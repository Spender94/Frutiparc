/*
 * VISER PUIS VALIDER — le doigt de Swapou ne joue plus au premier appui.
 *
 * « Sur mobile, on fait plein de missclicks » : au doigt, l'échange partait au
 * RELÂCHER, et un appui mal posé sur des cases de 35 pixels jouait un coup.
 * Désormais (cf. l'en-tête de public/swapou/game.js) :
 *   · un appui bref vise — la paire reste montrée, l'anneau pulse ;
 *   · un second appui bref sur la même paire la valide ;
 *   · ailleurs, il vise ailleurs ; hors du plateau, il désarme ; tout ce qui
 *     change la partie (verrou, pause, plateau qui bouge) désarme aussi ;
 *   · un glissé franc échange encore d'un seul geste, et revenir près du
 *     point d'appui avant de lever le doigt l'annule ;
 *   · l'option se coupe (par appareil), et la souris ne change pas.
 *
 * Et surtout : un coup validé au doigt part au journal EXACTEMENT comme le
 * même coup joué au clic — le serveur rejoue les parties, coup par coup.
 *
 * Les gestes sont donnés en coordonnées LOGIQUES, comme index.html les passe
 * au jeu après toLogical ; la partie navigateur (portrait et paysage, vrais
 * événements tactiles) est dans swapouViserValiderNavigateur.test.js.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SWAPOU = path.join(__dirname, '..', 'public', 'swapou');

// Un client Swapou complet, sans navigateur. `stockage` : le localStorage de
// l'appareil (un objet { get, set }), ou 'casse' pour un stockage qui lève.
function client(o) {
  o = o || {};
  const horloge = { t: 1000 };
  const bac = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams,
    performance: { now: () => horloge.t }, Date, Math, JSON,
  };
  if (o.stockage === 'casse') {
    Object.defineProperty(bac, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else if (o.stockage) {
    bac.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(o.stockage, k) ? o.stockage[k] : null),
      setItem: (k, v) => { o.stockage[k] = String(v); },
    };
  }
  if (o.tactile) bac.ontouchstart = null;
  bac.self = bac; bac.window = bac;
  vm.createContext(bac);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'])
    vm.runInContext(fs.readFileSync(path.join(SWAPOU, f), 'utf8'), bac, { filename: f });
  bac.SW.A.play = function () {};
  bac.SW.A.playMusic = function () {};
  bac.SW.Manager.init('');
  bac.horloge = horloge;
  return bac;
}

function pump(bac, n) {
  for (let i = 0; i < (n || 1); i++) {
    bac.horloge.t += 25;
    bac.SW.Manager.main(1, 1 / 40);
  }
}

// Une partie de Challenge à graine fixe : deux clients avec la même graine
// ont le même plateau, coup pour coup.
function challenge(bac, graine) {
  const SW = bac.SW, M = SW.Manager;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.essai = false;
  SW.Data.players = [0, -1];
  if (M.mode && M.mode.destroy) M.mode.destroy();
  M.client.partie = { id: 'essai', graine: graine === undefined ? 12345 : graine };
  M.mode = new SW.Challenge();
  pump(bac, 5);
  return M.mode;
}

// Les paires horizontales échangeables du plateau, du bas vers le haut.
function paires(chal, n) {
  const lvl = chal.player.level;
  const r = [];
  for (let y = lvl.height - 1; y >= 0 && r.length < (n || 1); y--)
    for (let x = 0; x < lvl.width - 1 && r.length < (n || 1); x++) {
      const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
      if (f1 && f2 && f1.canSwap() && f2.canSwap()) r.push({ x, y });
    }
  assert.ok(r.length >= (n || 1), 'assez de paires échangeables');
  return r;
}
// Le point qui vise (x,y)→droite par le quadrant (le même que les clics des
// autres tests : aux 6/7 de la case, à mi-hauteur) — et celui qui vise la
// MÊME paire depuis la case de droite, (x+1,y)→gauche.
function pointDroite(chal, p) {
  const i = chal.player.animator.getInfos();
  return { x: i.px + p.x * 35 + 30, y: i.py + p.y * 35 + 17 };
}
function pointGauche(chal, p) {
  const i = chal.player.animator.getInfos();
  return { x: i.px + (p.x + 1) * 35 + 5, y: i.py + p.y * 35 + 17 };
}
function centre(chal, p) {
  const i = chal.player.animator.getInfos();
  return { x: i.px + p.x * 35 + 17, y: i.py + p.y * 35 + 17 };
}

// Un geste : appui, passages, relâcher (le dernier point).
function geste(SW, pts) {
  SW.handleTouchStart(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) SW.handleMouseMove(pts[i].x, pts[i].y);
  const f = pts[pts.length - 1];
  SW.handleTouchEnd(f.x, f.y);
}
const tape = (SW, pt) => geste(SW, [pt]);
const decale = (pt, dx, dy) => ({ x: pt.x + dx, y: pt.y + dy });
const coup = (ligne) => ligne.split('@')[0];

test('les seuils : en pixels logiques, l’appui bref sous la glissade', () => {
  const { SW } = client();
  assert.strictEqual(SW.TOUCHER.TAPE, 10);
  assert.strictEqual(SW.TOUCHER.GLISSE, 22);
  assert.ok(SW.TOUCHER.GLISSE < 35, 'un glissé franc reste plus court qu’une case');
  assert.strictEqual(SW.viserValider, true, 'l’option est à oui par défaut');
});

test('un appui bref vise sans jouer ; le second sur la même paire joue, avec la même ligne qu’au clic', () => {
  const doigt = client(), souris = client();
  const chal = challenge(doigt), chalS = challenge(souris);
  const [p] = paires(chal);
  const pt = pointDroite(chal, p);

  tape(doigt.SW, pt);
  assert.strictEqual(chal.lock, false, 'le premier appui ne joue pas');
  assert.strictEqual(chal.journal.length, 0, 'rien au journal');
  assert.ok(doigt.SW.visee && doigt.SW.visee.x === p.x && doigt.SW.visee.y === p.y && doigt.SW.visee.dx === 1,
    'la paire est armée, dans le sens visé');
  pump(doigt, 3);
  const ro = chal.interf.rollover;
  assert.ok(ro.visible && ro.arme, 'doigt levé, la paire armée reste montrée et pulse');
  assert.ok(doigt.SW.visee, 'quelques images plus tard, elle est toujours armée');

  // Pendant le second appui, l'anneau armé pulse : le relâcher validera.
  doigt.SW.handleTouchStart(pt.x + 2, pt.y - 1);
  pump(doigt, 1);
  assert.ok(ro.visible && ro.arme, 'doigt posé sur la paire armée : elle pulse encore');
  doigt.horloge.t += 700;     // le temps de réflexion compte l'appui de plus
  doigt.SW.handleTouchEnd(pt.x + 2, pt.y - 1);
  assert.strictEqual(chal.lock, true, 'le second appui joue');
  assert.strictEqual(doigt.SW.visee, null, 'et désarme');

  // Le même coup, au clic de la souris, sur le même plateau.
  souris.SW.handleMouseMove(pt.x, pt.y);
  chalS.onClickDown();
  assert.strictEqual(chalS.lock, true);
  assert.strictEqual(chal.journal.length, 1);
  assert.strictEqual(coup(chal.journal[0]), coup(chalS.journal[0]), 'même coup au journal : ' + chal.journal[0]);
  assert.match(chal.journal[0], /^s\d+,\d+,[0-3]@\d+$/);
  assert.ok(Number(chal.journal[0].split('@')[1]) >= 700, 'la réflexion inclut l’appui de validation');
  // Et la partie continue à l'identique : le plateau d'après est le même.
  for (let i = 0; i < 400 && (chal.lock || chalS.lock); i++) { pump(doigt); pump(souris); }
  const grille = (c) => c.player.level.fruits.map((col) => col.map((f) => (f ? f.t + ':' + f.flags : '-')).join(',')).join('|');
  assert.strictEqual(grille(chal), grille(chalS), 'même plateau après le tour');
  assert.strictEqual(chal.player.score, chalS.player.score, 'même score');
});

test('valider depuis l’autre case de la paire : même échange, dans le sens visé d’abord', () => {
  const doigt = client(), souris = client();
  const chal = challenge(doigt), chalS = challenge(souris);
  const [p] = paires(chal);
  tape(doigt.SW, pointDroite(chal, p));
  const g = pointGauche(chal, p);
  assert.deepStrictEqual([chal.player.getPair(g.x, g.y).x, chal.player.getPair(g.x, g.y).dx], [p.x + 1, -1],
    'ce point vise bien (x+1,y)→gauche');
  tape(doigt.SW, g);
  assert.strictEqual(chal.lock, true, 'la même paire, vue de l’autre case, valide');
  const pt = pointDroite(chalS, p);
  souris.SW.handleMouseMove(pt.x, pt.y);
  chalS.onClickDown();
  assert.strictEqual(coup(chal.journal[0]), coup(chalS.journal[0]), 'le sens est celui de la visée');
});

test('un appui sur une autre paire vise celle-là, sans jouer', () => {
  const bac = client();
  const chal = challenge(bac);
  const [a, b] = paires(chal, 2);
  tape(bac.SW, pointDroite(chal, a));
  tape(bac.SW, pointDroite(chal, b));
  assert.strictEqual(chal.lock, false, 'rien n’est joué');
  assert.ok(bac.SW.visee.x === b.x && bac.SW.visee.y === b.y, 'la visée a changé de paire');
  // Pendant l'appui sur une autre paire, c'est l'aperçu (sans pulsation).
  bac.SW.handleTouchStart(pointDroite(chal, a).x, pointDroite(chal, a).y);
  pump(bac);
  assert.ok(chal.interf.rollover.visible && !chal.interf.rollover.arme, 'aperçu, pas d’anneau armé');
  bac.SW.handleTouchEnd(pointDroite(chal, a).x, pointDroite(chal, a).y);
  assert.strictEqual(chal.lock, false);
  tape(bac.SW, pointDroite(chal, a));
  assert.strictEqual(chal.lock, true, 'puis la validation joue la nouvelle paire');
  assert.strictEqual(coup(chal.journal[0]), 's' + a.x + ',' + a.y + ',0');
});

test('un appui hors du plateau, ou sur une case vide, désarme', () => {
  const bac = client();
  const chal = challenge(bac);
  const [p] = paires(chal);
  const pt = pointDroite(chal, p);
  tape(bac.SW, pt);
  assert.ok(bac.SW.visee);
  tape(bac.SW, { x: 20, y: 460 });          // le panneau de gauche
  assert.strictEqual(bac.SW.visee, null, 'hors du plateau : désarmé');
  pump(bac);
  assert.strictEqual(chal.interf.rollover.visible, false, 'plus de sélecteur');
  tape(bac.SW, pt);
  const i = chal.player.animator.getInfos();
  tape(bac.SW, { x: i.px + 17, y: i.py + 17 });   // tout en haut : case vide
  assert.strictEqual(chal.player.level.getFruit(0, 0), null, 'la case du haut est bien vide');
  assert.strictEqual(bac.SW.visee, null, 'case vide : désarmé');
  // Et l'appui suivant sur la paire ne fait que viser de nouveau.
  tape(bac.SW, pt);
  assert.strictEqual(chal.lock, false);
  assert.strictEqual(chal.journal.length, 0);
});

test('un appui sur l’interface (l’icône de défense) désarme', () => {
  const bac = client();
  const chal = challenge(bac);
  const [p] = paires(chal);
  tape(bac.SW, pointDroite(chal, p));
  const ic = chal.interf.defenseIcon;
  tape(bac.SW, { x: ic.x, y: ic.y });       // pas assez d'étoiles : l'icône ne fait rien
  assert.strictEqual(chal.lock, false);
  assert.strictEqual(bac.SW.visee, null, 'l’appui ailleurs que sur le plateau a fait tomber la visée');
});

test('un doigt qui hésite vise mais ne valide jamais', () => {
  const bac = client();
  const chal = challenge(bac);
  const [p] = paires(chal);
  const pt = pointDroite(chal, p);
  // 15 px puis retour : plus qu'un appui bref, moins qu'un glissé.
  geste(bac.SW, [pt, decale(pt, 0, 15), decale(pt, 0, 2)]);
  assert.strictEqual(chal.lock, false, 'une hésitation ne joue pas');
  assert.ok(bac.SW.visee, 'elle vise');
  geste(bac.SW, [pt, decale(pt, -14, 0), pt]);
  assert.strictEqual(chal.lock, false, 'même sur la paire armée, une hésitation ne valide pas');
  assert.ok(bac.SW.visee && bac.SW.visee.x === p.x, 'la paire reste armée');
  // Neuf pixels, c'est encore un appui bref : il valide.
  geste(bac.SW, [pt, decale(pt, 9, -9), decale(pt, 3, 0)]);
  assert.strictEqual(chal.lock, true, 'un appui bref (≤ 10 px) valide');
});

test('un glissé franc échange d’un seul geste, dans la direction du glissé', () => {
  const doigt = client(), souris = client();
  const chal = challenge(doigt), chalS = challenge(souris);
  const [a, b] = paires(chal, 2);
  tape(doigt.SW, pointDroite(chal, a));     // une visée en cours n'empêche rien
  const c = centre(chal, b);
  doigt.SW.handleTouchStart(c.x, c.y);
  doigt.SW.handleMouseMove(c.x + 12, c.y + 3);
  assert.strictEqual(doigt.SW.geste(), 'hesite');
  doigt.SW.handleMouseMove(c.x + 22, c.y + 6);
  assert.strictEqual(doigt.SW.geste(), 'glisse');
  pump(doigt);
  assert.ok(chal.interf.rollover.visible && !chal.interf.rollover.arme, 'la paire du glissé est montrée');
  doigt.SW.handleTouchEnd(c.x + 30, c.y + 6);
  assert.strictEqual(chal.lock, true, 'le relâcher échange');
  assert.strictEqual(doigt.SW.visee, null, 'et la visée précédente est oubliée');
  const pt = pointDroite(chalS, b);
  souris.SW.handleMouseMove(pt.x, pt.y);
  chalS.onClickDown();
  assert.strictEqual(coup(chal.journal[0]), coup(chalS.journal[0]), 'même coup qu’au clic sur la paire');
});

test('un glissé vers le haut, depuis le bas de la case : la direction vient du geste', () => {
  const bac = client();
  const chal = challenge(bac);
  const lvl = chal.player.level;
  let p = null;
  for (let y = lvl.height - 1; y > 0 && !p; y--)
    for (let x = 0; x < lvl.width && !p; x++) {
      const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x, y - 1);
      if (f1 && f2 && f1.canSwap() && f2.canSwap()) p = { x, y };
    }
  assert.ok(p);
  const c = centre(chal, p);
  geste(bac.SW, [decale(c, 0, 10), decale(c, 2, -6), decale(c, 3, -20)]);
  assert.strictEqual(chal.lock, true);
  assert.strictEqual(coup(chal.journal[0]), 's' + p.x + ',' + p.y + ',3', 'sens 3 : vers le haut');
});

test('revenir près du point d’appui annule le glissé : rien n’est joué, rien ne reste visé', () => {
  const bac = client();
  const chal = challenge(bac);
  const [a, b] = paires(chal, 2);
  tape(bac.SW, pointDroite(chal, a));
  const c = centre(chal, b);
  bac.SW.handleTouchStart(c.x, c.y);
  bac.SW.handleMouseMove(c.x + 30, c.y);
  pump(bac);
  assert.ok(chal.interf.rollover.visible, 'au-delà du seuil : la paire du glissé');
  bac.SW.handleMouseMove(c.x + 4, c.y + 2);
  assert.strictEqual(bac.SW.geste(), 'annule');
  pump(bac);
  assert.strictEqual(chal.interf.rollover.visible, false, 'revenu : plus rien de montré — le relâcher ne fera rien');
  bac.SW.handleTouchEnd(c.x + 4, c.y + 2);
  assert.strictEqual(chal.lock, false, 'rien n’est joué');
  assert.strictEqual(bac.SW.visee, null, 'rien ne reste visé');
  assert.strictEqual(chal.journal.length, 0);
  // Repartir au-delà avant de lever le doigt, c'est glisser de nouveau.
  geste(bac.SW, [c, decale(c, 30, 0), decale(c, 3, 0), decale(c, 28, 4)]);
  assert.strictEqual(chal.lock, true, 'reparti au-delà : le glissé joue');
});

test('la pause — le bouton, ou la fenêtre qui passe derrière — désarme', () => {
  const bac = client();
  const chal = challenge(bac);
  const [p] = paires(chal);
  const pt = pointDroite(chal, p);
  tape(bac.SW, pt);
  pump(bac);
  assert.ok(chal.interf.rollover.arme);
  assert.strictEqual(bac.SW.pauseAuto(), true, 'la fenêtre passe derrière : pause');
  pump(bac);
  assert.strictEqual(bac.SW.visee, null, 'la pause a fait tomber la visée');
  assert.strictEqual(chal.interf.rollover.visible, false, 'et éteint le sélecteur sous la boîte');
  tape(bac.SW, pt);                          // cet appui lève la pause…
  pump(bac, 2);
  assert.strictEqual(chal.pause.activated(), false);
  assert.strictEqual(bac.SW.visee, null, '…sans rien viser');
  tape(bac.SW, pt);
  assert.strictEqual(chal.lock, false, 'il faut viser de nouveau : le premier appui ne joue pas');
  // Le bouton pause, de même.
  const r = bac.SW.pauseBtnRect;
  tape(bac.SW, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
  pump(bac);
  assert.strictEqual(chal.pause.activated(), true);
  assert.strictEqual(bac.SW.visee, null);
});

test('un plateau qui bouge, un tour verrouillé, une autre partie : la visée tombe', () => {
  const bac = client();
  let chal = challenge(bac);
  const [p] = paires(chal);
  tape(bac.SW, pointDroite(chal, p));
  chal.player.genLine();                     // une ligne monte : tout le plateau bouge
  pump(bac);
  assert.strictEqual(bac.SW.visee, null, 'plateau changé : désarmé');

  tape(bac.SW, pointDroite(chal, paires(chal)[0]));
  assert.ok(bac.SW.visee);
  chal.setLock(true);                        // le tour se verrouille (défense, fin…)
  pump(bac);
  assert.strictEqual(bac.SW.visee, null, 'tour verrouillé : désarmé');
  assert.strictEqual(chal.interf.rollover.visible, false);
  chal.setLock(false);

  tape(bac.SW, pointDroite(chal, paires(chal)[0]));
  assert.ok(bac.SW.visee);
  chal = challenge(bac);                     // nouvelle partie
  assert.strictEqual(bac.SW.visee, null, 'nouvelle partie : désarmé');
});

test('le système reprend le doigt (touchcancel) : rien n’est joué, rien ne reste visé', () => {
  const bac = client();
  const chal = challenge(bac);
  const [p] = paires(chal);
  const pt = pointDroite(chal, p);
  tape(bac.SW, pt);
  bac.SW.handleTouchStart(pt.x, pt.y);
  bac.SW.handleTouchCancel();
  pump(bac);
  assert.strictEqual(chal.lock, false);
  assert.strictEqual(bac.SW.visee, null);
  assert.strictEqual(bac.SW.mouse.touching, false);
});

test('la souris ne change pas : le clic échange tout de suite, et fait tomber une visée du doigt', () => {
  const bac = client();
  const chal = challenge(bac);
  const [a, b] = paires(chal, 2);
  tape(bac.SW, pointDroite(chal, a));
  assert.ok(bac.SW.visee);
  const pt = pointDroite(chal, b);
  bac.SW.handleMouseMove(pt.x, pt.y);
  assert.strictEqual(bac.SW.visee, null, 'la souris bouge : la visée du doigt tombe');
  pump(bac);
  assert.ok(chal.interf.rollover.visible && !chal.interf.rollover.arme, 'survol ordinaire');
  bac.SW.handleMouseDown(pt.x, pt.y);
  assert.strictEqual(chal.lock, true, 'le clic joue au premier coup');
  assert.strictEqual(coup(chal.journal[0]), 's' + b.x + ',' + b.y + ',0');
});

test('option coupée : l’appui bref rejoue au relâcher, comme avant — retenu par l’appareil', () => {
  const stockage = {};
  const bac = client({ stockage });
  assert.strictEqual(bac.SW.viserValider, true, 'rien de retenu : à oui');
  bac.SW.setViserValider(false);
  assert.strictEqual(stockage.swapou2_viser, '0', 'retenu dans le localStorage de l’appareil');
  const chal = challenge(bac);
  const [p] = paires(chal);
  tape(bac.SW, pointDroite(chal, p));
  assert.strictEqual(chal.lock, true, 'option coupée : le premier appui joue');
  assert.strictEqual(coup(chal.journal[0]), 's' + p.x + ',' + p.y + ',0');

  // Un autre chargement de la page sur le même appareil s'en souvient.
  const relu = client({ stockage });
  assert.strictEqual(relu.SW.viserValider, false, 'relu au chargement');
  const chal2 = challenge(relu);
  // Coupée, le glissé annulé reste annulé.
  const c = centre(chal2, paires(chal2)[0]);
  geste(relu.SW, [c, decale(c, 30, 0), decale(c, 2, 0)]);
  assert.strictEqual(chal2.lock, false, 'glissé annulé : rien');
  relu.SW.setViserValider(true);
  assert.strictEqual(stockage.swapou2_viser, '1');
});

test('un stockage qui lève (navigation privée) : l’option reste à oui, rien ne casse', () => {
  const bac = client({ stockage: 'casse' });
  assert.strictEqual(bac.SW.viserValider, true);
  assert.doesNotThrow(() => bac.SW.setViserValider(false));
  assert.strictEqual(bac.SW.viserValider, false, 'le réglage vaut pour la séance');
});

test('le Duel vise et valide de même', () => {
  const bac = client();
  const SW = bac.SW, M = SW.Manager;
  SW.Data.gameMode = SW.Data.DUEL;
  SW.Data.players = [0, 2];
  SW.Data.difficulty = 0;
  M.mode.destroy();
  M.mode = new SW.Duel();
  const duel = M.mode;
  pump(bac, 5);
  const [p] = paires(duel);
  const pt = pointDroite(duel, p);
  const avant = duel.player.level.getFruit(p.x, p.y);
  tape(SW, pt);
  assert.strictEqual(duel.pl_lock, false, 'le premier appui ne joue pas');
  pump(bac);
  assert.ok(duel.interf.rollover.arme, 'la paire armée pulse');
  tape(SW, pt);
  assert.strictEqual(duel.pl_lock, true, 'le second joue');
  assert.strictEqual(duel.player.level.getFruit(p.x + 1, p.y), avant, 'les deux fruits ont changé de case');
});

test('« Paramètres de jeu » : la ligne « au doigt » sur un appareil tactile, et seulement là', () => {
  const stockage = {};
  const bac = client({ stockage, tactile: true });
  const menu = bac.SW.Manager.mode;
  pump(bac, 5);
  bac.SW.handleMouseMove(350, 240);
  menu.onClickDown();                        // le clic qui fait entrer (le logo)
  pump(bac, 200);
  menu.jump(11);
  pump(bac, 120);
  const libelles = () => [...menu.btList].filter((b) => !b.kill && b.phase !== 'hide').map((b) => b.label.trim());
  assert.deepStrictEqual(libelles(), ['son :  oui', 'musique :  oui', 'details :  hauts', 'au doigt :  viser', 'retour']);
  const bt = menu.btList[3];
  assert.match(bt.help, /un second appui/);
  bac.SW.handleMouseMove(bt.curX, bt.curY);
  menu.onClickDown();
  assert.strictEqual(bac.SW.viserValider, false, 'le bouton bascule l’option');
  assert.strictEqual(stockage.swapou2_viser, '0');
  pump(bac, 120);
  assert.deepStrictEqual(libelles(), ['son :  oui', 'musique :  oui', 'details :  hauts', 'au doigt :  direct', 'retour']);

  // À la souris seule, l'écran garde ses quatre lignes d'origine.
  const souris = client();
  const m2 = souris.SW.Manager.mode;
  m2.jump(11);
  pump(souris, 120);
  assert.deepStrictEqual([...m2.btList].map((b) => b.label.trim()), ['son :  oui', 'musique :  oui', 'details :  hauts', 'retour']);
  // Un premier doigt posé suffit à la faire paraître.
  souris.SW.handleTouchStart(-50, -50);
  souris.SW.handleTouchCancel();
  assert.strictEqual(souris.SW.tactilePossible(), true);
});

test('le sélecteur armé respire autour du milieu de la paire', () => {
  const bac = client();
  const U = bac.SW.U;
  const ro = new U.Rollover();
  const appels = [];
  const ctx = new Proxy({}, {
    get(_, nom) {
      if (nom === 'canvas') return {};
      return (...a) => { appels.push([nom].concat(a)); };
    },
    set() { return true; },
  });
  const f = (x, y) => ({ spr: { x, y }, canSwap: () => true });
  ro.setPair({ x: 0, y: 0, dx: 1, dy: 0, f1: f(100, 200), f2: f(135, 200) }, null, 0);
  ro.arme = false;
  ro.draw(ctx);
  assert.ok(!appels.some((c) => c[0] === 'scale'), 'au repos : pas de pulsation');
  appels.length = 0;
  ro.arme = true;
  bac.SW.tmod = 8;                            // un quart de période
  ro.draw(ctx);
  const s = appels.find((c) => c[0] === 'scale');
  assert.ok(s && s[1] > 1 && s[1] <= 1.07 && s[1] === s[2], 'armé : l’anneau gonfle (' + (s && s[1]) + ')');
  const t = appels.filter((c) => c[0] === 'translate');
  assert.deepStrictEqual([...t[1]].slice(1), [35, 17.5], 'autour de la jointure des deux cases');
});

test('l’astuce « Touche encore pour valider » : tant que l’appareil n’a pas validé trois coups', () => {
  const stockage = {};
  const bac = client({ stockage });
  const textes = [];
  const ctx = new Proxy({}, {
    get(_, nom) {
      if (nom === 'fillText') return (s) => { textes.push(s); };
      return () => {};
    },
    set() { return true; },
  });
  let chal = challenge(bac);
  bac.SW.dessinerAstuce(ctx, chal.player);
  assert.strictEqual(textes.length, 0, 'rien de visé : pas d’astuce');
  for (let n = 1; n <= 3; n++) {
    const pt = pointDroite(chal, paires(chal)[0]);
    tape(bac.SW, pt);
    assert.strictEqual(bac.SW.astuceVisible(chal.player), true, 'visée n° ' + n + ' : l’astuce est là');
    textes.length = 0;
    bac.SW.dessinerAstuce(ctx, chal.player);
    assert.deepStrictEqual(textes, ['Touche encore pour valider']);
    tape(bac.SW, pt);
    assert.strictEqual(chal.lock, true);
    assert.strictEqual(stockage.swapou2_viser_valides, String(n), 'le compte est retenu');
    for (let i = 0; i < 400 && chal.lock; i++) pump(bac);
  }
  tape(bac.SW, pointDroite(chal, paires(chal)[0]));
  assert.ok(bac.SW.visee);
  assert.strictEqual(bac.SW.astuceVisible(chal.player), false, 'trois validations : l’astuce se tait');
  // Un autre chargement de la page s'en souvient.
  const relu = client({ stockage });
  chal = challenge(relu);
  tape(relu.SW, pointDroite(chal, paires(chal)[0]));
  assert.strictEqual(relu.SW.astuceVisible(chal.player), false);
});
