/*
 * LA MESSAGERIE du bureau light, et deux retours qui l'accompagnent.
 *
 * D'époque la messagerie n'est pas une fenêtre mais TROIS. La boîte de
 * réception est un EXPLORATEUR — `box.Explorer` sur `fileMng.inbox`, avec
 * `list.tpl == "mail"` —, lire un courrier ouvre `winViewMail` (500 × 400) et
 * en écrire un ouvre `winMail`. Le light n'a qu'un panneau `#mail-panel` à
 * reparenter : il y rejoue les trois gabarits l'un après l'autre.
 *
 * S'y ajoutent deux corrections :
 *
 *   · la bande des contacts est faite des mêmes `userSlot` que la liste des
 *     connectés d'un salon (`SideList.buildElement`, `statusDspMode: "all"`) —
 *     `onStatusObj` y met l'icône du JEU à la place de la pastille de
 *     présence, ce que le portage ne faisait pas ;
 *   · l'écran d'une bouille qui joue une émotion doit cacher sa vignette
 *     figée : le SWF n'a qu'UNE bouille par écran, elle s'anime, elle ne se
 *     double pas.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la boîte de réception est un EXPLORATEUR, au gabarit d’époque', () => {
  // `win.Explorer` pose `pos = {50, 50, 400, 400}` et s'ouvre au milieu ; le
  // relevé 1:1 donne la fenêtre en 411 × 401, contour compris. Et c'est la
  // fenêtre JAUNE : `winType = "winExplorer"`, d'où la banane en pastille.
  assert.match(JS, /mail:\s+\{ panneau: '#mail-panel',\s+titre: 'Boîte de réception',\s*\n\s*fruit: 'winExplorer', l: 412, h: 402,/);
  assert.match(JS, /min: \{ w: 200, h: 128 \}, centre: true \}/);
  // `lister` : De|À 140, Sujet 200 (big), Date 80 — et le tri part sur la
  // date, en DESC (`currentSort`).
  assert.match(JS, /\{ cle: 'qui', titre: 'Expéditeur', titreEnvoi: 'Destinataire', tri: 'from', l: 140 \}/);
  assert.match(JS, /\{ cle: 'subject', titre: 'Sujet', tri: 'name', big: true \}/);
  assert.match(JS, /\{ cle: 'date', titre: 'Date', tri: 'date', l: 80 \}/);
  assert.match(JS, /var mailTri = \{ champ: 'date', desc: true \}/);
});

test('la barre d’outils : le dossier parent et l’enveloppe, rien d’autre', () => {
  // `initNavigatorIconList` : pour une boîte aux lettres, `flNewDirectory` et
  // `flRemoveAll` sont faux, `flUp` et `flMail` vrais.
  assert.match(JS, /navBouton\('nav_up', 'Dossier parent'/);
  assert.match(JS, /navBouton\('nav_new_mail', 'Écrire un courrier'/);
  assert.doesNotMatch(JS, /navBouton\('nav_new_folder'/);
  assert.doesNotMatch(JS, /navBouton\('nav_empty_recyclebin'/);
  // Les onglets du mobile n'existent pas d'époque : on change de boîte par le
  // dossier parent.
  assert.match(CSS, /#mail-panel #mail-head \{ display: none; \}/);
  assert.match(CSS, /#mail-panel\.mx-dossiers #mail-vue-liste,[\s\S]{0,200}?display: none !important;/);
});

test('les mesures 1:1 du champ et de ses rangées', () => {
  // Bandeau des colonnes : sa propre boîte de 18 px, chair #F9F977.
  assert.match(CSS, /#mail-panel \.mx-entete \{\s*\n\s*flex: 0 0 18px; height: 18px;/);
  assert.match(CSS, /rgba\(255,255,255,\.6\) 2px, rgba\(255,255,255,0\) 10px\), #F9F977;/);
  // Le champ : contour 2 px #DDDDDD hors boîte, liseré 2 px #EAEA0F, chair
  // #F8F866 — l'écorce de l'explorateur.
  assert.match(CSS, /border: 2px solid #EAEA0F; border-radius: 5px; box-shadow: 0 0 0 2px #DDDDDD;/);
  // Une rangée fait 22 px, séparée par un trait #EAEA0F ; les colonnes se
  // séparent de 2 px de #F1F13B.
  assert.match(CSS, /\.mx-rang \{[\s\S]*?height: 22px;[\s\S]*?border-bottom: 1px solid #EAEA0F;/);
  assert.match(CSS, /\.mx-rang \.mx-cell \{[\s\S]*?border-right: 2px solid #F1F13B;/);
  // Les encres relevées : #404000 au bandeau, #5A5A00 dans les rangées.
  assert.match(CSS, /\.mx-col \{[\s\S]*?color: #404000;/);
  assert.match(CSS, /\.mx-rang \{[\s\S]*?color: #5A5A00;/);
});

test('lire et écrire : les gabarits de winViewMail et winMail', () => {
  // `win.ViewMail.attachInfo` : QUATRE lignes de 20, étiquette de 60 à DROITE.
  assert.match(JS, /\[\['date', 'Date'\], \['from', 'De'\], \['to', 'À'\], \['subject', 'Sujet'\]\]/);
  assert.match(CSS, /\.mx-ligne,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel \.mx-de \{\s*\n\s*display: flex; align-items: center; height: 20px;/);
  assert.match(CSS, /\.mx-lab \{\s*\n\s*flex: 0 0 60px; width: 60px; text-align: right;/);
  // `attachEndButton` : « Mettre à la corbeille », un grand espace, puis
  // « Répondre ».
  assert.match(JS, /pou\.textContent = 'Mettre à la corbeille'/);
  assert.match(CSS, /#mail-supprimer \{ order: 1; \}/);
  assert.match(CSS, /#mail-repondre \{ order: 2; margin-left: auto; \}/);
  // `win.Mail.attachInfo` : la ligne « De », que `box.Mail.preInit` remplit
  // avec « pseudo <pseudo@frutiparc.com> ».
  assert.match(JS, /moi \+ ' <' \+ moi \+ '@frutiparc\.com>'/);
  // Et le corps en 12 (`textFormat: { size: 12 }`).
  assert.match(CSS, /#mail-texte \{[\s\S]*?font: normal 12px Verdana/);
});

test('le light passe la main au bureau, sans rien changer pour le mobile', () => {
  assert.match(LIGHT, /BureauFrutiz\.majMessagerie\(mailListe, mailDossier\);/);
  assert.match(LIGHT, /BureauFrutiz\.majLectureMail\(mailLu\);/);
  assert.match(LIGHT, /window\.MessagerieLight = \{\s*\n\s*charger: loadMail, ecrire: ecrireMail, ouvrir: ouvrirMail, vue: mailVue,/);
  assert.match(JS, /majMessagerie: majMessagerie,/);
  assert.match(JS, /majLectureMail: majLectureMail,/);
  // Tout l'habillage est sous `body.bureau-frutiz` : le mobile ne bouge pas.
  const bloc = CSS.slice(CSS.indexOf('── LA MESSAGERIE'), CSS.indexOf('── L\'EXPLORATEUR'));
  // Chaque ligne de tête de règle doit partir de `body.bureau-frutiz` — une
  // seule qui l'oublierait déborderait sur le mobile.
  const egares = bloc.split('\n')
    .filter((l) => /^[.#a-zA-Z]/.test(l) && !/^body\.bureau-frutiz/.test(l));
  assert.deepStrictEqual(egares, [], 'une règle de la messagerie n’est pas bornée au bureau');
});

test('la bande des contacts montre le VOYANT DU JEU', () => {
  // `UserSlot.onStatusObj` : présence 0 → la pastille saumon ; `status
  // .internal` → l'icône du jeu À SA PLACE ; sinon la pastille verte.
  assert.match(JS, /if \(c\.enLigne && c\.jeu\) \{/);
  assert.match(JS, /v\.classList\.add\('jeu'\);/);
  assert.match(JS, /voyantUrl\(c\.jeu\)[\s\S]{0,80}?sl-icone-fond\.svg/);
  assert.match(JS, /function voyantUrl\(jeu\) \{\s*\n\s*return '\/fb\/voyant_' \+ \(jeu === 'swapou2' \? 'swapou' : jeu\)/);
  // L'icône remplit le cadre de 17, moins son liseré.
  assert.match(CSS, /\.sl-contact \.voyant\.jeu \{\s*\n\s*background-size: 15px 15px, 17px 17px;/);
  // Et la bande se relit : le light n'a pas la poussée de statut hors salon.
  assert.match(JS, /contactsMinuteur = setInterval\(chargerContacts, 30000\);/);
  // Un dossier replié le reste quand la liste se refait (`element.open`).
  assert.match(JS, /if \(replies\[f\.nom\]\) bloc\.classList\.add\('replie'\);/);
});

test('la bouille qui joue une émotion ne se DOUBLE plus', () => {
  // Le SWF n'a qu'une bouille par écran : elle s'anime. La vignette figée
  // s'efface donc le temps de l'animation.
  assert.match(LIGHT, /ecran\.classList\.add\("bo-anime"\);/);
  assert.match(LIGHT, /ecran\.classList\.remove\("bo-anime"\);/);
  // Un second orateur n'en laisse pas deux allumées.
  assert.match(LIGHT, /var deja = colonne\.querySelectorAll\("\.bo-anime"\);/);
  // Et l'écran qu'on retire rend sa scène ET sa vignette.
  assert.match(JS, /ecran\.classList\.remove\('bo-anime'\);\s+\/\/ sa vignette figée revient/);
  // `!important` : `FPBouilleThumb` pose `visibility: visible` EN LIGNE.
  assert.match(CSS, /\.bo-anime img \{ visibility: hidden !important; \}/);
});
