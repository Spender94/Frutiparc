/*
 * Kit bande-annonce, section « chat » — LA RÉGIE : le scénario joué image par
 * image.
 *
 * Chaque réplique du scénario (scenes.json) a son instant `t`, en secondes
 * depuis le début de la prise. Quand la prise y arrive, la régie fait agir le
 * figurant pour de vrai (une trame vers le serveur), ATTEND la trame que le
 * serveur renvoie à la page du spectateur, et ne laisse la caméra tourner
 * l'image suivante qu'une fois cette trame livrée. Rien n'est donc simulé côté
 * page : ce qu'on voit est ce que le client a reçu et dessiné.
 *
 * Répliques possibles (voir l'aide en tête de scenes.json) :
 *   { "t": 1.0, "qui": "kiwinette", "dit": "Coucou !" }      une ligne, une émote, une commande
 *   { "t": 2.0, "qui": "prunox", "humeur": "joie" }           changer d'humeur
 *   { "t": 3.0, "qui": "citronade", "entre": true }           entrer dans le salon
 *   { "t": 4.0, "qui": "citronade", "sort": true }            quitter le salon
 *   { "t": 5.0, "pnj": "Gaspard" }                            la prochaine réplique retenue du PNJ
 *   { "t": 6.0, "qui": "litchiloo", "donne": ["Pomelo", 50] } /donne (kikooz personnels)
 * Quand `qui` est le spectateur, sa ligne est TAPÉE dans le champ de saisie de
 * sa fenêtre, lettre par lettre, puis envoyée par Entrée.
 */
'use strict';

const { attribut, balise } = require('./site');

