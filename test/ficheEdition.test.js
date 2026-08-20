/*
 * La fiche, côté mobile : la modifier, la dater, la ranger.
 *
 * Quatre choses tenaient le mobile en retrait du bureau :
 *
 *   · SA fiche était en lecture seule. Le bureau ouvre « modifier ma fiche »
 *     (win.EditInfo) sur /do/gmi + /do/smi ; le mobile n'avait rien. Il a
 *     maintenant le même formulaire, et le MÊME écrivain — /do/smi.
 *   · Personne ne pouvait EFFACER un champ : /do/smi retombait sur l'ancienne
 *     valeur dès que la chaîne arrivait vide (`source.f || user.firstName`).
 *     Un champ présent fait désormais foi, même vide.
 *   · La date de dernière connexion existait en base (last_login, écrite à
 *     chaque identification) sans jamais remonter. Elle s'affiche à présent
 *     dans la section « bonus » des deux clients — d'où l'attribut `lc` du
 *     XML userinfo, et `bonus.derniereConnexion` côté mobile.
 *   · Les lignes de scores n'avaient pas l'icône de leur jeu.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3499;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5240', FRUTISCORE_PORT: '5241',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const fiche = (sid, u) =>
  fetch(`${BASE}/api/light/fiche?sid=${sid}&u=${encodeURIComponent(u)}`).then((r) => r.json());
const profil = (sid) =>
  fetch(`${BASE}/api/light/profil?sid=${sid}`).then((r) => r.json());
const enregistrer = (sid, champs) =>
  fetch(BASE + '/do/smi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ sid }, champs)).toString(),
  });

test('le mobile lit sa fiche modifiable, listes de pays comprises', async () => {
  const u = 'fed' + RUN;
  const sid = await sidPour(u);
  const j = await profil(sid);
  assert.equal(j.ok, true);
  // Les mêmes champs que /do/gmi sert au bureau.
  for (const k of ['prenom', 'nom', 'nomPublic', 'anniversaire', 'sexe', 'metier',
    'ville', 'pays', 'region', 'site', 'commentaire']) {
    assert.ok(k in j.profil, 'champ manquant : ' + k);
  }
  // Et la table des pays — celle de lang_french.xml, pas un second référentiel.
  const fr = j.pays.find((p) => p.nom === 'France');
  assert.ok(fr, 'la France est au catalogue');
  assert.ok(fr.regions.length > 50, 'avec ses départements : ' + fr.regions.length);
  assert.ok(fr.regions.some((r) => r.nom === 'Paris'), 'dont Paris');
});

test('modifier sa fiche depuis le mobile écrit là où le bureau écrit', async () => {
  const u = 'fmod' + RUN;
  const sid = await sidPour(u);
  const r = await enregistrer(sid, {
    f: 'Rémi', l: 'Jallageas', p: 'Y', g: 'F', j: 'Testeur',
    c: 'Nantes', o: '1', r: '44', u: 'http://exemple.fr', m: 'Bonjour !',
    d: '1988-03-04',
  });
  assert.equal(r.status, 200);

  const p = (await profil(sid)).profil;
  assert.equal(p.prenom, 'Rémi');
  assert.equal(p.nom, 'Jallageas');
  assert.equal(p.sexe, 'F');
  assert.equal(p.metier, 'Testeur');
  assert.equal(p.ville, 'Nantes');
  assert.equal(p.region, '44');
  assert.equal(p.anniversaire, '1988-03-04');

  // La FICHE publique montre la même chose — c'est un seul jeu de données.
  const f = await fiche(sid, u);
  assert.equal(f.perso.prenom, 'Rémi');
  assert.equal(f.perso.ville, 'Nantes');
  assert.equal(f.perso.pays, 'France');
  assert.equal(f.perso.region, 'Loire-Atlantique');
  assert.equal(f.bonus.commentaire, 'Bonjour !');
  assert.equal(f.bonus.site, 'http://exemple.fr');
});

test('un champ vidé le RESTE — on peut effacer son nom ou son commentaire', async () => {
  const u = 'fvid' + RUN;
  const sid = await sidPour(u);
  await enregistrer(sid, { f: 'Jean', l: 'Dupont', c: 'Lyon', m: 'coucou', u: 'http://a.fr' });
  assert.equal((await profil(sid)).profil.prenom, 'Jean');

  // Le formulaire renvoie TOUS ses champs, celui-ci vidé : il doit partir.
  await enregistrer(sid, { f: '', l: 'Dupont', c: '', m: '', u: '' });
  const p = (await profil(sid)).profil;
  assert.equal(p.prenom, '', 'le prénom est effacé');
  assert.equal(p.ville, '', 'la ville aussi');
  assert.equal(p.commentaire, '', 'et le commentaire');
  assert.equal(p.nom, 'Dupont', 'ce qu’on n’a pas touché ne bouge pas');

  // Un appel PARTIEL, lui, ne doit rien effacer : c'est le garde-fou d'origine
  // (des clients anciens n'envoient qu'une partie du formulaire).
  await enregistrer(sid, { c: 'Lille' });
  const q = (await profil(sid)).profil;
  assert.equal(q.ville, 'Lille');
  assert.equal(q.nom, 'Dupont', 'le nom survit à un envoi partiel');
});

test('la fiche date la dernière connexion, et le bureau la reçoit aussi', async () => {
  const u = 'fcnx' + RUN;
  const sid = await sidPour(u);
  const f = await fiche(sid, u);
  const d = f.bonus.derniereConnexion;
  assert.ok(d, 'la date est servie');
  const t = Date.parse(d);
  assert.ok(Number.isFinite(t), 'et lisible : ' + d);
  assert.ok(Math.abs(Date.now() - t) < 5 * 60 * 1000,
    'elle vaut « à l’instant » — on vient de se connecter');

  // Côté bureau, c'est l'attribut `lc` du XML userinfo qui la porte : le
  // serveur doit l'écrire au format à points des autres dates de la fiche.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /lc="\$\{escapeXml\(getDerniereConnexion\(ud\)\)\}"/,
    'le XML userinfo porte la dernière connexion');
  assert.equal((src.match(/lc="\$\{escapeXml\(getDerniereConnexion/g) || []).length, 2,
    'sur les DEUX réponses userinfo (la sienne et celle d’un autre)');
});

test('chaque ligne de scores porte le voyant de son jeu', async () => {
  const u = 'fsco' + RUN;
  const sid = await sidPour(u);
  await fetch(`${BASE}/api/saveScore?sid=${sid}&game=snake3&score=4242&m=0`);
  await fetch(`${BASE}/api/saveScore?sid=${sid}&game=kaluga&score=1200&m=0`);

  const f = await fiche(sid, u);
  const jeux = f.scores.classements.map((c) => c.jeu);
  assert.ok(jeux.includes('snake3') && jeux.includes('kaluga'),
    'la fiche livre la CLÉ du jeu, de quoi choisir son icône : ' + jeux.join(','));

  // Le voyant existe pour chacun des jeux classables — c'est l'icône « en
  // partie » du bureau (clip 246 de main.swf), pas la jaquette du disque.
  for (const jeu of ['bkiwi', 'snake3', 'mb2', 'kaluga', 'swapou', 'grapiz',
    'bandas', 'miniwave', 'minipixiz', 'minifever']) {
    const f = path.join(ROOT, 'public/fb/voyant_' + jeu + '.png');
    assert.ok(fs.existsSync(f), 'voyant_' + jeu + '.png doit exister');
    // Et porter un dessin : une vignette vide passerait inaperçue sur la fiche,
    // alors qu'elle trahit une extraction ratée (Mini-Fever, dont l'image du
    // clip 246 est un bitmap greffé, s'était vidée ainsi).
    assert.ok(fs.statSync(f).size > 800,
      'voyant_' + jeu + '.png est vide : ' + fs.statSync(f).size + ' octets');
  }
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /ico\.src = voyantDuJeu\(c\.jeu\)/,
    'la ligne de scores pose le voyant du jeu');
  assert.match(html, /VOYANT_ASSET_KEY = \{ swapou2: "swapou" \}/,
    'seul Swapou change de nom entre le serveur et le fichier');
});

test('la carte mobile reprend les gestes du bureau', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // La bouille du bureau ouvre sa fiche : la scène est une iframe, d'où le
  // calque de clic par-dessus.
  assert.match(html, /id="home-avatar-fiche"/, 'la bouille du bureau est cliquable');
  // La vignette d'un joueur dans le tableau des scores ouvre la sienne.
  assert.match(html, /<span class="b" data-fiche="' \+ xmlEscape\(s\.user\)/,
    'la bouille d’une ligne de scores ouvre la fiche du joueur');
  // Les icônes du bureau se rangent, et l'ordre se retient.
  assert.match(html, /fp_bureau_ordre_/, 'l’ordre des icônes est mémorisé');
  assert.match(html, /grille\.insertBefore\(tuile,/, 'et la grille se réordonne au geste');
  // Le glisser-déposer NATIF du navigateur doit être écarté, sans quoi il
  // avale les événements de pointeur dès le deuxième mouvement.
  assert.match(html, /addEventListener\("dragstart", function \(ev\) \{ ev\.preventDefault\(\); \}\)/,
    'le glisser natif est neutralisé');
  // Les boutons de modération ne doivent plus s'afficher sur toutes les fiches :
  // `display:flex` l'emportait sur la règle [hidden] du navigateur.
  assert.match(html, /\.fiche-actions button\[hidden\] \{ display: none; \}/,
    'l’attribut hidden retrouve son effet sur les boutons de la fiche');
});
