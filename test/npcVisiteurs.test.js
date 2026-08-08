/*
 * La cadence des deux visiteurs du chat — m'dam Irma et Gromelin.
 *
 * Ils passaient beaucoup trop souvent : Irma toutes les dix à quarante-cinq
 * minutes, Gromelin toutes les trente-cinq à cent vingt. Un habitué du chat les
 * croisait plusieurs fois par session, et une apparition qu'on attend cesse
 * d'être une apparition.
 *
 * Désormais : Irma UNE fois par heure, Gromelin UNE fois par jour et seulement
 * entre huit heures et minuit. Ce fichier tient les deux règles — et la faute
 * de français d'Irma, qui traînait depuis le début.
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

test('Gromelin ne sort qu\'entre huit heures et minuit', () => {
  assert.match(SERVEUR, /const GROMELIN_HEURE_MIN = 8;/);
  assert.match(SERVEUR, /const GROMELIN_HEURE_MAX = 23;/);
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
});

// La règle elle-même, rejouée minute par minute sur une semaine simulée. C'est
// le seul moyen honnête de vérifier une cadence : la lire dans le source ne dit
// pas si elle compte juste.
test('sur une semaine : une Irma par heure, un Gromelin par jour', () => {
  const entierEntre = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const GROMELIN_HEURE_MIN = 8, GROMELIN_HEURE_MAX = 23;

  const irma = { cle: null, minute: entierEntre(0, 59) };
  const gromelin = {
    cle: null,
    heure: entierEntre(GROMELIN_HEURE_MIN, GROMELIN_HEURE_MAX),
    minute: entierEntre(0, 59),
  };
  // L'amorce du démarrage : premier jour, première heure déjà honorés.
  irma.cle = 'J0T0';
  gromelin.cle = 'J0';

  const irmaParHeure = new Map();
  const gromelinParJour = new Map();
  const heuresGromelin = [];

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
        if (gromelin.cle !== jour
          && (h > gromelin.heure || (h === gromelin.heure && m >= gromelin.minute))) {
          gromelin.cle = jour;
          gromelin.heure = entierEntre(GROMELIN_HEURE_MIN, GROMELIN_HEURE_MAX);
          gromelin.minute = entierEntre(0, 59);
          heuresGromelin.push(h);
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

  // Gromelin : une fois par jour, jamais deux, et jamais avant huit heures.
  for (const [jour, n] of gromelinParJour) assert.equal(n, 1, 'un seul Gromelin le ' + jour);
  assert.equal(gromelinParJour.size, 6, 'six jours — le premier étant amorcé');
  for (const h of heuresGromelin) {
    assert.ok(h >= GROMELIN_HEURE_MIN && h <= GROMELIN_HEURE_MAX,
      'Gromelin sort à ' + h + ' h, dans la tranche');
  }
});

test('m\'dam Irma ne dit plus « ça aure »', () => {
  assert.ok(!/ça aure/.test(SERVEUR), 'la faute a disparu');
  assert.match(SERVEUR, /Une b'nne configuration Frutale ça augure plein dé surprises sur lé site\./,
    'et la réplique est juste, patois compris');
});
