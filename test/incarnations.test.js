/*
 * LES INCARNATIONS — les bouilles qu'on enfile.
 *
 * DEUX MOTS À NE PAS CONFONDRE. Une INCARNATION est ce que voit le joueur : une
 * bouille qu'il porte à la place de la sienne, et qu'il retire pour se
 * retrouver. Une PRUNELLE est la mécanique des deux premières — une paire
 * d'iris récoltée chez hiko (famille 12) et greffée au bout du rouleau de la
 * famille d'accueil. L'iris est le clip `p` de `oa.o`, que le moteur cale sur
 * `eyeSc`, la valeur des caractères 4 et 5 de la chaîne d'état.
 *
 * Ce fichier tient les cinq promesses de la fonctionnalité :
 *
 *   · LA RÉCOLTE est reproductible et FIGÉE. `prunelles.json` porte l'index
 *     que chaque paire occupera : c'est ce numéro qu'une bouille inscrit dans
 *     son état et que la boutique vend. Il doit vouloir dire la même chose sur
 *     tous les écrans, pour toujours.
 *   · LA GREFFE n'écrase rien. Elle AJOUTE au bout du rouleau de la famille
 *     d'accueil, et se tait quand la famille a déjà un iris à cette place —
 *     sans quoi elle remplacerait un des iris de hiko chez ceux qui le
 *     portent.
 *   · L'ACHAT ne change QUE les yeux. Deux caractères sur vingt-quatre : la
 *     coiffure, les couleurs et l'accessoire restent à leur place.
 *   · ON LA PORTE, ON LA RETIRE. La bouille PRINCIPALE est gardée par le
 *     serveur (`fbouille_base`) : le retour marche encore après une
 *     reconnexion, alors même que ce que le joueur montre est l'incarnation.
 *   · L'INVENTAIRE a un rayon pour elles, des deux côtés — l'onglet du light
 *     et le dossier du bureau —, et elles ne se retrouvent pas parmi les
 *     accessoires. Le forum, lui, a son menu déroulant.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3518;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-incarnations';
const RUN = Date.now().toString(36).slice(-5);
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const PAQUET = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/fbouille/prunelles.json'), 'utf8'));
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

// Les deux articles livrés avec le code, dans leur plage réservée.
const HIKO1 = 600001;
const HIKO2 = 600002;

function lireFamille(n) {
  const b = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille' + n + '.swf'));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5360', FRUTISCORE_PORT: '5361',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le serveur de test n’a pas démarré');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function joueur(nom, etat) {
  const corps = JSON.stringify({ username: nom, password: 'secret123', birthday: '1990-05-15' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body: corps });
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: hdr, body: corps })).json();
  assert.ok(r.sid, 'session ouverte pour ' + nom);
  if (etat) await fetch(BASE + '/do/eb?sid=' + r.sid + '&b=' + encodeURIComponent(etat));
  return r.sid;
}

// ── La récolte ─────────────────────────────────────────────────────────────

test('la récolte porte les quatorze paires, et leur place est FIGÉE', () => {
  // Deux modèles — la fixe et l'animée — et six teintes chacun : les couleurs
  // de pupille que la famille 0 a déjà (le rouge est écarté, il ferait doublon
  // avec celui d'hiko).
  assert.equal(PAQUET.iris.length, 14);
  const parCle = Object.fromEntries(PAQUET.iris.map((i) => [i.cle, i]));
  assert.ok(parCle.hiko1 && parCle.hiko2);
  assert.equal(parCle.hiko1.nom, "Hiko's eyes");
  assert.equal(parCle.hiko2.nom, "Hiko's eyes #2");
  const TEINTES = ['brun', 'bleu', 'cyan', 'vert', 'violet', 'orange'];
  for (const modele of ['hiko1', 'hiko2']) {
    for (const t of TEINTES) {
      const d = parCle[modele + '-' + t];
      assert.ok(d, modele + '-' + t + ' est récoltée');
      assert.ok(d.teinte, 'et elle dit sa couleur');
      assert.ok(d.nom.startsWith(parCle[modele].nom + ' — '), 'nommée d’après son modèle');
    }
  }
  // La famille 0 a dix-huit iris : les deux ORIGINALES prennent 18 et 19, les
  // douze déclinaisons 20 à 31. Ces nombres sont vendus en boutique et inscrits
  // dans des chaînes d'état — les changer, c'est changer les yeux de tous ceux
  // qui les portent.
  assert.equal(parCle.hiko1.index, 18);
  assert.equal(parCle.hiko2.index, 19);
  assert.deepEqual(PAQUET.iris.map((i) => i.index),
    [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
  // Chaque paire porte ses ORDRES DE POSE, jamais de retrait : ce qu'il faut
  // retirer dépend de la famille d'accueil, la greffe le calcule.
  for (const i of PAQUET.iris) {
    assert.ok(i.ordres.length >= 1);
    for (const o of i.ordres) assert.equal(o.t, 'pose');
  }
  // Les caractères sont renumérotés au-delà de la plage d'un SWF : rien ne peut
  // se heurter à ceux de la famille d'accueil.
  const ids = Object.keys(PAQUET.formes).concat(Object.keys(PAQUET.sprites)).map(Number);
  assert.ok(ids.length >= 6, 'cinq formes et un clip au moins');
  for (const id of ids) assert.ok(id >= 300000, 'identifiant décalé : ' + id);
});

test('le disque coloré sort du mouvement — sinon le paquet triple', () => {
  /*
   * L'iris animé est un clip de vingt images : un DISQUE coloré posé une fois,
   * et par-dessus une roue noire qui tourne de 19° par image. Recopier le clip
   * pour chaque teinte coûterait quatre kilo-octets pièce, sur un fichier que
   * TOUTE PAGE affichant une bouille va chercher. On sort donc le disque du
   * clip : le clip ne porte plus que le mouvement, partagé par les sept, et
   * chaque teinte pose SON disque dessous.
   */
  assert.equal(Object.keys(PAQUET.sprites).length, 1, 'un seul clip pour les sept animées');
  const clip = PAQUET.sprites[Object.keys(PAQUET.sprites)[0]];
  assert.equal(clip.n, 20, 'les vingt images de la rotation');
  // Aucune image du clip ne pose de dégradé : la couleur n'y est plus.
  for (const im of clip.images) {
    for (const o of (im || [])) {
      const f = o.ch >= 0 ? PAQUET.formes[o.ch] : null;
      if (f) assert.ok(!(f.couches || []).some((c) => c.degrade),
        'le disque coloré ne doit plus vivre dans le clip');
    }
  }
  // Chaque animée pose son disque SOUS le mouvement, et le reflet par-dessus.
  for (const i of PAQUET.iris.filter((x) => x.cle.startsWith('hiko2'))) {
    const profs = i.ordres.map((o) => o.prof);
    assert.deepEqual(profs, [1, 2, 8], 'disque, mouvement, reflet — dans cet ordre');
    const disque = PAQUET.formes[i.ordres[0].ch];
    assert.ok(disque && (disque.couches || []).some((c) => c.degrade),
      'le premier ordre pose bien un disque à dégradé');
  }
  // Et le paquet reste raisonnable : sept clips auraient coûté le triple.
  const ko = fs.statSync(path.join(ROOT, 'public/fbouille/prunelles.json')).size / 1024;
  assert.ok(ko < 40, 'le paquet pèse ' + ko.toFixed(1) + ' Ko, il doit rester sous 40');
});

