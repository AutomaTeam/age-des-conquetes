# Tests

```bash
node tests/run.js
```

Un groupe seul : `node tests/run.js reseau` — lui seul TOURNE, et un nom de
groupe inconnu sort en erreur au lieu d'afficher un `0/0` vert.

**111 tests, 15 groupes, ~35 s.** Les groupes `ia` et `delta` comptent pour
l'essentiel du temps : ils simulent de vraies parties, c'est le prix pour
observer des comportements qui n'existent qu'apres plusieurs minutes.

Aucune dépendance, aucun `npm install`, aucun build — comme le jeu lui-même.
Node 18+ suffit.

## Ce que ça teste, et pourquoi ça

Le jeu se relit très bien à l'écran : si une unité se déplace mal ou si un
bâtiment est mal dessiné, ça se voit. Ces tests couvrent donc uniquement ce
qui **ne se voit pas** :

- **`ordres`** — `applyCommand`, la SEULE porte par laquelle un joueur mute
  l'état, et en ligne celle qui reçoit les ordres du client. Tout ce qu'elle
  ne vérifie pas est exploitable : l'interface, elle, ne verrouille que
  l'affichage. Ces tests visent donc les REFUS (verrous d'âge, arbre
  technologique, plafond de population, taux de troc forgé, ordre sur les
  unités d'un autre camp, démolition du Centre Ville…), pas les cas
  nominaux.
- **`delta`** — le flux différentiel hôte → client, la partie la plus
  fragile du jeu. Une paire hôte/client réellement reliée (même graine,
  SNAP puis deltas) doit CONVERGER, y compris sous le feu : 80 unités qui se
  battent et qui meurent. Couvre aussi l'invariant n°6 — tout champ que
  l'HÔTE décide ou recalcule doit voyager, jamais se redeviner chez le
  client : les bits `M_MAXHP`, `M_ATK` et `M_XP` côté unité (`maxHp` et
  `atk` à la montée d'âge, `xp`/`rank`/`atk` à la promotion de vétérance),
  et `autoTrain`/`rally` côté bâtiment. Plus le filtrage par brouillard (une
  fuite d'information = triche) et le différentiel `d.fac` (invariant n°2).
  Depuis le 2026-09-03, l'invariant n°6 vaut aussi pour les FACTIONS —
  `appliquerFaction` est le seul endroit du protocole où un champ peut n'être
  posé qu'à la CRÉATION : `equipe` (que la diplomatie change en cours de
  partie, si bien que le client voyait son propre allié en rouge) et
  `autoRepair` en étaient. Et la **RECONNEXION** : un client qui recharge sa
  page en pleine partie repart d'un SALUT + SNAP au milieu du jeu, jamais
  testé jusque-là.
- **`reseau`** — la sérialisation hôte → client, et le DURCISSEMENT du
  décodage : un message abîmé (clé du mauvais type, élément de lot tordu,
  descripteur bien formé sauf un champ) ne doit pas faire tomber la page du
  destinataire en pleine partie, et un message sain doit ensuite le remettre
  d'aplomb — un durcissement qui laisse l'état corrompu ne vaut pas mieux
  qu'un plantage franc. Les lots étaient lus en `(m.x||[])` : cela couvre
  l'absence et le null, pas un `{}` ni une chaîne. Une divergence n'apparaît
  qu'en partie en ligne, chez l'invité, et souvent plusieurs minutes après
  la cause. C'est le groupe le plus rentable : il a trouvé dès sa première
  exécution que `appliquerSnap` remettait les ~1900 cases de lac à 0 (l'eau
  est marquée `3` dans `bmap`, comme un bâtiment solide) — les lacs
  cessaient donc de bloquer le passage chez le client seul.
- **`carte`** — le déterminisme de la génération. Reliques, faune et
  poissons ne voyagent PAS en position sur le réseau : le client les
  régénère depuis la graine partagée. Si `genMap` cesse d'être déterministe,
  le multijoueur casse en silence.
- **`sauvegarde`** — `migrerSauvegarde` doit charger les formats anciens, et
  un chargement doit REPARTIR sans le drapeau de defaite : `G.gameOver` n'est
  pas un champ de sauvegarde et ne repartait pas a faux, donc perdre puis
  recharger gelait toutes les fins de partie pour le restant de la session.
  Couvre aussi la chaine **v6 -> v7 -> v8**, le seul palier dont l'echec est
  SILENCIEUX : les coordonnees v6 etaient des pixels au zoom d'ecriture, pas
  des unites `BASE_TILE` — rate d'un facteur 3, tout reste coherent a l'oeil,
  simplement chaque entite est ailleurs.
- **`chemin`** — contournement d'obstacle et ligne de vue.
- **`combat`** — le triangle de contres (Piquier > Chevalier > Archer >
  Piquier) et les invariants de `degatsContre`.
- **`civilisations`** — unité unique et recherche exclusive refusées aux
  autres camps, même par ordre réseau forgé ; bonus économiques réels. Plus
  l'INTÉGRITÉ des tables (`PRODUCTION`, `TCOST`, `CIVS`, `BONUS`), écrites à
  la main donc sujettes à dérive : elles se lisent partout sans garde, et une
  entrée qui désigne un type inexistant ne lève pas — elle rend `undefined`.
  Une unité formable absente de `TCOST` serait GRATUITE, une unité unique mal
  orthographiée rendrait sa civilisation muette.
- **`cartes`** — les cinq presets, et surtout : aucun n'enferme un camp (un
  `findPath` réel entre les deux Centres Ville). Plus la table des SOLS :
  chaque carte doit décrire une matière complète, aucune ne doit partager le
  sol d'une autre, et sa couleur de mini-carte ne doit pas contredire son
  terrain. Les pixels ne sont pas testables ici (les bouchons ne dessinent
  rien) — la table, si, et c'est elle qui avait laissé passer une steppe
  fleurie de marguerites.
