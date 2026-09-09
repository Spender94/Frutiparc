'use strict';
/*
 * DEUX ÉMOTES EMPRUNTÉES À D'AUTRES FAMILLES
 * ══════════════════════════════════════════
 *
 * « J'aimerais permettre à tout le monde d'utiliser l'émote "regarde
 * ailleurs" de hiko (famille 12). Ce qui m'intéresse, c'est la fin de
 * l'émote : il y a une explosion et un chocapic qui apparaît. […] J'aimerais
 * aussi reprendre le "tousse" de la famille 15 en éliminant la bulle de
 * chewing gum. »
 *
 * Le relevé des dix familles en donne quatre qui ont une chute que la
 * famille 0 n'a pas. Deux valaient d'être partagées :
 *
 *   JUTSU (famille 12). Après « regarde ailleurs », le visage disparaît dans
 *   la fumée et il ne reste qu'un chocapic. Le gag n'a rien de ninja : il
 *   marche sur n'importe quelle bouille. Deux dessins le portent — la fumée
 *   (six formes qui se relaient) et le chocapic — et ils n'existent que dans
 *   famille12.swf : c'est eux, et eux seuls, qu'on récolte.
 *
 *   TOUSSE (famille 15). La tête entière sursaute sur une courbe de six
 *   images, et un NUAGE la couvre — « c'est ce qui fait tout le charme de
 *   l'animation ». On emporte donc les six matrices ET le nuage ; c'est la
 *   BULLE de chewing-gum qu'on laisse chez elle, pas ce qu'elle produit.
 *
 * CE QU'ON N'EMPORTE PAS : les pellicules. La chute d'hiko vit dans les
 * images 129 à 148 de SON visage, avec ses scripts et ses boucles d'attente ;
 * rien de cela n'a de place dans un visage qui n'a pas ces images. Le moteur
 * rejoue donc le déroulé lui-même, au battement près du relevé.
 *
 * Ce fichier tient les trois choses qui peuvent se défaire : la récolte (son
 * contenu et ses numéros), le déroulé (ce qui paraît, quand, et pour combien
 * de temps), et le câblage du chat.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const VIGNETTE = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const PAQUET = JSON.parse(fs.readFileSync(path.join(DOSSIER, 'emotes.json'), 'utf8'));

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}
const paire = (n) => Moteur.encode62(n, 2);
const ETAT = [0, 1, 0, 4, 1, 15, 22, 0, 0, 0, 0, 0].map(paire).join('');

function monter(defs) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  mo.greffer(PAQUET);
  return mo;
}

// ══ LA RÉCOLTE ════════════════════════════════════════════════════════════

test('la récolte ne prend que les dessins de la chute, et les renumérote', () => {
  // Cinq clips — la fumée d'hiko, son chocapic, sa BULLE de chewing-gum, sa
  // tache, et le nuage de la toux — et les dix-sept formes qu'ils portent.
  assert.strictEqual(Object.keys(PAQUET.sprites).length, 5, 'cinq clips');
  assert.strictEqual(Object.keys(PAQUET.formes).length, 17, 'dix-sept formes');
  // AU-DELÀ DE LA PLAGE D'UN SWF. Un caractère d'hiko porte un numéro sur
  // seize bits, et la famille d'accueil a le sien au même : #415 est le
  // chocapic chez hiko et tout autre chose dans la famille 0.
  Object.keys(PAQUET.formes).concat(Object.keys(PAQUET.sprites)).forEach((id) => {
    assert.ok(Number(id) > 65535, 'le numéro ' + id + ' doit sortir de la plage d’un SWF');
  });
  assert.ok(PAQUET.jutsu.fumee.ch > 65535 && PAQUET.jutsu.chocapic.ch > 65535);
  // Et l'on sait d'où ça vient, si la récolte est à refaire.
  assert.match(PAQUET.source.outil, /extract-emotes-bouille\.js/);
  assert.match(PAQUET.source.jutsu, /famille12\.swf/);
  assert.match(PAQUET.source.toux, /famille15\.swf/);
});

test('les dessins récoltés sont bien ceux d’hiko, au tracé près', async () => {
  const d12 = await lire('famille12.swf');
  const dec = PAQUET.source.decalage;
  let compares = 0;
  Object.entries(PAQUET.formes).forEach(([id, forme]) => {
    const origine = d12.formes.get(Number(id) - dec);
    if (!origine) return;                    // celles de la famille 15, plus loin
    assert.deepStrictEqual(forme, origine, 'la forme ' + id + ' est recopiée telle quelle');
    compares++;
  });
  assert.strictEqual(compares, 11, 'les onze formes venues d’hiko sont recopiées telles quelles');
  // La fumée est bien une pellicule (six dessins qui se relaient), le chocapic
  // une seule image.
  assert.strictEqual(PAQUET.sprites[PAQUET.jutsu.chocapic.ch].n, 1, 'le chocapic ne bouge pas');
  assert.ok(PAQUET.sprites[PAQUET.jutsu.fumee.ch].n > 1, 'la fumée, elle, tourne');
});

test('la secousse de la toux est celle de la famille 15', () => {
  const pas = PAQUET.toux.secousse;
  assert.strictEqual(pas.length, 6, 'six images de sursaut');
  const angle = (M) => Math.atan2(M.b, M.a) * 180 / Math.PI;
  // Un RECUL AMORTI : la tête part à deux degrés et revient à sa place.
  assert.ok(angle(pas[0]) < -1.9 && angle(pas[0]) > -2.2, 'le départ est à −2°');
  for (let i = 1; i < pas.length; i++) {
    assert.ok(Math.abs(angle(pas[i])) < Math.abs(angle(pas[i - 1])),
      'l’image ' + i + ' revient vers la position de repos');
  }
  const fin = pas[pas.length - 1];
  assert.deepStrictEqual([fin.a, fin.b, fin.c, fin.d, fin.e, fin.f], [1, 0, 0, 1, 0, 0],
    'et la dernière est l’identité : on est rentré');
});

// ══ LE DÉROULÉ ════════════════════════════════════════════════════════════

test('« jutsu » commence à la fumée — le « regarde ailleurs » n’est pas rejoué', async () => {
  const mo = monter(await lire('famille0.swf'));
  const face = mo.racine.face;
  mo.jouerAnim(14);
  // Le visage ne joue rien : il est à l'arrêt sur son image 1, et c'est le
  // dessin qui l'efface (cf. `dessiner`). Chez hiko c'est l'alpha zéro posé
  // sur ses huit profondeurs qui fait le même travail.
  assert.strictEqual(face.frame, 1, 'le visage ne joue aucune pellicule');
  assert.ok(mo.chute && mo.chute.quoi === 'jutsu', 'la chute part tout de suite');
  assert.strictEqual(mo.chute.t, 0);
  // La fumée ET le chocapic sont là dès le premier battement.
  assert.ok(mo.chute.fumee && mo.chute.fumee.enfants.size > 0, 'la fumée est montée');
  assert.ok(mo.chute.chocapic && mo.chute.chocapic.enfants.size > 0, 'le chocapic aussi');
});

test('la fumée s’efface, le chocapic reste, et tout rentre au bout', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(14);
  let n = 0, battements = 0;
  const fumeeVue = new Set();
  while (mo.enMouvement() && n < 400) {
    if (mo.chute) {
      battements = mo.chute.t;
      if (mo.chute.t < 20) fumeeVue.add(mo.chute.t);
    }
    mo.avancer(); n++;
  }
  // La chute compte 129 BATTEMENTS — ce que dure celle d'hiko. À l'horloge,
  // elle en prend 150 : le ralenti d'une image sur sept (cf. RALENTI_EMOTES)
  // l'étire d'un sixième, sans changer un seul de ses battements.
  assert.strictEqual(battements, 128, 'la chute compte les battements d’hiko');
  assert.strictEqual(n, 150, 'et le ralenti l’étire d’un sixième à l’horloge');
  assert.strictEqual(fumeeVue.size, 20,
    'la fumée tient vingt battements — « _alpha -= 5 » vingt fois');
  assert.strictEqual(mo.chute, null, 'et la chute se range');
  assert.strictEqual(mo.racine.flStop, true, 'la bouille est revenue au repos');
});

test('« tousse » sursaute quatre fois, les yeux fermés, sans rien dessiner', async () => {
  const mo = monter(await lire('famille0.swf'));
  const face = mo.racine.face;
  const oa = face.enfantNomme('oa').enfantNomme('o');
  mo.jouerAnim(15);
  // Les yeux se ferment et restent clos, comme à l'image 90 de la famille 15.
  assert.ok(oa.def.labels && oa.def.labels.ferme, 'l’œil a une image « ferme »');
  assert.strictEqual(oa.frame, oa.def.labels.ferme, 'et c’est celle qu’il montre');
  assert.ok(mo.chute && mo.chute.quoi === 'toux');

  // Les battements où la tête est hors de sa place : quatre salves de six.
  const secoue = new Set();
  let n = 0;
  while (mo.enMouvement() && n < 400) {
    if (mo.secousseToux()) secoue.add(mo.chute.t);
    mo.avancer(); n++;
  }
  // Quarante-cinq battements de quinte, cinquante-deux images d'horloge : le
  // ralenti d'une image sur sept (cf. RALENTI_EMOTES).
  assert.strictEqual(n, 52, 'un peu plus d’une seconde, ralenti compris');
  assert.deepStrictEqual([...secoue], [
    0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15,
    20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35,
  ], 'quatre sursauts de six battements, dix battements d’écart');
  assert.strictEqual(mo.chute, null);

  // Et RIEN n'a été greffé sur le visage : la toux n'est que du mouvement.
  const profs = [...face.enfants.keys()];
  assert.ok(profs.every((p) => p < 65536), 'aucun dessin récolté ne s’invite dans le visage');
});

test('une chute ne survit pas à l’animation suivante', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(14);
  assert.ok(mo.chute);
  mo.jouerAnim(2);                         // on rit par-dessus
  assert.strictEqual(mo.chute, null, 'le rire range la chute');
  mo.jouerAnim(15);
  assert.ok(mo.chute);
  mo.jouerAnim(0);                         // retour au repos
  assert.strictEqual(mo.chute, null);
});

test('sans la récolte, l’émote ne fait rien plutôt que d’effacer la tête', async () => {
  // Le paquet arrive par le réseau : s'il manque, mieux vaut une bouille
  // immobile qu'un visage effacé et rien à sa place.
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);                        // pas de greffer()
  mo.jouerAnim(14);
  assert.ok(!mo.chute, 'aucune chute sans les dessins');
  // La toux, elle, n'a besoin d'aucun dessin — mais sa courbe vient du même
  // paquet : sans lui, elle ne secoue rien.
  mo.jouerAnim(15);
  assert.strictEqual(mo.secousseToux(), null);
});

test('la greffe est idempotente et ne recouvre rien', async () => {
  const defs = await lire('famille0.swf');
  const avantF = defs.formes.size, avantS = defs.sprites.size;
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.greffer(PAQUET);
  const apresF = defs.formes.size, apresS = defs.sprites.size;
  assert.strictEqual(apresF, avantF + 17, 'dix-sept formes de plus');
  assert.strictEqual(apresS, avantS + 5, 'cinq clips de plus');
  // La même famille sert toutes les bouilles d'une page : la deuxième greffe
  // ne doit rien refaire.
  const mo2 = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo2.creerVisage();
  mo2.greffer(PAQUET);
  assert.strictEqual(defs.formes.size, apresF);
  assert.strictEqual(defs.sprites.size, apresS);
  assert.ok(mo2.emotes, 'mais le moteur, lui, connaît le paquet');
});

// ══ LE CÂBLAGE ════════════════════════════════════════════════════════════

test('le chat mène aux deux émotes, et les nomme', () => {
  const bloc = /var EMOTE_MAP = \{\};[\s\S]*?\n  \}\)\(\);/.exec(LIGHT);
  assert.ok(bloc, 'la table des déclencheurs');
  assert.match(bloc[0], /add\("jutsu", "chocapic no jutsu", \["jutsu", "chocapic"\]\);/);
  assert.match(bloc[0], /add\("tousse", "tousse", \["tousse", "cough", "keuf"\]\);/);
  const idx = /var ANIM_INDEX = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(idx[0], /jutsu:14, tousse:15/);
  const lab = /var ANIM_LABEL = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(lab[0], /jutsu:"chocapic no jutsu"/);
  assert.match(lab[0], /tousse:"tousse"/);
  // Le moteur les connaît sous les mêmes indices.
  assert.strictEqual(Moteur.ANIMATIONS[14], 'jutsu');
  assert.strictEqual(Moteur.ANIMATIONS[15], 'tousse');
});

test('le paquet ne se charge QUE pour les émotes qui en ont besoin', () => {
  // Quarante-sept kilo-octets qu'on ne fait pas payer à ceux qui ne les jouent
  // pas — et une seule fois pour toute la page.
  assert.match(VIGNETTE, /var EMOTES_GREFFEES = \[14, 15, 16\];/);
  assert.match(VIGNETTE, /function emotes\(\) \{[\s\S]*?fetch\(DOSSIER \+ 'emotes\.json'\)/);
  const j = /function jouer\(c, etat, anim, humeur\) \{[\s\S]*?\n  \}/.exec(VIGNETTE);
  assert.ok(j, 'jouer');
  assert.match(j[0], /if \(EMOTES_GREFFEES\.indexOf\(n\) >= 0\)/);
  assert.match(j[0], /b\.moteur\.greffer\(r\[1\]\)/);
  // Et l'échec du chargement ne casse rien : `emotes()` rend null.
  assert.match(VIGNETTE, /\.catch\(function \(\) \{ return null; \}\);/);
});

/* ── LE NUAGE DE LA TOUX ───────────────────────────────────────────────────
 *
 * « Attention, je veux garder le nuage pour la toux, c'est ce qui fait tout le
 * charme de l'animation. »
 *
 * Il se pose chez elle à `gumNext` — l'image où la bulle éclate — aux trois
 * quarts d'opacité, et s'efface de cinq pour cent par battement. On le prend,
 * on laisse la bulle.
 */
