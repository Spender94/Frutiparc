#!/usr/bin/env node
/*
 * Mini-Fever — les PICTOS des épreuves.
 *
 * Un picto par mini-jeu, sur le modèle des monstres de MiniWave : on l'obtient
 * la première fois qu'on remporte l'épreuve. L'image, c'est le décor du jeu
 * lui-même — le seul dessin qui l'identifie à coup sûr.
 *
 * Le SWF ne contient AUCUN picto : Mini-Fever n'est jamais sorti, personne n'a
 * jamais dessiné ses récompenses. On les fabrique donc à partir des dessins
 * extraits (public/minifever/sprites) : chaque décor est un empilement de
 * tracés SVG posés par une matrice ; ce script les RECOUD en un seul fichier,
 * cadré sur la scène de 240 × 240, à la taille d'un picto.
 *
 * On reste en SVG à dessein : la plateforme sait déjà en servir (les smileys du
 * stand MiniWave en sont), et le dépôt n'embarque aucune bibliothèque d'image
 * capable de rasteriser.
 *
 *   node scripts/make-minifever-pictos.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/minifever/sprites');
const SORTIE = path.join(RACINE, 'public/minifever/pictos');
const SCENE = 240;                 // Cs.mcw / Cs.mch
const COTE = 64;                   // la taille d'un picto

/**
 * Le contenu d'un tracé, et la boîte que son viewBox déclare.
 *
 * Les identifiants internes (dégradés, surtout) sont PRÉFIXÉS du nom du
 * fichier : chaque tracé sort de l'extracteur avec ses « g0, g1… », et en
 * incruster plusieurs dans un même SVG faisait peindre les tubes de Tubulo
 * avec le dégradé sombre de leur décor.
 */