- **`tailles`** — `COLS`/`ROWS` ne sont plus des constantes : la carte se
  choisit en quatre tailles. On vérifie que tout ce qui en dérive suit —
  dimensions réelles des grilles, buffers typés de la séparation et du
  pathfinding (les oublier ne lève rien : ça écrit à côté), densité de
  gisements — et que les départs humains se répartissent sur l'anneau au
  lieu de deux coins figés : éloignés, variables selon la graine, jamais
  dans l'eau, jamais sur un gisement.
- **`economie`** — la récolte crédite le BON camp, le re-semis d'une ferme
  est facturé à SON propriétaire (le piège que documente `tryAutoReseed`).
- **`ages`** — les bonus de montee d'age s'appliquent rétroactivement, et
  une unité formée APRÈS a exactement les mêmes statistiques qu'une unité
  relevée. C'est l'invariant qui casse le plus discrètement.
- **`finpartie`** — élimination, victoire, défaite, et la Merveille qui ne
  doit PAS donner la victoire avant son délai.
- **`ia`** — plafond des Moines, atelier de siège au roster, et l'assaut qui
  passe bien par un rassemblement.
- **`charge`** — des invariants de COÛT, pas de résultat. Ce sont les seuls
  défauts qui ne se voient pas du tout en petite partie et qui rendent une
  grosse partie injouable. Le BUDGET de balayage du
  voisinage (le reciblage est censé tourner 4×/s et par unité ; une garde de
  point d'intérêt sans cible, ou une tour qui ne voit rien, rebalayaient à
  chaque image) ; l'ORDRE des tests dans `nearestBy`, où la distance doit
  écarter un candidat avant que le prédicat ne remonte à sa faction — le
  balayage porte sur un CARRÉ de cellules, dont les coins sont hors du rayon
  par construction ; le RECUL d'une recherche de chemin qui échoue ; et la
  passe de séparation qui doit survivre à une
  population qui grossit — si sa liste de cellules survit à une réallocation
  du tableau de têtes, la boucle de chaînage ne se termine plus et l'onglet
  se fige. Une régression sur ce dernier point BLOQUE ce fichier au lieu de
  l'échouer : c'est le symptôme lui-même, et il vaut mieux ça que rien.

Le **rendu n'est pas testé** et ne doit pas l'être ici : les bouchons ne
dessinent rien.

