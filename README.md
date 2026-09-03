# Âge des Conquêtes

Petit jeu de stratégie en temps réel (façon Age of Empires II) en HTML/JS/
Canvas — **aucune dépendance, aucun build, aucun outillage**.

## Jouer

Ouvrez [`index.html`](index.html) dans un navigateur (ou servez le dossier
avec n'importe quel serveur statique). Le jeu tourne aussi bien en local
qu'hébergé sur GitHub Pages.

## Organisation du code

Le code vivait dans un unique `<script>` de 13 500 lignes. Il est désormais
réparti en quatorze fichiers sous [`js/`](js/), chargés **dans l'ordre** par
`index.html` — ordre qui est significatif :

| Fichier | Contenu |
|---|---|
| `01-regles.js` | Constantes, tables d'unités et de bâtiments, armures et contres, difficultés, civilisations, types de carte, âges |
| `02-etat.js` | État global `G` et factions |
| `03-carte.js` | Génération de carte, naval, points d'intérêt, grille spatiale, brouillard |
| `04-entites.js` | `mkUnit` / `mkBuilding` et améliorations de bâtiments |
| `05-sprites.js` | Atlas pixel art, icônes, surcouche illustrée, teintes |
| `06-rendu.js` | Sol par pavés, entités, effets, mini-carte |
| `07-simulation.js` | Boucle `update`, séparation, pathfinding, récolte, combat, vagues |
| `08-ia.js` | Adversaire du mode Conquête |
| `09-entree.js` | Tactile, souris, clavier, sélection |
| `10-ordres.js` | Couche d'ordres — le seul point de mutation de l'état |
| `11-interface.js` | HUD, panneaux, sons, succès, bilan, pause, zoom |
| `12-reseau.js` | Transport, protocole, salon multijoueur |
| `13-cloud.js` | Connexion Google, Drive, sauvegarde et migration |
| `14-demarrage.js` | Boucle de jeu, démarrage de partie |

Ce sont des **scripts classiques**, pas des modules ES : ni `import`, ni
`export`. Ils partagent le même environnement lexical global, exactement comme
lorsqu'ils ne formaient qu'un seul bloc — le découpage est purement physique,
la sémantique est inchangée.

*Pourquoi pas des modules ES* : le code a été écrit dans une seule portée où
tout appelle tout, et son graphe de dépendances est massivement circulaire.
Des modules exigeraient de dénouer ces cycles un par un — une réécriture, pas
un découpage. Et surtout, un module ES est refusé en `file://` par la
politique d'origine des navigateurs : passer aux modules coûterait la
possibilité d'ouvrir le jeu par un double-clic, que les scripts classiques
préservent.

## Tests

```bash
node tests/run.js
```

110 tests, 15 groupes, ~35 s, sans dépendance ni build — comme le jeu. Ils
couvrent ce qui ne se voit pas à l'écran : la sérialisation réseau
(instantané **et** delta), le déterminisme de la carte, la validation des
ordres côté hôte, l'économie, les montees d'âge, la fin de partie, et des
invariants de CHARGE (budget de balayage du voisinage, ordre des tests dans
`nearestBy`, recul d'une recherche de chemin qui échoue, passe de séparation
qui survit à une population qui grossit). Voir
[`tests/README.md`](tests/README.md).

## Modes de jeu

Le mode se choisit sur l'écran-titre, en plus de la difficulté.

- **Survie** — le mode historique : des vagues d'assaut arrivent des bords de
  la carte, en survivre 20 donne la victoire. Des points d'intérêt (filons
  d'or inépuisables gardés par une garnison) récompensent l'offensive.
- **Conquête** — un seigneur rival joue avec les mêmes règles que vous : sa
  propre caisse de ressources, ses villageois qui récoltent réellement sur les
  gisements, ses chantiers, ses montées d'âge et ses armées. Aucune vague, et
  une seule condition de victoire de chaque côté : raser le Centre Ville
  adverse. Détruire ses fermes affame vraiment sa production, tuer ses
  villageois ralentit vraiment ses chantiers.
- **2 rivaux** — deux seigneurs IA, hostiles à vous ET entre eux. Le dernier
  Centre Ville debout l'emporte.
- **2v1 Coop** — vous et un allié (bouton *Jouer avec un ami*, voir plus bas)
  affrontez ensemble un seul seigneur IA, à la difficulté choisie sur
  l'écran-titre. Lancé seul, ce mode se joue comme la Conquête.

## Types de carte

Choisi sur l'écran-titre, à côté du mode et de la difficulté. Les cinq presets
ne sont **que des multiplicateurs** appliqués aux mêmes appels de génération :
la séquence de tirages aléatoires reste identique d'un preset à l'autre, donc
le déterminisme partagé hôte/client tient tel quel.

| Carte | Ce qui change |
|---|---|
| **Plaines** | Équilibrée — la carte historique du jeu |
| **Grande Forêt** | Bois surabondant, or et pierre rares |
| **Terres Arides** | Peu d'arbres, filons généreux, lacs deux fois plus petits |
| **Grands Lacs** | Beaucoup d'eau et de poisson — le Quai devient une économie |
| **Arène** | Chaque camp démarre derrière une palissade à quatre portails |

Chaque preset porte aussi son **sol** (table `SOLS`, `01-regles.js`) : une
teinte de biome et une densité de clairières de terre battue, plus la couleur
correspondante en mini-carte. Sans ça, les cinq cartes se ressemblaient trait
pour trait une fois en jeu — même vert, même texture — et seule la densité des
ressources les distinguait. Ce sont des réglages posés **par-dessus la même
texture d'herbe procédurale** : aucune texture supplémentaire à générer, donc
aucun coût d'atlas ni de mémoire.

Ce qu'on ne trouvera PAS, et pourquoi : pas de « Forêt Noire » (les arbres ne
bloquent aucun passage, une muraille d'arbres serait purement décorative), pas
d'« Îles » (sans navire de transport, les camps seraient inatteignables et la
partie ne pourrait pas se terminer).

