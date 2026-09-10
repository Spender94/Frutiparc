#!/usr/bin/env node
/*
 * LE MODE NUIT, FABRIQUÉ PLUTÔT QU'ÉCRIT.
 *
 * « Si on l'écoutait, Frutiparc serait un site aux couleurs totalement
 *   désaturées, avec des petits fruits zombies et des décors de crypte […].
 *   Mais son temps viendra… »
 *
 * Il y a près de mille huit cents couleurs en dur dans les trois feuilles du
 * site (le <style> de light.html, bureau-frutiz.css, le <style> du forum) et
 * pas une seule variable CSS. Les reprendre à la main, c'était réécrire le
 * site ; et surtout c'était devoir le refaire à chaque retouche du thème de
 * jour. On fabrique donc la feuille de nuit AU LIEU de l'écrire : chaque
 * couleur passe par une conversion, et le résultat est une feuille de
 * SURCHARGE, chargée par-dessus les originales quand le mode est allumé.
 *
 * Le thème de jour n'est jamais touché. Éteindre le mode nuit, c'est retirer
 * une feuille : il ne peut rien casser.
 *
 * LA CONVERSION tient en trois idées.
 *
 *  1. On garde la TEINTE. Le vert de Frutiparc reste vert, son jaune reste
 *     jaune : c'est ce qui fait qu'on reconnaît le parc dans le noir.
 *  2. On coupe la SATURATION — « totalement désaturées ». Un tiers, plafonné.
 *  3. On renverse la CLARTÉ, mais PAS de la même façon selon le rôle de la
 *     couleur, et c'est là tout le sel : une couleur de FOND descend, une
 *     couleur de TEXTE monte, une BORDURE se pose entre les deux. Une simple
 *     fonction couleur→couleur ne peut pas savoir ce qu'elle teint ; le nom
 *     de la propriété, lui, le sait. C'est ce qui évite le travers classique
 *     du thème sombre bricolé : du texte sombre sur un fond sombre.
 *
 * LE ROSE FAIT EXCEPTION. Toute la famille rose/rouge de Frutiparc — les
 * boutons, les en-têtes, le bandeau du forum — part au GRAPHITE : c'est elle
 * qui donne au mode nuit son air de crypte plutôt que d'« même site, en
 * sombre ». Le rouge des cris de modération, lui, n'est pas dans les feuilles
 * (le serveur l'écrit dans le message), donc il reste rouge : l'alerte garde
 * sa couleur d'alerte.
 *
 *   node scripts/generer-nuit.js            écrit les feuilles
 *   node scripts/generer-nuit.js --verifier n'écrit rien, sort 1 si périmé
 *
 * Le test test/modeNuit.test.js appelle la seconde forme : une retouche du
 * thème de jour sans régénération est une erreur de test, pas une surprise
 * en production.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const P = (...x) => path.join(RACINE, ...x);

// ── Couleurs ────────────────────────────────────────────────────────────────

function hexVersRgb(t) {
  let v = t.slice(1);
  if (v.length === 3 || v.length === 4) v = v.split('').map((c) => c + c).join('');
  const a = v.length === 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

function rgbVersHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let s = 0, h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

const arrondi = (x, n) => Number(x.toFixed(n));

function hsl(h, s, l, a) {
  const t = `hsl(${arrondi(h, 0)} ${arrondi(s, 0)}% ${arrondi(l, 1)}%`;
  return a >= 1 ? `${t})` : `${t} / ${arrondi(a, 3)})`;
}

// Les trois rôles d'une couleur, et la courbe de clarté de chacun.
// L'exposant creuse : les grands aplats clairs tombent vite, les valeurs
// sombres — celles du texte d'origine — remontent doucement.
const COURBES = {
  // LES FONDS. Le thème de jour range presque tous ses aplats entre 65 % et
  // 100 % de clarté et se sert d'écarts de deux ou trois points pour séparer
  // une carte de la page. Une courbe creusée écraserait ces écarts-là ; on
  // étale donc le haut de l'échelle sur toute la plage utile de la nuit
  // (4 % → 22 %), et l'on plafonne. Un fond DÉJÀ sombre, lui, ne se renverse
  // pas : un voile noir doit rester noir, pas devenir un voile gris clair.
  fond: (l) => (l <= 20 ? l * 0.85 : Math.min(4 + 62 * (100 - l) / 100, 22)),
  // Les bordures se posent entre les deux, et toujours visibles.
  bordure: (l) => 20 + 30 * (100 - l) / 100,                  // 20 % → 50 %
  // Le texte ne se renverse pas : il MONTE, toujours, en gardant sa hiérarchie
  // d'origine (ce qui était le plus clair reste le plus clair).
  texte: (l) => 62 + 28 * (l / 100),                          // 90 % → 62 %
  // Une ombre sombre reste une ombre : on la décolore sans toucher à sa
  // clarté. Une ombre CLAIRE, elle — les liserés et les reliefs d'époque —,
  // deviendrait un halo lumineux : on la traite comme un fond.
  ombre: (l) => (l <= 40 ? l : COURBES.fond(l)),
};

// La famille rose/rouge du parc : ses teintes relevées dans les trois feuilles
// vont de 335° à 16°. L'orange (#FF6600, 24°) et le jaune en sont dehors —
// ils restent des accents.
const ROSE_DE = 335, ROSE_A = 16;
const estRose = (h, s) => s > 12 && (h >= ROSE_DE || h <= ROSE_A);

// Un fond rose descend PLUS BAS que les autres : le plafond commun (22 %)
// donnait un charbon, on veut un noir. C'est là que se joue la différence
// entre « le même site, en sombre » et une crypte.
const ROSE_FOND_MAX = 13;

function convertir(r, g, b, a, role) {
  let [h, s, l] = rgbVersHsl(r, g, b);
  let ns = Math.min(s * 0.30, 24);
  let nl = COURBES[role](l);
  if (estRose(h, s)) {
    h = 15;        // un souffle de chaud, pour que le noir ne soit pas numérique
    ns = 5;        // « passer les boutons roses en noir »
    if (role === 'fond') nl = Math.min(nl, ROSE_FOND_MAX);
  }
  // Un gris d'origine reste un gris : inutile de lui inventer une teinte.
  if (s < 4) ns = 0;
  return hsl(h, ns, Math.max(0, Math.min(100, nl)), a);
}

const RE_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RE_RGB = /\brgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.%]+)\s*)?\)/g;

function teindreValeur(valeur, role) {
  return valeur
    .replace(RE_HEX, (m) => {
      const [r, g, b, a] = hexVersRgb(m);
      return convertir(r, g, b, a, role);
    })
    .replace(RE_RGB, (m, r, g, b, a) => {
      let alpha = a === undefined ? 1 : (String(a).endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));
      return convertir(+r, +g, +b, alpha, role);
    });
}

const aUneCouleur = (v) => { RE_HEX.lastIndex = 0; RE_RGB.lastIndex = 0; return RE_HEX.test(v) || RE_RGB.test(v); };

// Le rôle d'une déclaration, d'après son nom de propriété.
function roleDe(propriete) {
  const p = propriete.trim().toLowerCase();
  if (/shadow$/.test(p) || p === 'filter' || p === 'backdrop-filter') return 'ombre';
  if (/^background/.test(p) || p === 'fill' || p === 'accent-color') return 'fond';
  if (p === 'color' || p === '-webkit-text-fill-color' || p === 'caret-color'
      || p === '-webkit-tap-highlight-color') return 'texte';
  if (/^(border|outline|column-rule|text-decoration|stroke|scrollbar)/.test(p)) return 'bordure';
  // Une variable CSS n'a pas de rôle lisible dans son nom : on la traite en
  // bordure, la courbe du milieu, la moins risquée des trois.
  return 'bordure';
}

// ── Un découpeur de CSS, juste assez fin pour nos trois feuilles ─────────────
// On ne cherche pas à analyser le CSS du monde : seulement le nôtre. Il suffit
// de savoir traverser commentaires, chaînes et parenthèses sans se faire
// piéger par une accolade ou un point-virgule qui s'y cache (`url(a;b)`).

function decouper(css) {
  let i = 0;
  const n = css.length;

  function sauterInsignifiant() {
    for (;;) {
      if (css.startsWith('/*', i)) {
        const f = css.indexOf('*/', i + 2);
        i = f < 0 ? n : f + 2;
      } else if (/\s/.test(css[i])) i++;
      else return;
    }
  }

  // Avance jusqu'au premier caractère de `stops` rencontré au niveau zéro.
  function jusqua(stops) {
    const debut = i;
    let paren = 0;
    while (i < n) {
      const c = css[i];
      if (css.startsWith('/*', i)) { const f = css.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < n && css[i] !== q) i += css[i] === '\\' ? 2 : 1;
        i++; continue;
      }
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (paren === 0 && stops.includes(c)) break;
      i++;
    }
    return css.slice(debut, i);
  }

  function corps() {
    // On entre juste après '{' ; on sort juste après le '}' correspondant.
    const noeuds = [];
    for (;;) {
      sauterInsignifiant();
      if (i >= n) return noeuds;
      if (css[i] === '}') { i++; return noeuds; }
      const tete = jusqua('{};').trim();
      if (i >= n) return noeuds;
      const c = css[i];
      if (c === '{') {
        i++;
        noeuds.push({ type: 'bloc', tete, enfants: corps() });
      } else {
        i++;                                        // ';' ou '}'
        if (tete) noeuds.push({ type: 'decl', texte: tete });
        if (c === '}') return noeuds;
      }
    }
  }

  const racine = [];
  for (;;) {
    sauterInsignifiant();
    if (i >= n) return racine;
    const tete = jusqua('{};').trim();
    if (i >= n) { if (tete) racine.push({ type: 'decl', texte: tete }); return racine; }
    if (css[i] === '{') { i++; racine.push({ type: 'bloc', tete, enfants: corps() }); }
    else { i++; if (tete) racine.push({ type: 'decl', texte: tete }); }
  }
}

