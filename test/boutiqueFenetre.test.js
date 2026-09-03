/*
 * La BOUTIQUE du portage light — la fenêtre du bureau, reproduite.
 *
 * Le mobile n'ouvrait qu'un rayon sur cinq : les Accessoires. Le catalogue est
 * pourtant commun aux deux clients (SHOP_PACKS, servi au bureau par /ft/tree et
 * /ft/pack), et le bureau montre l'arbre entier — Accessoires, Fonds d'écran,
 * Pass, Feutres, Packs — avec, à droite, la fiche de l'article : aperçu encadré,
 * bouton Acheter dessous, accroche en gras, descriptif, puis le prix.
 *
 * Ce fichier tient les trois moitiés de la ressemblance :
 *   · le CATALOGUE — /api/light/shop sert les cinq rubriques, chacune avec de
 *     quoi se dessiner sans Flash (fond d'écran, picto d'époque, feutre) ;
 *   · les TEXTES — un accessoire porte les deux niveaux du bureau (accroche en
 *     gras puis descriptif), un pass reste toujours achetable et dit où on en
 *     est ;
 *   · les IMAGES et le RENDU — les vignettes sorties de shopitem.swf existent,
 *     et la fenêtre du light emploie les teintes relevées sur la vraie.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3503;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-boutique-fenetre';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5282', FRUTISCORE_PORT: '5283',
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

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const joueur = (b) => 'bou' + b + RUN;

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
const boutique = async (sid) => (await fetch(`${BASE}/api/light/shop?sid=${sid}`)).json();
const rubrique = (d, nom) => (d.categories || []).find((c) => c.name === nom);

// ── Le catalogue : les cinq rayons du bureau ──────────────────────────────

test('la boutique exige une session', async () => {
  const r = await fetch(BASE + '/api/light/shop');
  assert.equal(r.status, 401, 'sans sid, pas de catalogue');
});

test('les cinq rubriques du bureau sont servies, dans l\'ordre du catalogue', async () => {
  const d = await boutique(await inscrire(joueur('rub')));
  assert.deepEqual((d.categories || []).map((c) => c.name),
    ['Accessoires', "Fonds d'écran", 'Pass', 'Feutres', 'Packs'],
    'l\'arbre entier, pas seulement les accessoires');
  for (const c of d.categories) {
    assert.ok((c.items || []).length > 0, `la rubrique « ${c.name} » n'est pas vide`);
  }
  // L'ancienne clef survit : d'anciens appels s'y adossent.
  assert.ok(Array.isArray(d.items) && d.items.length > 0, '« items » sert encore les accessoires');
  assert.equal(d.items.length, rubrique(d, 'Accessoires').items.length);
});

test('chaque article sait se dessiner sans Flash', async () => {
  const d = await boutique(await inscrire(joueur('vue')));

  const fond = rubrique(d, "Fonds d'écran").items[0];
  assert.equal(fond.kind, 'fond');
  assert.match(fond.wallpaper, /^\/.+\.(jpg|jpeg|png|gif)$/i, 'le fond est déjà une image');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', fond.wallpaper)), fond.wallpaper + ' existe');

  for (const nom of ['Pass', 'Packs']) {
    for (const it of rubrique(d, nom).items) {
      assert.equal(it.kind, 'picto', `${it.name} porte un picto d'époque`);
      assert.match(it.picto, /^\/fb\/boutique\/(pass|pack)_\d+\.png$/);
      assert.ok(fs.existsSync(path.join(ROOT, 'public', it.picto)),
        `${it.picto} a bien été sorti de shopitem.swf`);
    }
  }

  for (const it of rubrique(d, 'Feutres').items) {
    assert.equal(it.kind, 'feutre', `${it.name} est un stylo`);
    assert.ok(Number.isInteger(it.feutre) && it.feutre >= 0,
      `${it.name} porte l'index de sa couleur (le SWF teinte par code)`);
  }

  const acc = rubrique(d, 'Accessoires').items[0];
  assert.equal(acc.kind, 'accessoire');
  assert.match(acc.suffix9, /^[0-9a-z]{9}$/i, 'l\'accessoire se pose sur la bouille du joueur');
  assert.match(d.bouille, /^[0-9a-z]{24}$/i, 'et la bouille de base voyage avec');
});

// Le stylo n'a qu'UN dessin dans shopitem.swf : le SWF colore son calque « col »
// par code. On le sort donc en deux couches, superposables, que le light
// recolore au masque.
test('le porte-feutres est sorti en deux couches superposables', () => {
  const dir = path.join(ROOT, 'public/fb/boutique');
  for (const f of ['feutre_corps.png', 'feutre_teinte.png']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f + ' existe');
  }
  const lire = (f) => {
    const b = fs.readFileSync(path.join(dir, f));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(lire('feutre_corps.png'), lire('feutre_teinte.png'),
    'même cadrage, sinon la teinte ne tomberait pas sur le stylo');
});

// ── Les textes : ceux que le bureau imprime ───────────────────────────────

test('un accessoire porte les deux niveaux de la fiche du bureau', async () => {
  const d = await boutique(await inscrire(joueur('txt')));
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const defaut = (nom) => {
    const m = new RegExp(`const ${nom} =\\s*\\n?\\s*"([^"]+)"`).exec(src);
    assert.ok(m, nom + ' est défini dans server.js');
    return m[1];
  };
  const l1 = defaut('DEFAULT_ACCESSORY_DESC_L1');
  const l2 = defaut('DEFAULT_ACCESSORY_DESC_L2');
  for (const it of rubrique(d, 'Accessoires').items) {
    assert.equal(it.comment, l1, `${it.name} : l'accroche en gras est celle du bureau`);
    assert.equal(it.description, l2, `${it.name} : le descriptif est celui du bureau`);
    assert.notEqual(it.comment, it.description, 'et les deux niveaux diffèrent');
  }
});

test('un pass reste toujours achetable et dit où on en est', async () => {
  const d = await boutique(await inscrire(joueur('pass')));
  const passes = rubrique(d, 'Pass').items;
  assert.ok(passes.length >= 5, 'les pass des jeux à quota');
  for (const it of passes) {
    assert.equal(it.owned, false, `${it.name} se rachète : il se cumule`);
    assert.equal(it.cumulable, true);
    assert.ok(it.pass && it.pass.jeu, 'la fiche sait de quel jeu il s\'agit');
    assert.equal(it.pass.possede, 0, 'un nouveau venu n\'en a aucun');
    assert.ok(it.pass.parJour >= 1, 'et connaît son quota du jour');
    assert.ok(it.price > 0, 'un pass a un prix');
  }
});

// Le bureau offre d'office les rubriques qui ne sont ni Accessoires, ni Fonds
// d'écran, ni Pass — sauf les articles marqués `notDefault`, qui redeviennent
// achetables au milieu d'un rayon offert (feutre spécial, packs de jeu).
test('les rubriques offertes le disent, les articles « notDefault » restent à acheter', async () => {
  const d = await boutique(await inscrire(joueur('eu')));

  const feutres = rubrique(d, 'Feutres').items.filter((x) => !/multicolore/i.test(x.name));
  assert.ok(feutres.length >= 17, 'les feutres d\'origine');
  for (const it of feutres) {
    assert.equal(it.offert, true, `${it.name} est offert (rayon offert par le bureau)`);
    assert.equal(it.owned, true);
  }
  const mc = rubrique(d, 'Feutres').items.find((x) => /multicolore/i.test(x.name));
  assert.ok(mc, 'le feutre spécial est au rayon');
  assert.equal(mc.offert, false, 'lui n\'est pas offert (notDefault)');
  assert.equal(mc.owned, false);
  assert.ok(mc.price > 0);

  for (const it of rubrique(d, 'Packs').items) {
    assert.equal(it.offert, false, `${it.name} s'achète (notDefault)`);
    assert.ok(it.price > 0);
  }
  for (const it of rubrique(d, 'Accessoires').items) {
    assert.equal(it.offert, false, `${it.name} s'achète`);
  }
  for (const it of rubrique(d, "Fonds d'écran").items) {
    assert.equal(it.offert, false, `${it.name} se débloque (rayon non offert)`);
  }
});

test('acheter débite le solde et l\'article rejoint l\'inventaire', async () => {
  const pseudo = joueur('ach');
  const sid = await inscrire(pseudo);
  await fetch(`${BASE}/api/admin/users/${pseudo}/kikooz`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ kikooz: 500 }) });

  const avant = await boutique(sid);
  const acc = rubrique(avant, 'Accessoires').items.find((x) => !x.owned);
  assert.ok(acc, 'un accessoire à acheter');

  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id: acc.id }) })).json();
  assert.equal(r.ok, true, 'l\'achat passe');
  assert.equal(r.kikooz, avant.kikooz - acc.price, 'le solde est débité du prix affiché');

  const apres = await boutique(sid);
  assert.equal(apres.kikooz, r.kikooz, 'et la boutique rouvre sur le bon solde');
  assert.equal(rubrique(apres, 'Accessoires').items.find((x) => x.id === acc.id).owned, true,
    'l\'article est marqué possédé');
});

// ── Le rendu : la fenêtre du bureau, aux teintes relevées ─────────────────

test('la fenêtre du light est bâtie comme celle du bureau', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Les deux volets : l'arbre des rubriques à gauche, la fiche à droite.
  for (const id of ['bo-rubriques', 'bo-fiche', 'shop-wallet']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} est dans le balisage`);
  }
  // Le dossier rose de l'arborescence, découpé sur la vraie fenêtre.
  assert.ok(html.includes('/fb/boutique/dossier.png'), 'les rubriques portent le dossier d\'époque');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/boutique/dossier.png')), 'et il existe');
  // Le stylo teinté au masque, comme le SWF le colore par code.
  assert.ok(html.includes('url("/fb/boutique/feutre_teinte.png")'), 'la teinte du stylo passe par un masque');
  assert.ok(html.includes('/fb/boutique/feutre_corps.png'), 'posée sur le corps du stylo');
  // Les teintes relevées au pixel sur un rendu Ruffle de la fenêtre.
  for (const [couleur, quoi] of [
    ['#CCF599', 'le fond de la carte'],
    ['#ADE76B', 'son filet vert'],
    ['#F1FAE4', 'le fond du cadre d\'aperçu'],
    ['#842929', 'le brun du titre'],
    ['#335511', 'le vert des textes'],
  ]) {
    assert.ok(html.includes(couleur), `${quoi} (${couleur}) est repris`);
  }
  // Le corps de la fenêtre est blanc : celui de l'inventaire, jaune, ne
  // conviendrait pas.
  assert.match(html, /#bo-corps\s*\{[^}]*background:\s*#FFFFFF/i,
    'le corps de la fenêtre Boutique est blanc');
});

test('un article déjà acquis n\'a pas de bouton, mais la phrase à la place du prix', () => {
  // `win.Shop.setItem` (main.swf 0x7a8d0) ne met l'entrée d'achat au menu que
  // `if (!item.alreadyBuy)` — il n'existe donc AUCUN bouton pour un article
  // possédé, ni actif ni grisé. Et `displayItemPage("description")` (0x7a9be)
  // écrit, exactement là où irait le prix et dans le même style `s="3"` :
  //
  //     if (item.alreadyBuy) page += Lang.fv('shop.already_have')
  //     else                 page += Lang.fv('shop.price', { p: item.price })
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const f = /function renderShopFiche\(\) \{[\s\S]*?\n  \}/.exec(html);
  assert.ok(f, 'renderShopFiche doit exister');
  assert.match(f[0], /\? '<button type="button" class="bo-acheter" id="bo-acheter">Acheter<\/button>'\s*\n\s*: ''\)/,
    'pas de bouton quand l\'article est déjà là');
  assert.doesNotMatch(f[0], /<button[^>]*bo-acheter[^>]*disabled/,
    'et surtout pas de bouton grisé qui le dirait');
  assert.match(f[0], /\(achetable \? 'Prix : ' \+ prix \+ ' kikooz' : 'Vous possédez déjà ce produit'\)/,
    'la ligne de prix devient la phrase');
});

/*
 * Les trois retouches de look de la fenêtre.
 *
 * Le bureau porte l'icône de la boutique devant son titre, entre toujours par
 * les Accessoires, et son arborescence se plie et se déplie. Sur un téléphone,
 * ce dernier point n'est pas un ornement : la rubrique des Feutres compte
 * dix-huit articles, et sans repli elle chasse les autres rayons de l'écran.
 */
