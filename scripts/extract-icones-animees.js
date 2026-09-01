#!/usr/bin/env node
/*
 * Sort les ICÔNES ANIMÉES du bureau — celles qui s'ouvrent au passage de la
 * souris : la boîte aux lettres, la boîte à disques, le carnet de contacts.
 *
 *   node scripts/extract-icones-animees.js      → écrit public/frutiz/sprites/
 *
 * ── Ce que fait main.swf ──
 *
 * `but.Icon` monte son dessin en trois étages : l'icône (`ico`, la bande
 * `iconGFX` de fileIcon.swf), la bande des TYPES DE DOSSIER (`s1`, sprite
 * #200) et, dedans, un clip de quinze images (`s2`). Le survol ne change pas
 * d'image : il fait JOUER celle du dessous —
 *
 *     playAnimRollOver  : animList.addPlayFrame(mc.ico.s1.s2, "move_"+id,
 *                           { end:  8, sens:  1, speed: 2 })
 *     playAnimRollOut   :                        { end:  1, sens: -1, speed: 2 }
 *     playAnimDragRollOver :                     { end: 15, sens:  1, speed: 2 }
 *
 * et `AnimList.playFrame` (0x51bd3) avance de `Math.round(speed * tmod)` images
 * toutes les 25 ms — deux images par battement. L'ouverture va donc de l'image
 * 1 à la 8 en quatre battements, une centaine de millisecondes ; la fermeture
 * refait le chemin en sens inverse. Les six dernières images (9 → 15) ne
 * servent qu'au survol AVEC UNE ICÔNE EN MAIN, que le light n'a pas.
 *
 * ── Les clips, et qui les porte ──
 *
 * Toutes les images de dossier n'ont pas de clip : `recyclebin` (#133),
 * `inventory` (#150) et `blacklist` (#199) sont des FORMES, elles ne bougent
 * pas. C'est pour cela que « certaines » icônes s'animent et pas toutes.
 * Les six qui bougent, et les types de dossier qui les partagent :
 *
 *     #113  default, draftBox           le dossier jaune qui s'entrouvre
 *     #129  mail, inbox, messages       l'enveloppe qui se lève
 *     #149  contact, mycontact          le carnet qui s'ouvre
 *     #166  outbox                      la boîte d'envoi
 *     #182  blackbox                    les indésirables
 *     #198  disccollector               la boîte à disques
 *
 * On ne sort donc qu'un JEU par clip, sous le nom du type qui le représente,
 * et le manifeste dit à quel jeu répond chaque type.
 *
 * ── Le cadre commun ──
 *
 * Chaque image du clip est UNE forme, et sa boîte n'est pas celle de la
 * précédente : l'enveloppe passe de 64 × 47 à 61 × 56 en s'ouvrant. Découper
 * chaque SVG sur son propre dessin ferait sauter l'icône d'une image à
 * l'autre. Les huit sortent donc dans le MÊME cadre — l'union des huit — et
 * l'image 1 y flotte, comme dans Flash.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');
const FICHIER_ICONES = path.join(RACINE, 'public/fileIcon.swf');

// Le survol s'arrête à l'image 8 (`playAnimRollOver`) : au-delà, c'est le
// survol avec une icône en main, que le light n'a pas.
const IMAGES = 8;

const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'frutiz-anim-'));
const arr = (v) => Math.round(v * 100) / 100;

// ── Les formes, par l'extracteur commun ───────────────────────────────────
const cacheFormes = new Map();
function chargerFormes(ids) {
  const manquants = ids.filter((id) => !cacheFormes.has(id));
  if (!manquants.length) return cacheFormes;
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), FICHIER_ICONES, TMP, ...manquants.map(String)],
    { stdio: 'pipe' });
  for (const id of manquants) {
    const p = path.join(TMP, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) { cacheFormes.set(id, null); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
    cacheFormes.set(id, {
      corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
      vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
    });
  }
  return cacheFormes;
}

// ── Les labels d'un sprite, par lecture de sa timeline ────────────────────
function labelsDe(swf, sprite) {
  const labels = new Map();
  swf.parcourir((code, corps, len, id, frame) => {
    if (id !== sprite || code !== 43) return;      // 43 = FrameLabel
    let e = corps; while (e < corps + len && swf.b[e] !== 0) e++;
    labels.set(swf.b.slice(corps, e).toString('utf8'), frame);
  });
  return labels;
}

let nFiltre = 0;
function filtreCx(cx) {
  if (!cx) return null;
  const id = 'cx' + (++nFiltre);
  const m = [
    cx.mr / 256, 0, 0, 0, cx.ar / 255,
    0, cx.mv / 256, 0, 0, cx.av / 255,
    0, 0, cx.mb / 256, 0, cx.ab / 255,
    0, 0, 0, cx.ma / 256, cx.aa / 255,
  ];
  return {
    id,
    def: `<filter id="${id}" color-interpolation-filters="sRGB">`
      + `<feColorMatrix type="matrix" values="${m.map((v) => +v.toFixed(4)).join(' ')}"/></filter>`,
  };
}

// La boîte d'un jeu de morceaux, en pixels (les translations sont en twips).
function boiteDe(morceaux, formes) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const m of morceaux) {
    if (m.masque) continue;
    const f = formes.get(m.shape);
    if (!f) continue;
    for (const [px, py] of [[f.vb.x, f.vb.y], [f.vb.x + f.vb.w, f.vb.y],
      [f.vb.x, f.vb.y + f.vb.h], [f.vb.x + f.vb.w, f.vb.y + f.vb.h]]) {
      const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
      const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

// Le SVG d'un jeu de morceaux DANS un cadre imposé — c'est ce cadre partagé
// qui tient l'icône en place d'une image à l'autre.
function svgDans(morceaux, formes, cadre) {
  let defs = '', corps = '';
  for (const m of morceaux) {
    if (m.masque) continue;
    const f = formes.get(m.shape);
    if (!f) continue;
    const fc = filtreCx(m.cx);
    if (fc) defs += fc.def;
    corps += `<g transform="matrix(${[m.M.a, m.M.b, m.M.c, m.M.d, m.M.e / 20, m.M.f / 20]
      .map((v) => +v.toFixed(4)).join(',')})"` + (fc ? ` filter="url(#${fc.id})"` : '') + '>'
      + f.corps + '</g>\n';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cadre.x} ${cadre.y} ${cadre.w} ${cadre.h}"`
    + ` width="${cadre.w}" height="${cadre.h}">\n`
    + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n';
}

// ═══════════════════════════════════════════════════════════════════════════
const swf = ouvrir(FICHIER_ICONES);
const ICONGFX = swf.noms.get('iconGFX');
if (!ICONGFX) throw new Error('iconGFX introuvable dans fileIcon.swf');

const labelsFichier = labelsDe(swf, ICONGFX);
const poseFolder = (swf.parSprite.get(ICONGFX).get(labelsFichier.get('folder')) || [])[0];
const BANDE = poseFolder && poseFolder.ch;
if (!BANDE) throw new Error("l'image « folder » d'iconGFX ne pose rien");
const labelsDossier = labelsDe(swf, BANDE);

/*
 * Qui s'anime : on ne le décide pas, on le CONSTATE. Une image de la bande
 * qui pose un clip nommé `s2` d'au moins huit images est animée ; les autres
 * (une forme nue : la corbeille, le coffre, la liste noire) ne le sont pas.
 * Les types qui posent le MÊME clip partagent le même jeu de dessins : le
 * premier rencontré donne son nom au jeu, les suivants s'y rattachent.
 */
