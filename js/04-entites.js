'use strict';
// ======================================================================
//  04-entites.js
// ======================================================================
// Usines d'entites (mkUnit / mkBuilding / placeBuilding) et
// ameliorations de batiments (tours, camps de ressource).
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── USINES D'ENTITÉS ──────────────────────────────────────
// Les archétypes ENEMI_* (roster propre à l'IA de Conquête et aux vagues de
// Survie — voir AI_TRAINERS) comptent aussi comme « militaires » : sans ça,
// les recherches génériques (Armure de Fer, Tactiques…) que l'IA peut
// désormais lancer (voir updateUneIA) n'auraient AUCUN effet sur sa propre
// armée. Inerte pour les vagues de Survie : spawnWave écrase hp/atk juste
// après mkUnit avec sa propre formule d'échelle, et FAC.PILL n'a ni âge ni
// recherche qui pourraient déclencher ces bonus entre-temps.
const MIL_TYPES=[UT.MIL,UT.ARC,UT.KNIGHT,UT.PALADIN,UT.PIKE,UT.XBOW,UT.TREB,UT.RAM,UT.SCOUT,UT.HERO,
                 UT.CATA,UT.CAVARC,UT.ARBRAP,UT.ROUL,
                 UT.ENEMI,UT.ENEMIA,UT.ENEMI_G,UT.ENEMI_C,UT.ENEMI_BOSS];
// Silhouette montee. La liste etait ecrite DEUX FOIS a l'identique (cycle de
// marche et dessin de l'unite) : ajouter une unite montee sans mettre les
// deux a jour lui donnait un cycle de jambes de fantassin sous son cheval.
const CAV_TYPES=[UT.KNIGHT,UT.PALADIN,UT.SCOUT,UT.ENEMI_C,UT.CATA,UT.CAVARC];
// Ce qui roule sur des ROUES plutot que sur des pattes : cible de la recherche
// gitane « Roues Cerclees ». Volontairement distinct du couple SIEGE de mkUnit
// (Belier/Trebuchet) qui sert, lui, a `siege_smithing` : cette recherche-la
// annonce « Beliers et Trebuchets » et ne doit PAS se mettre a toucher la
// Roulotte dans le dos du libelle.
const ROUES_TYPES=[UT.RAM,UT.TREB,UT.ROUL];
// Cibles des bonus de RECHERCHE, par famille. Ces quatre listes vivaient en
// `const` LOCALES a mkUnit, et les effets retroactifs (updateResearchFaction,
// js/08-ia.js) en recopiaient a la main des versions PLUS COURTES : une unite
// unique de civilisation (Cataphractaire, Cavalier-Archer, Arbaletrier a
// Repetition) recevait donc Arc Renforce / Cavalerie / Lance de Cavalerie a sa
// NAISSANCE, mais jamais si elle etait deja sur la carte au moment de la
// recherche. Deux unites du meme type n'avaient plus les memes statistiques
// selon leur date de naissance -- exactement ce que les notes de `tactics` et
// de `chevalerie` disaient avoir voulu eviter. Meme raison d'etre que
// CAV_TYPES/ROUES_TYPES ci-dessus : un seul endroit a tenir.
// Volontairement sans les archetypes ennemis (UT.ENEMI*) : les recherches ne
// concernent que le roster jouable.
const MELEE_BONUS_TYPES  = [UT.MIL,UT.PIKE];
const RANGED_BONUS_TYPES = [UT.ARC,UT.XBOW,UT.ARBRAP,UT.CAVARC];
const CAV_BONUS_TYPES    = [UT.KNIGHT,UT.PALADIN,UT.SCOUT,UT.CATA,UT.CAVARC];
const SIEGE_BONUS_TYPES  = [UT.RAM,UT.TREB];
// Set, pas Array.includes : isMilitary est appelé DANS des balayages de
// toute l'armée (selMilitary, heroAuraMult, les statistiques par seconde,
// les effets rétroactifs de recherche…), et chaque appel reparcourait les
// quinze types. Mesuré : c'était le vrai coût de selMilitary, plus que le
// `G.sel.includes` que l'audit désignait — d'où ce correctif, découvert en
// mesurant l'autre.
const MIL_SET=new Set(MIL_TYPES);
function isMilitary(type){ return MIL_SET.has(type); }

