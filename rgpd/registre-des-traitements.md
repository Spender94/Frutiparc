# Registre des activités de traitement — Frutiparc

*Article 30 du RGPD. Un traitement par fiche. À relire à chaque changement de
fonctionnalité qui touche aux données ; la date de dernière revue est en bas.*

**Responsable du traitement :** la personne ou l'association désignée par la
variable d'environnement `RGPD_RESPONSABLE` (affichée sur
`/confidentialite`). **Contact :** `RGPD_CONTACT`.
**Délégué à la protection des données :** aucun (non requis — art. 37).

Sauf mention contraire, les personnes concernées sont **les joueurs inscrits**
(dont des mineurs), les destinataires sont **le serveur du site et l'équipe
bénévole** (accès administrateur journalisé), et les mesures de sécurité sont
celles de la fiche 10.

---

## 1. Compte joueur

| | |
|---|---|
| **Finalité** | Créer et tenir un compte, permettre la connexion, retrouver un code secret oublié |
| **Base légale** | Exécution du contrat (les conditions d'utilisation du parc) ; consentement pour l'e-mail |
| **Données** | pseudo, code secret (haché bcrypt), date de naissance, e-mail (facultatif), date de création, dernière connexion, accord parental (date, mineurs de moins de 15 ans) |
| **Source** | le joueur, à l'inscription et dans ses réglages |
| **Destinataires** | serveur ; Resend (e-mail) pour le seul envoi des e-mails de récupération et d'inactivité |
| **Durée** | vie du compte ; effacement après 3 ans sans connexion (préavis 35 j par e-mail) ; sur demande, 7 j après la demande |
| **Où** | `users` (colonnes `username`, `password`, `email`, `birthday`, `created_at`, `last_login`, `parent_consent_at`, `deletion_requested_at`, `inactivity_warned_at`), `sessions`, `password_resets` |

## 2. Fiche du joueur (profil public)

| | |
|---|---|
| **Finalité** | Se présenter aux autres joueurs |
| **Base légale** | Consentement (tous les champs sont facultatifs et modifiables) |
| **Données** | prénom, nom (et son affichage), sexe, ville, pays, région, activité, site web, commentaire, signature de forum, frutibouille |
| **Source** | le joueur |
| **Destinataires** | tous les visiteurs connectés (fiche publique). L'âge n'est montré qu'à partir de 18 ans ; la date de naissance n'est jamais montrée |
| **Durée** | vie du compte |
| **Où** | `users` (`first_name`, `last_name`, `last_name_public`, `gender`, `city`, `country*`, `region*`, `real_job`, `site_url`, `comment`, `forum_signature`, `fbouille`) |

## 3. Données de jeu

| | |
|---|---|
| **Finalité** | Jouer : scores, classements, inventaire, progression, monnaie du jeu |
| **Base légale** | Exécution du contrat |
| **Données** | scores et classements (publics), médailles, fruticards (sauvegardes de jeu), inventaire et accessoires, pictos, kikooz et leur historique, quotas quotidiens, préférences, bureau |
| **Destinataires** | serveur ; classements publics pour les scores et médailles |
| **Durée** | vie du compte ; les archives de classement des jours passés gardent le pseudo (anonymisé à la suppression du compte) |
| **Où** | `scores`, `challenge_score_archive`, `challenge_medals`, `fruti_slots`, `user_items`, `user_accessories`, `user_game_items`, `kikooz_log`, `kikooz_gifts`, `shop_purchases`, `shop_sales`, `tournament_*`, `swapou_ia_scores`, colonnes `xp`, `kikooz`, `fd_state`, `owned_*`, `desktop_items`, `prefs` de `users` |

## 4. Communication : salons, messages privés, courrier interne, forum

| | |
|---|---|
| **Finalité** | Permettre aux joueurs de se parler ; faire vivre les espaces publics ; les modérer |
| **Base légale** | Exécution du contrat ; intérêt légitime pour la modération (un espace sûr, notamment pour les mineurs) |
| **Données** | contenu des messages, auteur, destinataires, dates, humeur de la bouille ; carnet de contacts et liste noire |
| **Destinataires** | les autres joueurs (salons et forum : public ; MP et courrier : les destinataires) ; le staff du salon pour les journaux des 24 dernières heures |
| **Durée** | salons : 24 h ; MP et courrier : vie du compte du destinataire ; forum : conservé, l'auteur anonymisé (« compte_supprime ») à la suppression du compte |
| **Où** | `chat_history` (en base et en mémoire), `user_mails`, `forum_topics`, `forum_posts`, `forum_topic_reads`, `forum_topic_follows`, `contacts`, `blacklist`, `contact_folders` |

## 5. Modération

| | |
|---|---|
| **Finalité** | Faire respecter le règlement ; tracer les sanctions |
| **Base légale** | Intérêt légitime |
| **Données** | joueur visé, modérateur, sanction, motif, date ; bannissement (jusqu'à, par, motif) |
| **Destinataires** | l'équipe de modération et l'administration |
| **Durée** | journaux de modération : 1 an ; bannissement : jusqu'à son terme |
| **Où** | `moderation_logs`, colonnes `banned_*` de `users`, `chat_banned_words` (pas de donnée personnelle) |

## 6. Lutte contre les multi-comptes (parrainage)

| | |
|---|---|
| **Finalité** | Empêcher qu'un joueur se parraine lui-même |
| **Base légale** | Intérêt légitime (l'équité du parc) |
| **Données** | adresse IP d'inscription, jeton d'appareil, pseudo du parrain, état du parrainage |
| **Destinataires** | serveur ; administration (revue des parrainages) |
| **Durée** | IP et jeton : 6 mois ; le lien de parrainage : vie du compte |
| **Où** | `users` (`register_ip`, `device_token`, `device_token_at`, `referred_by`, `referral_*`) |

## 7. Notifications push

| | |
|---|---|
| **Finalité** | Prévenir le joueur (courrier, MP, événements) quand il n'est pas devant l'écran |
| **Base légale** | Consentement (bouton « Activer les notifications » ; « Couper » le retire) |
| **Données** | adresse d'envoi chiffrée fournie par le navigateur, clés de chiffrement, navigateur, date |
| **Destinataires** | le service de push du navigateur (Google, Apple, Mozilla) — qui ne peut pas lire le contenu |
| **Durée** | jusqu'au retrait, ou jusqu'à ce que l'adresse ne réponde plus |
| **Où** | `push_subscriptions` |

## 8. Journaux techniques

| | |
|---|---|
| **Finalité** | Fonctionnement, dépannage, sécurité |
| **Base légale** | Intérêt légitime |
| **Données** | journaux du serveur (pseudo, adresse IP des tentatives d'inscription et des connexions admin, erreurs) |
| **Destinataires** | l'hébergeur ; l'équipe |
| **Durée** | celle de l'hébergeur (quelques semaines) |
| **Où** | la sortie standard du serveur, chez l'hébergeur |

## 9. Blindtest (YouTube)

| | |
|---|---|
| **Finalité** | Jouer un extrait musical dans un salon |
| **Base légale** | Consentement (le lecteur n'est chargé qu'au clic sur « Écouter » ; « Couper » retire le lecteur et le consentement) |
| **Données** | adresse IP du joueur, transmise à YouTube le temps de l'extrait ; aucune donnée conservée par le site |
| **Destinataires** | YouTube (`youtube-nocookie.com`, sans cookie publicitaire) |
| **Durée** | la durée de l'extrait |
| **Où** | nulle part sur le serveur |

## 10. Mesures de sécurité (communes)

- Transport chiffré (HTTPS) ; codes secrets hachés (bcrypt) ; jetons de
  réinitialisation hachés et limités à une heure.
- Accès administrateur par clé ou rôle, journalisé, limité par adresse IP en
  cas d'échecs répétés.
- Base de données chez l'hébergeur, dans l'Union européenne, sauvegardée par
  lui.
- Minimisation : inscription à trois champs, fiche entièrement facultative,
  date de naissance jamais montrée, âge des mineurs jamais montré.
- Purges automatiques des durées ci-dessus (`rgpdBalayage`, toutes les heures).
- Export et suppression de compte en libre-service (`/api/light/mes-donnees`,
  `/api/light/compte/suppression`).

---

## Transferts hors Union européenne

| Destinataire | Pays | Garantie |
|---|---|---|
| Resend (e-mails) | États-Unis | Clauses contractuelles types de la Commission européenne (dans les conditions de Resend) |
| Google / Apple / Mozilla (push) | États-Unis | Clauses contractuelles types ; le contenu est chiffré de bout en bout |
| YouTube (blindtest) | États-Unis | Consentement explicite du joueur, au clic |

L'hébergeur doit être configuré dans une région européenne (Render :
Frankfurt). À vérifier à chaque changement d'hébergement.

---

*Dernière revue : septembre 2026.*
