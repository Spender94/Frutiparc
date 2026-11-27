#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE — SECTION « frusion-fd » : on glisse un Fruti-Disque dans la Frusion.
 *
 *   node scripts/kit-bande-annonce/frusion-fd/generer.js [large] [gros-plan] [detoure]
 *
 * (sans argument : les trois prises ; port 4470 par défaut, KIT_PORT pour un
 * autre ; sortie dans /home/user/Frutiparc/kit-bande-annonce/frusion-fd.)
 *
 * Le VRAI bureau Frutiz (/light en largeur bureau → public/bureau-frutiz.js),
 * sur le serveur local, compte FICTIF « pomelo » (bouille du casting). « Mes
 * disques » est un catalogue (server.js, /ff/ls?uid=disccollector) : tout
 * compte y trouve les FD noirs (anneau 0) de Grapiz, Bandas, Swapou et
 * JamaJama — rien à accorder. On prend celui de SWAPOU.
 *
 * Le geste, avec un curseur mimé (une flèche dessinée, comme le kit existant)
 * et de VRAIS événements souris (page.mouse : pointerdown / pointermove /
 * pointerup, les gestionnaires du bureau) :
 *   1. clic sur « Mes disques » : la fenêtre s'ouvre ;
 *   2. on attrape le FD noir de Swapou : dès le premier mouvement, le tiroir
 *      de la Frusion SORT (frusion.onStartDragDisc → openSlot) ;
 *   3. on le lâche sur le tiroir : le disque s'y pose, le tiroir REMONTE
 *      (closeSlot, l'approche exponentielle du clip Flash, r = 0,8^tmod), et
 *      une fois refermé le disque PREND SA VITESSE (rotateDisc, jusqu'à 140°
 *      par battement) puis file ;
 *   4. le jeu s'ouvre dans un onglet « Swapou » (frusion.lancer) : écran titre.
 * C'est la mécanique du clip `frusion` d'époque, portée en JS : c'est elle,
 * l'animation d'insertion, et elle est filmée. (frusion/animfrusion.swf est
 * une autre animation, Flash, que le bureau JS ne joue pas.)
 *
 * Trois prises, déterministes (horloge de la page pilotée image par image,
 * extras/commun.js + extras/scene.js ; photos poussées dans ffmpeg par pipe) :
 *   large      tout le bureau, 1280 × 720 CSS rendu à l'échelle 1,5 → 1920 × 1080 ;
 *   gros-plan  la Frusion seule, un cadre 320 × 180 CSS autour d'elle rendu à
 *              l'échelle 6 → 1920 × 1080 nets (rien n'est agrandi après coup) ;
 *   detoure    le même cadre, seuls la Frusion, le disque glissé et le curseur :
 *              WebM transparent + MP4 fond vert.
 * Le seul temps réel : après le lâcher, on laisse 1,5 s au réseau (sans
 * avancer l'horloge) pour que l'onglet du jeu charge ses images.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const S = require('./serveur.js');
const C = S.C;
const Sc = require('../extras/scene.js');

const SECTION = 'frusion-fd';
const SORTIE = S.sortie(SECTION);
const DUREE = 11;
const T_AFFICHE = 4.55;          // le disque au-dessus du tiroir ouvert
// Le cadre du gros plan, en pixels CSS : la Frusion est en haut à droite
// (#frusion-boite à x 1157, 119 × 78 ; le tiroir ouvert descend jusqu'à 145).
const CADRE = { x: 960, y: 0, width: 320, height: 180 };

// Le compte fictif : inscription, bouille du casting, connexion. Sur une base
// toute neuve le serveur répond avant d'avoir fini ses tables : on vérifie
// que l'admin a bien posé la bouille, et on recommence sinon.
async function comptePomelo() {
  const cast = C.casting();
  for (let i = 0; i < 10; i++) {
    await C.api('/api/auth/register', { username: 'pomelo', password: 'kit-bande-annonce' });
    const r = await C.admin('/api/admin/users/pomelo', { fbouille: cast.spectateur.bouille, display_name: 'Pomelo',
      xp: 5200, kikooz: 1350, needs_bouille: false }, 'PATCH');
    if (r && r.ok) break;
    await C.attendre(1000);
  }
  return C.compte('pomelo');
}

// Le geste, commun aux trois prises (temps en secondes).
function plans() {
  const disque = '.ex-slot-disque:has(img[src*="disc_jaquette_swapou2"])';
  return [
    { t: 0.4, vers: '.home-tile[data-go="disques"]', duree: 0.9, clic: true, reseau: 700 },
    { t: 2.0, vers: disque, duree: 0.75 },
    { t: 2.95, faire: async (page) => { await page.mouse.down(); } },
    // Un petit décollage d'abord (le seuil de 4 px du bureau), puis la
    // traversée jusqu'au tiroir, qui est sorti entre-temps.
    { t: 3.05, vers: [700, 214], duree: 0.25 },
    { t: 3.35, vers: '#frusion-boite .fr-cible', dy: 4, duree: 1.35 },
    { t: 4.9, faire: async (page) => { await page.mouse.up(); }, reseau: 1500 },
    { t: 5.7, vers: [1010, 330], duree: 1.3 },
  ];
}

async function ouvrirBureau(nav, sid, o) {
  const cap = new C.Capture(nav, Object.assign({ largeur: 1280, hauteur: 720, fps: 60 }, o));
  await cap.ouvrir(C.BASE + '/light?sid=' + sid);
  await Sc.prechauffer(cap, 5, 40);
  // Le salon Pomme s'ouvre d'office à la connexion : on le referme avant de
  // tourner (le plan parle des disques, pas du chat).
  const fermer = cap.page.locator('.fen:has(#chat-panel) .fen-btn.fermer');
  if (await fermer.count()) await fermer.first().click();
  await Sc.prechauffer(cap, 1.5, 40);
  if (o.detoure) {
    // Tout disparaît sauf la Frusion, le disque glissé (et le curseur, posé
    // hors de <body>). Un élément `visibility: hidden` ne reçoit plus les
    // clics : la tuile « Mes disques » et sa fenêtre restent donc visibles
    // pour que le geste se fasse — elles sont hors du cadre filmé.
    await cap.page.addStyleTag({ content: `
      html, body, body.bureau-frutiz { background: transparent !important; }
      body * { visibility: hidden !important; }
      #frusion-boite, #frusion-boite *, .fb-glisse-icone, .fb-glisse-icone *,
      .home-tile[data-go="disques"], .home-tile[data-go="disques"] *,
      .fen:has(.ex-slot-disque), .fen:has(.ex-slot-disque) * { visibility: visible !important; }` });
  }
  return cap;
}

function ecrireAffiche(img, fichier) {
  const tmp = fichier + '.tmp.png';
  fs.writeFileSync(tmp, img);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp,
    '-vf', 'scale=1920:1080:flags=lanczos', fichier]);
  fs.unlinkSync(tmp);
}

