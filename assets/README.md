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
bâtiments (+ 76 variantes par civilisation — **les 21 types du jeu**, Mur et
Portail compris), 21 unités (+ 3 variantes de
Héros par civilisation), 6 gisements de carte, 2 animaux, 2 objets uniques.
`effets/` reste volontairement vide : particules et projectiles sont trop
brefs à l'écran pour qu'une illustration s'y voie.

Les trois dernières unités (`cataphractaire`, `cavalier_archer`,
`arbaletrier_repetition`) sont les **unités uniques de civilisation** — celles
qui se forment au Château selon `CIVS[...].unique`. Elles ont été ajoutées au
jeu APRÈS la passe qui avait couvert « tous les types de `UT` » et sont donc
restées longtemps les seules sans illustration, alors que ce sont justement
les seules dont le style DOIT se lire comme byzantin, mongol ou chinois.
Compter les fichiers ne suffit pas à s'en apercevoir : c'est `UNIT_SPRITE_FILES`
(js/05-sprites.js) qu'il faut recouper avec `UT`, un type absent de cette
table retombant SILENCIEUSEMENT sur le sprite procédural.

Une seule image par type suffit par défaut : elle sert aussi à toutes les
variantes du bâtiment (habillages d'âge, niveaux de tour, portail ouvert).
Inutile donc de produire `caserne_age2.webp` ou `tour_niveau3.webp`.

Exception : un bâtiment listé dans `BLD_AGE_SPRITE_FILES` (index.html) prend
une illustration **dédiée par palier d'âge** plutôt que de réutiliser la forme
de base. Convention de nommage : `<nom>_age1.webp` (Féodal), `_age2.webp`
(Châteaux), `_age3.webp` (Impérial) — l'Âge Sombre reste le fichier de base
sans suffixe. Actuellement seul `centre_ville` en bénéficie
(`centre_ville_age1/2/3.webp`).

Un bâtiment listé dans `BLD_CIV_SPRITE_FILES` (js/05-sprites.js) prend en plus
une illustration **dédiée par civilisation**. Convention : `<nom>_<civ>.webp`,
plus `<nom>_<civ>_age1/2/3.webp` si le type a des habillages d'âge. La
civilisation 'francs' n'a pas besoin d'entrée : elle utilise le style de base.

**Combien de planches ça coûte** : ça dépend de `lvlSuffix` dans
`drawBuildings`. Seuls **TC, Caserne et Mur** (habillages d'âge `_A1.._A3`), la
**Tour** (niveaux `_L2/_L3`) et le **Portail** (`_OPEN`) portent des variantes
de clé. Pour eux, une civ qui ne fournirait que l'âge 0 verrait son bâtiment
RETOMBER sur le style de base dès le passage à l'âge suivant, en pleine partie
et sans rien dans la console.

**Le raccourci qui désamorce ça** : écrire une **chaîne** au lieu d'un objet
`{âge: fichier}` signifie « la même planche à tous les âges ». C'est ce que
fait déjà `upgradeBuildingSprites` pour les illustrations génériques, et le
fichier n'est chargé et détouré qu'une fois de toute façon. **Trois planches
suffisent donc pour n'importe quel bâtiment**, y compris la Caserne :

```js
[BT.BARRACKS]: { byzantins:'caserne_byzantins', ... },   // 3 fichiers
[BT.TOWER]:    { byzantins:'tour_byzantins', ... },      // 3 fichiers, malgre _L2/_L3
[BT.TC]:       { byzantins:{0:'...',1:'...',2:'...',3:'...'}, ... }, // 12
```

La chaîne marche pour N'IMPORTE QUELLE famille de variantes de clé — âges
(`_A1..3`), niveaux de Tour (`_L2`/`_L3`) ou Portail ouvert (`_OPEN`) : elle
recopie la même image sur toutes les clés que `SPR.bld` possède déjà pour ce
type. Ne détailler les quatre âges que là où la montée en âge mérite d'être
dessinée — aujourd'hui le Centre Ville, et lui seul.

Couverture actuelle :

- `centre_ville` — complet, 16 fichiers (base + 3 civs × 4 âges).
- `maison` — 3 fichiers. C'est le bâtiment le plus NOMBREUX de la carte :
  une seule planche par civ y change plus la lecture d'une ville que partout
  ailleurs. Un joueur chinois bâtissait un quartier de colombages allemands.
- `chateau` — 3 fichiers. Bâtiment signature : c'est lui qui forme l'unité
  unique de la civilisation et son héros.
- `ferme` — 3 fichiers. Dit ce que le peuple CULTIVE, et pour les Mongols
  qu'il ne cultive pas : c'est un enclos de bétail, cohérent avec leur bonus
  de chasse et leur identité de nomades éleveurs.
- `monastere` — 3 fichiers. C'était le plus incongru de tous : un joueur
  chinois ou mongol priait dans une chapelle gothique surmontée d'une croix.
- `caserne` — 3 fichiers, grâce à la forme chaîne ci-dessus. C'était le
  dernier bâtiment militaire encore générique alors que l'Écurie et le
  Château ne l'étaient plus.
- `moulin` — 3 fichiers.
- `tour` — 3 fichiers, malgré ses habillages de NIVEAU (`_L2`/`_L3`, garde
  renforcée puis créneaux) — la forme chaîne s'applique aussi bien aux
  niveaux qu'aux âges. Vérifié en jeu : une tour chinoise reste chinoise à
  ses trois niveaux et diffère de la tour franque à chacun.
- `atelier_siege`, `avant_poste` et `quai` — 3 fichiers chacun, sans
  variante de clé.
- `hlm` — 3 fichiers. Les Mongols n'ont pas de tour d'immeuble : leur
  densification est un CAMP DE YOURTES groupées en cercle, cohérent avec
  leur identité nomade plutôt qu'une tour qu'ils ne bâtiraient jamais.
- `merveille` — 3 fichiers. L'aboutissement architectural de chaque
  civilisation : basilique à dômes dorés inspirée de Sainte-Sophie
  (Byzantins), pagode à neuf toits (Chinois), palais-tente doré sur podium de
  pierre (Mongols).
- `camp_bois` et `camp_minier` — 3 fichiers chacun, et **en PAYSAGE**
  (640×427) contrairement à tout le reste : ce sont les seuls types **2×1**
  traités, leur sprite est large et bas. Une planche générée en portrait s'y
  serait retrouvée réduite à la hauteur puis perdue au milieu d'un canevas
  trop large — `fitBuildingImage` fait un « contain ». C'est le seul endroit
  où le format de génération dépend de l'emprise du bâtiment.
- `universite` — 3 fichiers. Dit ce que la civilisation SAIT : scriptorium à
  coupole, académie à stèle gravée, pavillon de feutre à sphère armillaire.
- `ecurie`, `marche`, `forge` — 3 fichiers chacun. Les trois bâtiments civils
  les plus courants après la Maison et la Ferme. Chez les Mongols les trois
  deviennent des installations de campement (auvent de feutre, tente de
  commerce, forge de campagne) plutôt que des maçonneries — cohérent avec leur
  Centre Ville et leur Château, déjà des structures de feutre et de bois.
- `mur` — 3 fichiers, malgré ses habillages d'ÂGE (`_A1.._A3`) — même forme
  chaîne que la Caserne et la Tour. Crénelage pierre/brique (Byzantins),
  muraille de pierre grise à corbeaux de bois (Chinois), talus de terre battue
  surmonté de pieux liés de corde (Mongols) — ce dernier réutilise le bois
  mais change la MAJORITÉ du corps du mur (terre plutôt que rondins), pour ne
  pas se confondre avec la palissade franque. Le point délicat, propre au Mur :
  son rendu recoupe la source à 53 % de hauteur pour raccorder les tronçons
  verticaux (`murSuite` dans `drawBuildings`, voir js/06-rendu.js) — toute
  planche civ doit garder crénelage/pointes dans le haut et un corps continu
  dans le bas pour que ce raccord reste invisible. Vérifié en jeu sur un
  tronçon de 4 cases : aucune « échelle », le bandeau de brique byzantin se
  répète même en coursière convaincante.
- `portail` — 3 fichiers, sur le même contrat que le Mur (`_OPEN` au lieu des
  âges — voir plus haut « Combien de planches ça coûte »). Porte en arc de
  brique aux vantaux cloutés de fer (Byzantins), arc de pierre grise aux
  vantaux laqués rouge et clous de laiton (Chinois), porte de bois liée de
  corde entre deux talus à pieux (Mongols). Piège rencontré sur un premier
  candidat chinois : un vantail entrouvert laissait voir le fond blanc à
  travers l'arche, et le flood fill — qui ne connaît que la couleur —
  détourait ce « fond visible » comme un vrai passage ouvert alors que la
  planche sert l'état FERMÉ. Repris avec les deux vantaux clos.
  Un camp mongol complet ne partage plus AUCUNE silhouette avec un bourg
  franc — les 19 bâtiments partagés sont désormais 21 sur 21.

Une **unité** listée dans `UNIT_CIV_SPRITE_FILES` (js/05-sprites.js) prend elle
aussi une illustration dédiée par civilisation — même contrat que les
bâtiments : convention `<nom>_<civ>.webp`, `francs` sans entrée puisque son
style EST le fichier de base, repli silencieux sur la planche commune tant
qu'un fichier manque. Les unités n'ont pas de paliers d'âge, donc pas de
suffixe `_ageN` ; les deux frames de foulée (`_W1`/`_W2`) reçoivent la même
image, comme pour la surcouche commune.

Seul le **Héros** en bénéficie, et il est **complet pour les 4 civilisations** :
`HEROES` nomme quatre personnages distincts (Charlemagne, Bélisaire, Sun Tzu,
Gengis Khan) qui sortaient tous sous la même silhouette de seigneur occidental.
Charlemagne garde `heros.webp` — c'est le style Francs — et les trois autres ont
leur planche (`heros_byzantins`, `heros_chinois`, `heros_mongols`).

Les trois unités uniques de civilisation, elles, n'ont pas besoin d'entrée
ici : une seule civilisation peut les former, leur planche unique EST déjà
leur planche de civilisation.

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

## Poches de fond FERMÉES — le piège du flood fill

Le détourage du jeu (`stripBgTrimmed`) part **des bords** de la planche. Une
zone de fond que le sujet **enferme** n'est donc jamais atteinte et reste
peinte en blanc opaque au milieu de l'unité : le vide entre la corde et le
bois d'un arc bandé, l'intérieur de l'arc d'une arbalète, les jours entre les
poutres d'un trébuchet ou d'un atelier de siège.

Ce n'est pas théorique : **treize planches livrées en étaient atteintes**,
dont l'Archer (3,1 % de la planche) et l'Arbalétrier (2,2 %) qui affichaient
en jeu une grande voile blanche dans leur arc. Elles ont été balayées le
2026-08-31 ; le canal alpha seul a été touché, les couleurs n'ont pas bougé.

À vérifier sur **toute nouvelle planche**, avant de l'ajouter :

1. composer la planche sur un fond magenta et regarder — une poche saute aux
   yeux ; le fond vert du jeu, lui, la camoufle à moitié ;
2. ou recenser les composantes connexes de quasi-blanc opaque qui ne touchent
   ni un pixel transparent, ni un bord.

Le remède le plus sûr reste le prompt : demander des formes **jointives**
(voir la note « palissade » plus haut). Quand la forme impose le vide — un arc
bandé en a forcément un — il faut vider la poche à la livraison.

## Le piège INVERSE : un sujet trop BLANC

Symétrique et plus vicieux, parce qu'aucun réglage ne le rattrape. Le
détourage ne connaît que la couleur : un mur **blanchi à la chaux** passe le
même test que le fond, et le flood fill le troue depuis les bords. Le jeu fait
exactement pareil — ce n'est donc pas un défaut de la chaîne de livraison,
c'est la planche qui est inutilisable.

Rencontré en générant le Monastère byzantin : sur les quatre vignettes,
**16 % du cœur du sujet** de la plus belle passait pour du fond, et ses murs
sortaient criblés de trous. Une autre vignette du même lot était à 3,8 % et
est passée sans une retouche.

**Le test, avant de choisir une vignette** : compter, dans le rectangle
central (25-75 % en largeur, 35-75 % en hauteur — du sujet à coup sûr), la
part de pixels qui passent le test de fond. Au-delà de ~5 %, changer de
vignette plutôt que de bricoler les seuils. Et éviter « whitewashed » dans
le prompt : demander une pierre **crème**, **ocre** ou **sable**.

Deux exceptions volontaires, à ne pas « corriger » :

- `batiments/portail.webp` et `batiments/mur.webp` sont livrés en **RGB à fond
  blanc** (décision du 2026-08-30) : c'est le jeu qui les détoure. Tout leur
  fond est joignable depuis les bords, sauf une moucheture de 0,16 % dans le
  portail — trop peu pour justifier de changer leur format.
- `ressources/nourriture.webp` était livrée sur un **carton gris** (182,182,182),
  trop sombre pour le seuil de 230 du flood fill : l'icône sortait en
  rectangle opaque dans la topbar là où bois/pierre/or étaient détourées.
  Elle a été détourée à la main (gris ET blanc intérieur) et est maintenant
  en RGBA comme les trois autres.
