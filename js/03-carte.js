'use strict';
// ======================================================================
//  03-carte.js
// ======================================================================
// Carte : generation, deplacement naval, points d'interet, grille
// spatiale, index id -> entite, brouillard de guerre.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── GÉNÉRATION DE LA CARTE ────────────────────────────────
// Toute la disposition ci-dessous a été calibrée pour une carte de 60×60.
// SC() remet à l'échelle chaque décalage/rayon fixe proportionnellement à
// la taille réelle de la carte (COLS/ROWS) — indispensable pour agrandir
// la carte sans que tout se retrouve tassé dans un coin. Les expressions
// qui référencent déjà COLS/ROWS (COLS>>1, COLS-8…) restent telles quelles :
// elles sont déjà proportionnelles.
// COLS/ROWS n'étant plus constants (la taille se choisit sur l'écran-titre,
// voir TAILLES), l'échelle est RELUE à chaque appel : figée dans une const au
// chargement, elle serait restée celle de la taille par défaut et une carte
// « Petite » aurait gardé les décalages d'une carte 240×240.
const SC = n => Math.round(n*(COLS/60));
// Graine choisie par le joueur (champ de l'écran-titre) ou imposée par
// l'hôte en multijoueur ; null = tirage aléatoire à chaque partie.
let grainePartie=null;
// Générateur de la CARTE uniquement. Distinct de celui du pixel art (srnd
// est aussi utilisé par l'atlas) pour qu'un changement de zoom, qui régénère
// les sprites, ne décale jamais la suite aléatoire du terrain.
let RND=Math.random;

// ── EMPLACEMENTS DE DÉPART DES FACTIONS HUMAINES ──────────
// Un seul joueur démarre au centre, comme depuis toujours. Dès qu'un second
// humain existe, les départs se répartissent sur un ANNEAU centré sur la
// carte, à un angle tiré de la graine — le principe d'Age of Empires II.
//
// Ce que ça remplace : deux ancrages fixes, toujours les mêmes (coin haut
// gauche et coin bas droit). La partie en ligne se rejouait donc à
// l'identique d'une graine à l'autre, chacun sachant d'avance où chercher
// l'autre. L'anneau garde la seule propriété qui compte — les camps sont à
// égale distance du centre, donc des mêmes ressources centrales — et rend
// l'orientation imprévisible.
//
// Deux ALLIÉS (mode coopératif) sont posés côte à côte plutôt qu'aux
// antipodes : s'entraider est le sens même du mode, une demi-carte d'écart
// le rendrait impraticable.
//
// Entièrement déterministe (graine + nombre de joueurs), et tiré d'un
// générateur DISTINCT de RND : ajouter un tirage à la suite du terrain
// décalerait toute la carte, et l'hôte comme le client doivent obtenir
// exactement les mêmes départs.
const DEPART_RAYON = 0.38;  // fraction du côté de la carte
const DEPART_ALLIES = 0.5;  // écart angulaire entre deux alliés (radians)
// srnd est un générateur de Lehmer : sa PREMIÈRE valeur est (graine×16807)
// modulo 2^31-1, c'est-à-dire une fonction quasi affine de la graine. Deux
// graines voisines (11 et 22, ce que tape un joueur qui essaie « une autre
// carte ») en sortent donc à 0,0005 radian l'une de l'autre — soit très
// exactement le même angle de départ. Le générateur de la carte ne souffre
// pas de ce défaut parce qu'il tire des milliers de fois ; ici on ne tire
// qu'UNE fois, il faut donc brasser la graine avant.
function melangerGraine(n){
  let h=n>>>0;
  h=Math.imul(h^(h>>>16),0x2c1b3c6d)>>>0;
  h=Math.imul(h^(h>>>13),0x297a2d39)>>>0;
  h=(h^(h>>>16))>>>0;
  return h%2147483646+1;
}
function departsHumains(){
  const humains=factionsHumaines();
  const h=Math.max(1,humains.length);
  const cx=(COLS>>1)-1, cy=(ROWS>>1)-1;
  if(h<2) return [[cx,cy]];
  const rnd=srnd(melangerGraine(G.seed^0x6d2b79f5));
  const a0=rnd()*Math.PI*2;
  const R=Math.min(COLS,ROWS)*DEPART_RAYON;
  const allies=humains.every(f=>f.equipe===humains[0].equipe);
  const pas=allies?DEPART_ALLIES:(Math.PI*2/h);
  const m=SC(8);                            // marge au bord, proportionnelle
  const borne=v=>Math.max(m,Math.min(COLS-m-2,Math.round(v)));
  const out=[];
  for(let i=0;i<h;i++){
    const a=a0+i*pas;
    out.push([borne(cx+Math.cos(a)*R), borne(cy+Math.sin(a)*R)]);
  }
  return out;
}

