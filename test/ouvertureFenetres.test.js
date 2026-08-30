'use strict';
/*
 * OÙ UNE FENÊTRE S'OUVRE, ET À QUELLE TAILLE
 *
 * L'arrivée depuis le coin supérieur gauche était juste ; la DESTINATION ne
 * l'était pas. Le portage posait chaque fenêtre neuve en escalier au milieu du
 * bureau (450 + n×26, 185 + n×24) — un escalier qui n'existe nulle part dans
 * main.swf.
 *
 * Ce que le bytecode dit, en trois morceaux :
 *
 *   WinStandard.init (0x53807)
 *       if (this.pos === undefined) this.pos = { x: 0, y: 0, w: 0, h: 0 };
 *
 *   WinStandard.recal (0x5411f)
 *       pos.w = max(minimum.w, min(mcw - cornerX, pos.w))
 *       pos.h = max(minimum.h, min(mch - cornerY, pos.h))
 *       pos.x = max(cornerX,   min(mcw - pos.w,  pos.x))
 *       pos.y = max(cornerY,   min(mch - pos.h,  pos.y))
 *
 *   WinStandard.updateDeskPos (0x53f47)
 *       recal(); moveToPos();
 *
 * Un `pos` à zéro sort donc de `recal` en (cornerX, cornerY) : la fenêtre se
 * pose DANS LE COIN, sous la main bar et contre la bande des contacts.
 *
 * DEUX EXCEPTIONS, toutes deux écrites dans le `init` de la classe :
 *
 *   win.Explorer (0x92447)  pos = { x: 50, y: 50, w: 400, h: 400 } + moveToCenter()
 *   win.ViewMail (0xc8910)  pos = { x: 50, y: 50, w: 500, h: 400 }
 *
 * ET LA TAILLE. `pos.w`/`pos.h` partant de zéro, c'est `minimum` qui la donne —
 * et `minimum` vaut `frameSet.minInt` (`onFrameSetUpdate`, 0x54acb), le minimum
 * de l'arbre de cadres que `Frame.updateMinInt` (0x479ba) remonte depuis le
 * contenu. D'où le calcul de `minFenetre` : les deux bandes de 6, la barre de
 * titre de 20, la bande du bas de 6, et un plancher de 200 en largeur.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

/* ── 1. LE COIN ───────────────────────────────────────────────────────────── */

test('le coin de la zone utile est celui du SWF', () => {
  // `main.cornerY = 106` (0x6b5e2), ramené à `10 + 96 × !flHalfHide` quand la
  // main bar se replie (0x6c5ca) ; `main.cornerX = sideList.wSide` = 9, et
  // `wMain + wSide` = 129 quand la bande des contacts est dépliée (0xa0d63).
  assert.match(JS, /var CORNER_Y = 106, CORNER_X = 9;/);
  assert.match(JS, /CORNER_X = ouvert \? 129 : 9;/);
  assert.match(JS, /CORNER_Y = 10 \+ 96 \* \(repli\.actif \? 0 : 1\);/);
});

test('une fenêtre neuve part de (0, 0) : recal en fait le coin', () => {
  assert.match(JS, /place = \{ x: 0, y: 0 \};\s*\/\/ `recal` en fera \(cornerX, cornerY\)/);
  // Et `recal` borne exactement comme le SWF.
  assert.match(JS, /pos\.w = Math\.max\(minimum\.w, Math\.min\(pos\.w, vw - CORNER_X\)\);/);
  assert.match(JS, /pos\.x = Math\.max\(CORNER_X, Math\.min\(pos\.x, vw - pos\.w\)\);/);
  assert.match(JS, /pos\.y = Math\.max\(CORNER_Y, Math\.min\(pos\.y, vh - pos\.h\)\);/);
});

