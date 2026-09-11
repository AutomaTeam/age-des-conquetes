'use strict';
// ======================================================================
//  15-campagne.js
// ======================================================================
// Moteur du mode Campagne : état de scénario (G.scn), vocabulaire des
// scénaristes (SCN_API, que chaque mission reçoit sous le nom `M`),
// surcouche de carte, pose des camps, boucle des objectifs et des
// déclencheurs, fin de mission.
//
// Le CONTENU — les missions elles-mêmes — vit dans js/16-missions.js. Ici,
// rien ne connaît une mission particulière.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.
//
// Trois règles tiennent tout le reste, et viennent toutes du réseau (voir le
// plan de campagne et js/12-reseau.js) :
//   • le scénario ne s'évalue que chez l'HÔTE (update() ne tourne que chez
//     lui) ; c'est son RÉSULTAT qui voyage, jamais les prédicats ;
//   • le décor d'une mission (eau, gisements, reliques, faune) est posé par
//     la surcouche pendant genMap(), donc à l'identique des deux côtés — le
//     client ne passe jamais par startGame, et ni les gisements ni les
//     reliques ne voyagent sur le réseau. Un déclencheur en cours de partie
//     peut poser des unités et des bâtiments (ils voyagent), donner des
//     ressources, changer des camps — jamais créer un gisement ;
//   • G.scn ne contient que des DONNÉES (identifiants, états, compteurs) :
//     il part tel quel dans la sauvegarde, et partira tel quel sur le réseau.
//     Les fermetures des missions restent dans la table, jamais dans l'état.

// ── TABLES ────────────────────────────────────────────────
// Remplies par js/16-missions.js. Une mission n'appartient à une campagne
// que si CAMPAGNES la liste : une mission orpheline (la mission d'essai du
// moteur) existe, se lance, mais n'apparaît dans aucune carte de campagne.
const CAMPAGNES = {};
const MISSIONS = {};
// Mission à lancer au prochain startGame() — posée par l'écran de campagne,
// ou à la main depuis la console : `lancerMission('essai')`. Lue par
// initState, comme selectedMode.
let missionChoisie=null;

function missionCourante(){
  return (typeof G!=='undefined'&&G&&G.mission&&MISSIONS[G.mission])||null;
}
// Choisir sans lancer : c'est aussi le chemin du client d'une partie en
// ligne, qui ne passe jamais par startGame (initState + genMap seulement).
function choisirMission(cle){
  if(!MISSIONS[cle]) return false;
  missionChoisie=cle;
  return true;
}
function lancerMission(cle){
  if(!choisirMission(cle)) return false;
  startGame();
  return true;
}
window.lancerMission=lancerMission;

// ── POSITIONS ET ZONES ────────────────────────────────────
// Une mission décrit ses lieux en FRACTIONS de la carte (x, y et rayon r, ce
// dernier en fraction du côté) : la même mission tient alors sur toutes les
// tailles, exactement comme SC() rend genMap indépendant de COLS. Une zone
// est soit nommée (`zones:{gue:{x,y,r}}` dans la mission), soit donnée sur
// place ([x,y] ou {x,y,r}).
function zoneMission(z){
  if(typeof z==='string'){
    const def=missionCourante();
    z=def&&def.zones?def.zones[z]:null;
  }
  if(!z) return null;
  if(Array.isArray(z)) z={x:z[0],y:z[1],r:0};
  const tx=Math.max(0,Math.min(COLS-1,Math.round(z.x*(COLS-1))));
  const ty=Math.max(0,Math.min(ROWS-1,Math.round(z.y*(ROWS-1))));
  const r=Math.max(0,Math.round((z.r||0)*COLS));
  return {tx,ty,r,x:(tx+0.5)*BASE_TILE,y:(ty+0.5)*BASE_TILE};
}
// Parcourt les cases d'une zone (disque), bornées à la carte.
function casesDeZone(zn,fn){
  const r=zn.r;
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    if(dx*dx+dy*dy>r*r) continue;
    const x=zn.tx+dx, y=zn.ty+dy;
    if(x<0||y<0||x>=COLS||y>=ROWS) continue;
    fn(x,y);
  }
}
function dansZoneMonde(zn,wx,wy){
  const rw=(zn.r+0.5)*BASE_TILE;
  return Math.hypot(wx-zn.x,wy-zn.y)<=rw;
}

// Clés de faction employées par les missions : les mêmes que FAC, plus
// `pill` pour les pillards. En solo, le second commandant fusionné avec le
// joueur (roles.p2.solo:'fusion', le défaut) répond au nom de `p2` mais c'est
// P1 qui agit : ce qu'une mission adresse à « p2 » arrive donc au joueur.
const SCN_FAC = { p1:FAC.P1, p2:FAC.P2, ia:FAC.IA, ia2:FAC.IA2, pill:FAC.PILL, pillards:FAC.PILL };
function modeSecondCommandant(){
  const def=missionCourante();
  const r=def&&def.roles&&def.roles.p2;
  if(!r) return null;
  if(G.factions[FAC.P2]&&G.factions[FAC.P2].genre==='humain') return 'coop';
  return r.solo||'fusion';
}
function facMission(k){
  const id=SCN_FAC[k]||k;
  if(id===FAC.P2&&!G.factions[FAC.P2]&&modeSecondCommandant()==='fusion') return FAC.P1;
  return id;
}