// L'anneau ne connaît pas le terrain : son point peut tomber en plein lac.
// On glisse alors vers la case libre la plus proche, en carrés concentriques
// — ordre de parcours fixe, donc même résultat des deux côtés du réseau.
function departLibre(tx,ty,w,h){
  const libre=(x,y)=>{
    if(x<1||y<1||x+w>=COLS-1||y+h>=ROWS-1) return false;
    for(let dy=-1;dy<=h;dy++) for(let dx=-1;dx<=w;dx++)
      if(G.bmap[y+dy][x+dx]!==0) return false;
    return true;
  };
  if(libre(tx,ty)) return [tx,ty];
  for(let r=1;r<=40;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      if(libre(tx+dx,ty+dy)) return [tx+dx,ty+dy];
    }
  }
  return [tx,ty];  // carte pathologique : on garde l'ancre plutôt que rien
}
function resoudreDeparts(){
  const d=BDEF[BT.TC];
  return departsHumains().map(([tx,ty])=>departLibre(tx,ty,d.w,d.h));
}

function genMap() {
  invalidateTerrainChunks(); // les pavés en cache décrivent l'ancienne carte
  _mmFondVer=-1;             // idem pour le fond de mini-carte
  RND=srnd(G.seed);
  const t=[], b=[];
  for(let y=0;y<ROWS;y++){t[y]=[];b[y]=[];for(let x=0;x<COLS;x++){t[y][x]=T_GRASS;b[y][x]=0;}}
  G.tiles=t; G.bmap=b;
  initFog(); // un calque de brouillard par faction humaine

  // Lacs répartis sur toute la carte. Le RAYON suit le preset (voir CARTES) :
  // agrandir les lacs plutot que d'en ajouter garde la sequence de tirages
  // RND identique d'un preset a l'autre, donc le determinisme partage.
  const mLac=cM('lacs');
  const lakes=[[SC(3),SC(3),SC(2)],[COLS-SC(4),SC(3),SC(2)],[SC(3),ROWS-SC(4),SC(2)],[COLS-SC(4),ROWS-SC(4),SC(2)],
               [COLS>>1,SC(8),SC(2)],[COLS>>1,ROWS-SC(9),SC(2)],
               [SC(10),ROWS>>1,SC(1)],[COLS-SC(11),ROWS>>1,SC(1)]]
              .map(([cx,cy,r])=>[cx,cy,Math.max(1,Math.round(r*mLac))]);
  for(const[cx,cy,r] of lakes){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      const x=cx+dx,y=cy+dy;
      if(x>=0&&y>=0&&x<COLS&&y<ROWS){t[y][x]=T_WATER;b[y][x]=3;}
    }
  }

  // Emplacements de départ des humains, arrêtés ICI : les lacs sont creusés
  // (donc on peut s'en écarter) et les ressources ne sont pas encore semées
  // (donc on peut réserver la place). Ils sont mémorisés dans G.departs, que
  // startGame() lit ensuite pour poser les Centres Villes.
  G.departs=resoudreDeparts();

  // Réserve l'emplacement de CHAQUE Centre Ville de départ (+ 1 case de
  // marge) AVANT de semer les ressources. Sans ça, un gisement peut tomber
  // pile sous le futur Centre Ville et devenir à jamais inaccessible une
  // fois celui-ci posé (les bâtiments bloquent désormais physiquement le
  // passage — voir placeBuilding). La réservation ne couvrait que le centre
  // de la carte : en multijoueur, où plus personne ne démarre au centre,
  // elle protégeait un emplacement que personne n'occupait et laissait les
  // deux vraies bases se faire ensevelir. Marque temporaire (9), nettoyée
  // après la pose réelle des Centres Villes dans startGame().
  {
    const tcW=BDEF[BT.TC].w, tcH=BDEF[BT.TC].h;
    for(const [rsX,rsY] of G.departs){
      for(let y=rsY-1;y<=rsY+tcH;y++) for(let x=rsX-1;x<=rsX+tcW;x++){
        if(x>=0&&y>=0&&x<COLS&&y<ROWS&&b[y][x]===0) b[y][x]=9;
      }
    }
  }

  G.nodes=[];
  // ══ FORÊTS (très denses, partout sur la carte) ══
  place(SC(5),SC(5),SC(5),22,RT.TREE,380);   place(COLS-SC(8),SC(5),SC(5),22,RT.TREE,380);
  place(SC(5),ROWS-SC(9),SC(5),22,RT.TREE,360);  place(COLS-SC(8),ROWS-SC(9),SC(5),22,RT.TREE,360);
  place(SC(18),SC(16),SC(6),20,RT.TREE,340); place(COLS-SC(18),ROWS-SC(16),SC(6),20,RT.TREE,340);
  place(COLS>>1,SC(6),SC(5),18,RT.TREE,320); place(COLS>>1,ROWS-SC(8),SC(5),18,RT.TREE,320);
  place(SC(6),ROWS>>1,SC(5),18,RT.TREE,320); place(COLS-SC(8),ROWS>>1,SC(5),18,RT.TREE,320);
  place(COLS>>1,ROWS>>1,SC(7),22,RT.TREE,360); // grande forêt centrale
  place(SC(14),SC(36),SC(5),16,RT.TREE,300); place(COLS-SC(16),SC(24),SC(5),16,RT.TREE,300);
  place(SC(28),SC(8),SC(4),14,RT.TREE,280);  place(COLS-SC(30),ROWS-SC(10),SC(4),14,RT.TREE,280);
  place(SC(8),SC(42),SC(4),12,RT.TREE,270);  place(COLS-SC(10),SC(18),SC(4),12,RT.TREE,270);
  // ══ PIERRES (abondantes) ══
  place(SC(10),SC(18),SC(3),10,RT.STONE,600); place(COLS-SC(12),SC(18),SC(3),10,RT.STONE,600);
  place(COLS>>1,ROWS-SC(10),SC(4),10,RT.STONE,700); place(COLS>>1,SC(12),SC(3),9,RT.STONE,560);
  place(SC(8),ROWS-SC(14),SC(3),9,RT.STONE,540); place(COLS-SC(10),ROWS-SC(14),SC(3),9,RT.STONE,540);
  place(COLS>>1,ROWS>>1,SC(4),8,RT.STONE,620); // carrière centrale
  place(SC(20),ROWS>>1,SC(3),7,RT.STONE,500); place(COLS-SC(22),ROWS>>1,SC(3),7,RT.STONE,500);
  place(COLS>>1,ROWS>>1-SC(10),SC(2),6,RT.STONE,480); place(COLS>>1,ROWS>>1+SC(10),SC(2),6,RT.STONE,480);
  // ══ OR (récompense l'exploration) ══
  place(SC(12),ROWS-SC(16),SC(2),8,RT.GOLD,550); place(COLS-SC(14),ROWS-SC(16),SC(2),8,RT.GOLD,550);
  place(COLS>>1,SC(10),SC(2),7,RT.GOLD,600); place(SC(4),ROWS>>1,SC(2),7,RT.GOLD,520);
  place(COLS-SC(6),ROWS>>1,SC(2),7,RT.GOLD,520); place(COLS>>1,ROWS-SC(6),SC(2),7,RT.GOLD,580);
  place(SC(14),SC(10),SC(2),6,RT.GOLD,480);  place(COLS-SC(16),ROWS-SC(12),SC(2),6,RT.GOLD,480);
  place(COLS>>1,ROWS>>1,SC(1),5,RT.GOLD,640); // filons centraux précieux
  // ══ BAIES (nourriture abondante en début de partie) ══
  place(SC(16),SC(22),SC(3),9,RT.BERRY,320); place(SC(22),SC(16),SC(3),9,RT.BERRY,320);
  place(COLS-SC(18),SC(22),SC(3),8,RT.BERRY,300); place(SC(22),ROWS-SC(18),SC(3),8,RT.BERRY,300);
  place(COLS>>1,ROWS>>1-SC(5),SC(3),7,RT.BERRY,340); // baies centrales
  place(COLS>>1,ROWS>>1+SC(5),SC(3),7,RT.BERRY,340);
  place(SC(8),SC(8),SC(2),6,RT.BERRY,280);   place(COLS-SC(10),ROWS-SC(10),SC(2),6,RT.BERRY,280);
  place(COLS-SC(20),SC(8),SC(2),5,RT.BERRY,260); place(SC(10),ROWS-SC(10),SC(2),5,RT.BERRY,260);

  // Reliques : générées AVANT spawnPOIs pour rester à un point fixe de la
  // séquence RND (déterminisme partagé hôte/client — voir construireSnap,
  // seul r.bankedBy voyage sur le réseau, jamais la position).
  genRelics();
  // Gibier : même logique de déterminisme (position tirée de la graine,
  // seuls PV et mise à mort voyagent sur le réseau — voir construireDelta).
  genWildlife();
  // Poissons : nœuds ordinaires (comme le gibier abattu, RT.MEAT) mais posés
  // directement sur l'eau — aucune synchronisation réseau supplémentaire,
  // ils voyagent déjà comme n'importe quel gisement (voir construireDelta,
  // section "Gisements entames").
  genFish();

  // Points d'intérêt : filons infinis gardés. Réservés au mode Survie — leurs
  // garnisons ne ciblent que le joueur (voir updateEnemyAI), elles fausseraient
  // donc le duel en Conquête en n'inquiétant jamais l'adversaire.
  if(G.gmode==='survival') spawnPOIs();
}

