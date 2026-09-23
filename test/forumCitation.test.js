'use strict';
/*
 * Forum : citer un long message n'en recopie que le début, suivi de « [...] ».
 *
 * La fonction vit dans la page (public/fb/index.html) ; on l'en extrait telle
 * quelle, et l'on vérifie la coupe sur les cas qui comptent : un message
 * court passe intact, un long est coupé sur un blanc, les citations qu'il
 * contenait disparaissent, le BBCode reste bien formé (mise en forme
 * refermée, image ou lien jamais coupés en deux), et le rendu du forum n'y
 * voit ni balise orpheline ni crochet perdu.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'fb', 'index.html'), 'utf8');
const debut = PAGE.indexOf('var CITATION_MAX');
const fin = PAGE.indexOf('function quotePost');
// eslint-disable-next-line no-new-func
const { abregerCitation, CITATION_MAX } = new Function(PAGE.slice(debut, fin) + '\nreturn { abregerCitation, CITATION_MAX };')();

const LONG = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12);
// Le texte visible : sans balises ni « [...] ».
const visible = (t) => t.replace(/ \[\.\.\.\]$/, '').replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, '');
// Toutes les balises ouvertes sont fermées, dans l'ordre.
function bienForme(t) {
  const pile = [];
  for (const m of t.matchAll(/\[(\/?)([a-z]+)(?:=[^\]]*)?\]/gi)) {
    const nom = m[2].toLowerCase();
    if (m[1]) { if (pile.pop() !== nom) return false; } else pile.push(nom);
  }
  return pile.length === 0;
}

test('un message court passe intact, un long est coupé sur un blanc et finit par [...]', () => {
  assert.strictEqual(CITATION_MAX, 300);
  assert.strictEqual(abregerCitation('Court message.'), 'Court message.');
  assert.strictEqual(abregerCitation('x'.repeat(300)), 'x'.repeat(300), 'pile la limite : rien ne change');
  const c = abregerCitation(LONG);
  assert.ok(c.endsWith(' [...]'), c);
  assert.ok(visible(c).length <= CITATION_MAX && visible(c).length > CITATION_MAX - 60, visible(c).length);
  assert.ok(LONG.startsWith(visible(c)), 'le début du message, tel quel');
  assert.match(visible(c), /\S$/, 'pas de blanc avant [...]');
  // Coupé sur un mot entier : ce qui suit la coupe commence par un blanc.
  assert.match(LONG.slice(visible(c).length), /^\s/);
});

test('les citations que le message contenait sont retirées', () => {
  assert.strictEqual(abregerCitation('[quote=Bob]\nvieux truc\n[/quote]\nMa réponse.'), 'Ma réponse.');
  assert.strictEqual(abregerCitation('[quote=A]\n[quote=B]\nx\n[/quote]\ny\n[/quote]\n\n\n\nMoi.'), 'Moi.');
  assert.strictEqual(abregerCitation('[citation]a[/citation]'), '[...]', 'rien d’autre qu’une citation');
});

test('le BBCode reste bien formé : mise en forme refermée, image et lien jamais coupés', () => {
  for (const [ouvre, ferme] of [['[b]', '[/b]'], ['[i][u]', '[/u][/i]'], ['[color=red]', '[/color]'], ['[size=14]', '[/size]']]) {
    const c = abregerCitation(ouvre + LONG + ferme + ' la suite');
    assert.ok(bienForme(c), c);
    assert.ok(c.endsWith(' [...]'), c);
  }
  // Une image qui chevauche la limite : on coupe avant elle.
  const img = '[img]/forum-uploads/0123456789abcdef0123456789abcdef.png[/img]';
  const c = abregerCitation('mot '.repeat(70) + img + ' ' + LONG);
  assert.ok(c.indexOf('[img]') < 0 && c.indexOf('forum-uploads') < 0, c);
  assert.ok(bienForme(c));
  // Une image avant la limite reste entière.
  const d = abregerCitation('Regarde : ' + img + ' ' + LONG);
  assert.ok(d.indexOf(img) > 0, d);
  // Un lien pareil.
  const e = abregerCitation('mot '.repeat(72) + '[url=https://exemple.fr]un lien assez long pour chevaucher[/url] ' + LONG);
  assert.ok(e.indexOf('[url') < 0, e);
  // Jamais de balise tronquée en fin.
  for (let n = 280; n < 320; n++) {
    const f = abregerCitation('x'.repeat(n) + '[b]gras[/b] ' + LONG);
    assert.ok(bienForme(f), f.slice(-40));
    assert.doesNotMatch(f.replace(/ \[\.\.\.\]$/, ''), /\[[^\]]*$/, f.slice(-40));
  }
});

test('citer passe par l’abrégé', () => {
  assert.match(PAGE, /var text = abregerCitation\(tmp\.value\);/);
});
