/*
 * Kaluga — le PILOTE de la tzongre, pour la capture (injecté dans la page).
 *
 * La tzongre se pilote comme un petit hélicoptère : HAUT donne un coup d'aile
 * dans l'axe du corps (_rotation − 90°), GAUCHE/DROITE la font pencher, la
 * gravité la ramène au sol, et ESPACE lance le fil vers les pommes à portée
 * (tenu : on cherche ; relâché : on soulève ; repressé : on lâche).
 *
 * Le pilote est un asservissement simple : une vitesse voulue vers la cible,
 * l'accélération qu'il faut pour l'atteindre (gravité comprise), l'inclinaison
 * qui la donne (bornée, la tzongre ne fait pas de looping), et le coup d'aile
 * quand le corps est assez aligné. Par-dessus, une tâche : aller au-dessus de
 * la pomme libre la plus proche, l'attraper au fil, la porter au-dessus du
 * panier et la lâcher dedans — et recommencer.
 *
 * Il joue dans le pas du lecteur (scene.surTick enveloppé), en posant l'état
 * des touches dans K.Key comme le ferait un clavier.
 */
'use strict';

function installerPiloteKaluga(reglages) {
  /* eslint-disable no-undef */
  const R = Object.assign({ vMax: 7, kp: 0.07, kv: 0.35, inclinaison: 55, gravite: 0.5, hauteurSaisie: 28, hauteurPanier: 140 }, reglages || {});
  const K = window.KalugaMoteur, J = window.KalugaJeu || window.Kaluga || {};
  const mng = (J && J.manager) || window.__kalugaManager;
  const s = K.scene;
  const Key = K.Key;
  const T = { phase: 'cherche', pas: 0, lachers: 0, saisies: 0 };
  window.__pilote = T;
  const tenues = {};
  const poser = (code, v) => {
    if (!!tenues[code] === v) return;
    tenues[code] = v;
    if (v) Key.enfoncees[code] = true; else delete Key.enfoncees[code];
  };
  let tenirFil = 0, attente = 0, cible = null;
  const angle = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
  const tick0 = s.surTick;
  s.surTick = function () {
    const g = mng && mng.current;
    const tz = g && g.tzongre;
    if (!tz || tz.flScotched || !tz.key || g.flEndingGame) { for (const c of Object.keys(tenues)) poser(+c, false); return tick0.apply(this, arguments); }
    T.pas++;
    const k = tz.key;
    const panier = g.panier;
    // ── La tâche ──
    const libres = (g.fruitList || []).filter((f) => f && !f.flTree && !f.flPanier && f.parentLink == null && f.flScoreAble !== false
      && f.linkList && f.linkList.length === 0 && f._visible !== false && (!panier || Math.abs(f.x - panier.x) > 45 || f.y < panier.y - 60));
    if (attente > 0) attente--;
    if (T.phase === 'porte' && !tz.flLift) T.phase = 'cherche';
    if (T.phase === 'cherche' && tz.flLift) T.phase = 'porte';
    let but;
    if (T.phase === 'porte' && panier) {
      // La pomme pend sous la tzongre : c'est ELLE qu'on aligne sur l'ouverture
      // du panier, et on lâche quand elle est au-dessus, presque immobile.
      const pomme = tz.linkList && tz.linkList[0];
      const decal = pomme ? pomme.x - tz.x : 0;
      but = { x: panier.x - decal * 0.6, y: panier.y - R.hauteurPanier };
      const px = pomme ? pomme.x : tz.x, py = pomme ? pomme.y : tz.y + 40;
      const pvx = pomme ? (pomme.vitx || 0) : tz.vitx;
      if (Math.abs(px - panier.x) < 16 && py < panier.y - 55 && Math.abs(pvx) < 1.8 && Math.abs(tz.vitx) < 2.2 && !attente) {
        poser(k.shoot, true); attente = 12; T.lachers++;      // on lâche dans le panier
      } else if (!attente) poser(k.shoot, false);
    } else {
      if (!cible || libres.indexOf(cible) < 0) {
        let d0 = Infinity; cible = null;
        for (const f of libres) { const d = Math.hypot(f.x - tz.x, f.y - tz.y); if (d < d0) { d0 = d; cible = f; } }
      }
      but = cible ? { x: cible.x, y: cible.y - R.hauteurSaisie } : { x: (g.map ? g.map.width : 700) / 2, y: 180 };
      // À portée : on tient le fil quelques pas (la recherche), puis on relâche (on soulève).
      if (cible && Math.hypot(cible.x - tz.x, cible.y - tz.y) < Math.min(80, (tz.nbTake || 120) * 0.6) && !attente) {
        if (tenirFil < 6) { tenirFil++; poser(k.shoot, true); }
        else { poser(k.shoot, false); tenirFil = 0; attente = 10; T.saisies++; }
      } else if (!attente) { poser(k.shoot, false); tenirFil = 0; }
    }
    // ── L'asservissement ──
    const dx = but.x - tz.x, dy = but.y - tz.y;
    let vx = dx * R.kp * 1.6, vy = dy * R.kp * 1.6;
    const n = Math.hypot(vx, vy);
    if (n > R.vMax) { vx *= R.vMax / n; vy *= R.vMax / n; }
    const ax = (vx - tz.vitx) * R.kv;
    const ay = (vy - tz.vity) * R.kv - R.gravite;          // il faut aussi porter son poids
    let rotVoulue = Math.atan2(ay, ax) * 180 / Math.PI + 90;
    rotVoulue = Math.max(-R.inclinaison, Math.min(R.inclinaison, angle(rotVoulue)));
    if (ay > 0) rotVoulue *= 0.4;                           // on descend : on se redresse et on laisse tomber
    const err = angle(rotVoulue - tz._rotation);
    poser(k.left, err < -3);
    poser(k.right, err > 3);
    // Le coup d'aile : la poussée voulue le long du corps.
    const a = (tz._rotation - 90) * Math.PI / 180;
    const long = ax * Math.cos(a) + ay * Math.sin(a);
    poser(k.up, ay < 0.15 && long > 0.12 && Math.abs(err) < 40);
    poser(k.down, dy > 60 && tz.vity < 3 && !tz.flLift);
    T.x = Math.round(tz.x); T.y = Math.round(tz.y); T.but = { x: Math.round(but.x), y: Math.round(but.y) };
    return tick0.apply(this, arguments);
  };
  return true;
  /* eslint-enable no-undef */
}

module.exports = { installerPiloteKaluga };
