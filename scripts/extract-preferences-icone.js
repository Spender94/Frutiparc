#!/usr/bin/env node
// Sort l'ICÔNE DES PRÉFÉRENCES du bureau, pour que le panneau de l'appli
// porte le même dessin que le raccourci d'origine.
//
//   node scripts/extract-preferences-icone.js
//
// ── D'où elle vient ──
//
// Même feuille que le Club (cf. extract-club-icone.js) : main.swf charge
// public/fileIcon.swf, dont le clip 223 est la FEUILLE DES LIENS — une image
// par raccourci, étiquetée (link, linkForum, linkChat, linkShop, linkHisto,
// linkScore, linkPreference, linkClub, linkBlogs…), que le bureau choisit par
// gotoAndStop(<nom>).
//
// « linkPreference » est l'image 76. On la sort EN VECTEUR (extract-swf-shapes)
// plutôt qu'en capture : le dessin d'origine, net à toutes les tailles et sur
// fond transparent, comme les autres icônes SVG du light (club, messagerie,
// historique, évènements).
//
// Idempotent : relancer réécrit le même fichier.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');
const { imageDe, CLIP } = require('./extract-club-icone.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'public', 'fileIcon.swf');
const SORTIE = path.join(RACINE, 'public', 'fb', 'icone_preferences.svg');
const ETIQUETTE = 'linkPreference';

function principal() {
  const G = require('./lib/swf-greffe.js');
  const { body } = G.lireSwf(SWF);
  const image = imageDe(body, CLIP, ETIQUETTE);
  if (!image) throw new Error(`l'étiquette « ${ETIQUETTE} » est introuvable dans le clip ${CLIP}`);

  const swf = ouvrir(SWF);
  const pieces = swf.aplatir(CLIP, swf.IDENTITE, 0, image, '', null)
    .filter((p) => !p.masque);
  if (pieces.length !== 1) {
    throw new Error(`image ${image} : ${pieces.length} formes, une seule attendue`);
  }
  const forme = pieces[0].shape;
  console.log(`« ${ETIQUETTE} » = image ${image} du clip ${CLIP}, forme ${forme}`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-'));
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF, temp, String(forme)],
    { cwd: RACINE, encoding: 'utf8' });
  const svg = fs.readFileSync(path.join(temp, `shape${forme}.svg`), 'utf8');
  fs.rmSync(temp, { recursive: true, force: true });

  fs.writeFileSync(SORTIE, svg, 'utf8');
  const m = /viewBox="([^"]+)"/.exec(svg);
  console.log(`→ ${path.relative(RACINE, SORTIE)} (viewBox ${m ? m[1] : '?'}, ${svg.length} octets)`);
}

if (require.main === module) principal();
module.exports = { ETIQUETTE };
