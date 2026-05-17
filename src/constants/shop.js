// Shop catalog and accessory/wallpaper definitions.
//
// Each product becomes an entry in the user's `customAccessories` once
// purchased and shows up in the Inventaire/Accessoires folder.
// suffix9 = last 9 chars of a 24-char bouille string (the first 15 are
// taken from the user's current bouille at serve time).
const { escapeXml } = require('../util/xml');

const DEFAULT_WALLPAPERS = [
  { u: 'moutarde',       n: 'Chevalier moutarde',    url: 'wal/ch.jpg', color: '4E5464;' },
  { u: 'chorale',        n: 'Chorale Frutiparc',     url: 'wal/fp.jpg', color: 'ADE76B;' },
  { u: 'pixizchristmas', n: 'Noël Pixiz',            url: 'wal/ma.jpg', color: 'ADE76B;' },
  { u: 'snakechristmas', n: 'Noël Frutisnake',       url: 'wal/no.jpg', color: 'ADE76B;' },
  { u: 'pixiz',          n: 'Mini-Pixiz',            url: 'wal/pi.jpg', color: 'F9D190;' },
  { u: 'nostromo',       n: 'Mini-Wave Nostromo',    url: 'wal/pl.jpg', color: '000044;' },
  { u: 'ministar',       n: 'Mini-Wave Mini-Star',   url: 'wal/va.jpg', color: '000044;' },
  { u: 'utopiz',         n: 'Utopiz',                url: 'wal/ut.jpg', color: 'F6AFA9;' },
];
const WALLPAPER_BY_ID = Object.fromEntries(DEFAULT_WALLPAPERS.map((w) => [w.u, w]));

// Bouille presets offered in the avatar editor's left list.
const DEFAULT_BOUILLE_LIST = [
  { b: '000503000000111010000000', n: 'Classique' },
  { b: '000503000000111011000000', n: 'Classique 2' },
  { b: '000503000000111012000000', n: 'Classique 3' },
  { b: '010503000000111010000000', n: 'Famille 1' },
];

// Accessories = last 9 chars of a 24-char bouille string. The first 15
// chars are filled from the user's current bouille at serve time.
const DEFAULT_ACCESSORIES = [
  { u: 'bananocle', n: 'Bananocle', suffix: '6010k0w0g' },
  { u: 'beaute',    n: 'Beauté',    suffix: 'b000k0w0g' },
  { u: 'normal',    n: 'Normal',    suffix: '000000000' },
  { u: 'Kiwix',     n: 'Kiwix',     suffix: '30x000000' },
];

