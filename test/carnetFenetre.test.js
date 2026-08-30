/*
 * « MES CONTACTS » ET « LISTE NOIRE » — les deux dossiers du carnet, ouverts
 * dans la fenêtre du bureau.
 *
 * D'époque il n'existe pas de fenêtre de contacts à part : « Mes contacts »
 * est un DOSSIER (`fileMng.mycontact`) qu'on ouvre dans `win.Explorer`, et la
 * liste noire un autre — que `FPFileMng.onLoadDesktop` pose lui-même sur le
 * bureau, le listing de la racine ne la portant pas :
 *
 *     l.push({type: "folder", uid: "blacklist", desc: ["Liste noire","blacklist"]});
 *
 * Tout ce que la fenêtre sait faire tient dans QUATRE appels de `FPFileMng` :
 * `move` (ranger, bannir, jeter), `make` (ajouter un frutiz, créer un
 * sous-dossier), et les listeners qui relisent. Le serveur les tenait déjà —
 * il n'y avait aucune fenêtre pour les appeler.
 *
 * Ce fichier vérifie les trois moitiés :
 *
 *   · la SOURCE — /ff/ls, /ff/mv et /ff/mk font vraiment ce que la fenêtre
 *     leur demande, et /api/light/contacts sert la bouille de chacun (celle
 *     que `IconFileBox.onStatusObj` reçoit d'époque par `mainCnx.atrace`) ;
 *   · les DESSINS — les deux dossiers ont leur icône, sortie de fileIcon.swf ;
 *   · le PORTAGE — les deux fenêtres sont déclarées au gabarit d'époque, la
 *     liste noire porte la peau POURPRE de `frFileBlackList`, et les tuiles
 *     ne paraissent que sur le bureau.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3541;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let proc = null;
let sid = null;
const USER = 'crnt' + RUN;
const AMI = 'crna' + RUN;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5340', FRUTISCORE_PORT: '5341',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) { pret = true; break; } } catch { /* pas prêt */ }
    await wait(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  const entetes = { 'Content-Type': 'application/json' };
  for (const u of [USER, AMI]) {
    await fetch(BASE + '/api/auth/register', {
      method: 'POST', headers: entetes,
      body: JSON.stringify({ username: u, password: 'secret123' }),
    });
  }
  const rep = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: entetes,
    body: JSON.stringify({ username: USER, password: 'secret123' }),
  })).json();
  sid = rep.sid;
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('crn')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const q = (chemin, params) => `${BASE}${chemin}?sid=${encodeURIComponent(sid)}`
  + Object.entries(params || {}).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
const ls = async (uid) => (await fetch(q('/ff/ls', { uid }))).text();
const mv = async (f, folder) => (await fetch(q('/ff/mv', { f, folder }))).text();
const mk = async (params) => (await fetch(q('/ff/mk', params))).text();

// ══ LA SOURCE ═════════════════════════════════════════════════════════════

test('un frutiz glissé sur le carnet s’y AJOUTE (fileMng.make, uid « new »)', async () => {
  await mk({ t: 'contact', folder: 'mycontact', d: AMI + '@frutiparc.com' });
  const xml = await ls('mycontact');
  assert.match(xml, new RegExp(`<e u="${AMI}" t="contact"[^>]*>${AMI}@frutiparc\\.com</e>`));
});

test('le carnet sert la BOUILLE de chacun — ce que onStatusObj donne d’époque', async () => {
  const d = await (await fetch(q('/api/light/contacts'))).json();
  assert.strictEqual(d.ok, true);
  const c = (d.contacts || []).find((x) => x.pseudo.toLowerCase() === AMI);
  assert.ok(c, 'le contact doit être servi');
  assert.strictEqual(typeof c.bouille, 'string');
  assert.strictEqual(c.bouille.length, 24, 'une bouille fait 24 signes');
  assert.ok('enLigne' in c, 'la présence décide du voyant');
  // La LISTE NOIRE arrive par le même chemin : sans elle, un banni n'aurait
  // pas de visage dans sa fenêtre.
  assert.ok(Array.isArray(d.noire), '/api/light/contacts doit servir la liste noire');
});

test('d’une fenêtre à l’autre : le carnet → la liste noire, et retour', async () => {
  await mv(AMI, 'blacklist');
  assert.match(await ls('blacklist'), new RegExp(`<e u="${AMI}" t="contact"`));
  assert.doesNotMatch(await ls('mycontact'), new RegExp(`<e u="${AMI}" t="contact"`));
  // Et le retour — c'est le même verbe, dans l'autre sens.
  await mv(AMI, 'mycontact');
  assert.match(await ls('mycontact'), new RegExp(`<e u="${AMI}" t="contact"`));
  assert.doesNotMatch(await ls('blacklist'), new RegExp(`<e u="${AMI}" t="contact"`));
});

