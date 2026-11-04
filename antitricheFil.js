'use strict';
/*
 * L'ANTI-TRICHE DES PORTAGES — le fil du rejeu (cf. antitricheLight.js,
 * verifierEnFil). Une partie d'Arbre creux ou une arcade de Mini-Fever se
 * rejoue ici, hors de la boucle du serveur, une après l'autre.
 *
 * Protocole :
 *   → { n, type: 'arbre' | 'arcade', partie }
 *   ← { n, resultat }   le verdict (verifierArbre / verifierArcade)
 *   ← { n, erreur }     si le rejeu a planté
 */
const { parentPort } = require('worker_threads');
const AT = require('./antitricheLight.js');

parentPort.on('message', (m) => {
  if (!m) return;
  try {
    const resultat = m.type === 'arbre' ? AT.verifierArbre(m.partie) : AT.verifierArcade(m.partie);
    parentPort.postMessage({ n: m.n, resultat });
  } catch (e) {
    parentPort.postMessage({ n: m.n, erreur: String((e && e.message) || e) });
  }
});