// Quelques reliques dispersées sur la carte, à l'écart du centre (où les
// bases démarrent) et suffisamment éloignées les unes des autres. Un Moine
// qui en approche peut la porter jusqu'à son Monastère (voir doRelic) pour
// un revenu passif en or (voir updateRelicIncome) — jamais épuisée, jamais
// reprise une fois livrée (contrairement à AoE2, pas de vol de relique en v1).
const RELIC_COUNT = 5;
function genRelics(){
  G.relics=[];
  const centerX=(COLS>>1)*BASE_TILE, centerY=(ROWS>>1)*BASE_TILE;
  let tries=0;
  while(G.relics.length<RELIC_COUNT&&tries<500){
    tries++;
    const x=1+Math.floor(RND()*(COLS-2)), y=1+Math.floor(RND()*(ROWS-2));
    if(G.bmap[y][x]!==0) continue;
    const wx=x*BASE_TILE+BASE_TILE/2, wy=y*BASE_TILE+BASE_TILE/2;
    if(Math.hypot(wx-centerX,wy-centerY)<SC(10)*BASE_TILE) continue; // pas trop près du centre
    if(G.relics.some(r=>Math.hypot(r.x-wx,r.y-wy)<SC(14)*BASE_TILE)) continue; // dispersion
    G.relics.push({id:G.nid++, tx:x, ty:y, x:wx, y:wy, carrier:null, bankedBy:null});
  }
}