// ── SURCOUCHE DE CARTE ────────────────────────────────────
// Appelée DEPUIS genMap(), en deux temps :
//   'terrain' — juste après les lacs, AVANT le choix des départs et le semis
//               des ressources : une rivière creusée ensuite pourrait noyer
//               une base, ou un gisement déjà semé.
//   'decor'   — tout à la fin : dégager, semer, poser reliques et faune.
// Tirages par RND (le générateur semé de la carte), jamais Math.random : la
// surcouche doit donner la même carte chez l'hôte et chez le client.
const SURCOUCHE_TERRAIN = new Set(['eau','lac','terre','gue']);
function appliquerSurcouche(phase){
  const def=missionCourante();
  if(!def) return;
  for(const op of (def.surcouche||[])){
    if((phase==='terrain')!==SURCOUCHE_TERRAIN.has(op.op)) continue;
    const f=SURCOUCHE_OPS[op.op];
    if(f) f(op);
  }
}
function mettreEau(x,y){
  if(G.bmap[y][x]===9) return;              // réservation d'un départ : jamais noyée
  G.tiles[y][x]=T_WATER; G.bmap[y][x]=3;
}
function mettreTerre(x,y){
  if(G.tiles[y][x]!==T_WATER) return;
  G.tiles[y][x]=T_GRASS; G.bmap[y][x]=0;
}
// Retire d'une zone tout ce que genMap y a semé : gisements (poissons
// compris), reliques, faune. Réassigne G.nodes plutôt que de le muter en
// place : rebuildIndex ne reconstruit l'index que si la référence change.
function viderZone(zn){
  const dedans=(tx,ty)=>(tx-zn.tx)*(tx-zn.tx)+(ty-zn.ty)*(ty-zn.ty)<=zn.r*zn.r;
  G.nodes=G.nodes.filter(n=>{
    if(!dedans(n.tx,n.ty)) return true;
    if(G.bmap[n.ty][n.tx]===2) G.bmap[n.ty][n.tx]=0;
    return false;
  });
  G.relics=(G.relics||[]).filter(r=>!dedans(r.tx,r.ty));
  G.wildlife=(G.wildlife||[]).filter(w=>!dedans(w.tx,w.ty));
}
// Sème `n` gisements dans une zone. Même forme de nœud que place(), même
// richesse (NODE_RICHNESS) ; le nombre suit la taille de carte comme place()
// (linéaire, facteur 1 à 240), mais PAS le preset : une mission dit
// exactement ce qu'elle veut trouver à tel endroit.
function semerGisements(zn,type,n,amt,infini){
  n=Math.max(1,Math.round(n*(COLS/240)));
  const r=Math.max(1,zn.r);
  let poses=0, essais=0;
  while(poses<n&&essais<n*12){
    essais++;
    const a=RND()*Math.PI*2, d=RND()*r;
    const x=Math.round(zn.tx+Math.cos(a)*d), y=Math.round(zn.ty+Math.sin(a)*d);
    if(x<1||y<1||x>=COLS-1||y>=ROWS-1) continue;
    const surEau=G.tiles[y][x]===T_WATER;
    if(type===RT.FISH?!surEau:G.bmap[y][x]!==0) continue;
    if(type===RT.FISH&&G.nodes.some(o=>o.tx===x&&o.ty===y)) continue;
    if(type!==RT.FISH) G.bmap[y][x]=2;
    const a2=type===RT.FISH?FISH_STOCK:Math.round(amt*NODE_RICHNESS);
    const nd={id:G.nid++,type,tx:x,ty:y,x:x*BASE_TILE+BASE_TILE/2,y:y*BASE_TILE+BASE_TILE/2,amt:a2,max:a2,gatherers:[]};
    if(infini) nd.infinite=true;
    G.nodes.push(nd);
    poses++;
  }
}
// Première case libre (bmap 0) en carrés concentriques autour d'une zone —
// même parcours que departLibre, donc déterministe.
function caseLibreZone(zn,w,h){
  w=w||1; h=h||1;
  for(let r=0;r<=40;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const x=zn.tx+dx, y=zn.ty+dy;
      if(x<1||y<1||x+w>=COLS-1||y+h>=ROWS-1) continue;
      let libre=true;
      for(let a=0;a<h&&libre;a++) for(let b=0;b<w&&libre;b++) if(G.bmap[y+a][x+b]!==0) libre=false;
      if(libre) return {tx:x,ty:y};
    }
  }
  return null;
}
const SURCOUCHE_OPS = {
  // Rivière : une polyligne (points en fractions) creusée sur `largeur`
  // (fraction du côté). Des segments droits : pour une courbe, on donne plus
  // de points. Pas de pêche sur une rivière sinueuse — la Barque se déplace
  // en ligne droite (advanceNaval) et suppose des plans d'eau convexes.
  eau(op){
    const pts=(op.trace||[]).map(p=>zoneMission(p)).filter(Boolean);
    const larg=Math.max(1,Math.round((op.largeur||0.015)*COLS));
    for(let i=0;i+1<pts.length;i++){
      const a=pts[i], b=pts[i+1];
      const long=Math.max(1,Math.ceil(Math.hypot(b.tx-a.tx,b.ty-a.ty)*2));
      for(let k=0;k<=long;k++){
        const cx=Math.round(a.tx+(b.tx-a.tx)*k/long), cy=Math.round(a.ty+(b.ty-a.ty)*k/long);
        casesDeZone({tx:cx,ty:cy,r:larg},mettreEau);
      }
    }
  },
  lac(op){ const zn=zoneMission(op.zone); if(zn) casesDeZone(zn,mettreEau); },
  // Terre ferme : assèche une zone (un gué dans une rivière, un passage dans
  // un lac de genMap qui gênerait la mission).
  terre(op){ const zn=zoneMission(op.zone); if(zn) casesDeZone(zn,mettreTerre); },
  gue(op){ SURCOUCHE_OPS.terre(op); },
  degager(op){ const zn=zoneMission(op.zone); if(zn) viderZone(zn); },
  foret(op){ const zn=zoneMission(op.zone); if(zn) semerGisements(zn,RT.TREE,op.n||20,op.amt||320,false); },
  baies(op){ const zn=zoneMission(op.zone); if(zn) semerGisements(zn,RT.BERRY,op.n||6,op.amt||300,false); },
  poissons(op){ const zn=zoneMission(op.zone); if(zn) semerGisements(zn,RT.FISH,op.n||4,0,false); },
  gisement(op){ const zn=zoneMission(op.zone); if(zn) semerGisements(zn,op.type||RT.GOLD,op.n||6,op.amt||500,!!op.infini); },
  relique(op){
    const zn=zoneMission(op.zone); if(!zn) return;
    const c=caseLibreZone(zn); if(!c) return;
    G.relics.push({id:G.nid++, tx:c.tx, ty:c.ty, x:c.tx*BASE_TILE+BASE_TILE/2, y:c.ty*BASE_TILE+BASE_TILE/2, carrier:null, bankedBy:null});
  },
  faune(op){
    const zn=zoneMission(op.zone); if(!zn) return;
    const type=WILDLIFE_DEF[op.type]?op.type:'deer', def=WILDLIFE_DEF[type];
    const r=Math.max(1,zn.r);
    let poses=0, essais=0;
    while(poses<(op.n||3)&&essais<60){
      essais++;
      const x=zn.tx+Math.round((RND()*2-1)*r), y=zn.ty+Math.round((RND()*2-1)*r);
      if(x<1||y<1||x>=COLS-1||y>=ROWS-1||G.bmap[y][x]!==0) continue;
      G.wildlife.push({id:G.nid++, type, tx:x, ty:y, x:x*BASE_TILE+BASE_TILE/2, y:y*BASE_TILE+BASE_TILE/2, hp:def.hp, maxHp:def.hp});
      poses++;
    }
  },
};

