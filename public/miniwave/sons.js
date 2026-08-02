/*
 * Miniwave 2 — les sons du jeu.
 *
 * Trente-quatre sons extraits du SWF d'origine (scripts/extract-swf-sounds.js).
 * Le jeu les organise en CANAUX numérotés : un même canal ne joue qu'un son à la
 * fois, ce qui évite qu'une rafale de tirs se superpose à elle-même jusqu'à
 * saturer. On garde cette organisation — c'est elle qui donne au jeu son mixage.
 *
 * Deux contraintes du navigateur, absentes de Flash :
 *
 *   • le son ne démarre qu'après un geste du joueur. On prépare tout au
 *     chargement, et on ouvre le contexte au premier appui ;
 *   • rien ne garantit qu'un format soit lisible. Les sons du jeu sortent en
 *     MP3 (tels quels) et en WAV (l'ADPCM de Flash, décodé) : les deux sont
 *     lus partout.
 */
'use strict';

(function () {

const BASE = '/miniwave/sons/';

// nom → fichier. Les sons ADPCM sont sortis en WAV, les autres en MP3.
const FICHIERS = {
  sLaser0: 'mp3', sLaser1: 'mp3', sLaser2: 'mp3', sLaser3: 'wav', sLaser4: 'wav',
  sLaser5: 'wav', sLaser6: 'wav', sLaser7: 'wav',
  sPop0: 'wav', sPop1: 'wav', sPop2: 'wav',
  sBlast0: 'wav', sExplo2: 'wav', sExplo4: 'wav', sFlameBlop: 'wav',
  sMissile: 'wav', sMissileLaunch: 'wav', sZap: 'wav', sBigLaser: 'wav',
  sMetalHit: 'mp3', sWarp0: 'wav', sSaucer: 'wav', sJingle2: 'mp3',
  sWaveBeep0: 'mp3', sWaveBeep1: 'mp3', sWaveBeep2: 'mp3', sWaveBeep3: 'mp3',
  // Le menu : le froissement d'une page qui s'ouvre, le bip d'un choix, celui
  // d'un refus, et la musique d'accueil.
  sMenu: 'mp3', sMenuPage: 'wav', sMenuBeep: 'wav', sMenuBeep2: 'wav', sMenuBeepWrong: 'wav',
};

// Les canaux du jeu, repris de ses appels : le tir du vaisseau et celui des
// ennemis ne se marchent pas dessus, la soucoupe tourne en boucle sur le sien.
const CANAL = {
  tirHero: 10, tirBads: 12, explosion: 11, degat: 14, arme: 62,
  soucoupe: 57, saut: 15, vague: 32, jingle: 33,
  // Le menu a les siens (Box.tryToInitContent joue sMenuBeep2 sur 47).
  menu: 47, musique: 1,
};

// Le son du tir, vaisseau par vaisseau (sp/hero/*.as).
const TIR_VAISSEAU = ['sLaser1', 'sLaser3', 'sLaser2', 'sLaser0', 'sLaser4', 'sLaser6'];
// Et celui de leur bombe.
const BOMBE_VAISSEAU = ['sExplo2', 'sFlameBlop', 'sMissileLaunch', 'sMissile', 'sZap', 'sBigLaser'];

class Sons {
  constructor() {
    this.buffers = new Map();
    this.canaux = new Map();          // canal → { source, gain }
    this.ctx = null;
    this.actif = true;
    this.pret = false;
  }

  // Télécharge tout, mais ne décode qu'à l'ouverture du contexte : décoder
  // demande un AudioContext, qui demande un geste du joueur.
  charger() {
    const noms = Object.keys(FICHIERS);
    return Promise.all(noms.map((n) => fetch(BASE + n + '.' + FICHIERS[n])
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((a) => { if (a) this.buffers.set(n, a); })
      .catch(() => {})))
      .then(() => { this.pret = true; });
  }

  // Le premier appui du joueur ouvre le son. Tant qu'il n'a pas eu lieu, tous
  // les appels sont sans effet — et sans erreur.
  ouvrir() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    for (const [nom, brut] of this.buffers) {
      // decodeAudioData consomme le tampon : on lui en donne une copie, pour
      // pouvoir redécoder si le contexte est recréé.
      this.ctx.decodeAudioData(brut.slice(0), (b) => this.buffers.set(nom, b), () => {});
    }
  }

  buffer(nom) {
    const b = this.buffers.get(nom);
    return (b && b.duration !== undefined) ? b : null;   // décodé, pas brut
  }

  jouer(nom, canal, boucle) {
    if (!this.actif || !this.ctx) return;
    const buf = this.buffer(nom);
    if (!buf) return;
    this.arreter(canal);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!boucle;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(0);
    if (canal !== undefined) this.canaux.set(canal, src);
  }

  boucler(nom, canal) { this.jouer(nom, canal, true); }

  arreter(canal) {
    if (canal === undefined) return;
    const src = this.canaux.get(canal);
    if (!src) return;
    try { src.stop(); } catch (e) {}
    this.canaux.delete(canal);
  }

  taire(muet) {
    this.actif = !muet;
    if (muet) for (const c of [...this.canaux.keys()]) this.arreter(c);
  }

  // Traduit les annonces du moteur en sons. C'est la seule chose que ce module
  // sait du jeu — il ne décide de rien.
  surEvenement(nom, d) {
    switch (nom) {
      case 'tirHero': this.jouer(TIR_VAISSEAU[d.type] || 'sLaser1', CANAL.tirHero); break;
      case 'tirBads': this.jouer('sLaser5', CANAL.tirBads); break;
      case 'bombe': this.jouer(BOMBE_VAISSEAU[d.type] || 'sExplo2', CANAL.arme); break;
      case 'badsExplose':
        this.jouer('sPop' + Math.floor(Math.random() * 3), CANAL.explosion);
        break;
      case 'heroExplose': this.jouer('sBlast0', CANAL.degat); break;
      case 'bonus': this.jouer('sMetalHit', CANAL.degat); break;
      case 'saut':
      case 'warp': this.jouer('sWarp0', CANAL.saut); break;
      case 'soucoupe': this.boucler('sSaucer', CANAL.soucoupe); break;
      case 'soucoupeExplose':
        this.arreter(CANAL.soucoupe);
        this.jouer('sPop0', CANAL.explosion);
        break;
      case 'bipVague': this.jouer('sWaveBeep' + (d.index % 4), CANAL.vague); break;
      case 'panneau': if (!d.boss) this.jouer('sJingle2', CANAL.jingle); break;
      case 'bossExplose': this.jouer('sExplo4', CANAL.arme); break;
      case 'finPartie': for (const c of [...this.canaux.keys()]) this.arreter(c); break;
      default: break;
    }
  }
}

window.MiniwaveSons = { Sons, FICHIERS, TIR_VAISSEAU, BOMBE_VAISSEAU, CANAL };

})();