test('les teintes sont celles de la famille 0, et le modelé est gardé', () => {
  /*
   * On repeint, on ne teinte pas : le moteur ne pose aucune teinte sur l'iris
   * (`definir` n'en met que sur la peau, la bouche, les cheveux et les
   * accessoires). Chaque couche colorée passe à la couleur cible, réduite du
   * même rapport de clarté qu'elle avait vis-à-vis du rouge d'hiko — le sombre
   * reste sombre, et le noir comme les blancs ne bougent pas.
   */
  const parCle = Object.fromEntries(PAQUET.iris.map((i) => [i.cle, i]));
  const couches = (cle) => {
    const o = parCle[cle].ordres.find((x) => PAQUET.formes[x.ch]
      && (PAQUET.formes[x.ch].couches || []).length);
    return PAQUET.formes[o.ch].couches;
  };
  const rouge = couches('hiko1');
  const cyan = couches('hiko1-cyan');
  assert.equal(rouge.length, cyan.length, 'même nombre de couches');
  const gris = (c) => Math.max(...c.rgb) - Math.min(...c.rgb) <= 24;
  let repeintes = 0;
  rouge.forEach((c, i) => {
    if (!c.rgb) return;
    if (gris(c)) {
      assert.deepEqual(cyan[i].rgb, c.rgb, 'le noir et les blancs ne bougent pas');
    } else {
      assert.notDeepEqual(cyan[i].rgb, c.rgb, 'la couche colorée change');
      // Le cyan de la famille 0, #00ccff : plus de bleu que de rouge.
      assert.ok(cyan[i].rgb[2] > cyan[i].rgb[0], 'et vire au cyan');
      repeintes++;
    }
  });
  assert.equal(repeintes, 1, "« Hiko's eyes » n’a qu’une couche colorée");
  // L'animée, elle, porte sa couleur dans un dégradé à deux arrêts.
  const arrets = couches('hiko2-vert')[0].degrade.arrets;
  assert.equal(arrets.length, 2);
  arrets.forEach((a) => assert.ok(a.rgb[1] > a.rgb[0] && a.rgb[1] > a.rgb[2],
    'les deux arrêts virent au vert : ' + a.couleur));
  assert.ok(arrets[0].rgb[1] > arrets[1].rgb[1], 'et le second reste le plus sombre');
});

