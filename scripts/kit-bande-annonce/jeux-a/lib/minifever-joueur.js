/*
 * Mini-Fever — le JOUEUR de la capture : ce qu'il faut faire, image par image,
 * pour gagner quelques épreuves (injecté dans la page).
 *
 * La page refuse les appuis fabriqués par un script (js/garde-entrees.js) :
 * ici on ne fabrique rien. `decider()` LIT l'épreuve en cours et rend où
 * doit être la souris (en coordonnées de scène, 240 × 240) et si le bouton
 * doit être enfoncé ; c'est la capture qui bouge alors la VRAIE souris, par
 * Playwright — des événements de confiance, exactement ceux d'un joueur.
 *
 * Quatre épreuves savent se jouer :
 *   · Pong (renvoi)    — la raquette attend la balle là où elle arrivera
 *                        (rebonds prévus) ; survivre au chrono gagne ;
 *   · Hammer (maillet) — on frappe la bestiole la plus sortie dès que le
 *                        maillet est réarmé ;
 *   · Gobelet          — la souris SUIT le bon gobelet pendant le mélange,
 *                        puis clique dessus ;
 *   · SpaceDodge       — le vaisseau glisse vers l'endroit le moins exposé
 *                        aux tirs des tourelles ; survivre gagne.
 * Le mode Fever les enchaîne (la capture remplace le tirage au sort du socle
 * par cette liste) ; la difficulté monte de dix à chaque épreuve.
 */
'use strict';

/* eslint-disable no-undef */
function installerJoueur() {
  const W = 240, H = 240;
  const centre = (mc) => {
    const b = mc.boite || { x0: -10, y0: -10, x1: 10, y1: 10 };
    return { x: mc.x + (b.x0 + b.x1) / 2 * mc.sx, y: mc.y + (b.y0 + b.y1) / 2 * mc.sy };
  };
  const memo = { cle: null, t: 0, clic: 0 };
  window.__joueur = {
    decider() {
      const s = window.__socle;
      if (!s || !s.jeu || s.ecranFin || s.termine) return null;
      const j = s.jeu;
      const cle = s.suivant && s.suivant.cle;
      if (memo.cle !== j) { memo.cle = j; memo.t = 0; memo.clic = 0; }
      memo.t++;
      if (memo.clic > 0) { memo.clic--; return { x: s.souris.x, y: s.souris.y, bas: memo.clic > 1 }; }
      if (j.etapePrincipale !== 1) return { x: s.souris.x, y: s.souris.y, bas: false };
      switch (cle) {
        case 'gamePong': {
          const b = j.balle, r = j.raquette;
          if (!b || !r) return null;
          // La balle avance de −vit × coef par image : on la suit jusqu'à la raquette.
          let x = b.x, y = b.y, vx = b.vitx, vy = b.vity;
          const rb = j.rayonBalle || 5;
          for (let n = 0; n < 200 && vx < 0 && x < r.x; n++) {
            x -= vx; y -= vy;
            if (y < rb || y > H - rb) { vy = -vy; y = Math.max(rb, Math.min(H - rb, y)); }
          }
          const cible = vx < 0 ? y : H / 2 + (b.y - H / 2) * 0.3;
          return { x: r.x - 26, y: cible, bas: false, vite: true };
        }
        case 'gameHammer': {
          if (!j.flReady || !j.bList) return null;
          let mieux = null;
          for (const b of j.bList) {
            if (!b.hole || !b.appuyable || !b.hole.bestiole.visible) continue;
            if (b.hole.by > 45) continue;
            if (!mieux || b.hole.by < mieux.hole.by) mieux = b;
          }
          if (!mieux) return null;
          const c = centre(mieux.hole.bestiole);
          const p = { x: c.x, y: Math.min(c.y, mieux.hole.y + 4) };
          // Arrivé sur la tête : le clic (deux images enfoncé).
          if (Math.hypot(s.souris.x - p.x, s.souris.y - p.y) < 6) { memo.clic = 3; return { x: p.x, y: p.y, bas: true }; }
          return { x: p.x, y: p.y, bas: false, vite: true };
        }
        case 'gameGobelet': {
          if (!j.gobelets || j.pos === undefined) return null;
          const g = j.gobelets[j.pos];
          if (!g) return null;
          const c = centre(g.mc);
          if (j.etape === 4 && j.gagnant === null) {
            if (Math.hypot(s.souris.x - c.x, s.souris.y - c.y) < 5 && memo.t > 6) { memo.clic = 3; return { x: c.x, y: c.y, bas: true }; }
            return { x: c.x, y: c.y, bas: false };
          }
          // Pendant le mélange : l'œil (la souris) suit le bon gobelet, un peu au-dessus.
          return { x: c.x, y: c.y - 18, bas: false };
        }
        case 'gameSpaceDodge': {
          const h = j.hero;
          if (!h) return null;
          const tirs = j.sList || [];
          let mieux = null;
          for (let a = 0; a < 16; a++) {
            for (const rr of [0, 14, 28]) {
              const px = Math.max(12, Math.min(W - 12, h.x + Math.cos(a / 16 * 6.283) * rr));
              const py = Math.max(170, Math.min(H - 8, h.y + Math.sin(a / 16 * 6.283) * rr));
              let danger = Math.abs(px - W / 2) * 0.02 + Math.abs(py - (H - 30)) * 0.03 + rr * 0.01;
              for (const t of tirs) {
                const vx = t.vitx || 0, vy = t.vity || 0;
                for (let k = 0; k <= 14; k += 2) {
                  const d = Math.hypot(t.x + vx * k - px, t.y + vy * k - py);
                  if (d < 22) danger += (22 - d) * (1 - k / 20);
                }
              }
              if (!mieux || danger < mieux.d) mieux = { x: px, y: py, d: danger };
            }
          }
          return { x: mieux.x, y: mieux.y, bas: false, vite: true };
        }
        default:
          return null;
      }
    },
  };
  return true;
}
/* eslint-enable no-undef */

module.exports = { installerJoueur };