function lireTrace(fichier) {
  const brut = fs.readFileSync(path.join(SPRITES, fichier), 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(brut);
  const [x, y, w, h] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1, 1];
  const prefixe = fichier.replace(/\W/g, '') + '_';
  const dedans = brut.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/\bid="([^"]+)"/g, (m, id) => `id="${prefixe}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${prefixe}${id})`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (m, attr, id) => `${attr}="#${prefixe}${id}"`);
  return { x, y, w: w || 1, h: h || 1, dedans };
}

/*
 * La MISE EN SCÈNE d'un picto : le décor seul ne dit rien — quatre carrés de
 * ciel et de parquet se ressemblent tous. On y repose donc les acteurs, aux
 * places où le mini-jeu les met (les mêmes positions et les mêmes échelles que
 * public/minifever/jeux.js, à difficulté nulle), et la fleur en fin de pousse.
 */
const SCENES = {
  gameBasket: [
    { cle: 'sym488', x: 120, y: 50, s: 1.1 },       // l'arceau, rayon 55
    { cle: 'sym480', x: 120, y: 212.5, s: 0.55 },   // le ballon, rayon 27,5
  ],
  gameLander: [
    { cle: 'sym474', x: 120, y: 225, sx: 0.98 },    // la plateforme
    { cle: 'sym467', x: 120, y: 105, rot: -90 },    // le module, réacteur en bas
  ],
  gameFlower: [
    { cle: 'sym426', x: 120, y: 30, s: 0.7 },       // le nuage
    { cle: 'sym444', x: 150, y: 223, image: 17 },   // la fleur, poussée
  ],
  gamePong: [
    { cle: 'sym283', x: 226, y: 120, sy: 0.6 },     // la raquette
    { cle: 'sym279', x: 96, y: 120, s: 0.1 },       // la balle
  ],
  gameAstero: [
    { cle: 'sym318', x: 62, y: 62, s: 0.5 },        // trois rochers à 50 %
    { cle: 'sym318', x: 186, y: 92, s: 0.5 },
    { cle: 'sym318', x: 96, y: 186, s: 0.5 },
    { cle: 'sym316', x: 150, y: 150, rot: -35 },    // et le vaisseau
  ],
  gameParachute: [
    { cle: 'sym384', x: 170, y: 225, s: 0.8 },      // la feuille, rayon 40
    { cle: 'sym382', x: 120, y: 100 },              // le moulin
    { cle: 'sym404', x: 120, y: 120, s: 0.5 },      // la fourmi, rayon 25
  ],
  gameGobelet: [                                    // le choix : un gobelet levé
    { cle: 'sym450', x: 39, y: 210, s: 0.3 },       // les ombres au sol
    { cle: 'sym450', x: 93, y: 210, s: 0.3 },
    { cle: 'sym450', x: 147, y: 210, s: 0.3 },
    { cle: 'sym450', x: 201, y: 210, s: 0.3 },
    { cle: 'sym452', x: 39, y: 210, s: 0.3 },       // trois gobelets posés
    { cle: 'sym452', x: 93, y: 210, s: 0.3 },
    { cle: 'sym452', x: 201, y: 210, s: 0.3 },
    { cle: 'sym448', x: 147, y: 210, s: 0.3 },      // la bille, sous le quatrième
    { cle: 'sym452', x: 147, y: 140, s: 0.3 },
  ],
  gameMarmite: [
    { cle: 'sym200', x: 69, y: 52, image: 1 },      // la ronde passe en haut
    { cle: 'sym200', x: 120, y: 60, image: 2 },
    { cle: 'sym200', x: 174, y: 50, image: 3 },
    { cle: 'sym187', x: 120, y: 240 },              // le livre attend en bas
  ],
  gameGather: [
    { cle: 'sym418', x: 120, y: 120, s: 1.4 },      // le cercle, rayon 70
    { cle: 'sym414', x: 40, y: 52, s: 2, image: 1 },   // rouges dehors…
    { cle: 'sym414', x: 198, y: 76, s: 2, image: 1 },
    { cle: 'sym414', x: 60, y: 196, s: 2, image: 1 },
    { cle: 'sym414', x: 130, y: 112, s: 2, image: 2 }, // …bleue dedans
  ],
  gameTubulo: [                                     // trois pistons, découpés
    { cle: 'sym209', x: 100, y: 128, s: 0.4, image: 1, masque: { cle: 'sym210', s: 0.4 } },
    { cle: 'sym209', x: 120, y: 144, s: 0.4, image: 2, masque: { cle: 'sym210', s: 0.4 } },
    { cle: 'sym209', x: 140, y: 160, s: 0.4, image: 3, masque: { cle: 'sym210', s: 0.4 } },
  ],
  gameTrampoline: [
    { cle: 'sym160', x: 0, y: 128 },                // le mur à son étage facile
    { cle: 'sym152', x: 0, y: 0 },                  // le sol
    { cle: 'sym157', x: 120, y: 150, s: 0.48, image: 2 },  // le bonhomme
    { cle: 'sym150', x: 120, y: 200 },              // le trampoline
  ],
};

/** Recoud une image d'un symbole : ses pièces, chacune sous sa matrice. */
function coudre(etat) {
  const bouts = [];
  for (const p of etat.pieces) {
    const t = lireTrace(p.fichier);
    const ox = p.o ? p.o[0] : -p.w / 2;
    const oy = p.o ? p.o[1] : -p.h / 2;
    // La pièce est posée dans le rectangle (ox, oy, w, h) : on y projette le
    // viewBox du tracé, puis on applique la matrice de placement.
    const sx = p.w / t.w;
    const sy = p.h / t.h;
    const m = p.m;
    const place = `matrix(${m.join(' ')}) translate(${ox} ${oy}) scale(${sx} ${sy}) translate(${-t.x} ${-t.y})`;
    bouts.push(`<g transform="${place}">${t.dedans}</g>`);
  }
  return bouts.join('');
}

/** Un symbole posé sur la scène, comme le ferait le client. */
let masqueSuivant = 0;
function poser(manifeste, o) {
  const s = manifeste[o.cle];
  if (!s) throw new Error(`${o.cle} : pas dans le manifeste`);
  const etat = s.etats.find((e) => e.frame === (o.image || 1)) || s.etats[0];
  const sx = (o.sx !== undefined) ? o.sx : (o.s !== undefined ? o.s : 1);
  const sy = (o.sy !== undefined) ? o.sy : (o.s !== undefined ? o.s : 1);
  const t = [`translate(${o.x || 0} ${o.y || 0})`];
  if (o.rot) t.push(`rotate(${o.rot})`);
  if (sx !== 1 || sy !== 1) t.push(`scale(${sx} ${sy})`);
  // Le masque éventuel — la découpe que le jeu applique (setMask) : la forme
  // d'un autre symbole, posée au même endroit. Les capsules de Tubulo.
  let avant = '', attr = '';
  if (o.masque) {
    const m = manifeste[o.masque.cle];
    if (!m) throw new Error(`${o.masque.cle} : masque absent du manifeste`);
    const id = 'm' + (masqueSuivant++);
    const ms = o.masque.s !== undefined ? o.masque.s : 1;
    const chemins = [];
    for (const p of m.etats[0].pieces) {
      const trace = lireTrace(p.fichier);
      for (const d of trace.dedans.matchAll(/\bd="([^"]+)"/g)) {
        chemins.push(`<path d="${d[1]}" transform="translate(${o.x || 0} ${o.y || 0}) scale(${ms}) matrix(${p.m.join(' ')})"/>`);
      }
    }
    avant = `<clipPath id="${id}">${chemins.join('')}</clipPath>`;
    attr = ` clip-path="url(#${id})"`;
  }
  // La découpe vit sur une ENVELOPPE sans transform : ses chemins sont déjà en
  // coordonnées de scène, et un clip-path posé sur un groupe transformé se
  // verrait appliquer le transform une seconde fois.
  const dedans = `<g transform="${t.join(' ')}">${coudre(etat)}</g>`;
  return o.masque ? `${avant}<g${attr}>${dedans}</g>` : dedans;
}

function picto(manifeste, cle) {
  const s = manifeste[cle];
  if (!s) throw new Error(`${cle} : pas dans le manifeste`);
  // Le décor est accroché en (0,0) — ses dessins couvrent la scène depuis le
  // coin, pas depuis le centre.
  let corps = coudre(s.etats[0]);
  for (const o of (SCENES[cle] || [])) corps += poser(manifeste, o);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${COTE}" height="${COTE}"`
    + ` viewBox="0 0 ${SCENE} ${SCENE}">\n`
    // Le décor déborde souvent de la scène (le terrain de basket monte à -391,
    // le niveau de la grenouille file à 1524 sur la droite) : on découpe.
    + `<clipPath id="c"><rect x="0" y="0" width="${SCENE}" height="${SCENE}"/></clipPath>\n`
    + `<g clip-path="url(#c)">${corps}</g>\n`
    + '</svg>\n';
}

