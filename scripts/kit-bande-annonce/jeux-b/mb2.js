#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — MOTIONBALL 2 (public/mb2/).
 *
 *   node scripts/kit-bande-annonce/jeux-b/mb2.js [titre] [classique] [extras]
 *
 * Produit dans kit-bande-annonce/jeux-b/mb2/ :
 *   · titre.mp4 — l'intro (les lettres MOTION BALL qui rebondissent sur le
 *     grand « 2 ») puis le menu et ses boules qui s'enroulent en orbite ;
 *   · classique-maitre.mp4 — une partie du mode Classique (une salle, des
 *     bumpers, un trou de sortie : on enchaîne les salles contre la montre),
 *     pilotée par une IA de navigation, et les plans qu'on y découpe ;
 *   · les affiches, la jaquette, la musique et les bruitages.
 *
 * L'IA lit la table de collision de la salle (152×102 cases de 4 px, celle
 * que la bille teste elle-même), cherche un chemin jusqu'au bonus rouge le
 * plus proche ou jusqu'au trou de sortie (parcours en largeur, marge de la
 * taille de la bille), puis règle la vitesse de la bille vers le prochain
 * point du chemin — avec les flèches du clavier de Playwright, rien d'autre.
 *
 * Netteté : le jeu plafonne sa définition à 1,6 million de pixels (coût du
 * dessin vectoriel en temps réel). Ici le temps est virtuel : le harnais
 * redonne au canevas exactement sa taille affichée (1606×1079), sans
 * agrandissement par le navigateur.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');

const JEU = 'mb2';
const DOSSIER = path.join(C.SORTIE, JEU);
const CSS = '#fp-fd-badge,#commandes,#chargement{display:none!important}html,body{background:' + C.VERT_SITE + '!important}';

// ── L'IA de navigation, évaluée dans la page ──────────────────────────────
function installerIA() {
  const J = window.Mb2Jeu;
  const Const = J.Const;
  const W = Const.LVL_CWIDTH, H = Const.LVL_CHEIGHT, D = Const.DELTA;
  const mem = { champ: null, cible: null, age: 0, salle: '' };
  window.__iaMem = mem;
  // Cases bloquées (bumpers, bords, murs), dilatées de la taille de la bille.
  function bloquees(L) {
    const b = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) {
      const col = L.coltable[x];
      if (!col) continue;
      for (let y = 0; y < H; y++) {
        const ct = col[y];
        if (ct && ct.on_hit && !ct.is_event) b[x * H + y] = 1;
      }
    }
    const R = 4;   // 8 px de rayon + une marge, en cases
    const d = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      if (!b[x * H + y]) continue;
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        if (i * i + j * j > R * R + 1) continue;
        const u = x + i, v = y + j;
        if (u >= 0 && v >= 0 && u < W && v < H) d[u * H + v] = 1;
      }
    }
    return d;
  }
  // Distance (en cases) de chaque case libre à la cible.
  function champ(bl, cx, cy) {
    const dist = new Int32Array(W * H).fill(-1);
    const file = new Int32Array(W * H);
    let a = 0, z = 0;
    const s = cx * H + cy;
    dist[s] = 0; file[z++] = s;
    while (a < z) {
      const c = file[a++];
      const x = (c / H) | 0, y = c % H;
      for (let k = 0; k < 8; k++) {
        const u = x + [1, -1, 0, 0, 1, 1, -1, -1][k], v = y + [0, 0, 1, -1, 1, -1, 1, -1][k];
        if (u < 0 || v < 0 || u >= W || v >= H) continue;
        const n = u * H + v;
        if (dist[n] >= 0 || (bl[n] && Math.abs(u - cx) + Math.abs(v - cy) > 5)) continue;
        dist[n] = dist[c] + 1;
        file[z++] = n;
      }
    }
    return dist;
  }
  window.__iaMb2 = function () {
    const res = { haut: false, bas: false, gauche: false, droite: false };
    const g = J.Manager.mode;
    if (!g || !g.ball || !g.level || g.game_over_flag) return res;
    const L = g.level, B = g.ball;
    if (!B.control || B.hole_death) return res;
    // La cible : le bonus rouge le plus proche, sinon le trou de sortie ouvert.
    let cible = null, best = Infinity;
    for (const b of L.bonus) {
      if (!b || b.bname !== 'red' || !b.clip) continue;
      const d = Math.hypot(b.clip._x - B.x, b.clip._y - B.y);
      if (d < best) { best = d; cible = { x: b.clip._x, y: b.clip._y, sortie: false }; }
    }
    if (!cible && L.exit && L.exit.clip && L.exit.clip.flOpen) cible = { x: L.exit.clip._x, y: L.exit.clip._y, sortie: true };
    if (!cible) return res;
    const salle = L.pos_x + ',' + L.pos_y;
    const cx = Math.max(0, Math.min(W - 1, Math.round(cible.x / D))), cy = Math.max(0, Math.min(H - 1, Math.round(cible.y / D)));
    if (!mem.champ || mem.salle !== salle || mem.cx !== cx || mem.cy !== cy || ++mem.age > 20) {
      mem.champ = champ(bloquees(L), cx, cy);
      mem.salle = salle; mem.cx = cx; mem.cy = cy; mem.age = 0;
    }
    const dist = mem.champ;
    // On descend le champ de distance sur une douzaine de cases : le point
    // de passage, à vue de la bille.
    let x = Math.round(B.x / D), y = Math.round(B.y / D);
    x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
    let px = x, py = y;
    if (dist[x * H + y] < 0) {
      // Hors du champ (collée à un bumper) : on vise directement.
      px = cx; py = cy;
    } else {
      for (let pas = 0; pas < 14; pas++) {
        let meilleur = dist[px * H + py], nx = px, ny = py;
        for (let k = 0; k < 8; k++) {
          const u = px + [1, -1, 0, 0, 1, 1, -1, -1][k], v = py + [0, 0, 1, -1, 1, -1, 1, -1][k];
          if (u < 0 || v < 0 || u >= W || v >= H) continue;
          const dd = dist[u * H + v];
          if (dd >= 0 && dd < meilleur) { meilleur = dd; nx = u; ny = v; }
        }
        if (nx === px && ny === py) break;
        px = nx; py = ny;
      }
    }
    const dx = px * D - B.x, dy = py * D - B.y;
    const n = Math.hypot(dx, dy) || 1;
    const reste = dist[x * H + y] >= 0 ? dist[x * H + y] * D : Math.hypot(cible.x - B.x, cible.y - B.y);
    // Vitesse voulue : franche en ligne droite, plus douce près du but.
    const vmax = cible.sortie ? Math.min(6.5, 1.5 + reste / 18) : Math.min(7.5, 2.5 + reste / 14);
    const vx = dx / n * vmax, vy = dy / n * vmax;
    const ex = vx - B.sx, ey = vy - B.sy;
    const seuil = 0.6;
    if (ex > seuil) res.droite = true; else if (ex < -seuil) res.gauche = true;
    if (ey > seuil) res.bas = true; else if (ey < -seuil) res.haut = true;
    return res;
  };
}

