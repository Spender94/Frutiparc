// Ephemeral "Évènements" event store for the admin broadcast feature.
//
// Each event lives in `pushedEvents` (newest first, capped at 200) and
// receives a unique id from genEventId(). State is lost on restart —
// the desktop's "Évènements" window only displays recent events anyway,
// and admin can replay if needed.

const pushedEvents = [];   // [{ id, message, type, time, chat, notified, historyCount }]
let seq = 0;

function genEventId() {
  seq += 1;
  return `evt_${Date.now().toString(36)}_${seq}`;
}

module.exports = {
  pushedEvents,
  genEventId,
};
