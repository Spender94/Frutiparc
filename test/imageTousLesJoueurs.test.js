'use strict';
/*
 * `/image` ET `/img` SONT OUVERTES À TOUT LE MONDE
 * ═══════════════════════════════════════════════
 *
 * Partager une image au salon était un pouvoir d'animateur, et il tenait à
 * DEUX portillons — il fallait ouvrir les deux, sans quoi la commande
 * continuait de mourir en silence :
 *
 *   · CÔTÉ CLIENT FLASH. Le répartiteur de commandes envoie `/image` et
 *     `/img` sur la même branche (0x2aec8), qui s'ouvre sur un
 *     `if (!me.flAnimator) return false`. La commande n'ATTEIGNAIT donc même
 *     pas le serveur : elle mourait dans le client, sans un mot.
 *     scripts/patch-main-image-tous.js réécrit la cible du saut — deux octets,
 *     et les deux chemins se rejoignent sur la suite.
 *
 *   · CÔTÉ SERVEUR. La trame `t="i"` était refusée à qui n'était pas staff DU
 *     salon. C'est ce portillon-là qui faisait autorité : il tombe.
 *
 * Et le LIGHT, devenu le point d'entrée principal, savait recevoir ces trames
 * mais pas les émettre — `/img` tapé du téléphone repartait en « Commande
 * inconnue ». Il compose maintenant la même trame que le SWF.
 *
 * Ce qui reste, et qui n'a rien à voir avec le grade : le silence (un joueur
 * totoché ne parle pas), l'adhésion au salon, la syntaxe, les bornes de
 * taille, et le passage par le relais d'images de même origine.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

function corpsSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
}

test('main.swf laisse partir /image et /img, quel que soit le grade', () => {
  const b = corpsSwf(path.join(ROOT, 'legacy/main.swf'));
  // Les deux commandes mènent à la MÊME branche : une seule à ouvrir.
  for (const [nom, adr] of [['/image', 0x2a704], ['/img', 0x2a714]]) {
    assert.strictEqual(b[adr], 0x9d, nom + ' : pas un ActionIf à 0x' + adr.toString(16));
    assert.strictEqual(adr + 5 + b.readInt16LE(adr + 3), 0x2aec8,
      nom + ' ne mène plus au portillon 0x2aec8');
  }
  // Le portillon lui-même : `me.flAnimator` est toujours LU (on n'a pas touché
  // au dessin du code), mais les deux issues du test se rejoignent désormais
  // sur le `Pop` puis le `Jump` qui exécutent la commande.
  assert.strictEqual(b[0x2aed9], 0x4c, 'PushDuplicate attendu à 0x2aed9');
  assert.strictEqual(b[0x2aeda], 0x12, 'Not attendu à 0x2aeda');
  assert.strictEqual(b[0x2aedb], 0x9d, 'ActionIf attendu à 0x2aedb');
  const cible = 0x2aedb + 5 + b.readInt16LE(0x2aedb + 3);
  assert.strictEqual(cible, 0x2aee0,
    'le portillon renvoie encore au refus (0x' + cible.toString(16) + ')');
  assert.strictEqual(b[0x2aee0], 0x17, 'Pop attendu à 0x2aee0 (la pile doit rester juste)');
  assert.strictEqual(b[0x2aee1], 0x99, 'Jump attendu à 0x2aee1');
  // Et le correctif est rejouable — comme toutes les rustines du dépôt.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/patch-main-image-tous.js')));
});

test('le serveur ne réserve plus la trame image au staff', () => {
  // La garde a disparu, et le message qui l'expliquait avec elle.
  assert.ok(!SERVEUR.includes("L'affichage d'images est réservé au salon Pomme."),
    'le refus « réservé au salon Pomme » subsiste');
  const bloc = SERVEUR.slice(SERVEUR.indexOf("if (type === 'i' && imgChild)"),
    SERVEUR.indexOf('const proxied ='));
  assert.ok(!/isChannelStaff/.test(bloc), 'la branche image teste encore le grade');
  // Ce qui protège encore, et qui n'est pas une question de grade.
  assert.match(bloc, /if \(!g \|\| !client\.logged\) break;/, 'il faut être connecté');
  assert.match(bloc, /!channel\.users\.has\(client\.username\)/, 'et membre du salon');
  assert.match(bloc, /Syntaxe : \/image largeur hauteur url titre/, 'la syntaxe est vérifiée');
  assert.match(bloc, /Math\.min\(Math\.max\(iw, 10\), 600\)/, 'et la taille bornée');
  assert.match(SERVEUR, /const proxied = `\/api\/imgproxy\?url=\$\{encodeURIComponent\(iu\)\}`;/,
    'l’adresse passe toujours par le relais de même origine');
});

test('le light sait ENVOYER une image, pas seulement en recevoir', () => {
  assert.match(LIGHT, /var CMD_IMAGE = \["\/image", "\/img"\];/);
  assert.match(LIGHT, /if \(CMD_IMAGE\.indexOf\(cmd\) !== -1\) \{ commandeImage\(mots, salon\); return true; \}/);
  // La trame est celle du SWF : un `send` de type « i » dont le corps est un
  // nœud <i w= h= u=>titre</i>.
  assert.match(LIGHT, /wsSend\('<t g="' \+ xmlEscape\(ou\) \+ '" t="i" p="' \+ xmlEscape\(state\.pen\) \+ '">'/);
  assert.match(LIGHT, /\+ '<i w="' \+ l \+ '" h="' \+ h \+ '" u="' \+ xmlEscape\(url\) \+ '">'/);
  // Les mêmes bornes que le serveur, dites tout de suite.
  assert.match(LIGHT, /l = Math\.min\(Math\.max\(l, 10\), 600\);/);
  assert.match(LIGHT, /h = Math\.min\(Math\.max\(h, 10\), 600\);/);
  // Une syntaxe fautive ne part pas au salon : elle est rappelée sur place.
  assert.match(LIGHT, /systemLine\(SYNTAXE_IMAGE, ou\);/);
  assert.match(LIGHT, /!\/\^https\?:\\\/\\\/\/i\.test\(url\)/, 'seules http(s) passent');
  // Et il affiche toujours ce qu'il reçoit.
  assert.match(LIGHT, /if \(ty === "i"\) \{/);
  assert.match(LIGHT, /addImageMessage\(\{ from: from, time: h, url: iu,/);
});
