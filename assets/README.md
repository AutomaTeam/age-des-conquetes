# Assets visuels (sprites)

Dossier de sprites générés par IA (ou récupérés sur des banques libres),
destiné à remplacer progressivement le rendu 100% procédural du canvas.
Voir le plan complet dans la conversation / `.claude/plans` pour le contexte.

## Structure

- `batiments/` — un WebP par bâtiment (fond transparent), vue isométrique.
- `unites/` — un WebP par unité/type, vue isométrique.
- `ressources/` — icônes de ressources (bois, pierre, or, nourriture) et
  éventuellement les gisements/arbres tels qu'ils apparaissent sur la carte.
- `effets/` — effets ponctuels (mort, impact, poussière...), en une ou
  plusieurs frames si animés.

## Convention de nommage (à respecter pour l'intégration automatique)

`categorie_nom[_variante].webp`, tout en minuscules, sans accents, mots
séparés par `_`. Exemples :

- `ressources/bois.webp`, `ressources/pierre.webp`, `ressources/or.webp`,
  `ressources/nourriture.webp`
- `batiments/centre_ville.webp`, `batiments/maison.webp`, `batiments/ferme.webp`
- `unites/villageois.webp`, `unites/epeiste.webp`
- Variante "camp ennemi" (si générée séparément plutôt que teintée par
  code) : suffixe `_ennemi`, ex. `batiments/caserne_ennemi.webp`.

## Format

- **WebP**, fond détouré (alpha), largeur alignée sur la résolution de
  travail du jeu — 640 px pour `batiments/`, 400 px pour `unites/` et
  `ressources/`. Voir `TRIM_W_*` dans `index.html` : la planche est de toute
  façon redimensionnée à 512 / 320 / 256 px de large au chargement, donc
  tout pixel au-delà est stocké puis jeté. C'est ce recadrage de
  résolution, bien plus que le codec, qui a fait passer le dossier de
  21,8 Mo à 3,8 Mo.
- L'extension est définie à UN SEUL endroit, la constante `ASSET_EXT` dans
  `index.html`. Elle était auparavant écrite en dur à quinze endroits — et
  un oubli y est SILENCIEUX (fichier introuvable = repli sur le sprite
  procédural), donc invisible jusqu'à ce qu'on remarque le manque.
- Une planche fournie avec un fond blanc fonctionne toujours : le flood fill
  du jeu la détoure au chargement (voir plus bas). Mais **préférer un fond
  déjà transparent** : un fond quasi-blanc encodé avec pertes voit ses
  pixels légèrement modifiés, et comme il s'agit d'un flood fill, un seul
  pixel qui bascule peut ouvrir un passage vers une zone claire intérieure.
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

Une seule image par type suffit par défaut : elle sert aussi à toutes les
variantes du bâtiment (habillages d'âge, niveaux de tour, portail ouvert).
Inutile donc de produire `caserne_age2.webp` ou `tour_niveau3.webp`.

Exception : un bâtiment listé dans `BLD_AGE_SPRITE_FILES` (index.html) prend
une illustration **dédiée par palier d'âge** plutôt que de réutiliser la forme
de base. Convention de nommage : `<nom>_age1.webp` (Féodal), `_age2.webp`
(Châteaux), `_age3.webp` (Impérial) — l'Âge Sombre reste le fichier de base
sans suffixe. Actuellement seul `centre_ville` en bénéficie
(`centre_ville_age1/2/3.webp`).

Un bâtiment listé dans `BLD_CIV_SPRITE_FILES` (index.html) prend en plus une
illustration **dédiée par civilisation**, croisée avec les âges ci-dessus.
Convention : `<nom>_<civ>.webp` (Âge Sombre), `<nom>_<civ>_age1/2/3.webp`. La
civilisation 'francs' n'a pas besoin d'entrée : elle utilise le style de
base. `centre_ville` est **complet pour les 4 civilisations** (16 fichiers :
base + byzantins/chinois/mongols × 4 âges chacun).

Le fond quasi-blanc est détouré automatiquement par flood fill depuis les
bords, puis l'image est recadrée sur son contenu. Ce traitement n'est fait
**qu'une fois par partie** et mis en cache.

Les planches livrées ici sont **déjà détourées** (fond en alpha 0) : le flood
fill du jeu n'a alors plus rien à faire et le recadrage vient du seul balayage
d'alpha, ce qui le rend déterministe. Fournir une planche à fond blanc reste
accepté — le jeu la détourera — mais le résultat dépend alors finement du
rééchantillonnage et de l'encodage : sur une douzaine de planches, une
moucheture claire isolée dans la marge, que le flood fill ne peut pas
atteindre depuis les bords, gonflait la boîte de recadrage et faisait donc
dessiner le bâtiment plus petit qu'il ne devait l'être.