test('le nuage de la toux vient de la famille 15, avec son opacité', async () => {
  const d15 = await lire('famille15.swf');
  const nu = PAQUET.toux.nuage;
  assert.ok(nu, 'le nuage est récolté');
  assert.strictEqual(nu.alpha, 0.75, 'trois quarts d’opacité, comme à la pose');
  const def = PAQUET.sprites[nu.ch];
  assert.ok(def, 'et son clip est du voyage');
  assert.strictEqual(def.n, 13, 'treize images, six dessins qui se relaient');
  // Ses formes sont bien celles de la famille 15, au tracé près.
  let vues = 0;
  def.images.forEach((im) => im.forEach((o) => {
    if (!(o.ch >= 0)) return;
    const forme = PAQUET.formes[o.ch];
    if (!forme) return;
    // Le décalage est appliqué deux fois pour la seconde famille : une plage
    // par source, pour que deux numéros identiques ne se heurtent pas.
    const origine = d15.formes.get(o.ch - 2 * PAQUET.source.decalage);
    assert.ok(origine, 'la forme ' + o.ch + ' doit exister dans famille15.swf');
    assert.deepStrictEqual(forme, origine);
    vues++;
  }));
  assert.ok(vues >= 6, 'les six dessins du nuage sont là');
});

test('le nuage couvre la quinte, s’efface, et ne suit pas la secousse', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(15);
  assert.ok(mo.chute.nuage, 'le nuage est monté dès le premier battement');
  assert.ok(mo.chute.nuage.enfants.size > 0, 'et il a son dessin');
  // Il tient vingt battements — la boucle de l'image 93 de la famille 15 —
  // pendant que la quinte, elle, en dure quarante-cinq.
  let n = 0;
  const avecNuage = new Set();
  while (mo.enMouvement() && n < 400) {
    if (mo.chute && mo.chute.t < 20) avecNuage.add(mo.chute.t);
    mo.avancer(); n++;
  }
  assert.strictEqual(avecNuage.size, 20, 'vingt battements de nuage');
  assert.strictEqual(n, 52, 'quarante-cinq battements de quinte, ralenti compris');

  // LA SECOUSSE NE L'EMPORTE PAS : le nuage sort de la bouche, pas du crâne.
  // `dessiner` le compose donc au repère d'AVANT la secousse.
  const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
  assert.match(MOTEUR, /const repos = M \|\| IDENTITE;\s+\/\/ le repère AVANT la secousse/);
  assert.match(MOTEUR, /const base = composerM\(repos, face\.matrice\(\)\);\s*\n\s*this\.dessinerClip\(ctx, ch\.nuage/);
});