## Comment ça marche

`harness.js` lit la LISTE des `<script src="js/…">` d'`index.html` — une
seule source de vérité pour l'ordre de chargement, et un fichier ajouté au
jeu entre automatiquement dans les tests — puis évalue chaque fichier
SÉPARÉMENT dans un `vm` Node muni des bouchons de `stub-dom.js`. Les évaluer
séparément (et non concaténés) reproduit fidèlement le découpage, en
particulier le fait qu'une fonction déclarée dans un fichier n'est PAS
hissée dans les précédents. Les `const` de premier niveau restent dans la
portée lexicale du contexte, d'où la ligne d'export évaluée en dernier.

Le second bloc `<script type="module">` (Firebase) est ignoré : il ne publie
que `window.MP`, que tout le jeu appelle derrière des gardes `window.MP?.…`.
Son absence est donc exactement le cas « multijoueur non configuré ».

Deux points de bouchonnage méritent d'être connus :

- **Pas d'`AudioContext`.** `SFX.init()` teste sa présence et renonce sans
  bruit, après quoi `sfx()` sort immédiatement. Bien plus sûr que de
  bouchonner l'arbre des nœuds audio : la première version le faisait et
  plantait sur `f.Q.value`, un paramètre oublié parmi la dizaine que le jeu
  touche.
- **`Image` ne se charge jamais.** Les illustrations restent donc absentes
  et le jeu garde son rendu procédural — exactement le repli prévu par
  `withIllustration`/`onerror`.

## Ajouter un test

Un symbole du jeu doit être listé dans `EXPORTS` (`harness.js`) pour être
visible des tests ; une entrée absente d'`index.html` fait échouer le
chargement avec un message explicite, plutôt que de laisser un test vérifier
`undefined`.

Sept pièges rencontrés en écrivant ces tests, et qui reviendront :

1. **Les duels doivent opposer deux factions JUMELLES** (même genre, même
   civ, mêmes recherches). Opposer une escouade en marche d'attaque à une
   escouade sur l'automate ennemi ne compare pas des statistiques mais des
   automates, et le second gagne quoi qu'il arrive.
2. **La carte générée a des lacs, marqués `3` dans `bmap` comme les murs.**
   Un test de pathfinding qui choisit un point de départ en dur a de bonnes
   chances de partir dans un lac. Chercher une case libre (`caseLibre`).
3. **La simulation utilise `Math.random` en pleine boucle de jeu** (ciblage
   de l'IA désynchronisé, chasse, particules). Tout test dont l'issue dépend
   d'un combat est donc instable par nature — le triangle de contres a
   échoué par intermittence avant d'être réécrit. Appeler
   `j.semerAleatoire(n)` pour un aléa reproductible, et exiger la majorité
   sur plusieurs graines plutôt qu'un résultat unique.
4. **`placeBuilding` pousse lui-même dans `G.buildings`.** Ne jamais faire de
   `push` en plus : chaque bâtiment serait inséré deux fois avec le même id.
   Utiliser l'utilitaire `batir()`.
5. **Le client N'EST PAS l'hôte : il faut le faire tourner.** `appliquerDelta`
   ne pose pas les positions, il pose des CIBLES d'interpolation
   (`_netX`/`_netY`) que `updateVisuel` consomme. Un test qui applique des
   deltas sans appeler `updateVisuel` compare un état que personne n'a
   rattrapé — et la position ne se compare donc jamais au pixel près
   (résiduel mesuré : 0,71 unité-monde ; tolérance du test : 12).
6. **`revealFog()` recalcule le brouillard à chaque pas.** Donner une vision
   totale à un camp une seule fois ne tient pas : il faut la réappliquer
   avant chaque delta (voir `voirTout` dans le groupe `delta`).
7. **Un test qui ne peut pas échouer ne garde rien.** Le plafond des Moines
   de l'IA était vérifié après 15 minutes simulées par `monks <= 5` — or
   l'IA n'en produit aucun sur cette durée, donc le test passait à vide.
   Tester la RÈGLE (l'IA en met-elle un de plus quand elle en a déjà 5 ?)
   plutôt que d'attendre qu'elle se manifeste.
