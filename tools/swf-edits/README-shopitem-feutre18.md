# shopitem.swf — 18ᵉ feutre (multicolore animé)

Édition binaire de `public/swf/shopitem.swf` (AVM1 / SWF v7, zlib « CWS »).
Ajoute un feutre **multicolore animé** en boutique sans recompiler le `.fla`
(le SWF authoring Flash n'est pas dispo ici).

## Comment les feutres sont dessinés

Le porte-picto `feutre,N` n'a **pas 17 images** : il y a **une seule** forme de
stylo (`this.col`, la mèche) que le sprite 12 **teinte au runtime** :

```
FEMC.setColor(this.col, _global.penList[ _parent.infoList[1] ])   // N = infoList[1]
```

`_global.penList` (17 RGB) et la classe `FEMC` viennent de `main.swf`
(`frutiparc/global.as`, `frutiengine/FEMC.as`), partagés via `_global`.

## L'édition

Seul **le sprite 12** est modifié (diff structurel : 255 tags sur 256 identiques
à l'octet près). Sa `DoAction` de frame 1 devient une branche :

- `N < 17` → **comportement d'origine inchangé** (les 17 feutres teintés).
- `N >= 17` (le multicolore, picto `feutre,17`) → pose un `onEnterFrame` qui, à
  chaque image (12 fps), recolore la mèche via
  `new Color(this.col).setRGB(cols[(getTimer()/250 | 0) % 7])`.
  Auto-suffisant (built-in `Color`, aucune dépendance à `FEMC`).

`cols` = les couleurs REPRISES des feutres d'origine (mêmes teintes que le
dégradé du chat, `MC_RAINBOW` côté serveur) :

```
0xFF6600 0xEBB601 0x20D251 0x47B9C9 0x6666CC 0x6E3C8D 0xF986E2
(penList 0,5,6,7,1,16,4 : orange, jaune, vert pomme, bleu ciel, bleu, violet, rose)
```

Côté serveur, le pack du feutre multicolore porte `picto: 'feutre,17'`
(`server.js`, `SHOP_PACKS`), et la définition statique prime sur la valeur
persistée en base.

## Vérification

Rendu vérifié hors-ligne via Ruffle (npm `@ruffle-rs/ruffle`) + Chromium
headless (Playwright), en amorçant `infoList[1]` puis `gotoAndStop("feutre")` :
la mèche du picto `feutre,17` défile bien orange → rose → bleu ciel… au fil du
temps, tandis que les feutres `< 17` restent statiques. Le tinting réel
(`FEMC.setColor`) n'est visible qu'avec `main.swf` chargé (sur le site).

> Note : sur ce graphisme de stylo, seule la **mèche** (`this.col`) est
> colorable ; le corps blanc n'est pas teintable. L'effet multicolore porte
> donc sur la mèche.
