'use strict';
/*
 * MINIPIXIZ EN DEUX LANGUES — LE FRANÇAIS NE BOUGE PAS, ET L'ANGLAIS NE JOUE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Les missions de Gromelin, les répliques de la fée, les nuits s'ASSEMBLENT
 * au hasard. La version anglaise y passe sans toucher au jeu :
 *
 *   · LE FRANÇAIS, AU CARACTÈRE PRÈS. L'EMPREINTE ci-dessous est un SHA-256 de
 *     tout ce que les assembleurs écrivent en français — les dix mille graines
 *     de mission, chaque objet, chaque sort, et des centaines de graines de
 *     fées, de saluts, de nuits —, calculée sur le code d'AVANT la version
 *     anglaise (le commit 1c32fa2b). Le code d'aujourd'hui doit la redonner :
 *     sans FPI18n (le serveur, Node), et avec FPI18n en français (la page).
 *   · LE HASARD NE PARLE PAS. Les mêmes nuits, jouées en anglais, laissent la
 *     MÊME fiche et consomment le même hasard qu'en français ; une mission
 *     anglaise garde tout ce qui n'est pas du texte.
 *   · LES TABLES ANGLAISES ONT LA FORME DES FRANÇAISES (on tire le rang dans
 *     le français, on lit la case anglaise de même rang) : mêmes longueurs,
 *     mêmes silences, mêmes jetons. Et chaque clé du code a son anglais.
 *
 * Un « navigateur de poche » (vm) charge i18n.js, le dictionnaire et les
 * modules du jeu comme la page le fait.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MODULES = ['engine', 'items', 'faerie', 'combat', 'nuit', 'bassin', 'langue', 'missions', 'lieux',
  'sorts', 'plateforme', 'inventaire', 'menu'];

// L'empreinte du français d'avant la version anglaise (voir l'en-tête).
const EMPREINTE = '7c92412b2cd04ffad751ec9002f1f575c0e67c80dbe3144b46a41d304197d18e';

function navigateur(langue) {
  const ctx = { console, URLSearchParams, Intl, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.document = { readyState: 'complete', documentElement: {}, createElement: () => ({ getContext: () => ({}) }) };
  ctx.location = { search: '?lang=' + langue, hostname: 'localhost' };
  ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  ctx.navigator = { userAgent: '', languages: [langue] };
  vm.createContext(ctx);
  const executer = (f) => vm.runInContext(lire(f), ctx, { filename: f });
  executer('public/js/i18n.js');
  assert.equal(ctx.FPI18n.langue, langue);
  if (langue === 'en') executer('public/minipixiz/lang/en.js');
  for (const m of MODULES) executer('public/minipixiz/' + m + '.js');
  return {
    I18N: ctx.FPI18n, L: ctx.MinipixizLangue, O: ctx.MinipixizObjets, F: ctx.MinipixizFee, S: ctx.MinipixizSorts,
    M: ctx.MinipixizMissions, N: ctx.MinipixizNuit, P: ctx.MinipixizPlateforme,
  };
}
function sousNode() {
  const m = (f) => require(path.join(ROOT, 'public/minipixiz', f + '.js'));
  return { L: m('langue'), O: m('items'), F: m('faerie'), S: m('sorts'), M: m('missions'), N: m('nuit'), P: m('plateforme') };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function compteur(g) {
  const r = mulberry32(g);
  const f = () => { f.n++; return r(); };
  f.n = 0;
  return f;
}

// Une fiche d'habitué, peuplée au hasard : des fées à travers, des missions
// en cours (leurs vraies phrases de fin), un sac à moitié plein.
function fiche(X, g) {
  const r = mulberry32(g);
  const c = X.P.carteNeuve(1e12);
  c.$stat.$run = Math.floor(r() * 60000);
  c.$bag = Math.floor(r() * 3);
  const nb = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nb; i++) {
    const fs0 = X.F.genererGraine(mulberry32(g * 7 + i));
    fs0.$level = Math.floor(r() * 30); fs0.$hunger = Math.floor(r() * 20);
    fs0.$moral = Math.floor(r() * 20); fs0.$life = Math.floor(r() * 4);
    for (let b = 0; b < 5; b++) if (r() < 0.35) fs0.$behaviour[b] = 1;
    fs0.$inv = [r() < 0.5 ? 300 + Math.floor(r() * 50) : null, r() < 0.5 ? Math.floor(r() * 30) : null];
    if (r() < 0.3) fs0.$pos = i;
    c.$faerie.push(fs0);
  }
  c.$current = r() < 0.5 ? 0 : null;
  X.N.genererMissions(c, mulberry32(g * 3));
  for (let k = 0; k < 2; k++) {
    const info = c.$mission[k];
    const d = X.M.decrire(info);
    const v = r() < 0.5;
    c.$mis.push({ $d: 1 + k, $gift: v ? info[3] : null, $type: info[1], $string: v ? d.reussite : d.echec });
    if (c.$faerie[k]) c.$faerie[k].$mission = k;
  }
  return c;
}

/*
 * Tout ce que les assembleurs écrivent, à la suite. Cette fonction doit
 * rester celle qui a calculé EMPREINTE : elle n'appelle que ce que le code
 * d'avant savait déjà faire.
 */
