/*
 * Burning Kiwi — le mode MULTI : des courses en ligne, à deux, trois ou
 * quatre pilotes du parc, sur n'importe lequel des six circuits.
 *
 * LE PRINCIPE, ET POURQUOI ÇA NE LAGUE PAS. Chaque pilote joue SA voiture
 * chez lui, avec la physique du jeu, au pas, exactement comme en solo : la
 * touche agit à l'image même où on l'enfonce, le réseau n'est jamais entre le
 * doigt et le virage. Vingt fois par seconde, la voiture dit où elle est au
 * serveur (x, y, cap, vitesse, nitro, tour, balise), qui le relaie aux autres
 * pilotes du salon (server/net.js) ; les voitures des autres se dessinent
 * ENTRE deux positions reçues, un dixième de seconde en arrière du présent —
 * ce retard est le prix d'un mouvement lisse : il absorbe la gigue du réseau,
 * et quand une position tarde, la voiture est prolongée sur son cap à sa
 * vitesse, puis s'arrête plutôt que d'inventer. Les voitures ne se cognent
 * pas : elles se traversent, comme un fantôme — une collision à cent
 * millisecondes de distance ne serait la même pour personne.
 *
 * Le chrono de chacun est le sien ; le classement se fait au temps, par le
 * serveur, quand les temps arrivent. Le départ est commun : chacun charge le
 * circuit, et le serveur donne l'heure du GO, la même pour tous (on la
 * traduit en heure locale grâce à l'écart d'horloge mesuré au ping).
 *
 * LA X VIOLET : la voiture du mode, et de lui seul — la meilleure valeur de
 * chaque caractéristique prise parmi les cinq écuries (la rotation du Fury
 * Hun, l'accélération et l'adhérence… ), sept nitros, et une carrosserie à
 * part : celle de l'UltraCop (habillage 41, la seule du SWF qui rayonne),
 * teinte en violet, phares allumés même en plein jour. Rien ne lui ressemble
 * sur la piste. Tout le monde peut la prendre : c'est un mode pour s'amuser,
 * rien n'y est classé.
 *
 * Le salon (hub, salons, pilotes, voiture, prêt, lancer) est un panneau HTML
 * posé sur la scène (index.html, #bk-multi) : des listes et des boutons, ce
 * que le canevas fait mal. La course, elle, est celle du jeu.
 */
'use strict';

