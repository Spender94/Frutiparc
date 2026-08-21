/*
 * JamaJama — la racine : la boucle à 32 images par seconde, le clavier, la
 * souris, le doigt, et la ronde des états — menu, aventure (packs puis
 * parchemin), partie. La logique de chaque état est la transcription de son
 * State du SWF ; la partie rejoue les lots d'animations du moteur de règles
 * et n'accepte une entrée que quand tout est retombé, comme GameManager.
 *
 * Au doigt (le jeu d'origine était clavier seul) : glisser = un pas dans la
 * direction du geste, toucher = la barre d'espace (le fantôme), le bouton en
 * haut à droite = Échap.
 */
'use strict';

(function () {
  const R = window.JamaRegles;
  const Rendu = window.JamaRendu;
  const Ecrans = window.JamaEcrans;
  const Vue = window.JamaVue;
  const { Consts, Direction, Replay } = R;

  const canvas = document.getElementById('jama');
  const ctx = canvas.getContext('2d');
  const sid = new URLSearchParams(location.search).get('sid') || '';
  const plateforme = new window.JamaPlateforme.Plateforme(sid);

  // ── l'échelle : 384 logique, net sur tout écran ──
  let K = 1;
  function dimensionner() {
    const taille = Math.min(window.innerWidth, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    K = taille / Consts.WIDTH;
    canvas.style.width = taille + 'px';
    canvas.style.height = taille + 'px';
    canvas.width = Math.round(Consts.WIDTH * K * dpr);
    canvas.height = Math.round(Consts.HEIGHT * K * dpr);
  }
  window.addEventListener('resize', dimensionner);
  dimensionner();

  // ── le clavier ──
  //
  // Le jeu d'origine interroge Key.isDown à chaque image : maintenir une
  // flèche enchaîne les pas. On garde ce comportement, mais on retient aussi
  // le dernier appui non encore servi (`enAttente`) — sans quoi une pression
  // brève tombée entre deux tours de boucle, ou pendant qu'une animation
  // joue, serait perdue. C'est la différence entre un jeu qui répond et un
  // jeu qui « saute » des touches.
  const touches = {};
  let enAttente = null;
  let espaceAppuye = false, espaceBascule = false, echapDemande = false;
  const FLECHES = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
  window.addEventListener('keydown', (e) => {
    touches[e.key] = true;
    if (FLECHES[e.key] !== undefined) { enAttente = FLECHES[e.key]; e.preventDefault(); }
    if (e.key === ' ') { espaceAppuye = true; e.preventDefault(); }
    if (e.key === 'Escape') echapDemande = true;
  });
  window.addEventListener('keyup', (e) => {
    touches[e.key] = false;
    if (e.key === ' ' && espaceAppuye) { espaceBascule = true; espaceAppuye = false; }
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(touches)) touches[k] = false;
    enAttente = null;
  });

  // ── la souris et le doigt, en coordonnées 384 ──
  const souris = { x: -1, y: -1, clic: false };
  function versJeu(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K };
  }
  canvas.addEventListener('mousemove', (e) => {
    const p = versJeu(e);
    souris.x = p.x; souris.y = p.y;
  });
  canvas.addEventListener('mousedown', (e) => {
    const p = versJeu(e);
    souris.x = p.x; souris.y = p.y; souris.clic = true;
    canvas.focus();
  });
  let doigt = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    const p = versJeu(t);
    doigt = { x: p.x, y: p.y, t: Date.now() };
    souris.x = p.x; souris.y = p.y;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!doigt) return;
    const t = e.changedTouches[0];
    const p = versJeu(t);
    const dx = p.x - doigt.x, dy = p.y - doigt.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 12) {
      // un TOUCHER : un clic pour les écrans, la barre d'espace en partie
      souris.x = p.x; souris.y = p.y; souris.clic = true;
      if (etat && etat.nom === 'partie') { espaceBascule = true; souris.clic = false; }
    } else if (etat && etat.nom === 'partie') {
      geste = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? Direction.EAST : Direction.WEST)
        : (dy > 0 ? Direction.SOUTH : Direction.NORTH);
    }
    doigt = null;
    e.preventDefault();
  }, { passive: false });
  let geste = null;

  // ── la ronde des états ──
  let etat = null;
  function passer(nouvel) { etat = nouvel; }

  // — le menu —
  function EtatMenu() {
    const ecran = new Ecrans.EcranMenu();
    return {
      nom: 'menu',
      update(tmod) {
        const id = ecran.update(tmod, souris);
        if (id === 2) passer(EtatAventure());
        // 1 tournoi, 4 éditeur, 5 stats, 6 aide, 7 options : les prochaines
        // étapes du portage — le menu les montre déjà, fidèle au fichier.
      },
      dessiner() { ecran.dessiner(ctx); },
    };
  }

  // — l'aventure : les packs, puis le parchemin (adventure.State) —
  function EtatAventure(memoire) {
    const moi = {
      nom: 'aventure',
      packId: memoire ? memoire.packId : -1,
      index: memoire ? memoire.index : null,
      niveaux: null,
      jokers: 3,
      lastCompleted: -1,
      ecran: new Ecrans.EcranPacks(plateforme.packsOuverts()),
      select: null,
    };
    function surPack(packId) {
      moi.packId = packId;
      const pack = plateforme.packs[packId];
      moi.niveaux = pack.niveaux.map((n, i) => ({
        titre: n.titre,
        complete: plateforme.aventure.hasCompletedLevel(packId, i),
      }));
      let dernier = -1, faits = 0;
      moi.niveaux.forEach((n, i) => { if (n.complete) { faits += 1; dernier = i; } });
      moi.lastCompleted = dernier;
      moi.jokers = dernier > -1 ? 3 - (dernier - faits) : 3;
      moi.index = 0;
      moi.ecran = null;
      moi.select = new Ecrans.EcranSelect();
      majSelect();
      moi.select.prevActif = false;
      moi.select.nextActif = moi.niveaux.length > 1;
    }
    function majSelect() {
      moi.select.prevActif = moi.index - 1 >= 0;
      moi.select.nextActif = moi.index + 1 < moi.niveaux.length;
      moi.select.titre = moi.niveaux[moi.index].titre;
      moi.select.jokers = moi.jokers;
      moi.select.complete = moi.niveaux[moi.index].complete;
    }
    function suivant() {
      moi.index += 1;
      if (moi.index >= moi.niveaux.length) { moi.index -= 1; return; }
      if (moi.jokers - 1 < 0) { moi.index -= 1; return; }
      if (moi.index > moi.lastCompleted) moi.jokers -= 1;
      majSelect();
    }
    function precedent() {
      moi.index -= 1;
      if (moi.index < 0) { moi.index += 1; return; }
      if (moi.index + 1 > moi.lastCompleted) moi.jokers += 1;
      majSelect();
    }
    if (moi.packId >= 0) {
      const vise = moi.index;
      surPack(moi.packId);
      // setIndex : rejouer les pas pour retrouver l'endroit mémorisé.
      if (vise != null) {
        let i = Math.min(Math.max(0, vise), moi.niveaux.length - 1);
        while (i > moi.index && moi.jokers > 0) { const avant = moi.index; suivant(); if (moi.index === avant) break; }
        while (i < moi.index) precedent();
      }
    }
    return {
      nom: 'aventure',
      update(tmod) {
        if (echapDemande) {
          echapDemande = false;
          if (moi.select) passer(EtatAventure());
          else passer(EtatMenu());
          return;
        }
        if (moi.ecran) {
          const p = moi.ecran.update(tmod, souris);
          if (p >= 0) surPack(p);
        } else if (moi.select) {
          const a = moi.select.update(tmod, souris);
          if (a === 'prev') precedent();
          if (a === 'next') suivant();
          if (a === 'play') {
            const niveau = plateforme.niveauAventure(moi.packId, moi.index);
            if (niveau) {
              passer(EtatPartie(niveau, { type: 'aventure', pack: moi.packId, niveau: moi.index },
                { packId: moi.packId, index: moi.index }));
            }
          }
        }
      },
      dessiner() {
        if (moi.ecran) moi.ecran.dessiner(ctx);
        else if (moi.select) moi.select.dessiner(ctx);
      },
    };
  }

  // — la partie (game.State/adventure.PlayState + GameManager) —
  function EtatPartie(niveau, source, memoire) {
    const partie = new R.Partie(niveau.clone());
    const vue = new Vue.VueJeu(partie, plateforme.options);
    vue.jouer({ lots: partie._lots.map((l) => ({
      rapides: l.rapides.map((a) => a.desc), effets: l.effets.map((a) => a.desc) })),
    evenements: [] });
    let dialogue = null;
    let fini = false;
    let envoye = false;

    function envoyer(puis) {
      if (envoye) { puis(); return; }
      envoye = true;
      const p = source.type === 'aventure' && partie.isVictorious()
        ? (plateforme.aventure.setLevelCompleted(source.pack, source.niveau),
          plateforme.sauverAventure())
        : Promise.resolve();
      Promise.resolve(p)
        .then(() => plateforme.envoyerScore(source, partie.getMovements()))
        .then(puis, puis);
    }
    function retour() {
      if (source.type === 'aventure') passer(EtatAventure(memoire));
      else passer(EtatMenu());
    }
    function recommencer() {
      passer(EtatPartie(niveau, source, memoire));
    }

    return {
      nom: 'partie',
      update(tmod) {
        vue.update(tmod);
        if (dialogue) {
          const r = dialogue.update(tmod, souris);
          if (r === 'oui') { dialogue = null; envoyer(retour); }
          else if (r === 'non') { dialogue = null; echapDemande = false; }
          else if (r === 'encore') { dialogue = null; envoyer(recommencer); }
          return;
        }
        if (fini) return;
        if (partie.isEnded() && vue.libre()) {
          fini = true;
          if (partie.isVictorious()) {
            envoyer(retour);
          } else if (source.type === 'aventure') {
            // La défaite d'aventure revient à la sélection, sans question —
            // c'est adventure.PlayState.
            envoyer(retour);
          } else {
            envoyer(() => {
              fini = false;
              envoye = false;
              dialogue = new Ecrans.Dialogue('confirm', 'Perdu ! Recommencer le niveau ?');
              dialogue.update = ((maj) => (tmod2, s) => {
                const r = maj(tmod2, s);
                if (r === 'oui') { dialogue = null; recommencer(); }
                if (r === 'non') { dialogue = null; retour(); }
                return null;
              })(dialogue.update.bind(dialogue));
            });
          }
          return;
        }
        if (echapDemande && vue.libre() && !partie.isEnded()) {
          echapDemande = false;
          dialogue = new Ecrans.Dialogue('retry', 'Abandonner la partie ?');
          return;
        }
        echapDemande = false;
        if (!vue.libre() || partie.isEnded()) return;
        // Les entrées, dans l'ordre de _processInputs : l'espace d'abord,
        // puis les flèches (maintien ou appui en attente), puis le doigt.
        let resultat = null;
        let direction = null;
        if (touches.ArrowUp) direction = Direction.NORTH;
        else if (touches.ArrowDown) direction = Direction.SOUTH;
        else if (touches.ArrowLeft) direction = Direction.WEST;
        else if (touches.ArrowRight) direction = Direction.EAST;
        else if (enAttente != null) direction = enAttente;
        else if (geste != null) direction = geste;
        if (espaceBascule) {
          espaceBascule = false;
          resultat = partie.jouer(partie._inGhostMode ? Replay.STOP_GHOST : Replay.START_GHOST);
        } else if (direction != null) {
          resultat = partie.jouer(direction);
        }
        enAttente = null;
        geste = null;
        if (resultat) vue.jouer(resultat);
      },
      dessiner() {
        vue.dessiner(ctx);
        if (dialogue) dialogue.dessiner(ctx);
        else {
          // Le bouton Échap du tactile, discret en haut à droite.
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = '#000000';
          ctx.fillRect(Consts.WIDTH - 26, 4, 22, 16);
          ctx.fillStyle = '#ffffff';
          ctx.font = '9px Verdana, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('ESC', Consts.WIDTH - 15, 12);
          ctx.restore();
        }
      },
      clicEsc(x, y) {
        return !dialogue && x >= Consts.WIDTH - 26 && x <= Consts.WIDTH - 4 && y >= 4 && y <= 20;
      },
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = versJeu(e);
    if (etat && etat.clicEsc && etat.clicEsc(p.x, p.y)) { echapDemande = true; souris.clic = false; }
  });

  // ── la boucle : le Timer du fichier (32 i/s, tmod lissé à 0,95) ──
  let avant = performance.now();
  let tmodCalc = 1;
  function boucle(maintenant) {
    let delta = (maintenant - avant) / 1000;
    avant = maintenant;
    if (delta < 0.5) tmodCalc = tmodCalc * 0.95 + 0.05 * delta * 32;
    const tmod = tmodCalc;
    // Le temps du lecteur avance pour tout le monde : c'est lui qui fait
    // battre les clips que le jeu ne pilote pas (la flamme d'un joker…).
    Rendu.avancer(tmod);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(K * dpr, 0, 0, K * dpr, 0, 0);
    if (etat) {
      etat.update(tmod);
      if (etat) etat.dessiner();
    }
    souris.clic = false;
    requestAnimationFrame(boucle);
  }

  // ── le chargement ──
  ctx.setTransform(K * (window.devicePixelRatio || 1), 0, 0, K * (window.devicePixelRatio || 1), 0, 0);
  ctx.fillStyle = teinteHex(Consts.BROWN);
  ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
  function teinteHex(n) { return '#' + n.toString(16).padStart(6, '0'); }
  Promise.all([Rendu.charger(''), plateforme.charger().catch(() => null)])
    .then(() => {
      passer(EtatMenu());
      requestAnimationFrame((t) => { avant = t; boucle(t); });
    })
    .catch((e) => {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Verdana, sans-serif';
      ctx.fillText('Chargement impossible : ' + (e.message || e), 20, 40);
    });
})();
