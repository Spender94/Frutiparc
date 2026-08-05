// Le menu de l'aventure — la clairière d'où tout part.
//
// C'est l'écran-carrefour de Minipixiz : on y voit le bassin s'allumer quand une
// fée y dort, le donjon se construire dans la nuit, l'arbre grandir, le moulin
// tourner au vent du jour. Et le ciel y est une HORLOGE : cent une images d'un
// dégradé qui se déforme du lever au coucher.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'public/minipixiz/menu.js'));
const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));

// ── Le ciel ───────────────────────────────────────────────────────────────

test('le ciel a ses cent une heures', () => {
  // Menu.setNight : `sky.gotoAndStop( int(nc*100) + 1 )`, nc allant de 0 à 1.
  assert.ok(sprites.ciel, 'le ciel est extrait');
  assert.equal(sprites.ciel.etats.length, 101, 'une image par centième de journée');
  const frames = sprites.ciel.etats.map((e) => e.frame);
  assert.equal(Math.min(...frames), 1);
  assert.equal(Math.max(...frames), 101);
});

test('le ciel vient de DEUX morphs, pas d\'une forme', () => {
  // decorPlanSky : images 1 à 50 le morph du matin, 51 à 100 celui du soir,
  // 101 la nuit revenue. Une forme ordinaire n'aurait pas pu faire ça.
  const { lireMorphs } = require(path.join(ROOT, 'scripts/lib/swf-morph.js'));
  const morphs = lireMorphs(path.join(ROOT, 'Games/miniTroll/swf/root.swf'));
  assert.ok(morphs.has(373), 'le morph du matin');
  assert.ok(morphs.has(374), 'celui du soir');
  const m = morphs.get(373);
  assert.equal(m.styles.length, 1, 'un seul remplissage : le dégradé du ciel');
  assert.equal(m.styles[0].type, 0x10, 'un dégradé linéaire');
  assert.equal(m.styles[0].arrets.length, 4, 'quatre arrêts de couleur');
  // La géométrie doit être accordée des deux côtés, sinon rien n'est interpolable.
  const geo = (l) => l.filter((e) => ['move', 'ligne', 'courbe'].includes(e.type)).length;
  assert.equal(geo(m.a), geo(m.b), 'les deux contours ont le même nombre de points');
});

test('le ciel s\'éclaircit du minuit au midi', () => {
  const { lireMorphs, versSvg } = require(path.join(ROOT, 'scripts/lib/swf-morph.js'));
  const m = lireMorphs(path.join(ROOT, 'Games/miniTroll/swf/root.swf')).get(373);
  const clair = (t) => {
    const svg = versSvg(m, t);
    const stops = [...svg.matchAll(/stop-color="#([0-9a-f]{6})"/g)].map((x) => x[1]);
    // La luminance moyenne des arrêts du dégradé.
    return stops.reduce((s, h) => s + parseInt(h.slice(0, 2), 16)
      + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16), 0) / (stops.length * 3);
  };
  assert.ok(clair(1) > clair(0.5), 'midi est plus clair que le milieu de matinée');
  assert.ok(clair(0.5) > clair(0), 'et le milieu de matinée plus que minuit');
});

test('les images du ciel écrites sont de vrais dégradés', () => {
  for (const f of [1, 25, 50, 51, 75, 100]) {
    const e = sprites.ciel.etats.find((x) => x.frame === f);
    assert.ok(e, 'image ' + f);
    const svg = fs.readFileSync(
      path.join(ROOT, 'public/minipixiz/sprites', e.pieces[0].fichier), 'utf8');
    assert.match(svg, /linearGradient/, `image ${f} : un dégradé`);
    assert.match(svg, /viewBox="0.00 0.00 240.00 240.00"/, `image ${f} : toute la scène`);
  }
});

// ── Les plans et la parallaxe ─────────────────────────────────────────────

test('les neuf plans et leurs coefficients sont ceux de Menu.initDecor', () => {
  assert.deepEqual(M.PLANS.map((p) => p.c),
    [0.25, 0.35, 0.45, 0.52, 0.9, 1.1, 1.5, 1.8, 3.2]);
  const src = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/Menu.mt'), 'latin1');
  for (const c of ['0.25', '0.35', '0.45', '0.52', '0.9', '1.1', '1.5', '1.8', '3.2']) {
    assert.match(src, new RegExp('mc\\.c = ' + c.replace('.', '\\.')),
      `le coefficient ${c} vient bien du jeu`);
  }
  for (const p of M.PLANS) assert.ok(sprites[p.cle], `le plan ${p.cle} est extrait`);
});

