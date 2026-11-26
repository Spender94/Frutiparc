/*
 * L'ATELIER DES BOUILLES — une page de rendu, servie à Playwright, qui fait
 * tourner LE MOTEUR JS DU SITE (public/js/bouille-*.js) sur un grand canevas.
 *
 * On n'ajoute aucune page au site : la page est injectée par `page.route` sous
 * une adresse du serveur local (`/__kit/atelier.html`), et charge les scripts
 * du parc tels quels — bouille-swf, -avm, -moteur, -variante, -vignette. La
 * famille passe par `FPBouilleVignette.famille()`, LE point de passage du site
 * (variantes d'accessoires, prunelles et maquillage greffés), et les émotes
 * empruntées (jutsu, toux, gum d'hiko) par `public/fbouille/emotes.json`,
 * greffé comme le fait `FPBouilleVignette.jouer`.
 *
 * C'est le mode « planche » de /bouille-js.html (cf. public/frutiz/BOUILLES.md)
 * poussé jusqu'à la vidéo : le tirage au sort du moteur est calé (`alea`), et
 * l'on avance le moteur d'un nombre de battements choisi — à la cadence du
 * parc, 24 battements par seconde (CADENCE_PARC) — au lieu de photographier une
 * boucle vivante. Une émote rendue deux fois donne deux fois les mêmes images.
 */
'use strict';

const HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>atelier</title>
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
canvas{display:block}</style></head>
<body>
<script src="/js/bouille-palette.js"></script>
<script src="/js/bouille-swf.js"></script>
<script src="/js/bouille-avm.js"></script>
<script src="/js/bouille-moteur.js"></script>
<script src="/js/bouille-variante.js"></script>
<script src="/js/bouille-vignette.js"></script>
<script>
(function () {
  'use strict';
  var M = window.FPBouilleMoteur, V = window.FPBouilleVignette;
  var CADENCE = M.CADENCE_PARC || 24;
  var emotes = null;
  var kit = window.kit = {
    b: null, canvas: null, ticks: 0, fin: false, finTick: -1,

    /* Charge la famille (avec ses greffes) et le paquet des émotes. */
    preparer: function (etat) {
      return Promise.all([
        V.famille(M.familleDe(etat)),
        emotes || fetch('/fbouille/emotes.json').then(function (r) { return r.ok ? r.json() : null; }),
        M.prechargerSixSept ? M.prechargerSixSept() : null,
      ]).then(function (r) { emotes = r[1]; kit.defs = r[0]; return true; });
    },

    /* Monte une bouille sur un canevas carré de \`px\` pixels. */
    monter: function (etat, px, marge, fond) {
      if (kit.canvas) kit.canvas.remove();
      var c = document.createElement('canvas');
      c.width = px; c.height = px;
      c.style.width = px + 'px'; c.style.height = px + 'px';
      document.body.appendChild(c);
      kit.canvas = c;
      kit.b = new M.Bouille(c, kit.defs, { etat: etat, anime: false, super: 2, marge: marge || 0,
        fond: fond || null, alea: function () { return 0.5; } });
      if (emotes) kit.b.moteur.greffer(emotes);
      kit.ticks = 0; kit.fin = false; kit.finTick = -1;
      kit.b.rendre();
      return true;
    },

    /* Change d'état sans remonter (même famille) : c'est ce que fait l'éditeur. */
    definir: function (etat, humeur) {
      kit.b.moteur.definir(etat);
      kit.b.moteur.humeur(humeur || 0);
      kit.b.rendre();
      return true;
    },

    humeur: function (n) { kit.b.moteur.humeur(n); kit.b.rendre(); return true; },

    /* Lance l'animation n ; la fin est notée au retour au repos. */
    animer: function (n) {
      var mo = kit.b.moteur;
      mo.surFinAnim = null;
      mo.jouerAnim(0);
      mo.surFinAnim = function () { if (!kit.fin) { kit.fin = true; kit.finTick = kit.ticks; } };
      mo.action(n);
      return true;
    },
    arreter: function () { kit.b.moteur.jouerAnim(0); return true; },

    /* Avance jusqu'au battement \`cible\` ; rend vrai si quelque chose a bougé. */
    avancerA: function (cible) {
      var bouge = false;
      while (kit.ticks < cible) { kit.ticks++; if (kit.b.moteur.avancer()) bouge = true; }
      if (bouge) kit.b.rendre();
      return bouge;
    },

    png: function () { return kit.canvas.toDataURL('image/png').slice(22); },
    CADENCE: CADENCE,
    NOMS_HUMEURS: M.NOMS_HUMEURS, NOMS_ANIMATIONS: M.NOMS_ANIMATIONS,
  };
  document.body.setAttribute('data-prete', '1');
})();
</script>
</body></html>`;

/** Branche la page de l'atelier sur `base + /__kit/atelier.html`. */
async function ouvrirAtelier(contexte, base, taille) {
  const page = await contexte.newPage();
  await page.setViewportSize({ width: taille || 1024, height: taille || 1024 });
  await page.route(base + '/__kit/atelier.html', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto(base + '/__kit/atelier.html');
  await page.waitForFunction(() => document.body.getAttribute('data-prete') === '1');
  return page;
}

module.exports = { ouvrirAtelier, HTML };
