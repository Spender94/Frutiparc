/*
 * Minipixiz — l'inventaire.
 *
 * C'est ici que les objets ramassés en forêt cessent d'être des lignes dans une
 * fiche : on les regarde, on les donne à manger, on les fait porter. Le jeu
 * d'origine (Inventory.mt) tient une MAIN — on prend un objet, on le repose
 * ailleurs — et c'est ce geste qu'on garde, au doigt plutôt qu'à la souris.
 *
 * ── Ce que porter veut dire ──
 *
 * Il n'y a pas de bouton « équiper ». FaerieInfo.initItems rejoue les effets de
 * tout ce que la fée a dans son sac à chaque fois qu'on la charge : déposer un
 * gant chez elle la rend plus forte, le reprendre annule le bonus. Un objet
 * resté dans le sac DU JOUEUR, lui, profite à toutes les fées à la fois — c'est
 * la différence entre le gant et le globe.
 *
 * ── Les icônes ──
 *
 * Ce sont celles de l'album, déjà dans le dépôt : bmp/titems/GIF/item/item_N.gif
 * pour les objets (N = identifiant + 1) et food/food_N.gif pour la nourriture.
 * Les mêmes que le serveur sert pour les pictos — un seul jeu d'images, aucune
 * divergence possible entre l'album et le sac.
 */
'use strict';

