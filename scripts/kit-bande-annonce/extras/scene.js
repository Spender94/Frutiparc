/*
 * LE TOURNAGE D'UNE SCÈNE — une page du site, une ligne de temps, un curseur.
 *
 * Une scène est une liste de PLANS datés (en secondes) :
 *
 *   { t: 1.2, vers: '.home-tile[data-go="shop"]', duree: 0.7, clic: true }
 *       le curseur glisse (accélération douce) vers le centre de l'élément,
 *       puis CLIQUE pour de vrai (page.mouse — les vrais gestionnaires du
 *       site) ; le curseur dessiné s'enfonce un instant ;
 *   { t: 3, faire: async (page) => { … } }
 *       n'importe quelle action (taper du texte, appeler l'API…) ;
 *   { t: 5, reseau: 800 }
 *       laisse au réseau `ms` de temps RÉEL sans avancer l'horloge de la page
 *       (une fenêtre qui charge ses données au clic les reçoit avant l'image
 *       suivante : à l'écran, la connexion est simplement rapide).
 *
 * Le curseur est un calque ajouté à la page (pointer-events: none), la seule
 * chose qui ne vient pas du site : il « mime » les clics, comme dans le kit
 * existant. La vraie souris le suit, pour que les survols du site réagissent.
 *
 * Chaque image : on avance l'horloge de 1/60 s (Capture.avancer), on pose le
 * curseur, on photographie, on pousse dans ffmpeg. Rien n'est écrit sur disque
 * avant l'encodage.
 */
'use strict';

const C = require('./commun.js');

const CURSEUR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38">'
  + '<path d="M2 2 L2 31 L9 24.5 L13.6 35.5 L18.4 33.4 L13.9 22.8 L23.5 22.8 Z" fill="#fff" stroke="#000" '
  + 'stroke-width="2" stroke-linejoin="round"/></svg>';

async function poserCurseur(page) {
  await page.evaluate((svg) => {
    if (document.getElementById('kit-curseur')) return;
    const d = document.createElement('div');
    d.id = 'kit-curseur';
    d.innerHTML = svg;
    d.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:38px;z-index:2147483647;'
      + 'pointer-events:none;transform-origin:2px 2px;will-change:transform;'
      + 'filter:drop-shadow(1px 2px 1px rgba(0,0,0,.35))';
    document.documentElement.appendChild(d);
  }, CURSEUR_SVG);
}

// Le doigt (scènes sur téléphone) : une pastille, comme l'option « afficher
// les appuis » d'Android, qui ne paraît qu'au moment où l'on touche.
const DOIGT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">'
  + '<circle cx="22" cy="22" r="19" fill="rgba(255,255,255,.45)" stroke="#fff" stroke-width="3"/></svg>';

async function placerCurseur(page, x, y, enfonce, visible, doigt) {
  await page.evaluate(([x, y, k, v, svg, doigt]) => {
    let d = document.getElementById('kit-curseur');
    if (!d) {
      // Absent : la page vient d'être (re)chargée — on le repose.
      d = document.createElement('div');
      d.id = 'kit-curseur';
      d.innerHTML = svg;
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;'
        + (doigt ? 'width:44px;height:44px;margin:-20px 0 0 -20px;' : 'width:26px;height:38px;transform-origin:2px 2px;'
        + 'filter:drop-shadow(1px 2px 1px rgba(0,0,0,.35))');
      document.documentElement.appendChild(d);
    }
    d.style.display = v ? 'block' : 'none';
    d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + k + ')';
  }, [x, y, enfonce ? 0.82 : 1, visible !== false, doigt ? DOIGT_SVG : CURSEUR_SVG, !!doigt]);
}

