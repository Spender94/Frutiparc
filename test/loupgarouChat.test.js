// Le loup-garou du salon, joué pour de vrai : un animateur et cinq joueurs
// connectés au salon des animateurs (pomme), une partie de bout en bout.
//
// On vérifie ce que chacun REÇOIT : son rôle en secret (et lui seul), le
// silence de la nuit (la ligne d'un villageois ne part pas), le murmure de la
// meute (lu des seuls loups et du meneur), le panneau du mobile (t="lg"), les
// annonces de l'aube et du vote, la victoire et le prix pris dans l'enveloppe.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3611;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-loupgarou';
const DB = process.env.TEST_DATABASE_URL_LG || 'postgres://postgres@127.0.0.1:5433/frutiparc_loupgarou';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null, dispo = false;
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5480', FRUTISCORE_PORT: '5481',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`)).length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  const fini = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await fini;
  proc = null;
  await wait(300);
}
before(async () => {
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}
async function client(pseudo) {
  const sid = await inscrire(pseudo);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  const c = {
    pseudo, sid, trames,
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t>\0`),
    // Attend une trame qui n'est pas encore passée (depuis la marque).
    marque: 0,
    poser() { this.marque = trames.length; },
    async attendre(pred, quoi, ms = 5000) {
      for (let i = 0; i < ms / 40; i++) {
        const t = trames.slice(this.marque).find(pred);
        if (t) return t;
        await wait(40);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Dernières trames : ${trames.slice(-8).join(' ').slice(0, 1500)}`);
    },
    depuis() { return trames.slice(this.marque); },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'identification');
  ws.send('<o g="pomme" />\0');
  await c.attendre((t) => /^<o g="pomme"/.test(t), 'entrée au salon');
  return c;
}
const secret = (t) => /st="lg"/.test(t);
const vueLg = (t) => { const m = / t="lg"[^>]*><!\[CDATA\[([\s\S]*)\]\]>/.exec(t); return m ? JSON.parse(m[1]) : null; };

