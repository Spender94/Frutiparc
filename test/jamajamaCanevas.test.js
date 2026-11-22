'use strict';
/*
 * JAMAJAMA — DES « TROUS » DANS L'EAU.
 *
 * Retour du testeur : quand plusieurs blocs d'eau se touchent, l'affichage
 * montre parfois comme des trous. Le plateau est une mosaïque : chaque case
 * d'eau (de mur, de bord, de pont) est un dessin à part, posé bord à bord
 * contre ses voisines. Le canevas se peignait à l'échelle de la page
 * (K·dpr, 2,37 par exemple) : la frontière de deux cases tombait au milieu
 * d'un pixel, chacune le couvrait à moitié, et l'anticrénelage, composant
 * l'une sur l'autre, laissait transparaître le fond — un quadrillage de
 * fines lignes, plus ou moins visible selon la taille de la fenêtre. Le jeu
 * d'origine (vérifié sous Ruffle, à la même échelle) n'en montre aucun.
 *
 * Le canevas se peint désormais à l'échelle ENTIÈRE supérieure ; la page
 * réduit l'image d'un bloc.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'public/jamajama/jeu.js'), 'utf8');

test('jeu.js : le canevas se peint à une échelle entière, au moins celle de la page', () => {
  const m = SRC.match(/function echelleDuCanevas\(k, dpr\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, 'la fonction echelleDuCanevas existe');
  const echelle = new Function('k', 'dpr', m[1]);
  for (const [k, dpr, attendu] of [[1, 1, 1], [2, 1, 2], [2.37, 1, 3], [1.171875, 2, 3], [0.6, 1, 1], [1.5, 1.5, 3]]) {
    const e = echelle(k, dpr);
    assert.strictEqual(e, attendu, `K=${k}, dpr=${dpr}`);
    assert.ok(Number.isInteger(e) && e >= k * dpr - 1e-9);
  }
  // Le canevas a la taille de cette échelle, et la transformation la suit.
  assert.match(SRC, /canvas\.width = Consts\.WIDTH \* E;/);
  assert.match(SRC, /canvas\.height = Consts\.HEIGHT \* E;/);
  assert.doesNotMatch(SRC, /setTransform\(K \*/, 'plus de transformation à l’échelle fractionnaire');
  assert.strictEqual((SRC.match(/ctx\.setTransform\(E, 0, 0, E, 0, 0\);/g) || []).length, 2);
});

// ── Dans un vrai navigateur : le quadrillage, et sa disparition ──
function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}

test('navigateur : un bloc d’eau 3×3 sans quadrillage à l’échelle entière', async (t) => {
  const c = chromium();
  if (!c) return t.skip('Playwright absent');
  let navigateur;
  try { navigateur = await c.launch(); } catch (e) { return t.skip('Chromium absent'); }
  try {
    const page = await navigateur.newPage();
    const types = { '.js': 'application/javascript', '.json': 'application/json', '.woff': 'font/woff', '.html': 'text/html' };
    await page.route('http://jama.test/**', (route) => {
      const u = new URL(route.request().url());
      const f = path.join(RACINE, 'public', decodeURIComponent(u.pathname));
      if (!f.startsWith(path.join(RACINE, 'public')) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
    });
    await page.route('http://jama.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('http://jama.test/');
    for (const f of ['regles.js', 'rendu.js', 'vue.js']) await page.addScriptTag({ url: '/jamajama/' + f });
    const mesure = await page.evaluate(async () => {
      await window.JamaRendu.charger('/jamajama/');
      const Rg = window.JamaRegles;
      const l = new Rg.Level();
      l.size = new Rg.Dimension(5, 5);
      l.startPos = new Rg.Coord(0, 0);
      const poser = (id, x, y, param) => {
        const e = new Rg.Element(null);
        e.id = id; e.pos = new Rg.Coord(x, y); e.param = param == null ? -1 : param;
        l.tiles.push(e);
      };
      poser(Rg.Element.FRUIT, 4, 4, 1);
      for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) poser(Rg.Element.WATER, x, y);
      const vue = new window.JamaVue.VueJeu(new Rg.Partie(l), { showBeginFade: false, showVictoFade: false });
      const K = 2.37;
      const peindre = (entier) => {
        const c = document.createElement('canvas');
        c.width = Math.round(384 * K); c.height = Math.round(384 * K);
        const ctx = c.getContext('2d');
        if (!entier) {
          ctx.setTransform(K, 0, 0, K, 0, 0);
          vue.dessiner(ctx);
        } else {
          // Ce que fait jeu.js : peindre à l'échelle entière, puis réduire.
          const S = Math.ceil(K);
          const o = document.createElement('canvas');
          o.width = 384 * S; o.height = 384 * S;
          const octx = o.getContext('2d');
          octx.setTransform(S, 0, 0, S, 0, 0);
          vue.dessiner(octx);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(o, 0, 0, c.width, c.height);
        }
        return ctx;
      };
      // Une ligne horizontale au milieu du bloc, de la case (1,2) à (3,2) :
      // l'eau y est d'une seule couleur ; un pixel qui s'en écarte nettement
      // est un joint qui laisse voir le fond.
      const ecarts = (ctx) => {
        const pad = (384 - 5 * 32) / 2;
        const y = Math.round((pad + 2 * 32 + 20) * K);
        const x0 = Math.round((pad + 32 + 6) * K), x1 = Math.round((pad + 4 * 32 - 6) * K);
        const d = ctx.getImageData(x0, y, x1 - x0, 1).data;
        const ref = [d[0], d[1], d[2]];
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > 12) n += 1;
        }
        return n;
      };
      return { fractionnaire: ecarts(peindre(false)), entier: ecarts(peindre(true)) };
    });
    // Le constat (il dépend du moteur de rendu, d'où la seule exigence d'un
    // joint au moins), puis la correction.
    assert.ok(mesure.fractionnaire > 0, 'à 2,37, les joints entre cases se voient : ' + JSON.stringify(mesure));
    assert.strictEqual(mesure.entier, 0, 'à l’échelle entière, plus aucun : ' + JSON.stringify(mesure));
  } finally {
    await navigateur.close();
  }
});
