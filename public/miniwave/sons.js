/*
 * Miniwave 2 — les sons du jeu.
 *
 * Trente-quatre sons extraits du SWF d'origine (scripts/extract-swf-sounds.js).
 * Le jeu les organise en CANAUX numérotés : un même canal ne joue qu'un son à la
 * fois, ce qui évite qu'une rafale de tirs se superpose à elle-même jusqu'à
 * saturer. On garde cette organisation — c'est elle qui donne au jeu son mixage.
 * Les VOLUMES viennent aussi des sources : le jeu baisse certains canaux au
 * moment de jouer (le laser ennemi à 20, les bips de vague à 25, le jingle à
 * 80…) — sans quoi les bips, très fréquents en fin de niveau, écrasent tout.
 *
 * Trois contraintes du navigateur, absentes de Flash :
 *
 *   • le son ne démarre qu'après un geste du joueur. On prépare tout au
 *     chargement, et on ouvre le contexte au premier appui — et si l'appui
 *     arrive AVANT la fin du chargement, on décode ce qui manque dès qu'il
 *     arrive (sans ça, un clic pendant la barre de chargement laissait le jeu
 *     muet pour toujours : c'était le bug « plus aucun son sur Chrome ») ;
 *   • le graphe audio doit rester PETIT. Créer un nœud de gain par lecture
 *     finit par encombrer WebKit — latence qui monte, puis onglet qui casse
 *     sur iPhone quand les bips s'accélèrent. Un gain PERSISTANT par canal,
 *     une source jetable par lecture, et les sources coupées sont détachées
 *     du graphe dès qu'elles se terminent ;
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

// Les volumes posés par le jeu au moment de jouer (setVolume des sources) :
// Tequila baisse son laser à 50, le Manzana à 40, le tir ennemi joue à 20,
// les bips de vague à 25 et le jingle de niveau à 80. Le reste est à 100.
const VOLUMES = {
  sLaser1: 50, sLaser0: 40, sLaser5: 20,
  sWaveBeep0: 25, sWaveBeep1: 25, sWaveBeep2: 25, sWaveBeep3: 25,
  sJingle2: 80,
};

// Le son du tir, vaisseau par vaisseau (sp/hero/*.as). Le Cherry entamé change
// d'arme ET de son : sLaser7 quand il ne lui reste qu'un point de coque.
const TIR_VAISSEAU = ['sLaser1', 'sLaser3', 'sLaser2', 'sLaser0', 'sLaser4', 'sLaser6'];
// Et celui de leur bombe.
const BOMBE_VAISSEAU = ['sExplo2', 'sFlameBlop', 'sMissileLaunch', 'sMissile', 'sZap', 'sBigLaser'];

class Sons {
  constructor() {
    this.bruts = new Map();           // nom → ArrayBuffer téléchargé
    this.buffers = new Map();         // nom → AudioBuffer décodé
    this.decode = new Set();          // décodage lancé (évite de décoder deux fois)
    this.canaux = new Map();          // canal → { gain, src, nom }
    this.ctx = null;
    this.master = null;
    this.actif = true;
    this.pret = false;
    this.derniere = new Map();        // nom → date de dernière lecture (anti-rafale)
  }

  // Télécharge tout. Le décodage attend l'AudioContext — qui attend un geste du
  // joueur — mais si le contexte est DÉJÀ ouvert (appui pendant le chargement),
  // on décode au fil de l'eau : c'est ce rattrapage qui manquait.
  charger() {
    const noms = Object.keys(FICHIERS);
    return Promise.all(noms.map((n) => fetch(BASE + n + '.' + FICHIERS[n])
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((a) => { if (a) { this.bruts.set(n, a); if (this.ctx) this.decoder(n); } })
      .catch(() => {})))
      .then(() => { this.pret = true; });
  }

  // Le premier appui du joueur ouvre le son. Tant qu'il n'a pas eu lieu, tous
  // les appels sont sans effet — et sans erreur.
  ouvrir() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.actif ? 0.6 : 0;
    this.master.connect(this.ctx.destination);
    for (const nom of this.bruts.keys()) this.decoder(nom);
    // iOS suspend le contexte quand l'onglet passe derrière : on le relance au
    // retour, sinon le jeu revient muet.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    });
  }

  decoder(nom) {
    if (this.decode.has(nom)) return;
    const brut = this.bruts.get(nom);
    if (!brut) return;
    this.decode.add(nom);
    // decodeAudioData consomme le tampon : on lui en donne une copie, pour
    // pouvoir redécoder si le contexte est recréé.
    this.ctx.decodeAudioData(brut.slice(0),
      (b) => this.buffers.set(nom, b),
      () => { this.decode.delete(nom); });
  }

  // Le gain d'un canal est créé UNE fois et gardé : c'est lui qui porte le
  // volume, et c'est sa permanence qui garde le graphe audio petit.
  canal(num) {
    let c = this.canaux.get(num);
    if (!c) {
      c = { gain: this.ctx.createGain(), src: null, nom: null };
      c.gain.connect(this.master);
      this.canaux.set(num, c);
    }
    return c;
  }

  jouer(nom, canal, boucle) {
    if (!this.actif || !this.ctx) return;
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); return; }
    const buf = this.buffers.get(nom);
    if (!buf) { this.decoder(nom); return; }

    // Anti-rafale : deux lectures du même son dans la même poignée de
    // millisecondes n'en font qu'une. En fin de niveau, la vague boucle
    // plusieurs fois par image et peut demander le même bip plusieurs fois
    // d'un coup — le relancer à chaque fois ne s'entend pas, mais s'accumule.
    const t = performance.now();
    if (!boucle) {
      const d = this.derniere.get(nom);
      if (d !== undefined && t - d < 35) return;
      this.derniere.set(nom, t);
    }

    const c = this.canal(canal === undefined ? -1 : canal);
    if (c.src) { try { c.src.stop(); } catch (e) {} c.src = null; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!boucle;
    src.connect(c.gain);
    c.gain.gain.value = (VOLUMES[nom] === undefined ? 100 : VOLUMES[nom]) / 100;
    // La source coupée ou finie se détache du graphe : rien ne s'accumule.
    src.onended = () => {
      try { src.disconnect(); } catch (e) {}
      if (c.src === src) c.src = null;
    };
    src.start(0);
    c.src = src;
    c.nom = nom;
  }

  boucler(nom, canal) { this.jouer(nom, canal, true); }

  arreter(canal) {
    const c = this.canaux.get(canal);
    if (!c || !c.src) return;
    try { c.src.stop(); } catch (e) {}
    c.src = null;
  }

  arreterTout() { for (const num of this.canaux.keys()) this.arreter(num); }

  taire(muet) {
    this.actif = !muet;
    if (this.master) this.master.gain.value = muet ? 0 : 0.6;
    if (muet) this.arreterTout();
  }

  // La pause fige le son avec le jeu : on suspend le contexte entier, ce qui
  // gèle aussi la boucle de la soucoupe, et on le relâche à la reprise.
  suspendre(oui) {
    if (!this.ctx) return;
    if (oui) this.ctx.suspend().catch(() => {});
    else if (this.actif) this.ctx.resume().catch(() => {});
  }

  // Traduit les annonces du moteur en sons. C'est la seule chose que ce module
  // sait du jeu — il ne décide de rien.
  surEvenement(nom, d) {
    switch (nom) {
      case 'tirHero':
        // Cherry entamé : l'éventail sonne différemment (sLaser7).
        this.jouer((d.type === 5 && d.hp === 1) ? 'sLaser7' : (TIR_VAISSEAU[d.type] || 'sLaser1'),
          CANAL.tirHero);
        break;
      case 'tirBads': this.jouer('sLaser5', CANAL.tirBads); break;
      case 'bombe': this.jouer(BOMBE_VAISSEAU[d.type] || 'sExplo2', CANAL.arme); break;
      // Le missile du Pastaga saute (rappel du tir, contact, sortie d'écran) :
      // même son que dans Shot.onKill — sExplo4 sur le canal des armes.
      case 'missileExplose': this.jouer('sExplo4', CANAL.arme); break;
      case 'badsExplose':
        this.jouer('sPop' + Math.floor(Math.random() * 3), CANAL.explosion);
        break;
      case 'heroExplose': this.jouer('sBlast0', CANAL.degat); break;
      case 'bonus': this.jouer('sMetalHit', CANAL.degat); break;
      case 'saut':
      case 'warp': this.jouer('sWarp0', CANAL.saut); break;
      case 'soucoupe': this.boucler('sSaucer', CANAL.soucoupe); break;
      // sp/Saucer.kill coupe la boucle QUOI QU'IL ARRIVE — abattue ou sortie par
      // le bord. `soucoupeFin` part des deux chemins, `soucoupeExplose` n'ajoute
      // que la détonation.
      case 'soucoupeFin': this.arreter(CANAL.soucoupe); break;
      case 'soucoupeExplose':
        this.arreter(CANAL.soucoupe);
        this.jouer('sPop0', CANAL.explosion);
        break;
      case 'bipVague': this.jouer('sWaveBeep' + (d.index % 4), CANAL.vague); break;
      case 'panneau': if (!d.boss) this.jouer('sJingle2', CANAL.jingle); break;
      case 'bossExplose': this.jouer('sExplo4', CANAL.arme); break;
      case 'finPartie': this.arreterTout(); break;
      default: break;
    }
  }
}

window.MiniwaveSons = { Sons, FICHIERS, VOLUMES, TIR_VAISSEAU, BOMBE_VAISSEAU, CANAL };

})();
