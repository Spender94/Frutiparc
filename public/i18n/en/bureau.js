/*
 * DICTIONNAIRE ANGLAIS — LE BUREAU FRUTIZ (public/bureau-frutiz.js et ses sprites).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T()), ici seulement l'anglais. Glossaire du parc : voir commun.js.
 *
 * Ce que le SERVEUR écrit (noms de dossiers du carnet, articles de la
 * boutique, libellés des préférences, historiques, motifs d'erreur) n'est pas
 * ici : il le rend lui-même dans la langue de chacun.
 */
(function () {
  // `bureau.mailDateLongue` reçoit le rang du jour (0 = lundi, comme
  // MAIL_JOURS) et celui du mois (0 = janvier).
  var JOURS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  FPI18n.ajouter('en', {
    // Les titres de fenêtre
    'bureau.titreBoutique': 'Shop',
    'bureau.titreModifierFiche': 'Edit my profile',
    'bureau.titreEvenements': 'Events',
    'bureau.titreHistorique': 'My history',
    'bureau.historiqueKikooz': 'Kikooz history',
    'bureau.titrePreferences': 'My preferences',
    'bureau.titreSalonsPublics': 'Public chat rooms',
    'bureau.titreRecherche': 'Find a frutiz',
    'bureau.titreQuetes': 'Gromelin\'s quests',
    'bureau.ongletBureau': 'Desktop',

    // Les dossiers, par uid (disccollector, inventory, mycontact, blacklist,
    // recyclebin ; inbox, outbox, blackbox pour le courrier)
    'bureau.mesDisques': 'My discs',
    'bureau.inventaire': 'Inventory',
    'bureau.mesContacts': 'My contacts',
    'bureau.listeNoire': 'Blacklist',
    'bureau.corbeille': 'Trash',
    'bureau.boiteReception': 'Inbox',
    'bureau.messagesEnvoyes': 'Sent messages',
    'bureau.indesirables': 'Junk',
    // Les sous-dossiers de l'inventaire (inv_accessories, inv_incarnations,
    // inv_wallpapers, inv_pictos) : le français est le nom que le serveur envoie
    'bureau.dossierAccessoires': 'Accessories',
    'bureau.dossierIncarnations': 'Incarnations',
    'bureau.dossierFonds': 'Wallpapers',
    'bureau.dossierPictos': 'Pictos',

    // Ce que font les contacts
    'bureau.enLigne': 'Online',
    'bureau.invisible': 'Invisible',
    'bureau.horsLigne': 'Offline',
    'bureau.enLigneMin': 'online',
    'bureau.horsLigneMin': 'offline',
    'bureau.absent': 'Away',
    'bureau.auTelephone': 'On the phone',
    'bureau.dort': 'Sleeping',
    'bureau.auTravail': 'At work',
    'bureau.aTable': 'Eating',
    'bureau.litLeForum': 'reading the forum',
    'bureau.joueA': 'playing {jeu}',

    // Les salons publics
    'bureau.creerSalon': 'new chat room',
    'bureau.sujetSalonACreer': 'Topic of the new chat room',
    'bureau.salonSansSujet': 'Can\'t create this chat room: you need to give it a topic.',
    'bureau.salonImpossible': 'Can\'t create this chat room: {motif}',

    // La recherche de frutiz (les étiquettes ont la largeur du bytecode)
    'bureau.rcPseudo': 'username:',
    'bureau.rcPseudoCherche': 'Username to find',
    'bureau.rcAvancee': 'advanced',
    'bureau.rcSexe': 'gender:',
    'bureau.rcMasculin': 'Male',
    'bureau.rcFeminin': 'Female',
    'bureau.rcTous': 'All',
    'bureau.rcAgeMin': 'min age:',
    'bureau.rcAgeMinimum': 'Minimum age',
    'bureau.rcAgeMax': 'max age:',
    'bureau.rcAgeMaximum': 'Maximum age',
    'bureau.rcPays': 'country:',
    'bureau.rcPaysAria': 'Country',
    'bureau.rcRegion': 'region:',
    'bureau.rcRegionAria': 'Region',
    'bureau.rcPagePrecedente': 'Previous page',
    'bureau.rcPageSuivante': 'Next page',
    'bureau.rcChargement': 'loading...',
    'bureau.rcToutPays': 'All countries...',
    'bureau.rcPaysEnPremier': 'Pick your country first...',
    'bureau.rcNonDisponible': 'not available',
    'bureau.rcLieu': 'place',
    'bureau.rcToutLieu': 'Any {lieu}...',
    'bureau.rcRefusee': 'Search failed: the server refused the request.',
    'bureau.rcReponses': { one: '{page}/{pages} - {n} answer', other: '{page}/{pages} - {n} answers' },
    'bureau.ageAns': 'age {age}',
    'bureau.voirFiche': 'See {nom}\'s profile',

    // Les phrases des dossiers (lang_french.as)
    'bureau.alerteDisquesJouer': 'To play, drag the discs into the Frusion: the console at the top right of Frutiparc',
    'bureau.alerteDisquesVide': 'Out of Fruti-Discs? Black FDs are handed out every day at midnight, but you can buy white FDs or Passes in the shop right now!',
    'bureau.alerteInventaire': 'Your inventory holds the items you bought in the shop or picked up while playing.',
    'bureau.alerteListeNoire': 'You can turn down private chats and invitations from the contacts in your blacklist (see preferences). Mail from them goes to the "Junk" folder.',
    'bureau.alerteContactsAjouter': 'To add a contact: use a frutiz\'s profile, drag a frutiz from a chat room or the scores into this folder, or click an e-mail address.',
    'bureau.alerteContactsDossier': 'To create a folder, just click the button with a star above.',
    'bureau.alerteContactsInviter': 'To invite a contact to a private chat or a chat room, just drag them onto the chat window.',
    'bureau.alerteCorbeille': 'To throw something away, drag it onto the trash: a frutiz from your contacts, a desktop shortcut, a mail.',

    // L'explorateur et le bureau
    'bureau.dossierIndisponible': 'Folder unavailable.',
    'bureau.remonterDossier': 'Up one folder',
    'bureau.nouveauDossierMin': 'new folder',
    'bureau.nouveauDossier': 'New folder',
    'bureau.creationDossierFermee': 'Creating folders isn\'t open on the revival',
    'bureau.viderCorbeille': 'Empty the trash',
    'bureau.viderCorbeilleSur': 'Are you sure you want to empty your trash?',
    'bureau.supprimerDossierCarnet': 'Delete the folder "{nom}"?\nIts contacts will go back to "My contacts".',
    'bureau.sansSujet': '(no subject)',
    'bureau.mailSujetDe': '{sujet} — from {de}',
    'bureau.porter': 'Wear "{nom}"',
    'bureau.porterVendable': 'Wear "{nom}" (double-click: sell it back to the shop)',
    'bureau.poserFond': 'Put "{nom}" on the desktop',
    'bureau.retirerListeNoire': 'Remove "{nom}" from your blacklist?',
    'bureau.retirerContacts': 'Remove "{nom}" from your contacts?',
    'bureau.nomDossier': 'Folder name?',
    'bureau.glisserFrusion': 'Drag it into the Frusion',
    'bureau.glisserFrusionAPart': 'Drag it into the Frusion (it opens in a separate window)',
    'bureau.retirerDuBureau': 'Remove "{nom}" from the desktop?',
    'bureau.seDeconnecter': 'Log out',
    'bureau.dossier': 'Folder',
    'bureau.dossierVide': 'This folder is empty. Drag in whatever you want to keep here.',

    // La Frusion
    'bureau.redemarrerJeu': 'Restart the game',
    'bureau.ejecterDisque': 'Eject the disc',

    // Les salons : l'infobulle d'un frutiz, l'appel aux modérateurs
    'bureau.tipAvecAge': ': age {age}, {region} ({pays}), level {niveau}',
    'bureau.tipSansAge': ': {region} ({pays}), level {niveau}',
    'bureau.prevenirModerateurs': 'Alert the moderators',
    'bureau.erreur': 'Error: ',
    'bureau.modoSalonsPublics': 'This only works in public chat rooms.',
    'bureau.modoDejaLa': 'One or more moderators are already in this chat room.',
    'bureau.modoDejaPrevenus': 'You just alerted the moderators!',
    'bureau.salon': 'Chat room',
    'bureau.modoConfirmer': 'Are you sure you want to tell the moderators there\'s a problem in this chat room?<br><b>Careful!</b> Only use this for a real problem. Any abuse will be punished.',
    'bureau.oui': 'Yes',
    'bureau.non': 'No',

    // Le courrier (lang_french.as : mail.*)
    'bureau.mailExpediteur': 'Sender',
    'bureau.mailDestinataire': 'Recipient',
    'bureau.mailColSujet': 'Subject',
    'bureau.mailColDate': 'Date',
    'bureau.mailSujetReponse': 'Re: {sujet}',
    'bureau.mailSujetTransfert': 'Fwd: {sujet}',
    'bureau.mailCitationReponse': '\n\n--- Original message ---\nDate: {date}\nFrom: {de}\nTo: {a}\nSubject: {sujet}\n\n',
    'bureau.mailCitationTransfert': '\n\n--- Forwarded message ---\nDate: {date}\nFrom: {de}\nTo: {a}\nSubject: {sujet}\n\n',
    'bureau.dossierParent': 'Parent folder',
    'bureau.ecrireCourrier': 'Write a mail',
    'bureau.mailSupprimer': 'Delete',
    'bureau.mailRetour': 'Back',
    'bureau.mailEnvoyer': 'Send',
    'bureau.mailRepondre': 'Reply',
    'bureau.mailTransferer': 'Forward',
    'bureau.mailDate': 'Date:',
    'bureau.mailDe': 'From:',
    'bureau.mailA': 'To:',
    'bureau.mailSujet': 'Subject:',
    'bureau.mailTailleTexte': 'Text size',
    'bureau.mailTropGros': 'Too big',
    'bureau.mailTresGros': 'Very big',
    'bureau.mailGros': 'Big',
    'bureau.mailNormal': 'Normal',
    'bureau.mailPetit': 'Small',
    'bureau.mailTresPetit': 'Very small',
    'bureau.mailIllisible': 'Unreadable',
    'bureau.mailGras': 'Bold',
    'bureau.mailItalique': 'Italic',
    'bureau.mailSouligne': 'Underline',
    'bureau.mailCopie': 'Add to "Sent messages"',
    'bureau.composerMessage': 'Write a new message',
    'bureau.courrier': 'Mail',
    // « jeudi 27 aout 20:17 » → « Thursday, August 27 20:17 »
    'bureau.mailDateLongue': function (p) {
      return JOURS[p.js] + ', ' + MOIS[p.ms] + ' ' + p.j + ' ' + p.heure;
    },

    // La boutique, le forum déporté
    'bureau.obtenirKikooz': 'Get kikooz',
    'bureau.forumBloque': 'Window blocked: the browser wouldn\'t open the forum window.',

    // Les préférences (les rubriques locales ; celles du serveur arrivent traduites)
    'bureau.prefCetAppareil': 'This device',
    'bureau.prefNuit': 'The park by night',
    'bureau.prefNotifications': 'Notifications',
    'bureau.prefAppli': 'The app',
    'bureau.prefDiag': 'No sound?',
    'bureau.prefMonCompte': 'My account',
    'bureau.prefMesDonnees': 'My data',
    'bureau.prefLangueDesc': 'The park\'s language, for this account. The page reloads right away.',
    'bureau.prefValeursDefaut': 'Default values',
    'bureau.prefEnregistrer': 'Save',
    'bureau.prefValeurOrigine': 'Default value: {valeur}',
    'bureau.prefVide': '(empty)',

    // La fiche d'un frutiz
    'bureau.ficheBlog': 'Their blog',
    'bureau.ficheAjouterContact': 'Add to my contacts',
    'bureau.ficheListeNoire': 'Add to my blacklist',
    'bureau.ficheListeNoireSur': 'Add "{nom}" to your blacklist?',

    // Les onglets, la barre-titre des fenêtres
    'bureau.menuOnglet': 'Tab menu',
    'bureau.modeFlash': 'Flash mode',
    'bureau.afficherBarre': 'Show the bar',
    'bureau.modeRapide': 'Quick mode',
    'bureau.recherche': 'Search',
    'bureau.versBureau': 'To desktop',
    'bureau.deporter': 'Pop out',
    'bureau.ceJeu': 'this game',
    'bureau.deporterQuestion': 'Pop out {jeu}? Your current game will restart: the game starts over in the new window. To keep it, choose "To desktop": the game moves to a window on the desktop, without stopping.',
    'bureau.jeuBloque': 'Window blocked: the browser wouldn\'t open the game window.',
    'bureau.mettreEnOnglet': 'Put in a tab',
    'bureau.redimensionner': 'Resize',

    // Gaspard (lang_french.as : help.*) — le $n reste, il est remplacé ensuite
    'bureau.gsAttente': 'Please wait...',
    'bureau.gsInjoignable': 'The Frutiparc server seems out of reach. Check your internet connection.',
    'bureau.gsResultatsExacts': 'I found $n results matching your search:',
    'bureau.gsResultatsProches': 'I found $n results close to your search:',
    'bureau.gsRien': 'Sorry, I didn\'t find anything matching your search.',
    'bureau.gsConseil': 'Try a broader search: type a single word rather than a sentence. For example, search for <i>titems</i> rather than <i>What are titems?</i>. Check the spelling too.<br/><br/>If you need <b>technical support</b>, you can send a mail to: <a href="mailto:gaspard@frutiparc.com">gaspard@frutiparc.com</a>',
    'bureau.gsRubriques': 'Sections:',
    'bureau.gsDansRubrique': 'In this section:',
    'bureau.gsVoirEgalement': 'See also:',
    'bureau.gsErreur1': 'An unknown error happened on the server (HTTP)',
    'bureau.gsErreur2': 'Action not allowed',
    'bureau.gsErreur3': 'Invalid request',
    'bureau.gsErreur4': 'An error happened on the server',
    'bureau.gsErreur5': 'You can\'t do this for now',
    'bureau.gsAfficherBouilles': 'Show the bouilles',
    'bureau.gsAfficherPresents': 'Show the frutiz who are here',
    'bureau.gsQuestion': 'Ask Gaspard a question',
    'bureau.gsParlerA': 'Talk to {nom}',
    'bureau.gsPrecedent': 'Previous',
    'bureau.gsIndexAide': 'Help index',

    // L'afficheur du rang (fonte LcdSwf : minuscules a-z seulement, sans
    // apostrophe ni trait d'union)
    'bureau.lcdAide': 'gaspard',
    'bureau.lcdForum': 'forum',
    'bureau.lcdMail': 'messages',
    'bureau.lcdHistorique': 'history',
    'bureau.lcdEvenements': 'events',
    'bureau.lcdJeux': 'games',

    // Le frutimandala, le mode rapide
    'bureau.changerCadran': 'Switch dial',
    'bureau.revenirBarre': 'Back to the bar',
    'bureau.modeRapideMin': 'quick mode',

    // La page de chargement (chargement.json, `textes`)
    'bureau.chargementTitre': 'LOADING',
    'bureau.chargementPrefixe': 'files remaining: ',
    'bureau.chargementInfoTitre': 'Information:',
    'bureau.chargementInfo': 'This loads every part of the frutiparc interface, so you can get around faster afterwards!',
  });
})();