## Contenu

- Récolte de ressources (bois, pierre, or, nourriture), construction de
  bâtiments, entraînement d'unités, montée en âge, recherches.
- Portails, murs, tours, château fort, atelier de siège, avant-poste...
- Brouillard de guerre façon AoE2 (zones inexplorées entièrement noires,
  zones explorées mais hors champ de vision en brouillard translucide).
- Bilan chiffré en fin de partie (guerre, empire, récolte) affiché aussi bien
  sur la victoire que sur la défaite.
- 22 succès persistants (locaux, ou synchronisés sur Google Drive une fois
  connecté — voir *Sauvegarde cloud*), consultables depuis l'écran-titre et
  le menu pause, avec bandeau de déblocage en cours de partie.
- Groupes de contrôle : `Ctrl+1..9` assigne la sélection courante, `1..9` la
  rappelle, un second appui rapide sur le même chiffre recentre la caméra
  dessus (fiable au clavier AZERTY comme QWERTY).
- Plafond de population : **300 par camp**, à tous les âges — de quoi mener
  de vraies batailles rangées. La vitesse de jeu se règle sur ×1 ou ×2
  (le ×3 a été retiré : trop lourd à forte population).
- Adversaires IA qui **continuent de croître toute la partie** : leur objectif
  d'économie monte avec le temps au lieu de plafonner après cinq minutes, ils
  enchaînent les montées d'âge et leurs assauts grossissent à chaque vague.
- ...et qui jouent bien **aux mêmes règles que vous**. Cinq écarts le
  démentaient encore, tous à leur désavantage, et tous fermés depuis :
  - une **Merveille adverse achevée** est leur urgence absolue — elles
    lâchent rassemblement et repli défensif pour s'y ruer. Elle valait
    auparavant moins qu'une grange dans leur table de cibles, si bien qu'une
    Merveille posée dans un coin gagnait toute partie de Conquête ;
  - elles **réparent** leurs bâtiments (au plus trois villageois à la fois),
    là où les dégâts de siège leur étaient définitifs quand les vôtres ne le
    sont pas ;
  - elles forment l'**unité unique de leur civilisation** à leur Château :
    trois civs sur quatre jouaient jusque-là comme des Francs ;
  - elles **troquent au Marché** pour dénouer un blocage de caisse, au lieu
    de rester à sec d'or avec trois mille bois dormants ;
  - elles bâtissent des **Immeubles** quand il manque beaucoup de places d'un
    coup, et un **Quai** là où il y a du poisson à pêcher — la pêche n'est
    plus une économie réservée au joueur sur « Grands Lacs ».