// ── La feuille de surcharge ─────────────────────────────────────────────────

const inconnues = new Set();

function teindreDecl(texte, { tout }) {
  const coupe = texte.indexOf(':');
  if (coupe < 0) return null;
  const prop = texte.slice(0, coupe);
  const valeur = texte.slice(coupe + 1);
  if (!aUneCouleur(valeur)) return tout ? `${prop.trim()}:${valeur}` : null;
  // Un nom de couleur en valeur nous échapperait : il n'y en a aucun dans les
  // trois feuilles, mais si l'on en ajoutait un jour, autant le savoir.
  const nom = /(?:^|[\s,(])(white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|gold|silver|brown|coral|crimson|tomato|salmon|ivory|beige|olive|navy|teal|lime|aqua|fuchsia|maroon)(?=[\s,)!;]|$)/i.exec(valeur);
  if (nom) inconnues.add(prop.trim() + ': ' + nom[1]);
  return `${prop.trim()}:${teindreValeur(valeur, roleDe(prop))}`;
}

// Une règle @keyframes se REMPLACE en entier : une copie partielle effacerait
// les propriétés non colorées de l'animation d'origine. On la recopie donc
// complète, teinte comprise.
const estKeyframes = (tete) => /^@(-\w+-)?keyframes\b/i.test(tete);
// @font-face ne porte aucune couleur, et @import/@charset n'ont rien à faire
// dans une surcharge.
const aIgnorer = (tete) => /^@(font-face|import|charset|namespace)\b/i.test(tete);