test('l’étoile crée un sous-dossier, et un contact s’y range', async () => {
  const rep = await mk({ t: 'folder', folder: 'mycontact', d: 'Amis' });
  const uid = /<r u="([^"]+)"/.exec(rep)[1];
  // L'ARBRE le nomme et le TYPE : sans lui la fenêtre l'afficherait « Undefined ».
  const arbre = await (await fetch(q('/ff/tree'))).text();
  assert.match(arbre, new RegExp(`<f u="${uid}" n="Amis" t="mycontact"`));
  await mv(AMI, uid);
  assert.match(await ls(uid), new RegExp(`<e u="${AMI}" t="contact"`));
  // Le sous-dossier est SERVI DANS le carnet, avec son contenu.
  assert.match(await ls('mycontact'), new RegExp(`<f u="${uid}"[^>]*>\\s*<e u="${AMI}"`));
  // Jeté, il rend ses contacts à la racine.
  await mv(uid, 'recyclebin');
  assert.doesNotMatch(await ls('mycontact'), new RegExp(`<f u="${uid}"`));
  assert.match(await ls('mycontact'), new RegExp(`<e u="${AMI}" t="contact"`));
});

// ══ LES DESSINS ═══════════════════════════════════════════════════════════

test('les deux dossiers ont leur icône, sortie de fileIcon.swf', () => {
  for (const nom of ['ico_dossier_mycontact', 'ico_dossier_blacklist']) {
    assert.ok(fs.existsSync(path.join(SPRITES, nom + '.svg')), nom + ' manquant');
  }
  const cadres = JSON.parse(fs.readFileSync(path.join(SPRITES, 'explorateur.json'), 'utf8'));
  assert.ok(cadres.ico_dossier_mycontact && cadres.ico_dossier_blacklist,
    'les deux dessins doivent avoir leur cadre');
});

// ══ LE PORTAGE ════════════════════════════════════════════════════════════

test('les deux fenêtres sont le MÊME win.Explorer, au gabarit d’époque', () => {
  for (const cle of ['ex-contacts', 'ex-noire']) {
    const m = new RegExp(`'${cle}':\\s*\\{[^}]*\\}`).exec(JS);
    assert.ok(m, cle + ' n’est pas déclarée');
    assert.match(m[0], /fruit: 'winExplorer'/, 'la pastille est la banane');
    assert.match(m[0], /l: 402, h: 402/, 'pos = {50,50,400,400} plus le contour');
    assert.match(m[0], /centre: true/, 'init finit par moveToCenter()');
  }
  // Et les deux racines : `fileMng.mycontact` et le dossier « blacklist ».
  assert.match(JS, /contacts:\s*\{[^}]*uid: 'mycontact'/);
  assert.match(JS, /noire:\s*\{[^}]*uid: 'blacklist'/);
});

