/*
 * Le FD MiniPixiz « light » : un second disque, à anneau ROUGE, qui ouvre le
 * portage HTML du jeu au lieu du SWF de 2006.
 *
 * Pourquoi un disque de plus plutôt qu'un remplacement : les deux moteurs
 * coexistent, et le joueur doit pouvoir choisir. D'où la couleur — c'est elle
 * qui les distingue d'un coup d'œil dans « Mes disques ».
 *
 * Le rouge n'est pas décoratif. main.swf s'appuie dessus deux fois :
 *
 *   · but.icon.Full dessine le disque avec `ico.disc.gotoAndStop(desc[0] + 1)`
 *     — discType 3 tombe donc sur la 4e image du clip `disc` de fileIcon.swf,
 *     celle qui porte la transformation de couleur « tout en rouge » ;
 *   · en fin de partie, un disque N'ÉCLATE que si `discType < GAMEDISC_WHITE`
 *     (2). À 3, il est relâché : le disque light ne se consomme jamais.
 *
 * Ce fichier vérifie les deux bouts de la chaîne : ce que le serveur annonce,
 * et ce que les SWF et ruffle.html en font.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3497;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5234', FRUTISCORE_PORT: '5235',
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
after(() => { if (proc) proc.kill('SIGKILL'); });

// ── Le SWF, source de vérité du dessin ────────────────────────────────────

function corpsSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
}
function tags(buf, debut, fin) {
  const out = [];
  let o = debut;
  while (o < fin) {
    if (o + 2 > fin) break;
    const hdr = buf.readUInt16LE(o);
    const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = buf.readUInt32LE(o + 2); h = 6; }
    if (code === 0) break;
    out.push({ code, o: o + h, len });
    o += h + len;
  }
  return out;
}
const debutTags = (b) => Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

// Lecteur de bits, pour la MATRIX puis le CXFORMWITHALPHA d'un PlaceObject2.
class Bits {
  constructor(b, o) { this.b = b; this.o = o; this.bit = 0; }
  u(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1); if (++this.bit === 8) { this.bit = 0; this.o++; } } return v; }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  cale() { if (this.bit) { this.bit = 0; this.o++; } }
}
function sauteMatrice(br) {
  br.cale();
  if (br.u(1)) { const n = br.u(5); br.s(n); br.s(n); }
  if (br.u(1)) { const n = br.u(5); br.s(n); br.s(n); }
  const n = br.u(5); br.s(n); br.s(n); br.cale();
}
function lisCxform(br) {
  br.cale();
  const aAlpha = br.u(1), aMult = br.u(1), n = br.u(4);
  const o = {};
  if (aMult) { o.mr = br.s(n); o.mv = br.s(n); o.mb = br.s(n); o.ma = br.s(n); }
  if (aAlpha) { o.ar = br.s(n); o.av = br.s(n); o.ab = br.s(n); o.aa = br.s(n); }
  br.cale();
  return o;
}

// Les images du clip exporté `disc`, avec la teinte appliquée à la galette.
function imagesDuClipDisc() {
  const b = corpsSwf(path.join(ROOT, 'public/fileIcon.swf'));
  const racine = tags(b, debutTags(b), b.length);

  let idDisc = null;
  for (const t of racine) {
    if (t.code !== 56) continue;                       // ExportAssets
    const n = b.readUInt16LE(t.o);
    let p = t.o + 2;
    for (let i = 0; i < n; i++) {
      const id = b.readUInt16LE(p); p += 2;
      let e = p; while (b[e]) e++;
      if (b.slice(p, e).toString('latin1') === 'disc') idDisc = id;
      p = e + 1;
    }
  }
  assert.ok(idDisc !== null, 'fileIcon.swf exporte un clip nommé « disc »');

  for (const t of racine) {
    if (t.code !== 39 || b.readUInt16LE(t.o) !== idDisc) continue;   // DefineSprite
    const images = [];
    let frame = 1;
    for (const s of tags(b, t.o + 4, t.o + t.len)) {
      if (s.code === 1) { frame++; continue; }                        // ShowFrame
      if (s.code !== 26) continue;                                    // PlaceObject2
      const flags = b[s.o];
      const prof = b.readUInt16LE(s.o + 1);
      const br = new Bits(b, s.o + 3);
      if (flags & 2) br.o += 2;                                       // a un caractère
      if (flags & 4) sauteMatrice(br);
      const cx = (flags & 8) ? lisCxform(br) : null;
      if (prof === 1) images.push({ frame, cx });                     // la galette
    }
    return images;
  }
  throw new Error('clip disc introuvable');
}

// Les étiquettes d'images d'un SWF : ce sont elles que gotoAndStop(<nom>) vise.
function etiquettes(fichier) {
  const b = corpsSwf(path.join(ROOT, fichier));
  const out = new Set();
  (function scan(debut, fin) {
    for (const t of tags(b, debut, fin)) {
      if (t.code === 43) out.add(b.slice(t.o, t.o + t.len).toString('latin1').replace(/\0.*$/, ''));
      if (t.code === 39) scan(t.o + 4, t.o + t.len);
    }
  })(debutTags(b), b.length);
  return out;
}

const attr = (xml, nom) => (new RegExp(`${nom}="([^"]*)"`).exec(xml) || [])[1];

// ── Ce que le serveur annonce ─────────────────────────────────────────────

test('tout joueur trouve le disque light dans « Mes disques », en rouge', async () => {
  const creds = { username: 'fdl' + RUN, password: 'secret123' };
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
  });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
  });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'connexion → sid');

  const xml = await (await fetch(`${BASE}/ff/ls?uid=disccollector&sid=${sid}`)).text();

  // Le contenu d'un nœud disque, c'est « <discType>\n<nom de vignette> ».
  const noeud = /<e u="minipixizlight"[^>]*>([^<]*)<\/e>/.exec(xml);
  assert.ok(noeud, `le disque light est listé (${xml.slice(0, 300)})`);
  const [type, vignette] = noeud[1].split('\n');
  assert.equal(type, '3', 'discType 3 = GAMEDISC_RED');
  assert.equal(vignette, 'minipixiz', 'il porte la vignette MiniPixiz');

  // Et le disque Flash est toujours là, noir, à côté.
  const flash = /<e u="minipixiz1"[^>]*>([^<]*)<\/e>/.exec(xml);
  assert.ok(flash, 'le disque Flash n\'a pas disparu');
  assert.equal(flash[1].split('\n')[0], '0', 'lui reste en FD noir');
});

test('le disque light livre un marqueur, pas un SWF', async () => {
  const xml = await (await fetch(`${BASE}/do/ld?u=minipixizlight`)).text();
  assert.equal(attr(xml, 't'), '3', 'type rouge sur le fil aussi');
  assert.equal(attr(xml, 'u'), 'light/minipixiz', 'le gameId est le marqueur light');
  assert.doesNotMatch(xml, /\.swf/, 'aucun SWF à charger — le jeu est en HTML');
  // swfName reste « minipixiz » : voyant « joue à… », <service> et classement
  // doivent se comporter comme pour le disque Flash.
  assert.equal(attr(xml, 'n'), 'minipixiz', 'le jeu annoncé reste MiniPixiz');

  const flash = await (await fetch(`${BASE}/do/ld?u=minipixiz1`)).text();
  assert.equal(attr(flash, 't'), '0', 'le disque Flash est inchangé');
  assert.match(flash, /games\/miniTroll\/minipixiz\.swf/, 'et charge toujours son SWF');
});

test('jouer en light se classe comme jouer en Flash', async () => {
  // Le portage poste `game=minipixiz` : même cuve que le disque d'origine.
  const creds = { username: 'fdlsc' + RUN, password: 'secret123' };
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
  });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
  });
  const sid = (await r.json()).sid;

  const rep = await fetch(`${BASE}/api/saveScore?sid=${sid}&game=minipixiz&m=0&score=1234`);
  const j = await rep.json();
  assert.ok(j.ok, `score accepté (${JSON.stringify(j)})`);
  assert.equal(j.rankingId, 'minipixiz_classic', 'et rangé dans la cuve MiniPixiz');
});

// ── Ce que les SWF et le client en font ───────────────────────────────────

test('discType 3 est bien l\'image ROUGE du clip disc', () => {
  const images = imagesDuClipDisc();
  const parImage = new Map(images.map((i) => [i.frame, i.cx]));

  // but.icon.Full : gotoAndStop(discType + 1). Le disque light vise l'image 4.
  const cx = parImage.get(4);
  assert.ok(cx, 'l\'image 4 applique une transformation de couleur');

  // couleur = couleur * mult/256 + add. Ici mult = 0 partout : la galette est
  // repeinte de la couleur d'ajout, sans rien garder de l'originale.
  assert.equal(cx.mr, 0, 'rouge : rien de la couleur d\'origine');
  assert.equal(cx.mv, 0, 'vert : idem');
  assert.equal(cx.mb, 0, 'bleu : idem');
  assert.equal(cx.ar, 255, 'et on ajoute le rouge à fond');
  assert.equal(cx.av, 0, 'sans vert');
  assert.equal(cx.ab, 0, 'sans bleu');
  assert.equal(cx.ma, 256, 'la transparence, elle, est préservée');

  // Les voisines, pour montrer que l'image 4 n'est pas prise au hasard : la 3
  // est le FD blanc de la boutique, la 2 le gris.
  assert.deepEqual(
    [parImage.get(2).ar, parImage.get(2).av, parImage.get(2).ab], [127, 127, 127], 'image 2 = gris');
  assert.deepEqual(
    [parImage.get(3).ar, parImage.get(3).av, parImage.get(3).ab], [255, 255, 255], 'image 3 = blanc');
});

test('la vignette du disque light existe vraiment dans fileIcon.swf', () => {
  // `ico.disc.label.gotoAndStop(desc[1])` : un nom absent laisserait le clip sur
  // sa première image, donc un disque au visuel d'un autre jeu.
  const labels = etiquettes('public/fileIcon.swf');
  assert.ok(labels.has('minipixiz'), 'l\'étiquette « minipixiz » est présente');
});

test('ruffle.html détourne le marqueur light vers le client HTML', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');

  assert.match(src, /LIGHT_CLIENTS\s*=\s*\{/, 'la table des clients light est déclarée');
  assert.match(src, /"light\/minipixiz":\s*\{\s*url:\s*"\/minipixiz\/"/,
    'le marqueur MiniPixiz pointe sur /minipixiz/');
  assert.match(src, /var lightClient = LIGHT_CLIENTS\[game\.swf\];/,
    'le lancement consulte la table');
  assert.match(src, /if \(LIGHT_CLIENTS\[gameId\]\)/,
    'et le repli par URL la consulte aussi — un marqueur n\'est pas un .swf');

  // L'ordre compte : la clé exacte doit primer sur les détections par nom.
  assert.ok(src.indexOf('var lightClient = LIGHT_CLIENTS[game.swf];') < src.indexOf('Opening native Grapiz client'),
    'le test light passe avant les reconnaissances par nom');
});

test('le disque light n\'éclate pas en fin de partie', () => {
  // main.swf : `if (gd.discType < frusion.Context.GAMEDISC_WHITE) → burstDisc`.
  // GAMEDISC_WHITE vaut 2 ; notre disque est à 3, donc il est relâché. Ce test
  // fige la règle côté serveur pour que personne ne repasse le disque en 0 ou 1
  // sans se rendre compte qu'il deviendrait consommable.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const bloc = /minipixizlight:\s*\{[^}]*?discType:\s*'(\d)'/s.exec(src);
  assert.ok(bloc, 'l\'entrée minipixizlight porte un discType');
  assert.ok(Number(bloc[1]) >= 2,
    `discType ${bloc[1]} < GAMEDISC_WHITE : le disque serait détruit après chaque partie`);
});