test('l’outil de récolte refait le même paquet', () => {
  // On ne relance pas le script (il écrit dans public/) : on vérifie qu'il est
  // là, et que le paquet dit d'où il vient — de quoi refaire la récolte.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/extract-prunelles-bouille.js')));
  assert.equal(PAQUET.source.outil, 'scripts/extract-prunelles-bouille.js');
  assert.match(PAQUET.source.iris, /famille12\.swf/);
  assert.match(PAQUET.source.hote, /famille0\.swf, oa\.o\.p, 18 images/);
  assert.match(PAQUET.source.teintes, /couleurs de pupille de la famille 0/);
});

// ── La greffe ──────────────────────────────────────────────────────────────

test('le rouleau d’iris se retrouve sous oa.o.p, et il est PARTAGÉ', async () => {
  const d0 = await lireFamille(0);
  const r0 = M.rouleauxIris(d0);
  // Neuf formes d'œil, deux yeux — et un seul rouleau : le clip est partagé.
  // Greffer une image le fait donc paraître partout d'un coup.
  assert.equal(r0.length, 1, 'un seul rouleau pour les deux yeux et les neuf formes');
  assert.equal(r0[0].images.length, 18, 'dix-huit iris d’origine');
  const d12 = await lireFamille(12);
  assert.equal(M.rouleauxIris(d12)[0].images.length, 19, 'hiko en a dix-neuf');
});

test('la greffe AJOUTE au bout, sans toucher aux iris d’origine', async () => {
  const defs = await lireFamille(0);
  const r = M.rouleauxIris(defs)[0];
  const avant = r.images.slice(0, 18).map((im) => JSON.stringify(im));
  const table = M.grefferPrunelles(defs, PAQUET);
  assert.equal(table.hiko1, 18);
  assert.equal(table.hiko2, 19);
  assert.equal(Object.keys(table).length, 14, 'les quatorze paires sont greffées');
  assert.equal(r.images.length, 32, 'quatorze images de plus');
  assert.deepEqual(r.images.slice(0, 18).map((im) => JSON.stringify(im)), avant,
    'les dix-huit d’origine sont intactes');
  assert.equal(r.n, 32, 'et le compte du rouleau suit');
  // Les formes et les clips récoltés sont entrés dans les tables.
  for (const id of Object.keys(PAQUET.formes)) assert.ok(defs.formes.has(Number(id)));
  for (const id of Object.keys(PAQUET.sprites)) assert.ok(defs.sprites.has(Number(id)));
  // Idempotente : la même `defs` sert toutes les bouilles d'une page.
  assert.deepEqual(M.grefferPrunelles(defs, PAQUET), table);
  assert.equal(r.images.length, 32, 'une seconde greffe n’ajoute rien');
});