test('la liste noire porte la peau POURPRE de frFileBlackList', () => {
  // `mainStyleName = folderType.styleName` : c'est le DOSSIER qui décide.
  // `getWinStyle().frFileBlackList` vaut [purple, purple], et la famille
  // purple de global.as donne main #D0B5DC, shade #BF9ED1, darkest #6E3C8D.
  const bloc = /\.ex-panel\.ex-noire \.ex-champ \{[\s\S]*?\}/.exec(CSS);
  assert.ok(bloc, 'la liste noire n’a pas de peau');
  assert.match(bloc[0], /#D0B5DC/, 'la chair est purple.main');
  assert.match(bloc[0], /border-color: #BF9ED1/, 'le liseré est purple.shade');
  assert.match(CSS, /\.ex-panel\.ex-noire \.ex-lbl[\s\S]{0,120}color: #6E3C8D/);
  // La glissière suit le composant, comme les autres fenêtres.
  assert.match(CSS, /--asc-glissiere: #BF9ED1; --asc-liseret: #A679C1;/);
});

test('un contact est une BOUILLE qui s’attrape, et son clic ouvre la fiche', () => {
  const c = /function caseContact\(cle, e\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(c, /dessin: dessinBouille\(bouille\)/, 'but.Icon remplace l’icône par la bouille');
  assert.match(c, /if \(estGaspard\(nom\)\) ouvrirGaspard\(\); else ouvrirFiche\(nom\);/,
    'openFunctions.as : Gaspard ouvre SA fenêtre, les autres leur fiche');
  assert.match(c, /rendreAttrapable\(c, \{/, 'un fichier s’attrape');
  assert.match(c, /uid: e\.uid, type: 'contact', desc: \[adresse, bouille\]/);
});

test('les trois cibles de dépôt du carnet : la fenêtre, un sous-dossier, le bureau', () => {
  // `box.Explorer` est un dropBox dont l'uid est celui de la liste OUVERTE.
  assert.match(JS, /if \(contactsDe\(cle\)\) \{\s*\n\s*if \(info\.type !== 'contact'\) return false;/);
  // `IconFileBox.onDrop` : une icône de dossier prend SON PROPRE uid.
  assert.match(JS, /dossier\.setAttribute\('data-depot', 'dossier-carnet'\);/);
  assert.match(JS, /quoi === 'dossier-carnet'\) pris = deposerDansCarnet\(info, boite\.getAttribute\('data-uid'\)\)/);
  // `uid == "new"` → make ; sinon → move. Les deux branches sont là.
  const dep = /function deposerDansCarnet\(info, dossier\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(dep, /if \(info\.uid === 'new' \|\| !info\.uid\) \{/);
  assert.match(dep, /\/ff\/mk\?sid=/);
  assert.match(dep, /deplacerFichier\(info\.uid, dossier\);/);
  // Banni ou jeté, il quitte AUSSI le bureau — comme `desktopRemove` d'époque.
  assert.match(dep, /if \(dossier === 'blacklist' \|\| dossier === 'recyclebin'\)/);
});

test('un frutiz s’attrape aussi dans un salon — c’est ce que le bandeau promet', () => {
  assert.match(JS, /attraperFrutiz: function \(el, pseudo, bouille\) \{/);
  assert.match(LIGHT, /BureauFrutiz\.attraperFrutiz\(u, pseudo,/);
  // Bureau seulement : au doigt, tirer sur la liste la fait défiler.
  assert.match(LIGHT, /BureauFrutiz\.actif\(\)\s*\n\s*&& BureauFrutiz\.attraperFrutiz\) \{/);
});

test('les phrases du bandeau sont celles de lang_french.as', () => {
  // `box.Explorer.onLoadList` (0x8831c…) : quatre branches, quatre phrases.
  assert.match(JS, /Vous pouvez refuser les discussions privées et invitations des contacts /);
  assert.match(JS, /Vous pouvez ajouter un contact depuis la fiche d’un frutiz/);
  assert.match(JS, /Pour créer un dossier, il vous suffit de cliquer sur le bouton avec /);
  assert.match(JS, /Pour inviter un de vos contacts dans une discussion privée ou un salon/);
  // Les conditions d'époque, au chiffre près.
  assert.match(JS, /if \(n < 3 && !aDossier\)/);
  assert.match(JS, /if \(nbContacts > 15\)/);
  // Le tirage est fait À L'OUVERTURE : sinon la phrase clignoterait à chaque
  // relecture silencieuse.
  assert.match(JS, /if \(!silencieux \|\| etat\.tirage === undefined\) etat\.tirage = Math\.random\(\) \* 100;/);
});

test('l’étoile n’est active QUE sur « Mes contacts » — le serveur n’en crée pas ailleurs', () => {
  assert.match(JS, /uid === 'mycontact'\s*\n\s*\? boutonNav\('new_folder', 'nouveau dossier'/);
  // La liste noire, elle, n'a pas de bouton du tout (`flNewDirectory` faux).
  assert.match(JS, /t\.flNewDirectory = !\(MAIL_UIDS\[uid\] \|\| uid === 'inventory' \|\| uid === 'blacklist'\)/);
  assert.match(SRV, /if \(type === 'folder' && folder === 'mycontact'\) \{/);
});

test('les deux tuiles n’existent que sur le bureau, et ouvrent leur fenêtre', () => {
  assert.match(LIGHT, /class="home-tile home-tile-bureau" data-go="contacts"/);
  assert.match(LIGHT, /class="home-tile home-tile-bureau" data-go="noire"/);
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirContacts\) BureauFrutiz\.ouvrirContacts\(\);/);
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirListeNoire\) BureauFrutiz\.ouvrirListeNoire\(\);/);
  assert.match(JS, /ouvrirContacts: function \(\) \{ ouvrirExplorateur\('contacts'\); \}/);
  assert.match(JS, /ouvrirListeNoire: function \(\) \{ ouvrirExplorateur\('noire'\); \}/);
  // `home-tile-bureau` : cachée partout ailleurs.
  assert.match(LIGHT, /\.home-tile-bureau \{ display: none; \}/);
});

test('le carnet est lu UNE fois pour la bande et les deux fenêtres', () => {
  assert.match(JS, /function carnetPret\(\) \{ return carnetEnCours \|\| lireCarnet\(\); \}/);
  assert.match(JS, /contactsDe\(cle\) \? carnetPret\(\) : null,/);
  // Tout ce qui montre le carnet se relit après un déplacement — c'est
  // `callListeners` d'époque.
  const relire = /function relireCarnet\(\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(relire, /\['contacts', 'noire'\]\.forEach/);
  assert.match(relire, /ouvrirDossier\(cle, e\.uid, e\.titre, true\)/);
});
