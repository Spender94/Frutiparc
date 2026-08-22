/*
 * Le calendrier de la vitrine : « chaque lundi à 18 h, heure de Paris ».
 *
 * Trois choses à prouver, dont une qui ne se voit que deux fois par an :
 *   · un lundi à 17 h 59, on est encore dans la vitrine de la semaine passée ;
 *     à 18 h 00, dans la nouvelle ;
 *   · deux lundis consécutifs portent deux numéros consécutifs — y compris
 *     ceux qui encadrent un changement d'heure, où l'écart réel n'est pas de
 *     168 heures mais de 167 ou 169 ;
 *   · le numéro se retraduit exactement en la date de son lundi.
 *
 * Le balayage de deux ans, heure par heure, est celui qui pèse : il vérifie que
 * CHAQUE bascule tombe un lundi à 18 h de Paris, et pas une minute ailleurs.
 * C'est là qu'un numéro tiré d'une division de millisecondes se ferait prendre
 * — sa frontière à lui est fixe dans le temps absolu, donc elle dérive d'une
 * heure dans le calendrier parisien au dernier week-end de mars et d'octobre.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../public/js/vitrine-calendrier.js');

const HEURE = 18;
// Un instant, exprimé en heure de Paris, ramené à sa date absolue. On la
// cherche par balayage plutôt que par un décalage codé en dur : c'est
// justement le décalage qui bouge.
function instantParis(aaaammjj, heure) {
  const [y, m, d] = aaaammjj.split('-').map(Number);
  for (let dec = -2; dec <= 2; dec++) {
    const t = new Date(Date.UTC(y, m - 1, d, heure - dec, 30));
    const p = C.composantesParis(t);
    if (p.y === y && p.m === m && p.d === d && p.h === heure) return t;
  }
  throw new Error('heure de Paris introuvable : ' + aaaammjj + ' ' + heure + 'h');
}

test('un lundi, la vitrine bascule à 18 h pile', () => {
  const lundi = '2026-03-02';
  const avant = C.semaineDeVitrine(instantParis(lundi, 17), HEURE);
  const apres = C.semaineDeVitrine(instantParis(lundi, 18), HEURE);
  assert.equal(apres, avant + 1, '17 h → semaine précédente, 18 h → nouvelle');
  assert.equal(C.dateLundi(apres), lundi, 'la nouvelle semaine est bien celle de ce lundi');
  assert.equal(C.dateLundi(avant), '2026-02-23', 'la précédente est celle du lundi d\'avant');
});

test('la semaine tient du lundi 18 h au lundi suivant 17 h 59', () => {
  const s = C.semaineDeVitrine(instantParis('2026-03-02', 18), HEURE);
  const memeSemaine = [
    ['2026-03-02', 18], ['2026-03-02', 23], ['2026-03-03', 0], ['2026-03-05', 12],
    ['2026-03-08', 23], ['2026-03-09', 0], ['2026-03-09', 17],
  ];
  for (const [j, h] of memeSemaine) {
    assert.equal(C.semaineDeVitrine(instantParis(j, h), HEURE), s, `${j} ${h}h est dans la semaine du 02/03`);
  }
  assert.equal(C.semaineDeVitrine(instantParis('2026-03-09', 18), HEURE), s + 1,
    'le lundi suivant 18 h ouvre la semaine d\'après');
  assert.equal(C.semaineDeVitrine(instantParis('2026-03-01', 23), HEURE), s - 1,
    'le dimanche soir est encore dans la semaine d\'avant');
});

// ── Le piège : les deux week-ends de changement d'heure ─────────────────────
// En 2026 l'heure d'été arrive le dimanche 29 mars et repart le 25 octobre. Les
// lundis qui encadrent ces nuits-là sont séparés de 167 h et 169 h, pas 168.
test("le changement d'heure ne fait ni sauter ni répéter une semaine", () => {
  for (const [avant, apres] of [['2026-03-23', '2026-03-30'], ['2026-10-19', '2026-10-26']]) {
    const a = C.semaineDeVitrine(instantParis(avant, 18), HEURE);
    const b = C.semaineDeVitrine(instantParis(apres, 18), HEURE);
    assert.equal(b, a + 1, `${avant} → ${apres} : un seul numéro d'écart`);
    assert.equal(C.dateLundi(a), avant, 'le numéro retrouve son lundi (avant)');
    assert.equal(C.dateLundi(b), apres, 'le numéro retrouve son lundi (après)');
  }
});

test('deux ans de lundis se suivent sans trou ni doublon', () => {
  // Balayage heure par heure : chaque numéro doit être stable pendant
  // exactement une semaine, et monter de 1 en 1.
  let t = instantParis('2025-12-29', 18);
  let attendu = C.semaineDeVitrine(t, HEURE);
  const vus = new Set();
  const fin = Date.UTC(2027, 11, 31);
  let dernier = attendu;
  while (t.getTime() < fin) {
    const s = C.semaineDeVitrine(t, HEURE);
    assert.ok(s === dernier || s === dernier + 1,
      `le numéro ne peut que rester ou monter de 1 (${dernier} → ${s} le ${t.toISOString()})`);
    if (s !== dernier) {
      // Un changement ne se produit qu'à un lundi 18 h de Paris.
      const p = C.composantesParis(t);
      const jour = Date.UTC(p.y, p.m - 1, p.d) / C.JOUR_MS;
      assert.equal(((jour + 4) % 7 + 7) % 7, 1, 'la bascule tombe un lundi');
      assert.equal(p.h, HEURE, 'la bascule tombe à 18 h');
      assert.ok(!vus.has(s), 'aucun numéro ne revient');
      vus.add(s);
      dernier = s;
    }
    t = new Date(t.getTime() + 3600000);
  }
  assert.ok(vus.size >= 104, 'deux ans de balayage ont bien vu ~104 bascules (' + vus.size + ')');
});

test('le numéro et la date du lundi sont deux vues de la même chose', () => {
  // Semaine 0 = le lundi 5 janvier 1970, le premier lundi de l'ère Unix.
  assert.equal(C.dateLundi(0), '1970-01-05');
  for (let s = 2900; s < 2910; s++) {
    const jour = C.dateLundi(s);
    assert.equal(C.semaineDeVitrine(instantParis(jour, 18), HEURE), s, jour + ' ↔ semaine ' + s);
    assert.equal(new Date(C.dateLundi(s + 1)) - new Date(jour), 7 * C.JOUR_MS, 'sept jours d\'écart');
  }
});
