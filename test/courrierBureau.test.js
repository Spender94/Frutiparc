'use strict';
/*
 * LIRE ET ÉCRIRE UN COURRIER, AU BUREAU
 *
 * D'époque ce sont TROIS fenêtres : la boîte est un `win.Explorer` (le jaune),
 * lire ouvre `win.ViewMail` (0xc8910, `pos = {50, 50, 500, 400}`) et écrire
 * ouvre `win.Mail`. Le portage n'a qu'un panneau à reparenter, et il y rejoue
 * les trois gabarits l'un après l'autre — le bandeau suit donc la vue.
 *
 * CE QUI N'ALLAIT PAS :
 *
 * · LES BOUTONS. `win.ViewMail.attachEndButton` (0xc8e72) compose sa barre en
 *   XML, et les trois boutons y sont `l="butPushStandard"` — la GÉLULE ROSE de
 *   16 px, celle du pied de « Salons publics ». Le portage en avait fait des
 *   pastilles vertes, avec en prime un rouge « danger » et un vert « primaire »
 *   qui viennent du gabarit tactile : d'époque les trois sont IDENTIQUES.
 *
 * · LES MOTS. `mail.move_to_recyclebin` vaut « Supprimer » (et non « Mettre à
 *   la corbeille »), `mail.forward` vaut « Transférer » (et non « Faire
 *   suivre ») — et ce troisième bouton manquait tout court. Les étiquettes de
 *   l'en-tête portent leurs DEUX-POINTS, et le « A » n'a pas d'accent.
 *
 * · LA CITATION. `box.ViewMail.forward` (0xaecd9) et son pendant `reply`
 *   remplissent le nouveau message avec `mail.forward_tpl` / `mail.reply_tpl` :
 *   un en-tête, les quatre champs, une ligne vide, le message d'origine. Le
 *   portage répondait sur une page blanche.
 *
 * LE MOBILE NE BOUGE PAS : ses trois boutons gardent leurs couleurs, ses
 * étiquettes leurs mots, et `ecrireMail` sans corps se comporte comme avant.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');

/* ── 1. LE BOUTON ─────────────────────────────────────────────────────────── */

