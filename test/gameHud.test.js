// Options « tableau de bord » posées en overlay au-dessus des jeux Flash :
//   - Frutisnake : longueur du serpent, dynamites, durée du bonus actif
//   - Swapou     : compteur de coups
//
// Les deux reposent sur le MÊME pont : un ExternalInterface.call injecté dans le
// bytecode AVM1 du SWF, capté par window.fp*() dans game-popup.html.
//
// Le piège que ces tests verrouillent : ExternalInterface est une API Flash
// Player 8. Tant que l'en-tête du SWF annonce la version 7 (leur valeur
// d'origine), Ruffle ne publie pas flash.external.ExternalInterface et l'appel
// injecté ne fait RIEN — sans erreur, sans trace. Vérifié par une sonde
// inconditionnelle posée sur l'image 1 : zéro rappel en version 7, rappel
// immédiat en version 8. Un futur re-patch qui oublierait de relever cet octet
// casserait les deux options en silence : d'où l'assertion ci-dessous.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3427;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000' }),
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
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

function swfBody(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel));
  const sig = raw.slice(0, 3).toString('ascii');
  return { version: raw[3], body: sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8) };
}
const contient = (buf, s) => buf.includes(Buffer.from(s, 'latin1'));

test('kasparov obtient le tableau de bord Frutisnake, pas les autres joueurs', async () => {
  const sidOk = await sidFor('kasparov');
  const j = await (await fetch(BASE + '/api/features?sid=' + sidOk)).json();
  assert.equal(j.features.snake3Hud, true, 'kasparov → snake3Hud accordé');
  assert.equal(j.features.swapouMoves, true, 'kasparov → compteur Swapou conservé');

  const sidKo = await sidFor('quidamsnake');
  const k = await (await fetch(BASE + '/api/features?sid=' + sidKo)).json();
  assert.equal(k.features.snake3Hud, false, 'autre joueur → snake3Hud refusé');
  assert.equal(k.features.swapouMoves, false, 'autre joueur → compteur Swapou refusé');

  const anon = await (await fetch(BASE + '/api/features')).json();
  assert.equal(anon.features.snake3Hud, false, 'sans session → refusé');
});

test('snake3.swf : pont présent et jouable en version 8 (sinon ExternalInterface est mort)', () => {
  const { version, body } = swfBody('Games/snake3/snake3.swf');
  assert.ok(version >= 8, `version SWF ${version} : ExternalInterface exige Flash 8, l'appel serait ignoré en silence`);
  assert.ok(contient(body, 'fpSnakeHud'), 'nom du rappel JS présent');
  assert.ok(contient(body, 'ExternalInterface'), 'appel ExternalInterface présent');
  // Symboles du jeu intacts : l'injection ne doit rien avoir écrasé.
  for (const s of ['slots', 'giveItem', ']@=%^$', '3}-82]#', '*}^#"#']) {
    assert.ok(contient(body, s), `symbole du jeu conservé : ${JSON.stringify(s)}`);
  }
});

test('swapou.swf : même pont, même exigence de version', () => {
  const { version, body } = swfBody('Games/swapou2/swapou.swf');
  assert.ok(version >= 8, `version SWF ${version} : le compteur de coups serait ignoré en silence`);
  assert.ok(contient(body, 'fpSwapouCoup'), 'nom du rappel JS présent');
  assert.ok(contient(body, 'ExternalInterface'), 'appel ExternalInterface présent');
});

