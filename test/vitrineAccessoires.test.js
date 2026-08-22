/*
 * La vitrine hebdomadaire : dix accessoires puisés au Bouilloscope.
 *
 * Le chapelier n'est pas toujours disponible pour renouveler le rayon. Or les
 * bouilles du Bouilloscope portent déjà des accessoires : les neuf derniers
 * caractères d'une bouille sont exactement le `suffix9` que la boutique vend.
 * On y pioche donc dix accessoires, on les baptise, on les met en rayon — et
 * on retire les dix précédents.
 *
 * Ce que ces tests tiennent :
 *   · dix accessoires en rayon, tous venus de l'annuaire, tous nommés, aucun
 *     doublon de nom ni de code ;
 *   · RETIRER N'EST PAS SUPPRIMER — un joueur qui a acheté l'accessoire de la
 *     semaine passée le garde, le porte et le voit encore dans son inventaire
 *     après le renouvellement suivant ;
 *   · les ids ne se réutilisent jamais (sinon la boutique dirait « déjà
 *     possédé » sur un accessoire tout neuf) ;
 *   · les accessoires du chapelier ne bougent pas ;
 *   · le roulement sert vraiment : deux semaines de suite ne remettent pas les
 *     mêmes têtes en rayon tant que la banque est assez fournie.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FPBouille = require('../public/js/bouille-palette.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3507;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-vitrine';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

const ID_BASE = 900000;          // en dessous : les accessoires du chapelier
const TAILLE = 10;

// Un annuaire de Frutiz fabriqué pour l'occasion : 15 caractères de visage
// quelconques, puis un accessoire. On en met assez pour que deux semaines de
// vitrine ne se recoupent pas (30 accessoires distincts pour 10 places).
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VISAGE = '0004060h0407000';                     // 15 caractères
function bouilleAvecAccessoire(type, variante, c1, c2) {
  return VISAGE + B62[type] + '0' + B62[variante] + '0' + B62[c1] + '0' + B62[c2] + '00';
}
const ANNUAIRE = [];
for (let i = 0; i < 30; i++) {
  ANNUAIRE.push({
    pseudo: 'frutiz' + i + RUN,
    // types 1..16 (0 = « Rien »), couleurs variées
    bouille: bouilleAvecAccessoire(1 + (i % 16), i % 5, (i * 7) % 53, (i * 13) % 53),
  });
}
// Deux têtes nues et une bouille tronquée : elles ne doivent jamais entrer en
// banque (respectivement « pas d'accessoire » et « code abîmé »).
const TETES_NUES = [
  { pseudo: 'nu1' + RUN, bouille: VISAGE + '000000000' },
  { pseudo: 'nu2' + RUN, bouille: VISAGE + '000000000' },
];
const TRONQUEE = { pseudo: 'casse' + RUN, bouille: '30x000' };

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5264', FRUTISCORE_PORT: '5265',
      VITRINE_TICK_MS: '0',        // rendez-vous du lundi coupé : le test mène la danse
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 160 && !pret; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) pret = true; } catch { /* pas prêt */ }
    if (!pret) await wait(250);
  }
  if (!pret) throw new Error('serveur indisponible');

  const lignes = ANNUAIRE.concat(TETES_NUES, [TRONQUEE])
    .map((e) => e.pseudo + ',' + e.bouille).join('\r\n');
  const rep = await fetch(BASE + '/api/admin/trombinoscope/import', {
    method: 'POST', headers: { 'Content-Type': 'text/csv', 'x-admin-key': CLE }, body: lignes,
  });
  const j = await rep.json();
  assert.ok(j.ok, 'annuaire importé : ' + JSON.stringify(j).slice(0, 160));
});

after(() => { if (proc) proc.kill('SIGKILL'); });

const jget = (chemin) => fetch(BASE + chemin, { headers: hdr }).then((r) => r.json());
const etat = () => jget('/api/admin/shop/vitrine');
const catalogue = () => jget('/api/admin/shop');
async function renouveler(corps) {
  const r = await fetch(BASE + '/api/admin/shop/vitrine',
    { method: 'POST', headers: hdr, body: JSON.stringify(corps || {}) });
  return { statut: r.status, corps: await r.json() };
}
const vitrineDe = (packs) => packs.filter((p) => p.id >= ID_BASE);

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session ouverte pour ' + pseudo);
  return j.sid;
}

