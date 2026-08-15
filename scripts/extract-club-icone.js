#!/usr/bin/env node
// Sort l'ICÔNE DU CLUB du bureau, pour que le portage light affiche la même.
//
//   node scripts/extract-club-icone.js
//
// ── D'où elle vient ──
//
// Les icônes de la rangée du bureau ne sont pas dessinées dans main.swf : il
// charge public/fileIcon.swf, dont le clip 223 est la FEUILLE DES LIENS — une
// image par raccourci, étiquetée (link, linkForum, linkChat, linkShop,
// linkHisto, linkScore, linkPreference, linkClub, linkBlogs…), que le bureau
// choisit par gotoAndStop(<nom>). C'est la même feuille que les classements
// interrogent : LEGACY_RANKINGS pose g='linkClub' sur les classements « Club »
// (XP, consécration) pour hériter de ce dessin.
//
// L'image 84 (« linkClub ») porte UNE seule forme, la 210, posée à l'identité :
// la prune violette du Club. On la sort donc EN VECTEUR (extract-swf-shapes),
// pas en capture d'écran — le dessin d'origine, net à toutes les tailles, sur
// fond transparent, comme les autres icônes SVG du light (messagerie,
// historique, évènements, kikooz).
//
// Idempotent : relancer réécrit le même fichier.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'public', 'fileIcon.swf');
const SORTIE = path.join(RACINE, 'public', 'fb', 'icone_club.svg');
const CLIP = 223;                                  // la feuille des liens
const ETIQUETTE = 'linkClub';

/** Le numéro d'image que porte une étiquette, dans un clip donné. */
function imageDe(body, clip, nom) {
  let trouvee = 0;
  const visiter = (from, to, id) => {
    let o = from, img = 1;
    while (o < to - 1) {
      const hdr = body.readUInt16LE(o);
      const code = hdr >> 6;
      let len = hdr & 0x3f, h = 2;
      if (len === 0x3f) { len = body.readUInt32LE(o + 2); h = 6; }
      if (code === 0) return;
      if (code === 43 && id === clip) {
        const fin = body.indexOf(0, o + h);
        if (body.slice(o + h, fin).toString('latin1') === nom) trouvee = img;
      }
      if (code === 1) img++;
      if (code === 39) visiter(o + h + 4, o + h + len, body.readUInt16LE(o + h));
      o += h + len;
    }
  };
  const nbits = (body[0] >> 3) & 0x1f;
  visiter(Math.ceil((5 + nbits * 4) / 8) + 4, body.length, null);
  return trouvee;
}

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

  // extract-swf-shapes écrit shape<N>.svg dans un dossier : on passe par un
  // dossier temporaire, puis on renomme à destination.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'club-'));
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
module.exports = { imageDe, CLIP, ETIQUETTE };