const jeux = new Map();                 // clip → { nom, frame }
const rattache = {};                    // type de dossier → nom du jeu
for (const [type, frame] of [...labelsDossier].sort((a, b) => a[1] - b[1])) {
  const poses = swf.parSprite.get(BANDE).get(frame) || [];
  const s2 = poses.find((p) => p.nom === 's2' && swf.estSprite(p.ch)
    && (swf.parSprite.get(p.ch) || new Map()).size >= IMAGES);
  if (!s2) continue;
  if (!jeux.has(s2.ch)) jeux.set(s2.ch, { nom: type, frame });
  rattache[type] = jeux.get(s2.ch).nom;
}

const manifeste = { images: IMAGES, intervalle: 25, pas: 2, types: rattache,
  cadres: {}, repos: {} };

for (const [clip, jeu] of jeux) {
  const poses = swf.parSprite.get(BANDE).get(jeu.frame) || [];
  // Les huit états du clip. Le VOISIN du clip animé (l'ombre portée des boîtes
  // aux lettres, #132) ne bouge pas : Flash ne fait jouer que `s2`, et lui
  // reste sur sa première image — on l'aplatit donc sans numéro d'image.
  const etats = [];
  for (let n = 1; n <= IMAGES; n++) {
    const morceaux = [];
    for (const p of poses) {
      const M = swf.composer(poseFolder.M, p.M);
      morceaux.push(...swf.aplatir(p.ch, M, 0, p.nom === 's2' ? n : undefined));
    }
    etats.push(morceaux);
  }

  const ids = new Set();
  for (const e of etats) for (const m of e) ids.add(m.shape);
  const formes = chargerFormes([...ids]);

  // Le cadre COMMUN : l'union des huit boîtes.
  let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
  for (const e of etats) {
    const b = boiteDe(e, formes);
    if (!b) continue;
    X0 = Math.min(X0, b.x0); Y0 = Math.min(Y0, b.y0);
    X1 = Math.max(X1, b.x1); Y1 = Math.max(Y1, b.y1);
  }
  if (X1 < X0) { console.warn('!! rien à dessiner pour', jeu.nom, '(clip #' + clip + ')'); continue; }
  const cadre = { x: arr(X0), y: arr(Y0), w: arr(Math.max(0.01, X1 - X0)), h: arr(Math.max(0.01, Y1 - Y0)) };

  for (let n = 1; n <= IMAGES; n++) {
    fs.writeFileSync(path.join(SORTIE, 'ico_anim_' + jeu.nom + '_' + n + '.svg'),
      svgDans(etats[n - 1], formes, cadre));
  }
  /*
   * La boîte de l'image AU REPOS, dans le cadre commun. Une case qui pose
   * l'icône par l'ORIGINE de son clip (l'explorateur, `dessinStandard`) n'en a
   * pas besoin — le cadre suffit. Une case qui la CENTRE (les tuiles du
   * bureau, `.ico` en flex) si : sans elle, l'enveloppe descendrait de la
   * moitié du débord que l'animation s'est réservé au-dessus.
   */
  const b1 = boiteDe(etats[0], formes);
  const repos = { x: arr(b1.x0), y: arr(b1.y0), w: arr(b1.x1 - b1.x0), h: arr(b1.y1 - b1.y0) };

  manifeste.cadres[jeu.nom] = cadre;
  manifeste.repos[jeu.nom] = repos;
  console.log('ico_anim_' + jeu.nom + '_1..' + IMAGES, '(clip #' + clip + ')',
    '→', cadre.w + '×' + cadre.h, '(repos ' + repos.w + '×' + repos.h + ')',
    '·', Object.keys(rattache).filter((t) => rattache[t] === jeu.nom).join(', '));
}

fs.writeFileSync(path.join(SORTIE, 'icones-animees.json'),
  JSON.stringify(manifeste, null, 2) + '\n');
fs.rmSync(TMP, { recursive: true, force: true });
console.log('→ public/frutiz/sprites/icones-animees.json');