/*
 * Le DISQUE Frusion, pour la feuille de lancement du light. Les autres jeux ont
 * le leur, dessiné à l'époque ; Mini-Fever n'en a jamais eu. On le compose des
 * quatre premières épreuves, en quartiers — c'est exactement ce que le jeu est,
 * une poignée d'épreuves qui s'enchaînent — et on lui donne la forme des
 * autres : une galette percée, sur fond transparent.
 */
function jaquette(manifeste, cles) {
  const q = cles.slice(0, 4);
  const T = SCENE / 2;                 // le côté d'un quartier
  const R = SCENE / 2 - 2;             // le rayon de la galette
  let corps = '';
  q.forEach((cle, i) => {
    const dx = (i % 2) * T;
    const dy = Math.floor(i / 2) * T;
    corps += `<g transform="translate(${dx} ${dy}) scale(${T / SCENE})"`
      + ` clip-path="url(#c)">${coudre(manifeste[cle].etats[0])}`;
    for (const o of (SCENES[cle] || [])) corps += poser(manifeste, o);
    corps += '</g>';
  });
  const c = SCENE / 2;
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE}" height="${SCENE}"`
    + ` viewBox="0 0 ${SCENE} ${SCENE}">\n`
    + `<clipPath id="c"><rect x="0" y="0" width="${SCENE}" height="${SCENE}"/></clipPath>\n`
    // La galette et son trou : un masque, pour laisser passer le fond du light.
    + `<mask id="g"><circle cx="${c}" cy="${c}" r="${R}" fill="#fff"/>`
    + `<circle cx="${c}" cy="${c}" r="26" fill="#000"/></mask>\n`
    + `<g mask="url(#g)">\n<rect width="${SCENE}" height="${SCENE}" fill="#101830"/>\n${corps}\n`
    + `<line x1="${T}" y1="0" x2="${T}" y2="${SCENE}" stroke="#101830" stroke-width="3"/>\n`
    + `<line x1="0" y1="${T}" x2="${SCENE}" y2="${T}" stroke="#101830" stroke-width="3"/>\n`
    + `<circle cx="${c}" cy="${c}" r="34" fill="none" stroke="#101830" stroke-width="7"/>\n`
    + `<circle cx="${c}" cy="${c}" r="${R - 1}" fill="none" stroke="#101830" stroke-width="4"/>\n`
    + '</g>\n</svg>\n';
}

/** Les épreuves portées : celles-là seules ont un picto à gagner. */
function jeuxPortes() {
  const src = fs.readFileSync(path.join(RACINE, 'public/minifever/jeux.js'), 'utf8');
  const bloc = /const JEUX = \[([\s\S]*?)\];/.exec(src);
  if (!bloc) throw new Error('catalogue introuvable dans jeux.js');
  return [...bloc[1].matchAll(/cle: '([^']+)'/g)].map((m) => m[1]);
}

function main() {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
  fs.mkdirSync(SORTIE, { recursive: true });
  const cles = jeuxPortes();
  for (const cle of cles) {
    const nom = cle.replace(/^game/, '').toLowerCase() + '.svg';
    fs.writeFileSync(path.join(SORTIE, nom), picto(manifeste, cle));
    console.log(`${nom.padEnd(16)} ← ${cle} (#${manifeste[cle].id})`);
  }
  const disque = path.join(RACINE, 'public/fb/fd_minifever.svg');
  fs.writeFileSync(disque, jaquette(manifeste, cles));
  console.log(`\n${cles.length} pictos dans ${path.relative(RACINE, SORTIE)}`);
  console.log(`jaquette : ${path.relative(RACINE, disque)}`);
}

if (require.main === module) main();

module.exports = { picto, jaquette, coudre, poser, jeuxPortes, SCENES, COTE, SCENE };
