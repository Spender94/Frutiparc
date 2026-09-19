/*
 * KALUGA — LES POMMES FANTÔMES, ET CE QUI LES FAISAIT.
 *
 * « Des joueurs me disent qu'il y a des bugs, cf le bug des pommes
 *   fantômes. » — une capture où toutes les pommes du sol sont BLANCHES :
 * il ne reste d'elles que leur reflet et leur queue.
 *
 * ── LA CAUSE ──────────────────────────────────────────────────────────────
 * Les aplats du SWF sont rangés en IMAGES, et le corps d'une pomme est un
 * remplissage par bitmap (`kaluga-136.svg`). Quand l'image manque,
 * `dessinerDessin` saute le remplissage — c'est la bonne conduite, on ne va
 * pas peindre au hasard. Mais rien ne pouvait plus la ramener :
 *
 *     img.onerror = () => ok(null);      // et c'était fini
 *
 * L'identifiant n'entrait jamais dans la table de la bibliothèque, aucun
 * réessai n'était prévu, et pas un mot n'était dit. UNE seule requête perdue
 * au chargement — il y en a cinquante-sept à tirer d'un coup pour Kaluga, et
 * un hoquet de réseau sur un téléphone suffit — et la session entière se
 * jouait avec des pommes fantômes.
 *
 * Reproduit à l'identique au navigateur en coupant cette seule requête : on
 * obtient exactement la capture du joueur.
 *
 * ── LA RÉPONSE ────────────────────────────────────────────────────────────
 * On réessaie : trois fois vite (le chargement attend), puis de loin en loin
 * en arrière-plan. Et comme la table d'images est RELUE À CHAQUE IMAGE par le
 * dessin, une image qui finit par arriver se remet en place toute seule — la
 * pomme redevient rouge en cours de partie, sans rien relancer. Vérifié au
 * navigateur : quatre requêtes coupées, pommes blanches au départ, pommes
 * rouges douze secondes plus tard sans rechargement.
 *
 * Même traitement pour les fontes et pour les bibliothèques elles-mêmes (une
 * bibliothèque perdue, c'est « le jeu n'a pas pu démarrer »). Un 404, lui,
 * n'est pas un hoquet : c'est une vraie absence, et on le dit tout de suite.
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

// Les cadences du chargeur, relues DANS la source : les cas suivent le code,
// ils ne le recopient pas.
const SRC = lire('public/kaluga/moteur/chargeur.js');
const cste = (nom) => {
  const m = new RegExp('const ' + nom + ' = (\\d+)').exec(SRC);
  assert.ok(m, nom + ' doit être déclaré dans chargeur.js');
  return Number(m[1]);
};
const ESSAIS_BLOQUANTS = cste('ESSAIS_BLOQUANTS');
const ESSAIS_MAX = cste('ESSAIS_MAX');
const PAUSES = JSON.parse(/const PAUSES = (\[[^\]]*\])/.exec(SRC)[1]);

/*
 * UN CHARGEUR PAR CAS, avec son propre réseau de poche.
 *
 *   · `echecs` dit combien de requêtes d'images échouent avant que ça passe ;
 *   · `demandes` garde toutes les adresses réclamées, dans l'ordre ;
 *   · LE TEMPS EST COMPRIMÉ : les pauses du rattrapage vont jusqu'à trente
 *     secondes, et l'on ne va pas faire attendre la suite de cas une minute
 *     pour prouver une insistance. L'enchaînement, lui, est intact — et c'est
 *     lui qu'on vérifie, en comptant les requêtes et non les secondes.
 */
const PAS_DE_TEMPS = 4;                    // millisecondes par pause, au plus
function chargeur(echecs) {
  const etat = { echecs: echecs || 0, demandes: [] };
  const bac = {
    window: undefined, console: { warn: () => {}, error: () => {}, log: () => {} },
    fetch, TextDecoder, Uint8Array, Promise, Error, Number, Math, Object, JSON,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, Math.min(ms, PAS_DE_TEMPS));
      if (t && t.unref) t.unref();           // les rattrapages de fond ne retiennent pas le lanceur
      return t;
    },
    clearTimeout, setInterval, clearInterval,
    addEventListener: () => {},
    document: { fonts: null },
  };
  bac.Image = class {
    set src(v) {
      etat.demandes.push(v);
      const rate = etat.echecs > 0;
      if (rate) etat.echecs--;
      setTimeout(() => {
        if (rate) { if (this.onerror) this.onerror(); return; }
        this.naturalWidth = 102; this.complete = true;
        if (this.onload) this.onload();
      }, 1);
    }
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(lire('public/kaluga/moteur/flash.js'), bac, { filename: 'flash.js' });
  vm.runInContext(lire('public/kaluga/moteur/son.js'), bac, { filename: 'son.js' });
  vm.runInContext(lire('public/kaluga/moteur/chargeur.js'), bac, { filename: 'chargeur.js' });
  etat.K = bac.KalugaMoteur;
  return etat;
}
// Laisser passer N pauses du rattrapage de fond.
const souffler = (n) => new Promise((r) => setTimeout(r, (n || 1) * PAS_DE_TEMPS + 60));

