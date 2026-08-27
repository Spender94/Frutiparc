/*
  FPBouilleAvm — le minuscule interpréteur AVM1 des scripts d'image des bouilles.

  POURQUOI un interpréteur plutôt qu'une traduction à la main. Les treize
  animations d'une bouille (parle, rire, mdr, langue, rougir, regard, sifflote,
  gum, question, miam, pleure, larme) ne vivent pas dans un tableau de données :
  elles vivent dans les scripts d'image des pellicules, et CHAQUE famille a les
  siens, avec ses propres compteurs et ses propres retours. Recopier ces timings
  à la main pour dix familles, c'est dix occasions de se tromper d'une image.
  Jouer le bytecode d'origine, c'est le rendu d'époque par construction.

  CE QU'IL FAUT JOUER. Un recensement sur les dix SWF de famille (tous les
  DoAction internes aux DefineSprite) ne relève que vingt-six opcodes :

    Push GetVariable GetMember ConstantPool Not SetVariable Pop CallMethod If
    Greater Decrement GotoFrame2 Subtract GetProperty Play GoToLabel Add2
    SetMember Stop RandomNumber Jump Multiply GotoFrame Less2 Divide CallFunction

  Rien d'autre : pas de fonction définie, pas de tableau, pas d'objet. Le
  vocabulaire tient en une page.

  LES IDIOMES D'ÉPOQUE qu'on y retrouve :

    compt = compt - 1 ; if (compt > 0) gotoAndPlay(_currentframe - 1)
        « tenir cette image compt fois » — la boucle sur deux images.
    compt-- ; if (compt > 0) { gotoAndPlay("rire") } else _parent.playAnim(_parent.next)
        « rejouer le rire, sinon rendre la main à l'animation suivante ».
    bubble._width = bubble._width + size ; if (bubble._width > random(150) + 30) …
        le chewing-gum qui gonfle jusqu'à une taille tirée au sort.
    vit = -(random(5) + 3) ; _parent.col2._rotation += vit ; gotoAndPlay(2)
        la casquette qui tourne — trois images dont le dessin ne change pas,
        et dont TOUT le mouvement est dans ce script.

  LES PROPRIÉTÉS. Le même recensement ne cite que sept `_propriétés` dans les
  scripts d'image : _totalframes, _width, _height, _alpha, _visible,
  _currentframe et _rotation. Elles se lisent et s'écrivent toutes ici, par leur
  nom (GetMember/SetMember) comme par leur numéro (GetProperty/SetProperty, d'où
  la table PROPS) ; c'est au clip de savoir ce qu'elles veulent dire.

  L'HÔTE. L'interpréteur ne connaît ni le SVG ni la pellicule : il parle à des
  objets qui exposent avmGet / avmSet / avmAppel (nos clips, dans
  bouille-moteur.js). Tout le reste — la portée, les propriétés _x/_currentframe,
  les sauts — est ici.
*/
(function (global) {
  'use strict';

  // Les propriétés numérotées de GetProperty/SetProperty.
  const PROPS = ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes',
    '_alpha', '_visible', '_width', '_height', '_rotation', '_target',
    '_framesloaded', '_name', '_droptarget', '_url', '_highquality',
    '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'];

  function lireMembre(o, nom) {
    if (o === null || o === undefined) return undefined;
    if (o.avmGet) return o.avmGet(String(nom));
    return o[nom];
  }
  function ecrireMembre(o, nom, v) {
    if (o === null || o === undefined) return;
    if (o.avmSet) { o.avmSet(String(nom), v); return; }
    o[nom] = v;
  }
  function appeler(o, nom, args) {
    if (o === null || o === undefined) return undefined;
    if (o.avmAppel) return o.avmAppel(String(nom), args);
    const f = o[nom];
    return typeof f === 'function' ? f.apply(o, args) : undefined;
  }

  // Conversions AVM1 : « 3 » + 1 vaut 4, et une comparaison numérique force
  // les deux côtés en nombre. C'est ce que fait Add2 / Less2 / Greater.
  function nombre(v) {
    if (typeof v === 'number') return v;
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function chaine(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    return String(v);
  }
  function estVrai(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? v.length > 0 : n !== 0; }
    return true;
  }
  // Add2 : chaîne si l'un des deux est une chaîne, addition sinon.
  function add2(a, b) {
    if (typeof a === 'string' || typeof b === 'string') return chaine(a) + chaine(b);
    return nombre(a) + nombre(b);
  }

  /**
   * Joue un bloc d'actions.
   *
   * @param {Uint8Array} code   le corps du DoAction
   * @param {object} ctx        { cible, racine, alea }
   *        cible  le clip dont c'est le script (la portée des variables)
   *        racine _root
   *        alea   fonction () → [0,1) — injectable pour les tests
   */
  function jouer(code, ctx) {
    const cible = ctx.cible, racine = ctx.racine;
    const alea = ctx.alea || Math.random;
    let pool = [];
    const pile = [];
    const u16 = (o) => code[o] | (code[o + 1] << 8);
    const i16 = (o) => (u16(o) << 16) >> 16;
    const i32 = (o) => (code[o] | (code[o + 1] << 8) | (code[o + 2] << 16) | (code[o + 3] << 24));
    const f64 = (o) => {
      // Un double AVM1 s'écrit en deux mots de 32 bits ÉCHANGÉS.
      const t = new DataView(new ArrayBuffer(8));
      for (let i = 0; i < 4; i++) { t.setUint8(i, code[o + 4 + i]); t.setUint8(i + 4, code[o + i]); }
      return t.getFloat64(0, true);
    };
    const lireChaine = (o) => {
      let e = o, s = '';
      while (code[e]) { s += String.fromCharCode(code[e]); e++; }
      try { s = decodeURIComponent(escape(s)); } catch (err) { /* déjà lisible */ }
      return { texte: s, fin: e + 1 };
    };

    // La portée : une variable non qualifiée se cherche sur le clip courant,
    // puis parmi les noms réservés.
    function resoudre(nom) {
      if (nom === '_root') return racine;
      if (nom === '_parent') return lireMembre(cible, '_parent');
      if (nom === 'this') return cible;
      return lireMembre(cible, nom);
    }
    function affecter(nom, v) { ecrireMembre(cible, nom, v); }

    let o = 0, garde = 0;
    while (o < code.length && code[o] && garde++ < 20000) {
      const op = code[o];
      if (op < 0x80) {
        o += 1;
        switch (op) {
          case 0x06: appeler(cible, 'play', []); break;                       // Play
          case 0x07: appeler(cible, 'stop', []); break;                       // Stop
          case 0x0b: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) - nombre(b)); break; }
          case 0x0c: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) * nombre(b)); break; }
          case 0x0d: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) / nombre(b)); break; }
          case 0x12: pile.push(!estVrai(pile.pop())); break;                  // Not
          case 0x17: pile.pop(); break;                                       // Pop
          case 0x1c: pile.push(resoudre(chaine(pile.pop()))); break;          // GetVariable
          case 0x1d: { const v = pile.pop(), n = chaine(pile.pop()); affecter(n, v); break; }
          case 0x22: {                                                        // GetProperty
            const i = nombre(pile.pop()), c = pile.pop();
            const obj = (c === '' || c === undefined) ? cible : cheminVers(c);
            pile.push(lireMembre(obj, PROPS[i] || ('_p' + i)));
            break;
          }
          case 0x23: {                                                        // SetProperty
            const v = pile.pop(), i = nombre(pile.pop()), c = pile.pop();
            const obj = (c === '' || c === undefined) ? cible : cheminVers(c);
            ecrireMembre(obj, PROPS[i] || ('_p' + i), v);
            break;
          }
          case 0x30: pile.push(Math.floor(alea() * nombre(pile.pop()))); break; // RandomNumber
          case 0x3d: {                                                        // CallFunction
            const nom = chaine(pile.pop()), n = nombre(pile.pop()), args = [];
            for (let i = 0; i < n; i++) args.push(pile.pop());
            pile.push(appeler(cible, nom, args));
            break;
          }
          case 0x47: { const b = pile.pop(), a = pile.pop(); pile.push(add2(a, b)); break; }
          case 0x48: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) < nombre(b)); break; }
          case 0x49: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) === nombre(b)); break; }
          case 0x4e: { const n = pile.pop(), obj = pile.pop(); pile.push(lireMembre(obj, chaine(n))); break; }
          case 0x4f: { const v = pile.pop(), n = pile.pop(), obj = pile.pop(); ecrireMembre(obj, chaine(n), v); break; }
          case 0x50: { const n = chaine(pile.pop()); pile.push(nombre(n) + 1); break; }
          case 0x51: pile.push(nombre(pile.pop()) - 1); break;                // Decrement
          case 0x52: {                                                        // CallMethod
            const nom = pile.pop(), obj = pile.pop(), n = nombre(pile.pop()), args = [];
            for (let i = 0; i < n; i++) args.push(pile.pop());
            pile.push(nom === '' || nom === undefined
              ? undefined : appeler(obj, chaine(nom), args));
            break;
          }
          case 0x67: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) > nombre(b)); break; }
          case 0x0e: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) === nombre(b)); break; }
          case 0x0f: { const b = pile.pop(), a = pile.pop(); pile.push(nombre(a) < nombre(b)); break; }
          case 0x13: { const b = pile.pop(), a = pile.pop(); pile.push(chaine(a) === chaine(b)); break; }
          case 0x4a: pile.push(nombre(pile.pop())); break;
          case 0x4b: pile.push(chaine(pile.pop())); break;
          case 0x4c: pile.push(pile[pile.length - 1]); break;
          case 0x18: pile.push(Math.trunc(nombre(pile.pop()))); break;
          default: break;                                                     // hors périmètre
        }
        continue;
      }
      const len = u16(o + 1);
      const corps = o + 3;
      o = corps + len;
      switch (op) {
        case 0x88: {                                                          // ConstantPool
          const n = u16(corps);
          pool = [];
          let p = corps + 2;
          for (let i = 0; i < n; i++) { const r = lireChaine(p); pool.push(r.texte); p = r.fin; }
          break;
        }
        case 0x96: {                                                          // Push
          let p = corps;
          while (p < corps + len) {
            const t = code[p]; p += 1;
            if (t === 0) { const r = lireChaine(p); pile.push(r.texte); p = r.fin; }
            else if (t === 1) { const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, code[p + i]); pile.push(dv.getFloat32(0, true)); p += 4; }
            else if (t === 2) { pile.push(null); }
            else if (t === 3) { pile.push(undefined); }
            else if (t === 4) { pile.push(undefined); p += 1; }               // registre : inutilisé ici
            else if (t === 5) { pile.push(code[p] !== 0); p += 1; }
            else if (t === 6) { pile.push(f64(p)); p += 8; }
            else if (t === 7) { pile.push(i32(p)); p += 4; }
            else if (t === 8) { pile.push(pool[code[p]]); p += 1; }
            else if (t === 9) { pile.push(pool[u16(p)]); p += 2; }
            else { p = corps + len; }
          }
          break;
        }
        case 0x81: appeler(cible, 'allerImage', [u16(corps) + 1, false]); break;   // GotoFrame
        case 0x8c: appeler(cible, 'allerImage', [lireChaine(corps).texte, false]); break; // GoToLabel
        case 0x9f: {                                                          // GotoFrame2
          const drapeaux = code[corps];
          let biais = 0;
          if (drapeaux & 2) biais = u16(corps + 1);
          const v = pile.pop();
          const cadre = (typeof v === 'string' && isNaN(Number(v))) ? v : nombre(v) + biais;
          appeler(cible, 'allerImage', [cadre, !!(drapeaux & 1)]);
          break;
        }
        case 0x99: o = corps + len + i16(corps); break;                       // Jump
        case 0x9d: if (estVrai(pile.pop())) o = corps + len + i16(corps); break; // If
        case 0x8b: break;                                                     // SetTarget : hors périmètre
        default: break;
      }
    }

    // Un chemin d'époque (« _parent », « /face/b ») → l'objet visé. Les scripts
    // des familles n'en usent qu'avec la chaîne vide ; on couvre le simple.
    function cheminVers(c) {
      if (c === undefined || c === null || c === '') return cible;
      if (typeof c === 'object') return c;
      let obj = cible;
      const parts = String(c).replace(/^\//, '').split(/[\/.]/);
      for (const p of parts) {
        if (!p || p === '.') continue;
        obj = p === '..' ? lireMembre(obj, '_parent') : lireMembre(obj, p);
      }
      return obj;
    }
  }

  const API = { jouer, PROPS, nombre, chaine, estVrai };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else global.FPBouilleAvm = API;
})(typeof window !== 'undefined' ? window : globalThis);