function empreinte(X) {
  const h = crypto.createHash('sha256');
  const ecrire = (v) => h.update(JSON.stringify(v === undefined ? null : v) + '\n');
  for (let g = 0; g < 10000; g++) {
    ecrire(X.M.decrire([g % 7, g % 8, [3, 5, 7, 10, 15, 30][g % 6], [0, 41, 72, 81, 150, 305][g % 6], g]));
  }
  for (let n = 0; n < 420; n++) ecrire(X.O.info(n));
  for (const k of Object.keys(X.S.CLASSES)) { const s = X.S.nouveauSort(Number(k), null); ecrire([s.nom(), s.description()]); }
  for (const k of Object.keys(X.S.CLASSES_IMPY)) { const s = new X.S.CLASSES_IMPY[k](null); ecrire([s.nom(), s.description()]); }
  for (let g = 0; g < 300; g++) {
    const fs0 = X.F.genererGraine(mulberry32(g));
    ecrire(fs0);
    for (let hu = 0; hu < 9; hu++) {
      fs0.$humor = hu;
      for (const t of [0, 30, 31, 41, 52, 63, 71, 81, 120, 230, 300, 303, 330, 356]) {
        ecrire(new X.F.Fee(fs0, mulberry32(g * 31 + hu * 7 + t), null).salutObjet(t));
      }
    }
    const f = new X.F.Fee(fs0, null, X.P.carteNeuve(1e12));
    ecrire([f.gouts(), f.goutsCourts()]);
    for (const p of [{ $life: 0 }, { $life: 0, $hunger: 12 }, { $moral: 0 }, { $mood: [1] }, { $mood: [0, 1] }]) {
      ecrire(new X.F.Fee(Object.assign(JSON.parse(JSON.stringify(fs0)), p), null, null).raisonDeRester());
    }
    for (const n of [0, 30, 31, 45, 52, 66, 70, 80, 100, 200, 500]) ecrire(X.L.getItemFamily(n, mulberry32(g + n)));
    const c = fiche(X, g);
    ecrire(X.N.passerLeTemps(c, 1e12 + 86400000 * (4 + (g % 9)), mulberry32(g)));
    for (const vu of [false, true]) ecrire(X.M.accueil(fiche(X, g + 7), 0.5, vu).dial);
  }
  return h.digest('hex');
}

test('le français des assembleurs est celui d\'avant, au caractère près — sans FPI18n et avec', () => {
  assert.equal(empreinte(sousNode()), EMPREINTE, 'sous Node (le serveur)');
  assert.equal(empreinte(navigateur('fr')), EMPREINTE, 'dans la page, en français');
});