// Gibier sauvage : cerfs et sangliers dispersés sur la carte, chassables
// (voir ORD.CHASSER/doHunt) pour un gros bonus ponctuel de nourriture — un
// « corpse pile » réutilise directement le système de gisements (RT.MEAT,
// voir GRATE/findDropoff) une fois l'animal abattu (voir killWildlife).
const WILDLIFE_DEF = {
  deer: { nom:'Cerf',     ico:'🦌', hp:30, food:150, counter:0 },
  boar: { nom:'Sanglier', ico:'🐗', hp:80, food:280, counter:3 }, // riposte tant qu'il est vivant
};
const WILDLIFE_COUNT = { deer:8, boar:5 };
function genWildlife(){
  G.wildlife=[];
  for(const [type,count] of Object.entries(WILDLIFE_COUNT)){
    const def=WILDLIFE_DEF[type];
    let placed=0, tries=0;
    while(placed<count&&tries<300){
      tries++;
      const x=1+Math.floor(RND()*(COLS-2)), y=1+Math.floor(RND()*(ROWS-2));
      if(G.bmap[y][x]!==0) continue;
      const wx=x*BASE_TILE+BASE_TILE/2, wy=y*BASE_TILE+BASE_TILE/2;
      if(G.wildlife.some(w=>Math.hypot(w.x-wx,w.y-wy)<SC(6)*BASE_TILE)) continue; // pas les uns sur les autres
      G.wildlife.push({id:G.nid++, type, tx:x, ty:y, x:wx, y:wy, hp:def.hp, maxHp:def.hp});
      placed++;
    }
  }
}
// Bancs de poissons : posés directement sur des tuiles d'eau (T_WATER),
// jamais épuisés trop vite (gros stock — une seule Barque doit pouvoir en
// vivre un moment). Un lac est un disque plein (voir les cercles semés en
// tête de genMap) donc convexe : une Barque peut le rejoindre en ligne
// droite depuis n'importe quel Quai bordant le MÊME lac sans jamais
// traverser la terre (voir advanceNaval).
const FISH_COUNT = 14, FISH_STOCK = 400;
function genFish(){
  const cible=Math.max(1,Math.round(FISH_COUNT*cM('poissons')));
  let placed=0, tries=0;
  while(placed<cible&&tries<600*cM('poissons')){
    tries++;
    const x=1+Math.floor(RND()*(COLS-2)), y=1+Math.floor(RND()*(ROWS-2));
    if(G.tiles[y][x]!==T_WATER) continue;
    const wx=x*BASE_TILE+BASE_TILE/2, wy=y*BASE_TILE+BASE_TILE/2;
    if(G.nodes.some(n=>n.type===RT.FISH&&Math.hypot(n.x-wx,n.y-wy)<BASE_TILE*3)) continue;
    G.nodes.push({id:G.nid++, type:RT.FISH, tx:x, ty:y, x:wx, y:wy, amt:FISH_STOCK, max:FISH_STOCK, gatherers:[]});
    placed++;
  }
}
// Un animal abattu laisse une dépouille : un nœud de ressource ordinaire
// (RT.MEAT), récolté comme des baies — aucun code de récolte à dupliquer.
function killWildlife(w){
  G.wildlife=(G.wildlife||[]).filter(x=>x.id!==w.id);
  const def=WILDLIFE_DEF[w.type];
  const carcasse={id:G.nid++, type:RT.MEAT, tx:w.tx, ty:w.ty, x:w.x, y:w.y, amt:def.food, max:def.food, gatherers:[]};
  G.nodes.push(carcasse);
  // G.nodes est censé être figé après la génération de carte (voir
  // rebuildIndex : IN n'est reconstruit QUE si la référence du tableau
  // change) — un push() en cours de partie laisserait ce nouveau nœud
  // introuvable par nodeById tant qu'aucune autre unité n'a rejoint entre
  // temps. On l'ajoute donc explicitement à l'index pour rester immédiatement
  // ciblable par une récolte.
  IN.set(carcasse.id,carcasse);
  spawnParts(w.x,w.y,'#8b3a1a',10);
}
// Un moine/villageois/soldat qui chasse : dégâts fixes pour un villageois
// (arme improvisée), ceux de l'unité pour un militaire. Le sanglier riposte
// tant qu'il est vivant ; le cerf ne se défend jamais.
const WILD_VIL_DMG = 4;
function doHunt(u,dt){
  const w=(G.wildlife||[]).find(x=>x.id===u.target);
  if(!w||w.hp<=0){ u.state='idle'; u.target=null; return; }
  const d=Math.hypot(w.x-u.x,w.y-u.y);
  const reach=BASE_TILE*0.9;
  if(d>reach){ u.destX=w.x; u.destY=w.y; moveTo(u,dt,true); return; }
  u.moving=false;
  u.huntCd=(u.huntCd||0)-dt;
  if(u.huntCd<=0){
    u.huntCd=1/((u.atkSpd||1)*(civOf(u.owner).chasseMult||1));   // Mongols : chasse deux fois plus rapide
    const dmg=u.type===UT.VIL?WILD_VIL_DMG:u.atk;
    w.hp=Math.max(0,w.hp-dmg);
    spawnParts(w.x,w.y,'#8b3a1a',3);
    addFText(w.x,w.y-10,`-${dmg}`,'#ff5544');
    const def=WILDLIFE_DEF[w.type];
    if(w.hp<=0){
      killWildlife(w);
      u.state='idle'; u.target=null;
      const fo=fac(u.owner); if(fo) fo.stats.wildlifeHunted++;
      if(estLocal(u)) notify(`${def.ico} ${def.nom} abattu — ${def.food}🍖 à récolter`,'#8fbc44');
    } else if(def.counter>0){
      dealDmg(u,def.counter,null);
    }
  }
}

