'use strict';
/*
 * LE SID NE RESTE PAS DANS LA BARRE D'ADRESSE DU LIGHT.
 *
 * La connexion mène à `/light?sid=…` ; laissé dans l'adresse, le sid passait
 * dans chaque capture d'écran partagée, et avec lui le compte. Le Light le
 * range dans son stockage puis le retire de l'adresse — seulement s'il a bien
 * été gardé, et sans toucher aux autres paramètres (liens de notification).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const LIGHT = fs.readFileSync(path.join(__dirname, '..', 'public', 'light.html'), 'utf8');

function extraire(nom) {
  const i = LIGHT.indexOf('function ' + nom + '(');
  assert.ok(i > 0, nom + ' existe');
  let n = 0, j = LIGHT.indexOf('{', i);
  for (let k = j; k < LIGHT.length; k++) {
    if (LIGHT[k] === '{') n++;
    else if (LIGHT[k] === '}' && --n === 0) return LIGHT.slice(i, k + 1);
  }
  throw new Error('fin de ' + nom + ' introuvable');
}

function monter(adresse, stockage) {
  const u = new URL(adresse, 'https://frutiparc.test');
  const remplacements = [];
  const ctx = {
    SESS_KEY: 'fp_light_session', URLSearchParams, JSON,
    localStorage: stockage,
    window: { location: { search: u.search, pathname: u.pathname, hash: u.hash } },
    history: { state: null, replaceState: (s, t, url) => remplacements.push(url) },
  };
  vm.createContext(ctx);
  vm.runInContext(extraire('retirerSidDeLAdresse'), ctx);
  return { ctx, remplacements };
}
const stockageAvec = (sid) => ({ getItem: () => JSON.stringify({ sid, user: 'x' }) });
const SID = 'a'.repeat(32);

test('le sid gardé est retiré de l\'adresse, le reste demeure', () => {
  const { ctx, remplacements } = monter('/light?sid=' + SID + '&ouvre=prive&avec=kobbs#bas', stockageAvec(SID));
  ctx.retirerSidDeLAdresse(SID);
  assert.deepStrictEqual(remplacements, ['/light?ouvre=prive&avec=kobbs#bas']);
});

test('adresse réduite à /light quand le sid était seul', () => {
  const { ctx, remplacements } = monter('/light?sid=' + SID, stockageAvec(SID));
  ctx.retirerSidDeLAdresse(SID);
  assert.deepStrictEqual(remplacements, ['/light']);
});

test('stockage vide, autre sid ou bloqué : l\'adresse reste, un F5 ne déconnecte pas', () => {
  for (const stockage of [
    { getItem: () => null },
    stockageAvec('b'.repeat(32)),
    { getItem: () => { throw new Error('bloqué'); } },
  ]) {
    const { ctx, remplacements } = monter('/light?sid=' + SID, stockage);
    ctx.retirerSidDeLAdresse(SID);
    assert.deepStrictEqual(remplacements, []);
  }
});

test('appelé à l\'arrivée, juste après que le sid de l\'adresse est rangé', () => {
  assert.match(LIGHT, /if \(urlSid\) \{\s*state\.sid = urlSid; saveSession\(\);\s*retirerSidDeLAdresse\(urlSid\);/);
});

test('les jeux, eux, gardent le sid dans LEUR adresse (scores par Referer)', () => {
  assert.match(LIGHT, /return a \? a \+ "\?sid=" \+ encodeURIComponent\(state\.sid \|\| ""\) : null;/);
  assert.match(LIGHT, /"\/game-popup\.html\?swf="[\s\S]{0,200}"&sid=" \+ encodeURIComponent\(state\.sid \|\| ""\)/);
});
