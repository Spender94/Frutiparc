/*
 * L'EXPLORATEUR du bureau light — « Mes disques » et « Inventaire ».
 *
 * Le mobile ouvre deux feuilles ; le bureau ouvre la FENÊTRE JAUNE de main.swf
 * (`win.Explorer` / `box.Explorer`), qui lit ses dossiers par la même API que
 * le bureau Flash : /ff/tree pour l'arbre, /ff/ls pour le contenu.
 *
 * Ce fichier tient les trois moitiés de la ressemblance :
 *
 *   · la SOURCE — /ff/tree TYPE les trois dossiers de l'inventaire
 *     (« inventory », d'où le coffre) et /ff/ls rend ce que la fenêtre sait
 *     dessiner : des disques (type + nom de jaquette), des accessoires
 *     (« bouille » + état complet), des fonds d'écran, des pictos ;
 *   · les DESSINS — le coffre, la boîte à disques, les cinq anneaux de FD, les
 *     jaquettes et les quatre boutons de la barre d'outils existent vraiment,
 *     sortis de fileIcon.swf et de main.swf par scripts/extract-frutiz-explorer.js ;
 *   · le PORTAGE — les deux fenêtres sont déclarées au gabarit d'époque
 *     (400 × 400 plus le contour, pastille « winExplorer »), et les deux tuiles
 *     du bureau ne détournent la feuille mobile QUE sur desktop.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3524;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

let proc = null;
let sid = null;
const USER = 'expl' + RUN;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5320', FRUTISCORE_PORT: '5321',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) { pret = true; break; } } catch { /* pas prêt */ }
    await wait(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  const corps = JSON.stringify({ username: USER, password: 'secret123' });
  const entetes = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: entetes, body: corps });
  const rep = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: entetes, body: corps })).json();
  sid = rep.sid;
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('expl')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const ls = async (uid) => (await fetch(
  `${BASE}/ff/ls?uid=${encodeURIComponent(uid)}&sid=${encodeURIComponent(sid)}`)).text();

// ── L'ARBRE : c'est lui qui donne son coffre à l'inventaire ────────────────
test('l’arbre type les trois dossiers de l’inventaire en « inventory »', async () => {
  const xml = await (await fetch(`${BASE}/ff/tree?sid=${encodeURIComponent(sid)}`)).text();
  for (const uid of ['inv_accessories', 'inv_wallpapers', 'inv_pictos']) {
    const m = new RegExp(`<f u="${uid}"[^>]*t="([^"]+)"`).exec(xml)
      || new RegExp(`<f u="${uid}"[^>]*?t="([^"]+)"`).exec(xml);
    assert.ok(m, `${uid} absent de l’arbre`);
    assert.strictEqual(m[1], 'inventory', `${uid} doit porter le coffre`);
  }
  // Et la boîte à disques a son propre dessin.
  assert.match(xml, /<f u="disccollector"[^>]*t="disccollector"/);
});

// ── LE CONTENU : ce que la fenêtre sait dessiner ──────────────────────────
test('la racine de l’inventaire porte ses trois dossiers', async () => {
  const xml = await ls('inventory');
  assert.match(xml, /<f u="inv_accessories"/);
  assert.match(xml, /<f u="inv_wallpapers"/);
  assert.match(xml, /<f u="inv_pictos"/);
});

test('un accessoire arrive en « bouille » avec son état complet', async () => {
  const xml = await ls('inv_accessories');
  const m = /<e u="[^"]*" t="bouille"[^>]*>([^<]*)<\/e>/.exec(xml);
  assert.ok(m, 'aucun accessoire');
  const lignes = m[1].split('\n');
  assert.ok(lignes[0].length > 0, 'l’accessoire doit porter un nom');
  assert.strictEqual(lignes[1].trim().length, 24,
    'la deuxième ligne est l’état de bouille, celui que specialClick applique');
});

test('la boîte à disques rend le TYPE de FD et le nom de la jaquette', async () => {
  const xml = await ls('disccollector');
  const entrees = [...xml.matchAll(/<e u="([^"]*)" t="disc"[^>]*>([\s\S]*?)<\/e>/g)];
  assert.ok(entrees.length >= 10, 'la collection d’époque compte une quinzaine de disques');
  for (const [, , corps] of entrees) {
    const [type, nom] = corps.split('\n');
    assert.match(type, /^\d$/, 'desc[0] est le discType — il choisit l’anneau');
    assert.ok(nom && nom.length, 'desc[1] est le nom de la jaquette');
    // Chaque nom de jaquette doit avoir son dessin, sinon le disque sort nu.
    const cle = String(nom).toLowerCase();
    const table = /var JAQUETTES = \{([\s\S]*?)\};/.exec(JS)[1];
    assert.ok(new RegExp(`(^|[\\s,{])${nom}:|(^|[\\s,{])${cle}:`).test(table),
      `la jaquette « ${nom} » n’est pas dans la table du portage`);
  }
});

