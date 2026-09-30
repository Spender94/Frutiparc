'use strict';
/*
 * SWAPOU — LE FIL DU REJEU. Le rejeu d'une partie coûte quelques dixièmes de
 * seconde de calcul pur (l'accord avec l'IA, plusieurs minutes) : dans la
 * boucle du serveur, ce serait le chat, les salons et les autres jeux figés
 * d'autant. Il tourne donc ici, dans un fil à part (worker_threads), une
 * partie après l'autre.
 *
 * Protocole :
 *   → { n, type: 'verifier', graine, coups, perso }
 *   ← { n, resultat: { ok, fini, score, joues, total, raison }, rythme }
 *   → { n, type: 'accord', graine, coups, perso, budgetMs }
 *   ← { n, avance: { fait, total } }  (de temps en temps)
 *   ← { n, resultat: { …, accord } }
 *   ← { n, erreur }                    si le rejeu a planté
 */
const { parentPort } = require('worker_threads');
const R = require('./swapouRejeu.js');

parentPort.on('message', (m) => {
  if (!m) return;
  try {
    if (m.type === 'accord') {
      let dernier = 0;
      const resultat = R.rejouer(m, {
        analyse: { budgetMs: Number(m.budgetMs) || 1500 },
        surCoup: (fait, total) => {
          const t = Date.now();
          if (t - dernier < 2000) return;
          dernier = t;
          parentPort.postMessage({ n: m.n, avance: { fait, total } });
        },
      });
      parentPort.postMessage({ n: m.n, resultat });
    } else {
      const resultat = R.rejouer(m);
      parentPort.postMessage({ n: m.n, resultat, rythme: R.rythme(m.coups) });
    }
  } catch (e) {
    parentPort.postMessage({ n: m.n, erreur: String((e && e.message) || e) });
  }
});
