// Forum structure and access constants.
//
// Updating FORUM_DEFAULT_STRUCTURE automatically backfills any missing
// rubrique on the next startup via ensureForumBoardsExist().

// Categories visible only to staff (moderators + animators). Their topics
// are hidden from regular users in /api/forum/index.
const STAFF_ONLY_FORUM_CATEGORIES = new Set(['Gestion du site']);

const FORUM_DEFAULT_STRUCTURE = [
  { name: 'Gestion du site', boards: [
    { name: 'Animateur', description: "De l'animation, ses principes généraux, ses dernières nouveautées, ..." },
    { name: 'Modération-Animation', description: 'Ho ! Ca rime !' },
  ]},
  { name: 'Frutiparc', boards: [
    { name: 'Annonces', description: "Les annonces officielles de l'équipe Frutiparc" },
    { name: 'Animations officielles', description: 'Les annonces des prochaines animations organisées par des animateurs à venir' },
    { name: 'Animations Frutiz', description: 'Les annonces des prochaines animations organisées par des frutiz à venir' },
    { name: 'Jeux Frutiparc', description: 'Les jeux de Frutiparc, parlez-en !' },
    { name: 'Frutiz', description: 'Pour parler de la vie des Frutiz, population de frutiparc !' },
    { name: 'Clans', description: 'Tous les clans Frutiparc.' },
  ]},
  { name: 'La vie Frutiz', boards: [
    { name: 'Jeux Vidéos', description: 'Pour parler de votre passion, les jeux vidéos ;)' },
    { name: 'Créations littéraires', description: 'Pour tous vos poèmes, textes et histoires qui sortent tout droit de votre imagination, à vos plumes !' },
    { name: 'Créations graphiques', description: 'Pour tous vos dessins, trucages et gribouillis qui sortent tout droit de votre imagination, à vos crayons !' },
    { name: 'Musique', description: "Car votre passion, c'est la zique, parce que vous voulez partager avec vos amis frutiz..." },
    { name: 'Vie non Frutiz', description: 'Pour parler de la vie... en dehors de Frutiparc. Si si, elle existe !' },
  ]},
];

// Legacy boards that have been renamed/replaced in FORUM_DEFAULT_STRUCTURE.
// On startup their topics are merged into the canonical replacement, then
// the empty legacy board is deleted. Listed by name to handle both fresh
// installs and DBs migrated from an older seed.
const LEGACY_FORUM_BOARDS = [
  // The original seed had a single "Animations" / "Animation" board which
  // was split into "Animations officielles" + "Animations Frutiz". Topics
  // are funneled into "Animations officielles".
  { name: 'Animations',  mergeInto: 'Animations officielles' },
  { name: 'Animation',   mergeInto: 'Animations officielles' },
];

module.exports = {
  STAFF_ONLY_FORUM_CATEGORIES,
  FORUM_DEFAULT_STRUCTURE,
  LEGACY_FORUM_BOARDS,
};
