/*
 * Le TABLEAU DES SCORES du portage light — la fenêtre du bureau, reproduite.
 *
 * Le mobile affichait sa propre grammaire : des pastilles corail, une liste
 * verte, un jeu par onglet. Le bureau, lui, ouvre une fenêtre « Scores » à deux
 * volets — la liste des classements à gauche (Challenge, puis Championnat), le
 * tableau à droite : les médaillés de la veille, « Je suis Nème avec … », puis
 * les lignes Frutiz / Score / Heure, bouille du joueur comprise.
 *
 * Ce fichier tient les deux moitiés de la ressemblance :
 *   · la SOURCE — /api/light/challenge suit LEGACY_RANKINGS (l'ordre, les
 *     libellés et les sections que le bureau reçoit par listRankings), et
 *     chaque ligne porte ce que le bureau affiche (bouille, heure, rang) ;
 *   · les IMAGES — les trois icônes de la fenêtre (podium, coupe, médaille à
 *     couronne) et les médailles des deux classements pilotes existent
 *     vraiment, au format attendu.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3502;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-scores-fenetre';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5280', FRUTISCORE_PORT: '5281',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('fen')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const joueur = (b) => 'fen' + b + RUN;

async function inscrire(pseudo, bouille) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  if (bouille) await fetch(`${BASE}/do/eb?sid=${sid}&b=${bouille}`);
  return sid;
}
const poserScore = (pseudo, rk, score) =>
  fetch(`${BASE}/api/admin/scores/${pseudo}/${rk}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score }) });
const tableau = async (sid, params) =>
  (await fetch(`${BASE}/api/light/challenge?sid=${sid}${params || ''}`)).json();

// ── La source : la même liste que le bureau ───────────────────────────────

test('la liste des classements est celle du bureau : ordre, libellés, sections', async () => {
  const sid = await inscrire(joueur('liste'));
  const d = await tableau(sid);

  const challenge = (d.games || []).filter((g) => g.section === 'C').map((g) => g.name);
  assert.deepEqual(challenge, [
    'Burning kiwi', 'Frutisnake 2', 'Motion Ball 2', 'Swapou 2', 'Kaluga',
    'Frutibandas', 'Grapiz', 'MiniPixiz', 'MiniWave',
  ], 'la section Challenge, dans l\'ordre de LEGACY_RANKINGS');

  const championnat = (d.games || []).filter((g) => g.section === 'L').map((g) => g.name);
  assert.deepEqual(championnat, [
    'Class. kikooz', 'Frutisnake Contest', 'Swapou Contest',
    'Classement XP', 'Class. consécration',
  ], 'la section Championnat, XP et consécration comprises');

  // Les libellés viennent bien du descriptif du bureau, pas d'une table à part.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const nom of ['Burning kiwi', 'Frutisnake 2', 'Class. kikooz']) {
    assert.ok(src.includes(`rn: '${nom}'`), `« ${nom} » est un libellé de LEGACY_RANKINGS`);
  }
  // Et le jour affiché est celui de Paris.
  assert.match(d.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(d.past, false, 'par défaut, on regarde aujourd\'hui');
});

test('chaque ligne porte ce que le bureau affiche : rang, bouille, score, heure', async () => {
  const bouilles = {
    or: '100000010000000000000000',
    argent: '110000020000000000000000',
    bronze: '120000030000000000000000',
  };
  const sidOr = await inscrire(joueur('or'), bouilles.or);
  await inscrire(joueur('ag'), bouilles.argent);
  const sidMoi = await inscrire(joueur('moi'), bouilles.bronze);
  await poserScore(joueur('or'), 'minipixiz_classic', 9000);
  await poserScore(joueur('ag'), 'minipixiz_classic', 5000);
  await poserScore(joueur('moi'), 'minipixiz_classic', 1000);

  const d = await tableau(sidMoi);
  const g = (d.games || []).find((x) => x.id === 'minipixiz_classic');
  assert.ok(g, 'l\'onglet MiniPixiz est là');
  const mien = g.scores.find((s) => s.user.toLowerCase() === joueur('moi'));
  assert.ok(mien, 'je figure au tableau');
  assert.equal(mien.isMe, true);
  assert.ok(mien.pos >= 1, 'la ligne connaît son rang (le bureau l\'imprime à gauche)');
  assert.equal(mien.bouille, bouilles.bronze, 'et ma bouille voyage avec (colonne des vignettes)');
  assert.match(mien.time, /^\d{2}:\d{2}$/, 'l\'heure est au format de la colonne « Heure »');
  // Le séparateur de milliers du français est une espace fine insécable.
  assert.match(mien.label, /^1\s000$/, 'le score est formaté comme au bureau');

  // « Je suis Nème avec … » — même quand on n'est pas dans les premières lignes.
  assert.ok(g.me, 'mon rang est donné à part');
  assert.equal(g.me.pos, g.scores.findIndex((s) => s.isMe) + 1);
  assert.match(g.me.label, /^1\s000$/);

  // Les rangs se suivent, et chacun porte SA bouille (data/scores.json peut
  // déjà contenir d'autres joueurs : on cherche le nôtre par son nom).
  assert.equal(g.scores[0].pos, 1, 'la première ligne est le rang 1');
  const meilleur = g.scores.find((s) => s.user.toLowerCase() === joueur('or'));
  assert.ok(meilleur, 'le mieux classé de nos trois figure au tableau');
  assert.equal(meilleur.bouille, bouilles.or, 'avec sa propre bouille');
  assert.equal(meilleur.isMe, false, 'et ce n\'est pas moi');
  assert.ok(meilleur.pos < mien.pos, 'il est devant moi');

  // Un visiteur sans session n'a pas de rang à afficher.
  const anonyme = await (await fetch(`${BASE}/api/light/challenge`)).json();
  const ga = (anonyme.games || []).find((x) => x.id === 'minipixiz_classic');
  assert.equal(ga.me, null, 'sans session, pas de « Je suis … »');
  assert.ok(ga.scores.every((s) => s.isMe === false));
  assert.ok(sidOr);
});

test('un jour passé se demande par sa date, et n\'affiche pas les médailles du jour', async () => {
  const sid = await inscrire(joueur('hier'));
  const aujourdhui = (await tableau(sid)).day;
  const veille = new Date(aujourdhui + 'T12:00:00Z');
  veille.setUTCDate(veille.getUTCDate() - 1);
  const cle = veille.toISOString().slice(0, 10);

  const d = await tableau(sid, '&day=' + cle);
  assert.equal(d.day, cle, 'le jour demandé est celui rendu');
  assert.equal(d.today, aujourdhui, 'et on sait toujours quel jour est aujourd\'hui');
  assert.equal(d.past, true, 'le client saura afficher la flèche « jour suivant »');
  for (const g of d.games.filter((x) => x.section === 'C')) {
    assert.deepEqual(g.podium, [], 'un jour passé ne montre pas les médailles d\'après');
  }
  // Une date fantaisiste retombe sur aujourd'hui plutôt que de casser.
  const bancal = await tableau(sid, '&day=pas-une-date');
  assert.equal(bancal.day, aujourdhui);
  assert.equal(bancal.past, false);
});

// ── Les images de la fenêtre ──────────────────────────────────────────────

test('les trois icônes de la fenêtre existent, découpées du rendu du bureau', () => {
  // Podium (Challenge), coupe (Championnat), médaille à couronne (chaque ligne).
  for (const [nom, lMax, hMax] of [
    ['score_podium', 60, 60], ['score_coupe', 60, 70], ['score_medaille', 40, 40],
  ]) {
    const p = path.join(ROOT, 'public/fb/' + nom + '.png');
    assert.ok(fs.existsSync(p), `${nom}.png est là`);
    const png = fs.readFileSync(p);
    assert.equal(png.slice(1, 4).toString('latin1'), 'PNG', `${nom} est un PNG`);
    const l = png.readUInt32BE(16), h = png.readUInt32BE(20);
    assert.ok(l > 8 && l <= lMax && h > 8 && h <= hMax, `${nom} à la bonne échelle (${l}×${h})`);
    assert.equal(png[25], 6, `${nom} garde sa transparence (RGBA)`);
  }
});

test('les deux classements pilotes ont enfin leurs médailles, comme les sept autres', () => {
  // Sans elles, le bandeau des médaillés de la veille restait vide pour
  // MiniPixiz et Mini-Wave — les seuls jeux dont la vignette manquait.
  for (const jeu of ['minipixiz', 'miniwave', 'snake', 'kaluga']) {
    for (const couleur of ['gold', 'silver', 'bronze']) {
      const p = path.join(ROOT, `public/fb/medal_${couleur}_${jeu}.png`);
      assert.ok(fs.existsSync(p), `medal_${couleur}_${jeu}.png est là`);
      const png = fs.readFileSync(p);
      const l = png.readUInt32BE(16), h = png.readUInt32BE(20);
      assert.ok(l >= 90 && l <= 110 && h >= 90 && h <= 110,
        `medal_${couleur}_${jeu} au gabarit des autres (${l}×${h})`);
    }
  }
});

// ── La fenêtre, côté page ─────────────────────────────────────────────────

test('le panneau du light reproduit la fenêtre : barre de titre, deux volets, pied', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // La charpente.
  assert.match(html, /<div id="sc-fenetre">/, 'le cadre de la fenêtre');
  assert.match(html, /<span id="sc-titre-txt">/, 'la barre de titre nomme le classement');
  assert.match(html, /<div id="sc-liste">/, 'le volet des classements');
  assert.match(html, /<div id="sc-table">/, 'le volet du tableau');
  assert.match(html, /id="sc-jour-prec"[\s\S]{0,400}id="sc-jour"[\s\S]{0,400}id="sc-jour-suiv"/,
    'le pied : une date entre deux flèches');

  // Les couleurs relevées sur le rendu du bureau (et pas approchées à l'œil).
  assert.match(html, /#sc-fenetre \{[\s\S]*?background: #FACE68/, 'le fond doré de la fenêtre');
  assert.match(html, /#sc-liste, #sc-table \{[\s\S]*?#FBD888 linear-gradient\(180deg, #FDEDC8 0, #FBD888 14px\)/,
    'les deux panneaux crème, dégradé compris');
  assert.match(html, /\.sc-entete, \.sc-ligne \{[\s\S]*?color: #433005/, 'le brun du tableau');

  // Les trois images de la fenêtre, à leur place.
  assert.match(html, /"score_podium"/, 'le podium devant « Challenge »');
  assert.match(html, /"score_coupe"/, 'la coupe devant « Championnat »');
  assert.match(html, /score_medaille\.png/, 'la médaille devant chaque classement');

  // Le contenu du volet droit, dans l'ordre du bureau.
  assert.match(html, /class="sc-podium"/, 'les médaillés de la veille en tête');
  assert.match(html, /medal_' \+ p\.medal \+ '_/, 'avec leur vraie médaille');
  assert.match(html, /Je suis ' \+ g\.me\.pos/, 'puis « Je suis Nème avec … »');
  assert.match(html, /<span class="f">Frutiz<\/span>[\s\S]{0,120}Score[\s\S]{0,80}Heure/,
    'puis les colonnes Frutiz / Score / Heure');
  assert.match(html, /FPBouilleThumb\.imgHtml\(s\.bouille/, 'et la bouille de chaque joueur');
  assert.match(html, /xmlEscape\(s\.time/, 'ainsi que l\'heure de son score');

  // Les sections sont celles du serveur, pas une liste recopiée.
  assert.match(html, /\[\["C", "Challenge", "score_podium"\], \["L", "Championnat", "score_coupe"\]\]/,
    'les deux sections sont pilotées par le champ `section` de l\'API');

  // Et l'ancienne grammaire du mobile a bien disparu.
  assert.ok(!/class="scores-tab/.test(html), 'plus de pastilles corail');
  assert.ok(!/id="scores-body"/.test(html), 'plus de liste verte');
});
