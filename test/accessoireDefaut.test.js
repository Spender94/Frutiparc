/*
 * UN ACCESSOIRE PAR DÉFAUT POUR LA BOUILLE.
 *
 * « On devrait pouvoir, via les préférences, choisir un accessoire par défaut
 * (comme pour les fonds d'écran) que la bouille porte sur le bureau et sur le
 * forum (choix prédéfini qu'on peut modifier à la main). »
 *
 * Le manque était surtout au FORUM : son formulaire repartait de la tête nue à
 * chaque message (`accSuffix9: '000000000'`), si bien qu'un joueur qui porte
 * toujours le même chapeau devait le rechoisir vingt fois par jour.
 *
 * D'où une préférence de plus — la n° 17, `default_accessory` — qui garde les
 * NEUF caractères d'accessoire d'un état de bouille, comme la boutique et le
 * sélecteur du forum. Elle suit toutes les règles des autres préférences
 * (`prefdef`, `mypref`, `prefsave`, la fenêtre du bureau), à une exception
 * documentée : ses CHOIX sortent de l'inventaire du joueur, pas d'une liste
 * fixe — personne ne possède les mêmes accessoires.
 *
 * Ce que le réglage fait, et ce qu'il ne fait pas :
 *   · le choisir POSE l'accessoire sur la bouille, tout de suite ;
 *   · le forum OUVRE ses formulaires dessus, chaque fois ;
 *   · en porter un autre à la main ne touche PAS au défaut — on s'écarte pour
 *     un message, on ne redéfinit pas ;
 *   · et rien n'est reposé de force à la connexion.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3531;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-accessoire-defaut';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5294', FRUTISCORE_PORT: '5295',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const JSN = { 'Content-Type': 'application/json' };

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  const sid = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
const lirePrefs = async (sid) => (await fetch(`${BASE}/api/light/prefs?sid=${sid}`)).json();
const ecrirePref = async (sid, nom, valeur) => (await fetch(BASE + '/api/light/prefs', {
  method: 'POST', headers: JSN,
  body: JSON.stringify({ sid, prefs: { [nom]: valeur } }),
})).json();
const moiForum = async (sid) => (await fetch(`${BASE}/api/forum/me?sid=${sid}`)).json();
const defAcc = (p) => (p.categories.find((c) => c.name === 'Apparence') || { prefs: [] })
  .prefs.find((x) => x.name === 'default_accessory');

// Acheter un accessoire en boutique : c'est le seul chemin qui remplit vraiment
// `customAccessories`, et les 200 kikooz de bienvenue suffisent.
async function acheterUnAccessoire(sid) {
  const shop = await (await fetch(`${BASE}/api/light/shop?sid=${sid}`)).json();
  const rayon = (shop.categories || []).find((c) => c.name === 'Accessoires');
  const article = (rayon.items || []).find((a) => !a.owned && Number(a.price) <= shop.kikooz);
  assert.ok(article, 'un accessoire abordable en rayon');
  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: JSN, body: JSON.stringify({ sid, id: article.id }),
  })).json();
  assert.ok(r.ok, 'achat de ' + article.name + ' : ' + JSON.stringify(r));
  return { nom: article.name, suffixe: String(r.bouille).substring(15, 24) };
}

test('la préférence existe, vaut la tête nue, et ses choix sont l’inventaire', async () => {
  const sid = await inscrire('accd' + RUN);

  const avant = await lirePrefs(sid);
  const p = defAcc(avant);
  assert.ok(p, 'rangée dans « Apparence », avec le fond d’écran');
  assert.equal(p.type, 's', 'une chaîne, comme le fond d’écran');
  assert.equal(p.def, '000000000', 'sa valeur d’origine est la tête nue');
  assert.equal(avant.values.default_accessory, '000000000', 'donc rien ne change tant qu’on n’a rien réglé');
  assert.equal(p.choices[0].label, 'Normal', '« Normal » en tête — c’est la tête nue');
  assert.ok(p.choices.some((c) => c.label === 'Bananocle'), 'les accessoires de base y sont');
  assert.equal(new Set(p.choices.map((c) => c.v)).size, p.choices.length, 'aucun doublon');

  // Ce qu'on achète paraît dans les choix ; ce que les autres achètent, non.
  const achete = await acheterUnAccessoire(sid);
  const apres = defAcc(await lirePrefs(sid));
  const ligne = apres.choices.find((c) => c.v === achete.suffixe);
  assert.ok(ligne, achete.nom + ' rejoint les choix : ' + JSON.stringify(apres.choices));
  assert.equal(ligne.label, achete.nom, 'sous son nom de boutique');

  const autre = defAcc(await lirePrefs(await inscrire('accv' + RUN)));
  assert.ok(!autre.choices.some((c) => c.v === achete.suffixe),
    'le voisin ne se voit pas offrir ce qu’il ne possède pas');
});

test('ce qu’on choisit s’enregistre, et le forum le reçoit', async () => {
  const sid = await inscrire('acce' + RUN);
  const achete = await acheterUnAccessoire(sid);

  assert.equal((await moiForum(sid)).defaultAccessory, '000000000', 'au départ, la tête nue');

  const ecrit = await ecrirePref(sid, 'default_accessory', achete.suffixe);
  assert.ok(ecrit.ok);
  assert.equal(ecrit.values.default_accessory, achete.suffixe, 'la réponse rend la nouvelle valeur');
  assert.equal((await lirePrefs(sid)).values.default_accessory, achete.suffixe, 'et elle tient');
  assert.equal((await moiForum(sid)).defaultAccessory, achete.suffixe,
    'le forum la reçoit — c’est de là que son formulaire part');

  // Écrire une préférence VOISINE ne doit pas l'effacer : l'écriture est entrée
  // par entrée (`prefsavepartial`), pas la chaîne entière.
  await ecrirePref(sid, 'ch_dsp_h', 'N');
  assert.equal((await lirePrefs(sid)).values.default_accessory, achete.suffixe);
});

test('le forum ouvre son formulaire dessus, et retombe sur la tête nue', () => {
  const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

  // La valeur arrive de /api/forum/me et sert de point de départ.
  assert.match(FORUM, /myDefaultAccessory = data\.defaultAccessory \|\| '';/);
  assert.match(FORUM, /_activeBouilleSel\[formId\] = \{ accSuffix9: suffixe,/);
  assert.ok(!/accSuffix9: '000000000', mouthId: null/.test(FORUM),
    'le formulaire ne repart plus de la tête nue d’office');

  // Un accessoire revendu depuis ne doit pas cocher une vignette fantôme :
  // `suffixeParDefaut` ne retient que ce que `getAllAccessories` connaît.
  assert.match(FORUM, /function suffixeParDefaut\(\) \{[\s\S]*?getAllAccessories\(\)[\s\S]*?return '000000000';\n\}/);

  // Et la grille s'ouvre sur la PAGE qui le porte (huit vignettes par page).
  assert.match(FORUM, /_bouillePage\[formId\] = Math\.floor\(rang \/ BOUILLE_PER_PAGE\);/);
});

test('le réglage est au même endroit pour le téléphone et pour le bureau', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // La carte du mobile, rendue avec les autres réglages.
  assert.match(LIGHT, /id="reg-carte-accessoire"/);
  assert.match(LIGHT, /<div id="reg-accessoire" class="acc-grid">/);
  assert.match(LIGHT, /function majReglages\(\) \{[\s\S]*?majAccessoireDefaut\(\);/);
  // Le choisir l'ENREGISTRE et le POSE.
  assert.match(LIGHT, /prefs: \{ default_accessory: ac\.suffix \}/);
  assert.match(LIGHT, /porterEtat\(buildState\(myBase, accDefaut, null\)\);/);
  // Une incarnation n'est pas un accessoire : la grille les écarte.
  assert.match(LIGHT, /accList\.forEach\(function \(ac\) \{\n\s+if \(ac\.fullState\) return;/);

  // Le bureau montre LA MÊME carte à la place du champ de saisie…
  assert.match(BUREAU, /var CARTE_DE_PREF = \{ default_accessory: 'reg-carte-accessoire' \};/);
  assert.match(BUREAU, /p\.local !== undefined \? p\.local : CARTE_DE_PREF\[p\.name\]/);
  // …et une carte qui s'enregistre seule prévient le brouillon de la fenêtre,
  // sans quoi « Enregistrer » reposterait l'ancienne valeur.
  assert.match(BUREAU, /noterPref: function \(nom, valeur\) \{/);
  assert.match(LIGHT, /BureauFrutiz\.noterPref\("default_accessory", accDefaut\);/);

  // Côté serveur : la préférence, son libellé, sa rubrique, ses choix.
  assert.match(SERVEUR, /\{ id: 17, type: 's', name: 'default_accessory',\s+def: '000000000' \},/);
  assert.match(SERVEUR, /default_accessory:\s+\{ label: 'Accessoire par défaut',/);
  assert.match(SERVEUR, /\{ name: 'Apparence',\s+ids: \[5, 17\] \},/);
  assert.match(SERVEUR, /def\.name === 'default_accessory'\n\s+\? choixAccessoireDefaut\(user\)/);
  // La liste des accessoires de base n'est écrite qu'une fois.
  assert.equal((SERVEUR.match(/name: 'Bananocle', suffix: '6010k0w0g'/g) || []).length, 1);
});
