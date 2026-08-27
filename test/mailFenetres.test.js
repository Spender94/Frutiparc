'use strict';
/*
 * LIRE ET ÉCRIRE UN COURRIER : DEUX FENÊTRES À ELLES.
 *
 * « La visionneuse mail du light est assez éloignée visuellement de celle
 *   d'origine → c'est surtout la couleur qui change. Idem pour la fenêtre de
 *   rédaction — là c'est plus éloigné encore : couleur, absence de bouton de
 *   formattage, espacement… »
 *
 * La couleur ne se devine pas, elle se lit. `registerSymphony.as` enregistre
 * TROIS classes distinctes sur ce panneau —
 *
 *     Object.registerClass("winExplorer", win.Explorer);   ← la liste
 *     Object.registerClass("winMail",     win.Mail);       ← écrire
 *     Object.registerClass("winViewMail", win.ViewMail);   ← lire
 *
 * — et chacune monte ses cadres avec un `mainStyleName` écrit noir sur blanc
 * dans le bytecode :
 *
 *     infoFrame      `frSystem`                    (0x77fde et 0xc8de2)
 *     editToolFrame  `frSystem`, 28 px             (0x781dc)
 *     mainFrame      `frDef` + `flBackground:true` (0x7835d et 0xc90e6)
 *     butDoc         `frSystem`, marges 4 / 6      (0x785a9)
 *
 * `Standard.getWinStyle()` donne `frSystem = [white, green, white]` et
 * `frDef = [green, green]` ; `getDocStyle` en tire l'encre (`c0.overdark`),
 * la couleur des saisies (`inputColor = c1`) et celle des fonds de texte
 * (`bgTextColor = c0`). D'où : en-tête, barre de style et barre du bas en
 * gris foncé sur le blanc de la fenêtre, saisies VERTES, corps du message
 * dans le champ vert du bureau. Le portage peignait tout en JAUNE parce
 * qu'il loge les trois vues dans la fenêtre de l'explorateur.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');

/* ── 1. LA COULEUR ────────────────────────────────────────────────────────── */

