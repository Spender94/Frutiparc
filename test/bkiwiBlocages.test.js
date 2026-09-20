/*
 * BURNING KIWI — CE QUI FIGEAIT LE JEU, ET LA BARRE DE VITESSE MORTE.
 *
 * « On ne peut pas revenir au menu principal après avoir fini une course. Les
 *   joueurs sont obligés d'éjecter le FD du lecteur et relancer une partie. »
 * « Un joueur régulier a l'impression qu'il est plus difficile de faire un
 *   départ parfait sur la version light. »
 *
 * ── 1. UNE REQUÊTE QUI NE REVIENT PAS ─────────────────────────────────────
 * Le jeu attend le réseau à cinq endroits, chaque fois en boucle sur un
 * drapeau, voyant « réseau » à l'écran. Le premier écran qui suit l'arrivée
 * d'une course, c'est justement celui-là : la phase 40 de la fin enregistre le
 * score et la phase 41 attend `fl_success`.
 *
 * Or `fetch` N'A PAS DE DÉLAI. Une connexion qui part et ne revient jamais —
 * un téléphone qui change d'antenne, un proxy qui avale la requête — laisse la
 * promesse en suspens POUR TOUJOURS : le jeu reste sur son voyant, aucune
 * touche n'en sort, il n'y a plus qu'à éjecter le disque.
 *
 * Mesuré au navigateur, /api/saveScore retenu sans réponse :
 *     avant : bloqué en phase finale, quarante clics et trente-cinq secondes
 *             plus tard toujours rien ;
 *     après : retour au menu principal en 12,7 s (le délai, puis les écrans).
 *
 * ── 2. ET SI LE JEU S'ARRÊTE QUAND MÊME ───────────────────────────────────
 * `J.fatal` arrête le clip principal : sa boucle ne rappelle plus `main()`,
 * plus rien ne tourne. C'est ce que fait le fichier — tenable en 2004, où la
 * plateforme des Fruits Défendus, AUTOUR du jeu, montrait l'erreur et
 * refermait le disque. Ici il n'y a rien autour : image morte, pas un mot.
 * On garde l'arrêt, mais on dit ce qui s'est passé et on rouvre d'un clic.
 *
 * De même, une exception dans un script d'image tuait la boucle d'images du
 * lecteur (le `requestAnimationFrame` suivant n'était jamais demandé) : une
 * seule faute, et tout le jeu était perdu. La boucle survit maintenant.
 *
 * Et l'échec de connexion au menu (phase 121) posait `menuPhase = -1` en
 * comptant sur la plateforme pour la suite : un fond de menu vide et muet,
 * sans un bouton. On réessaie, puis on entre en mode hors ligne — la
 * fruticard n'étant pas lue, `charge` reste faux et aucune case n'est écrite.
 *
 * ── 3. LA BARRE DE VITESSE ────────────────────────────────────────────────
 * `_width` redimensionnait EN RELATIF : « multiplie l'échelle par le rapport
 * des largeurs ». Cela a un point mort — à zéro, l'échelle est à zéro, et
 * zéro fois quoi que ce soit fait zéro. Or `resetGame` met la jauge de
 * vitesse (un masque) à `_width = 0` au départ de CHAQUE course. Elle ne
 * repoussait donc jamais : aucune barre, ni au décompte ni en course.
 *
 * C'est sur cette barre que se cale le super départ — il faut lâcher
 * l'accélérateur pile à la vitesse optimale (8, à ±1 près : gameData.as).
 * Sans elle, on part à l'aveugle. Vérifié image contre image avec le SWF sous
 * Ruffle : la barre se remplit maintenant du même nombre de crans.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PLATEFORME = lire('public/bkiwi/plateforme.js');
const MENU = lire('public/bkiwi/jeu/menu.js');
const MOTEUR = lire('public/bkiwi/jeu/moteur.js');
const FLASH = lire('public/kaluga/moteur/flash.js');

/* ── 1. AUCUNE REQUÊTE NE PEUT FIGER LE JEU ──────────────────────────────── */

// La plateforme seule, hors navigateur : `requete` n'a besoin que de fetch.
function plateforme() {
  const bac = {
    window: undefined, console, fetch, AbortController, URLSearchParams, JSON, Math, Number, Object, Promise, Error,
    setTimeout, clearTimeout, document: undefined,
  };
  bac.globalThis = bac;
  bac.BkiwiJeu = {};
  vm.createContext(bac);
  vm.runInContext(PLATEFORME, bac, { filename: 'plateforme.js' });
  return bac.BkiwiJeu;
}

let srv, base, pendues = 0;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/pendue') { pendues++; return; }      // jamais de réponse
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok=1');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
after(() => { if (srv) srv.close(); });

