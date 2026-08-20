/*
 * La dernière connexion sur la fiche — des DEUX côtés.
 *
 * Le serveur la connaît depuis toujours (last_login, écrite à chaque
 * identification) et la sert dans l'attribut `lc` des deux réponses userinfo.
 * Le mobile l'affiche déjà (test/ficheEdition.test.js). Restait le bureau,
 * dont le code est compilé : la rustine
 * scripts/patch-main-frutiz-derniere-connexion.js pose dans legacy/main.swf un
 * DoInitAction qui ENVELOPPE trois méthodes plutôt que d'en réécrire une —
 *
 *   · FrutizInfo.onUserInfo garde `lc` à côté de `comment` et `url` ;
 *   · win.Frutiz.getMenuLine, dont le tableau ouvre la liste des lignes,
 *     ajoute pour la seule page « bonus » le titre et la date ;
 *   · win.Frutiz.getPageObj retire ensuite « aucune info », qui n'a plus lieu
 *     d'être.
 *
 * Ce fichier tient le RÉSULTAT dans le SWF livré : le tag est là, il enveloppe
 * bien ces trois-là, et il n'a pas abîmé le flux de tags. Le rendu, lui, a été
 * regardé sous Ruffle : « dernière connexion / jeu 20 aout 26 à 17:24 » en tête
 * de la rubrique, au-dessus de « Site Internet » et « Commentaire » ; et, sur
 * une fiche vierge, cette même ligne À LA PLACE de « aucune info ». Les onglets
 * frutiz, perso et scores rendent comme avant.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SWF = path.join(ROOT, 'legacy/main.swf');
const MARQUE = 'fpLcVieuxUserInfo';

function corpsSwf() {
  const raw = fs.readFileSync(SWF);
  const sig = raw.slice(0, 3).toString('ascii');
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

/** Les tags de premier niveau, pour vérifier que le flux se relit en entier. */
function tags(b) {
  const out = [];
  let o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  while (o < b.length - 1) {
    const hdr = b.readUInt16LE(o); const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); h = 6; }
    if (code === 0) return { out, fin: o };
    out.push({ code, o, h, len });
    o += h + len;
  }
  return { out, fin: -1 };
}

test('le bureau porte la rustine, et son flux de tags se relit en entier', () => {
  const b = corpsSwf();
  assert.ok(b.indexOf(MARQUE) >= 0,
    'legacy/main.swf doit être passé sous scripts/patch-main-frutiz-derniere-connexion.js');

  const { out, fin } = tags(b);
  assert.ok(fin > 0, 'le fichier se termine par un tag de fin, pas au milieu d’un tag');
  // Le tag ajouté : un DoInitAction (59) qui contient la marque.
  const notre = out.filter((t) => t.code === 59
    && b.slice(t.o + t.h, t.o + t.h + t.len).indexOf(MARQUE) >= 0);
  assert.equal(notre.length, 1, 'un seul tag porte la marque — la rustine ne s’empile pas');

  // Il doit venir APRÈS les deux classes qu'il enveloppe, sans quoi il
  // écraserait des méthodes qui n'existent pas encore.
  const apres = out.filter((t) => t.code === 59).filter((t) => {
    const c = b.slice(t.o + t.h, t.o + t.h + t.len);
    return (c.indexOf('FrutizInfo') >= 0 && c.indexOf('onUserInfo') >= 0)
      || (c.indexOf('getMenuLine') >= 0 && c.indexOf('getPageObj') >= 0);
  });
  assert.equal(apres.length, 3, 'les deux classes, plus notre enveloppe');
  assert.equal(apres[2].o, notre[0].o, 'notre tag passe en dernier');
});

test('l’enveloppe touche les trois méthodes attendues, et rien d’autre', () => {
  const b = corpsSwf();
  const { out } = tags(b);
  const t = out.find((x) => x.code === 59
    && b.slice(x.o + x.h, x.o + x.h + x.len).indexOf(MARQUE) >= 0);
  const corps = b.slice(t.o + t.h + 2, t.o + t.h + t.len).toString('latin1');

  for (const nom of ['FrutizInfo', 'onUserInfo', 'win', 'Frutiz', 'getMenuLine', 'getPageObj']) {
    assert.ok(corps.indexOf(nom + '\0') >= 0, 'le code doit nommer ' + nom);
  }
  // Les originaux sont mis de côté sur _global : une variable de pellicule ne
  // survivrait pas à la fin du DoInitAction.
  for (const cle of ['fpLcVieuxUserInfo', 'fpLcVieuxMenu', 'fpLcVieuxPage']) {
    assert.ok(corps.indexOf(cle + '\0') >= 0, 'l’original doit être gardé sous ' + cle);
  }
  // La date est mise en forme par le CLIENT, comme la date d'inscription : le
  // serveur n'envoie qu'une date brute et ne choisit pas la langue.
  assert.ok(corps.indexOf('formatDateString\0') >= 0, 'la date passe par Lang');
  assert.ok(corps.indexOf('sentence_year_short\0') >= 0,
    'au format « $A $d $M $y à $H:$I »');
  assert.ok(b.indexOf('format_sentence_year_short') >= 0,
    'format que le SWF connaît bien (table de langue d’origine)');
  // Le titre, et celui qu'il remplace.
  assert.ok(corps.indexOf(Buffer.from('dernière connexion', 'utf8').toString('latin1')) >= 0,
    'le titre de la ligne');
  assert.ok(corps.indexOf('aucune info\0') >= 0, 'et le titre qu’elle rend inutile');
  // La rubrique visée, et une seule : les trois autres pages ne sont même pas
  // nommées, donc rien ne peut leur arriver.
  assert.ok(corps.indexOf('bonus\0') >= 0, 'la rubrique « bonus » est visée');
  for (const autre of ['perso', 'scores', 'frutiz']) {
    assert.ok(corps.indexOf(autre + '\0') < 0,
      'la page « ' + autre + ' » n’est pas touchée');
  }
});

test('reposer la rustine ne fait rien : elle se reconnaît', () => {
  const avant = fs.readFileSync(SWF);
  const sortie = execFileSync(process.execPath,
    [path.join(ROOT, 'scripts/patch-main-frutiz-derniere-connexion.js')], { encoding: 'utf8' });
  assert.match(sortie, /déjà posée/, 'la rustine se voit déjà là');
  assert.ok(avant.equals(fs.readFileSync(SWF)), 'et n’a pas touché un octet');
});

test('le serveur sert la même date aux deux clients, chacun à sa façon', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Une seule source : le last_login du compte, écrit à chaque identification.
  assert.match(src, /function getDerniereConnexion\(user\) \{\s*\n\s*return user && user\.lastLogin/,
    'la date vient du dernier passage du joueur');
  // Le bureau la reçoit au format à points des autres dates de la fiche, dans
  // l'attribut `lc` du XML userinfo — c'est lui que la rustine du SWF lit.
  assert.equal((src.match(/lc="\$\{escapeXml\(getDerniereConnexion/g) || []).length, 2,
    'sur les deux réponses userinfo : la sienne et celle d’un autre');
  // Le mobile, lui, reçoit l'horodatage brut et le tourne à sa manière
  // (« aujourd’hui à 17:24 ») : c'est du HTML, il n'a pas la table de langue
  // du SWF.
  assert.match(src, /derniereConnexion: ud\.lastLogin \|\| ''/,
    'la fiche du mobile porte le même instant, non mis en forme');
});
