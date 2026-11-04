'use strict';
/*
 * ══ LES FRUTISIGNES DONNENT DES PARTIES ═════════════════════════════════════
 *
 * « Lorsque c'est la semaine du Frutisigne d'un Frutiz, celui-ci a droit à 2
 * parties supplémentaires par jour, réparties de façon aléatoire (par exemple
 * un FD Kaluga et un FD Snake). Lorsque c'est le jour de l'ascendant : 1 seul
 * FD en plus. Ça permet de donner de l'intérêt aux frutisignes qui aujourd'hui
 * sont purement décoratifs. »
 *
 * Le signe et l'ascendant d'un frutiz sont deux chiffres de 0 à 9 (colonnes
 * fruti_sign / fruti_sign_b), que M'dam Irma révèle dans les salons. Restait à
 * savoir QUAND c'est leur tour — et le parc d'époque le dit déjà : c'est la
 * roue des frutisignes de la frutimandala.
 *
 * LA SEMAINE DU SIGNE — `RunDate.getCurrentFSign` (main.swf, 0xbbf73), la loi
 * que la roue du bureau suit au chiffre près (bureau-frutiz.js,
 * `mandala.majFrutisigne`) :
 *
 *     signe = floor(((t − 345600) / 604800) % 10)       t en secondes
 *
 * Une SEMAINE par signe (604 800 s), dix signes qui tournent ; le décalage de
 * 345 600 s (quatre jours) cale le changement sur le lundi 0 h UTC. Le cycle
 * court depuis 1970 sans jamais se recaler : le jour de l'an n'y change rien,
 * une semaine à cheval sur deux années reste une seule semaine.
 *
 * Les parties du Challenge se comptent, elles, en jours de PARIS. Un jour de
 * Paris prend le signe que la roue montre à MIDI ce jour-là : du lundi au
 * dimanche, la semaine entière. (Seule la première heure du lundi — une ou
 * deux selon l'heure d'été — voit la roue encore sur le signe précédent.)
 *
 * LE JOUR DE L'ASCENDANT — la même roue fait tourner l'ascendant d'un cran par
 * HEURE (`signb = floor((t / 3600) % 10)`). Le jour de l'ascendant est cette
 * loi à l'échelle du jour : floor((t / 86 400) % 10), soit un jour tous les
 * dix, à date fixe dans le cycle et pour tout le monde.
 *
 * LE CUMUL. Le jour de l'ascendant peut tomber dans la semaine du signe : les
 * deux cadeaux s'ajoutent alors, trois parties. Rien ne dit qu'ils
 * s'excluent, et refuser l'un parce qu'on a l'autre ôterait au jour le plus
 * rare ce qui le rend remarquable.
 *
 * LE TIRAGE. Les parties vont à des jeux du Challenge DIFFÉRENTS (« un FD
 * Kaluga et un FD Snake »), tirés parmi ceux dont le Challenge est rationné.
 * Le tirage est une fonction du pseudo et du jour, rien d'autre : un
 * redémarrage ne le refait pas, deux appels donnent deux fois la même chose,
 * et il n'y a rien à stocker.
 */

const crypto = require('crypto');

const PARTIES_SEMAINE = 2;   // pendant la semaine du signe, chaque jour
const PARTIES_ASCENDANT = 1; // le jour de l'ascendant
const NB_SIGNES = 10;

const mod = (n, m) => ((n % m) + m) % m;

// Le numéro d'un jour de calendrier « YYYY-MM-DD » : jours écoulés depuis le
// 1er janvier 1970. null si la clé ne ressemble pas à une date.
function numeroDuJour(cleJour) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cleJour || ''));
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

// Le signe de la semaine qui contient ce jour — la loi de getCurrentFSign
// prise à midi : floor((n·86400 + 43200 − 345600) / 604800) = floor((n − 4) / 7)
// pour tout jour entier n.
function signeDeLaSemaine(cleJour) {
  const n = numeroDuJour(cleJour);
  return n === null ? null : mod(Math.floor((n - 4) / 7), NB_SIGNES);
}

// Le signe du jour, celui de l'ascendant : la loi horaire de `signb` à
// l'échelle du jour.
function signeDuJour(cleJour) {
  const n = numeroDuJour(cleJour);
  return n === null ? null : mod(n, NB_SIGNES);
}