// Les bonus de recherche et d'âge s'appliquent désormais à TOUT camp, lus
// dans sa propre faction. Auparavant ils étaient réservés à owner==='player'
// et l'IA devait se les réappliquer après coup (aiAdoptUnit) — le code est
// plus court, et un second joueur humain les reçoit naturellement.
function mkUnit(type, wx, wy, owner=FAC.P1){
  const d=UDEF[type];
  const rech=rechercheDe(owner), age=ageOf(owner), civ=civOf(owner);
  let mhp=d.hp;
  const mil=isMilitary(type);
  if(rech.iron_armor&&mil) mhp=Math.round(mhp*1.3);
  mhp=Math.round(mhp*AGE_BONUS[age].unitHp); // robustesse croissante avec l'âge
  let rng=d.rng*BASE_TILE; // portée en unités-monde (BASE_TILE), fixe : ne dépend pas du zoom
  if(rech.longbow&&(type===UT.ARC||type===UT.XBOW)) rng*=1.5;
  if(rech.arc_composite&&UDEF[type].atkType==='p'&&!UDEF[type].siege) rng+=BASE_TILE;   // Arc Composite (chinois)
  // Listes PARTAGEES avec les effets retroactifs (voir *_BONUS_TYPES en tete
  // de fichier) : ce que mkUnit pose a la creation et ce que la recherche
  // rattrape sur les unites deja en jeu doivent viser exactement les memes.
  const MELEE=MELEE_BONUS_TYPES, RANGED=RANGED_BONUS_TYPES,
        CAV=CAV_BONUS_TYPES, SIEGE=SIEGE_BONUS_TYPES;
  if(rech.cavalry&&CAV.includes(type)) mhp=Math.round(mhp*1.2);
  if(civ.cavHpMult&&CAV.includes(type)) mhp=Math.round(mhp*civ.cavHpMult); // bonus de civilisation (Francs)
  let atk=d.atk;
  if(rech.iron_sword&&MELEE.includes(type)) atk=Math.round(atk*1.25);
  if(rech.bow_craft&&RANGED.includes(type)) atk=Math.round(atk*1.25);
  if(rech.cavalry_lance&&CAV.includes(type)) atk=Math.round(atk*1.2);
  if(rech.chevalerie&&CAV.includes(type)) atk=Math.round(atk*1.15);   // Chevalerie Franque (francs)
  if(rech.siege_smithing&&SIEGE.includes(type)) atk=Math.round(atk*1.25);
  if(rech.tactics&&mil) atk=Math.round(atk*1.2);
  if(civ.rangedAtkMult&&(RANGED.includes(type)||type===UT.TREB)) atk=Math.round(atk*civ.rangedAtkMult); // bonus de civilisation (Mongols)
  if(mil) atk=Math.round(atk*AGE_BONUS[age].milAtk); // ATK militaire croissant avec l'âge
  let spd=d.spd;
  if(rech.logistics&&mil) spd*=1.15;
  if(rech.etriers&&CAV.includes(type)) spd*=1.15;   // Étriers de Fer (mongols)
  if(rech.sentiers&&type===UT.VIL) spd*=1.15;   // Sentiers Paves (recherche economique)
  if(rech.roues_cerclees&&ROUES_TYPES.includes(type)) spd*=1.25;   // Roues Cerclees (gitanos)
  // Gitanos : peuple de la route. Le bonus porte sur le VILLAGEOIS et non sur
  // la recolte -- il ouvre la carte (gisements lointains, camps qu'on
  // deplace) au lieu d'ajouter des pourcents a ce qu'on faisait deja.
  if(civ.vilSpdMult&&type===UT.VIL) spd*=civ.vilSpdMult;
  // Héros : nom/icône affichés selon la civilisation du propriétaire — les
  // statistiques de combat, elles, restent celles d'UDEF[UT.HERO] pour tous.
  const heroDef=(type===UT.HERO)?(HEROES[fac(owner)&&fac(owner).civ]||HEROES.francs):null;
  return {
    id:G.nid++, type, owner,
    x:wx, y:wy, destX:wx, destY:wy,
    hp:mhp, maxHp:mhp,
    spd, atk, rng, atkSpd:d.atkSpd, atkCd:0,
    state:'idle', target:null,
    gTimer:0, inv:0, invT:null, dropoff:null,
    buildTarget:null,
    pendingAction:null,
    animT:(G.nid*2.399)%6.283, dir:0, moving:false, // dérivé de l'id : déterministe, et un champ d'aléa en moins dans l'état
    homeNode:null, // mémoire du dernier nœud récolté
    avantGarnison:null, // activité à reprendre en sortant de garnison (voir ORD.GARNIR/DEGARNIR)
    heroNom:heroDef&&heroDef.nom, heroIco:heroDef&&heroDef.ico,
    xp:0, rank:0, // vétérance — voir awardKillXP
  };
}

