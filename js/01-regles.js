'use strict';
// ======================================================================
//  01-regles.js
// ======================================================================
// Regles du jeu : constantes, tables d'unites et de batiments,
// classes d'armure et table de contres, difficultes, civilisations, types de
// carte, heros, veterance, modes de jeu, ages.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

'use strict';
// ═══════════════════════════════════════════════════════════
//  ÂGE DES CONQUÊTES  —  RTS/Crafting mobile  (v1.0)
// ═══════════════════════════════════════════════════════════

// ── CONSTANTES ────────────────────────────────────────────
const BASE_TILE = 38;       // taille de tuile de base (px CSS)
let   TILE      = 38;       // taille courante (avec zoom)
const COLS      = 240;
const ROWS      = 240;
const DPR       = Math.min(window.devicePixelRatio || 1, 2);

// Tuiles
const T_GRASS = 0, T_WATER = 1, T_SAND = 2;

// Types ressources nœuds
const RT = { TREE:'T', STONE:'S', GOLD:'G', BERRY:'B', MEAT:'VD', FISH:'PO' };

// Types bâtiments
const BT = { TC:'TC', HOUSE:'HO', LUMBER:'LU', MINE:'MI', FARM:'FA',
             FORGE:'FO', BARRACKS:'BA', TOWER:'TW',
             MILL:'ML', MARKET:'MK', STABLE:'ST', CASTLE:'CS',
             MONASTERY:'MO', WALL:'WL', UNIV:'UV',
             SIEGE:'SG', OUTPOST:'OP', GATE:'GT', HLM:'HL', WONDER:'WD', DOCK:'DK' };

// Définitions bâtiments
const BDEF = {
  [BT.TC]:       { nom:'Centre Ville',   w:2,h:2, hp:1500, cost:{},                          col:'#7a5018',cld:'#503410', drops:true, popBonus:5, garrisonCap:10 },
  [BT.HOUSE]:    { nom:'Maison',         w:1,h:1, hp:180,  cost:{wood:25},                   col:'#8B6914',cld:'#5a4010', popBonus:5 },
  [BT.HLM]:      { nom:'Immeuble HLM',   w:2,h:2, hp:560,  cost:{wood:150,stone:100},         col:'#8a8f96',cld:'#565b62', popBonus:25 },
  [BT.LUMBER]:   { nom:'Camp Forestier', w:2,h:1, hp:260,  cost:{wood:80},                   col:'#5a3810',cld:'#3a2008', drops:true },
  [BT.MINE]:     { nom:'Camp Minier',    w:2,h:1, hp:260,  cost:{wood:80},                   col:'#6a6a6a',cld:'#444',    drops:true },
  [BT.FARM]:     { nom:'Ferme',          w:2,h:2, hp:180,  cost:{wood:60},                    col:'#7ab840',cld:'#4a8018' },
  [BT.MILL]:     { nom:'Moulin',         w:2,h:2, hp:300,  cost:{wood:100},                  col:'#b8860b',cld:'#8b6508', drops:true },
  [BT.MARKET]:   { nom:'Marché',         w:2,h:2, hp:320,  cost:{wood:150,gold:50},          col:'#d4a017',cld:'#a07810' },
  [BT.FORGE]:    { nom:'Forge',          w:2,h:2, hp:380,  cost:{wood:150,stone:100},         col:'#484848',cld:'#282828' },
  [BT.BARRACKS]: { nom:'Caserne',        w:2,h:2, hp:520,  cost:{wood:200,stone:80},          col:'#8b1a1a',cld:'#5a0d0d' },
  [BT.STABLE]:   { nom:'Écurie',         w:2,h:2, hp:420,  cost:{wood:175,stone:60},          col:'#8b5e3c',cld:'#5a3820' },
  [BT.MONASTERY]:{ nom:'Monastère',      w:1,h:2, hp:360,  cost:{wood:175,stone:50},          col:'#c9b99a',cld:'#8b7355' },
  [BT.UNIV]:     { nom:'Université',     w:2,h:2, hp:420,  cost:{wood:200,stone:150},         col:'#2c6e8a',cld:'#1a4a5a' },
  [BT.TOWER]:    { nom:'Tour Défensive', w:1,h:2, hp:750,  cost:{wood:60,stone:180},          col:'#7a6a4a',cld:'#4a3a2a', garrisonCap:5 },
  [BT.CASTLE]:   { nom:'Château Fort',   w:3,h:3, hp:2800, cost:{wood:300,stone:300,gold:100},col:'#888878',cld:'#555548', garrisonCap:15 },
  [BT.WALL]:     { nom:'Mur Palissade',  w:1,h:1, hp:450,  cost:{wood:20},                   col:'#8b7355',cld:'#6b5335' },
  [BT.SIEGE]:    { nom:'Atelier de Siège',w:2,h:2,hp:480,  cost:{wood:220,stone:140},         col:'#5a4a34',cld:'#382c1e' },
  [BT.OUTPOST]:  { nom:'Avant-poste',    w:1,h:1, hp:260,  cost:{wood:50},                    col:'#6a5a3a',cld:'#443620' },
  [BT.GATE]:     { nom:'Portail',        w:1,h:1, hp:400,  cost:{wood:40,stone:20},           col:'#7a5a34',cld:'#4a3620' },
  [BT.WONDER]:   { nom:'Merveille',      w:3,h:3, hp:3500, cost:{wood:800,stone:800,gold:400},col:'#d8c078',cld:'#8a7838', popBonus:10 },
  [BT.DOCK]:     { nom:'Quai',           w:2,h:2, hp:300,  cost:{wood:100},                   col:'#6a5030',cld:'#3a2810', drops:true },
};

// Types unités
const UT = { VIL:'V', MIL:'M', ARC:'A', KNIGHT:'K', MONK:'MON', PALADIN:'P',
             PIKE:'PK', XBOW:'XB', TREB:'TR', RAM:'RM', SCOUT:'SC', HERO:'HE', BOAT:'BO',
             // Unites uniques de civilisation, formees au Chateau (voir CIVS.unique)
             CATA:'CT', CAVARC:'CA', ARBRAP:'AR',
             ENEMI:'E', ENEMIA:'EA', ENEMI_G:'EG', ENEMI_C:'EC', ENEMI_BOSS:'EB' };

// ── CLASSES D'ARMURE ET TYPES D'ATTAQUE ────────────────────
// Chaque unité n'avait qu'UN chiffre d'attaque, et les deux seuls contres du
// jeu étaient codés en dur dans doAttack (Piquier ×2 contre la cavalerie,
// siège ×1,5 contre les bâtiments). Sans armure, aucune composition d'armée
// n'existait : le Paladin battait tout ce qui n'était pas Piquier, et la
// stratégie optimale se réduisait à produire une seule unité.
//
//   `cls`     — ce que l'unité EST (ce contre quoi on prend un bonus)
//   `atkType` — 'm' (mêlée/contondant) ou 'p' (perforant/trait)
//   `armor`   — réduction PLATE, par type d'attaque reçue
//
// L'armure se soustrait, le bonus s'ajoute, et le tout passe par un point
// unique : degatsContre(). Un coup fait toujours 1 dégât au minimum, sinon
// une unité suffisamment blindée deviendrait littéralement invulnérable.
const CLS = { INF:'inf', ARC:'arc', CAV:'cav', SIEGE:'siege', VIL:'vil', MOINE:'moine', NAV:'nav', BAT:'bat' };
const CLS_NOM = { inf:'Infanterie', arc:'Tireur', cav:'Cavalerie', siege:'Siège',
                  vil:'Civil', moine:'Moine', nav:'Navire', bat:'Bâtiment' };

