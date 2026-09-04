'use strict';
// ======================================================================
//  08-ia.js
// ======================================================================
// Adversaire complet du mode Conquete : economie, chantiers,
// recherches, montees d'age, et machine a phases des assauts.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ═══════════════════════════════════════════════════════════
//  MODE CONQUÊTE — ADVERSAIRE COMPLET
// ═══════════════════════════════════════════════════════════
// Contrairement aux vagues (des unités posées sur un bord à intervalle fixe,
// sans économie derrière), l'adversaire de Conquête joue AVEC LES MÊMES
// RÈGLES que le joueur : il possède sa propre caisse de ressources, ses
// villageois récoltent réellement sur les gisements de la carte et déposent
// dans SES entrepôts, il paie ses bâtiments, ses unités et ses montées d'âge.
// Le raser prive donc réellement son économie — détruire ses fermes affame
// sa production, tuer ses villageois ralentit ses chantiers.
//
// Choix d'implémentation : les villageois de l'IA réutilisent tels quels les
// états de récolte du joueur (doGather/doReturn/doBuild/doFarm, rendus
// agnostiques du camp via resPool/ageOf) et ses unités militaires réutilisent
// la boucle de combat existante (updateEnemyAI). L'IA n'ajoute donc qu'une
// couche de DÉCISION, pas une seconde simulation à maintenir en parallèle.

// Réglages par difficulté. Le joueur et l'IA jouent les mêmes règles : ce qui
// change est la dotation de départ de l'IA, sa taille d'économie visée, sa
// cadence d'assaut et un modificateur de puissance de ses troupes.
// `firstAtk` est distinct de `atkEvery` : il tient lieu de temps de paix
// initial, équivalent du FIRST_WAVE_DELAY du mode Survie. Sans lui, l'IA
// lançait son premier raid dès sa 6e unité — soit vers la 6e minute, alors
// que le joueur démarre avec 3 villageois et pas une seule caserne.
//
// Étalonnage 15/11/9/7 min, plancher remonté depuis 11/8/6/4.25 — toujours
// plus court que le répit du mode Survie à difficulté égale (25/15/12/9
// min), cohérent avec la nature des deux modes : en Survie la menace est un
// minuteur scripté qui monte en puissance lentement, en Conquête c'est une
// économie vivante qu'il faut continuer à presser.
//
// firstAtk n'est qu'un PLANCHER : l'assaut attend aussi que l'effectif
// atteigne atkMin (voir updateAI et refreshConquestBar, qui affiche "armée
// en formation" tant que ce n'est pas le cas). Vérifié par lots de parties
// simulées jusqu'au premier assaut, à chaque difficulté :
//   Facile   → prête en ~6 min en moyenne pour un plancher de 15 min (0/8 en retard)
//   Normal   → prête en ~5,5 min pour un plancher de 11 min (0/8 en retard)
//   Difficile→ prête en ~8,8 min pour un plancher de 9 min (effectif visé plus
//              lourd — atkMin:8 — le plancher a été relevé de 8 à 9 min pour
//              rester le facteur limitant, sans quoi la promesse affichée au
//              joueur ("8 minutes") mentait d'environ 1 min en moyenne)
//   Brutal   → prête en ~7,4 min pour un plancher de 7 min (atkMin:10 est
//              délibérément le SEUL réglage où l'effectif peut encore dépasser
//              lui-même le plancher : c'est la difficulté qui n'offre aucune
//              garantie de répit au-delà du strict minimum)
const AI_TUNE = {
  easy:   { start:{food:150,wood:120,stone:60, gold:60 }, vilTarget:8,  firstAtk:900, atkEvery:210, atkMin:4,  atkStep:2, hpMult:0.85, atkMult:0.85 },
  normal: { start:{food:220,wood:180,stone:100,gold:100}, vilTarget:12, firstAtk:660, atkEvery:165, atkMin:6,  atkStep:2, hpMult:1.00, atkMult:1.00 },
  hard:   { start:{food:320,wood:260,stone:160,gold:160}, vilTarget:16, firstAtk:540, atkEvery:130, atkMin:8,  atkStep:3, hpMult:1.15, atkMult:1.10 },
  brutal: { start:{food:460,wood:380,stone:240,gold:240}, vilTarget:20, firstAtk:420, atkEvery:100, atkMin:10, atkStep:3, hpMult:1.30, atkMult:1.25 },
};

// L'IA aligne les archétypes ennemis (Pillard, Archer Pillard, Cavalier Noir,
// Géant, Seigneur de Guerre) plutôt que les unités du joueur : leurs sprites
// sont déjà distincts et rouges, donc une armée adverse reste lisible d'un
// coup d'œil sans avoir à teinter les sprites du joueur.
const AI_TCOST = {
  [UT.VIL]:        { food:40 },
  [UT.ENEMI]:      { food:50,  gold:12 },
  [UT.ENEMIA]:     { food:25,  wood:35 },
  [UT.ENEMI_C]:    { food:70,  gold:35 },
  [UT.ENEMI_G]:    { food:110, gold:60 },
  [UT.ENEMI_BOSS]: { food:400, gold:300 },
  [UT.MONK]:       { food:45,  gold:20 }, // même tarif que le Moine du joueur — voir AI_TRAINERS[BT.MONASTERY]
  [UT.RAM]:        { wood:180, gold:60 }, // idem : pas de reskin « pillard », c'est le Bélier du joueur
};
const AI_TTIME = { [UT.VIL]:20, [UT.ENEMI]:16, [UT.ENEMIA]:19, [UT.ENEMI_C]:26, [UT.ENEMI_G]:34, [UT.ENEMI_BOSS]:70 };
// Coût d'une unité pour l'IA. Son roster reskinné a ses propres tarifs
// (AI_TCOST), mais tout ce qu'elle emprunte TEL QUEL au roster du joueur — le
// Moine, le Bélier, et désormais les unités uniques de civilisation — doit
// coûter exactement ce qu'il coûte au joueur : sinon la même unité aurait deux
// prix selon le camp qui la forme. Même principe que trainTime() juste
// au-dessus, qui interroge déjà TTIME avant AI_TTIME.
function aiCout(type){ return AI_TCOST[type]||TCOST[type]; }
// Durée d'entraînement, quel que soit le camp : la file de formation partagée
// (updateBuildings) sert les deux rosters.
function trainTime(type){ return TTIME[type]!=null?TTIME[type]:(AI_TTIME[type]||20); }

// Quel bâtiment produit quoi, côté IA.
const AI_TRAINERS = {
  [BT.TC]:       [UT.VIL],
  [BT.BARRACKS]: [UT.ENEMI,UT.ENEMIA,UT.ENEMI_G],
  [BT.STABLE]:   [UT.ENEMI_C],
  [BT.CASTLE]:   [UT.ENEMI_BOSS],
  // Le Moine n'a pas de reskin « guerrier » : civil des deux côtés, il sert
  // uniquement à ramasser les reliques (voir aiRelicHunt) — jamais au combat.
  [BT.MONASTERY]:[UT.MONK],
  // Sans atelier de siège, l'IA n'avait AUCUN moyen d'ouvrir une base murée :
  // il ne lui restait que le repli « je tape le mur parce que je suis
  // coincée » (voir updateEnemyAI), c'est-à-dire une unité de mêlée qui
  // gratte une palissade à dégâts réduits. Le Bélier est repris tel quel du
  // roster du joueur, comme le Moine : pas de reskin « pillard », il est
  // reconnaissable et sa fonction est lisible.
  [BT.SIEGE]:    [UT.RAM],
  // La Barque est reprise telle quelle du roster du joueur, comme le Moine et
  // le Bélier : elle ne combat pas (UDEF[UT.BOAT].naval), elle pêche. Sans
  // Quai, l'IA n'avait accès à AUCUNE nourriture d'eau — sur le preset
  // « Grands Lacs », où la pêche est censée être une économie à part entière,
  // elle était donc réservée au joueur.
  [BT.DOCK]:     [UT.BOAT],
};
// Au-delà d'une barque par banc à portée, chaque barque supplémentaire est une
// place de population et 60 bois jetés — même raisonnement que le plafond de
// Moines par relique.
const AI_BOAT_MAX = 4;
// Âge minimum requis pour chaque unité adverse (même logique de palier que
// les déblocages du joueur).
const AI_UNIT_AGE = { [UT.ENEMI_G]:2, [UT.ENEMI_BOSS]:3, [UT.RAM]:2 };

// Unité unique de la civilisation d'un camp, si son Château peut déjà la
// former — sinon null.
//
// L'IA reçoit bien une civilisation à sa création (voir initAI/civIA) mais ne
// formait QUE le Héros à son Château : le Cataphractaire, le Cavalier-Archer
// et l'Arbalétrier rapide n'existaient que du côté du joueur. Trois civs sur
// quatre jouaient donc exactement comme des Francs, et l'asymétrie des
// civilisations n'était qu'à moitié câblée.
//
// La règle (quelle civilisation, quel âge requis) est LUE dans PRODUCTION, la
// source de vérité de l'hôte — celle qui autorise ou refuse déjà la même
// unité au joueur. La recopier ici la ferait diverger au premier
// rééquilibrage. Lecture au tour de jeu et NON au chargement : PRODUCTION vit
// dans 10-ordres.js, chargé après ce fichier (voir l'ordre des <script> dans
// index.html), il n'existe pas encore quand celui-ci s'évalue.
function aiUniteUnique(a){
  const uniq=(CIVS[a.civ]||{}).unique;
  if(!uniq||typeof PRODUCTION==='undefined') return null;
  for(const o of (PRODUCTION[BT.CASTLE]||[])){
    if(o.u!==uniq) continue;
    if(o.civ&&o.civ!==a.civ) return null;
    if(o.age!=null&&a.age<o.age) return null;
    return uniq;
  }
  return null;
}

// `reserve` = ressources mises de côté et intouchables pour cette dépense.
// Sert à l'épargne de montée d'âge : sans elle, l'IA réinvestissait chaque
// pièce dans une unité de plus et restait bloquée à l'Âge Sombre toute la
// partie — c'est exactement l'erreur qu'un joueur débutant commet.
function aiAfford(cost,reserve,a){
  const p=a&&a.res;
  if(!p) return false;
  return Object.entries(cost).every(([r,v])=>(p[r]||0)-((reserve&&reserve[r])||0)>=v);
}
function aiSpend(cost,a){ const p=a.res; Object.entries(cost).forEach(([r,v])=>{ p[r]=Math.max(0,(p[r]||0)-v); }); }