const SHOP_PACKS_DEFAULT = [
  {
    id: 101,
    name: 'Bonnet de nuit',
    category: 'Accessoires',
    price: 60,
    description: 'Un bonnet douillet pour les Frutiz qui aiment rêvasser sur le chat. Parfait pour afficher une ambiance cosy !',
    suffix9: '9020t0a00',
    comment: 'Un bonnet douillet pour les Frutiz qui aiment rêvasser sur le chat. Parfait pour afficher une ambiance cosy !',
  },
  {
    id: 102,
    name: 'Chapeau de shérif',
    category: 'Accessoires',
    price: 60,
    description: 'Pour faire régner la loi dans les contrées de Legumia. Un classique indémodable de la panoplie du justicier.',
    suffix9: '4020B0000',
    comment: 'Pour faire régner la loi dans les contrées de Legumia. Un classique indémodable de la panoplie du justicier.',
  },
  {
    id: 103,
    name: 'Masque de ski',
    category: 'Accessoires',
    price: 60,
    description: 'Prêt à dévaler les pistes ! Ce masque coloré complètera votre tenue hivernale à merveille.',
    suffix9: 'a0b0a080m',
    comment: 'Prêt à dévaler les pistes ! Ce masque coloré complètera votre tenue hivernale à merveille.',
  },
  // Casquette Anim (suffix9 30y0t0j00) is no longer purchasable — it is now
  // auto-granted to users with is_animator=true via grantAnimatorAccessory
  // (mirroring the Badge Modérateur flow). See ANIM_ACCESSORY_* constants.
  // Wallpapers
  { id: 201, name: 'Chevalier moutarde',    category: "Fonds d'écran", price: 0, description: 'Un fond chevaleresque aux tons moutarde.',     suffix9: '000000000', wallpaperId: 'moutarde' },
  { id: 202, name: 'Chorale Frutiparc',     category: "Fonds d'écran", price: 0, description: 'La grande chorale de Frutiparc !',             suffix9: '000000000', wallpaperId: 'chorale' },
  { id: 203, name: 'Noël Pixiz',            category: "Fonds d'écran", price: 0, description: 'Ambiance de Noël avec les Pixiz.',              suffix9: '000000000', wallpaperId: 'pixizchristmas' },
  { id: 204, name: 'Noël Frutisnake',       category: "Fonds d'écran", price: 0, description: 'Frutisnake en mode fêtes de fin d\'année.',     suffix9: '000000000', wallpaperId: 'snakechristmas' },
  { id: 205, name: 'Mini-Pixiz',            category: "Fonds d'écran", price: 0, description: 'Les petits Pixiz en action.',                   suffix9: '000000000', wallpaperId: 'pixiz' },
  { id: 206, name: 'Mini-Wave Nostromo',    category: "Fonds d'écran", price: 0, description: 'Le vaisseau Nostromo de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'nostromo' },
  { id: 207, name: 'Mini-Wave Mini-Star',   category: "Fonds d'écran", price: 0, description: 'La planète Mini-Star de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'ministar' },
  { id: 208, name: 'Utopiz',                category: "Fonds d'écran", price: 0, description: 'Le monde coloré d\'Utopiz.',                    suffix9: '000000000', wallpaperId: 'utopiz' },
];

// Live shop catalog. Module-level alias kept so admin /api/admin/shop CRUD
// can swap entries via splice/push without re-importing.
const SHOP_PACKS = [...SHOP_PACKS_DEFAULT];

// Moderator-only accessory automatically granted with the role and revoked
// when the role is taken away. Not purchasable (shopId stays 0) so it never
// appears in the shop tree.
const MOD_ACCESSORY_ID = 'mod_badge';
const MOD_ACCESSORY_SUFFIX9 = '30i0e0j03';
const MOD_ACCESSORY_NAME = 'Badge Modérateur';

const ANIM_ACCESSORY_ID = 'anim_cap';
const ANIM_ACCESSORY_SUFFIX9 = '30y0t0j00';   // Casquette Anim suffix
const ANIM_ACCESSORY_NAME = 'Casquette Anim';

// ── Pure lookups ──
function getShopPack(id) {
  const num = Number(id);
  return SHOP_PACKS.find((p) => p.id === num);
}

function userOwnsShopPack(user, id) {
  if (!Array.isArray(user && user.customAccessories)) return false;
  return user.customAccessories.some((a) => a && a.shopId === Number(id));
}

// Returns the wallpaper definition tied to an accessory entry, or null.
// Recognises both the canonical "wp:url:color" value format and legacy
// entries where only the shopId is reliable (older purchases stored as
// regular bouille values before the wallpaper format was introduced).
function getAccessoryWallpaper(acc) {
  if (!acc) return null;
  const v = acc.v || '';
  if (typeof v === 'string' && v.startsWith('wp:')) {
    const parts = v.split(':');
    return { url: parts[1] || '', color: parts.slice(2).join(':') || '' };
  }
  if (acc.shopId) {
    const pack = SHOP_PACKS.find((p) => p.id === Number(acc.shopId));
    if (pack && pack.wallpaperId) {
      const wp = WALLPAPER_BY_ID[pack.wallpaperId];
      if (wp) return { url: wp.url, color: wp.color };
    }
  }
  return null;
}

function buildShopTreeXml() {
  const byCategory = new Map();
  for (const pack of SHOP_PACKS) {
    if (!byCategory.has(pack.category)) byCategory.set(pack.category, []);
    byCategory.get(pack.category).push(pack);
  }
  const defaultId = SHOP_PACKS.length ? SHOP_PACKS[0].id : '';
  let inner = '';
  for (const [cat, packs] of byCategory) {
    const prods = packs.map((p) => `<p i="${p.id}" n="${escapeXml(p.name)}"/>`).join('');
    inner += `<c n="${escapeXml(cat)}">${prods}</c>`;
  }
  return `<c n="Boutique" d="${defaultId}">${inner}</c>`;
}

module.exports = {
  DEFAULT_WALLPAPERS,
  WALLPAPER_BY_ID,
  DEFAULT_BOUILLE_LIST,
  DEFAULT_ACCESSORIES,
  SHOP_PACKS_DEFAULT,
  SHOP_PACKS,
  MOD_ACCESSORY_ID,
  MOD_ACCESSORY_SUFFIX9,
  MOD_ACCESSORY_NAME,
  ANIM_ACCESSORY_ID,
  ANIM_ACCESSORY_SUFFIX9,
  ANIM_ACCESSORY_NAME,
  getShopPack,
  userOwnsShopPack,
  getAccessoryWallpaper,
  buildShopTreeXml,
};