// LES SPRITES D'ÉPOQUE POSÉS EN FOND. Les boutons de fenêtre, les onglets,
// le lecteur Frusion, le frutimandala : quatre-vingt-neuf règles habillent un
// élément d'un dessin par `background-image: url(…)`. Ce ne sont pas des
// <img> — la règle qui fane les images ne les atteint donc pas, et ils
// resteraient éclatants au milieu d'un bureau éteint. On leur ajoute le
// fanage ici, à la source : une règle de plus dans le générateur les prend
// tous, aujourd'hui comme le jour où l'on en ajoutera un.
const RE_FOND_IMAGE = /^\s*background[a-z-]*\s*:[\s\S]*url\(/i;
const RE_FILTRE = /^\s*filter\s*:/i;
function porteUnSprite(enfants) {
  let image = false;
  for (const nd of enfants) {
    if (nd.type !== 'decl') continue;
    if (RE_FILTRE.test(nd.texte)) return false;   // la règle gère déjà son filtre
    if (RE_FOND_IMAGE.test(nd.texte)) image = true;
  }
  return image;
}

function rendre(noeuds, indent, tout) {
  const out = [];
  for (const nd of noeuds) {
    if (nd.type === 'decl') {
      const d = teindreDecl(nd.texte, { tout });
      if (d) out.push(indent + d + ';');
      continue;
    }
    if (aIgnorer(nd.tete)) continue;
    const k = estKeyframes(nd.tete);
    const dedans = rendre(nd.enfants, indent + '  ', tout || k);
    const sprite = !k && !tout && !nd.tete.startsWith('@') && porteUnSprite(nd.enfants);
    if (sprite) dedans.push(indent + '  filter: var(--nuit-fane);');
    if (!dedans.length) continue;
    out.push(indent + nd.tete + ' {', ...dedans, indent + '}');
  }
  return out;
}

function surcharge(css) {
  return rendre(decouper(css), '', false).join('\n');
}

// ── Les sources ─────────────────────────────────────────────────────────────

function styleDe(fichier) {
  const html = fs.readFileSync(fichier, 'utf8');
  const morceaux = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) morceaux.push(m[1]);
  if (!morceaux.length) throw new Error('aucun <style> dans ' + fichier);
  return morceaux.join('\n');
}