test('panneau Frutisnake : à CÔTÉ de la scène, aux couleurs du jeu', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function setupSnakeHud'), html.indexOf('const wrap = document.getElementById'));
  assert.ok(bloc.length > 100, 'bloc setupSnakeHud présent');

  assert.ok(bloc.includes('"Longueur"'), 'information affichée : Longueur');
  assert.ok(bloc.includes('"Dynamites"'), 'information affichée : Dynamites');
  assert.ok(bloc.includes('Dur\\u00e9e bonus en cours'), 'information affichée : Durée bonus en cours');
  // Posé dans la RANGÉE, pas dans la scène : l'aire de jeu n'est jamais couverte,
  // et le panneau suit la loupe puisque c'est la rangée qui est mise à l'échelle.
  assert.ok(bloc.includes('getElementById("stage-row")'), 'inséré à côté de la scène');
  assert.ok(!bloc.includes('getElementById("player-wrap")'), 'jamais posé par-dessus le jeu');
  assert.ok(html.includes('#stage-row'), 'la rangée existe dans la page');
  assert.ok(/row\.style\.transform = "scale\(/.test(html), 'la loupe met à l\'échelle la rangée');

  // Habillage demandé : fond vert du jeu, bordure blanche 2 px, ANGLES DROITS,
  // libellés Verdana blancs.
  assert.ok(bloc.includes('background:#83CA22'), 'remplissage vert du jeu');
  assert.ok(bloc.includes('border:2px solid #fff'), 'bordure blanche de 2 px');
  assert.ok(!/#snake-hud\{[^}]*border-radius/.test(bloc), 'encart sans arrondi');
  assert.ok(/color:#fff/.test(bloc) && /Verdana/.test(bloc), 'libellés Verdana blancs');

  // Valeurs en Alba : contour blanc épais peint DERRIÈRE la lettre, et dégradé
  // dont la teinte FONCÉE est en bas (stop 0 clair → stop 1 foncé).
  assert.ok(bloc.includes('paint-order:stroke fill'), 'contour blanc derrière le remplissage');
  const trait = /stroke-width:(\d+)/.exec(bloc);
  assert.ok(trait && Number(trait[1]) >= 90, `contour épais (${trait && trait[1]})`);
  // On isole le dégradé : #E46A6A apparaît aussi dans le repli texte, un simple
  // indexOf sur tout le bloc comparerait la mauvaise occurrence.
  const grad = /linearGradient id="fp-alba-grad"[\s\S]*?linearGradient>/.exec(bloc);
  assert.ok(grad, 'dégradé Alba défini');
  assert.ok(grad[0].indexOf('#E7A8A8') < grad[0].indexOf('#E46A6A'),
    'dégradé inversé : clair en haut, #E46A6A foncé en bas');
  assert.ok(bloc.includes('/fb/alba-glyphs.json'), 'glyphes Alba chargés');

  // `time` est déjà en secondes (Const.as : « temps en secondes »).
  assert.ok(/Math\.ceil\(t\)/.test(bloc), 'durée lue en secondes, sans conversion');
  assert.ok(!/t\s*\/\s*30/.test(bloc), 'pas de conversion images→secondes erronée');
});

test('durée du bonus : format mm:ss, et 00:00 quand aucun bonus n\'est chronométré', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const src = /function mmss\(sec\) \{[\s\S]*?\n    \}/.exec(html);
  assert.ok(src, 'fonction mmss présente');
  const mmss = new Function(src[0] + '; return mmss;')();

  assert.equal(mmss(0), '00:00', 'aucun bonus chronométré');
  assert.equal(mmss(13), '00:13');
  assert.equal(mmss(59), '00:59');
  assert.equal(mmss(60), '01:00');
  assert.equal(mmss(138), '02:18');
  // Le plus long bonus du jeu (potion verte : 80 + random(80)) reste sur 2 chiffres.
  assert.equal(mmss(160), '02:40');
  assert.equal(mmss(-5), '00:00', 'jamais de durée négative');
});

test('glyphes Alba : extraits du SWF, chiffres complets et boîte exploitable', () => {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/fb/alba-glyphs.json'), 'utf8'));
  assert.equal(f.police, 'Alba');
  for (const c of '0123456789:') {
    assert.ok(f.glyphes[c] && f.glyphes[c].d.length > 20, `glyphe ${c} présent`);
    assert.ok(f.glyphes[c].adv > 0, `chasse du glyphe ${c}`);
  }
  // La boîte des chiffres doit être NETTEMENT plus serrée que l'ascendante
  // déclarée : c'est elle qui donne la bonne taille de rendu (sinon les nombres
  // sortent deux fois trop petits dans une hauteur fixée).
  const hauteur = f.basChiffres - f.hautChiffres;
  assert.ok(hauteur > 300 && hauteur < f.ascendante + f.descendante,
    `boîte des chiffres exploitable (${hauteur} sur ${f.ascendante + f.descendante})`);
});
