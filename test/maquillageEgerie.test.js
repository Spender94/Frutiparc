'use strict';
/*
 * LE MAQUILLAGE D'EGERIE — greffé image par image, vendu comme une incarnation.
 *
 * « Récupérer le make-up (lèvres + yeux + sourcils) et voir dans quelle mesure
 * on peut le mettre en boutique + le customiser (comme on le fait pour les
 * accessoires). » Puis : « Comment se fait-il qu'on ne puisse pas suivre les
 * mouvements de bouche ? Alors que ça marche pour Egerie. »
 *
 * Chez Egerie, le maquillage est dessiné DANS les clips de la bouche et des
 * yeux, image par image. On le récolte donc image par image
 * (scripts/extract-maquillage-egerie.js) et le moteur en fait des images de
 * rouleau — « bouche k + maquillage teinte t », « œil k + maquillage teinte t »
 * — au bout des rouleaux de la famille 0, comme les prunelles au bout du
 * rouleau d'iris. Le porteur garde ses yeux, sa bouche, son iris et son
 * accessoire ; la boutique vend chaque teinte comme une incarnation.
 *
 * Ce que ce test tient :
 *   · le PAQUET — les teintes (la première est celle d'Egerie), les bases, des
 *     formes aux rôles connus, 129 images de bouche et 46 d'œil ;
 *   · la RÉCOLTE est reproductible ;
 *   · la GREFFE — les rouleaux grandissent d'un bloc par teinte, les clips
 *     greffés gardent leurs images, leurs étiquettes et leur iris, le
 *     maquillage y est à chaque image et suit l'œil fermé ; ailleurs qu'en
 *     famille 0, elle se tait ;
 *   · la CORRESPONDANCE d'images — la même quand la ligne de temps est celle
 *     d'Egerie, par étiquette sinon ;
 *   · la BOUTIQUE — un article par teinte, au rayon Incarnations, à un numéro
 *     figé ; l'achat ne change que les yeux et la bouche, de bloc ; l'inventaire
 *     le range parmi les incarnations ; on le porte, on le retire.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3563;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-maquillage';
const RUN = Date.now().toString(36).slice(-5);
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

const Swf = require('../public/js/bouille-swf.js');
require('../public/js/bouille-avm.js');
const M = require('../public/js/bouille-moteur.js');

const FICHIER = path.join(ROOT, 'public/fbouille/maquillage-egerie.json');
const PAQUET = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
const ID_BASE = 610000;

function lireFamille(n) {
  const b = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille' + n + '.swf'));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}
const p2 = (n) => M.encode62(n, 2);
const dec = (s, i) => M.decode62(s.substring(i, i + 2));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5412', FRUTISCORE_PORT: '5413',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le serveur de test n’a pas démarré');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function joueur(nom, etat) {
  const corps = JSON.stringify({ username: nom, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body: corps });
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: hdr, body: corps })).json();
  assert.ok(r.sid, 'session ouverte pour ' + nom);
  if (etat) await fetch(BASE + '/do/eb?sid=' + r.sid + '&b=' + encodeURIComponent(etat));
  return r.sid;
}

// ── Le paquet ──────────────────────────────────────────────────────────────

test('le paquet : les teintes, les bases, des formes aux rôles connus, deux clips entiers', () => {
  assert.strictEqual(PAQUET.nom, 'Maquillage d’Egerie');
  assert.ok(PAQUET.teintes.length >= 6, 'plusieurs teintes');
  assert.strictEqual(PAQUET.teintes[0].cle, 'egerie', 'la première est celle d’Egerie');
  assert.deepStrictEqual(PAQUET.teintes[0].levres, [153, 153, 255], 'son lavande');
  for (const t of PAQUET.teintes) {
    assert.match(t.cle, /^[a-z]+$/);
    assert.strictEqual(t.levres.length, 3); assert.strictEqual(t.fard.length, 3);
  }
  assert.strictEqual(new Set(PAQUET.teintes.map((t) => t.cle)).size, PAQUET.teintes.length, 'des clés distinctes');
  assert.deepStrictEqual(PAQUET.base, { bouches: 5, yeux: 9 }, 'les rouleaux de la famille 0');
  assert.strictEqual(PAQUET.source.decalage, 500000, 'hors des autres paquets greffés');
  const roles = new Set();
  for (const [id, f] of Object.entries(PAQUET.formes)) {
    assert.ok(Number(id) >= 500000 && Number(id) < 501000, 'id décalé : ' + id);
    assert.ok(f.couches.length >= 1);
    for (const c of f.couches) { roles.add(c.role); assert.match(c.d, /^M/); assert.strictEqual(c.rgb.length, 3); }
  }
  assert.deepStrictEqual([...roles].sort(), ['fard', 'fixe', 'levres']);
  // Les deux clips, entiers, et chaque pose désigne une forme du paquet.
  assert.strictEqual(PAQUET.bouche.n, 129); assert.strictEqual(PAQUET.bouche.images.length, 129);
  assert.strictEqual(PAQUET.oeil.n, 46); assert.strictEqual(PAQUET.oeil.images.length, 46);
  assert.strictEqual(PAQUET.bouche.labels.parle0, 10); assert.strictEqual(PAQUET.oeil.labels.ferme, 5);
  for (const clip of [PAQUET.bouche, PAQUET.oeil]) {
    for (const ops of clip.images) for (const o of ops) {
      assert.ok(PAQUET.formes[o.ch], 'forme connue : ' + o.ch);
      assert.ok(o.prof >= 1 && o.M && typeof o.M.a === 'number');
    }
  }
  // Les lèvres à l'image 1, et sur les images de la parole ; rien pendant le sifflet (Egerie non plus).
  assert.ok(PAQUET.bouche.images[0].length >= 2, 'lèvres et reflet au repos');
  assert.ok(PAQUET.bouche.images[PAQUET.bouche.labels.parle1].length >= 1, 'les lèvres suivent la parole');
  assert.strictEqual(PAQUET.bouche.images[PAQUET.bouche.labels.siffle].length, 0, 'pas de lèvres sur le sifflet');
  // Le fard et le sourcil sur l'œil fermé.
  const ferme = PAQUET.oeil.images[PAQUET.oeil.labels.ferme - 1];
  const rolesFerme = ferme.flatMap((o) => PAQUET.formes[o.ch].couches.map((c) => c.role));
  assert.ok(rolesFerme.includes('fard') && rolesFerme.includes('fixe'), 'fard et sourcil sur l’œil fermé');
  assert.ok(PAQUET.oeil.images.every((ops) => ops.length), 'du maquillage sur chacune des 46 images');
});

test('la récolte est reproductible : relancer le script rend le même paquet', () => {
  const avant = fs.readFileSync(FICHIER, 'utf8');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/extract-maquillage-egerie.js')], { stdio: 'pipe' });
  assert.strictEqual(fs.readFileSync(FICHIER, 'utf8'), avant);
});

// ── La greffe ──────────────────────────────────────────────────────────────

test('la greffe ajoute un bloc par teinte au bout des rouleaux, et se tait ailleurs', async () => {
  const d = await lireFamille(0);
  const table = M.grefferMaquillage(d, PAQUET);
  assert.deepStrictEqual(table.base, { bouches: 5, yeux: 9 });
  assert.strictEqual(table.teintes.egerie, 0);
  const T = PAQUET.teintes.length;
  const mo = new M.Moteur(d, { alea: () => 0.5 });
  mo.creerVisage(); mo.definir('000000010000000000000000');
  assert.strictEqual(mo.racine.face.enfantNomme('b').def.n, 5 * (1 + T), 'bouches : un bloc de cinq par teinte');
  assert.strictEqual(mo.racine.face.enfantNomme('oa').def.n, 9 * (1 + T), 'yeux : un bloc de neuf par teinte');
  // Idempotente.
  assert.strictEqual(M.grefferMaquillage(d, PAQUET), table);
  assert.strictEqual(mo.racine.face.enfantNomme('b').def.n, 5 * (1 + T));
  // Une autre famille n'a pas ces rouleaux : rien ne bouge.
  const h = await lireFamille(12);
  const mh = new M.Moteur(h, { alea: () => 0.5 }); mh.creerVisage(); mh.definir('0c0000010000000000000000');
  const avant = mh.racine.face.enfantNomme('b').def.n;
  assert.strictEqual(M.grefferMaquillage(h, PAQUET), null);
  assert.strictEqual(mh.racine.face.enfantNomme('b').def.n, avant);
});

test('un clip greffé est le clip d’origine, maquillé à chaque image, iris compris', async () => {
  const d = await lireFamille(0);
  M.grefferMaquillage(d, PAQUET);
  const mo = new M.Moteur(d, { alea: () => 0.5 });
  mo.creerVisage();
  for (let k = 0; k < 5; k++) {
    // La bouche k nue, puis la bouche k + teinte 1 (index 5 × 2 + k).
    mo.definir(p2(0) + p2(0) + p2(0) + p2(8) + p2(k) + p2(2) + p2(7) + p2(0) + p2(0) + p2(0) + p2(0) + p2(0));
    const nue = mo.racine.face.enfantNomme('b').enfantNomme('b');
    mo.definir(p2(0) + p2(0) + p2(0) + p2(8) + p2(10 + k) + p2(2) + p2(7) + p2(0) + p2(0) + p2(0) + p2(0) + p2(0));
    const maq = mo.racine.face.enfantNomme('b').enfantNomme('b');
    assert.notStrictEqual(maq.def, nue.def, 'bouche ' + k + ' : un autre clip');
    assert.strictEqual(maq.def.n, nue.def.n, 'bouche ' + k + ' : autant d’images');
    assert.deepStrictEqual(maq.def.labels, nue.def.labels, 'bouche ' + k + ' : mêmes étiquettes');
    for (const nom of ['parle0', 'rire0', 'mdr0']) {
      maq.allerImage(nom, false);
      const greffes = [...maq.enfants.keys()].filter((prof) => prof >= 200);
      assert.ok(greffes.length >= 1, 'bouche ' + k + ' @' + nom + ' : du maquillage (' + greffes.join(',') + ')');
      const propres = [...maq.enfants.keys()].filter((prof) => prof < 200);
      nue.allerImage(nom, false);
      assert.deepStrictEqual(propres, [...nue.enfants.keys()], 'bouche ' + k + ' @' + nom + ' : la bouche d’origine dessous');
    }
  }
  for (let k = 0; k < 9; k++) {
    mo.definir(p2(0) + p2(9 + k) + p2(3) + p2(8) + p2(0) + p2(2) + p2(7) + p2(0) + p2(0) + p2(0) + p2(0) + p2(0));
    const o = mo.racine.face.enfantNomme('oa').enfantNomme('o');
    const iris = o.enfantNomme('p');
    assert.ok(iris, 'œil ' + k + ' : l’iris est là');
    assert.strictEqual(iris.frame, 4, 'œil ' + k + ' : et c’est celui de la chaîne (3 + 1)');
    for (const nom of ['normal', 'ferme', 'content', 'regardG']) {
      o.allerImage(nom, false);
      assert.ok([...o.enfants.keys()].some((prof) => prof >= 200), 'œil ' + k + ' @' + nom + ' : du maquillage');
    }
  }
  // Les teintes : les lèvres de la teinte 1 ont sa couleur, les cils restent noirs.
  const t1 = PAQUET.teintes[1];
  const levres = Object.values(PAQUET.formes).find((f) => f.couches[0].role === 'levres');
  assert.deepStrictEqual(d.formes.get(levres.id + 1000).couches[0].rgb, t1.levres);
  const cils = Object.values(PAQUET.formes).find((f) => f.couches.some((c) => c.role === 'fixe'));
  const k = cils.couches.findIndex((c) => c.role === 'fixe');
  assert.deepStrictEqual(d.formes.get(cils.id + 1000).couches[k].rgb, [0, 0, 0]);
});

test('la correspondance d’images : la même sur la bouche 2, par étiquette ailleurs', async () => {
  const d = await lireFamille(0);
  const mo = new M.Moteur(d, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(p2(0) + p2(0) + p2(0) + p2(8) + p2(2) + p2(2) + p2(7) + p2(0) + p2(0) + p2(0) + p2(0) + p2(0));
  const b2 = mo.racine.face.enfantNomme('b').enfantNomme('b').def;
  assert.strictEqual(b2.n, PAQUET.bouche.n, 'la bouche 2 est celle d’Egerie');
  assert.deepStrictEqual(b2.labels, PAQUET.bouche.labels);
  for (const f of [1, 10, 46, 129]) assert.strictEqual(M.imageCorrespondante(f, b2, PAQUET.bouche, true), f);
  mo.definir(p2(0) + p2(0) + p2(0) + p2(8) + p2(0) + p2(2) + p2(7) + p2(0) + p2(0) + p2(0) + p2(0) + p2(0));
  const b0 = mo.racine.face.enfantNomme('b').enfantNomme('b').def;
  assert.notStrictEqual(b0.n, PAQUET.bouche.n, 'la bouche 0 a une autre ligne de temps');
  assert.strictEqual(M.imageCorrespondante(b0.labels.mdr0, b0, PAQUET.bouche, false), PAQUET.bouche.labels.mdr0, 'mdr0 → mdr0');
  assert.strictEqual(M.imageCorrespondante(b0.labels.mdr0 + 3, b0, PAQUET.bouche, false), PAQUET.bouche.labels.mdr0 + 3, 'même décalage');
  assert.strictEqual(M.imageCorrespondante(b0.labels.rire0 - 1, b0, PAQUET.bouche, false), PAQUET.bouche.labels.rire0 - 1, 'la fin du segment d’avant');
  assert.strictEqual(M.imageCorrespondante(1, b0, PAQUET.bouche, false), 1, 'le repos');
  // Un décalage plus long que le segment du modèle se borne à sa dernière image.
  const long = { n: 30, labels: { parle0: 10, parle1: 25 }, images: [] };
  assert.strictEqual(M.imageCorrespondante(24, long, PAQUET.bouche, false), PAQUET.bouche.labels.parle1 - 1);
});

// ── La boutique ────────────────────────────────────────────────────────────

test('chaque teinte est un article du rayon Incarnations, à un numéro figé', async () => {
  const mienne = '00030507020f0m09020t0a00';           // yeux 3, bouche 2, bonnet de nuit
  const sid = await joueur('maqr' + RUN, mienne);
  const s = await (await fetch(BASE + '/api/light/shop?sid=' + sid)).json();
  const rayon = (s.categories || []).find((c) => c.name === 'Incarnations');
  assert.ok(rayon, 'le rayon existe');
  const items = rayon.items.filter((a) => a.maquillage);
  assert.strictEqual(items.length, PAQUET.teintes.length, 'une teinte, un article');
  PAQUET.teintes.forEach((t, i) => {
    const a = items.find((x) => x.maquillage === t.cle);
    assert.ok(a, 'la teinte ' + t.cle);
    assert.strictEqual(a.id, ID_BASE + i, 'numéro figé : 610000 + t');
    assert.strictEqual(a.kind, 'incarnation');
    assert.strictEqual(a.price, 80);
    assert.strictEqual(a.owned, false); assert.strictEqual(a.offert, false);
    assert.match(a.name, /Maquillage d’Egerie/);
    // L'aperçu : SA bouille, yeux et bouche passés dans le bloc de la teinte.
    assert.strictEqual(a.etat.length, 24);
    const diff = [];
    for (let k = 0; k < 24; k++) if (a.etat[k] !== s.bouille[k]) diff.push(k);
    assert.ok(diff.every((k) => [2, 3, 8, 9].includes(k)), 'seuls yeux et bouche changent, pas ' + diff.join(','));
    assert.strictEqual(dec(a.etat, 2), 9 * (1 + i) + 3, 'yeux 3, teinte ' + i);
    assert.strictEqual(dec(a.etat, 8), 5 * (1 + i) + 2, 'bouche 2, teinte ' + i);
    assert.strictEqual(a.etat.substring(15), mienne.substring(15), 'le bonnet reste');
  });
});

test('acheter le maquillage ne change que les yeux et la bouche — de bloc', async () => {
  const mienne = '00030507020f0m09020t0a00';
  const sid = await joueur('maqa' + RUN, mienne);
  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: ID_BASE + 1 }),
  })).json();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.bouille.length, 24);
  assert.strictEqual(dec(r.bouille, 2), 9 * 2 + 3, 'yeux 3 + teinte 1');
  assert.strictEqual(dec(r.bouille, 8), 5 * 2 + 2, 'bouche 2 + teinte 1');
  assert.strictEqual(r.bouille.substring(0, 2) + r.bouille.substring(4, 8) + r.bouille.substring(10), mienne.substring(0, 2) + mienne.substring(4, 8) + mienne.substring(10), 'le reste est intact');
  const encore = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: ID_BASE + 1 }),
  })).json();
  assert.strictEqual(encore.ok, false, 'déjà possédé');
  // L'inventaire le range parmi les incarnations, pas les accessoires.
  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  const inc = (inv.incarnations || []).find((i) => i.maquillage === PAQUET.teintes[1].cle);
  assert.ok(inc, 'dans les incarnations');
  assert.strictEqual(inc.etat, r.bouille, 'avec l’état à enfiler');
  assert.ok(!(inv.accessoires || []).some((a) => a.etat === r.bouille), 'pas parmi les accessoires');
  // On le porte : la bouille principale reste la sienne ; on le retire : on la retrouve.
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(r.bouille));
  const porte = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.strictEqual(porte.bouillePrincipale, mienne, 'la principale ne suit pas le maquillage');
  const moi = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  assert.ok(JSON.stringify(moi).includes(r.bouille), 'mais c’est bien lui qu’on montre');
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(mienne));
  const retire = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.strictEqual(retire.bouillePrincipale, mienne);
});

test('une bouille déjà maquillée change de teinte, une autre famille reste intacte', async () => {
  // Un compte qui n'a montré qu'une bouille maquillée (teinte 2, yeux 4, bouche 2).
  const sid = await joueur('maqt' + RUN, '00' + p2(9 * 3 + 4) + '0507' + p2(5 * 3 + 2) + '0f0m09020t0a00');
  const s = await (await fetch(BASE + '/api/light/shop?sid=' + sid)).json();
  const a = s.categories.find((c) => c.name === 'Incarnations').items.find((x) => x.maquillage === 'egerie');
  // C'est une incarnation : sa bouille PRINCIPALE est celle par défaut (il a
  // enfilé sans qu'on ait vu sa tête), et l'aperçu la maquille en teinte 0.
  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.strictEqual(inv.bouillePrincipale, '000000010000000000000000');
  assert.strictEqual(Math.floor(dec(a.etat, 2) / 9), 1, 'bloc de la teinte 0');
  assert.strictEqual(Math.floor(dec(a.etat, 8) / 5), 1);
  // Une vieille chaîne dont la bouche déborde SANS que les yeux suivent n'est
  // pas un maquillage : elle reste une bouille ordinaire, et principale.
  const sid2 = await joueur('maqv' + RUN, '000305070b0f0m09020t0a00');
  const inv2 = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid2)).json();
  assert.strictEqual(inv2.bouillePrincipale, '000305070b0f0m09020t0a00');
});

// ── Les deux clients, et la base ───────────────────────────────────────────

test('le lecteur greffe le maquillage au chargement de la famille, et le reconnaît comme incarnation', () => {
  const vignette = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  assert.match(vignette, /maquillage-egerie\.json/, 'le paquet est chargé');
  assert.match(vignette, /M\.grefferMaquillage\(r\[0\], r\[3\]\)/, 'et greffé avec la famille');
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /MAQ_YEUX = 9, MAQ_BOUCHES = 5/);
  assert.match(light, /return te >= 1 && te === tb;/, 'isIncarnation : yeux et bouche dans le même bloc');
  assert.match(light, /if \(i\.maquillage\) \{/, 'l’inventaire recompose le maquillage sur SA bouille');
  const planche = fs.readFileSync(path.join(ROOT, 'public/bouille-js.html'), 'utf8');
  assert.match(planche, /grefferMaquillage\(defs, chargement\[2\]\)/, 'la page d’aperçu aussi');
  const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(db, /ADD COLUMN IF NOT EXISTS maquillage TEXT DEFAULT ''/, 'la colonne de l’article');
  assert.match(db, /if \(r\.maquillage\) p\.maquillage = r\.maquillage;/);
  assert.match(db, /maquillage = \$13/);
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /const YEUX_ORIGINE_MAX = 8;/);
  assert.match(serveur, /if \(def && def\.maquillage && !p\.maquillage\) p\.maquillage = def\.maquillage;/, 'le rattrapage depuis la base');
});