function mkBuilding(type,tx,ty,owner=FAC.P1){
  const d=BDEF[type];
  const rech=rechercheDe(owner);
  let mhp=d.hp;
  if(rech.masonry) mhp=Math.round(mhp*1.25);
  mhp=Math.round(mhp*AGE_BONUS[ageOf(owner)].bldHp); // PV bâtiments croissants avec l'âge
  if(rech.engineering&&(type===BT.TOWER||type===BT.CASTLE)) mhp=Math.round(mhp*1.4);
  if(rech.fortification&&(type===BT.WALL||type===BT.GATE||type===BT.OUTPOST)) mhp=Math.round(mhp*1.25);
  const civBldMult=civOf(owner).bldHpMult; if(civBldMult) mhp=Math.round(mhp*civBldMult); // bonus de civilisation (Byzantins)
  return {
    id:G.nid++, type, owner,
    tx,ty, w:d.w, h:d.h,
    x:tx*BASE_TILE+d.w*BASE_TILE/2, y:ty*BASE_TILE+d.h*BASE_TILE/2,
    hp:mhp, maxHp:mhp,
    constructing:false, progress:1,
    trainQ:[], trainTimer:0,
    atkCd:0, active:true,
    rally:null, // point de ralliement {x,y}
    foodLeft: type===BT.FARM ? FARM_FOOD : 0, // stock de nourriture (ferme à la AoE2)
    farmers: [], // ids des villageois qui y travaillent
    level: 1, // niveau d'amélioration (utilisé par la Tour Défensive)
    open: false, // portail : fermé par défaut à la construction
  };
}

function placeBuilding(b){
  // Seuls les murs bloquaient jusqu'ici (mark=3) ; les autres bâtiments
  // (mark=1) n'étaient qu'un simple repère de case occupée jamais lu comme
  // obstacle par wallAt/tileBlocked — une unité pouvait traverser une
  // Caserne en ligne droite. Tout bâtiment est désormais solide, SAUF la
  // Ferme qui doit rester un champ où les fermiers marchent (farmSpot()
  // les positionne À L'INTÉRIEUR de son emprise), et le Portail dont le
  // passage dépend de son état ouvert/fermé (voir toggleGate).
  const mark=(b.type===BT.FARM?1:b.type===BT.GATE?(b.open?0:3):3);
  for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++) G.bmap[b.ty+dy][b.tx+dx]=mark;
  G.buildings.push(b);
  updatePopCap();
}

// Bascule l'état ouvert/fermé d'un portail : fermé, il bloque le passage
// comme un mur (mark=3) ; ouvert, on peut le traverser librement (mark=0).
// Mutation pure — appelée par applyCommand. Le retour d'interface est du
// ressort de l'appelant local (voir toggleGate).
function appliquerPortail(b){
  b.open=!b.open;
  const mark=b.open?0:3;
  for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++){
    if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=mark;
  }
  return {open:b.open};
}
function toggleGate(b){
  if(b.type!==BT.GATE) return;
  const r=emettreOrdre(ordre(ORD.PORTAIL,{bId:b.id}));
  if(!r.ok) return;
  notify(r.open?'🔓 Portail ouvert':'🔒 Portail fermé', r.open?'#2ecc71':'#e67e22'); buzz(6);
  refreshUI();
}