// ── DÉPARTS D'UNE MISSION ─────────────────────────────────
// Imposés par la mission au lieu de l'anneau de departsHumains : glissés vers
// la case libre la plus proche (departLibre) si un lac les recouvre. Les
// humains (P1 puis le second commandant) dans G.departs, que startGame lit
// déjà ; les seigneurs IA dans G.departsIA, qui remplace pour eux les huit
// ancrages génériques d'aiAnchors().
function departsMission(){
  const def=missionCourante(), d=BDEF[BT.TC], out=[];
  for(const k of ['p1','p2']){
    const r=def.roles&&def.roles[k];
    if(!r) continue;
    const zn=zoneMission(r.depart||[0.5,0.5]);
    out.push(departLibre(zn.tx,zn.ty,d.w,d.h));
  }
  return out;
}
function departsIAMission(){
  const def=missionCourante(), d=BDEF[BT.TC], out=[];
  for(const k of ['ia','ia2']){
    const fd=def.factions&&def.factions[k];
    if(!fd) continue;
    const zn=zoneMission(fd.depart||[0.8,0.5]);
    out.push(departLibre(zn.tx,zn.ty,d.w,d.h));
  }
  return out;
}

// ── POSE DES CAMPS (hôte seulement) ───────────────────────
// Gabarits de base : ce que chaque rôle trouve en arrivant. `tc` est le
// départ habituel ; `rien` sert aux missions sans base (escorte, marche) —
// le camp est alors dispensé d'élimination (voir sansElimination).
const GABARITS_BASE = {
  rien:    [],
  tc:      [BT.TC],
  village: [BT.TC, BT.HOUSE, BT.HOUSE, BT.HOUSE, BT.LUMBER, BT.MILL],
};
// Générateur propre à la pose : installerMission ne tourne que chez l'hôte,
// le déterminisme n'y est pas exigé par le réseau — mais une mission qui se
// pose chaque fois pareil se teste, et se rejoue, bien mieux.
let _rndPose=Math.random;