/* ── 1. UNE IMAGE QUI N'ARRIVE PAS DU PREMIER COUP ───────────────────────── */

test('une image ratée est redemandée, et elle finit par se poser', async () => {
  const c = chargeur(2);
  const posees = [];
  const img = await c.K.chargerImage('/img/pomme.svg', (i) => posees.push(i));
  assert.ok(img, 'l’image finit par arriver');
  assert.strictEqual(posees.length, 1, 'et elle est posée une fois');
  assert.strictEqual(c.demandes.length, 3, 'trois requêtes : deux ratées, une bonne');
});

test('les redemandes portent une adresse NEUVE', async () => {
  // Sans cela, le navigateur peut resservir l'échec qu'il tient encore.
  const c = chargeur(2);
  await c.K.chargerImage('/img/pomme.svg', () => {});
  assert.strictEqual(c.demandes[0], '/img/pomme.svg', 'la première est l’adresse nue');
  for (let i = 1; i < c.demandes.length; i++) {
    assert.match(c.demandes[i], /[?&]ressai=\d+/, 'redemande ' + i + ' : ' + c.demandes[i]);
  }
  assert.strictEqual(new Set(c.demandes).size, c.demandes.length, 'aucune adresse répétée');
});

test('au-delà des premiers essais, le jeu ne l’attend plus — mais elle arrive quand même', async () => {
  const c = chargeur(ESSAIS_BLOQUANTS);      // un de trop pour la fenêtre bloquante
  const posees = [];
  const rendu = await c.K.chargerImage('/img/tardive.svg', (i) => posees.push(i));
  assert.strictEqual(rendu, null, 'le chargement rend la main sans l’image');
  assert.strictEqual(posees.length, 0, 'rien de posé pour l’instant');
  assert.strictEqual(c.demandes.length, ESSAIS_BLOQUANTS, 'il a bien essayé ' + ESSAIS_BLOQUANTS + ' fois');
  // …et derrière, il continue. C'est ce qui remet la pomme en couleur.
  await souffler(2);
  assert.strictEqual(posees.length, 1, 'elle s’est posée APRÈS coup');
  assert.strictEqual(c.demandes.length, ESSAIS_BLOQUANTS + 1, 'une requête de plus a suffi');
});

test('une image vraiment perdue est abandonnée, jamais retentée sans fin', async () => {
  const c = chargeur(9999);
  await c.K.chargerImage('/img/jamais.svg', () => {});
  assert.strictEqual(c.demandes.length, ESSAIS_BLOQUANTS, 'trois essais avant de rendre la main');
  await souffler(ESSAIS_MAX + 4);
  assert.ok(c.demandes.length > ESSAIS_BLOQUANTS, 'il a insisté derrière : ' + c.demandes.length);
  assert.strictEqual(c.demandes.length, ESSAIS_MAX, 'et s’est arrêté à ' + ESSAIS_MAX);
  // La borne distingue l'insistance de la boucle folle.
  assert.ok(ESSAIS_MAX > ESSAIS_BLOQUANTS && ESSAIS_MAX <= 12, 'borne raisonnable : ' + ESSAIS_MAX);
  // Les pauses s'allongent : on ne martèle pas un serveur en peine.
  for (let i = 1; i < PAUSES.length; i++) assert.ok(PAUSES[i] > PAUSES[i - 1], 'pauses croissantes');
});

/* ── 2. LA TABLE DE LA BIBLIOTHÈQUE EST CELLE QUE LE DESSIN RELIT ────────── */

let srv, base, bafouilles = 0;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/biblio.json') {
      const corps = Buffer.from(JSON.stringify({
        entete: { largeur: 100, hauteur: 100, cadence: 40 },
        perso: {}, symboles: {}, fontes: {},
        images: { 136: { f: 'pomme.svg', l: 102, h: 97 } },
      }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Taille-Reelle': String(corps.length) });
      res.end(corps);
      return;
    }
    if (u.pathname === '/casse') { res.writeHead(503).end('en rade'); return; }
    if (u.pathname === '/bafouille') {
      if (bafouilles > 0) { bafouilles--; req.destroy(); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(120, 67));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port + '/';
});
after(() => { if (srv) srv.close(); });