const ENTETE = (sources) => `/* ENGENDRÉ — NE PAS MODIFIER À LA MAIN.
 *
 * La feuille du mode nuit. Produite par scripts/generer-nuit.js à partir de :
${sources.map((s) => ' *   · ' + s).join('\n')}
 *
 * Toute retouche du thème de jour demande de relancer :
 *   node scripts/generer-nuit.js
 * (test/modeNuit.test.js échoue si l'on oublie.)
 *
 * Les corrections à la main, elles, vivent dans scripts/nuit-retouches*.css
 * et sont recopiées à la fin de ce fichier — donc elles gagnent.
 */
`;

const CIBLES = [
  {
    sortie: 'public/nuit.css',
    sources: ['public/light.html (son <style>)', 'public/bureau-frutiz.css'],
    lire: () => [styleDe(P('public/light.html')), fs.readFileSync(P('public/bureau-frutiz.css'), 'utf8')],
    retouches: 'scripts/nuit-retouches.css',
  },
  {
    sortie: 'public/fb/nuit.css',
    sources: ['public/fb/index.html (son <style>)'],
    lire: () => [styleDe(P('public/fb/index.html'))],
    retouches: 'scripts/nuit-retouches-forum.css',
  },
];

function fabriquer(cible) {
  const corps = cible.lire().map(surcharge).join('\n\n');
  const main = fs.existsSync(P(cible.retouches)) ? fs.readFileSync(P(cible.retouches), 'utf8') : '';
  return ENTETE(cible.sources) + '\n' + corps + '\n\n'
    + '/* ── À la main, à partir d\'ici ────────────────────────────────────── */\n'
    + main.replace(/\s*$/, '') + '\n';
}

function main() {
  const verifier = process.argv.includes('--verifier');
  let perime = 0;
  for (const cible of CIBLES) {
    const texte = fabriquer(cible);
    const chemin = P(cible.sortie);
    const ancien = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
    if (verifier) {
      if (ancien !== texte) { console.error('PÉRIMÉ : ' + cible.sortie); perime++; }
      continue;
    }
    fs.writeFileSync(chemin, texte);
    const lignes = texte.split('\n').length;
    console.log(cible.sortie.padEnd(20) + String(lignes).padStart(6) + ' lignes, '
      + (Buffer.byteLength(texte) / 1024).toFixed(1) + ' Ko'
      + (ancien === texte ? '  (inchangé)' : ''));
  }
  if (inconnues.size) {
    console.log('\nCouleurs NOMMÉES rencontrées (non converties) :');
    for (const x of inconnues) console.log('  ' + x);
  }
  if (verifier) {
    if (perime) {
      console.error('\nRelancer : node scripts/generer-nuit.js');
      process.exit(1);
    }
    console.log('Les feuilles de nuit sont à jour.');
  }
}

if (require.main === module) main();

module.exports = { convertir, teindreValeur, roleDe, surcharge, fabriquer, CIBLES, estRose, rgbVersHsl, hexVersRgb };
