'use strict';
/*
 * JAMAJAMA DANS LA FICHE JOUEUR
 * ═════════════════════════════
 *
 * « Ajouter les stats à la fiche (niveaux complétés et peut-être d'autres
 *   infos ?) »
 *
 * La fruticard de JamaJama n'existait pas : le `switch` d'époque
 * (Standard.getFrutiCardLines) n'a pas de branche pour lui. Le portage en
 * ajoute une, comme les combos de Swapou, et n'y écrit que ce qui est
 * SAUVEGARDÉ ou CONNU du serveur :
 *   · l'aventure : les niveaux finis de la chaîne de sauvegarde, sur les
 *     niveaux jouables de levels.xml, et pack par pack ;
 *   · le tournoi : les niveaux terminés (tiki blanc ou d'or — la règle de
 *     l'onglet Joueurs des Statistiques), dont les tikis d'or ;
 *   · les niveaux joués ($plays) et les niveaux publiés (mode Édition) ;
 *   · les pictos JamaJama obtenus.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FC = require(path.join(ROOT, 'fruticard.js'));
const R = require(path.join(ROOT, 'public/jamajama/regles.js'));
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function textes(lignes) {
  const out = [];
  (function marche(ls) {
    (ls || []).forEach((l) => {
      if (!l || typeof l !== 'object') return;
      if (l.list) marche(l.list);
      else if (l.lineList) marche(l.lineList);
      else if (l.type === 'text') out.push(l.param.text);
    });
  })(lignes);
  return out;
}
// La paire « libellé, valeur » d'une getSimpleScoreLine.
const valeur = (t, libelle) => t[t.indexOf(libelle) + 1];

// Un contexte comme celui du serveur : deux packs, dont un palier vide.
const CTX = {
  packs: [
    { titre: '   Premiers pas', jouables: [true, true, true, true] },
    { titre: 'A coeur vaillant', jouables: [false] },          // palier d'attente
    { titre: 'Le début du voyage', jouables: [true, true] },
  ],
  tournoi: [200001, 200002, 200003, 7],
  publies: 2,
  pictos: [{ nom: 'Premier coup de Tiki', obtenu: true }, { nom: '10 niveaux joués', obtenu: true },
    { nom: '25 niveaux joués', obtenu: false }],
};

test('le résumé ne compte que ce qui est sauvegardé, et sur ce qui existe', () => {
  const r = FC.resumeJamajama({
    // Pack 0 : trois niveaux finis (dont un indice hors du pack) ; pack 1 :
    // le palier, qui ne se compte pas ; pack 2 : un ; pack 9 : n'existe pas.
    aventure: '0[0,2,3,12;1[0;2[1;9[0,1;',
    niveaux: {
      200001: { p: 3, v: 1, b: 12, s: 2 },     // or
      200002: { p: 2, v: 1, b: 30, s: 1 },     // terminé
      200003: { p: 4, v: 0, b: 0, s: 0 },      // tombe : pas terminé
      999: { p: 1, v: 1, b: 5, s: 2 },         // un niveau retiré du tournoi
    },
    $plays: 9,
  }, CTX);
  assert.deepStrictEqual(r.aventure, {
    finis: 4, total: 6,
    packs: [{ titre: 'Premiers pas', total: 4, finis: 3 }, { titre: 'Le début du voyage', total: 2, finis: 1 }],
  });
  assert.deepStrictEqual(r.tournoi, { termines: 2, ors: 1, total: 4 });
  assert.strictEqual(r.joues, 9);
  assert.strictEqual(r.publies, 2);
  assert.deepStrictEqual(r.pictos, { obtenus: ['Premier coup de Tiki', '10 niveaux joués'], total: 3 });
});

test('une sauvegarde vide fait une carte de zéros, jamais une carte cassée', () => {
  const r = FC.resumeJamajama({}, CTX);
  assert.deepStrictEqual([r.aventure.finis, r.aventure.total, r.tournoi.termines, r.joues],
    [0, 6, 0, 0]);
  // Sans contexte non plus (le serveur ne l'aurait pas fourni).
  assert.doesNotThrow(() => FC.lignes('jamajama', { aventure: 'n\'importe quoi', niveaux: 5 }, 'x'));
});

test('la carte dessinée : aventure, packs, tournoi, parties, pictos', () => {
  assert.strictEqual(FC.aUneCarte('jamajama'), true, 'JamaJama a maintenant sa carte');
  assert.strictEqual(FC.nomJeu('jamajama'), 'JamaJama');
  const t = textes(FC.lignes('jamajama', {
    aventure: '0[0,1,2,3;2[0;', niveaux: { 200001: { s: 2 }, 7: { s: 1 } }, $plays: 14,
  }, 'tiki', CTX));
  assert.ok(t.includes('aventure') && t.includes('5 / 6 niveaux'), t.join(' | '));
  assert.strictEqual(valeur(t, 'Premiers pas'), '4 / 4', 'le titre du pack, sans ses espaces de tête');
  assert.strictEqual(valeur(t, 'Le début du voyage'), '1 / 2');
  assert.ok(!t.includes('A coeur vaillant'), 'un pack sans niveau jouable ne paraît pas');
  assert.ok(t.includes('tournoi'));
  assert.strictEqual(valeur(t, 'niveaux terminés'), '2 / 4');
  assert.strictEqual(valeur(t, "dont tikis d'or"), '1');
  assert.ok(t.includes('parties') && t.includes('14 niveaux joués'));
  assert.strictEqual(valeur(t, 'niveaux publiés'), '2');
  assert.ok(t.includes('pictos') && t.includes('2 / 3'));
  assert.ok(t.includes('Premier coup de Tiki') && t.includes('10 niveaux joués'));
  assert.ok(!t.includes('25 niveaux joués'), 'un picto pas encore obtenu ne s\'écrit pas');
});

test('le serveur fournit le contexte, et la fiche liste la carte', () => {
  assert.match(SERVEUR, /async function jamaContexteFiche\(username, inventaire\) \{/);
  assert.match(SERVEUR, /jouables: p\.niveaux\.map\(\(n\) => !!n\.contenu\)/);
  assert.match(SERVEUR, /tournoi: jamaTournoi\(\)\.map\(\(t\) => t\.id\)/);
  assert.match(SERVEUR, /lignes: FCard\.lignes\(jeu, carte, getDisplayName\(u\), contexte\),/);
  assert.match(SERVEUR, /const FCARD_GAMES = \[[^\]]*'jamajama'/);
});

// ── De bout en bout : un vrai serveur, de vraies parties rejouées ──────────
const PORT = 3797;
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5797', FRUTISCORE_PORT: '5798',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const poster = (chemin, corps) => fetch(BASE + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}).then((r) => r.json());
const lire = (chemin) => fetch(BASE + chemin).then((r) => r.json());
async function inscrire(pseudo) {
  await poster('/api/auth/register', { username: pseudo, password: 'secret123' });
  const j = await poster('/api/auth/login', { username: pseudo, password: 'secret123' });
  assert.ok(j.sid, 'session ' + pseudo);
  return j.sid;
}
function couloir(largeur) {
  const l = new R.Level();
  l.size = new R.Dimension(largeur, 2);
  const mur = new R.Element(null);
  mur.id = R.Element.WALL; mur.pos = new R.Coord(0, 1); mur.orientation = 0;
  const sortie = new R.Element(null);
  sortie.id = R.Element.EXIT; sortie.pos = new R.Coord(largeur - 1, 0); sortie.orientation = 0;
  l.tiles.push(mur, sortie);
  return l.dump();
}
const VERS_LA_SORTIE = (n) => Array.from({ length: n - 1 }, () => R.Direction.EAST);

test('la fiche d\'un joueur montre ses niveaux, son tournoi et ses pictos JamaJama', async () => {
  const auteur = await inscrire('jamafiche_aut');
  const v = await poster('/api/jamajama/edition/valider',
    { sid: auteur, titre: 'Couloir fiche', contenu: couloir(5), mouvements: [R.Direction.EAST, R.Direction.WEST].concat(VERS_LA_SORTIE(5)) });
  assert.ok(v.ok, JSON.stringify(v));

  const joueur = await inscrire('jamafiche_jou');
  const d = await lire('/api/jamajama/donnees?sid=' + joueur);
  const total = d.packs.reduce((n, p) => n + p.niveaux.filter((x) => x.contenu).length, 0);
  // Une victoire rejouée au tournoi (l'or : 4 coups contre 6).
  const r = await poster('/api/jamajama/score', { sid: joueur, source: 'tournoi', id: v.niveau.id, mouvements: VERS_LA_SORTIE(5) });
  assert.ok(r.ok && r.victorieux && r.statut.s === 2, JSON.stringify(r));
  // La sauvegarde d'aventure, telle que le jeu l'écrit.
  await poster('/api/jamajama/aventure', { sid: joueur, dt: '0[0,1,2;1[0;' });

  const fiche = await lire(`/api/light/fiche?sid=${joueur}&u=jamafiche_jou`);
  assert.ok(fiche.scores.fcards.some((g) => g.id === 'jamajama' && g.nom === 'JamaJama'),
    'la section « Fruticard ! » liste JamaJama');

  const carte = await lire(`/api/light/fruticard?sid=${auteur}&u=jamafiche_jou&g=jamajama`);
  assert.ok(carte.ok, JSON.stringify(carte));
  const t = textes(carte.lignes);
  assert.ok(t.includes(`4 / ${total} niveaux`), t.join(' | '));
  assert.strictEqual(valeur(t, 'Premiers pas'), '3 / 16');
  assert.strictEqual(valeur(t, 'Le début du voyage'), '1 / 13');
  assert.strictEqual(valeur(t, 'niveaux terminés'), `1 / ${d.tournoi.length}`);
  assert.strictEqual(valeur(t, "dont tikis d'or"), '1');
  assert.ok(t.includes('1 niveau joué'), 'la partie rejouée');
  assert.strictEqual(valeur(t, 'niveaux publiés'), '0');
  assert.ok(t.includes('0 / 28'), 'les 28 pictos JamaJama, aucun encore : ' + t.join(' | '));

  // Et la fiche de l'auteur compte son niveau publié — et son picto
  // « Créateur », tombé à la validation.
  const ca = await lire(`/api/light/fruticard?sid=${joueur}&u=jamafiche_aut&g=jamajama`);
  const ta = textes(ca.lignes);
  assert.strictEqual(valeur(ta, 'niveaux publiés'), '1');
  assert.ok(ta.includes('1 / 28') && ta.includes('Créateur'), ta.join(' | '));
});