test('chaque plan sait où il accroche ses lieux', () => {
  // Le donjon, le bassin, le sac… ne sont pas dessinés dans le plan : le jeu les
  // pilote (le donjon change de forme, l'arbre grandit). On garde leur point
  // d'accroche pour pouvoir les reposer exactement là.
  for (const l of M.LIEUX) {
    const plan = sprites[l.plan];
    assert.ok(plan, `le plan ${l.plan}`);
    assert.ok(plan.ancrages && plan.ancrages[l.nom],
      `${l.plan} accroche ${l.nom} (${JSON.stringify(plan.ancrages || {})})`);
    assert.ok(sprites[l.cle], `et ${l.cle} est extrait à part`);
  }
});

test('les lieux ne sont pas dessinés deux fois', () => {
  // S'ils étaient restés dans leur plan ET extraits à part, on les verrait en
  // double dès que le jeu leur donne une autre image.
  for (const l of M.LIEUX) {
    for (const e of sprites[l.plan].etats) {
      for (const p of e.pieces) {
        assert.ok(!p.nom || p.nom.split('.')[0] !== l.nom,
          `${l.plan} ne contient plus ${l.nom}`);
      }
    }
  }
});

test('la marge du regard est celle du jeu', () => {
  // Menu.update : `var ma = 0.3` puis
  //   xm = min(max(0, _xmouse*(1+2*ma) - mcw*ma), mcw)
  assert.equal(M.MARGE_SOURIS, 0.3);
  const src = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/Menu.mt'), 'latin1');
  assert.match(src, /var ma\s*=\s*0\.3/);
  assert.match(src, /xm = Math\.min\(Math\.max\(0,_xmouse\*\(1\+2\*ma\)-Cs\.mcw\*ma\),Cs\.mcw\)/);
});

// ── Ce que la fiche change dans le décor ──────────────────────────────────

function menuFactice(carte) {
  return Object.create(M.Menu.prototype, {
    plateforme: { value: { carte } },
    carte: { get() { return carte; } },
  });
}

test('le décor raconte la partie', () => {
  const vide = menuFactice({ $bag: 0, $dungeon: {}, $pond: {}, $rainbow: {}, $stat: {} });
  const trouve = (m, nom) => m.etatLieu(M.LIEUX.find((l) => l.nom === nom));

  assert.equal(trouve(vide, 'bag').visible, false, 'sans sac, pas de sac au pied de l\'arbre');
  assert.equal(trouve(vide, 'dungeon').visible, false, 'le donjon n\'est pas encore bâti');
  assert.equal(trouve(vide, 'rainbow').visible, false, 'ni l\'arc-en-ciel');
  assert.equal(trouve(vide, 'frog').visible, false, 'ni Ornegon');
  assert.equal(trouve(vide, 'fountain').frame, 1, 'et le bassin est éteint');

  const riche = menuFactice({
    $bag: 3, $key: 1, $frog: true,
    $dungeon: { $f: true, $lvl: 2 },
    $rainbow: { $f: true },
    $pond: { $fs: { $name: 'Lila' } },
    $stat: { $treeMax: 3000 },
  });
  assert.deepEqual(trouve(riche, 'bag'), { visible: true, frame: 3 }, 'le troisième sac');
  assert.equal(trouve(riche, 'dungeon').frame, 3, 'le donjon à son troisième niveau');
  assert.equal(trouve(riche, 'dungeon').ouvert, true, 'et la clé ouvre sa porte');
  assert.equal(trouve(riche, 'fountain').frame, 2, 'le bassin s\'est allumé');
  assert.equal(trouve(riche, 'fountain').ouvert, true);
  assert.equal(trouve(riche, 'frog').visible, true);
  assert.equal(trouve(riche, 'rainbow').visible, true);
  // Cs.treeLimit = [500,1000,2000,4000,8000] : 3000 en franchit trois.
  assert.equal(trouve(riche, 'tree').frame, 4, 'l\'arbre a grandi trois fois');
});

test('sans clé, le donjon reste fermé', () => {
  const m = menuFactice({ $dungeon: { $f: true, $lvl: 0 }, $key: 0, $pond: {}, $rainbow: {}, $stat: {} });
  const d = m.etatLieu(M.LIEUX.find((l) => l.nom === 'dungeon'));
  assert.equal(d.visible, true, 'on le voit');
  assert.equal(d.ouvert, false, 'mais on n\'y entre pas');
});

