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

- `audit-detourage.py` — audite les planches **déjà livrées** dans `assets/`
  pour du blanc résiduel : rejoue exactement le détourage du jeu au chargement
  (`computeStripBgTrimmed`, js/05-sprites.js — même flood fill, même
  résolution de travail) plutôt que de se fier à l'alpha du fichier, pour ne
  signaler que ce que le joueur voit RÉELLEMENT en partie. Trouvé le
  2026-09-08 : 33 planches avec des poches jamais comblées (murs, portes,
  charpentes — tout ce qui a un jour de la lumière derrière), plus deux
  planches jamais détourées du tout (`mur.webp`, `portail.webp`, base non-civ).

  ```bash
  python outils/audit-detourage.py
  ```

- `comble-poches-livrees.py` — corrige ce que l'audit a trouvé, directement
  sur le fichier livré (la planche source, elle, ne survit pas au détourage).
  Deux faux positifs connus à ne PAS lui passer : `relique.webp` (halo
  magique volontaire) et `banc_poissons.webp` (dessin clair, aucune poche).
  `mur.webp`/`portail.webp`, jamais détourés du tout, veulent le traitement
  complet de `detourer-planche.py --pockets` plutôt que ce correctif
  ponctuel (voir le commit du 2026-09-08).

  Le seuil de taille de l'audit (0,1 % de la boîte du sujet) est fait pour
  un bâtiment, vu une fois. Une planche REPÉTÉE à l'écran — l'arbre, le
  buisson, des centaines d'exemplaires par carte — montre des poches bien
  plus petites : l'arbre avait deux trous blancs entre ses branches (0,03 %),
  sous le seuil, visibles dans chaque forêt. `--min=0.02` abaisse le seuil
  pour ces planches-là (appliqué le 2026-09-11 à `arbre.webp` et
  `buisson_baies.webp`). Regarder la planche avant : à ce seuil, un reflet
  blanc voulu passerait aussi.

  ```bash
  python outils/comble-poches-livrees.py --dry assets/batiments/*.webp assets/unites/*.webp   # aperçu
  python outils/comble-poches-livrees.py assets/batiments/mur_mongols.webp                     # applique
  python outils/comble-poches-livrees.py --min=0.02 assets/ressources/arbre.webp              # planche répétée
  ```

  Le jeu lui-même, depuis le 2026-09-11, **défrange** le bord de chaque
  planche au chargement (`defrangerBord`, js/05-sprites.js) : la couronne
  délavée de blanc qu'une planche peinte sur fond blanc garde tout autour de
  son sujet disparaît, le bord devient anticrénelé. Ça ne comble PAS une
  poche fermée — seul ce script le fait.

- `reboucher-transparence.py` — remplace le RGB caché sous les pixels déjà
  transparents d'une planche livrée par la couleur du pixel opaque le plus
  proche (même « rebouchage » que la première précaution de
  `detourer-planche.py`, appliqué après coup). Sans effet visuel direct — ces
  pixels sont invisibles avant comme après — mais évite qu'un futur
  redimensionnement fasse baver ce blanc résiduel dans le contour. **Ne
  résout PAS**, à lui seul, un mur qui rend plus court que son propre
  portail (Byzantins : 94 px contre 126 px, vérifié le 2026-09-08) — cet
  écart-là vient de la composition même des deux planches, pas d'un défaut
  de détourage ; seule une nouvelle génération le corrigerait proprement.

  ```bash
  python outils/reboucher-transparence.py --dry assets/batiments/*.webp   # aperçu
  python outils/reboucher-transparence.py assets/batiments/mur_byzantins.webp
  ```
