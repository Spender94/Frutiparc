/*
 * LE MONDE FICTIF des moments du site — tout ce qui peuple le serveur local
 * avant qu'on filme, et RIEN de réel : on n'a pas la base de production et on
 * n'en veut pas.
 *
 *   · les comptes du casting (kit-bande-annonce/casting.json, relu) et du
 *     spectateur, avec leur bouille, de l'XP et des kikooz — de quoi remplir
 *     les classements « joueur » (XP, kikooz) sans inventer de score de jeu ;
 *   · le Bouilloscope (le trombinoscope, d'ordinaire importé par l'admin) :
 *     le casting plus une quarantaine de pseudos fruités INVENTÉS ici, aux
 *     bouilles tirées au sort (graine fixe : on retire les mêmes) ;
 *   · une poignée de sujets de forum écrits par le casting ;
 *   · des pictos pour le spectateur (accordés par la route d'admin).
 *
 * Idempotent : relancé, il ne double ni les comptes ni les sujets.
 */
'use strict';

const C = require('./commun.js');

// Des pseudos fruités, inventés pour le kit (aucun n'est un joueur du parc).
const FIGURANTS = ['abricotine', 'airelle', 'amandine', 'ananaso', 'avocado', 'bergamote', 'bigarreau',
  'brugnon', 'cassissou', 'cerisette', 'chataigne', 'clementix', 'coingcoing', 'cranberry', 'dattier',
  'figounette', 'framboizz', 'goyave', 'griotte', 'groseillo', 'kakiboum', 'kumquat', 'mandarinou',
  'mangue2006', 'melonade', 'mirabelle', 'mureMure', 'nectarine', 'noisetto', 'olivette', 'papayou',
  'pasteque', 'pechou', 'physalis', 'pistache', 'poirotin', 'pommeDapi', 'quetsche', 'reineclaude',
  'rhubarbe', 'tamarin', 'yuzou'];

// Les coiffures 1 à 3 de la famille 0 sont le sac à patate (cf. light.html,
// FB_SAC) : on ne les tire pas.
function bouilleAuHasard(alea) {
  const e62 = (n) => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[n];
  const deux = (n) => e62(Math.floor(n / 62)) + e62(n % 62);
  let ch; do { ch = Math.floor(alea() * 67); } while (ch >= 1 && ch <= 3);
  const acc = alea() < 0.55 ? 0 : 1 + Math.floor(alea() * 15);
  return '00' + deux(Math.floor(alea() * 9)) + deux(Math.floor(alea() * 18)) + deux(ch)
    + deux(Math.floor(alea() * 5)) + deux(Math.floor(alea() * 11)) + deux(Math.floor(alea() * 53))
    + deux(acc) + deux(0) + deux(Math.floor(alea() * 53)) + deux(Math.floor(alea() * 53)) + deux(Math.floor(alea() * 53));
}

function graine(n) {
  return function () { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x80000000; };
}

// XP et kikooz du casting : des valeurs rondes et variées, pour un classement lisible.
const STATS = {
  pomelo: { xp: 5200, kikooz: 1350 }, kiwinette: { xp: 18400, kikooz: 4210 }, prunox: { xp: 26800, kikooz: 9870 },
  myrtillou: { xp: 12100, kikooz: 2640 }, citronade: { xp: 900, kikooz: 310 }, fraizou: { xp: 15300, kikooz: 5120 },
  banagaga: { xp: 9800, kikooz: 1980 }, litchiloo: { xp: 21900, kikooz: 7450 }, grenadix: { xp: 31200, kikooz: 12800 },
};

