'use strict';
/*
 * LES PARIS DES TOURNOIS — la règle du pari mutuel, et rien d'autre.
 *
 * Pas de base, pas de réseau, pas d'horloge : on donne les paris d'un match
 * et son vainqueur, le module dit ce que chacun touche. Le stockage, les
 * kikooz et les routes vivent dans server.js.
 *
 * LE PARI MUTUEL. Toutes les mises d'un match vont dans un même pot ; ceux qui
 * ont vu juste se partagent le pot entier, chacun au prorata de sa mise. Le
 * parc ne prend rien et ne donne rien : pas de kikooz créé, pas de kikooz
 * détruit.
 *
 *   · Un pari perdu est TOUJOURS perdu. Personne n'a vu juste : tout le monde
 *     perd, et le pot part dans la CAGNOTTE des Prunostics (`cagnotte: true`
 *     sur chaque décision), que le Prunostiqueur de la semaine remporte le
 *     lundi. Avant, chacun était remboursé : parier seul, ou à contre-pied de
 *     tout le monde, ne coûtait alors rien.
 *   · Tout le monde a vu juste : chacun récupère sa mise, et rien de plus.
 *
 * Les arrondis. Les kikooz sont entiers : on donne à chacun la partie entière
 * de sa part, puis les quelques kikooz qui restent, un par un, aux plus gros
 * restes (à égalité, au plus gros parieur, puis au premier arrivé). Le pot est
 * ainsi distribué jusqu'au dernier kikooz.
 */

/**
 * @param {Array<{id, username, choix, mise}>} paris — les paris OUVERTS du match
 * @param {string} gagnant — le pseudo du vainqueur
 * @returns {Array<{id, username, statut:'gagne'|'perdu', gain:number, cagnotte?:true}>}
 *   `gain` est ce que le parieur REÇOIT (sa mise comprise) : 0 s'il a perdu.
 *   `cagnotte` marque les mises d'un pot sans gagnant, qui vont à la cagnotte.
 */
function regler(paris, gagnant) {
  return reglerEnsemble(paris, [gagnant]);
}

/**
 * Le même règlement quand PLUSIEURS joueurs font gagner un pari — les trois
 * médaillés d'un Challenge : quiconque a misé sur l'un d'eux a vu juste, et
 * ceux-là se partagent le pot au prorata de leurs mises.
 * @param {Array<{id, username, choix, mise}>} paris
 * @param {string[]} gagnants
 */
function reglerEnsemble(paris, gagnants) {
  const g = new Set((gagnants || []).filter(Boolean).map(cle));
  const liste = (paris || []).filter((p) => Number(p.mise) > 0);
  const pot = liste.reduce((s, p) => s + Number(p.mise), 0);
  const bons = liste.filter((p) => g.has(cle(p.choix)));
  const misesBonnes = bons.reduce((s, p) => s + Number(p.mise), 0);
  if (!bons.length) {
    return liste.map((p) => ({ id: p.id, username: p.username, statut: 'perdu', gain: 0, cagnotte: true }));
  }
  const parts = bons.map((p, rang) => {
    const exacte = (Number(p.mise) * pot) / misesBonnes;
    return { p, rang, entier: Math.floor(exacte), reste: exacte - Math.floor(exacte) };
  });
  let restant = pot - parts.reduce((s, x) => s + x.entier, 0);
  const ordre = parts.slice().sort((a, b) =>
    (b.reste - a.reste) || (Number(b.p.mise) - Number(a.p.mise)) || (a.rang - b.rang));
  for (const x of ordre) {
    if (restant <= 0) break;
    x.entier++;
    restant--;
  }
  const gains = new Map(parts.map((x) => [x.p, x.entier]));
  return liste.map((p) => (gains.has(p)
    ? { id: p.id, username: p.username, statut: 'gagne', gain: gains.get(p) }
    : { id: p.id, username: p.username, statut: 'perdu', gain: 0 }));
}

/**
 * Le pot d'un match, côté par côté, et la cote qu'il donne EN CE MOMENT : ce
 * que rapporte un kikooz misé sur ce joueur si le pot en restait là.
 * @returns {{ total, joueurs: { [pseudo]: { mises, parieurs, cote } } }}
 */
