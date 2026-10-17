/*
 * La cadence des deux visiteurs du chat — m'dam Irma et Gromelin.
 *
 * Ils passaient beaucoup trop souvent : Irma toutes les dix à quarante-cinq
 * minutes, Gromelin toutes les trente-cinq à cent vingt. Un habitué du chat les
 * croisait plusieurs fois par session, et une apparition qu'on attend cesse
 * d'être une apparition.
 *
 * Désormais : Irma UNE fois par heure, Gromelin QUATRE fois par jour (depuis
 * qu'il a une bricole à confier au salon des animations) et seulement entre
 * huit heures et minuit. Ce fichier tient les deux règles — et la faute de
 * français d'Irma, qui traînait depuis le début.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('les anciens minuteurs ont disparu', () => {
  // C'étaient deux chaînes de setTimeout qui se rappelaient elles-mêmes ; il
  // n'en reste rien, sans quoi les deux cadences se superposeraient.
  assert.ok(!/function scheduleMdamirma/.test(SERVEUR), 'plus de scheduleMdamirma');
  assert.ok(!/function scheduleGromelin/.test(SERVEUR), 'plus de scheduleGromelin');
  assert.match(SERVEUR, /function tickVisiteurs\(maintenant = new Date\(\)\)/,
    'un seul battement pour les deux');
  // Il bat à la minute — la granularité des rendez-vous.
  assert.match(SERVEUR, /tickVisiteurs\(\); \} catch \(e\) \{[^}]*\}\n\}, 60 \* 1000\);/,
    'une fois par minute');
});

test('Gromelin ne sort qu\'entre huit heures et minuit, quatre fois par jour', () => {
  assert.match(SERVEUR, /const GROMELIN_HEURE_MIN = 8;/);
  assert.match(SERVEUR, /const GROMELIN_HEURE_MAX = 23;/);
  assert.match(SERVEUR, /const GROMELIN_PASSAGES = 4;/);
  // L'heure vient de PARIS : un changement d'heure ne doit pas le décaler
  // pendant six mois.
  assert.match(SERVEUR, /timeZone: 'Europe\/Paris', hour: '2-digit', minute: '2-digit', hour12: false,/);
  assert.match(SERVEUR, /const jour = parisDayKey\(maintenant\);/);
});

test('un redémarrage ne rappelle pas les visiteurs dans la minute', () => {
  // Sans cette amorce, relancer le serveur à 14 h 30 ferait revenir Gromelin
  // une seconde fois le même jour, et Irma dans la minute qui suit.
  assert.match(SERVEUR, /irmaRdv\.cle = jour \+ 'T' \+ h;/);
  assert.match(SERVEUR, /gromelinRdv\.cle = jour;/);
  // Les passages de la matinée ne se rattrapent pas.
  assert.match(SERVEUR, /gromelinRdv\.fait = gromelinRdv\.rdv\.filter\(\(x\) => x <= h \* 60 \+ m\)\.length;/);
});

// La règle elle-même, rejouée minute par minute sur une semaine simulée. C'est
// le seul moyen honnête de vérifier une cadence : la lire dans le source ne dit
// pas si elle compte juste.
test('sur une semaine : une Irma par heure, quatre Gromelin par jour', () => {
  const entierEntre = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const GROMELIN_HEURE_MIN = 8, GROMELIN_HEURE_MAX = 23, GROMELIN_PASSAGES = 4;
  const tirerRdvGromelin = () => {
    const rdv = new Set();
    while (rdv.size < GROMELIN_PASSAGES) rdv.add(entierEntre(GROMELIN_HEURE_MIN * 60, GROMELIN_HEURE_MAX * 60 + 59));
    return [...rdv].sort((a, b) => a - b);
  };

  const irma = { cle: null, minute: entierEntre(0, 59) };
  const gromelin = { cle: null, rdv: tirerRdvGromelin(), fait: 0 };
  // L'amorce du démarrage : première heure déjà honorée ; le jour commence à
  // minuit, aucun passage de Gromelin n'est encore passé.
  irma.cle = 'J0T0';
  gromelin.cle = 'J0';
  gromelin.fait = gromelin.rdv.filter((x) => x <= 0).length;

  const irmaParHeure = new Map();
  const gromelinParJour = new Map();
  const minutesGromelin = [];

  for (let j = 0; j < 7; j++) {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        const jour = 'J' + j;
        const cleHeure = jour + 'T' + h;
        if (irma.cle !== cleHeure && m >= irma.minute) {
          irma.cle = cleHeure;
          irma.minute = entierEntre(0, 59);
          irmaParHeure.set(cleHeure, (irmaParHeure.get(cleHeure) || 0) + 1);
        }
        if (gromelin.cle !== jour) {
          gromelin.cle = jour;
          gromelin.rdv = tirerRdvGromelin();
          gromelin.fait = 0;
        }
        if (gromelin.fait < gromelin.rdv.length && h * 60 + m >= gromelin.rdv[gromelin.fait]) {
          gromelin.fait++;
          minutesGromelin.push(h * 60 + m);
          gromelinParJour.set(jour, (gromelinParJour.get(jour) || 0) + 1);
        }
      }
    }
  }

  // Irma : jamais deux fois dans la même heure, et jamais une heure sautée
  // (hors la toute première, amorcée au démarrage).
  for (const [cle, n] of irmaParHeure) assert.equal(n, 1, 'une seule Irma en ' + cle);
  assert.equal(irmaParHeure.size, 7 * 24 - 1,
    'toutes les heures de la semaine sauf celle du démarrage');

  // Gromelin : quatre fois par jour, chaque jour, jamais avant huit heures, et
  // jamais deux passages dans la même minute.
  assert.equal(gromelinParJour.size, 7);
  for (const [jour, n] of gromelinParJour) assert.equal(n, 4, 'quatre Gromelin le ' + jour);
  for (const mn of minutesGromelin) {
    assert.ok(mn >= GROMELIN_HEURE_MIN * 60 && mn <= GROMELIN_HEURE_MAX * 60 + 59,
      'Gromelin sort à la minute ' + mn + ', dans la tranche');
  }
  for (let i = 1; i < minutesGromelin.length; i++) {
    if (Math.floor(i / 4) === Math.floor((i - 1) / 4)) assert.ok(minutesGromelin[i] > minutesGromelin[i - 1], 'deux passages, deux minutes');
  }
});

test('m\'dam Irma ne dit plus « ça aure »', () => {
  assert.ok(!/ça aure/.test(SERVEUR), 'la faute a disparu');
  assert.match(SERVEUR, /Une b'nne configuration Frutale ça augure plein dé surprises sur lé site\./,
    'et la réplique est juste, patois compris');
});