/* ── LE CHEWING-GUM D'HIKO ─────────────────────────────────────────────────
 *
 * « Implémenter l'emote "gum" de hiko pour la famille 0. Le déclencheur ne
 * peut pas être "gum" car déjà utilisé pour le gum classique. »
 *
 * Celle-ci ne s'emprunte pas comme les deux autres, et c'est ce qui la rend
 * simple : LA PELLICULE DU CHEWING-GUM EST LA MÊME PARTOUT. Les images 87 à
 * 95 du visage portent le même bytecode d'une famille à l'autre — la bulle
 * enfle jusqu'à une taille tirée au sort, elle éclate, la tache reste puis
 * s'efface. Seuls les DESSINS de la fin changent, et c'est là que hiko se
 * distingue : là où la famille 0 pose une pastille sur la joue, lui s'en
 * prend une en pleine figure.
 *
 * On ne rejoue donc rien. On laisse la pellicule d'accueil tourner et l'on
 * SUBSTITUE ses trois dessins de fin par ceux d'hiko.
 */

test('la pellicule du gum a partout la MÊME FORME — c’est ce qui autorise l’échange', async () => {
  /*
   * Ce qui se ressemble d'une famille à l'autre, ce sont les ÉTIQUETTES et
   * leur découpe : `gum` puis `gumNext`, douze images jusqu'à `question`, et
   * une fin qui pose deux dessins d'éclatement sans nom plus un nommé
   * « tache ». C'est cette forme-là qui rend la substitution possible.
   *
   * Ce qui CHANGE, ce sont les constantes de la boucle de croissance : la
   * famille 0 laisse sa bulle enfler jusqu'à `random(150) + 30`, hiko jusqu'à
   * `random(80)`, la 14 jusqu'à `random(500)`. On ne les touche pas — la bulle
   * reste celle de la famille, avec son rythme ; seuls les dessins de la fin
   * changent.
   */
  for (const f of ['famille0.swf', 'famille12.swf', 'famille14.swf', 'famille23.swf']) {
    const face = visageDe(await lire(f));
    assert.ok(face.labels.gum && face.labels.gumNext && face.labels.question, f + ' : les étiquettes');
    assert.strictEqual(face.labels.gumNext - face.labels.gum, 3, f + ' : trois images de bulle');
    assert.strictEqual(face.labels.question - face.labels.gum, 12, f + ' : douze en tout');
    // La fin : des poses sans nom (l'éclatement) et une nommée « tache ».
    const deb = face.labels.gumNext;
    let sansNom = 0, tache = 0;
    for (let i = deb; i < deb + 3; i++) {
      (face.images[i - 1] || []).forEach((o) => {
        if (o.t !== 'pose' || !(o.ch >= 0)) return;
        if (o.nom === 'tache') tache++; else sansNom++;
      });
    }
    assert.strictEqual(sansNom, 2, f + ' : deux images d’éclatement');
    assert.strictEqual(tache, 1, f + ' : une tache');
  }
});

