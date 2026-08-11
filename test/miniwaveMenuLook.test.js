/*
 * Le look & feel des écrans de menu de Mini-Wave, comparé au Flash.
 *
 * Quatre écarts relevés en jeu, tous mesurables contre les sources AS2 :
 *
 * 1. L'ACCUEIL était mal réparti. page/Main.as saute une rangée après la
 *    TROISIÈME rubrique (`if(i==2)`) : ARCADE, BONUS, SPECIAL en haut, puis le
 *    groupe du bas. Le portage sautait après la DEUXIÈME — SPECIAL descendait
 *    rejoindre STAND et le milieu se vidait. Et le panneau de droite montrait
 *    une liste figée là où le jeu affiche un titre, une IMAGE et un texte qui
 *    s'écrit lettre à lettre (box/InfoMain).
 *
 * 2. LES MISSIONS s'écrivaient en capitales pixel, ce qui tronquait les titres
 *    (« RT AUX FRUITS JAUNE »). box/LevelTitle est un champ de texte ordinaire :
 *    police proportionnelle, casse d'origine.
 *
 * 3. L'ARCADE montrait les vaisseaux au centre, agrandis, avec leur nom sous
 *    chaque alvéole. box/ShipDemo les pose À LEUR TAILLE, douze pixels au-dessus
 *    du bas, sans nom — celui-ci s'affiche sur la plaque du bas AU SURVOL
 *    (SelectShip.rOver). Et le fond de l'alvéole est le ton sombre, avec sa
 *    pluie d'étoiles.
 *
 * 4. LES SPÉCIAUX affichaient une vignette réduite dans un coin, avec le nom du
 *    mode écrit par-dessus. box/Special accroche l'illustration au COIN de
 *    l'encadré, sans échelle, sous un masque : elle le remplit, et rien n'est
 *    écrit dessus.
 *
 * Plus la règle qui vaut partout : LA BANNIÈRE EST LE BOUTON RETOUR
 * (Menu.init : `title.onPress = … backToMenu()`). Aucune page n'a de bouton
 * « RETOUR » — le portage en avait posé trois.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'public/miniwave/menu.js'));
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));

const SRC = fs.readFileSync(path.join(ROOT, 'public/miniwave/menu.js'), 'utf8');
const SPRITES = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));

// Une interface montée à blanc : on ne dessine pas, on regarde où les encadrés
// se posent et ce qu'on leur demande d'afficher.
function ui(carte) {
  const i = new M.Interface({
    canvas: { width: 240, height: 240, getContext: () => ({}) },
    sprites: SPRITES,
    poser: () => {},
    plateforme: { carte: carte || P.carteNeuve(), pseudo: 'Sykka' },
    niveaux: NIVEAUX,
  });
  i.visible = true;
  return i;
}
const carteGarnie = () => {
  const c = P.carteNeuve();
  c.$ship = [1, 1, 1, 1, 1, 1];
  c.$mode = [1, [1, 1, 1, 1, 1, 0, 0, 0], [1, 1, 0], 1, 1];
  c.$cons.$bonus = [100, 80, 63, 38, 0, 0, 0, 0];
  c.$credit = 8174;
  c.$arcade = { $bestScore: 128000, $bestLevel: 101 };
  return c;
};

// ── 1 · L'accueil ─────────────────────────────────────────────────────────

test('les rubriques suivent la grille du jeu : trois en haut, le reste en bas', () => {
  const i = ui();
  i.poserPage('accueil');
  const b = i.boites.filter((x) => x.rubrique !== undefined);
  assert.equal(b.length, 5, 'cinq rubriques — les cinq rangées de page/Main.as');
  // page/Main.as : rangées de trente, saut après la TROISIÈME. CHALLENGE (le
  // mode du portage) occupe la rangée d'OPTION, non portée.
  assert.deepEqual(b.map((x) => x.gy), [0, 30, 60, 126, 156],
    'ARCADE, BONUS, SPECIAL en haut — CHALLENGE et STAND calés en bas');
  for (const x of b) {
    assert.equal(x.gw, 100, 'box/Menu : cent de large');
    assert.equal(x.gh, 20, 'et vingt de haut');
    assert.equal(x.gx, 0);
  }
  // Le trou du milieu est réel : entre SPECIAL et le groupe du bas, plus de
  // quarante pixels de vide. C'est LUI qui donne son allure à la page.
  assert.ok(b[3].gy - (b[2].gy + b[2].gh) > 40, 'le groupe du bas est bien détaché');
});

test('le panneau d\'accueil a un titre, une image et un texte — pas une liste', () => {
  const i = ui(carteGarnie());
  i.poserPage('accueil');
  const p = i.boites.find((x) => x.info);
  assert.ok(p, 'le panneau existe');
  assert.equal(p.gx, 110, 'à droite des boutons');
  assert.equal(p.gw, 110);

  const a = i.infoContenu();
  assert.equal(a.titre, 'bienvenue', 'le titre d\'accueil de box/InfoMain');
  assert.equal(a.illus, 1, 'et son image');
  assert.match(a.texte, /^Bon(jour|soir) /, 'le salut selon l\'heure');
  assert.match(a.texte, /Sykka/, 'avec le pseudo du joueur');
  assert.match(a.texte, /choisissez votre section\.$/);
  assert.doesNotMatch(a.texte, /undefined/, 'jamais « undefined » comme le SWF');

  // Le survol d'une rubrique change la page du panneau (page/Main.rOver).
  i.infoPage = 2;
  const b = i.infoContenu();
  assert.equal(b.titre, 'missions');
  assert.equal(b.illus, 3);
  assert.match(b.texte, /8 missions/);
});

test('l\'illustration du panneau existe dans les dessins extraits', () => {
  // box/InfoMain.setIllus va de l'image 1 (accueil) à la 6 (options). On porte
  // les cinq premières ; si l'extraction les perd, le panneau se vide en
  // silence — d'où ce garde-fou.
  assert.ok(SPRITES.illus, 'le clip « illus » est extrait');
  const frames = new Set(SPRITES.illus.etats.map((e) => e.frame));
  for (let f = 1; f <= 5; f++) assert.ok(frames.has(f), 'image ' + f + ' présente');
  for (const r of M.RUBRIQUES) {
    assert.ok(frames.has(r.illus), r.nom + ' pointe sur une image qui existe');
  }
});

// ── 2 · Les missions ──────────────────────────────────────────────────────

test('les titres de mission gardent leur casse et leur police proportionnelle', () => {
  const i = ui(carteGarnie());
  i.poserPage('missions');
  const t = i.boites.filter((x) => x.titreMission);
  assert.ok(t.length >= 4, 'les missions sont listées');
  assert.ok(t.some((x) => /[a-z]/.test(x.titreMission)),
    'les titres ne sont pas passés en capitales');
  assert.deepEqual(t.map((x) => x.gy).slice(0, 4), [0, 23, 46, 69],
    'espacées de vingt-trois, comme SelectLevel');
  assert.equal(t[0].gw, 220 - 56, 'largeur width-56');
  assert.equal(t[0].gh, 18);

  // Le rendu doit demander la police PROPORTIONNELLE pour ces titres.
  const bloc = /if \(b\.titreMission\) \{[\s\S]*?\n      return;\n    \}/.exec(SRC);
  assert.ok(bloc, 'la branche de rendu existe');
  const police = /ctx\.font = '[^']+';/.exec(bloc[0]);
  assert.ok(police, 'une police est choisie');
  assert.match(police[0], /VerdanaPix/, 'titre en police proportionnelle');
  assert.doesNotMatch(police[0], /Jawbreaker/, 'et surtout pas en pixel capitale');
});

test('le pourcentage a sa plaque et sa jauge', () => {
  const i = ui(carteGarnie());
  i.poserPage('missions');
  const p = i.boites.filter((x) => x.pourcent !== undefined);
  assert.ok(p.length >= 4);
  assert.equal(p[0].gw, 50, 'box/Pourcentage : cinquante sur dix-huit');
  assert.equal(p[0].gh, 18);
  assert.equal(p[0].gx, 220 - 50, 'collée à droite');
  assert.equal(p[0].pourcent, 100, 'et elle porte le taux de la mission');
  // Une mission fermée n'affiche pas de taux (le SWF ne pose rien).
  const c = P.carteNeuve();
  const j = ui(c);
  j.poserPage('missions');
  assert.equal(j.boites.filter((x) => x.pourcent !== undefined)[0].pourcent, null);
});

// ── 3 · L'arcade ──────────────────────────────────────────────────────────

test('les vaisseaux sont posés à leur taille, au bas de leur alvéole, sans nom', () => {
  const i = ui(carteGarnie());
  i.poserPage('escadron', { mode: 'arcade', vies: 4, niveaux: [], nom: 'Arcade' });
  const v = i.boites.filter((x) => x.vaisseau !== undefined);
  assert.equal(v.length, 6, 'six vaisseaux possédés, six alvéoles');
  assert.equal(v[0].gh, 176 - 28, 'hauteur height-(lowHeight+8)');
  assert.equal(v[0].gy, 0);
  assert.ok(v.every((x) => x.vitrine), 'les alvéoles sont des vitrines, pas des boutons');
  assert.ok(v.every((x) => !x.texte), 'aucun nom écrit sous les alvéoles');

  // Le rendu : échelle 1, ancré sur le BAS moins douze.
  const bloc = /if \(b\.vaisseau !== undefined\) \{[\s\S]*?\n      return;\n    \}/.exec(SRC);
  assert.ok(bloc, 'la branche de rendu existe');
  assert.match(bloc[0], /b\.y \+ b\.h - 12, 1\)/,
    'posé douze pixels au-dessus du bas, sans agrandissement');
  assert.match(bloc[0], /this\.etoiles\(/, 'et les alvéoles ont leur pluie d\'étoiles');
});

test('le bandeau du bas nomme le vaisseau survolé', () => {
  const i = ui(carteGarnie());
  i.poserPage('escadron', { mode: 'arcade', vies: 4, niveaux: [], nom: 'Arcade' });
  const d = i.boites.find((x) => x.descVaisseau);
  const l = i.boites.find((x) => x.escadronChoisi);
  assert.ok(d && l, 'la plaque et le panneau d\'escadron sont là');
  // SelectShip.initBox : w = width-(20+shipMax*16), le panneau juste après.
  assert.equal(d.gw, 220 - (20 + 4 * 16), 'la plaque prend la largeur du jeu');
  assert.equal(l.gx, 8 + d.gw, 'le panneau d\'escadron suit à huit pixels');
  assert.equal(l.gx + l.gw, 220, 'et va jusqu\'au bord');

  const bloc = /if \(b\.descVaisseau\) \{[\s\S]*?\n      return;\n    \}/.exec(SRC);
  assert.match(bloc[0], /this\.survol/, 'elle lit ce que la souris désigne');
  assert.match(bloc[0], /escadron selection/, 'et retombe sur le libellé du jeu');
});

// ── 4 · Les spéciaux ──────────────────────────────────────────────────────

test('l\'illustration d\'un spécial remplit son encadré, sans texte par-dessus', () => {
  const i = ui(carteGarnie());
  i.poserPage('speciaux');
  const s = i.boites.filter((x) => x.vignette);
  assert.equal(s.length, 3, 'trois cases, comme $mode[2]');
  assert.equal(s[0].gw, 220, 'pleine largeur');
  // (height - marge*(n-1))/n, marge de six.
  const h = (176 - 6 * 2) / 3;
  assert.ok(Math.abs(s[0].gh - h) < 0.01, 'hauteur partagée en trois');
  assert.ok(s.every((x) => !x.texte), 'aucun nom écrit sur les vignettes');
  assert.equal(s[2].verrou, true, 'le troisième mode n\'a jamais existé : verrouillé');

  const bloc = /if \(b\.vignette\) \{[\s\S]*?\n      return;\n    \}/.exec(SRC);
  assert.ok(bloc, 'la branche de rendu existe');
  assert.match(bloc[0], /this\.poser\(ctx, sp, b\.vignette, b\.x, b\.y, 1\)/,
    'accrochée au coin, à l\'échelle 1');
  assert.doesNotMatch(bloc[0], /fillText|strokeText/, 'et rien n\'est écrit dessus');

  // L'illustration fait bien la taille d'une case : c'est ce qui justifie
  // l'échelle 1.
  const p = SPRITES.specialIco.etats[0].pieces[0];
  assert.ok(p.h >= h - 2 && p.h <= h + 4,
    `l'illustration (${p.h}) couvre la hauteur de la case (${h.toFixed(1)})`);
  assert.ok(p.w >= 220, 'et déborde en largeur — le masque la recadre');
});

// ── La bannière, partout ──────────────────────────────────────────────────

test('aucune page ne porte de bouton RETOUR', () => {
  const c = carteGarnie();
  for (const page of ['accueil', 'missions', 'speciaux', 'stand']) {
    const i = ui(c);
    i.poserPage(page);
    assert.ok(!i.boites.some((b) => b.texte === 'RETOUR'),
      `la page « ${page} » n'a pas de bouton retour`);
  }
  assert.doesNotMatch(SRC, /texte: 'RETOUR'/, 'et le code n\'en fabrique plus');
});

test('la bannière ramène à l\'accueil, depuis n\'importe quelle page', () => {
  const i = ui(carteGarnie());
  i.poserPage('missions');
  assert.equal(i.page, 'missions');
  // Menu.marginUp = 54 : tout ce qui est au-dessus appartient à la bannière.
  const pris = i.auClic(120, 20);
  assert.equal(pris, true, 'le clic est consommé');
  // `ouvrir` referme d'abord la page en cours ; c'est la suivante qui compte.
  assert.equal((i.suivante && i.suivante.page) || i.page, 'accueil',
    'et l\'accueil est demandé');

  // Sur l'accueil, elle ne fait rien — on y est déjà.
  const j = ui(carteGarnie());
  j.poserPage('accueil');
  j.auClic(120, 20);
  assert.equal(j.suivante, undefined, 'pas de rechargement inutile de l\'accueil');
});

test('le survol éclaire l\'encadré visé et déplace le panneau d\'accueil', () => {
  const i = ui(carteGarnie());
  i.poserPage('accueil');
  for (const b of i.boites) { b.etape = 2; b.w = b.gw; b.h = b.gh; b.ouverte = !b.verrou; }
  assert.equal(i.infoPage, 0, 'au départ, le panneau montre l\'accueil');

  // Le centre du deuxième bouton (BONUS), en coordonnées d'écran.
  i.auSurvol(10 + 50, 54 + 30 + 10);
  const b = i.boites.find((x) => x.rubrique === 1);
  assert.equal(b.survole, true, 'BONUS est éclairé');
  assert.equal(b.couleurs.fond, '#A0A0CB', 'du ton de survol de box/Menu');
  assert.equal(i.infoPage, 2, 'et le panneau bascule sur « missions »');

  // Sortir remet l'accueil.
  i.auSurvol(-1, -1);
  assert.equal(i.infoPage, 0);
  assert.equal(b.survole, false);
});
