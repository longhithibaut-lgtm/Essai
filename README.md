# Essai

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
