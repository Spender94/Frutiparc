#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — LOGOS, POLICES, PALETTE.
 *
 *   node scripts/kit-bande-annonce/extras/statiques.js
 *
 * LOGOS (extras/logos/)
 *   Le dépôt n'a QU'UNE source du logo Frutiparc : public/images/logo.png,
 *   167 × 74 (le .gif est la même image). `fcLogo.swf` est un fichier vide de
 *   17 octets et son .fla d'origine (frutiparc/swf/fcLogo/) ne se lit pas sans
 *   Flash ; l'icône d'appli 512 px n'est elle-même qu'un agrandissement flou.
 *   On livre donc l'original au pixel près, et un agrandissement ×8 fait au
 *   mieux : xBR ×4 (un filtre qui suit les contours au lieu de les flouter),
 *   puis Lanczos ×2 — la couleur et l'alpha traités séparément, xBR ne
 *   connaissant pas la transparence. Même traitement pour la grappe de fruits
 *   de l'écran de connexion (welcome.gif).
 *
 * POLICES (extras/typo/polices/)
 *   Les fontes des jeux, sorties de leurs SWF (scripts/extract-swf-font.js) :
 *   elles n'embarquent QUE les glyphes dont le jeu se servait. On les livre en
 *   TTF (pour les logiciels de montage) et en WOFF, avec une planche de
 *   spécimen et la liste exacte des caractères présents (table cmap).
 *
 * PALETTE (extras/typo/palette-frutiparc.*)
 *   Les couleurs maîtresses du parc, relevées dans les feuilles de style du
 *   light et du bureau Frutiz (les plus employées), en JSON, CSS, GPL (GIMP,
 *   Inkscape, Krita) et en planche PNG.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const C = require('./commun.js');
const W = require('./woff.js');

const PUB = path.join(C.RACINE, 'public');
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