function posePopulation(owner,delta){
  const f=G.factions[owner];
  if(f&&f.genre!=='neutre') f.pop+=delta;
}
// Pose un bâtiment TERMINÉ au plus près d'une case (en tuiles). `ecart` :
// distance minimale au point quand la case elle-même est prise — les
// bâtiments d'un gabarit de base s'écartent ainsi du Centre Ville au lieu de
// le murer (un Centre Ville cerné n'a plus de passage pour ses villageois).
function poserBatimentScn(type,tx,ty,owner,tag,ecart){
  const d=BDEF[type];
  const spot=G.bmap[ty]&&libreRect(tx,ty,d.w,d.h)?{tx,ty}:aiSpot(d.w,d.h,tx,ty,ecart||1,16,_rndPose);
  if(!spot) return null;
  const b=mkBuilding(type,spot.tx,spot.ty,owner);
  b.constructing=false; b.progress=1;
  if(tag){ b.tag=tag; compterTag(tag); }
  placeBuilding(b);
  return b;
}
function libreRect(tx,ty,w,h){
  if(tx<1||ty<1||tx+w>=COLS-1||ty+h>=ROWS-1) return false;
  for(let dy=0;dy<h;dy++) for(let dx=0;dx<w;dx++) if(G.bmap[ty+dy][tx+dx]!==0) return false;
  return true;
}
// Case praticable la plus proche (les gisements et les champs se traversent,
// seul bmap 3 bloque — voir tileBlocked).
function casePraticable(tx,ty){
  for(let r=0;r<=20;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const x=tx+dx, y=ty+dy;
      if(x<1||y<1||x>=COLS-1||y>=ROWS-1) continue;
      if(G.bmap[y][x]!==3) return {tx:x,ty:y};
    }
  }
  return {tx,ty};
}
function compterTag(tag){ G.scn.tags[tag]=(G.scn.tags[tag]||0)+1; }

// Pose une unité de scénario : dans G.units, population comptée, héros
// réservé, difficulté appliquée aux camps adverses. Renvoie l'unité.
function poserUniteScn(type,wx,wy,owner,o){
  o=o||{};
  const u=mkUnit(type,wx,wy,owner);
  const f=G.factions[owner];
  if(o.tag){ u.tag=o.tag; compterTag(o.tag); }
  if(f&&f.genre==='ia') aiAdoptUnit(u,f);
  else if(f&&f.genre==='neutre'){
    // Même mise à l'échelle que les vagues de Survie (spawnWave) : c'est la
    // difficulté choisie qui rend un camp de pillards plus ou moins coriace.
    const diff=DIFFS[G.difficulty]||DIFFS.normal;
    u.hp=u.maxHp=Math.round(u.maxHp*diff.enemyHp*(o.pv||1));
    u.atk=Math.round(u.atk*diff.enemyAtk);
  }
  if(type===UT.HERO&&f) f.heroTrained=true;   // le Château n'en formera pas un second
  G.units.push(u);
  posePopulation(owner,1);
  return u;
}
// Normalise une entrée d'unités : [type, n, tag] ou {type, n, tag, zone, garde}.
function groupeUnites(e){
  if(Array.isArray(e)) return {type:e[0], n:e[1]||1, tag:e[2]||null};
  return Object.assign({n:1},e);
}
// Pose un groupe autour d'un point (en tuiles), en petite grille — même pas
// que formation(). `garde` : l'unité tient son poste (u.camp), comme les
// garnisons des points d'intérêt, au lieu de partir chasser.
function poserGroupe(g,owner,cx,cy){
  const out=[];
  const pas=0.9, cols=Math.max(1,Math.ceil(Math.sqrt(g.n)));
  for(let i=0;i<g.n;i++){
    const c=casePraticable(Math.round(cx+(i%cols-(cols-1)/2)*pas),Math.round(cy+Math.floor(i/cols)*pas));
    const u=poserUniteScn(g.type,(c.tx+0.5)*BASE_TILE,(c.ty+0.5)*BASE_TILE,owner,{tag:g.tag,pv:g.pv});
    if(g.garde){ u.camp=owner; u.campX=u.x; u.campY=u.y; }
    out.push(u);
  }
  return out;
}
// Tout ce qu'un rôle ou une faction apporte en plus de sa base : bâtiments
// et unités, chacun à sa zone ou autour du point de départ.
function poserApports(owner,spec,tx,ty){
  for(const e of (spec.batiments||[])){
    const o=Array.isArray(e)?{type:e[0],dx:e[1]||0,dy:e[2]||0,tag:e[3]||null}:e;
    const zn=o.zone?zoneMission(o.zone):null;
    const bx=zn?zn.tx:tx+(o.dx||0), by=zn?zn.ty:ty+(o.dy||0);
    poserBatimentScn(o.type,bx,by,owner,o.tag);
  }
  for(const e of (spec.unites||[])){
    const g=groupeUnites(e);
    const zn=g.zone?zoneMission(g.zone):null;
    if(zn) poserGroupe(g,owner,zn.tx,zn.ty);
    else poserGroupe(g,owner,tx+1,ty+3);
  }
}
// Un rôle humain à son départ. `fusion` : c'est le rôle du second
// commandant, posé au nom de P1 en solo — il n'impose alors ni sa
// civilisation, ni son âge, ni sa caisse, qui restent ceux du joueur.
function poserRole(owner,role,dep,fusion){
  const f=G.factions[owner];
  if(!fusion){
    if(role.civ&&CIVS[role.civ]) f.civ=role.civ;
    if(role.age!=null) f.age=role.age;       // AVANT toute entité : mkUnit/mkBuilding lisent l'âge
    if(role.res) f.res={food:0,wood:0,stone:0,gold:0,...role.res};
    for(const k of (role.recherches||[])) if(k in f.research) f.research[k]=true;
  }
  const [tx,ty]=dep;
  for(const type of (GABARITS_BASE[role.base||'tc']||GABARITS_BASE.tc)){
    if(type===BT.TC){
      const tc=mkBuilding(BT.TC,tx,ty,owner);
      placeBuilding(tc);
    } else poserBatimentScn(type,tx+1,ty+1,owner,null,4);
  }
  poserApports(owner,role,tx,ty);
}