// Applique à une unité fraîchement produite par l'IA le modificateur de
// DIFFICULTÉ (propre à l'IA), puis la poste en défense de la base. Les bonus
// d'âge, eux, sont désormais posés par mkUnit pour tous les camps : cette
// fonction ne les réapplique surtout pas, sous peine de les compter deux fois.
function aiAdoptUnit(u,a){
  a=a||fac(u); if(!a||a.genre!=='ia') return;
  const tune=AI_TUNE[G.difficulty]||AI_TUNE.normal;
  u.ai=true;
  // Les bonus d'âge sont déjà posés par mkUnit (ils valent pour tous les
  // camps depuis la refonte en factions) : il ne reste ici que le
  // modificateur de DIFFICULTÉ, propre à l'IA, et la mise en garde.
  u.hp=u.maxHp=Math.round(u.maxHp*tune.hpMult);
  if(u.type!==UT.VIL){
    u.atk=Math.round(u.atk*tune.atkMult);
    // Posté en garde autour de la base tant qu'aucun assaut n'est lancé :
    // réutilise le mécanisme de garnison des camps (campX/campY), qui sait
    // déjà ramener une unité à son poste après un combat.
    u.camp=a.id; u.campX=a.baseX; u.campY=a.baseY;
  }
}

// Recense les bâtiments de l'IA par type (terminés uniquement pour ce qui
// doit être opérationnel, chantiers inclus pour ne pas relancer deux fois le
// même bâtiment pendant qu'il se construit).
function aiCount(includeSites,a){
  const c={};
  for(const b of G.buildings){
    if(b.owner!==a.id) continue;
    if(b.constructing&&!includeSites) continue;
    c[b.type]=(c[b.type]||0)+1;
  }
  return c;
}

// Cherche une zone libre de w×h tuiles autour de (cx,cy), en spirale
// grandissante. Refuse l'eau et tout ce qui est déjà occupé (G.bmap!==0),
// exactement comme le contrôle de pose du joueur (updateGhost).
// `rnd` : générateur à utiliser pour l'angle de départ. L'installation des
// bases (initAI) en passe un SEMÉ, sans quoi deux joueurs partageant la même
// graine n'obtiendraient pas les mêmes emplacements de départ. En cours de
// partie (aiBuild), Math.random convient : seul l'hôte simule.
// `filtre(tx,ty)` — contrainte de TERRAIN optionnelle, en plus du simple
// « l'emprise est libre ». Un seul bâtiment en a besoin (le Quai, qui doit
// toucher l'eau), mais la passer en paramètre plutôt que de dupliquer toute la
// spirale de recherche évite d'avoir deux versions à tenir à jour.
function aiSpot(w,h,cx,cy,minR,maxR,rnd,filtre){
  rnd=rnd||Math.random;
  for(let r=minR;r<=maxR;r++){
    // ordre angulaire tiré au hasard : deux bâtiments successifs ne
    // s'alignent pas systématiquement du même côté de la base
    const a0=rnd()*Math.PI*2;
    const steps=Math.max(1,r*8); // r=0 : on teste quand même la case centrale
    for(let k=0;k<steps;k++){
      const ang=a0+(k/steps)*Math.PI*2;
      const tx=Math.round(cx+Math.cos(ang)*r), ty=Math.round(cy+Math.sin(ang)*r);
      if(tx<1||ty<1||tx+w>=COLS-1||ty+h>=ROWS-1) continue;
      let ok=true;
      for(let dy=0;dy<h&&ok;dy++) for(let dx=0;dx<w&&ok;dx++) if(G.bmap[ty+dy][tx+dx]!==0) ok=false;
      if(ok&&filtre&&!filtre(tx,ty)) ok=false;
      if(ok) return {tx,ty};
    }
  }
  return null;
}

// Gisement le plus proche d'un type donné, dans un rayon (en tuiles).
function aiNearestNode(type,x,y,maxTiles,a){
  let best=null,bd=(maxTiles||60)*BASE_TILE;
  for(const n of G.nodes){
    if(n.amt<=0||n.type!==type) continue;
    const d=Math.hypot(n.x-x,n.y-y);
    if(d<bd){bd=d;best=n;}
  }
  return best;
}

// Lance un chantier de l'IA : place le bâtiment, prélève son coût, applique
// ses PV d'âge, puis affecte des villageois au chantier.
function aiBuild(type,nearX,nearY,a){
  const d=BDEF[type];
  if(!aiAfford(d.cost,null,a)) return false;
  const cx=Math.round((nearX!=null?nearX:a.baseX)/BASE_TILE), cy=Math.round((nearY!=null?nearY:a.baseY)/BASE_TILE);
  // Le Quai est le seul bâtiment à contrainte de terrain : il doit toucher
  // l'eau, exactement comme côté joueur (voir le refus 'invalide' d'ORD.BATIR).
  // Il cherche donc bien plus loin que les 16 tuiles habituelles — une rive
  // n'est pas forcément au pied de la base. hasAdjacentWater vit dans
  // 09-entree.js, chargé après ce fichier : la garde `typeof` couvre le cas où
  // aiBuild serait appelé avant, jamais en jeu mais possible sous test.
  const rive=(type===BT.DOCK&&typeof hasAdjacentWater==='function')
    ? (tx,ty)=>hasAdjacentWater(tx,ty,d.w,d.h) : null;
  const spot=aiSpot(d.w,d.h,cx,cy,3,rive?46:16,null,rive);
  if(!spot) return false;
  aiSpend(d.cost,a);
  const b=mkBuilding(type,spot.tx,spot.ty,a.id);
  // mkBuilding lit déjà l'âge, la recherche (Maçonnerie) ET la civilisation
  // du PROPRIÉTAIRE passé en paramètre (ici a.id) — génériquement, pour
  // n'importe quel camp. L'ancien recalcul ici (ne tenant compte que de
  // l'âge) datait d'avant ce refactor et écrasait silencieusement les
  // bonus de recherche/civ de l'IA ; supprimé, mkBuilding suffit.
  b.ai=true; b.constructing=true; b.progress=0;
  b.aiStartT=G.gameTime; // sert de garde-fou anti-blocage — voir aiWatchSites
  b.aiCost=d.cost;
  placeBuilding(b);
  // 2 bâtisseurs : les villageois les plus proches, en priorité les inactifs
  const vils=G.units.filter(u=>u.owner===a.id&&u.type===UT.VIL&&u.state!=='build')
    .sort((p,q)=>{
      const pi=p.state==='idle'?0:1, qi=q.state==='idle'?0:1;
      if(pi!==qi) return pi-qi;
      return Math.hypot(p.x-b.x,p.y-b.y)-Math.hypot(q.x-b.x,q.y-b.y);
    });
  for(const v of vils.slice(0,2)){ quitterPoste(v); v.state='build'; v.buildTarget=b.id; v.target=null; }
  return true;
}

// Abandonne un chantier resté bloqué (voir l'appelant, dans updateAI) :
// libère ses bâtisseurs, rend la case franchissable et rembourse la moitié
// du coût — le site est perdu, pas l'investissement en entier.
function aiAbortSite(b,a){
  for(const u of G.units) if(u.owner===b.owner&&u.state==='build'&&u.buildTarget===b.id){
    u.state='idle'; u.buildTarget=null; u.scanCd=0;
  }
  if(a&&b.aiCost) for(const[r,v] of Object.entries(b.aiCost)) a.res[r]=(a.res[r]||0)+Math.round(v*0.5);
  for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++) if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=0;
  G.buildings=G.buildings.filter(x=>x.id!==b.id);
  G.sel=G.sel.filter(id=>id!==b.id);
}

// Prochain bâtiment à ériger, par ordre de besoin. La liste suit la même
// logique qu'une ouverture humaine : loger, nourrir, s'installer sur les
// ressources, puis militariser et fortifier.
// Marge de population que l'IA garde d'avance sur ses effectifs réels.
const AI_POP_MARGE = 15;

// Maison ou Immeuble ?
//
// L'IA ne bâtissait QUE des Maisons : 5 places pour 25 bois, soit cinquante-
// neuf chantiers successifs pour atteindre les 300 du plafond — autant de
// cycles de décision et de villageois immobilisés en chemin, là où un
// Immeuble en apporte 25 d'un coup.
//
// L'Immeuble n'est PAS un remplacement pour autant : la Maison reste moins
// chère au logement (5 bois la place, contre 6 bois + 4 pierre). C'est le bon
// choix quand il manque beaucoup de places D'UN COUP et que la pierre dort —
// et la pierre dort souvent chez l'IA, c'est sa ressource la moins pondérée
// (voir AI_RES_WEIGHT : 0,15).
const AI_HLM_DEFICIT = 12;   // places manquantes à partir desquelles l'Immeuble vaut le détour
function aiLogement(a){
  const manque=Math.min(AGE_BONUS[a.age].popCap,a.pop+AI_POP_MARGE)-a.maxPop;
  if(manque>=AI_HLM_DEFICIT&&aiAfford(BDEF[BT.HLM].cost,null,a)) return {type:BT.HLM};
  return {type:BT.HOUSE};
}

