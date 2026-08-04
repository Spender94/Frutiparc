/*
 * Minipixiz — l'ŒIL, la cellule d'impy, et le sac de l'écran principal.
 *
 * Trois plaintes de terrain, et ce qu'elles avaient sous le capot :
 *
 *   « des billes indestructibles »   l'œil n'avait ni souffle ni ponte : une
 *                                    boule inerte, toujours rouge, que rien ne
 *                                    détruisait — et sa couleur ne pouvait
 *                                    jamais s'épuiser (majCouleurs le compte) ;
 *   « capsules jamais colonisées »   la cellule se dessinait sans les couleurs
 *                                    de son occupant, et sans fée il n'y avait
 *                                    pas de champ du tout — donc pas d'impy ;
 *   « le sac ne répond pas »         l'inventaire s'ouvrait DERRIÈRE la
 *                                    clairière (z-index 8 sous le menu à 9).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const E = require('../public/minipixiz/engine.js');

const ROOT = path.join(__dirname, '..');

// Une partie nue : grille vide, pas de champ — on pose ce qu'on veut.
function partieNue(graine) {
  return new E.Jeu({ graine: graine || 5, niveau: 0, grille: null });
}

// ── L'œil ─────────────────────────────────────────────────────────────────

test('l\'œil tire sa couleur du niveau, comme Eye.init', () => {
  // Le modèle écrit toujours { et: OEIL, n: 0 } : si `n` faisait la couleur,
  // tous les yeux seraient rouges. Eye.init tire dans la liste du niveau.
  const couleurs = new Set();
  for (let graine = 1; graine < 40; graine++) {
    const jeu = partieNue(graine);
    const oeil = jeu.genElement(E.E.OEIL, 2, 14, 0);
    couleurs.add(oeil.color);
    assert.ok(jeu.colorList.includes(oeil.color), 'une couleur du tirage courant');
  }
  assert.ok(couleurs.size > 1, 'et pas toujours la même');
});

test('un souffle détruit l\'œil — Eye.blast fait explode puis kill', () => {
  const jeu = partieNue(7);
  // Un carré rouge de quatre, l'œil collé à lui : la destruction le souffle.
  for (const [x, y] of [[2, 15], [3, 15], [2, 16], [3, 16]]) {
    const t = jeu.genElement(E.E.JETON, x, y, 0);
    t.setType(0);
  }
  const oeil = jeu.genElement(E.E.OEIL, 4, 16, 0);
  const morts = [];
  jeu.onEvent = (n, d) => { if (n === 'oeilDetruit') morts.push(d); };
  jeu.viderGroupes();
  jeu.chercherGroupes();
  jeu.initStep(E.ETAPE.DESTRUCTION);
  assert.equal(oeil.vivant, false, 'l\'œil n\'a pas survécu au souffle');
  assert.equal(morts.length, 1, 'et l\'a dit');
  assert.equal(morts[0].couleur, oeil.color);
});

test('la couleur d\'un œil ne s\'épuise qu\'avec lui', () => {
  const jeu = partieNue(11);
  jeu.eList.slice().forEach((e) => e.tuer());
  const oeil = jeu.genElement(E.E.OEIL, 1, 16, 0);
  jeu.majCouleurs();
  assert.ok(jeu.colorList.includes(oeil.color),
    'tant que l\'œil est là, sa couleur reste au tirage');
  oeil.tuer();
  jeu.majCouleurs();
  assert.ok(!jeu.termine || jeu.gagne, 'plus rien : le niveau peut se finir');
});

test('chargé, l\'œil pond une perle de sa couleur en haut du plateau', () => {
  const jeu = partieNue(13);
  jeu.eList.slice().forEach((e) => e.tuer());
  const oeil = jeu.genElement(E.E.OEIL, 3, 16, 0);
  const pontes = [];
  jeu.onEvent = (n, d) => { if (n === 'oeilPond') pontes.push(d); };

  // Eye.initActiveStep : deux tours pour se charger, la ponte au troisième.
  assert.equal(jeu.veillerYeux(), false, 'premier tour : il se charge');
  assert.equal(oeil.lumiere, 1);
  assert.equal(jeu.veillerYeux(), false, 'deuxième tour : encore');
  assert.equal(oeil.lumiere, 2);
  assert.equal(jeu.veillerYeux(), true, 'troisième : la ponte');
  assert.equal(oeil.lumiere, 0, 'et la charge retombe');
  assert.equal(pontes.length, 1);

  const p = pontes[0];
  assert.equal(p.y, 0, 'pondue sur la première ligne');
  const jeton = jeu.element(p.x, p.y);
  assert.ok(jeton && jeton.et === E.E.JETON, 'et c\'est bien un jeton');
  assert.equal(jeton.type, oeil.color, 'de la couleur de l\'œil');
  assert.equal(jeton.special, E.SPECIAL.PERLE, 'et c\'est une perle — genElement(0,…,1)');
});

test('la ponte fait partie du tour : après la pose, l\'œil veille', () => {
  const jeu = partieNue(17);
  jeu.eList.slice().forEach((e) => e.tuer());
  const oeil = jeu.genElement(E.E.OEIL, 2, 16, 0);
  // Trois poses de pièce : charge, charge, ponte.
  for (let tour = 0; tour < 3; tour++) {
    jeu.surPiecePosee();
    let garde = 0;
    while (jeu.step !== E.ETAPE.JEU && !jeu.termine && garde++ < 400) jeu.update(1);
  }
  const jetons = jeu.eList.filter((e) => e.et === E.E.JETON);
  assert.equal(jetons.length, 1, 'trois tours → une ponte');
  assert.equal(oeil.lumiere, 0);
  // Et la perle est TOMBÉE : le cycle de chute a suivi la ponte.
  assert.ok(jetons[0].py > 10, 'la perle a chuté jusqu\'au sol');
});

test('le haut muré, la ponte descend ; tout muré, la charge attend', () => {
  // Eye.initActiveStep : vingt tirages sur la ligne du haut, puis on descend
  // d'une ligne à chaque échec — la ponte trouve le premier creux venu.
  const jeu = partieNue(19);
  jeu.eList.slice().forEach((e) => e.tuer());
  const oeil = jeu.genElement(E.E.OEIL, 0, 16, 0);
  oeil.lumiere = 2;
  for (let x = 0; x < jeu.xMax; x++) {
    for (let y = 0; y < 4; y++) jeu.genElement(E.E.PIERRE, x, y, 3);
  }
  assert.equal(jeu.veillerYeux(), true, 'le haut est muré : la ponte descend plus bas');
  const ponte = jeu.eList.find((e) => e.et === E.E.JETON);
  assert.ok(ponte && ponte.py >= 4, 'sous le mur');

  // Et si TOUT est muré, l'œil renonce et garde sa charge (le `return` sans
  // remise à zéro de light).
  const plein = partieNue(29);
  plein.eList.slice().forEach((e) => e.tuer());
  const oeil2 = plein.genElement(E.E.OEIL, 0, 16, 0);
  oeil2.lumiere = 2;
  for (let x = 0; x < plein.xMax; x++) {
    for (let y = 0; y < plein.yMax; y++) {
      if (plein.estLibre(x, y)) plein.genElement(E.E.PIERRE, x, y, 3);
    }
  }
  assert.equal(plein.veillerYeux(), false, 'aucune place nulle part : pas de ponte');
  assert.equal(oeil2.lumiere, 2, 'la charge ne se perd pas');
});

// ── La génération ─────────────────────────────────────────────────────────

test('les yeux du modèle prennent des couleurs variées', () => {
  // Au niveau 40, jusqu'à quatre yeux : sur assez de graines, on doit voir
  // plusieurs couleurs — c'était le « toujours rouge » du bug.
  const vues = new Set();
  for (let graine = 1; graine < 30; graine++) {
    const jeu = new E.Jeu({ graine, niveau: 40 });
    for (const e of jeu.eList) if (e.et === E.E.OEIL) vues.add(e.color);
  }
  assert.ok(vues.size >= 3, 'plusieurs couleurs d\'yeux sur trente graines (vu : '
    + [...vues].join(',') + ')');
});

// ── La cellule d'impy ─────────────────────────────────────────────────────

test('sans champ, la cellule cassée ne plante pas ; le client en pose toujours un', () => {
  const jeu = partieNue(23);
  jeu.eList.slice().forEach((e) => e.tuer());
  const cellule = jeu.genElement(E.E.CELLULE, 3, 16, 2);
  // Le hasard de la graine 23 : on souffle jusqu'à ce qu'elle cède.
  let garde = 0;
  while (cellule.vivant && garde++ < 20) cellule.souffler();
  assert.equal(cellule.vivant, false, 'elle finit par céder, champ ou pas');

  // Et côté client, le champ existe MÊME SANS fée — c'est lui qui fait naître
  // l'impy d'une cellule cassée (ImpCell.blast → addImp, fée ou pas).
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /Combat \? new Combat\.Champ\(this\.jeu, \{ fee: this\.fee \|\| null \}\)/,
    'nouvellePartie pose le champ sans condition de fée');
});

// ── Ce que le client dessine ──────────────────────────────────────────────

test('le client habille l\'œil, la cellule et l\'objet de leurs vrais dessins', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // L'œil : le clip `eye`, sa boule teintée, sa pupille qui grossit avec la
  // charge (Eye.updateLight : 20 + light×40 %).
  assert.match(client, /rendre\(s\.eye, 1, TS, undefined, \{ col: teinte \}, '<center'\)/,
    'l\'œil est le clip du jeu, boule teintée');
  assert.match(client, /20 \+ Math\.min\(2, e\.lumiere \|\| 0\) \* 40/, 'la pupille dit la charge');
  // La cellule : les couleurs du rang de l'occupant (ImpCell.setLevel).
  assert.match(client, /COULEURS_IMPY/, 'les couleurs des impys');
  assert.match(client, /\{ ball: paire\[0\], bz: paire\[1\] \}/, 'sur la boule et l\'occupant');
  // L'objet : la bulle ET le dessin de l'objet en son centre (Item.setType).
  assert.match(client, /dessinObjet\(e\.type\)/, 'le dessin de l\'objet dans la bulle');
  // Les échos visuels de l'œil.
  assert.match(client, /case 'oeilPond':/, 'la ponte s\'entend');
  assert.match(client, /case 'oeilDetruit':/, 'et sa mort aussi');
});

test('le clip de l\'œil est dans le manifeste, avec sa boule et sa pupille', () => {
  const m = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  assert.ok(m.eye, 'le clip `eye` est extrait');
  const etat = m.eye.etats.find((q) => q.frame === 1) || m.eye.etats[0];
  const noms = etat.pieces.map((p) => p.nom);
  assert.ok(noms.includes('col'), 'la boule à teinter');
  assert.ok(noms.includes('center'), 'et la pupille');
});

// ── Les couleurs du plateau ───────────────────────────────────────────────

test('l\'heure ne voile jamais l\'écran de jeu', () => {
  // Dans l'original, seul le MENU bleuit ses plans (Menu.setNight) et le
  // bassin change l'image de son fond (base/Fountain) : la forêt est la même
  // à midi et à minuit. Le portage posait un multiply bleu nuit sur toute la
  // scène — le « filtre opaque » qui éteignait les couleurs.
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.ok(!/this\.dessinerNuit\(ctx\)/.test(client), 'plus de voile sur les scènes de jeu');
  assert.ok(!/NUIT_MAX/.test(client), 'la constante du voile est partie avec lui');
  // Le menu, lui, garde sa nuit — c'est la sienne.
  const menu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(menu, /BLEU_NUIT/, 'la clairière bleuit toujours');
});

test('la couleur ne teint que la peau du jeton — le reflet reste clair', () => {
  // Token.updateSkin : Mc.setColor(downcast(skin).skin, …) — la teinte tombe
  // sur le clip `skin` seul ; le rebord anonyme au-dessus (le liseré brillant)
  // garde ses couleurs. Teindre tout le canevas rendait les billes plates.
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /function partiesJeton\(couleur\) \{\n  return \{ skin: couleur, 'skin\.d': couleur \};/,
    'la peau, et son enfant sur l\'armure');
  assert.match(client, /rendre\(s\.token, frame, TS, undefined, partiesJeton\(couleur\), null, null, melange\)/,
    'le plateau teint par parties');
  assert.match(client, /rendre\(s\.token, 1, NEXT_ZONE\.taille \* k, undefined,\n\s*partiesJeton\(/,
    'la colonne des pièces à venir aussi');
  // Et le rebord existe bien : une pièce anonyme au-dessus de la peau.
  const m = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  const f1 = m.token.etats.find((q) => q.frame === 1);
  assert.ok(f1.pieces.some((p) => p.nom === 'skin'), 'la peau nommée');
  assert.ok(f1.pieces.some((p) => !p.nom), 'et le rebord anonyme, épargné par la teinte');
});

test('la perle et l\'étoile prennent la couleur de leur bille', () => {
  // Token.setSpecial attache la perle et l'étoile DANS le clip teinté
  // (attachMC sur skin.skin) puis les éclaircit (bmEnlight, +100) : leur
  // noyau suit la couleur de la bille — sortie = source + couleur − 130.
  // Posées brutes, elles restaient grises — les « noyaux gris » du terrain.
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /rendre\(s\.marble, 1, TS, \{ col: couleur, ajout: 125 \}\)/,
    'la perle hérite de la teinte, éclaircie');
  assert.match(client, /rendre\(s\.star, 1, TS, \{ col: couleur, ajout: 125 \}\)/,
    'l\'étoile aussi');
  assert.match(client, /function teinter\(g, x, y, l, h, couleur, ajout\)/,
    'teinter sait doser l\'éclat');
});

// ── L'inventaire ──────────────────────────────────────────────────────────

test('l\'inventaire s\'ouvre sur la fée COURANTE', () => {
  // Inventory.mt lit Cm.getCurrentFaerie() — $faerie[$current] — partout.
  // Ouvrir sur la première du bocal montrait la mauvaise fée au médaillon.
  const inv = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(inv, /const c = nombre\(this\.carte\.\$current\);\n\s*this\.feeCourante = \(c >= 0 && c < l\.length && l\[c\]\) \? c : 0;/,
    'ouvrir() suit $current, avec repli sur zéro');
});

test('le coin de sortie ramène à la clairière', () => {
  // Slot.initButQuit : mcButQuit en (mcw, mch), image 2 au survol, et le
  // clic quitte l'écran. Le portage n'avait que le bouton HTML sous le
  // canevas — le triangle du jeu manquait.
  const inv = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(inv, /poser\('boutonQuitter', this\.surLeCoin \? 2 : 1, 100, SCENE, SCENE\)/,
    'le triangle du jeu, au coin, image 2 au survol');
  assert.match(inv, /this\.zoneRect\('quitter', SCENE - 46, SCENE - 46, 46, 46\)/,
    'et sa zone');
  assert.match(inv, /if \(quoi === 'quitter'\) \{ this\.fermer\(\); return; \}/,
    'le clic referme');
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /surFermeture: function \(\) \{ fermerSac\(\); \}/,
    'et la page rend la main à la clairière');
  assert.match(page, /function fermerSac\(\) \{\n\s*\$\('#inventaire'\)\.classList\.remove\('on'\);/,
    '— la même fermeture que le bouton « retour »');
});

// ── Le sac de l'écran principal ───────────────────────────────────────────

test('l\'inventaire s\'ouvre DEVANT la clairière', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  const zInv = /#inventaire \{[^}]*z-index:\s*(\d+)/s.exec(page);
  const zMenu = /#menu \{[^}]*z-index:\s*(\d+)/s.exec(page);
  assert.ok(zInv && zMenu, 'les deux couches déclarent leur étage');
  assert.ok(Number(zInv[1]) > Number(zMenu[1]),
    'l\'inventaire (' + zInv[1] + ') passe au-dessus du menu (' + zMenu[1] + ')');
});