// Pose TOUS les camps d'une mission. Remplace, dans startGame(), le bloc
// « Centre Ville + 3 villageois + initAI × rivaux ».
function installerMission(){
  const def=missionCourante();
  _rndPose=srnd(((G.seed^0x3c6ef372)>>>0)||1);
  initScenario();
  // Les réservations de départ (bmap 9, posées par genMap) ont rempli leur
  // office : les ressources ont été semées autour. Elles sautent toutes ici,
  // AVANT de poser quoi que ce soit — aiSpot n'accepte que des cases à 0.
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(G.bmap[y][x]===9) G.bmap[y][x]=0;

  const dep=G.departs||[];
  poserRole(FAC.P1,def.roles.p1,dep[0],false);
  const mode2=modeSecondCommandant();
  if(def.roles.p2&&dep[1]){
    if(mode2==='coop') poserRole(FAC.P2,def.roles.p2,dep[1],false);
    else if(mode2==='fusion') poserRole(FAC.P1,def.roles.p2,dep[1],true);
    else if(mode2==='ia'){
      // Faction humaine alliée le temps de la pose (mkUnit/mkBuilding lisent
      // son âge et ses recherches), puis confiée à l'IA : la bascule de
      // déconnexion (convertirEnIA) sait déjà tout faire.
      G.factions[FAC.P2]=mkFaction(FAC.P2,{genre:'humain',equipe:G.factions[FAC.P1].equipe,
        nom:def.roles.p2.nom||'Allié',civ:def.roles.p2.civ,maxPop:5,
        res:(DIFFS[G.difficulty]||DIFFS.normal).startRes});
      poserRole(FAC.P2,def.roles.p2,dep[1],false);
      convertirEnIA(FAC.P2,{silencieux:true});
    }
  }

  // Seigneurs IA : emplacement, civilisation et équipe imposés.
  const idsIA={ia:FAC.IA, ia2:FAC.IA2};
  const depIA=G.departsIA||[];
  let i=0;
  for(const k of ['ia','ia2']){
    const fd=def.factions&&def.factions[k];
    if(!fd) continue;
    const p=depIA[i++]; if(!p) continue;
    const a=initAI(dep[0][0],dep[0][1],idsIA[k],fd.nom||'Seigneur rival',[],
      {pos:p, civ:fd.civ, equipe:fd.equipe, age:fd.age, tune:fd.tune});
    if(a) poserApports(a.id,fd,p[0],p[1]);
  }
  // Pillards : camps, garnisons, tentes — tout ce que la mission leur donne.
  if(def.factions&&def.factions.pill){
    const zn=zoneMission([0.5,0.5]);
    poserApports(FAC.PILL,def.factions.pill,zn.tx,zn.ty);
  }

  // Un camp humain qui démarre sans Centre Ville (escorte, marche, camp à
  // fonder) serait déclaré vaincu à la première image (voir l'élimination
  // dans update()). Il en est dispensé : c'est la mission qui dit quand il
  // a perdu — et M.eliminable() le rend éliminable s'il fonde sa ville.
  for(const f of factionsHumaines().concat(factionsIA())){
    if(!G.buildings.some(b=>b.owner===f.id&&b.type===BT.TC)) f.sansElimination=true;
  }
  updatePopCap();
  rebuildIndex();
}

