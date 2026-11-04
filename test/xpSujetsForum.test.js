'use strict';
/*
 * LES SUJETS DU FORUM — on ne pousse personne à en ouvrir à la chaîne.
 *
 *   · l'XP ne paie plus qu'un sujet par jour (trois, c'était une invitation
 *     au spam) ; les réponses restent payées comme avant ;
 *   · aucune quête (vie du parc, bricoles de Gromelin, premiers pas) ne
 *     demande plus d'un sujet.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Q = require('../quetes.js');

const SERVEUR = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('l’XP ne paie qu’un sujet de forum par jour', () => {
  assert.match(SERVEUR, /forumTopic: \{ base: 2500, cap: 1 {2}\}/);
  assert.match(SERVEUR, /forumPost: {2}\{ base: 1250, cap: 8 {2}\}/, 'les réponses ne bougent pas');
});

test('aucune quête ne demande plus d’un sujet', () => {
  const toutes = [Q.PARC, Q.GROMELIN, Q.PREMIERS_PAS, Q.CATALOGUE]
    .flatMap((t) => (Array.isArray(t) ? t : Object.values(t || {})));
  const sujets = toutes.filter((x) => x && x.params
    && (x.params.action === 'forumTopic' || (x.params.actions || []).includes('forumTopic')));
  assert.ok(sujets.length >= 2, 'les quêtes de forum sont bien là');
  for (const x of sujets) assert.ok((x.params.n || 1) <= 1, (x.titre || x.id) + ' : ' + x.params.n);
  assert.strictEqual(Q.PARC['parc-sujet'].params.n, 1);
});