// ── DÉPLACEMENT NAVAL ────────────────────────────────────────
// Volontairement séparé du pathfinding terrestre (moveTo/advance/wallAt,
// partagés par TOUTES les unités) plutôt que d'y ajouter un domaine
// eau/terre : une Barque ne franchit jamais la moindre côte, et un lac est
// un disque plein donc convexe (voir genFish) — une ligne droite entre deux
// points du même lac reste toujours dans l'eau, aucune recherche de chemin
// n'est nécessaire. `false` = en route, `true` = terre droit devant (arrêt net).
function advanceNaval(u,gx,gy,dt){
  u.destX=gx; u.destY=gy;
  const dx=gx-u.x, dy=gy-u.y, d=Math.hypot(dx,dy);
  if(d<4) return false;
  u.moving=true; u.dir=Math.atan2(dy,dx);
  const spd=u.spd*BASE_TILE*dt;
  const nx=u.x+dx/d*spd, ny=u.y+dy/d*spd;
  const tx=(nx/BASE_TILE)|0, ty=(ny/BASE_TILE)|0;
  if(tx>=0&&ty>=0&&tx<COLS&&ty<ROWS&&G.tiles[ty][tx]===T_WATER){ u.x=nx; u.y=ny; return false; }
  return true;
}
function doFish(u,dt){
  const n=nodeById(u.target);
  if(!n||n.amt<=0){
    if(u.inv>0){ u.dropoff=findDropoff(u); u.state='fishReturn'; return; }
    u.state='idle'; u.target=null; return;
  }
  if(Math.hypot(n.x-u.x,n.y-u.y)>BASE_TILE*0.9){
    if(advanceNaval(u,n.x,n.y,dt)){ u.state='idle'; u.target=null; } // terre entre-temps (banc près de la rive) : abandonne proprement
    return;
  }
  u.moving=false;
  u.gTimer=(u.gTimer||0)+dt*gatherMult(u.owner);
  if(u.gTimer>=1/GRATE[RT.FISH]){
    u.gTimer=0;
    const a=Math.min(1,n.amt); n.amt-=a; u.inv=(u.inv||0)+a; u.invT=RT.FISH;
    if(u.inv>=gatherCap(u.owner)){ u.dropoff=findDropoff(u); u.state='fishReturn'; }
  }
}
// Déplacement libre d'une Barque (pas de récolte en cours) : arrêt net à la
// côte plutôt que de se laisser glisser sur la terre via le déplacement
// terrestre partagé (voir la note sur wallAt/"déjà dans un mur" en tête
// d'advanceNaval — une Barque est TOUJOURS considérée "dans un mur" du
// point de vue du pathfinding terrestre puisqu'elle vit sur l'eau).
function doSail(u,dt){
  if(advanceNaval(u,u.destX,u.destY,dt)) u.state='idle';
  else if(Math.hypot(u.destX-u.x,u.destY-u.y)<4) u.state='idle';
}
function doFishReturn(u,dt){
  const b=bldById(u.dropoff);
  if(!b){ u.dropoff=findDropoff(u); if(!u.dropoff){u.state='idle';return;} return; }
  const d=Math.hypot(b.x-u.x,b.y-u.y);
  // Le Quai est planté sur la terre (seule son emprise touche l'eau, voir
  // hasAdjacentWater) : son CENTRE n'est jamais atteignable en bateau. Une
  // Barque livre donc dès qu'elle touche le rivage assez près du Quai —
  // "bloqué par la côte" vaut accostage, pas échec — et n'abandonne que
  // si la côte qui la bloque est trop loin pour être celle du bon Quai.
  if(d>bldContact(b,0.5)){
    const blockedByShore=advanceNaval(u,b.x,b.y,dt);
    if(!blockedByShore) return; // encore en route sur l'eau libre
    if(d>BASE_TILE*2.6){ u.state='idle'; return; } // rivage sans rapport avec ce Quai
    // sinon : assez près, on livre quand même malgré la côte qui bloque la ligne droite vers le centre
  }
  u.moving=false;
  const pool=resPool(u.owner);
  if(pool) pool.food+=u.inv;
  const fg=fac(u.owner); if(fg) fg.stats.gathered.food+=u.inv;
  if(estLocal(u)){ addFText(b.x,b.y-16,`+${u.inv}`,'#e8d5a0'); G.rateAcc.food=(G.rateAcc.food||0)+u.inv; sfx('drop'); }
  u.inv=0; u.invT=null;
  const orig=nodeById(u.target);
  if(orig&&orig.amt>0) u.state='fish';
  else { u.state='idle'; u.target=null; }
}