test('en anglais, les nuits laissent la même fiche et consomment le même hasard', () => {
  const fr = sousNode(), en = navigateur('en');
  let missionsAnglaises = 0;
  for (let g = 0; g < 300; g++) {
    const ca = fiche(fr, g), cb = fiche(en, g);
    const ra = compteur(g), rb = compteur(g);
    const t = 1e12 + 86400000 * (4 + (g % 9));
    const xa = fr.N.passerLeTemps(ca, t, ra), xb = en.N.passerLeTemps(cb, t, rb);
    assert.deepEqual(JSON.parse(JSON.stringify(cb)), JSON.parse(JSON.stringify(ca)), 'la fiche après les nuits, graine ' + g);
    assert.equal(rb.n, ra.n, 'le hasard consommé, graine ' + g);
    assert.equal(xb.messages.length, xa.messages.length, 'autant de nouvelles, graine ' + g);
    for (const m of xb.messages) {
      assert.ok(!/\$\w/.test(m), 'aucun jeton oublié : ' + m);
      if (/^Congratulations!|hasn't|haven't/.test(m)) missionsAnglaises++;
      assert.ok(!/Félicitations|n'a |n'ont /.test(m), 'la mission se lit en anglais : ' + m);
    }
  }
  assert.ok(missionsAnglaises > 100, 'les phrases de fin rangées en français se refont en anglais (' + missionsAnglaises + ')');
  // La fée tire la même chose dans les deux langues.
  for (let g = 0; g < 200; g++) {
    const fa = fr.F.genererGraine(mulberry32(g)), fb = en.F.genererGraine(mulberry32(g));
    for (let hu = 0; hu < 9; hu++) {
      fa.$humor = fb.$humor = hu;
      for (const t of [41, 63, 120, 303, 330]) {
        const a = compteur(g + t), b = compteur(g + t);
        const sa = new fr.F.Fee(fa, a, null).salutObjet(t), sb = new en.F.Fee(fb, b, null).salutObjet(t);
        assert.equal(b.n, a.n, 'le salut tire autant');
        assert.equal(sb === null, sa === null, 'et se tait aux mêmes endroits');
      }
    }
  }
});

test('une mission anglaise raconte la même histoire, sans jeton ni article de trop', () => {
  const fr = sousNode(), en = navigateur('en');
  for (let g = 0; g < 10000; g++) {
    const info = [g % 7, g % 8, [3, 5, 7, 10, 15, 30][g % 6], [0, 41, 72, 81, 150, 305][g % 6], g];
    const a = fr.M.decrire(info), b = en.M.decrireDansLaLangue(info);
    for (const k of ['rang', 'difficulte', 'jours', 'cadeau', 'test']) assert.deepEqual(b[k], a[k], k);
    for (const k of ['titre', 'enonce', 'reussite', 'echec']) {
      assert.ok(!/\$\w/.test(b[k]), 'graine ' + g + ' : jeton oublié — ' + b[k]);
      assert.ok(!/\b(the|a|an) (the|a|an)\b/i.test(b[k]), 'graine ' + g + ' : deux articles — ' + b[k]);
      assert.ok(!/\ba ([aeiou])/i.test(b[k].replace(/\ba (one|uni|use)/gi, '')), 'graine ' + g + ' : « a » devant voyelle — ' + b[k]);
    }
  }
  // La sauvegarde garde le FRANÇAIS (le format du SWF, que le bureau relit) :
  // en anglais aussi, accepter range la phrase de `decrire`.
  const c = fiche(en, 5);
  c.$faerie[0].$mission = null; c.$faerie[0].$pos = 0;
  const info = c.$mission[0].slice();
  const r = en.M.accepter(c, 0, [c.$faerie[0]], mulberry32(1), true);
  assert.equal(r.mission.$string, fr.M.decrire(info).reussite);
  assert.notEqual(r.mission.$string, en.M.decrireDansLaLangue(info).reussite, 'et non la phrase anglaise');
});