Le sol est lui aussi procédural, et chaque type de carte a sa propre
matière : huit variantes de texture (× quatre miroirs) peintes dans la
palette de la carte, avec ses propres brins, son grain et ses décors —
champignons et fougères en sous-bois, cailloux et terre craquelée en
steppe. Ce n'est pas un voile de couleur posé sur une herbe unique : un
voile ne change pas une matière, il efface celle qu'il recouvre.

Le rendu (bâtiments, unités, icônes) est généré en pixel art par code
directement en `<canvas>` — et progressivement enrichi par des illustrations
IA en surcouche (voir *Assets illustrés* ci-dessous).

## Performances

Le jeu vise 60 images/seconde sur une carte de 240×240 cases — la taille par
défaut, réglable de 120×120 à 320×320 sur l'écran-titre — avec plusieurs
centaines d'unités. Quatre caches portent l'essentiel du travail :

- **Détourage des illustrations** — fait une fois par planche et par
  résolution de travail, jamais rejoué au zoom.
- **Atlas de sprites** — régénéré seulement sur des barreaux d'échelle
  discrets (et non pour chaque cran de molette), par étapes réparties sur
  plusieurs images, avec bascule atomique : aucune image ne montre un atlas
  à moitié reconstruit.
- **Sol par pavés** — l'herbe, la teinte de biome, les clairières de terre et
  les lisérés de rive sont statiques, donc pré-rendus par pavés de 8×8 cases ;
  seule l'eau, animée, est repeinte à chaque image. Les clairières sont
  déterministes par position de pavé et débordent sur les neuf pavés voisins,
  pour n'être ni tranchées à la couture ni déplacées quand un pavé est purgé
  du cache puis regénéré.
- **Calques de macro-variation** — deux motifs répétés en coordonnées monde
  (une douzaine de cases, puis une quarantaine) qui cassent la platitude du
  tapis d'herbe pour un `fillRect` chacun par image, quel que soit le nombre
  de cases à l'écran. Le calque large a une texture de taille FIXE, agrandie
  par le motif lui-même : indexée sur `TILE`, elle aurait pesé 26 Mo au zoom
  maximum.
- **Fond de mini-carte** — recalculé au rythme du brouillard de guerre (cinq
  fois par seconde) au lieu de balayer les 57 600 cases à chaque image.

Le HUD n'écrit dans le DOM que lorsqu'une valeur affichée change réellement.

## Assets illustrés (surcouche optionnelle sur le rendu procédural)

Un deuxième niveau de rendu, purement additif : au démarrage, le jeu tente de
charger des sprites illustrés depuis le dossier `assets/` (`assets/ressources/`,
`assets/batiments/`, à terme `assets/unites/` et `assets/effets/`) et les
substitue au dessin procédural correspondant une fois chargés et détourés
(flood fill du fond quasi-blanc, recadré sur le contenu). **Aucune régression
possible** : tant qu'un fichier est absent, le sprite procédural déjà en place
reste utilisé tel quel — le jeu fonctionne à l'identique sans le dossier
`assets/`.

**Couverture complète** à ce jour : les 4 icônes de ressources, les 21
bâtiments, les 18 unités, les 6 gisements de la carte (arbre, pierre, or,
baies, poisson, viande), la faune (cerf, sanglier) et les objets uniques
(relique, caravane). Seuls les effets ponctuels (particules, projectiles)
restent volontairement procéduraux : trop brefs pour justifier une
illustration. Voir `assets/README.md` pour la convention de nommage et le
format attendu.