// `cnt` est le nombre de gisements TENTES ; le preset de carte le module par
// type (voir CARTES). On le fait ICI, en un seul point, plutot que sur les
// quarante appels de genMap : le nombre de tirages RND change avec le preset,
// mais reste identique pour un meme preset et une meme graine — c'est ce
// couple-la qui doit etre deterministe, pas la comparaison entre presets.
const CARTE_CLE_RES={ [RT.TREE]:'foret', [RT.GOLD]:'or', [RT.STONE]:'pierre', [RT.BERRY]:'baies' };
// Le nombre de gisements suit aussi la TAILLE de la carte, linéairement (et
// non selon la surface) : SC() écarte déjà les gisements les uns des autres
// quand la carte grandit, et n'ajouter aucun gisement en plus aurait fait
// d'une grande carte un désert qu'on traverse sans rien trouver. Le facteur
// vaut exactement 1 à 240 cases de côté : la carte historique ne bouge pas
// d'un gisement.
function place(cx,cy,rx,cnt,type,amt){
  const cle=CARTE_CLE_RES[type];
  if(cle) cnt=Math.max(1,Math.round(cnt*cM(cle)));
  cnt=Math.max(1,Math.round(cnt*(COLS/240)));
  for(let i=0;i<cnt;i++){
    const a=RND()*Math.PI*2, d=RND()*rx;
    const x=Math.round(cx+Math.cos(a)*d), y=Math.round(cy+Math.sin(a)*d);
    if(x>=1&&y>=1&&x<COLS-1&&y<ROWS-1&&G.bmap[y][x]===0){
      G.bmap[y][x]=2;
      const a2=Math.round(amt*NODE_RICHNESS);
      G.nodes.push({id:G.nid++,type,tx:x,ty:y,x:x*BASE_TILE+BASE_TILE/2,y:y*BASE_TILE+BASE_TILE/2,amt:a2,max:a2,gatherers:[]});
    }
  }
}