// Le journal des événements : les sons que la partie demande disent ce qui
// arrive (bumper heurté, bonus, sortie, salle suivante).
function installerJournal() {
  const J = window.Mb2Jeu;
  window.__journal = [];
  const joue = J.Sound.play.bind(J.Sound);
  J.Sound.play = function (s) { window.__journal.push(String(s)); return joue.apply(null, arguments); };
}

const TOUCHES = { haut: 'ArrowUp', bas: 'ArrowDown', gauche: 'ArrowLeft', droite: 'ArrowRight' };
async function appliquer(page, etat, voulu) {
  for (const k of Object.keys(TOUCHES)) {
    if (!!voulu[k] !== !!etat[k]) {
      if (voulu[k]) await page.keyboard.down(TOUCHES[k]); else await page.keyboard.up(TOUCHES[k]);
      etat[k] = !!voulu[k];
    }
  }
}

async function ouvrirJeu(nav, sid) {
  const page = await C.nouvellePage(nav, { css: CSS, graine: 610 });
  await page.goto(C.BASE + '/mb2/?sid=' + sid);
  await C.patienter(page, () => !!window.__mb2, null, 90000);
  // La définition du canevas : exactement sa taille affichée.
  await page.evaluate(() => {
    const c = document.getElementById('scene');
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width);
    c.height = Math.round(r.height);
    window.KalugaMoteur.scene.echelleCanvas = c.width / 610;
  });
  return page;
}
async function versEcran(page, x, y) {
  const r = await page.evaluate(() => { const b = document.getElementById('scene').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; });
  return { x: r.l + x * r.w / 610, y: r.t + y * r.w / 610 };
}
const modeCourant = (page) => page.evaluate(() => { const m = window.Mb2Jeu.Manager.mode; return m ? m.constructor.name : null; });

async function attendreMenu(page) {
  await C.patienter(page, () => { const m = window.Mb2Jeu.Manager.mode; return m && m.balls && m.menu_phase === 1; }, null, 60000);
}