// ── L'état de départ ───────────────────────────────────────────────────────

test('la banque ne retient que les vraies têtes accessoirisées', async () => {
  const v = await etat();
  assert.equal(v.banque, ANNUAIRE.length,
    'les 30 accessoires de l\'annuaire sont en banque — ni les têtes nues ni la bouille tronquée');
  assert.equal(v.jamaisSortis, v.banque, 'aucun n\'est encore passé en rayon');
  assert.equal(v.taille, TAILLE);
  assert.equal(v.heure, 18, 'le rendez-vous est bien à 18 h');
  assert.match(v.lundi, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(v.prochainLundi) - new Date(v.lundi), 7 * 86400000,
    'le prochain renouvellement automatique est sept jours plus tard');
  assert.equal(v.enRayon.length, 0, 'rayon vide avant le premier renouvellement');
});

// ── Le renouvellement ──────────────────────────────────────────────────────

let premiere = null;

test('un renouvellement pose dix accessoires nommés, venus de l\'annuaire', async () => {
  const avant = await catalogue();
  const chapelier = avant.filter((p) => p.id < ID_BASE);

  // `auto` : exactement ce que déclenche le rendez-vous du lundi 18 h.
  const { statut, corps } = await renouveler({ prix: 60, auto: true });
  assert.equal(statut, 200, 'renouvellement accepté : ' + JSON.stringify(corps).slice(0, 200));
  assert.equal(corps.poses.length, TAILLE, 'dix accessoires posés');
  assert.equal(corps.retires.length, 0, 'rien à retirer la première fois');

  const packs = await catalogue();
  premiere = vitrineDe(packs).filter((p) => !p.disabled);
  assert.equal(premiere.length, TAILLE, 'dix accessoires en vitrine');

  const codesAnnuaire = new Set(ANNUAIRE.map((e) => e.bouille.substring(15, 24)));
  for (const p of premiere) {
    assert.equal(p.category, 'Accessoires', `${p.name} est bien un accessoire`);
    assert.equal(p.price, 60, `${p.name} est au prix demandé`);
    assert.ok(codesAnnuaire.has(p.suffix9), `${p.name} (${p.suffix9}) vient d'une bouille du Bouilloscope`);
    assert.ok(FPBouille.accessoryParts(p.suffix9).type > 0, `${p.name} porte vraiment un accessoire`);
    // Un surnom d'époque : un seul mot, tiré de la couleur et du type
    // (« Citronocle », « Kiwix »). Cf. test/accessoiresBapteme.test.js.
    assert.ok(p.name && !/\s/.test(p.name), 'chaque accessoire a un nom d\'un mot : ' + JSON.stringify(p.name));
    const possibles = [];
    for (let e = 0; e < 6; e++) possibles.push(FPBouille.accessoryName(p.suffix9, e));
    assert.ok(possibles.includes(p.name),
      `« ${p.name} » est bien le surnom de ${p.suffix9} (attendus : ${possibles.slice(0, 3).join(', ')}…)`);
  }
  assert.equal(new Set(premiere.map((p) => p.suffix9)).size, TAILLE, 'dix codes distincts');
  assert.equal(new Set(premiere.map((p) => p.name.toLowerCase())).size, TAILLE,
    'dix noms distincts — deux accessoires de même nom seraient indiscernables en rayon');

  // Le chapelier n'a rien perdu.
  const apres = packs.filter((p) => p.id < ID_BASE);
  assert.deepEqual(apres.map((p) => p.id + ':' + p.name + ':' + !!p.disabled),
    chapelier.map((p) => p.id + ':' + p.name + ':' + !!p.disabled),
    'les accessoires du chapelier sont intacts');
});