test('la récolte emporte l’éclatement d’hiko et sa tache', () => {
  assert.ok(PAQUET.gum, 'la fin du gum est récoltée');
  assert.strictEqual(PAQUET.gum.eclats.length, 2, 'deux images d’éclatement');
  PAQUET.gum.eclats.concat([PAQUET.gum.tache]).forEach((o) => {
    assert.ok(o.ch > 65535, 'renuméroté hors de la plage d’un SWF : ' + o.ch);
    assert.ok(o.M, 'et sa matrice de pose est là');
  });
  assert.match(PAQUET.source.gum, /famille12\.swf.*gumNext/);
  // L'éclatement est fait de FORMES, la tache d'un CLIP — comme chez elle.
  PAQUET.gum.eclats.forEach((e) => assert.ok(PAQUET.formes[e.ch], 'l’éclat ' + e.ch + ' est une forme'));
  assert.ok(PAQUET.sprites[PAQUET.gum.tache.ch], 'la tache est un clip');
});

test('« gumm » joue la pellicule du gum, avec les dessins d’hiko', async () => {
  const defs = await lire('famille0.swf');
  const mo = monter(defs);
  const face = mo.racine.face;

  // Le point de départ est celui de l'animation 8, à la lettre.
  mo.jouerAnim(16);
  assert.strictEqual(face.frame, face.def.labels.gum, 'on part de « gum »');
  assert.strictEqual(mo.racine.flStop, false);

  // Et la table de substitution est prête : les dessins de la famille 0
  // pointent vers ceux d'hiko.
  assert.ok(mo.remplacements instanceof Map, 'la table est posée');
  assert.strictEqual(mo.remplacements.size, 4, 'la bulle, deux éclats et une tache');
  const cibles = [...mo.remplacements.values()].sort((a, b) => a - b);
  assert.deepStrictEqual(cibles,
    PAQUET.gum.eclats.map((e) => e.ch)
      .concat([PAQUET.gum.tache.ch, PAQUET.gum.bulle.ch]).sort((a, b) => a - b),
    'et elle mène exactement aux dessins récoltés');
  // Les CLÉS sont les dessins de la famille d'accueil, lus sur sa pellicule :
  // la bulle à l'étiquette « gum », la fin aux trois images de « gumNext ».
  const deb = face.def.labels.gumNext;
  const poses = [];
  for (let i = deb; i < deb + 3; i++) {
    (face.def.images[i - 1] || []).forEach((o) => { if (o.t === 'pose' && o.ch >= 0) poses.push(o.ch); });
  }
  (face.def.images[face.def.labels.gum - 1] || []).forEach((o) => {
    if (o.t === 'pose' && o.ch >= 0 && o.nom === 'bubble') poses.push(o.ch);
  });
  [...mo.remplacements.keys()].forEach((ch) => assert.ok(poses.indexOf(ch) >= 0,
    'la clé #' + ch + ' est bien posée par la pellicule du gum'));
});

