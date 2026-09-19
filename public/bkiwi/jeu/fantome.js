/*
 * Burning Kiwi — LE FANTÔME, et comment il tient dans une ligne de texte.
 *
 * Le mode Ghost-Run enregistre la course : une position tous les DEUX images
 * (mainGame.as, le drapeau `skipGhost`), soit vingt par seconde à la cadence
 * du jeu. Une course de trois tours en fait deux mille. Le fichier d'époque
 * gardait tout cela dans une variable de la timeline, et le fantôme mourait
 * avec la page ; pour qu'il survive à la nuit, il faut l'écrire quelque part,
 * donc le rendre petit.
 *
 * LE FORMAT. Cinq octets par point, en base64 :
 *
 *     x  sur 16 bits   (la coordonnée du circuit, décalée de DECALAGE pour
 *                       qu'un débordement dans le vide reste positif)
 *     y  sur 16 bits   (idem)
 *     r  sur  8 bits   (la rotation, −180..180 ramenée sur 0..255)
 *
 * La rotation est le seul champ qu'on abîme : un pas de 1,4 degré, invisible
 * sur une voiture de vingt pixels, et surtout SANS ENROULEMENT — une rotation
 * absolue ne connaît pas le saut de +179 à −179 qui piège les différences.
 * `x` et `y` restent au pixel : c'est la trajectoire, on n'y touche pas.
 *
 * Le troisième champ que `ghostStore` range (`n`, la nitro) n'est jamais posé
 * par le jeu — l'appel passe `false` en dur — et rien ne le relit. On ne
 * l'écrit donc pas, et on le rend `false` à la relecture.
 *
 * L'ALPHABET est celui des URL (« - » et « _ » à la place de « + » et « / »),
 * et il n'y a pas de remplissage : la trace traverse un formulaire sans qu'un
 * seul caractère soit ré-encodé. Avec le base64 ordinaire, trois caractères
 * sur cent devenaient « %2B » ou « %2F » et la trace enflait d'autant.
 *
 * Deux mille points font dix kilo-octets encodés : le poids d'une image, pour
 * une course entière. Le fantôme ne voyage que quand on entre en Ghost-Run,
 * jamais avec la fruticard.
 */
'use strict';

(function (racine) {

const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

// Les coordonnées d'un circuit tiennent dans quelques milliers ; le décalage
// laisse de la place à une voiture partie dans le vide avant que `outZone` ne
// la rattrape (la seule façon d'obtenir une coordonnée négative).
const DECALAGE = 16384;
const MAX16 = 65535;
const OCTETS = 5;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const borner16 = (v) => {
  const n = Math.round(Number(v) || 0) + DECALAGE;
  return n < 0 ? 0 : (n > MAX16 ? MAX16 : n);
};
// −180..180 → 0..255. `getAngle` rend déjà l'angle dans cet intervalle ; on
// referme quand même, une rotation posée par un script peut en sortir.
const angleOctet = (r) => {
  let a = Number(r) || 0;
  a = ((a + 180) % 360 + 360) % 360;              // 0..360, sans trou à la jonction
  const n = Math.round(a * 256 / 360);
  return n >= 256 ? 0 : n;                        // 360 se referme sur 0
};
const octetAngle = (n) => ((n * 360 / 256) - 180);

function versB64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i], b = octets[i + 1], c = octets[i + 2];
    const reste = octets.length - i;
    s += B64[a >> 2];
    s += B64[((a & 3) << 4) | (reste > 1 ? (b >> 4) : 0)];
    if (reste > 1) s += B64[((b & 15) << 2) | (reste > 2 ? (c >> 6) : 0)];
    if (reste > 2) s += B64[c & 63];
  }
  return s;
}
function depuisB64(s) {
  const t = String(s || '').replace(/[^A-Za-z0-9\-_]/g, '');
  const octets = [];
  for (let i = 0; i < t.length; i += 4) {
    const n = [B64.indexOf(t[i]), B64.indexOf(t[i + 1]), B64.indexOf(t[i + 2]), B64.indexOf(t[i + 3])];
    if (n[0] < 0 || n[1] < 0) break;
    octets.push(((n[0] << 2) | (n[1] >> 4)) & 255);
    if (n[2] >= 0) octets.push((((n[1] & 15) << 4) | (n[2] >> 2)) & 255);
    if (n[3] >= 0) octets.push((((n[2] & 3) << 6) | n[3]) & 255);
  }
  return octets;
}

/** La trace d'un fantôme (`{ moves: [{x,y,r,n}] }`) → une chaîne. */
J.encoderFantome = function (ghost) {
  const pas = (ghost && ghost.moves) || [];
  const octets = new Array(pas.length * OCTETS);
  let k = 0;
  for (const p of pas) {
    const x = borner16(p.x), y = borner16(p.y);
    octets[k++] = x >> 8; octets[k++] = x & 255;
    octets[k++] = y >> 8; octets[k++] = y & 255;
    octets[k++] = angleOctet(p.r);
  }
  return versB64(octets);
};

/** Une chaîne → la trace, prête pour `ghostRead` (current remis à zéro). */
J.decoderFantome = function (texte) {
  const octets = depuisB64(texte);
  // Cinq octets par point, ni plus ni moins : une chaîne d'une autre longueur
  // n'est pas une trace (texte étranger, envoi tronqué) et ne donnera pas un
  // fantôme de fortune qui partirait en diagonale.
  if (!octets.length || octets.length % OCTETS !== 0) return null;
  const moves = [];
  for (let i = 0; i + OCTETS <= octets.length; i += OCTETS) {
    moves.push({
      x: ((octets[i] << 8) | octets[i + 1]) - DECALAGE,
      y: ((octets[i + 2] << 8) | octets[i + 3]) - DECALAGE,
      r: octetAngle(octets[i + 4]),
      n: false,
    });
  }
  return moves.length ? { current: 0, moves, raceTime: Infinity } : null;
};

J.FANTOME_DECALAGE = DECALAGE;

})(typeof window !== 'undefined' ? window : globalThis);