// ── TROC AU MARCHÉ ─────────────────────────────────────────
// L'IA bâtissait des Marchés — pour les routes commerciales — sans JAMAIS
// s'en servir pour échanger, quand le joueur convertit son surplus d'un clic.
// Une IA à sec d'or avec trois mille bois dormants restait bloquée pour de
// bon : ni Paladin, ni Trébuchet, ni montée d'âge.
//
// On ne troque que du VRAI surplus, et jamais pour combler un manque
// marginal : le taux est volontairement mauvais (100 donnés pour 60 reçus,
// voir TROCS) et échanger par réflexe brûlerait l'économie au lieu de la
// débloquer. Le plancher, lui, empêche de vendre le stock dont on a besoin
// tout de suite pour résoudre un manque à venir.
const AI_TROC_SURPLUS  = 1.6;  // au-delà de 1,6× sa part visée, c'est du surplus
const AI_TROC_MANQUE   = 0.55; // en deçà de 0,55× sa part, c'est un manque qui bloque
const AI_TROC_PLANCHER = 400;  // stock en deçà duquel on ne vend plus rien
function aiTroquer(a){
  // TROCS vit dans 10-ordres.js, chargé après ce fichier : même prudence que
  // pour PRODUCTION (voir aiUniteUnique).
  if(typeof TROCS==='undefined') return;
  if(!aiCount(true,a)[BT.MARKET]) return;      // pas de Marché debout, pas de troc
  const ratios=aiResRatios(a);
  for(const t of TROCS){
    if(ratios[t.recoit]>=AI_TROC_MANQUE) continue;             // rien à débloquer de ce côté
    if(ratios[t.donne]<AI_TROC_SURPLUS) continue;              // rien à donner
    if((a.res[t.donne]||0)-t.qte<AI_TROC_PLANCHER) continue;   // ne pas se vider
    a.res[t.donne]-=t.qte;
    a.res[t.recoit]=(a.res[t.recoit]||0)+t.rend;
    return;                                                    // un échange par passage, pas une rafale
  }
}
function aiNextBuild(vilCount,a){
  const c=aiCount(true,a);
  const n=t=>c[t]||0;
  // Fermes « de croisière », visées une fois l'essentiel (Mine, Caserne)
  // acquis — voir plus bas pourquoi elles ne bloquent plus rien avant ça.
  const farmTarget=Math.min(8, 2 + Math.floor((vilCount||0)/5));
  if(a.pop>=a.maxPop-2 && a.maxPop<AGE_BONUS[a.age].popCap) return aiLogement(a);
  if(!n(BT.LUMBER)){
    const t=aiNearestNode(RT.TREE,a.baseX,a.baseY,30,a);
    if(t) return {type:BT.LUMBER,x:t.x,y:t.y};
  }
  if(!n(BT.MILL)) return {type:BT.MILL};
  // Amorce vivrière minimale (2 fermes) puis on passe directement à la
  // pierre/or et à la Caserne. Avant cette réorganisation, le quota de
  // fermes grimpait avec l'âge (2+âge×2, jusqu'à 9) et devait être ATTEINT
  // avant que l'IA ne considère seulement construire une Mine ou une
  // Caserne : à petit effectif (Facile, 8 villageois visés), le village
  // entier finissait absorbé par les champs et l'IA ne s'armait jamais,
  // quelle que soit la durée de la partie.
  if(n(BT.FARM)<2) return {type:BT.FARM};
  if(!n(BT.MINE)){
    const t=aiNearestNode(RT.GOLD,a.baseX,a.baseY,44,a)||aiNearestNode(RT.STONE,a.baseX,a.baseY,44,a);
    if(t) return {type:BT.MINE,x:t.x,y:t.y};
  }
  // Quai : décidé sur ce que l'IA VOIT (des bancs à portée de sa base), pas
  // sur le type de carte. Sur une carte sèche la condition ne se déclenche
  // jamais et l'IA n'y pense plus ; sur « Grands Lacs » elle s'installe sur
  // l'eau comme le ferait un joueur.
  if(!n(BT.DOCK)&&aiNearestNode(RT.FISH,a.baseX,a.baseY,40,a)) return {type:BT.DOCK};
  if(!n(BT.BARRACKS)) return {type:BT.BARRACKS};
  // Forge dès la défense minimale assurée : sans elle, l'IA n'a jamais accès
  // aux recherches (voir aiResearch) et prend un retard technologique que le
  // joueur, lui, peut toujours combler.
  if(!n(BT.FORGE)) return {type:BT.FORGE};
  // Fermes supplémentaires : seulement si la nourriture stagne réellement,
  // jamais comme un quota théorique qui repousserait indéfiniment la suite.
  if(n(BT.FARM)<farmTarget&&a.res.food<300) return {type:BT.FARM};
  if(n(BT.TOWER)<1+a.age) return {type:BT.TOWER};
  // Capacité de production militaire indexée sur la main-d'œuvre : avec deux
  // casernes en tout et pour tout, une IA dont l'économie grossit ne pouvait
  // pas transformer ses ressources en armée, et sa croissance s'arrêtait là.
  const milTarget=Math.max(2,Math.min(6,Math.floor((vilCount||0)/12)+1));
  if(a.age>=1&&!n(BT.STABLE)) return {type:BT.STABLE};
  if(a.age>=1&&n(BT.BARRACKS)<milTarget) return {type:BT.BARRACKS};
  // Atelier de siège dès l'Âge des Châteaux, et AVANT toute l'économie
  // avancée (Marchés, Monastère, Université, Château) : sans lui l'IA reste
  // incapable d'ouvrir une base murée — c'est le premier mur, au sens
  // propre, contre lequel elle butait. Le placer en queue de liste revenait
  // à ne jamais le construire dans une partie de durée normale.
  if(a.age>=2&&!n(BT.SIEGE)) return {type:BT.SIEGE};
  if(a.age>=2&&n(BT.STABLE)<milTarget-1) return {type:BT.STABLE};
  // Économie avancée : Marché ×2 (route commerciale, voir aiTradeRoute),
  // Monastère (reliques, voir aiRelicHunt) et Université (recherches
  // avancées) — une fois la défense et la production de base en place.
  if(a.age>=1&&n(BT.MARKET)<2) return {type:BT.MARKET};
  if(a.age>=1&&!n(BT.MONASTERY)) return {type:BT.MONASTERY};
  if(a.age>=1&&!n(BT.UNIV)) return {type:BT.UNIV};
  if(a.age>=2&&!n(BT.CASTLE)) return {type:BT.CASTLE};
  if(n(BT.FARM)<farmTarget) return {type:BT.FARM}; // en dernier recours, jamais bloquant
  // Maisons de confort : seulement une MARGE au-dessus de la population
  // occupée, jamais jusqu'au plafond absolu. Depuis que ce plafond est haut
  // (300), bâtir « tant qu'on n'y est pas » transformait l'IA en lotisseur :
  // elle engloutissait tout son bois en maisons vides, n'avait plus de quoi
  // monter d'âge ni produire une seule unité, et son armée restait figée.
  if(a.maxPop<Math.min(AGE_BONUS[a.age].popCap,a.pop+AI_POP_MARGE)) return aiLogement(a);
  return null;
}

// Affecte un villageois inactif à la ressource la plus en retard. Le retard
// se mesure en écart à une répartition cible plutôt qu'en stock brut : sans
// ça, l'IA empilerait tout sur la ressource la moins chère à récolter.
const AI_RES_WEIGHT = { wood:0.34, food:0.30, gold:0.21, stone:0.15 };
// Écart de chaque ressource à sa part visée : < 1 = en retard, > 1 = en excès.
function aiResRatios(a){
  const p=a.res;
  const total=Math.max(1,p.wood+p.food+p.gold+p.stone);
  const out={};
  for(const[r,w] of Object.entries(AI_RES_WEIGHT)) out[r]=(p[r]/total)/w;
  return out;
}
// Ressource sur laquelle un villageois travaille actuellement.
const NODE_RES={ [RT.TREE]:'wood', [RT.STONE]:'stone', [RT.GOLD]:'gold', [RT.BERRY]:'food' };
function aiVilRes(u){
  if(u.state==='farm'||u.invT==='farm') return 'food';
  const n=nodeById(u.homeNode!=null?u.homeNode:u.target);
  return n?(NODE_RES[n.type]||null):null;
}
// Rééquilibrage périodique. Sans lui, une affectation ne se remet JAMAIS en
// question : quand son gisement s'épuise, doGather rebascule le villageois
// sur un gisement du MÊME type. L'IA se retrouvait donc avec toute sa
// main-d'œuvre figée sur le bois et la pierre des premières minutes, des
// milliers d'unités de surplus inutile, et une famine qui l'empêchait de
// monter d'âge ou de lever la moindre troupe.
function aiRebalance(vils,a){
  const ratios=aiResRatios(a);
  let worst=null,worstV=Infinity,over=null,overV=-Infinity;
  for(const[r,v] of Object.entries(ratios)){
    if(v<worstV){worstV=v;worst=r;}
    if(v>overV){overV=v;over=r;}
  }
  // Seuil : on ne déplace personne pour un déséquilibre marginal, sinon les
  // villageois passeraient leur temps sur la route au lieu de récolter.
  if(!worst||!over||worst===over||overV<worstV*1.6) return;
  const cand=vils.find(u=>u.state==='gather'&&aiVilRes(u)===over);
  if(!cand) return;
  crediterInventaire(cand); // sa charge en cours n'a rien à voir avec ce rééquilibrage, pas de raison de la perdre
  cand.inv=0; cand.invT=null;
  quitterPoste(cand); // sans ça, le gisement quitté garde un point de récolteur fantôme — ce rééquilibrage tourne toute la partie
  cand.target=null; cand.state='idle'; cand.scanCd=0; // aiAssignVillager le replacera
}
function aiAssignVillager(u,a){
  const ratios=aiResRatios(a);
  let worst=null,worstRatio=Infinity;
  for(const[r,v] of Object.entries(ratios)){
    if(v<worstRatio){worstRatio=v;worst=r;}
  }
  if(worst==='food'){
    // Nourriture : les baies d'abord (immédiat), sinon un champ de l'IA.
    const berry=aiNearestNode(RT.BERRY,u.x,u.y,32,a);
    if(berry){ u.state='gather'; u.target=berry.id; u.homeNode=berry.id; return; }
    const farm=findNearestFarm(u.x,u.y,true,u.owner);
    if(farm){ u.state='farm'; u.target=farm.id; u.homeFarm=farm.id; u.invT='farm'; return; }
  }
  const nodeType={wood:RT.TREE,stone:RT.STONE,gold:RT.GOLD,food:RT.BERRY}[worst];
  const nd=aiNearestNode(nodeType,u.x,u.y,50,a)||aiNearestNode(RT.TREE,u.x,u.y,50,a);
  if(nd){ u.state='gather'; u.target=nd.id; u.homeNode=nd.id; }
}