function desechapper(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// La trame que le serveur renvoie quand `pseudo` a parlé : sa ligne (u), son
// émote (eu) ou son cri rouge (au).
function trameDe(pseudo) {
  const cle = pseudo.toLowerCase();
  return (t) => balise(t) === 't'
    && ['u', 'eu', 'au'].some((a) => desechapper(attribut(t, a)).toLowerCase() === cle);
}

class Regie {
  /**
   * @param {object} o
   * @param {import('./camera').Camera} o.camera
   * @param {object} o.bots         pseudo (minuscules) → Bot
   * @param {string} o.spectateur   pseudo du spectateur
   * @param {string} o.salon
   * @param {number} o.fps
   */
  constructor(o) {
    Object.assign(this, o);
    this.page = o.camera.page;
    this.frappe = null;      // la saisie en cours du spectateur
  }

  bot(qui) {
    const b = this.bots[String(qui).toLowerCase()];
    if (!b) throw new Error('personne ne s’appelle « ' + qui + ' » dans le scénario');
    return b;
  }

  async jouer(r, image) {
    const cam = this.camera;
    if (r.pnj) { await cam.liberer(r.pnj); return; }
    const qui = String(r.qui || '').toLowerCase();
    if (qui === this.spectateur.toLowerCase() && r.dit !== undefined) {
      // Le spectateur TAPE sa ligne : une lettre toutes les `pas` images.
      this.frappe = { texte: String(r.dit), i: 0, pas: r.pas || 3, prochaine: image };
      await this.page.evaluate(() => {
        const champ = [...document.querySelectorAll('#compose-input')].find((e) => e.offsetWidth > 0);
        if (champ) champ.focus();
      });
      return;
    }
    const b = this.bot(qui);
    const m = cam.marque();
    if (r.dit !== undefined) {
      const texte = String(r.dit);
      b.dire(texte);
      // Une commande d'animation (/initpoint, /point, /don…) répond par une
      // ligne d'« admin » ou de l'animatrice : on guette la première ligne qui
      // revient.
      const pred = /^\//.test(texte) ? ((t) => balise(t) === 't') : trameDe(b.affiche);
      await cam.guetter(m, pred, `${b.affiche} : ${texte}`);
    } else if (r.humeur !== undefined) {
      b.humeur(r.humeur);
      await cam.guetter(m, (t) => balise(t) === 'z' && desechapper(attribut(t, 'u')).toLowerCase() === b.pseudo,
        `${b.affiche} : humeur ${r.humeur}`);
    } else if (r.entre) {
      b.rejoindre(this.salon);
      await cam.guetter(m, (t) => balise(t) === 'v' && desechapper(attribut(t, 'u')).toLowerCase() === b.pseudo,
        `${b.affiche} entre`);
    } else if (r.sort) {
      b.quitter(this.salon);
      await cam.guetter(m, (t) => balise(t) === 'u' && desechapper(attribut(t, 'u')).toLowerCase() === b.pseudo,
        `${b.affiche} sort`);
    } else if (r.donne) {
      await b.donner(r.donne[0], r.donne[1], r.donne[2] || '');
      await cam.guetter(m, (t) => balise(t) === 't' && attribut(t, 't') === 'g', `${b.affiche} donne`);
    } else {
      throw new Error('réplique incomprise : ' + JSON.stringify(r));
    }
  }

  /** À chaque image : la saisie du spectateur avance d'une lettre, puis Entrée. */
  async avancer(image) {
    const f = this.frappe;
    if (!f || image < f.prochaine) return;
    if (f.i < f.texte.length) {
      await this.page.keyboard.type(f.texte[f.i]);
      f.i++;
      f.prochaine = image + f.pas;
      return;
    }
    // Le texte est complet : on le laisse lire un instant, puis on l'envoie
    // et on attend que la ligne revienne du serveur.
    const m = this.camera.marque();
    await this.page.keyboard.press('Enter');
    this.frappe = null;
    await this.camera.guetter(m, trameDe(this.spectateur), `${this.spectateur} : ${f.texte}`);
  }
}

/*
 * LA MAIN DU SPECTATEUR — un curseur MIMÉ (la photo d'un navigateur n'en
 * montre pas) et de vrais clics.
 *
 * Le curseur est une flèche posée par-dessus la page ; il glisse d'un point à
 * un autre au fil des images (avec une douce accélération), et le clic est un
 * vrai clic de souris à sa pointe : c'est le site qui réagit, pas nous.
 *
 * Gestes (dans plans.js) :
 *   { t: 0.6, vers: { sel: '.sp-salon', texte: 'Salon Pomme' }, duree: 0.8 }
 *   { t: 1.6, clic: true, attendre: 'p' }   (attendre : une trame du serveur
 *                                            de cette balise, p. ex. la liste
 *                                            des connectés du salon rejoint)
 *   { t: 4.9, saisir: true } … { vers: [600, 440] } … { lacher: true }
 *                                           (un glisser : bouton enfoncé pendant
 *                                            le trajet, p. ex. la poignée d'une
 *                                            fenêtre qu'on agrandit)
 */
const FLECHE = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">'
  + '<path d="M1 1 L1 24 L7 18.5 L11.2 28 L15 26.3 L10.9 17 L19 17 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';

class Main {
  constructor(camera, depart) {
    this.camera = camera;
    this.page = camera.page;
    this.pos = depart.slice();
    this.trajet = null;
    this.fps = camera.fps;
  }

  async poser() {
    await this.page.evaluate(({ svg, x, y }) => {
      const c = document.createElement('div');
      c.id = 'kit-curseur';
      c.innerHTML = svg;
      c.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:22px;height:30px;z-index:2147483647;pointer-events:none;`;
      document.body.appendChild(c);
    }, { svg: FLECHE, x: this.pos[0], y: this.pos[1] });
  }

  // Le centre d'un élément visible (le premier dont le texte commence par…).
  async cible(v) {
    if (Array.isArray(v)) return v;
    const p = await this.page.evaluate(({ sel, texte }) => {
      const e = [...document.querySelectorAll(sel)].find((x) => x.offsetWidth > 0
        && (!texte || x.textContent.trim().startsWith(texte)));
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [b.left + Math.min(b.width / 2, 60), b.top + b.height / 2];
    }, v);
    if (!p) throw new Error('rien à viser : ' + JSON.stringify(v));
    return p;
  }

  async jouer(g, image) {
    if (g.vers) {
      const b = await this.cible(g.vers);
      this.trajet = { a: this.pos.slice(), b, i0: image, n: Math.max(1, Math.round((g.duree || 0.6) * this.fps)) };
      return;
    }
    // Saisir et lâcher : un glisser (la poignée d'une fenêtre qu'on étire).
    if (g.saisir) { await this.page.mouse.move(this.pos[0], this.pos[1]); await this.page.mouse.down(); return; }
    if (g.lacher) { await this.page.mouse.up(); return; }
    if (g.clic) {
      const m = this.camera.marque();
      await this.page.mouse.click(this.pos[0], this.pos[1]);
      if (g.attendre) {
        await this.camera.guetter(m, (t) => balise(t) === g.attendre, 'réponse au clic (' + g.attendre + ')', 6000);
        await new Promise((r) => setTimeout(r, 400));   // le reste de la salve
      }
    }
  }

  // À chaque image : le curseur avance sur son trajet.
  async avancer(image) {
    const tr = this.trajet;
    if (!tr) return;
    const u = Math.min(1, (image - tr.i0) / tr.n);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    this.pos = [tr.a[0] + (tr.b[0] - tr.a[0]) * e, tr.a[1] + (tr.b[1] - tr.a[1]) * e];
    await this.page.evaluate(([x, y]) => {
      const c = document.getElementById('kit-curseur');
      if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
    }, this.pos);
    // La vraie souris suit : le survol des boutons s'allume comme pour un joueur.
    await this.page.mouse.move(this.pos[0], this.pos[1]);
    if (u >= 1) this.trajet = null;
  }
}

module.exports = { Regie, Main, desechapper };