// ── Agrandissement xBR, alpha à part ─────────────────────────────────────
function agrandir(src, dst, facteurXbr, facteurLanczos, fondCouleur) {
  const [l, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', src]).toString().trim().split(',').map(Number);
  const k = facteurLanczos > 1 ? ',scale=iw*' + facteurLanczos + ':ih*' + facteurLanczos + ':flags=lanczos' : '';
  ff('-i', src, '-filter_complex',
    '[0]format=rgba,split[a][b];color=c=' + (fondCouleur || 'white') + ':s=' + l + 'x' + h + '[w];'
    + '[w][a]overlay=format=auto:shortest=1,format=rgb24,xbr=' + facteurXbr + k + '[rgb];'
    + '[b]alphaextract,format=rgb24,xbr=' + facteurXbr + k + ',format=gray[al];[rgb][al]alphamerge',
    '-frames:v', '1', dst);
}

function carton(src, dst, fond, largeurMax) {
  ff('-i', src, '-filter_complex', 'color=c=' + fond.replace('#', '0x') + ':s=1920x1080[f];'
    + '[0]scale=' + largeurMax + ':-1:flags=lanczos[l];[f][l]overlay=(W-w)/2:(H-h)/2:format=auto',
    '-frames:v', '1', dst);
}

function logos() {
  const d = C.dossier('logos');
  const els = [];
  fs.copyFileSync(path.join(PUB, 'images/logo.png'), path.join(d, 'frutiparc-logo-original.png'));
  agrandir(path.join(PUB, 'images/logo.png'), path.join(d, 'frutiparc-logo-hd.png'), 4, 2);
  carton(path.join(d, 'frutiparc-logo-hd.png'), path.join(d, 'frutiparc-logo-carton-vert.png'), C.VERT_PARC, 1336);
  carton(path.join(d, 'frutiparc-logo-hd.png'), path.join(d, 'frutiparc-logo-carton-fonce.png'), '#335511', 1336);
  agrandir(path.join(PUB, 'images/welcome.gif'), path.join(d, 'frutiparc-fruits-hd.png'), 4, 1);
  fs.copyFileSync(path.join(PUB, 'images/appli/icone-512.png'), path.join(d, 'frutiparc-icone-appli-512.png'));
  els.push({ fichier: 'logos/frutiparc-logo-hd.png', type: 'image', titre: 'Logo Frutiparc — HD transparent',
    description: 'Le logo du site (public/images/logo.png, 167 × 74 — la seule source du dépôt : fcLogo.swf est vide) '
      + 'agrandi ×8 en 1336 × 592 : xBR ×4 puis Lanczos ×2, alpha traité à part. Le léger halo vert clair autour '
      + 'est d’origine (le logo était dessiné pour un fond vert). L’original au pixel près est en variante.',
    usage: 'Carton titre, fin de bande-annonce, incrustation en coin.', largeur: 1336, hauteur: 592, alpha: true,
    affiche: 'logos/frutiparc-logo-carton-vert.png',
    variantes: ['logos/frutiparc-logo-original.png', 'logos/frutiparc-logo-carton-vert.png', 'logos/frutiparc-logo-carton-fonce.png'] });
  els.push({ fichier: 'logos/frutiparc-fruits-hd.png', type: 'image', titre: 'La grappe de fruits de l’accueil',
    description: 'L’illustration de l’écran de connexion (ananas, banane, orange, pomme… — public/images/welcome.gif, '
      + '292 × 290) agrandie ×4 en xBR, fond transparent.',
    usage: 'Habillage d’un carton titre, à côté du logo.', largeur: 1168, hauteur: 1160, alpha: true });
  els.push({ fichier: 'logos/frutiparc-icone-appli-512.png', type: 'image', titre: 'Icône de l’appli (512 px)',
    description: 'L’icône de l’application installable (public/images/appli/icone-512.png), telle quelle.',
    usage: 'Plan « disponible sur téléphone ».', largeur: 512, hauteur: 512, alpha: false });
  return els;
}

// ── Polices ───────────────────────────────────────────────────────────────
/*
 * La sélection : les fontes qui ont un alphabet COMPLET (au moins A-Z), plus
 * les afficheurs de chiffres (LCD du bureau, DSEG7). Les Verdana / Arial
 * pixelisés des jeux sont écartés : ce sont des polices système.
 *
 * Les licences : AUCUN fichier du dépôt ne les mentionne. Ce qui suit est ce
 * qu'on peut dire sans l'inventer — le nom porté par la fonte, et pour DSEG7 sa
 * licence connue (SIL OFL 1.1, de Keshikan). Toutes les autres sont à vérifier
 * avant une diffusion publique.
 */
const POLICES = [
  { src: 'miniwave/fontes/jawbreaker.woff', nom: 'Jawbreaker', jeu: 'Mini-Wave', role: 'titres arrondis, très « jeu vidéo »' },
  { src: 'swapou/fontes/banana.woff', nom: 'PT Banana Split', jeu: 'Swapou', role: 'titres gourmands, avec accents' },
  { src: 'jamajama/fontes/jester.woff', nom: 'Jester', jeu: 'JamaJama', role: 'titres fantaisie' },
  { src: 'minipixiz/atlantis.woff', nom: 'Atlantis', jeu: 'MiniPixiz', role: 'titres « conte de fées »' },
  { src: 'snake3/fontes/alba.woff', nom: 'Alba', jeu: 'Snake 3', role: 'titres bulles, avec accents' },
  { src: 'kaluga/fontes/kaluga-430.woff', nom: 'Kaluga 430', jeu: 'Kaluga', role: 'texte des écrans de Kaluga' },
  { src: 'kaluga/fontes/kaluga-92.woff', nom: 'Kaluga 92', jeu: 'Kaluga', role: 'texte de Kaluga' },
  { src: 'kaluga/fontes/kaluga-523.woff', nom: 'Kaluga 523', jeu: 'Kaluga', role: 'capitales et chiffres de Kaluga' },
  { src: 'bkiwi/fontes/bkiwi-464.woff', nom: 'Burning Kiwi 464', jeu: 'Burning Kiwi', role: 'texte de Burning Kiwi' },
  { src: 'bkiwi/fontes/bkiwi-94.woff', nom: 'Burning Kiwi 94', jeu: 'Burning Kiwi', role: 'titres de Burning Kiwi' },
  { src: 'mb2/fontes/mb2-133.woff', nom: 'Motion-Ball 133', jeu: 'Motion-Ball 2', role: 'titres de Motion-Ball' },
  { src: 'swapou/fontes/impact.woff', nom: 'Impact (Swapou)', jeu: 'Swapou', role: 'gros chiffres et accroches' },
  { src: 'frutiz/fontes/lcd.woff', nom: 'LCD du bureau', jeu: 'Bureau Frutiz', role: 'afficheur à cristaux (minuscules et chiffres) — compteurs' },
  { src: 'fb/DSEG7Classic-Bold.woff2', nom: 'DSEG7 Classic Bold', jeu: 'Site (light)', role: 'chiffres sept segments — compteurs',
    licence: 'SIL Open Font License 1.1 (DSEG, par Keshikan) — libre, y compris pour une vidéo commerciale.' },
];

const TEST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 éèàçêù !?&';

async function polices(nav) {
  const d = C.dossier('typo', 'polices');
  const els = [];
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  for (const p of POLICES) {
    const src = path.join(PUB, p.src);
    const buf = fs.readFileSync(src);
    const base = p.nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '');
    const ext = path.extname(src);
    fs.copyFileSync(src, path.join(d, base + ext));
    let ttf = null, presents = null;
    if (ext === '.woff') {
      ttf = W.woffVersTtf(buf);
      fs.writeFileSync(path.join(d, base + '.ttf'), ttf);
      presents = W.caracteres(ttf);
    }
    // Latin de base et Latin-1 seulement : au-delà, des fontes « complètes »
    // (Alba, 482 entrées) pointent sur des glyphes vides.
    const chars = presents ? [...presents].filter((c) => c > 32 && c <= 0xFF && c !== 0xAD).sort((a, b) => a - b).map((c) => String.fromCodePoint(c)).join('') : null;
    const manquent = presents ? [...TEST].filter((c) => c !== ' ' && !presents.has(c.codePointAt(0))).join('') : '';
    // Le spécimen : rendu par Chromium avec la fonte elle-même.
    const b64 = buf.toString('base64');
    const mime = ext === '.woff2' ? 'font/woff2' : 'font/woff';
    const echantillon = chars ? chars.replace(/[<>&]/g, '') : '0123456789 : . -';
    const titre = presents && presents.has(65) ? 'FRUTIPARC' : (presents && presents.has(97) ? 'frutiparc 2026' : '1 234 567');
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @font-face { font-family: F; src: url(data:${mime};base64,${b64}); }
      body { margin:0; width:1920px; height:1080px; background:#E8F8D3; color:#335511; font-family:Verdana,sans-serif; }
      .cadre { position:absolute; inset:40px; border:6px solid #ADE76B; border-radius:28px; background:#fff; padding:40px 56px; box-sizing:border-box; }
      .nom { font-size:30px; font-weight:bold; } .meta { font-size:20px; color:#5A7D33; margin-top:6px; }
      .grand { font-family:F; font-size:190px; line-height:1.1; margin:30px 0 10px; color:#2C4A0F; white-space:nowrap; overflow:hidden; }
      .glyphes { font-family:F; font-size:54px; line-height:1.25; word-break:break-all; color:#335511; }
      .manque { position:absolute; bottom:36px; left:56px; right:56px; font-size:18px; color:#B23B2E; }
    </style></head><body><div class="cadre">
      <div class="nom">${p.nom}</div><div class="meta">${p.jeu} — ${p.role}</div>
      <div class="grand">${titre}</div>
      <div class="glyphes">${echantillon}</div>
      <div class="manque">${manquent ? 'Absents de la fonte : ' + manquent.replace(/[<>&]/g, '') : ''}</div>
    </div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const spec = path.join(d, base + '-specimen.png');
    await page.screenshot({ path: spec });
    const fichier = ttf ? base + '.ttf' : base + ext;
    els.push({ fichier: 'typo/polices/' + fichier, type: 'police', titre: p.nom, groupe: 'Polices',
      description: 'Fonte de ' + p.jeu + ' (' + p.role + '), sortie du SWF d’origine. '
        + (presents ? presents.size + ' caractères présents' + (manquent ? ' — manquent : ' + manquent : ' — alphabet complet avec accents') + '. ' : '')
        + 'Licence : ' + (p.licence || 'non documentée dans le dépôt, à vérifier avant diffusion publique (fonte commerciale ou freeware d’époque, auteur non mentionné).'),
      usage: 'Cartons titres, sous-titres, compteurs.', affiche: 'typo/polices/' + base + '-specimen.png',
      variantes: [ttf ? 'typo/polices/' + base + ext : null, 'typo/polices/' + base + '-specimen.png'].filter(Boolean),
      caracteres: chars, licence: p.licence || 'à vérifier' });
  }
  await ctx.close();
  return els;
}

// ── Palette ───────────────────────────────────────────────────────────────
const PALETTE = [
  ['Vert pomme', '#ADE76B', 'la couleur du parc : liserés, en-têtes, fond des écrans de relevé'],
  ['Vert tendre', '#E8F8D3', 'fond clair des pages et des cartes'],
  ['Vert anis', '#CCF599', 'surlignage, boutons au survol'],
  ['Vert vif', '#94DB39', 'boutons d’action'],
  ['Vert feuille', '#73B01E', 'titres, pastilles'],
  ['Vert mousse', '#5A7D33', 'textes secondaires'],
  ['Vert sapin', '#335511', 'texte principal, fond sombre de l’accueil'],
  ['Vert forêt', '#2C4A0F', 'texte très foncé du light'],
  ['Rose framboise', '#F28687', 'flèches et boutons roses du bureau'],
  ['Rose bonbon', '#FFAAAD', 'fonds roses, bulles'],
  ['Rose dragée', '#FFEAEC', 'fond des encarts roses'],
  ['Rouge cerise', '#D16767', 'alertes, mentions'],
  ['Bordeaux', '#660000', 'texte sur rose'],
  ['Jaune citron', '#EAEA0F', 'surbrillance, étoiles'],
  ['Jaune paille', '#F8F866', 'fonds jaunes'],
  ['Rose chargement', '#BB1E1E', 'barre de chargement (haut du dégradé, → #FFC1C1)'],
  ['Gris fenêtre', '#DDDDDD', 'liseré des fenêtres du bureau'],
  ['Gris contour', '#444444', 'contour et titre des fenêtres'],
  ['Blanc', '#FFFFFF', 'fond des fenêtres'],
];

function palette() {
  const d = C.dossier('typo');
  const json = { nom: 'Frutiparc', source: 'public/light.html, public/bureau-frutiz.css (couleurs les plus employées)',
    couleurs: PALETTE.map(([nom, hex, role]) => ({ nom, hex, role })) };
  fs.writeFileSync(path.join(d, 'palette-frutiparc.json'), JSON.stringify(json, null, 1) + '\n');
  fs.writeFileSync(path.join(d, 'palette-frutiparc.css'), ':root {\n' + PALETTE.map(([n, h, r]) =>
    '  --fp-' + n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '-') + ': ' + h + ';  /* ' + r + ' */').join('\n') + '\n}\n');
  fs.writeFileSync(path.join(d, 'palette-frutiparc.gpl'), 'GIMP Palette\nName: Frutiparc\nColumns: 5\n#\n'
    + PALETTE.map(([n, h]) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => String(x).padStart(3)).join(' ') + '\t' + n + ' ' + h; }).join('\n') + '\n');
  return d;
}

async function planchePalette(nav) {
  const d = C.dossier('typo');
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const clair = (h) => { const v = parseInt(h.slice(1), 16); return (((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) > 150; };
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:1920px;height:1080px;background:#E8F8D3;font-family:Verdana,sans-serif;color:#335511}
    h1{font-size:34px;margin:40px 60px 20px} .g{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;margin:0 60px}
    .c{height:178px;border-radius:18px;border:4px solid #ADE76B;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end}
    .n{font-weight:bold;font-size:22px}.h{font-size:20px;font-family:monospace;margin-top:4px}
  </style></head><body><h1>Palette Frutiparc</h1><div class="g">${PALETTE.map(([n, h]) =>
    `<div class="c" style="background:${h};color:${clair(h) ? '#2C4A0F' : '#FFFFFF'}"><div class="n">${n}</div><div class="h">${h}</div></div>`).join('')}</div></body></html>`);
  await page.screenshot({ path: path.join(d, 'palette-frutiparc.png') });
  await ctx.close();
  return { fichier: 'typo/palette-frutiparc.png', type: 'image', titre: 'Palette Frutiparc', largeur: 1920, hauteur: 1080, alpha: false,
    description: 'Les ' + PALETTE.length + ' couleurs maîtresses du parc avec leur code hexadécimal, relevées dans les feuilles de style '
      + 'du light et du bureau Frutiz. En variantes : JSON (avec le rôle de chaque couleur), CSS, et GPL (GIMP / Inkscape / Krita).',
    usage: 'Cartons, sous-titres, fonds unis raccord avec le site.',
    variantes: ['typo/palette-frutiparc.json', 'typo/palette-frutiparc.css', 'typo/palette-frutiparc.gpl'] };
}

async function main() {
  const nav = await chromium.launch();
  try {
    const els = logos();
    palette();
    const pal = await planchePalette(nav);
    const pol = await polices(nav);
    C.majManifeste(['logos/', 'typo/'], els.concat([pal], pol));
    console.log('logos, palette et', pol.length, 'polices écrits dans', C.SORTIE);
  } finally { await nav.close(); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
