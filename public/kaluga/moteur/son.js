/*
 * Kaluga — les SONS, à la façon de l'objet Sound d'ActionScript 2.
 *
 * Le SoundManager du jeu tient des canaux (un clip chacun), y attache des
 * sons par leur nom d'auteur (sFly, sBonus, sJeuLoop0…), les lance une fois
 * ou en boucle (start(0, 0xFFFF)), règle le volume du canal et attend
 * onSoundComplete. On lui rend le même objet, sur Web Audio :
 *
 *   · un AudioBuffer par fichier (les MP3 tels quels, les ADPCM décodés en
 *     WAV à l'extraction) ;
 *   · un GainNode par canal — c'est le « vol_ctrl » du gestionnaire ;
 *   · le contexte audio ne démarre qu'au premier geste (règle des
 *     navigateurs) : on le réveille sur le premier clic ou la première touche.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

const audio = {
  contexte: null,
  tampons: {},              // nom → AudioBuffer
  attente: {},              // nom → Promise
  base: '',
  contexteOuvert() {
    if (!this.contexte) {
      const AC = racine.AudioContext || racine.webkitAudioContext;
      if (!AC) return null;
      this.contexte = new AC();
    }
    return this.contexte;
  },
  reveiller() {
    const c = this.contexteOuvert();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  },
  // Charge un son (mp3 ou wav) ; sans contexte audio, on n'a rien à décoder.
  charger(nom, fichier) {
    if (this.tampons[nom]) return Promise.resolve(this.tampons[nom]);
    if (this.attente[nom]) return this.attente[nom];
    const c = this.contexteOuvert();
    if (!c) return Promise.resolve(null);
    this.attente[nom] = fetch(this.base + fichier).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? c.decodeAudioData(b) : null))
      .then((buf) => { this.tampons[nom] = buf; delete this.attente[nom]; return buf; })
      .catch(() => { delete this.attente[nom]; return null; });
    return this.attente[nom];
  },
};
K.audio = audio;
for (const ev of ['pointerdown', 'keydown', 'touchstart']) racine.addEventListener(ev, () => audio.reveiller(), { passive: true });

// Sound(mc) : un contrôle de volume par clip (le SoundManager en crée un par canal).
class Sound {
  constructor(mc) {
    this.mc = mc || null;
    this.nom = null;
    this.source = null;
    this.volume = 100;
    this.playing = false;
    this.onSoundComplete = null;
    this.gain = null;
    // Le gain d'un clip : partagé entre tous les Sound du même clip, comme
    // en Flash où setVolume sur l'un vaut pour tous les sons du clip.
    if (mc) {
      if (!mc.__gain) {
        const c = audio.contexteOuvert();
        if (c) { mc.__gain = c.createGain(); mc.__gain.connect(c.destination); }
      }
      this.gain = mc.__gain || null;
    }
  }
  attachSound(nom) { this.nom = nom; }
  start(decalage, boucles) {
    this.stop();
    const c = audio.contexteOuvert();
    if (!c || !this.nom) return;
    const lancer = (buf) => {
      if (!buf || this.nom === null) return;
      if (this.source) return;                    // relancé entre-temps
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = (boucles || 1) > 1;
      if (!this.gain) { this.gain = c.createGain(); this.gain.connect(c.destination); if (this.mc) this.mc.__gain = this.gain; }
      s.connect(this.gain);
      s.onended = () => { if (this.source === s) { this.source = null; this.playing = false; if (typeof this.onSoundComplete === 'function') this.onSoundComplete(); } };
      this.source = s;
      this.playing = true;
      try { s.start(0, decalage || 0); } catch (e) { this.source = null; this.playing = false; }
    };
    const buf = audio.tampons[this.nom];
    if (buf) lancer(buf);
    else audio.charger(this.nom, K.fichierSon ? K.fichierSon(this.nom) : (this.nom + '.mp3')).then(lancer);
  }
  stop() {
    if (this.source) { const s = this.source; this.source = null; s.onended = null; try { s.stop(); } catch (e) { /* déjà arrêté */ } }
    this.playing = false;
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Number(v) || 0));
    if (this.gain) this.gain.gain.value = this.volume / 100;
  }
  getVolume() { return this.volume; }
}
K.Sound = Sound;

})(typeof window !== 'undefined' ? window : globalThis);