// Définitions unités
const UDEF = {
  [UT.VIL]:     { nom:'Villageois',    hp:28,  spd:1.8, atk:3,  rng:1.2, atkSpd:1.0, cls:CLS.VIL,   atkType:'m', armor:{m:0,p:0} },
  [UT.MIL]:     { nom:'Milicien',      hp:55,  spd:2.2, atk:10, rng:1.2, atkSpd:1.3, cls:CLS.INF,   atkType:'m', armor:{m:1,p:1} },
  [UT.ARC]:     { nom:'Archer',        hp:38,  spd:2.0, atk:7,  rng:4.5, atkSpd:1.0, cls:CLS.ARC,   atkType:'p', armor:{m:0,p:0} },
  [UT.KNIGHT]:  { nom:'Chevalier',     hp:95,  spd:2.8, atk:15, rng:1.3, atkSpd:1.2, cls:CLS.CAV,   atkType:'m', armor:{m:2,p:2} },
  [UT.MONK]:    { nom:'Moine',         hp:32,  spd:1.7, atk:1,  rng:1.2, atkSpd:0.5, cls:CLS.MOINE, atkType:'m', armor:{m:0,p:0} },
  [UT.PALADIN]: { nom:'Paladin',       hp:150, spd:2.5, atk:20, rng:1.5, atkSpd:1.1, cls:CLS.CAV,   atkType:'m', armor:{m:3,p:3} },
  [UT.PIKE]:    { nom:'Piquier',       hp:70,  spd:2.0, atk:13, rng:1.5, atkSpd:1.1, cls:CLS.INF,   atkType:'m', armor:{m:0,p:0} },
  [UT.XBOW]:    { nom:'Arbalétrier',   hp:45,  spd:1.9, atk:11, rng:5.2, atkSpd:1.1, cls:CLS.ARC,   atkType:'p', armor:{m:0,p:1} },
  [UT.TREB]:    { nom:'Trébuchet',     hp:60,  spd:0.8, atk:55, rng:8.0, atkSpd:0.25, siege:true, cls:CLS.SIEGE, atkType:'p', armor:{m:1,p:5} },
  [UT.RAM]:     { nom:'Bélier',        hp:220, spd:1.4, atk:35, rng:1.2, atkSpd:0.5,  siege:true, cls:CLS.SIEGE, atkType:'m', armor:{m:0,p:8} }, // quasi immunisé au trait, fondu en mêlée : c'est sa signature
  [UT.SCOUT]:   { nom:'Éclaireur',     hp:40,  spd:3.3, atk:5,  rng:1.2, atkSpd:0.9, cls:CLS.CAV,   atkType:'m', armor:{m:0,p:2} },
  [UT.HERO]:    { nom:'Héros',         hp:220, spd:2.6, atk:20, rng:1.4, atkSpd:1.2, cls:CLS.CAV,   atkType:'m', armor:{m:3,p:3} }, // nom/stats de combat identiques pour les 4 civs ; seuls le nom et l'icône affichés varient (voir HEROES)
  [UT.BOAT]:    { nom:'Barque de Pêche', hp:50, spd:2.2, atk:0,  rng:1,   atkSpd:1.0, naval:true, cls:CLS.NAV, atkType:'p', armor:{m:0,p:0} }, // sans combat en v1 — voir advanceNaval
  // ── Unites uniques de civilisation ──
  // Chacune occupe une NICHE que le roster commun ne couvre pas, plutot que
  // d'etre une unite existante en mieux : sinon la civilisation ne change pas
  // la facon de jouer, elle rend juste plus fort.
  [UT.CATA]:    { nom:'Cataphractaire', hp:130, spd:2.4, atk:16, rng:1.3, atkSpd:1.1, cls:CLS.CAV, atkType:'m', armor:{m:4,p:3}, resistBonus:0.5 }, // byzantins : la seule cavalerie qui ne fond pas sous les Piquiers
  [UT.CAVARC]:  { nom:'Cavalier-Archer', hp:60, spd:3.0, atk:8,  rng:4.0, atkSpd:1.1, cls:CLS.CAV, atkType:'p', armor:{m:0,p:1} }, // mongols : le seul tireur qui peut fuir ce qui le contre
  [UT.ARBRAP]:  { nom:'Arbalétrier à Répétition', hp:42, spd:1.9, atk:7, rng:4.8, atkSpd:2.4, cls:CLS.ARC, atkType:'p', armor:{m:0,p:0} }, // chinois : peu de degats par trait, mais deux fois plus de traits -- redoutable sur l'infanterie nue, inoffensif sur ce qui est blinde (l'armure se soustrait A CHAQUE trait)
  [UT.ENEMI]:   { nom:'Pillard',       hp:38,  spd:1.6, atk:7,  rng:1.2, atkSpd:1.0, cls:CLS.INF,   atkType:'m', armor:{m:1,p:1} },
  [UT.ENEMIA]:  { nom:'Archer Pillard',hp:28,  spd:1.7, atk:5,  rng:4.0, atkSpd:0.8, cls:CLS.ARC,   atkType:'p', armor:{m:0,p:0} },
  [UT.ENEMI_G]: { nom:'Géant',         hp:160, spd:1.2, atk:20, rng:1.2, atkSpd:0.7, cls:CLS.INF,   atkType:'m', armor:{m:2,p:2} },
  [UT.ENEMI_C]: { nom:'Cavalier Noir', hp:90,  spd:3.0, atk:14, rng:1.3, atkSpd:1.1, cls:CLS.CAV,   atkType:'m', armor:{m:2,p:2} },
  [UT.ENEMI_BOSS]:{nom:'Seigneur de Guerre',hp:900,spd:1.4,atk:40,rng:1.5,atkSpd:0.9, cls:CLS.INF,  atkType:'m', armor:{m:4,p:4} },
};