test('la classe de la vue décide de la couleur, et le jaune reste à la liste', () => {
  // Trois vues dans un panneau : la classe dit laquelle on regarde.
  const bloc = /function retitrerMail\(vue\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(bloc, 'retitrerMail doit exister');
  assert.match(bloc[0], /panneau\.classList\.toggle\('mx-lit', vue === 'lecture'\);/);
  assert.match(bloc[0], /panneau\.classList\.toggle\('mx-ecrit', vue === 'ecriture'\);/);
  // Le jaune de l'explorateur ne vaut QUE pour la liste et ses dossiers.
  assert.match(CSS, /#mail-panel \.mx-champ,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel #mail-liste \{/);
  const jaune = /#mail-panel \.mx-champ,[\s\S]*?\n\}/.exec(CSS)[0];
  assert.ok(/#F8F866/.test(jaune) && /#EAEA0F/.test(jaune), 'la liste garde sa chair jaune');
  assert.ok(!/#mail-lu-corps/.test(jaune) && !/#mail-texte/.test(jaune),
    'mais elle ne teint plus les deux autres vues');
  // Et l'ascenseur suit le composant : `frDef` est vert.
  assert.match(CSS, /\.fen:has\(#mail-panel\.mx-lit\),\s*\n\s*body\.bureau-frutiz \.fen:has\(#mail-panel\.mx-ecrit\) \{\s*\n\s*--asc-glissiere: #ADE76B;/);
});

test('l’encre de `frSystem` est le gris de `white.overdark`, pas du vert', () => {
  // `ts.textFormat.color = c0.overdark` (Standard.as:274) et `c0` vaut
  // `colorSet.white` pour `frSystem` — donc #222222.
  assert.match(CSS, /\.mx-ligne,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel \.mx-de \{[\s\S]*?color: #222222;/);
  assert.match(CSS, /\.mx-lab \{[\s\S]*?color: #222222;/);
  assert.match(CSS, /\.mail-form label \{[\s\S]*?color: #222222;/);
  assert.match(CSS, /\.mx-copie \{[\s\S]*?color: #222222;/);
});

test('le corps du message est le champ VERT du bureau, aux mesures du salon', () => {
  // `mainFrame` est le SEUL cadre à porter `flBackground`, et il est en
  // `frDef` : c'est l'écorce de la zone des messages d'un salon, relevée au
  // pixel (contour 2 px #DDDDDD hors boîte, liseré 2 px #ADE76B, chair
  // #CCF599 sous un reflet blanc de 8 px).
  for (const sel of ['#mail-lu-corps', '#mail-texte']) {
    const r = new RegExp(sel.replace('#', '#') + ' \\{[\\s\\S]*?\\n\\}');
    const b = r.exec(CSS);
    assert.ok(b, sel + ' doit avoir sa règle');
    assert.match(b[0], /rgba\(255,255,255,\.64\) 0, rgba\(255,255,255,0\) 8px\), #CCF599;/);
    assert.match(b[0], /border: 2px solid #ADE76B; border-radius: 5px; box-shadow: 0 0 0 2px #DDDDDD;/);
    assert.match(b[0], /font: normal 12px Verdana, Arial, sans-serif; color: #335511;/);
  }
  // La même écorce, aux mêmes valeurs, que `#chat-panel #messages`.
  const salon = /#chat-panel #messages \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(salon, /border: 2px solid #ADE76B; border-radius: 5px;/);
  assert.match(salon, /box-shadow: 0 0 0 2px #DDDDDD;/);
  assert.match(salon, /rgba\(255,255,255,\.64\) 0, rgba\(255,255,255,0\) 8px\),\s*\n\s*#CCF599;/);
});

test('les saisies prennent `inputColor`, le VERT — et la ligne « De » le BLANC', () => {
  // `inputColor = color[1]`, et `frSystem` met `green` en deuxième : la même
  // gélule que le champ « sujet du salon » et que celui de la Recherche.
  const champs = /#mail-a,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel #mail-sujet \{[\s\S]*?\n\}/.exec(CSS);
  assert.ok(champs, 'les deux champs doivent partager leur règle');
  assert.match(champs[0], /height: 14px;/);
  assert.match(champs[0], /border-radius: 7px; box-shadow: inset 0 0 0 1px #94DB39;/);
  assert.match(champs[0], /background: #DDFFBB;/);
  const salon = /#salons-panel \.sp-nom \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(salon, /height: 14px;[\s\S]*?border-radius: 7px; background: #DDFFBB; box-shadow: inset 0 0 0 1px #94DB39;/);
  // La ligne « De » n'est pas une saisie : c'est un `type:"text"` porteur de
  // `flBackground: true` (0x77f46), et `de.Text.display` (0x730f8) le peint
  // alors avec `bgTextColor = c0` — le BLANC, pas le vert. `drawCustomSquare`
  // (0x734ab) prend `c0.light` en chair et `c0.dark` en liseré de 1 px.
  const de = /\.mx-de \.mx-val \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(de, /background: #FFFFFF;/);
  assert.match(de, /box-shadow: inset 0 0 0 1px #AAAAAA;/);
});

/* ── 2. LES BOUTONS DE FORMATTAGE ─────────────────────────────────────────── */

test('la barre de style existe, avec les vrais dessins de `butFlagSmallPink`', () => {
  // `attachEditTool` (0x78048) : un `cpDocument` de 28 px, style `frSystem`.
  assert.match(CSS, /\.mx-outils \{\s*\n\s*grid-column: 1 \/ -1; height: 28px;/);
  // Les cinq dessins sortent du SWF — coque relâchée (#359 + reflet #375),
  // coque enfoncée (#560 + #561), et les trois pictos (#370, #371, #372).
  for (const f of ['haut', 'bas', 'gras', 'italique', 'souligne']) {
    const p = path.join(ROOT, 'public/frutiz/sprites/but-flag-' + f + '.svg');
    assert.ok(fs.existsSync(p), 'but-flag-' + f + '.svg doit être extrait');
    const svg = fs.readFileSync(p, 'utf8');
    assert.match(svg, /viewBox="0 0 20 20" width="20" height="20"/,
      'chaque pièce garde le carré de 20 du sprite');
  }
  // Les couleurs relevées à l'extraction : la coque relâchée #FFAAAD cerclée
  // de #F28687, l'enfoncée #FE8B95 cerclée de #E3756A, l'encre #5B0B0B.
  const haut = fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/but-flag-haut.svg'), 'utf8');
  assert.ok(/#ffaaad/i.test(haut) && /#f28687/i.test(haut) && /#ffffff/i.test(haut));
  const bas = fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/but-flag-bas.svg'), 'utf8');
  assert.ok(/#fe8b95/i.test(bas) && /#e3756a/i.test(bas) && /#dadada/i.test(bas));
  assert.match(fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/but-flag-gras.svg'), 'utf8'), /#5b0b0b/i);
  // Vingt pixels de large, c'est le `width: 20` du bytecode.
  assert.match(CSS, /\.mx-flag \{\s*\n\s*width: 20px; height: 20px; flex: 0 0 20px;/);
  // Un `butFlag` reste ENFONCÉ tant que son drapeau est vrai : image 2.
  assert.match(CSS, /\.mx-flag\[aria-pressed="true"\] \{[\s\S]*?but-flag-bas\.svg/);
});

test('l’ordre de la barre : G I S, l’espace élastique, puis le menu des corps', () => {
  // L'InitArray de 0x781a5 se lit à l'envers : flBold, flItalic, flUnderline,
  // {spacer big:1}, comboBox.
  assert.match(JS, /var MAIL_DRAPEAUX = \[\['gras', 'g', 'Gras'\], \['italique', 'i', 'Italique'\],\s*\n\s*\['souligne', 's', 'Souligné'\]\];/);
  const bloc = JS.slice(JS.indexOf("outils.className = 'mx-outils'"), JS.indexOf("form2.insertBefore(outils"));
  assert.ok(bloc.indexOf('mx-outils-esp') < bloc.indexOf("createElement('select')"),
    'l’espace élastique vient AVANT le menu');
  assert.match(CSS, /\.mx-outils-esp \{ flex: 1 1 auto; \}/);
  // La barre se glisse entre le « Sujet » et le corps.
  assert.match(JS, /form2\.insertBefore\(outils, \$\('#mail-texte'\)\);/);
  assert.match(CSS, /\.mail-form \{[\s\S]*?grid-template-rows: 20px 20px 20px 28px 1fr auto;/);
});

test('les sept corps de `mail.font_size`, « Normal » en place, et `dy: 4`', () => {
  assert.match(LANG, /mail\.font_size = "Trop gros;Tr.s gros;Gros;Normal;Petit;Tr.s petit;Illisible"/);
  // Les corps ne sont pas au choix : `AdvancedTextInput.cbSizeEqui` (0x7970d)
  // les porte en clair — [6, 8, 10, 12, 14, 16, 18], que l'InitArray retourne.
  assert.match(JS, /var MAIL_CORPS = \[\['Trop gros', 18\], \['Très gros', 16\], \['Gros', 14\],\s*\n\s*\['Normal', 12\], \['Petit', 10\], \['Très petit', 8\], \['Illisible', 6\]\];/);
  // `def: "normal"` : le menu s'ouvre sur le corps du message, 12.
  assert.match(JS, /taille\.value = '12';/);
  // `width: 100` et `dy: 4` — les deux mesures du comboBox.
  assert.match(CSS, /\.mx-taille \{\s*\n\s*flex: 0 0 100px; width: 100px; height: 16px; margin-top: 4px;/);
  // Et son fond est `inputColor`, comme celui de la Recherche.
  assert.match(CSS, /\.mx-taille \{[\s\S]*?background: #DDFFBB;/);
});

test('les drapeaux agissent sur le champ — et l’écart est écrit', () => {
  // D'époque `win.Mail.endInit` (0x77d4d) branche un `AdvancedTextInput` sur
  // le champ, qui porte `fieldProperty.html = true` : le message EST du HTML,
  // que `box.Mail.sendMail` passe par `FEString.simplifyHTML` (0x8a99f).
  // Le portage envoie du texte simple d'un bout à l'autre — c'est écrit.
  assert.match(JS, /ÉCART ASSUMÉ : le courrier du portage est du texte simple/);
  assert.match(JS, /champ\.classList\.toggle\('mx-' \+ f\[1\], on\);/);
  assert.match(CSS, /#mail-texte\.mx-g \{ font-weight: 700; \}/);
  assert.match(CSS, /#mail-texte\.mx-i \{ font-style: italic; \}/);
  assert.match(CSS, /#mail-texte\.mx-s \{ text-decoration: underline; \}/);
});

/* ── 3. LA CASE « GARDER UNE COPIE » ──────────────────────────────────────── */

test('la case `savetooutbox`, dessinée comme `de.CheckBox`', () => {
  // Les guillemets du libellé sont échappés dans le fichier de langue.
  assert.match(LANG, /mail\.add_in_outbox = "Ajouter dans \\"Messages envoy.s\\"";/);
  assert.match(JS, /var MAIL_COPIE = 'Ajouter dans "Messages envoyés"';/);
  assert.match(JS, /lab\.innerHTML = '<input type="checkbox" id="mail-copie" checked>/);
  // `drawGfx` (0xa971e) : la case en `inputColor.light` cerclée de
  // `inputColor.dark`, SANS arrondi (`curve: 0`) ; la coche est un carré
  // plein en `inputColor.darker`. `th = textHeight + 3` vaut 16 pour une
  // ligne de Verdana 10 : case de 13, coche de 8.
  const c = /\.mx-copie input \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(c, /flex: 0 0 13px; width: 13px; height: 13px;/);
  assert.match(c, /border-radius: 0; background: #DDFFBB;/);
  assert.match(c, /box-shadow: inset 0 0 0 1px #94DB39;/);
  assert.match(CSS, /\.mx-copie input::after \{\s*\n\s*content: ""; width: 8px; height: 8px;/);
  assert.match(CSS, /\.mx-copie input:checked::after \{ background: #66AA22; \}/);
  // L'ordre de la barre : la case, l'espace élastique, puis « Envoyer ».
  assert.match(CSS, /\.mx-copie \{ order: 1; \}/);
  assert.match(CSS, /#mail-envoyer \{ order: 2; margin-left: auto; \}/);
});

test('la case voyage jusqu’au serveur, et le mobile ne bouge pas', () => {
  // `box.Mail.sendMail` (0x8a9d6) relaie la variable dans `o` : sans elle, le
  // SWF ne gardait AUCUNE copie.
  assert.match(LIGHT, /var copieMail = \$\("#mail-copie"\);\s*\n\s*if \(copieMail\) corps\.saveToOutbox = copieMail\.checked;/);
  assert.match(SERVEUR, /const garderCopie = corps\.saveToOutbox === undefined \|\| !!corps\.saveToOutbox;/);
  assert.match(SERVEUR, /if \(garderCopie\) \{\s*\n\s*user\.mails\.push\(mail\);/);
  // Le gabarit tactile n'a pas cette case : le champ reste absent, et le
  // serveur garde la copie comme avant.
  assert.ok(!/id="mail-copie"/.test(LIGHT.slice(0, LIGHT.indexOf('function envoyerMail'))),
    'aucune case dans le gabarit du mobile');
});

/* ── 4. LES DATES ─────────────────────────────────────────────────────────── */

test('la visionneuse date en toutes lettres, la liste en chiffres', () => {
  // `win.ViewMail.setMail` (0xaeb22) demande le format « long » ;
  // `but.icon.Detail.display` (0x524c7) demande « numeric ».
  assert.match(LANG, /date\.format_long = "\$a \$d \$m \$H:\$I"/);
  assert.match(LANG, /date\.format_numeric = "\$D\/\$N \$H:\$I"/);
  assert.match(JS, /date: mailDateLongue\(m\.date\),/);
  // « $D/$N $H:$I » : PAS D'ANNÉE. On en affichait une.
  const courte = /function mailDateCourte\(s\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(courte, /return m \? m\[3\] \+ '\/' \+ m\[2\] \+ ' ' \+ m\[4\] \+ ':' \+ m\[5\] : String\(s \|\| ''\);/);
  // Les douze mois et les sept jours de lang_french.as. « aout » n'a pas
  // d'accent circonflexe d'époque : on garde la faute.
  assert.match(LANG, /date\.month\["8"\] = "aout"/);
  assert.match(JS, /'juillet', 'aout', 'septembre'/);
  assert.match(LANG, /date\.day\["1"\] = "lundi"/);
  assert.match(JS, /var MAIL_JOURS = \['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',\s*\n\s*'samedi', 'dimanche'\];/);
});

test('mailDateLongue rend « jeudi 27 aout 20:17 »', () => {
  const src = /var MAIL_JOURS = [\s\S]*?function mailDateLongue\(s\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(src, 'mailDateLongue doit exister');
  // eslint-disable-next-line no-new-func
  const f = new Function(src[0] + '; return mailDateLongue;')();
  assert.strictEqual(f('2026-08-27 20:17:04'), 'jeudi 27 aout 20:17');
  // `$d` est le quantième SANS zéro, `$H:$I` l'heure AVEC.
  assert.strictEqual(f('2026-01-05 09:03:00'), 'lundi 5 janvier 09:03');
  // `$b` va de 1 (lundi) à 7 (dimanche) : le dimanche de getDay() vaut 0.
  assert.strictEqual(f('2026-08-30 00:00:00'), 'dimanche 30 aout 00:00');
  assert.strictEqual(f('2026-12-25T18:30:00'), 'vendredi 25 décembre 18:30');
  // Ce qu'on ne sait pas lire ressort tel quel.
  assert.strictEqual(f('jamais'), 'jamais');
});

/* ── 5. CE QUI NE DOIT PAS BOUGER ─────────────────────────────────────────── */

test('la barre de l’explorateur disparaît des deux autres vues', () => {
  assert.match(CSS, /#mail-panel\.mx-lit \.mx-nav,\s*\n\s*body\.bureau-frutiz \.fen #mail-panel\.mx-ecrit \.mx-nav \{ display: none; \}/);
});

test('le gabarit TACTILE garde ses couleurs et ses mots', () => {
  // Tout ce qui précède est porté par `body.bureau-frutiz` : le mobile lit la
  // même page sans en voir une ligne.
  for (const r of ['.mx-outils', '.mx-flag', '.mx-copie', '.mx-taille',
    '#mail-lu-corps', '#mail-texte', '.mx-de .mx-val']) {
    const i = CSS.indexOf(r + ' {');
    if (i < 0) continue;
    const debut = CSS.lastIndexOf('\n', CSS.lastIndexOf('body', i)) + 1;
    assert.match(CSS.slice(debut, i + r.length + 2), /^body\.bureau-frutiz/,
      r + ' doit rester derrière body.bureau-frutiz');
  }
  // Le mobile garde son bandeau, ses étiquettes et son fond vert clair.
  assert.match(LIGHT, /<label for="mail-a">À<\/label>/);
  assert.match(LIGHT, /<label for="mail-texte">Message<\/label>/);
  assert.match(LIGHT, /\.mail-entete \{ flex-shrink: 0; padding: 10px 12px 8px; background: #E4F7C4;/);
});
