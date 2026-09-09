'use strict';
/*
 * LE MAKULO — UNE RÉCOMPENSE QUI EXISTE TOUJOURS
 *
 * « L'accessoire Makulo ne se débloque pas automatiquement pour les joueurs qui
 * terminent le mode difficile du mode Épreuves sur Kaluga. »
 *
 * Le crochet marchait : le jeu appelle `giveAccessory('$makulo')`, le serveur
 * répond, l'inventaire s'écrit. Ce qui manquait, c'est L'ARTICLE. Il ne vivait
 * qu'en base — « créé depuis l'admin » — et sur une installation où personne ne
 * l'avait saisi, `/api/kaluga/accessoire` répondait `absent`, journalisait, et
 * le joueur ne recevait rien. Pire : l'annonce, elle, se lit sur la fruticard
 * AVANT la réponse du serveur — on lui disait donc « Vous avez gagné le
 * Makulo ! » sans rien lui donner.
 *
 * Il est donc livré avec le code. Deux conséquences à tenir :
 *   · une ligne déjà présente en base GAGNE (la fusion du démarrage) — un parc
 *     qui l'a dessiné à sa façon garde le sien ;
 *   · l'article ne doit PAS se retrouver en rayon. Il est à zéro kikooz dans
 *     une rubrique payante : il se ramasserait gratuitement en boutique, et
 *     l'épreuve n'aurait plus rien à donner. D'où `recompense`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MODES = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
const PLATEFORME = fs.readFileSync(path.join(ROOT, 'public/kaluga/plateforme.js'), 'utf8');

test('l’article du Makulo est livré avec le code', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf('LE MAKULO — UNE RÉCOMPENSE, PAS UN ARTICLE DE RAYON'),
    SERVEUR.indexOf('LES INCARNATIONS — un rayon à part'));
  assert.match(bloc, /id: 88888,/);
  assert.match(bloc, /name: 'Makulo',/);
  assert.match(bloc, /category: 'Accessoires',/);
  assert.match(bloc, /suffix9: '50h0t0j0o',/, 'le dessin, tel que la base le porte');
  assert.match(bloc, /recompense: true,/);
  // Et c'est bien le numéro que la table des récompenses désigne.
  assert.match(SERVEUR, /'\$makulo': \{ packId: 88888 \}/);
});

test('une récompense n’est dans aucun rayon, et ne s’achète pas', () => {
  assert.match(SERVEUR, /function estPackEnRayon\(p\) \{ return !p\.disabled && !p\.recompense; \}/);
  // Les DEUX vitrines la filtrent : celle du SWF et celle du light.
  const enRayon = SERVEUR.match(/const visible = SHOP_PACKS\.filter\(estPackEnRayon\);/g) || [];
  assert.strictEqual(enRayon.length, 2, 'la boutique du bureau ET celle du light');
  assert.ok(!/SHOP_PACKS\.filter\(\(p\) => !p\.disabled\)/.test(SERVEUR),
    'plus aucun rayon ne se contente d’écarter les articles retirés');
  // Et en tapant le numéro à la main : refusé comme un article inconnu.
  assert.match(SERVEUR,
    /if \(!pack \|\| pack\.disabled \|\| pack\.recompense\) return \{ ok: false, code: 1 \};/);
});

test('une ligne déjà en base garde la main, mais pas son rayon', () => {
  // La fusion du démarrage remplace la définition statique par la ligne de la
  // base — c'est voulu (un parc qui a dessiné le sien le garde). Mais la base
  // n'a pas de colonne `recompense` : sans ce rappel, l'article reparaîtrait
  // en rayon, à zéro kikooz.
  assert.match(SERVEUR, /if \(def && def\.recompense\) p\.recompense = true;/);
});

test('le jeu ne demande l’accessoire qu’au dernier niveau des Épreuves', () => {
  assert.match(MODES, /if \(this\.level === DEFI_NIVEAUX\.length - 1\) \{/);
  assert.match(MODES, /this\.mng\.client\.giveAccessory\('\$makulo', \(reponse\) => \{/);
  // La marque n'est posée QUE si la pièce est bien au vestiaire : une victoire
  // perdue en route se rattrape à la suivante.
  assert.match(MODES, /if \(!carte \|\| carte\.\$makulo \|\| !reponse \|\| reponse\.absent\) return;/);
  // Et le crochet mène bien au serveur.
  assert.match(PLATEFORME, /fetch\('\/api\/kaluga\/accessoire', \{/);
});
