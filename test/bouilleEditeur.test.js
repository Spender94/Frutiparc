/*
 * « Ma Frutibouille » — l'éditeur de visage du light, et LE SAC À PATATE.
 *
 * À l'époque, qui n'avait pas encore fait sa bouille portait un sac en papier
 * sur la tête : c'est la coiffure 1 de la famille 0, et la bouille par défaut
 * la porte. Sur le mobile, l'éditeur s'ouvrait donc SUR LE SAC — qui couvre
 * tout le visage. On changeait d'yeux, d'iris, de bouche… sans rien voir
 * changer : impossible de concevoir sa bouille à la première connexion.
 *
 * Trois coiffures sont en fait le sac (1 plein, 2 soulevé, 3 porté en
 * bonnet). On ne les propose plus, et l'éditeur quitte le sac à l'ouverture.
 * Le DESSIN, lui, reste : les bouilles déjà enregistrées avec un sac
 * s'affichent partout comme avant — on retire l'option, pas l'asset.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

/**
 * L'éditeur, extrait du light et exécuté pour de bon : on rejoue les
 * fonctions de défilement sur un état, sans navigateur.
 */
function editeur() {
  const bloc = (nom) => {
    const i = LIGHT.indexOf('function ' + nom);
    assert.ok(i > 0, 'fonction ' + nom + ' introuvable dans light.html');
    // Jusqu'à l'accolade fermante de la fonction, comptée à la main.
    let p = LIGHT.indexOf('{', i);
    let n = 0;
    for (let j = p; j < LIGHT.length; j++) {
      if (LIGHT[j] === '{') n++;
      else if (LIGHT[j] === '}' && --n === 0) return LIGHT.substring(i, j + 1);
    }
    throw new Error('fonction ' + nom + ' non refermée');
  };
  const src = [
    LIGHT.match(/var FB_SAC = \[[^\]]*\];/)[0],
    LIGHT.match(/var FB_PARTS = \[[\s\S]*?\n {2}\];/)[0],
    'var fbState = "000000010000000000000000";',
    bloc('fbDecChar'), bloc('fbEncChar'), bloc('fbGet'), bloc('fbSet'),
    bloc('fbChoix'),
    // fbCycle touche à l'affichage : on neutralise ce qui sort du calcul.
    bloc('fbCycle')
      .replace(/if \(part\.color\) fbRefreshBar\(part\);/, '')
      .replace(/else fbRefreshLabel\(part\);/, '')
      .replace(/fbRenderPreviewSoon\(\);/, ''),
    'return { FB_SAC: FB_SAC, FB_PARTS: FB_PARTS, fbChoix: fbChoix, fbCycle: fbCycle,'
      + ' get: function (p) { return fbGet(p); },'
      + ' set: function (p, v) { fbSet(p, v); },'
      + ' etat: function () { return fbState; } };',
  ].join('\n');
  return new Function(src)();   // eslint-disable-line no-new-func
}

test('le sac à patate n\'est plus proposé parmi les coiffures', () => {
  const e = editeur();
  assert.deepEqual(e.FB_SAC, [1, 2, 3], 'le sac plein, le sac soulevé, le sac en bonnet');
  const cheveux = e.FB_PARTS.find((p) => p.key === 'cheveux');
  assert.deepEqual(cheveux.saute, e.FB_SAC, 'la ligne « cheveux » les écarte');
  const choix = e.fbChoix(cheveux);
  assert.equal(choix.length, 64, '67 coiffures moins les trois sacs');
  for (const sac of e.FB_SAC) {
    assert.ok(!choix.includes(sac), 'la coiffure ' + sac + ' n\'est plus offerte');
  }
  assert.ok(choix.includes(0), 'le crâne nu reste — c\'est un choix, pas un sac');
  assert.ok(choix.includes(66), 'et la dernière coiffure aussi');
  // Les autres lignes ne sautent rien : on ne retire que le sac.
  for (const p of e.FB_PARTS.filter((x) => x.key !== 'cheveux')) {
    assert.ok(!p.saute, p.key + ' garde toutes ses valeurs');
  }
});

test('les flèches enjambent le sac, dans les deux sens et au tour du compteur', () => {
  const e = editeur();
  const cheveux = e.FB_PARTS.find((p) => p.key === 'cheveux');
  // Depuis le crâne nu, en avant : on saute 1, 2, 3 pour tomber sur 4.
  e.set(6, 0);
  e.fbCycle(cheveux, 1);
  assert.equal(e.get(6), 4, 'en avant, le sac est enjambé');
  // En arrière depuis le crâne nu : on repart de la fin, pas du sac.
  e.set(6, 0);
  e.fbCycle(cheveux, -1);
  assert.equal(e.get(6), 66, 'en arrière, le tour passe par la dernière coiffure');
  // Et de la dernière, en avant, on revient au crâne nu.
  e.fbCycle(cheveux, 1);
  assert.equal(e.get(6), 0);
  // Une VIEILLE bouille posée sur un sac : la flèche rejoint la liste au lieu
  // de tourner dans le vide.
  e.set(6, 2);
  e.fbCycle(cheveux, 1);
  assert.ok(!e.FB_SAC.includes(e.get(6)), 'on quitte le sac : ' + e.get(6));
  e.set(6, 2);
  e.fbCycle(cheveux, -1);
  assert.ok(!e.FB_SAC.includes(e.get(6)), 'dans l\'autre sens aussi : ' + e.get(6));
});

test('l\'éditeur s\'ouvre sur un visage VISIBLE, jamais sous le sac', () => {
  // La bouille par défaut porte le sac (coiffure 1) — c'est la marque
  // d'époque du joueur qui n'a pas encore fait sa tête.
  const defaut = /var DEFAULT_BOUILLE = "([^"]+)"/.exec(LIGHT)[1];
  const e = editeur();
  e.set(6, 0);                     // repartir d'un état neutre
  const cheveuxDefaut = (defaut.charCodeAt(6) - 48) * 62 + (defaut.charCodeAt(7) - 48);
  assert.ok(e.FB_SAC.includes(cheveuxDefaut),
    'la bouille par défaut porte bien le sac — c\'est le problème qu\'on corrige');
  // openFbEditor quitte le sac dès l'ouverture.
  const ouvre = LIGHT.substring(LIGHT.indexOf('function openFbEditor'),
    LIGHT.indexOf('function closeFbEditor'));
  assert.match(ouvre, /FB_SAC\.indexOf\(fbGet\(6\)\) >= 0\) fbSet\(6, 0\)/,
    'sous le sac, l\'ouverture bascule sur le crâne nu');
});

test('le compteur se lit sur les coiffures PROPOSÉES (1/64, pas 2/67)', () => {
  // Le libellé compte la place dans la liste offerte : sans ça, il sauterait
  // des numéros au passage du sac.
  const src = LIGHT.substring(LIGHT.indexOf('function fbRefreshLabel'),
    LIGHT.indexOf('function fbRefreshLabels'));
  assert.match(src, /fbChoix\(part\)/, 'le libellé passe par la liste offerte');
  assert.match(src, /choix\.length/, 'et le total est celui de cette liste');
  assert.ok(!/part\.max \+ 1/.test(src), 'plus le total brut du sprite');
});