test('une partie de loup-garou au salon des animateurs, de l’ouverture à la victoire', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const anim = await client('meneurlg');
  const pose = await fetch(`${BASE}/api/admin/users/meneurlg`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE }, body: JSON.stringify({ is_animator: true }) });
  assert.equal(pose.status, 200);
  const noms = ['lgalice', 'lgbruno', 'lgcamille', 'lgdenis', 'lgeva'];
  const J = [];
  for (const n of noms) J.push(await client(n));
  const tous = [anim, ...J];
  try {
    // Un joueur ordinaire n'ouvre pas de partie.
    J[0].poser();
    J[0].dire('/lg ouvrir');
    await J[0].attendre((x) => secret(x) && /Seuls les animateurs/.test(x), 'refus d’ouverture');

    // L'animateur ouvre, avec un prix.
    for (const c of tous) c.poser();
    anim.dire('/lg ouvrir prix=10');
    await J[3].attendre((x) => /t="c"/.test(x) && /LOUP-GAROU commence/.test(x) && /10 kikooz/.test(x), 'annonce publique');
    await anim.attendre((x) => secret(x) && /Meneur : \/lg ouvrir/.test(x), 'l’aide du meneur, en secret');
    const v0 = vueLg(await J[4].attendre((x) => / t="lg"/.test(x), 'panneau mobile'));
    assert.deepEqual([v0.phase, v0.inscrit, v0.estMeneur], ['inscriptions', false, false]);

    // Les inscriptions, dans l'ordre (les numéros suivent).
    for (let i = 0; i < J.length; i++) {
      anim.poser();
      J[i].dire('/lg jouer');
      await anim.attendre((x) => new RegExp(`${noms[i]} rejoint la partie \\(${i + 1} joueur`).test(x), 'inscription ' + noms[i]);
    }

    // Le lancement : chacun son rôle, en secret.
    for (const c of tous) c.poser();
    anim.dire('/lg lancer nuit=30 debat=0 vote=30 soir=3');
    await J[0].attendre((x) => /Dans ce village de 5 : 1 Loup-garou, 1 Voyante, 3 Simples villageois/.test(x), 'composition');
    const roles = {};
    for (let i = 0; i < J.length; i++) {
      const s = await J[i].attendre((x) => secret(x) && /Tu es <b>/.test(x), 'rôle de ' + noms[i]);
      roles[noms[i]] = /Tu es <b>([^<]+)<\/b>/.exec(s)[1];
      // Personne ne reçoit le rôle d'un autre.
      assert.equal(J[i].depuis().filter((x) => secret(x) && /Tu es <b>/.test(x)).length, 1);
    }
    await anim.attendre((x) => secret(x) && /Les rôles :/.test(x), 'les rôles, au meneur');
    const iLoup = noms.findIndex((n) => roles[n] === 'Loup-garou');
    const iVoy = noms.findIndex((n) => roles[n] === 'Voyante');
    const villageois = noms.map((n, i) => i).filter((i) => i !== iLoup && i !== iVoy);
    assert.ok(iLoup >= 0 && iVoy >= 0 && villageois.length === 3, JSON.stringify(roles));
    await J[iLoup].attendre((x) => /NUIT 1/.test(x), 'la nuit tombe');

    // La nuit : un villageois parle, personne ne l'entend.
    const [v1, v2, v3] = villageois;
    for (const c of tous) c.poser();
    J[v1].dire('Il fait noir ici');
    await J[v1].attendre((x) => secret(x) && /Chut ! C’est la nuit/.test(x), 'le rappel au silence');
    // Le loup murmure : la meute (lui seul ici) et le meneur l'entendent.
    J[iLoup].dire('Miam, qui je mange');
    await anim.attendre((x) => secret(x) && /Meute — lgalice|Meute — lgbruno|Meute — lgcamille|Meute — lgdenis|Meute — lgeva/.test(x) && /Miam/.test(x), 'le meneur lit la meute');
    await J[iLoup].attendre((x) => secret(x) && /Miam/.test(x), 'le loup se relit');
    await wait(300);
    for (const i of [iVoy, v1, v2, v3]) {
      assert.ok(!J[i].depuis().some((x) => /Il fait noir|Miam/.test(x)), `${noms[i]} n’entend rien la nuit`);
    }
    // Le panneau du loup lui propose de dévorer ; celui d'un villageois ne montre aucun rôle.
    const vl = vueLg(J[iLoup].trames.filter((x) => / t="lg"/.test(x)).pop());
    assert.equal(vl.action.verbe, 'devorer');
    const vv = vueLg(J[v1].trames.filter((x) => / t="lg"/.test(x)).pop());
    assert.ok(vv.joueurs.every((x) => !x.role || x.moi), 'pas de fuite de rôle');
    assert.equal(vv.action, null);

    // Le loup dévore un villageois, la voyante sonde le loup : l'aube.
    for (const c of tous) c.poser();
    J[iLoup].dire(`/lg devorer ${v1 + 1}`);
    J[iVoy].dire(`/lg voir ${iLoup + 1}`);
    await J[iVoy].attendre((x) => secret(x) && new RegExp(`${noms[iLoup]} \\(n°${iLoup + 1}\\) est <b>Loup-garou</b>`).test(x), 'la vision');
    await J[v2].attendre((x) => new RegExp(`${noms[v1]} \\(n°${v1 + 1}\\) ne se réveillera pas`).test(x), 'l’annonce de l’aube');
    await J[v2].attendre((x) => /JOUR 1/.test(x), 'le jour');
    // Le jour : les vivants parlent, le mort se tait.
    for (const c of tous) c.poser();
    J[v2].dire('C est le loup !');
    await J[v3].attendre((x) => /C est le loup/.test(x) && !secret(x), 'la parole revient le jour');
    J[v1].dire('Je suis mort mais je sais tout');
    await J[v1].attendre((x) => secret(x) && /Les morts ne parlent pas/.test(x), 'le mort se tait');

    // Le meneur ouvre le vote ; tout le monde vote contre le loup.
    for (const c of tous) c.poser();
    anim.dire('/lg vote');
    await J[v2].attendre((x) => /AUX URNES/.test(x), 'le vote s’ouvre');
    for (const i of [iVoy, v2, v3]) J[i].dire(`/lg voter ${iLoup + 1}`);
    J[iLoup].dire(`/lg voter ${iVoy + 1}`);
    await J[v3].attendre((x) => new RegExp(`${noms[iLoup]} \\(n°${iLoup + 1}\\) est chassé du village\\. Rôle : <b>Loup-garou</b>`).test(x), 'le loup est chassé');
    await J[v3].attendre((x) => /victoire du village/.test(x), 'la victoire');
    await J[v3].attendre((x) => /10 kikooz pour chaque gagnant/.test(x), 'le prix');
    const fin = vueLg(J[v3].trames.filter((x) => / t="lg"/.test(x)).pop());
    assert.equal(fin.phase, 'fin');
    assert.equal(fin.joueurs.filter((x) => x.role).length, 5, 'à la fin, tous les rôles sont révélés');
    // Le prix est sorti de l'enveloppe de l'animateur (4 gagnants × 10).
    const rq = await (await fetch(`${BASE}/do/give?sid=${anim.sid}`)).text();
    assert.match(rq, /a="1960"/, rq);
    // La partie finie, tout le monde reparle.
    for (const c of tous) c.poser();
    J[v1].dire('Bien joué tout le monde');
    await J[v2].attendre((x) => /Bien joué tout le monde/.test(x), 'le mort reparle à la fin');
  } finally { for (const c of tous) c.fermer(); }
});

test('une partie en cours survit à un redémarrage : elle reprend en pause', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  let anim = await client('meneurlg');
  const noms = ['lgalice', 'lgbruno', 'lgcamille', 'lgdenis'];
  let J = [];
  for (const n of noms) J.push(await client(n));
  anim.poser();
  anim.dire('/lg ouvrir');
  await anim.attendre((x) => /LOUP-GAROU commence/.test(x), 'ouverture');
  for (const c of J) { anim.poser(); c.dire('/lg jouer'); await anim.attendre((x) => new RegExp(`${c.pseudo} rejoint`).test(x), 'inscription'); }
  anim.poser();
  anim.dire('/lg lancer');
  await anim.attendre((x) => /NUIT 1/.test(x), 'la nuit');
  await wait(800);                       // la sauvegarde part en différé
  for (const c of [anim, ...J]) c.fermer();
  await arreter();
  await demarrer();
  anim = await client('meneurlg');
  J = [];
  for (const n of noms) J.push(await client(n));
  try {
    const v = vueLg(await J[0].attendre((x) => / t="lg"/.test(x), 'le panneau revient à l’entrée au salon'));
    assert.deepEqual([v.phase, v.pause, v.nuit, v.inscrit], ['nuit', true, 1, true]);
    assert.ok(v.moi && v.moi.role, 'son rôle est toujours là');
    anim.poser();
    anim.dire('/lg reprise');
    await J[1].attendre((x) => /La partie reprend/.test(x), 'la reprise');
    anim.poser();
    anim.dire('/lg fin');
    await J[2].attendre((x) => /Le meneur arrête la partie/.test(x), 'l’arrêt');
  } finally { for (const c of [anim, ...J]) c.fermer(); }
});