test('une image en retard se range dans la table que le dessin relit', async () => {
  const c = chargeur(ESSAIS_BLOQUANTS);      // elle manquera au démarrage
  c.K.base = base;
  const b = await c.K.chargerBiblio('../biblio');
  assert.ok(b, 'la bibliothèque est là malgré l’image manquante');
  assert.strictEqual(b.images['136'], undefined, 'et la pomme est fantôme : pas d’image');
  await souffler(2);
  assert.ok(b.images['136'], 'l’image arrivée en retard s’est rangée TOUTE SEULE');
  assert.strictEqual(b.images['136'].naturalWidth, 102);
  // C'est bien LA table de la bibliothèque, pas une copie : sans cela, rien
  // de ce qui arrive en retard ne serait jamais dessiné.
  assert.ok(Object.prototype.hasOwnProperty.call(b, 'images'));
});

test('le jeu n’attend pas une image pour démarrer', async () => {
  const c = chargeur(9999);
  c.K.base = base;
  const b = await c.K.chargerBiblio('../biblio');
  assert.ok(b, 'démarré sans elle');
  assert.strictEqual(b.images['136'], undefined);
  assert.strictEqual(c.demandes.length, ESSAIS_BLOQUANTS, 'il n’a attendu que la fenêtre bloquante');
});

/* ── 3. LA BIBLIOTHÈQUE ELLE-MÊME ────────────────────────────────────────── */

test('un serveur qui bafouille est réessayé, et le fichier finit par arriver', async () => {
  const c = chargeur(0);
  bafouilles = 2;
  const buf = await c.K.telecharger(base + 'bafouille', null);
  assert.ok(buf && buf.byteLength === 120, 'le fichier arrive au troisième essai');
  assert.strictEqual(bafouilles, 0, 'les deux coupures ont bien été consommées');
});

test('un 404 n’est pas un hoquet : on le dit tout de suite, sans réessayer', async () => {
  const c = chargeur(0);
  let coups = 0;
  const vrai = c.K.telecharger;
  c.K.telecharger = function (...a) { coups++; return vrai.apply(this, a); };
  await assert.rejects(() => c.K.telecharger(base + 'absent.json', null), /introuvable/);
  assert.strictEqual(coups, 1, 'une seule tentative pour une vraie absence');
});

test('un 503 passager, lui, est réessayé', async () => {
  const c = chargeur(0);
  let coups = 0;
  const vrai = c.K.telecharger;
  c.K.telecharger = function (...a) { coups++; return vrai.apply(this, a); };
  await assert.rejects(() => c.K.telecharger(base + 'casse', null), /HTTP 503|introuvable/);
  assert.strictEqual(coups, ESSAIS_BLOQUANTS + 1, 'il a insisté ' + (ESSAIS_BLOQUANTS + 1) + ' fois');
});

test('une bibliothèque ratée ne reste pas en travers', async () => {
  const c = chargeur(0);
  c.K.base = base;
  await assert.rejects(() => c.K.chargerBiblio('../absent'), /introuvable/);
  // Sans le nettoyage, ce second appel rendrait la promesse déjà retombée et
  // le jeu ne repartirait jamais, même réseau revenu.
  await assert.rejects(() => c.K.chargerBiblio('../absent'), /introuvable/);
  const b = await c.K.chargerBiblio('../biblio');
  assert.ok(b, 'et une autre bibliothèque charge encore');
});

/* ── 4. LE DESSIN SAUTE UN REMPLISSAGE DONT L'IMAGE MANQUE ───────────────── */

test('sans image, le remplissage est sauté — d’où le fantôme, et pourquoi il guérit', () => {
  const FORMES = lire('public/kaluga/moteur/formes.js');
  assert.match(FORMES, /const img = images && images\[f\.bm\.id\];/);
  assert.match(FORMES, /if \(!img \|\| !img\.complete \|\| !img\.naturalWidth\) continue;/);
  // C'est bien LA TABLE qui est consultée à chaque tracé, et non une copie
  // prise au chargement : c'est ce qui rend la guérison possible.
  const FLASH = lire('public/kaluga/moteur/flash.js');
  assert.match(FLASH, /this\.images = images \|\| \{\};/);
  assert.match(FLASH, /this\.\$biblio\.images/);
});

test('le corps de la pomme de Kaluga est bien un remplissage par image', () => {
  // La pièce en cause, nommément : si l'extraction changeait de forme, ces
  // cas ne parleraient plus de rien.
  const biblio = JSON.parse(lire('public/kaluga/data/kaluga.json'));
  const fruit = biblio.symboles.spPhysFruit;
  assert.ok(fruit, 'spPhysFruit est dans la bibliothèque');
  const corps = biblio.perso[String(biblio.perso[String(fruit)].frames[0].ops[0].c)];
  assert.ok(corps, 'le corps de la pomme existe');
  const f = corps.ops ? corps.ops[0].f : (biblio.perso[String(corps.frames[0].ops[0].c)].ops[0].f);
  assert.ok(f && f.bm, 'et il se remplit par une image : ' + JSON.stringify(f).slice(0, 80));
  const info = biblio.images[String(f.bm.id)];
  assert.ok(info, 'l’image est déclarée');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/kaluga/data/img', info.f)), info.f + ' est sur le disque');
});
