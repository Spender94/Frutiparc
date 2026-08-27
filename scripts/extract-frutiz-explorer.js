#!/usr/bin/env node
/*
 * Sort les dessins de L'EXPLORATEUR du bureau — les icônes de fichiers et de
 * dossiers, et les boutons de sa barre d'outils.
 *
 *   node scripts/extract-frutiz-explorer.js     → écrit public/frutiz/sprites/
 *
 * ── Où elles vivent ──
 *
 * Les icônes de l'explorateur ne sont PAS dans main.swf : elles vivent dans
 * `fileIcon.swf`, un fichier à part que le bureau charge une fois. Deux bandes
 * y répondent à `gotoAndStop(nom)` :
 *
 *   · `iconGFX` (#223) — une image par TYPE de fichier : « folder », « disc »,
 *     « wallpaper », « link », « pictoForum »… C'est `but.Icon.display` qui
 *     appelle `ico.gotoAndStop(this.type)` ;
 *   · la bande des dossiers (#200), imbriquée sous le nom `s1` dans l'image
 *     « folder », une image par TYPE DE DOSSIER : « inventory » (le coffre),
 *     « disccollector » (la boîte à disques), « recyclebin », « mycontact »…
 *     C'est la deuxième ligne du même display : `ico.s1.gotoAndStop(desc[1])`.
 *
 * Un DISQUE est composé : l'image « disc » d'iconGFX porte un clip `disc` dont
 * l'anneau change avec le type (`ico.disc.gotoAndStop(desc[0] + 1)` — noir,
 * blanc, rouge…) et dont l'étiquette porte la JAQUETTE du jeu
 * (`ico.disc.label.gotoAndStop(desc[1])`). On sort donc les anneaux d'un côté,
 * les jaquettes de l'autre : le portage les superpose.
 *
 * Les BOUTONS de la barre d'outils, eux, sont dans main.swf : `butPushNavigator`
 * (#393), une image par action — 2 = remonter d'un dossier, 3 = nouveau
 * dossier (l'étoile), 4 = vider la corbeille, 5 = nouveau message. La liste et
 * les numéros viennent de `win.Explorer.initNavigatorIconList`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');
const FICHIER_ICONES = path.join(RACINE, 'public/fileIcon.swf');
const MAIN = path.join(RACINE, 'legacy/main.swf');

const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'frutiz-explo-'));
const arr = (v) => String(Math.round(v * 100) / 100);

// ── Les formes, par l'extracteur commun ───────────────────────────────────
function chargeurDeFormes(fichier) {
  const dossier = path.join(TMP, path.basename(fichier, '.swf'));
  const cache = new Map();
  return function charger(ids) {
    const manquants = ids.filter((id) => !cache.has(id));
    if (manquants.length) {
      execFileSync(process.execPath,
        [path.join(__dirname, 'extract-swf-shapes.js'), fichier, dossier, ...manquants.map(String)],
        { stdio: 'pipe' });
      for (const id of manquants) {
        const p = path.join(dossier, 'shape' + id + '.svg');
        if (!fs.existsSync(p)) { cache.set(id, null); continue; }
        const t = fs.readFileSync(p, 'utf8');
        const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
        cache.set(id, {
          corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
          vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
        });
      }
    }
    return cache;
  };
}

// La table des formes d'un SWF, avec les IMAGES qu'elles portent : une forme
// dont tout le contenu est UN bitmap n'a pas besoin d'être tracée — l'image
// EST le dessin (c'est le cas des jaquettes de disques et de leur anneau).
function tableFormes(fichier) {
  const brut = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), fichier],
    { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
  const t = new Map();
  for (const ligne of brut.split('\n')) {
    const m = /^#(\d+)\t\S+\t(\S+)\t(.*)$/.exec(ligne);
    if (!m) continue;
    const images = [...m[3].matchAll(/bitmap#(\d+)/g)]
      .map((x) => Number(x[1])).filter((id) => id !== 65535);
    const [w, h] = m[2].split('x').map(Number);
    t.set(Number(m[1]), { images, w, h });
  }
  return t;
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

function svgCompose(morceaux, formes) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const dessins = [];
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
    dessins.push(m);
  }
  if (!dessins.length) return null;
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  let defs = '', corps = '';
  for (const d of dessins) {
    const f = formes.get(d.shape);
    const fc = filtreCx(d.cx);
    if (fc) defs += fc.def;
    corps += `<g transform="matrix(${[d.M.a, d.M.b, d.M.c, d.M.d, d.M.e / 20, d.M.f / 20]
      .map((v) => +v.toFixed(4)).join(',')})"` + (fc ? ` filter="url(#${fc.id})"` : '') + '>'
      + f.corps + '</g>\n';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(l)} ${arr(h)}" width="${arr(l)}" height="${arr(h)}">\n`
    + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n';
  return { svg, cadre: { x: +arr(x0), y: +arr(y0), w: +arr(l), h: +arr(h) } };
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

// ═══════════════════════════════════════════════════════════════════════════
const manifeste = {};

function sortir(nom, morceaux, formes) {
  const r = svgCompose(morceaux, formes);
  if (!r) { console.warn('!! rien à dessiner pour', nom); return; }
  fs.writeFileSync(path.join(SORTIE, nom + '.svg'), r.svg);
  manifeste[nom] = r.cadre;
  console.log(nom, '→', r.cadre.w + '×' + r.cadre.h);
}

// ── 1. fileIcon.swf : les types de fichiers et de dossiers ────────────────
{
  const swf = ouvrir(FICHIER_ICONES);
  const charger = chargeurDeFormes(FICHIER_ICONES);
  const ICONGFX = swf.noms.get('iconGFX');
  const labelsFichier = labelsDe(swf, ICONGFX);

  // La bande des dossiers : l'image « folder » d'iconGFX pose le clip `s1`,
  // et c'est LUI qui porte une image par type de dossier.
  const poseFolder = (swf.parSprite.get(ICONGFX).get(labelsFichier.get('folder')) || [])[0];
  const BANDE_DOSSIERS = poseFolder && poseFolder.ch;
  const labelsDossier = BANDE_DOSSIERS ? labelsDe(swf, BANDE_DOSSIERS) : new Map();

  const aSortir = [];
  // Les types de fichiers utiles au portage light. « folder » et « contact »
  // n'y sont PAS : leur image d'iconGFX ne porte pas un dessin mais une BANDE
  // (`s1`), qu'il faut arrêter sur sa propre image — c'est la boucle suivante
  // qui s'en charge. L'aplatisseur, lui, descend avec le même numéro d'image :
  // demander « folder » à iconGFX donnerait l'image 25 de la bande, c'est-à-dire
  // le courrier.
  for (const t of ['wallpaper', 'link', 'pictoForum', 'text', 'default']) {
    const f = labelsFichier.get(t);
    if (!f) { console.warn('!! type de fichier inconnu :', t); continue; }
    aSortir.push({ nom: 'ico_' + t, morceaux: swf.aplatir(ICONGFX, swf.IDENTITE, 0, f) });
  }
  // Les types de dossiers (le coffre de l'inventaire, la boîte à disques…).
  for (const t of ['default', 'inventory', 'disccollector', 'recyclebin', 'mycontact',
    'inbox', 'outbox', 'draftBox', 'blackbox', 'messages', 'blacklist']) {
    const f = labelsDossier.get(t);
    if (!f) { console.warn('!! type de dossier inconnu :', t); continue; }
    aSortir.push({
      nom: 'ico_dossier_' + t,
      morceaux: swf.aplatir(BANDE_DOSSIERS, poseFolder.M, 0, f),
    });
  }
  const ids = new Set();
  for (const s of aSortir) for (const m of s.morceaux) ids.add(m.shape);
  const formes = charger([...ids]);
  for (const s of aSortir) sortir(s.nom, s.morceaux, formes);

  // LE DISQUE, en deux couches. L'image « disc » d'iconGFX pose le clip `disc`
  // (#83) : celui-ci empile l'ANNEAU — une image par type de FD, du noir au
  // rouge — et la bande des JAQUETTES, une image par jeu. Ce ne sont pas des
  // tracés mais des BITMAPS : le portage les superpose comme le SWF, l'anneau
  // dessous, la jaquette dessus.
  const poseDisc = (swf.parSprite.get(ICONGFX).get(labelsFichier.get('disc')) || [])[0];
  if (poseDisc) {
    const table = tableFormes(FICHIER_ICONES);
    const dossierImages = path.join(TMP, 'images');
    // Ce que le SWF appelle « le disque » (#83) tient sur cinq images : la
    // profondeur 1 porte l'ANNEAU (le FD noir, le blanc… un par discType, et
    // `ico.disc.gotoAndStop(discType + 1)` choisit l'image), la profondeur 3
    // la BANDE DES JAQUETTES. On les sépare par la profondeur, puisque c'est
    // ainsi que le SWF les empile.
    const frames83 = swf.parSprite.get(poseDisc.ch);
    const bandeJaquettes = (frames83.get(1) || []).find((p) => swf.estSprite(p.ch)
      && labelsDe(swf, p.ch).size);
    const profJaquettes = bandeJaquettes && bandeJaquettes.prof;

    const aComposer = [];               // { nom, morceaux }
    for (const [f, poses] of frames83) {
      const morceaux = [];
      for (const p of poses) {
        if (p.prof === profJaquettes) continue;
        // La TEINTE du placement compte : les cinq anneaux sont le MÊME dessin,
        // seule change la transformation de couleur posée sur lui (le FD noir,
        // le blanc, le rouge…).
        morceaux.push(...swf.aplatir(p.ch, p.M, 0, f, '', p.cx));
      }
      if (morceaux.length) aComposer.push({ nom: 'disc_anneau_' + (f - 1), morceaux });
    }
    // LA JAQUETTE : l'image 1 de son clip, et rien d'autre.
    //
    // Chaque image de la bande pose un clip nommé `gfx` — la jaquette d'un
    // jeu. Ce clip a deux ou trois images, et son script d'image 1 est un
    // simple `Stop` :
    //
    //     image 1  →  Stop                            (le RECTO, le dessin)
    //     image 2  →  setProperty("", _rotation, random(360))
    //     image 3  →  gotoAndPlay(1)                  (donc retour au Stop)
    //
    // Les images 2-3 portent un AUTRE bitmap : le VERSO brillant du disque,
    // qu'une rotation au hasard fait tourner. Rien ne les montre — `Stop`
    // tient l'image 1, et `but.Icon` finit d'ailleurs par
    // `ico.disc.label.gfx.stop()`.
    //
    // On descendait dans `gfx` avec le NUMÉRO D'IMAGE DE LA BANDE : pour
    // Kaluga (image 2) et son aperçu (image 3), ces numéros existent aussi
    // dans le clip, et c'est le verso brillant qui sortait à la place du
    // dessin. D'où deux disques vierges dans « Mes disques ».
    if (bandeJaquettes) {
      const imagesBande = swf.parSprite.get(bandeJaquettes.ch) || new Map();
      for (const [nom, f] of labelsDe(swf, bandeJaquettes.ch)) {
        const morceaux = [];
        for (const p of imagesBande.get(f) || []) {
          const M = swf.composer(bandeJaquettes.M, p.M);
          const cx = swf.composerCouleur(bandeJaquettes.cx, p.cx);
          const dedans = (swf.parSprite.get(p.ch) || new Map()).get(1);
          // La jaquette greffée de Mini-Fever est une FORME posée telle
          // quelle, pas un clip : elle n'a pas d'image 1 à descendre.
          if (!dedans) { morceaux.push(...swf.aplatir(p.ch, M, 0, 1, '', cx)); continue; }
          for (const q of dedans) {
            // LE BANDEAU « DEMO ». Son script d'image 1 (#58 et #63) dit :
            //
            //     setProperty("", _visible, _parent._parent._currentframe > 60)
            //
            // `_parent._parent`, c'est la BANDE : le bandeau ne se montre donc
            // que sur ses images de fin — miniwaved (61) et minipixizd (62).
            // Le portage le posait sur les deux, et le disque Mini-Wave du
            // commerce (image 11) portait un DEMO qu'il n'a pas.
            if (q.nom === 'demo' && f <= 60) continue;
            morceaux.push(...swf.aplatir(q.ch, swf.composer(M, q.M), 0, 1, '',
              swf.composerCouleur(cx, q.cx)));
          }
        }
        aComposer.push({ nom: 'disc_jaquette_' + nom, morceaux });
      }
    }

    // Ces dessins-là ne sont pas des tracés mais des BITMAPS posés à
    // l'identique dans une forme de leur taille. On sort les images une fois,
    // et on les INCORPORE dans un SVG par disque : une couche par forme, dans
    // l'ordre du SWF (l'anneau sous la jaquette, l'estampille par-dessus).
    const bitmaps = new Set();
    for (const c of aComposer) {
      for (const m of c.morceaux) {
        const info = table.get(m.shape);
        if (info && info.images.length === 1) bitmaps.add(info.images[0]);
      }
    }
    const parBitmap = new Map();
    if (bitmaps.size) {
      const brut = execFileSync(process.execPath,
        [path.join(__dirname, 'extract-swf-bitmaps.js'), FICHIER_ICONES, dossierImages,
          ...[...bitmaps].map(String)],
        { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
      for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.(?:png|svg|jpg|gif))/gm)) {
        parBitmap.set(Number(m[1]), m[2]);
      }
    }
    const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
    const formesDisque = charger([...new Set(aComposer.flatMap((c) => c.morceaux.map((m) => m.shape)))]);
    for (const { nom, morceaux } of aComposer) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, corps = '', defs = '';
      for (const m of morceaux) {
        const info = table.get(m.shape), forme = formesDisque.get(m.shape);
        const fichier = info && info.images.length === 1 && parBitmap.get(info.images[0]);
        if (!forme) { console.warn('!! forme absente dans', nom, '—', m.shape); continue; }
        const vb = forme.vb;
        // Les rares couches VECTORIELLES (l'anneau du FD démo, la jaquette de
        // Tuberculoz) se dessinent telles quelles.
        if (!fichier) {
          for (const [px, py] of [[vb.x, vb.y], [vb.x + vb.w, vb.y], [vb.x, vb.y + vb.h], [vb.x + vb.w, vb.y + vb.h]]) {
            const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
            const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
            x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
          }
          corps += `<g transform="matrix(${[m.M.a, m.M.b, m.M.c, m.M.d, m.M.e / 20, m.M.f / 20]
            .map((v) => +v.toFixed(4)).join(',')})">` + forme.corps + '</g>\n';
          continue;
        }
        const b64 = fs.readFileSync(path.join(dossierImages, fichier)).toString('base64');
        for (const [px, py] of [[vb.x, vb.y], [vb.x + vb.w, vb.y], [vb.x, vb.y + vb.h], [vb.x + vb.w, vb.y + vb.h]]) {
          const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
          const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
          x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
        }
        const fc = filtreCx(m.cx);
        if (fc) defs += fc.def;
        corps += `<g transform="matrix(${[m.M.a, m.M.b, m.M.c, m.M.d, m.M.e / 20, m.M.f / 20]
          .map((v) => +v.toFixed(4)).join(',')})"` + (fc ? ` filter="url(#${fc.id})"` : '') + '>'
          + `<image x="${arr(vb.x)}" y="${arr(vb.y)}" width="${arr(vb.w)}" height="${arr(vb.h)}"`
          + ` href="data:${MIME[path.extname(fichier)]};base64,${b64}"/></g>\n`;
      }
      if (!corps) continue;
      const l = x1 - x0, h = y1 - y0;
      fs.writeFileSync(path.join(SORTIE, nom + '.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(l)} ${arr(h)}" width="${arr(l)}" height="${arr(h)}">\n`
        + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n');
      manifeste[nom] = { x: +arr(x0), y: +arr(y0), w: +arr(l), h: +arr(h) };
      console.log(nom, '→', arr(l) + '×' + arr(h));
    }
  }
}

// ── 2. main.swf : les boutons de la barre d'outils ────────────────────────
{
  const swf = ouvrir(MAIN);
  const charger = chargeurDeFormes(MAIN);
  const NAV = swf.noms.get('butPushNavigator');
  if (!NAV) {
    console.warn('!! butPushNavigator absent de main.swf');
  } else {
    // Les numéros d'image viennent de win.Explorer.initNavigatorIconList.
    const ACTIONS = { 2: 'up', 3: 'new_folder', 4: 'empty_recyclebin', 5: 'new_mail' };
    const aSortir = [];
    for (const [f, nom] of Object.entries(ACTIONS)) {
      aSortir.push({ nom: 'nav_' + nom, morceaux: swf.aplatir(NAV, swf.IDENTITE, 0, +f) });
    }
    const ids = new Set();
    for (const s of aSortir) for (const m of s.morceaux) ids.add(m.shape);
    const formes = charger([...ids]);
    for (const s of aSortir) sortir(s.nom, s.morceaux, formes);
  }
}

fs.writeFileSync(path.join(SORTIE, 'explorateur.json'), JSON.stringify(manifeste, null, 2) + '\n');
console.log('manifeste :', path.join(SORTIE, 'explorateur.json'));
fs.rmSync(TMP, { recursive: true, force: true });
