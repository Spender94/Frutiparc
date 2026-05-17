// Soft profanity filter applied to chat / forum content before it's
// persisted or broadcast. Matches whole words (\b…\b) so suffixes don't
// trip false positives. Order is significant — earlier rules win.
const PROFANITY_REPLACEMENTS = [
  [/\bcon\b/gi, 'blonk'],
  [/\bconne\b/gi, 'blonk'],
  [/\bputain\b/gi, 'margotton'],
  [/\bpute\b/gi, 'ribaude'],
  [/\bcontent\b/gi, 'youpi-banane'],
  [/\bcontente\b/gi, 'youpi-banane'],
  [/\bmignon\b/gi, 'youpi-framboise'],
  [/\bmignonne\b/gi, 'youpi-framboise'],
  [/\bserveur\b/gi, 'gros cube noir et lourd qui ventile fort'],
];

function censorProfanity(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, repl] of PROFANITY_REPLACEMENTS) out = out.replace(re, repl);
  return out;
}

module.exports = { PROFANITY_REPLACEMENTS, censorProfanity };