// ── ÉTAT DE SCÉNARIO ──────────────────────────────────────
// obj   : id → 'cache' | 'actif' | 'fait' | 'echec'
// decl  : id → nombre de tirs ; declT : id → instant du dernier tir
// tags  : étiquette → nombre d'entités posées sous ce nom (mort ≠ jamais posé)
// dlg   : journal des répliques [{k, d, t}] (clé de dialogue, destinataire)
// rev   : zones révélées [{tx,ty,r,f,jusqua}] — lues par revealFog
// fin   : {issue:'victoire'|'defaite', cause} une fois tranchée
// seq   : incrémenté à chaque changement visible (servira au différentiel réseau)
function initScenario(){
  const def=missionCourante();
  G.scn={obj:{}, decl:{}, declT:{}, tags:{}, dlg:[], rev:[], marques:[], fin:null, etoiles:0, seq:0, acc:0};
  for(const o of (def.objectifs||[])) G.scn.obj[o.id]=o.cache?'cache':'actif';
}

// Exécute une fermeture de mission sans jamais laisser une erreur de
// scénariste casser la boucle de jeu : une mission mal écrite perd son
// déclencheur, pas la partie. Une seule trace par fermeture fautive.
const _scnErreurs=new Set();
function scnAppel(fn,etiquette){
  try{ return fn(SCN_API); }
  catch(e){
    if(!_scnErreurs.has(etiquette)){ _scnErreurs.add(etiquette); console.warn('Mission — '+etiquette+' :',e); }
    return false;
  }
}

const SCN_CADENCE = 0.5;   // même cadence que les décisions de l'IA (AI_THINK)
function majScenario(dt){
  const def=missionCourante();
  if(!def||!G.scn||G.scn.fin) return;
  G.scn.acc=(G.scn.acc||0)+dt;
  if(G.scn.acc<SCN_CADENCE) return;
  G.scn.acc=0;
  // 1. Déclencheurs. `repete` : peut retirer, au plus toutes les
  //    `intervalle` secondes, tant que sa condition tient.
  for(const d of (def.declencheurs||[])){
    const n=G.scn.decl[d.id]||0;
    if(n&&!d.repete) continue;
    if(n&&d.repete&&G.gameTime-(G.scn.declT[d.id]||0)<(d.intervalle||30)) continue;
    if(!scnAppel(d.si,'si:'+d.id)) continue;
    G.scn.decl[d.id]=n+1; G.scn.declT[d.id]=G.gameTime; G.scn.seq++;
    scnAppel(d.alors,'alors:'+d.id);
    if(G.scn.fin) return;                     // un déclencheur a tranché la mission
  }
  // 2. Objectifs actifs.
  for(const o of (def.objectifs||[])){
    if(G.scn.obj[o.id]!=='actif') continue;
    if(o.echec&&scnAppel(o.echec,'echec:'+o.id)) majObjectif(o.id,'echec');
    else if(o.test&&scnAppel(o.test,'test:'+o.id)) majObjectif(o.id,'fait');
  }
  // 3. Issue : un principal échoué perd la mission, tous faits la gagnent.
  //    Un principal encore caché bloque la victoire tant qu'il n'est pas
  //    révélé ET rempli.
  //    Un objectif SANS `test` (« le héros doit survivre ») est une condition
  //    à MAINTENIR : il ne se remplit jamais de lui-même, il tient tant qu'il
  //    n'a pas échoué — sans quoi il bloquerait toute victoire.
  const principaux=(def.objectifs||[]).filter(o=>o.type!=='secondaire');
  const rate=principaux.find(o=>G.scn.obj[o.id]==='echec');
  const tenu=o=>G.scn.obj[o.id]==='fait'||(!o.test&&G.scn.obj[o.id]==='actif');
  if(rate) finMission('defaite','obj:'+rate.id);
  else if(principaux.some(o=>o.test)&&principaux.every(tenu)){
    for(const o of principaux) if(!o.test) G.scn.obj[o.id]='fait';
    finMission('victoire');
  }
}

function objectifDef(id){ const def=missionCourante(); return def&&(def.objectifs||[]).find(o=>o.id===id); }
function majObjectif(id,etat){
  const o=objectifDef(id);
  if(!o||!G.scn||G.scn.obj[id]===etat) return;
  const avant=G.scn.obj[id];
  if(avant==='fait'||avant==='echec') return;   // une issue ne se reprend pas
  G.scn.obj[id]=etat; G.scn.seq++;
  const ico=etat==='fait'?'✅':etat==='echec'?'❌':'📜';
  const verbe=etat==='fait'?'Objectif accompli':etat==='echec'?'Objectif manqué':'Nouvel objectif';
  retourTous('message',{txt:`${ico} ${verbe} : ${o.txt}`,col:etat==='echec'?'#e74c3c':'#f0c040'});
}