// Bonus PLAT par type d'attaquant, contre la CLASSE de la cible. Table de
// contres du jeu : c'est ici, et nulle part ailleurs, qu'on décide qui bat
// qui. Les valeurs reprennent exactement les deux contres historiques
// (Piquier ×2 sur la cavalerie ≈ 13→26, siège ×1,5 sur les bâtiments,
// Seigneur de Guerre ×1,6 sur les bâtiments) pour ne pas déséquilibrer
// l'existant, et ajoutent les chaînons qui manquaient.
const BONUS = {
  // +25 et non +13 : le Chevalier a ~114 PV une fois la recherche Cavalerie
  // passée, contre 70 au Piquier. Un simple doublement des dégâts (l'ancien
  // ×2) laissait le Chevalier gagner le duel à effectif égal — le « contre »
  // n'en était pas un. Mesuré : 10 Piquiers battent désormais 10 Chevaliers.
  // Le Paladin, lui, gagne toujours à effectif égal, et c'est voulu : il
  // coûte trois fois le prix, le Piquier le contre au COÛT, pas au nombre.
  [UT.PIKE]:      { cav:25, siege:8 },
  [UT.MIL]:       { siege:4 },
  [UT.KNIGHT]:    { arc:6 },             // la cavalerie fond sur les tireurs...
  [UT.PALADIN]:   { arc:8 },
  [UT.SCOUT]:     { arc:4, moine:8 },    // ...et l'Éclaireur va chercher les Moines
  // Le tireur n'a ni la vitesse ni les PV pour survivre au corps à corps :
  // sa seule fenêtre, ce sont les quelques volées tirées pendant que
  // l'infanterie traverse sa portée. Sans ce bonus, elles ne pesaient rien
  // et l'Archer perdait contre TOUT (7 dégâts pour 70 PV de Piquier).
  [UT.ARC]:       { inf:7, vil:2 },
  [UT.XBOW]:      { inf:9 },
  [UT.RAM]:       { bat:18 },            // 35 + 18 = 53 ≈ l'ancien 35×1,5
  [UT.TREB]:      { bat:28 },            // 55 + 28 = 83 ≈ l'ancien 55×1,5
  // Le Cataphractaire ne prend PAS de bonus contre les tireurs : son role est
  // d'encaisser les Piquiers (armure 4 en melee), pas de tout surclasser.
  [UT.CAVARC]:    { arc:4 },
  [UT.ARBRAP]:    { inf:5 },
  [UT.ENEMI_C]:   { arc:6 },
  [UT.ENEMI_G]:   { bat:8 },
  [UT.ENEMI_BOSS]:{ bat:24 },            // 40 + 24 = 64 ≈ l'ancien 40×1,6
};
// Armure des bâtiments. Relevée de {1,2} à {2,3} une fois l'IA dotée d'un
// atelier de siège (voir AI_TRAINERS[BT.SIEGE]) : un tireur ne démolit
// pratiquement plus un bâtiment (l'Archer Pillard passe de 5 dégâts à 2),
// ce qui est le comportement attendu du genre, sans pour autant neutraliser
// l'IA avant qu'elle n'atteigne l'Âge des Châteaux.
//
// Pas les {3,5} d'un vrai AoE2, et c'est délibéré : mesuré sur une partie
// où le joueur ne fait rien, l'IA rase le Centre Ville à t=756s en {1,2},
// t=816s en {2,3} et t=780s en {3,5} — l'armure n'est donc pas le facteur
// limitant tant que le joueur est passif. Mais face à un joueur qui se
// défend VRAIMENT, une armure de 5 en perforant rendrait l'armée de l'IA
// (majoritairement des Archers Pillards avant l'Âge des Châteaux) incapable
// d'entamer quoi que ce soit. À reconsidérer seulement après une vraie
// session de jeu contre un joueur qui construit des murs.
const BLD_ARMOR = { m:2, p:3 };

// Coûts d'entraînement
const TCOST = {
  [UT.VIL]:     { food:40 },
  [UT.MIL]:     { food:45, gold:10 },
  [UT.ARC]:     { food:20, wood:30 },
  [UT.KNIGHT]:  { food:60, gold:30 },
  [UT.MONK]:    { food:45, gold:20 },
  [UT.PALADIN]: { food:90, gold:55 },
  [UT.PIKE]:    { food:35, wood:18 },
  [UT.XBOW]:    { food:20, wood:32, gold:12 },
  [UT.TREB]:    { wood:150, gold:140 },
  [UT.RAM]:     { wood:180, gold:60 },
  [UT.SCOUT]:   { food:50 },
  [UT.HERO]:    { food:250, gold:200 },
  [UT.BOAT]:    { wood:60 },
  [UT.CATA]:    { food:70, gold:75 },
  [UT.CAVARC]:  { wood:40, gold:65 },
  [UT.ARBRAP]:  { wood:40, gold:35 },
};

// Libellé de coût généré depuis TCOST : plus de valeurs écrites en dur dans les boutons
const RICO={food:'🍖',wood:'🪵',stone:'🪨',gold:'💰'};
function costLabel(cost){ return Object.entries(cost||{}).map(([r,v])=>v+RICO[r]).join(' '); }
// Ne liste que ce qui manque réellement (pas le coût total) — pour les info-bulles
// des boutons grisés par manque de ressources (voir mkBtn/costlock).
function missingLabel(cost){
  return Object.entries(cost||{})
    .filter(([r,v])=>(G.res[r]||0)<v)
    .map(([r,v])=>Math.ceil(v-(G.res[r]||0))+RICO[r])
    .join(' ');
}
const TTIME = { [UT.VIL]:20, [UT.MIL]:15, [UT.ARC]:18, [UT.KNIGHT]:25, [UT.MONK]:22, [UT.PALADIN]:35,
                [UT.PIKE]:16, [UT.XBOW]:20, [UT.TREB]:50, [UT.RAM]:40, [UT.SCOUT]:14, [UT.HERO]:60, [UT.BOAT]:18,
                [UT.CATA]:24, [UT.CAVARC]:22, [UT.ARBRAP]:19 };

// Taux de récolte (par seconde)
const GRATE = { [RT.TREE]:1.0, [RT.STONE]:0.9, [RT.GOLD]:0.8, [RT.BERRY]:1.15, [RT.MEAT]:1.3, [RT.FISH]:1.1, farm:1.0, mill:0.38 };
// Vitesse de la caravane commerciale (unités-monde/s) — un peu plus rapide
// qu'un villageois, pour que la route se sente vivante sans dominer l'écran.
const CARAVAN_SPEED = BASE_TILE*2.4;
// Reliques : revenu passif en or, par relique mise à l'abri au Monastère.
const RELIC_GOLD_RATE = 0.15; // or/s/relique (≈9/min — comparable à un mineur)
// Merveille : temps qu'elle doit tenir debout, achevée, avant la victoire.
const MERVEILLE_WIN_TIME = 300; // 5 minutes — le temps pour l'adversaire de réagir
const GCAP  = 22;            // capacité inventaire villageois (moins d'allers-retours)
// Capacité réelle, par camp : la Brouette (recherche économique) l'augmente.
// GCAP restait une constante GLOBALE, donc impossible à faire dépendre d'une
// faction — en multijoueur, la recherche de l'hôte se serait appliquée aussi
// aux villageois du client.
const GCAP_BROUETTE = 8;
function gatherCap(owner){ return GCAP+(rechercheDe(owner).brouette?GCAP_BROUETTE:0); }
const NODE_RICHNESS = 1.5;   // gisements 50% plus riches
const FARM_FOOD = 350;
const FARM_RESEED_COST = {wood:30};  // façon AoE2 : re-semer coûte du bois
let _lastFarmNotify=0;
// Re-semis automatique : dès qu'un champ est vide, on retente le paiement en
// bois à chaque image. Tant que le bois suit, le silo est refait quasi
// instantanément et le fermier ne décroche jamais ; sans bois, il patiente.
function tryAutoReseed(b){
  if(b.foodLeft>0){ b._reseedWarned=false; return; }
  const t=G.gameTime||0;
  // Toujours facturer LE PROPRIÉTAIRE du champ (b.owner), pas G.me : en
  // multijoueur en ligne, cette fonction tourne côté hôte pour les fermes
  // des DEUX camps (voir updateBuildings) — sans owner explicite, canAfford/
  // spend retombent sur la caisse de l'hôte et prélèveraient son bois pour
  // resemer le champ du client.
  // Francs : le champ se re-seme sans rien coûter. Bonus STRUCTUREL et non
  // un multiplicateur : il change la façon de jouer (les fermes deviennent
  // une économie sans entretien) plutôt que d'ajouter des pourcents.
  const gratuit=!!civOf(b.owner).fermeGratuite;
  if(gratuit||canAfford(FARM_RESEED_COST,b.owner)){
    if(!gratuit) spend(FARM_RESEED_COST,b.owner);
    b.foodLeft=FARM_FOOD; b._reseedWarned=false;
    spawnParts(b.x,b.y,'#8fbc44',6);
    addFText(b.x,b.y-18,'🌱','#8fbc44');
    if(estLocal(b)&&t-_lastFarmNotify>3){ _lastFarmNotify=t; notify(`🌱 Ferme re-semée (-${FARM_RESEED_COST.wood}🪵)`,'#8fbc44'); }
  } else if(!b._reseedWarned){
    b._reseedWarned=true;
    if(estLocal(b)&&t-_lastFarmNotify>3){ _lastFarmNotify=t; notify('🪵 Bois insuffisant pour re-semer une ferme','#e67e22'); }
  }
}
const FIRST_WAVE_DELAY = 1200; // temps de paix avant le premier assaut (à difficulté Normal)
const WAVE_BASE_DELAY  = 720;  // base entre deux vagues ensuite (à difficulté Normal)
const WAVE_MIN_DELAY   = 150;  // plancher aux vagues tardives // stock de nourriture d'une ferme (récoltée par les villageois)

