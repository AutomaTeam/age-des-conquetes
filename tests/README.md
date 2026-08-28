# Tests

```bash
node tests/run.js
```

Un groupe seul : `node tests/run.js reseau` (groupes : `carte`, `reseau`,
`sauvegarde`, `chemin`, `combat`).

Aucune dépendance, aucun `npm install`, aucun build — comme le jeu lui-même.
Node 18+ suffit.

## Ce que ça teste, et pourquoi ça

Le jeu se relit très bien à l'écran : si une unité se déplace mal ou si un
bâtiment est mal dessiné, ça se voit. Ces tests couvrent donc uniquement ce
qui **ne se voit pas** :

- **`reseau`** — la sérialisation hôte → client. Une divergence n'apparaît
  qu'en partie en ligne, chez l'invité, et souvent plusieurs minutes après
  la cause. C'est le groupe le plus rentable : il a trouvé dès sa première
  exécution que `appliquerSnap` remettait les ~1900 cases de lac à 0 (l'eau
  est marquée `3` dans `bmap`, comme un bâtiment solide) — les lacs
  cessaient donc de bloquer le passage chez le client seul.
- **`carte`** — le déterminisme de la génération. Reliques, faune et
  poissons ne voyagent PAS en position sur le réseau : le client les
  régénère depuis la graine partagée. Si `genMap` cesse d'être déterministe,
  le multijoueur casse en silence.
- **`sauvegarde`** — `migrerSauvegarde` doit charger les formats anciens.
- **`chemin`** — contournement d'obstacle et ligne de vue.
- **`combat`** — le triangle de contres (Piquier > Chevalier > Archer >
  Piquier) et les invariants de `degatsContre`.

Le **rendu n'est pas testé** et ne doit pas l'être ici : les bouchons ne
dessinent rien.

## Comment ça marche

`harness.js` extrait le grand `<script>` classique d'`index.html` et
l'évalue dans un `vm` Node muni des bouchons de `stub-dom.js`. Les `const` de
premier niveau d'un script `vm` restent dans sa portée lexicale, d'où la
ligne d'export ajoutée à la fin du source.

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

Deux pièges rencontrés en écrivant ces tests, et qui reviendront :

1. **Les duels doivent opposer deux factions JUMELLES** (même genre, même
   civ, mêmes recherches). Opposer une escouade en marche d'attaque à une
   escouade sur l'automate ennemi ne compare pas des statistiques mais des
   automates, et le second gagne quoi qu'il arrive.
2. **La carte générée a des lacs, marqués `3` dans `bmap` comme les murs.**
   Un test de pathfinding qui choisit un point de départ en dur a de bonnes
   chances de partir dans un lac. Chercher une case libre.
