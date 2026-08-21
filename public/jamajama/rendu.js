// JamaJama — le dessin. Remet en scène ce que scripts/extract-jamajama-sprites.js
// a sorti du SWF : un manifeste d'états (pièces + matrices), un paquet de SVG,
// des fontes WOFF.
//
// Une PIÈCE se dessine de quatre façons :
//   fichier   un SVG (forme ou texte figé), posé par sa matrice sur son viewBox ;
//   clip      un RENVOI vers un autre symbole — enfant nommé que le jeu pilote
//             (l'orientation du héros est mc.j.gotoAndStop(d+1) dans le SWF ;
//             ici, l'appelant passe `clips: {j: d+1}`). Sans consigne, l'image
//             que la ligne de temps donnerait ;
//   champ     un champ de texte : la géométrie et le style viennent du SWF, le
//             contenu de l'appelant (`champs: {chemin: "..."}`) ou du texte
//             d'origine ;
//   bouton    un renvoi vers un bouton à trois états (repos/survol/appui).
//
// Les transformations de couleur du fichier (fondu du gaz, sortie qui blanchit,
// rougeoiement de l'archer) s'appliquent par passes composites — multiply pour
// les multiplicateurs, lighter pour les ajouts, destination-in pour rendre son
// détourage au dessin — parce que `ctx.filter` n'existe pas sous Safari.
//
// Tout est accroché à window : le jeu vise les mêmes navigateurs que light.html.
(function () {
  'use strict';

  let MANIFESTE = null;
  const images = new Map();          // fichier → Image prête
  const teintes = new Map();         // fichier+cx → canevas teinté
  let BASE = '';

  function charger(base) {
    BASE = base || '';
    return Promise.all([
      fetch(BASE + 'sprites/sprites.json').then((r) => r.json()),
      fetch(BASE + 'sprites/paquet.json').then((r) => r.json()),
    ]).then(([manifeste, paquet]) => {
      MANIFESTE = manifeste;
      // Les fontes embarquées, déclarées puis réellement chargées : un fillText
      // parti avant que la fonte n'arrive resterait en Times pour toujours.
      let css = '';
      for (const f of Object.values(manifeste.fontes)) {
        if (f.fichier) css += '@font-face{font-family:"' + f.famille + '";src:url("'
          + BASE + 'fontes/' + f.fichier + '") format("woff")}\n';
      }
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      const fontes = Object.values(manifeste.fontes).filter((f) => f.fichier)
        .map((f) => document.fonts.load('12px "' + f.famille + '"').catch(() => {}));
      const dessins = Object.entries(paquet).map(([fichier, svg]) => new Promise((res) => {
        const img = new Image();
        img.onload = res;
        img.onerror = res;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        images.set(fichier, img);
      }));
      return Promise.all(dessins.concat(fontes));
    });
  }

  function symbole(cle) {
    const s = MANIFESTE && MANIFESTE.symboles[cle];
    if (!s) throw new Error('symbole inconnu : ' + cle);
    return s;
  }

  /** L'état d'un symbole pour une image (numéro ou étiquette). Une image sans
   *  état propre garde le dernier connu — la liste d'affichage du lecteur. */
  function etatDe(s, ref) {
    let f = ref || 1;
    if (typeof ref === 'string') {
      f = (s.etiquettes || {})[ref];
      // Flash lit d'abord les étiquettes, puis se rabat sur le NUMÉRO : c'est
      // ainsi que LevelSlot écrit icon.gotoAndStop("4") pour un niveau jamais
      // joué, alors que ce clip n'a pas la moindre étiquette.
      if (f === undefined && /^\d+$/.test(ref)) f = Number(ref);
      if (f === undefined) throw new Error('étiquette inconnue : ' + ref);
    }
    let choix = null;
    for (const e of s.etats) {
      if (e.frame > f) break;
      choix = e;
    }
    return choix || s.etats[0];
  }

  /** Nombre d'images d'un symbole (la plus haute connue). */
  function longueur(cle) {
    const e = symbole(cle).etats;
    return e[e.length - 1].frame;
  }
  function etiquettes(cle) { return symbole(cle).etiquettes || {}; }

  // ── La couleur transformée : sortie = source × mult/256 + ajout ──
  function teinter(img, vb, cx, echelle) {
    const cleCache = img.src.length + ':' + vb.join(',') + ':' + cx.join(',') + ':' + echelle;
    if (teintes.has(cleCache)) return teintes.get(cleCache);
    const q = Math.max(1, Math.min(4, echelle));
    const o = document.createElement('canvas');
    o.width = Math.max(1, Math.ceil(vb[2] * q));
    o.height = Math.max(1, Math.ceil(vb[3] * q));
    const c = o.getContext('2d');
    c.scale(q, q);
    c.drawImage(img, 0, 0, vb[2], vb[3]);
    const [mr, mv, mb] = cx, ar = cx[4], av = cx[5], ab = cx[6];
    if (mr !== 256 || mv !== 256 || mb !== 256) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = 'rgb(' + Math.round(mr / 256 * 255) + ',' + Math.round(mv / 256 * 255)
        + ',' + Math.round(mb / 256 * 255) + ')';
      c.fillRect(0, 0, vb[2], vb[3]);
    }
    if (ar || av || ab) {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgb(' + ar + ',' + av + ',' + ab + ')';
      c.fillRect(0, 0, vb[2], vb[3]);
    }
    // Les deux passes ont peint jusque dans le transparent : le dessin d'origine
    // rend son détourage.
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(img, 0, 0, vb[2], vb[3]);
    teintes.set(cleCache, o);
    return o;
  }

  // ── Un champ de texte, écrit comme Flash l'aurait fait ──
  //
  // La gouttière de 2 px et la première ligne de base à ~86 % du corps sont
  // celles du lecteur ; l'interligne du fichier s'ajoute au corps.
  function ecrireChamp(ctx, meta, texte, alpha) {
    if (!texte) return;
    ctx.font = meta.taille + 'px "' + meta.fonte + '"';
    ctx.fillStyle = meta.couleur;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    const r = meta.rect;
    const largeur = r.w - 4;
    const lignes = [];
    for (const brute of String(texte).split('\n')) {
      if (!meta.wrap) { lignes.push(brute); continue; }
      let ligne = '';
      for (const mot of brute.split(' ')) {
        const essai = ligne ? ligne + ' ' + mot : mot;
        if (ctx.measureText(essai).width <= largeur || !ligne) ligne = essai;
        else { lignes.push(ligne); ligne = mot; }
      }
      lignes.push(ligne);
    }
    const interligne = meta.taille * 1.15 + (meta.interligne || 0);
    let x = r.x + 2;
    ctx.textAlign = 'left';
    if (meta.align === 'centre') { ctx.textAlign = 'center'; x = r.x + r.w / 2; }
    if (meta.align === 'droite') { ctx.textAlign = 'right'; x = r.x + r.w - 2; }
    ctx.textBaseline = 'alphabetic';
    let y = r.y + 2 + meta.taille * 0.86;
    for (const ligne of (meta.multiligne ? lignes : lignes.slice(0, 1))) {
      ctx.fillText(ligne, x, y);
      y += interligne;
    }
  }

  /**
   * Dessine un symbole du manifeste.
   *
   * @param ctx    le contexte, déjà placé (translate/scale à la charge de l'appelant)
   * @param cle    le nom du symbole (« jama_Hero », « clip562 »…)
   * @param ref    l'image : numéro, étiquette, ou rien (première)
   * @param sur    les consignes du jeu, par chemin d'instance :
   *               clips   {chemin: image|étiquette} — pilote un renvoi
   *               boutons {chemin: 1|2|3}           — repos, survol, appui
   *               champs  {chemin: texte}           — contenu d'un champ nommé
   *               vars    {variable: texte}         — contenu par VARIABLE
   *                                                   (mc.name = …, comme le SWF)
   *               cacher  [chemin…]                 — pièces à passer
   *               alpha   0..1                      — transparence d'ensemble
   *               temps   images écoulées           — fait tourner les clips
   *                                                   que rien n'arrête
   * @param prefixe (interne) le chemin déjà parcouru par la récursion
   */
  function dessiner(ctx, cle, ref, sur, prefixe) {
    sur = sur || {};
    if (sur.temps === undefined) sur = Object.assign({ temps }, sur);
    const s = symbole(cle);
    const etat = etatDe(s, ref);
    if (!etat) return;
    const cacher = sur.cacher || [];
    let fenetre = 0;
    ctx.save();
    if (sur.alpha !== undefined) ctx.globalAlpha *= sur.alpha;
    // Quoi qu'il arrive dans une pièce — une étiquette qui manque, un dessin
    // absent —, la pile de transformations doit revenir comme elle était :
    // sans ce filet, un incident au milieu d'une liste décalait toutes les
    // lignes suivantes, chacune un peu plus bas que la précédente.
    try {
    for (const p of etat.pieces) {
      const chemin = p.nom
        ? (prefixe ? prefixe + '.' + p.nom : p.nom)
        : (prefixe || '');
      if (chemin && cacher.indexOf(chemin) >= 0) continue;
      const msq = p.msq || 0;
      if (msq !== fenetre) {
        if (fenetre) ctx.restore();
        fenetre = msq;
        if (msq) {
          const f = (etat.fenetres || []).find((q) => q.num === msq);
          ctx.save();
          if (f) { ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip(); }
        }
      }
      ctx.save();
      try {
      if (p.m) ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      if (p.fichier !== undefined) {
        const img = images.get(p.fichier);
        if (img) {
          if (p.cx) {
            const t = ctx.getTransform();
            const echelle = Math.hypot(t.a, t.b);
            ctx.globalAlpha *= Math.max(0, Math.min(1, p.cx[3] / 256));
            ctx.drawImage(teinter(img, p.vb, p.cx, echelle),
              p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
          } else {
            ctx.drawImage(img, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
          }
        }
      } else if (p.clip !== undefined) {
        // La consigne ne vaut que pour la pièce qui PORTE le nom : un clip
        // anonyme hérite du chemin de son parent pour l'affichage, mais pas
        // de ses ordres — sans quoi le « available » du joker descendait
        // jusqu'à la flamme, qui ne connaît pas cette étiquette.
        const consigne = p.nom ? (sur.clips || {})[chemin] : undefined;
        if (p.cx) ctx.globalAlpha *= Math.max(0, Math.min(1, p.cx[3] / 256));
        let ref2 = consigne;
        if (ref2 === undefined) {
          ref2 = p.frame;
          // Un clip que rien n'arrête TOURNE sous le lecteur : la flamme d'un
          // joker, les remous d'un décor. `temps` (en images) le fait avancer,
          // et le décalage tiré du chemin remplace le gotoAndPlay(random) que
          // le fichier pose sur ces clips pour qu'ils ne battent pas ensemble.
          const s2 = MANIFESTE.symboles[p.clip];
          // Seuls les clips ANONYMES tournent d'eux-mêmes : un enfant nommé
          // est, par construction, celui que l'ActionScript atteint et arrête
          // (mc.j, mask, text, icon, star1…). Le laisser défiler ferait
          // clignoter l'orientation du héros ou le raccord de l'eau.
          if (s2 && s2.anime && sur.temps && !p.nom) {
            let graine = 0;
            for (let i = 0; i < chemin.length; i++) graine = (graine * 31 + chemin.charCodeAt(i)) % 997;
            ref2 = Math.floor((sur.temps + graine + (p.frame || 1) - 1) % s2.anime) + 1;
          }
        }
        dessiner(ctx, p.clip, ref2, sur, chemin);
      } else if (p.champ !== undefined) {
        const meta = MANIFESTE.champs[p.champ];
        // Un champ se remplit de deux façons dans le fichier : par son nom
        // d'instance (win.title.text = …) ou par sa VARIABLE (mc.name = …,
        // et le champ lié suit). Les lignes de la liste des niveaux sont de
        // la seconde sorte — sans ce canal, elles resteraient au texte de
        // maquette (« Le nom de mon super level lalatsouin »).
        let texte = meta.texte || '';
        if (meta.variable && sur.vars && meta.variable in sur.vars) texte = sur.vars[meta.variable];
        if (p.nom && sur.champs && chemin in sur.champs) texte = sur.champs[chemin];
        ecrireChamp(ctx, meta, texte, meta.alpha);
      } else if (p.bouton !== undefined) {
        const etatBouton = (p.nom ? (sur.boutons || {})[chemin] : 0) || 1;
        if (MANIFESTE.symboles[p.bouton]) dessiner(ctx, p.bouton, etatBouton, sur, chemin);
      }
      } finally { ctx.restore(); }
    }
    } finally {
      if (fenetre) ctx.restore();
      ctx.restore();
    }
  }

  /** La zone de clic d'un bouton (le cadre de son état `hit` dans le SWF). */
  function zoneBouton(cle) { return symbole(cle).hit || null; }

  // Le TEMPS du lecteur, en images : le jeu l'avance à chaque tour de boucle
  // et le rendu s'en sert pour les clips qui tournent tout seuls. Le tenir ici
  // évite de le passer de main en main jusqu'au fond des écrans.
  let temps = 0;
  function avancer(tmod) { temps += tmod; }
  function tempsCourant() { return temps; }

  window.JamaRendu = { charger, dessiner, etatDe, longueur, etiquettes, zoneBouton,
    symbole, ecrireChamp, manifeste: () => MANIFESTE, avancer, temps: tempsCourant };
})();
