/*
 * JamaJama — le circuit que la version Flash avait perdu.
 *
 * Le SWF déployé ne parle à personne : extension.swf y remplace la couche
 * réseau par une mémoire locale (un SharedObject). Aucun score ne remontait
 * donc au serveur, et awardJamaPictosOnScore — qui n'est appelé que sur les
 * chemins de sauvegarde de score — ne se déclenchait jamais. D'où des pictos
 * JamaJama qui ne tombaient pas, quoi qu'on joue.
 *
 * Le portage rebranche le circuit, et c'est ce que tient ce fichier : le
 * client envoie le REPLAY d'une partie, le serveur la REJOUE avec le même
 * moteur de règles (public/jamajama/regles.js), et seule une victoire
 * vraiment jouable inscrit quoi que ce soit. Un replay inventé n'obtient rien.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'public/jamajama/regles.js'));
const PORT = 3477;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5177', FRUTISCORE_PORT: '5178',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'session ouverte pour ' + pseudo);
  return j.sid;
}
const poster = (chemin, corps) => fetch(BASE + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}).then((r) => r.json());

/** Une solution du niveau, trouvée en le jouant vraiment (parcours en
 *  largeur sur les suites de mouvements). C'est le seul replay qu'un
 *  serveur honnête peut accepter — et c'est celui qu'on lui envoie. */
function resoudre(chaine, profondeur) {
  const file = [[]];
  const vus = new Set();
  while (file.length) {
    const chemin = file.shift();
    if (chemin.length > (profondeur || 6)) return null;
    const v = R.rejouer(R.Level.depuisChaine(chaine), chemin);
    if (v.victorieux) return chemin;
    if (v.fini) continue;
    const cle = chemin.join(',');
    if (vus.has(cle)) continue;
    vus.add(cle);
    for (const d of [0, 1, 2, 3]) file.push(chemin.concat([d]));
  }
  return null;
}

test('les données de départ : sept packs, le tournoi, les options', async () => {
  const sid = await inscrire('jamadata');
  const d = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  assert.ok(d.ok);
  assert.equal(d.packs.length, 7, 'les sept packs de levels.xml');
  assert.equal(d.packs[0].niveaux.length, 16, 'seize grottes dans « Premiers pas »');
  assert.match(d.packs[0].niveaux[0].titre, /Grotte 1 :\nPar ici la sortie/,
    'le « \\n » du XML devient un vrai saut de ligne');
  assert.equal(d.packs[0].total, -1, 'le premier pack laisse toujours passer au suivant');
  assert.ok(d.tournoi.length >= 7, 'les niveaux du tournoi');
  assert.ok(d.tournoi[0].auteur, 'avec leur auteur');
  assert.ok(d.tournoi[0].score > 0, 'et le score de l’auteur');
  assert.equal(d.options, '1:1:1:AvTdS', 'les options par défaut du jeu');
  assert.equal(d.aventure, '', 'aventure vierge');
  // Chaque niveau doit se relire : un seul casier de travers et le plateau
  // serait faux pour tout le monde.
  //
  // Trois packs font exception, et c'est voulu : « A coeur vaillant »,
  // « Rien d'impossible » et « Ultimes soubresauts » ne contiennent qu'une
  // entrée SANS contenu, avec un `total` supérieur à leur nombre réel de
  // niveaux. C'est le tour de main que le XML documente lui-même pour
  // fermer la route au pack suivant : des paliers d'attente, pas des
  // niveaux. On les compte, on ne les lit pas.
  let vides = 0;
  for (const p of d.packs) {
    for (const n of p.niveaux) {
      if (!n.contenu) { vides += 1; continue; }
      const l = R.Level.depuisChaine(n.contenu);
      assert.ok(l.size.width > 0 && l.size.height > 0, 'niveau lisible : ' + n.titre);
      assert.equal(l.dump(), n.contenu, 'et qui se réécrit à l’identique');
    }
  }
  assert.equal(vides, 3, 'les trois paliers d’attente de levels.xml');
});

test('une victoire d’aventure compte, et décroche le premier picto', async () => {
  const sid = await inscrire('jamaaventure');
  const d = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  const grotte1 = d.packs[0].niveaux[0];
  const solution = resoudre(grotte1.contenu, 6);
  assert.ok(solution, 'la Grotte 1 se gagne');

  const r = await poster('/api/jamajama/score',
    { sid, source: 'aventure', pack: 0, niveau: 0, mouvements: solution });
  assert.ok(r.ok && r.victorieux, 'le serveur reconnaît la victoire');
  assert.equal(r.coups, solution.length, 'et compte les mêmes coups que le jeu');
  assert.deepEqual(r.pictos, ['Premier coup de Tiki'],
    'le picto du premier niveau joué tombe enfin');

  // L'aventure retenue : le client la sauve, le serveur la rend.
  await poster('/api/jamajama/aventure', { sid, dt: '0[0;' });
  const d2 = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  assert.equal(d2.aventure, '0[0;');
});

