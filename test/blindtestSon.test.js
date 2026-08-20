/*
 * Le blindtest : pourquoi on n'entendait rien ailleurs que sur Firefox.
 *
 * L'extrait était fabriqué AU CLIC : on posait alors une iframe YouTube avec le
 * son. Cela paraît juste — le geste est là — mais un navigateur n'accorde le
 * droit au son qu'au CADRE où le geste a eu lieu. Un clic dans la page ne
 * déverrouille pas une iframe d'un autre domaine. Chrome, Edge et Safari
 * refusaient donc de faire parler le lecteur, et les téléphones avec eux ; seul
 * Firefox marchait, parce qu'il regarde, lui, l'activation de la page du dessus.
 * D'où le rapport reçu : « ça marche bien sur Firefox, moins bien ailleurs, et
 * sur mobile on voit la bannière mais on n'entend rien ».
 *
 * La lecture MUETTE, elle, démarre partout. On lance donc le lecteur dès
 * l'arrivée de l'extrait, en silence et à la bonne seconde, et le clic n'a plus
 * qu'à demander le son à un lecteur DÉJÀ en train de jouer — par postMessage,
 * puisque enablejsapi ouvre ce dialogue. C'est ce détour qui débloque l'iPhone :
 * WebKit fait voyager le geste avec le message.
 *
 * Trois règles en découlent, et ce sont elles qu'on tient ici :
 *
 *   1. Le serveur sert un lecteur muet, pilotable, et qui sait à qui il parle
 *      (mute=1, enablejsapi=1, origin) — vérifié dans animateurs.test.js, où un
 *      vrai extrait est en cours.
 *   2. Les deux clients posent le lecteur À L'ARRIVÉE de l'extrait, pas au clic.
 *   3. Le bouton dit ce que le LECTEUR répond, pas ce que nous espérions ; et
 *      s'il ne répond jamais, alors seulement on retombe sur l'ancienne
 *      méthode — recharger l'iframe avec le son, celle que Firefox honore.
 *
 * Le déroulé complet (vrai serveur, vrai navigateur, faux lecteur YouTube qui
 * parle le protocole du widget) a été joué à la main : lecteur bavard →
 * « Couper » ; lecteur qui refuse de se démuter → le bouton reste « Écouter » ;
 * lecteur muré → rechargement avec le son, à la seconde où en est l'extrait.
 * Il n'est pas rejouable ici : il demande un navigateur et un accès à YouTube.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SERVEUR = lire('server.js');
const LIGHT = lire('public/light.html');
const BUREAU = lire('public/ruffle.html');

// Le bloc blindtest de chaque client, pour ne pas confondre avec le reste.
function bloc(source, depart, fin) {
  const a = source.indexOf(depart);
  assert.ok(a > 0, 'repère introuvable : ' + depart);
  const b = source.indexOf(fin, a);
  assert.ok(b > a, 'fin de bloc introuvable : ' + fin);
  return source.slice(a, b);
}
const BLOC_LIGHT = bloc(LIGHT, '// ── Blindtest ──', '// Ligne système suivie');
const BLOC_BUREAU = bloc(BUREAU, 'var etat = {', '(function () {\n            var badge');

test('le serveur sert un lecteur muet, pilotable, et qui sait à qui il parle', () => {
  const embed = bloc(SERVEUR, "app.get('/api/blindtest/embed'", 'res.redirect(302');
  assert.match(embed, /mute: String\(req\.query\.m\) === '0' \? '0' : '1'/,
    'muet par défaut, et ?m=0 comme seule porte de sortie');
  assert.match(embed, /enablejsapi: '1'/, 'le dialogue avec le lecteur est ouvert');
  assert.match(embed, /origin: buildPublicBase\(req\)/,
    'et YouTube sait de quelle page viennent les ordres — sans quoi il n\'écoute pas');
  // playsinline reste indispensable : sans lui l'iPhone passe en plein écran,
  // ce qui montrerait la vidéo... c'est-à-dire la réponse.
  assert.match(embed, /playsinline: '1'/, 'et l\'iPhone ne bascule pas en plein écran');
});

// ── 2. Le lecteur part à l'ARRIVÉE de l'extrait, pas au clic ──────────────

test('les deux clients lancent le lecteur dès l\'arrivée de l\'extrait', () => {
  // Mobile : jouerBlindtest pose la bannière PUIS le cadre, sans condition.
  const jouer = bloc(LIGHT, 'function jouerBlindtest(', '\n  }\n');
  assert.match(jouer, /blindtestBoite\(\);\s*(?:\/\/[^\n]*\n\s*)*lancerCadre\(false\);/,
    'le mobile pose le lecteur muet sans attendre le moindre clic');
  assert.ok(!/if \(blindtest\.arme\) lancerCadre/.test(LIGHT),
    'et plus jamais « seulement si le joueur avait dit oui »');

  // Bureau : même chose, au retour de /api/blindtest/state.
  assert.match(BLOC_BUREAU, /poser\(\);\s*(?:\/\/[^\n]*\n\s*)*cadre\(false\);/,
    'le bureau aussi');
  assert.ok(!/if \(etat\.arme\) cadre\(\)/.test(BUREAU), 'et lui non plus n\'attend plus');

  // Les deux iframes délèguent la permission de jouer : sans allow="autoplay",
  // Chrome ne laisse pas un cadre d'un autre domaine démarrer quoi que ce soit.
  for (const [nom, b] of [['mobile', BLOC_LIGHT], ['bureau', BLOC_BUREAU]]) {
    assert.match(b, /<iframe title="extrait" allow="autoplay"/,
      nom + ' : la permission de jouer est déléguée au cadre');
  }
});

// ── 3. Le bouton dit ce que le LECTEUR répond ─────────────────────────────

test('le bouton suit la parole du lecteur, jamais notre intention', () => {
  // Mobile.
  assert.match(BLOC_LIGHT,
    /function btSonne\(\) \{ return blindtest\.repond \? !blindtest\.muet : blindtest\.arme; \}/,
    'tant que le lecteur parle, c\'est lui qui décide de l\'étiquette');
  assert.match(BLOC_LIGHT, /bouton\.textContent = btSonne\(\) \? "Couper" : "Écouter"/,
    'et l\'étiquette en découle');
  // Bureau.
  assert.match(BLOC_BUREAU,
    /function sonne\(\) \{ return etat\.repond \? !etat\.muet : etat\.arme; \}/,
    'même règle au bureau');
  assert.match(BLOC_BUREAU, /bo\.textContent = sonne\(\) \? "Couper" : "Écouter"/);

  // Ce qu'on écoute, et de qui. Le filtre d'origine n'est pas une formalité :
  // n'importe quelle page ouverte peut poster un message.
  for (const [nom, b] of [['mobile', BLOC_LIGHT], ['bureau', BLOC_BUREAU]]) {
    assert.match(b, /if \(ev\.origin !== "https:\/\/www\.youtube\.com"\) return;/,
      nom + ' : seul YouTube est écouté');
    assert.match(b, /\.muted !== undefined\) \{ (?:blindtest|etat)\.repond = true;/,
      nom + ' : la première réponse fait foi à partir de là');
  }
});

test('le clic demande le son au lecteur déjà lancé — muet, volume, lecture', () => {
  for (const [nom, b, cmd] of [['mobile', BLOC_LIGHT, 'btCommande'], ['bureau', BLOC_BUREAU, 'commande']]) {
    const plat = b.replace(/\s+/g, ' ');
    assert.match(plat, new RegExp(cmd + '\\("unMute"\\); ?' + cmd
      + '\\("setVolume", \\[100\\]\\); ?' + cmd + '\\("playVideo"\\);'),
    nom + ' : les trois demandes partent ensemble');
    // Elles doivent partir DU CLIC : c'est là qu'est le geste.
    assert.match(b, /addEventListener\("click", function \(\) \{[\s\S]{0,600}?(?:btDemanderSon|demanderSon)\(\);/,
      nom + ' : la demande de son est dans le gestionnaire de clic');
    // Et le lecteur qu'on relance quand le navigateur l'a mis en pause en le
    // démuetant — sans quoi le bouton dirait « Couper » sur un silence.
    assert.match(b, /=== 2\) (?:btCommande|commande)\("playVideo"\)/,
      nom + ' : un lecteur mis en pause à l\'ouverture du son est relancé');
  }
});

// ── 4. Le dernier recours, et lui seul ────────────────────────────────────

test('le rechargement avec le son ne sert QUE si le lecteur n\'a jamais répondu', () => {
  for (const [nom, b, appel] of [
    ['mobile', BLOC_LIGHT, 'lancerCadre(true)'], ['bureau', BLOC_BUREAU, 'cadre(true)']]) {
    const plat = b.replace(/\s+/g, ' ');
    // La condition entière : extrait en cours, son voulu, et lecteur MUET DE
    // NAISSANCE. S'il a répondu, on le croit — recharger ne ferait que casser
    // la lecture muette, qui elle était au moins synchrone.
    assert.match(plat, new RegExp(
      'if \\(![a-z]+\\.jeton \\|\\| ![a-z]+\\.arme \\|\\| [a-z]+\\.repond\\) return; '
        + appel.replace(/[()]/g, '\\$&')),
    nom + ' : le recours est réservé au lecteur muré');
    // Et il recharge AVEC le son : c'est tout son intérêt.
    assert.match(plat, /\(avecSon \? "&m=0" : ""\)/,
      nom + ' : le recours redemande un lecteur sonore');
  }
});

test('la poignée de main est répétée : le lecteur ne s\'abonne qu\'une fois prêt', () => {
  // Le `load` de l'iframe précède de loin l'instant où le lecteur accepte des
  // ordres. Un seul « listening » se perdrait ; la bibliothèque officielle
  // insiste, nous aussi.
  for (const [nom, b, ecoute] of [
    ['mobile', BLOC_LIGHT, 'btEcouterLecteur'], ['bureau', BLOC_BUREAU, 'ecouterLecteur']]) {
    const plat = b.replace(/\s+/g, ' ');
    assert.match(plat, new RegExp('setInterval\\(function \\(\\) \\{ if \\([a-z]+\\.repond \\|\\| reste-- <= 0\\)'),
      nom + ' : on redemande jusqu\'à réponse (ou épuisement)');
    assert.match(plat, new RegExp(ecoute + '\\(\\); \\}, 300\\);'),
      nom + ' : toutes les 300 ms');
  }
});

test('un extrait qui s\'arrête efface tout : minuteurs, cadre, et parole du lecteur', () => {
  // Sans quoi le `repond` d'un extrait fuiterait sur le suivant et le bouton
  // partirait sur une vérité périmée.
  const arret = bloc(LIGHT, 'function arreterBlindtest(', '\n  }\n');
  assert.match(arret, /blindtest\.muet = true; blindtest\.repond = false; blindtest\.etat = -1;/,
    'le mobile repart d\'une page blanche');
  assert.match(arret, /clearInterval\(blindtest\.poignee\)/, 'et sans minuteur orphelin');
  assert.match(arret, /clearTimeout\(blindtest\.recours\)/);

  const retirer = bloc(BUREAU, 'function retirer()', '\n            function tic');
  assert.match(retirer, /etat\.muet = true; etat\.repond = false; etat\.pEtat = -1;/,
    'le bureau aussi');
  assert.match(retirer, /clearInterval\(etat\.poignee\)/);
  assert.match(retirer, /clearTimeout\(etat\.recours\)/);

  // Et un NOUVEL extrait ne part jamais sur la parole de l'ancien.
  assert.match(BLOC_BUREAU, /etat\.muet = true; etat\.repond = false; etat\.pEtat = -1;\s*\n\s*etat\.fin =/,
    'le bureau oublie l\'extrait précédent en accueillant le suivant');
});