test('plus d’escalier d’ouverture — ni pour les fenêtres, ni pour la fiche', () => {
  assert.doesNotMatch(JS, /cascade/);
  assert.doesNotMatch(JS, /450 \+ \(/);
  assert.doesNotMatch(JS, /185 \+ \(/);
  assert.doesNotMatch(JS, /ficheRang/);
  assert.match(JS, /f\.style\.setProperty\('--fx', CORNER_X \+ 'px'\);/);
});

/* ── 2. LES DEUX QUI DÉROGENT ─────────────────────────────────────────────── */

test('moveToCenter SOUSTRAIT le coin, il ne l’ajoute pas', () => {
  // 0x55bee : pos.x = (mcw - (cornerX + pos.w)) / 2 — la fenêtre se pose donc
  // un demi-coin plus haut et plus à gauche que le vrai centre.
  assert.match(JS, /x: \(window\.innerWidth - \(CORNER_X \+ parseFloat\(fen\.style\.width\)\)\) \/ 2,/);
  assert.match(JS, /y: \(window\.innerHeight - \(CORNER_Y \+ parseFloat\(fen\.style\.height\)\)\) \/ 2,/);
  // Et l'ancienne formule — le milieu de la zone utile — a disparu.
  assert.doesNotMatch(JS, /CORNER_Y \+ \(window\.innerHeight - CORNER_Y - rub\.h\) \/ 2/);
});

test('les explorateurs et la boîte d’alerte sont les seuls à se centrer', () => {
  // `win.Explorer` : pos {50,50,400,400} puis moveToCenter — 402 × 402 contour
  // compris. La boîte de réception, les deux dossiers du bureau et un dossier
  // posé sur le fond sont tous des `win.Explorer`. La boutique se centre aussi
  // (`win.Shop`), et `win.Alert` (sprite#812) finit son `init` par
  // `moveToCenter()` comme les autres boîtes de dialogue.
  // Le compte n'est PAS la garantie — il bouge dès qu'un dossier de plus
  // s'ouvre en fenêtre (« Mes contacts » et « Liste noire » sont deux
  // `win.Explorer` de plus). Ce qui compte, c'est qu'aucune fenêtre ne se
  // centre en dehors des trois gabarits qui le font d'époque :
  //
  //     402 × 402   win.Explorer   (courrier, disques, inventaire, carnet,
  //                                 liste noire, dossier du bureau)
  //     476 × 404   win.Shop       404 × 470   win.EditInfo
  //     260 × 130   win.Alert
  // Le gabarit ne tient pas toujours sur la ligne du `centre: true` (la boîte
  // de réception l'écrit une ligne plus haut) : on remonte donc jusqu'au
  // dernier `l:` déclaré avant lui.
  const gabarits = [];
  for (const m of JS.matchAll(/centre: true/g)) {
    const avant = JS.slice(Math.max(0, m.index - 240), m.index);
    const l = [...avant.matchAll(/\bl: (\d+), h: (\d+)/g)].pop();
    assert.ok(l, 'une fenêtre centrée sans gabarit : ' + avant.slice(-90));
    gabarits.push(l[1]);
  }
  for (const l of gabarits) {
    assert.ok(['402', '412', '476', '404', '260'].includes(l), 'gabarit inattendu : ' + l);
  }
  // Et les explorateurs sont bien les plus nombreux : c'est la fenêtre que le
  // bureau rouvre pour chaque dossier.
  assert.ok(gabarits.filter((l) => l === '402').length >= 5,
    'les dossiers du bureau s’ouvrent dans un win.Explorer centré');
});

/* ── 3. LA TAILLE ─────────────────────────────────────────────────────────── */

test('minFenetre reprend l’arithmétique de l’arbre de cadres', () => {
  assert.match(JS, /function minFenetre\(w, h\) \{ return \{ w: Math\.max\(200, w \+ 12\), h: h \+ 26 \}; \}/);
  // Les deux bandes de 6 (`left`/`right`), la barre de titre (`winTopBar`,
  // min 200 × 20) et la bande du bas (6) : c'est tout ce qu'`initFrameSet`
  // (0x547f9) met autour du contenu.
  assert.match(JS, /left   type w   min \{ w: 6, h: 0 \}/);
  assert.match(JS, /winTopBar \(compo, min 200×20\)/);
});

test('chaque fenêtre d’époque a le minimum de SON contenu', () => {
  // Les nombres sont ceux des `newElement` de chaque classe, relevés un à un.
  const attendus = [
    ["scores", "minFenetre(160 + 300, 200)"],       // win.Score  (sprite#869)
    ["boutique", "minFenetre(140 + 300, 200)"],     // win.Shop   (sprite#795)
    ["reglages", "minFenetre(140 + 200, 200)"],     // win.Pref   (sprite#831)
    ["salons", "minFenetre(200, 240)"],             // win.RoomList (sprite#894)
    ["evenements", "minFenetre(300, 200)"],         // win.Log    (sprite#750)
    ["historique", "minFenetre(300, 200)"],
  ];
  for (const [rub, appel] of attendus) {
    const bloc = JS.slice(JS.indexOf(rub + ':'), JS.indexOf(rub + ':') + 400);
    assert.ok(bloc.includes('min: ' + appel),
      rub + ' devrait déclarer min: ' + appel);
  }
  // Les explorateurs : navigatorFrame 80×28 au-dessus de fileIconList 100×100.
  const nb = (JS.match(/minFenetre\(100, 28 \+ 100\)/g) || []).length;
  assert.ok(nb >= 4, 'les quatre explorateurs partagent le même minimum');
});

test('la fenêtre d’un salon garde son minimum calculé, pas un couple figé', () => {
  // `minSalon` est un relevé 1:1 des quatre états du panneau : il reste une
  // FONCTION, parce qu'ouvrir la colonne des bouilles relève le minimum et
  // fait grandir la fenêtre (`appliquerMinimum`).
  assert.match(JS, /min: function \(\) \{ return minSalon\(panneau\); \},/);
  assert.match(JS, /function minSalon\(p\) \{/);
});
