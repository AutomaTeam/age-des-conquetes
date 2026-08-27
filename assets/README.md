# Assets visuels (sprites)

Dossier de sprites générés par IA (ou récupérés sur des banques libres),
destiné à remplacer progressivement le rendu 100% procédural du canvas.
Voir le plan complet dans la conversation / `.claude/plans` pour le contexte.

## Structure

- `batiments/` — un PNG par bâtiment (fond transparent), vue isométrique.
- `unites/` — un PNG par unité/type, vue isométrique.
- `ressources/` — icônes de ressources (bois, pierre, or, nourriture) et
  éventuellement les gisements/arbres tels qu'ils apparaissent sur la carte.
- `effets/` — effets ponctuels (mort, impact, poussière...), en une ou
  plusieurs frames si animés.

## Convention de nommage (à respecter pour l'intégration automatique)

`categorie_nom[_variante].png`, tout en minuscules, sans accents, mots
séparés par `_`. Exemples :

- `ressources/bois.png`, `ressources/pierre.png`, `ressources/or.png`,
  `ressources/nourriture.png`
- `batiments/centre_ville.png`, `batiments/maison.png`, `batiments/ferme.png`
- `unites/villageois.png`, `unites/epeiste.png`
- Variante "camp ennemi" (si générée séparément plutôt que teintée par
  code) : suffixe `_ennemi`, ex. `batiments/caserne_ennemi.png`.

## Format recommandé

- PNG, fond transparent.
- Dimensions cohérentes par catégorie (ex. 256×256 pour bâtiments, 128×128
  pour unités, 64×64 pour icônes de ressources) — facilite le calage dans
  le canvas.
- Même angle de caméra et même style sur toutes les images d'une catégorie
  (voir les prompts fournis) pour rester cohérent visuellement.

Tant qu'un fichier n'existe pas ici, le jeu continue d'utiliser le rendu
procédural existant (aucune régression).

## État : couverture complète

Toutes les catégories prévues sont fournies — 4 icônes de ressources, 21
bâtiments, 18 unités, 6 gisements de carte, 2 animaux, 2 objets uniques.
`effets/` reste volontairement vide : particules et projectiles sont trop
brefs à l'écran pour qu'une illustration s'y voie.

Une seule image par type suffit : elle sert aussi à toutes les variantes du
bâtiment (habillages d'âge, niveaux de tour, portail ouvert). Inutile donc de
produire `centre_ville_age2.png` ou `tour_niveau3.png`.

Le fond quasi-blanc est détouré automatiquement par flood fill depuis les
bords, puis l'image est recadrée sur son contenu. Ce traitement n'est fait
**qu'une fois par partie** et mis en cache — inutile de fournir des PNG déjà
détourés, mais un fond bien uniforme donne un meilleur résultat.