/*
 * LA BULLE ROSE QUI ÉCLATAIT EN JAUNE.
 *
 * Chaque famille pose sa bulle sous le nom `bubble` à l'étiquette « gum ». La
 * famille 0 la dessine ROSE, hiko JAUNE — et c'est l'éclatement d'hiko qu'on
 * emprunte. On échange donc la bulle elle-même, dès le premier souffle.
 */
test('la bulle du gumm est celle d’hiko, jaune du premier souffle', async () => {
  const d0 = await lire('famille0.swf');
  const d12 = await lire('famille12.swf');
  const bulleDe = (defs) => {
    const face = visageDe(defs);
    return (face.images[face.labels.gum - 1] || [])
      .find((o) => o.t === 'pose' && o.ch >= 0 && o.nom === 'bubble');
  };
  const b0 = bulleDe(d0), b12 = bulleDe(d12);
  assert.ok(b0 && b12, 'les deux familles posent une bulle nommée « bubble »');

  // Les deux bulles sont des CLIPS d'une image, qui portent une forme.
  const formeDe = (defs, ch) => {
    const sp = defs.sprites.get(ch);
    const p = (sp.images[0] || []).find((o) => o.t === 'pose' && o.ch >= 0);
    return defs.formes.get(p.ch);
  };
  const rose = formeDe(d0, b0.ch), jaune = formeDe(d12, b12.ch);
  // Le rose de la famille 0 : un contour rouge sombre et un dégradé rose.
  const arrets = (f) => f.couches.filter((c) => c.degrade)
    .flatMap((c) => c.degrade.arrets.map((a) => a.rgb));
  const moyenne = (l) => l.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0])
    .map((v) => Math.round(v / l.length));
  const mRose = moyenne(arrets(rose)), mJaune = moyenne(arrets(jaune));
  assert.ok(mRose[0] > mRose[2] + 40 && mRose[1] < mRose[0] - 40,
    'la bulle de la famille 0 est bien rose : ' + mRose);
  assert.ok(mJaune[0] > 200 && mJaune[1] > 200 && mJaune[2] < mJaune[1] - 40,
    'celle d’hiko est bien jaune : ' + mJaune);

  // Et c'est bien la seconde que le moteur pose à la place de la première.
  const mo = monter(d0);
  mo.jouerAnim(16);
  assert.strictEqual(mo.remplacements.get(b0.ch), PAQUET.gum.bulle.ch,
    'la bulle de l’hôte mène à celle d’hiko');
  assert.ok(PAQUET.sprites[PAQUET.gum.bulle.ch], 'et la bulle récoltée est un clip');
});

