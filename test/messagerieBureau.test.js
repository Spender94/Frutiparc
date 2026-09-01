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
 *
 * Et, depuis, LA BOUTIQUE — `win.Shop`, la fenêtre verte à deux colonnes :
 * le compteur de kikooz et l'arbre des rubriques à gauche, la fiche de
 * l'article à droite, la grande plaque orange dessous. Huit pièces sorties du
 * SWF pour elle seule.
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
  // Le minimum vient de `initFrameSet` : navigatorFrame 80×28 au-dessus de
  // fileIconListFrame 100×100, plus le chrome de la fenêtre.
  assert.match(JS, /min: minFenetre\(100, 28 \+ 100\), centre: true \}/);
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
  // Les mots portent leurs deux-points, et le « A » n'a pas d'accent — c'est
  // lang_french.as qui les écrit (cf. test/courrierBureau.test.js).
  assert.match(JS, /\[\['date', 'Date :'\], \['from', 'De :'\], \['to', 'A :'\], \['subject', 'Sujet :'\]\]/);
  assert.match(CSS, /\.mx-ligne,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel \.mx-de \{\s*\n\s*display: flex; align-items: center; height: 20px;/);
  assert.match(CSS, /\.mx-lab \{\s*\n\s*flex: 0 0 60px; width: 60px; color: #222222;/);
  // L'alignement N'EST PLUS commun aux deux vues, et ce n'était pas une
  // inattention d'époque : `win.ViewMail` pose `textFormat: {align: "right"}`
  // sur ses quatre étiquettes (0xc8bb2, 0xc8c4e, 0xc8cea, 0xc8d82),
  // `win.Mail` n'en pose aucune sur les siennes (0x77e61, 0x77ee6, 0x77f6e).
  // On lit à droite, on écrit à gauche.
  assert.match(CSS, /\.mx-info \.mx-lab \{ text-align: right; \}/);
  assert.match(CSS, /\.mail-form label \{\s*\n\s*flex: 0 0 60px; width: 60px; text-align: left;/);
  // `attachEndButton` : « Supprimer », un grand espace, puis « Répondre » et
  // « Transférer » — les trois mots de lang_french.as.
  assert.match(JS, /pou\.textContent = 'Supprimer'/);
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
  // .internal` → l'icône du jeu À SA PLACE ; `status.external` → le statut
  // d'absence, à la même place ; sinon la pastille verte.
  assert.match(JS, /if \(\(c\.enLigne && c\.jeu\) \|\| absence\) \{/);
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
  // Deux formes à effacer : l'IMAGE du cache PNG là où il sert encore, et le
  // CANEVAS du moteur JS partout où la bouille est dessinée sur place. Sans
  // la seconde, l'écran montrerait la bouille figée SOUS celle qui s'anime.
  //
  // Mais l'enfant DIRECT, et lui seul (« > ») : depuis le portage JS des
  // bouilles, le LECTEUR est un canevas lui aussi, et il vit DANS l'écran le
  // temps de l'animation. Sans le « > », il disparaissait avec la vignette et
  // l'écran restait blanc quatre secondes durant.
  assert.match(CSS, /\.bo-anime > img,\n[^\n]*\.bo-anime > canvas \{ visibility: hidden !important; \}/);
});

test('LA BOUTIQUE : deux colonnes, et les pièces sorties du SWF', () => {
  // `win.Shop` : la fenêtre du fruit VERT (`winType = "winShop"`). Relevé
  // 1:1 — x 8..483 / y 104..507, soit 476 × 404.
  assert.match(JS, /boutique:\s+\{ panneau: '#shop-sheet',\s+titre: 'Boutique', fruit: 'winShop',\s*\n\s*l: 476, h: 404,/);
  // Les onze pièces extraites du SWF, et leurs formes.
  const EX = fs.readFileSync(path.join(ROOT, 'scripts/extract-frutiz-bureau.js'), 'utf8');
  const pieces = [
    ['shop-kikooz', 396], ['shop-but-blanc', 473], ['shop-but-blanc-2', 501],
    ['shop-ico-journal', 498], ['shop-ico-kikooz', 499],
    ['shop-puce-article', 563], ['shop-puce-rubrique', 564],
    ['shop-but-acheter', 460], ['shop-cadre', 405], ['shop-cadre-reflet', 409],
    ['shop-plus-kikooz', 557],
  ];
  for (const [cle, id] of pieces) {
    assert.match(EX, new RegExp("\\{ cle: '" + cle + "', id: " + id + " \\}"), cle + ' manque à l’extracteur');
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites', cle + '.svg')), cle + '.svg manque');
  }
  // `initFrameSet` : la colonne de gauche fait 140, l'arbre est dessous, la
  // fiche à droite et la grande plaque sous elle.
  assert.match(CSS, /#shop-sheet \.sheet-body \{[\s\S]*?grid-template-columns: 148px 1fr;/);
  // Le compteur : `cpCounter` au style `frKikooz` — relevé pilule #F8D5BC,
  // liseré #F3BE8C, encre #764A34, Verdana 14 GRAS. Le coin fait 5, pas une
  // pilule : le relevé donne quatre pixels d'arc à chaque bout.
  assert.match(CSS, /\.bo-solde \{[\s\S]*?background: #F8D5BC; border: 2px solid #F3BE8C; border-radius: 5px;[\s\S]*?font: 700 14px Verdana[^;]*; color: #764A34;/);
  // LES PUCES DE L'ARBRE. `caps.Exe` prend l'image 1 de `shopBullet` (#563,
  // l'ocre) et `caps.Dir` de niveau 0 l'image 2 (#564, le rose) : c'est
  // « article / rubrique » et non « fermé / ouvert ». Les tailles suivent
  // `getTreeStyle` (10 et 16) et les rangées `Capsule.height = size + 6`.
  const rub = /#bo-rubriques \.bo-rub::before \{[\s\S]*?\}/.exec(CSS)[0];
  assert.match(rub, /shop-puce-rubrique\.svg/);
  const art = /#bo-rubriques \.bo-art::before \{[\s\S]*?\}/.exec(CSS)[0];
  assert.match(art, /shop-puce-article\.svg/);
  assert.match(CSS, /#bo-rubriques button \{[\s\S]*?height: 22px;[\s\S]*?font: normal 16px Verdana/);
  // L'arbre respire sous la pastille : la colonne x=30 du relevé donne
  // 45-46 #F3BE8C, 47-48 #DDDDDD (le contour BAS de la pastille), 49-52
  // BLANCS, puis 53-54 #DDDDDD — le haut de l'arbre. Quatre pixels d'écart.
  assert.match(CSS, /#bo-rubriques \{\s*\n\s*grid-column: 1; grid-row: 2 \/ span 2; margin: 8px 5px 8px 0;/);
  assert.match(CSS, /#bo-rubriques \.bo-art \{\s*\n\s*height: 16px;[\s\S]*?font-size: 10px;/);
  // Les deux boutons blancs portent le contour que `butPush` dessine
  // (`outline: 2`) : 24 × 24 pour un art de 20.
  assert.match(CSS, /\.bq-ico \{[\s\S]*?box-shadow: 0 0 0 2px #DDDDDD;[\s\S]*?shop-but-blanc\.svg/);
  // La fiche : le style `frSheet` — contour #DDDDDD, liseré #ADE76B, chair
  // #CCF599. L'encre relevée est #335511 (#5A7D33 n'était que du crénelage).
  assert.match(CSS, /#bo-fiche \{[\s\S]*?#CCF599;\s*\n\s*border: 2px solid #ADE76B;[\s\S]*?color: #335511;/);
  // DEUX COLONNES dans la fiche : `attachMenu` glisse le `cp.ProductMenu` de
  // 100 à l'index 0 de `showFrame`, qui est de type "h".
  assert.match(CSS, /#bo-fiche \{[\s\S]*?grid-template-columns: 100px 1fr;/);
  assert.match(CSS, /#bo-fiche \.bo-tete \{ display: contents; \}/);
  // L'aperçu est `shopScreen` (100 × 100) sous son lustre `shopScreenLight`.
  assert.match(CSS, /\.bo-vue \.cadre \{[\s\S]*?width: 100px; height: 100px;[\s\S]*?shop-cadre\.svg/);
  assert.match(CSS, /\.bo-vue \.cadre::after \{[\s\S]*?shop-cadre-reflet\.svg/);
  // « Acheter » est `butPushShop` : 80 × 16 d'art, deux pixels de contour.
  assert.match(CSS, /\.bo-acheter \{[\s\S]*?width: 80px; height: 16px;[\s\S]*?border: 2px solid #ADE76B;[\s\S]*?shop-but-acheter\.svg/);
  // La plaque orange, 150 × 60, calée à droite, elle aussi cerclée.
  assert.match(CSS, /\.bq-plus \{\s*\n\s*width: 150px; height: 60px;[\s\S]*?box-shadow: 0 0 0 2px #DDDDDD;[\s\S]*?shop-plus-kikooz\.svg/);
  assert.match(CSS, /\.bq-pied \{[\s\S]*?justify-content: flex-end;/);
  // Sur le bureau la boutique est une FENÊTRE ; sur mobile, la feuille.
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirBoutique\) return BureauFrutiz\.ouvrirBoutique\(\);/);
  // `charger` arme l'animation d'entrée avant de lire la boutique : elle ne
  // se joue donc qu'à L'OUVERTURE de la fenêtre, pas à chaque clic (cf.
  // test/boutiqueAnimation.test.js).
  assert.match(LIGHT, /window\.MagasinLight = \{\s*\n\s*charger: function \(\) \{ boAnimerColonne = true; loadShop\(\); \},\s*\n\s*acheter: buyShopItem,?\s*\n\s*\};/);
  assert.match(JS, /ouvrirBoutique: ouvrirBoutique,/);
});
