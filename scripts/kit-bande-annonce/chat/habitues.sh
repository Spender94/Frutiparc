#!/bin/sh
# Kit bande-annonce — LE SALON DES HABITUÉS : tourne les plans de
# plans-habitues.js (scénario scenes-habitues.json) avec les vraies bouilles de
# kit-bande-annonce/casting-habitues.json, dans kit-bande-annonce/salon-habitues/.
#
#   sh scripts/kit-bande-annonce/chat/habitues.sh                 tous les plans
#   sh scripts/kit-bande-annonce/chat/habitues.sh habitues-multi  un seul
#   sh scripts/kit-bande-annonce/chat/habitues.sh --essai habitues-maitre
#
# casting-habitues.json reste HORS du dépôt (bouilles de vrais joueurs) ; même
# forme que casting.json : { "spectateur": {pseudo, affiche, bouille},
# "casting": [ {pseudo, affiche, bouille}, … ] }.
ICI=$(dirname "$0")
KIT=/home/user/Frutiparc/kit-bande-annonce
KIT_CHAT_SCENES="$ICI/scenes-habitues.json" \
KIT_CHAT_PLANS="$ICI/plans-habitues.js" \
KIT_CASTING="$KIT/casting-habitues.json" \
KIT_CHAT_SORTIE="$KIT/salon-habitues" \
exec node "$ICI/generer.js" "$@"
