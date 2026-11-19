'use strict';
/*
 * FICHIERS STATIQUES COMPRESSÉS UNE FOIS POUR TOUTES.
 *
 * `compression` recompresse chaque fichier texte à chaque requête, avec un
 * compresseur zlib de ~256 Ko de mémoire native par réponse en vol. Ici, la
 * première requête d'un fichier le fait compresser en tâche de fond vers un
 * dossier de cache (nom = chemin + date + taille : un fichier modifié donne
 * une autre entrée) ; les suivantes reçoivent ce .gz tel quel, lu en flux
 * depuis le disque : aucun compresseur ouvert.
 *
 * Mêmes en-têtes qu'express.static (ETag faible, Last-Modified, 304), plus
 * X-Taille-Reelle. Les requêtes Range, les clients sans gzip, les fichiers
 * < 1 Ko ou non compressibles passent leur chemin vers express.static.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const etag = require('etag');
const mime = require('mime-types');
const compressible = require('compressible');

const DOSSIER = process.env.PRECOMP_DIR || path.join(os.tmpdir(), 'frutiparc-gz');
fs.mkdirSync(DOSSIER, { recursive: true });

const prets = new Map();      // clé → taille du .gz (connus prêts)
const enCours = new Set();
const file = [];
let actif = false;
const stats = { servis: 0, prepares: 0, echecs: 0 };

function cle(abs, st) {
  return crypto.createHash('sha1').update(abs).digest('hex').slice(0, 20)
    + '-' + Math.floor(st.mtimeMs) + '-' + st.size + '.gz';
}

function suivant() {
  if (actif || !file.length) return;
  actif = true;
  const { abs, nom } = file.shift();
  const tmp = path.join(DOSSIER, nom + '.' + process.pid + '.tmp');
  fs.createReadStream(abs)
    .pipe(zlib.createGzip({ level: 9 }))
    .pipe(fs.createWriteStream(tmp))
    .on('finish', () => {
      fs.rename(tmp, path.join(DOSSIER, nom), (err) => {
        enCours.delete(nom); actif = false;
        if (err) stats.echecs++;
        else { stats.prepares++; prets.set(nom, fs.statSync(path.join(DOSSIER, nom)).size); }
        suivant();
      });
    })
    .on('error', () => { enCours.delete(nom); actif = false; stats.echecs++; fs.rm(tmp, () => {}); suivant(); });
}

function precompresse(racine, opts = {}) {
  const racineAbs = path.resolve(racine);
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range) return next();
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0')) return next();
    if (rel.endsWith('/')) rel += 'index.html';
    const abs = path.join(racineAbs, path.normalize(rel));
    if (!abs.startsWith(racineAbs + path.sep)) return next();
    if (path.basename(abs).startsWith('.')) return next();
    const type = mime.lookup(abs);
    if (!type || !compressible(type) || type === 'application/x-shockwave-flash') return next();
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile() || st.size < 1024) return next();
      const nom = cle(abs, st);
      const gz = prets.get(nom);
      if (gz === undefined) {
        // Pas encore prêt : déjà sur le disque (redémarrage) ? sinon on le prépare.
        fs.stat(path.join(DOSSIER, nom), (e2, s2) => {
          if (!e2 && s2.isFile()) prets.set(nom, s2.size);
          else if (!enCours.has(nom)) { enCours.add(nom); file.push({ abs, nom }); suivant(); }
          next();
        });
        return;
      }
      res.setHeader('Content-Type', mime.contentType(path.extname(abs)) || type);
      res.setHeader('ETag', etag(st));
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', opts.maxAge ? `public, max-age=${opts.maxAge}${opts.immutable ? ', immutable' : ''}` : 'public, max-age=0');
      }
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('X-Taille-Reelle', String(st.size));
      if (req.fresh) { res.statusCode = 304; return res.end(); }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(gz));
      if (req.method === 'HEAD') return res.end();
      stats.servis++;
      fs.createReadStream(path.join(DOSSIER, nom)).on('error', () => res.destroy()).pipe(res);
    });
  };
}

precompresse.stats = stats;
module.exports = precompresse;
