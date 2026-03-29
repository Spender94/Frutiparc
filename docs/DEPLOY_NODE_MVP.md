# Déploiement public du serveur Node MVP (sans Ruffle)

Ce guide expose publiquement l'endpoint :

- `GET /api/mvp/showcase`

## Option recommandée : Render

Le dépôt contient `render.yaml` prêt à l'emploi.

### Étapes

1. Pousser la branche sur GitHub.
2. Dans Render: **New +** -> **Blueprint** -> sélectionner le repo.
3. Valider la création du service `frutiparc-node-mvp`.
4. Vérifier que le healthcheck passe sur `/healthz`.

### Vérification

Quand le déploiement est vert:

```bash
curl https://<votre-app>.onrender.com/healthz
curl https://<votre-app>.onrender.com/api/mvp/showcase
```

## Notes

- Le serveur lit `PORT` depuis l'environnement (compatible Render/Fly/Railway).
- Cet endpoint est la version portée Node/Haxe (pas de `main.swf`, pas de Ruffle).
