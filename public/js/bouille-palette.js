/*
  FPBouille — palette de couleurs et noms d'accessoires des bouilles Frutiparc.

  Une bouille = 24 caractères base62. Chaque emplacement « couleur » (peau,
  cheveux, couleurs d'accessoire…) stocke un INDEX 0-52 (1 caractère, poids
  faible de la paire) qui renvoie à une couleur de COLORS ci-dessous. Chaque
  emplacement « type d'accessoire » stocke un index 0-16 → ACCESSORIES.

  Vérifié empiriquement : sur un visage réel, l'index N en pos 11 (peau) /
  pos 13 (cheveux) rend bien la couleur COLORS[N] de la table.

  Partagé par l'éditeur d'accessoires de l'admin, l'éditeur « Ma Frutibouille »
  de /light, et — côté serveur, via require() — la vitrine hebdomadaire qui
  puise ses accessoires dans le Bouilloscope (voir vitrineBanque, server.js).
*/
(function (global) {
  "use strict";

  // index → { name, hex }  (table fournie par l'admin du jeu)
  var COLORS = [
    { name: "Beige 1", hex: "#FFE7CE" }, { name: "Beige 2", hex: "#FCDCD8" }, { name: "Beige 3", hex: "#FBC8BE" },
    { name: "Skin dark 1", hex: "#FAB4A4" }, { name: "Skin dark 2", hex: "#E69B50" }, { name: "Skin dark 3", hex: "#D77D3C" }, { name: "Skin dark 4", hex: "#C86428" },
    { name: "Skin black 1", hex: "#A0642D" }, { name: "Skin black 2", hex: "#8A5725" }, { name: "Skin black 3", hex: "#6C441E" }, { name: "Skin black 4", hex: "#4B3014" },
    { name: "Skin yellow 1", hex: "#E6D796" }, { name: "Skin yellow 2", hex: "#DCC873" }, { name: "Skin yellow 3", hex: "#D2B950" },
    { name: "Frutigreen 1", hex: "#B4E67D" }, { name: "Frutigreen 2", hex: "#96D737" }, { name: "Frutigreen 3", hex: "#82C820" }, { name: "Frutigreen 4", hex: "#78B919" }, { name: "Frutigreen 5", hex: "#6EAA14" },
    { name: "Red 1", hex: "#E67D7D" }, { name: "Red 2", hex: "#DC5555" }, { name: "Red 3", hex: "#D23737" }, { name: "Red 4", hex: "#BE1E1E" },
    { name: "Blue 1", hex: "#6EA0E1" }, { name: "Blue 2", hex: "#5082D2" }, { name: "Blue 3", hex: "#3269AF" },
    { name: "Mauve 1", hex: "#9664C8" }, { name: "Mauve 2", hex: "#793DB6" }, { name: "Mauve 3", hex: "#5F3796" },
    { name: "Mega jaune 1", hex: "#FAE13C" }, { name: "Mega jaune 2", hex: "#E6C80A" }, { name: "Mega jaune 3", hex: "#D7B709" },
    { name: "Orange 1", hex: "#FAA032" }, { name: "Orange 2", hex: "#E6780A" }, { name: "Orange 3", hex: "#C86409" },
    { name: "Rose 1", hex: "#FFC8D9" }, { name: "Rose 2", hex: "#FEABC5" }, { name: "Rose 3", hex: "#FD8CB7" },
    { name: "Gris bleu 1", hex: "#ADB7C5" }, { name: "Gris bleu 2", hex: "#96A0B4" }, { name: "Gris bleu 3", hex: "#6E7D96" },
    { name: "Gris bronze 1", hex: "#CDC8AC" }, { name: "Gris bronze 2", hex: "#B9B18E" }, { name: "Gris bronze 3", hex: "#A29868" },
    { name: "Gris vert 1", hex: "#A9CAA8" }, { name: "Gris vert 2", hex: "#8FB98E" }, { name: "Gris vert 3", hex: "#71A770" },
    { name: "Gris azur 1", hex: "#93B3D2" }, { name: "Gris azur 2", hex: "#759EC6" }, { name: "Gris azur 3", hex: "#608EBD" },
    { name: "Turquoise 1", hex: "#37BEB4" }, { name: "Turquoise 2", hex: "#329B9B" },
    { name: "Blanc", hex: "#FFF5F5" }
  ];

  // index → nom du type d'accessoire (0-16)
  var ACCESSORIES = [
    "Rien", "Chapeau Chinois", "Bonnet type 1", "Casquette", "Chapeau cowboy", "Bonnet type 2",
    "Bananocle", "Bandeau", "Grand chapeau", "Bonnet de nuit", "Lunettes", "Coquille",
    "Banane", "Bois de cerf", "Nez", "Bonnet type 3", "Carapace"
  ];

  // ── Baptiser un accessoire ─────────────────────────────────────────────────
  //
  // Un accessoire pioché dans le Bouilloscope arrive sans nom : neuf caractères
  // et rien d'autre. On lui en fabrique un — mais à la manière de la maison.
  //
  // Les accessoires d'époque ne se décrivent pas, ils se surnomment : un seul
  // mot, souvent un mot-valise, qui suggère la couleur plus qu'il ne nomme
  // l'objet. « Bananocle », c'est banane + monocle. « Kiwix », c'est kiwi + ix.
  // « Casquette citron » aurait été une étiquette de catalogue, pas un nom.
  //
  // D'où deux tables et une règle de collage :
  //   · RACINE — un mot court par couleur de la palette. Fruits, matières,
  //     bestiaire du parc : c'est elle qui porte la teinte.
  //   · FINALE — une terminaison par type d'accessoire. Huit d'entre elles
  //     rappellent l'objet au passage (-ocle le monocle, -ette les lunettes,
  //     -orne les bois de cerf, -if le pif, -ace la carapace, -ane la banane,
  //     -eau le bandeau, -ille la coquille) ; les autres sont là pour la
  //     musique. C'est ce qui distingue deux accessoires de même couleur.
  //
  // La casquette porte « -ix » : Kiwi + ix rend « Kiwix », le nom d'origine.
  //
  // Aucune racine ne se termine par « l » : la finale « -ille » y produirait
  // des « Pailille » imprononçables.
  var COLOR_ROOTS = [
    "Crèm", "Ivor", "Pêch",                     // beiges
    "Saum", "Cara", "Cuiv", "Brik",             // peaux mates
    "Muscad", "Noiz", "Moka", "Choco",          // peaux foncées
    "Blond", "Nectar", "Doré",                  // peaux dorées
    "Pista", "Pom", "Kiwi", "Avoca", "Sapin",   // verts Frutiparc
    "Ceriz", "Tomat", "Grena", "Rubis",         // rouges
    "Bleut", "Azur", "Marin",                   // bleus
    "Lilas", "Prun", "Bergin",                  // mauves
    "Citron", "Curcum", "Moutar",               // jaunes
    "Mango", "Mandar", "Abrico",                // oranges
    "Dragé", "Bonbon", "Fuchsi",                // roses
    "Brum", "Ardoiz", "Orag",                   // gris bleutés
    "Écru", "Chanv", "Jonc",                    // gris bronze
    "Saug", "Laur", "Fougèr",                   // gris verts
    "Givr", "Ondin", "Denim",                   // gris azur
    "Turkiz", "Lagon",                          // turquoises
    "Neig"                                      // blanc
  ];

  // Indexées par type d'accessoire (0 = « Rien », jamais baptisé).
  var NAME_ENDINGS = [
    "",                 // 0  Rien
    "az",               // 1  Chapeau chinois
    "in",               // 2  Bonnet type 1
    "ix",               // 3  Casquette          → Kiwi + ix = Kiwix
    "y",                // 4  Chapeau cowboy
    "ouf",              // 5  Bonnet type 2
    "ocle",             // 6  Bananocle          → banane + monocle
    "eau",              // 7  Bandeau
    "us",               // 8  Grand chapeau
    "oz",               // 9  Bonnet de nuit
    "ette",             // 10 Lunettes
    "ille",             // 11 Coquille
    "ane",              // 12 Banane
    "orne",             // 13 Bois de cerf
    "if",               // 14 Nez                → le pif
    "ade",              // 15 Bonnet type 3
    "ace"               // 16 Carapace
  ];

  var VOYELLES = "aeiouyàâäéèêëîïôöûüÿ";
  // Racine + finale. Deux voyelles qui se rencontrent, la racine cède la
  // sienne : Kiwi + ix → Kiwix, Choco + ocle → Chococle. Sans quoi on
  // écrirait « Kiwiix ».
  function coller(racine, finale) {
    if (!finale) return racine;
    var fin = racine.charAt(racine.length - 1).toLowerCase();
    var debut = finale.charAt(0).toLowerCase();
    if (VOYELLES.indexOf(fin) >= 0 && VOYELLES.indexOf(debut) >= 0) {
      racine = racine.substring(0, racine.length - 1);
    }
    return racine + finale;
  }

  var B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function enc(n) { n = ((n % 62) + 62) % 62; return B62.charAt(n); }
  function dec(c) { var i = B62.indexOf(c); return i < 0 ? 0 : i; }

  // Les cinq emplacements d'un suffix9 (positions 15→23 de la bouille). La
  // valeur est portée par le PREMIER caractère de chaque paire ; le second
  // reste un '0' séparateur — c'est ainsi que sont encodés les vrais
  // accessoires ('9020t0a00' = type 9, variante 2, couleurs t et a).
  function accessoryParts(suffix9) {
    var s = String(suffix9 || "").padEnd ? String(suffix9 || "").padEnd(9, "0")
                                        : (String(suffix9 || "") + "000000000");
    s = s.substring(0, 9);
    return { type: dec(s[0]), variante: dec(s[2]), c1: dec(s[4]), c2: dec(s[6]), c3: dec(s[8]) };
  }

  // Le surnom d'un accessoire. Rend "" pour un suffixe sans accessoire
  // (type 0 = « Rien »).
  //
  // `essai` sert quand le nom est déjà pris : 0 tire sur la couleur
  // principale, 1 et 2 sur les couleurs secondaires (même objet, autre
  // teinte : autre mot), au-delà on change de finale. Il y a donc de quoi
  // baptiser sans jamais coller deux fois le même mot en rayon, et toujours
  // en UN SEUL mot.
  //
  // L'emplacement « variante » ne sert pas au nom : ses valeurs sont des codes
  // de modèle (33, 34…) qui ne veulent rien dire pour un joueur.
  function accessoryName(suffix9, essai) {
    var p = accessoryParts(suffix9);
    if (!p.type) return "";
    var n = essai || 0;
    var couleurs = [p.c1, p.c2, p.c3];
    var racine = COLOR_ROOTS[couleurs[n] === undefined ? p.c1 : couleurs[n]];
    var finale = NAME_ENDINGS[p.type];
    if (n >= couleurs.length) {
      // Plus de couleurs à jouer : on change de musique, pas de teinte.
      racine = COLOR_ROOTS[p.c1];
      finale = NAME_ENDINGS[1 + ((p.type - 1 + n) % (NAME_ENDINGS.length - 1))];
    }
    if (!racine) racine = COLOR_ROOTS[0];
    return coller(racine, finale || "o");
  }

  // Texte noir ou blanc lisible sur un fond donné (luminance).
  function readableText(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length !== 6) return "#000";
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#000" : "#fff";
  }

  var FPBouille = {
    COLORS: COLORS,
    ACCESSORIES: ACCESSORIES,
    COLOR_ROOTS: COLOR_ROOTS,
    NAME_ENDINGS: NAME_ENDINGS,
    enc: enc,
    dec: dec,
    readableText: readableText,
    accessoryParts: accessoryParts,
    accessoryName: accessoryName,
    colorHex: function (i) { return (COLORS[i] && COLORS[i].hex) || "#000"; },
    colorName: function (i) { return (COLORS[i] && COLORS[i].name) || ("#" + i); },
    accName: function (i) { return ACCESSORIES[i] || ("Type " + i); }
  };

  global.FPBouille = FPBouille;
  // Même table côté serveur (vitrine hebdomadaire) : une seule source.
  if (typeof module !== "undefined" && module.exports) module.exports = FPBouille;
})(typeof globalThis !== "undefined" ? globalThis : this);
