#!/usr/bin/env node
// Sort les DISQUES Frusion officiels des chargeurs de jeu.
//
//   node scripts/extract-frusion-discs.js            → écrit les SVG + un manifeste
//   node scripts/extract-frusion-discs.js --liste    → montre les images du clip
//
// ── Où vivent les disques ──
//
// Chaque jeu Frutiparc est distribué par un CHARGEUR (loader_<jeu>.swf) : c'est
// lui que le lecteur Frusion insère, et c'est lui qui porte le dessin du disque
// — le clip `frusion`, dix-sept images d'animation où le disque tourne. Le jeu
// lui-même n'a pas son disque : il est DANS le disque.
//
// On aplatit chaque image du clip et on laisse un navigateur composer le PNG :
// les formes sont des SVG, exactement comme pour les sprites de Minipixiz.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public/fb/frusion-discs');

const DISQUES = [
  { cle: 'minipixiz', swf: 'Games/miniTroll/loader_minipixiz.swf' },
  { cle: 'miniwave', swf: 'Games/miniWave2/loader_miniwave.swf' },
];

fs.mkdirSync(SORTIE, { recursive: true });

const manifeste = {};
for (const d of DISQUES) {
  const chemin = path.join(RACINE, d.swf);
  const r = ouvrir(chemin);
  const id = r.noms.get('frusion');
  if (id === undefined) { console.log(d.cle + ' : pas de clip frusion'); continue; }
  const tl = r.parSprite.get(id);
  const etats = [];
  const formes = new Set();
  for (const [f, ph] of tl) {
    const pieces = [];
    for (const p of ph) {
      const morceaux = r.aplatir(p.ch, p.M, 0, f, p.nom || '', p.cx || null);
      if (p.masque) for (const m of morceaux) m.masque = true;
      pieces.push(...morceaux);
    }
    for (const pc of pieces) formes.add(pc.shape);
    etats.push({ frame: f, pieces });
  }

  // Les SVG des formes, préfixés par jeu pour ne pas se marcher dessus.
  const dossier = path.join(SORTIE, d.cle);
  fs.mkdirSync(dossier, { recursive: true });
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), chemin, dossier, ...[...formes].map(String)],
    { encoding: 'utf8' });

  // Le manifeste : mêmes conventions que les sprites de Minipixiz — la matrice
  // absolue de chaque pièce, translation en pixels.
  const cadre = (fichier) => {
    const t = fs.readFileSync(path.join(dossier, fichier), 'utf8');
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(t);
    return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : { x: -50, y: -50, w: 100, h: 100 };
  };
  manifeste[d.cle] = {
    etats: etats.map((e) => ({
      frame: e.frame,
      pieces: e.pieces.map((pc) => {
        const fichier = 'shape' + pc.shape + '.svg';
        const c = cadre(fichier);
        const M = [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20];
        const coin = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
        const pts = [coin(c.x, c.y), coin(c.x + c.w, c.y),
          coin(c.x, c.y + c.h), coin(c.x + c.w, c.y + c.h)];
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const p = {
          fichier: d.cle + '/' + fichier,
          x: Math.min(...xs), y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
          vb: [c.x, c.y, c.w, c.h],
          m: M,
        };
        if (pc.masque) p.masque = true;
        if (pc.cx) p.cx = [pc.cx.mr, pc.cx.mv, pc.cx.mb, pc.cx.ma,
          pc.cx.ar, pc.cx.av, pc.cx.ab, pc.cx.aa];
        return p;
      }),
    })),
  };
  console.log(d.cle + ' : ' + etats.length + ' images, ' + formes.size + ' formes');
}

fs.writeFileSync(path.join(SORTIE, 'manifeste.json'), JSON.stringify(manifeste));
console.log('→ ' + path.relative(RACINE, path.join(SORTIE, 'manifeste.json')));

if (process.argv.includes('--liste')) {
  for (const [cle, m] of Object.entries(manifeste)) {
    for (const e of m.etats) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of e.pieces) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
      }
      console.log(`  ${cle} f${e.frame} : ${e.pieces.length} pièces, cadre `
        + [x0, y0, x1 - x0, y1 - y0].map(Math.round).join(','));
    }
  }
}
