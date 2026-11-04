'use strict';
/*
 * LE FORUM SUR TÉLÉPHONE : LE FIL D'ARIANE ENTIER, ET LE RETOUR PAR NIVEAU
 * ════════════════════════════════════════════════════════════════════════
 *
 * « Sur mobile, la navigation forum est pénible : on ne peut pas cliquer en
 *   haut pour retourner sur le forum principal (seulement sur le
 *   sous-forum) ; le bouton "page précédente" nous ramène à travers tous les
 *   clics qu'on a faits au lieu de reculer sur le sous-forum, puis sur le
 *   forum principal. »
 *
 * Deux réponses, toutes deux dans public/fb/index.html :
 *   1. la racine « Forum Frutiparc » ne s'efface plus à l'étroit : le fil est
 *      une rangée de boîtes sur une ligne, la racine ne rétrécit jamais, le
 *      sous-forum et le sujet finissent en points de suspension ;
 *   2. l'historique est une PILE DE NIVEAUX (accueil › forum › sujet) : la
 *      pagination remplace l'entrée, descendre empile, remonter (fil
 *      d'Ariane, « Annuler ») recule au lieu d'empiler un doublon.
 *
 * Le second point se vérifie ici POUR DE VRAI : on extrait le code de
 * l'historique de la page et on le fait tourner contre un faux `history`
 * qui se comporte comme celui du navigateur (go/back asynchrones, popstate).
 * Le premier se lit dans la feuille de style ; la vérification à l'œil s'est
 * faite sous Playwright, en émulation Pixel 5 et à 320 px.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FORUM = fs.readFileSync(path.join(__dirname, '..', 'public/fb/index.html'), 'utf8');

// ── Un navigateur de poche : la pile de session, et rien d'autre ──────────
function navigateur() {
  const entrees = [{ state: null }];   // l'entrée de chargement de la page
  let i = 0;
  const ecouteurs = [];
  const affichages = [];
  const history = {
    get state() { return entrees[i].state; },
    get length() { return entrees.length; },
    pushState(s) { entrees.splice(i + 1); entrees.push({ state: structuredClone(s) }); i++; },
    replaceState(s) { entrees[i] = { state: structuredClone(s) }; },
    // Comme le vrai : le déplacement se fait plus tard, puis `popstate`.
    go(n) {
      setTimeout(() => {
        const j = i + n;
        if (j < 0 || j >= entrees.length) return;
        i = j;
        ecouteurs.forEach((f) => f({ state: entrees[i].state }));
      }, 0);
    },
    back() { this.go(-1); },
  };
  const ctx = {
    history,
    location: { href: 'http://x/fb/?sid=abc' },
    window: { addEventListener: (type, f) => { if (type === 'popstate') ecouteurs.push(f); } },
    setTimeout,
    currentTopicData: null,
    ouvrirRecherche() {},
    loadIndex() { affichages.push('index'); },
    console,
  };
  vm.createContext(ctx);
  const debut = FORUM.indexOf('var NIVEAU_VUE');
  const fin = FORUM.indexOf('function pagination(');
  assert.ok(debut > 0 && fin > debut, 'le code de l\'historique est à sa place');
  vm.runInContext(FORUM.slice(debut, fin), ctx);
  // L'affichage réel charge des pages par le réseau : on le remplace par un
  // simple relevé de ce qui s'afficherait.
  vm.runInContext('afficherVue = function (view, id, extra) { __aff(view + (id != null ? ":" + id : "") + (extra != null && typeof extra !== "object" ? "@" + extra : "")); };', Object.assign(ctx, { __aff: (v) => affichages.push(v) }));
  const pause = () => new Promise((r) => setTimeout(r, 5));
  return {
    ctx, entrees, affichages,
    get index() { return i; },
    async nav(view, id, extra) { ctx.navigate(view, id, extra); await pause(); await pause(); },
    async retour() { history.back(); await pause(); await pause(); },
    chemin() { const s = history.state; return s ? s.fbChemin.map((v) => v.view + (v.id != null ? ':' + v.id : '')) : []; },
    vue() { return affichages[affichages.length - 1]; },
  };
}

test('le Retour recule par niveau : sujet → sous-forum → accueil, pas clic par clic', async () => {
  const b = navigateur();
  await b.nav('index');
  assert.strictEqual(b.entrees.length, 1, 'l\'accueil prend l\'entrée de chargement, sans empiler');
  await b.nav('board', 7);
  await b.nav('board', 7, 2);                // page 2 de la liste : on remplace
  await b.nav('topic', 42);
  for (const p of [1, 2, 3, 2, 4]) await b.nav('topic', 42, p);   // on feuillette
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'topic:42']);
  assert.strictEqual(b.entrees.length, 3, 'trois niveaux, trois entrées — pas une par page lue');
  assert.strictEqual(b.vue(), 'topic:42@4');

  await b.retour();
  assert.strictEqual(b.vue(), 'board:7@2', 'Retour : le sous-forum, à la page où on l\'avait laissé');
  await b.retour();
  assert.strictEqual(b.vue(), 'index', 'Retour : l\'accueil du forum');
});

test('remonter par le fil d\'Ariane recule dans la pile au lieu d\'empiler', async () => {
  const b = navigateur();
  await b.nav('index');
  await b.nav('board', 7);
  await b.nav('topic', 42);
  await b.nav('board', 7);                   // clic sur « Frutiz » dans le fil
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7']);
  assert.strictEqual(b.index, 1, 'on est revenu sur l\'entrée du sous-forum');
  assert.strictEqual(b.vue(), 'board:7');
  await b.nav('topic', 43);                  // un autre sujet : on redescend
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'topic:43']);
  assert.strictEqual(b.entrees.length, 3, 'le sujet précédent a été remplacé, pas gardé derrière');
  await b.nav('index');                      // clic sur « Forum Frutiparc »
  assert.strictEqual(b.index, 0);
  assert.strictEqual(b.vue(), 'index');
  assert.deepStrictEqual(b.chemin(), ['index']);
});

test('un autre forum, « Mes Pictos », un nouveau sujet : on repart du parent commun', async () => {
  const b = navigateur();
  await b.nav('index');
  await b.nav('board', 7);
  await b.nav('topic', 42);
  await b.nav('pictos');                     // depuis un sujet
  assert.deepStrictEqual(b.chemin(), ['index', 'pictos']);
  await b.retour();
  assert.strictEqual(b.vue(), 'index', 'Retour depuis les pictos : l\'accueil');

  await b.nav('board', 7);
  await b.nav('newTopic', 7);
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'newTopic:7']);
  await b.nav('topic', 99);                  // le sujet tout juste créé
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'topic:99'],
    'le formulaire cède sa place au sujet : Retour ne rouvre pas un formulaire vide');
  await b.retour();
  assert.strictEqual(b.vue(), 'board:7');
});

test('la recherche s\'intercale : ses résultats, puis la vue d\'où on l\'a lancée', async () => {
  const b = navigateur();
  await b.nav('index');
  await b.nav('board', 7);
  await b.nav('search', null, { q: 'grenouille', page: 1 });
  await b.nav('search', null, { q: 'grenouille', page: 2 });   // page 2 des résultats : remplacée
  await b.nav('topic', 42, { page: 2, post: 17 });
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'search', 'topic:42']);
  await b.retour();
  assert.strictEqual(b.vue(), 'search');
  await b.retour();
  assert.strictEqual(b.vue(), 'board:7');
});

test('un sujet ouvert par un lien direct reçoit son forum et l\'accueil derrière lui', async () => {
  const b = navigateur();
  await b.nav('topic', 42);                  // ?sujet=42 (une notification)
  b.ctx.retoucherHistoire('topic', 42, 3);   // le sujet chargé : page 3…
  b.ctx.ancrerSujet(42, 7, 3);               // …dans le forum 7
  assert.deepStrictEqual(b.chemin(), ['index', 'board:7', 'topic:42']);
  assert.strictEqual(b.ctx.history.state.fbVue.extra, 3, 'à la page réellement ouverte');
  await b.retour();
  assert.strictEqual(b.vue(), 'board:7', 'Retour : le forum du sujet, pas la sortie');
  await b.retour();
  assert.strictEqual(b.vue(), 'index');
  // Et le bouton « ‹ » de l'en-tête fait le même geste.
  await b.nav('board', 7);
  b.ctx.reculerForum();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(b.vue(), 'index');
});

test('l\'en-tête mobile garde « Forum Frutiparc » cliquable à toute profondeur', () => {
  const mobile = FORUM.slice(FORUM.indexOf('@media (max-width: 640px)'));
  const bloc = mobile.slice(0, mobile.indexOf('\n  }\n'));
  // La racine ne disparaît plus…
  assert.doesNotMatch(bloc, /\.bc-root \{ display: none; \}/);
  // …le fil est une rangée sur une ligne, où rien ne rétrécit par défaut…
  assert.match(bloc, /\.forum-header \.title-link \{[^}]*display: flex;[^}]*white-space: nowrap;[^}]*overflow: hidden;/);
  assert.match(bloc, /\.forum-header \.title-link > \* \{ flex: none; \}/);
  // …sauf le sous-forum (borné) et le sujet, en points de suspension.
  assert.match(bloc, /\.bc-niveau,\s*\n\s*\.forum-header \.title-link \.bc-current \{[^}]*text-overflow: ellipsis;/);
  assert.match(bloc, /\.bc-niveau \{ flex: 0 0 auto; max-width: 38%; \}/);
  // Le lien de la racine, et le titre entier en infobulle des niveaux.
  const fil = FORUM.slice(FORUM.indexOf('function setBreadcrumb'), FORUM.indexOf('var NIVEAU_VUE'));
  assert.match(fil, /<span class="bc-root"><a href="#" onclick="navigate\(\\'index\\'\);return false"[^>]*>Forum Frutiparc<span class="bc-com">\.com<\/span><\/a>/);
  assert.match(fil, /class="bc-niveau" title="' \+ t \+ '"/);
  assert.match(fil, /class="bc-current" title="' \+ t \+ '"/);
  // Le bureau garde son en-tête : tout cela vit dans le bloc mobile.
  const horsMobile = FORUM.slice(0, FORUM.indexOf('@media (max-width: 640px)'));
  assert.doesNotMatch(horsMobile, /\.bc-com \{ display: none; \}/);
});
