#!/usr/bin/env node
// Sort les dessins de la FICHE user — les vrais, ceux de main.swf et de sa
// banque d'icônes fileIcon.swf — pour l'écran du mobile.
//
//   node scripts/extract-fiche-assets.js      → écrit public/fb/fiche/*.png
//
// ── D'où vient quoi ──
//
// La fiche du bureau (win.Frutiz + cp.FrutizBasicInfo) est assemblée par code :
// des boutons roses (pinkBut, butPush*SmallPink), des icônes de fichiers
// chargées depuis /fileIcon.swf (sprite iconGFX, une étiquette par type :
// mail, contact, linkChat, linkBlogs…), le petit triangle icoArrow teinté à
// l'exécution, et le bandeau clair butGfxFrutizInfoTitleBg sous les titres de
// section (« frutisigne »).

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public/fb/fiche');
const TRAVAIL = path.join(RACINE, 'data/fiche-travail');
const K = 3;                        // rendu à 3× pour les écrans denses

// Chaque cible : le SWF, le clip, l'image — et parfois SEULEMENT certaines
// formes (le chrome d'un bouton sans son glyphe) ou une teinte (le triangle).
const CIBLES = [
  // Le chrome carré des boutons d'action : butPushVerySmallPink sans son
  // glyphe « » » (forme 457) — il ne reste que le carré rose.
  { swf: 'legacy/main.swf', nom: 'butPushVerySmallPink', image: 1,
    fichier: 'bouton_carre', garder: [456] },
  // Le bouton « liste » complet — le deuxième de la rangée du bureau.
  { swf: 'legacy/main.swf', nom: 'butPushSmallPink', image: 1, fichier: 'bouton_liste' },
  // Le triangle (icoArrow, pointe en bas) — le bureau le teinte à l'exécution.
  { swf: 'legacy/main.swf', nom: 'icoArrow', image: 2, fichier: 'triangle', teinte: 0xE2574B },
  // Le bandeau clair sous les titres de section (« frutisigne »).
  { swf: 'legacy/main.swf', nom: 'butGfxFrutizInfoTitleBg', image: 8, fichier: 'bandeau_titre' },
  // Les icônes de la banque du bureau (fileIcon.swf, sprite iconGFX).
  { swf: 'public/fileIcon.swf', nom: 'iconGFX', image: 49, fichier: 'ico_chat' },
  { swf: 'public/fileIcon.swf', nom: 'iconGFX', image: 9, fichier: 'ico_mail' },
  { swf: 'public/fileIcon.swf', nom: 'iconGFX', image: 132, fichier: 'ico_blog' },
  { swf: 'public/fileIcon.swf', nom: 'iconGFX', image: 14, fichier: 'ico_contact' },
];

fs.mkdirSync(TRAVAIL, { recursive: true });
fs.mkdirSync(SORTIE, { recursive: true });

const lecteurs = {};
const cellules = [];
const parSwf = {};
for (const c of CIBLES) {
  const chemin = path.join(RACINE, c.swf);
  const r = lecteurs[c.swf] || (lecteurs[c.swf] = ouvrir(chemin));
  const id = r.noms.get(c.nom);
  let pieces = r.aplatir(id, r.IDENTITE, 0, c.image, '', null);
  if (c.garder) pieces = pieces.filter((p) => c.garder.includes(p.shape));
  const prefixe = c.swf.includes('fileIcon') ? 'fi' : 'mn';
  (parSwf[c.swf] = parSwf[c.swf] || new Set());
  for (const p of pieces) parSwf[c.swf].add(p.shape);
  cellules.push({ fichier: c.fichier, prefixe, pieces, teinte: c.teinte || null });
}
for (const [swf, formes] of Object.entries(parSwf)) {
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), path.join(RACINE, swf),
      TRAVAIL, ...[...formes].map(String)], { encoding: 'utf8' });
  const prefixe = swf.includes('fileIcon') ? 'fi' : 'mn';
  for (const f of formes) {
    const src = path.join(TRAVAIL, 'shape' + f + '.svg');
    if (fs.existsSync(src)) fs.renameSync(src, path.join(TRAVAIL, prefixe + f + '.svg'));
  }
}
const donnees = cellules.map((c) => ({
  fichier: c.fichier,
  teinte: c.teinte,
  pieces: c.pieces.map((p) => {
    const t = fs.readFileSync(path.join(TRAVAIL, c.prefixe + p.shape + '.svg'), 'utf8');
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(t);
    return { f: c.prefixe + p.shape + '.svg', vb: [+m[1], +m[2], +m[3], +m[4]],
      m: [p.M.a, p.M.b, p.M.c, p.M.d, p.M.e / 20, p.M.f / 20] };
  }),
}));
fs.writeFileSync(path.join(TRAVAIL, 'fiche.json'), JSON.stringify(donnees));