// ── RÉPARATION ─────────────────────────────────────────────
// L'IA ne réparait RIEN. Le joueur, lui, a une bascule dédiée (🔧
// réparation auto, voir toggleAutoRepair) qui remet ses villageois inactifs
// sur ses murs et son Centre Ville entre deux assauts. En Conquête, où les
// deux camps sont censés jouer aux mêmes règles, cela voulait dire que les
// dégâts de siège étaient DÉFINITIFS d'un côté et effaçables de l'autre :
// après trois assauts repoussés, le Centre Ville de l'IA restait à 40 % pour
// le restant de la partie.
//
// L'effort est borné volontairement : au plus AI_REPAIR_MAX villageois à la
// fois, et seulement pour des dégâts qui comptent (AI_REPAIR_SEUIL). Envoyer
// toute la main-d'œuvre retaper une palissade éraiflée arrêterait l'économie
// — exactement le travers que corrige déjà aiRebalance côté récolte.
const AI_REPAIR_MAX = 3;       // villageois détournés simultanément
const AI_REPAIR_SEUIL = 0.85;  // sous 85 % de PV, ça vaut le détour
function aiRepare(vils,a){
  // Un Centre Ville à 50 % passe avant une ferme à 20 % : on pondère le
  // manque de PV par l'importance du bâtiment, comme le ciblage d'assaut
  // pondère la distance par la priorité (voir nearPlayerBuildingSmart).
  let best=null,bestScore=-Infinity;
  for(const b of G.buildings){
    if(b.owner!==a.id||b.constructing||b.hp>=b.maxHp) continue;
    const ratio=b.hp/b.maxHp;
    if(ratio>AI_REPAIR_SEUIL) continue;
    const poids=b.type===BT.TC?3:(b.type===BT.TOWER||b.type===BT.CASTLE)?2:1;
    const score=(1-ratio)*poids;
    if(score>bestScore){ bestScore=score; best=b; }
  }
  if(!best) return;
  // Les réparateurs DÉJÀ à l'œuvre comptent dans le plafond : sans ce
  // décompte, chaque passage en ajoutait AI_REPAIR_MAX de plus et toute la
  // main-d'œuvre finissait sur le chantier en quelques secondes.
  let manque=AI_REPAIR_MAX;
  for(const u of vils) if(u.state==='repair') manque--;
  if(manque<=0) return;
  // On détourne les PLUS PROCHES : un villageois pris à l'autre bout de la
  // carte passerait l'essentiel du chantier en marche, et aurait lâché son
  // gisement pour rien.
  const libres=vils.filter(u=>u.state!=='repair'&&u.state!=='build')
                   .sort((p,q)=>Math.hypot(p.x-best.x,p.y-best.y)-Math.hypot(q.x-best.x,q.y-best.y));
  for(let i=0;i<manque&&i<libres.length;i++){
    quitterPoste(libres[i]);
    libres[i].state='repair'; libres[i].target=best.id;
  }
}

// Barque de l'IA au repos : elle repart pêcher d'elle-même.
//
// Appelée depuis la branche 'idle' d'updatePlayerUnit, et UNIQUEMENT pour un
// camp IA : côté joueur, une barque postée quelque part doit y rester, c'est
// un ordre. L'IA, elle, n'a personne pour lui en redonner un quand son banc
// s'épuise — sans cette relance, sa flottille de pêche s'arrêtait définiti-
// vement au premier banc vidé.
function aiAssignBoat(u){
  const n=aiNearestNode(RT.FISH,u.x,u.y,60,fac(u));
  if(n){ u.state='fish'; u.target=n.id; u.homeNode=n.id; }
}

// Villageois de l'IA : exactement la même machine à états que celle du
// joueur, plus une relance quand il se retrouve sans rien à faire.
function updateAIVillager(u,dt){
  switch(u.state){
    case 'moving': moveTo(u,dt); break;
    case 'gather': doGather(u,dt); break;
    case 'farm':   doFarm(u,dt);   break;
    case 'return': doReturn(u,dt); break;
    case 'build':  doBuild(u,dt);  break;
    // Sans ce cas, un villageois passé en 'repair' par aiRepare retombait
    // dans `default` et se faisait réaffecter à un gisement à l'image
    // suivante : la réparation n'aurait jamais commencé.
    case 'repair': doRepair(u,dt); break;
    default:
      u.scanCd=(u.scanCd||0)-dt;
      if(u.scanCd<=0){ u.scanCd=0.4+Math.random()*0.4; aiAssignVillager(u,fac(u)); }
  }
}

// Richesse en ressources critiques autour d'une case (tuile), dans le rayon
// où l'IA cherche effectivement à récolter (voir aiAssignVillager : 50
// tuiles pour bois/pierre/or, 32 pour les baies — on reste prudemment en
// deçà pour ne compter que ce qui est confortablement à portée).
function aiSiteRichness(tx,ty){
  const wx=tx*BASE_TILE, wy=ty*BASE_TILE, R=26*BASE_TILE;
  let stone=0,gold=0,tree=0,berry=0;
  for(const nd of G.nodes){
    if(Math.hypot(nd.x-wx,nd.y-wy)>R) continue;
    if(nd.type===RT.STONE) stone++;
    else if(nd.type===RT.GOLD) gold++;
    else if(nd.type===RT.TREE) tree++;
    else if(nd.type===RT.BERRY) berry++;
  }
  return {stone,gold,tree,berry};
}

// Installe l'adversaire sur la carte : Centre Ville au plus loin du joueur
// PARMI les emplacements viables, premiers villageois, caisse de départ.
// Installe UN adversaire IA. `id` permet d'en aligner plusieurs (mode
// « 2 rivaux ») ; `evites` liste les points déjà pris, pour ne pas poser deux
// rivaux au même endroit. Renvoie la faction créée, ou null.
function initAI(playerTX,playerTY,id=FAC.IA,nom='Seigneur rival',evites=[]){
  const tune=AI_TUNE[G.difficulty]||AI_TUNE.normal;
  // Dérivé de la graine de carte ET de l'identifiant du camp : reproductible,
  // mais deux rivaux ne suivent pas la même suite.
  const rndPose=srnd((G.seed^(id===FAC.IA2?0x5bf03635:0x27d4eb2f))>>>0||1);
  // Quatre ancrages à mi-bord (le joueur démarre au centre) + les quatre
  // coins (position des camps de Survie, donc déjà réputés riches en
  // ressources — la Conquête désactivant spawnPOIs, ils sont libres ici).
  // aiAnchors() (03-carte.js) est la source UNIQUE : genMap() y garantit déjà
  // un minimum de ressources à chacun, avant même que l'un d'eux soit choisi.
  const anchors=aiAnchors();
  const d=BDEF[BT.TC];
  // Priorité à la richesse en ressources plutôt qu'au seul éloignement : un
  // adversaire posé loin mais sans la moindre pierre ni or à portée ne
  // pouvait plus jamais financer de Caserne ni de montée d'âge, quelle que
  // soit la durée de la partie — un vrai blocage, pas une simple difficulté.
  // Pierre ET or à proximité sont donc exigés (`stone&&gold`) ; seul un
  // repli sur le simple éloignement s'applique si aucun site ne les a tous
  // les deux (carte atypique).
  let best=null,bestScore=-Infinity;
  for(const[ax,ay] of anchors){
    const spot=aiSpot(d.w,d.h,ax,ay,0,14,rndPose);
    if(!spot) continue;
    const r=aiSiteRichness(spot.tx,spot.ty);
    if(!r.stone||!r.gold) continue;
    const dist=Math.hypot(spot.tx-playerTX,spot.ty-playerTY);
    // S'écarter aussi des rivaux déjà installés : deux IA côte à côte se
    // partageraient les mêmes gisements et s'étrangleraient mutuellement.
    let ecart=0;
    for(const e of evites) ecart+=Math.min(Math.hypot(spot.tx-e[0],spot.ty-e[1]),120);
    const score=dist+ecart*1.5+Math.min(r.stone,6)*40+Math.min(r.gold,6)*40+Math.min(r.tree,10)*8+Math.min(r.berry,6)*20;
    if(score>bestScore){bestScore=score;best=spot;}
  }
  if(!best){
    let bestD=-1;
    for(const[ax,ay] of anchors){
      const spot=aiSpot(d.w,d.h,ax,ay,0,14,rndPose);
      if(!spot) continue;
      let dist=Math.hypot(spot.tx-playerTX,spot.ty-playerTY);
      for(const e of evites) dist+=Math.min(Math.hypot(spot.tx-e[0],spot.ty-e[1]),120);
      if(dist>bestD){bestD=dist;best=spot;}
    }
  }
  if(!best){ // carte pathologique : on renonce plutôt que de planter la partie
    notify('⚠️ Aucun emplacement pour l\'adversaire — partie sans IA','#e74c3c');
    return null;
  }
  // La faction doit exister AVANT de poser le moindre bâtiment : mkBuilding
  // lit désormais l'âge et les recherches de son propriétaire.
  // Civilisation tirée depuis rndPose (déterministe par graine+camp), en
  // évitant celle du joueur pour que les bonus asymétriques se voient.
  const civKeysIA=Object.keys(CIVS).filter(k=>k!==selectedCiv);
  const civIA=civKeysIA[Math.floor(rndPose()*civKeysIA.length)]||Object.keys(CIVS)[0];
  const a=mkFaction(id,{genre:'ia', equipe:(id===FAC.IA?3:4), nom, res:tune.start,
                        maxPop:BDEF[BT.TC].popBonus, civ:civIA});
  Object.assign(a,{
    baseX:0, baseY:0, tcId:null,
    think:0, ageQ:null,
    atkTimer:tune.firstAtk, atkMin:tune.atkMin, raids:0,
    vilTarget:tune.vilTarget,
  });
  G.factions[id]=a;

  const tc=mkBuilding(BT.TC,best.tx,best.ty,id);
  tc.ai=true;
  placeBuilding(tc);
  a.baseX=tc.x; a.baseY=tc.y; a.tcId=tc.id;
  // Arène : l'IA a droit à la même enceinte que le joueur, sinon le preset
  // reviendrait à offrir une palissade gratuite au seul camp humain.
  if(carteCfg().murs) poserMursArene(tc.tx,tc.ty,tc.w,tc.h,id);
  for(let i=0;i<4;i++){
    const u=mkUnit(UT.VIL,tc.x+(i-1.5)*BASE_TILE*0.9,tc.y+BASE_TILE*1.8,id);
    aiAdoptUnit(u,a);
    a.pop++;
    G.units.push(u);
  }
  return a;
}

