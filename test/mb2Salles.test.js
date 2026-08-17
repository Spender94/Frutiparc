/*
 * Motion-Ball 2 : aucune salle servie ne doit être IMPOSSIBLE À OUVRIR.
 *
 * Level.gen_normal_room incrémente bonus_reds pour chaque item de type 8
 * (bille rouge) et interf.open_doors() n'est appelé qu'à bonus_reds == 0. Une
 * rouge que la bille ne peut pas atteindre condamne donc la salle, et avec
 * elle le parcours — « une salle de la verte ne s'ouvre pas même après avoir
 * récupéré toutes les billes ».
 *
 * Deux causes distinctes, à ne pas confondre :
 *
 *   1. HORS TERRAIN. 46 items des dungeon/*.txt portaient une position au-delà
 *      de la table (152×102 cases), jusqu'à y=215 — soit 860 px, bien sous le
 *      sol. Tous avec la même empreinte : cinq bits de poids faible de X à 1
 *      et bit de poids fort de Y mis. Sept d'entre eux étaient des rouges, qui
 *      bloquaient sept salles. assembleMake({reparerHorsChamp:true}) les
 *      retire à la construction des .dat servis : invisibles et inatteignables
 *      de toute façon, leur seul effet était d'empoisonner le compteur.
 *
 *   2. EMMURÉE. Une rouge posée dans une poche de décor fermée par des blocs.
 *      C'est du placement d'auteur, pas un artefact d'encodage : on ne touche
 *      pas aux données, mais on veut le savoir. Le cas connu (aventure 2,
 *      salle (3,2)) est listé ici en toutes lettres ; le test échoue si un
 *      NOUVEAU cas apparaît.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JEU = path.join(ROOT, 'Games', 'motionBall2');
const mb2 = require(path.join(ROOT, 'mb2gen.js'));
mb2.loadBumpers();
const T = mb2._tables;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const POS_NBITS = 8;
const FICHIERS = ['mb2tuto', 'mb2adv1', 'mb2adv2', 'mb2adv3', 'mb2adv4', 'mb2adv5',
  'mb2run1', 'mb2run2', 'mb2run3', 'mb2run4', 'mb2run5', 'mb2run6', 'mb2run7'];

// Les salles emmurées CONNUES : « fichier salle(x,y) rouge@x,y ». Une entrée
// ici veut dire « constaté, laissé tel quel, pas une régression ».
const EMMUREES_CONNUES = new Set(['mb2adv2 (3,2) 36,84']);

// La grammaire de LevelLoader.as, avec l'alphabet du SWF.
function decoder(texte) {
  const data = /ddata=([a-zA-Z0-9_-]+)/.exec(texte)[1];
  const bits = [];
  for (const c of data) {
    const v = ALPHABET.indexOf(c);
    for (let j = 5; j >= 0; j--) bits.push((v >> j) & 1);
  }
  let pos = 0;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (bits[pos++] || 0); return v; };
  const W = read(7), H = read(7); read(7); read(7);
  const salles = [];
  for (let x = 0; x < W; x++) {
    salles[x] = [];
    for (let y = 0; y < H; y++) {
      const t = read(3);
      if (t === 3 || t === 5) read(2); else if (t === 4) read(3);
      if (t !== 0) for (let d = 0; d < 4; d++) { if (read(2) === 3) read(2); }
      salles[x][y] = { rtype: t, items: null };
    }
  }
  pos = Math.ceil(pos / 6) * 6;                    // MTBitcodec.next_part
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (read(1) === 0) continue;
      const items = [];
      for (;;) {
        const t = read(4);
        if (t === 0) break;
        items.push({ t, x: read(POS_NBITS), y: read(POS_NBITS) });
        assert.ok(items.length < 400, 'liste d\'items sans fin — le flux a déraillé');
      }
      salles[x][y].items = items;
    }
  }
  return { W, H, salles };
}

// Les rouges qu'aucune case libre atteignable ne touche.
function rougesEmmurees(salle) {
  const { cwidth: CW, cheight: CH, cborder: BORD, bumpers, redTable } = T;
  const dur = Array.from({ length: CW }, () => new Array(CH).fill(false));
  for (let i = 0; i < BORD; i++) {
    for (let j = 0; j < CH; j++) { dur[i][j] = true; dur[CW - 1 - i][j] = true; }
  }
  for (let j = 0; j < BORD; j++) {
    for (let i = 0; i < CW; i++) { dur[i][j] = true; dur[i][CH - 1 - j] = true; }
  }
  // Seuls les blocs arrêtent la bille (BBlock et les blocs à interrupteur).
  for (const it of salle.items) {
    if (it.t !== 6 && it.t !== 12 && it.t !== 13) continue;
    const tbl = bumpers[it.t - 1];
    if (!tbl) continue;
    for (let a = 0; a < tbl.length; a++) {
      for (let b = 0; b < tbl[a].length; b++) {
        if (!tbl[a][b]) continue;
        const px = it.x + a, py = it.y + b;
        if (px >= 0 && px < CW && py >= 0 && py < CH) dur[px][py] = true;
      }
    }
  }
  const vu = Array.from({ length: CW }, () => new Array(CH).fill(false));
  const file = [];
  const semer = (px, py) => {
    if (px < 0 || px >= CW || py < 0 || py >= CH) return;
    if (dur[px][py] || vu[px][py]) return;
    vu[px][py] = true; file.push([px, py]);
  };
  // Les quatre portes (milieu de chaque bord) et le centre.
  semer(Math.floor(CW / 2), BORD + 1);
  semer(Math.floor(CW / 2), CH - BORD - 2);
  semer(BORD + 1, Math.floor(CH / 2));
  semer(CW - BORD - 2, Math.floor(CH / 2));
  semer(Math.floor(CW / 2), Math.floor(CH / 2));
  while (file.length) {
    const [px, py] = file.pop();
    semer(px + 1, py); semer(px - 1, py); semer(px, py + 1); semer(px, py - 1);
  }
  const perdues = [];
  for (const r of salle.items) {
    if (r.t !== 8) continue;
    let prenable = false;
    for (let a = -1; a <= redTable.length && !prenable; a++) {
      for (let b = -1; b <= redTable[0].length; b++) {
        const px = r.x + a, py = r.y + b;
        if (px < 0 || px >= CW || py < 0 || py >= CH) continue;
        if (vu[px][py]) { prenable = true; break; }
      }
    }
    if (!prenable) perdues.push(r);
  }
  return perdues;
}

test('aucun item des .dat servis ne tombe hors de la table de jeu', () => {
  const { cwidth: CW, cheight: CH } = T;
  for (const f of FICHIERS) {
    const d = decoder(fs.readFileSync(path.join(JEU, f + '.dat'), 'utf8'));
    for (let x = 0; x < d.W; x++) {
      for (let y = 0; y < d.H; y++) {
        const s = d.salles[x][y];
        if (!s.items) continue;
        for (const it of s.items) {
          assert.ok(it.x < CW && it.y < CH,
            `${f} salle(${x},${y}) : item type ${it.t} @${it.x},${it.y} hors table ${CW}×${CH}`);
        }
      }
    }
  }
});

test('aucune bille rouge inatteignable, hors les cas connus', () => {
  const trouves = [];
  for (const f of FICHIERS) {
    const d = decoder(fs.readFileSync(path.join(JEU, f + '.dat'), 'utf8'));
    for (let x = 0; x < d.W; x++) {
      for (let y = 0; y < d.H; y++) {
        const s = d.salles[x][y];
        if (!s.items) continue;
        for (const r of rougesEmmurees(s)) trouves.push(`${f} (${x},${y}) ${r.x},${r.y}`);
      }
    }
  }
  const neufs = trouves.filter((t) => !EMMUREES_CONNUES.has(t));
  assert.deepEqual(neufs, [],
    'salle(s) devenue(s) impossible(s) à ouvrir : ' + neufs.join(' | '));
  // Le cas connu doit rester connu : s'il disparaît, c'est que la liste est
  // à mettre à jour (et la salle enfin jouable).
  for (const c of EMMUREES_CONNUES) {
    assert.ok(trouves.includes(c), `le cas connu « ${c} » n'existe plus — retirer l'entrée`);
  }
});

test('la réparation hors-champ est rejouable et laisse la preuve de fidélité intacte', () => {
  const swap = (s) => s.replace(/[-_]/g, (c) => (c === '-' ? '_' : '-'));
  for (const [txt, dat] of [['course_2', 'mb2run2'], ['adv_2', 'mb2adv2'], ['tuto', 'mb2tuto']]) {
    const source = path.join(JEU, 'dungeon', txt + '.txt');
    const rapport = { reparerHorsChamp: true };
    const repare = mb2.assembleMake(source, mb2.B64_SWF, rapport);
    assert.equal(fs.readFileSync(path.join(JEU, dat + '.dat'), 'utf8'), repare,
      `${dat}.dat est bien la sortie RÉPARÉE de dungeon/${txt}.txt`);
    assert.ok(rapport.retires.length > 0, `${dat} : des items hors champ ont bien été retirés`);
    // Sans réparation, l'alphabet OCaml reproduit toujours l'archive d'époque,
    // et l'alphabet SWF en est le transcodage exact : le port n'a pas dérivé.
    const brutSwf = mb2.assembleMake(source, mb2.B64_SWF);
    const brutOcaml = mb2.assembleMake(source, mb2.B64_OCAML);
    const [pre, dd] = brutSwf.split('&ddata=');
    assert.equal(brutOcaml, pre + '&ddata=' + swap(dd),
      `${dat} : les deux alphabets restent l'exact miroir l'un de l'autre`);
  }
});
