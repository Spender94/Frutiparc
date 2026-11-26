/*
 * Burning Kiwi — le PILOTE AUTOMATIQUE de la capture (injecté dans la page).
 *
 * C'est celui de test/bkiwiCadence.test.js (poursuite pure sur la polyligne
 * des checkpoints, frein avant les virages serrés), poussé pour la vitrine :
 * plein gaz par défaut, une visée qui s'allonge avec la vitesse, un frein qui
 * dose selon l'angle du virage qui vient, et la NITRO (les kiwis) lâchée sur
 * les lignes droites. Il joue DANS le pas de physique, comme le pilote des
 * tests : l'état du clavier est posé directement avant chaque pas
 * (K.Key.$cadence.presser0 / relacher0), exactement ce que ferait une frappe
 * arrivée à l'heure de ce pas. Rien du jeu n'est modifié : on enveloppe
 * scene.tick dans la page, le temps de la capture.
 *
 * installerPilote(reglages) → window.__pilote (télémétrie).
 */
'use strict';

function installerPilote(reglages) {
  /* eslint-disable no-undef */
  const R = Object.assign({ L: 70, Lv: 6, croisiere: 99, nitro: true, nitroDroite: 380, nitroAngle: 35, prudence: 1 }, reglages || {});
  const K = window.KalugaMoteur, Jeu = window.BkiwiJeu, m = Jeu.M, s = window.__bkiwi.scene;
  const P = m.CP[m.track.id].map((c) => ({ x: c.x, y: c.y }));
  const n = P.length;
  const getAngle = (a) => { let r = a % 360; if (r >= 180) r -= 360; if (r <= -180) r += 360; return r; };
  const seg = (k) => { const a = P[((k % n) + n) % n], b = P[(((k + 1) % n) + n) % n]; return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) || 1 }; };
  const cum = [0]; for (let k = 0; k < n; k++) cum.push(cum[k] + seg(k).l);
  const total = cum[n];
  const proj = (k, x, y) => {
    const g = seg(k); const t = Math.max(0, Math.min(1, ((x - g.a.x) * (g.b.x - g.a.x) + (y - g.a.y) * (g.b.y - g.a.y)) / (g.l * g.l)));
    return { t, d: Math.hypot(x - (g.a.x + t * (g.b.x - g.a.x)), y - (g.a.y + t * (g.b.y - g.a.y))), s: cum[k] + t * g.l };
  };
  const pointA = (sAbs) => {
    const v = ((sAbs % total) + total) % total; let k = 0; while (k < n - 1 && cum[k + 1] < v) k++;
    const g = seg(k); const t = (v - cum[k]) / g.l; return { x: g.a.x + t * (g.b.x - g.a.x), y: g.a.y + t * (g.b.y - g.a.y) };
  };
  const virage = (k) => {
    const a = seg(k - 1), b = seg(k);
    const c1 = Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x), c2 = Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x);
    return Math.abs(getAngle((c2 - c1) * 180 / Math.PI));
  };
  const codes = () => ({ haut: m.controls[0], frein: m.controls[1], gauche: m.controls[2], droite: m.controls[3], nitro: m.controls[4] });
  const etat = {};
  const poser = (code, v) => {
    if (!!etat[code] === v) return;
    etat[code] = v;
    const c = K.Key.$cadence;
    (v ? (c ? c.presser0 : K.Key.presser) : (c ? c.relacher0 : K.Key.relacher)).call(K.Key, code);
  };
  let kProj = 0, gauche = false, droite = false, frein = false, nitroAttente = 0;
  const T = { pas: 0, nitros: 0, actif: true, x: 0, y: 0, v: 0 };
  window.__pilote = T;
  const tick0 = s.tick.bind(s);
  s.tick = function () {
    const c = m.cars && m.cars[0];
    const C = codes();
    // Pendant le décompte : l'accélérateur tenu (le super départ).
    if (T.actif && c && !m.gamePaused && !c.finished && m.vs.mainPhase === 1) {
      T.pas++;
      let best = null;
      for (let dk = -1; dk < 4; dk++) { const k = ((kProj + dk) % n + n) % n; const p = proj(k, c.x, c.y); if (!best || p.d < best.d) best = Object.assign({ k }, p); }
      kProj = best.k;
      const L = R.L + R.Lv * Math.max(0, c.speed);
      const cible = pointA(best.s + L);
      const ecart = getAngle(Math.atan2(cible.y - c.y, cible.x - c.x) * 180 / Math.PI - c._rotation);
      const vg = gauche ? ecart < -3 : ecart < -7, vd = droite ? ecart > 3 : ecart > 7;
      gauche = vg; droite = vd;
      poser(C.gauche, gauche); poser(C.droite, droite);
      // La vitesse cible : la plus basse qu'imposent les virages des 2 à 4 segments qui viennent.
      let vCible = R.croisiere;
      let droiteLibre = Infinity;
      for (let dk = 1; dk <= 4; dk++) {
        const k = (kProj + dk) % n;
        const dist = ((cum[k] - best.s) % total + total) % total;
        const a = virage(k);
        if (a > R.nitroAngle && dist < droiteLibre) droiteLibre = dist;
        const portee = 90 + c.speed * 14 * R.prudence;
        if (dist < portee && a > 40) vCible = Math.min(vCible, a > 110 ? 5 : a > 80 ? 6.5 : a > 60 ? 8 : 10);
      }
      const vf = c.speed > vCible + 0.4 ? true : (c.speed < vCible - 0.4 ? false : frein);
      frein = vf;
      poser(C.haut, !frein);
      poser(C.frein, frein && c.speed > vCible + 2.5);
      // La nitro : une ligne droite devant, pas de nitro en cours.
      if (nitroAttente > 0) nitroAttente--;
      const kiwis = c.vs ? c.vs.kiwis : 0;
      if (R.nitro && kiwis > 0 && !c.nitroTimer && !nitroAttente && droiteLibre > R.nitroDroite && Math.abs(ecart) < 12 && c.speed > 6) {
        poser(C.nitro, true); nitroAttente = 6; T.nitros++;
      } else if (etat[C.nitro] && nitroAttente < 4) poser(C.nitro, false);
      T.x = c.x; T.y = c.y; T.v = c.speed; T.cp = c.totalCP;
    } else if (T.actif && c && m.vs.mainPhase === 1 && !c.finished) {
      poser(C.haut, true);          // décompte : le pied au plancher
    }
    return tick0();
  };
  return true;
  /* eslint-enable no-undef */
}

module.exports = { installerPilote };