function finMission(issue,cause){
  if(!G.scn||G.scn.fin) return;
  G.scn.fin={issue,cause:cause||null}; G.scn.seq++;
  if(issue==='victoire'){
    G.scn.etoiles=compterEtoiles();
    if(!G.victory&&!G.gameOver){ G.victory=true; showVictory(); }
  } else if(!G.victory&&!G.gameOver){ G.gameOver=true; showGameOver(); }
}
// Étoiles : une par entrée de `etoiles`, dont 'victoire' (toujours acquise
// quand on compte). Évaluées une seule fois, à l'instant de la victoire.
function compterEtoiles(){
  const def=missionCourante();
  let n=0;
  for(const e of (def.etoiles||['victoire'])){
    if(e==='victoire'||(typeof e==='function'&&scnAppel(e,'etoile'))) n++;
  }
  return n;
}
// Textes de fin, pour les écrans de victoire et de défaite.
function texteFinMission(){
  const def=missionCourante(), fin=G.scn&&G.scn.fin;
  if(!def||!fin) return null;
  if(fin.issue==='victoire') return def.victoire||'Mission accomplie.';
  if(fin.cause&&fin.cause.startsWith('obj:')){
    const o=objectifDef(fin.cause.slice(4));
    if(o) return o.echecTxt||`Objectif manqué : ${o.txt}`;
  }
  return (def.causes&&def.causes[fin.cause])||def.defaite||'La mission a échoué.';
}

// ── RÉPLIQUES ─────────────────────────────────────────────
// Le journal (G.scn.dlg) est la source ; l'affichage n'en est qu'une lecture.
// Pour l'instant une réplique s'affiche en toast chez l'hôte — le bandeau de
// dialogue, et sa lecture par l'invité depuis le journal répliqué, viennent
// avec l'interface de campagne.
function destinataireLocal(dest){
  if(!dest||dest==='tous') return true;
  return facMission(dest)===G.me;
}
function afficherReplique(k,dest){
  if(!destinataireLocal(dest)) return;
  const def=missionCourante();
  const lignes=(def.dialogues&&def.dialogues[k])||[];
  for(const [qui,txt] of lignes){
    const o=(def.orateurs&&def.orateurs[qui])||{nom:qui,ico:'💬'};
    notify(`${o.ico} ${o.nom} : ${txt}`,'#e8d5a0',true);
  }
}