test('la barre de titre porte l\'icône de la fenêtre', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /<img class="sheet-ico" src="\/fb\/boutique\/icone\.png"[\s\S]{0,120}Boutique<\/span>/,
    'l\'icône précède le titre « Boutique »');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/boutique/icone.png')),
    'découpée sur la barre de titre du bureau');
  assert.match(html, /\.sheet-head \.sheet-ico \{/, 'et elle a sa taille');
});

test('la boutique s\'ouvre tous rayons repliés, et la fiche attend un choix', async () => {
  const d = await boutique(await inscrire(joueur('def')));
  assert.equal((d.categories || [])[0].name, 'Accessoires',
    'le premier rayon du catalogue reste celui des accessoires');

  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Elle s'ouvrait sur le PREMIER rayon du catalogue — qui, selon ce que
  // l'admin a désactivé, pouvait être les fonds d'écran. Plus de rayon
  // d'entrée : tout est replié, la fiche dit d'ouvrir un rayon.
  assert.match(html, /var BO_RUBRIQUE_DEFAUT = -1;/, 'aucun rayon déplié à l\'ouverture');
  assert.match(html, /function reposerBoutique\(\) \{\s*\n\s*boRubrique = BO_RUBRIQUE_DEFAUT;\s*\n\s*boChoixR = -1;\s*\n\s*boArticle = 0;/,
    'l\'état de départ : rien de déplié, rien de montré');
  // L'ouverture REPOSE l'état : sans ça, on retombait sur la rubrique de la
  // visite précédente — la feuille du mobile comme la fenêtre du bureau.
  assert.match(html, /function openShopSheet\(\) \{[\s\S]{0,300}reposerBoutique\(\);/,
    'chaque ouverture de la feuille repart repliée');
  assert.match(html, /charger: function \(reposer\) \{\s*\n\s*if \(reposer\) reposerBoutique\(\);/,
    'le bureau peut demander la même chose');
  const bureau = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  assert.match(bureau, /var neuve = !fenetres\['shop-sheet'\];\s*\n\s*ouvrirFenetre\('boutique'\);\s*\n\s*if \(window\.MagasinLight && MagasinLight\.charger\) MagasinLight\.charger\(neuve\);/,
    'une fenêtre neuve s\'ouvre repliée ; rappelée, elle garde son rayon');
  assert.match(html, /var r = boChoixR >= 0 \? shopCategories\[boChoixR\] : null;/,
    'sans choix, pas d\'article courant');
  assert.match(html, /Ouvrez un rayon dans la colonne de gauche\./, 'et la fiche le dit');
});

test('un dossier se replie quand on le rappuie, sans vider la fiche', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Le dossier ouvert se referme ; un autre s'ouvre ; un article se choisit.
  assert.match(html, /\} else if \(r === boRubrique\) \{[\s\S]{0,120}boRubrique = -1;/,
    'rappuyer sur le dossier ouvert le referme');
  assert.match(html, /boRubrique = -1;\s*\/\/ \(la fiche reste, elle\)/,
    'et la fiche reste affichée');
  // Deux états distincts : le dossier déplié et l'article montré.
  assert.match(html, /var boChoixR = -1;/, 'la fiche a sa propre rubrique');
  assert.match(html, /function boArticleCourant\(\) \{\s*var r = boChoixR >= 0 \? shopCategories\[boChoixR\] : null;/,
    'la fiche lit boChoixR, pas le dossier déplié');
  // L'état est annoncé aux lecteurs d'écran.
  assert.match(html, /aria-expanded="' \+ \(ouverte \? "true" : "false"\)/,
    'le dossier dit s\'il est déplié');
});