const SUJETS = [
  { board: 6, auteur: 'fraizou', titre: 'Swapou : vos plus gros combos ?',
    texte: 'Hier soir j’ai enchaîné un combo x7 sur la plaine, je tremblais ! Et vous, c’est quoi votre record ? :)',
    reponses: [['prunox', 'x9 sur le marais. Je dis ça, je dis rien. B-)'],
      ['citronade', 'Je viens d’arriver, je ne sais même pas ce que c’est un combo… quelqu’un m’explique ?'],
      ['fraizou', '@citronade tu alignes trois fruits pareils, et si la chute en aligne d’autres, ça enchaîne ! Viens on fait une partie.']] },
  { board: 7, auteur: 'grenadix', titre: 'Qui se souvient du parc en 2005 ?',
    texte: 'Les soirées dans le salon Pomme, les bouilles à sac à patate, le premier Frusion… Ça me fait tout drôle de revoir tout ça !',
    reponses: [['kiwinette', 'Coucou Grenadix !! Moi j’avais une bouille avec des couettes roses, je l’ai refaite à l’identique ^^'],
      ['banagaga', 'Ouais bon, à l’époque le chat plantait tous les soirs. Mais c’était bien quand même. Un peu.'],
      ['myrtillou', 'Le chat plantait parce que Banagaga râlait trop fort :D']] },
  { board: 5, auteur: 'litchiloo', titre: 'Quiz du jeudi soir — salon Cerise, 21 h',
    texte: 'Ce jeudi, grand quiz « jeux du parc » : 20 questions, des kikooz à gagner et un picto pour le podium. Venez nombreux !',
    reponses: [['kiwinette', 'J’y serai !!! Je révise mes Kaluga.'], ['prunox', 'Préparez-vous à perdre.']] },
];

async function peupler(opts) {
  opts = opts || {};
  const cast = C.casting();
  const tous = [Object.assign({}, cast.spectateur)].concat(cast.liste);
  const sids = {};
  for (const p of tous) {
    const st = STATS[p.pseudo] || { xp: 4000, kikooz: 800 };
    sids[p.pseudo] = await C.compte(p.pseudo, { fbouille: p.bouille, xp: st.xp, kikooz: st.kikooz,
      display_name: p.affiche || p.pseudo, daily_streak: p.pseudo === cast.spectateur.pseudo ? 6 : 12 });
  }
  // Une animatrice, comme le dit le casting (le quiz de Litchiloo).
  await C.admin('/api/admin/users/litchiloo', { is_animator: true }, 'PATCH');

  // Le Bouilloscope : on repart d'un jeu propre, fait du seul monde fictif.
  await C.admin('/api/admin/trombinoscope/clear', {});
  const alea = graine(20061104);
  const lignes = ['pseudo,bouille'].concat(tous.map((p) => (p.affiche || p.pseudo) + ',' + p.bouille),
    FIGURANTS.map((f) => f + ',' + bouilleAuHasard(alea)));
  await fetch(C.BASE + '/api/admin/trombinoscope/import', { method: 'POST',
    headers: { 'content-type': 'text/csv', 'x-admin-key': C.ADMIN_KEY }, body: lignes.join('\n') });

  // Le forum : des sujets du casting, une seule fois.
  if (opts.forum !== false) {
    const index = await C.api('/api/forum/index');
    const titres = JSON.stringify(index);
    for (const s of SUJETS) {
      if (titres.includes(s.titre.slice(0, 20)) || (await sujetExiste(s))) continue;
      const r = await C.api('/api/forum/topic?sid=' + sids[s.auteur], { sid: sids[s.auteur], boardId: s.board, title: s.titre, content: s.texte });
      const id = r.topicId || r.id || (r.topic && r.topic.id);
      for (const [qui, txt] of s.reponses) {
        await C.api('/api/forum/post?sid=' + sids[qui], { sid: sids[qui], topicId: id, content: txt });
      }
    }
  }

  // Les pictos du spectateur : une collection montrable, de plusieurs jeux.
  if (opts.pictos !== false) {
    const PICTOS = ['$butterfly0', '$butterfly1', '$butterfly2', '$butterfly3', '$smiley0', '$smiley1', '$smiley2',
      '$smiley3', '$tz1', '$tz2', '$tz3', '$tz4', '$basket', '$bird', '$ring', '$ant', '$kagulga',
      '$sel', '$poivre', '$epee', '$piment', '$dent', '$sucre', '$metal01', '$metal02', '$ice01', '$ice02'];
    for (const p of PICTOS) await C.admin('/api/admin/users/' + cast.spectateur.pseudo + '/gameitems', { itemName: p });
  }
  return { sids, tous };
}

async function sujetExiste(s) {
  const b = await C.api('/api/forum/board/' + s.board);
  return JSON.stringify(b).includes(s.titre.slice(0, 20));
}

module.exports = { peupler, bouilleAuHasard, graine, FIGURANTS, STATS };

if (require.main === module) {
  C.demarrerServeur().then(async (srv) => {
    const r = await peupler();
    console.log('monde peuplé :', Object.keys(r.sids).join(', '));
    srv.arreter();
  }).catch((e) => { console.error(e); process.exit(1); });
}