async function genererTitre(nav, sid, elements) {
  console.log('  intro et menu…');
  const page = await ouvrirJeu(nav, sid);
  await C.patienter(page, () => { const m = window.Mb2Jeu.Manager.mode; return m && m.constructor.name === 'Intro'; }, null, 60000);
  const f = path.join(DOSSIER, 'titre.mp4');
  const enc = new C.Encodeur(f);
  // L'intro : les lettres tombent et rebondissent (≈ 4 s), puis le clic.
  for (let i = 0; i < 260; i++) { await C.avancer(page, 1); await enc.ecrire(await C.capturer(page)); }
  await page.mouse.click(960, 540);
  await page.mouse.move(1919, 1079);
  let survol = -1;
  for (let i = 0; i < 420; i++) {
    await C.avancer(page, 1);
    // Une fois les boules en place, la souris en survole une (le cadre
    // d'information monte du bas).
    if (survol < 0 && await page.evaluate(() => { const m = window.Mb2Jeu.Manager.mode; return !!(m && m.menu_phase === 1); })) survol = i;
    if (survol >= 0 && i === survol + 60) {
      const b = await page.evaluate(() => { const m = window.Mb2Jeu.Manager.mode; const x = m.balls.find((o) => o.id === 3) || m.balls[0]; return [x._x, x._y]; });
      const p = await versEcran(page, b[0], b[1]);
      await page.mouse.move(p.x, p.y, { steps: 8 });
    }
    await enc.ecrire(await C.capturer(page));
  }
  await enc.fermer();
  await page.close();
  elements.push(C.elementVideo(JEU, f, {
    titre: 'MotionBall 2 — intro et menu',
    description: 'L\'intro du jeu (les lettres jaunes MOTION BALL qui tombent et rebondissent sur le grand « 2 » violet), puis le menu : les boules aventure, classique, course, challenge, aide et options arrivent en spirale et tournent en orbite ; au survol, le cadre d\'information remonte.',
    usage: 'Carton titre du segment MotionBall ; l\'intro seule (0–4 s) fait un logo animé.',
    affiche: C.affiche(f, path.join(DOSSIER, 'titre.png'), 2.6),
  }));
  elements.push({
    fichier: path.relative(C.SORTIE, C.affiche(f, path.join(DOSSIER, 'menu.png'), 10.5)), jeu: JEU, type: 'image',
    titre: 'MotionBall 2 — le menu (image)', description: 'Le menu en orbite, figé : les six boules du jeu.',
    usage: 'Fond ou affiche.', largeur: 1920, hauteur: 1080, alpha: false,
  });
}

const POIDS = { bonus_blip: 6, bonus_blip2: 6, bonus_blip3: 6, bumper_metal: 3, wall_bump: 1, hide: 12, door_open: 8, object_found: 8, game_over: -100, sound_bdeath: -40 };

