/*
 * KIT BANDE-ANNONCE — sections « pictos-frutisnake » et « frusion-fd » :
 * le serveur local et les réglages communs.
 *
 * On réutilise la boîte à outils de la section « extras » (Capture à horloge
 * pilotée, encodeur ffmpeg par pipe, ffprobe) : ce module fixe AVANT de la
 * charger le port (4470, dans la plage 4400–4499), la clé d'admin et la base,
 * puis lance le VRAI serveur du parc à notre façon :
 *
 *   · depuis un lien symbolique À NOUS (Express répond 404 sur un chemin qui
 *     traverse `.claude/…`, cf. extras/commun.js) — pas celui des extras, qu'un
 *     autre tournage pourrait utiliser au même moment ;
 *   · avec une base Postgres à nous (kit_frusion_fd) : sans base, l'admin ne
 *     peut pas poser la bouille du compte fictif.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.KIT_PORT || 4470);
process.env.KIT_PORT = String(PORT);
process.env.KIT_ADMIN_KEY = process.env.KIT_ADMIN_KEY || 'kit-frusion-fd';
process.env.KIT_DATABASE_URL = process.env.KIT_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/kit_frusion_fd';

const C = require('../extras/commun.js');

const KIT = C.KIT;
function sortie(section, ...p) {
  const d = path.join(KIT, section, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function assurerBase() {
  const pret = () => { try { execFileSync('pg_isready', ['-h', '127.0.0.1', '-p', '5433'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
  if (!pret()) {
    try {
      execFileSync('setsid', ['su', 'postgres', '-c', "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg-frutiparc-test -o '-p 5433 -k /tmp' -l /tmp/pg-frutiparc-test.log -w start"], { stdio: 'ignore' });
    } catch (e) { /* lancé par un autre entre-temps */ }
  }
  const nom = process.env.KIT_DATABASE_URL.split('/').pop();
  try { execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-c', 'create database ' + nom], { stdio: 'ignore' }); } catch (e) { /* existe déjà */ }
}

/** Lance le serveur (ou réutilise celui qui répond déjà sur le port). */
async function demarrer(opts) {
  opts = opts || {};
  try {
    if ((await fetch(C.BASE + '/light')).status === 200) return { base: C.BASE, arreter() {} };
  } catch (e) { /* personne : on le lance */ }
  if (opts.base !== false) assurerBase();
  let racine = C.RACINE;
  if (racine.split(path.sep).some((s) => s.startsWith('.'))) {
    racine = path.join(os.tmpdir(), 'frutiparc-kit-frusion-fd-' + PORT);
    try { fs.unlinkSync(racine); } catch (e) { /* absent */ }
    fs.symlinkSync(C.RACINE, racine);
  }
  const journal = fs.openSync(path.join(os.tmpdir(), 'frutiparc-kit-frusion-fd-serveur.log'), 'w');
  const enfant = spawn(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
      cwd: os.tmpdir(),
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DATABASE_URL: opts.base === false ? '' : process.env.KIT_DATABASE_URL,
        REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', ADMIN_KEY: process.env.KIT_ADMIN_KEY,
        XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
      }),
      stdio: ['ignore', journal, journal],
    });
  for (let i = 0; i < 120; i++) {
    await C.attendre(500);
    try { if ((await fetch(C.BASE + '/light')).status === 200) break; } catch (e) { /* pas encore */ }
    if (enfant.exitCode !== null) throw new Error('le serveur est tombé au démarrage');
  }
  return { base: C.BASE, arreter() { try { enfant.kill(); } catch (e) { /* déjà parti */ } } };
}

/** Une entrée vidéo de manifeste, mesurée par ffprobe (chemin relatif à `dossier`). */
function entreeVideo(dossier, rel, champs) {
  const s = C.sonder(path.join(dossier, rel));
  return Object.assign({ fichier: rel, type: 'video' }, champs, {
    duree: s.duree, fps: s.fps, largeur: s.largeur, hauteur: s.hauteur,
    alpha: champs.alpha !== undefined ? champs.alpha : s.alpha, octets: s.octets,
  });
}

module.exports = { C, PORT, KIT, sortie, demarrer, entreeVideo };
