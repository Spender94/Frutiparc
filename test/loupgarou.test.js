// Le loup-garou du salon — le moteur seul (loupgarou.js), sans serveur.
//
// Les parties sont scénarisées : un tirage « 0,9999 » laisse les rôles dans
// l'ordre canonique (les loups d'abord, puis voyante, sorcière, chasseur,
// cupidon, salvateur, idiot, puis les villageois), si bien que le joueur n°1
// est toujours un loup.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LG = require(path.join(__dirname, '..', 'loupgarou.js'));

const FIXE = () => 0.9999;
let horloge = 1_000_000;
const MENEUR = { u: 'anim', nom: 'Anim', staff: true };

function partie(pseudos, lancer) {
  const p = LG.creer({ salon: 'pomme', meneur: 'anim', meneurNom: 'Anim', now: horloge });
  for (const x of pseudos) LG.commande(p, { u: x.toLowerCase(), nom: x }, 'jouer', { now: horloge, rnd: FIXE });
  const evts = lancer === false ? [] : LG.commande(p, MENEUR, 'lancer ' + (lancer || ''), { now: horloge, rnd: FIXE });
  return { p, evts };
}
const lg = (p, u, ligne) => LG.commande(p, { u, nom: u.charAt(0).toUpperCase() + u.slice(1) }, ligne, { now: horloge, rnd: FIXE });
const men = (p, ligne) => LG.commande(p, MENEUR, ligne, { now: horloge, rnd: FIXE });
const publics = (evts) => evts.filter((e) => e.a === 'public' || e.a === 'info').map((e) => e.t).join('\n');
const secretsDe = (evts, u) => evts.filter((e) => e.a === 'secret' && e.u === u).map((e) => e.t).join('\n');
const role = (p, u) => p.joueurs.find((j) => j.u === u).role;
const vivant = (p, u) => p.joueurs.find((j) => j.u === u).vivant;
function avancer(p, ms) { horloge += ms; return LG.echeance(p, horloge, FIXE); }

