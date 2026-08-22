/*
 * Play Store (TWA) : la preuve de propriété et la politique de confidentialité.
 *
 * L'appli Android du store est une Trusted Web Activity — Chrome plein écran
 * sur ce site. Pour qu'Android retire la barre d'adresse, le domaine doit
 * publier /.well-known/assetlinks.json avec l'empreinte SHA-256 du certificat
 * de signature. express.static ignore les dossiers en point : c'est une route
 * explicite, alimentée par data/assetlinks.json ou par l'environnement
 * (ANDROID_PACKAGE_ID + ANDROID_CERT_SHA256).
 *
 * Ce que ces tests tiennent :
 *   · configuré par l'environnement, le fichier a EXACTEMENT la forme que
 *     l'outil de vérification de Google attend (relation, namespace,
 *     package_name, empreintes en MAJUSCULES — la casse compte pour Digital
 *     Asset Links) ;
 *   · plusieurs empreintes séparées par des virgules passent (clé d'envoi +
 *     clé de signature Play) ;
 *   · /confidentialite répond — la fiche Play exige cette URL publique ;
 *   · sans configuration, assetlinks répond 404 (le site marche, l'appli
 *     du store afficherait simplement la barre d'adresse).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3514;               // serveur configuré (env Android)
const PORT_NU = 3515;            // serveur sans configuration
const BASE = `http://127.0.0.1:${PORT}`;
const BASE_NU = `http://127.0.0.1:${PORT_NU}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAQUET = 'app.frutiparc.twa';
// Volontairement en minuscules et avec des espaces parasites : la route doit
// nettoyer et remonter en majuscules (Digital Asset Links est sensible à ça).
const EMPREINTE_ENVOI = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';
const EMPREINTE_PLAY = '12:34:56:78:9a:bc:de:f0:12:34:56:78:9a:bc:de:f0:12:34:56:78:9a:bc:de:f0:12:34:56:78:9a:bc:de:f0';

let proc = null;
let procNu = null;

function lancer(port, socket, scores, envSup) {
  return spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), DATABASE_URL: '',
      XMLSOCKET_PORT: String(socket), FRUTISCORE_PORT: String(scores),
    }, envSup || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function attendre(base) {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(base + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible : ' + base);
}

before(async () => {
  proc = lancer(PORT, 5274, 5275, {
    ANDROID_PACKAGE_ID: '  ' + PAQUET + '  ',
    ANDROID_CERT_SHA256: EMPREINTE_ENVOI + ' , ' + EMPREINTE_PLAY,
  });
  procNu = lancer(PORT_NU, 5276, 5277, {
    ANDROID_PACKAGE_ID: '', ANDROID_CERT_SHA256: '',
  });
  for (const p of [proc, procNu]) {
    p.stdout.on('data', () => {});
    p.stderr.on('data', () => {});
  }
  await Promise.all([attendre(BASE), attendre(BASE_NU)]);
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (procNu) procNu.kill('SIGKILL');
});

test('assetlinks.json : la forme exacte que Google vérifie', async () => {
  const rep = await fetch(BASE + '/.well-known/assetlinks.json');
  assert.strictEqual(rep.status, 200);
  assert.match(rep.headers.get('content-type') || '', /application\/json/);

  const doc = await rep.json();
  assert.ok(Array.isArray(doc) && doc.length === 1, 'un tableau d\'une déclaration');
  const decl = doc[0];
  assert.deepStrictEqual(decl.relation, ['delegate_permission/common.handle_all_urls']);
  assert.strictEqual(decl.target.namespace, 'android_app');
  assert.strictEqual(decl.target.package_name, PAQUET, 'identifiant nettoyé des espaces');
  assert.deepStrictEqual(
    decl.target.sha256_cert_fingerprints,
    [EMPREINTE_ENVOI.toUpperCase(), EMPREINTE_PLAY.toUpperCase()],
    'deux empreintes, nettoyées, en majuscules'
  );
});

test('la politique de confidentialité répond (la fiche Play l\'exige)', async () => {
  const rep = await fetch(BASE + '/confidentialite');
  assert.strictEqual(rep.status, 200);
  const page = await rep.text();
  assert.match(page, /Politique de confidentialité/);
  assert.match(page, /bcrypt/, 'dit comment le mot de passe est gardé');
  assert.match(page, /notifications/i, 'explique le push opt-in');
  assert.match(page, /[Ss]upprimer son compte/, 'dit comment partir');
});

test('le pied de /light mène à la politique de confidentialité', async () => {
  const rep = await fetch(BASE + '/light');
  assert.strictEqual(rep.status, 200);
  const page = await rep.text();
  assert.match(page, /href="\/confidentialite"/);
});

test('sans configuration : 404 — le site marche, la barre d\'adresse reste', async () => {
  const rep = await fetch(BASE_NU + '/.well-known/assetlinks.json');
  assert.strictEqual(rep.status, 404);
  // Et le reste du site n'en souffre pas.
  const light = await fetch(BASE_NU + '/light');
  assert.strictEqual(light.status, 200);
  const confid = await fetch(BASE_NU + '/confidentialite');
  assert.strictEqual(confid.status, 200);
});