// ── LE VOCABULAIRE DES SCÉNARISTES ────────────────────────
// Passé à chaque fermeture de mission sous le nom `M`. Les missions ne
// touchent jamais G directement : tout ce qu'elles lisent ou font passe par
// ici, ce qui permet de faire évoluer le moteur sans les réécrire, et de les
// rejouer telles quelles dans les tests.
function entitesTag(tag){
  const out=[];
  for(const u of G.units) if(u.tag===tag&&u.hp>0) out.push(u);
  for(const b of G.buildings) if(b.tag===tag&&b.hp>0) out.push(b);
  return out;
}
const SCN_API = {
  // ── lecture ──
  temps(){ return G.gameTime; },
  fait(id){ return !!G.scn&&G.scn.obj[id]==='fait'; },
  echoue(id){ return !!G.scn&&G.scn.obj[id]==='echec'; },
  etat(id){ return G.scn?G.scn.obj[id]:undefined; },
  tire(id){ return !!G.scn&&(G.scn.decl[id]||0)>0; },
  vivant(tag){ return entitesTag(tag).length>0; },
  // « Mort » suppose d'avoir existé : un tag jamais posé n'est pas mort.
  mort(tag){ return !!G.scn&&(G.scn.tags[tag]||0)>0&&entitesTag(tag).length===0; },
  detruit(tag){ return SCN_API.mort(tag); },
  restants(tag){ return entitesTag(tag).length; },
  compte(k,type){
    const id=facMission(k);
    if(UDEF[type]) return G.units.filter(u=>u.owner===id&&u.type===type&&u.hp>0).length;
    return G.buildings.filter(b=>b.owner===id&&b.type===type&&!b.constructing&&b.hp>0).length;
  },
  dansZone(zone,k,n){
    const zn=zoneMission(zone); if(!zn) return false;
    const id=k?facMission(k):null;
    let c=0;
    for(const u of G.units){
      if(u.hp<=0||(id&&u.owner!==id)) continue;
      if(dansZoneMonde(zn,u.x,u.y)&&++c>=(n||1)) return true;
    }
    return false;
  },
  age(k){ const f=G.factions[facMission(k)]; return f?f.age:0; },
  res(k,r){ const f=G.factions[facMission(k)]; return f&&f.res?(f.res[r]||0):0; },
  stats(k,cle){ const f=G.factions[facMission(k)]; return f&&f.stats?(f.stats[cle]||0):0; },
  reliques(k){ const id=facMission(k); return (G.relics||[]).filter(r=>r.bankedBy===id).length; },
  vaincu(k){ const f=G.factions[facMission(k)]; return !f||!!f.vaincu; },
  coop(){ return modeSecondCommandant()==='coop'; },
  difficulte(){ return G.difficulty; },

  // ── action ──
  dire(k,dest){
    if(!G.scn) return;
    G.scn.dlg.push({k,d:dest||'tous',t:G.gameTime}); G.scn.seq++;
    afficherReplique(k,dest||'tous');
  },
  objectif(id,etat){ majObjectif(id,etat==='ajout'?'actif':etat); },
  // Renfort ou vague : même geste, poser des unités à une zone. Pour un camp
  // adverse, l'effectif suit la difficulté (enemyCount, comme spawnWave) et
  // la coopération (regles.coopMult) ; un renfort allié est toujours tel
  // qu'écrit. `vers` : les unités humaines y marchent en ordre offensif ;
  // les adverses y tiennent la garde si `garde`, sinon partent chasser.
  renfort(k,compo,zone,o){
    o=o||{};
    const id=facMission(k), zn=zoneMission(zone);
    if(!zn) return [];
    const f=G.factions[id];
    const adverse=f&&estHostile(FAC.P1,{owner:id});
    const diff=DIFFS[G.difficulty]||DIFFS.normal;
    const def=missionCourante();
    const mult=adverse?diff.enemyCount*(SCN_API.coop()?((def.regles&&def.regles.coopMult)||1.3):1):1;
    const vers=o.vers?zoneMission(o.vers):null;
    const poses=[];
    for(const e of compo){
      const g=groupeUnites(e);
      g.n=Math.max(1,Math.round(g.n*mult));
      if(o.tag) g.tag=o.tag;
      if(o.garde) g.garde=true;
      poses.push(...poserGroupe(g,id,zn.tx,zn.ty));
    }
    if(vers){
      if(f&&f.genre==='humain'){
        const fmt=formation(vers.x,vers.y,poses.length);
        poses.forEach((u,i)=>{
          if(!isMilitary(u.type)) return;
          u.amove={x:fmt[i].x,y:fmt[i].y}; u.destX=fmt[i].x; u.destY=fmt[i].y;
          u.anchorX=fmt[i].x; u.anchorY=fmt[i].y; u.state='amove'; u.target=null;
        });
      } else for(const u of poses){ u.camp=id; u.campX=vers.x; u.campY=vers.y; }
    }
    rebuildIndex();
    return poses;
  },
  vague(k,compo,zone,o){
    const poses=SCN_API.renfort(k,compo,zone,o);
    if(poses.length) retourTous('alerte',{x:poses[0].x,y:poses[0].y});
    return poses;
  },
  // Lâche une garde : ses unités cessent de tenir leur poste et partent
  // chasser (la logique de ciblage adverse, updateEnemyAI, prend le relais).
  lacher(tag){ for(const u of entitesTag(tag)) if(u.camp!=null){ u.camp=null; u.target=null; u.state='idle'; } },
  poser(k,type,zone,tag){
    const zn=zoneMission(zone); if(!zn) return null;
    const b=poserBatimentScn(type,zn.tx,zn.ty,facMission(k),tag);
    if(b){ updatePopCap(); rebuildIndex(); }
    return b;
  },
  convertir(tag,k){
    const id=facMission(k);
    for(const e of entitesTag(tag)){
      if(e.w){ e.owner=id; }                  // un bâtiment n'a pas d'état à réinitialiser
      else convertirUnite(e,id);
    }
    updatePopCap();
  },
  equipe(k,n){ const f=G.factions[facMission(k)]; if(f){ f.equipe=n; G.scn.seq++; } },
  eliminable(k,oui){ const f=G.factions[facMission(k)]; if(f) f.sansElimination=!oui; },
  donner(k,res){
    const f=G.factions[facMission(k)]; if(!f) return;
    for(const [r,v] of Object.entries(res||{})) f.res[r]=Math.max(0,(f.res[r]||0)+v);
  },
  // Révèle une zone aux camps humains (tous, ou l'équipe de `k`) pendant
  // `duree` secondes (sans fin si omise). Passe par G.scn, pas par le
  // brouillard directement : revealFog recalcule le calque cinq fois par
  // seconde, et le client calcule le sien.
  reveler(zone,duree,k){
    const zn=zoneMission(zone); if(!zn) return;
    G.scn.rev.push({tx:zn.tx,ty:zn.ty,r:Math.max(2,zn.r),f:k?facMission(k):null,
                    jusqua:duree?G.gameTime+duree:null});
    G.scn.seq++;
  },
  marquer(zone){ const zn=zoneMission(zone); if(zn){ G.scn.marques.push({tx:zn.tx,ty:zn.ty}); G.scn.seq++; } },
  victoire(){ finMission('victoire'); },
  defaite(cause){ finMission('defaite',cause||null); },
};

// Zones révélées par le scénario : appelée par revealFog pour chaque camp
// humain, avec sa fonction d'éclairage. Les révélations échues sont purgées.
function revelationsScenario(f,equipe,reveal){
  if(!G.scn||!G.scn.rev||!G.scn.rev.length) return;
  G.scn.rev=G.scn.rev.filter(z=>z.jusqua==null||z.jusqua>G.gameTime);
  for(const z of G.scn.rev) if(z.f==null||equipe.has(z.f)) reveal(z.tx,z.ty,z.r);
}
