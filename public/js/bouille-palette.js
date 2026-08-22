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
  // et rien d'autre. On lui en fabrique un — « Casquette citron » — à partir de
  // son type et de sa couleur principale.
  //
  // COLOR_WORDS : un NOM de couleur par index de la palette. Des noms, pas des
  // adjectifs : en français un nom employé comme couleur est INVARIABLE (« une
  // casquette citron », « des lunettes turquoise »), ce qui évite tout accord —
  // et l'imagier fruité tombe juste dans ce parc-là. Deux index voisins peuvent
  // partager un mot (la palette a trois verts, trois oranges…) : c'est le
  // baptême qui départage ensuite, pas la couleur seule.
  var COLOR_WORDS = [
    "beige", "ivoire", "pêche",                             // beiges
    "saumon", "caramel", "cuivre", "rouille",               // peaux mates
    "cannelle", "noisette", "cacao", "chocolat",            // peaux foncées
    "paille", "miel", "or",                                 // peaux dorées
    "pistache", "pomme", "kiwi", "avocat", "sapin",         // verts Frutiparc
    "corail", "tomate", "grenade", "rubis",                 // rouges
    "bleuet", "azur", "outremer",                           // bleus
    "lilas", "prune", "aubergine",                          // mauves
    "citron", "safran", "moutarde",                         // jaunes
    "mangue", "mandarine", "abricot",                       // oranges
    "dragée", "bonbon", "fuchsia",                          // roses
    "brume", "ardoise", "orage",                            // gris bleutés
    "lin", "chanvre", "kaki",                               // gris bronze
    "sauge", "laurier", "fougère",                          // gris verts
    "givre", "océan", "denim",                              // gris azur
    "turquoise", "lagon",                                   // turquoises
    "neige"                                                 // blanc
  ];

  // Le nom d'objet, pour la boutique. Repris de ACCESSORIES, débarrassé des
  // « type 1/2/3 » : ce sont trois bonnets différents, mais « Bonnet type 2
  // citron » ne se vend pas. Trois bonnets s'appellent donc « Bonnet » — leur
  // couleur les distingue, et à défaut le baptême ajoute ce qu'il faut.
  var ACCESSORY_LABELS = [
    "", "Chapeau chinois", "Bonnet", "Casquette", "Chapeau de cowboy", "Bonnet",
    "Bananocle", "Bandeau", "Grand chapeau", "Bonnet de nuit", "Lunettes", "Coquille",
    "Banane", "Bois de cerf", "Nez", "Bonnet", "Carapace"
  ];

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

  // « Casquette citron ». Avec `avecSecondeCouleur`, « Casquette citron et
  // pistache » — de quoi départager deux casquettes jaunes. Rend "" pour un
  // suffixe sans accessoire (type 0 = « Rien »).
  //
  // On s'arrête à deux couleurs : au-delà, c'est à l'appelant de numéroter
  // (voir baptiserAccessoire, server.js). L'emplacement « variante » ne sert
  // pas au nom — ses valeurs sont des codes de modèle (33, 34…) qui ne veulent
  // rien dire pour un joueur.
  function accessoryLabel(suffix9, avecSecondeCouleur) {
    var p = accessoryParts(suffix9);
    if (!p.type) return "";
    var nom = ACCESSORY_LABELS[p.type] || ("Accessoire " + p.type);
    var mot = COLOR_WORDS[p.c1];
    var out = mot ? (nom + " " + mot) : nom;
    if (avecSecondeCouleur && COLOR_WORDS[p.c2] && p.c2 !== p.c1) out += " et " + COLOR_WORDS[p.c2];
    return out;
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
    COLOR_WORDS: COLOR_WORDS,
    ACCESSORY_LABELS: ACCESSORY_LABELS,
    enc: enc,
    dec: dec,
    readableText: readableText,
    accessoryParts: accessoryParts,
    accessoryLabel: accessoryLabel,
    colorHex: function (i) { return (COLORS[i] && COLORS[i].hex) || "#000"; },
    colorName: function (i) { return (COLORS[i] && COLORS[i].name) || ("#" + i); },
    accName: function (i) { return ACCESSORIES[i] || ("Type " + i); }
  };

  global.FPBouille = FPBouille;
  // Même table côté serveur (vitrine hebdomadaire) : une seule source.
  if (typeof module !== "undefined" && module.exports) module.exports = FPBouille;
})(typeof globalThis !== "undefined" ? globalThis : this);
