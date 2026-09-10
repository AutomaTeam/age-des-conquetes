# Tests

```bash
node tests/run.js
```

Un groupe seul : `node tests/run.js reseau` — lui seul TOURNE, et un nom de
groupe inconnu sort en erreur au lieu d'afficher un `0/0` vert.

**210 tests, 16 groupes, ~45 s.** Les groupes `ia` et `delta` comptent pour
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
  nominaux. **Les 30 ordres sont désormais couverts** : douze ne l'étaient
  par rien du tout (`ATK`, `AMOVE`, `CHANTIER`, `REPARE`, `POSTURE`, `STOP`,
  `PORTAIL`, `AMELIORER_TOUR`, `AMELIORER_CAMP`, `CHASSER`, `PECHER`,
  `NAVIGUER`). Deux d'entre eux valent d'être connus : `PORTAIL` est vérifié
  DANS `G.bmap` et pas seulement sur `b.open` — une porte qui s'ouvre sans
  libérer sa case laisse le pathfinding la contourner ; et `AMELIORER_TOUR`
  garde le fait que les dégâts déjà subis ne soient pas effacés par une
  amélioration, ce qui en ferait un soin gratuit. **BATIR refuse le Centre
  Ville** (2026-09-07) : `BDEF[BT.TC].cost` vaut `{}` — juste pour que la
  table reste complète — et sans ce refus explicite, un ordre BATIR forgé
  posait un second Centre Ville gratuit, plafond de population doublé et
  élimination devenue impossible.
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
  testé jusque-là. **2026-09-07** : le réglage `autoRepair` voyageait
  correctement (test ci-dessus), mais ne faisait jamais rien pour l'invité —
  `nearestDamagedBuilding()` cherchait un bâtiment endommagé appartenant à
  `G.me`, jamais à `u.owner` ; comme `update()` ne tourne que côté hôte,
  G.me y vaut toujours SA faction, quelle que soit l'unité traitée dans la
  boucle. Aucune erreur, aucun exploit (`doRepair` rejette la cible mal
  assignée) — juste une fonctionnalité silencieusement morte pour le second
  joueur humain. Un test dédié garde qu'un Centre Ville d'invité endommagé
  finit RÉPARÉ, pas seulement que l'interrupteur est sur ON. Même défaut sur
  les PICS de partie (`peakPop`/`peakMil`/`peakFarms`/`campsCleared`,
  échantillonnés chaque image ou chaque seconde) et sur `bossKilled` : les
  deux ne visaient que `G.stats`/`moi()`, donc toujours l'hôte, jamais
  l'invité — cinq succès (Métropole, Grenier Plein, Chef de Guerre,
  Nettoyeur, Tueur de Seigneurs) restaient hors d'atteinte pour lui quoi
  qu'il construise ou tue réellement. Et `stats.killed`/`stats.lost`
  souffraient d'une AUTRE asymétrie : `if(estLocal(u)){lost++} else
  {tueur.killed++}` sautait le crédit de kill dès que la VICTIME était
  l'hôte — sans effet en coop, mais réel en « 2 rivaux » en ligne (l'ami y
  rejoint comme ADVERSAIRE hostile, pas seulement en allié) : les kills de
  l'invité SUR l'hôte ne comptaient jamais pour lui. Enfin, même une fois
  ces compteurs correctement attribués CÔTÉ HÔTE, ils ne voyageaient par
  AUCUN canal : `serialiserFaction` n'inclut jamais `stats` dans le flux
  régulier (2,1 Ko à lui seul, et ça bouge à quasi chaque image — voir le
  commentaire de `construireDelta`). `appliquerBilanFin` recopie donc
  désormais le bilan de fin de partie ('FIN', déjà envoyé pour l'écran à
  deux colonnes) dans `G.factions[id].stats`, et relance
  `checkAchievements()` pour rattraper une détection locale de fin de
  partie trop précoce. Restait un dernier trou : `envoyerBilanReseau()`
  n'était appelée que depuis showVictory/showGameOver, donc seulement
  quand G.me — L'HÔTE LUI-MÊME — gagne ou perd. En coop 2v1 ou 2 rivaux en
  ligne, chaque camp a son propre Centre Ville : un invité éliminé tôt
  tombait sur son écran de défaite (stats encore à zéro) bien avant que
  l'hôte ne termine sa PROPRE partie — parfois jamais, s'il quitte après
  sa défaite. La boucle d'élimination envoie maintenant le bilan dès qu'un
  joueur HUMAIN (jamais l'IA — bruit réseau inutile, elle n'a pas de
  succès) tombe, sans attendre l'hôte.
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
  Piquier) et les invariants de `degatsContre`. Garde aussi la RIPOSTE
  (2026-09-07) : jusque-là, une unité ne remarquait un agresseur QUE par le
  balayage périodique de doIdle/doAMove, à un rayon proportionnel à SA
  PROPRE portée — jamais à celle de l'attaquant, et JAMAIS en 'moving'. Le
  triangle lui-même en souffrait par intermittence (un Chevalier qui
  n'engageait pas toujours l'Archer à temps, surtout la nuit ou loin du
  Centre Ville). `dealDmg()` fait maintenant riposter la cible dès le
  premier coup reçu, sauf garde posté (`camp` non nul, dormance
  volontaire — voir `majPhaseAssaut`) ou combat déjà engagé.
- **`civilisations`** — unité unique et recherche exclusive refusées aux
  autres camps, même par ordre réseau forgé ; bonus économiques réels. Plus
  l'INTÉGRITÉ des tables (`PRODUCTION`, `TCOST`, `CIVS`, `BONUS`), écrites à
  la main donc sujettes à dérive : elles se lisent partout sans garde, et une
  entrée qui désigne un type inexistant ne lève pas — elle rend `undefined`.
  Une unité formable absente de `TCOST` serait GRATUITE, une unité unique mal
  orthographiée rendrait sa civilisation muette. Depuis que l'invité d'une
  partie en ligne choisit SA civilisation, ce groupe garde aussi ce trajet :
  son choix arrive bien sur `FAC.P2` (toutes les civs, y compris la même que
  l'hôte), le repli tient quand il ne publie rien (invité en version
  antérieure), le champ voyage dans le SALUT, et le sélecteur du salon reste
  synchronisé avec celui de l'écran-titre.
  La liste des civilisations testées est **dérivée de `CIVS`**, jamais
  recopiée : elle était écrite en dur, si bien qu'ajouter une cinquième
  civilisation laissait tout le groupe au vert sans jamais l'avoir testée.
  Trois replis SILENCIEUX y sont désormais gardés, parce qu'aucun ne lève et
  qu'aucun ne se voit sans jouer : une civ absente de `HEROES` sortirait
  Charlemagne sous son propre drapeau ; une unité unique absente de
  `UNIT_ICO` sortirait un '⭐' ; et une unité unique sans planche ni case
  dédiée dans `buildUnitSprite` sortirait sous la silhouette humanoïde
  générique — une Roulotte de Guerre en fantassin à tunique brune. Même
  logique côté décor : chaque civ non franque doit avoir soit un jeu de
  planches, soit une livrée (`CIV_LIVERY`), faute de quoi elle jouerait dans
  un bourg franc. Enfin les deux bonus gitans, qui passent par des chemins
  que rien d'autre ne couvrait — une boucle de simulation (`updateTradeRoutes`,
  lue sur la civ du PROPRIÉTAIRE du Marché, pas du joueur local) et la vitesse
  d'un civil — et « Roues Cerclées », dont le libellé nomme trois unités : le
  test vérifie que ce sont EXACTEMENT celles qui accélèrent, ni plus (un bonus
  caché sur toute l'armée) ni moins (une des trois oubliée). **2026-09-07** :
  l'aperçu de construction (`drawGhost`, avant de poser un bâtiment) faisait
  `SPR.bld[G.buildType]` — une table plate, sans passer par
  `civKeyOf`/`BLD_CIV_SPRITE_FILES` comme `drawBuildings`. L'aperçu montrait
  donc TOUJOURS la planche générique non teintée, et le bâtiment de la
  civilisation du joueur n'apparaissait qu'une fois RÉELLEMENT posé —
  signalé par l'utilisateur, vérifié en jeu (Gitanos : la Caserne prévisualisée
  et celle posée sont maintenant le même sprite, confirmé par comparaison
  d'identité d'objet). Pas de rendu dans ce test (voir la note en tête de
  fichier) : il vérifie par lecture de source que `drawGhost` consulte bien
  la même table que le bâtiment réel.
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
  Garde aussi la prime en or à la mort d'une unité (2026-09-07) : le code ne
  distinguait le pillard de vague de l'armée de l'IA de Conquête QUE par le
  TYPE d'unité — or l'IA recycle EXACTEMENT le même roster reskinné
  (`AI_TRAINERS`), donc harceler son armée finançait la partie du joueur à
  sa place (4 à 15💰 par mort, sans limite). Et le Seigneur de Guerre, la
  mort la plus dure du jeu, ne payait JAMAIS les 200💰 promis par sa propre
  formule : cette branche était inatteignable, coincée dans le `else` du
  test « ce type EST un Seigneur de Guerre », qui ne fait que compter
  `bossKilled`.
- **`ages`** — les bonus de montee d'age s'appliquent rétroactivement, et
  une unité formée APRÈS a exactement les mêmes statistiques qu'une unité
  relevée. C'est l'invariant qui casse le plus discrètement. Garde aussi
  qu'un chantier tout juste posé (progress:0) ne loge PERSONNE : `updatePopCap`
  ignorait `constructing`, et une simple fondation de Maison faisait sauter
  le plafond de population avant le premier coup de marteau (2026-09-07).
- **`finpartie`** — élimination, victoire, défaite, et la Merveille qui ne
  doit PAS donner la victoire avant son délai. Ce groupe garde aussi une
  famille à part : **ce que l'interface PROMET doit être ce que le code
  FAIT**. Chacun de ces tests correspond à un libellé qui a menti à un
  joueur, sans que rien ne le signale — d'où un test plutôt qu'une simple
  correction. Aucun mode à vagues proposé en ligne (leur victoire n'est
  évaluée que par l'hôte) ; chaque onglet Solo/Multi garde au moins un mode
  et ne perd pas le choix du joueur ; le raccourci d'émotion fonctionne sur
  un clavier **AZERTY** (`e.code`, pas `e.key`) ; aucun texte de difficulté
  ne parle de vagues dans un mode qui n'en a pas ; aucune civilisation
  n'annonce une unité que les quatre camps peuvent former ; le gain de
  population affiché est celui qui est réellement appliqué ; une unité qui
  résiste aux contres le dit à l'écran ; le Héros n'est pas perdu pour la
  partie si son Château tombe pendant sa formation ; une attente de
  reconnexion ne se fait pas dégeler par la reprise de pause ; et quitter
  après un écran de fin ne laisse pas le joueur sans écran-titre.
- **`ia`** — plafond des Moines, atelier de siège au roster, et l'assaut qui
  passe bien par un rassemblement. **2026-09-07 : la fortification de l'IA**
  (`aiFortify`, chantier « murs de l'IA » écarté à l'audit du 2026-08-28,
  repris sous une forme volontairement bornée) — une LIGNE de palissade
  tournée vers l'ennemi le plus proche, jamais un anneau fermé (les 270°
  restants du pourtour ne sont jamais murés, quel que soit l'endroit où l'IA
  récolte), avec un unique portail resté OUVERT sur la ligne directe vers la
  cible. Un test garde qu'aucune section ne se pose au DOS de la base ; un
  autre — le plus important — qu'un gisement pris sur le tracé est SAUTÉ,
  jamais rasé comme le fait `poserMursArene` pour la palissade de départ de
  l'Arène (qui, elle, n'a rien à perdre : posée avant toute économie). C'est
  ce second test qui a trouvé le vrai bug de la première version : un
  portail OUVERT marque sa case `bmap=0`, exactement comme une case libre —
  sans un recensement à part par POSITION (pas par l'état du terrain),
  chaque passage en reposait un nouveau par-dessus, indéfiniment (53
  portails empilés sur la même case en une seule partie de test). Vérifié
  aussi hors suite automatisée par une partie de 40 minutes simulée
  (joueur increvable) : l'IA construit ses 32 sections, relance 7 assauts
  au travers de son propre portail sans jamais s'y bloquer, et ses
  villageois ne connaissent aucune image où ils sont tous inactifs faute de
  chemin vers un gisement.
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
  S'y ajoute la LECTURE DE PIXELS : tout décor peint par-dessus un sprite de
  bâtiment (la livrée de civilisation) doit savoir où le contenu est
  réellement peint, et la tentation est de le retrouver par `getImageData`.
  Mesuré en jeu : la première image après un changement de zoom passait de
  3,6 ms à 219 ms sur un camp de 39 bâtiments. Le rectangle est donc noté à la
  construction du sprite (champ `box`) et transporté par les copies. Deux
  tests le tiennent, et l'un des deux vérifie EXPRÈS la moitié négative — sans
  boîte, la lecture doit bien avoir lieu — sinon il passerait à vide le jour
  où le repli disparaîtrait. Ils comptent les appels plutôt que de les rendre
  fatals : `_contentBox` avale l'échec dans un `try/catch` (canevas « taint »),
  un test par exception ne prouverait rien.
  Enfin l'ÉTALEMENT de la reconstruction d'atlas : elle est découpée en étapes
  jouées une par image, donc c'est la PLUS LOURDE qui décide de l'à-coup
  ressenti au zoom, pas leur total. Le découpage d'origine partageait les
  bâtiments au NOMBRE de types et laissait toute la surcouche illustrée
  (générique 8,5 ms + par civilisation 15,7 ms) accrochée à une seule d'entre
  elles, à côté d'un procédural qui n'en coûtait que 1,5 : sept étapes entre
  0,7 et 9,6 ms, et une à 24-28 ms. Mesuré en jeu réel, pire image d'une
  session de molette : 50,7 ms avant, 21,3 ms après. Le test ne chronomètre
  rien — une mesure de temps serait instable en CI — il tient la STRUCTURE
  dont le temps découle : les deux surcouches sont appelées par tranches, ces
  tranches PAVENT exactement la liste des types (un type oublié, c'est un
  bâtiment qui repart en procédural au premier zoom ; un type traité deux
  fois, c'est du travail payé en double), et `buildBuildings` passe avant
  elles puisqu'il remet `SPR.bld`/`SPR.bldCiv` à zéro.

- **`promesses`** — « l'interface promet X, le code fait-il X ? ». Même
  famille que la fin du groupe `finpartie`, mais sur les mécaniques : ces
  défauts-là ne font planter RIEN, ne cassent aucun invariant, et sont
  invisibles à l'œil — c'est exactement pourquoi ils survivent. Cinq écarts
  trouvés à la lecture le 2026-09-10 :
  1. Les effets **rétroactifs de recherche** (`updateResearchFaction`)
     recopiaient à la main des listes de types PLUS COURTES que celles de
     `mkUnit` : Arc Renforcé, Cavalerie et Lance de Cavalerie ne rattrapaient
     pas les unités uniques de civilisation (Cataphractaire, Cavalier-Archer,
     Arbalétrier à Répétition). Un exemplaire déjà sur la carte restait
     définitivement plus faible que le suivant formé au Château. Les quatre
     listes vivent maintenant en `*_BONUS_TYPES` (js/04-entites.js) et sont
     LUES des deux côtés. Les tests comparent une unité née AVANT à une née
     APRÈS : cette formulation attrape l'erreur dans les deux sens.
  2. Le **re-semis gratuit des Francs** ne valait que pour un joueur humain :
     `updateBuildings` ne fait passer par `tryAutoReseed` que les fermes des
     factions humaines, et le chemin propre à l'IA (`aiResemer`) ignorait le
     bonus. Or l'IA est franque dès que le joueur ne l'est pas.
  3. **« Allié » veut dire ÉQUIPE.** L'aura du Héros (`heroAuraMult`) et le
     soin de l'Hospice ne portaient que sur le PROPRIÉTAIRE, alors que la
     fiche d'unité annonce « aux alliés proches », que le panneau de
     l'Hospice annonce « aux unités alliées » et que `drawHeroAuras` dessine
     déjà le cercle d'un COÉQUIPIER en doré (couleur alliée). En coopératif
     on massait donc son armée dans un cercle qui ne donnait rien. Les routes
     commerciales, elles, raisonnaient déjà par équipe. **Le Moine reste
     volontairement sur ses seules unités** : c'est un soin CIBLÉ, pas un
     effet de zone — et son libellé ne promet rien d'autre.
  4. Le **panneau d'une Tour** affichait l'ATK brute du palier pendant que
     `updateBuildings` tirait avec garnison + Feu Grégeois : une Tour de Guet
     byzantine garnie de cinq archers annonçait 14 et tirait 44. `bldAtk`
     (js/04-entites.js) est désormais le point unique, lu par le tir ET par
     l'affichage — même raison d'être que `towerMaxHp` juste à côté.
  5. Le **message de re-semis** facturait 30🪵 au joueur franc, démentant son
     bonus de civilisation au moment même où celui-ci jouait.

  **Deuxième passe (2026-09-10), même angle élargi — « et si on jouait en
  INVITÉ ? ».** Six écarts de plus, tous invisibles en solo :
  6. **`emettreOrdre` rendait « ça part » et rien d'autre à un client.** Son
     paramètre de prédiction existait mais aucun des 41 appels ne le passait,
     et onze sites lisaient `r.n`, `r.nom`, `r.dist`, `r.actif`… L'invité
     lisait « ⚔️ undefined unité(s) », « Construction de undefined lancée ! »,
     un cumul à **NaN** sur le bouton d'abri, et surtout « ⏹ Production
     continue **arrêtée** » au moment où il l'ACTIVAIT. Le paramètre est
     devenu un simple objet de champs prédits. **Un test mécanique relit les
     sources** et refuse tout `emettreOrdre` dont le résultat est interrogé
     sans prédiction ni repli explicite — c'est lui qui avait trouvé les onze.
  7. **`tradeRoute`, `wonderTimer` et le nombre de fermiers ne voyageaient
     pas** alors que l'interface du client les lit : Marché proposant
     « Envoyer une caravane » pendant que la route tournait déjà (sans moyen
     de l'annuler), décompte de Merveille figé jusqu'à la victoire, « 👷×N »
     jamais affiché. **PROTO_VERSION 6.** L'animation de caravane, elle, reste
     locale (`routeCompacte` ne transmet ni `t` ni `dur`) : la transmettre
     salirait le Marché à chaque delta pour du cosmétique.
  8. **L'or d'une caravane était calculé deux fois**, et le panneau avait
     oublié `tradeMult` : un Gitanos lisait « +22💰 » et touchait 33 — le
     bonus signature de sa civilisation, invisible là où il le cherche.
     `gainCaravane` est le point unique. **Deux tests, pas un** : celui qui
     tient la fonction ne tient PAS le fait que le panneau la lise (vérifié
     par mutation — remettre la formule recopiée dans l'interface ne faisait
     tomber aucun test), d'où un second test qui REND le panneau.
  9. **La barre de formation d'un bâtiment de l'IA valait NaN** : le rendu
     lisait `TTIME[type]` alors que le roster de l'IA est dans `AI_TTIME`, et
     que `trainTime()` existe pour interroger les deux. `fillRect` avale une
     largeur NaN sans un mot, donc la barre ne se remplissait jamais.

  À la même occasion, **MERVEILLE_WIN_TIME est passé de 300 à 600 s**. Deux
  conséquences à connaître : un indice de jeu annonçait encore « 5 minutes »
  en dur (désormais dérivé de la constante), et le test de victoire par
  Merveille ne peut plus simuler le délai entier avec `update()` — à 600 s,
  l'IA rase la base d'un joueur qui ne fait RIEN d'autre que poser sa
  Merveille, et le test échouait sur une défaite. Il garde maintenant une
  phase bout-en-bout courte (le vrai `update()` fait bien avancer le minuteur)
  puis pousse `updateWonders` seul.

  Chacun de ces tests a été vérifié par MUTATION : on remet le comportement
  d'avant, et le test doit tomber. Deux pièges d'outillage ont été payés en
  route — `forNearby` lit la GRILLE spatiale, donc c'est `rebuildGrid()` qu'il
  faut appeler et pas `rebuildIndex()` ; et le bouchon DOM n'a pas de
  `lastChild` (même piège que dans le groupe `triche`).

Le **rendu n'est pas testé** et ne doit pas l'être ici : les bouchons ne
dessinent rien — ces deux tests-là mesurent des APPELS, pas des pixels.

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