(function (racine) {

const J = racine.BkiwiJeu = racine.BkiwiJeu || {};
const K = racine.KalugaMoteur;

const RETARD = 100;             // ms : les voitures des autres se dessinent dans le passé
const PROLONGE_MAX = 250;       // ms : au-delà, une voiture sans nouvelle s'arrête
const ECHANTILLONS_MAX = 12;    // positions gardées par voiture
const CADENCE_ENVOI = 2;        // une position tous les deux pas (vingt par seconde)

const horloge = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const angleCourt = (a, b, t) => {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
};

// La voiture du mode : le meilleur de chaque colonne de carStats, sept
// nitros (le plafond du jeu), et la carrosserie 41 (l'UltraCop : la seule du
// clip « car » entourée de rayons de lumière) teinte en violet, phares
// allumés (`phares`) — les cinq écuries n'ont rien de tel en plein jour.
const X_VIOLET = { rot: 9, accel: 1.8, brake: 0.93, turning: 0.992, maxSpeed: 16.2, grip: 0.7, kiwis: 7, skin: 41, violet: true, phares: true };
const TEINTE_VIOLET = [50, 60, 30, 0, 90, 110];   // ra, rb, ga, gb, ba, bb (Color.setTransform)

J.installerMulti = function (M) {
  M.MULTI = 9;                    // après TRAINING (8) ; hors du slot des modes
  M.X_VIOLET = 5;                 // l'indice de la voiture
  M.carStats[M.X_VIOLET] = Object.assign({}, X_VIOLET);
  M.staticStats[M.X_VIOLET] = { maxSpeed: 1, accel: 1, grip: 1, rot: 1 };
  J.multi.M = M;
};
J.nomVoiture = function (c) {
  const M = J.multi.M;
  if (!M) return '';
  if (Number(c) === M.X_VIOLET) return 'X Violet';
  const st = M.carStats[c];
  return st ? (M.carSkinNames[st.skin - 1] || '') : '';
};
J.teindreViolet = function (mc) {
  const [ra, rb, ga, gb, ba, bb] = TEINTE_VIOLET;
  J.setColor(mc, ra, rb, ga, gb, ba, bb);
};

// ── Le contrôleur ──────────────────────────────────────────────────────────
const multi = {
  M: null,
  reseau: null,
  actif: false,                   // un fil ouvert, un salon ou le hub affiché
  hub: { salons: [], libres: [] },
  salon: null,                    // { id, hote, piste, etat, joueurs:[{u,n,f,c,i,r,k,t,g}] }
  course: null,                   // la course en cours (voir demarrerCourse)
  dernierResultat: null,          // le classement de la dernière course, pour le salon
  erreur: '',
  etat: '',
  surFermeture: null,             // posé par le menu : retour aux modes de jeu
  surVoiture: null,               // posé par le menu : aller choisir la voiture

  moi() { return (J.client && J.client.pseudo) || ''; },
  disponible() { return !!(J.client && J.client.sid && typeof WebSocket === 'function' && racine.ReseauJeu); },

  // ── Le fil ──
  ouvrir() {
    this.actif = true;
    if (!this.reseau) {
      const { Reseau } = racine.ReseauJeu;
      this.reseau = new Reseau({
        balise: 'kw', salon: 'hub',
        sid: J.client.sid, pseudo: this.moi(), nom: this.moi(), bouille: '',
        surEtat: (t) => { this.etat = t; this.rendre(); },
        surEvenement: (e, el) => this.evenement(e, el),
      });
      this.reseau.connecter();
    }
    this.montrer(true);
    this.rendre();
  },
  fermer() {
    if (this.reseau) { this.reseau.sb({ a: 'quitter' }); this.reseau.fermer(); }
    this.reseau = null;
    this.actif = false;
    this.salon = null;
    this.course = null;
    this.dernierResultat = null;
    this.montrer(false);
    if (this.surFermeture) this.surFermeture();
  },
  envoyer(attrs) { return this.reseau ? this.reseau.sb(attrs) : false; },

  // ── Les événements du serveur ──
  evenement(e, el) {
    const M = this.M;
    const lireJ = (balise) => [...el.getElementsByTagName(balise)].map((n) => ({
      u: n.getAttribute('u'), n: n.getAttribute('n') || n.getAttribute('u'), f: n.getAttribute('f') || '',
      c: Number(n.getAttribute('c')) || 0, i: Number(n.getAttribute('i')) || 0,
      r: n.getAttribute('r') === '1', k: n.getAttribute('k') === '1',
      t: Number(n.getAttribute('t')) || 0, g: Number(n.getAttribute('g')) || 0,
    }));
    switch (e) {
      case 'hub':
        this.hub = {
          salons: [...el.getElementsByTagName('s')].map((n) => ({
            id: n.getAttribute('i'), hote: n.getAttribute('h'), piste: Number(n.getAttribute('p')) || 0,
            n: Number(n.getAttribute('n')) || 0, etat: n.getAttribute('e'),
          })),
          libres: lireJ('j'),
        };
        // Reconnexion : on redit sa voiture (le serveur nous a peut-être oubliés).
        if (M && M.vs && !this._voitureDite) { this._voitureDite = true; this.envoyer({ a: 'voiture', c: String(M.vs.selectedCar) }); }
        break;
      case 'salon':
        // (la course en mémoire reste jusqu'au retour au salon : les écrans
        // de fin la lisent encore quand le résultat tombe)
        this.salon = { id: el.getAttribute('s'), hote: el.getAttribute('h'), piste: Number(el.getAttribute('p')) || 0,
          etat: el.getAttribute('et'), joueurs: lireJ('j') };
        break;
      case 'depart':
        this.salon = { id: el.getAttribute('s'), hote: el.getAttribute('h'), piste: Number(el.getAttribute('p')) || 0,
          etat: 'chargement', joueurs: lireJ('j') };
        this.demarrerCourse();
        break;
      case 'go': {
        if (!this.course) break;
        const at = Number(el.getAttribute('at'));
        this.course.goAt = this.reseau ? this.reseau.heureLocale(at) : horloge();
        this.course.go = true;
        break;
      }
      case 'pos': this.position(el); break;
      case 'arrivee':
      case 'resultat': {
        const l = [...el.getElementsByTagName('a')].map((n) => ({
          u: n.getAttribute('u'), n: n.getAttribute('n') || n.getAttribute('u'), c: Number(n.getAttribute('c')) || 0,
          t: Number(n.getAttribute('t')) || 0, g: Number(n.getAttribute('g')) || 0,
        }));
        if (this.course) {
          this.course.classement = l;
          if (e === 'resultat') this.course.resultat = true;
          // Les voitures des autres : finies quand leur temps est là.
          for (const a of l) if (a.t && this.course.distants[a.u]) this.course.distants[a.u].mc.finished = true;
        }
        this.dernierResultat = l;
        break;
      }
      case 'quitte':
      case 'abandon': {
        const u = el.getAttribute('u');
        if (this.course && this.course.distants[u]) this.course.distants[u].parti = true;
        break;
      }
      case 'err':
        this.erreur = this.messageErreur(el.getAttribute('m'));
        if (this._erreurTimer) clearTimeout(this._erreurTimer);
        this._erreurTimer = setTimeout(() => { this.erreur = ''; this.rendre(); }, 4000);
        break;
      default: break;
    }
    this.rendre();
  },
  messageErreur(code) {
    return {
      'salon-plein': 'Ce salon est complet (quatre pilotes).',
      'salon-inconnu': 'Ce salon n’existe plus.',
      'course-en-cours': 'La course est déjà partie.',
      'pas-prets': 'Tout le monde n’est pas prêt.',
      seul: 'Il faut au moins deux pilotes.',
      'pas-l-hote': 'Seul l’hôte peut faire ça.',
      'not-logged': 'Il faut être connecté au parc.',
    }[code] || ('Erreur : ' + code);
  },

  // ── Le salon : les actions ──
  creer() { this.erreur = ''; this.envoyer({ a: 'creer', p: String(this.M.vs.selectedTrack || 0) }); },
  rejoindre(id) { this.erreur = ''; this.envoyer({ a: 'rejoindre', s: id }); },
  quitterSalon() { this.envoyer({ a: 'quitter' }); this.salon = null; this.dernierResultat = null; this.rendre(); },
  piste(p) { this.envoyer({ a: 'piste', p: String(p) }); },
  pret(r) { this.envoyer({ a: 'pret', r: r ? '1' : '0' }); },
  lancer() { this.erreur = ''; this.envoyer({ a: 'lancer' }); },
  voiture(c) { this.envoyer({ a: 'voiture', c: String(c) }); },
  changerVoiture() { this.montrer(false); if (this.surVoiture) this.surVoiture(); },

  // ── La course ──
  // Le serveur a lancé : on charge le circuit comme n'importe quelle course
  // (mainPhase 3 → 4 → 1), et c'est initGame qui dira « chargé ».
  demarrerCourse() {
    const M = this.M;
    const moi = this.moi();
    const pilotes = this.salon.joueurs.slice().sort((a, b) => a.i - b.i);
    let monIndice = pilotes.findIndex((p) => p.u === moi);
    if (monIndice < 0) monIndice = 0;
    this.course = {
      salon: this.salon.id, piste: this.salon.piste, pilotes, monIndice,
      go: false, goAt: 0, chargeDit: false, finEnvoyee: false, abandonne: false,
      distants: {}, classement: [], resultat: false, pas: 0,
    };
    this.montrer(false);
    M.vs.gameMode = M.MULTI;
    M.vs.selectedTrack = this.salon.piste;
    M.vs.menuPhase = -1;
    M.skipToTrackPresent = false;
    M.vs.mainPhase = 3;
  },
  // Les voitures de la grille : la mienne en 0, les autres à la suite, chacun
  // à la place de la grille qu'il a dans le salon.
  grille() {
    const c = this.course;
    if (!c) return [];
    const l = [];
    let id = 1;
    c.pilotes.forEach((p, i) => {
      const moi = i === c.monIndice;
      l.push({ u: p.u, nom: p.n, voiture: p.c, place: i, id: moi ? 0 : id++, moi });
    });
    return l;
  },
  // Une voiture d'un autre pilote, posée par attachTrack : on la pilotera
  // depuis ses positions reçues.
  lier(u, mc) {
    if (!this.course) return;
    mc.distant = true;
    mc.vs.immuneHit = Infinity;        // jamais de collision
    this.course.distants[u] = { mc, echantillons: [], parti: false, nitro: false, vu: 0 };
  },
  // Le circuit est chargé (initGame) : on le dit, et l'on attend le GO.
  charge() {
    if (!this.course || this.course.chargeDit) return;
    this.course.chargeDit = true;
    this.envoyer({ a: 'charge' });
    this._voitureDite = true;
  },
  pretAuDepart() {
    const c = this.course;
    if (!c) return true;
    return c.go && horloge() >= c.goAt;
  },
  // Une position reçue.
  position(el) {
    const c = this.course;
    if (!c) return;
    const d = c.distants[el.getAttribute('u')];
    if (!d) return;
    const ech = {
      t: horloge(), x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')), r: Number(el.getAttribute('r')),
      v: Number(el.getAttribute('v')) || 0, n: el.getAttribute('n') === '1', l: Number(el.getAttribute('l')) || 0,
      c: Number(el.getAttribute('c')), k: Number(el.getAttribute('k')) || 0, f: el.getAttribute('f') === '1',
    };
    if (!Number.isFinite(ech.x) || !Number.isFinite(ech.y) || !Number.isFinite(ech.r)) return;
    d.echantillons.push(ech);
    if (d.echantillons.length > ECHANTILLONS_MAX) d.echantillons.shift();
  },
  // Chaque pas de la course (mainGame) : ma position aux autres, mon arrivée.
  tickCourse() {
    const M = this.M, c = this.course;
    if (!c || !M.carPJ) return;
    const car = M.carPJ;
    c.pas++;
    if (c.pas % CADENCE_ENVOI === 0) {
      this.envoyer({ a: 'pos', x: car.x.toFixed(1), y: car.y.toFixed(1), r: car._rotation.toFixed(1), v: car.speed.toFixed(2),
        n: M.vs.nitroFlag ? '1' : '0', l: String(car.vs.laps), c: String(car.currentCP), k: String(car.totalCP), f: car.finished ? '1' : '0' });
    }
    if (car.finished && !c.finEnvoyee) {
      c.finEnvoyee = true;
      this.envoyer({ a: 'fin', t: String(Math.round(car.vs.totalTime)) });
    }
  },
  abandonner() {
    const c = this.course;
    if (!c || c.finEnvoyee || c.abandonne) return;
    c.abandonne = true;
    this.envoyer({ a: 'abandon' });
  },
  // Les voitures des autres, à la place de moveIA : interpolées un dixième de
  // seconde en arrière, prolongées sur leur cap quand le réseau tarde.
  avancerDistants() {
    const M = this.M, c = this.course;
    if (!c) return;
    const maintenant = horloge() - RETARD;
    for (let i = 1; i < M.cars.length; i++) {
      const mc = M.cars[i];
      if (!mc || !mc.distant) continue;
      const d = Object.values(c.distants).find((x) => x.mc === mc);
      if (!d) continue;
      if (d.parti) { mc._visible = false; if (M.carShadows[i]) M.carShadows[i]._visible = false; continue; }
      const E = d.echantillons;
      if (!E.length) continue;
      let x, y, r;
      const dernier = E[E.length - 1];
      if (E.length >= 2 && maintenant <= dernier.t) {
        let a = E[0], b = E[1];
        for (let k = E.length - 1; k >= 1; k--) if (E[k - 1].t <= maintenant) { a = E[k - 1]; b = E[k]; break; }
        const t = b.t > a.t ? Math.max(0, Math.min(1, (maintenant - a.t) / (b.t - a.t))) : 1;
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
        r = angleCourt(a.r, b.r, t);
      } else {
        // Rien de plus frais : on prolonge sur le cap, à la vitesse connue,
        // puis on s'arrête.
        const dt = Math.min(PROLONGE_MAX, Math.max(0, maintenant - dernier.t));
        const pas = dernier.f ? 0 : dernier.v * dt / 25;   // la vitesse est en pixels par pas de 25 ms
        const rad = dernier.r * Math.PI / 180;
        x = dernier.x + Math.cos(rad) * pas;
        y = dernier.y + Math.sin(rad) * pas;
        r = dernier.r;
      }
      mc.x = x; mc.y = y;
      mc._x = x; mc._y = y;
      mc._rotation = r;
      mc.speed = dernier.v;
      mc.vs.laps = dernier.l;
      mc.currentCP = dernier.c;
      mc.totalCP = dernier.k;
      if (dernier.f && !mc.finished) mc.finished = true;
      if (dernier.n !== d.nitro) { d.nitro = dernier.n; if (d.nitro) J.startBoostAnim(mc); else J.stopBoostAnim(mc); }
      const ombre = M.carShadows[i];
      if (ombre) { ombre._x = x + M.shadowShift; ombre._y = y + M.shadowShift; ombre._rotation = r; }
    }
  },
  // Mon rang, tel que le serveur l'a dit à mon arrivée (ou maintenant).
  rang() {
    const c = this.course;
    if (!c) return 0;
    const moi = c.classement.find((a) => a.u === this.moi());
    return moi ? moi.g : 0;
  },
  // Retour au salon après la course : le panneau reprend, la course est close.
  retourSalon() {
    this.course = null;
    this._voitureDite = false;
    if (this.reseau) this.envoyer({ a: 'voiture', c: String(this.M.vs.selectedCar) });
    this.montrer(true);
    this.rendre();
  },

  // ── Le panneau ──
  panneau() { return (typeof document !== 'undefined') ? document.getElementById('bk-multi') : null; },
  montrer(oui) {
    const p = this.panneau();
    if (p) p.style.display = oui ? 'flex' : 'none';
  },
  rendre() {
    const p = this.panneau();
    if (!p || p.style.display === 'none') return;
    const M = this.M;
    const moi = this.moi();
    const nomPiste = (i) => (M.tracks[i] ? M.tracks[i].title : 'circuit ' + i);
    const temps = (t) => (t ? J.timeToString(t) : '—');
    let h = '<div class="bkm-tete"><b>Burning Kiwi en ligne</b><span class="bkm-etat">' + esc(this.etat) + '</span></div>';
    if (this.erreur) h += '<div class="bkm-erreur">' + esc(this.erreur) + '</div>';
    const s = this.salon;
    if (!s) {
      h += '<div class="bkm-section"><div class="bkm-titre">Les courses ouvertes</div>';
      if (!this.hub.salons.length) h += '<div class="bkm-vide">Aucune course pour l’instant : ouvrez la vôtre !</div>';
      for (const x of this.hub.salons) {
        const ouverte = x.etat === 'attente' && x.n < 4;
        h += '<div class="bkm-ligne"><span>Course de <b>' + esc(x.hote) + '</b> · ' + esc(nomPiste(x.piste)) + ' · ' + x.n + '/4' +
          (x.etat !== 'attente' ? ' · <i>en course</i>' : '') + '</span>' +
          '<button class="bkm-btn" data-act="rejoindre" data-id="' + esc(x.id) + '"' + (ouverte ? '' : ' disabled') + '>Rejoindre</button></div>';
      }
      h += '</div>';
      h += '<div class="bkm-section"><div class="bkm-titre">Pilotes au stand</div><div class="bkm-noms">' +
        (this.hub.libres.length ? this.hub.libres.map((j) => esc(j.n)).join(', ') : 'personne') + '</div></div>';
      h += '<div class="bkm-actions"><button class="bkm-btn bkm-grand" data-act="creer">Ouvrir une course</button>' +
        '<button class="bkm-btn" data-act="voiture">Ma voiture : ' + esc(J.nomVoiture(M.vs.selectedCar)) + '</button>' +
        '<button class="bkm-btn bkm-sombre" data-act="retour">Retour</button></div>';
    } else {
      const hote = s.hote === moi;
      const hoteNom = (s.joueurs.find((j) => j.u === s.hote) || {}).n || s.hote;
      h += '<div class="bkm-section"><div class="bkm-titre">Course de ' + esc(hoteNom) + (s.etat !== 'attente' ? ' · en course' : '') + '</div>';
      h += '<div class="bkm-piste">Circuit : ' + (hote && s.etat === 'attente'
        ? '<select data-act="piste">' + M.tracks.map((t, i) => '<option value="' + i + '"' + (i === s.piste ? ' selected' : '') + '>' + esc(t.title) + ' (' + t.totalLaps + ' tours)</option>').join('') + '</select>'
        : '<b>' + esc(nomPiste(s.piste)) + '</b>' + (M.tracks[s.piste] ? ' (' + M.tracks[s.piste].totalLaps + ' tours)' : '')) + '</div>';
      if (this.dernierResultat && this.dernierResultat.length) {
        h += '<div class="bkm-titre bkm-petit">Dernière course</div>';
        for (const a of this.dernierResultat) {
          h += '<div class="bkm-ligne bkm-res"><span>' + (a.g ? a.g + '. ' : '— ') + '<b>' + esc(a.n) + '</b> <i>' + esc(J.nomVoiture(a.c)) + '</i></span><span>' + (a.t ? esc(temps(a.t)) : 'abandon') + '</span></div>';
        }
      }
      h += '<div class="bkm-titre bkm-petit">Pilotes (' + s.joueurs.length + '/4)</div>';
      for (const j of s.joueurs) {
        const estMoi = j.u === moi;
        h += '<div class="bkm-ligne"><span>' + (j.u === s.hote ? '★ ' : '') + '<b>' + esc(j.n) + '</b>' + (estMoi ? ' (vous)' : '') +
          ' <i>' + esc(J.nomVoiture(j.c)) + '</i></span><span class="bkm-pret' + (j.r || j.u === s.hote ? ' oui' : '') + '">' +
          (j.u === s.hote ? 'hôte' : (j.r ? 'prêt' : 'pas prêt')) + '</span></div>';
      }
      h += '</div>';
      const moiJ = s.joueurs.find((j) => j.u === moi) || {};
      const tousPrets = s.joueurs.length >= 2 && s.joueurs.every((j) => j.u === s.hote || j.r);
      h += '<div class="bkm-actions">';
      if (s.etat === 'attente') {
        if (hote) h += '<button class="bkm-btn bkm-grand" data-act="lancer"' + (tousPrets ? '' : ' disabled') + '>Lancer la course</button>';
        else h += '<button class="bkm-btn bkm-grand' + (moiJ.r ? ' bkm-oui' : '') + '" data-act="pret">' + (moiJ.r ? 'Prêt ! (annuler)' : 'Je suis prêt') + '</button>';
        h += '<button class="bkm-btn" data-act="voiture">Ma voiture : ' + esc(J.nomVoiture(M.vs.selectedCar)) + '</button>';
      } else {
        h += '<div class="bkm-vide">La course est en cours…</div>';
      }
      h += '<button class="bkm-btn bkm-sombre" data-act="quitter">Quitter le salon</button></div>';
      if (hote && s.etat === 'attente') h += '<div class="bkm-note">Vous êtes l’hôte : choisissez le circuit, et lancez quand tout le monde est prêt.</div>';
    }
    h += '<div class="bkm-note">Les voitures des autres se traversent : pas de collision en ligne. Rien n’est classé, c’est pour le plaisir.</div>';
    p.innerHTML = h;
  },
  // Les clics du panneau (une seule écoute, posée par index.html).
  action(el) {
    const act = el.dataset.act;
    if (!act) return;
    if (act === 'rejoindre') this.rejoindre(el.dataset.id);
    else if (act === 'creer') this.creer();
    else if (act === 'voiture') this.changerVoiture();
    else if (act === 'retour') this.fermer();
    else if (act === 'lancer') this.lancer();
    else if (act === 'pret') { const s = this.salon; const moiJ = s && s.joueurs.find((j) => j.u === this.moi()); this.pret(!(moiJ && moiJ.r)); }
    else if (act === 'quitter') this.quitterSalon();
    else if (act === 'piste') this.piste(Number(el.value));
  },
};
J.multi = multi;

})(typeof window !== 'undefined' ? window : globalThis);
