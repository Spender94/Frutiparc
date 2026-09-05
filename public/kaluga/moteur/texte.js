/*
 * Kaluga — les CHAMPS DE TEXTE (DefineEditText, createTextField).
 *
 * Deux sortes de fontes dans le SWF :
 *   · les EMBARQUÉES (Impact, President, Donald…) : leurs contours sont dans
 *     le fichier, sortis en WOFF (fontes/kaluga-<id>.woff) et déclarés sous
 *     la famille « Kaluga <id> » — le lettrage d'origine, exactement ;
 *   · les fontes SYSTÈME (la « verdana » des panneaux, des descriptions) :
 *     le SWF n'en porte aucun glyphe, le lecteur écrivait avec la Verdana de
 *     la machine. On fait pareil : Verdana si elle est là, sinon la pile CSS
 *     la plus proche (DejaVu Sans a les mêmes proportions).
 *
 * La mise en page suit celle du lecteur : une gouttière de deux pixels tout
 * autour, la première ligne posée à sa hauteur d'ascendante, l'interligne =
 * ascendante + descendante + interlignage de la fonte + `leading` du format.
 * Le HTML n'est que le sous-ensemble que le jeu emploie : <p align>, <font
 * face size color>, <b>, <i>, <br>, <sbr/> et quelques entités.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

const GOUTTIERE = 2;
const PILES = {
  verdana: 'Verdana, "DejaVu Sans", "Bitstream Vera Sans", Geneva, sans-serif',
  impact: 'Impact, "Anton", "Arial Narrow Bold", sans-serif',
  arial: 'Arial, Helvetica, "Liberation Sans", sans-serif',
};
// Les métriques des fontes système (fraction du corps) : Verdana.
const METRIQUES_SYSTEME = { asc: 1.005, desc: 0.21, lead: 0 };

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', ucirc: 'û', icirc: 'î' };
function decoderEntites(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITES[e] !== undefined ? ENTITES[e] : m;
  });
}

class Texte extends K.Affichable {
  constructor(biblio, id) {
    super();
    this.$biblio = biblio;
    this.$id = (id === undefined) ? null : id;
    const d = this.$id !== null ? biblio.perso[this.$id] : null;
    this.$rect = d ? d.r.slice() : [0, 0, 100, 20];
    this.$format = {
      font: d ? d.fonte : 0, size: d ? d.taille : 12, color: d ? d.couleur : '#000000', alpha: d ? d.alpha : 1,
      align: d ? d.align : 'gauche', leading: d ? d.inter : 0, leftMargin: d ? d.mg : 0, rightMargin: d ? d.md : 0, indent: d ? d.ret : 0,
      bold: false, italic: false,
    };
    this.wordWrap = d ? !!d.wrap : false;
    this.multiline = d ? !!d.multi : false;
    this.html = d ? !!d.html : false;
    this.embedFonts = d ? !!d.emb : false;
    this.selectable = false;
    this.variable = d ? d.variable : '';
    this._autoSize = d && d.auto ? 'left' : 'none';
    this._texte = '';
    this._html = '';
    this.$paragraphes = null;
    this.$mesure = null;
    if (d && d.texte) { if (this.html) this.htmlText = d.texte; else this.text = d.texte; }
  }

  get text() { return this._texte; }
  set text(v) { this._texte = (v === undefined || v === null) ? '' : String(v); this._html = ''; this.$paragraphes = null; this.$mesure = null; }
  get htmlText() { return this._html || this._texte; }
  set htmlText(v) { this._html = (v === undefined || v === null) ? '' : String(v); this._texte = this._html.replace(/<[^>]*>/g, ''); this.$paragraphes = null; this.$mesure = null; }
  get autoSize() { return this._autoSize; }
  set autoSize(v) { this._autoSize = (v === true) ? 'left' : (v === false || !v) ? 'none' : String(v); this.$mesure = null; }
  get textHeight() { return this.mesurer().hauteur; }
  get textWidth() { return this.mesurer().largeur; }
  get _width() { return this.$rect[2] * this.$sx; }
  set _width(v) { if (typeof v === 'number' && !Number.isNaN(v)) { this.$rect[2] = v / (this.$sx || 1); this.$mesure = null; } }
  get _height() { return this.$rect[3] * this.$sy; }
  set _height(v) { if (typeof v === 'number' && !Number.isNaN(v)) { this.$rect[3] = v / (this.$sy || 1); this.$mesure = null; } }
  get textColor() { return parseInt(this.$format.color.slice(1), 16); }
  set textColor(v) { this.$format.color = K.hex(v); }

  getTextFormat() { return Object.assign({}, this.$format); }
  setTextFormat(tf) {
    for (const k of ['size', 'color', 'align', 'leading', 'leftMargin', 'rightMargin', 'indent', 'bold', 'italic']) {
      if (tf[k] !== undefined && tf[k] !== null) this.$format[k] = (k === 'color' && typeof tf[k] === 'number') ? K.hex(tf[k]) : tf[k];
    }
    if (tf.font !== undefined && tf.font !== null) this.$format.font = tf.font;
    if (typeof this.$format.align === 'string') {
      this.$format.align = { left: 'gauche', right: 'droite', center: 'centre', justify: 'justifie' }[this.$format.align] || this.$format.align;
    }
    this.$paragraphes = null; this.$mesure = null;
  }
  setNewTextFormat(tf) { this.setTextFormat(tf); }

  cadreLocal() { return [this.$rect[0], this.$rect[1], this.$rect[0] + this.$rect[2], this.$rect[1] + this.$rect[3]]; }
  contientLocal(x, y) { const c = this.cadreLocal(); return x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]; }

  // ── la fonte ──
  infoFonte(fonte) {
    const f = (typeof fonte === 'number') ? this.$biblio.fontes[fonte] : null;
    if (f && f.fichier) return { famille: `"Kaluga ${f.id}"`, gras: f.gras, asc: f.asc || 0.9, desc: f.desc || 0.2, lead: f.lead || 0, embarquee: true };
    const nom = (f ? f.nom : (typeof fonte === 'string' ? fonte : 'verdana')).toLowerCase();
    let pile = PILES.verdana;
    for (const k of Object.keys(PILES)) if (nom.includes(k)) pile = PILES[k];
    return { famille: pile, gras: f ? f.gras : false, asc: METRIQUES_SYSTEME.asc, desc: METRIQUES_SYSTEME.desc, lead: METRIQUES_SYSTEME.lead, embarquee: false };
  }
  css(run) {
    const info = this.infoFonte(run.font);
    const gras = run.bold || info.gras;
    return `${run.italic ? 'italic ' : ''}${gras ? 'bold ' : ''}${run.size}px ${info.famille}`;
  }

  // ── le texte en paragraphes de runs ──
  decouper() {
    if (this.$paragraphes) return this.$paragraphes;
    const base = this.$format;
    const paras = [];
    if (this._html) {
      let courant = { align: base.align, runs: [] };
      const pile = [Object.assign({}, base)];
      // Sans condenseWhite (défaut Flash), un \n dans le htmlText est un vrai saut de ligne.
      const pousserTexte = (t) => {
        if (!t) return;
        const segs = t.split(/\r\n|\r|\n/);
        for (let k = 0; k < segs.length; k++) {
          if (k > 0) { paras.push(courant); courant = { align: courant.align, runs: [] }; }
          if (segs[k]) courant.runs.push(Object.assign({ texte: decoderEntites(segs[k]) }, pile[pile.length - 1]));
        }
      };
      const re = /<\s*(\/?)\s*([a-z]+)([^>]*)>/gi;
      let i = 0, m;
      while ((m = re.exec(this._html))) {
        pousserTexte(this._html.slice(i, m.index));
        i = re.lastIndex;
        const fermante = !!m[1], tag = m[2].toLowerCase(), attrs = m[3];
        const attr = (n) => { const r = new RegExp(n + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs) || new RegExp(n + "\\s*=\\s*'([^']*)'", 'i').exec(attrs); return r ? r[1] : null; };
        if (tag === 'p') {
          if (fermante) { paras.push(courant); courant = { align: base.align, runs: [] }; }
          else { if (courant.runs.length) { paras.push(courant); } courant = { align: base.align, runs: [] }; const al = attr('align'); if (al) courant.align = { left: 'gauche', right: 'droite', center: 'centre' }[al.toLowerCase()] || base.align; }
        } else if (tag === 'br' || tag === 'sbr') {
          paras.push(courant); courant = { align: courant.align, runs: [] };
        } else if (tag === 'font') {
          if (fermante) { if (pile.length > 1) pile.pop(); }
          else {
            const s = Object.assign({}, pile[pile.length - 1]);
            const face = attr('face'); if (face) s.font = face;
            const size = attr('size'); if (size) s.size = parseFloat(size) || s.size;
            const color = attr('color'); if (color) s.color = color;
            pile.push(s);
          }
        } else if (tag === 'b' || tag === 'i') {
          if (fermante) { if (pile.length > 1) pile.pop(); }
          else { const s = Object.assign({}, pile[pile.length - 1]); s[tag === 'b' ? 'bold' : 'italic'] = true; pile.push(s); }
        }
      }
      pousserTexte(this._html.slice(i));
      if (courant.runs.length || !paras.length) paras.push(courant);
      // Un </p> final laisse un paragraphe vide : on l'ôte.
      while (paras.length > 1 && !paras[paras.length - 1].runs.length) paras.pop();
    } else {
      const lignes = this._texte.split(/\r\n|\r|\n/);
      for (const l of lignes) paras.push({ align: base.align, runs: [Object.assign({ texte: l }, base)] });
    }
    this.$paragraphes = paras;
    return paras;
  }

  // ── la mise en page : lignes, avec retour à la ligne si wordWrap ──
  mesurer() {
    if (this.$mesure) return this.$mesure;
    const ctx = K.scene ? K.scene.ctxMesure : document.createElement('canvas').getContext('2d');
    const f = this.$format;
    const largeurUtile = Math.max(1, this.$rect[2] - 2 * GOUTTIERE - f.leftMargin - f.rightMargin);
    const lignes = [];
    for (const p of this.decouper()) {
      // Chaque run se mesure dans sa fonte ; on coupe aux espaces si le champ retourne à la ligne.
      let ligne = { align: p.align, morceaux: [], largeur: 0, asc: 0, desc: 0, lead: 0, hauteur: 0 };
      const finir = () => { lignes.push(ligne); ligne = { align: p.align, morceaux: [], largeur: 0, asc: 0, desc: 0, lead: 0, hauteur: 0 }; };
      const poser = (run, texte, largeur) => {
        const info = this.infoFonte(run.font);
        ligne.morceaux.push({ run, texte, largeur, css: this.css(run) });
        ligne.largeur += largeur;
        ligne.asc = Math.max(ligne.asc, info.asc * run.size);
        ligne.desc = Math.max(ligne.desc, info.desc * run.size);
        ligne.lead = Math.max(ligne.lead, info.lead * run.size);
      };
      if (!p.runs.length) { const info = this.infoFonte(f.font); ligne.asc = info.asc * f.size; ligne.desc = info.desc * f.size; ligne.lead = info.lead * f.size; }
      for (const run of p.runs) {
        ctx.font = this.css(run);
        if (!this.wordWrap) { poser(run, run.texte, ctx.measureText(run.texte).width); continue; }
        const mots = run.texte.split(/(\s+)/);
        let courant = '';
        for (const mot of mots) {
          if (!mot) continue;
          const essai = courant + mot;
          const w = ctx.measureText(essai).width;
          if (ligne.largeur + w <= largeurUtile || !(courant || ligne.morceaux.length)) { courant = essai; continue; }
          if (courant) poser(run, courant.replace(/\s+$/, ''), ctx.measureText(courant.replace(/\s+$/, '')).width);
          finir();
          courant = /^\s+$/.test(mot) ? '' : mot;
        }
        if (courant) poser(run, courant, ctx.measureText(courant).width);
      }
      finir();
    }
    let hauteur = 0, largeur = 0;
    for (const l of lignes) {
      l.hauteur = l.asc + l.desc + l.lead + f.leading;
      hauteur += l.hauteur;
      largeur = Math.max(largeur, l.largeur);
    }
    this.$mesure = { lignes, hauteur, largeur };
    if (this._autoSize !== 'none') {
      const l = largeur + 2 * GOUTTIERE + f.leftMargin + f.rightMargin;
      if (this._autoSize === 'droite' || this._autoSize === 'right') this.$rect[0] += this.$rect[2] - l;
      else if (this._autoSize === 'centre' || this._autoSize === 'center') this.$rect[0] += (this.$rect[2] - l) / 2;
      this.$rect[2] = l;
      this.$rect[3] = hauteur + 2 * GOUTTIERE;
    }
    return this.$mesure;
  }

  // La valeur affichée : la variable liée, si elle en a une et qu'elle existe.
  contenuAffiche() {
    if (this.variable && this._parent) {
      let o = this._parent;
      for (const seg of this.variable.split('.')) {
        if (o === undefined || o === null) break;
        o = (seg === '_parent') ? o._parent : (seg === '_root' ? K.scene.racine : o[seg]);
      }
      if (o !== undefined && o !== null && typeof o !== 'object') {
        const s = String(o);
        if (s !== this._texte || this._html) { this.text = s; }
      }
    }
    return this.mesurer();
  }

  dessinerDans(ctx, alpha) {
    if (!this.$visible || this.$estMasque) return;
    K.scene.dessinerObjet(ctx, this, alpha, (ctx2, a) => this.dessinerContenu(ctx2, a));
  }
  dessinerContenu(ctx, a) {
    const m = this.contenuAffiche();
    const f = this.$format;
    const x0 = this.$rect[0] + GOUTTIERE + f.leftMargin, y0 = this.$rect[1] + GOUTTIERE;
    const largeur = this.$rect[2] - 2 * GOUTTIERE - f.leftMargin - f.rightMargin;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.$rect[0], this.$rect[1], this.$rect[2] + 0.5, this.$rect[3] + 0.5);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
    let y = y0;
    for (const l of m.lignes) {
      let x = x0 + (l === m.lignes[0] ? f.indent : 0);
      if (l.align === 'centre') x = x0 + (largeur - l.largeur) / 2;
      else if (l.align === 'droite') x = x0 + largeur - l.largeur;
      const yb = y + l.asc;
      for (const mo of l.morceaux) {
        ctx.font = mo.css;
        ctx.globalAlpha = a * (mo.run.alpha === undefined ? f.alpha : mo.run.alpha);
        ctx.fillStyle = mo.run.color || f.color;
        ctx.fillText(mo.texte, x, yb);
        x += mo.largeur;
      }
      y += l.hauteur;
    }
    ctx.restore();
  }
}
K.Texte = Texte;

})(typeof window !== 'undefined' ? window : globalThis);
