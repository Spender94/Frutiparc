// Option « tableau de bord » de Frutisnake : longueur du serpent, dynamites,
// durée du bonus en cours, affichées dans un panneau à côté de la scène.
//
// Elle repose sur un ExternalInterface.call injecté dans le bytecode AVM1 du
// SWF, capté par window.fpSnakeHud() dans game-popup.html. Le même montage
// avait été appliqué à Swapou pour un compteur de coups : il cassait le jeu, il
// a été retiré (voir le test « swapou.swf : intact »).
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
    // server.js ouvre aussi deux sockets sur des ports FIXES par défaut (5000
    // chat / 5001 scores). Deux fichiers de test lancés en parallèle par
    // `node --test` se les disputeraient et le second serveur ne démarrerait
    // jamais : on les décale ici.
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5100', FRUTISCORE_PORT: '5101',
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
  // swapouMoves reste accordé : il ne pilote plus que le compteur de la version
  // JavaScript de Swapou, le pont SWF ayant été retiré.
  assert.equal(j.features.swapouMoves, true, 'kasparov → compteur Swapou (version JS) conservé');

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
  for (const s of ['slots', 'giveItem', ']@=%^$', '3}-82]#', "'@{ #", '|*?23!"']) {
    assert.ok(contient(body, s), `symbole du jeu conservé : ${JSON.stringify(s)}`);
  }
  // Second point d'injection : le compteur de fruits, posé dans eat_fruit.
  assert.ok(contient(body, '__nf'), 'compteur de fruits présent');
});

test('chronomètre : la pause et les coupures ne comptent pas', () => {
  // Le chronomètre est tenu par la PAGE (le jeu ne mesure pas le temps écoulé).
  // On extrait la fonction du fichier livré et on la fait tourner pour de vrai.
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const src = /var chrono = 0, derniereTick = 0;[\s\S]*?\n    \}/.exec(html);
  assert.ok(src, 'fonction majChrono présente');
  const faux = { valeur: 1000 };
  const sandbox = new Function('Date', src[0] +
    '; return { maj: majChrono, lire: function () { return chrono; } };')(
    { now: () => faux.valeur });

  // Trois tics de 200 ms en jeu → 400 ms comptés (le premier tic amorce l'horloge).
  for (const dt of [0, 200, 200]) { faux.valeur += dt; sandbox.maj(false, false); }
  assert.equal(sandbox.lire(), 400, 'temps de jeu cumulé');

  // Un tic en PAUSE ne compte pas.
  faux.valeur += 200; sandbox.maj(true, false);
  assert.equal(sandbox.lire(), 400, 'la pause ne compte pas');

  // Une coupure de plus d'une seconde (fin de partie, onglet caché) non plus :
  // le chronomètre se fige sur la durée finale.
  faux.valeur += 5000; sandbox.maj(false, false);
  assert.equal(sandbox.lire(), 400, 'une longue coupure ne compte pas');

  // Nouvelle partie : remise à zéro.
  faux.valeur += 200; sandbox.maj(false, true);
  assert.equal(sandbox.lire(), 0, 'une nouvelle partie repart de zéro');
});

// Le compteur de coups Swapou a d'abord cassé le jeu : le script d'alors
// n'agrandissait PAS le codeSize de la fonction englobante, si bien que l'AVM
// s'arrêtait 80 octets trop tôt et tronquait la routine d'échange. La deuxième
// version est volontairement minimale — pas de changement de version du SWF
// (getURL existe depuis Flash 4), aucune écriture mémoire, aucun branchement —
// et les tests ci-dessous verrouillent ces trois garanties.
test('swapou.swf : pont getURL, version d\'origine préservée', () => {
  const { version, body } = swfBody('Games/swapou2/swapou.swf');
  assert.equal(version, 7, 'la version du SWF ne doit PAS être relevée');
  assert.ok(contient(body, 'fpswcoup:'), 'préfixe getURL du compteur présent');
  assert.ok(!contient(body, 'ExternalInterface'),
    'pas d\'ExternalInterface : il exigerait la version 8');
});

test('swapou.swf : le codeSize de la fonction englobante a bien été agrandi', () => {
  // C'est LA régression qui avait cassé le jeu. On refait le calcul : le site
  // injecté doit tomber dans le corps déclaré d'une fonction, pas au-delà.
  const { body } = swfBody('Games/swapou2/swapou.swf');
  const rect = (b) => Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
  let off = rect(body) + 4, tag = null;
  while (off < body.length) {
    const h = body.readUInt16LE(off), c = h >> 6;
    let l = h & 0x3f, hs = 2;
    if (l === 0x3f) { l = body.readUInt32LE(off + 2); hs = 6; }
    if (c === 0) break;
    if (c === 59 && body.slice(off + hs, off + hs + l).includes(Buffer.from('fpswcoup:', 'latin1'))) {
      tag = { off, hs, l }; break;
    }
    off += hs + l;
  }
  assert.ok(tag, 'tag contenant le pont trouvé');
  const s0 = tag.off + tag.hs;
  const plen = body.readUInt16LE(s0 + 3), cnt = body.readUInt16LE(s0 + 5);
  const cp = []; let q = s0 + 7;
  for (let i = 0; i < cnt; i++) { const e = body.indexOf(0, q); cp.push(body.slice(q, e).toString('latin1')); q = e + 1; }
  const iUrl = cp.indexOf('fpswcoup:');
  assert.ok(iUrl >= 0, 'préfixe présent dans la table des constantes');

  const start = s0 + 5 + plen, end = tag.off + tag.hs + tag.l;
  const fns = [];
  let site = -1, pc = start;
  while (pc < end) {
    const op = body[pc];
    const next = op >= 0x80 ? pc + 3 + body.readUInt16LE(pc + 1) : pc + 1;
    if (next <= pc || next > end) break;
    if (op === 0x8E) { const hdrEnd = next; fns.push({ debut: hdrEnd, fin: hdrEnd + body.readUInt16LE(hdrEnd - 2) }); }
    if (op === 0x96 && site < 0) {
      const seg = body.slice(pc + 3, next);
      // Push cp(fpswcoup:) — index sur 1 ou 2 octets selon sa taille.
      if ((seg[0] === 0x08 && seg[1] === iUrl) || (seg[0] === 0x09 && seg.readUInt16LE(1) === iUrl)) site = pc;
    }
    pc = next;
  }
  assert.ok(site > 0, 'site injecté localisé');
  const englobantes = fns.filter((f) => f.debut <= site && site < f.fin);
  assert.ok(englobantes.length >= 1,
    'le site injecté tombe dans le corps DÉCLARÉ d\'une fonction — sinon l\'AVM ' +
    'tronquerait la routine d\'échange, ce qui avait cassé le jeu');
});

test('panneau Frutisnake : à CÔTÉ de la scène, aux couleurs du jeu', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function setupSnakeHud'), html.indexOf('const wrap = document.getElementById'));
  assert.ok(bloc.length > 100, 'bloc setupSnakeHud présent');

  assert.ok(bloc.includes('"Longueur"'), 'information affichée : Longueur');
  assert.ok(bloc.includes('Fruits aval\\u00e9s'), 'information affichée : Fruits avalés');
  assert.ok(bloc.includes('"Dynamites"'), 'information affichée : Dynamites');
  assert.ok(bloc.includes('Dur\\u00e9e bonus en cours'), 'information affichée : Durée bonus en cours');
  assert.ok(bloc.includes('Dur\\u00e9e de la partie'), 'information affichée : Durée de la partie');
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
