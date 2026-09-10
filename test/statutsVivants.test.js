/*
 * LES VOYANTS DISENT LA MÊME CHOSE PARTOUT — ET TOUT DE SUITE. Plus le cœur
 * du carnet, qui ne doit pas s'offrir deux fois.
 *
 * LE PROBLÈME. La fiche d'un frutiz, la bande des contacts et la liste d'un
 * salon montrent le même clip d'époque (`userSlot`) et devraient donc dire la
 * même chose. Elles le tiraient de trois sources d'âges différents :
 *
 *   · le salon      des trames du fil — vivant, mais réservé aux salons
 *                   qu'on partage ;
 *   · le carnet     d'un `fetch` relu toutes les trente secondes ;
 *   · la fiche      d'un `fetch` unique, jamais relu.
 *
 * Une même personne pouvait donc être « en partie » dans le salon, « en
 * ligne » dans la bande et « hors ligne » sur sa fiche.
 *
 * LA MÉCANIQUE EXISTAIT DÉJÀ. La trame `trace` (`<z>`) abonne une socket au
 * statut de qui l'on veut — `subscribeTrace`, « independent of shared
 * channels » — et répond aussitôt avec l'état courant ; `notifyTraceSubscribers`
 * pousse ensuite chaque changement. Le portage ne l'avait jamais ENVOYÉE. Les
 * trois surfaces lisent maintenant une seule table (`statutDe`), que le fil
 * tient à jour, et le `fetch` ne fait plus qu'AMORCER.
 *
 * LE CŒUR, enfin : `box.Frutiz.getIconList` ne pose l'image 4
 * (`frutiz_add_to_contact`) que « si pas déjà au carnet ».
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LIGHT = lire('public/light.html');
const BUREAU = lire('public/bureau-frutiz.js');
const SERVEUR = lire('server.js');

const PORT = 3527;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = 'sv' + String(Date.now()).slice(-6);

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5372', FRUTISCORE_PORT: '5373', DATABASE_URL: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const JSON_H = { 'Content-Type': 'application/json' };
async function compte(nom) {
  const body = JSON.stringify({ username: nom, password: 'secret123', birthday: '1990-05-15' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSON_H, body });
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSON_H, body })).json();
  assert.ok(r.sid, 'connexion → sid');
  return r.sid;
}
const fiche = (sid, u) =>
  fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=${encodeURIComponent(u)}`)
    .then((r) => r.json());

// ── LE CŒUR ────────────────────────────────────────────────────────────────

test('le serveur dit si le frutiz est DÉJÀ au carnet', async () => {
  const moi = 'coeurA' + SUF, lui = 'coeurB' + SUF;
  const sid = await compte(moi);
  await compte(lui);

  let d = await fiche(sid, lui);
  assert.equal(d.ok, true);
  assert.equal(d.vous.contact, false, 'un inconnu n’est pas au carnet');

  // On l'ajoute par le chemin que le bouton emprunte (`/ff/mk`).
  await fetch(`${BASE}/ff/mk?sid=${encodeURIComponent(sid)}&folder=mycontact&t=contact&u=`
    + encodeURIComponent(lui));
  d = await fiche(sid, lui);
  assert.equal(d.vous.contact, true, 'et une fois ajouté, si');

  // La réponse regarde le carnet de CELUI QUI DEMANDE, pas celui d'en face :
  // l'autre ne m'a pas ajouté.
  const sidLui = await compte(lui);
  const inverse = await fiche(sidLui, moi);
  assert.equal(inverse.vous.contact, false, 'le carnet de chacun est le sien');
});

test('le cœur ne paraît que s’il peut servir', () => {
  // La règle d'époque est écrite dans le portage : image 4 « si pas déjà au
  // carnet ». Le bouton, lui, est monté par le bureau — d'où la garde.
  assert.match(BUREAU, /image {2}4 {2}frutiz_add_to_contact {7}si pas déjà au carnet/);
  assert.match(LIGHT, /var boutonContact = fq\("fiche-contact"\);\s*\n\s*if \(boutonContact\) \{\s*\n\s*boutonContact\.hidden = !d \|\| moi \|\| !!\(d\.vous && d\.vous\.contact\);/);
  // Tant que la réponse n'est pas là (`!d`), il ne s'affiche pas : mieux vaut
  // un cœur en retard qu'un cœur qui s'affiche puis se retire.
  // Et cliqué, il disparaît sans attendre la relecture du carnet.
  assert.match(BUREAU, /if \(ev && ev\.currentTarget\) ev\.currentTarget\.hidden = true;/);
  // Le CSS sait déjà cacher un bouton de la rangée.
  assert.match(LIGHT, /\.fiche-actions button\[hidden\] \{ display: none; \}/);
});

// ── LES VOYANTS ────────────────────────────────────────────────────────────

test('la fiche sert l’activité, et le carnet la même', async () => {
  const moi = 'voyA' + SUF, lui = 'voyB' + SUF;
  const sid = await compte(moi);
  const sidLui = await compte(lui);
  await fetch(`${BASE}/ff/mk?sid=${encodeURIComponent(sid)}&folder=mycontact&t=contact&u=`
    + encodeURIComponent(lui));

  // Personne n'est sur une socket de chat : hors ligne des deux côtés.
  const f = await fiche(sid, lui);
  assert.equal(f.enLigne, false);
  assert.equal(f.jeu, '');
  const c = await (await fetch(`${BASE}/api/light/contacts?sid=${encodeURIComponent(sid)}`)).json();
  const ligne = (c.contacts || []).find((x) => String(x.pseudo).toLowerCase() === lui.toLowerCase());
  assert.ok(ligne, 'le contact est au carnet');
  assert.equal(ligne.enLigne, false, 'et les deux disent la même chose');

  // Une partie déclarée sans socket n'allume rien : le voyant suit la présence.
  await fetch(BASE + '/api/light/jeu-en-cours', { method: 'POST', headers: JSON_H,
    body: JSON.stringify({ sid: sidLui, jeu: 'grapiz', on: 1 }) });
  const f2 = await fiche(sid, lui);
  assert.equal(f2.jeu, '', 'hors ligne, pas de voyant de jeu');
});

test('le light DEMANDE les statuts qu’il affiche — la trame `trace`', () => {
  /*
   * `subscribeTrace` (server.js) existe depuis toujours : « when socket A asks
   * for user B's trace, A is subscribed to real-time presence/status updates
   * for B — independent of shared channels ». Le light ne l'appelait jamais.
   */
  assert.match(SERVEUR, /const traceSubscriptions = new Map\(\);/);
  assert.match(SERVEUR, /function subscribeTrace\(socket, targetUsername\)/);
  // La trame `trace` porte le code `z`, et accepte une LISTE d'enfants : le
  // carnet entier tient en un envoi.
  assert.match(SERVEUR, /\n {2}trace: +'z',/);
  assert.match(SERVEUR, /const traceChildren = \(msg\.children \|\| \[\]\)\.filter\(child => child\.tag === 'u' && child\.attrs\.u\);/);
  assert.match(LIGHT, /var xml = "<z>";\s*\n\s*qui\.forEach\(function \(c\) \{ xml \+= '<u u="' \+ xmlEscape\(c\) \+ '" \/>'; \}\);\s*\n\s*wsSend\(xml \+ "<\/z>"\);/);
  // Une fiche ouverte suit son frutiz ; le carnet suit tout le monde.
  assert.match(LIGHT, /suivreStatuts\(\[p\]\);/);
  assert.match(BUREAU, /function suivreLeCarnet\(d\) \{[\s\S]*?StatutsLight\.suivre\(noms\);/);
  // Après une coupure, le serveur a oublié les abonnements : on les refait.
  assert.match(LIGHT, /resuivreStatuts\(\);/);
  assert.match(LIGHT, /function resuivreStatuts\(\) \{ suivreStatuts\(Object\.keys\(suivis\)\); \}/);
});