test('la vitrine est bien celle que voit le joueur dans la boutique', async () => {
  const sid = await sidPour('vitr' + RUN);
  const xml = await (await fetch(`${BASE}/ft/tree?sid=${sid}`)).text();
  const rubrique = /<c n="Accessoires">([\s\S]*?)<\/c>/.exec(xml);
  assert.ok(rubrique, 'la rubrique Accessoires existe');
  const ids = [...rubrique[1].matchAll(/<p i="(\d+)"/g)].map((m) => Number(m[1]));
  for (const p of premiere) {
    assert.ok(ids.includes(p.id), `${p.name} est en rayon côté joueur`);
  }
  // Et sa fiche se construit (aperçu de bouille compris).
  const fiche = await (await fetch(`${BASE}/ft/pack?sid=${sid}&id=${premiere[0].id}`)).text();
  assert.ok(fiche.includes(`p="bouille,`), 'la fiche porte un aperçu de bouille');
  assert.ok(fiche.includes(premiere[0].suffix9), 'l\'aperçu montre bien cet accessoire');
});

test('le rendez-vous du lundi ne se déclenche qu\'une fois par semaine', async () => {
  // C'est ce qui rend le minuteur increvable : il sonde toutes les minutes,
  // et un redémarrage ou une reprise après coupure ne repose pas un tirage
  // par-dessus celui de la semaine.
  const avant = vitrineDe(await catalogue()).filter((p) => !p.disabled).map((p) => p.id);
  const { statut, corps } = await renouveler({ auto: true });
  assert.equal(statut, 409, 'le second passage automatique de la semaine ne fait rien');
  assert.equal(corps.error, 'deja-faite');
  const apres = vitrineDe(await catalogue()).filter((p) => !p.disabled).map((p) => p.id);
  assert.deepEqual(apres, avant, 'le rayon n\'a pas bougé');
});

// ── Le renouvellement suivant ──────────────────────────────────────────────

test('renouveler retire les dix précédents et en pose dix autres', async () => {
  const { statut, corps } = await renouveler({});
  assert.equal(statut, 200, JSON.stringify(corps).slice(0, 200));
  assert.equal(corps.retires.length, TAILLE, 'les dix précédents sont retirés');
  assert.equal(corps.poses.length, TAILLE, 'dix nouveaux sont posés');

  const packs = await catalogue();
  const enRayon = vitrineDe(packs).filter((p) => !p.disabled);
  assert.equal(enRayon.length, TAILLE, 'toujours dix en rayon, jamais vingt');

  const anciens = new Set(premiere.map((p) => p.id));
  for (const p of enRayon) assert.ok(!anciens.has(p.id), `${p.name} porte un id neuf (${p.id})`);
  // Le roulement : 30 accessoires en banque, 10 par semaine → aucun retour.
  const codesAvant = new Set(premiere.map((p) => p.suffix9));
  for (const p of enRayon) {
    assert.ok(!codesAvant.has(p.suffix9), `${p.name} n'était pas déjà en rayon la semaine passée`);
  }

  // RETIRÉS, PAS SUPPRIMÉS.
  for (const a of premiere) {
    const encore = packs.find((p) => p.id === a.id);
    assert.ok(encore, `${a.name} est toujours au catalogue`);
    assert.equal(encore.disabled, true, `${a.name} n'est plus en vente`);
  }
  const v = await etat();
  assert.equal(v.jamaisSortis, ANNUAIRE.length - 2 * TAILLE,
    'vingt accessoires ont été vus, dix restent à sortir');
});

test('un accessoire acheté reste acquis après son retrait du rayon', async () => {
  // Le joueur achète l'un des dix du moment (un compte neuf a 60 kikooz, le
  // prix d'un accessoire — le premier achat d'un Frutiz, en somme).
  const sid = await sidPour('achat' + RUN);
  const enRayon = vitrineDe(await catalogue()).filter((p) => !p.disabled);
  const cible = enRayon[0];
  const achat = await (await fetch(`${BASE}/ft/buy?sid=${sid}&i=${cible.id}`)).text();
  assert.ok(!/<r k="\d"/.test(achat), 'achat accepté : ' + achat.slice(0, 120));

  // …puis la vitrine tourne.
  const { statut } = await renouveler({});
  assert.equal(statut, 200);

  const packs = await catalogue();
  assert.equal(packs.find((p) => p.id === cible.id).disabled, true, 'l\'accessoire a quitté le rayon');

  // Il est toujours dans l'inventaire, et toujours portable.
  const inv = await (await fetch(`${BASE}/ff/ls?sid=${sid}&uid=inv_accessories`)).text();
  assert.ok(inv.includes(`u="shop_${cible.id}"`), 'il figure encore dans Inventaire › Accessoires');
  assert.ok(inv.includes(cible.suffix9), 'avec son code d\'accessoire, donc portable');
  assert.ok(inv.includes(cible.name), 'et sous son nom');
});