test('la greffe se TAIT là où la famille a déjà un iris', async () => {
  /*
   * Hiko a dix-neuf iris — les places 0 à 18 sont prises, la 19 est libre.
   * Y poser la greffe à la 18 remplacerait un de ses propres iris chez ceux
   * qui portent son incarnation : la règle est donc « on n'ajoute qu'au-delà
   * de ce que la famille a déjà ». La 18 reste à lui ; les treize autres,
   * dont la place est libre chez lui, s'y posent normalement.
   */
  const d12 = await lireFamille(12);
  const r = M.rouleauxIris(d12)[0];
  const avant = r.images.map((im) => JSON.stringify(im));
  M.grefferPrunelles(d12, PAQUET);
  assert.equal(r.images.length, 32, 'jusqu’à la dernière place du paquet');
  assert.deepEqual(r.images.slice(0, 19).map((im) => JSON.stringify(im)), avant,
    'aucun des dix-neuf iris de hiko n’a bougé — la place 18 lui reste');
});

test('une image greffée RETIRE ce que la famille laissait, puis pose', async () => {
  const defs = await lireFamille(0);
  M.grefferPrunelles(defs, PAQUET);
  const r = M.rouleauxIris(defs)[0];
  for (const index of [18, 19]) {
    const ordres = r.images[index];
    assert.ok(ordres.some((o) => o.t === 'retire'),
      'l’image ' + index + ' commence par faire place nette');
    assert.ok(ordres.some((o) => o.t === 'pose' && o.ch >= 300000),
      'puis pose un caractère récolté');
  }
});

// ── La boutique ────────────────────────────────────────────────────────────

test('les incarnations ont leur rayon, et il est PAYANT', async () => {
  const sid = await joueur('prul' + RUN, '000305070b0f0m09020t0a00');
  const s = await (await fetch(BASE + '/api/light/shop?sid=' + sid)).json();
  const rayon = (s.categories || []).find((c) => c.name === 'Incarnations');
  assert.ok(rayon, 'le rayon « Incarnations » existe');
  assert.equal(rayon.items.length, 14, 'les deux originales et leurs six teintes chacune');
  // Une plage RÉSERVÉE : un article créé depuis l'admin prend le numéro qu'on
  // lui donne, et ne doit pas pouvoir se poser sur celui d'une incarnation.
  const ids = rayon.items.map((a) => a.id).sort((x, y) => x - y);
  assert.equal(ids[0], HIKO1, 'la première garde son numéro — elle est vendue');
  assert.equal(ids[1], HIKO2, 'la seconde aussi');
  assert.equal(new Set(ids).size, 14, 'quatorze numéros distincts');
  assert.ok(ids.every((i) => i >= 600001 && i <= 600014), 'tous dans la plage réservée');
  for (const a of rayon.items) {
    assert.equal(a.kind, 'incarnation');
    assert.equal(a.offert, false, 'un rayon payant, comme les accessoires');
    assert.equal(a.owned, false);
    assert.ok(a.prunelle, 'l’article nomme sa paire');
    // L'ÉTAT D'APERÇU : la bouille du joueur, deux caractères changés.
    assert.equal(a.etat.length, 24);
    const diff = [];
    for (let i = 0; i < 24; i++) if (a.etat[i] !== s.bouille[i]) diff.push(i);
    assert.ok(diff.every((i) => i === 4 || i === 5),
      'seuls les caractères 4-5 (l’iris) changent, pas ' + diff.join(','));
  }
  // Les deux index vendus sont ceux du paquet.
  const yeux = rayon.items.map((a) => M.decode62(a.etat.substring(4, 6))).sort((x, y) => x - y);
  assert.deepEqual(yeux, [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
  // Le PRIX suit le modèle, pas la teinte : une couleur ne se paie pas plus
  // cher que l'originale.
  const prix = {};
  rayon.items.forEach((a) => { prix[/#2/.test(a.name) ? 'animee' : 'fixe'] = new Set(); });
  rayon.items.forEach((a) => prix[/#2/.test(a.name) ? 'animee' : 'fixe'].add(a.price));
  assert.deepEqual([...prix.fixe], [120], 'les sept fixes au même prix');
  assert.deepEqual([...prix.animee], [200], 'les sept animées aussi');
});

test('acheter une incarnation ne change QUE les yeux', async () => {
  const mienne = '000305070b0f0m09020t0a00';   // avec le bonnet de nuit au bout
  const sid = await joueur('prua' + RUN, mienne);
  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: HIKO1 }),
  })).json();
  assert.equal(r.ok, true);
  assert.equal(r.bouille.length, 24);
  const diff = [];
  for (let i = 0; i < 24; i++) if (r.bouille[i] !== mienne[i]) diff.push(i);
  assert.deepEqual(diff, [5], 'un seul caractère : le poids faible de l’iris');
  assert.equal(M.decode62(r.bouille.substring(4, 6)), 18);
  assert.equal(r.bouille.substring(15, 24), '9020t0a00', 'le bonnet est resté');
  // Deux fois, non : c'est un article de boutique comme un autre.
  const encore = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: HIKO1 }),
  })).json();
  assert.equal(encore.ok, false);
  assert.equal(encore.code, 2, 'déjà possédé');
});