const rendu = path.join(TRAVAIL, 'rendu.js');
fs.writeFileSync(rendu, `
const { chromium } = require(${JSON.stringify(path.join(RACINE, 'node_modules/playwright'))});
const fs = require('fs');
const TRAVAIL = ${JSON.stringify(TRAVAIL)};
const SORTIE = ${JSON.stringify(SORTIE)};
const K = ${K};
(async () => {
  const donnees = JSON.parse(fs.readFileSync(TRAVAIL + '/fiche.json', 'utf8'));
  const svgs = {};
  for (const c of donnees) for (const p of c.pieces) {
    if (!svgs[p.f]) svgs[p.f] = 'data:image/svg+xml;base64,'
      + fs.readFileSync(TRAVAIL + '/' + p.f).toString('base64');
  }
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await nav.newPage({ viewport: { width: 900, height: 300 } });
  await page.setContent('<canvas id="c"></canvas>');
  for (const c of donnees) {
    const url = await page.evaluate(async ({ c, svgs, K }) => {
      const images = {};
      await Promise.all(c.pieces.map((p) => new Promise((res) => {
        if (images[p.f]) return res();
        const i = new Image(); i.onload = () => { images[p.f] = i; res(); }; i.onerror = res;
        i.src = svgs[p.f];
      })));
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of c.pieces) {
        const [a, b, cc, d, e, f] = p.m;
        for (const [qx, qy] of [[p.vb[0], p.vb[1]], [p.vb[0] + p.vb[2], p.vb[1]],
          [p.vb[0], p.vb[1] + p.vb[3]], [p.vb[0] + p.vb[2], p.vb[1] + p.vb[3]]]) {
          const X = a * qx + cc * qy + e, Y = b * qx + d * qy + f;
          x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
        }
      }
      const cv = document.getElementById('c');
      cv.width = Math.max(1, Math.ceil((x1 - x0) * K));
      cv.height = Math.max(1, Math.ceil((y1 - y0) * K));
      const ctx = cv.getContext('2d');
      for (const p of c.pieces) {
        const img = images[p.f];
        if (!img) continue;
        const [a, b, cc, d, e, f] = p.m;
        ctx.save();
        ctx.scale(K, K);
        ctx.translate(-x0, -y0);
        ctx.transform(a, b, cc, d, e, f);
        ctx.drawImage(img, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
        ctx.restore();
      }
      // Mc.setColor : sortie = source + (couleur − 255) — le triangle du
      // bureau est un dessin neutre teinté à l'exécution.
      if (c.teinte !== null) {
        const d2 = ctx.getImageData(0, 0, cv.width, cv.height);
        const px = d2.data;
        const dr = ((c.teinte >> 16) & 255) - 255, dv = ((c.teinte >> 8) & 255) - 255, db = (c.teinte & 255) - 255;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue;
          px[i] = Math.max(0, Math.min(255, px[i] + dr));
          px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + dv));
          px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + db));
        }
        ctx.putImageData(d2, 0, 0);
      }
      return cv.toDataURL('image/png');
    }, { c, svgs, K });
    fs.writeFileSync(SORTIE + '/' + c.fichier + '.png', Buffer.from(url.split(',')[1], 'base64'));
    console.log(c.fichier + '.png');
  }
  await nav.close();
})();
`);
const res = spawnSync(process.execPath, [rendu], { encoding: 'utf8' });
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');
console.log('→ public/fb/fiche/*.png');