/*
 * LE RALENTI DES TROIS ÉMOTES EMPRUNTÉES.
 *
 * Elles racontent quelque chose — une tête qui part en fumée, deux sursauts,
 * une bulle qui enfle puis éclate — et passaient trop vite pour être lues. On
 * saute une image d'horloge sur sept : +17 % de durée, pas un dessin changé.
 */
test('jutsu, tousse et gumm sautent une image sur sept — les autres non', async () => {
  const defs = await lire('famille0.swf');
  const jouer = (id, n) => {
    const mo = monter(defs);
    mo.jouerAnim(id);
    let bouge = 0;
    for (let i = 0; i < n; i++) if (mo.avancer()) bouge++;
    return { mo, bouge };
  };
  // Quarante-deux images d'horloge : la plus courte des trois (la quinte) en
  // dure cinquante-deux, on reste donc dans l'émote. Six d'entre elles tombent
  // sur un multiple de sept et ne font rien avancer.
  for (const id of [14, 15]) {
    const { mo } = jouer(id, 42);
    assert.strictEqual(mo.chute.t, 36,
      'l’animation ' + id + ' n’a battu que trente-six fois en quarante-deux images');
  }
  /*
   * LE GUM ET LE GUMM JOUENT LA MÊME PELLICULE : c'est ce qui rend la
   * comparaison exacte. Sur la même fenêtre, le gumm doit avancer SIX FOIS DE
   * MOINS — les six images qu'il saute —, et pas une de plus.
   */
  assert.strictEqual(jouer(8, 42).bouge - jouer(16, 42).bouge, 6,
    'le gumm saute six images là où le gum d’époque n’en saute aucune');
});