// ── L'inventaire ───────────────────────────────────────────────────────────

test('les incarnations ont leur rayon d’inventaire, et pas celui des accessoires', async () => {
  // Un nouveau membre a de quoi s'offrir la première paire (120 kikooz sur les
  // 200 de bienvenue) : c'est assez pour voir où elle se range.
  const sid = await joueur('prui' + RUN, '000305070b0f0m09020t0a00');
  const achat = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: HIKO1 }),
  })).json();
  assert.equal(achat.ok, true, 'la paire est achetée');

  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.equal(inv.incarnations.length, 1);
  assert.equal(inv.incarnations[0].nom, "Hiko's eyes");
  assert.equal(inv.incarnations[0].cle, 'hiko1', 'la ligne nomme sa paire');
  assert.equal(inv.incarnations[0].etat.length, 24);
  // Et elle n'est PAS parmi les accessoires : une paire d'iris n'en est pas un.
  const accs = (inv.accessoires || []).map((a) => a.nom);
  assert.ok(!accs.some((n) => /Hiko/.test(n)), 'pas de doublon côté accessoires');

  // Le BUREAU a le même rangement : un dossier de plus dans l'Inventaire.
  const arbre = await (await fetch(BASE + '/ff/ls?uid=inventory&sid=' + sid)).text();
  assert.match(arbre, /<f u="inv_incarnations" n="Incarnations" t="folder" \/>/);
  const dossier = await (await fetch(BASE + '/ff/ls?uid=inv_incarnations&sid=' + sid)).text();
  // « Ma bouille » d'abord : c'est par elle qu'on retire ce qu'on porte.
  assert.match(dossier, /u="fb_principale"[^>]*t="bouille"[^>]*>Ma bouille/);
  assert.match(dossier, new RegExp('u="shop_' + HIKO1 + '"[^>]*t="bouille"'));
  const accessoires = await (await fetch(BASE + '/ff/ls?uid=inv_accessories&sid=' + sid)).text();
  assert.ok(!new RegExp('shop_' + HIKO1).test(accessoires),
    'le dossier Accessoires ne la reprend pas');
});

// ── Le code ────────────────────────────────────────────────────────────────

// ── On la porte, on la retire ──────────────────────────────────────────────

