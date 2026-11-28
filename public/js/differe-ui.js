//
// LES PARTIES EN DIFFÉRÉ — le panneau commun à Grapiz et Frutibandas.
//
// Le serveur envoie la liste d'un joueur (<gz|bd e="dlist"> … <d …/>) ; ce
// module la dessine et branche les boutons : inviter un joueur par son pseudo,
// accepter ou décliner une invitation, ouvrir une partie, l'abandonner. Il ne
// parle pas au réseau lui-même : la page lui donne `envoyer(attrs)` (son
// émetteur <gz>/<bd>) et `ouvrir(id)` (sa façon d'afficher une partie).
//
// Les textes et les durées sont ici aussi : « il te reste 2 j 5 h », et le
// même format sert aux horloges de la partie (fmtDelai), où trois jours ne se
// lisent pas en minutes et secondes.
//
// LES LANGUES : chaque texte passe par T() (/js/i18n.js), le français écrit
// ici en repli, l'anglais dans /i18n/en/widgets.js. Les pages des jeux ne
// chargent pas encore i18n.js : sans lui, T() rend le français, gabarit rempli.
//
(function (root) {
  "use strict";

  function remplir(s, p) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? String(p[k]) : m; });
  }
  // FPI18n est cherché à CHAQUE appel : la page peut charger i18n.js après nous.
  function T(cle, fr, p) {
    var I = root.FPI18n;
    return I && I.T ? I.T(cle, fr, p) : remplir(fr, p);
  }
  T.n = function (cle, n, formes, p) {
    var I = root.FPI18n;
    if (I && I.T && I.T.n) return I.T.n(cle, n, formes, p);
    var q = { n: n };
    for (var k in (p || {})) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
    // La règle française : 0 et 1 au singulier.
    return remplir(Math.abs(n) < 2 ? formes.one : formes.other, q);
  };

  function esc(s) { var d = document.createElement("div"); d.textContent = String(s == null ? "" : s); return d.innerHTML; }
  function same(a, b) { return String(a == null ? "" : a).toLowerCase() === String(b == null ? "" : b).toLowerCase(); }
  // Les identifiants des salles et des raisons viennent du serveur ; seul
  // l'affichage se traduit. SALLES reste en français : Grapiz le lit tel quel.
  var SALLES = { amical: "Amical", champ: "Championnat" };
  function nomSalle(sa) {
    if (sa === "amical") return T("widgets.differeAmical", "Amical");
    if (sa === "champ") return T("widgets.differeChampionnat", "Championnat");
    return sa;
  }
  function nomRaison(r) {
    switch (r) {
      case "delai": case "timeout": return T("widgets.differeRaisonDelai", "délai dépassé");
      case "forfeit": return T("widgets.differeRaisonAbandon", "abandon");
      case "connection": return T("widgets.differeRaisonJetons", "jetons reliés");
      case "elimination": return T("widgets.differeRaisonElimination", "élimination");
      case "victory": return T("widgets.differeRaisonVictoire", "victoire");
      case "draw": return T("widgets.differeRaisonEgalite", "égalité");
      default: return r;
    }
  }

  // 259 200 000 ms → « 3 j » ; 93 600 000 → « 1 j 2 h » ; 4 500 000 → « 1 h 15 min ».
  function fmtDelai(ms) {
    ms = Math.max(0, Number(ms) || 0);
    var min = Math.floor(ms / 60000), h = Math.floor(min / 60), j = Math.floor(h / 24);
    if (j >= 1) return h % 24 ? T("widgets.differeJoursHeures", "{j} j {h} h", { j: j, h: h % 24 }) : T("widgets.differeJours", "{j} j", { j: j });
    if (h >= 1) return min % 60 ? T("widgets.differeHeuresMinutes", "{h} h {min} min", { h: h, min: min % 60 }) : T("widgets.differeHeures", "{h} h", { h: h });
    if (min >= 1) return T("widgets.differeMinutes", "{min} min", { min: min });
    return T("widgets.differeMoinsMinute", "moins d’une minute");
  }

  var CSS = ""
    + ".dif{font-family:Verdana,Geneva,sans-serif;color:#333;font-size:13px}"
    + ".dif .dif-intro{color:#666;font-size:12px;line-height:1.5;margin:0 0 10px}"
    + ".dif .dif-inviter{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 14px;padding:10px;border-radius:8px;background:var(--dif-fond,#f6f6f6)}"
    + ".dif .dif-inviter input,.dif .dif-inviter select{font:inherit;padding:6px 8px;border:1px solid #ccc;border-radius:5px;min-width:0}"
    + ".dif .dif-inviter input{flex:1 1 120px}"
    + ".dif .dif-inviter .dif-err{flex-basis:100%;color:#c62828;font-size:12px;min-height:0}"
    + ".dif .dif-inviter .dif-err:empty{display:none}"
    + ".dif button{font:inherit;font-weight:bold;border:0;border-radius:5px;padding:6px 11px;cursor:pointer;background:var(--dif-accent,#8ba731);color:#fff}"
    + ".dif button.sec{background:#e4e4e4;color:#555}"
    + ".dif button.danger{background:#f0626e}"
    + ".dif button:disabled{opacity:.55;cursor:default}"
    + ".dif h4{margin:14px 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--dif-accent,#8ba731)}"
    + ".dif .dif-vide{color:#999;font-size:12px;padding:6px 0}"
    + ".dif .dif-ligne{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;border:1px solid #e6e6e6;margin:0 0 6px;background:#fff}"
    + ".dif .dif-ligne.moi{border-color:var(--dif-accent,#8ba731);box-shadow:0 0 0 1px var(--dif-accent,#8ba731) inset}"
    + ".dif .dif-av{width:44px;height:44px;flex:0 0 auto;border-radius:7px;overflow:hidden;background:#eee}"
    + ".dif .dif-av canvas,.dif .dif-av iframe{width:100%;height:100%;border:0;display:block}"
    + ".dif .dif-txt{flex:1;min-width:0}"
    + ".dif .dif-nom{font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
    + ".dif .dif-nom small{font-weight:normal;color:#888;margin-left:6px}"
    + ".dif .dif-etat{font-size:12px;color:#666;margin-top:2px}"
    + ".dif .dif-etat b{color:var(--dif-accent,#8ba731)}"
    + ".dif .dif-etat .perdu{color:#c62828}.dif .dif-etat .gagne{color:#2e7d32}"
    + ".dif .dif-btns{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}"
    + "@media (max-width:760px){.dif .dif-ligne{flex-wrap:wrap}.dif .dif-btns{flex-basis:100%;justify-content:flex-start}}";

  function creer(opts) {
    if (!document.getElementById("dif-style")) {
      var st = document.createElement("style"); st.id = "dif-style"; st.textContent = CSS; document.head.appendChild(st);
    }
    var box = opts.conteneur;
    box.classList.add("dif");
    var ui = { parties: [], max: 10, delai: 3 * 24 * 3600 * 1000 };

    // La liste du serveur : <… e="dlist" n max delai><d …/>…</…>
    ui.maj = function (el) {
      ui.max = +el.getAttribute("max") || ui.max;
      ui.delai = +el.getAttribute("delai") || ui.delai;
      ui.recu = Date.now();
      ui.parties = Array.prototype.map.call(el.getElementsByTagName("d"), function (n) {
        var g = function (k) { return n.getAttribute(k); };
        return {
          id: g("id"), sa: g("sa"), st: g("st"), a: g("a"), b: g("b"), na: g("na"), nb: g("nb"), fa: g("fa"), fb: g("fb"),
          moi: +g("moi"), tour: +g("tour"), ech: +g("ech") || 0, coups: +g("coups") || 0,
          w: g("w") === null || g("w") === "" ? null : +g("w"), r: g("r") || "", maj: +g("maj") || 0,
        };
      });
      ui.rendre();
      if (opts.onListe) opts.onListe(ui);
    };
    // Ce qui attend le joueur : invitations à répondre + parties où c'est à lui.
    ui.aMoi = function (salle) {
      return ui.parties.filter(function (p) { return (!salle || p.sa === salle) && aMoiDeJouer(p); }).length;
    };
    ui.enCours = function (salle) {
      return ui.parties.filter(function (p) { return (!salle || p.sa === salle) && p.st !== "finie"; }).length;
    };
    function aMoiDeJouer(p) {
      if (p.st === "invitation") return p.moi === 1;
      return p.st === "en_cours" && p.tour === p.moi;
    }
    function adv(p) { return p.moi === 0 ? { u: p.b, n: p.nb, f: p.fb } : { u: p.a, n: p.na, f: p.fa }; }
    function restant(p) { return Math.max(0, p.ech - (Date.now() - (ui.recu || Date.now()))); }

    function etat(p) {
      var a = adv(p), r;
      if (p.st === "invitation") {
        return p.moi === 1 ? T("widgets.differeTInvite", "<b>{nom} t’invite</b> · à répondre sous {delai}", { nom: esc(a.n), delai: fmtDelai(restant(p)) })
          : T("widgets.differeInvitationEnvoyee", "Invitation envoyée · sans réponse, elle s’éteint dans {delai}", { delai: fmtDelai(restant(p)) });
      }
      if (p.st === "en_cours") {
        r = fmtDelai(restant(p));
        // Le numéro du coup est une information à part, posée après un « · ».
        var coup = p.coups ? " · " + T("widgets.differeCoup", "coup {n}", { n: p.coups + 1 }) : "";
        return (p.tour === p.moi ? T("widgets.differeATonTour", "<b>À toi de jouer</b> · il te reste {delai}", { delai: r })
          : T("widgets.differeIlDoitJouer", "{nom} doit jouer · il lui reste {delai}", { nom: esc(a.n), delai: r })) + coup;
      }
      var nul = p.w !== 0 && p.w !== 1;
      var issue = nul ? T("widgets.differeEgalite", "Égalité")
        : (p.w === p.moi ? '<span class="gagne">' + T("widgets.differeVictoire", "Victoire") + "</span>"
          : '<span class="perdu">' + T("widgets.differeDefaite", "Défaite") + "</span>");
      var coups = T.n("widgets.differeCoups", p.coups, { one: "{n} coup", other: "{n} coups" });
      return p.r ? T("widgets.differeTermineeRaison", "Terminée · {issue} ({raison}) · {coups}", { issue: issue, raison: esc(nomRaison(p.r)), coups: coups })
        : T("widgets.differeTerminee", "Terminée · {issue} · {coups}", { issue: issue, coups: coups });
    }

    function ligne(p) {
      var a = adv(p);
      var row = document.createElement("div");
      row.className = "dif-ligne" + (aMoiDeJouer(p) ? " moi" : "");
      var fb = (a.f && a.f.length >= 15) ? a.f : "000000010000000000000000";
      var tete = (root.FPBouilleVignette && root.FPBouilleVignette.html) ? root.FPBouilleVignette.html(fb) : "";
      row.innerHTML = '<div class="dif-av">' + tete + '</div><div class="dif-txt"><div class="dif-nom">' + esc(a.n || a.u)
        + '<small>' + esc(nomSalle(p.sa)) + '</small></div><div class="dif-etat">' + etat(p) + '</div></div><div class="dif-btns"></div>';
      var btns = row.querySelector(".dif-btns");
      function bouton(txt, cls, fn) { var b = document.createElement("button"); b.textContent = txt; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); return b; }
      if (p.st === "invitation") {
        if (p.moi === 1) {
          bouton(T("widgets.differeAccepter", "Accepter"), "", function () { opts.envoyer({ a: "daccept", id: p.id }); });
          bouton(T("widgets.differeDecliner", "Décliner"), "sec", function () { opts.envoyer({ a: "ddecline", id: p.id }); });
        } else {
          bouton(T("widgets.differeAnnuler", "Annuler"), "sec", function () { opts.envoyer({ a: "ddecline", id: p.id }); });
        }
      } else if (p.st === "en_cours") {
        bouton(p.tour === p.moi ? T("widgets.differeJouer", "Jouer") : T("widgets.differeVoir", "Voir"), "", function () { opts.ouvrir(p.id, p); });
        bouton(T("widgets.differeAbandonner", "Abandonner"), "danger", function () {
          if (window.confirm(T("widgets.differeConfirmerAbandon", "Abandonner cette partie contre {nom} ? {nom} l’emporte.", { nom: a.n || a.u }))) opts.envoyer({ a: "dpart", id: p.id });
        });
      } else {
        bouton(T("widgets.differeRevoir", "Revoir"), "sec", function () { opts.ouvrir(p.id, p); });
      }
      if (root.FPBouilleVignette && root.FPBouilleVignette.brancher) root.FPBouilleVignette.brancher(row);
      return row;
    }

    ui.rendre = function () {
      var salle = opts.salle ? opts.salle() : null;
      var liste = ui.parties.filter(function (p) { return !salle || p.sa === salle; });
      box.innerHTML = "";
      var intro = document.createElement("p"); intro.className = "dif-intro";
      intro.innerHTML = T("widgets.differeIntro", "Une partie <b>en différé</b> se joue à son rythme : chacun joue son coup quand il passe, et dispose de "
        + "<b>{delai} par coup</b>. Passé ce délai, la partie est perdue. Tu es prévenu dans l’appli (et sur ton téléphone) quand c’est à toi.", { delai: fmtDelai(ui.delai) })
        + (salle === "champ" ? " " + T("widgets.differeIntroChamp", "Au championnat, ta note bouge comme en direct.") : "");
      box.appendChild(intro);

      // Inviter
      var inv = document.createElement("div"); inv.className = "dif-inviter";
      var plein = ui.enCours() >= ui.max;
      inv.innerHTML = '<input type="text" list="dif-pseudos" placeholder="' + esc(T("widgets.differePseudoAInviter", "Pseudo du joueur à inviter")) + '" maxlength="20" autocomplete="off"><datalist id="dif-pseudos"></datalist>'
        + (salle ? "" : '<select><option value="amical">' + esc(nomSalle("amical")) + '</option><option value="champ">' + esc(nomSalle("champ")) + "</option></select>")
        + '<button type="button"' + (plein ? " disabled" : "") + ">" + esc(T("widgets.differeInviter", "Inviter")) + "</button><div class=\"dif-err\">"
        + (plein ? esc(T("widgets.differeTropDeParties", "Tu as déjà {max} parties en cours : termine-en une d’abord.", { max: ui.max })) : "") + "</div>";
      var input = inv.querySelector("input"), sel = inv.querySelector("select"), err = inv.querySelector(".dif-err"), dl = inv.querySelector("datalist");
      var minuteur = null;
      input.addEventListener("input", function () {
        clearTimeout(minuteur);
        var q = input.value.trim();
        if (q.length < 2) return;
        minuteur = setTimeout(function () {
          fetch("/api/light/pseudos?q=" + encodeURIComponent(q) + "&sid=" + encodeURIComponent(opts.sid || ""), { cache: "no-store" }).then(function (r) { return r.json(); })
            .then(function (d) { dl.innerHTML = ((d && d.pseudos) || []).map(function (n) { return "<option value=\"" + esc(n) + "\">"; }).join(""); })
            .catch(function () {});
        }, 250);
      });
      function inviter() {
        var u = input.value.trim();
        if (!u) { input.focus(); return; }
        if (same(u, opts.moi())) { err.textContent = T("widgets.differePasToiMeme", "Tu ne peux pas t’inviter toi-même."); return; }
        err.textContent = "";
        opts.envoyer({ a: "dinvite", u: u.toLowerCase(), sa: salle || sel.value });
        input.value = "";
      }
      inv.querySelector("button").onclick = inviter;
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") inviter(); });
      box.appendChild(inv);
      // Le serveur envoie un CODE : le texte se choisit ici, dans la langue du joueur.
      ui.erreur = function (m) {
        var textes = {
          "unknown-player": T("widgets.differeErrInconnu", "Ce pseudo n’existe pas."),
          "already-playing": T("widgets.differeErrDejaEnsemble", "Vous avez déjà une partie en cours ensemble dans cette salle."),
          "too-many-games": T("widgets.differeErrTropDeParties", "Tu as trop de parties en cours."),
          "target-busy": T("widgets.differeErrJoueurOccupe", "Ce joueur a déjà trop de parties en cours."),
          "self-challenge": T("widgets.differePasToiMeme", "Tu ne peux pas t’inviter toi-même."),
          "bad-room": T("widgets.differeErrPasAuChallenge", "Pas de différé au Challenge."),
        };
        err.textContent = textes[m] || ("⚠ " + m);
      };

      // Les sections : [identifiant, titre affiché, parties]. On compare
      // l'identifiant, jamais le titre, qui change avec la langue.
      var sections = [
        ["atoi", T("widgets.differeSectionATonTour", "À toi de jouer"), liste.filter(function (p) { return aMoiDeJouer(p); })],
        ["attente", T("widgets.differeSectionAttente", "En attente de l’adversaire"), liste.filter(function (p) { return p.st !== "finie" && !aMoiDeJouer(p); })],
        ["finies", T("widgets.differeSectionTerminees", "Terminées"), liste.filter(function (p) { return p.st === "finie"; })],
      ];
      sections.forEach(function (s) {
        if (!s[2].length && s[0] === "finies") return;
        var h = document.createElement("h4"); h.textContent = s[1]; box.appendChild(h);
        if (!s[2].length) {
          var v = document.createElement("div"); v.className = "dif-vide";
          v.textContent = s[0] === "atoi" ? T("widgets.differeRienAJouer", "Rien à jouer pour l’instant.") : T("widgets.differeAucuneEnAttente", "Aucune partie en attente. Invite quelqu’un !");
          box.appendChild(v); return;
        }
        s[2].forEach(function (p) { box.appendChild(ligne(p)); });
      });
    };

    // Les durées affichées vieillissent : on redessine chaque minute.
    ui.minuteur = setInterval(function () { if (box.isConnected && box.offsetParent !== null) ui.rendre(); }, 60000);
    ui.rendre();
    return ui;
  }

  // La partie qu'une notification demande d'ouvrir : laissée par le light en
  // mémoire locale (le cadre n'était pas chargé) ou soufflée par message (il
  // l'était). `ouvrir(id)` est appelé une fois, et la trace effacée.
  function ecouterOuverture(jeu, ouvrir) {
    try {
      var brut = localStorage.getItem("fp_differe_ouvrir");
      if (brut) {
        var d = JSON.parse(brut);
        if (d && d.jeu === jeu && d.id && Date.now() - (d.at || 0) < 15 * 60000) {
          localStorage.removeItem("fp_differe_ouvrir");
          setTimeout(function () { ouvrir(d.id); }, 50);
        } else if (d && d.jeu === jeu) localStorage.removeItem("fp_differe_ouvrir");
      }
    } catch (e) { /* stockage fermé */ }
    window.addEventListener("message", function (e) {
      if (e.origin !== window.location.origin) return;
      var d = e.data;
      if (d && d.differe && d.jeu === jeu) {
        try { localStorage.removeItem("fp_differe_ouvrir"); } catch (err) { /* rien */ }
        ouvrir(String(d.differe));
      }
    });
  }

  root.DiffereUI = { creer: creer, fmtDelai: fmtDelai, ecouterOuverture: ecouterOuverture, SALLES: SALLES, nomSalle: nomSalle };
})(typeof self !== "undefined" ? self : this);