test('la substitution ne survit pas à l’animation suivante', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(16);
  assert.ok(mo.remplacements, 'posée par « gumm »');
  mo.jouerAnim(8);
  assert.strictEqual(mo.remplacements, null, 'et rangée par le gum ordinaire');
  mo.jouerAnim(16);
  mo.jouerAnim(0);
  assert.strictEqual(mo.remplacements, null, 'comme par le retour au repos');
});

test('sans la récolte, « gumm » n’est que le gum ordinaire', async () => {
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  // Pas de greffe : rien à substituer.
  mo.jouerAnim(16);
  assert.strictEqual(mo.remplacements, null, 'aucune table');
  assert.strictEqual(mo.racine.face.frame, mo.racine.face.def.labels.gum,
    'mais la bulle part quand même');
});

test('le chat mène au gum d’hiko sous un mot à lui', () => {
  // « gum » est pris par la 8 : on double la dernière lettre.
  const bloc = /var EMOTE_MAP = \{\};[\s\S]*?\n  \}\)\(\);/.exec(LIGHT);
  assert.match(bloc[0], /add\("gumm", "s’en met plein la figure", \["gumm", "gum2"\]\);/);
  assert.match(bloc[0], /add\("gum", "fait une bulle de chewing-gum", \["gum"\]\);/,
    'et le gum d’époque garde le sien');
  const idx = /var ANIM_INDEX = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(idx[0], /gum:8,/);
  assert.match(idx[0], /gumm:16 \}/);
  const lab = /var ANIM_LABEL = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(lab[0], /gumm:"s’en met plein la figure"/);
  assert.strictEqual(Moteur.ANIMATIONS[16], 'gumm');
  assert.strictEqual(Moteur.NOMS_ANIMATIONS[16], 'Gum d’hiko');
});

// Le visage d'une famille : celui qui porte le plus d'étiquettes d'action.
function visageDe(defs) {
  const ACTIONS = ['parle', 'rire', 'mdr', 'langue', 'rougir', 'regard', 'sifflote',
    'gum', 'question', 'miam', 'pleurer', 'larme'];
  let best = null, score = -1;
  for (const [, sp] of defs.sprites) {
    const n = ACTIONS.filter((a) => sp.labels && a in sp.labels).length;
    if (n > score) { score = n; best = sp; }
  }
  return best;
}
