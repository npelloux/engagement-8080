# Engagement 80/80

Application web mono-page qui analyse l'historique trimestriel d'une équipe et
estime combien de Features engager au prochain trimestre pour tenir une
prédictibilité cible (80 % par défaut) avec un niveau de confiance donné
(80 % par défaut).

Le résultat est une estimation probabiliste fondée sur l'historique, jamais une
garantie.

Un outil open source d'[AELWorks](https://aelworks.fr/).

## Utilisation

En ligne : <https://aelworks.fr/outils/engagement-8080/>

En local : ouvrir `index.html` dans un navigateur. Aucune installation, aucun serveur :
les données restent dans le stockage local du navigateur, avec import et
export CSV ou JSON.

## Déploiement

Chaque push sur `main` lance les tests, puis dépose `index.html`, `moteur.js`
et le logo dans `outils/engagement-8080/` sur l'hébergement web IONOS
d'aelworks.fr (`.github/workflows/deploy.yml`). Le dépôt doit avoir les secrets
`SFTP_SERVER`, `SFTP_USERNAME` et `SFTP_PASSWORD`.

## Structure

| Fichier | Rôle |
|---|---|
| `moteur.js` | Couche données (normalisation F / E / P, sélection, CSV, JSON) et moteur statistique (empirique, Monte-Carlo, Student). Aucun accès au DOM. |
| `index.html` | Interface et graphiques. Ne contient aucune logique statistique : elle appelle le moteur et trace les séries reçues. |
| `moteur.test.js` | Tests unitaires du moteur. |

Ajouter un moteur statistique (comptage Poisson / binomiale négative, modèle
conditionnel F | E) revient à ajouter une entrée au registre `METHODS` de
`moteur.js`.

## Tests

```bash
npm test
```

Node 18 ou plus récent, sans dépendance.

## Licence

[MIT](LICENSE) © 2026 [AELWorks](https://aelworks.fr/)