test('l\'arbre franchit ses cinq paliers', () => {
  assert.deepEqual(M.TREE_LIMIT, [500, 1000, 2000, 4000, 8000]);
  const image = (n) => menuFactice({ $stat: { $treeMax: n }, $dungeon: {}, $pond: {}, $rainbow: {} })
    .etatLieu(M.LIEUX.find((l) => l.nom === 'tree')).frame;
  assert.deepEqual([0, 600, 1500, 3000, 5000, 9000].map(image), [1, 2, 3, 4, 5, 6]);
});

// ── Les nuages ────────────────────────────────────────────────────────────

test('les nuages sont semés en huit groupes de plus en plus petits', () => {
  // Menu.initDecor : huit groupes, huit moins i nuages chacun, de plus en plus
  // gros et de plus en plus lents. C'est ce dégradé qui donne la profondeur.
  const m = menuFactice({});
  M.Menu.prototype.semerNuages.call(m, () => 0.5);
  assert.equal(m.nuages.length, 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1, 'trente-six nuages');
  const larges = m.nuages.map((n) => n.w);
  assert.equal(Math.min(...larges), 50, 'le plus petit');
  assert.ok(Math.max(...larges) > 130, 'et le plus gros, bien plus large');
  // Les plus gros sont aussi les plus rapides : ils sont plus près.
  const gros = m.nuages.find((n) => n.w > 130);
  const petit = m.nuages.find((n) => n.w === 50);
  assert.ok(gros.c > petit.c, 'le nuage proche dérive plus vite');
});

test('le vent du jour pousse les nuages, et fait tourner le moulin', () => {
  const m = menuFactice({ $wind: 0.5 });
  M.Menu.prototype.semerNuages.call(m, () => 0.5);
  m.rotationMoulin = 0;
  const avant = m.nuages.map((n) => n.x);
  M.Menu.prototype.avancer.call(m, 1);
  const bouges = m.nuages.filter((n, i) => n.x !== avant[i]).length;
  assert.ok(bouges > 20, `les nuages avancent (${bouges} sur ${m.nuages.length})`);
  assert.ok(m.rotationMoulin > 0, 'et le moulin tourne');

  // Sans vent, tout s'arrête — c'est ce que dit $wind au repos.
  const calme = menuFactice({ $wind: 0 });
  M.Menu.prototype.semerNuages.call(calme, () => 0.5);
  calme.rotationMoulin = 0;
  const fixes = calme.nuages.map((n) => n.x);
  M.Menu.prototype.avancer.call(calme, 1);
  assert.deepEqual(calme.nuages.map((n) => n.x), fixes, 'pas de vent, pas de nuage qui bouge');
  assert.equal(calme.rotationMoulin, 0);
});

// ── L'heure ───────────────────────────────────────────────────────────────

test('l\'heure du jeu vient de $time.$s', () => {
  const nc = (s) => menuFactice({ $time: { $s: s } }).coefNuit();
  assert.equal(nc(0), 0, 'minuit');
  assert.equal(nc(12 * 3600000), 0.5, 'midi');
  assert.ok(Math.abs(nc(6 * 3600000) - 0.25) < 1e-9, 'six heures');
  assert.equal(nc(-1000), 0, 'une horloge négative ne casse rien');
  assert.ok(nc(30 * 3600000) < 1, 'et au-delà d\'un jour, on repart au matin');
});

// ── L'accrochage à la page ────────────────────────────────────────────────

test('la page ouvre le menu en premier, et la forêt part de là', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /<canvas id="menu-stage" width="240" height="240">/);
  assert.match(html, /src="\/minipixiz\/menu\.js"/);
  assert.match(html, /new window\.MinipixizMenu\.Menu\(/);
  // C'est le menu qui s'ouvre au démarrage, pas la partie — et il s'ouvre dans
  // l'étoile de `fadeSlot("menu", 120, 120)`, par-dessus l'écran-titre.
  assert.match(html, /ouvrirMenu\(\);\s*\n\s*menu\.iris = new window\.MinipixizClient\.Iris\(photoTitre, 120, 120\);\s*\n\s*client\.demarrer\(\);/);
  assert.match(html, /if \(lieu\.va === 'foret'\)/, 'et la forêt s\'ouvre depuis le menu');
});