// Recalcule la capacité de population de CHAQUE camp : chacun ne loge que
// dans ses propres Maisons, avec le bonus de SON âge.
// Combien de places de population ce type de bâtiment apporte à ce camp.
// SOURCE UNIQUE, partagée par la mécanique (updatePopCap, juste dessous) et
// par l'affichage (menu de construction, js/11-interface.js) : le joueur
// choisit entre une Maison et un Immeuble sur ce seul chiffre, il ne doit
// pas pouvoir être calculé deux fois différemment.
// La Maison est le cas particulier : sa capacité CROÎT avec l'âge
// (AGE_BONUS.housePop, 5→8) et ne vient donc pas de BDEF.popBonus, qui
// resterait figé à 5.
function popGain(type,owner){
  if(type===BT.HOUSE) return AGE_BONUS[ageOf(owner)].housePop;
  return (BDEF[type]||{}).popBonus||0;
}
function updatePopCap(){
  const cap={};
  for(const f of factionsJouantes()) cap[f.id]=0;
  for(const b of G.buildings){
    if(cap[b.owner]==null) continue;
    // Un chantier À PEINE POSÉ (progress:0) logeait déjà tout le monde : une
    // fondation de Maison faisait sauter le plafond de 5 à 10 AVANT le
    // premier coup de marteau. doBuild rappelle déjà updatePopCap() au
    // moment où b.constructing PASSE à false (voir plus haut) — la place
    // n'est donc jamais perdue, seulement rendue au bon instant : quand le
    // bâtiment existe réellement.
    if(b.constructing) continue;
    cap[b.owner]+=popGain(b.type,b.owner);
  }
  // Bonus de population de civilisation. Les Chinois démarrent avec deux
  // villageois de plus (voir startGame) : sans la place qui va avec, ils
  // commencaient la partie DÉJÀ PLAFONNÉS (5 villageois pour un plafond de
  // 5, fourni par le seul Centre Ville) et ne pouvaient rien produire avant
  // d'avoir bâti une Maison — leur bonus s'annulait en partie lui-même.
  // Trouvé par tests/run.js, groupe `civilisations`.
  for(const f of factionsJouantes()) if(civOf(f.id).popBonusDepart) cap[f.id]+=civOf(f.id).popBonusDepart;
  // Chaque camp est plafonné par le popCap de SON âge.
  for(const f of factionsJouantes()) f.maxPop=Math.min(cap[f.id],AGE_BONUS[f.age].popCap);
}

// Un bâtiment disparaît (rasé au combat ou démoli volontairement) : sa file
// de formation part avec lui. Le Héros est le seul élément de cette file qui
// réserve autre chose que des ressources — f.heroTrained est une CHANCE
// UNIQUE pour toute la partie (voir ORD.FORMER, js/10-ordres.js : un second
// Héros y est refusé). L'annulation d'une formation rend explicitement cette
// chance ; la destruction, elle, ne le faisait pas : un Château rasé pendant
// que le Héros y était en file coûtait au joueur son Héros ET tout espoir
// d'en former un autre, sans le moindre message. Appelé par les DEUX chemins
// de disparition, sans quoi le correctif ne vaudrait que pour l'un des deux.
function libererFileFormation(b){
  if(!b||!b.trainQ||!b.trainQ.includes(UT.HERO)) return;
  const f=fac(b.owner);
  if(f) f.heroTrained=false;
}

// Nombre d'unités actuellement en garnison dans un bâtiment. Écrit à trois
// endroits (panneau de garnison, bouton d'abri, décompte de place restante)
// et désormais à un quatrième — les PRÉDICTIONS optimistes des ordres de
// garnison (voir emettreOrdre, js/10-ordres.js), seule façon pour un client
// d'annoncer un compte juste sans attendre la réponse de l'hôte.
// Nombre de villageois aux champs d'une Ferme. L'HÔTE tient la liste des ids
// (`b.farmers`, mutée par doFarm) ; le CLIENT n'en reçoit que le compte
// (`b.nFarmers`, v6 du protocole) — la liste elle-même ne lui servirait à
// rien. Un seul point de lecture pour que le panneau n'ait pas à savoir de
// quel côté du fil il tourne.
// `nFarmers` d'ABORD : mkBuilding initialise `farmers` à un tableau VIDE, qui
// est truthy — tester `b.farmers` en premier faisait donc toujours répondre 0
// chez le client, réplication ou pas. Le champ n'existe que chez lui ; côté
// hôte on retombe sur la vraie liste.
function fermiersDe(b){ return b.nFarmers!=null?b.nFarmers:(b.farmers||[]).length; }
function garnisonDe(b){ return G.units.filter(u=>u.state==='garrison'&&u.target===b.id).length; }