// ── DIFFICULTÉ ────────────────────────────────────────────
// Choisie sur l'écran-titre, figée pour toute la partie (comme l'âge de
// départ) — pas de bouton pour la changer en cours de jeu, afin de ne pas
// avoir à re-doser rétroactivement les ennemis déjà en vie ni les vagues
// déjà écoulées. Un seul jeu de multiplicateurs, appliqué à la source
// (ressources de départ, coût des bâtiments, effectif/force des vagues,
// rythme, récompense) plutôt que dispersé en correctifs ad hoc.
//
// Le mode Normal d'origine laissait bien trop de répit (20 minutes de paix,
// coûts de construction inchangés) : le jeu se jouait tout seul. Facile
// reste la seule difficulté « repos » ; à partir de Normal, le temps avant
// la première attaque ET le coût des bâtiments augmentent tous les deux —
// il faut désormais construire vite ET compter serré.
const DIFFS = {
  easy:   { nom:'Facile',    ico:'🌿', enemyHp:0.75, enemyAtk:0.75, enemyCount:0.75, waveDelayMult:1.25, rewardMult:0.85, buildCostMult:1.0,
            startRes:{food:120,wood:80,stone:0,gold:0},
            desc:'Plus de temps, ennemis plus faibles, constructions au prix normal — pour découvrir le jeu.' },
  normal: { nom:'Normal',    ico:'⚔️', enemyHp:1,    enemyAtk:1,    enemyCount:1,    waveDelayMult:0.75, rewardMult:1,    buildCostMult:1.15,
            startRes:{food:80,wood:50,stone:0,gold:0},
            desc:"Moins de répit avant la 1ère vague, constructions +15% plus chères." },
  hard:   { nom:'Difficile', ico:'🔥', enemyHp:1.3,  enemyAtk:1.2,  enemyCount:1.2,  waveDelayMult:0.6,  rewardMult:1.15, buildCostMult:1.3,
            startRes:{food:70,wood:45,stone:0,gold:0},
            desc:'Vagues rapprochées et nombreuses, constructions +30% plus chères.' },
  brutal: { nom:'Brutal',    ico:'💀', enemyHp:1.65, enemyAtk:1.4,  enemyCount:1.4,  waveDelayMult:0.45, rewardMult:1.3,  buildCostMult:1.5,
            startRes:{food:60,wood:40,stone:0,gold:0},
            desc:'Assauts massifs et quasi sans répit, constructions +50% plus chères.' },
};

// ── CIVILISATIONS ─────────────────────────────────────────
// Un seul bonus passif marquant par civilisation, appliqué à des points de
// passage déjà centralisés (mkUnit, mkBuilding, gatherMult) : pas de nouveau
// système, juste une lecture en plus à chacun de ces trois endroits.
// Une civilisation, c'était UN multiplicateur. Quatre camps qui jouaient
// exactement la même partie — alors que le Centre Ville a, lui, quatre
// illustrations dédiées par civilisation et par âge. L'écart entre le travail
// visuel et le travail mécanique était le vrai déséquilibre.
//
// Chaque camp a désormais TROIS choses, et c'est le minimum pour qu'une
// civilisation se joue différemment plutôt que d'être « la même en plus
// fort » :
//   `unique`  — une unité à lui seul, formée au Château (voir PRODUCTION) ;
//   `techCiv` — une recherche exclusive à l'Âge Impérial (voir RDEF) ;
//   un bonus ÉCONOMIQUE ou STRUCTUREL, lu là où il agit, jamais un
//   multiplicateur global de plus.
const CIVS = {
  francs:    { nom:'Francs',    ico:'🐴',
               desc:'+20% PV Cavalerie · Fermes re-semées gratuitement · Paladin · Chevalerie Franque',
               cavHpMult:1.20, fermeGratuite:true, unique:null, techCiv:'chevalerie' },
  byzantins: { nom:'Byzantins', ico:'🛡️',
               desc:'+15% PV bâtiments · chantiers 30% plus rapides · Cataphractaire · Feu Grégeois',
               bldHpMult:1.15, chantierMult:1.30, unique:UT.CATA, techCiv:'feu_gregeois' },
  chinois:   { nom:'Chinois',   ico:'🌾',
               desc:'+15% récolte · 2 villageois et +2 de population au départ · Arbalétrier à Répétition · Arc Composite',
               gatherMult:1.15, vilBonusDepart:2, popBonusDepart:2, unique:UT.ARBRAP, techCiv:'arc_composite' },
  mongols:   { nom:'Mongols',   ico:'🏹',
               desc:'+20% ATK à distance · chasse deux fois plus rapide · Cavalier-Archer · Étriers de Fer',
               rangedAtkMult:1.20, chasseMult:2.0, unique:UT.CAVARC, techCiv:'etriers' },
};
// ── TYPES DE CARTE ────────────────────────────────────────
// genMap() ne produisait qu'UN seul type de monde : lacs epars, forets
// denses, or aux extremites, depart au centre. Aucun reglage, aucune
// variante — et donc la meme partie a chaque fois, quelle que soit la graine.
//
// Chaque preset n'est qu'un jeu de MULTIPLICATEURS applique aux memes appels
// place() : rien n'est reecrit, la sequence de tirages reste identique, donc
// le determinisme partage hote/client (voir genMap et le groupe `carte` des
// tests) est preserve tel quel.
//
// Ce qu'on ne trouvera PAS ici, et pourquoi :
//   • pas de carte « Foret Noire » facon AoE2 : les arbres sont marques 2
//     dans bmap, pas 3 — ils ne bloquent AUCUN passage. Une muraille
//     d'arbres serait purement decorative tant que ce choix tient.
//   • pas de carte « Iles » : sans navire de transport, les camps seraient
//     inatteignables et la partie ne pourrait pas se terminer.
//
// Chaque preset porte aussi son SOL (voir SOLS plus bas) : jusqu'ici les cinq
// cartes se ressemblaient trait pour trait une fois en jeu — meme vert, meme
// texture — et seule la densite des ressources les distinguait. Le sol est la
// premiere chose qu'on voit ; c'est lui qui doit dire ou l'on joue.
const CARTES = {
  plaines: { nom:'Plaines',      ico:'🌾', sol:'plaines',
             desc:'Équilibrée — la carte historique du jeu' },
  foret:   { nom:'Grande Forêt', ico:'🌲', foret:2.2, or:0.55, pierre:0.6, baies:1.3, sol:'foret',
             desc:'Bois surabondant, or et pierre rares — l’armée chère se paie cher' },
  arides:  { nom:'Terres Arides', ico:'🪨', foret:0.45, or:1.6, pierre:1.7, baies:0.7, lacs:0.5, sol:'arides',
             desc:'Peu d’arbres, filons généreux — chaque bûcheron compte' },
  lacs:    { nom:'Grands Lacs',   ico:'🌊', lacs:2.2, poissons:2.6, foret:0.9, sol:'lacs',
             desc:'Beaucoup d’eau et de poisson — le Quai devient une vraie économie' },
  arene:   { nom:'Arène',        ico:'🏟️', murs:true, foret:0.8, or:1.2, sol:'arene',
             desc:'Chaque camp démarre derrière une palissade à quatre portails' },
};

