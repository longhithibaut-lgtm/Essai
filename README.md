# Essai

## Aube

Un parcours de parkour calme, à la première personne, au-dessus d'une mer de nuages à l'aube. Jouable dans le navigateur, fait avec [three.js](https://threejs.org/).

### Jouer

Il faut servir le dossier avec un petit serveur local (les modules JavaScript ne se chargent pas en ouvrant `index.html` directement) :

```
npx serve .
```

puis ouvrir l'adresse affichée (par exemple http://localhost:3000). three.js est chargé depuis le CDN jsdelivr, aucune installation n'est nécessaire.

### Commandes

- `Z` `Q` `S` `D` (ou `W` `A` `S` `D`) : se déplacer
- Souris : regarder
- `Espace` : sauter, courir sur les murs, grimper
- `Maj` ou `C` : glisser
- `Échap` : pause, `M` : couper le son

### Capture automatique

`node tools/capture.mjs` lance le jeu dans Chromium sans écran, fait jouer un pilote automatique sur tout le parcours et enregistre des images dans `.captures/latest/` (points de vue, séquences de mouvement, interface, mesures). Il faut d'abord `npm install` pour avoir three.js en local.

## Skill Gauntlet Loop

Ce dépôt inclut le skill **gauntlet-loop** pour Claude Code, dans `.claude/skills/gauntlet-loop/`.

Utilisation, dans Claude Code :

```
/gauntlet-loop <ton objectif>
```

Le skill propose 2 ou 3 références de qualité réelles (une « barre » : un site, un jeu, un texte précis), tu en choisis une, et il te rend un prompt court à coller dans une nouvelle session. Cet agent découpe le travail en petits morceaux, fait tourner pour chacun un constructeur et un critique séparé, compare le résultat à la référence à l'aveugle, et recommence jusqu'à ce que le critique choisisse notre version.

### Crédits

- Skill par Jay E de [RoboNuggets](https://robonuggets.com) : [robonuggets/gauntlet-loop](https://github.com/robonuggets/gauntlet-loop) (copié sans modification depuis le commit `9b1975a`).
- Technique « gauntlet loop » par [Matt Shumer](https://github.com/mshumer), issue de [Claude of Duty](https://github.com/mshumer/Claude-of-Duty).
- Licence : [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), texte complet dans `.claude/skills/gauntlet-loop/LICENSE`.