async function genererClassique(nav, sid, elements) {
  console.log('  partie Classique…');
  const page = await ouvrirJeu(nav, sid);
  await page.evaluate(installerJournal);
  await page.evaluate(installerIA);
  await C.patienter(page, () => { const m = window.Mb2Jeu.Manager.mode; return m && m.constructor.name === 'Intro'; }, null, 60000);
  await C.avancer(page, 120);
  await page.mouse.click(960, 540);
  await attendreMenu(page);
  await C.avancer(page, 20);
  const b = await page.evaluate(() => { const m = window.Mb2Jeu.Manager.mode; const x = m.balls.find((o) => o.id === 4); return [x._x, x._y]; });
  const p = await versEcran(page, b[0], b[1]);
  await page.mouse.move(p.x, p.y);
  await C.avancer(page, 10);
  await page.mouse.down(); await C.avancer(page, 1); await page.mouse.up();
  await page.mouse.move(1919, 1079);
  await C.patienter(page, () => { const m = window.Mb2Jeu.Manager.mode; return m && m.constructor.name === 'Game'; }, null, 60000);
  const maitre = path.join(DOSSIER, 'classique-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const etat = {};
  const scores = [];
  let fin = -1;
  for (let i = 0; i < 60 * 100; i++) {
    const r = await page.evaluate((ms) => {
      window.__vt.avancer(ms);
      const m = window.Mb2Jeu.Manager.mode;
      const g = m && m.constructor.name === 'Game' ? m : null;
      return { ia: window.__iaMb2(), j: window.__journal.splice(0), jeu: !!g, salle: g ? g.level.pos_x + ',' + g.level.pos_y : '' };
    }, C.IMAGE);
    await appliquer(page, etat, r.ia);
    let s = 0;
    for (const n of r.j) s += POIDS[n] || 0;
    scores.push(s);
    await enc.ecrire(await C.capturer(page));
    if (!r.jeu && fin < 0) fin = i;
    if (fin >= 0 && i - fin > 240) break;
    if (i % 600 === 0) console.log(`    image ${i} salle ${r.salle}`);
  }
  await appliquer(page, etat, {});
  await enc.fermer();
  await page.close();
  const info = C.sonde(maitre);
  elements.push(C.elementVideo(JEU, maitre, {
    titre: 'MotionBall 2 — partie Classique (plan maître)',
    description: 'Le mode Classique d\'un bout à l\'autre : la bille jaune file entre les bumpers, rebondit, plonge dans le trou de sortie et enchaîne les salles contre la montre (cinq secondes gagnées par sortie), jusqu\'au panneau de fin. Pilotée par une IA de navigation.',
    usage: 'Réserve de plans MotionBall.',
    affiche: C.affiche(maitre, path.join(DOSSIER, 'classique-maitre.png'), Math.min(info.duree / 2, 20)),
  }));
  // Deux plans de 10 s, là où il se passe le plus de choses.
  const L = 600;
  const mauvais = scores.map((s) => (s < 0 ? 1 : 0));
  const fenetres = C.meilleuresFenetres(scores, L, 2, { debutMin: 60, interdit: (a, z) => mauvais.slice(a, z + 30).some(Boolean) });
  fenetres.forEach((d, k) => {
    const f = path.join(DOSSIER, `classique-${k + 1}.mp4`);
    C.couper(maitre, f, d / 60, L / 60);
    elements.push(C.elementVideo(JEU, f, {
      titre: `MotionBall 2 — salles en enfilade (${k + 1})`,
      description: 'Dix secondes de mode Classique : la bille dévale la salle, ricoche sur les bumpers et s\'engouffre dans le trou de sortie, salle après salle. Découpé là où les sorties et les rebonds sont les plus nombreux.',
      usage: 'Plan d\'action ; marche bien en accéléré ou en cut rapide.',
      affiche: C.affiche(f, path.join(DOSSIER, `classique-${k + 1}.png`), 5),
    }));
  });
}

async function genererExtras(nav, elements) {
  const j = await C.jaquettePng(nav, 'public/frutiz/sprites/disc_jaquette_mb2.svg', path.join(DOSSIER, 'jaquette.png'), 1200);
  elements.push({ fichier: path.relative(C.SORTIE, j.fichier), jeu: JEU, type: 'image', titre: 'MotionBall 2 — jaquette du disque',
    description: 'La jaquette du disque MotionBall (disc_jaquette_mb2.svg du bureau Frutiz), rendue en PNG transparent.',
    usage: 'Carton de présentation du jeu.', largeur: j.largeur, hauteur: j.hauteur, alpha: true });
  const sons = [
    ['public/mb2/sons/loop$1.mp3', 'musique-boucle-1.ogg', 'MotionBall 2 — musique de jeu (boucle 1)', 'La première boucle musicale des salles.'],
    ['public/mb2/sons/menu.mp3', 'musique-menu.ogg', 'MotionBall 2 — musique du menu', 'La musique du menu.'],
    ['public/mb2/sons/boss_loop.mp3', 'musique-boss.ogg', 'MotionBall 2 — musique du boss', 'La boucle des salles de boss.'],
    ['public/mb2/sons/bumper_metal.mp3', 'bumper.ogg', 'MotionBall 2 — bumper', 'La bille qui frappe un bumper.'],
    ['public/mb2/sons/bonus_blip.mp3', 'bonus.ogg', 'MotionBall 2 — bonus', 'Un bonus ramassé.'],
    ['public/mb2/sons/hide.mp3', 'sortie.ogg', 'MotionBall 2 — plongée dans le trou', 'La bille qui plonge dans le trou de sortie.'],
    ['public/mb2/sons/menu_enter.mp3', 'menu-entree.ogg', 'MotionBall 2 — validation du menu', 'Le son de validation d\'une boule du menu.'],
  ];
  for (const [src, nom, titre, desc] of sons) {
    if (!fs.existsSync(path.join(C.RACINE, src))) { console.warn('  son absent :', src); continue; }
    const f = path.join(DOSSIER, 'sons', nom);
    const duree = C.copierSon(src, f);
    elements.push(C.elementSon(JEU, f, duree, { titre, description: desc + ' Fichier du site (' + src + '), converti en OGG.', usage: 'Bande son du segment MotionBall.' }));
  }
}

async function generer(nav, quoi) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const elements = [];
  const tout = !quoi || !quoi.length;
  const sid = await C.compte('prunox');
  if (tout || quoi.includes('titre')) await genererTitre(nav, sid, elements);
  if (tout || quoi.includes('classique')) await genererClassique(nav, sid, elements);
  if (tout || quoi.includes('extras')) await genererExtras(nav, elements);
  return elements;
}

module.exports = { JEU, generer };

if (require.main === module) {
  (async () => {
    await C.demarrerServeur();
    const nav = await C.ouvrirNavigateur();
    try {
      const elements = await generer(nav, process.argv.slice(2));
      C.ecrireFragment(JEU, elements, process.argv.length > 2);
      console.log(`${JEU} : ${elements.length} éléments`);
    } finally {
      await nav.close();
      C.arreterServeur();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