test('une requête qui ne revient pas finit par être abandonnée', async () => {
  const J = plateforme();
  assert.strictEqual(typeof J.requete, 'function', 'la plateforme expose son garde-fou');
  const t0 = Date.now();
  await assert.rejects(() => J.requete(base + '/pendue', {}, 250), /délai dépassé/);
  const dt = Date.now() - t0;
  assert.ok(dt >= 200 && dt < 3000, 'abandonnée au bout du délai : ' + dt + ' ms');
  assert.strictEqual(pendues, 1, 'la requête est bien partie');
});

test('une requête qui répond n’est pas gênée', async () => {
  const J = plateforme();
  const r = await J.requete(base + '/ok', {}, 2000);
  assert.strictEqual(await r.text(), 'ok=1');
});

test('le délai par défaut est court mais pas nerveux', () => {
  const m = /const DELAI_RESEAU = (\d+)/.exec(PLATEFORME);
  assert.ok(m, 'le délai est déclaré');
  const ms = Number(m[1]);
  assert.ok(ms >= 4000 && ms <= 20000, 'un délai raisonnable : ' + ms + ' ms');
});

test('TOUTES les requêtes du jeu passent par le garde-fou', () => {
  // C'est le point : il suffit d'UNE requête nue pour que le jeu puisse se
  // figer, et c'est celle-là que personne ne verra.
  const nues = PLATEFORME.split('\n')
    .map((l, i) => ({ l, i: i + 1 }))
    .filter((x) => /(^|[^.\w])fetch\(/.test(x.l) && !/return fetch\(url, opts\)|return fetch\(url, options\)/.test(x.l));
  assert.deepStrictEqual(nues.map((x) => x.i + ': ' + x.l.trim()), [],
    'ces lignes appellent fetch sans délai');
  // Et les neuf appels du client sont bien là.
  assert.ok(PLATEFORME.match(/requete\(/g).length >= 10, 'les requêtes du client passent par requete()');
});

/* ── 2. LES CULS-DE-SAC ──────────────────────────────────────────────────── */

test('une erreur fatale se montre et rouvre le jeu', () => {
  assert.match(MOTEUR, /J\.montrerPanneEtRelancer/, 'le jeu prévient la page');
  assert.match(PLATEFORME, /J\.montrerPanneEtRelancer = function/, 'la page sait poser le panneau');
  const bloc = /J\.montrerPanneEtRelancer = function[\s\S]*?\n\};/.exec(PLATEFORME)[0];
  assert.match(bloc, /location\.reload/, 'et le clic relance le jeu');
  assert.match(bloc, /Relancer le jeu/, 'avec un bouton qui le dit');
  // L'arrêt du clip reste : le jeu est dans un état où l'on n'écrit plus rien.
  assert.match(MOTEUR, /M\.stop\(\);\n\s*M\.fatalError = msgUser;/);
});

test('un échec de connexion mène au menu hors ligne, jamais à un écran mort', () => {
  const bloc = MENU.slice(MENU.indexOf('case 121:'), MENU.indexOf('case 122:'));
  assert.ok(bloc.indexOf('M.vs.menuPhase = -1') < 0,
    'la phase -1 sans bouton, c’est l’écran mort — elle ne doit plus être là');
  assert.match(bloc, /M\.reconnexionFaite/, 'on réessaie une fois');
  assert.match(bloc, /client\(\)\.serviceConnect\(\)/, 'et la seconde tentative part');
  assert.match(bloc, /J\.report\(/, 'puis on entre quand même, en le disant');
  assert.match(bloc, /J\.readFrutiCard\(\);[\s\S]*M\.vs\.menuPhase\+\+;/, 'et la phase avance vers le menu');
  // Le garde-fou de l'écriture : sans fruticard lue, aucune case n'est écrite.
  assert.match(PLATEFORME, /if \(!this\.sid \|\| !this\.charge\) return Promise\.resolve\(false\);/);
});

test('une exception dans un script ne tue plus la boucle d’images', () => {
  const bloc = /demarrer\(\) \{[\s\S]*?\n  \}/.exec(FLASH)[0];
  // La demande de l'image suivante est faite AVANT le pas : quoi qu'il arrive
  // ensuite, il y aura une image de plus.
  const iRaf = bloc.indexOf('this.rafId = requestAnimationFrame(boucle);');
  const iTick = bloc.indexOf('this.tick()');
  assert.ok(iRaf > 0 && iTick > iRaf, 'l’image suivante est demandée avant le pas');
  assert.match(bloc, /try \{ this\.tick\(\); \} catch/, 'le pas est isolé');
  assert.match(bloc, /try \{ this\.rendre\(\); \} catch/, 'le tracé aussi');
  assert.match(FLASH, /signalerPanne\(ou, e\) \{/, 'et la faute est dite une fois');
});

/* ── 3. LA BARRE DE VITESSE : `_width` REPART DE ZÉRO ────────────────────── */

globalThis.window = undefined;
require(path.join(ROOT, 'public/kaluga/moteur/formes.js'));
require(path.join(ROOT, 'public/kaluga/moteur/flash.js'));
const K = globalThis.KalugaMoteur;

// Un clip nu, avec le cadre qu'on lui donne : c'est tout ce que `_width`
// regarde.
function clip(cadre) {
  const c = new K.Clip(null, null);
  c.cadreLocal = () => cadre.slice();
  return c;
}

test('un clip remis à zéro peut repousser — la jauge de vitesse en dépend', () => {
  // Exactement le cas du jeu : maskSpeedBar, cadre local [0, -11.4, 100, 11.4],
  // que `resetGame` met à zéro puis que `mainGame` fait grandir.
  const m = clip([0, -11.4, 100, 11.4]);
  assert.strictEqual(m._width, 100, 'largeur naturelle');
  m._width = 0;
  assert.strictEqual(m._width, 0, 'remise à zéro au départ de la course');
  m._width = 47.5;                                  // vitesse à la moitié
  assert.ok(Math.abs(m._width - 47.5) < 1e-9, 'elle repousse : ' + m._width);
  assert.ok(Math.abs(m._xscale - 47.5) < 1e-9, 'échelle 47,5 % : ' + m._xscale);
  m._width = 95;
  assert.ok(Math.abs(m._width - 95) < 1e-9, 'et jusqu’au bout : ' + m._width);
});

test('la hauteur aussi', () => {
  const m = clip([-10, 0, 10, 40]);
  assert.strictEqual(m._height, 40);
  m._height = 0;
  m._height = 30;
  assert.ok(Math.abs(m._height - 30) < 1e-9, m._height);
  assert.ok(Math.abs(m._xscale - 100) < 1e-9, 'la largeur n’a pas bougé');
});

test('un redimensionnement ordinaire donne le même résultat qu’avant', () => {
  // Le calcul relatif d'avant et le calcul par la taille naturelle coïncident
  // partout où l'ancien fonctionnait : c'est ce qui rend le changement sûr.
  for (const [cadre, depart, cible] of [
    [[0, 0, 200, 50], 100, 350], [[-30, -30, 30, 30], 250, 12],
    [[0, -5, 12.5, 5], 100, 100], [[0, 0, 640, 480], 40, 1000],
  ]) {
    const a = clip(cadre); a._xscale = depart;
    const relatif = a._xscale * cible / a._width;    // l'ancienne formule
    a._width = cible;
    assert.ok(Math.abs(a._xscale - relatif) < 1e-9, cadre + ' : ' + a._xscale + ' vs ' + relatif);
    assert.ok(Math.abs(a._width - cible) < 1e-9, 'et la largeur demandée est atteinte');
  }
});

test('un clip sans cadre ne bouge pas, et un clip tourné garde l’ancien calcul', () => {
  const vide = new K.Clip(null, null);
  vide.cadreLocal = () => null;
  vide._width = 50;
  assert.strictEqual(vide._xscale, 100, 'rien à redimensionner');
  // Un clip TOURNÉ garde le calcul relatif d'avant — et ce calcul n'atteint
  // pas la largeur demandée (il ne touche que `_xscale`, or la boîte d'un
  // clip tourné dépend aussi de sa hauteur). C'est le comportement d'avant,
  // que rien dans nos jeux n'exerce : on vérifie qu'il n'a pas changé.
  const tourne = clip([0, 0, 100, 10]);
  tourne._rotation = 30;
  const avant = tourne._width;
  tourne._width = avant * 2;
  assert.ok(Math.abs(tourne._xscale - 200) < 1e-6, 'échelle doublée, comme avant : ' + tourne._xscale);
  assert.ok(tourne._width > avant, 'et le clip a bien grandi');
});

/* ── 4. LE COMPTEUR DE PARTIES ───────────────────────────────────────────── */

test('la page du jeu porte le bandeau des parties restantes', () => {
  const page = lire('public/bkiwi/index.html');
  assert.match(page, /<script src="\/js\/fd-badge\.js" data-jeu="bkiwi"><\/script>/);
  // Le bandeau ne parle que des jeux rationnés : bkiwi en est un.
  assert.match(lire('server.js'), /const FD_LIMITED_GAMES = new Set\(\[[^\]]*'bkiwi'/);
  // …et il ne prend jamais le clic : le jeu passe dessous.
  assert.match(lire('public/js/fd-badge.js'), /pointer-events:none/);
});
