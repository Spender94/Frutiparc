/*
 * Burning Kiwi — l'amorçage de la page.
 *
 * demarrerBurningKiwi() charge la bibliothèque du SWF (data/bkiwi.json, ses
 * images et ses fontes), précharge les neuf sons embarqués, pose la scène à
 * 40 images par seconde et lui donne pour racine le clip 0 du fichier
 * lui-même : la racine saute à « main » (image 5), qui pose le clip `main`
 * (sprite 637) et `limited`. C'est la première image de `main` qui installe
 * le code et appelle init(), et sa boucle de deux images qui fait main() une
 * fois par image (scripts-images.js) : le jeu tourne exactement comme dans
 * le fichier — même horloge, même timer de secours (gtmod), mêmes
 * profondeurs.
 *
 * Les musiques (bk00..05.mp3, bkMenu.mp3) ne sont pas ici : le jeu les
 * demande au fil du menu et des courses (initMusicLoader → startPreload),
 * là où le disque Flash les prenait (/swf/games/burningKiwi/), et les
 * circuits et l'intro sont des bibliothèques à part (data/track0N.json,
 * data/intro.json) qui prennent la place d'un clip vide, comme loadClip.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

// Les sons embarqués dans burningkiwi.swf (DefineSound), par leur nom d'auteur.
const SONS = ['buttonCancel', 'buttonOk', 'buttonSwitch', 'kiwiPickUp', 'loseLifeSound',
  'buttonRefuse', 'buttonKeys', 'buttonKeysOk', 'gameOverSound'];
J.SONS = SONS;

racine.demarrerBurningKiwi = function (options) {
  const canvas = typeof options.canvas === 'string' ? document.getElementById(options.canvas) : options.canvas;
  K.base = '/bkiwi/';
  // Les adresses de sons sont absolues (les musiques viennent d'ailleurs que
  // les sons du jeu) : pas de préfixe commun.
  K.audio.base = '';
  K.fichierSon = (nom) => '/bkiwi/sons/' + nom + '.mp3';
  return K.chargerBiblio('bkiwi').then((biblio) => {
    Promise.all(SONS.map((n) => K.audio.charger(n, K.fichierSon(n)))).catch(() => {});
    const scene = new K.Scene(canvas, biblio, { cadence: 40 });
    const client = new J.Client(options.sid || '');
    J.client = client;
    // La racine : le clip 0 du SWF. Son image 1 saute à « main », qui pose
    // le clip principal — dont le script d'image 1 installe le jeu.
    const racineSwf = K.instancier(biblio, 0);
    scene.racine = racineSwf;
    K.finaliser(racineSwf, null);
    scene.demarrer();
    return { scene, client, jeu: J };
  });
};

})(typeof window !== 'undefined' ? window : globalThis);