// ── SOL PAR TYPE DE CARTE ─────────────────────────────────
// Trois reglages seulement, appliques par-dessus la MEME texture d'herbe
// procedurale (voir buildTerrain) — aucune texture supplementaire a generer,
// donc aucun cout d'atlas ni de memoire :
//   • `teinte` : voile plaque case par case dans le pave de terrain. Il
//     deplace la teinte generale du sol sans effacer le grain, les brins ni
//     les touffes, qui restent lisibles au travers. `null` = herbe nue.
//   • `terre`  : couleur des clairieres de terre battue (voir drawPatches),
//     en composantes r,g,b — l'opacite est posee par le degrade.
//   • `densite`: probabilite qu'un pave de 8x8 cases porte une clairiere.
//     0.90 sur les Terres Arides (la terre y perce partout), 0.30 sous la
//     futaie (l'humus reste couvert).
//   • `mini`   : le meme sol, aplati en une couleur, pour la mini-carte —
//     sans quoi une carte aride verte en miniature contredirait le terrain.
const SOLS = {
  plaines: { teinte:null,                       terre:'128,106,66', densite:0.50, mini:'#53823a' },
  foret:   { teinte:'rgba(34,68,32,.26)',       terre:'74,58,36',   densite:0.30, mini:'#3f6b30' },
  arides:  { teinte:'rgba(178,146,80,.52)',     terre:'152,122,74', densite:0.90, mini:'#87873f' },
  lacs:    { teinte:'rgba(96,158,74,.20)',      terre:'112,96,60',  densite:0.30, mini:'#4f8a3c' },
  // L'arene est une plaine pietinee : meme vert, mais la terre y affleure
  // deux fois plus souvent qu'ailleurs.
  arene:   { teinte:'rgba(120,104,62,.14)',     terre:'128,106,66', densite:0.70, mini:'#4f7d3a' },
};
let selectedCarte='plaines';
function pickCarte(key){
  if(!CARTES[key]) return;
  selectedCarte=key;
  document.querySelectorAll('#carterow .diffbtn').forEach(b=>b.classList.toggle('sel', b.dataset.k===key));
  const t=document.getElementById('cartetip');
  if(t) t.textContent=`${CARTES[key].nom} — ${CARTES[key].desc}`;
  try{ localStorage.setItem('adc_carte',key); }catch(e){}
  updateCfgSummary();
}
window.pickCarte=pickCarte;
// Reglages de la carte en cours. G.carte est pose par initState ; EMPTY sert
// aux lectures faites avant la premiere partie.
const CARTE_DEF=CARTES.plaines;
function carteCfg(){ return (typeof G!=='undefined'&&G&&CARTES[G.carte])||CARTE_DEF; }
// Multiplicateur d'un reglage, 1 par defaut.
function cM(cle){ const v=carteCfg()[cle]; return v==null?1:v; }
// Reglages de sol de la carte en cours (voir SOLS). Retombe sur les Plaines
// pour toute carte qui n'en declare pas — y compris une sauvegarde ancienne
// enregistree avant l'existence de ce champ.
function solCfg(){ return SOLS[carteCfg().sol]||SOLS.plaines; }

let selectedCiv='francs';
function pickCiv(key){
  if(!CIVS[key]) return;
  selectedCiv=key;
  document.querySelectorAll('#civrow .diffbtn').forEach(b=>b.classList.toggle('sel', b.dataset.c===key));
  const ct=document.getElementById('civtip');
  if(ct) ct.textContent=`${CIVS[key].nom} — ${CIVS[key].desc}`;
  try{ localStorage.setItem('adc_civ',key); }catch(e){}
  updateCfgSummary();
}
window.pickCiv=pickCiv;
// Bonus de la civilisation d'un camp — EMPTY_CIV si la faction n'existe pas
// encore (lecture avant première image, comme rechercheDe/EMPTY_RESEARCH).
const EMPTY_CIV={};
function civOf(owner){ const f=fac(owner); return (f&&CIVS[f.civ])||EMPTY_CIV; }
// Clé brute de la civilisation ('francs','byzantins',...), pas l'objet de
// bonus — sert à choisir le bon jeu d'illustrations (voir BLD_CIV_SPRITE_FILES).
function civKeyOf(owner){ const f=fac(owner); return (f&&f.civ)||'francs'; }

// ── HÉROS DE CIVILISATION ─────────────────────────────────
// Une unité unique et nommée par civilisation, entraînable UNE SEULE FOIS
// par partie (même si elle meurt — voir ORD.FORMER et f.heroTrained), au
// Château. Statistiques de combat identiques pour les 4 civs (voir
// UDEF[UT.HERO]) : seuls le nom et l'icône changent, plus l'aura de
// leadership qu'elles apportent toutes (voir heroAuraMult).
const HEROES = {
  francs:    { nom:'Charlemagne', ico:'👑' },
  byzantins: { nom:'Bélisaire',   ico:'🛡️' },
  chinois:   { nom:'Sun Tzu',     ico:'📯' },
  mongols:   { nom:'Gengis Khan', ico:'🏇' },
};
const HERO_AURA_RADIUS = BASE_TILE*6;
const HERO_AURA_MULT = 1.15;
// Multiplicateur d'ATK pour une unité militaire à portée d'un héros allié
// vivant (le héros lui-même en profite aussi : rien ne l'exclut du calcul).
// Héros vivants, recensés UNE FOIS par pas de simulation (voir update).
// heroAuraMult est appelé à chaque coup porté par chaque unité — mêlée,
// projectile, riposte de l'IA : balayer tout G.units à chaque fois, c'était
// des centaines de milliers d'itérations par seconde en grosse bataille
// pour retrouver au plus quatre héros (un par camp, voir f.heroTrained).
let _heros=[];
function majHeros(){
  _heros.length=0;
  for(const u of G.units) if(u.type===UT.HERO&&u.hp>0) _heros.push(u);
}
function heroAuraMult(u){
  // Sortie immédiate dans le cas de très loin le plus fréquent : aucun héros
  // sur la carte. Avant, ce cas coûtait quand même un balayage complet.
  if(!_heros.length||!isMilitary(u.type)) return 1;
  for(const h of _heros){
    if(h.hp<=0||h.owner!==u.owner) continue;   // un héros peut mourir dans le pas courant
    if(Math.hypot(h.x-u.x,h.y-u.y)<=HERO_AURA_RADIUS) return HERO_AURA_MULT;
  }
  return 1;
}