test('on enfile une incarnation, on la retire, et sa bouille est intacte', async () => {
  const mienne = '000305070b0f0m09020t0a00';
  const sid = await joueur('prup' + RUN, mienne);
  await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: HIKO1 }),
  });
  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  const habit = inv.incarnations[0].etat;

  // On l'enfile — c'est le même chemin d'écriture que le chat et le mobile.
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(habit));
  const porte = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  assert.equal(porte.bouille, habit, 'il montre l’incarnation');
  assert.equal(porte.bouillePrincipale, mienne,
    'et le serveur garde SA bouille — c’est elle qu’on lui rendra');
  assert.equal(porte.incarnations.length, 1, 'la liste sert au forum comme à l’inventaire');

  // L'inventaire dit la même chose, et le dossier du bureau propose le retour.
  const inv2 = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.equal(inv2.bouillePrincipale, mienne);
  const dossier = await (await fetch(BASE + '/ff/ls?uid=inv_incarnations&sid=' + sid)).text();
  assert.ok(dossier.indexOf(mienne) >= 0, '« Ma bouille » porte l’état d’origine');

  // On la retire.
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(mienne));
  const nu = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  assert.equal(nu.bouille, mienne);
  assert.equal(nu.bouillePrincipale, mienne);
});

test('une incarnation ne se confond pas avec une bouille ordinaire', () => {
  // Deux familles de bouilles sont des incarnations : celles d'une AUTRE
  // famille, et celles dont l'iris a été acheté (au-delà des dix-huit
  // d'origine). Serveur et client doivent en juger pareil, sans quoi l'un
  // écraserait la bouille principale que l'autre s'efforce de garder.
  assert.match(SERVEUR, /const IRIS_ORIGINE_MAX = 17;/);
  assert.match(SERVEUR, /return decode62\(s\.substring\(4, 6\)\) > IRIS_ORIGINE_MAX;/);
  assert.match(LIGHT, /var IRIS_ORIGINE_MAX = 17;/);
  assert.match(LIGHT, /return fbDecChar\(v\.charAt\(4\)\) \* 62 \+ fbDecChar\(v\.charAt\(5\)\) > IRIS_ORIGINE_MAX;/);
  // L'éditeur, lui, ne propose que les iris d'origine : les autres s'achètent.
  assert.match(LIGHT, /\{ key: "iris",\s+label: "iris",\s+id: 2, pos: 4,\s+max: IRIS_ORIGINE_MAX \}/);
  // Et la bouille principale ne bouge que lorsqu'on montre la sienne.
  assert.match(SERVEUR, /function champsDeLaBouille\(user, etat\) \{[\s\S]*?if \(!estIncarnation\(etat\)\) \{/);
});

test('la clé d’une paire survit au passage par la base', () => {
  // Elle a sa colonne — sans quoi une incarnation créée depuis l'admin
  // redeviendrait un accessoire au suffixe vide au premier redémarrage : une
  // bouille sans rien, et des yeux inchangés.
  const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(DB, /ALTER TABLE shop_packs ADD COLUMN IF NOT EXISTS prunelle TEXT DEFAULT '';/);
  assert.match(DB, /if \(r\.prunelle\) p\.prunelle = r\.prunelle;/);
  assert.match(DB, /disabled = \$10, auteur = \$11, prunelle = \$12/);
  // Le rattrapage depuis la définition statique ne sert plus qu'aux lignes
  // écrites avant la colonne, et ne touche pas ce que la base renseigne.
  assert.match(SERVEUR, /if \(def && def\.prunelle && !p\.prunelle\) p\.prunelle = def\.prunelle;/);
  // Et le rayon reste payant.
  assert.match(SERVEUR, /n\.startsWith\('incarnation'\)\);/);
});

test('l’admin peut créer, modifier et défaire une incarnation', async () => {
  // Le menu des paires : de quoi remplir la liste sans rien taper.
  const dispo = await (await fetch(BASE + '/api/admin/prunelles', { headers: hdr })).json();
  assert.equal(dispo.ok, true);
  // Les quatorze paires, originales et déclinaisons — c'est le menu que
  // l'admin déroule pour poser un article sans taper un numéro.
  assert.equal(dispo.prunelles.length, 14);
  const cles = dispo.prunelles.map((p) => p.cle);
  assert.ok(cles.includes('hiko1') && cles.includes('hiko2'));
  assert.ok(cles.includes('hiko1-cyan') && cles.includes('hiko2-violet'));
  for (const p of dispo.prunelles) assert.ok(p.eyeSc >= 0 && p.nom, 'chaque paire se nomme et se place');

  // On en crée une : pas de suffix9 à donner, la clé suffit.
  const id = 600900;
  const cr = await (await fetch(BASE + '/api/admin/shop', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ id, name: 'Essai', price: 10, prunelle: 'hiko2' }),
  })).json();
  assert.equal(cr.ok, true);
  assert.equal(cr.pack.prunelle, 'hiko2');
  assert.equal(cr.pack.category, 'Incarnations', 'le rayon se devine tout seul');

  // Une clé inconnue est refusée — mieux vaut un refus qu'un article muet.
  const faux = await fetch(BASE + '/api/admin/shop', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ id: id + 1, name: 'Faux', prunelle: 'nexiste-pas' }),
  });
  assert.equal(faux.status, 400);

  // On la change de paire, puis on la défait : l'article redevient ordinaire.
  const mod = await (await fetch(BASE + '/api/admin/shop/' + id, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ prunelle: 'hiko1' }),
  })).json();
  assert.equal(mod.pack.prunelle, 'hiko1');
  const nu = await (await fetch(BASE + '/api/admin/shop/' + id, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ prunelle: '' }),
  })).json();
  assert.equal(nu.pack.prunelle, undefined, 'la clé retirée, l’article n’est plus une incarnation');

  await fetch(BASE + '/api/admin/shop/' + id, { method: 'DELETE', headers: hdr });
});