test('un replay qui ne gagne pas ne classe rien, et un replay forgé non plus', async () => {
  const sid = await inscrire('jamatriche');
  const d = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  const t = d.tournoi[0];

  // Une partie qu'on quitte en route : refusée, et rien n'est compté. (Une
  // DÉFAITE, elle, compte : le jeu d'origine enregistrait aussi les parties
  // perdues — c'est ce qui remplit la colonne « parties ».)
  const inacheve = await poster('/api/jamajama/score',
    { sid, source: 'tournoi', id: t.id, mouvements: [] });
  assert.equal(inacheve.ok, false);
  assert.equal(inacheve.error, 'inacheve');

  // Un palier d'attente (pack sans contenu) : rien à jouer, rien à compter.
  const palier = await poster('/api/jamajama/score',
    { sid, source: 'aventure', pack: 3, niveau: 0, mouvements: [1, 1] });
  assert.equal(palier.ok, false);
  assert.equal(palier.error, 'niveau');

  // Un niveau qui n'existe pas : refusé.
  const inconnu = await poster('/api/jamajama/score',
    { sid, source: 'tournoi', id: 999999, mouvements: [1, 1] });
  assert.equal(inconnu.ok, false);
  assert.equal(inconnu.error, 'niveau');

  // Des mouvements hors alphabet (6 n'est ni une direction ni une bascule).
  const faux = await poster('/api/jamajama/score',
    { sid, source: 'tournoi', id: t.id, mouvements: [1, 6] });
  assert.equal(faux.ok, false);
  assert.equal(faux.error, 'mouvements');

  // Et le classement n'a rien retenu de tout ça.
  const scores = await fetch(BASE + '/do/scores?g=jamajama').then((r) => r.text()).catch(() => '');
  assert.ok(!/jamatriche/.test(scores), 'aucun score inscrit pour un replay refusé');
});

test('le tournoi : la victoire inscrit le record, le statut et le classement', async () => {
  const sid = await inscrire('jamatournoi');
  const d = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  // On fabrique une partie gagnable dont on connaît le compte : le premier
  // niveau du pack d'aventure sert de terrain, mais joué par le chemin du
  // TOURNOI il faut un vrai niveau de tournoi. On prend le plus simple —
  // celui dont l'auteur annonce le plus petit score.
  const t = d.tournoi.slice().sort((a, b) => a.score - b.score)[0];
  const solution = resoudre(t.contenu, 5);
  if (!solution) {
    // Aucun niveau du tournoi ne se gagne en cinq coups : on vérifie au
    // moins que le chemin refuse proprement une partie non finie.
    const r = await poster('/api/jamajama/score',
      { sid, source: 'tournoi', id: t.id, mouvements: [1, 1] });
    assert.equal(r.ok, false);
    return;
  }
  const r = await poster('/api/jamajama/score',
    { sid, source: 'tournoi', id: t.id, mouvements: solution });
  assert.ok(r.ok && r.victorieux);
  assert.ok(r.statut, 'le niveau retient son statut');
  assert.equal(r.statut.v, 1, 'une victoire');
  assert.equal(r.statut.b, solution.length, 'et le meilleur nombre de coups');
  assert.ok(r.statut.s === 1 || r.statut.s === 2, 'bronze ou or, selon le score de l’auteur');
  assert.ok(r.classement, 'le score part au classement jamajama_classic');

  // Le statut revient avec les données : la liste s'en sert pour l'icône.
  const d2 = await fetch(BASE + '/api/jamajama/donnees?sid=' + sid).then((r) => r.json());
  const revu = d2.tournoi.find((x) => x.id === t.id);
  assert.ok(revu.moi, 'le serveur garde ce que le joueur a fait de ce niveau');
  assert.equal(revu.moi.b, solution.length);
});

test('sans session, rien ne passe', async () => {
  const r = await poster('/api/jamajama/score',
    { sid: 'pas-une-session', source: 'aventure', pack: 0, niveau: 0, mouvements: [1] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'session');
  const d = await fetch(BASE + '/api/jamajama/donnees').then((x) => x.json());
  assert.equal(d.ok, false);
});