test('la composition suit le nombre de joueurs, et se règle au lancement', () => {
  assert.deepEqual(LG.compositionDefaut(5), { loups: 1, speciaux: ['voyante'] });
  assert.deepEqual(LG.compositionDefaut(8), { loups: 2, speciaux: ['voyante', 'sorciere', 'chasseur'] });
  assert.deepEqual(LG.compositionDefaut(12), { loups: 3, speciaux: ['voyante', 'sorciere', 'chasseur', 'cupidon', 'salvateur'] });
  const { p, evts } = partie(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
  assert.match(publics(evts), /Dans ce village de 12 : 3 Loups-garous, 1 Voyante, 1 Sorcière, 1 Chasseur, 1 Cupidon, 1 Salvateur, 4 Simples villageois/);
  assert.equal(p.phase, 'nuit');
  // Chacun a reçu son rôle, et lui seul ; la meute se connaît.
  for (const j of p.joueurs) assert.match(secretsDe(evts, j.u), new RegExp(`Tu es \\*\\*${LG.ROLES[j.role].nom}\\*\\*`));
  assert.match(secretsDe(evts, 'a'), /Ta meute : B \(n°2\), C \(n°3\)/);
  assert.doesNotMatch(secretsDe(evts, 'l'), /meute/i);
  assert.ok(evts.some((e) => e.a === 'meneur' && /1\. A — Loup-garou/.test(e.t)));
  // Les réglages du meneur : loups=1, +idiot, -voyante, des chronos.
  const r = partie(['A', 'B', 'C', 'D', 'E', 'F'], 'loups=1 +idiot -voyante -sorciere debat=30 nuit=20 nimporte');
  assert.match(publics(r.evts), /1 Loup-garou, 1 Idiot du village, 4 Simples villageois/);
  assert.deepEqual([r.p.options.chronos.debat, r.p.options.chronos.nuit], [30, 20]);
  assert.ok(r.evts.some((e) => e.a === 'meneur' && /pas compris : nimporte/.test(e.t)));
  // Trop peu de joueurs.
  const petit = partie(['A', 'B', 'C'], false);
  assert.ok(men(petit.p, 'lancer').some((e) => /au moins 4 joueurs/.test(e.t)));
  assert.equal(petit.p.phase, 'inscriptions');
});

test('les inscriptions : jouer, quitter, ajouter, retirer ; le meneur ne joue pas', () => {
  const { p } = partie(['Alice', 'Bob'], false);
  assert.ok(lg(p, 'alice', 'jouer').some((e) => /déjà inscrit/.test(e.t)));
  assert.ok(men(p, 'jouer').some((e) => /le meneur ne joue pas/.test(e.t)));
  const ajout = LG.commande(p, MENEUR, 'ajouter carla zorro', { now: horloge, rnd: FIXE, compte: (a) => (a === 'carla' ? { u: 'carla', nom: 'Carla' } : null) });
  assert.match(publics(ajout), /Carla rejoint la partie \(3 joueurs\)/);
  assert.ok(ajout.some((e) => e.a === 'meneur' && /introuvable : zorro/.test(e.t)));
  lg(p, 'alice', 'quitter');
  assert.deepEqual(p.joueurs.map((j) => [j.n, j.nom]), [[1, 'Bob'], [2, 'Carla']], 'renumérotés');
  men(p, 'retirer carla');
  assert.deepEqual(p.joueurs.map((j) => j.nom), ['Bob']);
  assert.ok(lg(p, 'bob', 'suite').some((e) => /Seul le meneur/.test(e.t)));
});

test('une partie complète : nuit, sorcière, débat, vote, chasseur — victoire du village', () => {
  // 8 joueurs : A et B loups, C voyante, D sorcière, E chasseur, F G H villageois.
  const { p } = partie(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(p.joueurs.map((j) => j.role), ['loup', 'loup', 'voyante', 'sorciere', 'chasseur', 'villageois', 'villageois', 'villageois']);
  // La nuit : le village se tait, la meute se parle.
  assert.equal(LG.parole(p, 'f', false).ok, false);
  assert.deepEqual(LG.parole(p, 'a', false), { meute: true });
  assert.deepEqual(LG.parole(p, 'anim', true), { ok: true });
  assert.equal(LG.parole(p, 'spectateur', false).ok, false);
  assert.deepEqual(LG.parole(p, 'autreanim', true), { ok: true }, 'un animateur qui ne joue pas parle');
  const m = LG.meute(p, 'a', 'on mange F ?');
  assert.deepEqual(m.filter((e) => e.a === 'secret').map((e) => e.u).sort(), ['a', 'b']);
  assert.ok(m.some((e) => e.a === 'meneur'));
  assert.ok(LG.meute(p, 'c', 'coucou').every((e) => e.u === 'c'), 'pas de meute pour la voyante');
  // Les loups hésitent, la voyante sonde, puis la meute s'accorde.
  lg(p, 'a', 'devorer F');
  assert.ok(lg(p, 'a', 'devorer 2').some((e) => /On ne mange pas un membre de la meute/.test(e.t)));
  assert.ok(lg(p, 'c', 'devorer 1').some((e) => /pas un loup-garou/.test(e.t)));
  lg(p, 'b', 'devorer g');
  assert.equal(p.etape, 'nuit');
  const vu = lg(p, 'c', 'voir 1');
  assert.match(secretsDe(vu, 'c'), /A \(n°1\) est \*\*Loup-garou\*\* !/);
  assert.ok(lg(p, 'c', 'voir 2').some((e) => /éteinte/.test(e.t)));
  const accord = lg(p, 'b', '6');         // le raccourci : l'action du moment
  assert.match(secretsDe(accord, 'a'), /La meute est d’accord : ce sera F \(n°6\)/);
  assert.equal(p.etape, 'sorciere', 'tout le monde a joué : la sorcière se réveille');
  assert.match(secretsDe(accord, 'd'), /les loups ont attaqué F \(n°6\)/);
  assert.deepEqual(LG.vue(p, 'd', false, horloge).action.sorciere, { victime: 'F', sauver: true, sauve: false });
  const s = lg(p, 'd', 'sauver');
  assert.match(secretsDe(s, 'd'), /Autre chose \?/);
  assert.equal(p.phase, 'nuit', 'la potion de mort reste : elle peut encore agir');
  const jour = lg(p, 'd', 'rien');
  assert.match(publics(jour), /tout le monde se réveille|égratignure|au complet/);
  assert.match(publics(jour), /JOUR 1 : le village débat/);
  assert.equal(p.phase, 'jour');
  assert.ok(vivant(p, 'f'));
  // Le jour : tout le monde parle ; le meneur ouvre le vote.
  assert.equal(LG.parole(p, 'f', false).ok, true);
  assert.ok(lg(p, 'c', 'voter 1').some((e) => /pas encore ouvert/.test(e.t)));
  assert.match(publics(men(p, 'vote')), /AUX URNES/);
  for (const u of ['c', 'd', 'e', 'f', 'g']) lg(p, u, 'voter 1');
  assert.match(publics(lg(p, 'h', 'voter a')), /H vote contre A \(6 voix\)/);
  assert.match(publics(lg(p, 'a', 'voter c')), /A vote contre C/);
  assert.equal(LG.vue(p, 'h', false, horloge).joueurs[0].voix, 6);
  const elim = lg(p, 'b', 'voter 3');
  assert.match(publics(elim), /Le vote est clos\. A 6 · C 2/);
  assert.match(publics(elim), /A \(n°1\) est chassé du village\. Rôle : \*\*Loup-garou\*\*/);
  assert.equal(p.phase, 'soir');
  // Les morts se taisent.
  assert.equal(LG.parole(p, 'a', false).ok, false);
  assert.ok(lg(p, 'a', 'voter 2').some((e) => /les morts n’agissent plus/.test(e.t)));
  // Nuit 2 : B (seul) dévore le chasseur ; la voyante sonde ; la sorcière ne fait rien.
  const n2 = avancer(p, 8000);
  assert.match(publics(n2), /NUIT 2/);
  lg(p, 'b', 'devorer chasseur');      // « chasseur » n'est pas un pseudo
  assert.equal(Object.keys(p.n.loups).length, 0);
  lg(p, 'b', 'devorer e');
  lg(p, 'c', 'voir 7');
  assert.equal(p.etape, 'sorciere');
  const aube = lg(p, 'd', 'rien');
  assert.match(publics(aube), /E \(n°5\) ne se réveillera pas\. Rôle : \*\*Chasseur\*\*/);
  assert.equal(p.phase, 'chasseur');
  assert.match(secretsDe(aube, 'e'), /tu épaules ton fusil/);
  assert.equal(LG.vue(p, 'e', false, horloge).action.verbe, 'tirer');
  const fin = lg(p, 'e', 'tirer B');
  assert.match(publics(fin), /PAN ! Le chasseur emporte B \(n°2\)/);
  assert.match(publics(fin), /victoire du village/);
  assert.equal(p.phase, 'fin');
  const f = fin.find((e) => e.a === 'fin');
  assert.deepEqual([f.camp, f.gagnants.sort()], ['village', ['c', 'd', 'e', 'f', 'g', 'h']]);
  assert.deepEqual(LG.parole(p, 'a', false), { ok: true }, 'la partie finie, les morts reparlent');
});

test('cupidon lie un loup et une villageoise : ils gagnent seuls au monde ; le chagrin emporte l’autre', () => {
  // 5 joueurs : A loup, B voyante, C cupidon, D et E villageois.
  const { p } = partie(['A', 'B', 'C', 'D', 'E'], 'loups=1 +cupidon');
  assert.deepEqual(p.joueurs.map((j) => j.role), ['loup', 'voyante', 'cupidon', 'villageois', 'villageois']);
  assert.ok(lg(p, 'c', 'lier 1').some((e) => /introuvable|Indique un joueur/.test(e.t)));
  const fleche = lg(p, 'c', 'lier 1 4');
  assert.match(secretsDe(fleche, 'a'), /Ton cœur bat désormais pour D \(n°4\)/);
  assert.match(secretsDe(fleche, 'd'), /pour A \(n°1\)/);
  assert.equal(LG.vue(p, 'd', false, horloge).moi.amoureux, 'A');
  assert.equal(LG.vue(p, 'e', false, horloge).joueurs[0].amoureux, undefined, 'les autres ne le savent pas');
  lg(p, 'a', 'devorer 2');
  lg(p, 'b', 'voir 5');
  assert.equal(p.phase, 'jour', 'pas de sorcière : l’aube tout de suite');
  assert.equal(vivant(p, 'b'), false);
  men(p, 'vote');
  for (const [u, c] of [['a', 3], ['d', 3], ['e', 3], ['c', 1]]) lg(p, u, `voter ${c}`);
  assert.equal(vivant(p, 'c'), false);
  avancer(p, 8000);
  const n2 = lg(p, 'a', 'devorer 5');
  assert.match(publics(n2), /victoire des amoureux/);
  assert.deepEqual(n2.find((e) => e.a === 'fin').gagnants.sort(), ['a', 'd']);
  // Le chagrin : dans une autre partie, le vote chasse D et emporte A.
  const q = partie(['A', 'B', 'C', 'D', 'E', 'F'], 'loups=1 +cupidon -sorciere');
  lg(q.p, 'c', 'lier 4 5');
  lg(q.p, 'a', 'devorer 6');
  lg(q.p, 'b', 'voir 3');
  men(q.p, 'vote');
  for (const u of ['a', 'b', 'c', 'e']) lg(q.p, u, 'voter 4');
  const ch = lg(q.p, 'd', 'voter 1');
  assert.match(publics(ch), /Le cœur brisé, E \(n°5\) rejoint son amour/);
});

test('le salvateur protège, pas deux fois de suite ; l’idiot est épargné ; les chronos font avancer', () => {
  // 13 joueurs : A B C loups, D voyante, E sorcière, F chasseur, G cupidon, H salvateur, I idiot, J..M villageois.
  const { p } = partie(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
  assert.deepEqual(p.joueurs.slice(0, 9).map((j) => j.role), ['loup', 'loup', 'loup', 'voyante', 'sorciere', 'chasseur', 'cupidon', 'salvateur', 'idiot']);
  lg(p, 'h', 'proteger 10');
  for (const u of ['a', 'b', 'c']) lg(p, u, 'devorer 10');
  lg(p, 'd', 'voir 1');
  assert.equal(p.etape, 'nuit', 'cupidon n’a pas encore tiré');
  lg(p, 'g', 'lier 11 12');
  assert.equal(p.etape, 'sorciere');
  const aube = lg(p, 'e', 'rien');
  assert.ok(vivant(p, 'j'), 'protégé par le salvateur');
  assert.doesNotMatch(publics(aube), /ne se réveillera pas/);
  // Le vote contre l'idiot : épargné, sans vote ensuite.
  men(p, 'vote');
  for (const j of p.joueurs) if (j.u !== 'i') lg(p, j.u, 'voter 9');
  const idiot = lg(p, 'i', 'voter 1');
  assert.match(publics(idiot), /c’est l’\*\*Idiot du village\*\* ! On l’épargne/);
  assert.ok(vivant(p, 'i'));
  // Nuit 2 : pas deux fois le même ; le chrono tranche pour les loups qui n'ont pas voté.
  avancer(p, 8000);
  assert.ok(lg(p, 'h', 'proteger 10').some((e) => /la nuit dernière/.test(e.t)));
  lg(p, 'a', 'devorer 13');
  lg(p, 'b', 'devorer 10');
  const tard = avancer(p, 60000);
  assert.equal(p.etape, 'sorciere');
  assert.match(secretsDe(tard, 'a'), /faute d’accord, la meute se jette sur [JM]/);
  avancer(p, 30000);                                  // la sorcière dort
  assert.equal(p.phase, 'jour');
  assert.equal(p.joueurs.filter((j) => !j.vivant).length, 1);
  // Le débat se termine seul, le vote aussi : l'idiot ne vote plus, l'égalité épargne tout le monde.
  avancer(p, 150000);
  assert.equal(p.phase, 'vote');
  assert.ok(lg(p, 'i', 'voter 1').some((e) => /ne vote plus/.test(e.t)));
  assert.equal(LG.vue(p, 'i', false, horloge).action, null);
  lg(p, 'd', 'voter 1');
  lg(p, 'a', 'voter 4');
  const nul = avancer(p, 60000);
  assert.match(publics(nul), /Égalité ! .*personne n’est chassé/);
  assert.equal(p.phase, 'soir');
});

test('le meneur : pause, reprise, suite, foudre, chronos ; les secrets ne fuient pas', () => {
  const { p } = partie(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  // La vue d'un villageois ne montre aucun rôle ; celle d'un loup, sa meute ; celle du meneur, tout.
  const vf = LG.vue(p, 'f', false, horloge);
  assert.ok(vf.joueurs.every((j) => !j.role || j.moi));
  assert.equal(vf.moi.role, 'villageois');
  assert.deepEqual(LG.vue(p, 'a', false, horloge).joueurs.filter((j) => j.role).map((j) => j.nom), ['A', 'B']);
  assert.equal(LG.vue(p, 'anim', true, horloge).joueurs.filter((j) => j.role).length, 8);
  assert.equal(LG.vue(p, 'f', false, horloge).reste, 60000);
  // Pause : le chrono s'arrête, rien n'avance.
  horloge += 20000;
  men(p, 'pause');
  assert.equal(LG.vue(p, 'f', false, horloge).reste, 40000);
  assert.deepEqual(avancer(p, 120000), []);
  for (const u of ['a', 'b']) lg(p, u, 'devorer 6');
  lg(p, 'c', 'voir 1');
  assert.equal(p.etape, 'nuit', 'en pause, la nuit attend');
  men(p, 'reprise');
  assert.equal(p.etape, 'sorciere', 'à la reprise, tout le monde avait joué');
  // Suite : on passe la sorcière, puis le débat.
  men(p, 'suite');
  assert.equal(p.phase, 'jour');
  assert.equal(vivant(p, 'f'), false);
  men(p, 'suite');
  assert.equal(p.phase, 'vote');
  // La foudre : le meneur retire un joueur (absent, tricheur…).
  const foudre = men(p, 'eliminer G');
  assert.match(publics(foudre), /La foudre du meneur s’abat sur G \(n°7\)/);
  assert.ok(lg(p, 'c', 'eliminer 1').some((e) => /Seul le meneur/.test(e.t)));
  assert.match(men(p, 'chrono debat=0 vote=20').find((e) => e.a === 'meneur').t, /débat au meneur, vote 20 s/);
  assert.match(men(p, 'roles').find((e) => e.a === 'meneur').t, /1\. A — Loup-garou/);
  assert.match(lg(p, 'f', 'etat').find((e) => e.a === 'secret').t, /6\. F † — Simple villageois/);
  assert.doesNotMatch(lg(p, 'h', 'etat').find((e) => e.a === 'secret').t, /A — Loup-garou/);
  // Un autre animateur reprend la main.
  const relais = LG.commande(p, { u: 'anim2', nom: 'Anim2', staff: true }, 'meneur', { now: horloge, rnd: FIXE });
  assert.equal(p.meneur, 'anim2');
  assert.ok(relais.some((e) => e.a === 'meneur' && /A — Loup-garou/.test(e.t)));
  // La fin, sur ordre du meneur.
  const stop = men(p, 'fin');
  assert.match(publics(stop), /Le meneur arrête la partie/);
  assert.equal(p.phase, 'fin');
  assert.ok(!stop.some((e) => e.a === 'fin'), 'pas de prix sur une partie arrêtée');
});

test('retrouver un joueur ; la partie se sauvegarde en JSON et repart', () => {
  const { p } = partie(['Kasparov', 'Karpov', 'Tal', 'Fischer', 'Carlsen']);
  assert.equal(LG.trouver(p, 'kasp').j.nom, 'Kasparov');
  assert.match(LG.trouver(p, 'ka').erreur, /Plusieurs joueurs correspondent : Kasparov, Karpov/);
  assert.equal(LG.trouver(p, '#3').j.nom, 'Tal');
  assert.equal(LG.trouver(p, 'CARLSEN').j.nom, 'Carlsen');
  assert.match(LG.trouver(p, 'zorro').erreur, /Je ne trouve pas/);
  assert.match(LG.trouver(p, '9').erreur, /Pas de joueur n°9/);
  // Une sauvegarde au milieu de la nuit, relue : la partie continue pareil.
  lg(p, 'kasparov', 'devorer 3');
  const relue = JSON.parse(JSON.stringify(p));
  const e = LG.commande(relue, { u: 'karpov', nom: 'Karpov' }, 'voir 1', { now: horloge, rnd: FIXE });
  assert.match(secretsDe(e, 'karpov'), /Kasparov \(n°1\) est \*\*Loup-garou\*\*/);
  assert.equal(relue.phase, 'jour');
  assert.equal(relue.joueurs.find((j) => j.u === 'tal').vivant, false);
  assert.match(LG.aide(p, 'x', true), /Meneur : \/lg ouvrir/);
  assert.doesNotMatch(LG.aide(p, 'x', false), /Meneur/);
});