// ── LES DESSINS, sortis des SWF ───────────────────────────────────────────
test('les dessins de l’explorateur sont là, et le manifeste les décrit', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'explorateur.json'), 'utf8'));
  const attendus = [
    'ico_dossier_inventory', 'ico_dossier_disccollector', 'ico_dossier_default',
    'ico_wallpaper', 'ico_pictoForum', 'ico_link', 'ico_default',
    'nav_up', 'nav_new_folder', 'nav_empty_recyclebin', 'nav_new_mail',
    'disc_anneau_0', 'disc_anneau_1', 'disc_anneau_2', 'disc_anneau_3',
    'disc_jaquette_snake', 'disc_jaquette_bandas', 'disc_jaquette_grapiz',
    'disc_jaquette_miniwave', 'disc_jaquette_minipixiz', 'disc_jaquette_minifever',
    'disc_jaquette_jama', 'disc_jaquette_swapou2', 'disc_jaquette_bkiwi',
    'disc_jaquette_kaluga', 'disc_jaquette_mb2',
  ];
  for (const nom of attendus) {
    const f = path.join(SPRITES, nom + '.svg');
    assert.ok(fs.existsSync(f), `${nom}.svg manquant`);
    assert.ok(fs.statSync(f).size > 200, `${nom}.svg est vide`);
    assert.ok(manifeste[nom] && manifeste[nom].w > 0,
      `${nom} sans cadre au manifeste — le portage ne saurait pas le poser`);
  }
  // Le coffre fait bien 59 × 51 : c'est ce cadre-là qui, à l'échelle du
  // bureau (r4 × icoRatio = 37 × 1,66 %), donne les 36 px du relevé 1:1.
  assert.ok(Math.abs(manifeste.ico_dossier_inventory.w - 59) < 1);
  assert.ok(Math.abs(manifeste.ico_dossier_inventory.h - 51.5) < 1);
  // Les boutons de la barre d'outils font 20 px — la plaque de `butPush`
  // avec `outline: 2` autour, soit la case de 24 du bytecode.
  for (const b of ['nav_up', 'nav_new_folder']) {
    assert.strictEqual(manifeste[b].w, 20);
    assert.strictEqual(manifeste[b].h, 20);
  }
  // Les cinq anneaux sont le MÊME dessin, teinté : ils doivent différer.
  const noir = fs.readFileSync(path.join(SPRITES, 'disc_anneau_0.svg'), 'utf8');
  const rouge = fs.readFileSync(path.join(SPRITES, 'disc_anneau_3.svg'), 'utf8');
  assert.notStrictEqual(noir, rouge, 'le FD rouge doit se distinguer du noir');
});

// ── LE PORTAGE : gabarit, pastille, et le mobile intouché ─────────────────
test('les deux fenêtres ont le gabarit et la pastille d’époque', () => {
  for (const cle of ['ex-disques', 'ex-inventaire']) {
    const m = new RegExp(`'${cle}':\\s*\\{[^}]*\\}`, 's').exec(JS);
    assert.ok(m, `rubrique ${cle} absente`);
    const bloc = m[0];
    assert.match(bloc, /fruit: 'winExplorer'/, 'la pastille est la banane de winExplorer');
    assert.match(bloc, /l: 402, h: 402/, 'pos = {w:400, h:400} plus le contour');
  }
});

test('la navigation se fait SUR PLACE, et le retour existe', () => {
  // `IconFileBox.click` : un dossier appelle box.getList(uid) — pas de fenêtre
  // de plus. Et `flUp` pose le bouton qui rappelle box.getParent.
  assert.match(JS, /function ouvrirDossier\(cle, uid, titre\)/);
  assert.match(JS, /retitrer\(etat\.panneau\.id, etat\.titre\)/);
  assert.match(JS, /boutonNav\('up'/);
  assert.match(JS, /typeDeDossier/);
});

test('le clic reproduit specialClick : porter un accessoire, poser un fond', () => {
  assert.match(JS, /porterAccessoire/);
  assert.match(JS, /poserFondInventaire/);
  assert.match(LIGHT, /window\.InventaireBureau = \{/);
  assert.match(LIGHT, /porterAccessoire: function \(nom, etatBouille\)/);
});

test('le mobile ne bouge pas : la fenêtre ne prend la main que sur le bureau', () => {
  // Les deux tuiles gardent leur feuille ; la fenêtre ne s'ouvre que si le
  // bureau est actif (donc jamais sous 768 px).
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirDisques\) return BureauFrutiz\.ouvrirDisques\(\);/);
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirInventaire\) return BureauFrutiz\.ouvrirInventaire\(\);/);
  assert.match(LIGHT, /return openDisquesSheet\(\);/);
  assert.match(LIGHT, /return openBouilleSheet\(\);/);
  // Et tout l'habillage jaune est sous `body.bureau-frutiz` — la classe que
  // seul le desktop porte.
  const lignes = CSS.split('\n').filter((l) => /\.ex-(panel|champ|slot|nav|alerte|lbl|img|disque|bouille|fond)/.test(l)
    && /^[^\s].*\{/.test(l));
  for (const l of lignes) {
    assert.ok(l.startsWith('body.bureau-frutiz'),
      `règle d’explorateur hors du bureau : ${l.trim()}`);
  }
});

test('le champ jaune porte la rampe relevée au pixel', () => {
  const m = /\.ex-champ \{[\s\S]*?\}/.exec(CSS);
  assert.ok(m, 'le champ de l’explorateur n’est pas défini');
  const bloc = m[0];
  assert.match(bloc, /#F8F866/, 'le fond du champ');
  assert.match(bloc, /2px solid #EAEA0F/, 'le liseré');
  assert.match(bloc, /0 0 0 2px #DDDDDD/, 'le contour, peint hors de la boîte');
  // L'encre des étiquettes : le jaune très sombre, pendant du #335511 vert.
  assert.match(CSS, /\.ex-lbl \{[\s\S]*?color: #5A5A00/);
});