// ── CERVEAU DE L'IA ───────────────────────────────────────
// Cadencé à 2 décisions/seconde : assez réactif pour ne jamais laisser une
// file de production vide, assez espacé pour rester négligeable au profilage
// même avec plusieurs dizaines d'unités des deux côtés.
const AI_THINK = 0.5;
// Fait jouer TOUS les adversaires IA de la partie (le mode « 2 rivaux » en
// aligne deux, le multijoueur 1v1+IA un seul).
// Plus de garde par mode : le mode Survie ne CRÉE pas d'adversaire IA (voir
// MODES.rivaux), donc la boucle y tourne à vide de toute façon — mais une
// faction humaine déconnectée peut être convertie en IA en cours de partie
// (voir convertirEnIA), et elle doit alors jouer quel que soit le mode.
function updateAI(dt){
  for(const a of factionsIA()) updateUneIA(dt,a);
}

// ── CROISSANCE CONTINUE DE L'IA ────────────────────────────
// L'objectif d'économie de l'IA était un palier FIXE (8 à 20 villageois selon
// la difficulté) qu'elle atteignait en quelques minutes et ne dépassait plus
// jamais. Passé ce cap, son revenu était exactement le même à la trentième
// minute qu'à la cinquième, et son armée plafonnait avec : une partie longue
// se terminait toujours par un adversaire figé. L'objectif monte donc avec le
// temps de jeu, borné par sa propre population maximale.
const AI_VIL_PALIER = 40;   // secondes de jeu par villageois supplémentaire
const AI_VIL_MAX    = 80;   // plafond d'économie, largement au-delà de l'ancien
function aiVilTarget(a){
  const base=a.vilTarget||12;
  const cible=base+Math.floor(G.gameTime/AI_VIL_PALIER);
  return Math.max(base,Math.min(cible,AI_VIL_MAX,Math.max(base,a.maxPop||base)));
}

// ── ASSAUTS DE L'IA : RASSEMBLER, PUIS FRAPPER ─────────────
// L'IA libérait TOUTE son armée d'un coup (`u.camp=null`) et chaque unité
// partait seule vers la cible la plus proche : l'armée arrivait en file
// indienne et se faisait tuer par paquets de trois, quelle que soit sa
// taille. Elle se rassemble désormais à mi-chemin avant de frapper.
//
// Aucun mécanisme nouveau : on réutilise la GARDE de camp (`u.camp`,
// `u.campX/campY`) déjà en place pour les garnisons de points d'intérêt.
// updateEnemyAI sait déjà ramener une garde à son poste et ne lui faire
// engager que les intrus proches — c'est exactement un point de ralliement.
// 0,3 et non la moitié du trajet : sur une carte de 240 tuiles, se masser à
// mi-chemin demandait plus d'une minute de marche à un Pillard (1,6 tuile/s)
// — le délai de garde expirait toujours avant le quorum et le rassemblement
// ne servait à rien. Le but est de PARTIR ENSEMBLE, pas d'avancer : un point
// proche de la base remplit cet office et se remplit vite.
const AI_RALLY_PART = 0.3;           // part du trajet base→cible où l'on se masse
const AI_RALLY_RAYON = BASE_TILE*7;  // « arrivé au point de ralliement »
const AI_RALLY_QUORUM = 0.8;         // 80 % de l'armée présente = on part
// Délai de garde CALCULÉ sur le trajet réel plutôt que figé : une constante
// arbitraire est soit trop courte sur grande carte (le rassemblement ne se
// produit jamais), soit trop longue sur petite (l'IA reste plantée alors que
// tout le monde est arrivé). 1,8× le temps de marche théorique de l'unité la
// plus lente, avec un plancher.
function aiRallyDelai(a,army){
  let spdMin=Infinity;
  for(const u of army) if(u.spd<spdMin) spdMin=u.spd;
  if(!isFinite(spdMin)||spdMin<=0) spdMin=1;
  const d=Math.hypot(a.rallyX-a.baseX,a.rallyY-a.baseY)/BASE_TILE;
  return Math.max(20,Math.min(120,d/spdMin*1.8));
}
const AI_DEFENSE_RAYON = BASE_TILE*16;
const AI_DEFENSE_DUREE = 35;         // secondes de rappel après la dernière alerte

// Centre Ville hostile le plus proche : l'objectif de l'assaut.
function aiCibleBase(a){
  let best=null,bd=Infinity;
  for(const b of G.buildings){
    if(b.type!==BT.TC||b.hp<=0||!estHostile(a.id,b)) continue;
    const d=Math.hypot(b.x-a.baseX,b.y-a.baseY);
    if(d<bd){ bd=d; best=b; }
  }
  return best;
}
// Poste une armée en garde autour d'un point (ralliement ou repli défensif).
function aiPoster(army,x,y){
  for(const u of army){ u.camp=u.owner; u.campX=x; u.campY=y; u.target=null; }
}

// Merveille adverse ACHEVÉE, s'il en existe une.
//
// Même prédicat que cibleMerveille (07-simulation.js), mais posé au niveau de
// la FACTION, et c'est tout l'enjeu : une armée encore POSTÉE en garde (phase
// de rassemblement ou de repli défensif) n'engage que les intrus de son rayon
// et ne verra jamais une Merveille à l'autre bout de la carte. Le ciblage
// individuel ne suffit donc pas — il faut que la machine à phases lâche
// l'armée.
function aiMerveilleHostile(a){
  for(const b of G.buildings){
    if(b.type===BT.WONDER&&!b.constructing&&b.hp>0&&estHostile(a.id,b)) return b;
  }
  return null;
}

function majPhaseAssaut(dt,a,army){
  const tune=AI_TUNE[G.difficulty]||AI_TUNE.normal;

  // ── Urgence Merveille ── prioritaire sur TOUT, la défense comprise.
  //
  // Une Merveille adverse debout gagne la partie en MERVEILLE_WIN_TIME
  // secondes (5 min). Face à ce sablier, attendre le quorum de rassemblement
  // ou la fin du minuteur d'assaut, c'est perdre en regardant ; et se replier
  // sur sa base parce qu'un éclaireur rôde, c'est perdre en beauté. C'est la
  // seule situation où l'IA jette par-dessus bord sa machine à phases.
  //
  // Le commentaire de MERVEILLE_WIN_TIME annonçait « le temps pour
  // l'adversaire de réagir » : voici la réaction. Sans elle, poser une
  // Merveille dans un coin gagnait toute partie de Conquête.
  const merv=aiMerveilleHostile(a);
  if(merv){
    if(a.phase!=='merveille'){
      a.phase='merveille';
      sfx('wave');
      bigBanner('🏛️ RUÉE SUR LA MERVEILLE');
      notify(`🏛️ ${a.nom} lance tout ce qu'il a sur la Merveille !`,'#e74c3c');
    }
    // On se contente de LIBÉRER ce qui est encore posté : le choix de la
    // cible reste à updateEnemyAI (voir cibleMerveille), un seul endroit qui
    // décide. Le test sur u.camp évite de réinitialiser à chaque image l'état
    // d'une unité déjà en route ou au contact.
    for(const u of army) if(u.camp!=null){ u.camp=null; u.target=null; u.state='idle'; }
    return;
  }
  if(a.phase==='merveille') a.phase=null;   // Merveille tombée : on reprend le cours normal

  // ── Défense ── une menace près de la base rappelle l'armée, où qu'elle
  // soit. `defenseJusqua` donne l'hystérésis : sans elle, un seul éclaireur
  // qui rôde annulerait tous les assauts de la partie.
  const tc=bldById(a.tcId);
  if(tc&&(a.scanDef=(a.scanDef||0)-dt)<=0){
    a.scanDef=0.5;
    const menace=nearestBy(tc.x,tc.y,AI_DEFENSE_RAYON,e=>e.hp>0&&e.state!=='garrison'&&estHostile(a.id,e));
    if(menace) a.defenseJusqua=G.gameTime+AI_DEFENSE_DUREE;
  }
  if(a.defenseJusqua>G.gameTime){
    if(a.phase!=='defense'){
      a.phase='defense';
      aiPoster(army,a.baseX,a.baseY);
      if(a.raids>0) notify(`🛡 ${a.nom} rappelle son armée en défense`,'#e67e22');
    } else aiPoster(army,a.baseX,a.baseY);   // rattrape les recrues sorties depuis
    return;
  }
  if(a.phase==='defense') a.phase=null;      // menace écartée : on reprend le cours normal

  // ── Rassemblement ── on attend le quorum, ou l'expiration du délai : sans
  // ce plafond, une seule unité coincée derrière un lac gèlerait l'assaut
  // pour le restant de la partie.
  if(a.phase==='rassemble'){
    aiPoster(army,a.rallyX,a.rallyY);        // les recrues rejoignent le point, elles aussi
    // Est « prêt » celui qui a rejoint le point... mais AUSSI celui qui est
    // déjà plus près de la cible que le point de ralliement lui-même : un
    // rescapé de l'assaut précédent, encore au contact dans la base adverse,
    // est au front — le faire revenir en arrière pour repartir serait absurde,
    // et c'est ce qui faisait expirer le délai à chaque vague après la
    // première.
    const dCible=Math.hypot(a.rallyX-a.cibleX,a.rallyY-a.cibleY);
    const prets=army.filter(u=>Math.hypot(u.x-a.rallyX,u.y-a.rallyY)<=AI_RALLY_RAYON
                             ||Math.hypot(u.x-a.cibleX,u.y-a.cibleY)<dCible).length;
    const quorum=army.length&&prets/army.length>=AI_RALLY_QUORUM;
    if(!quorum&&G.gameTime-a.phaseT<aiRallyDelai(a,army)) return;
    a.rallyQuorum=quorum;   // trace : l'assaut est-il parti groupé ou par expiration ?
    // camp effacé = l'unité cesse de garder son poste et part chasser avec
    // la logique de ciblage ennemie déjà en place.
    for(const u of army){ u.camp=null; u.target=null; u.state='idle'; }
    a.phase='assaut';
    a.raids++;
    a.atkTimer=tune.atkEvery;
    a.atkMin+=tune.atkStep;
    sfx('wave');
    bigBanner(`🏴 ASSAUT ENNEMI ${a.raids}`);
    notify(`🏴 ${a.nom} lance un assaut ! (${army.length} unités)`,'#e74c3c');
    return;
  }

  // ── Déclenchement ── le compte à rebours et l'effectif décident, comme
  // avant ; c'est ce qui suit qui change : on se masse d'abord.
  if(a.atkTimer<=0&&army.length>=a.atkMin){
    const cible=aiCibleBase(a);
    if(!cible) return;                       // plus personne à attaquer
    a.cibleX=cible.x; a.cibleY=cible.y;
    a.rallyX=a.baseX+(cible.x-a.baseX)*AI_RALLY_PART;
    a.rallyY=a.baseY+(cible.y-a.baseY)*AI_RALLY_PART;
    a.phase='rassemble'; a.phaseT=G.gameTime;
    aiPoster(army,a.rallyX,a.rallyY);
  }
}