// ── SÉLECTION : appartenance en O(1) ───────────────────────
// `estSel(id)` À L'INTÉRIEUR d'un balayage de toutes les unités
// (selMilitary, assignerGroupe, les ordres de la barre d'action...) donne un
// O(n×m) : 300 unités sélectionnées sur 900 en jeu, c'est 270 000
// comparaisons par appel, et ces appels partent au rythme des clics.
//
// Le cache est indexé sur la RÉFÉRENCE du tableau, et c'est ce qui le rend
// exact sans discipline : G.sel n'est jamais muté en place dans tout le
// fichier (aucun push/splice — vérifié), il est toujours RÉASSIGNÉ. Toute
// modification change donc la référence et invalide le cache d'elle-même.
// Si un jour un `G.sel.push(...)` apparaît, ce cache devient faux : passer
// alors par une fonction de mutation dédiée.
let _selSet=new Set(), _selRef=null;
function estSel(id){
  if(_selRef!==G.sel){ _selRef=G.sel; _selSet=new Set(G.sel); }
  return _selSet.has(id);
}

// ── CALCUL DES DÉGÂTS (point de passage UNIQUE) ────────────
// Tout coup porté dans le jeu passe par ici : mêlée (doAttack), riposte de
// l'IA bloquée par un mur (updateEnemyAI), impact de projectile ciblé ET
// dégâts de zone d'un tir de siège (updateProjs), tir automatique d'une
// Tour ou d'un Château (updateBuildings). Auparavant chacun de ces cinq
// endroits refaisait son propre calcul — d'où un bélier qui frappait
// à dégâts nus quand il atteignait un mur par le chemin de repli.
//
// `profil` décrit l'ATTAQUANT indépendamment de l'unité elle-même : un
// projectile survit à son tireur (et un tir de siège touche des cibles que
// le tireur ne visait pas), il doit donc emporter de quoi recalculer les
// dégâts à l'impact, contre chaque victime.
function profilAttaque(u){
  return { atk:u.atk*heroAuraMult(u), type:u.type };
}
function estBatiment(e){ return e&&e.w!=null&&e.tx!=null; }
function classeDe(e){
  if(estBatiment(e)) return CLS.BAT;
  const d=UDEF[e.type];
  return (d&&d.cls)||CLS.INF;
}
function armureDe(e){
  if(estBatiment(e)) return BLD_ARMOR;
  const d=UDEF[e.type], a=(d&&d.armor)||{m:0,p:0};
  // Armure de Fer : la recherche qui donnait déjà +30% PV protège aussi
  // d'un point contre les deux types d'attaque. Lue à la volée plutôt que
  // recopiée sur l'unité : rien de nouveau n'a besoin de voyager sur le
  // réseau (voir serialiserUnite), la faction suffit à la retrouver.
  const r=rechercheDe(e.owner);
  if(r.iron_armor&&isMilitary(e.type)) return {m:a.m+1,p:a.p+1};
  return a;
}
function degatsContre(profil,cible){
  const d=profil.type!=null?UDEF[profil.type]:null;
  // `resistBonus` attenue la PART DE BONUS, pas l'attaque de base : c'est ce
  // qui donne sa niche au Cataphractaire. L'armure seule n'y suffisait pas --
  // le Piquier frappe a +25 contre la cavalerie, donc 2 points d'armure de
  // plus que le Chevalier ne lui faisaient encaisser que 6 % de mieux
  // (mesure : 34 degats contre 36). Avec 0,5, il tombe a 21 : la promesse
  // « la cavalerie qui ne fond pas sous les Piquiers » devient vraie.
  const dc=UDEF[cible.type];
  const resist=(dc&&dc.resistBonus!=null)?dc.resistBonus:1;
  const bonus=Math.round(((BONUS[profil.type]||{})[classeDe(cible)]||0)*resist);
  // Un tir de bâtiment (Tour/Château) n'a pas de type d'unité : il compte
  // comme un trait, sans aucun bonus de contre.
  const arm=armureDe(cible)[(d&&d.atkType)||'p']||0;
  return Math.max(1,Math.round(profil.atk+bonus-arm));
}
// Raccourci pour les coups portés directement par une unité présente.
function degatsDe(u,cible){ return degatsContre(profilAttaque(u),cible); }

// ── VÉTÉRANCE ────────────────────────────────────────────
// Une unité militaire qui survit à ses combats gagne de l'XP à chaque
// ennemi qu'elle achève (un coup porté ne suffit pas — il faut le kill,
// comme un Chef de Guerre le reconnaîtrait) et monte en grade par paliers
// cumulatifs. Donne une vraie raison de protéger ses troupes plutôt que de
// les sacrifier en vagues jetables.
const RANK_THRESHOLDS = [
  { kills:3, mult:1.15, nom:'Vétéran', ico:'🎖️' },
  { kills:8, mult:1.30, nom:'Élite',   ico:'⭐' },
];
function veterancyRank(xp){
  let r=0;
  for(let i=0;i<RANK_THRESHOLDS.length;i++) if(xp>=RANK_THRESHOLDS[i].kills) r=i+1;
  return r;
}
// `killerId` : identifiant de l'unité ayant porté le coup fatal — voir
// doAttack (mêlée, référence directe) et updateProjs (tir, via
// p.shooterId, seul moyen de remonter jusqu'au tireur une fois la flèche
// partie). Balayage direct plutôt que unitById : peut être appelé juste
// après une mort, avant la prochaine reconstruction de l'index.
function awardKillXP(killerId){
  if(killerId==null) return;
  const u=G.units.find(x=>x.id===killerId);
  if(!u||u.hp<=0||!isMilitary(u.type)) return;
  u.xp=(u.xp||0)+1;
  const rank=veterancyRank(u.xp);
  if(rank<=(u.rank||0)) return;
  const cfg=RANK_THRESHOLDS[rank-1];
  const prevMult=rank>1?RANK_THRESHOLDS[rank-2].mult:1;
  const dmg=u.maxHp-u.hp;
  u.maxHp=Math.round(u.maxHp/prevMult*cfg.mult);
  u.hp=Math.max(1,u.maxHp-dmg);
  u.atk=Math.round(u.atk/prevMult*cfg.mult);
  u.rank=rank;
  const fo=fac(u.owner);
  if(fo&&rank>=RANK_THRESHOLDS.length) fo.stats.hadEliteUnit=true; // survit à la mort de l'unité, pour le succès 'elite_unit'
  if(estLocal(u)){ notify(`${cfg.ico} Une unité devient ${cfg.nom} !`,'#f0c040'); addFText(u.x,u.y-24,cfg.nom,'#f0c040'); }
}

// Coût réel d'un bâtiment, mis à l'échelle par la difficulté en cours.
// Point de passage UNIQUE pour tout coût de construction/amélioration de
// bâtiment : le menu de construction, la confirmation de pose et
// l'amélioration de tour l'utilisent tous, pour ne jamais afficher un
// montant différent de celui réellement prélevé.
function scaleCost(cost){
  const mult=(DIFFS[G.difficulty]||DIFFS.normal).buildCostMult||1;
  if(mult===1) return cost;
  const out={};
  for(const[r,v] of Object.entries(cost)) out[r]=Math.round(v*mult);
  return out;
}
let selectedDifficulty='normal'; // choix courant sur l'écran-titre (avant démarrage)

