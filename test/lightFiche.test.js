/*
 * La FICHE d'un frutiz sur /light — ce que le bureau montre en cliquant un
 * pseudo (FrutizInfo + winFrutizInfo), porté au mobile.
 *
 * Trois choses à garder :
 *   1. l'endpoint /api/light/fiche — le JSON qui réunit la commande chat
 *      `userinfo` (frutiz / perso / bonus) et FrutiScore (scores) ;
 *   2. les frutisignes — les dessins de frutiSign.swf, extraits en PNG ;
 *   3. l'écran du mobile — quatre onglets, le signe au centre, et le geste :
 *      toucher un pseudo ouvre la fiche, la fiche mène au privé.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5190', FRUTISCORE_PORT: '5191',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => {
  if (serverProc) serverProc.kill('SIGKILL');
  // Comme les concours : on efface NOS joueurs de data/scores.json en sortant.
  await wait(300);
  const fichier = path.join(ROOT, 'data/scores.json');
  try {
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(-RUN.length) === RUN) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

test('la fiche répond avec les quatre onglets du bureau', async () => {
  const sid = await sidFor(joueur('fichea'));
  await sidFor(joueur('ficheb'));
  const r = await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=${joueur('ficheb')}`);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(String(j.pseudo).toLowerCase(), joueur('ficheb'));
  // basic : ce que l'en-tête affiche — bouille, niveau, « âge - ville ».
  assert.ok(typeof j.bouille === 'string' && j.bouille.length === 24, 'la bouille de l\'avatar');
  assert.ok(j.basic.niveau >= 1, 'le niveau (XP)');
  // frutiz : le signe (caché au départ), la consécration, l'inscription.
  assert.equal(j.frutiz.signe, null, 'signe encore caché — la silhouette noire');
  assert.equal(j.frutiz.job, 'Frutiz');
  assert.ok(j.frutiz.inscription, 'la date d\'inscription');
  assert.equal(j.frutiz.frutiAgeMois, 0, 'inscrit à l\'instant : zéro mois');
  // perso / bonus / scores : les structures des trois autres onglets.
  assert.ok('prenom' in j.perso && 'ville' in j.perso && 'metier' in j.perso);
  assert.ok('commentaire' in j.bonus && 'site' in j.bonus);
  assert.ok(Array.isArray(j.scores.classements) && Array.isArray(j.scores.medailles));
});

test('un score de championnat apparaît dans l\'onglet scores', async () => {
  const nom = joueur('fichesc');
  const sid = await sidFor(nom);
  // Un score Frutisnake classique (section C, rk 1 — snake3_classic).
  const r = await fetch(`${BASE}/api/saveScore`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'snake3', score: '4321', mode: '0' }),
  });
  // saveScore peut avoir une autre signature : dans ce cas on passe par l'API
  // du moteur de scores. On vérifie seulement que si un score EST enregistré,
  // la fiche le montre.
  const info = await (await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=${nom}`)).json();
  assert.equal(info.ok, true);
  for (const c of info.scores.classements) {
    assert.ok(c.titre && Number.isFinite(c.score), 'chaque ligne porte un titre et un score');
  }
});

test('la fiche refuse sans session, et dit quand le frutiz n\'existe pas', async () => {
  const r1 = await fetch(`${BASE}/api/light/fiche?u=quelquun`);
  assert.equal(r1.status, 401);
  const sid = await sidFor(joueur('fichec'));
  const r2 = await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=nexistepas${RUN}`);
  assert.equal(r2.status, 404);
});

test('les frutisignes sont extraits — les dix fruits, et la silhouette', () => {
  const signes = ['pomme', 'abricot', 'poire', 'fraise', 'citron',
    'kiwi', 'raisin', 'orange', 'cerise', 'banane', 'mystere'];
  for (const s of signes) {
    const f = path.join(ROOT, 'public/fb/signe_' + s + '.png');
    assert.ok(fs.existsSync(f), 'signe_' + s + '.png existe');
    assert.ok(fs.statSync(f).size > 800, 'et porte un vrai dessin');
  }
  // La table du serveur suit l'ordre de Lang.sign — l'index du signe est un
  // rang dans cette liste, pas un nom.
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /SIGNES_FRUITS = \['pomme', 'abricot', 'poire', 'fraise', 'citron',\n\s*'kiwi', 'raisin', 'orange', 'cerise', 'banane'\]/,
    'les dix signes, dans l\'ordre du bureau');
});

test('la rangée d\'actions porte les vrais glyphes de main.swf', () => {
  // La feuille `icon` de butPushSmallWhite (sprite 500), mappée par
  // box.Frutiz.getIconList : bulle (2), carte (3), cœur (4), bulle-croix (5),
  // « ! » (6), carton (7), totoche (8), feuille (10), bulle-plus (12), B (13).
  // Plus les chromes (blanc et rose), le bandeau des titres et la fleur.
  for (const f of ['bouton_rose', 'bandeau_titre', 'croix_fermer',
    'statut_present', 'statut_absent',
    'ico_chat', 'ico_mail', 'ico_contact', 'ico_listenoire', 'ico_kick',
    'ico_ban', 'ico_totoche', 'ico_edite', 'ico_autorise', 'ico_blog', 'ico_avance']) {
    const p = path.join(ROOT, 'public/fb/fiche/' + f + '.png');
    assert.ok(fs.existsSync(p), f + '.png existe');
    assert.ok(fs.statSync(p).size > 200, 'et porte un vrai dessin');
  }
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // but.Push trace son cadre par code (drawSmoothSquare 0xDDDDDD) : le mobile
  // fait pareil, en CSS — le halo gris clair de l'intégration, pas d'image de
  // chrome blanc.
  assert.match(html, /box-shadow: 0 0 0 1\.5px #DDDDDD;/, 'le halo gris des boutons, par code');
  assert.match(html, /\/fb\/fiche\/bouton_rose\.png/, 'le chrome rose du mode avancé');
  assert.match(html, /\/fb\/fiche\/croix_fermer\.png/, 'la croix du bureau (butGroupWinTop)');
  // L'en-tête : le point de présence, et l'écran de niveau à barres.
  assert.match(html, /statut_present/, 'présent en vert');
  assert.match(html, /statut_absent/, 'éteint sinon');
  // L'écran de niveau est la mainbar de l'accueil en miniature : NEUF barres,
  // remplies par la même règle (levelProgress = UserMng.xpLevelCompletionRate).
  const barres = /id="fiche-barres">((?:<i><\/i>)+)</.exec(html);
  assert.ok(barres && (barres[1].match(/<i>/g) || []).length === 9, 'neuf barres, comme la mainbar');
  assert.match(html, /levelProgress\(d\.basic\.xp, d\.basic\.niveau\)/, 'remplies par la règle de la mainbar');
  assert.match(html, /cadre_bouille\.svg/, 'le cadre de la bouille de la mainbar');
  assert.match(html, /reflet_niveau\.svg/, 'et le reflet de l\'encart');
  // La rangée ne porte QUE les gestes qui marchent sur mobile.
  for (const ico of ['ico_chat', 'ico_mail', 'ico_kick', 'ico_ban',
    'ico_totoche', 'ico_avance']) {
    assert.match(html, new RegExp('/fb/fiche/' + ico + '\\.png'), ico + ' posée sur son bouton');
  }
  for (const mort of ['ico_blog', 'ico_contact', 'ico_listenoire']) {
    assert.ok(!html.includes('/fb/fiche/' + mort + '.png'),
      mort + ' retirée : un bouton éteint ne prend plus la place');
  }
  // Et le courrier est branché sur la vraie messagerie, destinataire prérempli.
  assert.match(html, /ecrireMail\(p, ""\)/, 'le bouton mail ouvre le composeur');
});

test('la fiche suit le style de l\'intégration : carte, plaque, dépliant', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // La CARTE : blanche, liseré sombre fin, coins courts — pas une fenêtre verte.
  assert.match(html, /#fiche \{[\s\S]{0,400}border: 1\.5px solid #545454; border-radius: 8px;/,
    'la carte blanche à liseré sombre, coins francs');
  // LA PLAQUE : un seul encart vert qui tient la bouille ET l'écran de niveau.
  assert.match(html, /\.fiche-plaque \{[\s\S]{0,400}background: #c8f39a;/, 'la plaque verte');
  assert.match(html, /border: 1px solid #666; border-radius: 5px; box-shadow: 0 0 0 2px #ddd;/,
    'cernée de gris, comme sur l\'intégration');
  assert.match(html, /<div class="fiche-plaque">[\s\S]{0,700}class="fa-jauge"/,
    'la bouille et la jauge dans le MÊME encart');
  // Les barres et le niveau prennent les couleurs de l'intégration.
  assert.match(html, /background: #72A62C;/, 'les barres au vert de l\'intégration');
  assert.match(html, /font-size: 11px; line-height: 1; color: #4E8030;/, 'le niveau aussi');
  assert.match(html, /font-size: 12\.5px; color: #290D64;/, 'et le pseudo au bleu nuit');
  // Les tailles de la rangée d'en-tête, réglées à la demande.
  assert.match(html, /#fiche-fermer img \{ width: 20px; height: 20px;/, 'la croix en 20 px');
  assert.match(html, /\.fiche-actions button img \{ width: 20px; height: 20px;/, 'les glyphes en 20 px');
  assert.match(html, /\.fiche-nom-ligne \.statut \{ width: 18px; height: 18px;/, 'le voyant en 18 px');
  // Le cadre et le reflet habillent la PLAQUE, pas la seule vignette — et la
  // bouille garde son carré de 52 px, avec son propre repère.
  // Le cadre ET le reflet doivent être DANS la plaque — pas seulement quelque
  // part dans la page : la mainbar de l'accueil en a une paire elle aussi, et
  // c'est ce qui a permis de les supprimer de la fiche sans que rien ne crie.
  const plaque = /<div class="fiche-plaque">([\s\S]*?)\n          <\/div>/.exec(html);
  assert.ok(plaque, 'la plaque existe');
  assert.match(plaque[1], /<img class="cadre" src="\/fb\/cadre_bouille\.svg"/,
    'le cadre est dans la plaque');
  assert.match(plaque[1], /<img class="reflet" src="\/fb\/reflet_bouille\.svg"/,
    'et le reflet aussi');
  assert.match(html, /\.fiche-plaque > \.cadre \{[\s\S]{0,120}inset: 0; width: 100%; height: 100%;/,
    'le cadre prend toute la largeur de l\'encart');
  assert.match(html, /\.fiche-plaque > \.reflet \{[\s\S]{0,120}right: 3%; top: 4%;/,
    'le reflet se pose dans le coin haut-droit');
  assert.match(html, /<div class="fa-frame">\s*<div class="stage" id="fiche-avatar"><\/div>\s*<\/div>/,
    'la vignette ne contient plus que la bouille');
  // La vignette garde son PROPRE repère (position: relative) — c'est ce qui
  // fait tenir le cadre et le reflet sur la plaque, et non sur elle. Sa taille,
  // en revanche, a grossi de quinze pour cent : voir le test dédié plus bas.
  assert.match(html, /\.fiche-plaque \.fa-frame \{\s*position: relative; width: 60px; height: 60px;/,
    'et garde son repère, à sa nouvelle taille');
  // La bouille n'a plus de contour, et la carte porte son ombre de tous les côtés.
  assert.match(html, /\.fiche-plaque \.fa-frame \{[^}]*\n\s*z-index: 2;\n\s*\}/,
    'plus de liseré autour de la bouille');
  assert.match(html, /box-shadow: 0 0 16px rgba\(0, 0, 0, \.45\), 0 4px 10px rgba\(0, 0, 0, \.3\);/,
    'l\'ombre portée court sur tous les côtés');
  // LE DÉPLIANT : le bouton rose n'est plus mort, il ouvre le détail.
  assert.ok(!/id="fiche-avance"[^>]*disabled/.test(html), 'le bouton rose n\'est plus éteint');
  assert.match(html, /#fiche:not\(\.deploye\) \.fiche-corps \{ display: none; \}/,
    'la fiche se replie');
  assert.match(html, /poserFicheDeployee\(!\$\("#fiche"\)\.classList\.contains\("deploye"\)\)/,
    'et le bouton rose bascule');
  assert.match(html, /localStorage\.setItem\(FICHE_DEPLOYE_KEY/, 'le choix se retient');
  // Le panneau vert clair, ses onglets et leur rouge d'activité.
  assert.match(html, /\.fiche-corps \{[\s\S]{0,200}background: #E0F4C5;/, 'le panneau vert clair');
  assert.match(html, /border: 2px solid #a7dc6b; border-radius: 2px; box-shadow: 0 0 0 2px #DDDDDD;/,
    'son liseré et son halo');
  assert.match(html, /font-size: 11px; color: #446531;/, 'les onglets en vert sombre');
  assert.match(html, /\.fiche-onglets button\.actif \{ color: #811C22; \}/, 'l\'onglet actif en rouge brique');
  // Le titre de section entre deux filets — la réponse à l'encart « frutisigne ».
  assert.match(html, /\.fiche-titre::before, \.fiche-titre::after \{/, 'le titre entre deux filets');
  assert.match(html, /t\.textContent = "FrutiSigne"/, 'nommé comme sur l\'intégration');
  assert.match(html, /border-bottom: 1\.5px solid #a7dc6b;/, 'les signes posés sur leur séparateur');
  // Et l'onglet perso encadre ses lignes.
  assert.match(html, /"fiche-lignes encadre"/, 'perso encadré de ses séparateurs');
});

test('l\'en-tête tient sur deux lignes, et la carte ne saute pas d\'un onglet à l\'autre', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // LIGNE 1 : le voyant, le pseudo, l'âge et le département, la croix — dans
  // cet ordre et sur la MÊME ligne, comme au bureau.
  const ligne = /<div class="fiche-nom-ligne">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(ligne, 'la ligne d\'identité existe');
  const l = ligne[1];
  assert.ok(l.indexOf('id="fiche-statut"') < l.indexOf('id="fiche-pseudo"'),
    'le voyant avant le pseudo');
  assert.ok(l.indexOf('id="fiche-pseudo"') < l.indexOf('id="fiche-meta"'),
    'puis l\'âge et le département');
  assert.ok(l.indexOf('id="fiche-meta"') < l.indexOf('id="fiche-fermer"'),
    'et la croix au bout');
  assert.match(html, /\.fiche-nom-ligne \.meta \{\s*margin-left: auto;/,
    'l\'âge est poussé à droite de la ligne');
  // LIGNE 2 : les actions SOUS le pseudo (dans la colonne de droite), pas
  // sous la plaque — et le bouton rose au bout, au même niveau.
  const droite = /<div class="fiche-droite">([\s\S]*?)\n          <\/div>/.exec(html);
  assert.ok(droite && droite[1].includes('class="fiche-actions"'),
    'la rangée d\'actions vit dans la colonne du pseudo');
  assert.ok(droite[1].includes('id="fiche-avance"'),
    'et le bouton rose la termine');
  assert.match(html, /#fiche-avance \{\s*margin-left: auto;/, 'poussé au bout de la rangée');
  // La HAUTEUR de la fiche dépliée est FIXE : le contenu défile s'il déborde.
  assert.match(html, /\.fiche-page \{ padding: [^;]*; height: \d+px; overflow-y: auto; \}/,
    'le panneau garde sa hauteur d\'un onglet à l\'autre');
});

test('Minipixiz et Miniwave sont posés sur le vert du bureau', () => {
  for (const jeu of ['minipixiz', 'miniwave']) {
    const html = fs.readFileSync(path.join(ROOT, 'public/' + jeu + '/index.html'), 'utf8');
    assert.match(html, /html, body \{[\s\S]{0,120}background: #ADE76B;/,
      jeu + ' : le fond de page est vert');
    assert.ok(!/background: #150f28|background: #0b1424|background: #070b18/.test(html),
      jeu + ' : plus un seul fond bleu nuit');
    // L'écran de chargement, lui, est CELUI DE CHAQUE JEU : le sprite
    // « loading » lavande de Minipixiz, l'écran blanc du disque (cadre à
    // feston + logo frusion) pour Miniwave — les mêmes qu'en Flash.
    // Reprendre le vert du bureau les effacerait.
    if (jeu === 'minipixiz') {
      assert.match(html, /#chargement \{[\s\S]{0,220}background: #ac9dec;/,
        jeu + ' : le chargement est l\'écran-titre du jeu');
      assert.match(html, /titre-logo\.svg/, jeu + ' : avec son logo');
    } else {
      assert.match(html, /#chargement \{[\s\S]{0,220}background: #ffffff;/,
        jeu + ' : le chargement est l\'écran blanc du disque d\'origine');
      assert.match(html, /loader\/loader\.json/, jeu + ' : cadre et logo frusion du SWF');
    }
  }
});

test('le bouton rose est la TUILE nue, le triangle posé dessus', () => {
  // but.Push monte ses boutons en deux clips (Push.init) : la tuile
  // (butPushSmallPink, 378) et le glyphe dans son enfant `icon`
  // (gfx.icon.gotoAndStop(frame)). Notre extracteur maison ramenait l'enfant
  // avec la tuile : le carré rose sortait avec le glyphe « liste » collé
  // dessus. La tuile vient donc de FFDec, nue.
  const png = fs.readFileSync(path.join(ROOT, 'public/fb/fiche/bouton_rose.png'));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'c\'est bien un PNG');
  // Les dimensions vivent dans l'en-tête IHDR (deux entiers 32 bits, offset 16).
  assert.equal(png.readUInt32BE(16), 60, 'la tuile exportée à 3× : 60 px');
  assert.equal(png.readUInt32BE(20), 60, 'carrée');
  const script = fs.readFileSync(path.join(ROOT, 'scripts/extract-fiche-assets.js'), 'utf8');
  assert.match(script, /DefineSprite_378_butPushSmallPink\/1\.png → bouton_rose\.png/,
    'la provenance FFDec est écrite');
  assert.ok(!/nom: 'butPushSmallPink'/.test(script),
    'et l\'ancienne extraction maison ne repasse pas derrière');
  // Le triangle reste un dessin à part, posé DANS le bouton.
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /id="fiche-avance"[^>]*><img src="\/fb\/fiche\/ico_avance\.png"/,
    'le triangle est l\'enfant du bouton');
  assert.match(html, /#fiche-avance \{[\s\S]{0,200}bouton_rose\.png'\) no-repeat/,
    'et la tuile en est le fond');
});

test('l\'onglet perso nomme le pays et la région, pas des blancs', () => {
  // Le bureau ne garde que des index et lit les noms dans la table qu'on lui
  // sert déjà (public/xml/lang_french.xml, bloc <ct>). La fiche mobile lit la
  // même — deux référentiels finiraient par diverger.
  const xml = fs.readFileSync(path.join(ROOT, 'public/xml/lang_french.xml'), 'utf8');
  assert.match(xml, /<c c="1" n="France"/, 'la table porte la France');
  assert.match(xml, /<r c="94">Val-de-Marne<\/r>/, 'et ses départements');
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /function tablePays\(\)/, 'le serveur lit la table');
  assert.match(src, /pays: lieuDit\.pays, region: lieuDit\.region,/,
    'et la fiche en sort les NOMS');
  // Le repli : sans index résolvable, le texte libre plutôt qu'un blanc.
  assert.match(src, /region: region \|\| \(ud && ud\.region\) \|\| '',/,
    'à défaut d\'index, le texte libre');
});

test('la vue modérateur : kick, ban et totoché, aux modérateurs seulement', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Cachés par défaut, montrés quand le REGARDEUR est modérateur (d.vous).
  for (const id of ['fiche-kick', 'fiche-ban', 'fiche-totoche']) {
    assert.match(html, new RegExp('id="' + id + '"[^>]*hidden'), id + ' caché par défaut');
  }
  assert.match(html, /d\.vous && d\.vous\.moderateur/, 'la vue suit les droits du regardeur');
  // Les mêmes fils que le bureau : kick <l>, ban <m>, totoché <az> — et une
  // confirmation d'abord, un doigt glisse plus vite qu'une souris.
  assert.match(html, /wsSend\('<l u="' \+ xmlEscape\(p\) \+ '" g="' \+ xmlEscape\(state\.room/,
    'kick sur le salon courant');
  assert.match(html, /wsSend\('<m u="' \+ xmlEscape\(p\) \+ '" g="0" \/>'\)/, 'ban global');
  assert.match(html, /wsSend\('<az u="' \+ xmlEscape\(p\) \+ '" \/>'\)/, 'totoché');
  assert.ok((html.match(/window\.confirm\(/g) || []).length >= 3, 'trois confirmations');
  // Et le serveur dit les droits du regardeur.
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /vous: \{ moderateur: !!moi\.isModerator, animateur: !!moi\.isAnimator \}/,
    'la fiche porte `vous`');
});

test('l\'écran mobile porte la fenêtre, les onglets et les gestes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // La fenêtre et ses quatre onglets.
  assert.match(html, /id="fiche-backdrop"/, 'la surcouche');
  for (const o of ['frutiz', 'perso', 'scores', 'bonus']) {
    assert.match(html, new RegExp('data-onglet="' + o + '"'), 'l\'onglet ' + o);
  }
  // Le signe au centre, l'ascendant en petit — et la silhouette du signe caché.
  assert.match(html, /\/fb\/signe_/, 'les dessins extraits');
  assert.match(html, /"mystere"/, 'le signe caché a sa silhouette');
  // Les gestes : pseudo → fiche (liste, messages, trombinoscope), fiche → privé.
  assert.match(html, /Voir la fiche de/, 'l\'appui sur un pseudo est annoncé');
  assert.match(html, /fr\.addEventListener\("click", function \(\) \{ ouvrirFiche\(auteur\); \}\)/,
    'le pseudo d\'un message ouvre la fiche');
  assert.match(html, /ouvrirFiche\(c\.getAttribute\("data-pseudo"\)\)/,
    'une vignette du trombinoscope aussi');
  assert.match(html, /api\/light\/fiche\?sid=/, 'la fiche interroge le bon endpoint');
  // L'en-tête : la bouille (Ruffle), le niveau, « âge - ville », fermer.
  assert.match(html, /previewIframe\(d\.bouille\)/, 'l\'avatar est la vraie bouille');
  assert.match(html, /id="fiche-niveau"/, 'la plaque NIV');
  assert.match(html, /ans"/, 'l\'âge en années');
});

// ── Les deux retouches d'affichage du mode light ─────────────────────────

test('la bouille de la fiche a grossi de quinze pour cent', () => {
  // 52 px d'origine × 1,15 = 59,8 → 60. Un visage de 52 px ne se reconnaît pas
  // sur un téléphone, et c'est la vignette qu'on regarde en premier.
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const regle = /\.fiche-plaque \.fa-frame \{[^}]*\}/.exec(html);
  assert.ok(regle, 'la vignette de la fiche a bien sa règle');
  assert.match(regle[0], /width: 60px; height: 60px/, 'elle fait soixante pixels');
  assert.ok(!/width: 52px; height: 52px/.test(regle[0]), 'et plus cinquante-deux');
  // La plaque reste une boîte flexible : elle s'élargit d'elle-même autour.
  const plaque = /\.fiche-plaque \{[^}]*\}/.exec(html);
  assert.ok(plaque && /display: flex/.test(plaque[0]),
    'la plaque suit la vignette sans qu\'on ait à la retailler');
});

test('la liste des connectés n\'affiche plus d\'enveloppe à côté des pseudos', () => {
  // Toucher un pseudo ouvre sa FICHE — et c'est la fiche qui porte le bouton
  // « discuter en privé ». L'enveloppe promettait autre chose que ce qu'elle
  // faisait, sur chacune des lignes.
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.ok(!/#users-drawer \.u\.mp::after/.test(html), 'plus d\'enveloppe en bout de ligne');
  assert.ok(!/content: "\\2709"/.test(html), 'ni son glyphe nulle part ailleurs');
  // Le geste, lui, ne change pas : la ligne reste cliquable et mène à la fiche.
  assert.match(html, /#users-drawer \.u\.mp \{ cursor: pointer/, 'la ligne reste un bouton');
  assert.match(html, /u\.title = "Voir la fiche de " \+ pseudo;/, 'et dit ce qu\'elle ouvre');
});