(function (racine) {

const O = racine.MinipixizObjets;
const BASE_ICONES = '/swf/games/miniTroll/bmp/titems/GIF/';

// Item.getPic : le fichier d'une icône se déduit du type.
function icone(type) {
  const it = O.info(type);
  if (!it) return null;
  if (it.famille === 'aliment') {
    return BASE_ICONES + 'food/food_' + (type - O.PREMIER_ALIMENT + 1) + '.gif';
  }
  return BASE_ICONES + 'item/item_' + (type + 1) + '.gif';
}

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

/**
 * @param {object} o
 *   racine      l'élément qui reçoit le panneau
 *   plateforme  la Plateforme, pour lire et écrire la fiche
 *   sprites     le manifeste des dessins, pour les portraits
 *   surFermeture  appelé quand le joueur referme
 */
class Inventaire {
  constructor(o) {
    this.hote = o.racine;
    this.plateforme = o.plateforme;
    this.sprites = o.sprites;
    this.surFermeture = o.surFermeture || null;
    this.surChangement = o.surChangement || null;
    this.main = null;                 // l'objet tenu : {sac, case}
    this.feeCourante = 0;
    this.message = '';
    this.construire();
  }

  get carte() { return this.plateforme.carte; }

  construire() {
    this.hote.innerHTML = '';
    const t = el('div', 'inv-titre');
    t.textContent = 'INVENTAIRE';
    const fermer = el('button', 'inv-fermer');
    fermer.type = 'button';
    fermer.textContent = '✕';
    fermer.addEventListener('click', () => this.fermer());

    this.zoneFee = el('div', 'inv-fee');
    this.zoneSacFee = el('div', 'inv-grille');
    this.zoneSacJoueur = el('div', 'inv-grille');
    this.zoneMsg = el('div', 'inv-msg');

    const l1 = el('div', 'inv-label'); l1.textContent = 'Ce qu\'elle porte';
    const l2 = el('div', 'inv-label'); l2.textContent = 'Votre sac';

    this.hote.append(t, fermer, this.zoneFee, l1, this.zoneSacFee, l2,
      this.zoneSacJoueur, this.zoneMsg);
    this.rendre();
  }

  // La fée que l'on regarde, sous forme vivante (avec ses objets appliqués).
  fee() {
    const l = this.carte.$faerie || [];
    const fs = l[this.feeCourante];
    if (!fs) return null;
    return new racine.MinipixizFee.Fee(fs, null, this.carte);
  }

  rendre() {
    this.rendreFee();
    this.rendreSac(this.zoneSacFee, 'fee');
    this.rendreSac(this.zoneSacJoueur, 'joueur');
    this.zoneMsg.textContent = this.message;
  }

  rendreFee() {
    const z = this.zoneFee;
    z.innerHTML = '';
    const fee = this.fee();
    const liste = this.carte.$faerie || [];

    if (!fee) {
      const rien = el('div', 'inv-rien');
      rien.textContent = 'Aucune fée pour l\'instant. Le bassin en fera venir une.';
      z.append(rien);
      return;
    }

    const C = racine.MinipixizClient;
    const portrait = C.portraitDeFee(this.sprites, fee, 84);
    portrait.className = 'inv-portrait';
    // Donner à manger : on pose l'objet tenu sur la fée, comme Inventory.giveItem.
    portrait.addEventListener('click', () => this.donnerALaFee());

    const infos = el('div', 'inv-infos');
    const nom = el('div', 'inv-nom');
    nom.textContent = fee.fs.$name + ' · niv. ' + (Number(fee.fs.$level) + 1);
    const vie = C.jauge(this.sprites, 'coeur', Number(fee.fs.$life), fee.vieMax(), C.ECART_COEUR);
    const mana = C.jauge(this.sprites, 'mana', Number(fee.fs.$mana), fee.manaMax(), C.ECART_MANA);
    const barres = el('div', 'inv-barres');
    barres.append(vie, mana);

    const etat = el('div', 'inv-etat');
    etat.innerHTML = this.barre('faim', fee.fs.$hunger, 20, '#c8e08a')
      + this.barre('moral', fee.fs.$moral, 20, '#f0a7d8');
    infos.append(nom, barres, etat);

    z.append(portrait, infos);

    // Plusieurs fées : de quoi passer de l'une à l'autre.
    if (liste.length > 1) {
      const nav = el('div', 'inv-nav');
      liste.forEach((fs, i) => {
        const b = el('button', 'inv-onglet' + (i === this.feeCourante ? ' on' : ''));
        b.type = 'button';
        b.textContent = fs && fs.$name ? fs.$name : ('fée ' + (i + 1));
        b.addEventListener('click', () => { this.feeCourante = i; this.main = null; this.rendre(); });
        nav.append(b);
      });
      z.append(nav);
    }
  }

  barre(nom, v, max, couleur) {
    const p = Math.max(0, Math.min(100, (Number(v) || 0) / max * 100));
    return '<div class="inv-b"><span>' + nom + '</span>'
      + '<i style="width:' + p.toFixed(0) + '%;background:' + couleur + '"></i></div>';
  }

  rendreSac(zone, quel) {
    zone.innerHTML = '';
    const estFee = quel === 'fee';
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    if (estFee && !fs) return;
    const places = estFee ? O.placesFee(fs) : O.placesJoueur(this.carte);
    const liste = O.contenu(estFee ? fs.$inv : this.carte.$inv, places);
    const sac = estFee ? this.feeCourante : 'joueur';

    if (places === 0) {
      const rien = el('div', 'inv-rien');
      rien.textContent = estFee ? 'Elle n\'a pas de place.'
        : 'Vous n\'avez pas encore de sac : c\'est la première chose que la forêt vous donnera.';
      zone.append(rien);
      return;
    }

    liste.forEach((type, i) => {
      const c = el('button', 'inv-case');
      c.type = 'button';
      const tenu = this.main && this.main.sac === sac && this.main.case === i;
      if (tenu) c.classList.add('main');
      const it = O.info(type);
      if (it) {
        const img = el('img');
        img.src = icone(type);
        img.alt = it.nom;
        img.addEventListener('error', () => { img.replaceWith(document.createTextNode('?')); });
        c.append(img);
        c.title = it.nom + (it.portion ? ' (' + it.portion + ' part)' : '') + ' — ' + it.desc;
      }
      c.addEventListener('click', () => this.toucher(sac, i));
      zone.append(c);
    });
  }

  /**
   * Le geste de l'inventaire : on prend, puis on repose. Reposer sur une case
   * occupée échange les deux objets — c'est ce que fait la main du jeu.
   */
  toucher(sac, index) {
    const it = this.objetA(sac, index);
    if (!this.main) {
      if (!it) return;
      this.main = { sac, case: index };
      this.message = it.nom + ' en main.';
      this.rendre();
      return;
    }
    if (this.main.sac === sac && this.main.case === index) {
      this.main = null;
      this.message = '';
      this.rendre();
      return;
    }
    const bouge = O.deplacer(this.carte,
      { sac: this.main.sac, case: this.main.case }, { sac, case: index });
    this.main = null;
    this.message = bouge ? '' : 'Impossible de poser là.';
    this.changer();
  }

  objetA(sac, index) {
    const liste = sac === 'joueur'
      ? this.carte.$inv
      : ((this.carte.$faerie || [])[sac] || {}).$inv;
    return O.info(Array.isArray(liste) ? liste[index] : null);
  }

  // Inventory.giveItem : l'objet tenu est consommé sur la fée.
  donnerALaFee() {
    const fee = this.fee();
    if (!fee) return;
    if (!this.main) {
      this.message = 'Prenez d\'abord un objet, puis touchez la fée.';
      this.rendre();
      return;
    }
    const it = this.objetA(this.main.sac, this.main.case);
    if (!it || !it.flUse) {
      this.message = (it ? it.nom : 'Cet objet') + ' ne se donne pas à manger.';
      this.rendre();
      return;
    }
    const r = O.donner(this.carte, { sac: this.main.sac, case: this.main.case }, fee);
    if (!r.ok) { this.message = r.message; this.rendre(); return; }

    // La fée vit dans la fiche : ce que `donner` a changé sur l'objet vivant
    // doit y retourner, sinon le repas serait oublié à la prochaine ouverture.
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    fs.$life = fee.fs.$life;
    fs.$mana = fee.fs.$mana;
    fs.$hunger = fee.fs.$hunger;
    fs.$moral = fee.fs.$moral;

    this.main = null;
    if (r.effet.genre === 'repas') {
      this.message = fee.fs.$name + ' mange'
        + (r.effet.moral > 0 ? ' avec plaisir !' : r.effet.moral < 0 ? '… sans enthousiasme.' : '.');
    } else {
      this.message = fee.fs.$name + ' récupère ' + r.effet.gagne
        + ' cœur' + (r.effet.gagne > 1 ? 's' : '') + '.';
    }
    if (r.pictos.length) this.message += ' Album : ' + r.pictos.length + ' picto de plus !';
    this.changer();
  }

  // Toute modification de la fiche est enregistrée tout de suite : on ne perd
  // pas un repas parce que le joueur a fermé l'onglet.
  changer() {
    this.rendre();
    if (this.surChangement) this.surChangement();
  }

  ouvrir() {
    this.main = null;
    this.message = '';
    this.rendre();
    this.hote.classList.add('on');
  }

  fermer() {
    this.hote.classList.remove('on');
    if (this.surFermeture) this.surFermeture();
  }
}

const API = { Inventaire, icone, BASE_ICONES };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizInventaire = API;

})(typeof window !== 'undefined' ? window : globalThis);
