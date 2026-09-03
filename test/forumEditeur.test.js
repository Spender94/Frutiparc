'use strict';
/*
 * L'ÉDITEUR DU FORUM : LE BARRÉ, ET LA SÉLECTION QUI RESTE
 * ═══════════════════════════════════════════════════════
 *
 * Deux demandes de la même liste :
 *
 *   « Ajouter strikethrough sur le forum » — `renderBBCode` rendait déjà
 *   [s]…[/s] en <s>, mais aucun bouton de la barre ne l'écrivait. Un bouton
 *   « Barré », entre « Souligné » et la taille.
 *
 *   « Que le texte sélectionné ne se désélectionne pas après avoir appliqué
 *   une mise en forme » — `bbWrap` posait le curseur APRÈS le texte entouré ;
 *   pour mettre une phrase en italique puis en gras, il fallait la reprendre
 *   à la souris. La sélection reste maintenant sur le texte, sans ses
 *   balises : italique, gras, couleur, taille s'enchaînent.
 *
 * Le forum est une page, pas un module : on en extrait les fonctions de la
 * barre et on les fait tourner sur une zone de texte simulée.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

// Une fonction de la page, de `function nom(` à sa dernière accolade.
function fonction(nom) {
  const re = new RegExp('\\nfunction ' + nom + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n');
  const m = re.exec(PAGE);
  assert.ok(m, 'la page définit ' + nom);
  return m[0];
}

// La zone de texte simulée : `value`, la sélection, `setSelectionRange`.
function zone(texte, debut, fin) {
  return {
    value: texte, selectionStart: debut, selectionEnd: fin, foyers: 0,
    focus() { this.foyers++; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    selection() { return this.value.substring(this.selectionStart, this.selectionEnd); },
  };
}

function editeur(ta) {
  const code = 'var _openTagStacks = {};\n'
    + fonction('_ensureStack') + fonction('bbWrap') + fonction('bbToggleTag')
    + fonction('bbCloseAllTags') + fonction('bbInsertText') + fonction('bbInsertUrl')
    + fonction('bbInsertColorFromSelect') + fonction('bbInsertSizeFromSelect')
    + fonction('bbInsertList') + fonction('bbInsertCode');
  const bac = {
    document: { getElementById: (id) => (id === 'ta' ? ta : null) },
    prompt: () => 'https://frutiparc.example/lien',
  };
  vm.createContext(bac);
  vm.runInContext(code, bac);
  return bac;
}

test('le bouton « Barré » écrit [s]…[/s], que le rendu connaissait déjà', () => {
  assert.match(PAGE, /<button type="button" class="bb-btn" style="text-decoration:line-through" onclick="bbToggleTag\(\\'' \+ targetId \+ '\\',\\'s\\'\)" title="Barré">Barré<\/button>/);
  // Juste après « Souligné », avant la taille.
  const barre = /title="Souligné">Souligné<\/button>';\n\s*html \+= '<button[^\n]*title="Barré">Barré<\/button>';\n\s*html \+= selHtml\('size'/;
  assert.match(PAGE, barre);
  assert.match(PAGE, /out = out\.replace\(\/\\\[s\\\]\(\[\\s\\S\]\*\?\)\\\[\\\/s\\\]\/gi, '<s>\$1<\/s>'\);/);
});

test('une mise en forme garde le texte sélectionné, sans ses balises', () => {
  const ta = zone('la phrase en frisien ici', 10, 20);
  assert.strictEqual(ta.selection(), 'en frisien');
  const e = editeur(ta);
  e.bbToggleTag('ta', 'i');
  assert.strictEqual(ta.value, 'la phrase [i]en frisien[/i] ici');
  assert.strictEqual(ta.selection(), 'en frisien', 'toujours sélectionné, sans les balises');
  assert.strictEqual(ta.foyers, 1, 'et la zone a repris le clavier');
  // Le gras s'enchaîne sur la même sélection : pas besoin de la reprendre.
  e.bbToggleTag('ta', 'b');
  assert.strictEqual(ta.value, 'la phrase [i][b]en frisien[/b][/i] ici');
  assert.strictEqual(ta.selection(), 'en frisien');
  e.bbToggleTag('ta', 's');
  assert.strictEqual(ta.value, 'la phrase [i][b][s]en frisien[/s][/b][/i] ici');
  assert.strictEqual(ta.selection(), 'en frisien');
});

test('la couleur, la taille, le lien, le code et la liste gardent la sélection aussi', () => {
  const ta = zone('un mot', 3, 6);
  const e = editeur(ta);
  const menu = { value: '#FF6600', selectedIndex: 1 };
  e.bbInsertColorFromSelect('ta', menu);
  assert.strictEqual(ta.value, 'un [color=#FF6600]mot[/color]');
  assert.strictEqual(ta.selection(), 'mot');
  assert.strictEqual(menu.selectedIndex, 0, 'le menu déroulant revient sur son titre');
  e.bbInsertSizeFromSelect('ta', { value: '18', selectedIndex: 5 });
  assert.strictEqual(ta.value, 'un [color=#FF6600][taille=18]mot[/taille][/color]');
  assert.strictEqual(ta.selection(), 'mot');
  e.bbInsertUrl('ta');
  assert.strictEqual(ta.value, 'un [color=#FF6600][taille=18][url=https://frutiparc.example/lien]mot[/url][/taille][/color]');
  assert.strictEqual(ta.selection(), 'mot');
  e.bbInsertCode('ta');
  assert.strictEqual(ta.selection(), 'mot');
  assert.ok(ta.value.indexOf('[code]mot[/code]') > 0);
  e.bbInsertList('ta');
  assert.strictEqual(ta.selection(), 'mot');
  assert.ok(ta.value.indexOf('[liste]\n[*]mot\n[/liste]') > 0);
});

test('sans sélection, rien ne change : la balise ouvrante seule, à fermer plus tard', () => {
  const ta = zone('salut ', 6, 6);
  const e = editeur(ta);
  e.bbToggleTag('ta', 'b');
  assert.strictEqual(ta.value, 'salut [b]');
  assert.strictEqual(ta.selectionStart, 9);
  assert.strictEqual(ta.selectionEnd, 9, 'le curseur, pas une sélection');
  e.bbInsertColorFromSelect('ta', { value: '#6666CC', selectedIndex: 2 });
  assert.strictEqual(ta.value, 'salut [b][color=#6666CC]');
  ta.value += 'toi'; ta.selectionStart = ta.selectionEnd = ta.value.length;
  e.bbCloseAllTags('ta');
  assert.strictEqual(ta.value, 'salut [b][color=#6666CC]toi[/color][/b]');
  // Un lien sans sélection : l'adresse sert de texte, le curseur après.
  e.bbInsertUrl('ta');
  assert.ok(/\[url=https:\/\/frutiparc\.example\/lien\]https:\/\/frutiparc\.example\/lien\[\/url\]$/.test(ta.value));
  assert.strictEqual(ta.selectionStart, ta.value.length);
  // Le code sans sélection : le curseur ENTRE les balises.
  e.bbInsertCode('ta');
  assert.strictEqual(ta.value.substring(ta.selectionStart - 6, ta.selectionStart + 7), '[code][/code]');
  assert.strictEqual(ta.selectionStart, ta.selectionEnd);
});