async function prise(nav, sid, nom, o, sorties) {
  console.log('prise', nom, '…');
  const cap = await ouvrirBureau(nav, sid, o);
  const enc = C.encodeur(sorties, { largeur: 1920, hauteur: 1080, fps: 60 });
  let affiche = null;
  await Sc.tourner(cap, plans(), { duree: DUREE, enc, clip: o.clip, depart: { x: 760, y: 470 },
    affiche: T_AFFICHE, surAffiche: (img) => { affiche = img; } });
  await enc.fin();
  if (affiche) ecrireAffiche(affiche, path.join(SORTIE, nom + '.png'));
  await cap.fermer();
}

function manifeste() {
  const ent = (rel, champs) => S.entreeVideo(SORTIE, rel, champs);
  const elements = [];
  const existe = (f) => fs.existsSync(path.join(SORTIE, f));
  if (existe('fd-frusion-large.mp4')) {
    elements.push(ent('fd-frusion-large.mp4', { titre: 'Un FD dans la Frusion — tout le bureau', alpha: false,
      affiche: 'fd-frusion-large.png',
      description: 'Le vrai bureau Frutiz, compte fictif Pomelo : on ouvre « Mes disques », on attrape le Fruti-Disque '
        + 'noir de Swapou — le tiroir de la Frusion sort aussitôt, en haut à droite —, on le traverse tout l’écran et on '
        + 'le lâche dedans : le tiroir remonte, le disque prend sa vitesse et file, et Swapou s’ouvre dans son onglet '
        + '(écran titre). Glisser réel (événements souris), curseur dessiné pour mimer le geste.',
      usage: 'Le geste fondateur du parc, en un plan : « on glisse le disque, le jeu démarre ». Couper entre 2 s (prise '
        + 'du disque) et 7 s (écran titre) pour un plan court.' }));
  }
  if (existe('fd-frusion-gros-plan.mp4')) {
    elements.push(ent('fd-frusion-gros-plan.mp4', { titre: 'Un FD dans la Frusion — gros plan', alpha: false,
      affiche: 'fd-frusion-gros-plan.png',
      description: 'Le même geste, caméra serrée sur la console : le tiroir qui sort, le disque de Swapou qui arrive au '
        + 'bout du curseur, se pose, le tiroir qui remonte en douceur et le disque qui s’emballe. Rendu six fois plus fin '
        + '(échelle 6 du navigateur), pas agrandi : les dessins vectoriels de la Frusion sont nets.',
      usage: 'Insert sur le temps fort ; se prête à un zoom ou un ralenti en montage.' }));
  }
  if (existe('fd-frusion-detoure.webm')) {
    elements.push(ent('fd-frusion-detoure.webm', { titre: 'Un FD dans la Frusion — détouré', alpha: true,
      affiche: 'fd-frusion-detoure.png', variantes: ['fd-frusion-detoure-vert.mp4'],
      description: 'Le gros plan sans le bureau : seuls la Frusion, le disque glissé et le curseur, sur fond transparent '
        + '(WebM VP9 avec alpha) et sur fond vert #00FF00 (MP4). Même minutage que les deux autres prises.',
      usage: 'À incruster sur n’importe quel fond (un plan de jeu, un titre) : la console qui avale un disque.' }));
  }
  const m = {
    section: SECTION, titre: 'Un FD dans la Frusion',
    texte: 'Le geste qui lance un jeu sur le bureau Frutiz : on glisse un Fruti-Disque (FD) noir depuis « Mes disques » '
      + 'dans la Frusion, la console en haut à droite. Le tiroir sort dès qu’on attrape le disque, l’avale, remonte, le '
      + 'disque tourne et le jeu (Swapou) s’ouvre. C’est la mécanique du clip Flash d’époque portée en JS, filmée image '
      + 'par image sur le vrai bureau, compte fictif. En 1920 × 1080 à 60 i/s : plan large, gros plan net, et version '
      + 'détourée (transparente et fond vert). Les scènes « frusion » et « frusion-defile » de l’admin montrent le '
      + 'lecteur ; ici, c’est l’insertion.',
    elements,
  };
  fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
}

async function principal() {
  const demandes = process.argv.slice(2);
  const faire = (n) => !demandes.length || demandes.includes(n);
  const srv = await S.demarrer();
  const nav = await chromium.launch();
  try {
    const sid = await comptePomelo();
    if (faire('large')) {
      await prise(nav, sid, 'fd-frusion-large', { echelle: 1.5 }, { mp4: path.join(SORTIE, 'fd-frusion-large.mp4') });
    }
    if (faire('gros-plan')) {
      await prise(nav, sid, 'fd-frusion-gros-plan', { echelle: 6, clip: CADRE },
        { mp4: path.join(SORTIE, 'fd-frusion-gros-plan.mp4') });
    }
    if (faire('detoure')) {
      await prise(nav, sid, 'fd-frusion-detoure', { echelle: 6, clip: CADRE, transparent: true, detoure: true },
        { webm: path.join(SORTIE, 'fd-frusion-detoure.webm'), vert: path.join(SORTIE, 'fd-frusion-detoure-vert.mp4') });
    }
  } finally {
    await nav.close();
    srv.arreter();
  }
  manifeste();
  console.log('fait :', SORTIE);
}

principal().catch((e) => { console.error(e); process.exit(1); });
