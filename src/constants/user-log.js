// Frame number in the events-icon sprite (sprite id=533) for each user-log /
// site-log entry type. Mapped empirically via the /test-log-icon admin scan.
// Drives the icon shown next to each <l type="N"> entry in the user's
// "Mon historique" and "Évènements" desktop windows.
const USER_LOG_TYPE = {
  KICK:        1,    // user ejected from a channel
  BAN:         2,    // user banned
  TOTOCHE:     3,    // user muted (totoché) by a moderator
  // 4: reserved (no visual)
  PICTO:       10,   // unlocked a new game picto / titem
  CHAT:        20,   // chat-related notification (NPC reveal, etc.)
  LEVEL_UP:    30,
  LEVEL_DOWN:  31,
  INSCRIPTION: 40,   // first entry on a freshly-registered account
  GODSON:      50,   // new godson recruited
  MEDAL:       60,   // won a daily-challenge medal
};

// Frame number in the activity-icon sprite (sprite id=246 inside the "status"
// sprite at the "internal" label) for each game. The SWF renders the icon via
// gotoAndStop(internal) where `internal` is the 2-char base62 value broadcast
// in the user's status string. Note: the sprite has been reordered since it
// was authored and its FrameLabels no longer match the visual content at each
// frame — these numbers were validated empirically from the icons users see
// when launching each game. Returning 0 hides the icon (no internal status).
const STATUS_INTERNAL_FRAME = {
  bkiwi:     2,   // verified: Kaluga (internal=2) was showing the BKiwi visual
  mb2:       3,   // verified empirically via /set-internal scan
  swapou2:   4,   // verified empirically via /set-internal scan
  snake3:    5,   // verified: Snake (internal=5) already shows the right visual
  bandas:    6,   // verified: Swapou (internal=6) was showing the Frutibandas visual
  grapiz:    7,   // verified: MB2 (internal=7) was showing the Grapiz visual
  kaluga:    8,   // verified: BKiwi (internal=8) was showing the Kaluga visual
  miniwave:  9,   // verified empirically via /set-internal scan
  // Not yet located in the sprite (frame number unknown): minipixiz, jamajama.
  // forum visual is at frame 36 per FrameLabels.
  forum:     36,
};

function statusInternalCode(name) {
  if (!name) return 0;
  return STATUS_INTERNAL_FRAME[name] || 0;
}

module.exports = { USER_LOG_TYPE, STATUS_INTERNAL_FRAME, statusInternalCode };
