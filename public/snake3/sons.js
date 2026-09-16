/*
 * Frutisnake — les sons, au format de asml.SoundManager.
 *
 * Le jeu d'origine mixe par CANAUX numérotés : 0 les bruitages, 1 et 2 les
 * deux pistes de musique qui se répondent en fondu (menu ↔ partie, 1,5 s —
 * Const.MUSIC_FADE_LENGTH). Un canal ne joue qu'UN son à la fois : rejouer
 * dessus coupe le précédent — c'est le mixage d'origine, on le garde tel quel
 * (un glurps rapproché remplace le glurps en cours, comme en Flash).
 *
 * Les 22 sons sont les MP3 extraits du SWF (scripts/extract-snake3-sprites.js),
 * nommés d'après la banque WAV d'origine. Contraintes navigateur, déjà
 * éprouvées sur Miniwave (public/miniwave/sons.js) :
 *   · le contexte ne s'ouvre qu'après un geste — on précharge tout, on décode
 *     au premier appui même si le téléchargement vient à peine de finir ;
 *   · un gain PERSISTANT par canal, une source jetable par lecture, détachée
 *     dès qu'elle se termine — le graphe reste petit, Safari reste vivant.
 */
'use strict';

(function (racine) {

const BASE = '/snake3/sons/';
const NOMS = ['explose', 'selmenu', 'sabre', 'rotmenu', 'retmenu', 'ressort',
  'page', 'menu_loop', 'game_loop', 'langue', 'game_over', 'glurps',
  'glurps_2', 'effect_end', 'dynamite', 'fdisp', 'coffre', 'sonnette',
  'cloche', 'ciseaux', 'potion', 'option'];
// Les deux musiques se décodent avant tout le reste (voir preparer).
const MUSIQUES = new Set(['menu_loop', 'game_loop']);
const DECODAGE_PATIENCE = 10000;      // ms avant de passer au son suivant

class Sons {
  constructor() {
    this.bruts = new Map();           // nom → ArrayBuffer téléchargé
    this.buffers = new Map();         // nom → AudioBuffer décodé
    this.decode = new Set();
    this.canaux = new Map();          // canal → { gain, volume, actif, src, nom, boucle }
    this.fondus = [];                 // { de, vers, duree, t, volDepart }
    this.ctx = null;
    this.master = null;
    this.chargeLance = false;
    this.aDecoder = [];               // les sons téléchargés, dans l'ordre où on les décode
    this.decodeEnCours = null;

    const ouvrir = () => this.ouvrir();
    window.addEventListener('pointerdown', ouvrir, { capture: true });
    window.addEventListener('pointerup', ouvrir, { capture: true });
    window.addEventListener('keydown', ouvrir, { capture: true });
  }

  // Le téléchargement des vingt-deux MP3. Il partait dès la construction, et
  // faisait la queue devant les dessins du menu — sur six connexions, c'est un
  // menu qui vient plus tard. Le jeu l'appelle une fois le menu prêt (et le
  // premier geste l'appelle aussi, au cas où) : un son demandé avant son
  // arrivée part dès qu'il est décodé (enAttente).
  charger() {
    if (this.chargeLance) return;
    this.chargeLance = true;
    // Le contexte s'ouvre DÈS MAINTENANT, suspendu — de quoi décoder pendant
    // que le menu tourne (voir preparer). Le premier geste le réveillera.
    this.preparer();
    for (const nom of NOMS) {
      fetch(BASE + nom + '.mp3')
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => {
          if (!b) return;
          this.bruts.set(nom, b);
          this.decoder(nom);
        })
        .catch(() => {});
    }
  }

  /*
   * LE CONTEXTE AVANT LE GESTE, LE DÉCODAGE UN SON À LA FOIS.
   *
   * Le contexte ne s'ouvrait qu'au premier geste — et le premier geste d'un
   * joueur au doigt, c'est le tap sur « jouer ». Les vingt-deux MP3 partaient
   * alors au décodage D'UN COUP, au moment même où l'arène se lève : la
   * musique de partie pèse à elle seule 632 ko, soit près d'une minute de son
   * à déplier en PCM (une vingtaine de mégaoctets), les vingt-et-un autres
   * par-dessus, sur les cœurs que la partie voudrait pour elle. C'est un
   * « lag au début » de plus, et celui-là ne se voit pas sur un banc sans
   * geste.
   *
   * Un contexte se CRÉE sans geste, suspendu : il décode très bien dans cet
   * état, et seul `resume()` a besoin du geste — il le reçoit au premier
   * appui, comme avant. Le décodage se fait donc pendant le menu, un son
   * après l'autre pour ne jamais faire de rafale, les deux musiques d'abord
   * (ce sont elles qu'on attend). Un décodage qui ne rendrait rien (un vieux
   * Safari qui attend le geste pour décoder) ne bloque pas les suivants : au
   * bout de dix secondes on passe, et le premier geste le redemande.
   */
  preparer() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return false; }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const c of this.canaux.values()) {
      if (!c.gain) { c.gain = this.ctx.createGain(); c.gain.connect(this.master); this.poserGain(c); }
    }
    return true;
  }

  ouvrir() {
    this.charger();
    if (!this.preparer()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    // Ce qui n'est pas encore décodé (ou dont le décodage a été abandonné)
    // repart — le contexte est réveillé, il ne peut plus rien retenir.
    for (const nom of this.bruts.keys()) this.decoder(nom);
  }

  decoder(nom) {
    if (!this.ctx || !this.bruts.has(nom) || this.buffers.has(nom) || this.decode.has(nom)) return;
    this.decode.add(nom);
    if (MUSIQUES.has(nom)) this.aDecoder.unshift(nom); else this.aDecoder.push(nom);
    this.decoderSuivant();
  }

  decoderSuivant() {
    if (this.decodeEnCours || !this.aDecoder.length) return;
    const nom = this.aDecoder.shift();
    this.decodeEnCours = nom;
    const passer = () => {
      if (this.decodeEnCours !== nom) return;
      this.decodeEnCours = null;
      this.decoderSuivant();
    };
    const garde = setTimeout(() => { if (this.decodeEnCours === nom) { this.decode.delete(nom); passer(); } }, DECODAGE_PATIENCE);
    this.ctx.decodeAudioData(this.bruts.get(nom).slice(0))
      .then((buf) => {
        this.buffers.set(nom, buf);
        // Un loop() demandé avant la fin du décodage part dès qu'il est prêt.
        for (const c of this.canaux.values()) {
          if (c.enAttente === nom) { c.enAttente = null; this.jouerSur(c, nom, c.boucle); }
        }
      })
      .catch(() => { this.decode.delete(nom); })
      .then(() => { clearTimeout(garde); passer(); });
  }

  canal(n) {
    let c = this.canaux.get(n);
    if (!c) {
      c = { gain: null, volume: 100, actif: true, src: null, nom: null, boucle: false, enAttente: null };
      this.canaux.set(n, c);
    }
    if (this.ctx && !c.gain) {
      c.gain = this.ctx.createGain();
      c.gain.connect(this.master);
      this.poserGain(c);
    }
    return c;
  }

  poserGain(c) {
    if (c.gain) c.gain.gain.value = c.actif ? c.volume / 100 : 0;
  }

  jouerSur(c, nom, boucle) {
    if (!this.ctx) { c.nom = nom; c.boucle = boucle; c.enAttente = nom; return; }
    const buf = this.buffers.get(nom);
    if (!buf) { c.nom = nom; c.boucle = boucle; c.enAttente = nom; this.decoder(nom); return; }
    if (c.src) { try { c.src.stop(); } catch (e) { /* déjà finie */ } c.src.disconnect(); }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!boucle;
    src.connect(c.gain);
    src.onended = () => {
      if (c.src === src) { c.src = null; if (!c.boucle) c.nom = null; }
      src.disconnect();
    };
    src.start();
    c.src = src;
    c.nom = nom;
    c.boucle = !!boucle;
    c.enAttente = null;
  }

  // ── L'API du jeu (asml.SoundManager) ────────────────────────────────────
  play(nom) { this.playSound(nom, 0); }
  playSound(nom, canal) { this.jouerSur(this.canal(canal), nom, false); }
  loop(nom, canal) { this.jouerSur(this.canal(canal), nom, true); }
  isPlaying(nom, canal) {
    const c = this.canaux.get(canal);
    return !!c && (c.nom === nom || c.enAttente === nom);
  }
  setVolume(canal, v) {
    const c = this.canal(canal);
    c.volume = v;
    this.poserGain(c);
  }
  enable(canal, actif) {
    const c = this.canal(canal);
    c.actif = !!actif;
    this.poserGain(c);
  }
  stop(canal) {
    const c = this.canaux.get(canal);
    if (!c) return;
    if (c.src) { try { c.src.stop(); } catch (e) { /* déjà finie */ } c.src.disconnect(); c.src = null; }
    c.nom = null;
    c.enAttente = null;
  }

  // fade(de, vers, durée en s) : le volume du canal `de` glisse vers 0, celui
  // de `vers` monte jusqu'au volume que `de` portait — le fondu croisé des
  // musiques (le jeu pose toujours 50 des deux côtés).
  fade(de, vers, duree) {
    this.fondus = this.fondus.filter((f) => f.de !== de && f.vers !== de && f.de !== vers && f.vers !== vers);
    this.fondus.push({ de, vers, duree, t: 0, volDepart: this.canal(de).volume });
  }

  // Appelé chaque image avec le temps écoulé (secondes) — avance les fondus.
  main(deltaT) {
    for (let i = 0; i < this.fondus.length; i++) {
      const f = this.fondus[i];
      f.t += deltaT / f.duree;
      const t = Math.min(1, f.t);
      this.setVolume(f.de, f.volDepart * (1 - t));
      this.setVolume(f.vers, f.volDepart * t);
      if (t >= 1) { this.fondus.splice(i, 1); i--; }
    }
  }
}

const API = { Sons };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeSons = API;

})(typeof window !== 'undefined' ? window : globalThis);
