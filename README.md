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

`node tools/capture.mjs` (ou `--gpu` sur une machine avec carte graphique) lance le jeu dans Chromium, fait jouer un pilote automatique sur tout le parcours et enregistre des images dans `.captures/latest/` (points de vue, séquences de mouvement, interface, mesures). Il faut d'abord `npm install` pour avoir three.js en local.

### Reprendre la boucle gauntlet sur une machine avec une carte graphique

Les tours 1 à 3 ont tourné dans un conteneur sans carte graphique : chaque capture y prenait 15 à 20 minutes, et les 60 images/s ne pouvaient pas être mesurées. Pour le tour suivant, sur un PC avec un GPU (par exemple un Shadow) :

1. Installer [Git](https://git-scm.com/), [Node.js 22](https://nodejs.org/) et, si possible, [ffmpeg](https://ffmpeg.org/) (pour les vidéos de référence).
2. Récupérer le code :
   ```
   git clone https://github.com/longhithibaut-lgtm/Essai.git
   cd Essai
   git checkout claude/pensive-clarke-gxx4bb
   npm install
   npx playwright install chromium
   ```
3. Télécharger la barre (captures et vidéos Steam de VHOLUME et Mirror's Edge, gardées hors du dépôt) : `npm run bar`
4. Vérifier que tout tourne : `node tools/capture.mjs --gpu --only views,route` (une fenêtre Chromium s'ouvre, les images arrivent dans `.captures/latest/`).
5. Ouvrir Claude Code dans ce dossier (application Claude Desktop, ou `claude remote-control` dans un terminal pour le suivre depuis l'application Claude Code) et lui demander de lancer le tour 4 avec `tools/gauntlet-round.js`, en partant des écarts du tour 3 notés sur la page Atelier Aube.

Pour mesurer les images par seconde en jouant, ajouter `#fps` à l'adresse du jeu.

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