// Libellé dérivé des constantes : les textes ne peuvent plus mentir sur le délai,
// et reflètent la difficulté choisie (avant partie) ou en cours (pendant).
function peaceLabel(diffKey,modeKey){
  const dk=diffKey||(G&&G.difficulty)||'normal';
  const mk=modeKey||(typeof selectedMode!=='undefined'?selectedMode:'survival');
  // Conquête : le répit n'est pas dicté par le minuteur de vagues mais par le
  // délai avant le premier raid de l'adversaire (AI_TUNE.firstAtk).
  // Tout mode sans vagues scriptees (targetWaves:0 -- Conquete, 2 rivaux,
  // 2v1 coop) est rythme par le premier raid de l'IA, pas par le minuteur
  // de vagues de Survie.
  const sansVagues=(MODES[mk]||{}).targetWaves===0;
  const sec=sansVagues
    ? (AI_TUNE[dk]||AI_TUNE.normal).firstAtk
    : FIRST_WAVE_DELAY*(DIFFS[dk]||DIFFS.normal).waveDelayMult;
  const m=Math.round(sec/60);
  return m>=60?`${(m/60).toFixed(m%60?1:0)} heure${m>=120?'s':''}`:`${m} minutes`;
}

// Sélection de la difficulté sur l'écran-titre : met à jour la surbrillance,
// le texte explicatif et l'annonce du temps de paix, et mémorise le choix.
function pickDifficulty(key){
  if(!DIFFS[key]) return;
  selectedDifficulty=key;
  document.querySelectorAll('#diffrow .diffbtn').forEach(b=>b.classList.toggle('sel', b.dataset.d===key));
  const dt=document.getElementById('difftip');
  if(dt) dt.textContent=`${DIFFS[key].nom} — ${DIFFS[key].desc}`;
  const pt=document.getElementById('peacetxt');
  if(pt) pt.textContent=peaceLabel(key);
  try{ localStorage.setItem('adc_diff',key); }catch(e){}
  updateCfgSummary();
}
window.pickDifficulty=pickDifficulty;

// ── RÉSUMÉ PLIABLE MODE + DIFFICULTÉ (écran-titre) ──────────
// Reflète toujours le choix courant, pour que le résumé reste vrai même
// replié. Appelé par pickMode()/pickDifficulty() (définis juste après/avant)
// et une fois au chargement (voir tout en bas du fichier).
function updateCfgSummary(){
  const txt=document.getElementById('cfgsummary-txt');
  if(!txt) return;
  const m=MODES[selectedMode]||MODES.survival, d=DIFFS[selectedDifficulty]||DIFFS.normal, c=CIVS[selectedCiv]||CIVS.francs;
  txt.textContent=`${m.ico} ${m.nom} · ${d.ico} ${d.nom} · ${c.ico} ${c.nom}`;
}
function toggleCfg(){
  const det=document.getElementById('cfgdetails');
  const btn=document.getElementById('cfgsummary');
  if(!det||!btn) return;
  const ouvre=det.style.display==='none';
  det.style.display=ouvre?'flex':'none';
  btn.classList.toggle('open',ouvre);
}
window.toggleCfg=toggleCfg;

// ── MODES DE JEU ──────────────────────────────────────────
// survival : le mode historique — des vagues scriptées arrivent des bords,
//   survivre à MODES.survival.targetWaves suffit à gagner.
// conquest : un adversaire complet (base, économie, âges, armée) s'installe
//   à l'autre bout de la carte. Aucune vague scriptée, aucun camp neutre :
//   la seule menace est cette IA, et la victoire consiste à raser SON Centre
//   Ville avant qu'elle ne rase le vôtre.
const MODES = {
  survival: { nom:'Survie',   ico:'🛡️', targetWaves:20,
              desc:"Repoussez 20 vagues d'assaut pour l'emporter.",
              intro:'Récoltez bois, pierre et or. Bâtissez votre cité. Forgez vos armes.<br>Vous avez <strong id="peacetxt">20 minutes</strong> avant la première attaque !' },
  conquest2:{ nom:'2 rivaux', ico:'⚔️', targetWaves:0, rivaux:2,
              desc:'Deux seigneurs rivaux, hostiles à vous ET entre eux. Le dernier Centre Ville debout l\'emporte.',
              intro:'Trois cités se partagent la carte : la vôtre et deux rivaux qui se combattent aussi entre eux.<br>Laissez-les s\'affaiblir… ou frappez le premier.' },
  conquest: { nom:'Conquête', ico:'🏴', targetWaves:0, rivaux:1,
              desc:'Un seigneur rival bâtit sa propre cité. Détruisez son Centre Ville — avant qu\'il ne détruise le vôtre.',
              intro:'Un rival récolte, construit, monte les âges et lève ses armées en même temps que vous.<br>Son premier assaut n\'arrive pas avant <strong id="peacetxt">8 minutes</strong> — pas de vagues, un seul adversaire.' },
  coop2v1:  { nom:'2v1 Coop',  ico:'🤝', targetWaves:0, rivaux:1, coop:true,
              desc:'Deux joueurs alliés (bouton « Jouer avec un ami ») contre un seul seigneur IA, à la difficulté choisie ci-dessous.',
              intro:'Rejoignez-vous à un allié (bouton « Jouer avec un ami » ci-dessous) pour affronter ensemble un seul seigneur rival.<br>Son premier assaut n\'arrive pas avant <strong id="peacetxt">8 minutes</strong>. Lancé seul, ce mode se joue comme la Conquête.' },
};
let selectedMode='survival';
function pickMode(key){
  if(!MODES[key]) return;
  selectedMode=key;
  document.querySelectorAll('.modebtn').forEach(b=>b.classList.toggle('sel', b.dataset.m===key));
  const mt=document.getElementById('modetip');
  if(mt) mt.textContent=`${MODES[key].nom} — ${MODES[key].desc}`;
  const mi=document.getElementById('modeintro');
  if(mi) mi.innerHTML=MODES[key].intro;
  // L'intro de Survie contient #peacetxt, réinjecté ci-dessus : il faut le
  // re-remplir, sinon il resterait sur son texte HTML par défaut après un
  // aller-retour Conquête → Survie.
  const pt=document.getElementById('peacetxt');
  if(pt) pt.textContent=peaceLabel(selectedDifficulty);
  try{ localStorage.setItem('adc_mode',key); }catch(e){}
  updateCfgSummary();
}
window.pickMode=pickMode;