function updateUneIA(dt,a){
  if(!a||a.vaincu) return;

  // Montée d'âge en cours
  if(a.ageQ){
    a.ageQ.timer-=dt;
    if(a.ageQ.timer<=0){
      const ob=AGE_BONUS[a.age]; a.age++; a.ageQ=null;
      const nb=AGE_BONUS[a.age];
      // Mêmes règles rétroactives que pour le joueur (updateAgeUp) : les PV
      // maximum montent, les dégâts déjà subis restent acquis.
      for(const b of G.buildings) if(b.owner===a.id){
        const nm=Math.round(b.maxHp/ob.bldHp*nb.bldHp), dmg=b.maxHp-b.hp;
        b.maxHp=nm; b.hp=Math.max(1,nm-dmg);
      }
      for(const u of G.units) if(u.owner===a.id){
        const nm=Math.round(u.maxHp/ob.unitHp*nb.unitHp), dmg=u.maxHp-u.hp;
        u.maxHp=nm; u.hp=Math.max(1,nm-dmg);
        if(u.type!==UT.VIL) u.atk=Math.round(u.atk/ob.milAtk*nb.milAtk);
      }
      notify(`🏴 L'ennemi atteint l'${AGES[a.age].nom} !`,'#e67e22');
    }
  }

  // Re-semis des champs adverses, payé sur sa propre caisse
  for(const b of G.buildings){
    if(b.owner===a.id&&b.type===BT.FARM&&!b.constructing&&b.foodLeft<=0&&aiAfford(FARM_RESEED_COST,null,a)){
      aiSpend(FARM_RESEED_COST,a); b.foodLeft=FARM_FOOD;
    }
  }

  // Assauts : le compte à rebours tourne en continu, la décision se prend
  // quand l'armée est assez fournie. Le seuil monte à chaque raid, donc les
  // vagues adverses grossissent au lieu de se répéter à l'identique.
  // Plancher à 0 plutôt que de laisser filer le compte à rebours dans les
  // négatifs : sans lui, une IA sans caserne accumulait plusieurs minutes de
  // « dette » et déclenchait son 1er assaut à la seconde où sa 6e unité
  // sortait — puis affichait « assaut : 0s » pendant tout ce temps.
  a.atkTimer=Math.max(0,a.atkTimer-dt);
  // Le Moine ne combat pas (updateEnemyAI l'exclut explicitement) : le
  // compter dans l'armée faisait déclencher des assauts sur un effectif qui
  // n'existait pas — trois moines chasseurs de reliques pouvaient à eux
  // seuls faire franchir le seuil `atkMin`.
  const army=G.units.filter(u=>u.owner===a.id&&u.type!==UT.VIL&&u.type!==UT.MONK);
  majPhaseAssaut(dt,a,army);

  a.think-=dt;
  if(a.think>0) return;
  a.think=AI_THINK;

  // ── Recensement ──
  a.pop=G.units.filter(u=>u.owner===a.id).length;
  let cap=0;
  for(const b of G.buildings){
    if(b.owner!==a.id||b.constructing) continue;
    if(b.type===BT.HOUSE) cap+=AGE_BONUS[a.age].housePop;
    else if(BDEF[b.type].popBonus) cap+=BDEF[b.type].popBonus;
  }
  a.maxPop=Math.min(cap,AGE_BONUS[a.age].popCap);

  const vils=G.units.filter(u=>u.owner===a.id&&u.type===UT.VIL);
  const tc=bldById(a.tcId);
  // Rééquilibrage de la main-d'œuvre (voir aiRebalance) — un travailleur
  // déplacé toutes les 6 secondes au maximum.
  a.rebal=(a.rebal||0)-AI_THINK;
  if(a.rebal<=0){ a.rebal=6; aiRebalance(vils,a); }
  // Réparation : même nature de décision que le rééquilibrage (déplacer de la
  // main-d'œuvre), donc même genre de cadence — un peu plus prompte, parce
  // qu'un bâtiment qui prend des coups, lui, n'attend pas.
  a.repCd=(a.repCd||0)-AI_THINK;
  if(a.repCd<=0){ a.repCd=4; aiRepare(vils,a); }
  // Troc : la plus lente des trois décisions économiques. Un déséquilibre de
  // caisse se corrige d'abord par la main-d'œuvre (aiRebalance) ; le Marché
  // n'est là que pour les blocages que la récolte ne résout plus.
  a.trocCd=(a.trocCd||0)-AI_THINK;
  if(a.trocCd<=0){ a.trocCd=8; aiTroquer(a); }

  // Épargne de montée d'âge : dès que l'économie tient debout, le coût du
  // prochain âge devient intouchable pour la production militaire. L'IA
  // accepte donc de lever moins de troupes pendant un temps pour encaisser
  // un palier — arbitrage qu'elle ne faisait pas du tout auparavant.
  //
  // La garde `army.length>=5` est essentielle : sans elle, une IA à court de
  // nourriture n'atteignait jamais le coût de l'âge suivant ET ne pouvait
  // plus rien entraîner, se figeant définitivement à 0 unité militaire. On
  // ne met de côté qu'une fois la défense minimale assurée.
  const saving=(!a.ageQ&&a.age<AGES.length-1&&army.length>=5&&vils.length>=Math.min(8,a.vilTarget))
    ? AGES[a.age+1].cost : null;

  // ── Production ──
  for(const b of G.buildings){
    if(b.owner!==a.id||b.constructing) continue;
    let roster=AI_TRAINERS[b.type];
    if(!roster||b.trainQ.length>=3) continue;
    if(a.pop>=a.maxPop) continue;
    // Château : l'unité unique de la civilisation rejoint le roster dès que
    // l'âge le permet (voir aiUniteUnique). `concat` et non un push : le
    // tableau AI_TRAINERS est partagé par TOUS les camps, y compris les deux
    // rivaux du mode « 2 rivaux » qui n'ont pas la même civilisation — le
    // muter donnerait à l'un l'unité unique de l'autre, et définitivement.
    if(b.type===BT.CASTLE){
      const uniq=aiUniteUnique(a);
      if(uniq) roster=roster.concat(uniq);
    }
    if(b.type===BT.TC){
      // Villageois jusqu'à l'objectif d'économie, puis on garde la place
      // pour l'armée.
      if(vils.length+b.trainQ.length>=aiVilTarget(a)) continue;
      // La réserve de montée d'âge s'applique AUSSI aux villageois. Sans ça,
      // un objectif d'économie qui monte en continu (voir aiVilTarget) fait
      // repartir en villageois — 40 nourritures pièce — tout ce que l'IA
      // encaisse : elle n'atteint jamais les 500 nourritures du palier
      // suivant, reste à l'Âge Sombre pour toujours, et son armée se fige
      // avec elle. Constaté en simulation : âge 0 et 6 unités au bout de
      // onze minutes, avec 1 500 bois dormants faute d'âge pour les dépenser.
      if(!aiAfford(aiCout(UT.VIL),saving,a)) continue;
      aiSpend(aiCout(UT.VIL),a);
      b.trainQ.push(UT.VIL);
      if(b.trainQ.length===1) b.trainTimer=trainTime(UT.VIL);
      continue;
    }
    // Bâtiments militaires : on ne produit qu'une fois l'économie lancée,
    // pour ne pas étrangler les chantiers dès les premières minutes.
    if(vils.length<Math.min(6,a.vilTarget)) continue;
    // Le Moine ne sert QU'À ramasser les reliques (voir aiRelicHunt) et ne
    // combat jamais : au-delà d'un porteur par relique de la carte, chaque
    // Moine supplémentaire est une place de population et 45🍖+20💰 jetés.
    // Mesuré avant plafond : 16 Moines pour 5 reliques.
    const monks=G.units.filter(u=>u.owner===a.id&&u.type===UT.MONK).length;
    const boats=G.units.filter(u=>u.owner===a.id&&u.type===UT.BOAT).length;
    const avail=roster.filter(t=>(AI_UNIT_AGE[t]||0)<=a.age&&aiAfford(aiCout(t),saving,a)
                                &&!(t===UT.MONK&&monks>=RELIC_COUNT)
                                &&!(t===UT.BOAT&&boats>=AI_BOAT_MAX));
    if(!avail.length) continue;
    const type=avail[(Math.random()*avail.length)|0];
    aiSpend(aiCout(type),a);
    b.trainQ.push(type);
    if(b.trainQ.length===1) b.trainTimer=trainTime(type);
  }

  // ── Chantiers ── Un seul chantier tant que l'économie est jeune (disperser
  // 4 villageois sur 2 fronts ne construit rien), un second dès qu'elle est
  // assez fournie pour alimenter les deux — sans quoi une IA à 12 villageois
  // passait l'essentiel de son temps à regarder un unique mur monter.
  let sites=G.buildings.filter(b=>b.owner===a.id&&b.constructing);
  // Garde-fou anti-blocage : constaté en simulation (rare, ~1 partie sur 15)
  // — un bâtisseur qui n'arrive jamais à destination (chemin impraticable
  // vers le site choisi) laisse le chantier à l'arrêt indéfiniment. Sans
  // repli, l'IA restait engagée sur ce chantier fantôme jusqu'à la fin de la
  // partie : jamais de Caserne, jamais d'armée, quel que soit le temps
  // laissé au joueur. Un chantier resté quasiment vierge plus de 90s est
  // donc abandonné (bâtisseurs libérés, moitié du coût remboursée) pour
  // qu'un autre site, ailleurs, ait sa chance.
  for(const s of sites) if(G.gameTime-(s.aiStartT||0)>90&&s.progress<0.15) aiAbortSite(s,a);
  sites=G.buildings.filter(b=>b.owner===a.id&&b.constructing);
  // Nombre de chantiers menés de front, proportionnel à la main-d'œuvre :
  // figé à 2, une IA à cinquante villageois passait son temps à accumuler des
  // ressources qu'elle n'avait plus aucun moyen de dépenser.
  const maxSites=Math.max(1,Math.min(4,Math.floor(vils.length/10)+1));
  if(sites.length<maxSites){
    const next=aiNextBuild(vils.length,a);
    if(next) aiBuild(next.type,next.x,next.y,a);
  }
  {
    // Chantier orphelin (bâtisseurs tués) : on y renvoie quelqu'un
    for(const s of sites){
      if(G.units.some(u=>u.owner===a.id&&u.state==='build'&&u.buildTarget===s.id)) continue;
      const v=vils.find(u=>u.state!=='build');
      if(v){ quitterPoste(v); v.state='build'; v.buildTarget=s.id; v.target=null; }
    }
  }

  // ── Montée d'âge ── une fois l'économie assise, et sans vider les caisses
  // au point de ne plus rien pouvoir produire ensuite.
  if(!a.ageQ&&a.age<AGES.length-1&&tc&&vils.length>=Math.min(8,a.vilTarget)){
    const cost=AGES[a.age+1].cost;
    if(aiAfford(cost,null,a)){
      aiSpend(cost,a);
      const t=[0,60,90,120][a.age+1]||90;
      a.ageQ={timer:t,total:t};
    }
  }

  // ── Recherches ── une seule à la fois, comme le joueur ; les effets
  // rétroactifs (updateResearchFaction) sont déjà génériques par faction,
  // il ne manquait que la décision de lancer la recherche.
  if(!a.researchQ.length){
    const forgeReady=G.buildings.some(b=>b.owner===a.id&&b.type===BT.FORGE&&!b.constructing);
    const univReady=G.buildings.some(b=>b.owner===a.id&&b.type===BT.UNIV&&!b.constructing);
    // L'IA aligne un roster d'unités ENEMI_* propre (voir AI_TRAINERS), pas
    // celui du joueur : les recherches ciblant un type précis (Épée de Fer
    // pour Milicien/Piquier, Arc Long pour Archer…) ne lui servent à rien.
    // Elle ne pioche donc que dans les techs génériques (isMilitary ou
    // bâtiments), les seules qui profitent réellement à son armée.
    // Les trois recherches économiques profitent à l'IA exactement comme au
    // joueur (gatherMult, gatherCap et la vitesse des villageois sont déjà
    // génériques par faction) : les lui refuser lui imposerait un handicap
    // que rien ne justifie, et le Moulin est de toute façon le deuxième
    // bâtiment qu'elle pose.
    const AI_RESEARCH_POOL=['iron_armor','masonry','tactics','engineering','fortification',
                            'brouette','charrue','sentiers'];
    const moulinReady=G.buildings.some(b=>b.owner===a.id&&b.type===BT.MILL&&!b.constructing);
    const pool=[];
    if(forgeReady)  for(const k of AI_RESEARCH_POOL) if(RDEF[k].cat==='forge') pool.push(k);
    if(univReady)   for(const k of AI_RESEARCH_POOL) if(RDEF[k].cat==='univ')  pool.push(k);
    if(moulinReady) for(const k of AI_RESEARCH_POOL) if(RDEF[k].cat==='eco')   pool.push(k);
    const choix=pool.filter(k=>!a.research[k]&&aiAfford(RDEF[k].cost,saving,a));
    if(choix.length){
      const key=choix[(Math.random()*choix.length)|0];
      aiSpend(RDEF[key].cost,a);
      a.researchQ.push({type:key,timer:RDEF[key].time});
    }
  }

  // ── Route commerciale ── entre ses deux Marchés, dès qu'ils sont bâtis.
  const aiMarkets=G.buildings.filter(b=>b.owner===a.id&&b.type===BT.MARKET&&!b.constructing);
  if(aiMarkets.length>=2&&!aiMarkets[0].tradeRoute){
    const dist=Math.hypot(aiMarkets[1].x-aiMarkets[0].x,aiMarkets[1].y-aiMarkets[0].y);
    aiMarkets[0].tradeRoute={toId:aiMarkets[1].id,dist,t:0,dur:Math.max(20,dist/CARAVAN_SPEED),dir:1};
  }

  // ── Reliques ── un Moine libre part récupérer la relique libre la plus
  // proche (relicFree() protège déjà contre toute double-réclamation).
  {
    const idleMonk=G.units.find(u=>u.owner===a.id&&u.type===UT.MONK&&u.state==='idle');
    if(idleMonk){
      let best=null,bd=Infinity;
      for(const r of (G.relics||[])){
        if(!relicFree(r)) continue;
        const d=Math.hypot(r.x-idleMonk.x,r.y-idleMonk.y);
        if(d<bd){bd=d;best=r;}
      }
      if(best){ best.carrier=idleMonk.id; idleMonk.state='relic'; idleMonk.target=best.id; idleMonk.relicHeld=false; }
    }
  }

  // ── Héros ── une seule fois par partie (voir HEROES), dès que le Château
  // le permet — même garde-fou que côté joueur (f.heroTrained).
  if(!a.heroTrained){
    const castle=G.buildings.find(b=>b.owner===a.id&&b.type===BT.CASTLE&&!b.constructing);
    if(castle&&castle.trainQ.length<3&&a.pop<a.maxPop&&aiAfford(TCOST[UT.HERO],saving,a)){
      aiSpend(TCOST[UT.HERO],a);
      castle.trainQ.push(UT.HERO);
      if(castle.trainQ.length===1) castle.trainTimer=trainTime(UT.HERO);
      a.heroTrained=true;
    }
  }

  // ── Merveille ── dernier palier, seulement une fois une armée conséquente
  // déjà levée : bâtir une Merveille sans pouvoir la défendre serait un
  // cadeau offert au joueur, pas une vraie menace.
  if(a.age>=3&&army.length>=10&&!G.buildings.some(b=>b.owner===a.id&&b.type===BT.WONDER)){
    aiBuild(BT.WONDER,a.baseX,a.baseY,a);
  }

  // ── Amélioration des camps ── Forestier/Minier/Moulin, comme le joueur ;
  // appliquerUpgradeCamp() vérifie déjà elle-même le coût et l'âge requis.
  for(const b of G.buildings){
    if(b.owner!==a.id||b.constructing) continue;
    if(CAMP_LEVELS[b.type]) appliquerUpgradeCamp(b,a.id);
  }

  // ── Garnison défensive ── un ennemi rôde près de la base : les villageois
  // inactifs se mettent à l'abri ; ils ressortent une fois la menace passée.
  if(tc){
    const threat=nearestBy(tc.x,tc.y,GUARD_AGGRO_RADIUS,e=>e.hp>0&&e.state!=='garrison'&&estHostile(a.id,e));
    if(threat){
      const cap=BDEF[BT.TC].garrisonCap||0;
      const curGarr=G.units.filter(u=>u.owner===a.id&&u.state==='garrison'&&u.target===tc.id).length;
      const idleVils=vils.filter(v=>v.state==='idle').slice(0,Math.max(0,cap-curGarr));
      // Sans effet aujourd'hui (un villageois idle n'a ni poste ni charge en
      // cours, voir doGather/doFarm) mais garde ce chemin aligné sur
      // ORD.GARNIR (js/10-ordres.js) — si ce filtre s'élargit un jour à des
      // villageois occupés, les mêmes fantômes/pertes qu'il a fallu corriger
      // côté joueur reviendraient ici, sans le moindre signal.
      for(const v of idleVils){
        v.avantGarnison=posteActuel(v);
        quitterPoste(v);
        crediterInventaire(v);
        v.state='garrison'; v.target=tc.id; v.x=tc.x; v.y=tc.y; v.moving=false; v.inv=0; v.invT=null;
      }
      if(idleVils.length) a.stats.garrisonUses+=idleVils.length;
    } else {
      for(const v of vils) if(v.state==='garrison'&&v.target===tc.id){ v.state='idle'; v.target=null; reprendrePoste(v); }
    }
  }

  // ── Chasse occasionnelle ── un villageois inactif part de temps en temps
  // chercher le gibier le plus proche : un bonus de nourriture gratuit,
  // jamais prioritaire sur le reste de l'économie.
  if(Math.random()<0.1){
    const hunter=vils.find(v=>v.state==='idle');
    if(hunter){
      let bestW=null,bdw=60*BASE_TILE;
      for(const w of (G.wildlife||[])){
        if(w.hp<=0) continue;
        const d=Math.hypot(w.x-hunter.x,w.y-hunter.y);
        if(d<bdw){bdw=d;bestW=w;}
      }
      if(bestW){ hunter.state='hunt'; hunter.target=bestW.id; }
    }
  }

  // ── Trahison ── une IA alliée (voir ORD.DIPLOMATIE) rompt d'elle-même si
  // elle prend nettement le dessus sur celui qui l'a alliée : une trêve
  // n'est jamais définitive, juste une pause tant que l'IA y a intérêt.
  if(a.allieDe!=null){
    const allieF=G.factions[a.allieDe];
    if(!allieF||allieF.vaincu||allieF.equipe!==a.equipe){
      a.allieDe=null; // l'allié a disparu ou l'a déjà rompue de son côté
    } else {
      const armeeDe=id=>G.units.filter(u=>u.owner===id&&u.hp>0&&isMilitary(u.type)).length;
      const armeeA=armeeDe(a.id), armeeAllie=armeeDe(a.allieDe);
      if(armeeA>=10&&armeeA>=armeeAllie*1.5&&Math.random()<0.02){
        a.equipe=a._equipeAvant!=null?a._equipeAvant:a.equipe;
        const traheId=a.allieDe; a.allieDe=null;
        if(traheId===G.me){
          bigBanner(`⚔️ TRAHISON DE ${a.nom.toUpperCase()}`);
          notify(`⚔️ ${a.nom} rompt son alliance et vous attaque !`,'#e74c3c');
        }
      }
    }
  }
}

