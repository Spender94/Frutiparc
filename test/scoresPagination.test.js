'use strict';
/*
 * LE TABLEAU DES SCORES : LA PAGINATION, LA PUCE, LE NIVEAU, LA PHRASE.
 *
 * Quatre demandes du joueur, quatre points d'appui dans main.swf :
 *
 *   `box.Score.init`        0xc1132   nbResult = 10        — dix par page
 *   `win.Score.displayRanking` 0xc389e  deux boutons de texte poussés aux deux
 *                                     bouts par un `{type:'spacer', big:1}` :
 *                                       si currentStart > 0        « précédents »
 *                                       si la suite existe          « suivants »
 *   `win.Score.onRankingList` 0xc1b69  les DEUX classements « joueur » que le
 *                                     SWF ajoute lui-même à la liste reçue
 *                                     portent `bulletFrame: 12` — la douzième
 *                                     image de `scoreBullet` (#583), un
 *                                     PANTHÉON, quand toutes les autres lignes
 *                                     prennent l'image 1 (la médaille).
 *   `lang_french.as`                  score.my_rank.empty = « Je ne suis pas
 *                                     classé pour le moment »
 *                                     score.next / score.prev
 *
 * Ce fichier n'inspecte pas que le texte du source : il EXÉCUTE les fonctions
 * de pagination livrées, extraites de light.html et rejouées ici.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Les trois fonctions de pagination, telles qu'elles sont livrées.
function moteurPagination() {
  const bouts = ['SC_PAR_PAGE = 10', 'function scPage(g) {', 'function scPagination(g) {'];
  const src = [];
  const par = /var SC_PAR_PAGE = 10;[\s\S]*?var scoresDebut = 0;/.exec(LIGHT);
  assert.ok(par, 'le pas de page et le curseur doivent exister');
  src.push(par[0].replace(/^\s*\/\/.*$/gm, ''));
  for (const nom of ['scPage', 'scPagination']) {
    const f = new RegExp('function ' + nom + '\\(g\\) \\{[\\s\\S]*?\\n  \\}').exec(LIGHT);
    assert.ok(f, 'fonction introuvable : ' + nom);
    src.push(f[0]);
  }
  assert.ok(bouts.length === 3);
  // eslint-disable-next-line no-new-func
  return new Function(src.join('\n') + `
    return {
      page: (g, d) => { scoresDebut = d; return scPage(g); },
      pied: (g, d) => { scoresDebut = d; return scPagination(g); },
      pas: SC_PAR_PAGE,
    };`)();
}

function classement(n, total) {
  const s = [];
  for (let i = 0; i < n; i++) s.push({ pos: i + 1, user: 'j' + (i + 1), label: String(1000 - i) });
  return { scores: s, count: total === undefined ? n : total };
}

test('dix lignes par page — c’est `nbResult` du bytecode', () => {
  const M = moteurPagination();
  assert.strictEqual(M.pas, 10, 'nbResult = 10 (0xc1132)');
  const g = classement(37);
  assert.strictEqual(M.page(g, 0).length, 10);
  assert.strictEqual(M.page(g, 0)[0].pos, 1);
  assert.strictEqual(M.page(g, 10)[0].pos, 11);
  assert.strictEqual(M.page(g, 30).length, 7, 'la dernière page ne se complète pas');
});

test('les deux boutons paraissent et disparaissent au bon moment', () => {
  const M = moteurPagination();
  const g = classement(37);
  // Première page : « suivants » seul.
  let h = M.pied(g, 0);
  assert.ok(!/précédents/.test(h), 'rien avant la première page');
  assert.ok(/suivants/.test(h), 'mais il y a une suite');
  // Au milieu : les deux.
  h = M.pied(g, 10);
  assert.ok(/précédents/.test(h) && /suivants/.test(h));
  // Dernière page : « précédents » seul.
  h = M.pied(g, 30);
  assert.ok(/précédents/.test(h), 'on peut remonter');
  assert.ok(!/suivants/.test(h), 'et il n’y a plus rien après');
  // Un classement qui tient sur une page n'a AUCUN bouton — d'époque la ligne
  // du bas se réduit à son `spacer`.
  assert.strictEqual(M.pied(classement(4), 0), '', 'quatre lignes : pas de pied');
  assert.strictEqual(M.pied(classement(10), 0), '', 'dix pile non plus');
});

test('« suivants » ne promet pas des lignes que le serveur n’a pas envoyées', () => {
  // Le serveur plafonne à cinquante lignes ; un classement de deux cents en
  // annonce deux cents (`count`) mais n'en donne que cinquante. Le bouton doit
  // s'arrêter à ce qu'on a REÇU, sinon la dernière page est vide.
  const M = moteurPagination();
  const g = classement(50, 200);
  assert.ok(/suivants/.test(M.pied(g, 30)), 'il reste des lignes reçues');
  assert.ok(!/suivants/.test(M.pied(g, 40)),
    'la cinquantième est la dernière que l’on ait : on ne propose pas au-delà');
  assert.strictEqual(M.page(g, 40).length, 10);
});

test('un curseur qui dépasse revient en tête plutôt que de vider la page', () => {
  const M = moteurPagination();
  // Changer de classement pour un plus court, sans remettre le curseur.
  assert.strictEqual(M.page(classement(4), 30).length, 4);
});

test('la puce du panthéon ne coiffe QUE les deux classements joueur', () => {
  const f = /function puceDeClassement\(g\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'le choix de la puce doit exister');
  // eslint-disable-next-line no-new-func
  const puce = new Function(f[0] + '; return puceDeClassement;')();
  assert.strictEqual(puce({ id: '_xp' }), '/fb/score_pantheon.png');
  assert.strictEqual(puce({ id: '_rate' }), '/fb/score_pantheon.png');
  assert.strictEqual(puce({ id: 'snake3_classic' }), '/fb/score_medaille.png');
  assert.strictEqual(puce({ id: 'kikooz' }), '/fb/score_medaille.png');
  assert.strictEqual(puce(null), '/fb/score_medaille.png');
});

test('le panthéon est bien l’image 12 de `scoreBullet`, sortie du SWF', () => {
  // Le fichier existe, et c'est bien le bitmap #581 : 24 × 22, celui que la
  // forme #582 (image 12 du clip #583) remplit.
  const p = path.join(ROOT, 'public/fb/score_pantheon.png');
  assert.ok(fs.existsSync(p), 'le dessin doit être livré');
  const b = fs.readFileSync(p);
  assert.strictEqual(b.toString('ascii', 1, 4), 'PNG');
  assert.strictEqual(b.readUInt32BE(16), 24, 'vingt-quatre de large');
  assert.strictEqual(b.readUInt32BE(20), 22, 'vingt-deux de haut');
  // Et le clip est bien dans main.swf, avec ses douze images.
  const brut = fs.readFileSync(path.join(ROOT, 'legacy/main.swf'));
  const corps = brut.toString('latin1', 0, 3) === 'CWS'
    ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
  assert.ok(corps.toString('latin1').includes('scoreBullet'),
    'le nom d’auteur `scoreBullet` est dans le SWF');
});

test('le classement XP montre le NIVEAU, et le tri reste sur l’XP', () => {
  const m = /const xp = \[\.\.\.fusion\.entries\(\)\][\s\S]*?games\.push\('?_xp'?[\s\S]{0,120}?\);/
    .exec(SERVEUR) || /const xp = \[\.\.\.fusion\.entries\(\)\][\s\S]*?games\.push\(permanent\('_xp'[^\n]*\);/
    .exec(SERVEUR);
  assert.ok(m, 'le classement XP doit exister côté serveur');
  // « Niv. 95, 31% » : `Standard.displayScoreType(v, 'xp')` (0x25b84) écrit le
  // niveau ET l'avancement dedans. Le portage n'écrivait que « niveau 95 ».
  assert.match(m[0], /label: displayScoreType\(s, 'xp'\)/, 'l’étiquette est celle d’époque');
  assert.ok(!/toLocaleString\('fr-FR'\) \+ ' xp'/.test(m[0]),
    'et plus le compte d’expérience');
  assert.match(m[0], /xp\.sort\(\(a, b\) => b\.s - a\.s/, 'le tri, lui, reste sur l’XP');
  // La colonne porte le bon titre — celui de `score.score_type.<ty>`.
  const t = /function titreColonneScore\(g\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(t, 'le titre de colonne doit exister');
  // eslint-disable-next-line no-new-func
  const titre = new Function(t[0] + '; return titreColonneScore;')();
  assert.strictEqual(titre({ id: '_xp' }), 'Expérience');
  assert.strictEqual(titre({ id: '_rate' }), 'Consécration');
  assert.strictEqual(titre({ id: 'mb2_classic', lowerIsBetter: true }), 'Temps');
  assert.strictEqual(titre({ id: 'snake3_classic' }), 'Score');
});

test('un score s’écrit comme `Standard.displayScoreType`', () => {
  /* main.swf 0x25a56, branche par branche — c'est le `ty` du descripteur qui
     choisit, et `FENumber.toStringL` (0x128a1) remplit de zéros à gauche.
     Le portage avait ses propres formats : « 1:01.23 » pour un temps (deux
     centièmes au lieu de trois millièmes, et deux-points au lieu de la
     ponctuation d'époque), le compte d'XP brut, la consécration à quatre
     décimales suivie d'une espace. */
  const f = /function displayScoreType\(score, ty\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'displayScoreType doit exister côté serveur');
  const pad = /function padZ\(n, l\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  const lvl = /function getLevelForXp\(xp\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  const xpl = /function xpForLevel\(level\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  const rate = /function xpLevelCompletionRate\(xp\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  // eslint-disable-next-line no-new-func
  const d = new Function(pad[0] + xpl[0] + lvl[0] + rate[0] + f[0]
    + '; return displayScoreType;')();

  // millisecond : `m + "'" + pad(s,2) + '"' + pad(ms,3)`, la minute seulement
  // si elle existe.
  assert.strictEqual(d(61234, 'millisecond'), '1\'01"234');
  assert.strictEqual(d(45678, 'millisecond'), '45"678');
  assert.strictEqual(d(704, 'millisecond'), '0"704');
  // xp : niveau 1 à 0 d'expérience, et 10 000 ouvre le niveau 2.
  assert.strictEqual(d(0, 'xp'), 'Niv. 1, 00%');
  assert.strictEqual(d(10000, 'xp'), 'Niv. 2, 00%');
  assert.strictEqual(d(5000, 'xp'), 'Niv. 1, 50%');
  // rate : deux décimales au plus, le % collé.
  assert.strictEqual(d(31.4159, 'rate'), '31.42%');
  assert.strictEqual(d(50, 'rate'), '50%');
  // ptmb2 : le pourcentage seul en dessous de cent, le boss devant au-delà.
  assert.strictEqual(d(42, 'ptmb2'), '43%');
  assert.strictEqual(d(305, 'ptmb2'), '3, 6%');
  // le défaut rend le nombre
  assert.strictEqual(d(4321, 'point'), '4321');

  // Et le light écrit pareil dans la fiche.
  const s = /function scoreLisible\(score, type\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(s, 'scoreLisible doit exister');
  // eslint-disable-next-line no-new-func
  const l = new Function(s[0] + '; return scoreLisible;')();
  assert.strictEqual(l(61234, 'millisecond'), '1\'01"234');
  assert.strictEqual(l(42, 'ptmb2'), '43%');
});

test('« Je ne suis pas classé pour le moment » — la phrase de lang_french.as', () => {
  // `win.Score.displayMyRank` (0xc2fb9) pose `score.my_rank.empty` quand le
  // joueur n'a pas de rang. Le portage ne posait rien.
  assert.match(LIGHT, /html \+= '<div class="sc-moi">Je ne suis pas classé pour le moment<\/div>';/);
  // …et seulement si l'on est identifié : un visiteur n'a pas à se voir dire
  // qu'il n'est pas classé.
  assert.match(LIGHT, /\} else if \(state\.user\) \{\s*\n\s*html \+= '<div class="sc-moi">Je ne suis pas classé/);
  // L'autre branche reste celle d'époque : « Je suis $p avec $s ».
  assert.match(LIGHT, /'<div class="sc-moi">Je suis ' \+ g\.me\.pos \+ \(g\.me\.pos === 1 \? "er" : "ème"\)/);
});

test('le nom d’un médaillé est en gras', () => {
  const r = /\.sc-pod span \{[^}]*\}/.exec(LIGHT);
  assert.ok(r, 'la règle du médaillé doit exister');
  assert.match(r[0], /font-weight: bold/);
});

test('les deux boutons sont de VRAIES gélules roses (`butPushStandard`)', () => {
  /* Le dépouillement d'un élément de document (0x65b6d) :
   *     case "button":
   *       e.link = "butPush";
   *       if (e.param.link  == undefined) e.param.link  = "butPushStandard";
   *       if (e.param.color == undefined) e.param.color = doc.docStyle.outlineColorNum;
   *
   * (Le portage les avait d'abord dessinés en `butText` — du texte qui change
   * de couleur. C'est le bouton des entrées de menu et des pseudos, pas celui
   * d'un élément de document.) */
  const r = /\.sc-page-btn \{[^}]*\}/.exec(LIGHT);
  assert.ok(r, 'la règle du bouton doit exister');
  assert.match(r[0], /background: #FFAAAD/, 'la chair rose de `butPushStandard`');
  assert.match(r[0], /box-shadow: inset 0 0 0 1\.5px #F28687/, 'son anneau intérieur');
  assert.match(r[0], /height: 16px/, 'seize de haut, comme le dessin');
  assert.match(r[0], /flex: 0 0 80px/, 'la largeur du milieu (image 2 : 40, 80, 120)');
  assert.match(r[0], /font: 700 10px Verdana[^;]*; color: #660000/, 'l’encre relevée');
  // Le reflet `#FFEAEC` : bord haut puis bout droit.
  assert.match(LIGHT, /\.sc-page-btn::after \{[\s\S]*?border-top: 1px solid #FFEAEC; border-right: 1px solid #FFEAEC;/);
  // Et le `spacer big:1` qui les pousse aux deux bouts.
  assert.match(LIGHT, /\.sc-page-esp \{ flex: 1 1 auto; \}/);
  assert.match(LIGHT, /'<span class="sc-page-esp"><\/span>'/);
});

test('c’est LE MÊME rendu que le bouton « créer un salon »', () => {
  // Les deux sortent de `butPushStandard` (#465) : celui de la fenêtre des
  // salons a été relevé 1:1 sur le rendu d'époque, et la pagination le
  // reprend au lieu d'en inventer un second. Les deux ne peuvent plus
  // diverger sans qu'on s'en aperçoive.
  const salon = /#salons-panel \.sp-creer \{[^}]*\}/.exec(CSS);
  assert.ok(salon, 'le bouton de la fenêtre des salons doit exister');
  const page = /\.sc-page-btn \{[^}]*\}/.exec(LIGHT);
  for (const t of ['height: 16px', 'border-radius: 8px', 'background: #FFAAAD',
    'box-shadow: inset 0 0 0 1.5px #F28687', 'color: #660000']) {
    assert.ok(salon[0].includes(t), 'le bouton des salons porte « ' + t + ' »');
    assert.ok(page[0].includes(t), 'celui de la pagination aussi : « ' + t + ' »');
  }
  // Le clip est bien dans main.swf.
  const brut = fs.readFileSync(path.join(ROOT, 'legacy/main.swf'));
  const corps = brut.toString('latin1', 0, 3) === 'CWS'
    ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
  assert.ok(corps.toString('latin1').includes('butPushStandard'),
    'le nom d’auteur `butPushStandard` est dans le SWF');
});