// ── POINTS D'INTÉRÊT : filons infinis gardés ──────────────
// Un filon d'or qui ne s'épuise jamais (voir doGather), posté aux quatre
// coins de la carte et défendu par une garnison ennemie permanente + des
// tours de guet — indépendant du système de vagues (u.camp les exclut de
// la détection de fin de vague, voir updateWaves). Récompense l'exploration
// et l'offensive : l'or y coule à volonté pour qui ose nettoyer le camp.
function poiCanPlaceTower(tx,ty){
  const d=BDEF[BT.TOWER];
  if(tx<0||ty<0||tx+d.w>COLS||ty+d.h>ROWS) return false;
  for(let dy=0;dy<d.h;dy++) for(let dx=0;dx<d.w;dx++)
    if(G.bmap[ty+dy][tx+dx]!==0) return false;
  return true;
}
function spawnPOIs(){
  const diff=DIFFS[G.difficulty]||DIFFS.normal;
  const isEasy=G.difficulty==='easy';
  // En Facile, ce mode s'adresse aux débutants : un point d'intérêt ne doit
  // pas y être un mur infranchissable. On adoucit nettement la garnison
  // (effectif ET PV) et on pose des tours moins dangereuses, au-delà du
  // multiplicateur générique enemyCount/enemyHp déjà appliqué aux vagues.
  const campCountMult=isEasy?0.5:1;
  const campHpMult=isEasy?0.55:1;
  const towerLevel=isEasy?2:3;
  // Emplacements aux quatre coins, à ~23% du bord (donc ~77% du centre) —
  // proportionnel à COLS/ROWS via SC(), et laisse une immense marge avec le
  // camp de départ (toujours au centre) quelle que soit la taille de carte.
  const spots=[[SC(14),SC(14)],[COLS-SC(15),SC(14)],[SC(14),ROWS-SC(15)],[COLS-SC(15),ROWS-SC(15)]];
  let camp=0;
  G.campTotal=0; // nombre de camps réellement posés — référence du succès « Nettoyeur »
  for(const[cx,cy] of spots){
    camp++;
    // gisement d'or inépuisable
    const before=G.nodes.length;
    place(cx,cy,3,9,RT.GOLD,600);
    if(G.nodes.length===before) continue; // aucune case libre ici (relief/eau) : on saute ce camp
    for(let i=before;i<G.nodes.length;i++) G.nodes[i].infinite=true;
    G.campTotal++;

    // tours de guet encadrant le filon (Donjon niv.3, ou Tour de Garde niv.2 en Facile)
    for(const[ox,oy] of [[-5,-2],[5,2]]){
      let tx=cx+ox, ty=cy+oy;
      for(let tries=0;tries<14;tries++){
        if(poiCanPlaceTower(tx,ty)){
          const tw=mkBuilding(BT.TOWER,tx,ty,FAC.PILL);
          tw.level=towerLevel;
          tw.hp=tw.maxHp=Math.round(BDEF[BT.TOWER].hp*TOWER_LEVELS[towerLevel].hpMult);
          placeBuilding(tw);
          break;
        }
        tx+=(RND()<0.5?1:-1); ty+=(RND()<0.5?1:-1);
      }
    }

    // garnison mixte, nettement plus robuste qu'une vague de début de partie
    // (sauf en Facile, où elle est délibérément adoucie — voir plus haut)
    const campWX=cx*BASE_TILE+BASE_TILE/2, campWY=cy*BASE_TILE+BASE_TILE/2;
    const n=Math.max(4,Math.round(11*diff.enemyCount*campCountMult));
    const comp=[[UT.ENEMI,Math.ceil(n*0.4)],[UT.ENEMIA,Math.ceil(n*0.25)],
                [UT.ENEMI_C,Math.ceil(n*0.25)],[UT.ENEMI_G,Math.max(1,Math.round(n*0.1))]];
    for(const[type,count] of comp){
      for(let i=0;i<count;i++){
        let x,y,tries=0;
        do{
          const a=RND()*Math.PI*2, r=1+RND()*4;
          x=(cx+Math.cos(a)*r)*BASE_TILE+BASE_TILE/2; y=(cy+Math.sin(a)*r)*BASE_TILE+BASE_TILE/2;
        } while(++tries<20 && tileBlocked((x/BASE_TILE)|0,(y/BASE_TILE)|0));
        const u=mkUnit(type,x,y,FAC.PILL);
        u.hp=Math.round(u.hp*2.0*campHpMult*diff.enemyHp); u.maxHp=u.hp;
        u.atk=Math.round(u.atk*1.5*diff.enemyAtk);
        u.camp=camp; // exclu des vagues (updateWaves) — garde permanente
        // Point de garde : la garnison ne réagit qu'aux intrus proches de
        // CE point (voir updateEnemyAI), pas à tout le reste de la carte,
        // et y retourne une fois le combat terminé.
        u.campX=campWX; u.campY=campWY;
        G.units.push(u);
      }
    }
  }
}

// ── GRILLE SPATIALE (perf sur grande carte) ───────────────
const GRID_SZ=200; // px monde par cellule
let grid=new Map();
// Clé entière : la concaténation de chaînes allouait une clé par cellule et
// par requête, plusieurs milliers de fois par seconde.
const GRID_OFF=1024;
function gridKey(x,y){ return (((x/GRID_SZ)|0)+GRID_OFF)*4096 + (((y/GRID_SZ)|0)+GRID_OFF); }
function rebuildGrid(){
  grid.clear();
  for(const u of G.units){
    // Une unité en garnison est retirée de la grille spatiale : ni ciblable
    // ni détectable par les recherches de proximité (forNearby/nearestBy),
    // sans quoi elle resterait attaquable alors qu'elle est censée être à
    // l'abri à l'intérieur du bâtiment.
    if(u.state==='garrison') continue;
    const k=gridKey(u.x,u.y);
    const cell=grid.get(k);
    if(cell) cell.push(u); else grid.set(k,[u]);
  }
  rebuildIndex();
}

