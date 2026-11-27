#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE — LA PAGE D'INDEX DU KIT.
 *
 *   node scripts/kit-bande-annonce/index.js [dossier-du-kit]
 *
 * Parcourt <kit>/*\/manifest.json (sections chat, jeux-a, jeux-b, extras… et
 * toute autre qui viendrait s'ajouter) et écrit <kit>/index.html : une page
 * française aux couleurs du parc qui liste chaque élément, section par
 * section, avec
 *
 *   · un aperçu : vidéo (affiche, lecture muette en boucle au survol ou au
 *     toucher), image, lecteur audio, spécimen de police ;
 *   · sa description et son idée d'usage ;
 *   · sa durée, sa définition, son poids, son fond (transparent ou non) ;
 *   · un lien de téléchargement, et un par variante.
 *
 * Tous les liens sont RELATIFS : le dossier du kit, une fois téléchargé,
 * s'ouvre tel quel, hors ligne. Les poids sont relevés sur le disque (pas
 * recopiés des manifestes). La page tient sur un téléphone : une colonne,
 * des cartes larges, les groupes nombreux (les stickers d'un personnage, les
 * polices…) repliés derrière un titre qu'on touche pour les déplier.
 *
 * Champs du manifeste lus : section, titre, texte, elements[{ fichier, type
 * (video|image|son|police|autre), titre, description, usage, duree, fps,
 * largeur, hauteur, alpha, affiche, variantes[], groupe }]. `groupe` est
 * facultatif.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KIT = path.resolve(process.argv[2] || process.env.KIT_DIR || '/home/user/Frutiparc/kit-bande-annonce');
const ORDRE = ['chat', 'salon-habitues', 'jeux-a', 'jeux-b', 'pictos-frutisnake', 'frusion-fd', 'extras'];

const pluriel = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Un chemin relatif sûr dans un attribut : chaque segment encodé.
const url = (...segs) => segs.join('/').split('/').map(encodeURIComponent).join('/');

function poids(o) {
  if (o == null) return '';
  if (o < 1024) return o + ' o';
  if (o < 1024 * 1024) return (o / 1024).toFixed(0) + ' Ko';
  if (o < 1024 * 1024 * 1024) return (o / 1024 / 1024).toFixed(o < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' Mo';
  return (o / 1024 / 1024 / 1024).toFixed(2).replace('.', ',') + ' Go';
}
function duree(s) {
  if (!(s > 0)) return '';
  if (s < 60) return s.toFixed(1).replace('.', ',') + ' s';
  return Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0');
}
function taille(dos, rel) {
  try { return fs.statSync(path.join(KIT, dos, rel)).size; } catch (e) { return null; }
}
const ext = (f) => path.extname(f || '').toLowerCase();
const estVideo = (f) => ['.mp4', '.webm', '.mov', '.m4v'].includes(ext(f));
const estImage = (f) => ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext(f));
const estSon = (f) => ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus'].includes(ext(f));

function lireSections() {
  const sections = [];
  for (const nom of fs.readdirSync(KIT)) {
    const f = path.join(KIT, nom, 'manifest.json');
    if (!fs.existsSync(f)) continue;
    // Les sections d'essai (zz-essai-…) ne paraissent jamais dans l'index.
    if (/^zz-essai/.test(nom)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      m.dossier = nom;
      m.elements = Array.isArray(m.elements) ? m.elements.filter((e) => e && e.fichier) : [];
      sections.push(m);
    } catch (e) {
      sections.push({ dossier: nom, titre: nom, texte: 'Manifeste illisible : ' + e.message, elements: [] });
    }
  }
  const rang = (s) => { const i = ORDRE.indexOf(s.dossier); return i < 0 ? 100 : i; };
  return sections.sort((a, b) => rang(a) - rang(b) || a.dossier.localeCompare(b.dossier));
}

// L'aperçu d'un élément. Une vidéo transparente (WebM) ne se lit pas sur
// iPhone : on prévisualise alors sa première variante MP4 s'il y en a une.
function apercu(dos, e) {
  const tous = [e.fichier].concat(e.variantes || []);
  const affiche = e.affiche ? url(dos, e.affiche) : '';
  const type = e.type || (estVideo(e.fichier) ? 'video' : estImage(e.fichier) ? 'image' : estSon(e.fichier) ? 'son' : 'autre');
  if (type === 'video' || estVideo(e.fichier)) {
    const mp4 = tous.find((f) => ext(f) === '.mp4');
    const webm = tous.find((f) => ext(f) === '.webm');
    const sources = (mp4 ? '<source src="' + url(dos, mp4) + '" type="video/mp4">' : '')
      + (webm && webm !== mp4 ? '<source src="' + url(dos, webm) + '" type="video/webm">' : '');
    const src = sources || '<source src="' + url(dos, e.fichier) + '">';
    const vertical = e.hauteur > e.largeur;
    return '<div class="ap' + (vertical ? ' ap-v' : '') + (e.alpha ? ' ap-alpha' : '') + '">'
      + '<video muted loop playsinline preload="' + (affiche ? 'none' : 'metadata') + '"'
      + (affiche ? ' poster="' + affiche + '"' : '') + '>' + src + '</video>'
      + '<span class="jouer" aria-hidden="true">▶</span></div>';
  }
  if (type === 'son' || estSon(e.fichier)) {
    return '<div class="ap ap-son">' + (affiche ? '<img loading="lazy" src="' + affiche + '" alt="">' : '<span class="note">♪</span>')
      + '<audio controls preload="none" src="' + url(dos, e.fichier) + '"></audio></div>';
  }
  const img = estImage(e.fichier) ? e.fichier : (e.affiche || tous.find(estImage));
  if (img) {
    return '<div class="ap ap-img' + (e.alpha ? ' ap-alpha' : '') + '"><img loading="lazy" src="' + url(dos, img) + '" alt=""></div>';
  }
  return '<div class="ap ap-autre"><span class="note">' + esc(ext(e.fichier).slice(1).toUpperCase() || 'fichier') + '</span></div>';
}

function carte(dos, e) {
  const o = taille(dos, e.fichier);
  const meta = [];
  if (e.duree) meta.push(duree(Number(e.duree)));
  if (e.largeur && e.hauteur) meta.push(e.largeur + ' × ' + e.hauteur);
  if (e.fps) meta.push(e.fps + ' i/s');
  if (e.alpha) meta.push('transparent');
  if (o != null) meta.push(poids(o)); else meta.push('fichier absent');
  const variantes = (e.variantes || []).map((v) => {
    const ov = taille(dos, v);
    return '<a class="var" href="' + url(dos, v) + '" download>' + esc(path.basename(v))
      + (ov != null ? ' <small>' + poids(ov) + '</small>' : ' <small>absent</small>') + '</a>';
  }).join('');
  const cherche = [e.titre, e.description, e.usage, e.fichier, e.groupe].join(' ').toLowerCase();
  return '<article class="carte" data-q="' + esc(cherche) + '">'
    + apercu(dos, e)
    + '<div class="corps"><h3>' + esc(e.titre || path.basename(e.fichier)) + '</h3>'
    + '<div class="meta">' + meta.map(esc).join(' · ') + '</div>'
    + (e.description ? '<p>' + esc(e.description) + '</p>' : '')
    + (e.usage ? '<p class="usage"><b>Usage :</b> ' + esc(e.usage) + '</p>' : '')
    + '<div class="liens"><a class="dl" href="' + url(dos, e.fichier) + '" download>Télécharger '
    + esc(ext(e.fichier).slice(1).toUpperCase()) + '</a>' + variantes + '</div>'
    + '</div></article>';
}

function section(s) {
  // Les éléments sans groupe d'abord, en grille ; puis chaque groupe replié.
  const seuls = s.elements.filter((e) => !e.groupe);
  const groupes = new Map();
  s.elements.filter((e) => e.groupe).forEach((e) => {
    if (!groupes.has(e.groupe)) groupes.set(e.groupe, []);
    groupes.get(e.groupe).push(e);
  });
  let total = 0, nb = 0;
  s.elements.forEach((e) => {
    [e.fichier].concat(e.variantes || []).forEach((f) => { const o = taille(s.dossier, f); if (o) { total += o; nb++; } });
  });
  let h = '<section id="s-' + esc(s.dossier) + '"><h2>' + esc(s.titre || s.dossier)
    + ' <small>' + pluriel(s.elements.length, 'élément') + ' · ' + pluriel(nb, 'fichier') + ' · ' + poids(total) + '</small></h2>'
    + (s.texte ? '<p class="texte">' + esc(s.texte) + '</p>' : '');
  if (!s.elements.length) h += '<p class="vide">Rien pour l’instant.</p>';
  if (seuls.length) h += '<div class="grille">' + seuls.map((e) => carte(s.dossier, e)).join('') + '</div>';
  for (const [g, els] of groupes) {
    h += '<details class="groupe"><summary>' + esc(g) + ' <small>' + pluriel(els.length, 'élément') + '</small></summary>'
      + '<div class="grille">' + els.map((e) => carte(s.dossier, e)).join('') + '</div></details>';
  }
  return { html: h + '</section>', total, nb };
}

function page(sections) {
  let corps = '', total = 0, nb = 0;
  for (const s of sections) { const r = section(s); corps += r.html; total += r.total; nb += r.nb; }
  const nav = sections.map((s) => '<a href="#s-' + esc(s.dossier) + '">' + esc(s.titre ? s.titre.split(' — ')[0] : s.dossier)
    + ' <small>' + s.elements.length + '</small></a>').join('');
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kit bande-annonce Frutiparc</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #E8F8D3; color: #2C4A0F; font: 14px/1.45 Verdana, Geneva, sans-serif; }
  header { background: #ADE76B; padding: 14px 16px 10px; border-bottom: 3px solid #94DB39; }
  header h1 { margin: 0; font-size: 20px; color: #335511; }
  header p { margin: 4px 0 0; font-size: 12px; color: #335511; }
  nav { position: sticky; top: 0; z-index: 5; background: #E8F8D3; border-bottom: 1px solid #ADE76B;
    display: flex; gap: 6px; padding: 8px 16px; overflow-x: auto; -webkit-overflow-scrolling: touch; align-items: center; }
  nav a { flex: none; text-decoration: none; color: #335511; background: #fff; border: 2px solid #ADE76B;
    border-radius: 14px; padding: 4px 10px; font-size: 12px; white-space: nowrap; }
  nav a small { color: #73B01E; }
  nav input { flex: 1 0 140px; min-width: 140px; font: 13px Verdana, sans-serif; padding: 5px 10px;
    border: 2px solid #ADE76B; border-radius: 14px; background: #fff; color: #2C4A0F; }
  main { max-width: 1280px; margin: 0 auto; padding: 8px 16px 40px; }
  section { margin-top: 18px; }
  h2 { font-size: 17px; color: #335511; margin: 10px 0 4px; border-bottom: 2px solid #ADE76B; padding-bottom: 4px; }
  h2 small, summary small { font-weight: normal; font-size: 12px; color: #5A7D33; }
  .texte { margin: 6px 0 10px; color: #335511; font-size: 13px; }
  .vide { color: #5A7D33; font-style: italic; }
  .grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
  .carte { background: #fff; border: 2px solid #ADE76B; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .ap { position: relative; background: #F4FBEA; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center; }
  .ap-v { aspect-ratio: 16 / 9; }
  .ap video, .ap img { width: 100%; height: 100%; object-fit: contain; display: block; }
  /* Un damier sous ce qui est transparent : on voit ce qui est vide. */
  .ap-alpha { background: #fff repeating-conic-gradient(#E3F2D0 0 25%, #fff 0 50%) 0 0 / 18px 18px; }
  .ap .jouer { position: absolute; right: 8px; bottom: 8px; width: 30px; height: 30px; border-radius: 50%;
    background: rgba(44,74,15,.7); color: #fff; font-size: 13px; line-height: 30px; text-align: center; pointer-events: none; }
  .ap.lit .jouer { display: none; }
  .ap-son { flex-direction: column; gap: 6px; padding: 8px; }
  .ap-son img { height: 70%; }
  .ap-son audio { width: 100%; }
  .note { font-size: 34px; color: #73B01E; }
  .corps { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .corps h3 { margin: 0; font-size: 14px; color: #335511; }
  .meta { font-size: 11px; color: #5A7D33; }
  .corps p { margin: 2px 0; font-size: 12px; }
  .usage { color: #446531; }
  .liens { margin-top: auto; padding-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  .liens a { font-size: 11px; text-decoration: none; border-radius: 10px; padding: 4px 9px; word-break: break-all; }
  .dl { background: #94DB39; color: #2C4A0F; font-weight: bold; }
  .var { background: #E8F8D3; color: #335511; border: 1px solid #ADE76B; }
  .liens small { color: #5A7D33; font-weight: normal; }
  details.groupe { margin: 10px 0; background: #F4FBEA; border: 2px solid #ADE76B; border-radius: 12px; }
  details.groupe > summary { cursor: pointer; padding: 10px 12px; font-weight: bold; color: #335511; list-style: none; }
  details.groupe > summary::before { content: '▸ '; color: #73B01E; }
  details.groupe[open] > summary::before { content: '▾ '; }
  details.groupe > .grille { padding: 0 10px 12px; }
  .cache { display: none !important; }
  footer { text-align: center; font-size: 11px; color: #5A7D33; padding: 20px 16px 30px; }
  @media (max-width: 520px) {
    .grille { grid-template-columns: 1fr; }
    /* Sur téléphone, la recherche passe sur sa propre ligne, au-dessus des sections. */
    nav { flex-wrap: wrap; }
    nav input { order: -1; flex-basis: 100%; }
    header h1 { font-size: 17px; }
  }
</style></head>
<body>
<header><h1>Kit bande-annonce Frutiparc</h1>
<p>${pluriel(sections.length, 'section')} · ${pluriel(nb, 'fichier')} · ${poids(total)} — page générée le ${esc(date)}. Survole (ou touche) une vidéo pour la lancer ; « Télécharger » pour récupérer le fichier.</p></header>
<nav>${nav}<input type="search" id="q" placeholder="Chercher (bouille, bureau, logo…)" aria-label="Chercher dans le kit"></nav>
<main>${corps}</main>
<footer>Personnages et comptes fictifs — aucune donnée de joueur réel. Les chemins sont relatifs : ce dossier s’ouvre tel quel, hors ligne.</footer>
<script>
(function () {
  // Les vidéos : lecture au survol (souris), au toucher (téléphone).
  function lire(v, oui) {
    var ap = v.parentNode;
    if (oui) { var p = v.play(); if (p && p.catch) p.catch(function () {}); ap.classList.add('lit'); }
    else { v.pause(); ap.classList.remove('lit'); }
  }
  var tactile = window.matchMedia && window.matchMedia('(hover: none)').matches;
  Array.prototype.forEach.call(document.querySelectorAll('.ap video'), function (v) {
    if (!tactile) {
      v.addEventListener('mouseenter', function () { lire(v, true); });
      v.addEventListener('mouseleave', function () { lire(v, false); });
    }
    v.addEventListener('click', function () { lire(v, v.paused); });
  });
  // Une vidéo qui sort de l'écran s'arrête (le téléphone garde sa batterie).
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (!e.isIntersecting && !e.target.paused) lire(e.target, false); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ap video'), function (v) { io.observe(v); });
  }
  // La recherche : filtre les cartes, déplie les groupes qui ont une réponse.
  var q = document.getElementById('q');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('.carte'), function (c) {
      c.classList.toggle('cache', !!t && c.getAttribute('data-q').indexOf(t) < 0);
    });
    Array.prototype.forEach.call(document.querySelectorAll('details.groupe'), function (d) {
      var reste = d.querySelectorAll('.carte:not(.cache)').length;
      d.classList.toggle('cache', !!t && !reste);
      if (t) d.open = reste > 0;
    });
  });
})();
</script>
</body></html>
`;
}

function main() {
  const sections = lireSections();
  const html = page(sections);
  fs.writeFileSync(path.join(KIT, 'index.html'), html);
  console.log('index écrit :', path.join(KIT, 'index.html'), '—', sections.map((s) => s.dossier + ' (' + s.elements.length + ')').join(', '));
}

if (require.main === module) main();
module.exports = { lireSections, page };