async function centreDe(page, cible) {
  if (Array.isArray(cible)) return { x: cible[0], y: cible[1] };
  const b = await page.locator(cible).first().boundingBox();
  if (!b) throw new Error('élément introuvable : ' + cible);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const douce = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/*
 * Tourne la scène. `cap` est une Capture déjà ouverte sur la page ; `enc` un
 * encodeur (ou une fonction qui reçoit chaque image) ; `duree` en secondes.
 * `clip` recadre la photo (en pixels CSS). `depart` : position initiale du
 * curseur ; `curseur: false` pour une scène sans curseur.
 */
async function tourner(cap, plans, opts) {
  const page = cap.page;
  const fps = cap.opts.fps || 60;
  const n = Math.round(opts.duree * fps);
  const avecCurseur = opts.curseur !== false;
  // Les instants où le doigt touche l'écran (scènes « doigt ») : la fin de
  // chaque déplacement suivi d'un clic.
  const appuis = plans.filter((p) => p.clic).map((p) => p.t + (p.duree || 0.6));
  const doigtVisible = (t) => appuis.some((a) => t >= a - 0.16 && t <= a + 0.22);
  let pos = Object.assign({ x: 640, y: 420 }, opts.depart || {});
  let mouvement = null;               // { de, vers, t0, t1, clic }
  let enfonceJusqua = -1;
  const reste = plans.slice().sort((a, b) => a.t - b.t);
  const affiches = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    while (reste.length && reste[0].t <= t + 1e-9) {
      const p = reste.shift();
      if (p.vers !== undefined) {
        const c = await centreDe(page, p.vers);
        const vers = { x: c.x + (p.dx || 0), y: c.y + (p.dy || 0) };
        mouvement = { de: Object.assign({}, pos), vers, t0: t, t1: t + (p.duree || 0.6), clic: !!p.clic, apres: p.apres, reseau: p.reseau };
      }
      // Un clic sur place (la même flèche, plusieurs fois en rythme).
      if (p.clicIci) {
        await page.mouse.down(); await page.mouse.up();
        enfonceJusqua = i + Math.round(0.08 * fps);
      }
      if (p.faire) await p.faire(page, cap);
      if (p.reseau && p.vers === undefined) await C.attendre(p.reseau);
      if (p.affiche) affiches.push(i);
    }
    if (mouvement) {
      const u = Math.min(1, (t - mouvement.t0) / Math.max(1e-6, mouvement.t1 - mouvement.t0));
      const k = douce(u);
      pos = { x: mouvement.de.x + (mouvement.vers.x - mouvement.de.x) * k,
        y: mouvement.de.y + (mouvement.vers.y - mouvement.de.y) * k };
      await page.mouse.move(pos.x, pos.y);
      if (u >= 1) {
        const m = mouvement; mouvement = null;
        if (m.clic) {
          await page.mouse.down(); await page.mouse.up();
          enfonceJusqua = i + Math.round(0.12 * fps);
          if (m.reseau) await C.attendre(m.reseau);
        }
        if (m.apres) await m.apres(page, cap);
      }
    }
    await cap.avancer(1000 / fps);
    if (avecCurseur) {
      const visible = opts.doigt ? doigtVisible(t) : (opts.curseurVisible ? opts.curseurVisible(t) : true);
      await placerCurseur(page, pos.x - 2, pos.y - 2, i < enfonceJusqua, visible, opts.doigt);
    }
    const img = await cap.image(opts.clip);
    if (typeof opts.enc === 'function') await opts.enc(img, i);
    else await opts.enc.ecrire(img);
    if (opts.affiche !== undefined && i === Math.round(opts.affiche * fps) && opts.surAffiche) await opts.surAffiche(img);
  }
  return { images: n, affiches };
}

/*
 * Le préchauffage : avant de tourner, on laisse la page se charger et parler
 * au serveur (WebSocket du chat, fetch) en avançant son horloge par petits
 * pas, avec un vrai délai entre chaque — sans quoi les réponses réseau
 * arriveraient pendant le tournage.
 */
async function prechauffer(cap, secondes, pasReel) {
  const pas = 100;
  for (let t = 0; t < secondes * 1000; t += pas) {
    await cap.page.clock.runFor(pas);
    await C.attendre(pasReel || 30);
  }
  cap.t = 0;
  await cap.page.evaluate(() => { if (window.__kitAnims) window.__kitAnims.vues = new WeakMap(); });
}

module.exports = { tourner, prechauffer, poserCurseur, placerCurseur, centreDe };