// ── INDEX id → entité ──────────────────────────────────────
// Les boucles de jeu résolvaient leurs cibles par G.xxx.find(), soit un
// balayage linéaire PAR UNITÉ ET PAR IMAGE (~400 gisements × N villageois).
// Une Map reconstruite une fois par image ramène ça à un accès direct.
let IU=new Map(), IB=new Map(), IN=new Map(), _nodesRef=null;
function rebuildIndex(){
  IU.clear(); for(const u of G.units) IU.set(u.id,u);
  IB.clear(); for(const b of G.buildings) IB.set(b.id,b);
  // les gisements ne sont jamais retirés du tableau : on ne réindexe que si
  // le tableau lui-même a changé (nouvelle partie ou chargement).
  if(_nodesRef!==G.nodes){ IN.clear(); for(const nd of G.nodes) IN.set(nd.id,nd); _nodesRef=G.nodes; }
}
const unitById =id=>IU.get(id);
const bldById  =id=>IB.get(id);
const nodeById =id=>IN.get(id);
// Variante sans allocation : les recherches de cible tournent pour CHAQUE unité
// à chaque image ; construire un tableau intermédiaire y coûtait plus cher que
// le test de distance lui-même.
function forNearby(x,y,r,fn){
  const cr=Math.ceil(r/GRID_SZ);
  const cx=(x/GRID_SZ)|0, cy=(y/GRID_SZ)|0;
  for(let dy=-cr;dy<=cr;dy++) for(let dx=-cr;dx<=cr;dx++){
    const cell=grid.get(((cx+dx)+GRID_OFF)*4096+((cy+dy)+GRID_OFF));
    if(cell) for(let i=0;i<cell.length;i++) fn(cell[i]);
  }
}
// Recherche générique : plus proche dans le rayon, filtrée par prédicat
function nearestBy(x,y,r,pred){
  let best=null,bd=r*r;
  forNearby(x,y,r,u=>{
    if(!pred(u)) return;
    const dx=u.x-x,dy=u.y-y,d2=dx*dx+dy*dy;
    if(d2<bd){bd=d2;best=u;}
  });
  return best;
}

// ── BROUILLARD DE GUERRE ──────────────────────────────────
// Chaque faction humaine explore sa propre carte : en 1v1, ce que voit
// l'adversaire ne doit rien révéler à l'autre. L'IA et les pillards n'ont
// pas de calque (ils voient tout, comme avant).
// 0 (plein jour) .. 1 (cœur de la nuit) — même courbe que le voile visuel
// (drawNightTint/drawNightGlow) : une seule définition de "à quel point il
// fait nuit", partagée entre l'habillage et le gameplay.
function nightFactor(){ return Math.max(0,Math.sin(G.dayPhase*Math.PI*2-Math.PI/2)); }
// Vision réduite d'un quart au plus noir de la nuit : la carte se rétrécit
// vraiment, pas seulement à l'écran — un raid nocturne peut approcher plus
// près avant d'être repéré.
const VISION_NIGHT_MULT = 0.75;
function revealFog(){
  G.fogVer=(G.fogVer||0)+1; // invalide le fond de mini-carte (voir dessinerFondMinimap)
  const visMult=1-(1-VISION_NIGHT_MULT)*nightFactor();
  for(const f of factionsHumaines()){
    // Le CLIENT d'une partie en ligne n'a qu'une vue partielle des camps
    // adverses : leur calque serait faux, et il n'est de toute facon jamais
    // affiche (le rendu ne lit que celui de G.me). L'HOTE, lui, en a besoin
    // pour filtrer ce qu'il envoie — voir visiblePour().
    if(RESEAU.actif&&RESEAU.role==='client'&&f.id!==G.me) continue;
    const fog=f.fog;
    if(!fog||!fog.length) continue;
    const reveal=(tx,ty,rad)=>{
      for(let dy=-rad;dy<=rad;dy++) for(let dx=-rad;dx<=rad;dx++){
        if(dx*dx+dy*dy>rad*rad) continue;
        const x=tx+dx, y=ty+dy;
        if(x>=0&&y>=0&&x<COLS&&y<ROWS) fog[y][x]=2; // visible
      }
    };
    // Décroît visible -> exploré
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(fog[y][x]===2) fog[y][x]=1;
    for(const u of G.units) if(u.owner===f.id) reveal((u.x/BASE_TILE)|0,(u.y/BASE_TILE)|0, Math.max(2,Math.round((u.type===UT.ARC||u.type===UT.XBOW?7:5)*visMult)));
    for(const b of G.buildings) if(b.owner===f.id){
      const rad=b.type===BT.TOWER||b.type===BT.CASTLE?10:b.type===BT.TC?9:b.type===BT.OUTPOST?8:6;
      reveal((b.tx+b.w/2)|0,(b.ty+b.h/2)|0,Math.max(3,Math.round(rad*visMult)));
    }
  }
}

// Recalcule les positions monde (fixes, indépendantes du zoom) depuis les
// indices de tuile — utilisé à l'initialisation et au chargement d'une
// sauvegarde. N'a plus besoin d'être rejoué au zoom : les coordonnées monde
// ne dépendent plus de TILE (voir BASE_TILE, la constante immuable).
function refreshNodePos(){
  for(const n of G.nodes){ n.x=n.tx*BASE_TILE+BASE_TILE/2; n.y=n.ty*BASE_TILE+BASE_TILE/2; }
  for(const b of G.buildings){ b.x=b.tx*BASE_TILE+b.w*BASE_TILE/2; b.y=b.ty*BASE_TILE+b.h*BASE_TILE/2; }
}
