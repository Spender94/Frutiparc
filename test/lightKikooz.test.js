// Don de kikooz (/donne) depuis /light.
//
// La commande n'existe pas côté serveur : sur le bureau, c'est main.swf qui
// l'intercepte, appelle /do/give, puis annonce le cadeau au salon par une trame
// t="g". Le client mobile refait ce chemin à l'identique — donc ce qu'il faut
// vérifier, c'est le contrat que les DEUX clients partagent :
//
//   1. /do/give déplace vraiment les kikooz, et refuse proprement les cas
//      tordus (soi-même, inconnu, solde insuffisant) avec le code que le client
//      sait traduire ;
//   2. la trame t="g" est bien relayée au salon avec le montant et le
//      destinataire intacts, sans quoi personne ne verrait rien arriver ;
//   3. le serveur pousse le nouveau solde (<av command_name="ku">) aux deux
//      parties, qui n'ont donc pas à le redemander.
//
// Un don qui débite sans créditer — ou l'inverse — serait la pire des pannes :
// on teste les deux comptes après chaque opération.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3442;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// data/scores.json survit d'une exécution à l'autre : sans suffixe, les comptes
// de la veille rejoueraient avec un solde déjà entamé.
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5160', FRUTISCORE_PORT: '5161',
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

const attr = (xml, n) => {
  const m = new RegExp(`\\b${n}="([^"]*)"`).exec(xml);
  return m ? m[1] : '';
};
const corps = (xml) => {
  const m = /^<[^>]*>([\s\S]*)<\/[^>]*>$/.exec(xml);
  return m ? m[1] : '';
};

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

// Un client mobile : même poignée de main que public/light.html (lc="1"). Il faut
// être identifié sur la socket ET dans le salon pour que le relais du cadeau
// s'applique — c'est le serveur qui l'exige, comme pour n'importe quel message.
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
    pseudo, sid, ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 4000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 700)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

// Le solde tel que le mobile le lit sur son accueil.
const solde = async (sid) => Number((await (await fetch(`${BASE}/api/light/profile?sid=${sid}`)).json()).kikooz);
// L'appel exact que fait public/light.html quand on valide la confirmation.
const donner = (sid, k, u, r = '') => fetch(
  `${BASE}/do/give?sid=${encodeURIComponent(sid)}&k=${encodeURIComponent(k)}`
  + `&u=${encodeURIComponent(u)}&r=${encodeURIComponent(r)}`).then((x) => x.text());

test('un don déplace les kikooz d\'un compte à l\'autre', async () => {
  const donneur = 'kkdon' + RUN;
  const recu = 'kkrec' + RUN;
  const sa = await inscrire(donneur);
  const sb = await inscrire(recu);

  const avantA = await solde(sa);
  const avantB = await solde(sb);
  assert.ok(avantA >= 25, `le donneur a de quoi donner (${avantA})`);

  const rep = await donner(sa, 25, recu, 'parce que');
  assert.equal(attr(rep, 'k'), '0', 'don accepté');
  assert.equal(Number(attr(rep, 'g')), 25, 'la réponse rappelle le montant offert');
  assert.equal(attr(rep, 'u'), recu, 'et le destinataire, tel que le serveur l\'orthographie');
  assert.equal(Number(attr(rep, 'a')), avantA - 25, 'le nouveau solde annoncé est le solde débité');

  assert.equal(await solde(sa), avantA - 25, 'le donneur est débité');
  assert.equal(await solde(sb), avantB + 25, 'le destinataire est crédité — rien ne s\'est évaporé');
});

test('le don apparaît dans l\'historique kikooz du destinataire', async () => {
  const donneur = 'kkhdon' + RUN;
  const recu = 'kkhrec' + RUN;
  const sa = await inscrire(donneur);
  const sb = await inscrire(recu);

  assert.equal(attr(await donner(sa, 7, recu), 'k'), '0', 'don accepté');

  // /ft/log est la fenêtre « historique des kikooz » du bureau : le don doit
  // y figurer, sans quoi le destinataire verrait son solde bouger sans savoir
  // d'où ça vient.
  const journal = await (await fetch(`${BASE}/ft/log?sid=${sb}`)).text();
  const ligne = (journal.match(/<c\b[^>]*\/>/g) || []).find((l) => Number(attr(l, 'k')) === 7);
  assert.ok(ligne, `le don figure au journal (${journal.slice(0, 200)})`);
  assert.equal(attr(ligne, 'c').toLowerCase(), donneur, 'et il nomme le donneur');
});