// Barre du haut en mode Conquête : elle affiche l'état de l'adversaire au
// lieu du compteur de vagues, qui n'a plus de sens ici.
function refreshConquestBar(){
  const el=document.getElementById('wb-conquest');
  const sv=document.getElementById('wb-survival');
  if(!el) return;
  el.style.display='';
  if(sv) sv.style.display='none';
  const a=G.ai;
  if(!a){ el.textContent='🏴 Conquête'; return; }
  const army=G.units.filter(u=>u.owner===a.id&&u.type!==UT.VIL).length;
  const nextAtk=Math.max(0,Math.ceil(a.atkTimer));
  const m=Math.floor(nextAtk/60), s=nextAtk%60;
  // Trois états distincts, pour ne jamais afficher un décompte qui ment :
  // l'armée est prête et le délai écoulé (imminent), le délai court (compte
  // à rebours), ou l'adversaire n'a tout simplement pas encore les troupes.
  let etat;
  // La ruée sur la Merveille passe avant les trois autres : le joueur voit
  // arriver TOUTE l'armée d'un coup, hors de tout cycle d'assaut, il doit
  // pouvoir comprendre pourquoi sans deviner.
  if(a.phase==='merveille')      etat='<span style="color:#e74c3c">ruée sur la Merveille</span>';
  else if(army>=a.atkMin&&nextAtk<=0) etat='<span style="color:#e74c3c">assaut imminent</span>';
  else if(army>=a.atkMin)        etat=`assaut : ${nextAtk>60?`${m}m${String(s).padStart(2,'0')}`:nextAtk+'s'}`;
  else                           etat=`<span style="color:#9a8a6a">armée en formation</span>`;
  el.innerHTML=`🏴 Ennemi ${AGES[a.age].ico} &nbsp;|&nbsp; ⚔️ ${army} &nbsp;|&nbsp; ${etat}`;
}

