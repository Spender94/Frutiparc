#!/usr/bin/env node
/*
 * Kit bande-annonce Frutiparc — section « chat » : de VRAIES scènes de salon,
 * filmées dans le vrai client.
 *
 *   node scripts/kit-bande-annonce/chat/generer.js            tous les plans
 *   node scripts/kit-bande-annonce/chat/generer.js multi quiz  seulement ceux-là
 *   node scripts/kit-bande-annonce/chat/generer.js --liste     la liste des plans
 *   node scripts/kit-bande-annonce/chat/generer.js --essai aquarium-maitre
 *                                       (3 secondes seulement, pour vérifier)
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/chat/ (KIT_CHAT_SORTIE pour
 * changer), plus manifest.json. Il faut ffmpeg et Playwright (Chromium).
 *
 * LE PRINCIPE. Le site tourne en local (server.js, sans base). Les comptes du
 * casting (kit-bande-annonce/casting.json) y sont créés par les vraies API,
 * chacun avec sa bouille. Ils entrent dans un salon comme figurants — des
 * clients WebSocket qui parlent le protocole XML du chat — et y jouent le
 * scénario de scenes.json (le fichier À MODIFIER pour changer les répliques).
 * Le spectateur, lui, est un vrai navigateur sur /light, en mode bureau Frutiz :
 * c'est SA fenêtre de salon qu'on filme, avec la colonne des bouilles ouverte.
 * La caméra tient l'horloge de la page et livre chaque trame à l'image près
 * (lib/camera.js) : le rendu est fluide et identique d'un tournage à l'autre.
 *
 * Chaque plan refait tout depuis un serveur neuf : un même scénario filmé par
 * trois caméras (plan large, gros plan, bouilles détourées) donne donc trois
 * fois la même scène.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { Site, attendre, RACINE } = require('./lib/site');
const { Camera, Sortie } = require('./lib/camera');
const { Regie, Main } = require('./lib/regie');

const playwright = (() => {
  for (const m of [path.join(RACINE, 'node_modules', 'playwright'), 'playwright', '/opt/node-tools/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* suivant */ }
  }
  throw new Error('Playwright introuvable (npm i playwright)');
})();

const SORTIE = process.env.KIT_CHAT_SORTIE || '/home/user/Frutiparc/kit-bande-annonce/chat';
const CASTING = process.env.KIT_CASTING || path.join(path.dirname(SORTIE), 'casting.json');
// Le scénario et la liste des plans : ceux du kit par défaut, ou d'autres
// (KIT_CHAT_SCENES / KIT_CHAT_PLANS) pour tourner une autre série de scènes
// avec une autre distribution (KIT_CASTING) dans un autre dossier (KIT_CHAT_SORTIE).
// Exemple : le salon des habitués, voir habitues.sh.
const SCENES = process.env.KIT_CHAT_SCENES ? path.resolve(process.env.KIT_CHAT_SCENES) : path.join(__dirname, 'scenes.json');
const FPS = 60;
// Plage de ports de la section « chat » : 4100–4199.
const PORTS = { port: 4100, portXml: 4110, portScore: 4111 };
// La base Postgres de test (cf. BRIEF-COMMUN.md), une base à la section.
const BASE_PG = process.env.KIT_CHAT_PG || 'postgres://postgres@127.0.0.1:5433/kit_chat';

/*
 * LES PLANS : une scène de scenes.json + une caméra.
 *
 *   vue      la fenêtre du navigateur, en pixels CSS, et son échelle
 *            (deviceScaleFactor) : 960 × 540 à l'échelle 2 donne du 1920 × 1080
 *            net, sans agrandissement après coup. Le bureau Frutiz ne s'ouvre
 *            qu'à partir de 768 px de large (en dessous, c'est la vue mobile) ;
 *   fenetre  où poser la fenêtre du salon sur le bureau (x, y, largeur, hauteur) ;
 *   connectes  ouvrir la liste des connectés à côté du fil ;
 *   cadre    'tout' (l'écran entier), 'fenetre' (la fenêtre du salon, recadrée
 *            en 16:9, photographiée à l'échelle qui donne 1920 de large) ou
 *            'bouilles' (la seule zone des bouilles, à 1080 de haut) ;
 *   alpha    bouilles seules sur fond transparent (+ version fond vert) ;
 *   mobile   la vue light d'un téléphone (vertical 1080 × 1920) ;
 *   affiche  l'instant (s) de l'image gardée comme affiche PNG.
 */