L'illustration d'un bâtiment couvre **toutes ses variantes** par défaut —
habillages d'âge de la Caserne et du Mur, niveaux de la Tour, portail ouvert.
Conséquence assumée : ces bâtiments ne changent pas d'aspect en montant d'âge
(une seule illustration par type). Le Portail ouvert fait exception et reste
distinct, peint en translucide : c'est un état de jeu — on passe ou on ne
passe pas — pas une simple coquetterie.

Le **Centre Ville** a, lui, une illustration **dédiée par palier d'âge** (Âge
Sombre / Féodal / Châteaux / Impérial), pour que le bâtiment le plus visible
de la carte montre vraiment la progression de la partie. Voir
`BLD_AGE_SPRITE_FILES` dans `js/05-sprites.js` pour ajouter cette même couverture
à un autre bâtiment.

Le Centre Ville a en plus une illustration **dédiée par civilisation**, croisée
avec les quatre âges — **complète pour les quatre camps jouables** :
- **Francs** : château de pierre occidental (le style de base, sans fichier
  à part — c'est déjà son identité).
- **Byzantins** : dômes dorés, appareillage de brique, mosaïques, croix et
  bannires pourpres.
- **Chinois** : pagode à toits relevés (1 à 4 étages selon l'âge), bois
  laqué rouge, dragons dorés, lanternes.
- **Mongols** : yourte de feutre sur base fortifiée en bois, étendards en
  queue de cheval, camp qui s'étend (plusieurs yourtes) aux âges avancés.

Voir `BLD_CIV_SPRITE_FILES` dans `js/05-sprites.js` pour étendre cette couverture
à un autre bâtiment.

Le détourage de chaque planche n'est fait **qu'une seule fois par partie** et
mis en cache : c'est de loin l'opération la plus coûteuse du pipeline de
sprites, et la rejouer à chaque changement de zoom gelait le jeu plus d'une
seconde par cran de molette.

## Connexion Google (compte unique — sauvegarde cloud + multijoueur)

Optionnelle et désactivée par défaut : sans configuration, le jeu utilise
uniquement le stockage local (`localStorage`, ou `window.storage` dans
Claude Canvas) et le solo reste inchangé. Une fois configurée, **un seul**
bouton ☁️ *Connexion Google* (écran-titre, menu pause, panneau *Jouer avec un
ami*) sert à la fois :

- la **sauvegarde cloud** — manuelle et auto — suit le compte Google du
  joueur plutôt que l'appareil (fichier caché dans son propre Drive, dossier
  `appData` — invisible dans son Drive normal, illisible par toute autre
  application) ;
- l'**identité multijoueur/classement** (1v1 en ligne, coop 2v1) — le même
  `uid` sert à retrouver un ami et à publier un score.

Techniquement, tout repose sur **Firebase Authentication** (`GoogleAuthProvider`,
avec le scope Drive `drive.appdata` demandé en plus au moment du consentement)
— voir `window.MP.connecter` dans le bloc `<script type="module">` d'`index.html`
+ CONNEXION GOOGLE ». Un seul écran de consentement Google couvre les deux
usages ; se connecter depuis n'importe lequel des trois boutons connecte
partout ailleurs dans l'app.

**Déjà configuré** pour `https://automateam.fr` (projet Google Cloud
`age-des-conquetes`, API Drive activée, écran de consentement en statut
*Test*, `FIREBASE_CONFIG` déjà renseigné dans `index.html`). Tant que l'appli
reste en *Test*, seuls les comptes Google ajoutés comme « utilisateurs test »
peuvent se connecter (jusqu'à 100, sans passer par la vérification Google) —
ajouter quelqu'un : Google Cloud Console → projet *age-des-conquetes* →
**Google Auth Platform → Audience → Add users**.

L'identité (uid, pseudo) est persistée entre deux rechargements de page —
c'est Firebase qui s'en charge seul, aucun backend requis. Le jeton Drive,
lui, n'est rendu qu'au moment du popup de consentement et n'est pas
mémorisable ; il suffit de recliquer une fois par session de navigateur.

## Multijoueur 1v1 en ligne (Firebase)

Optionnel et **désactivé par défaut** : sans configuration, le bouton
👥 *Jouer avec un ami* explique qu'il n'est pas configuré et tout le reste du
jeu fonctionne exactement comme avant (le module réseau n'appelle même pas le
CDN Firebase tant qu'il n'est pas configuré ; le bouton ☁️ *Connexion Google*
reste alors caché partout, y compris pour la sauvegarde cloud — voir section
précédente).

L'architecture est *hôte autoritaire* : celui qui crée la partie fait tourner
la simulation, l'autre lui envoie des ordres et reçoit l'état. Firebase sert
uniquement à l'authentification, au salon et à la mise en relation ; la partie
elle-même passe en **WebRTC pair-à-pair**, avec repli sur un relais Firebase
si le pair-à-pair échoue.

Le bouton 👥 *Jouer avec un ami* vit délibérément juste sous le sélecteur de
mode/difficulté/civilisation de l'écran-titre plutôt que dans les
utilitaires (Succès/Classement/Contrôles) : la séquence est "je choisis mon
mode, puis je retrouve un ami dessus" — le panneau qu'il ouvre reprend tel
quel le mode déjà choisi, aucun second sélecteur à l'intérieur. Il se
présente comme un lobby en trois étapes — Compte → Retrouver un ami → Salon
— une seule carte visible à la fois selon où on en est ; le code du salon
s'affiche en grand et se partage via `navigator.share` quand le navigateur le
permet (sinon copie presse-papiers), et un bouton *Quitter le salon* permet
de renoncer à une
partie créée/rejointe sans avoir à fermer tout le panneau.

### Configuration

1. [console.firebase.google.com](https://console.firebase.google.com/) →
   ajouter Firebase au projet Google Cloud existant (`age-des-conquetes`).
2. **APIs et services → Bibliothèque** → activer *Google Drive API* (sert à
   la sauvegarde cloud, voir section précédente — même projet, même
   consentement).
3. **Realtime Database → Créer une base** (choisir une région proche, ex.
   `europe-west1`), démarrer en mode verrouillé.
4. **Authentication → Sign-in method** → activer le fournisseur **Google**.
5. **Authentication → Settings → Domaines autorisés** → ajouter le domaine
   d'hébergement (`automateam.fr`) ; `localhost` y est déjà par défaut.
6. **Paramètres du projet → Vos applications → Web** → copier l'objet de
   configuration dans `index.html`, constante `FIREBASE_CONFIG` (dans le bloc
   `<script type="module">`, tout en bas). Ces valeurs sont **publiques** : la
   sécurité repose entièrement sur les règles ci-dessous, appliquées côté
   serveur.

Un `file://` direct ne fonctionne **pas** avec la connexion Google (ni
Drive, ni multijoueur) : un serveur statique est nécessaire, même en local
(`http://localhost:PORT`).

### Règles de sécurité Realtime Database

À coller dans **Realtime Database → Règles**. Elles garantissent qu'un joueur
ne peut lire ni écrire que dans les salons dont il fait partie.

```json
{
  "rules": {
    "parties": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('hote/uid').val() === auth.uid || newData.child('invite/uid').val() === auth.uid || data.child('invite/uid').val() === auth.uid)",
        ".validate": "newData.hasChildren(['hote','etat'])"
      }
    },
    "signal": {
      "$code": {
        ".read":  "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        ".write": "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        "ice": {
          "$role": {
            "$id": { ".validate": "newData.hasChild('candidate') && newData.child('candidate').val().length < 512" }
          }
        }
      }
    },
    "relais": {
      "$code": {
        ".read":  "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        ".write": "auth != null && (root.child('parties/'+$code+'/hote/uid').val() === auth.uid || root.child('parties/'+$code+'/invite/uid').val() === auth.uid)",
        "$dest": {
          "$id": { ".validate": "newData.hasChild('charge')" }
        }
      }
    },
    "presence": {
      "$code": {
        ".read": "auth != null",
        "$uid": { ".write": "auth != null && auth.uid === $uid" }
      }
    },
    "classement": {
      "survie": {
        ".read": "auth != null",
        ".indexOn": "valeur",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 9999"
        }
      },
      "conquete": {
        ".read": "auth != null",
        ".indexOn": "valeur",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 36000"
        }
      },
      "conquete2": {
        ".read": "auth != null",
        ".indexOn": "valeur",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 36000"
        }
      },
      "coop2v1": {
        ".read": "auth != null",
        ".indexOn": "valeur",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['nom','valeur','ts']) && newData.child('valeur').isNumber() && newData.child('valeur').val() >= 0 && newData.child('valeur').val() <= 36000"
        }
      }
    }
  }
}
```

**Codes de partie.** Cinq caractères sans ambiguïté visuelle (ni `0`/`O`, ni
`1`/`I`/`L`), soit ~28 millions de combinaisons. C'est devinable par force
brute si beaucoup de salons coexistent : le salon passe donc à `plein` dès
l'arrivée du second joueur, expire au bout de 2 h, et ne contient aucune
information sensible. L'hôte le supprime en partant (`onDisconnect`).

**Reconnexion.** Une coupure de lien (wifi, onglet en arrière-plan) laisse
3 minutes pour revenir avant que l'hôte ne bascule le camp absent en IA. Si
c'est votre PROPRE page qui recharge ou plante, un bouton apparaît à
l'écran-titre pendant 15 minutes pour rejoindre le même salon et resynchroniser
l'état courant avec l'hôte (toujours actif, lui, puisque sa simulation n'a
jamais quitté la mémoire) — limité au rôle client, l'hôte étant seul dépositaire
de l'état autoritatif.

**Classement en ligne.** Léger et optionnel, réutilise la même connexion
Firebase que le multijoueur (bouton 🥇 *Classement* sur l'écran-titre — la
connexion se fait depuis le panneau *Jouer avec un ami*, mais le classement N'EST
PAS réservé au multijoueur : une victoire solo contre l'IA y figure tout
autant qu'une victoire 1v1 réelle). Une seule entrée par joueur et par
catégorie (sa MEILLEURE valeur, pas un historique) — **quatre** catégories,
une par mode : meilleure vague atteinte en Survie (`survie`), victoire la
plus rapide en Conquête (`conquete`), en 2 Rivaux (`conquete2`) et en 2v1
Coop (`coop2v1`) — jamais mélangées entre elles, une victoire solo contre 1
IA et une victoire à trois camps hostiles en 2 Rivaux ne se jouant pas à la
même vitesse. Envoyé automatiquement en fin de partie si connecté ; échoue
silencieusement sinon (comme le reste du multijoueur). Les règles
`classement/…` ci-dessus valident le type et bornent la valeur envoyée
(0-9999 vagues, 0-36000 s) — une protection minimale, pas une preuve
d'intégrité : un client signé peut toujours mentir dans cette fourchette,
il n'y a pas de serveur de jeu faisant autorité pour la partie solo.

### NAT et TURN

Les serveurs STUN publics suffisent dans environ 75-85 % des cas. Derrière un
NAT symétrique (4G, certains réseaux d'entreprise), le pair-à-pair échoue et
il faudrait un serveur **TURN**, que Firebase ne fournit pas. Le jeu bascule
alors automatiquement sur un **relais Firebase** : fonctionnel, mais latence
150-400 ms et écritures facturées — d'où une cadence réduite et des envois
groupés. Un bandeau prévient le joueur. Pour un vrai confort en 4G, ajouter un
service TURN (Twilio, Metered, ou un `coturn` auto-hébergé) dans
`ICE_SERVERS`.

### Compte Google : une seule connexion

La sauvegarde Drive et le multijoueur partagent désormais la même connexion
Firebase (`signInWithPopup` avec le scope `drive.appdata` demandé en plus) —
voir « Connexion Google » plus haut. Un seul écran de consentement, un seul
bouton, où qu'on clique dessus dans l'app.