test('la page d’admin propose les paires, et les dessine', () => {
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(ADMIN, /id="pack-prunelle"/, 'un menu pour choisir la paire');
  assert.match(ADMIN, /\/api\/admin\/prunelles/, 'rempli par le serveur');
  assert.match(ADMIN, /prunelle: \$\('#pack-prunelle'\)\.value/, 'et envoyé à la création');
});

test('le light range les incarnations à part, et on en sort d’un clic', () => {
  assert.match(LIGHT, /<button class="inv-onglet" data-rub="incarnations">Incarnations<\/button>/);
  assert.match(LIGHT, /id="inv-incarnations-grid"/);
  // La première case est TOUJOURS « Ma bouille » : c'est le geste de retrait,
  // le même que « Normal » chez les accessoires.
  assert.match(LIGHT, /\{ nom: "Ma bouille", etat: fbPad\(myBase\), sienne: true \}/);
  assert.match(LIGHT, /function porterIncarnation\(c\)/);
  // `myBase` ne suit PAS l'incarnation : c'est ce qui permet de la retirer.
  assert.match(LIGHT, /\/\/ `myBase` ne bouge pas : l'incarnation est un habit, pas un visage\./);
  // Et la bouille principale du serveur fait foi au chargement.
  assert.match(LIGHT, /if \(d\.bouillePrincipale && !isIncarnation\(d\.bouillePrincipale\)\) myBase = d\.bouillePrincipale;/);
  // « Ma Frutibouille » édite SA bouille, jamais le déguisement : sinon une
  // coiffure retouchée disparaîtrait en retirant l'incarnation.
  assert.match(LIGHT, /if \(isIncarnation\(depart\)\) depart = fbPad\(myBase\);/);
});

test('le forum a son menu d’incarnation, et seulement pour qui en possède', () => {
  assert.match(FORUM, /function incarnationSelectHtml\(formId\)/);
  assert.match(FORUM, /<option value=""' \+ \(courant \? '' : ' selected'\) \+ '>Ma bouille<\/option>/);
  assert.match(FORUM, /if \(myIncarnations\.length\) \{/, 'pas de ligne vide pour les autres');
  // L'accessoire se pose SUR l'incarnation choisie — les deux tiennent ensemble.
  assert.match(FORUM, /function baseDuFormulaire\(sel\) \{\s*\n\s*return \(sel && sel\.incarnation\) \|\| myBouillePrincipale \|\| myBouille;/);
  assert.match(FORUM, /buildBouilleState\(baseDuFormulaire\(sel\), sel && sel\.accSuffix9\)/);
  assert.match(FORUM, /myIncarnations = data\.incarnations \|\| \[\];/);
});

test('le lecteur greffe les prunelles au chargement de la famille', () => {
  const vig = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  // Au MÊME point de passage que les variantes d'accessoire, et pour la même
  // raison : un index doit vouloir dire la même chose sur tous les écrans.
  assert.match(vig, /Promise\.all\(\[Swf\.charger\(DOSSIER \+ 'famille' \+ n \+ '\.swf'\), variantes\(\), prunelles\(\)\]\)/);
  assert.match(vig, /M\.grefferPrunelles\(r\[0\], r\[2\]\)/);
  assert.match(vig, /global\.fetch\(DOSSIER \+ 'prunelles\.json'\)/);
  // Un fichier absent ne doit pas empêcher les bouilles de paraître.
  assert.match(vig, /\.catch\(function \(\) \{ return null; \}\)/);
});

/* ── LES DOUZE DÉCLINAISONS, RENDUES ───────────────────────────────────────
 *
 * « Avons-nous la main pour les décliner dans les différentes couleurs de
 * pupilles déjà existantes pour la famille 0 ? »
 *
 * Oui — mais pas par un réglage : le moteur ne teinte pas l'iris, la couleur
 * est DANS le dessin. On repeint donc à la récolte, et ce test vérifie que la
 * repeinte arrive jusqu'au tracé que le moteur dessinera.
 */
test('chaque teinte se retrouve dans le tracé, et les originales ne bougent pas', async () => {
  const defs = await lireFamille(0);
  M.grefferPrunelles(defs, PAQUET);
  const parCle = Object.fromEntries(PAQUET.iris.map((i) => [i.cle, i]));

  // La couleur dominante d'une paire, telle qu'elle sera dessinée.
  const dominante = (cle) => {
    for (const o of parCle[cle].ordres) {
      const f = defs.formes.get(o.ch);
      if (!f) continue;
      for (const c of (f.couches || [])) {
        if (c.degrade && c.degrade.arrets && c.degrade.arrets[0]) return c.degrade.arrets[0].rgb;
        if (c.rgb && Math.max(...c.rgb) - Math.min(...c.rgb) > 24) return c.rgb;
      }
    }
    return null;
  };
  // Le canal qui doit dominer, pour chacune des six couleurs de la famille 0.
  const ATTENDU = {
    brun: (c) => c[0] > c[1] && c[1] > c[2],
    bleu: (c) => c[2] > c[1] && c[1] > c[0],
    cyan: (c) => c[2] > c[0] && c[1] > c[0],
    vert: (c) => c[1] > c[0] && c[1] > c[2],
    violet: (c) => c[0] > c[1] && c[2] > c[1],
    orange: (c) => c[0] > c[1] && c[1] > c[2],
  };
  for (const modele of ['hiko1', 'hiko2']) {
    // L'originale reste ROUGE : elle est vendue, son dessin ne bouge pas.
    const rouge = dominante(modele);
    assert.ok(rouge && rouge[0] > rouge[1] && rouge[0] > rouge[2],
      modele + ' garde son rouge : ' + rouge);
    for (const [t, test] of Object.entries(ATTENDU)) {
      const c = dominante(modele + '-' + t);
      assert.ok(c, modele + '-' + t + ' a une couleur dominante');
      assert.ok(test(c), modele + '-' + t + ' vire bien au ' + t + ' : ' + c);
    }
  }
  // Et le rouleau les porte toutes, à leur place.
  const r = M.rouleauxIris(defs)[0];
  for (const i of PAQUET.iris) {
    assert.ok(Array.isArray(r.images[i.index]) && r.images[i.index].length,
      'la place ' + i.index + ' est occupée');
  }
});

test('l’éditeur ne propose toujours que les iris d’origine', () => {
  // Les prunelles s'ACHÈTENT ; on ne les dessine pas dans l'atelier. Quatorze
  // paires greffées ne doivent pas allonger le sélecteur de « Ma Frutibouille ».
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /var IRIS_ORIGINE_MAX = 17;/);
  assert.match(light, /max: IRIS_ORIGINE_MAX/);
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /const IRIS_ORIGINE_MAX = 17;/);
});
