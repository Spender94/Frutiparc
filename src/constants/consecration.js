// Per-game progression registry used by the consecration ranking.
// `enabled: false` removes a game from the per-game weight share; the
// overall score auto-rebalances over the enabled set.
const { JAMA_MILESTONES } = require('./game-items');

const GAME_PROGRESS_REGISTRY = [
  {
    id: 'kaluga',
    name: 'Kaluga',
    enabled: true,
    matchGame: 'Kaluga', // matches getGameItemGame() value
  },
  {
    id: 'swapou',
    name: 'Swapou',
    enabled: true,
    matchGame: 'Swapou',
  },
  {
    id: 'snake3',
    name: 'Frutisnake',
    enabled: true,
    matchGame: 'Frutisnake',
    totalPictos: 322, // dynamic "Fruit N" pictos — fixed total used as denominator
  },
  {
    id: 'bkiwi',
    name: 'Burning Kiwi',
    enabled: true,
    matchGame: 'Burning Kiwi',
  },
  {
    id: 'mb2',
    name: 'MotionBall',
    enabled: true,
    matchGame: 'MotionBall',
  },
  {
    id: 'miniwave',
    name: 'MiniWave',
    enabled: true,
    matchGame: 'MiniWave',
  },
  {
    id: 'jamajama',
    name: 'JamaJama',
    enabled: true,
    matchGame: 'JamaJama',
    totalPictos: Object.keys(JAMA_MILESTONES).length,
  },
  {
    id: 'pixiz',
    name: 'MiniPixiz',
    enabled: true,
    matchGame: 'MiniPixiz',
  },
];

module.exports = { GAME_PROGRESS_REGISTRY };
