'use strict';
/*
 * L'AIDE DES TESTS DE SWAPOU : de vraies parties, jouées par le bot dans un
 * bac à sable du jeu, et rendues au serveur comme le ferait un navigateur.
 *
 * Depuis que le serveur rejoue chaque partie AVANT de classer son score, un
 * test ne peut plus poser « 9000 points » d'un formulaire : il lui faut une
 * partie, sa graine, ses coups — et du temps. Le bot joue en une fraction de
 * seconde ce qu'un joueur joue en plusieurs minutes ; l'horloge du bac à
 * sable est donc SIMULÉE (elle avance de 25 ms par image du jeu, plus le
 * temps de réflexion choisi avant chaque coup), et la graine est vieillie en
 * base d'autant (vieillir) : pour le serveur, la partie a duré ce qu'elle
 * dit.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function bac() {
  const horloge = { t: 1000 };
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams, performance: { now: () => horloge.t }, Date, Math, JSON,
  };
  s.self = s; s.window = s;
  vm.createContext(s);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js', 'bot.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/swapou', f), 'utf8'), s, { filename: f });
  }
  s.SW.Manager.init('');
  s.horloge = horloge;
  return s;
}

/**
 * Une partie de Challenge complète, jouée par le bot.
 * @param {object} sb      le bac à sable (bac())
 * @param {{id, graine}|null} partie  la partie donnée par le serveur (null : graine locale)
 * @param {number} perso
 * @param {{ reflexionMs?:number, pasVariable?:boolean }} [o]
 * @returns {{ score, pf, combos, tempsJeuMs }} pf : le récit (id, graine, coups, duree)
 */
function jouer(sb, partie, perso, o) {
  o = o || {};
  const reflexion = o.reflexionMs === undefined ? 400 : o.reflexionMs;
  const SW = sb.SW, M = SW.Manager, Bot = sb.SwapouBot;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.essai = false;
  SW.Data.players = [perso, -1];
  if (M.mode && M.mode.destroy) M.mode.destroy();
  M.client.partie = partie;
  M.mode = new SW.Challenge();
  const chal = M.mode;
  // Les combos tels que le JEU les compte (la fiche du bac à sable).
  const combos = new Array(11).fill(0);
  const addCombo = SW.TItem.addCombo;
  SW.TItem.addCombo = (n) => { combos[n]++; };
  let tj = 0, k = 0;
  try {
    while (M.mode === chal) {
      if (!chal.lock && !chal.pause.activated()) {
        const mv = Bot.choose(chal.player.level, { charId: perso, canDefend: false, stars: chal.player.star_counter, ncoups: chal.ncoups });
        if (mv.type === 'none') break;
        sb.horloge.t += reflexion;
        const info = chal.player.animator.getInfos(), p = mv.pair;
        if (p.dx === 1) SW.handleMouseMove(info.px + p.x * 35 + 30, info.py + p.y * 35 + 17);
        else SW.handleMouseMove(info.px + p.x * 35 + 17, info.py + p.y * 35 + 30);
        chal.onClickDown();
      }
      const t = o.pasVariable ? 0.3 + ((k++ * 7919) % 37) / 10 : 2;
      sb.horloge.t += t * 25;
      tj += t * 25;
      M.main(t, t / 40);
    }
  } finally {
    SW.TItem.addCombo = addCombo;
  }
  const pf = M.client.partieFinie;
  M.client.partieFinie = null;
  return { score: chal.player.score, pf, combos, tempsJeuMs: Math.round(tj) };
}

// Le formulaire, comme le client du jeu (URLSearchParams).
function formulaire(base, url, champs) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(champs)) if (v !== undefined && v !== null) body.set(k, String(v));
  return fetch(base + url, { method: 'POST', body });
}
async function nouvellePartie(base, sid, essai) {
  const j = await (await formulaire(base, '/api/swapou/partie', { sid, essai: essai ? '1' : undefined })).json();
  if (!(j.ok && /^[a-f0-9]{24}$/.test(j.id) && Number.isInteger(j.graine))) throw new Error('pas de graine : ' + JSON.stringify(j));
  return { id: j.id, graine: j.graine };
}
/*
 * La graine a été donnée il y a `ms` : sa ligne en base recule d'autant (le
 * serveur prend la plus ancienne de ses deux horloges, la mémoire et la
 * base). La ligne s'écrit sans qu'on l'attende : on la guette.
 */
async function vieillir(sql, id, ms) {
  for (let i = 0; i < 100; i++) {
    const r = await sql(`UPDATE swapou_parties SET cree_le = now() - make_interval(secs => $2::float / 1000)
                          WHERE id = $1 RETURNING id`, [id, Math.round(ms)]);
    if (r.length) return;
    await new Promise((ok) => setTimeout(ok, 30));
  }
  throw new Error('la graine ' + id + ' n’est jamais arrivée en base');
}
async function rendre(base, sid, score, pf, perso, extra) {
  const champs = Object.assign({ sid, game: 'swapou2', m: 0, score, data: 'S' + perso + ':' }, extra || {});
  if (pf) {
    if (pf.id) champs.partie = pf.id; else champs.graine = pf.graine;
    champs.coups = pf.coups;
    champs.duree = pf.duree;
  }
  const r = await formulaire(base, '/api/saveScore', champs);
  return { status: r.status, json: await r.json() };
}
/*
 * Une partie honnête, de bout en bout : graine, partie jouée par le bot,
 * graine vieillie de la durée de la partie (et d'une seconde de réseau),
 * score rendu. Rend { partie, score, pf, combos, rep }.
 */
async function partieHonnete(base, sql, sid, perso, o) {
  const sb = (o && o.sb) || bac();
  const partie = await nouvellePartie(base, sid);
  const j = jouer(sb, partie, perso, o);
  await vieillir(sql, partie.id, j.pf.duree + 1000);
  const rep = await rendre(base, sid, j.score, j.pf, perso);
  return Object.assign({ partie, rep }, j);
}

module.exports = { bac, jouer, formulaire, nouvellePartie, vieillir, rendre, partieHonnete };
