/*
 * LA GARDE DES ENTRÉES — les touches et les appuis SIMULÉS, refusés et signalés.
 *
 * Un script (une extension, un assistant branché sur la page) qui « appuie »
 * à la place du joueur fabrique ses événements : `dispatchEvent(new
 * KeyboardEvent(…))`. Le navigateur les marque — `isTrusted` vaut `false`
 * pour tout événement né d'un script, `true` pour ceux qui viennent d'un vrai
 * clavier, d'une vraie souris, d'un vrai doigt, et ce drapeau ne se pose pas
 * à la main. Les jeux classés ne prennent donc que les seconds :
 *
 *     if (!Garde.vraie(ev)) return;      // en tête de chaque écouteur de jeu
 *
 * Un événement refusé est COMPTÉ, et le compte part au serveur
 * (/api/antitriche/entrees), qui en fait une alerte pour l'admin : la partie
 * continue, mais le script n'y joue pas.
 *
 * LE PIÈGE (`piege`). Les pages de jeu laissaient leur état en évidence
 * (`window.__client`, pour les vérifications automatisées) : un script lisait
 * la grille en une ligne. Ces noms n'existent plus ; à leur place, un piège
 * muet — qui les LIT est signalé, et ne reçoit rien. Non énumérable : un
 * outil qui parcourt `window` ne le déclenche pas, il faut viser le nom.
 *
 * CE QUE ÇA NE FAIT PAS, pour ne pas se raconter d'histoire : un programme
 * qui pilote le navigateur de l'extérieur (protocole de débogage,
 * automatisation du système) produit de VRAIS événements, et un assistant
 * qui regarde l'écran pour conseiller n'en produit aucun. La garde ferme la
 * porte aux scripts de page ; le reste se lit au profil de jeu (admin).
 *
 * Le drapeau est lu par son accesseur d'origine, relevé au chargement : un
 * faux événement (un objet quelconque passé à un écouteur intercepté) ne
 * l'a pas, quoi qu'il prétende. Sous Node et dans les bacs à sable des
 * tests, où les événements sont de simples objets, la garde se contente de
 * refuser ceux qui se disent `isTrusted: false`.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);

let lire = null;
if (!sousNode) {
  try {
    const E = racine.Event;
    const d = E && Object.getOwnPropertyDescriptor(new E('x'), 'isTrusted');
    if (d && typeof d.get === 'function') lire = d.get;
  } catch (e) { /* navigateur sans Event constructible : on reste au drapeau */ }
}

const PERIODE_MS = 30000;          // un envoi au plus par demi-minute
let cible = null;                  // { jeu, sid } — posé par surveiller()
let refuses = 0;
let parType = {};
let sondes = {};
let aEnvoyer = false;
let dernierEnvoi = 0;
let minuteur = null;
const dejaVus = new WeakSet();

function envoyer(enPartant) {
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  if (!cible || !cible.sid || !aEnvoyer || typeof racine.fetch !== 'function') return;
  aEnvoyer = false;
  dernierEnvoi = Date.now();
  const corps = JSON.stringify({ sid: cible.sid, jeu: cible.jeu, refuses, types: parType, sondes });
  // La page se ferme : le dernier compte part quand même.
  if (enPartant === true && racine.navigator && typeof racine.navigator.sendBeacon === 'function') {
    try {
      if (racine.navigator.sendBeacon('/api/antitriche/entrees', new racine.Blob([corps], { type: 'application/json' }))) return;
    } catch (e) { /* on retombe sur fetch */ }
  }
  try {
    racine.fetch('/api/antitriche/entrees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, keepalive: true,
    }).catch(function () {});
  } catch (e) { /* hors ligne : tant pis */ }
}
function prevenir() {
  aEnvoyer = true;
  if (minuteur || !cible) return;
  const attente = Math.max(1500, PERIODE_MS - (Date.now() - dernierEnvoi));
  // Le premier signal part vite ; les suivants, groupés.
  minuteur = setTimeout(envoyer, dernierEnvoi ? attente : 1500);
}
if (!sousNode && typeof racine.addEventListener === 'function') {
  racine.addEventListener('pagehide', function () { envoyer(true); });
}

/** L'événement vient-il d'un vrai appui ? Sinon : compté, signalé, et `false`. */
function vraie(ev) {
  let ok;
  if (lire) {
    try { ok = lire.call(ev) === true; } catch (e) { ok = false; }
  } else {
    ok = !(ev && ev.isTrusted === false);
  }
  if (ok) return true;
  // Un même événement passe par plusieurs écouteurs : il ne compte qu'une fois.
  if (ev && typeof ev === 'object') {
    if (dejaVus.has(ev)) return false;
    dejaVus.add(ev);
  }
  refuses++;
  const t = String((ev && ev.type) || '?').slice(0, 20);
  parType[t] = (parType[t] || 0) + 1;
  prevenir();
  return false;
}

/** À qui rendre compte : le jeu et la session. */
function surveiller(o) {
  cible = { jeu: String((o && o.jeu) || ''), sid: String((o && o.sid) || '') };
  if (aEnvoyer) prevenir();
}

/** Pose un piège muet sous chacun de ces noms de `window` (cf. « LE PIÈGE »). */
function piege(noms) {
  for (const nom of noms || []) {
    try {
      Object.defineProperty(racine, nom, {
        enumerable: false, configurable: false,
        get: function () { sondes[nom] = (sondes[nom] || 0) + 1; prevenir(); return undefined; },
        set: function () { sondes[nom] = (sondes[nom] || 0) + 1; prevenir(); },
      });
    } catch (e) { /* déjà posé */ }
  }
}

/** Où en est le compte (les tests, et le bilan de fin de partie). */
function bilan() { return { refuses, types: Object.assign({}, parType), sondes: Object.assign({}, sondes) }; }

const API = Object.freeze({ vraie, surveiller, piege, bilan });

if (sousNode) module.exports = API;
else {
  try { Object.defineProperty(racine, 'GardeEntrees', { value: API, writable: false, configurable: false }); }
  catch (e) { racine.GardeEntrees = API; }
}

})(typeof window !== 'undefined' ? window : globalThis);