// Recherches — cat:'forge' = Forge / cat:'univ' = Université
const RDEF = {
  iron_sword: { nom:'Épée de Fer',    ico:'⚔️', cost:{gold:80,wood:40},    time:30,  desc:'+25% ATK Miliciens et Piquiers',     cat:'forge' },
  bow_craft:  { nom:'Arc Renforcé',   ico:'🏹', cost:{gold:60,wood:50},    time:30,  desc:'+25% ATK Archers et Arbalétriers',   cat:'forge' },
  cavalry:    { nom:'Cavalerie',      ico:'🐴', cost:{gold:100,food:80},   time:45,  desc:'+20% PV Chevaliers, Paladins et Éclaireurs', cat:'forge' },
  iron_armor: { nom:'Armure de Fer',  ico:'🛡️', cost:{gold:120,stone:80},  time:45,  desc:'+30% PV aux unités militaires',      cat:'forge' },
  masonry:    { nom:'Maçonnerie',     ico:'🧱', cost:{stone:120,food:80},  time:40,  desc:'+25% PV aux bâtiments',              cat:'forge' },
  siege_smithing:{ nom:'Forge de Siège', ico:'🐏', cost:{gold:150,stone:100}, time:50,  desc:'+25% ATK Béliers et Trébuchets',   cat:'forge' },
  cavalry_lance:{ nom:'Lance de Cavalerie', ico:'🗡️', cost:{gold:120,wood:60}, time:40,  desc:'+20% ATK Chevaliers, Paladins et Éclaireurs', cat:'forge' },
  longbow:    { nom:'Arc Long',       ico:'🎯', cost:{gold:150,wood:80},   time:60,  desc:'+50% portée des Archers',            cat:'univ'  },
  tactics:    { nom:'Tactiques',      ico:'📜', cost:{gold:200,food:100},  time:75,  desc:'+20% ATK à toutes vos unités',       cat:'univ'  },
  faith:      { nom:'Foi Divine',     ico:'✝️', cost:{gold:200,stone:150}, time:90,  desc:'Débloque le Paladin',                cat:'univ'  },
  engineering:{ nom:'Génie Civil',    ico:'🔧', cost:{stone:200,gold:80},  time:60,  desc:'+40% PV des Tours et Château',       cat:'univ'  },
  fortification:{ nom:'Fortifications', ico:'🏯', cost:{stone:220,gold:90}, time:65,  desc:'+25% PV Murs, Portails et Avant-postes', cat:'univ' },
  logistics:  { nom:'Logistique',     ico:'🥾', cost:{gold:180,food:120},  time:70,  desc:'+15% vitesse de déplacement des unités militaires', cat:'univ' },
  // ── Économie (Moulin) ──
  // Les treize recherches ci-dessus sont TOUTES militaires ou défensives :
  // le vrai arbitrage du genre — « j'investis dans l'économie ou dans
  // l'armée maintenant ? » — ne se posait donc jamais, tout l'or partait
  // mécaniquement dans l'armée. Ces trois-là rétablissent le dilemme.
  brouette:   { nom:'Brouette',       ico:'🛒', cost:{wood:100,food:75},   time:40,  desc:'+8 de capacité de portage des villageois (22 → 30)', cat:'eco' },
  charrue:    { nom:'Charrue Lourde', ico:'🐂', cost:{food:150,wood:75},   time:50,  desc:'+15% vitesse de récolte sur toutes les ressources',   cat:'eco' },
  // ── Recherches EXCLUSIVES par civilisation (Âge Impérial, Université) ──
  // Filtrées par `civ` : voir openRP et la validation d'ORD.RECHERCHE. Une
  // civilisation qui n'a pas la sienne ne la voit pas et ne peut pas la
  // lancer, même par un ordre réseau forgé.
  chevalerie:   { nom:'Chevalerie Franque', ico:'🏇', cost:{gold:250,food:180}, time:80, age:3, civ:'francs',
                  desc:'+15% ATK à toute votre cavalerie', cat:'univ' },
  feu_gregeois: { nom:'Feu Grégeois',       ico:'🔥', cost:{gold:220,stone:200}, time:80, age:3, civ:'byzantins',
                  desc:'+30% ATK des Tours et du Château', cat:'univ' },
  arc_composite:{ nom:'Arc Composite',      ico:'🏹', cost:{gold:230,wood:200}, time:80, age:3, civ:'chinois',
                  desc:'+1 case de portée à tous vos tireurs', cat:'univ' },
  etriers:      { nom:'Étriers de Fer',     ico:'👟', cost:{gold:200,food:200}, time:80, age:3, civ:'mongols',
                  desc:'+15% vitesse de toute votre cavalerie', cat:'univ' },
  sentiers:   { nom:'Sentiers Pavés', ico:'🛤️', cost:{wood:120,gold:50},   time:45,  desc:'+15% vitesse de déplacement des villageois',          cat:'eco' },
};

// ── SYSTÈME D'ÂGES ────────────────────────────────────────
const AGES = [
  { nom:'Âge Sombre',   ico:'🌑', cost:{},                     bonus:'Début de votre civilisation' },
  { nom:'Âge Féodal',   ico:'🌅', cost:{food:500},
    bonus:'+15% PV bâtiments · +10% récolte · +6 par Maison · débloque Piquier & Tour de Garde' },
  { nom:'Âge des Châteaux',ico:'🏰', cost:{food:800,gold:200},
    bonus:'+30% PV bâtiments · +20% récolte · +7 par Maison · débloque Château Fort, Arbalétrier & Donjon' },
  { nom:'Âge Impérial', ico:'👑', cost:{food:1200,gold:600},
    bonus:'+45% PV bâtiments · +30% récolte · +25% ATK unités · +8 par Maison · pop. max 80 · débloque Trébuchet' },
];

// ── BONUS CUMULÉS PAR ÂGE (source unique) ──────────────────────────────
// Avant, chaque bonus était une ligne isolée (+20% PV bâtiments appliqué
// une seule fois à l'Âge Féodal, jamais augmenté ensuite ; récolte et ATK
// militaire ne bougeaient qu'à un seul palier chacun) : l'Âge Féodal et
// l'Âge Impérial ne rapportaient presque rien à l'économie, et le Château
// Fort n'était même pas réellement verrouillé par l'âge malgré ce que
// prétendait sa description. Cette table centralise tout, avec un gain
// économique ET défensif à chaque palier, pas seulement au dernier.
const AGE_BONUS = [
  { bldHp:1.00, gather:1.00, unitHp:1.00, milAtk:1.00, housePop:5, popCap:300 },
  { bldHp:1.15, gather:1.10, unitHp:1.08, milAtk:1.08, housePop:6, popCap:300 },
  { bldHp:1.30, gather:1.20, unitHp:1.15, milAtk:1.16, housePop:7, popCap:300 },
  { bldHp:1.45, gather:1.30, unitHp:1.22, milAtk:1.25, housePop:8, popCap:300 },
];

// Icônes bâtiments
const BICO = {
  [BT.TC]:'🏰',[BT.HOUSE]:'🏠',[BT.LUMBER]:'🪵',[BT.MINE]:'⛏️',
  [BT.FARM]:'🌾',[BT.MILL]:'💨',[BT.MARKET]:'🏪',[BT.FORGE]:'⚒️',
  [BT.BARRACKS]:'⚔️',[BT.STABLE]:'🐴',[BT.MONASTERY]:'⛪',[BT.UNIV]:'🎓',
  [BT.TOWER]:'🗼',[BT.CASTLE]:'🏯',[BT.WALL]:'🪵',
  [BT.SIEGE]:'🛠️',[BT.OUTPOST]:'🚩',[BT.GATE]:'🚪',[BT.HLM]:'🏢',[BT.WONDER]:'🏛️',[BT.DOCK]:'⛵',
};

// Même emoji que le bouton de formation correspondant (voir drawBuildAct) —
// centralisé ici pour que la file d'attente (drawBuildAct) affiche la bonne
// icône par unité sans dupliquer les emojis à deux endroits.
const UNIT_ICO = {
  [UT.VIL]:'👷', [UT.MIL]:'⚔️', [UT.ARC]:'🏹', [UT.PIKE]:'🔱', [UT.SCOUT]:'💨',
  [UT.KNIGHT]:'🐴', [UT.MONK]:'⛪', [UT.PALADIN]:'🌟', [UT.XBOW]:'🎯',
  [UT.TREB]:'🪨', [UT.RAM]:'🐏', [UT.HERO]:'⭐', [UT.BOAT]:'⛵',
  [UT.CATA]:'🛡️', [UT.CAVARC]:'🏎️', [UT.ARBRAP]:'🎋',
};
