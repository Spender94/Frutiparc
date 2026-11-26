/*
 * Kit bande-annonce, section « chat » — LE MANIFESTE.
 *
 * Relève ce qui a été produit dans le dossier de sortie (ffprobe pour la
 * durée, la cadence et la taille) et l'écrit dans manifest.json, avec les
 * titres et descriptions des plans (generer.js). Se relance seul :
 *   node scripts/kit-bande-annonce/chat/manifeste.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function sonder(fichier) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
    '-show_streams', '-show_format', fichier], { encoding: 'utf8' }));
  const v = j.streams.find((s) => s.codec_type === 'video') || {};
  const [a, b] = String(v.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duree: Math.round(Number(j.format.duration) * 100) / 100,
    fps: b ? Math.round(a / b * 100) / 100 : 0,
    largeur: v.width, hauteur: v.height,
  };
}

function ecrire(sortie, plans) {
  const elements = [];
  for (const [nom, p] of Object.entries(plans)) {
    const principal = path.join(sortie, nom + (p.alpha ? '.webm' : '.mp4'));
    if (!fs.existsSync(principal)) continue;
    const s = sonder(principal);
    const variantes = [];
    if (p.alpha && fs.existsSync(path.join(sortie, nom + '-vert.mp4'))) variantes.push(nom + '-vert.mp4');
    elements.push({
      fichier: path.basename(principal), type: 'video', titre: p.titre,
      description: p.description, usage: p.usage,
      duree: s.duree, fps: s.fps, largeur: s.largeur, hauteur: s.hauteur,
      alpha: !!p.alpha,
      affiche: fs.existsSync(path.join(sortie, nom + '.png')) ? nom + '.png' : undefined,
      variantes,
    });
  }
  const manifeste = {
    section: 'chat',
    titre: 'Le chat — des bouilles en scène',
    texte: 'Des scènes de salon jouées pour de bon : le site tourne en local, les personnages du casting '
      + '(comptes fictifs, bouilles posées par l’éditeur) entrent dans un salon et y parlent le vrai protocole '
      + 'du chat, et l’on filme le vrai client du spectateur (Pomelo) en mode bureau Frutiz — la colonne des '
      + 'bouilles ouverte, en « aquarium » quand le salon est plein, un écran par personne quand on est peu. '
      + 'Tournage image par image (horloge de la page pilotée, chaque trame livrée à l’image près) : 60 i/s '
      + 'fluides. Scénario modifiable : scripts/kit-bande-annonce/chat/scenes.json ; tout se régénère par '
      + '« node scripts/kit-bande-annonce/chat/generer.js ».',
    elements,
  };
  fs.writeFileSync(path.join(sortie, 'manifest.json'), JSON.stringify(manifeste, null, 2) + '\n');
  console.log(`manifest.json : ${elements.length} élément(s)`);
}

if (require.main === module) {
  const { PLANS } = require('./generer');
  ecrire(process.env.KIT_CHAT_SORTIE || '/home/user/Frutiparc/kit-bande-annonce/chat', PLANS);
}

module.exports = { ecrire, sonder };
