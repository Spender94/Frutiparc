'use strict';
/*
 * LA GRAMMAIRE ANGLAISE DES DICTIONNAIRES DU SERVEUR — ce qu'un gabarit ne sait
 * pas dire : les ordinaux (1st, 2nd, 23rd), les listes (« A, B and C »), les
 * nombres et les dates à l'anglaise. Les dictionnaires de en/ s'en servent
 * dans leurs entrées-fonctions.
 *
 * Ce fichier vit HORS de en/ : le serveur charge tout ce que en/ contient
 * comme un dictionnaire (une zone par fichier, cf. test/chatLangues.test.js).
 */

// 1st, 2nd, 3rd, 4th… 11th, 12th, 13th… 21st, 22nd.
function ordinal(n) {
  const v = Math.trunc(Number(n) || 0);
  const cent = Math.abs(v) % 100, dix = Math.abs(v) % 10;
  if (cent >= 11 && cent <= 13) return v + 'th';
  return v + (dix === 1 ? 'st' : dix === 2 ? 'nd' : dix === 3 ? 'rd' : 'th');
}

// « A », « A and B », « A, B and C ».
function liste(items) {
  const l = (items || []).filter((x) => x != null && x !== '').map(String);
  if (l.length <= 1) return l.join('');
  return l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
}

// 12,345.
function nombre(n) {
  try { return Number(n || 0).toLocaleString('en-US'); } catch (e) { return String(n); }
}

// « March 12, 2026 », à l'heure de Paris (comme les dates françaises du parc).
function dateLongue(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(x);
}

// « September 2026 », pour une clé de mois « 2026-09 ».
function moisLisible(cle) {
  const [a, m] = String(cle || '').split('-').map(Number);
  if (!a || !m) return String(cle || '');
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(a, m - 1, 15)));
}

module.exports = { ordinal, liste, nombre, dateLongue, moisLisible };
