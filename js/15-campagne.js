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
// Mission d'un salon multijoueur ouvert depuis son briefing (voir
// jouerMissionAvecAmi et mpOuvrir). Distincte de missionChoisie : elle ne
// devient la mission de la partie qu'au LANCEMENT (demarrerPartieHote).
let missionSalon=null;

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
// Un nom de zone que la mission ne déclare pas ne lève rien — la vague part
// dans le vide, sans bruit. On le RETIENT donc ici (une trace par nom), et le
// groupe de tests `campagne` exige que ce registre reste vide après avoir
// exercé toutes les fermetures de toutes les missions. `peutEtreTag` : le
// nom peut aussi désigner une étiquette (`vers`, `cible`), ce n'est alors pas
// une faute de ne pas le trouver parmi les zones.
const _zonesInconnues=new Set();
function zoneMission(z,peutEtreTag){
  if(typeof z==='string'){
    const def=missionCourante(), nom=z;
    z=def&&def.zones?def.zones[z]:null;
    if(!z&&def&&!peutEtreTag&&!_zonesInconnues.has(nom)){
      _zonesInconnues.add(nom);
      console.warn(`Mission — zone inconnue : « ${nom} »`);
    }
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
// Une troupe d'un SEIGNEUR que la mission commande elle-même : ni son cerveau
// d'IA ne la réquisitionne (voir js/08-ia.js), ni elle ne compte dans sa
// population. Comptée, une garnison de camp de vingt-quatre hommes laissait
// Vitigès à 28/5 de population toute la partie : il ne formait plus un seul
// villageois, plus un seul soldat (mesuré, Rome assiégée). Symétrique à la
// mort (voir updateUnits) et à la conversion (M.convertir).
function marquerHorsArmee(u){
  const f=G.factions[u.owner];
  if(u.horsArmee||!f||f.genre!=='ia') return;
  u.horsArmee=true;
  posePopulation(u.owner,-1);
}

// Pose une unité de scénario : dans G.units, population comptée, héros
// réservé, difficulté appliquée aux camps adverses. Renvoie l'unité.
function poserUniteScn(type,wx,wy,owner,o){
  o=o||{};
  const u=mkUnit(type,wx,wy,owner);
  const f=G.factions[owner];
  if(o.tag){ u.tag=o.tag; compterTag(o.tag); }
  if(f&&f.genre==='ia') aiAdoptUnit(u,f);
  else if(f&&f.genre==='neutre'&&!o.egal){
    // Même mise à l'échelle que les vagues de Survie (spawnWave) : c'est la
    // difficulté choisie qui rend un camp de pillards plus ou moins coriace.
    // `egal` : un combat « à armes égales » (un exercice de contres) garde
    // les chiffres de la table, quelle que soit la difficulté.
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
    const u=poserUniteScn(g.type,(c.tx+0.5)*BASE_TILE,(c.ty+0.5)*BASE_TILE,owner,{tag:g.tag,pv:g.pv,egal:g.egal});
    if(g.garde){
      u.camp=owner; u.campX=u.x; u.campY=u.y;
      // La garnison d'un camp de seigneur tient SON poste, pas celui que le
      // cerveau de l'IA lui donnerait (voir `horsArmee`, js/08-ia.js).
      marquerHorsArmee(u);
    }
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
  // `murs` : des lignes de palissade (abattis, barrage, rempart) d'un point à
  // un autre, en fractions de carte. Les cases d'eau ou déjà bâties sont
  // sautées. `portes:n` : n portails ouverts, régulièrement espacés le long
  // de la ligne (un rempart qu'on doit pouvoir franchir soi-même).
  for(const m of (spec.murs||[])){
    const a=zoneMission(m.de), z=zoneMission(m.a);
    if(!a||!z) continue;
    const pas=Math.max(Math.abs(z.tx-a.tx),Math.abs(z.ty-a.ty),1);
    const portes=new Set();
    for(let k=1;k<=(m.portes||0);k++) portes.add(Math.round(pas*k/((m.portes||0)+1)));
    for(let i=0;i<=pas;i++){
      const x=Math.round(a.tx+(z.tx-a.tx)*i/pas), y=Math.round(a.ty+(z.ty-a.ty)*i/pas);
      // Un arbre sur le tracé ferait brèche : épuisé plutôt que retiré, comme
      // le fait poserMursArene — un gisement à zéro VOYAGE (delta `n`), un
      // gisement retiré du tableau de l'hôte resterait debout chez l'invité.
      if(G.bmap[y]&&G.bmap[y][x]===2){
        for(const nd of G.nodes) if(nd.tx===x&&nd.ty===y&&nd.amt>0) nd.amt=0;
        G.bmap[y][x]=0;
      }
      if(!libreRect(x,y,1,1)) continue;
      const b=mkBuilding(portes.has(i)?BT.GATE:BT.WALL,x,y,owner);
      b.constructing=false; b.progress=1;
      if(portes.has(i)) b.open=true;
      if(m.tag){ b.tag=m.tag; compterTag(m.tag); }
      placeBuilding(b);
    }
  }
  // `enceintes` : l'anneau de palissade de l'Arène (poserMursArene), à un
  // rayon et en un lieu choisis — une ville à défendre ou à prendre.
  for(const e of (spec.enceintes||[])){
    const zn=zoneMission(e.zone); if(!zn) continue;
    const avant=G.buildings.length;
    poserMursArene(zn.tx,zn.ty,1,1,owner,Math.max(3,Math.round((e.r||0.04)*COLS)),!e.ferme);
    if(e.tag) for(const b of G.buildings.slice(avant)){ b.tag=e.tag; compterTag(e.tag); }
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
      // Un appui, pas un second rival qui jouerait la mission à sa place ; la
      // mission peut préciser (`roles.p2.ia`, mêmes champs que reglerIA).
      reglerIA(G.factions[FAC.P2],Object.assign({role:'allie'},def.roles.p2.ia||{}));
      // Ses soldats ont été posés quand le camp était encore humain : aucune
      // garde ne leur a été donnée (aiAdoptUnit ne passe que pour une IA), et
      // un soldat d'IA sans poste part raser le bâtiment hostile le plus
      // précieux de TOUTE la carte. Mesuré (Mélantias) : les Dèmes traversaient
      // la carte et rasaient le camp de Zabergan à la cinquième minute, et la
      // mission se gagnait toute seule. On les poste à leur base, comme toute
      // armée d'IA en attendant son premier assaut.
      const p2=G.factions[FAC.P2];
      for(const u of G.units) if(u.owner===FAC.P2&&u.type!==UT.VIL&&u.type!==UT.MONK){
        u.camp=FAC.P2; u.campX=p2.tcId?p2.baseX:u.x; u.campY=p2.tcId?p2.baseY:u.y;
      }
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
    if(a){
      // `enceinte` : palissade à portails autour du Centre Ville (le gabarit
      // de l'Arène, voir poserMursArene) — une place forte à assiéger.
      const tc=bldById(a.tcId)||G.buildings.find(b=>b.id===a.tcId);
      if(fd.enceinte&&tc) poserMursArene(tc.tx,tc.ty,tc.w,tc.h,a.id);
      poserApports(a.id,fd,p[0],p[1]); reglerIA(a,fd);
    }
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
  // `inst` : identité de CETTE partie de la mission. Chez l'invité, G.scn est
  // remplacé par un objet neuf à chaque delta qui le porte : l'interface ne
  // peut pas se fier à l'identité de l'objet pour savoir si elle découvre une
  // nouvelle mission ou lit la suite de la même.
  G.scn={inst:(Math.random()*1e9)|0, obj:{}, prog:{}, decl:{}, declT:{}, tags:{}, dlg:[], rev:[], marques:[], fin:null, etoiles:0, seq:0, acc:0};
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
  // 2. Objectifs actifs. `compte` (M=>[n, sur]) : l'avancement affiché à
  //    côté du texte (« 4/6 »). Calculé ICI, chez l'hôte, et rangé dans l'état
  //    répliqué : l'invité n'a pas de quoi le recompter (les stats de l'autre
  //    camp, le brouillard...), il le lit.
  for(const o of (def.objectifs||[])){
    if(G.scn.obj[o.id]!=='actif') continue;
    if(o.compte){
      const c=scnAppel(o.compte,'compte:'+o.id);
      if(Array.isArray(c)){
        const n=Math.max(0,Math.min(c[1],Math.floor(c[0]))), sur=Math.floor(c[1]);
        const p=G.scn.prog||(G.scn.prog={}), av=p[o.id];
        if(!av||av[0]!==n||av[1]!==sur){ p[o.id]=[n,sur]; G.scn.seq++; }
      }
    }
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
// Le joueur local vient d'être éliminé (son dernier Centre Ville est tombé),
// entre deux évaluations du scénario. Les objectifs sont évalués SUR-LE-CHAMP —
// « Rome doit tenir » échoue avec SON texte — et, si aucun ne tranche, la
// mission est perdue pour élimination... seulement s'il ne reste personne de
// l'équipe en lice : en coop, l'allié encore debout continue la mission.
function trancherEliminationMission(){
  if(!G.scn||G.scn.fin) return;
  G.scn.acc=SCN_CADENCE; majScenario(0);
  if(G.scn.fin) return;
  const p1=G.factions[FAC.P1];
  const reste=factionsHumaines().some(f=>!f.vaincu&&p1&&f.equipe===p1.equipe);
  if(!reste) finMission('defaite','elimine');
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
  if(def.causes&&def.causes[fin.cause]) return def.causes[fin.cause];
  if(fin.cause==='merveille') return "Un rival a achevé sa Merveille et l'a gardée debout : la mission est perdue.";
  if(fin.cause==='elimine') return "Votre dernier Centre Ville est tombé : la mission est perdue.";
  return def.defaite||'La mission a échoué.';
}

// ── RÈGLES DE MISSION ─────────────────────────────────────
// `regles` d'une mission : {ageMax, interdits:[BT.x|UT.x], recherchesInterdites:
// [clé RDEF], merveille:false}. UNE fonction, lue par applyCommand — la seule
// porte de mutation, donc aussi celle des ordres forgés de l'invité — ET par
// l'interface qui grise les boutons : les deux ne peuvent pas diverger (voir
// le groupe de tests `promesses`). Rend la RAISON du refus, courte et
// affichable telle quelle, ou null.
//   quoi : 'age' | 'batir' | 'former' | 'recherche'
function regleMission(quoi,cle,owner){
  const def=missionCourante(), r=def&&def.regles;
  if(!r) return null;
  if(quoi==='age'){
    const f=G.factions&&G.factions[owner];
    return (r.ageMax!=null&&f&&f.age>=r.ageMax)?`Âge maximum de la mission : ${AGES[r.ageMax].nom}`:null;
  }
  if(quoi==='batir'||quoi==='former'){
    if((r.interdits||[]).includes(cle)) return 'Interdit dans cette mission';
    if(quoi==='batir'&&cle===BT.WONDER&&r.merveille===false) return 'Pas de Merveille dans cette mission';
    return null;
  }
  if(quoi==='recherche') return (r.recherchesInterdites||[]).includes(cle)?'Interdite dans cette mission':null;
  return null;
}

// ── DIPLOMATIE DE MISSION ─────────────────────────────────
// Hors mission, tout rival IA peut être approché (ORD.DIPLOMATIE). En mission,
// SEULS les camps dont la fiche porte `diplomatie` le peuvent. Sans ce verrou,
// un seigneur SEUL de son camp acceptait toujours l'alliance — la règle
// d'acceptation le compare aux AUTRES rivaux, et il n'y en a pas — et un clic
// dans le menu pause vidait une mission de son adversaire (Reliques d'Aix, Ring
// des Avars : le rival devenu allié n'attaquait plus, ou ne pouvait plus être
// vaincu).
//   diplomatie: true            — la règle ordinaire (pas plus fort que les autres rivaux)
//             | { si:M=>bool,   — n'accepte qu'à cette condition (greniers brûlés...)
//                 prix:{gold:…},— contre ce tribut, prélevé à l'acceptation
//                 refus:'texte',— la raison dite au joueur quand il refuse
//                 force:true }  — ET la règle ordinaire (par défaut : seulement
//                                 sans `si` ni `prix`)
// Rend undefined hors mission (aucun verrou), null si le camp refuse tout
// pourparler, la fiche sinon. UNE fonction, lue par applyCommand ET par le
// panneau Diplomatie : l'interface ne propose que ce que l'hôte acceptera
// d'examiner (groupe `promesses`).
function cleFactionMission(id){
  for(const [k,v] of Object.entries(SCN_FAC)) if(v===id&&k!=='pillards') return k;
  return null;
}
function diplomatieMission(cibleId){
  const def=missionCourante(); if(!def) return undefined;
  const k=cleFactionMission(cibleId);
  const d=k&&def.factions&&def.factions[k]&&def.factions[k].diplomatie;
  if(!d) return null;
  return d===true?{}:d;
}
const ICO_RES={food:'🍖',wood:'🪵',stone:'🪨',gold:'💰'};
function texteCoutMission(c){ return Object.entries(c||{}).map(([k,v])=>`${v}${ICO_RES[k]||k}`).join(' '); }
// Examen d'une proposition d'alliance en mission — null si elle passe (le
// tribut éventuel est alors prélevé), sinon le refus à renvoyer.
function examenDiplomatie(d,cible,owner){
  if(d.si&&!scnAppel(d.si,'diplomatie:si')) return {ok:false,raison:'refuse',nom:cible.nom,msg:d.refus||`${cible.nom} refuse de traiter pour l'instant.`};
  if(d.prix&&!canAfford(d.prix,owner))
    return {ok:false,raison:'refuse',nom:cible.nom,msg:`${cible.nom} demande ${texteCoutMission(d.prix)} pour traiter.`};
  return null;
}

// ── RÔLES D'IA SCRIPTÉS ───────────────────────────────────
// De petits crochets dans l'IA de Conquête (js/08-ia.js), pas une nouvelle
// IA. Posés sur la FACTION (données pures : ils partent dans la sauvegarde) :
//   role      : 'normal' | 'passif' (n'attaque pas — sa défense reste
//               active — jusqu'à ce qu'un déclencheur la relance) |
//               'forteresse' (n'attaque jamais, fortifie plus souvent) |
//               'allie' (assauts plus espacés : un appui, pas un rival)
//   cible     : zone ou étiquette vers laquelle ses assauts se rallient, au
//               lieu du Centre Ville hostile le plus proche
//   ageMax    : âge qu'elle ne dépassera pas
//   heros:false, merveille:false : elle n'en forme / n'en bâtit pas
//   tune      : réglages fusionnés dans les siens (voir aiTune)
//   lancer    : son prochain assaut part dès que son armée est prête
const ROLES_IA = new Set(['normal','passif','forteresse','allie']);
function reglerIA(f,o){
  if(!f||f.genre!=='ia'||!o) return;
  if(o.role!=null&&ROLES_IA.has(o.role)) f.role=o.role;
  if('cible' in o) f.cible=o.cible||null;
  if(o.ageMax!=null&&AGES[o.ageMax]) f.ageMax=o.ageMax;
  if(o.armeeMax!=null) f.armeeMax=o.armeeMax;   // plafond d'armée d'une IA retenue (voir aiArmeeMax)
  if(o.heros===false) f.heros=false;
  if(o.merveille===false) f.merveille=false;
  if(o.tune) f.tune=Object.assign({},f.tune||{},o.tune);
  if(o.lancer) f.atkTimer=0;
}
// Où rallier l'assaut d'une IA de mission : sa zone ou son étiquette-cible,
// ou null (l'IA garde alors son choix habituel, aiCibleBase).
function cibleIAMission(a){
  if(!a.cible||!G.mission) return null;
  const zn=zoneMission(a.cible,true);
  if(zn) return {x:zn.x,y:zn.y};
  const e=entitesTag(a.cible)[0];
  return e?{x:e.x,y:e.y}:null;
}

// ── RÉPLIQUES ─────────────────────────────────────────────
// Le journal (G.scn.dlg) est la SOURCE ; le bandeau de dialogue n'en est
// qu'une lecture (voir majInterfaceScenario, plus bas). C'est ce qui permettra
// à l'invité d'une partie à deux de lire le même récit depuis l'état répliqué,
// sans passer par la file de RETOURS, plafonnée et oublieuse.
function destinataireLocal(dest){
  if(!dest||dest==='tous') return true;
  return facMission(dest)===G.me;
}

// ── LE VOCABULAIRE DES SCÉNARISTES ────────────────────────
// Passé à chaque fermeture de mission sous le nom `M`. Les missions ne
// touchent jamais G directement : tout ce qu'elles lisent ou font passe par
// ici, ce qui permet de faire évoluer le moteur sans les réécrire, et de les
// rejouer telles quelles dans les tests.
function campJoueur(){
  const ids=new Set([FAC.P1]);
  if(G.factions[FAC.P2]) ids.add(FAC.P2);
  return ids;
}
function entitesTag(tag){
  const out=[];
  for(const u of G.units) if(u.tag===tag&&u.hp>0) out.push(u);
  for(const b of G.buildings) if(b.tag===tag&&b.hp>0) out.push(b);
  return out;
}
// Fait passer un bâtiment dans un autre camp. Le propriétaire d'un bâtiment
// NE VOYAGE PAS (le delta d'un bâtiment connu ne porte que ses PV, sa file,
// son chantier... — voir construireDelta) : changer `b.owner` en place
// laisserait l'invité voir la ville libérée sous les couleurs de l'ennemi, et
// son estHostile la compterait encore adverse (invariant n°6). On le
// REMPLACE donc par un bâtiment neuf, même type, même emprise, même état :
// il part chez l'invité par `newB`, l'ancien par `rmb`.
function passerBatiment(b,owner){
  if(b.owner===owner) return b;
  for(const u of G.units) if(u.target===b.id&&['repair','farm','build','garrison'].includes(u.state)){
    const enGarnison=u.state==='garrison';
    u.state='idle'; u.target=null;
    if(enGarnison) reprendrePoste(u);
  }
  libererFileFormation(b);
  const nb=mkBuilding(b.type,b.tx,b.ty,owner);
  nb.hp=Math.max(1,Math.round(nb.maxHp*b.hp/Math.max(1,b.maxHp)));
  nb.constructing=b.constructing; nb.progress=b.progress;
  nb.foodLeft=b.foodLeft; nb.level=b.level; nb.open=b.open;
  if(b.tag) nb.tag=b.tag;                  // même étiquette : ni « mort », ni compté deux fois
  G.buildings=G.buildings.filter(x=>x!==b);
  G.sel=G.sel.filter(id=>id!==b.id);
  placeBuilding(nb);                        // même emprise : la marque de bmap est reposée telle quelle
  return nb;
}
let _coupeVu=null, _coupeFile=null;   // tampons de M.coupe, réutilisés d'un appel à l'autre
const SCN_API = {
  // ── lecture ──
  temps(){ return G.gameTime; },
  fait(id){ return !!G.scn&&G.scn.obj[id]==='fait'; },
  echoue(id){ return !!G.scn&&G.scn.obj[id]==='echec'; },
  etat(id){ return G.scn?G.scn.obj[id]:undefined; },
  tire(id){ return !!G.scn&&(G.scn.decl[id]||0)>0; },
  // Combien de fois un déclencheur `repete` a tiré : de quoi faire grossir
  // des vagues successives sans tenir un compteur à part.
  tirs(id){ return G.scn?(G.scn.decl[id]||0):0; },
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
  // Tout le camp du JOUEUR (P1, et le second commandant s'il existe) : un
  // objectif commun — « six fermes » — compte les fermes des deux
  // commandants en coop, et ne compte pas deux fois en solo fusionné.
  compteEquipe(type){
    const ids=campJoueur();
    if(UDEF[type]) return G.units.filter(u=>ids.has(u.owner)&&u.type===type&&u.hp>0).length;
    return G.buildings.filter(b=>ids.has(b.owner)&&b.type===type&&!b.constructing&&b.hp>0).length;
  },
  statsEquipe(cle){ let n=0; for(const id of campJoueur()){ const f=G.factions[id]; if(f&&f.stats) n+=f.stats[cle]||0; } return n; },
  age(k){ const f=G.factions[facMission(k)]; return f?f.age:0; },
  res(k,r){ const f=G.factions[facMission(k)]; return f&&f.res?(f.res[r]||0):0; },
  stats(k,cle){ const f=G.factions[facMission(k)]; return f&&f.stats?(f.stats[cle]||0):0; },
  reliques(k){ const id=facMission(k); return (G.relics||[]).filter(r=>r.bankedBy===id).length; },
  reliquesEquipe(){ const ids=campJoueur(); return (G.relics||[]).filter(r=>ids.has(r.bankedBy)).length; },
  // Au moins `n` entités vivantes de cette étiquette dans la zone (un convoi
  // arrivé, une garde en place).
  tagDansZone(tag,zone,n){
    const zn=zoneMission(zone); if(!zn) return false;
    let c=0;
    for(const e of entitesTag(tag)) if(dansZoneMonde(zn,e.x,e.y)&&++c>=(n||1)) return true;
    return false;
  },
  // Plus AUCUN chemin praticable entre deux zones : une muraille fermée.
  // Parcours en largeur 4-connexe — comme la recherche de chemin, qui refuse
  // les coupes d'angle (voir findPath) — sur les cases que tileBlocked laisse
  // passer : un portail ouvert en est une, un fermé non ; un champ ou un
  // arbre aussi. Toute la carte dans le pire cas : à n'employer que dans un
  // objectif ou un déclencheur, évalués deux fois par seconde.
  coupe(za,zb){
    const a=zoneMission(za), b=zoneMission(zb); if(!a||!b) return false;
    const n=COLS*ROWS;
    if(!_coupeVu||_coupeVu.length!==n){ _coupeVu=new Uint8Array(n); _coupeFile=new Int32Array(n); }
    const vu=_coupeVu, file=_coupeFile; vu.fill(0);
    const d=casePraticable(a.tx,a.ty), rb=Math.max(1,b.r);
    let tete=0, queue=0;
    file[queue++]=d.tx+d.ty*COLS; vu[file[0]]=1;
    while(tete<queue){
      const c=file[tete++], x=c%COLS, y=(c/COLS)|0;
      if((x-b.tx)*(x-b.tx)+(y-b.ty)*(y-b.ty)<=rb*rb) return false;
      if(x>0&&!vu[c-1]&&G.bmap[y][x-1]!==3){ vu[c-1]=1; file[queue++]=c-1; }
      if(x<COLS-1&&!vu[c+1]&&G.bmap[y][x+1]!==3){ vu[c+1]=1; file[queue++]=c+1; }
      if(y>0&&!vu[c-COLS]&&G.bmap[y-1][x]!==3){ vu[c-COLS]=1; file[queue++]=c-COLS; }
      if(y<ROWS-1&&!vu[c+COLS]&&G.bmap[y+1][x]!==3){ vu[c+COLS]=1; file[queue++]=c+COLS; }
    }
    return true;
  },
  // Une route commerciale du camp du joueur aboutit-elle à un Marché de la
  // zone (à l'une ou l'autre de ses extrémités) ? Une ville se rallie ainsi
  // par le commerce.
  routeVers(zone){
    const zn=zoneMission(zone); if(!zn) return false;
    const ids=campJoueur();
    for(const b of G.buildings){
      if(b.type!==BT.MARKET||!ids.has(b.owner)||!b.tradeRoute||b.hp<=0) continue;
      const to=bldById(b.tradeRoute.toId); if(!to) continue;
      if(dansZoneMonde(zn,b.x,b.y)||dansZoneMonde(zn,to.x,to.y)) return true;
    }
    return false;
  },
  // Combien d'entités vivantes de cette étiquette dans la zone (pour un compteur).
  tagCompteZone(tag,zone){
    const zn=zoneMission(zone); if(!zn) return 0;
    let c=0; for(const e of entitesTag(tag)) if(dansZoneMonde(zn,e.x,e.y)) c++;
    return c;
  },
  vaincu(k){ const f=G.factions[facMission(k)]; return !f||!!f.vaincu; },
  coop(){ return modeSecondCommandant()==='coop'; },
  // Au moins `n` unités du camp du joueur (les deux commandants) dans la zone.
  equipeDansZone(zone,n){
    const zn=zoneMission(zone); if(!zn) return false;
    const ids=campJoueur(); let c=0;
    for(const u of G.units) if(u.hp>0&&ids.has(u.owner)&&dansZoneMonde(zn,u.x,u.y)&&++c>=(n||1)) return true;
    return false;
  },
  // Même chose pour les seules unités MILITAIRES (une armée revenue au camp :
  // les villageois qui y travaillent ne comptent pas).
  armeeDansZone(zone,n){
    const zn=zoneMission(zone); if(!zn) return false;
    const ids=campJoueur(); let c=0;
    for(const u of G.units) if(u.hp>0&&ids.has(u.owner)&&isMilitary(u.type)&&dansZoneMonde(zn,u.x,u.y)&&++c>=(n||1)) return true;
    return false;
  },
  // Combien d'unités HOSTILES au joueur dans la zone (garnison, pillards,
  // armée d'un seigneur) : une place n'est à soi que lorsque ce compte tombe à 0.
  hostilesDansZone(zone){
    const zn=zoneMission(zone); if(!zn) return 0;
    const moiRef={owner:FAC.P1}; let c=0;
    for(const u of G.units) if(u.hp>0&&u.state!=='garrison'&&estHostile(moiRef,u)&&dansZoneMonde(zn,u.x,u.y)) c++;
    return c;
  },
  // Une entité au moins de cette étiquette appartient au camp du joueur.
  possede(tag){ const ids=campJoueur(); return entitesTag(tag).some(e=>ids.has(e.owner)); },
  // Ce camp est-il (devenu) l'allié du joueur ? Diplomatie, ralliement.
  allie(k){
    const f=G.factions[facMission(k)], p=G.factions[FAC.P1];
    return !!f&&!!p&&!f.vaincu&&f.id!==p.id&&f.equipe===p.equipe;
  },
  recherche(k,cle){ const f=G.factions[facMission(k)]; return !!(f&&f.research&&f.research[cle]); },
  rechercheEquipe(cle){ for(const id of campJoueur()){ const f=G.factions[id]; if(f&&f.research&&f.research[cle]) return true; } return false; },
  // Unités militaires vivantes du camp du joueur.
  armeeEquipe(){ const ids=campJoueur(); let n=0; for(const u of G.units) if(u.hp>0&&ids.has(u.owner)&&isMilitary(u.type)) n++; return n; },
  // Total récolté (ou gagné au commerce) par le camp du joueur depuis le départ.
  recolte(r){ let n=0; for(const id of campJoueur()){ const f=G.factions[id]; if(f&&f.stats&&f.stats.gathered) n+=f.stats.gathered[r]||0; } return n; },
  // Au moins `n` bâtiments ACHEVÉS de ce type au camp du joueur, dans la zone.
  bati(type,zone,n){
    const zn=zoneMission(zone); if(!zn) return false;
    const ids=campJoueur(); let c=0;
    for(const b of G.buildings) if(b.type===type&&ids.has(b.owner)&&!b.constructing&&b.hp>0&&dansZoneMonde(zn,b.x,b.y)&&++c>=(n||1)) return true;
    return false;
  },
  difficulte(){ return G.difficulty; },

  // ── action ──
  dire(k,dest){
    if(!G.scn) return;
    G.scn.dlg.push({k,d:dest||'tous',t:G.gameTime}); G.scn.seq++;
  },
  objectif(id,etat){ majObjectif(id,etat==='ajout'?'actif':etat); },
  // Renfort ou vague : même geste, poser des unités à une zone. Pour un camp
  // adverse, l'effectif suit la difficulté (enemyCount, comme spawnWave) et
  // la coopération (regles.coopMult) ; un renfort allié est toujours tel
  // qu'écrit. `vers` : les unités humaines y marchent en ordre offensif ;
  // les adverses y marchent (par les étapes de `via`), puis y tiennent la
  // garde si `garde`, sinon partent chasser une fois arrivées.
  renfort(k,compo,zone,o){
    o=o||{};
    const id=facMission(k), zn=zoneMission(zone);
    if(!zn) return [];
    const f=G.factions[id];
    const adverse=f&&estHostile(FAC.P1,{owner:id});
    const diff=DIFFS[G.difficulty]||DIFFS.normal;
    const def=missionCourante();
    const mult=(adverse&&!o.egal)?diff.enemyCount*(SCN_API.coop()?((def.regles&&def.regles.coopMult)||1.3):1):1;
    // `vers` : une zone, ou une ÉTIQUETTE — la position actuelle de ce qu'elle
    // désigne (un convoi en marche). Indispensable là où le joueur n'a aucun
    // bâtiment : une vague libre cherche d'abord un bâtiment à abattre, et
    // sans cible elle resterait plantée à son point d'apparition.
    let vers=o.vers?zoneMission(o.vers,true):null;
    if(!vers&&typeof o.vers==='string'){
      const cibles=entitesTag(o.vers);
      if(cibles.length){ const c=cibles[(cibles.length/2)|0]; vers={x:c.x,y:c.y}; }
    }
    const poses=[];
    for(const e of compo){
      const g=groupeUnites(e);
      g.n=Math.max(1,Math.round(g.n*mult));
      if(o.tag) g.tag=o.tag;
      if(o.garde) g.garde=true;
      if(o.egal) g.egal=true;
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
      } else {
        // `via` : des étapes (zones) avant `vers`. La recherche de chemin a un
        // budget (PF_BUDGET) qui ne contourne pas un lac ou un camp à
        // quatre-vingts cases de distance : une colonne lancée à travers la
        // carte doit recevoir son itinéraire, étape par étape (voir le
        // retour au poste, updateEnemyAI).
        const pts=(o.via||[]).map(z=>zoneMission(z)).filter(Boolean).map(z=>({x:z.x,y:z.y}));
        pts.push({x:vers.x,y:vers.y});
        for(const u of poses){
          u.camp=id; u.campX=pts[0].x; u.campY=pts[0].y;
          u.etapes=pts.length>1?pts.slice(1).map(p=>({x:p.x,y:p.y})):null;
          if(!o.garde) u.assaut=true;   // arrivée, elle part chasser (voir updateEnemyAI)
          marquerHorsArmee(u);   // la colonne va où la mission l'envoie (voir js/08-ia.js)
        }
      }
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
  // Poursuite : chaque unité de l'étiquette prend pour poste l'unité du camp
  // du joueur la plus proche d'elle. À appeler par un déclencheur `repete` :
  // une troupe lâchée ne chasse d'elle-même que des BÂTIMENTS au loin (voir
  // updateEnemyAI) — face à une armée sans base qui recule, elle resterait
  // plantée. Rend le nombre de poursuivants.
  traquer(tag){
    const ids=campJoueur();
    const proies=G.units.filter(u=>u.hp>0&&ids.has(u.owner)&&u.state!=='garrison');
    if(!proies.length) return 0;
    let n=0;
    for(const u of entitesTag(tag)){
      if(!u.owner||!G.factions[u.owner]||G.factions[u.owner].genre==='humain'||u.w) continue;
      let best=null, bd=Infinity;
      for(const p of proies){ const d=(p.x-u.x)*(p.x-u.x)+(p.y-u.y)*(p.y-u.y); if(d<bd){ bd=d; best=p; } }
      u.camp=u.owner; u.campX=best.x; u.campY=best.y;
      marquerHorsArmee(u);
      n++;
    }
    return n;
  },
  poser(k,type,zone,tag){
    const zn=zoneMission(zone); if(!zn) return null;
    const b=poserBatimentScn(type,zn.tx,zn.ty,facMission(k),tag);
    if(b){ updatePopCap(); rebuildIndex(); }
    return b;
  },
  // Change de camp tout ce qui porte l'étiquette : une garnison qui se rend,
  // une ville qui ouvre ses portes.
  convertir(tag,k){
    const id=facMission(k);
    for(const e of entitesTag(tag)){
      if(e.w) passerBatiment(e,id);
      else {
        // Hors population de son ancien seigneur (marquerHorsArmee) : on l'y
        // remet un instant, pour que convertirUnite l'en retire à l'identique.
        if(e.horsArmee){ e.horsArmee=false; posePopulation(e.owner,1); }
        convertirUnite(e,id); e.camp=null;   // une garde ralliée ne garde plus le poste de l'ancien camp
      }
    }
    updatePopCap(); rebuildIndex();
  },
  equipe(k,n){ const f=G.factions[facMission(k)]; if(f){ f.equipe=n; G.scn.seq++; } },
  // Rôle et consignes d'un seigneur IA en cours de mission — voir reglerIA.
  // `M.ia('ia',{role:'normal',lancer:true})` : le rival passif passe à l'attaque.
  ia(k,o){ reglerIA(G.factions[facMission(k)],o); },
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

// ══════════════════════════════════════════════════════════
//  INTERFACE DE CAMPAGNE
// ══════════════════════════════════════════════════════════
// Tout texte de mission passe par echapHTML avant d'entrer dans un innerHTML :
// ce contenu est le nôtre, mais la règle du jeu est qu'aucun texte ne soit
// jamais rendu comme du balisage — et l'invité lira bientôt des clés venues
// du réseau.
function echapHTML(t){
  return String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── PROGRESSION ───────────────────────────────────────────
// PROFILE.campagne : une entrée par mission gagnée au moins une fois,
// {v:1, diff, etoiles, temps}. Fusion (Drive ↔ appareil, ou deux victoires
// successives) : la MEILLEURE difficulté, le plus d'étoiles, le meilleur
// temps — chacun indépendamment, puisqu'un joueur peut avoir gagné en
// Brutal avec deux étoiles puis en Facile avec trois.
const RANG_DIFF = { easy:0, normal:1, hard:2, brutal:3 };
function fusionMission(a,b){
  if(!a) return b?Object.assign({},b):null;
  if(!b) return Object.assign({},a);
  const ta=a.temps!=null?a.temps:Infinity, tb=b.temps!=null?b.temps:Infinity;
  return { v:1,
    diff:(RANG_DIFF[b.diff]||0)>(RANG_DIFF[a.diff]||0)?b.diff:a.diff,
    etoiles:Math.max(a.etoiles||0,b.etoiles||0),
    temps:isFinite(Math.min(ta,tb))?Math.min(ta,tb):null };
}
function fusionProgression(a,b){
  const out={};
  for(const k of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){
    const m=fusionMission(a&&a[k],b&&b[k]);
    if(m) out[k]=m;
  }
  return out;
}
// Appelée par finishGame(true) — donc une seule fois par partie.
function enregistrerVictoireMission(){
  if(!G.mission) return;
  const e={v:1, diff:G.difficulty, etoiles:(G.scn&&G.scn.etoiles)||1, temps:Math.round(G.gameTime)};
  if(!PROFILE.campagne) PROFILE.campagne={};
  PROFILE.campagne[G.mission]=fusionMission(PROFILE.campagne[G.mission],e);
}
function resultatMission(cle){ return (PROFILE.campagne&&PROFILE.campagne[cle])||null; }
// Une mission s'ouvre quand la précédente de sa campagne a été gagnée, à
// n'importe quelle difficulté. La première est toujours ouverte.
function missionDebloquee(cle){
  const m=MISSIONS[cle]; if(!m) return false;
  const c=CAMPAGNES[m.campagne]; if(!c) return true;
  const i=c.missions.indexOf(cle);
  return i<=0||!!resultatMission(c.missions[i-1]);
}
function missionSuivante(cle){
  const m=MISSIONS[cle], c=m&&CAMPAGNES[m.campagne];
  if(!c) return null;
  const i=c.missions.indexOf(cle);
  return (i>=0&&i+1<c.missions.length)?c.missions[i+1]:null;
}
// ── SUCCÈS ET CLASSEMENT DE CAMPAGNE ─────────────────────
// Lus par les succès (ACH, js/11-interface.js) dans la PROGRESSION du profil,
// pas dans la partie : ils tombent à la victoire qui complète la campagne —
// enregistrerVictoireMission passe AVANT checkAchievements (voir finishGame).
function campagneTerminee(cle){
  const c=CAMPAGNES[cle];
  return !!c&&c.missions.length>0&&c.missions.every(id=>!!resultatMission(id));
}
// Toutes les missions de toutes les campagnes, gagnées en Brutal (la fusion
// garde la meilleure difficulté : une victoire en Facile après ne l'efface pas).
function toutesEnBrutal(){
  const ids=Object.values(CAMPAGNES).flatMap(c=>c.missions);
  return ids.length>0&&ids.every(id=>{ const r=resultatMission(id); return !!r&&r.diff==='brutal'; });
}
// Tableau du classement en ligne d'une mission : UN PAR MISSION ET PAR
// DIFFICULTÉ — un temps en Facile et un temps en Brutal ne se comparent pas.
// Null pour une mission hors campagne (la mission d'essai du moteur).
// Nécessite la règle RTDB `classement/missions/$tableau` du README.
function tableauClassementMission(cle,diff){
  const m=MISSIONS[cle];
  if(!m||!m.campagne||!CAMPAGNES[m.campagne]||!DIFFS[diff]) return null;
  return `missions/${cle}_${diff}`;
}
function etoilesTexte(n,max){ return '★'.repeat(n||0)+'☆'.repeat(Math.max(0,(max||3)-(n||0))); }
function nbEtoilesMax(cle){ const m=MISSIONS[cle]; return ((m&&m.etoiles)||['victoire']).length; }

// ── ÉCRAN-TITRE : onglet Campagne ─────────────────────────
// Une campagne sans mission n'est PAS affichée : un bouton grisé « à venir »
// serait une promesse que le jeu ne tient pas encore.
function afficherListeCampagnes(){
  const el=document.getElementById('campbloc');
  if(!el) return;
  let html='';
  for(const [cle,c] of Object.entries(CAMPAGNES)){
    if(!c.missions.length) continue;
    const gagnees=c.missions.filter(id=>resultatMission(id)).length;
    const h=HEROES[c.heros]||{nom:''};
    html+=`<button type="button" class="campbtn" onclick="ouvrirCampagne('${cle}')">`
      +`<span class="cico">${c.ico}</span>`
      +`<span><span class="cnom">${echapHTML(c.nom)}</span>`
      +`<span class="csub">${echapHTML(h.nom)} · ${gagnees}/${c.missions.length} mission${c.missions.length>1?'s':''}</span></span></button>`;
  }
  el.innerHTML='<p class="campintro">Des missions scénarisées, chacune avec son récit, ses objectifs et sa carte.</p>'
    +(html||'<p class="tip">Aucune campagne disponible pour le moment.</p>');
}
window.afficherListeCampagnes=afficherListeCampagnes;

// ── PANNEAU DE CAMPAGNE : missions et briefing ────────────
let _campOuverte=null, _missionVue=null;
function ouvrirCampagne(cle,missionCle){
  const c=CAMPAGNES[cle]; if(!c||!c.missions.length) return;
  _campOuverte=cle;
  const h=HEROES[c.heros]||{nom:'',ico:''};
  const tete=document.getElementById('camp-tete');
  if(tete) tete.innerHTML=`<div class="ct-ico">${c.ico}</div><h2>${echapHTML(c.nom)}</h2>`
    +`<div class="ct-sub">${echapHTML(CIVS[c.heros]?CIVS[c.heros].nom:'')} · ${h.ico||''} ${echapHTML(h.nom)}</div>`;
  // Par défaut : la première mission ouverte et pas encore gagnée — là où le
  // joueur en était.
  const defaut=c.missions.find(id=>missionDebloquee(id)&&!resultatMission(id))
             ||[...c.missions].reverse().find(missionDebloquee)||c.missions[0];
  voirMission(missionCle&&missionDebloquee(missionCle)?missionCle:defaut);
  const p=document.getElementById('campagnepanel');
  if(p) p.style.display='flex';
}
function fermerCampagne(){
  const p=document.getElementById('campagnepanel');
  if(p) p.style.display='none';
  _campOuverte=null;
}
function voirMission(cle){
  const m=MISSIONS[cle]; if(!m||!missionDebloquee(cle)) return;
  _missionVue=cle;
  const c=CAMPAGNES[m.campagne];
  const liste=document.getElementById('camp-missions');
  if(liste) liste.innerHTML=c.missions.map((id,i)=>{
    const mm=MISSIONS[id], ouverte=missionDebloquee(id), r=resultatMission(id);
    return `<button type="button" class="missbtn${id===cle?' sel':''}" ${ouverte?`onclick="voirMission('${id}')"`:'disabled'}>`
      +`<span class="mnum">${ouverte?i+1:'🔒'}</span>`
      +`<span class="mtit">${echapHTML(mm.titre)}</span>`
      +`<span class="mstar">${r?etoilesTexte(r.etoiles,nbEtoilesMax(id)):''}</span></button>`;
  }).join('');
  const r=resultatMission(cle);
  const vus=(m.objectifs||[]).filter(o=>!o.cache);
  const princ=vus.filter(o=>o.type!=='secondaire'), sec=vus.filter(o=>o.type==='secondaire');
  const listeObj=l=>`<ul class="cb-obj">${l.map(o=>`<li>${echapHTML(o.txt)}</li>`).join('')}</ul>`;
  const brief=document.getElementById('camp-brief');
  if(!brief) return;
  brief.innerHTML=`<h3>${echapHTML(m.titre)}</h3>`
    +`<div class="cb-lieu">${echapHTML(m.lieu||'')}${m.date?' · '+echapHTML(m.date):''}</div>`
    +(m.briefing||[]).map(t=>`<p>${echapHTML(t)}</p>`).join('')
    +`<div class="cb-sec">Objectifs</div>${listeObj(princ)}`
    +(sec.length?`<div class="cb-sec">Secondaires</div>${listeObj(sec)}`:'')
    +(r?`<div class="cb-sec">Meilleur résultat : ${etoilesTexte(r.etoiles,nbEtoilesMax(cle))} · ${DIFFS[r.diff]?DIFFS[r.diff].nom:''}${r.temps!=null?' · '+fmtDuration(r.temps):''}</div>`:'')
    +`<div id="camp-classement"></div>`
    +`<div class="cb-sec">Difficulté</div>`
    +`<div class="diffrow">${Object.entries(DIFFS).map(([k,d])=>
        `<button type="button" class="diffbtn${k===selectedDifficulty?' sel':''}" data-d="${k}" onclick="choisirDiffCampagne('${k}')"><span class="dico">${d.ico}</span><span class="dlabel">${d.nom}</span></button>`).join('')}</div>`
    +`<button class="bigbtn sheen" onclick="jouerMissionSolo()">⚔️ Jouer seul</button>`
    // À deux seulement si la mission a un second commandant à confier.
    +(m.roles&&m.roles.p2?`<button class="bigbtn friendbtn" onclick="jouerMissionAvecAmi()">👥 Jouer avec un ami · votre allié sera ${echapHTML(m.roles.p2.nom||'le second commandant')}</button>`:'');
  brief.style.display='flex';
  afficherClassementMission(cle);
}
// Les meilleurs temps de la mission, à la difficulté choisie. Chargés en
// asynchrone : un jeton écarte la réponse d'une mission ou d'une difficulté
// qu'on a quittée entre-temps. Rien du tout si le multijoueur n'est pas
// configuré ; une invite si l'on n'est pas connecté (même panneau que le
// classement général). Les NOMS viennent du réseau : échappés.
let _jetonClassementMission=0;
async function afficherClassementMission(cle){
  const el=document.getElementById('camp-classement');
  if(!el) return;
  const tableau=tableauClassementMission(cle,selectedDifficulty);
  if(!tableau||typeof mpDispo!=='function'||!mpDispo()||!window.MP.classementLire){ el.innerHTML=''; return; }
  const titre=`<div class="cb-sec">🥇 Meilleurs temps · ${echapHTML(DIFFS[selectedDifficulty].nom)}</div>`;
  if(!_mpEtat.uid){
    el.innerHTML=titre+'<p class="cb-cla-vide">Connectez-vous depuis <b>👥 Jouer avec un ami</b> pour voir les meilleurs temps et y figurer.</p>';
    return;
  }
  const jeton=++_jetonClassementMission;
  el.innerHTML=titre+'<p class="cb-cla-vide">Chargement…</p>';
  const rows=await window.MP.classementLire(tableau,5);
  if(jeton!==_jetonClassementMission) return;
  const e=document.getElementById('camp-classement'); if(!e) return;
  e.innerHTML=titre+htmlClassementMission(rows);
}
function htmlClassementMission(rows){
  if(!rows||!rows.length) return '<p class="cb-cla-vide">Aucun temps pour l\'instant — soyez le premier !</p>';
  return rows.map((r,i)=>`<div class="cb-cla${r.uid===_mpEtat.uid?' moi':''}"><span>${i+1}. ${echapHTML(r.nom||'Joueur')}</span><span>${fmtDuration(+r.valeur||0)}</span></div>`).join('');
}
function choisirDiffCampagne(k){ pickDifficulty(k); if(_missionVue) voirMission(_missionVue); }
// Ouvre le salon multijoueur habituel, réglé sur cette mission : l'hôte y
// crée sa partie et partage le code comme d'ordinaire ; la mission n'est
// armée qu'au lancement (voir demarrerPartieHote).
function jouerMissionAvecAmi(){
  const cle=_missionVue;
  if(!cle||!missionDebloquee(cle)||!MISSIONS[cle].roles.p2) return;
  fermerCampagne();
  mpOuvrir({mission:cle});
}
function jouerMissionSolo(){
  const cle=_missionVue;
  if(!cle||!missionDebloquee(cle)) return;
  fermerCampagne();
  lancerMission(cle);
}
// Le profil se charge en asynchrone (et se refusionne après une connexion
// Drive) : ce qui est affiché doit suivre — voir refreshAchCount.
function rafraichirCampagne(){
  if(typeof selectedPlayTab!=='undefined'&&selectedPlayTab==='campagne') afficherListeCampagnes();
  if(_campOuverte&&_missionVue) voirMission(_missionVue);
}
Object.assign(window,{ouvrirCampagne,fermerCampagne,voirMission,choisirDiffCampagne,jouerMissionSolo,jouerMissionAvecAmi});

// ── FIN DE MISSION ────────────────────────────────────────
// Après une mission, on revient à l'écran de campagne en RECHARGEANT la page
// (comme « Nouvelle partie » depuis toujours : c'est le seul chemin qui remet
// tout l'état à neuf), en laissant un mot dans sessionStorage pour rouvrir le
// bon briefing. Les boutons disent donc où ils mènent — un briefing — et non
// « Rejouer », que le jeu ne ferait pas d'un seul clic.
const CLE_RETOUR_CAMPAGNE='adc_campagne_ouvrir';
function allerAuBriefing(cle){
  const m=MISSIONS[cle];
  try{ sessionStorage.setItem(CLE_RETOUR_CAMPAGNE,JSON.stringify({c:m&&m.campagne,m:cle})); }catch(e){}
  location.reload();
}
window.allerAuBriefing=allerAuBriefing;
function boutonsFinMission(issue){
  const cle=G.mission, suiv=missionSuivante(cle);
  const second='style="background:linear-gradient(180deg,#3a2a08,#1a1200);color:var(--gold-l);border:1.5px solid var(--gold-d);box-shadow:none;"';
  if(issue==='victoire'){
    return (suiv?`<button class="bigbtn" onclick="allerAuBriefing('${suiv}')">➡️ Mission suivante : ${echapHTML(MISSIONS[suiv].titre)}</button>`:'')
      +`<button class="bigbtn" ${suiv?second:''} onclick="allerAuBriefing('${cle}')">📜 Retour à la campagne</button>`;
  }
  return `<button class="bigbtn" onclick="allerAuBriefing('${cle}')">📜 Retour au briefing</button>`;
}
// À l'ouverture de la page : rouvre le briefing laissé par une fin de mission.
function reprendreEcranCampagne(){
  let r=null;
  try{ r=JSON.parse(sessionStorage.getItem(CLE_RETOUR_CAMPAGNE)||'null'); sessionStorage.removeItem(CLE_RETOUR_CAMPAGNE); }catch(e){}
  if(!r||!CAMPAGNES[r.c]) return;
  pickPlayTab('campagne');
  ouvrirCampagne(r.c,r.m);
}

// ── EN PARTIE : objectifs, répliques, marqueurs ───────────
// Lecture de G.scn à chaque image (voir loop), redessinée seulement quand
// G.scn.seq a bougé. Rien ici ne modifie l'état : c'est l'affichage du
// scénario, que l'hôte écrit — et que l'invité recevra tel quel.
let _scnInst=null, _scnVu=-1, _objOuvert=true;
let _dlgLu=0, _fileRepliques=[], _repliqueFin=0;
// Posé par loadGame : une partie reprise rouvre sur un journal déjà joué, qu'on
// ne rejoue pas. Un signal explicite plutôt qu'une devinette sur le temps de
// jeu — une mission neuve peut très bien avoir déjà quelques secondes au
// compteur quand l'interface la découvre.
let _scnReprise=false;
const REPLIQUE_FRAICHE=8;
function marquerScenarioRepris(){ _scnReprise=true; }
function majInterfaceScenario(){
  if(!G.mission||!G.scn) return;
  if(G.scn.inst!==_scnInst){
    // Nouvelle mission, partie reprise (voir marquerScenarioRepris), ou
    // invité qui rejoint en cours de route.
    _scnInst=G.scn.inst; _scnVu=-1; _fileRepliques=[]; _repliqueFin=0;
    // Sur un téléphone, le panneau ouvert couvrirait un quart de la carte au
    // moment où le joueur la découvre : il démarre replié, la barre du haut
    // tient le compte (refreshConquestBar) et le bouton 📜 le rouvre.
    _objOuvert=!(typeof matchMedia==='function'&&matchMedia('(max-width:600px)').matches);
    // Une sauvegarde reprise ne rejoue rien ; sinon, seules les répliques de
    // moins de REPLIQUE_FRAICHE secondes sont dites — un invité qui rejoint
    // (ou recharge sa page) à la 20e minute n'a pas à subir tout le récit
    // d'un coup, mais celui qui arrive au lancement entend l'introduction.
    _dlgLu=0;
    if(_scnReprise) _dlgLu=G.scn.dlg.length;
    else while(_dlgLu<G.scn.dlg.length&&G.scn.dlg[_dlgLu].t<G.gameTime-REPLIQUE_FRAICHE) _dlgLu++;
    _scnReprise=false;
    const b=document.getElementById('zobjectifs'); if(b) b.style.display='';
  }
  if(G.scn.seq!==_scnVu){
    _scnVu=G.scn.seq;
    dessinerObjectifs();
    const def=missionCourante();
    for(;_dlgLu<G.scn.dlg.length;_dlgLu++){
      const e=G.scn.dlg[_dlgLu];
      if(!destinataireLocal(e.d)) continue;
      for(const l of ((def.dialogues&&def.dialogues[e.k])||[])) _fileRepliques.push(l);
    }
  }
  avancerRepliques();
}
function dessinerObjectifs(){
  const el=document.getElementById('objpanel'), def=missionCourante();
  if(!el||!def) return;
  if(!_objOuvert){ el.style.display='none'; return; }
  const ico={actif:'☐',fait:'✓',echec:'✗'};
  const lignes=(def.objectifs||[]).filter(o=>G.scn.obj[o.id]&&G.scn.obj[o.id]!=='cache')
    .sort((a,b)=>(a.type==='secondaire')-(b.type==='secondaire'))
    .map(o=>{
      const st=G.scn.obj[o.id];
      const cls=['op-ligne',st==='fait'?'fait':st==='echec'?'echec':'',o.type==='secondaire'?'sec':'',o.zone?'zone':''].join(' ');
      const clic=o.zone?` onclick="centrerObjectif('${o.id}')"`:'';
      // L'avancement vient de l'état répliqué (voir `compte` dans majScenario) :
      // des nombres, vérifiés, jamais du texte reçu.
      const pr=st==='actif'&&G.scn.prog&&G.scn.prog[o.id];
      const av=Array.isArray(pr)&&isFinite(pr[0])&&isFinite(pr[1])?` <span class="op-prog">${pr[0]|0}/${pr[1]|0}</span>`:'';
      return `<div class="${cls}"${clic}>${ico[st]||'☐'} ${o.type==='secondaire'?'◇ ':''}${echapHTML(o.txt)}${av}</div>`;
    });
  el.innerHTML=`<div class="op-titre"><span>📜 ${echapHTML(def.titre)}</span><button type="button" onclick="basculerObjectifs()" title="Masquer (O)">–</button></div>`+lignes.join('');
  el.style.display='flex';
}
function basculerObjectifs(){
  if(!G.mission) return;
  _objOuvert=!_objOuvert;
  dessinerObjectifs();
}
function centrerObjectif(id){
  const o=objectifDef(id); const zn=o&&o.zone?zoneMission(o.zone):null;
  if(zn) camCenterOn(zn.x,zn.y);
}
// Une réplique reste affichée le temps de la lire (≈ 15 caractères par
// seconde, bornée), ou jusqu'au clic. Temps RÉEL, pas temps de jeu : on lit
// au même rythme en ×2.
function dureeReplique(txt){ return Math.max(3500,Math.min(9000,1800+String(txt).length*65)); }
function avancerRepliques(){
  const el=document.getElementById('dlgbandeau');
  if(!el) return;
  const maintenant=(typeof performance!=='undefined'?performance.now():Date.now());
  if(_repliqueFin&&maintenant<_repliqueFin) return;
  if(!_fileRepliques.length){
    if(_repliqueFin){ el.style.display='none'; _repliqueFin=0; }
    return;
  }
  const [qui,txt]=_fileRepliques.shift();
  const def=missionCourante();
  const o=(def&&def.orateurs&&def.orateurs[qui])||{nom:qui,ico:'💬'};
  el.innerHTML=`<span class="dl-ico">${o.ico}</span><span><span class="dl-nom">${echapHTML(o.nom)}</span>`
    +`<span class="dl-txt">${echapHTML(txt)}</span>`
    +(_fileRepliques.length?`<span class="dl-suite">Toucher pour la suite (${_fileRepliques.length})</span>`:'')+`</span>`;
  el.style.display='flex';
  _repliqueFin=maintenant+dureeReplique(txt);
}
function repliqueSuivante(){ _repliqueFin=1; avancerRepliques(); }
Object.assign(window,{basculerObjectifs,centrerObjectif,repliqueSuivante});

// Marqueurs sur la mini-carte : les objectifs actifs qui ont une zone, et ce
// que la mission a marqué (M.marquer). Un anneau qui pulse, pour se voir sur
// une forêt comme sur l'inexploré.
function dessinerMarquesMinimap(ctx,scx,scy,K){
  if(!G.mission||!G.scn) return;
  const def=missionCourante(); if(!def) return;
  const pts=[];
  for(const o of (def.objectifs||[])) if(o.zone&&G.scn.obj[o.id]==='actif'){ const zn=zoneMission(o.zone); if(zn) pts.push(zn); }
  for(const m of (G.scn.marques||[])) pts.push(m);
  if(!pts.length) return;
  const t=((typeof performance!=='undefined'?performance.now():Date.now())%1400)/1400;
  for(const p of pts){
    const x=(p.tx+0.5)*BASE_TILE*scx, y=(p.ty+0.5)*BASE_TILE*scy;
    ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.lineWidth=2.6*K;
    ctx.beginPath(); ctx.arc(x,y,(3+t*4)*K,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle=`rgba(255,215,90,${1-t*0.7})`; ctx.lineWidth=1.3*K;
    ctx.beginPath(); ctx.arc(x,y,(3+t*4)*K,0,Math.PI*2); ctx.stroke();
  }
}