test('les dons impossibles sont refusés avec le bon code', async () => {
  const donneur = 'kkref' + RUN;
  const sa = await inscrire(donneur);
  const autre = 'kkref2' + RUN;
  await inscrire(autre);
  const depart = await solde(sa);

  // Chaque code a un libellé dédié dans public/light.html : s'ils divergent, le
  // joueur reçoit une explication qui ne correspond pas à son erreur.
  assert.equal(attr(await donner(sa, 'abc', autre), 'k'), '1', 'montant illisible → 1');
  assert.equal(attr(await donner(sa, 5, ''), 'k'), '1', 'destinataire vide → 1');
  assert.equal(attr(await donner(sa, 0, autre), 'k'), '1', 'montant nul → 1');
  assert.equal(attr(await donner(sa, 5, donneur), 'k'), '2', 'à soi-même → 2');
  assert.equal(attr(await donner(sa, 5, 'personnequinexistepas'), 'k'), '3', 'inconnu → 3');
  assert.equal(attr(await donner(sa, depart + 1000, autre), 'k'), '4', 'solde insuffisant → 4');

  assert.equal(await solde(sa), depart, 'aucun refus n\'a entamé le solde');
});

test('un don sans session est rejeté', async () => {
  const rep = await donner('sid-bidon', 5, 'personne');
  assert.ok(!/k="0"/.test(rep), `pas de don sans session valable (${rep})`);
});

test('l\'annonce du cadeau parvient au destinataire dans le salon', async () => {
  const a = await client('kkwsa' + RUN);
  const b = await client('kkwsb' + RUN);
  const temoin = await client('kkwst' + RUN);
  try {
    for (const c of [a, b, temoin]) c.envoyer('<o g="pomme" />');
    await wait(400);

    const rep = await donner(a.sid, 12, b.pseudo);
    assert.equal(attr(rep, 'k'), '0', 'don accepté');

    // Puis le client annonce le cadeau au salon — la trame que main.swf émet.
    a.envoyer(`<t g="pomme" t="g" p=""><g k="12" u="${b.pseudo}" /></t>`);

    // Le serveur la relaie au salon en la marquant du pseudo du donneur.
    const vue = await b.attendre((t) => t.startsWith('<t ') && attr(t, 't') === 'g',
      'annonce du cadeau');
    assert.equal(attr(vue, 'u').toLowerCase(), a.pseudo, 'le donneur est nommé');
    const enfant = corps(vue);
    assert.equal(Number(attr(enfant, 'k')), 12, 'le montant traverse intact');
    assert.equal(attr(enfant, 'u').toLowerCase(), b.pseudo, 'le destinataire aussi');

    // Le témoin la reçoit également (le protocole diffuse à tout le salon) —
    // c'est le CLIENT qui la tait pour les autres, en comparant `u` à son pseudo.
    // Ce test fige ce partage des rôles : si le serveur se mettait à filtrer,
    // le bureau cesserait d'afficher les cadeaux exactement comme aujourd'hui.
    const vueTemoin = await temoin.attendre((t) => t.startsWith('<t ') && attr(t, 't') === 'g',
      'le témoin reçoit aussi la trame');
    assert.notEqual(attr(corps(vueTemoin), 'u').toLowerCase(), temoin.pseudo,
      'elle ne lui est pas destinée : son client ne l\'affichera pas');

    // Rien ne doit ressembler à une commande inconnue : le mobile intercepte
    // /donne avant l'envoi, donc le serveur ne doit jamais le voir passer.
    assert.ok(!a.trames.some((t) => /Commande inconnue/.test(t)),
      'aucune trame « Commande inconnue »');
  } finally {
    a.fermer(); b.fermer(); temoin.fermer();
  }
});

test('le nouveau solde est poussé aux deux parties', async () => {
  const a = await client('kkava' + RUN);
  const b = await client('kkavb' + RUN);
  try {
    for (const c of [a, b]) c.envoyer('<o g="pomme" />');
    await wait(400);
    const avantA = await solde(a.sid);
    const avantB = await solde(b.sid);
    a.trames.length = 0;
    b.trames.length = 0;

    assert.equal(attr(await donner(a.sid, 9, b.pseudo), 'k'), '0', 'don accepté');

    // <av command_name="ku">N</av> : la trame que main.swf range dans
    // _global.me.kikooz, et que /light lit désormais aussi.
    const pousseA = await a.attendre((t) => t.startsWith('<av ') && attr(t, 'command_name') === 'ku',
      'solde poussé au donneur');
    const pousseB = await b.attendre((t) => t.startsWith('<av ') && attr(t, 'command_name') === 'ku',
      'solde poussé au destinataire');
    assert.equal(Number(corps(pousseA)), avantA - 9, 'le donneur voit son solde débité sans rien demander');
    assert.equal(Number(corps(pousseB)), avantB + 9, 'le destinataire voit le sien crédité');
  } finally {
    a.fermer(); b.fermer();
  }
});