// ── AMÉLIORATION DES TOURS DÉFENSIVES ──────────────────────
// Trois paliers façon AoE2 (Tour de Guet → Tour de Garde → Donjon) : chaque
// palier coûte des ressources et améliore PV, dégâts, portée et cadence.
const TOWER_LEVELS = {
  1: { nom:'Tour de Guet',  atk:14, range:5.5, cd:2.0, hpMult:1.00 },
  2: { nom:'Tour de Garde', atk:20, range:6.2, cd:1.7, hpMult:1.35, cost:{wood:80,stone:120,gold:40}, reqAge:1 },
  3: { nom:'Donjon',        atk:28, range:7.0, cd:1.4, hpMult:1.90, cost:{wood:100,stone:200,gold:120}, reqAge:2 },
};
// PV max d'une tour à un niveau donné, en tenant compte des mêmes bonus de
// recherche/âge que mkBuilding() applique à la construction — sans quoi
// une amélioration pourrait faire perdre le bénéfice de Maçonnerie/Génie Civil.
function towerMaxHp(level,owner){
  owner=owner||G.me;
  const rech=rechercheDe(owner);
  let hp=BDEF[BT.TOWER].hp*(TOWER_LEVELS[level].hpMult||1);
  if(rech.masonry) hp*=1.25;
  hp*=AGE_BONUS[ageOf(owner)].bldHp;
  if(rech.engineering) hp*=1.4;
  const civBldMult=civOf(owner).bldHpMult; if(civBldMult) hp*=civBldMult; // bonus de civilisation (Byzantins) — voir mkBuilding
  return Math.round(hp);
}
// ATK réellement tirée par une Tour ou un Château, garnison et Feu Grégeois
// compris. Le panneau de sélection (js/11-interface.js) affichait le chiffre
// BRUT du palier pendant que updateBuildings tirait avec celui-ci : une Tour
// de Guet byzantine garnie de cinq archers annonçait « ATK 14 » et tirait à
// 44. Même raison d'être que towerMaxHp juste au-dessus — un seul point de
// vérité, pour que l'affichage ne puisse plus diverger du tir.
const CASTLE_ATK = 30, CASTLE_RANGE = 9, CASTLE_CD = 1.2;
function bldAtk(b, garnAtk=0){
  let atk = b.type===BT.CASTLE ? CASTLE_ATK : (TOWER_LEVELS[b.level||1]||TOWER_LEVELS[1]).atk;
  // La garnison s'ajoute AVANT le Feu Grégeois, qui multiplie donc aussi
  // l'apport des archers postés (comportement d'origine, conservé tel quel).
  if(garnAtk) atk += Math.min(garnAtk, garnBonusCap(b))*4;
  if(rechercheDe(b.owner).feu_gregeois) atk = Math.round(atk*1.3);
  return atk;
}

// Mutation pure — valide et applique, sans toucher à l'interface.
function appliquerUpgradeTour(b,owner){
  if(b.constructing) return {ok:false,raison:'cible'};
  const cur=b.level||1, next=TOWER_LEVELS[cur+1];
  if(!next) return {ok:false,raison:'max'};
  if(next.reqAge!=null&&ageOf(owner)<next.reqAge) return {ok:false,raison:'age',reqAge:next.reqAge};
  const cost=scaleCost(next.cost);
  if(!canAfford(cost,owner)) return {ok:false,raison:'ressources',cost};
  spend(cost,owner);
  const dmg=b.maxHp-b.hp;             // dégâts déjà subis, conservés en absolu (pas de soin gratuit)
  b.maxHp=towerMaxHp(cur+1,owner);
  b.hp=Math.max(1,b.maxHp-dmg);
  b.level=cur+1;
  return {ok:true,next};
}
function upgradeTower(b){
  if(b.type!==BT.TOWER||b.constructing) return;
  const r=emettreOrdre(ordre(ORD.AMELIORER_TOUR,{bId:b.id}));
  if(!r.ok){
    if(r.raison==='max') notify('🏆 Niveau maximum atteint','#f0c040');
    else if(r.raison==='age') notify(`🔒 Nécessite ${AGES[r.reqAge].nom}`,'#e74c3c');
    else if(r.raison==='ressources'){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(r.cost); }
    return;
  }
  spawnParts(b.x,b.y,'#f0c040',12);
  notify(`🏗️ ${r.next.nom} — Tour améliorée !`,'#2ecc71');
  sfx('build'); buzz(10);
  refreshUI();
}

