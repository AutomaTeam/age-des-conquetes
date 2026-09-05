# Outils d'atelier

Scripts qui servent à **fabriquer** les ressources du jeu, jamais à le faire
tourner. Le jeu et ses tests restent sans dépendance ni build ; ce dossier,
lui, a le droit d'en avoir.

- `detourer-planche.py` — détoure une planche générée (fond blanc), la recadre
  sur son sujet et l'écrit en WebP RGBA au gabarit attendu par
  `fitBuildingImage` / `fitUnitImage`. Dépend de Pillow, NumPy et SciPy.
  Le mode d'emploi, les trois précautions et les pièges sont dans son en-tête ;
  la direction artistique et les prompts sont dans
  [`../assets/README.md`](../assets/README.md).

```bash
python outils/detourer-planche.py source.jpg assets/batiments/maison_gitanos.webp bld pockets
```

Il affiche pour chaque planche la taille finale, la part de blanc **au cœur du
sujet** (au-delà de ~5 %, changer de vignette : le détourage trouerait le
sujet) et les poches de fond fermées, qui sortiraient en voile blanc opaque.
