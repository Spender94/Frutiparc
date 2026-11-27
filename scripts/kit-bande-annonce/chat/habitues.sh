#!/bin/sh
# Kit bande-annonce — LE SALON DES HABITUÉS : tourne les plans de
# plans-habitues.js (scénario scenes-habitues.json) avec les vraies bouilles de
# kit-bande-annonce/casting-habitues.json, dans kit-bande-annonce/salon-habitues/.
#
#   sh scripts/kit-bande-annonce/chat/habitues.sh                 tous les plans
#   sh scripts/kit-bande-annonce/chat/habitues.sh habitues-salon2 un seul
#   sh scripts/kit-bande-annonce/chat/habitues.sh --essai habitues-maitre
#
# casting-habitues.json reste HORS du dépôt (bouilles de vrais joueurs) ; même
# forme que casting.json : { "spectateur": {pseudo, affiche, bouille},
# "casting": [ {pseudo, affiche, bouille}, … ] }.
#
# Les variantes d'accessoire créées sur le site (admin → Variantes) ne sont pas
# dans le dépôt : sans elles, plusieurs habitués paraissent chauves. Enregistrer
# https://<le site>/api/light/variantes (public) sous
# kit-bande-annonce/variantes-accessoire.json : il est pris s'il existe.
ICI=$(dirname "$0")
KIT=/home/user/Frutiparc/kit-bande-annonce
[ -f "$KIT/variantes-accessoire.json" ] && export KIT_VARIANTES="$KIT/variantes-accessoire.json"
KIT_CHAT_SCENES="$ICI/scenes-habitues.json" \
KIT_CHAT_PLANS="$ICI/plans-habitues.js" \
KIT_CASTING="$KIT/casting-habitues.json" \
KIT_CHAT_SORTIE="$KIT/salon-habitues" \
exec node "$ICI/generer.js" "$@"