// ── Les garde-fous ─────────────────────────────────────────────────────────

test('sans annuaire suffisant, le rayon en place est laissé tranquille', async () => {
  const avant = vitrineDe(await catalogue()).filter((p) => !p.disabled).map((p) => p.id);
  const vide = await fetch(BASE + '/api/admin/trombinoscope/clear', { method: 'POST', headers: hdr });
  assert.ok(vide.ok, 'annuaire vidé');

  const { statut, corps } = await renouveler({});
  assert.equal(statut, 409, 'le renouvellement est refusé');
  assert.equal(corps.error, 'banque-insuffisante');
  assert.equal(corps.requis, TAILLE);

  const apres = vitrineDe(await catalogue()).filter((p) => !p.disabled).map((p) => p.id);
  assert.deepEqual(apres, avant, 'le rayon précédent reste en vente — mieux qu\'une boutique vide');
});

// ── Le rendez-vous automatique, sans attendre lundi ────────────────────────
//
// Un second serveur, avec un minuteur accéléré (VITRINE_TICK_MS) : personne ne
// touche à la boutique, et le rayon se remplit tout seul. C'est le seul moyen
// de vérifier que le minuteur est vraiment branché sur tournerLaVitrine sans
// patienter jusqu'au lundi suivant.
test('le minuteur garnit le rayon tout seul', { timeout: 90000 }, async () => {
  const P2 = PORT + 1, B2 = `http://127.0.0.1:${P2}`;
  const p2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(P2), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5266', FRUTISCORE_PORT: '5267',
      VITRINE_TICK_MS: '700',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p2.stdout.on('data', () => {});
  p2.stderr.on('data', () => {});
  try {
    let pret = false;
    for (let i = 0; i < 160 && !pret; i++) {
      try { if ((await fetch(B2 + '/do/prefdef')).ok) pret = true; } catch { /* pas prêt */ }
      if (!pret) await wait(250);
    }
    assert.ok(pret, 'second serveur démarré');
    // Rayon vide tant que l'annuaire l'est : le minuteur tourne déjà à vide.
    await wait(1500);
    let v = await (await fetch(B2 + '/api/admin/shop/vitrine', { headers: hdr })).json();
    assert.equal(v.enRayon.length, 0, 'sans annuaire, le minuteur ne fabrique rien');

    const lignes = ANNUAIRE.map((e) => e.pseudo + ',' + e.bouille).join('\r\n');
    await fetch(B2 + '/api/admin/trombinoscope/import', {
      method: 'POST', headers: { 'Content-Type': 'text/csv', 'x-admin-key': CLE }, body: lignes,
    });
    // …et dès que l'annuaire est là, le prochain passage garnit le rayon.
    for (let i = 0; i < 30 && v.enRayon.length === 0; i++) {
      await wait(400);
      v = await (await fetch(B2 + '/api/admin/shop/vitrine', { headers: hdr })).json();
    }
    assert.equal(v.enRayon.length, TAILLE, 'dix accessoires posés sans que personne ne clique');
    assert.ok(v.faiteCetteSemaine, 'la semaine est marquée comme faite');

    // Et il ne recommence pas au passage suivant.
    const ids = v.enRayon.map((p) => p.id);
    await wait(2000);
    v = await (await fetch(B2 + '/api/admin/shop/vitrine', { headers: hdr })).json();
    assert.deepEqual(v.enRayon.map((p) => p.id), ids,
      'les passages suivants laissent le rayon tranquille jusqu\'à lundi prochain');
  } finally {
    p2.kill('SIGKILL');
  }
});