function pot(paris, joueur1, joueur2) {
  const j = {};
  for (const n of [joueur1, joueur2]) if (n) j[cle(n)] = { mises: 0, parieurs: 0, cote: null };
  let total = 0;
  for (const p of paris || []) {
    const c = j[cle(p.choix)];
    if (!c) continue;
    c.mises += Number(p.mise) || 0;
    c.parieurs++;
    total += Number(p.mise) || 0;
  }
  for (const k of Object.keys(j)) {
    j[k].cote = j[k].mises > 0 ? Math.round((total / j[k].mises) * 100) / 100 : null;
  }
  return { total, joueurs: j };
}

/**
 * Peut-on miser `mise` sur `choix` dans ce match ? Rend null si oui, sinon le
 * motif (un code et une phrase pour le joueur).
 *   ctx : { tournoi, match, parieur, misePrecedente, choixPrecedent, solde }
 */
function refus(ctx) {
  const t = ctx.tournoi, m = ctx.match;
  const non = (code, message) => ({ code, message });
  if (!t || !t.paris_actifs) return non('fermes', 'Les paris ne sont pas ouverts sur ce tournoi.');
  if (!['bracket', 'poules'].includes(t.status)) return non('fermes', 'Les paris ne sont pas ouverts en ce moment.');
  if (!m || m.tournament_id !== t.id) return non('match', 'Ce match n’existe pas.');
  if (!m.player1 || !m.player2) return non('match', 'Les deux joueurs de ce match ne sont pas encore connus.');
  if (m.winner || m.status === 'done') return non('joue', 'Ce match est déjà joué.');
  if (m.paris_fermes) return non('joue', 'Les paris sur ce match sont fermés : il a commencé.');
  if ((Number(m.score1) || 0) + (Number(m.score2) || 0) > 0 && t.format === 'duel') {
    return non('joue', 'Les paris sur ce match sont fermés : il a commencé.');
  }
  const moi = cle(ctx.parieur);
  if (moi === cle(m.player1) || moi === cle(m.player2)) {
    return non('soi', 'On ne parie pas sur ses propres matchs.');
  }
  if (cle(ctx.choix) !== cle(m.player1) && cle(ctx.choix) !== cle(m.player2)) {
    return non('choix', 'Ce joueur ne dispute pas ce match.');
  }
  if (ctx.choixPrecedent && cle(ctx.choixPrecedent) !== cle(ctx.choix)) {
    return non('camp', 'Tu as déjà parié sur l’autre joueur de ce match.');
  }
  const mise = Number(ctx.mise);
  if (!Number.isInteger(mise) || mise < 1) return non('mise', 'La mise est un nombre entier de kikooz.');
  const plafond = Math.max(1, Number(t.paris_plafond) || 100);
  const deja = Number(ctx.misePrecedente) || 0;
  if (deja + mise > plafond) {
    return non('plafond', deja
      ? `Le plafond est de ${plafond} kikooz par match : tu peux encore ajouter ${Math.max(0, plafond - deja)}.`
      : `Le plafond est de ${plafond} kikooz par match.`);
  }
  if ((Number(ctx.solde) || 0) < mise) return non('solde', 'Tu n’as pas assez de kikooz.');
  return null;
}

/**
 * Le pot d'un pari à plusieurs candidats (le Challenge) : le total, et les
 * mises sur chacun. La cote n'y est exacte que pour un pari à un seul
 * gagnant (la médaille d'or) : pour le podium, elle dépend des deux autres
 * médaillés.
 */
function potLibre(paris, unSeulGagnant) {
  const joueurs = {};
  let total = 0;
  for (const p of paris || []) {
    const k = cle(p.choix);
    if (!joueurs[k]) joueurs[k] = { mises: 0, parieurs: 0, cote: null };
    joueurs[k].mises += Number(p.mise) || 0;
    joueurs[k].parieurs++;
    total += Number(p.mise) || 0;
  }
  if (unSeulGagnant) {
    for (const k of Object.keys(joueurs)) joueurs[k].cote = Math.round((total / joueurs[k].mises) * 100) / 100;
  }
  return { total, joueurs };
}

function cle(s) { return String(s == null ? '' : s).toLowerCase(); }

module.exports = { regler, reglerEnsemble, pot, potLibre, refus };
