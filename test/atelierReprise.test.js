'use strict';
/*
 * REPRENDRE UN ACCESSOIRE MAISON — L'ENCART 5 DE L'ATELIER
 *
 * « Permettre de télécharger le SVG d'un accessoire créé (accessoire maison)
 * sur /bouille-accessoire.html. »
 *
 * Un accessoire publié n'existe nulle part sous forme de fichier : ses tracés
 * vivent dans le catalogue des variantes, et le graphiste qui a perdu son SVG
 * n'avait aucun moyen de le retrouver. L'atelier savait pourtant déjà fabriquer
 * un gabarit — c'est ce que font les encarts 1 et 4. Il ne manquait qu'une
 * source : le catalogue lui-même.
 *
 * Trois pièces, et rien de plus :
 *   · le catalogue public porte désormais le NOM et l'AUTEUR de chaque
 *     variante (les deux s'affichent déjà en boutique) ;
 *   · la reprise monte la variante sur une famille NEUVE — on ne touche pas au
 *     rouleau de l'atelier, qui sert aux autres encarts ;
 *   · et chaque reprise porte son NUMÉRO DE TOUR : charger la famille est
 *     asynchrone, et sans lui une reprise qui rentrait en retard faisait
 *     télécharger le dessin d'avant sous le nom du nouveau.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public/bouille-accessoire.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('le catalogue public dit qui a dessiné quoi', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf("app.get('/api/light/variantes'"),
    SERVEUR.indexOf("app.get('/api/admin/variantes'"));
  assert.match(bloc, /nom: String\(v\.nom \|\| ''\), auteur: String\(v\.auteur \|\| ''\),/);
  // Les tracés y étaient déjà — c'est eux qu'on redonne.
  assert.match(bloc, /paths: v\.retire \? \[\] : v\.paths/);
});

test('l’encart 5 existe, et il ne propose que ce qui est dessiné', () => {
  assert.match(PAGE, /<h2>5 · Reprendre un accessoire maison<\/h2>/);
  assert.match(PAGE, /<select id="mai-liste">/);
  assert.match(PAGE, /<canvas id="mai-apercu"/);
  assert.match(PAGE, /<button class="btn plein" id="mai-dl" disabled>/,
    'le bouton n’est actif qu’une fois la reprise montée');
  // Famille 0, publiée, et qui porte quelque chose.
  assert.match(PAGE, /return \(v\.famille \|\| 0\) === 0 && !v\.retire && v\.paths && v\.paths\.length;/);
});

test('la reprise ne touche pas au rouleau de l’atelier', () => {
  const bloc = PAGE.slice(PAGE.indexOf('function reprendreMaison()'),
    PAGE.indexOf('$("#mai-dl").addEventListener'));
  // Une famille NEUVE à chaque fois : `defs`, celui des encarts 1 à 4, n'est
  // jamais réécrit.
  assert.match(bloc, /return Swf\.charger\("\/fbouille\/famille0\.swf"\)\.then\(function \(d\) \{/);
  assert.match(bloc, /maisonDefs = d;/);
  assert.ok(!/\bdefs = d;/.test(bloc), 'le rouleau de l’atelier reste intact');
  assert.match(bloc, /maisonInj = V\.injecter\(d, \{ type: v\.type, paths: v\.paths \|\| \[\],/);
});

test('une reprise en retard ne fait pas télécharger le dessin d’avant', () => {
  assert.match(PAGE, /var maisonTour = 0;/);
  assert.match(PAGE, /var tour = \+\+maisonTour;/);
  assert.match(PAGE, /if \(tour !== maisonTour\) return;\s+\/\/ une autre reprise a pris la main/);
});

test('le téléchargement passe par le même gabarit que les autres encarts', () => {
  const bloc = PAGE.slice(PAGE.indexOf('$("#mai-dl").addEventListener'),
    PAGE.indexOf('$("#mai-liste").addEventListener'));
  assert.match(bloc, /V\.exporterSVG\(maisonDefs, \{/);
  assert.match(bloc, /type: v\.type, variante: maisonInj\.variante, coiffure: co,/);
  // La tête de repère vient de la famille 0 de l'atelier : c'est sur une
  // bouille classique qu'on retouche.
  assert.match(bloc, /fondTete: V\.fondTete\(defs, co, 512\),/);
  assert.match(bloc, /a\.download = "maison-"/);
});
