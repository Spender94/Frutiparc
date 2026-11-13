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
 *   → { n, type: 'captures', graine, coups, perso, seuil }
 *   ← { n, resultat: { …, captures: [{ coup, combo, x, y, dx, dy, ms, ia, grille }] } }
 *   → { n, type: 'film', graine, coups, perso }
 *   ← { n, resultat: { …, film: { plateaux, scores, etoiles, combos, coups } }, rythme }
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
    } else if (m.type === 'film') {
      // La partie entière, coup par coup (cf. swapouRejeu.js, « LE FILM »).
      parentPort.postMessage({ n: m.n, resultat: R.rejouer(m, { film: true }), rythme: R.rythme(m.coups) });
    } else if (m.type === 'captures') {
      // Le plateau d'avant chaque gros combo (cf. swapouRejeu.js, « LES CAPTURES »).
      parentPort.postMessage({ n: m.n, resultat: R.rejouer(m, { captures: { seuil: m.seuil } }) });
    } else {
      const resultat = R.rejouer(m);
      parentPort.postMessage({ n: m.n, resultat, rythme: R.rythme(m.coups) });
    }
  } catch (e) {
    parentPort.postMessage({ n: m.n, erreur: String((e && e.message) || e) });
  }
});