// Chaque camp fait avancer sa propre file : en 1v1, les deux joueurs
// cherchent en parallèle, et les effets rétroactifs ne touchent que les
// unités de celui qui a payé la recherche.
function updateResearchQ(dt){
  for(const f of factionsJouantes()) updateResearchFaction(dt,f);
}
function updateResearchFaction(dt,f){
  if(!f.researchQ||!f.researchQ.length) return;
  const owner=f.id, local=(owner===G.me);
  const r=f.researchQ[0];
  r.timer-=dt;
  if(r.timer<=0){
    f.research[r.type]=true;
    f.researchQ.shift();
    f.stats.research++;
    if(local) notify(`✅ ${RDEF[r.type].nom} recherché !`,'#2ecc71');
    // Effets rétroactifs
    if(r.type==='iron_armor'){
      for(const u of G.units)
        if(u.owner===owner&&isMilitary(u.type)){ // toutes les unités militaires (Piquier/Arbalétrier/Trébuchet inclus)
          u.maxHp=Math.round(u.maxHp*1.3); u.hp=Math.min(u.hp+10,u.maxHp);
        }
    }
    if(r.type==='tactics'){
      // Alignée sur mkUnit (isMilitary), plutôt que "tout sauf Villageois" :
      // les deux chemins doivent viser exactement les mêmes unités, sans
      // quoi une unité déjà en jeu et une unité formée après la recherche
      // ne reçoivent pas le même bonus.
      for(const u of G.units)
        if(u.owner===owner&&isMilitary(u.type)){
          u.atk=Math.round(u.atk*1.2);
        }
      if(local) notify('⚔️ +20% ATK sur toutes vos unités militaires !','#f0c040');
    }
    if(r.type==='iron_sword'){
      for(const u of G.units) if(u.owner===owner&&[UT.MIL,UT.PIKE].includes(u.type)) u.atk=Math.round(u.atk*1.25);
      if(local) notify('⚔️ Miliciens et Piquiers renforcés !','#e74c3c');
    }
    if(r.type==='bow_craft'){
      for(const u of G.units) if(u.owner===owner&&[UT.ARC,UT.XBOW].includes(u.type)) u.atk=Math.round(u.atk*1.25);
      if(local) notify('🏹 Archers renforcés !','#e67e22');
    }
    if(r.type==='cavalry'){
      // Éclaireur inclus : c'est de la cavalerie légère, et mkUnit lui
      // applique déjà ce bonus à la création (voir CAV dans mkUnit) — sans
      // ça, un Éclaireur déjà formé avant la recherche ne recevait rien.
      for(const u of G.units) if(u.owner===owner&&[UT.KNIGHT,UT.PALADIN,UT.SCOUT].includes(u.type)){
        u.maxHp=Math.round(u.maxHp*1.2); u.hp=Math.min(u.hp+15,u.maxHp);
      }
      if(local) notify('🐴 Cavalerie renforcée !','#9b59b6');
    }
    if(r.type==='masonry'){ // était absent : les bâtiments existants ne gagnaient rien
      for(const b of G.buildings)
        if(b.owner===owner){ b.maxHp=Math.round(b.maxHp*1.25); b.hp=Math.min(Math.round(b.hp*1.25),b.maxHp); }
      if(local) notify('🧱 Tous vos bâtiments renforcés !','#95a5a6');
    }
    if(r.type==='longbow'){
      for(const u of G.units)
        if(u.owner===owner&&(u.type===UT.ARC||u.type===UT.XBOW)){ // Arbalétrier inclus
          u.rng=Math.round(u.rng*1.5);
        }
      if(local) notify('🎯 Portée des Archers augmentée !','#3498db');
    }
    if(r.type==='engineering'){
      for(const b of G.buildings)
        if(b.owner===owner&&(b.type===BT.TOWER||b.type===BT.CASTLE)){
          b.maxHp=Math.round(b.maxHp*1.4); b.hp=Math.min(b.hp+80,b.maxHp);
        }
      if(local) notify('🔧 Tours et Château renforcés !','#95a5a6');
    }
    if(r.type==='siege_smithing'){
      for(const u of G.units) if(u.owner===owner&&[UT.RAM,UT.TREB].includes(u.type)) u.atk=Math.round(u.atk*1.25);
      if(local) notify('🐏 Machines de siège renforcées !','#c0392b');
    }
    if(r.type==='cavalry_lance'){
      for(const u of G.units) if(u.owner===owner&&[UT.KNIGHT,UT.PALADIN,UT.SCOUT].includes(u.type)) u.atk=Math.round(u.atk*1.2);
      if(local) notify('🗡️ Cavalerie plus offensive !','#9b59b6');
    }
    if(r.type==='fortification'){
      for(const b of G.buildings)
        if(b.owner===owner&&(b.type===BT.WALL||b.type===BT.GATE||b.type===BT.OUTPOST)){
          b.maxHp=Math.round(b.maxHp*1.25); b.hp=Math.min(Math.round(b.hp*1.25),b.maxHp);
        }
      if(local) notify('🏯 Murs, Portails et Avant-postes renforcés !','#95a5a6');
    }
    if(r.type==='logistics'){
      for(const u of G.units) if(u.owner===owner&&isMilitary(u.type)) u.spd*=1.15;
      if(local) notify('🥾 Vos troupes se déplacent plus vite !','#3498db');
    }
    // Recherches de civilisation — même logique rétroactive que leurs
    // équivalents génériques (Lance de Cavalerie, Logistique, Arc Long) : ce
    // que mkUnit pose à la création, il faut le rattraper sur les unités
    // déjà en jeu, sinon deux unités du même type n'ont pas les mêmes
    // statistiques selon qu'elles sont nées avant ou après.
    if(r.type==='chevalerie'){
      for(const u of G.units) if(u.owner===owner&&CAV_TYPES.includes(u.type)&&isMilitary(u.type)) u.atk=Math.round(u.atk*1.15);
      if(local) notify('🏇 Votre cavalerie frappe plus fort !','#9b59b6');
    }
    if(r.type==='etriers'){
      for(const u of G.units) if(u.owner===owner&&CAV_TYPES.includes(u.type)&&isMilitary(u.type)) u.spd*=1.15;
      if(local) notify('👟 Votre cavalerie se déplace plus vite !','#3498db');
    }
    if(r.type==='arc_composite'){
      for(const u of G.units)
        if(u.owner===owner&&UDEF[u.type]&&UDEF[u.type].atkType==='p'&&!UDEF[u.type].siege) u.rng+=BASE_TILE;
      if(local) notify('🏹 Vos tireurs gagnent une case de portée !','#16a085');
    }
    // Le Feu Grégeois n'a rien à rattraper : updateBuildings lit la recherche
    // à chaque tir (comme gatherMult pour la Charrue).
    // Sentiers Pavés : même effet rétroactif que Logistique, côté civil.
    if(r.type==='sentiers'){
      for(const u of G.units) if(u.owner===owner&&u.type===UT.VIL) u.spd*=1.15;
      if(local) notify('🛤️ Vos villageois se déplacent plus vite !','#3498db');
    }
    // Brouette et Charrue Lourde n'ont RIEN à faire ici : gatherCap() et
    // gatherMult() lisent la recherche à chaque appel, donc le bonus vaut
    // immédiatement pour un villageois DÉJÀ en train de porter une charge.
    // C'est tout l'intérêt d'être passé par un point unique plutôt que de
    // recopier la valeur sur l'unité comme le font les bonus militaires.
    if(r.type==='brouette'&&local) notify('🛒 Vos villageois portent 30 unités au lieu de 22 !','#2ecc71');
    if(r.type==='charrue'&&local) notify('🐂 +15% sur toutes vos récoltes !','#2ecc71');
  }
}