const PLANS = require(process.env.KIT_CHAT_PLANS ? path.resolve(process.env.KIT_CHAT_PLANS) : './plans');

// ─────────────────────────────────────────────────────────────────────────────

/*
 * VERDANA. Toute l'interface du bureau est écrite en Verdana, la police que
 * Windows et macOS fournissent — et que ce Linux n'a pas : fontconfig lui
 * substituait « Inter », plus étroite, qui ne ressemble à rien de ce qu'un
 * joueur voit. On demande au navigateur filmé (et à lui seul) de prendre
 * DejaVu Sans, la cousine libre de Verdana (même dessin large, même œil).
 */
function policesVerdana() {
  const f = path.join(require('os').tmpdir(), 'kit-chat-polices.conf');
  fs.writeFileSync(f, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <match target="pattern">
    <test qual="any" name="family"><string>Verdana</string></test>
    <edit name="family" mode="assign" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
</fontconfig>
`);
  return f;
}

function lireJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

async function tournerPlan(nom, essai) {
  const plan = PLANS[nom];
  if (!plan) throw new Error('plan inconnu : ' + nom);
  const scenes = lireJson(SCENES);
  const casting = lireJson(CASTING);
  const scene = scenes.scenes[plan.scene];
  if (!scene) throw new Error('scène inconnue : ' + plan.scene);
  const gens = [casting.spectateur].concat(casting.casting);
  const fiche = (pseudo) => {
    const g = gens.find((x) => x.pseudo.toLowerCase() === String(pseudo).toLowerCase());
    if (!g) throw new Error('« ' + pseudo + ' » n’est pas dans casting.json');
    return g;
  };
  const spect = casting.spectateur;
  const duree = essai ? Math.min(essai, scene.duree) : scene.duree;
  console.log(`\n▶ ${nom} — scène « ${plan.scene} », ${duree} s`);

  const site = new Site(Object.assign({ cle: 'cle-kit-chat', base: BASE_PG, journal: path.join(require('os').tmpdir(), 'kit-chat-serveur.log') }, PORTS));
  const bots = {};
  let navigateur = null;
  try {
    await site.demarrer();
    // Gaspard accueille les nouveaux… sans kikooz : sa phrase de bienvenue
    // tient alors en une ligne (« Bienvenue X ! Je suis Gaspard, l’hôte du parc. »).
    await site.reglagesGaspard({ actif: true, accueil: true, kikooz: 0 });

    // Les comptes : le spectateur et tous ceux que la scène fait paraître.
    const acteurs = new Set([spect.pseudo]);
    for (const p of scene.presents || []) acteurs.add(p);
    for (const r of scene.repliques) if (r.qui) acteurs.add(String(r.qui).toLowerCase());
    for (const [qui] of scene.avant || []) acteurs.add(qui);
    const sids = {};
    for (const p of acteurs) {
      const f = fiche(p);
      sids[p] = await site.inscrire(f.affiche);
      await site.poserBouille(sids[p], f.bouille);
    }
    for (const [p, champs] of Object.entries(scene.roles || {})) await site.role(p, champs);

    // L'ACCUEIL DE GASPARD, sauf pour les « nouveaux » de la scène : chacun
    // entre une fois dans un salon public et en ressort aussitôt. Gaspard le
    // note comme accueilli, et comme il est parti avant la phrase, rien n'est dit.
    const nouveaux = new Set((scene.nouveaux || []).map((s) => s.toLowerCase()));
    for (const p of acteurs) {
      if (nouveaux.has(p)) continue;
      const b = await site.bot(fiche(p).affiche, sids[p]);
      b.rejoindre('bienvenue');
      await attendre(150);
      b.quitter('bienvenue');
      await attendre(100);
      b.fermer();
    }
    await attendre(3500);   // que les accueils programmés tombent dans le vide

    // Les figurants : connectés, avec leur feutre ; les présents sont déjà au salon.
    for (const p of acteurs) {
      if (p === spect.pseudo) continue;
      bots[p] = await site.bot(fiche(p).affiche, sids[p]);
      bots[p].feutre = (scenes.feutres || {})[p] ?? '';
      bots[p].salon = scene.salon;
    }
    for (const p of scene.presents || []) { bots[p].rejoindre(scene.salon); await attendre(120); }
    await attendre(800);
    // Ce qui s'est dit AVANT l'arrivée du spectateur : il le retrouvera dans le
    // rejeu du salon (les dernières minutes, que le serveur renvoie au client light).
    for (const [qui, texte] of scene.avant || []) { bots[qui].dire(texte); await attendre(350); }
    await attendre(600);

    // ── Le spectateur : un vrai navigateur sur /light ──
    navigateur = await playwright.chromium.launch({ env: Object.assign({}, process.env, { FONTCONFIG_FILE: policesVerdana() }) });
    const [lv, hv, echelle] = plan.vue;
    const contexte = await navigateur.newContext(Object.assign(
      { viewport: { width: lv, height: hv }, deviceScaleFactor: echelle },
      // Un téléphone : écran tactile, et le moteur de rendu « mobile ».
      plan.mobile ? { isMobile: true, hasTouch: true } : {}));
    await Camera.preparer(contexte);
    const page = await contexte.newPage();
    page.on('pageerror', (e) => console.warn('[page] ' + e.message));
    const camera = new Camera(page, {
      fps: FPS, echelle, pnjRetenus: scene.pnj || [], heure: scene.heure || '17:45:00',
      ecarter: ['^<aw[^>]*>[^<]*mentionné\\(e\\) sur le forum'],
    });
    await camera.brancher();
    // `vue=light` : la vue des téléphones (le bureau Frutiz ne s'ouvre pas).
    await page.goto(`${site.base}/light?sid=${sids[spect.pseudo]}${plan.mobile ? '&vue=light' : ''}`);
    if (plan.mobile) await miseEnPlaceMobile(page, scene, gens);
    else if (plan.arrivee) await miseEnPlaceArrivee(page, plan, gens);
    else await miseEnPlace(page, camera, plan, scene, gens);

    // ── Le cadre et les sorties ──
    const cadre = await cadrer(page, plan);
    fs.mkdirSync(SORTIE, { recursive: true });
    const base = path.join(SORTIE, nom + (essai ? '-essai' : ''));
    const sorties = [];
    if (plan.alpha) {
      sorties.push(new Sortie({
        mode: 'alpha', fichier: base + '.webm', vert: base + '-vert.mp4', fps: FPS,
        cadre: [1920, 1080], pad: [0, 0],
        capture: { clip: cadre.clip, echelle: cadre.echelle, alpha: true },
      }));
    } else if (cadre) {
      sorties.push(new Sortie({
        mode: 'mp4', fichier: base + '.mp4', fps: FPS, ajuster: [1920, 1080],
        capture: { clip: cadre.clip, echelle: cadre.echelle },
      }));
    } else {
      sorties.push(new Sortie({ mode: 'mp4', fichier: base + '.mp4', fps: FPS }));
    }

    // ── La prise ──
    const regie = new Regie({ camera, bots, spectateur: spect.pseudo, salon: scene.salon, fps: FPS });
    const repliques = scene.repliques.slice().sort((a, b) => a.t - b.t);
    // La main du spectateur, pour les plans qui la montrent (gestes de plans.js).
    const main = plan.gestes ? new Main(camera, plan.curseur || [plan.vue[0] * 0.7, plan.vue[1] * 0.7]) : null;
    if (main) await main.poser();
    const gestes = (plan.gestes || []).slice().sort((a, b) => a.t - b.t);
    let kg = 0;
    await camera.demarrer(scene.graine || 7);
    const n = Math.round(duree * FPS);
    const iAffiche = Math.min(n - 1, Math.round((plan.affiche || duree / 2) * FPS));
    let affiche = null;
    let k = 0;
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const t = i / FPS;
      while (kg < gestes.length && gestes[kg].t <= t + 1e-6) await main.jouer(gestes[kg++], i);
      if (main) await main.avancer(i);
      while (k < repliques.length && repliques[k].t <= t + 1e-6) await regie.jouer(repliques[k++], i);
      await regie.avancer(i);
      const imgs = await camera.tourner(sorties);
      if (i === iAffiche) affiche = imgs[0];
      if (i % 120 === 0) process.stdout.write(`  ${t.toFixed(0)} s / ${duree} s (${((Date.now() - t0) / 1000).toFixed(0)} s réelles)\r`);
    }
    for (const s of sorties) await s.fermer();
    if (affiche) ecrireAffiche(affiche, base + '.png', plan);
    console.log(`  ✓ ${nom} en ${((Date.now() - t0) / 1000).toFixed(0)} s réelles`);
    return { nom, base, duree };
  } finally {
    for (const b of Object.values(bots)) b.fermer();
    if (navigateur) await navigateur.close();
    await site.arreter();
  }
}

/*
 * LA MISE EN PLACE, à vitesse réelle, avant que la caméra ne tourne : le
 * bureau se charge, la fenêtre du salon s'ouvre (le salon Pomme s'ouvre seul à
 * la connexion), on la pose et on la règle comme le ferait un joueur — taille,
 * colonne des bouilles, liste des connectés —, puis on attend que tout soit
 * dessiné.
 */
async function miseEnPlace(page, camera, plan, scene, gens) {
  // Le bureau Frutiz est prêt quand la page de chargement s'est effacée et
  // que la fenêtre du salon par défaut est là.
  await page.waitForFunction(() => !document.getElementById('fb-chargement')
    && [...document.querySelectorAll('.fen')].some((f) => f.offsetWidth > 0 && f.querySelector('[data-salon]')), null, { timeout: 30000 });
  await attendre(1500);
  if (scene.salon !== 'pomme') {
    // Un autre salon : on referme Pomme et on ouvre le sien, comme depuis la
    // liste des salons.
    await page.evaluate(() => {
      const f = [...document.querySelectorAll('.fen')].find((x) => x.offsetWidth > 0 && x.querySelector('[data-salon="pomme"]'));
      const x = f && [...f.querySelectorAll('.fen-btn')].find((b) => !b.classList.contains('plier'));
      if (x) x.click();
    });
    await attendre(800);
    await page.evaluate((s) => window.BureauFrutiz.ouvrirSalon(s), scene.salon);
    await page.waitForFunction((s) => [...document.querySelectorAll('.fen')].some((f) => f.offsetWidth > 0 && f.querySelector(`[data-salon="${s}"]`)), scene.salon, { timeout: 15000 });
    await attendre(1500);
  }
  const [x, y, l, h] = plan.fenetre;
  await page.evaluate(({ salon, x, y, l, h, connectes }) => {
    const fen = [...document.querySelectorAll('.fen')].find((f) => f.offsetWidth > 0 && f.querySelector(`[data-salon="${salon}"]`));
    fen.id = 'fen-tournage';
    fen.style.left = x + 'px'; fen.style.top = y + 'px';
    fen.style.width = l + 'px'; fen.style.height = h + 'px';
    const cliquer = (sel) => { const b = fen.querySelector(sel); if (b) b.click(); };
    const panneau = fen.querySelector('[data-salon]');
    if (!panneau.classList.contains('bouilles-ouvertes')) cliquer('#bouille-toggle');
    if (connectes) cliquer('#users-btn');
  }, { salon: scene.salon, x, y, l, h, connectes: !!plan.connectes });
  await attendre(600);
  // La fenêtre a pu grandir à son minimum : on la repose où on la veut.
  await page.evaluate(({ x, y, l, h }) => {
    const fen = document.getElementById('fen-tournage');
    fen.style.left = x + 'px'; fen.style.top = y + 'px';
    fen.style.width = l + 'px'; fen.style.height = h + 'px';
    window.BureauFrutiz.majBouilles();
  }, { x, y, l, h });
  await attendre(400);
  await prechargerBouilles(page, gens);
  // Le fil tout en bas, comme quand on vient d'arriver.
  await page.evaluate(() => {
    document.querySelectorAll('#fen-tournage #messages').forEach((m) => { m.scrollTop = m.scrollHeight; });
  });
  // Pas de curseur de saisie qui clignote au gré du temps réel.
  await page.addStyleTag({ content: '#compose-input { caret-color: transparent !important; }' });
  // La souris loin de tout ce qui a une infobulle.
  await page.mouse.move(plan.vue[0] - 5, plan.vue[1] - 5);
  if (plan.alpha) {
    // Les bouilles SEULES : tout le reste devient invisible et transparent
    // (fond de l'écran, reflet, page). Les bouilles gardent leur place, leur
    // glissement et leur rognage par l'écran : rien n'est redessiné.
    await page.addStyleTag({ content: `
      html, body, #app, #bureau { background: transparent !important; }
      body * { visibility: hidden !important; }
      #fen-tournage .bo-clb, #fen-tournage .bo-clb *,
      #fen-tournage .bo-ecran:not(.clb) > canvas, #fen-tournage .bo-ecran:not(.clb) #bouille-overlay-stage,
      #fen-tournage .bo-ecran:not(.clb) #bouille-overlay-stage * { visibility: visible !important; }
    ` });
  }
  await attendre(500);
}

/*
 * LA MISE EN PLACE SUR TÉLÉPHONE. Le light s'ouvre sur son tiroir d'accueil ;
 * on touche « Salons », comme un joueur, et le salon par défaut (Pomme)
 * remplit l'écran. La réaction de bouille y est la grande surimpression qui
 * traverse le fil, pas l'aquarium.
 */
async function miseEnPlaceMobile(page, scene, gens) {
  await page.waitForSelector('.home-tile[data-go="chat"]', { timeout: 30000 });
  await attendre(2500);
  await page.tap('.home-tile[data-go="chat"]');
  await page.waitForFunction(() => {
    const p = document.getElementById('chat-panel');
    return p && p.offsetWidth > 0 && !document.getElementById('app').classList.contains('menu-open');
  }, null, { timeout: 15000 });
  await attendre(1500);
  await prechargerBouilles(page, gens);
  await page.evaluate(() => { const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight; });
  await page.addStyleTag({ content: '#compose-input { caret-color: transparent !important; }' });
  await attendre(500);
}

/*
 * LA MISE EN PLACE DE L'ARRIVÉE. Pomelo vient de se connecter : on referme la
 * fenêtre du salon par défaut et l'on ouvre « Salons publics » (la liste et
 * son affluence) — c'est de là que la main du spectateur ira cliquer.
 */
async function miseEnPlaceArrivee(page, plan, gens) {
  await page.waitForFunction(() => !document.getElementById('fb-chargement')
    && [...document.querySelectorAll('.fen')].some((f) => f.offsetWidth > 0 && f.querySelector('[data-salon]')), null, { timeout: 30000 });
  await attendre(1500);
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('.fen')].find((x) => x.offsetWidth > 0 && x.querySelector('[data-salon="pomme"]'));
    const x = f && f.querySelector('.fen-btn.fermer');
    if (x) x.click();
  });
  await attendre(1000);
  await page.evaluate(() => window.BureauFrutiz.ouvrirSalonsPublics());
  await attendre(2000);
  await prechargerBouilles(page, gens);
  await page.addStyleTag({ content: '#compose-input { caret-color: transparent !important; }' });
  await page.mouse.move(plan.curseur[0], plan.curseur[1]);
  await attendre(500);
}

// Les familles de bouilles se chargent une fois pour toutes, AVANT la prise :
// une bouille qui entre dans l'aquarium doit être dessinée tout de suite.
async function prechargerBouilles(page, gens) {
  await page.evaluate((etats) => {
    const d = document.createElement('div');
    d.id = 'kit-prechargement';
    d.style.cssText = 'position:fixed;left:-500px;top:0;width:100px';
    d.innerHTML = etats.map((s) => '<div style="width:100px;height:100px">' + window.FPBouilleVignette.html(s, { anime: true }) + '</div>').join('');
    document.body.appendChild(d);
    window.FPBouilleVignette.brancher(d);
  }, gens.map((g) => g.bouille).concat(['0n0000000000000000000000']));
  await attendre(2500);
  await page.evaluate(() => { const d = document.getElementById('kit-prechargement'); if (d) d.remove(); });
}

/*
 * LE CADRE : le rectangle à filmer (pixels CSS) et l'échelle de la photo.
 *   'fenetre'  la fenêtre du salon dans un 16:9, photographiée à l'échelle qui
 *              donne 1920 px de large ;
 *   'bouilles' la zone des bouilles seule (l'aquarium, ou la pile d'écrans en
 *              mode MULTI), à l'échelle qui donne 1080 px de haut.
 */
async function cadrer(page, plan) {
  if (plan.cadre === 'tout') return null;
  const r = await page.evaluate((cadre) => {
    const fen = document.getElementById('fen-tournage');
    if (cadre === 'fenetre') {
      const b = fen.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    }
    // Les écrans eux-mêmes (la colonne s'étire plus bas qu'eux en MULTI).
    const ecrans = [...fen.querySelectorAll('#bouille-overlay .bo-ecran')].map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...ecrans.map((b) => b.left)), y0 = Math.min(...ecrans.map((b) => b.top));
    const x1 = Math.max(...ecrans.map((b) => b.right)), y1 = Math.max(...ecrans.map((b) => b.bottom));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, plan.cadre);
  const [lv, hv] = plan.vue;
  if (plan.cadre === 'bouilles') return { clip: r, echelle: 1080 / r.height };
  // Un 16:9 qui contient la fenêtre (et un peu de bureau autour), centré dessus.
  let w = Math.min(lv, Math.max(r.width + 12, (r.height + 12) * 16 / 9));
  const hh = Math.min(hv, w * 9 / 16);
  w = hh * 16 / 9;
  const x = Math.max(0, Math.min(r.x + r.width / 2 - w / 2, lv - w));
  const y = Math.max(0, Math.min(r.y + r.height / 2 - hh / 2, hv - hh));
  return { clip: { x, y, width: w, height: hh }, echelle: 1920 / w };
}

// L'affiche : l'image choisie, mise au format du plan (transparente et calée à
// gauche d'un 1920 × 1080 pour les bouilles détourées, comme dans la vidéo).
function ecrireAffiche(png, fichier, plan) {
  const tmp = fichier + '.tmp.png';
  fs.writeFileSync(tmp, png);
  const vf = plan.alpha
    ? 'format=rgba,scale=-2:1080:flags=lanczos,pad=1920:1080:0:0:color=0x00000000'
    : plan.mobile ? 'scale=1080:1920:flags=lanczos' : 'scale=1920:1080:flags=lanczos';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', vf, '-frames:v', '1', fichier]);
  fs.unlinkSync(tmp);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--liste')) {
    for (const [n, p] of Object.entries(PLANS)) console.log(n.padEnd(22) + p.titre);
    return;
  }
  // --essai : 3 secondes seulement ; --essai=8 : huit.
  const optEssai = args.find((a) => a.startsWith('--essai'));
  const essai = optEssai ? (Number(optEssai.split('=')[1]) || 3) : 0;
  const noms = args.filter((a) => !a.startsWith('--'));
  const aFaire = noms.length ? noms : Object.keys(PLANS);
  for (const n of aFaire) await tournerPlan(n, essai);
  // La fiche de section (titre, texte) peut venir du scénario (« section »).
  if (!essai) require('./manifeste').ecrire(SORTIE, PLANS, lireJson(SCENES).section);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { PLANS, tournerPlan };