// ── AMÉLIORATION DES BÂTIMENTS DE RESSOURCE ─────────────────
// Même principe que les Tours : deux paliers pour le Camp Forestier, le
// Camp Minier et le Moulin, qui accélèrent la récolte du villageois (et
// renforcent un peu le bâtiment). Le niveau est propre à CHAQUE bâtiment,
// mais la récolte prend le meilleur niveau possédé par la faction pour le
// type concerné (voir campRateMult) : pas besoin de courir vers un camp
// précis, l'amélioration profite à toute la récolte de la ressource.
const LUMBER_LEVELS = {
  1: { nom:'Camp Forestier', hpMult:1.00, rate:1.00 },
  2: { nom:'Scierie',        hpMult:1.20, rate:1.20, cost:{wood:120,gold:60},          reqAge:1 },
  3: { nom:'Grande Scierie', hpMult:1.45, rate:1.40, cost:{wood:200,gold:140,stone:80}, reqAge:2 },
};
const MINE_LEVELS = {
  1: { nom:'Camp Minier',    hpMult:1.00, rate:1.00 },
  2: { nom:'Mine Étayée',    hpMult:1.20, rate:1.20, cost:{wood:100,gold:80},           reqAge:1 },
  3: { nom:'Mine Profonde',  hpMult:1.45, rate:1.40, cost:{wood:160,gold:160,stone:100},reqAge:2 },
};
const MILL_LEVELS = {
  1: { nom:'Moulin',         hpMult:1.00, rate:1.00 },
  2: { nom:'Moulin à Aubes', hpMult:1.20, rate:1.20, cost:{wood:120,gold:70},           reqAge:1 },
  3: { nom:'Grand Moulin',   hpMult:1.45, rate:1.40, cost:{wood:200,gold:150,stone:60}, reqAge:2 },
};
const CAMP_LEVELS = { [BT.LUMBER]:LUMBER_LEVELS, [BT.MINE]:MINE_LEVELS, [BT.MILL]:MILL_LEVELS };

// PV max d'un bâtiment de ressource à un niveau donné — même logique que
// towerMaxHp, pour ne jamais faire perdre le bénéfice de Maçonnerie/âge.
function campMaxHp(type,level,owner){
  owner=owner||G.me;
  const tbl=CAMP_LEVELS[type]; if(!tbl) return BDEF[type].hp;
  const rech=rechercheDe(owner);
  let hp=BDEF[type].hp*(tbl[level].hpMult||1);
  if(rech.masonry) hp*=1.25;
  hp*=AGE_BONUS[ageOf(owner)].bldHp;
  const civBldMult=civOf(owner).bldHpMult; if(civBldMult) hp*=civBldMult; // bonus de civilisation (Byzantins) — voir mkBuilding
  return Math.round(hp);
}
// Meilleur niveau possédé par la faction pour ce type de camp — sert à
// moduler la vitesse de récolte de la ressource correspondante.
function campBestLevel(owner,type){
  let lvl=1;
  for(const b of G.buildings) if(b.owner===owner&&b.type===type&&!b.constructing) lvl=Math.max(lvl,b.level||1);
  return lvl;
}
// Multiplicateur de récolte pour un type de ressource ('wood'/'ore'/'food'),
// à combiner avec gatherMult (bonus d'âge) dans doGather/doFarm.
function campRateMult(owner,kind){
  const type = kind==='wood'?BT.LUMBER : kind==='ore'?BT.MINE : BT.MILL;
  const tbl=CAMP_LEVELS[type];
  return tbl[campBestLevel(owner,type)].rate;
}
// Mutation pure — valide et applique, sans toucher à l'interface.
function appliquerUpgradeCamp(b,owner){
  if(b.constructing) return {ok:false,raison:'cible'};
  const tbl=CAMP_LEVELS[b.type]; if(!tbl) return {ok:false,raison:'cible'};
  const cur=b.level||1, next=tbl[cur+1];
  if(!next) return {ok:false,raison:'max'};
  if(next.reqAge!=null&&ageOf(owner)<next.reqAge) return {ok:false,raison:'age',reqAge:next.reqAge};
  const cost=scaleCost(next.cost);
  if(!canAfford(cost,owner)) return {ok:false,raison:'ressources',cost};
  spend(cost,owner);
  const dmg=b.maxHp-b.hp;
  b.maxHp=campMaxHp(b.type,cur+1,owner);
  b.hp=Math.max(1,b.maxHp-dmg);
  b.level=cur+1;
  return {ok:true,next};
}
function upgradeCamp(b){
  if(!CAMP_LEVELS[b.type]||b.constructing) return;
  const r=emettreOrdre(ordre(ORD.AMELIORER_CAMP,{bId:b.id}));
  if(!r.ok){
    if(r.raison==='max') notify('🏆 Niveau maximum atteint','#f0c040');
    else if(r.raison==='age') notify(`🔒 Nécessite ${AGES[r.reqAge].nom}`,'#e74c3c');
    else if(r.raison==='ressources'){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(r.cost); }
    return;
  }
  spawnParts(b.x,b.y,'#8fbc44',12);
  notify(`🏗️ ${r.next.nom} — récolte améliorée !`,'#2ecc71');
  sfx('build'); buzz(10);
  refreshUI();
}