test('les trois boutons sont le butPushStandard rose, pas une pastille verte', () => {
  const bloc = CSS.slice(CSS.indexOf('LE BOUTON D’ÉPOQUE') >= 0
    ? CSS.indexOf('LE BOUTON D’ÉPOQUE') : CSS.indexOf("LE BOUTON D'ÉPOQUE"));
  assert.ok(bloc, 'le bloc du bouton manque');
  assert.match(CSS, /#mail-panel \.ma-btn \{[\s\S]*?background: #FFAAAD; box-shadow: inset 0 0 0 1\.5px #F28687;/);
  assert.match(CSS, /#mail-panel \.ma-btn \{[\s\S]*?color: #660000;/);
  // Le reflet du bout droit, comme au pied de « Salons publics ».
  assert.match(CSS, /#mail-panel \.ma-btn::after \{[\s\S]*?border-top: 1px solid #FFEAEC; border-right: 1px solid #FFEAEC;/);
  // Le vert inventé a disparu.
  assert.doesNotMatch(CSS, /#mail-panel \.ma-btn \{[\s\S]*?background: #94DB39;/);
  // Et les deux teintes du mobile sont ramenées à la même gélule.
  assert.match(CSS, /#mail-panel \.ma-btn\.primaire,\s*\nbody\.bureau-frutiz \.fen #mail-panel \.ma-btn\.danger \{\s*\n\s*background: #FFAAAD; color: #660000;\s*\n\}/);
  // Le mobile, lui, garde ses trois couleurs.
  assert.match(LIGHT, /\.ma-btn\.danger \{ color: #fff; background: linear-gradient\(180deg, #E8756B, #C94437\); \}/);
});

test('l’ordre de la barre est celui du XML : corbeille, élastique, répondre + 8, transférer', () => {
  assert.match(CSS, /#mail-supprimer \{ order: 1; \}/);
  assert.match(CSS, /#mail-repondre \{ order: 2; margin-left: auto; \}/);
  assert.match(CSS, /#mail-transferer \{ order: 3; margin-left: 0; \}/);
  // `<s w="8"/>` : les deux derniers ne sont séparés que de huit pixels, ce que
  // le `gap` de la barre donne déjà.
  assert.match(CSS, /#mail-panel \.mail-actions \{[\s\S]*?gap: 8px;/);
});

/* ── 2. LES MOTS ──────────────────────────────────────────────────────────── */

test('les libellés sont ceux de lang_french.as, au mot près', () => {
  assert.match(LANG, /langText\.mail\.move_to_recyclebin = "Supprimer";/);
  assert.match(LANG, /langText\.mail\.forward = "Transf.rer";/);
  assert.match(LANG, /langText\.mail\.reply = "R.pondre";/);
  assert.match(LANG, /langText\.mail\.write_new_mail = "Composer un nouveau message";/);
  assert.match(JS, /if \(pou\) pou\.textContent = 'Supprimer';/);
  assert.match(JS, /tr\.textContent = 'Transférer';/);
  assert.doesNotMatch(JS, /Mettre à la corbeille'/);
  // Les chevrons du gabarit tactile tombent.
  assert.match(JS, /if \(ret\) ret\.textContent = 'Retour';/);
  assert.match(JS, /if \(ann\) ann\.textContent = 'Annuler';/);
  assert.match(LIGHT, /id="mail-retour">‹ Retour<\/button>/, 'le mobile garde son chevron');
});

test('les étiquettes portent leurs deux-points, et le A n’a pas d’accent', () => {
  // `mail.date` = « Date : », `mail.from` = « De : », `mail.to` = « A : »,
  // `mail.subject` = « Sujet : ».
  assert.match(LANG, /langText\.mail\.to = "A :";/);
  assert.match(JS, /\[\['date', 'Date :'\], \['from', 'De :'\], \['to', 'A :'\], \['subject', 'Sujet :'\]\]/);
  assert.match(JS, /<span class="mx-lab">De :<\/span>/);
  assert.match(JS, /if \(lblA\) lblA\.textContent = 'A :';/);
  assert.match(JS, /if \(lblS\) lblS\.textContent = 'Sujet :';/);
  // Le mobile garde les siens dans son gabarit.
  assert.match(LIGHT, /<label for="mail-a">À<\/label>/);
});

/* ── 3. LA CITATION ───────────────────────────────────────────────────────── */

test('répondre et transférer citent le message, au gabarit d’époque', () => {
  assert.match(LANG, /mail\.reply_tpl = '<br><br><b>--- En r.ponse au message ---<\/b>/);
  assert.match(LANG, /mail\.forward_tpl = '<br><br><b>--- Message transf.r. ---<\/b>/);
  const bloc = JS.slice(JS.indexOf('function citerMail'), JS.indexOf('function habillerMail'));
  assert.match(bloc, /var entete = quoi === 'reply' \? '--- En réponse au message ---' : '--- Message transféré ---';/);
  assert.match(bloc, /'Date : ' \+ \(m\.date \|\| ''\) \+ '\\n'/);
  assert.match(bloc, /'A : ' \+ \(m\.to \|\| ''\) \+ '\\n'/);
  // `box.ViewMail.forward` (0xaecd9) : « Tr: » collé, et pas de doublon si le
  // sujet en porte déjà un (le SWF teste « tr: » ET « tr : »).
  assert.match(bloc, /var prefixe = quoi === 'reply' \? 'Re: ' : 'Tr: ';/);
  assert.match(bloc, /var deja = quoi === 'reply' \? \/\^re\\s\*:\/i : \/\^tr\\s\*:\/i;/);
  // Transférer laisse le destinataire à choisir ; répondre vise l'expéditeur.
  assert.match(bloc, /M\.ecrire\(quoi === 'reply' \? \(m\.from \|\| ''\) : '',/);
});

test('ecrireMail accepte un corps, et le mobile n’en passe pas', () => {
  assert.match(LIGHT, /function ecrireMail\(dest, sujet, corps\) \{/);
  assert.match(LIGHT, /\$\("#mail-texte"\)\.value = corps \|\| "";/);
  // Les appels du light restent à deux arguments : rien ne change pour lui.
  assert.match(LIGHT, /ecrireMail\(mailLu\.from \|\| "", \/\^re\\s\*:\/i\.test\(s\) \? s : \("Re : " \+ \(s \|\| "\(sans sujet\)"\)\)\);/);
});

/* ── 4. LE BANDEAU SUIT LA VUE ────────────────────────────────────────────── */

test('trois fenêtres d’époque, trois titres', () => {
  assert.match(JS, /retitrer\('mail-panel', val\.subject\);/);
  assert.match(JS, /if \(vue === 'ecriture'\) retitrer\('mail-panel', 'Composer un nouveau message'\);/);
  assert.match(JS, /else if \(vue === 'liste'\) retitrer\('mail-panel', MAIL_DOSSIERS\[mailDossierVu\] \|\| 'Courrier'\);/);
  assert.match(JS, /retitrerMail: retitrerMail,/);
  // Le light prévient à chaque changement de vue, et seulement lui.
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.retitrerMail\) BureauFrutiz\.retitrerMail\(nom\);/);
});
