// Virtual file-system tree exposed via /ff/tree.
//
// The "b" attribute lists folder uids in a specific positional order — the
// AS2 client (FFileMng) reads bFolder[7]=mycontact, bFolder[8]=recyclebin.
// Do NOT insert extra entries before mycontact/recyclebin or the indices
// shift and the client mis-routes folder operations.

const FILE_TREE_XML = `<s u="root" n="Bureau" t="desktop" m="0" b="messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin;blacklist">
  <f u="messages" n="Messages" t="messages">
    <f u="inbox" n="Boîte de réception" t="inbox" />
    <f u="outbox" n="Messages envoyés" t="outbox" />
    <f u="blackbox" n="Spams" t="blackbox" />
    <f u="draftbox" n="Brouillons" t="draftbox" />
  </f>
  <f u="disccollector" n="Mes disques" t="disccollector" />
  <f u="inventory" n="Inventaire" t="inventory">
    <f u="inv_accessories" n="Accessoires" t="inventory" />
    <f u="inv_wallpapers" n="Fonds d&apos;écran" t="inventory" />
  </f>
  <f u="shop" n="Boutique" t="shop">
    <f u="accessories" n="Accessoires" t="accessories" />
  </f>
  <f u="mycontact" n="Mes contacts" t="mycontact" />
  <f u="recyclebin" n="Corbeille" t="recyclebin" />
  <f u="blacklist" n="Liste noire" t="blacklist" />
</s>`;

// Mail folders recognised by the file-system endpoints (/ff/ls, /ff/dm).
const MAIL_FOLDERS = new Set(['inbox', 'outbox', 'draftbox', 'blackbox', 'recyclebin']);

module.exports = { FILE_TREE_XML, MAIL_FOLDERS };