test('la PRÉSENCE arrive par le fil, elle aussi', () => {
  // Les trames portaient `p` (0 hors ligne, 1 en ligne, 2 invisible) et
  // personne ne le lisait : c'était la seule donnée que le carnet et la fiche
  // devaient encore aller redemander en HTTP.
  assert.match(SERVEUR, /const pVal = getSocketsForUsername\(u\)\.length > 0 \? 1 : 0;/);
  assert.match(LIGHT, /rememberPresence\(attr\(zf, "u"\), attr\(zf, "p"\)\);/);
  assert.match(LIGHT, /rememberPresence\(attr\(xml, "u"\), attr\(xml, "p"\)\);/);
  // Entrer dans un salon (ou y figurer) vaut présence — sortir ne prouve rien.
  assert.match(LIGHT, /rememberPresence\(uj, 1\);/);
  assert.match(LIGHT, /rememberPresence\(uname, 1\);/);
  const rp = /function rememberPresence\(pseudo, p\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(rp, /var la = Number\(p\) === 1;/, 'un invisible se montre hors ligne');
  assert.match(rp, /majStatutsPartout\(cle\);/);
});

test('UNE SEULE TABLE pour les trois surfaces', () => {
  // `statutDe` est la lecture unique — et hors ligne, ni voyant ni panneau.
  const sd = /function statutDe\(pseudo\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(sd, /jeu: la \? \(state\.jeuByUser\[cle\] \|\| ""\) : "",/);
  assert.match(sd, /absence: la \? \(state\.absenceByUser\[cle\] \|\| ""\) : "",/);
  // La fiche la lit (son point de présence se peint à part du reste).
  assert.match(LIGHT, /function peindreStatutFiche\(\) \{[\s\S]*?var s = statutDe\(ficheEtat\.pseudo\);/);
  // La bande des contacts et la fenêtre du carnet aussi.
  assert.match(BUREAU, /function activiteDe\(c\) \{[\s\S]*?StatutsLight\.de\(c\.pseudo\)/);
  assert.match(BUREAU, /function habillerLigneContact\(b, c\) \{\s*\n\s*var a = activiteDe\(c\);/);
  assert.match(BUREAU, /function habillerCaseContact\(c, f\) \{\s*\n\s*var a = activiteDe\(f\);/);
  // Et le light l'ouvre au bureau plutôt que de le laisser relire une page.
  assert.match(LIGHT, /window\.StatutsLight = \{\s*\n\s*de: statutDe,/);
});

test('un changement se voit PARTOUT, sans rien relire', () => {
  // Une seule fonction prévient les trois surfaces.
  const maj = /function majStatutsPartout\(cle\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(maj, /if \(drawerVue === "salon"\) renderUsers\(\);/);
  assert.match(maj, /if \(fichesOuvertes\[cle\]\) avecFiche\(fichesOuvertes\[cle\], peindreStatutFiche\);/);
  assert.match(maj, /BureauFrutiz\.majStatutContact\(cle\)/);
  // `rememberStatut` l'appelle pour le voyant de jeu ET pour l'absence — il ne
  // rafraîchissait que la liste du salon.
  const rs = /function rememberStatut\(pseudo, s\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(rs, /if \(avant !== jeu\) majStatutsPartout\(cle\);/);
  assert.match(rs, /if \(avantAbs !== abs\) majStatutsPartout\(cle\);/);
  assert.doesNotMatch(rs, /drawerVue === "salon"\) renderUsers/, 'plus de rafraîchissement partiel');
  // Le bureau retrouve les lignes par leur pseudo, et les rhabille sur place.
  assert.match(BUREAU, /b\.setAttribute\('data-frutiz', String\(c\.pseudo \|\| ''\)\.toLowerCase\(\)\);/);
  assert.match(BUREAU, /function majStatutContact\(cle\) \{[\s\S]*?data-frutiz/);
  assert.match(BUREAU, /majStatutContact: majStatutContact,/, 'et il l’ouvre au light');
});

test('le fetch AMORCE, le fil TRANCHE', () => {
  // Une page peut dater ; une trame, non. L'amorce ne s'impose donc pas à qui
  // le fil a déjà décrit.
  const am = /function amorcerStatut\(pseudo, enLigne, jeu, absence\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(am, /if \(!cle \|\| poussesRecues\[cle\]\) return;/);
  assert.match(LIGHT, /if \(d && d\.ok\) amorcerStatut\(p, d\.enLigne, d\.jeu, d\.absence\);/);
  assert.match(BUREAU, /StatutsLight\.amorcer\(c\.pseudo, c\.enLigne, c\.jeu, c\.absence\);/);
  // Et la ligne du carnet retombe sur la page tant que le fil n'a rien dit.
  assert.match(BUREAU, /if \(st && st\.connu\) return st;/);
});
