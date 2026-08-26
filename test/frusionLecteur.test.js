/*
 * LE LECTEUR FRUSION du bureau light — ouvrir, insérer, éjecter.
 *
 * Le clip `frusion` (#324) n'est pas un décor : c'est une machine, et
 * `_global.Frusion` (DoInitAction 0x990e0) en donne toute la mécanique. Ce
 * fichier tient les trois moitiés de la ressemblance :
 *
 *   · les DESSINS — le lecteur sort en COUCHES (le fond, le berceau, la
 *     plaque, le tiroir, la façade percée) plus ses deux boutons ronds avec
 *     leurs trois états, tous tirés de main.swf par
 *     scripts/extract-frutiz-bureau.js ;
 *   · la MÉCANIQUE — le portage transcrit les méthodes d'époque, aux valeurs
 *     du bytecode : slot._y de 71 à 140, l'approche en 0,8^tmod, la rotation
 *     qui accélère jusqu'à 140 puis file, `sens < 0` qui enchaîne sur
 *     `discDestiny`, et l'abonnement au glisser des disques ;
 *   · le GESTE — on attrape un disque (au-delà de 4 px, `dragDistMin`), le
 *     tiroir sort tout seul, le disque y descend, le jeu prend un onglet ;
 *     l'éjection le rend, et il se reprend d'un clic.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('le lecteur sort en COUCHES, et ses deux boutons ont leurs trois états', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'bureau.json'), 'utf8'));
  // Les couches partagent le cadre du clip entier — sans quoi elles ne se
  // superposeraient pas.
  for (const cle of ['frusion-arriere', 'frusion-fondslot', 'frusion-milieu',
    'frusion-slot', 'frusion-avant']) {
    const f = path.join(SPRITES, cle + '.svg');
    assert.ok(fs.existsSync(f), cle + '.svg manquant');
    assert.ok(fs.statSync(f).size > 200, cle + '.svg est vide');
    const c = manifeste[cle] && manifeste[cle].cadre;
    assert.ok(c, cle + ' sans cadre au manifeste');
    assert.strictEqual(c.w, 119, cle + ' : le cadre du clip fait 119 de large');
    assert.strictEqual(c.h, 77.5, cle + ' : et 77,5 de haut');
    assert.strictEqual(c.x, -117.5, cle + ' : l’origine du clip tombe à x 117,5');
  }
  // #317 = le casque (pushReset), #313 = l'éjection (pushEject) — lus dans les
  // actions des deux DefineButton2 du clip.
  for (const cle of ['frusionCasque', 'frusionEject']) {
    for (const etat of ['up', 'over', 'down']) {
      const f = path.join(SPRITES, cle + '_' + etat + '.svg');
      assert.ok(fs.existsSync(f), cle + '_' + etat + '.svg manquant');
    }
    const c = manifeste.boutons[cle].cadre;
    assert.strictEqual(c.w, 20, cle + ' : le bouton fait 20 px');
    assert.strictEqual(c.h, 20);
  }
});

test('la mécanique reprend les valeurs du bytecode', () => {
  // slot._y : 71 fermé, 140 ouvert — `openSlot`/`closeSlot`.
  assert.match(JS, /FR_FERME = 71, FR_OUVERT = 140/);
  // `moveSlot` : l'approche exponentielle, r = 0,8 ^ tmod.
  assert.match(JS, /Math\.pow\(0\.8, tmod\)/);
  assert.match(JS, /this\.y = this\.y \* r \+ y \* \(1 - r\)/);
  // `rotateDisc` : speed += tmod × sens, _rotation −= speed, seuil 140.
  assert.match(JS, /FR_VMAX = 140/);
  assert.match(JS, /this\.vitesse \+= tmod \* sens/);
  // `stopDisc` passe sens = −2, et c'est `sens < 0 && speed < 0` qui enchaîne.
  assert.match(JS, /this\.sens = -2/);
  assert.match(JS, /if \(d && this\[d\]\) this\[d\]\(\)/);
  // Le tiroir refermé sur un disque le LANCE (`si y == 71 et flDisc`).
  assert.match(JS, /if \(y === FR_FERME && this\.disque\) this\.runDisc\(\)/);
});

test('attraper un disque OUVRE le tiroir, le lâcher ailleurs le referme', () => {
  // `dragListener.addListener("disc", {startMethod: "onStartDragDisc", …})`
  assert.match(JS, /ecouterGlisser\('disc'/);
  assert.match(JS, /frusion\.onStartDragDisc = function \(\) \{ if \(!this\.disque && !this\.ouvert\) this\.openSlot\(\); \}/);
  assert.match(JS, /frusion\.onEndDragDisc = function \(\) \{ if \(!this\.disque && this\.ouvert\) this\.closeSlot\(\); \}/);
  // `IconFileBox.dragDistMin = 4`
  assert.match(JS, /DIST_MIN_GLISSER = 4/);
});

test('le dépôt ne vaut que TIROIR SORTI, et sur le tiroir', () => {
  // `onDrop` : type "disc", pas déjà de disque, et flOpen.
  assert.match(JS, /info\.type !== 'disc' \|\| this\.disque \|\| !this\.ouvert/);
  // `slot.dropBox = this` : la cible est le tiroir, pas la console — et elle
  // ne reçoit rien tant qu'il est rentré.
  assert.match(CSS, /\.fr-cible \{[\s\S]*?pointer-events: none;/);
  assert.match(CSS, /#frusion-boite\.fr-ouvert \.fr-cible \{ pointer-events: auto; \}/);
  // Et elle N'EST PAS une pièce mobile : ses 71 px de haut de page disent déjà
  // le tiroir SORTI. Rangée dans le tiroir, elle prenait EN PLUS sa
  // translation de 69 et tombait à 140 — sous le dessin, dans le vide : le
  // disque ne se posait jamais. Elle est donc posée sur la console, AVANT le
  // tiroir (le disque rendu, lui, doit rester cliquable au-dessus d'elle).
  const ordre = JS.slice(JS.indexOf('cible.className = \'fr-cible\''));
  assert.match(ordre, /b\.appendChild\(cible\);\s*\n\s*b\.appendChild\(mSlot\);/,
    'la cible se pose sur la console, sous le tiroir');
  assert.doesNotMatch(JS, /mSlot\.appendChild\(cible\)/);
  // Le disque n'attrape le curseur QUE rendu : sinon il volerait les dépôts.
  assert.match(CSS, /\.fr-disque \{[\s\S]*?pointer-events: none;/);
  assert.match(CSS, /\.fr-disque\.reprenable \{ pointer-events: auto;/);
});

test('le jeu prend un ONGLET, et le fermer éjecte', () => {
  // `FPSlotList.addSlot(slot, true)` → mainBar.addTab + activate.
  assert.match(JS, /window\.activateTab\(tab\)/);
  // `FPSlotList.addSlot(slot, flGo)` : un jeu qu'on vient de lancer S'AFFICHE,
  // donc flGo vrai — au contraire d'une fenêtre qu'on range, qui laisse la
  // main au bureau.
  assert.match(JS, /mettreEnOnglet\(panneau\.id, true\)/);
  // Le routeur du light est ouvert au bureau pour cela.
  assert.match(LIGHT, /window\.activateTab = activateTab;/);
  // Fermer la fenêtre du jeu = `onReadyToClose` : le disque ralentit et sort.
  assert.match(JS, /frusion\.stopDisc\('releaseDisc'\)/);
  // `pushEject` referme le jeu puis rend le disque.
  assert.match(JS, /frusion\.pushEject = function/);
  assert.match(JS, /frusion\.releaseDisc = function/);
  assert.match(JS, /frusion\.takeDisc = function/);
});

test('le disque qui tourne quitte la boîte à disques', () => {
  // `fileMng.frusionOn` : le disque n'est plus dans le dossier tant qu'il est
  // dans le lecteur.
  assert.match(JS, /return x\.uid !== frusion\.disque\.uid;/);
  assert.match(JS, /function rafraichirDisques\(\)/);
});

test('la géométrie est celle du clip et du relevé 1:1', () => {
  assert.match(JS, /FR_X0 = 117\.5/);            // l'origine du clip dans la boîte
  assert.match(JS, /FR_SLOT_X = FR_X0 - 58/);    // le tiroir posé à (−58, 71)
  assert.match(JS, /FR_DISQUE = 63/);            // but.icon.Full : _xscale = 100
  assert.match(JS, /FR_DISQUE_DY = -32\.25/);    // au ras de la corde de la cuve
  // Les deux boutons, aux places du clip : (−100, 60) et (−15,85, 60).
  assert.match(CSS, /\.fr-casque \{ left: 7\.5px; \}/);
  assert.match(CSS, /\.fr-eject \{ left: 91\.65px; \}/);
  assert.match(CSS, /\.fr-but \{[\s\S]*?top: 50px; width: 20px; height: 20px;/);
});

test('rien de tout cela ne sort du bureau : le mobile ne bouge pas', () => {
  const lignes = CSS.split('\n').filter((l) => /#frusion-boite|\.fb-glisse-icone/.test(l)
    && /^[^\s].*\{/.test(l));
  assert.ok(lignes.length > 5, 'les règles du lecteur sont introuvables');
  for (const l of lignes) {
    assert.ok(l.startsWith('body.bureau-frutiz'),
      'règle de lecteur hors du bureau : ' + l.trim());
  }
  // Et le lecteur ne se bâtit qu'au démarrage du bureau.
  assert.match(JS, /haut\.appendChild\(batirFrusion\(\)\);/);
});