test('les tables anglaises ont la forme des françaises, et chaque clé du code a son anglais', () => {
  const en = navigateur('en');
  const D = en.I18N._dicos.en;
  const ecarts = [];
  function comparer(nom, fr, t, chemin) {
    if (fr === null || fr === undefined) {
      if (t !== null && t !== undefined) ecarts.push(nom + chemin + ' : un silence français devient un texte');
      return;
    }
    if (Array.isArray(fr)) {
      if (!Array.isArray(t)) { ecarts.push(nom + chemin + ' : pas un tableau'); return; }
      if (t.length !== fr.length) ecarts.push(nom + chemin + ' : ' + t.length + ' cases au lieu de ' + fr.length);
      fr.forEach((v, i) => comparer(nom, v, t[i], chemin + '[' + i + ']'));
      return;
    }
    if (typeof fr === 'object') {
      // Les nombres (le `soin` d'une potion, le `test` d'une mission) sont des données, pas du texte.
      for (const k of Object.keys(fr)) {
        if (typeof fr[k] === 'number' || (Array.isArray(fr[k]) && fr[k].every((v) => typeof v === 'number'))) continue;
        comparer(nom, fr[k], t && t[k], chemin + '.' + k);
      }
      return;
    }
    if (typeof fr === 'number') return;
    if (typeof t !== 'string') { ecarts.push(nom + chemin + ' : manquant'); return; }
    for (const j of (fr.match(/\$\w+/g) || [])) {
      if (!t.includes(j) && !t.includes('$' + j.charAt(1).toUpperCase() + j.slice(2))) ecarts.push(nom + chemin + ' : jeton ' + j + ' perdu');
    }
  }
  // langue.js : tout, sauf ce qui n'est pas du texte (les rangs, les syllabes des noms).
  for (const k of Object.keys(en.L)) {
    if (typeof en.L[k] === 'function' || ['MISSION_DIF_RANK', 'nameSyl0', 'nameSyl1'].includes(k)) continue;
    const t = D['minipixiz.langue.' + k];
    if (t === undefined) ecarts.push('minipixiz.langue.' + k + ' : pas de traduction');
    else comparer(k, en.L[k], t, '');
  }
  const tables = {
    'minipixiz.objets.NOM_OBJET_CARAC': en.O.NOM_OBJET_CARAC, 'minipixiz.objets.NOM_CARAC': en.O.NOM_CARAC,
    'minipixiz.objets.POUVOIRS': en.O.POUVOIRS, 'minipixiz.objets.GLOBES': en.O.GLOBES,
    'minipixiz.objets.POTIONS': en.O.POTIONS, 'minipixiz.objets.SACS': en.O.SACS,
    'minipixiz.objets.ALIMENTS': en.O.ALIMENTS, 'minipixiz.objets.QUANTITE': en.O.QUANTITE,
    'minipixiz.objets.ALIMENT_QT2': en.O.ALIMENT_QT2,
    'minipixiz.fee.NOM_CARAC': en.F.NOM_CARAC, 'minipixiz.fee.RESUME_CARAC': en.F.RESUME_CARAC,
    'minipixiz.fee.NOM_COMPORTEMENT': en.F.NOM_COMPORTEMENT,
    'minipixiz.nuit.DONJONS': en.N.DONJONS, 'minipixiz.nuit.ADJECTIFS': en.N.ADJECTIFS,
    'minipixiz.nuit.ENVIES_DE_PARTIR': en.N.ENVIES_DE_PARTIR,
  };
  const Inv = require(path.join(ROOT, 'public/minipixiz/inventaire.js'));
  Object.assign(tables, {
    'minipixiz.inv.SECTION_BULLE': Inv.SECTION_BULLE, 'minipixiz.inv.LETTRES': Inv.LETTRES,
    'minipixiz.inv.FLASK_ACTION': Inv.FLASK_ACTION, 'minipixiz.inv.ORIGINE_SORT': Inv.ORIGINE_SORT,
  });
  for (const [cle, fr] of Object.entries(tables)) {
    if (D[cle] === undefined) ecarts.push(cle + ' : pas de traduction');
    else comparer(cle, fr, D[cle], '');
  }
  // Les clés écrites en toutes lettres dans le code et dans la page.
  const sources = ['game', 'inventaire', 'menu', 'sorts', 'items', 'faerie', 'nuit', 'missions', 'plateforme']
    .map((f) => lire('public/minipixiz/' + f + '.js')).concat(lire('public/minipixiz/index.html'));
  const cles = new Set();
  for (const s of sources) {
    for (const m of s.matchAll(/T(?:\.n)?\('(minipixiz\.[\w.]+)'/g)) cles.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-html)?="(minipixiz\.[\w.]+)"/g)) cles.add(m[1]);
    for (const m of s.matchAll(/data-i18n-attr="[^"]*:(minipixiz\.[\w.]+)"/g)) cles.add(m[1]);
  }
  assert.ok(cles.size > 200, cles.size + ' clés relevées');
  for (const c of cles) if (D[c] === undefined && !c.endsWith('.')) ecarts.push('clé sans anglais : ' + c);
  // Et toute entrée du dictionnaire est bien de la zone du jeu.
  for (const k of Object.keys(D)) if (k.startsWith('minipixiz') && !k.startsWith('minipixiz.')) ecarts.push('clé mal formée : ' + k);
  assert.deepEqual(ecarts, []);
});