// Le lundi et le dimanche de la semaine du signe qui contient ce jour.
function bornesDeLaSemaine(cleJour) {
  const n = numeroDuJour(cleJour);
  if (n === null) return null;
  const lundi = n - mod(n - 4, 7);
  const cle = (j) => new Date(j * 86400000).toISOString().slice(0, 10);
  return { debut: cle(lundi), fin: cle(lundi + 6) };
}

const estSigne = (v) => v !== null && v !== undefined && v !== ''
  && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) < NB_SIGNES;

// Les `combien` premiers jeux d'un mélange propre au pseudo et au jour : un
// Fisher-Yates dont les tirages sont les octets d'un SHA-256, renouvelé par
// tranches. La liste des jeux est triée d'abord, pour que l'ordre où le
// serveur les déclare ne change pas le résultat.
function tirerLesJeux(pseudo, cleJour, jeux, combien) {
  const liste = [...new Set((jeux || []).map(String))].sort();
  const n = Math.min(Math.max(0, combien | 0), liste.length);
  let octets = Buffer.alloc(0);
  let tranche = 0, i = 0;
  const hasard = () => {
    if (i + 4 > octets.length) {
      octets = crypto.createHash('sha256')
        .update(`frutisigne|${String(pseudo || '').toLowerCase()}|${cleJour}|${tranche++}`).digest();
      i = 0;
    }
    const v = octets.readUInt32BE(i);
    i += 4;
    return v / 0x100000000;
  };
  for (let k = 0; k < n; k++) {
    const j = k + Math.floor(hasard() * (liste.length - k));
    [liste[k], liste[j]] = [liste[j], liste[k]];
  }
  return liste.slice(0, n);
}

/*
 * Ce que le Frutisigne offre à un frutiz un jour donné :
 *   { semaine, ascendant, parties, jeux: [jeu, …], signeSemaine, signeJour }
 * `jeux` est la liste des jeux qui reçoivent UNE partie de plus aujourd'hui
 * (vide les autres jours, ou si le signe n'est pas encore révélé).
 */
function bonusDuJour({ pseudo, signe, ascendant, cleJour, jeux }) {
  const signeSemaine = signeDeLaSemaine(cleJour);
  const signeJour = signeDuJour(cleJour);
  const semaine = estSigne(signe) && Number(signe) === signeSemaine;
  const jourAsc = estSigne(ascendant) && Number(ascendant) === signeJour;
  const parties = (semaine ? PARTIES_SEMAINE : 0) + (jourAsc ? PARTIES_ASCENDANT : 0);
  return {
    semaine,
    ascendant: jourAsc,
    parties,
    jeux: parties ? tirerLesJeux(pseudo, cleJour, jeux, parties) : [],
    signeSemaine,
    signeJour,
  };
}

// « à Kaluga et à Frutisnake », « à Kaluga, à Swapou et à Frutisnake ».
function enumerer(noms) {
  const l = noms.map((n) => 'à ' + n);
  if (l.length <= 1) return l.join('');
  return l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
}

// Le mot du jour, sobre. `libelle(jeu)` donne le nom affiché d'un jeu.
function phraseDuBonus(bonus, libelle) {
  if (!bonus || !bonus.jeux || !bonus.jeux.length) return '';
  const nom = typeof libelle === 'function' ? libelle : (j) => j;
  const noms = bonus.jeux.map(nom);
  const debut = bonus.semaine && bonus.ascendant ? 'C\'est ta semaine, et le jour de ton ascendant !'
    : bonus.semaine ? 'C\'est ta semaine !' : 'C\'est le jour de ton ascendant !';
  // Une partie de plus À CHAQUE jeu nommé : le tirage ne donne jamais deux
  // parties au même jeu.
  return `${debut} Le Frutisigne t'offre une partie de plus ${enumerer(noms)} aujourd'hui.`;
}

module.exports = {
  PARTIES_SEMAINE,
  PARTIES_ASCENDANT,
  numeroDuJour,
  signeDeLaSemaine,
  signeDuJour,
  bornesDeLaSemaine,
  tirerLesJeux,
  bonusDuJour,
  phraseDuBonus,
};
