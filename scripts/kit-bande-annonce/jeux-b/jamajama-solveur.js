#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — le SOLVEUR de JamaJama.
 *
 *   node scripts/kit-bande-annonce/jeux-b/jamajama-solveur.js [motif du titre]
 *
 * Cherche, pour les niveaux de Games/poulpi/levels.xml, la solution la plus
 * courte (parcours en largeur) avec le moteur de règles du site lui-même
 * (public/jamajama/regles.js, celui qui sert aussi à l'anti-triche serveur).
 * Chaque solution trouvée est vérifiée par `rejouer` — le verdict même que
 * le serveur rend à un score. Le harnais de capture (jamajama.js) rejoue
 * ensuite ces coups au clavier, dans la vraie page.
 *
 * L'état d'une position = les sprites vivants et leurs champs simples (place,
 * paramètre, orientation, minuteries…) + le mode fantôme. Deux positions de
 * même clé sont réputées identiques : au pire on rate une solution, jamais
 * on n'en invente une (la vérification finale en décide).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../../../public/jamajama/regles.js');

const RACINE = path.resolve(__dirname, '..', '..', '..');

/** Les niveaux du fichier : { section, pack, index, titre, contenu }. */
function niveaux() {
  const xml = fs.readFileSync(path.join(RACINE, 'Games/poulpi/levels.xml'), 'utf8');
  const sortie = [];
  const aventure = /<adventure>([\s\S]*?)<\/adventure>/.exec(xml)[1];
  let pack = -1;
  for (const m of aventure.matchAll(/<pack[^>]*>|<l t="([^"]*)">([^<]*)<\/l>/g)) {
    if (m[0].startsWith('<pack')) { pack++; continue; }
    const idx = sortie.filter((n) => n.section === 'aventure' && n.pack === pack).length;
    sortie.push({ section: 'aventure', pack, index: idx, titre: m[1].replace(/\\n/g, ' '), contenu: m[2].trim() });
  }
  const tournoi = (/<tournament>([\s\S]*?)<\/tournament>/.exec(xml) || [, ''])[1];
  let i = 0;
  for (const m of tournoi.matchAll(/<l t="([^"]*)"[^>]*>([^<]*)<\/l>/g)) {
    sortie.push({ section: 'tournoi', pack: -1, index: i++, titre: m[1].replace(/\\n/g, ' ').replace(/&apos;/g, '\''), contenu: m[2].trim() });
  }
  return sortie.filter((n) => n.contenu);
}

function cle(partie) {
  const morceaux = [partie._inGhostMode ? 'G' : 'H'];
  for (const s of partie._sprites) {
    if (!s.alive) continue;
    let k = s.id + '@' + s.pos.x + ',' + s.pos.y + ':' + s.param + ':' + s.orientation;
    for (const n of Object.keys(s)) {
      const v = s[n];
      if (n === 'uid' || n === 'id' || n === 'param' || n === 'orientation') continue;
      if (typeof v === 'number' || typeof v === 'boolean') k += '|' + n + '=' + v;
    }
    morceaux.push(k);
  }
  return morceaux.join(';');
}

function jouerTout(niveau, coups) {
  const p = new R.Partie(niveau.clone());
  for (const c of coups) { if (p.isEnded()) break; p.jouer(c); }
  return p;
}

/**
 * Parcours en largeur. opts : { maxEtats, fantome (autoriser l'esprit) }.
 * Rend la liste des coups (codes Replay) ou null.
 */
function resoudre(contenu, opts) {
  opts = opts || {};
  const niveau = R.Level.depuisChaine(contenu);
  const depart = new R.Partie(niveau.clone());
  if (depart.isEnded()) return null;
  const vus = new Set([cle(depart)]);
  let front = [[]];
  let etats = 0;
  while (front.length) {
    const suivant = [];
    for (const coups of front) {
      const actions = [0, 1, 2, 3];
      if (opts.fantome !== false) actions.push(-1);
      for (const a of actions) {
        const p = jouerTout(niveau, coups);
        const code = a === -1 ? (p._inGhostMode ? R.Replay.STOP_GHOST : R.Replay.START_GHOST) : a;
        const avant = p.getMovements().length;
        p.jouer(code);
        if (p.getMovements().length === avant && a !== -1) continue;   // coup refusé
        const nouveau = coups.concat([code]);
        if (p.isEnded()) {
          if (p.isVictorious()) {
            const v = R.rejouer(R.Level.depuisChaine(contenu), nouveau);
            if (v.victorieux) return nouveau;
          }
          continue;
        }
        const k = cle(p);
        if (vus.has(k)) continue;
        vus.add(k);
        suivant.push(nouveau);
        if (++etats > (opts.maxEtats || 200000)) return null;
      }
    }
    front = suivant;
  }
  return null;
}

module.exports = { niveaux, resoudre, jouerTout };

if (require.main === module) {
  const motif = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  for (const n of niveaux()) {
    if (motif && !motif.test(n.titre)) continue;
    const t0 = Date.now();
    const s = resoudre(n.contenu, { maxEtats: Number(process.env.MAX_ETATS || 60000) });
    console.log(`${n.section} ${n.pack}/${n.index} « ${n.titre} » : ${s ? s.length + ' coups ' + JSON.stringify(s) : 'pas trouvé'} (${Date.now() - t0} ms)`);
  }
}
