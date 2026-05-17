// In-memory user store. Each entry is a hydrated user record:
//   { pass, xp, kikooz, fbouille, items, gameItems, prefs, isModerator,
//     userLog, siteLog, kikoozLog, mails, contacts, blacklist, … }
//
// Populated from the DB on login/ident via hydrateUserFromDb(), or
// freshly created via createDefaultUser() on registration. The Gaspard
// welcome bot is seeded directly at boot.
//
// Module-level shared object so every server.js call site that does
// `users[username] = …` or `users[username].xp += 10` continues to
// work by reference.

const users = {};   // lowercase username → record

module.exports = { users };
