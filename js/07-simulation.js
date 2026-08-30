'use strict';
// ======================================================================
//  07-simulation.js
// ======================================================================
// Simulation : boucle update, unites, batiments, separation,
// pathfinding, recolte, combat, routes commerciales, reliques, merveille,
// ciblage et vagues.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── LOGIQUE DE JEU ────────────────────────────────────────
let fogTimer=0;
function update(dt){
  G.dt=dt;
  G.gameTime+=dt;
  G.dayPhase=(G.gameTime/90)%1; // cycle de 90s
  _pfFrame=0;               // budget de recherches de chemin pour cette image
  rebuildGrid();
  majHeros();               // recensement unique des héros (voir heroAuraMult)
  updateUnits(dt);
  updateBuildings(dt);
  updateEnemyAI(dt);
  updateAI(dt);           // adversaire du mode Conquête (économie, chantiers, armée)
  // APRÈS tous les déplacements, et pas dans updateUnits : les unités du
  // joueur bougent dans updateUnits, celles de l'IA et des pillards dans
  // updateEnemyAI. Une passe unique en aval traite donc les deux camps —
  // et un chevalier peut être écarté par un pillard, pas seulement par les
  // siens. Ne tourne que chez l'hôte : update() n'est appelé que par lui
  // (voir loop), le client se contente d'interpoler l'état reçu.
  separerUnites(dt);
  updateProjs(dt);
  updateParts(dt);
  updateFTexts(dt);
  updateDeathFx(dt);
  if(G.shake.mag>0) G.shake.mag=Math.max(0,G.shake.mag-dt*14); // secousse de caméra : décroissance rapide
  updateWaves(dt);
  updateAutoSave(dt);
  updateSpriteRebuild(dt);
  updateGlide(dt);
  updateResearchQ(dt);
  updateTradeRoutes(dt);
  updateRelicIncome(dt);
  updateWonders(dt);
  updateAgeUp(dt);
  G.mtTimer=Math.max(0,G.mtTimer-dt);

  // Brouillard rafraîchi 5×/s
  fogTimer-=dt;
  if(fogTimer<=0){ revealFog(); fogTimer=0.2; }

  // Indices contextuels liés au temps plutôt qu'à une construction : la
  // chasse est disponible dès le début, et la garnison mérite un rappel
  // juste avant le premier vrai danger plutôt qu'en pleine mise en place.
  if(G.gameTime>=45) hintOnce('hunt',"🦌 Du gibier sauvage rôde sur la carte : envoyez une unité l'attaquer pour un gros bonus de nourriture.",'#8fbc44');
  if(nightFactor()>0.5) hintOnce('night',"🌙 La nuit tombe : votre champ de vision se réduit jusqu'au lever du jour.",'#7fb8e8');
  if(G.gmode==='survival'&&G.wave===0&&G.waveTimer<=60) hintOnce('garrison',"🏰 Première vague proche : vos villageois peuvent se mettre à l'abri dans le Centre Ville (sélectionnez-les puis tapez le bâtiment).",'#3498db');

  // Suivi du taux de ressources (par 2s)
  G.rateTimer+=dt;
  if(G.rateTimer>=2){
    for(const k of ['food','wood','stone','gold']){
      G.rateShow[k]=Math.round(G.rateAcc[k]/G.rateTimer*10)/10;
      G.rateAcc[k]=0;
    }
    G.rateTimer=0;
  }

  // Pics et jalons de la partie (bilan de fin + succès). Échantillonnés à
  // chaque image plutôt que recalculés en fin de partie : un pic de
  // population ou de fermes ne laisse aucune trace une fois redescendu.
  G.stats.peakPop=Math.max(G.stats.peakPop,G.pop);
  G.statsTick=(G.statsTick||0)-dt;
  if(G.statsTick<=0){
    G.statsTick=1;
    let mil=0, farms=0;
    for(const u of G.units) if(estLocal(u)&&isMilitary(u.type)) mil++;
    for(const b of G.buildings) if(estLocal(b)&&b.type===BT.FARM&&!b.constructing) farms++;
    G.stats.peakMil=Math.max(G.stats.peakMil,mil);
    G.stats.peakFarms=Math.max(G.stats.peakFarms,farms);
    // Camps de points d'intérêt entièrement nettoyés (numérotés à la genèse)
    const alive=new Set();
    for(const u of G.units) if(u.camp&&u.camp!=='ai') alive.add(u.camp);
    G.stats.campsCleared=Math.max(G.stats.campsCleared,(G.campTotal||0)-alive.size);
    checkAchievements();
  }

  // Élimination : une faction sans Centre Ville est hors jeu. On l'annonce
  // une seule fois (f.vaincu), ce qui permet à une partie à trois camps de
  // continuer après la chute du premier.
  for(const f of factionsJouantes()){
    if(f.vaincu) continue;
    if(!G.buildings.find(b=>b.type===BT.TC&&b.owner===f.id)){
      f.vaincu=true;
      if(f.id!==G.me) notify(`💀 ${f.nom} a été éliminé`,'#f0c040');
    }
  }
  // Défaite locale
  if(moi()&&moi().vaincu&&!G.gameOver){ G.gameOver=true; showGameOver(); }
  // Merveille achevée et restée debout assez longtemps : victoire immédiate,
  // quel que soit le mode — vérifiée avant les conditions propres au mode
  // pour ne jamais être masquée par elles.
  checkMerveilleVictory();
  // Victoire — Survie : survivre à targetWaves. Conquête : plus aucun camp
  // hostile debout (la partie n'a alors aucune vague, targetWaves vaut 0,
  // d'où la garde sur le mode : sans elle, Conquête serait gagnée à la
  // 1ère image).
  if(!G.victory&&!G.gameOver){
    if(G.gmode!=='survival'){
      const rivaux=factionsJouantes().filter(f=>f.id!==G.me&&f.equipe!==(moi()?moi().equipe:-1));
      if(rivaux.length&&rivaux.every(f=>f.vaincu)){ G.victory=true; showVictory(); }
    } else if(G.wave>=G.targetWaves&&!G.waveActive){
      G.victory=true; showVictory();
    }
  }
}

// Avancement d'âge — un minuteur PAR CAMP HUMAIN, comme updateResearchQ.
// Il ne lisait que G.ageUpQ, c'est-à-dire la faction LOCALE : en ligne, le
// client avait beau payer sa montée d'âge (l'hôte validait l'ordre et
// prélevait ses ressources), plus personne ne décomptait son minuteur — il
// restait bloqué à 60 s et l'invité finissait la partie à l'Âge Sombre.
// Les IA gardent leur propre chemin (a.ageQ, voir updateAI).
function updateAgeUp(dt){
  for(const f of factionsHumaines()) updateAgeUpFaction(dt,f);
}
function updateAgeUpFaction(dt,f){ // (auto-sauvegarde déclenchée à la fin du passage d'âge)
  if(!f.ageUpQ) return;
  f.ageUpQ.timer-=dt;
  if(f.ageUpQ.timer>0) return;
  const local=(f.id===G.me), oldAge=f.age;
  f.age++;
  const a=AGES[f.age];
  f.ageUpQ=null;
  // L'habillage (son, bannière, notifications) ne concerne que MON camp ;
  // l'effet de jeu, lui, s'applique à celui qui a payé.
  if(local){
    sfx('age');
    notify(`${a.ico} ${a.nom} atteint !`,'#f0c040');
    notify(`Apporte : ${a.bonus}`,'#e8d5a0',true);
    bigBanner(`${a.ico} ${a.nom}`);
    if(f.age>=3) hintOnce('wonder',"🏛️ Âge Impérial atteint : vous pouvez désormais bâtir une Merveille — la garder debout 5 minutes une fois achevée gagne la partie.",'#d8c078');
  }

  // Recalcule proportionnellement les PV des bâtiments et des unités
  // existants DE CE CAMP (dégâts déjà subis conservés en absolu — même
  // principe que l'amélioration de tour), pour CHAQUE palier. L'ATK
  // militaire suit la même logique.
  const ob=AGE_BONUS[oldAge], nb=AGE_BONUS[f.age];
  for(const b of G.buildings) if(b.owner===f.id){
    const newMax=Math.round(b.maxHp/ob.bldHp*nb.bldHp);
    const dmg=b.maxHp-b.hp;
    b.maxHp=newMax; b.hp=Math.max(1,newMax-dmg);
  }
  for(const u of G.units) if(u.owner===f.id){
    const newMaxHp=Math.round(u.maxHp/ob.unitHp*nb.unitHp);
    const dmg=u.maxHp-u.hp;
    u.maxHp=newMaxHp; u.hp=Math.max(1,newMaxHp-dmg);
    if(isMilitary(u.type)) u.atk=Math.round(u.atk/ob.milAtk*nb.milAtk);
  }
  updatePopCap(); // les Maisons existantes logent aussitôt plus de monde
  if(local) refreshUI();
}

function updateUnits(dt){
  for(const u of G.units){
    u.atkCd=Math.max(0,u.atkCd-dt);
    if(u.pathCd) u.pathCd=Math.max(0,u.pathCd-dt);
    if(u.hitFlash) u.hitFlash=Math.max(0,u.hitFlash-dt);
    const fu=fac(u);
    // Le Moine de l'IA de Conquête réutilise TEL QUEL l'automate du joueur
    // (porter une relique — voir doRelic — ou soigner un allié blessé au
    // repos, voir le cas 'idle'/UT.MONK d'updatePlayerUnit) plutôt qu'une
    // copie : un seul comportement à maintenir pour les deux camps.
    if(fu&&(fu.genre==='humain'||(fu.genre==='ia'&&u.type===UT.MONK))) updatePlayerUnit(u,dt);
    else if(estIA(u)&&u.type===UT.VIL) updateAIVillager(u,dt);
    if(u.moving) u.animT+=dt; // anim de marche uniquement en mouvement
  }
  // Mort
  const dead=G.units.filter(u=>u.hp<=0);
  for(const u of dead){
    G.sel=G.sel.filter(id=>id!==u.id);
    // u.homeNode pointe déjà vers l'UNIQUE nœud dont ce villageois peut être
    // le récolteur (voir doGather) : un balayage de TOUS les gisements de la
    // carte (des centaines, jamais retirés du tableau) pour chaque mort
    // était pur gâchis — le vrai responsable des gros pics observés en
    // pleine bataille, bien plus que la garnison des tours corrigée
    // au-dessus. Un combattant qui n'a jamais récolté a homeNode=null et ne
    // coûte plus rien du tout ici.
    if(u.homeNode!=null){
      const n=nodeById(u.homeNode);
      if(n&&n.gatherers.length) n.gatherers=n.gatherers.filter(id=>id!==u.id);
    }
    spawnParts(u.x,u.y,couleurMinimap(u,true),8);
    G.deathfx.push({type:u.type,x:u.x,y:u.y,dir:u.dir||0,life:1,teinte:(fac(u)||{}).teinte||'rouge'}); // silhouette qui bascule au sol et s'estompe, plutôt qu'une disparition instantanée
    sfx('death');
    const fm=fac(u); if(fm) fm.pop--;
    if(estLocal(u)){ moi().stats.lost++; }
    else {
      // Le kill est crédité à la faction qui a porté le coup fatal.
      const tueur=fac(u.dernierAgresseur);
      if(tueur) tueur.stats.killed++;
      if(u.type===UT.ENEMI_BOSS) G.stats.bossKilled++;
      // Une unité de l'IA de Conquête appartient à une économie réelle : elle
      // compte dans SA population, et ne verse pas de prime au joueur (sans
      // quoi harceler l'adversaire financerait la partie à sa place).
      // (population deja decrementee plus haut, par faction)
      else { // récompense or à la mort d'un pillard de vague
        const bounty=u.type===UT.ENEMI_BOSS?200:u.type===UT.ENEMI_G?15:u.type===UT.ENEMI_C?8:4;
        G.res.gold+=bounty;
        addFText(u.x,u.y-12,`+${bounty}💰`,'#f0c040');
      }
    }
  }
  G.units=G.units.filter(u=>u.hp>0);
}

function updatePlayerUnit(u,dt){
  switch(u.state){
    case 'moving':  moveTo(u,dt); break;
    case 'gather':  doGather(u,dt); break;
    case 'farm':    doFarm(u,dt); break;
    case 'repair':  doRepair(u,dt); break;
    case 'return':  doReturn(u,dt); break;
    case 'build':   doBuild(u,dt); break;
    case 'relic':   doRelic(u,dt); break;
    case 'hunt':    doHunt(u,dt); break;
    case 'fish':       doFish(u,dt); break;
    case 'fishReturn': doFishReturn(u,dt); break;
    case 'sailing':    doSail(u,dt); break;
    case 'attack':  doAttack(u,dt); break;
    case 'amove':   doAMove(u,dt); break;
    case 'heal':    doHeal(u,dt); break;
    case 'idle':
      // Balayer le voisinage à chaque image pour une unité qui ne fait rien
      // coûtait plus cher que tout le reste de la simulation réunie.
      u.scanCd=(u.scanCd||0)-dt;
      if(u.scanCd<=0){
        u.scanCd=0.25+Math.random()*0.15;   // désynchronise les unités entre elles
        if(u.type===UT.MONK){
          const ally=nearInjuredAlly(u.x,u.y,6*BASE_TILE,u.id,u.owner);
          if(ally){u.state='heal';u.target=ally.id;}
        } else if(u.type===UT.VIL){
          if(fac(u)&&fac(u).autoRepair){
            const b=nearestDamagedBuilding(u.x,u.y);
            if(b){ u.state='repair'; u.target=b.id; }
          }
        } else if(u.type!==UT.VIL&&u.type!==UT.BOAT){
          // La Barque (sans combat en v1, voir UDEF[UT.BOAT].naval) ne
          // scanne jamais d'hostile : passer en 'attack' la ferait tenter
          // d'utiliser le déplacement terrestre partagé (doAttack/moveTo),
          // hors de son domaine — voir advanceNaval.
          const st=u.stance||'agg';
          // Tenir position : ne riposte que si l'ennemi entre dans sa portée
          const r=st==='hold'?u.rng+8:st==='def'?u.rng*1.8:u.rng*3.5;
          const e=prochainHostileUnite(u.x,u.y,r,u);
          if(e){u.state='attack';u.target=e.id;}
        }
      }
      break;
  }
}

// Attaque-déplacement : on avance vers un point en engageant ce qu'on croise.
function doAMove(u,dt){
  u.scanCd=(u.scanCd||0)-dt;
  if(u.scanCd<=0){
    u.scanCd=0.25+Math.random()*0.15;
    const e=prochainHostileUnite(u.x,u.y,u.rng*3.5,u);
    if(e){ u.state='attack'; u.target=e.id; return; }
  }
  if(Math.hypot(u.destX-u.x,u.destY-u.y)<BASE_TILE*0.5){
    u.state='idle'; u.amove=null; u.anchorX=u.x; u.anchorY=u.y; return;
  }
  moveTo(u,dt,true);
}

function doHeal(u,dt){
  const _t=unitById(u.target);
  const tgt=(_t&&_t.owner===u.owner&&_t.hp<_t.maxHp)?_t:null; // on ne soigne que les siens
  if(!tgt){u.state='idle';u.target=null;return;}
  const dx=tgt.x-u.x,dy=tgt.y-u.y,d=Math.sqrt(dx*dx+dy*dy);
  if(d>BASE_TILE*2.2){u.destX=tgt.x;u.destY=tgt.y;moveTo(u,dt);return;}
  u.atkCd-=dt;
  if(u.atkCd<=0){
    u.atkCd=1.0;
    const heal=rechercheDe(u.owner).faith?5:3;
    tgt.hp=Math.min(tgt.maxHp,tgt.hp+heal);
    addFText(tgt.x,tgt.y-14,`+${heal}`,'#2ecc71');
    if(tgt.hp>=tgt.maxHp){u.state='idle';u.target=null;}
  }
}

function nearInjuredAlly(x,y,r,selfId,owner=FAC.P1){
  let best=null,bd=r,lowestHp=Infinity;
  for(const u of G.units){
    if(u.owner!==owner||u.hp>=u.maxHp||u.id===selfId) continue;
    const d=Math.hypot(u.x-x,u.y-y);
    if(d<bd&&u.hp<lowestHp){bd=d;best=u;lowestHp=u.hp;}
  }
  return best;
}

// keepState=true : déplacement au service d'une tâche (récolte, dépôt, chantier…)
// sans quoi arriver à destination remettrait l'unité au repos et annulerait la tâche.
function moveTo(u,dt,keepState){
  const dx=u.destX-u.x, dy=u.destY-u.y;
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d<4){
    u.x=u.destX; u.y=u.destY; u.moving=false; u.path=null;
    if(u.pendingAction){const f=u.pendingAction;u.pendingAction=null;f(u);}
    else if(!keepState) u.state='idle';
    return;
  }
  if(advance(u,u.destX,u.destY,dt)){
    const r=requestPath(u);                       // coincé : calculer un contournement
    if(r===false){                                // aucun chemin : on abandonne l'ordre
      u.pathFail=(u.pathFail||0)+1;
      if(u.pathFail>=3){ u.pathFail=0; u.path=null; u.moving=false; if(!keepState) u.state='idle'; }
    } else if(r===true) u.pathFail=0;
  }
}

// Un mur bloque physiquement le passage (bmap===3)
function wallAt(wx,wy){
  const tx=(wx/BASE_TILE)|0, ty=(wy/BASE_TILE)|0;
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS) return false;
  return G.bmap[ty][tx]===3;
}
// Déplacement avec glissement le long des murs ; renvoie true si totalement bloqué
function stepBlocked(u,nx,ny){
  if(wallAt(u.x,u.y)){ u.x=nx; u.y=ny; return false; } // déjà dans un mur : on laisse sortir
  const ox=u.x, oy=u.y;
  if(!wallAt(nx,ny)){ u.x=nx; u.y=ny; }
  else if(!wallAt(nx,oy)){ u.x=nx; }                   // glisse en X
  else if(!wallAt(ox,ny)){ u.y=ny; }                   // glisse en Y
  // bloqué = progrès réel négligeable (sinon l'unité reste collée sans réagir)
  const moved=Math.hypot(u.x-ox,u.y-oy), wanted=Math.hypot(nx-ox,ny-oy);
  return wanted>0.0001 && moved < wanted*0.35;
}

// ── SÉPARATION DES UNITÉS ──────────────────────────────────
// Rien n'empêchait jusqu'ici deux unités d'occuper le même pixel :
// stepBlocked() ne teste que les murs. Quarante chevaliers envoyés sur un
// même point convergeaient donc en UNE SEULE PILE, et formation() n'était
// que cosmétique — la galette s'effondrait dessus dès le premier pas.
//
// Passe DOUCE, appelée une fois par pas de simulation APRÈS tous les
// déplacements (voir update) : chaque unité repousse ses voisines trop
// proches d'un décalage plafonné. Pas de physique, pas d'impulsion
// accumulée d'une image sur l'autre — donc ni vibration ni emballement.
const SEP_R_DEF   = BASE_TILE*0.28;   // demi-écart visé entre deux unités
const SEP_R_SIEGE = BASE_TILE*0.45;   // Bélier / Trébuchet : encombrants
const SEP_SPEED   = BASE_TILE*1.2;    // déplacement maximum par seconde
// États ancrés à un poste précis calculé ailleurs : les déplacer ferait
// osciller l'automate correspondant — nodeApproach vise déjà à 90 % du seuil
// de contact, farmSpot pose le fermier SUR son sillon, doBuild sur le
// pourtour du chantier. Ils restent des OBSTACLES pour les autres (ils sont
// bien vus par la boucle intérieure), mais ne bougent jamais eux-mêmes.
const SEP_ANCRES = new Set(['garrison','farm','gather','build']);
function sepRayon(u){ const d=UDEF[u.type]; return (d&&d.siege)?SEP_R_SIEGE:SEP_R_DEF; }
// Grille dédiée, d'une TUILE de côté : la grille spatiale générale
// (GRID_SZ=200, soit 5,3 tuiles) est bien trop grossière ici — à forte
// population, chacune de ses cellules contient des dizaines d'unités et le
// balayage 3×3 redeviendrait quadratique. Listes chaînées sur tableaux
// typés : aucune allocation une fois la première image passée.
let   _sepHead = new Int32Array(COLS*ROWS);
let   _sepNext = new Int32Array(0);
let   _sepPX = new Float32Array(0), _sepPY = new Float32Array(0);
let   _sepX  = new Float32Array(0), _sepY  = new Float32Array(0), _sepRad = new Float32Array(0);
// Demi-voisinage : chaque paire n'est examinée QU'UNE FOIS. Les quatre
// directions complémentaires ((-1,0), (+1,-1), (0,-1), (-1,-1)) sont
// couvertes quand c'est la cellule d'en face qui est le sujet. Balayer les
// 8 voisines reviendrait à calculer deux fois chaque distance.
const SEP_VOIS = [[1,0],[-1,1],[0,1],[1,1]];
// Une paire (i,j) : la poussée est portée au crédit des DEUX, en sens
// opposé. C'est ce qui rend le résultat indépendant de l'ordre de parcours.
function sepPousser(i,j,xi,yi,ri){
  const want=ri+_sepRad[j];
  let ex=xi-_sepX[j], ey=yi-_sepY[j];
  const d2=ex*ex+ey*ey;
  if(d2>=want*want) return;
  let d=Math.sqrt(d2);
  if(d<0.001){
    // Superposition exacte : aucune direction n'est « juste ». On en tire
    // une de l'unité elle-même (animT est déjà semé sur son id, voir
    // mkUnit) plutôt que de Math.random(), qui désynchroniserait l'hôte
    // et le client.
    const u=G.units[i], a=u.animT||(u.id*2.399963);
    ex=Math.cos(a); ey=Math.sin(a); d=1;
  }
  const k=(want-d)*0.5/d;   // chacun fait la moitié du chemin
  const px=ex*k, py=ey*k;
  _sepPX[i]+=px; _sepPY[i]+=py;
  _sepPX[j]-=px; _sepPY[j]-=py;
}
function sepEligible(u){
  const d=UDEF[u.type];
  return u.hp>0 && !(d&&d.naval) && u.state!=='garrison';
}
function separerUnites(dt){
  const N=G.units.length;
  if(N<2) return;
  if(_sepNext.length<N){
    const cap=N+64;
    _sepNext=new Int32Array(cap); _sepPX=new Float32Array(cap); _sepPY=new Float32Array(cap);
    _sepX=new Float32Array(cap); _sepY=new Float32Array(cap); _sepRad=new Float32Array(cap);
  }
  _sepHead.fill(-1);
  // Semis. Position et rayon sont recopiés dans des tableaux typés : la
  // boucle intérieure tourne des dizaines de milliers de fois par pas, et y
  // déréférencer l'objet unité (puis UDEF[u.type]) coûtait plus cher que le
  // calcul de distance lui-même. `_sepRad[i]<0` marque une unité non
  // éligible : un seul test au lieu de rappeler sepEligible.
  for(let i=0;i<N;i++){
    const u=G.units[i];
    _sepPX[i]=0; _sepPY[i]=0; _sepRad[i]=-1;
    if(!sepEligible(u)) continue;
    const tx=u.x/BASE_TILE|0, ty=u.y/BASE_TILE|0;
    if(tx<0||ty<0||tx>=COLS||ty>=ROWS) continue;   // hors carte : jamais semé, donc jamais poussé
    _sepX[i]=u.x; _sepY[i]=u.y; _sepRad[i]=sepRayon(u);
    const c=ty*COLS+tx;
    _sepNext[i]=_sepHead[c]; _sepHead[c]=i;
  }
  // Accumulation. La poussée est calculée pour TOUT LE MONDE (y compris les
  // unités ancrées) puis appliquée seulement aux unités libres : le calcul
  // reste additif et indépendant de l'ordre du tableau — donc déterministe,
  // ce qu'exige la simulation partagée hôte/client (voir construireDelta).
  for(let c=0,nc=COLS*ROWS;c<nc;c++){
    let i=_sepHead[c];
    if(i===-1) continue;
    const cx=c%COLS, cy=(c/COLS)|0;
    for(;i!==-1;i=_sepNext[i]){
      const xi=_sepX[i], yi=_sepY[i], ri=_sepRad[i];
      // (a) voisines de la MÊME cellule, une seule fois par paire
      for(let j=_sepNext[i];j!==-1;j=_sepNext[j]) sepPousser(i,j,xi,yi,ri);
      // (b) quatre cellules du demi-voisinage
      for(let v=0;v<4;v++){
        const nx=cx+SEP_VOIS[v][0], ny=cy+SEP_VOIS[v][1];
        if(nx<0||ny<0||nx>=COLS||ny>=ROWS) continue;
        for(let j=_sepHead[ny*COLS+nx];j!==-1;j=_sepNext[j]) sepPousser(i,j,xi,yi,ri);
      }
    }
  }
  // Application, plafonnée. Les unités ancrées ont bien été comptées comme
  // obstacles ci-dessus mais ne bougent pas.
  const cap=SEP_SPEED*dt, maxX=COLS*BASE_TILE-1, maxY=ROWS*BASE_TILE-1;
  for(let i=0;i<N;i++){
    let px=_sepPX[i], py=_sepPY[i];
    if(px===0&&py===0) continue;
    const u=G.units[i];
    if(SEP_ANCRES.has(u.state)) continue;
    const m=Math.hypot(px,py);
    if(m>cap){ const s=cap/m; px*=s; py*=s; }
    // Même glissement que stepBlocked : une séparation ne doit JAMAIS
    // pousser une unité à travers un mur (ni l'enfermer si elle est déjà
    // dedans — le cas est laissé à stepBlocked, qui sait l'en faire sortir).
    const nx=u.x+px, ny=u.y+py;
    if(!wallAt(nx,ny)){ u.x=nx; u.y=ny; }
    else if(!wallAt(nx,u.y)){ u.x=nx; }
    else if(!wallAt(u.x,ny)){ u.y=ny; }
    // wallAt() renvoie false hors carte : le bord doit être borné à part.
    if(u.x<1) u.x=1; else if(u.x>maxX) u.x=maxX;
    if(u.y<1) u.y=1; else if(u.y>maxY) u.y=maxY;
  }
}

// ── PATHFINDING (A* sur tuiles) ────────────────────────────
// Jusqu'ici une unité bloquée ne savait que glisser le long de l'obstacle :
// une palissade en L ou un lac la collait indéfiniment. On ne calcule un
// chemin QUE lorsqu'elle est réellement coincée (cas rare), avec un budget
// borné par image pour rester fluide sur mobile.
const PF_BUDGET=1200;         // tuiles explorées au maximum par recherche
const PF_PER_FRAME=3;         // recherches simultanées maximum par image
const PF_DX=[1,-1,0,0, 1,1,-1,-1], PF_DY=[0,0,1,-1, 1,-1,1,-1];
const PF={ n:0 };
PF.hn=0; PF.run=0;

// Les deux structures ci-dessus (grille de séparation, buffers A*) sont
// dimensionnées sur COLS*ROWS. Tant que la carte faisait toujours 240×240
// elles pouvaient être allouées une fois pour toutes au chargement ; la
// taille se choisit désormais sur l'écran-titre (voir TAILLES), donc
// appliquerTailleCarte() rappelle cette fonction à chaque changement —
// sans quoi la première image écrirait hors des bornes de l'ancienne
// carte. Appelée aussi ci-dessous, pour la taille par défaut.
function redimensionnerBuffersCarte(){
  if(_sepHead.length!==COLS*ROWS) _sepHead=new Int32Array(COLS*ROWS);
  if(PF.n===COLS*ROWS) return;
  PF.n=COLS*ROWS;
  PF.g=new Float32Array(PF.n); PF.f=new Float32Array(PF.n);
  PF.from=new Int32Array(PF.n); PF.stamp=new Int32Array(PF.n);
  PF.closed=new Int32Array(PF.n); PF.heap=new Int32Array(PF.n+1);
  // Les marques de visite repartent à zéro avec les tableaux : le compteur
  // de passage doit repartir avec elles, sinon la première recherche sur la
  // nouvelle carte prendrait des cases neuves pour des cases déjà fermées.
  PF.hn=0; PF.run=0;
}
redimensionnerBuffersCarte();
let _pfFrame=0;

function tileBlocked(tx,ty){
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS) return true;
  return G.bmap[ty][tx]===3;
}
// Tas binaire ordonné sur PF.f
function hPush(i){
  const H=PF.heap; let k=++PF.hn; H[k]=i;
  while(k>1){ const p=k>>1; if(PF.f[H[p]]<=PF.f[H[k]]) break; const t=H[p];H[p]=H[k];H[k]=t; k=p; }
}
function hPop(){
  const H=PF.heap, top=H[1]; H[1]=H[PF.hn--];
  let k=1;
  for(;;){
    const l=k<<1, r=l+1; let m=k;
    if(l<=PF.hn&&PF.f[H[l]]<PF.f[H[m]]) m=l;
    if(r<=PF.hn&&PF.f[H[r]]<PF.f[H[m]]) m=r;
    if(m===k) break;
    const t=H[m];H[m]=H[k];H[k]=t; k=m;
  }
  return top;
}
// Ligne de vue libre entre deux points monde (Bresenham sur tuiles)
function losClear(x0,y0,x1,y1){
  let tx=(x0/BASE_TILE)|0, ty=(y0/BASE_TILE)|0;
  const ex=(x1/BASE_TILE)|0, ey=(y1/BASE_TILE)|0;
  const dx=Math.abs(ex-tx), dy=Math.abs(ey-ty);
  const sx=tx<ex?1:-1, sy=ty<ey?1:-1;
  let err=dx-dy, guard=0;
  while(guard++<400){
    if(tileBlocked(tx,ty)) return false;
    if(tx===ex&&ty===ey) return true;
    const e2=2*err;
    if(e2>-dy){ err-=dy; tx+=sx; }
    if(e2< dx){ err+=dx; ty+=sy; }
  }
  return false;
}
// Corde tendue : on ne garde que les points de passage indispensables
function smoothPath(sx,sy,pts){
  const out=[]; let cx=sx, cy=sy, i=0;
  while(i<pts.length){
    let j=Math.min(pts.length-1,i+40);          // fenêtre bornée : coût maîtrisé
    while(j>i&&!losClear(cx,cy,pts[j].x,pts[j].y)) j--;
    out.push(pts[j]); cx=pts[j].x; cy=pts[j].y; i=j+1;
  }
  return out;
}
function findPath(sx,sy,gx,gy){
  const W=COLS;
  const stx=Math.max(0,Math.min(COLS-1,(sx/BASE_TILE)|0)), sty=Math.max(0,Math.min(ROWS-1,(sy/BASE_TILE)|0));
  let gtx=Math.max(0,Math.min(COLS-1,(gx/BASE_TILE)|0)), gty=Math.max(0,Math.min(ROWS-1,(gy/BASE_TILE)|0));
  if(tileBlocked(gtx,gty)){                      // arrivée dans un mur : viser la case libre la plus proche
    let bd=Infinity, bx=-1, by=-1;
    for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
      const x=gtx+dx, y=gty+dy;
      if(tileBlocked(x,y)) continue;
      const d2=dx*dx+dy*dy;
      if(d2<bd){ bd=d2; bx=x; by=y; }
    }
    if(bx<0) return null;
    gtx=bx; gty=by;
  }
  if(stx===gtx&&sty===gty) return null;
  const run=++PF.run; PF.hn=0;
  const si=sty*W+stx, gi=gty*W+gtx;
  const h=(x,y)=>{ const dx=Math.abs(x-gtx), dy=Math.abs(y-gty);
    return (dx+dy)+(1.4142-2)*Math.min(dx,dy); };
  PF.stamp[si]=run; PF.g[si]=0; PF.f[si]=h(stx,sty); PF.from[si]=-1;
  hPush(si);
  let expanded=0, found=false;
  while(PF.hn>0&&expanded<PF_BUDGET){
    const cur=hPop();
    if(PF.closed[cur]===run) continue;
    PF.closed[cur]=run; expanded++;
    if(cur===gi){ found=true; break; }
    const cx=cur%W, cy=(cur/W)|0;
    for(let k=0;k<8;k++){
      const nx=cx+PF_DX[k], ny=cy+PF_DY[k];
      if(tileBlocked(nx,ny)) continue;
      if(k>=4&&(tileBlocked(cx+PF_DX[k],cy)||tileBlocked(cx,cy+PF_DY[k]))) continue; // pas de coupe d'angle
      const ni=ny*W+nx;
      if(PF.closed[ni]===run) continue;
      const ng=PF.g[cur]+(k<4?1:1.4142);
      if(PF.stamp[ni]!==run||ng<PF.g[ni]){
        PF.stamp[ni]=run; PF.g[ni]=ng; PF.f[ni]=ng+h(nx,ny); PF.from[ni]=cur;
        hPush(ni);
      }
    }
  }
  if(!found) return null;
  const tiles=[];
  for(let i=gi;i!==-1&&tiles.length<600;i=PF.from[i]) tiles.push(i);
  tiles.reverse();
  const pts=tiles.map(i=>({x:(i%W)*BASE_TILE+BASE_TILE/2, y:((i/W)|0)*BASE_TILE+BASE_TILE/2}));
  pts[pts.length-1]={x:gx,y:gy};                 // dernier point : la cible réelle
  return smoothPath(sx,sy,pts);
}
// null = pas tenté (cooldown ou budget), true/false = chemin trouvé ou non
function requestPath(u){
  if((u.pathCd||0)>0||_pfFrame>=PF_PER_FRAME) return null;
  u.pathCd=0.6; _pfFrame++;
  const p=findPath(u.x,u.y,u.destX,u.destY);
  u.path=(p&&p.length)?p:null;
  u.pathGoal=u.path?{x:u.destX,y:u.destY}:null;
  return !!u.path;
}
// Avance vers (gx,gy) en suivant le chemin s'il y en a un. Renvoie true si bloqué.
function advance(u,gx,gy,dt){
  u.destX=gx; u.destY=gy;
  // ordre changé : le chemin mémorisé ne vaut plus rien
  if(u.path&&(!u.pathGoal||Math.hypot(u.pathGoal.x-gx,u.pathGoal.y-gy)>BASE_TILE*1.5)) u.path=null;
  let ax=gx, ay=gy;
  if(u.path&&u.path.length){
    if(Math.hypot(u.path[0].x-u.x,u.path[0].y-u.y)<BASE_TILE*0.45) u.path.shift();
    if(u.path.length){ ax=u.path[0].x; ay=u.path[0].y; } else u.path=null;
  }
  const dx=ax-u.x, dy=ay-u.y, d=Math.hypot(dx,dy);
  if(d<0.001) return false;
  u.moving=true; u.dir=Math.atan2(dy,dx);
  const spd=u.spd*BASE_TILE*dt;
  return stepBlocked(u, u.x+dx/d*spd, u.y+dy/d*spd);
}

// Bâtiment solide (tout sauf la Ferme, qui reste un champ où l'on marche)
// occupant cette position. Sert de repli à l'IA ennemie quand elle est
// bloquée par un obstacle qui n'est pas sa cible courante — auparavant
// limité aux murs, alors que n'importe quel bâtiment bloque désormais.
function blockingBuildingAt(wx,wy){
  const tx=(wx/BASE_TILE)|0, ty=(wy/BASE_TILE)|0;
  return G.buildings.find(b=>b.type!==BT.FARM&&tx>=b.tx&&tx<b.tx+b.w&&ty>=b.ty&&ty<b.ty+b.h);
}

// Zone de contact d'un gisement.
// Le sprite est dessiné AU-DESSUS du centre logique (décalage h*0.78 dans
// drawNodes) : viser le centre plantait le villageois dans le feuillage.
// On vise donc le PIED du sprite (fy), via une ellipse large et basse
// (vue 3/4 façon AoE2 : on se poste sur le flanc, pas au-dessus).
function nodeReach(nd){
  // L'arbre a une large canopée mais sa masse au sol, c'est le TRONC (~±3px) :
  // caler l'ellipse sur la canopée laissait un vide visible entre le bûcheron
  // et l'arbre. Les rochers et buissons, eux, sont larges au sol.
  if(nd.type===RT.TREE)  return {rx:BASE_TILE*0.27, ry:BASE_TILE*0.20, fy:BASE_TILE*0.26};
  if(nd.type===RT.BERRY) return {rx:BASE_TILE*0.36, ry:BASE_TILE*0.20, fy:0};
  return {rx:BASE_TILE*0.38, ry:BASE_TILE*0.20, fy:BASE_TILE*0.02};  // pierre / or
}
// Distance normalisée au gisement : <=1 = au contact
function nodeDistN(u,nd){
  const R=nodeReach(nd);
  return Math.hypot((u.x-nd.x)/R.rx,(u.y-(nd.y+R.fy))/R.ry);
}
// Point où se poster : sur l'ellipse, du côté d'où l'on vient, jamais plein
// nord (sinon l'unité est dessinée par-dessus le sprite au lieu d'être à son pied).
function nodeApproach(u,nd){
  const R=nodeReach(nd), fy=nd.y+R.fy;
  let ang=Math.atan2((u.y-fy)/R.ry,(u.x-nd.x)/R.rx);
  if(!isFinite(ang)) ang=Math.PI/2;
  if(Math.sin(ang)<-0.25){          // rabat l'approche vers les flancs
    const t=Math.asin(-0.25);
    ang=Math.cos(ang)>=0?t:Math.PI-t;
  }
  const k=0.90;                     // viser en deçà du seuil : évite l'oscillation
  return {x:nd.x+Math.cos(ang)*R.rx*k, y:fy+Math.sin(ang)*R.ry*k};
}
// Distance de contact avec un bâtiment : son bord, pas son centre
function bldContact(b,margin){
  return (Math.max(b.w,b.h)*BASE_TILE)/2 + BASE_TILE*(margin==null?0.45:margin);
}
// Point d'approche d'un BÂTIMENT : sur son pourtour, jamais par l'arrière.
// Le sprite est dessiné vers le haut (marge oy dans drawBuildings) : une unité
// postée au nord disparaît derrière le toit au lieu de longer le mur.
function bldApproach(u,b,margin){
  const m=BASE_TILE*(margin==null?0.45:margin);
  const rx=(b.w*BASE_TILE/2+m)*0.92;                       // toujours < bldContact : pas d'oscillation
  const ry=(b.h*BASE_TILE/2+Math.max(m,BASE_TILE*0.30))*0.92;   // ...et toujours hors de l'emprise au sol
  let ang=Math.atan2((u.y-b.y)/ry,(u.x-b.x)/rx);
  if(!isFinite(ang)) ang=Math.PI/2;
  if(Math.sin(ang)<-0.30){                            // rabat vers les flancs
    const t=Math.asin(-0.30);
    ang=Math.cos(ang)>=0?t:Math.PI-t;
  }
  return {x:b.x+Math.cos(ang)*rx, y:b.y+Math.sin(ang)*ry};
}

// Poste de travail dans un champ (façon AoE2 : les fermiers se répartissent
// sur les sillons au lieu de s'empiler au centre).
function farmSpot(u,f){
  if(u.farmSlot==null||u.farmSlotFor!==f.id){
    u.farmSlotFor=f.id;
    const taken=new Set();
    for(const v of G.units)
      if(v!==u&&v.state==='farm'&&v.target===f.id&&v.farmSlot!=null) taken.add(v.farmSlot);
    let s=0; while(s<4&&taken.has(s)) s++;
    u.farmSlot=s%4;
  }
  const i=u.farmSlot;
  const ox=(i%2)?0.74:0.26, oy=(i<2)?0.36:0.74;
  return {x:(f.tx+ox*f.w)*BASE_TILE, y:(f.ty+oy*f.h)*BASE_TILE};
}


// (resPool / ageOf / gatherMult sont désormais définis avec les factions,
//  plus haut : ce sont des lectures de table, plus des ternaires codés en dur.)

function doGather(u,dt){
  const n=nodeById(u.target);
  if(!n||n.amt<=0){
    // nœud épuisé : reprendre sur le même type, en évitant les gisements saturés
    const type=u.invT||(n&&n.type);
    if(n) n.gatherers=n.gatherers.filter(id=>id!==u.id);
    // on reste dans le même bosquet plutôt que de traverser la carte
    const load=gatherLoad();
    const nn=type?(bestNodeFor(u,type,n||null,load)||bestNodeFor(u,type,null,load)):null;
    if(nn){u.target=nn.id;u.homeNode=nn.id;u.state='gather';return;}
    if(u.inv>0){ u.dropoff=findDropoff(u); u.state='return'; return; } // ne pas jeter la charge
    u.state='idle';u.target=null;return;
  }
  u.moving=false;
  if(nodeDistN(u,n)>1){
    const ap=nodeApproach(u,n);
    u.destX=ap.x; u.destY=ap.y; moveTo(u,dt,true); return;
  }
  if(!n.gatherers.includes(u.id)) n.gatherers.push(u.id);
  u.homeNode=n.id;
  const nKind = n.type===RT.TREE?'wood' : (n.type===RT.BERRY||n.type===RT.MEAT)?'food' : 'ore';
  u.gTimer+=dt*gatherMult(u.owner)*campRateMult(u.owner,nKind);
  if(u.gTimer>=1/GRATE[n.type]){
    u.gTimer=0;
    // Gisement infini (point d'intérêt gardé) : jamais épuisé, se récolte
    // indéfiniment tant que le camp ennemi ne repousse pas le villageois.
    const a=n.infinite?1:Math.min(1,n.amt);
    if(!n.infinite) n.amt-=a;
    u.inv+=a; u.invT=n.type;
    addFText(u.x,u.y-14,'+1','#f1c40f');
    sfx(n.type===RT.TREE?'chop':(n.type===RT.BERRY||n.type===RT.MEAT)?'pick':'mine');
    if(u.inv>=gatherCap(u.owner)||(!n.infinite&&n.amt<=0)){
      n.gatherers=n.gatherers.filter(id=>id!==u.id);
      u.dropoff=findDropoff(u);
      u.state='return';
    }
  }
}

// Récolte sur une ferme (modèle Age of Empires 2 : le villageois travaille le champ)
function doFarm(u,dt){
  let f=bldById(u.target); if(f&&f.type!==BT.FARM) f=null;
  // ferme démolie / en chantier : il en faut une autre, vide ou non — elle
  // se re-sème toute seule si le bois suit (voir tryAutoReseed).
  if(!f||f.constructing){
    if(f) f.farmers=(f.farmers||[]).filter(id=>id!==u.id);
    const nf=findNearestFarm(u.x,u.y,true,u.owner);
    if(nf){ u.target=nf.id; u.homeFarm=nf.id; return; }
    if(u.inv>0){ u.dropoff=findDropoff(u); u.state='return'; }
    else { u.state='idle'; u.target=null; }
    return;
  }
  u.homeFarm=f.id;
  // le fermier travaille DANS le champ, sur son propre sillon (pas au centre)
  const sp=farmSpot(u,f);
  if(Math.hypot(sp.x-u.x,sp.y-u.y)>BASE_TILE*0.20){
    u.destX=sp.x; u.destY=sp.y; moveTo(u,dt,true); return;
  }
  u.moving=false;
  if(!(f.farmers||[]).includes(u.id)) (f.farmers=f.farmers||[]).push(u.id);
  // Champ épuisé : le fermier patiente SUR PLACE au lieu de partir en chercher
  // un autre — la ferme se re-sème seule (tryAutoReseed) en général dans
  // l'image qui suit, donc la pause est imperceptible tant qu'il y a du bois.
  if(f.foodLeft<=0){
    if(u.inv>0){
      f.farmers=(f.farmers||[]).filter(id=>id!==u.id);
      u.dropoff=findDropoff(u); u.state='return';
    }
    return;
  }
  u.gTimer+=dt*gatherMult(u.owner)*campRateMult(u.owner,'food');
  if(u.gTimer>=1/GRATE.farm){
    u.gTimer=0;
    const a=Math.min(1,f.foodLeft); f.foodLeft-=a; u.inv+=a; u.invT='farm';
    addFText(u.x,u.y-14,'+1','#8fbc44');
    sfx('pick');
    if(u.inv>=gatherCap(u.owner)){
      f.farmers=(f.farmers||[]).filter(id=>id!==u.id);
      u.dropoff=findDropoff(u);
      u.state='return';
    }
  }
}

// Réparation d'un bâtiment endommagé par un villageois
const REPAIR_RATE=14; // PV/s
function doRepair(u,dt){
  const _b=bldById(u.target), b=(_b&&_b.owner===u.owner)?_b:null; // on ne bâtit/répare que chez soi
  if(!b||b.hp>=b.maxHp||b.constructing){
    if(b&&b.hp>=b.maxHp) addFText(b.x,b.y-20,'Réparé !','#2ecc71');
    u.state='idle'; u.target=null; return;
  }
  const reach=bldContact(b,0.35);
  const d=Math.hypot(b.x-u.x,b.y-u.y);
  if(d>reach){ const ap=bldApproach(u,b,0.35); u.destX=ap.x; u.destY=ap.y; moveTo(u,dt,true); return; }
  u.moving=false;
  b.hp=Math.min(b.maxHp, b.hp+REPAIR_RATE*dt);
  if(Math.random()<dt*3) spawnParts(b.x+(Math.random()-0.5)*b.w*BASE_TILE, b.y+(Math.random()-0.5)*b.h*BASE_TILE,'#f1c40f',1);
}

function findNearestFarm(x,y,allowEmpty,owner=FAC.P1){
  let best=null,bd=Infinity;
  for(const b of G.buildings){
    if(b.owner!==owner||b.type!==BT.FARM||b.constructing) continue;
    if(!allowEmpty&&b.foodLeft<=0) continue;
    const d=Math.hypot(b.x-x,b.y-y);
    if(d<bd){bd=d;best=b;}
  }
  return best;
}
// Une relique est libre si personne ne la porte activement — auto-guérit :
// un moine "porteur" réaffecté à autre chose (déplacement, attaque, mort,
// garnison…) sans repasser par ORD.RELIQUE libère la relique tout seul, sans
// qu'il faille intercepter chaque ordre susceptible d'interrompre un moine.
function relicFree(r){
  if(r.bankedBy) return false;
  if(!r.carrier) return true;
  // Balayage direct plutôt que unitById (IU) : un ordre peut arriver avant
  // la première reconstruction de l'index, comme pour _bldDe (voir plus haut).
  const u=G.units.find(x=>x.id===r.carrier);
  return !(u&&u.hp>0&&u.state==='relic'&&u.target===r.id);
}
function findNearestMonastery(x,y,owner){
  let best=null,bd=Infinity;
  for(const b of G.buildings){
    if(b.owner!==owner||b.type!==BT.MONASTERY||b.constructing) continue;
    const d=Math.hypot(b.x-x,b.y-y);
    if(d<bd){bd=d;best=b;}
  }
  return best;
}
// Un Moine porte une relique jusqu'au Monastère le plus proche : d'abord la
// rejoindre (elle reste immobile à son point de génération jusqu'à ce
// qu'un moine l'atteigne), puis la livrer. Sans Monastère possédé, il
// patiente sur place — relique en main — jusqu'à ce que le joueur en bâtisse un.
function doRelic(u,dt){
  const relic=G.relics&&G.relics.find(r=>r.id===u.target);
  if(!relic||relic.carrier!==u.id){ u.state='idle'; u.target=null; return; } // relique perdue (improbable) : abandon propre
  if(!u.relicHeld){
    if(Math.hypot(relic.x-u.x,relic.y-u.y)>BASE_TILE*0.5){
      u.destX=relic.x; u.destY=relic.y; moveTo(u,dt,true); return;
    }
    u.relicHeld=true; // relique ramassée : elle voyage désormais avec le moine
  }
  u.moving=false;
  const mon=findNearestMonastery(u.x,u.y,u.owner);
  if(!mon) return; // pas de Monastère : attente sur place, relique en main
  const d=Math.hypot(mon.x-u.x,mon.y-u.y);
  if(d>bldContact(mon,0.4)){ const ap=bldApproach(u,mon,0.4); u.destX=ap.x; u.destY=ap.y; moveTo(u,dt,true); return; }
  // Livraison : revenu passif désormais actif (voir updateRelicIncome)
  u.moving=false;
  relic.carrier=null; relic.bankedBy=u.owner; u.relicHeld=false;
  if(estLocal(u)) notify('🏺 Relique mise à l\'abri — revenu passif en or !','#f0c040');
  u.state='idle'; u.target=null;
}

// Charge réelle par nœud : villageois qui y récoltent OU qui y retournent après dépôt
// Compte les deux camps : un gisement déjà saturé par les villageois adverses
// est tout aussi mauvais à rejoindre qu'un gisement saturé par les siens.
function gatherLoad(){
  const load={};
  for(const u of G.units){
    if(u.type!==UT.VIL) continue;
    if((u.state==='gather'||u.state==='return')&&u.homeNode!=null)
      load[u.homeNode]=(load[u.homeNode]||0)+1;
  }
  return load;
}

// Meilleur nœud pour un villageois : proche ET peu encombré (évite l'empilement)
const CROWD_PENALTY=2.5;   // en tuiles, par récolteur déjà présent
const ANCHOR_RADIUS=5;     // tuiles : on ne s'éloigne plus du gisement désigné
const ANCHOR_WEIGHT=1.8;   // s'écarter du gisement désigné coûte plus cher que marcher
function bestNodeFor(u,type,anchor,load){
  let best=null,bestScore=Infinity;
  for(const nd of G.nodes){
    if(nd.amt<=0||nd.type!==type) continue;
    let anchorD=0;
    if(anchor){
      // le rayon était de 12 tuiles et l'éloignement ne coûtait rien : on
      // désignait un arbre et le villageois partait sur un autre, très loin.
      anchorD=Math.hypot(nd.x-anchor.x,nd.y-anchor.y);
      if(anchorD>ANCHOR_RADIUS*BASE_TILE) continue;
    }
    const dist=Math.hypot(nd.x-u.x,nd.y-u.y);
    const score=dist+anchorD*ANCHOR_WEIGHT+(load[nd.id]||0)*BASE_TILE*CROWD_PENALTY;
    if(score<bestScore){bestScore=score;best=nd;}
  }
  return best;
}

// Envoie un groupe de villageois récolter : ils se répartissent sur les
// ressources du même type autour du nœud visé, au lieu de s'empiler dessus.
function assignGatherers(vils,anchorNode){
  const type=anchorNode.type;
  const load=gatherLoad();
  // traiter les plus proches du point visé en premier (répartition naturelle)
  const ordered=[...vils].sort((a,b)=>
    Math.hypot(a.x-anchorNode.x,a.y-anchorNode.y)-Math.hypot(b.x-anchorNode.x,b.y-anchorNode.y));
  let placed=0;
  const used=new Set();
  // Un seul villageois : il va sur le gisement DÉSIGNÉ, sans discussion.
  // La répartition n'a de sens que pour un groupe.
  const single=ordered.length===1;
  for(const v of ordered){
    const nd=single?anchorNode:(bestNodeFor(v,type,anchorNode,load)||anchorNode);
    // retirer le villageois de son ancien nœud
    for(const old of G.nodes) if(old.gatherers.length) old.gatherers=old.gatherers.filter(id=>id!==v.id);
    if(v.invT!==type){ v.inv=0; v.invT=null; } // ne perdre l'inventaire que si on change de ressource
    v.state='gather'; v.target=nd.id; v.homeNode=nd.id;
    load[nd.id]=(load[nd.id]||0)+1;
    used.add(nd.id); placed++;
  }
  return {placed,spread:used.size};
}

function findDropoff(u){
  let best=null,bd=Infinity;
  for(const b of G.buildings){
    if(b.owner!==u.owner||b.constructing) continue;
    const d=BDEF[b.type];
    if(!d.drops) continue;
    if(u.invT===RT.TREE&&b.type!==BT.TC&&b.type!==BT.LUMBER) continue;
    if((u.invT===RT.STONE||u.invT===RT.GOLD)&&b.type!==BT.TC&&b.type!==BT.MINE) continue;
    if(u.invT===RT.BERRY&&b.type!==BT.TC&&b.type!==BT.MILL) continue;
    if(u.invT===RT.MEAT&&b.type!==BT.TC&&b.type!==BT.MILL) continue; // viande de chasse : TC ou Moulin, comme les baies
    if(u.invT===RT.FISH&&b.type!==BT.DOCK) continue; // le poisson ne se dépose qu'au Quai, jamais au TC (trop loin de l'eau)
    if(u.invT==='farm'&&b.type!==BT.TC&&b.type!==BT.MILL) continue; // nourriture de ferme : TC ou Moulin
    const dx=b.x-u.x,dy=b.y-u.y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<bd){bd=dist;best=b;}
  }
  return best?best.id:null;
}

function doReturn(u,dt){
  const b=bldById(u.dropoff);
  if(!b){u.dropoff=findDropoff(u); if(!u.dropoff){u.state='idle';return;} return;}
  u.moving=false;
  const dx=b.x-u.x,dy=b.y-u.y,d=Math.sqrt(dx*dx+dy*dy);
  const dc=bldContact(b);
  if(d>dc){ const ap=bldApproach(u,b,0.45); u.destX=ap.x; u.destY=ap.y; moveTo(u,dt,true); return; }
  // Dépose
  const rm={[RT.TREE]:'wood',[RT.STONE]:'stone',[RT.GOLD]:'gold',[RT.BERRY]:'food',[RT.MEAT]:'food',farm:'food'};
  const rk=rm[u.invT];
  if(rk){
    const pool=resPool(u.owner);
    if(pool) pool[rk]+=u.inv;
    const fg=fac(u.owner); if(fg) fg.stats.gathered[rk]+=u.inv;
    if(estLocal(u)){ // retours d'interface : seulement pour le joueur local
      G.rateAcc[rk]=(G.rateAcc[rk]||0)+u.inv;
      addFText(b.x,b.y-16,`+${u.inv}`,rk==='gold'?'#f0c040':rk==='wood'?'#8fbc44':rk==='stone'?'#bbb':'#e8d5a0');
      sfx('drop');
    }
  }
  const savedType=u.invT;
  u.inv=0; u.invT=null;
  // Si le villageois travaillait une ferme, il y retourne (sinon une autre ferme)
  if(savedType==='farm'){
    let f=bldById(u.homeFarm);
    if(!(f&&f.type===BT.FARM&&!f.constructing)) f=null;
    if(!f) f=findNearestFarm(u.x,u.y,true,u.owner);
    if(f){ u.target=f.id; u.homeFarm=f.id; u.state='farm'; }
    else u.state='idle';
    return;
  }
  // Retourner récolter le même nœud, sinon le plus proche du même type
  const origN=nodeById(u.homeNode);
  if(origN&&origN.amt>0){ u.target=origN.id; u.state='gather'; }
  else {
    const load=gatherLoad();
    const nn=savedType?(bestNodeFor(u,savedType,origN||null,load)||bestNodeFor(u,savedType,null,load)):null;
    if(nn){u.target=nn.id;u.homeNode=nn.id;u.state='gather';}
    else u.state='idle';
  }
}

function doBuild(u,dt){
  const b=bldById(u.buildTarget);
  if(!b||!b.constructing){u.state='idle';return;}
  u.moving=false;
  const dx=b.x-u.x,dy=b.y-u.y,d=Math.sqrt(dx*dx+dy*dy);
  const bc=bldContact(b,0.35);
  if(d>bc){ const ap=bldApproach(u,b,0.35); u.destX=ap.x; u.destY=ap.y; moveTo(u,dt,true); return; }
  // Plus il y a de villageois, plus c'est rapide
  // Byzantins : +30% de vitesse de chantier (voir CIVS.chantierMult).
  b.progress=Math.min(1,b.progress+dt*0.12*(civOf(b.owner).chantierMult||1));
  // Fumée de construction occasionnelle
  if(Math.random()<dt*4){
    G.parts.push({x:b.x+(Math.random()-.5)*b.w*BASE_TILE*.6, y:b.y, vx:(Math.random()-.5)*8, vy:-20-Math.random()*15, col:'rgba(200,200,200,.8)', r:2+Math.random()*2, life:1});
  }
  if(b.progress>=1){
    b.constructing=false;
    // Un chantier adverse ne doit pas déclencher les retours destinés au
    // joueur (son : sfx, bannière plein écran, notification) : seule la
    // particule de fin reste, visible uniquement si la zone est explorée.
    const fb=fac(b.owner);
    if(fb){ fb.stats.built++; if(b.type===BT.WALL) fb.stats.wallsBuilt++; }
    if(estLocal(b)){
      sfx('build');
      notify(`${BDEF[b.type].nom} construite !`,'#2ecc71');
      bigBanner(`✅ ${BDEF[b.type].nom}`);
      // Indices contextuels : signalés une seule fois par partie, au moment
      // où ils deviennent concrètement utiles — plus efficace qu'un tutoriel
      // qui les évoquerait tous d'un coup avant même le premier villageois.
      if(b.type===BT.CASTLE) hintOnce('hero',"⭐ Château bâti : vous pouvez former votre Héros de civilisation (une seule fois par partie).",'#f0c040');
      if(b.type===BT.MONASTERY) hintOnce('relic',"🏺 Monastère bâti : un Moine peut porter les reliques dispersées sur la carte pour un revenu passif en or.",'#f0c040');
      if(b.type===BT.MARKET&&G.buildings.filter(x=>x.owner===G.me&&x.type===BT.MARKET&&!x.constructing).length>=1)
        hintOnce('trade',"🐫 Marché bâti : avec un second Marché, établissez une route commerciale pour un revenu continu en or.",'#f0c040');
    }
    spawnParts(b.x,b.y,'#2ecc71',10);
    updatePopCap();
    u.state='idle';
  }
}

function doAttack(u,dt){
  const tgt=unitById(u.target)||bldById(u.target);
  if(!tgt||tgt.hp<=0){
    u.target=null;
    // cible abattue : on reprend la marche d'attaque là où elle s'était arrêtée
    if(u.amove){ u.destX=u.amove.x; u.destY=u.amove.y; u.state='amove'; return; }
    u.state='idle'; return;
  }
  const dx=tgt.x-u.x,dy=tgt.y-u.y,d=Math.sqrt(dx*dx+dy*dy);
  if(d>u.rng+10){
    const st=u.stance||'agg';
    if(st==='hold'){ u.state='idle'; u.target=null; return; }   // ne quitte jamais son poste
    if(st==='def'&&u.anchorX!=null&&Math.hypot(u.x-u.anchorX,u.y-u.anchorY)>8*BASE_TILE){
      u.destX=u.anchorX; u.destY=u.anchorY; u.state='moving'; u.target=null; return; // laisse trop de champ
    }
    u.destX=tgt.x;u.destY=tgt.y;moveTo(u,dt,true);return;
  }
  u.moving=false;
  u.dir=Math.atan2(dy,dx);
  if(u.atkCd<=0){
    u.atkCd=1/u.atkSpd;
    // Bonus de contre et armure : voir BONUS/UDEF.armor et degatsContre.
    // Un tir ne fige PAS ses dégâts au départ (voir shootProj) : la flèche
    // emporte le profil de son tireur et se résout à l'impact, contre la
    // cible réellement touchée.
    const dmg=degatsDe(u,tgt);
    if(u.rng>BASE_TILE*1.5) shootProj(u,tgt);
    else { dealDmg(tgt,dmg,u); if(tgt.hp<=0) awardKillXP(u.id); }
  }
}

// Décompte des archers/arbalétriers en garnison, par bâtiment — un seul
// passage sur G.units pour toute l'image, au lieu d'un G.units.filter()
// PAR Tour/Château à CHAQUE pas de simulation (voir updateBuildings). Sur
// une grosse base (des dizaines de tours) et une armée nombreuse, ce
// filtre répété devenait le vrai goulot : O(tours × unités) et une
// allocation de tableau jetée par tour, quand une seule Map suffit.
function garnisonsArcheres(){
  const m=new Map();
  for(const u of G.units){
    if(u.state!=='garrison'||(u.type!==UT.ARC&&u.type!==UT.XBOW)) continue;
    m.set(u.target,(m.get(u.target)||0)+1);
  }
  return m;
}

function updateBuildings(dt){
  const garnisons=garnisonsArcheres();
  for(const b of G.buildings){
    if(!b.active||b.constructing) continue;
    // Réensemencement des fermes et production continue : concernent
    // TOUTE faction humaine (pas seulement G.me), sans quoi elles ne se
    // déclenchent jamais pour le camp du client distant en multijoueur en
    // ligne — update() ne tourne que côté hôte, où G.me vaut la faction de
    // L'HÔTE, jamais celle du client (voir estLocal). L'IA gère sa propre
    // économie ailleurs (updateAI) et ne doit pas passer par ce chemin.
    const fb=fac(b.owner), humB=fb&&fb.genre==='humain';
    if(b.type===BT.FARM&&humB) tryAutoReseed(b);
    // Production continue : réenfile un villageois dès que la file est vide
    if(b.type===BT.TC&&humB&&b.autoTrain&&b.trainQ.length===0
       &&popDe(b.owner)<maxPopDe(b.owner)&&canAfford(TCOST[UT.VIL],b.owner)){
      spend(TCOST[UT.VIL],b.owner); b.trainQ.push(UT.VIL); b.trainTimer=TTIME[UT.VIL];
    }
    // File de formation — commune aux deux camps : chacun est borné par SA
    // population et produit pour SON compte (voir trainTime/spawnUnit).
    if(b.trainQ.length>0){
      b.trainTimer-=dt;
      if(b.trainTimer<=0){
        const type=b.trainQ[0];
        const pop=popDe(b.owner), cap=maxPopDe(b.owner);
        if(pop<cap){
          b.trainQ.shift();
          spawnUnit(type,b,b.owner);
          b.trainTimer=b.trainQ.length>0?trainTime(b.trainQ[0]):0;
        } else {
          b.trainTimer=2; // retry in 2s
        }
      }
    }
    // Tour défensive + Château (auto-attaque) — vaut aussi bien pour les
    // tours du joueur (ciblent les ennemis) que pour les tours de garde
    // ennemies postées sur un point d'intérêt (ciblent les unités du joueur).
    if(b.type===BT.TOWER||b.type===BT.CASTLE){
      b.atkCd-=dt;
      let range,atk,cd;
      if(b.type===BT.CASTLE){ range=9*BASE_TILE; atk=30; cd=1.2; }
      else { const lv=TOWER_LEVELS[b.level||1]; range=lv.range*BASE_TILE; atk=lv.atk; cd=lv.cd; }
      // Garnison d'archers/arbalétriers : chacun ajoute un peu de dégâts à
      // l'attaque automatique du bâtiment (façon AoE2), plafonné pour ne pas
      // transformer une Tour en artillerie à elle seule.
      const garnAtk=garnisons.get(b.id)||0;
      if(garnAtk) atk+=Math.min(garnAtk,garnBonusCap(b))*4;
      // Feu Grégeois (byzantins) : applique APRÈS la garnison, donc il
      // multiplie aussi l'apport des archers postés.
      if(rechercheDe(b.owner).feu_gregeois) atk=Math.round(atk*1.3);
      if(b.atkCd<=0){
        const e=prochainHostileToute(b.x,b.y,range,b);
        if(e){ b.atkCd=cd; shootProj({x:b.x,y:b.y,atk,owner:b.owner},e); }
      }
    }
  }
  // Destruction
  const dest=G.buildings.filter(b=>b.hp<=0);
  for(const b of dest){
    G.sel=G.sel.filter(id=>id!==b.id);
    for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++) G.bmap[b.ty+dy][b.tx+dx]=0;
    spawnParts(b.x,b.y,'#e74c3c',14);
    // La garnison tombe avec le bâtiment — un abri détruit ne protège plus
    // personne (contrairement à une démolition volontaire, voir appliquerDemolition).
    // On propage l'auteur du coup fatal du bâtiment aux unités qui tombent
    // avec lui : sans ça, u.dernierAgresseur restait vide (ces unités ne
    // sont jamais passées par dealDmg) et l'attaquant ne recevait ni kill
    // compté dans ses stats, ni XP de vétérance pour ces morts pourtant
    // provoquées par lui.
    for(const u of G.units) if(u.state==='garrison'&&u.target===b.id){
      u.hp=0; u.dernierAgresseur=b.dernierAgresseur;
      if(b.dernierAgresseurUnit!=null) awardKillXP(b.dernierAgresseurUnit);
    }
    const fv=fac(b.owner); if(fv) fv.stats.bldLost++;
    const fk=fac(b.dernierAgresseur); if(fk&&fk!==fv) fk.stats.bldDestroyed++;
    if(estLocal(b)) notify(`${BDEF[b.type].nom} détruite !`,'#e74c3c');
    else if(fk&&fk.id===G.me) notify(`💥 ${BDEF[b.type].nom} ennemie détruite !`,'#2ecc71');
    updatePopCap();
  }
  G.buildings=G.buildings.filter(b=>b.hp>0);
}
// Plafond de bonus d'archers garnis : 5 par Tour, 8 par Château (plus grande
// capacité d'accueil).
function garnBonusCap(b){ return b.type===BT.CASTLE?8:5; }

// ── ROUTES COMMERCIALES ─────────────────────────────────────
// Fait avancer chaque caravane active ; à l'arrivée elle paie de l'or à SON
// propriétaire (pas au destinataire — c'est le marché qui a expédié la
// caravane, celui d'en face n'est qu'un point de virage) et repart en sens
// inverse. Aucune protection ni interception en v1 : la route continue de
// payer même sous blocus, mais s'interrompt proprement si l'un des deux
// marchés disparaît (démoli ou détruit).
function updateTradeRoutes(dt){
  for(const b of G.buildings){
    if(b.type!==BT.MARKET||!b.tradeRoute||b.constructing) continue;
    const to=bldById(b.tradeRoute.toId);
    if(!to||to.type!==BT.MARKET||to.constructing){ b.tradeRoute=null; continue; }
    const tr=b.tradeRoute;
    tr.t+=dt;
    if(tr.t>=tr.dur){
      tr.t=0; tr.dir*=-1;
      const gold=Math.round(10+(tr.dist/BASE_TILE)*0.6);
      const pool=resPool(b.owner);
      if(pool){
        pool.gold+=gold;
        const fo=fac(b.owner);
        if(fo){ fo.stats.gathered.gold+=gold; fo.stats.tradesDone++; }
        if(estLocal(b)){ addFText(b.x,b.y-24,`+${gold}💰`,'#f0c040'); if(G.rateAcc) G.rateAcc.gold=(G.rateAcc.gold||0)+gold; }
      }
    }
  }
}
// Position actuelle de la caravane sur son trajet, pour le rendu.
function caravanPos(b){
  const tr=b.tradeRoute, to=bldById(tr.toId); if(!to) return null;
  const p=Math.max(0,Math.min(1,tr.t/tr.dur));
  const k=tr.dir>0?p:1-p;
  return {x:b.x+(to.x-b.x)*k, y:b.y+(to.y-b.y)*k};
}

// ── RELIQUES ─────────────────────────────────────────────
// Revenu passif : chaque relique mise à l'abri (voir doRelic) rapporte de
// l'or en continu à SA faction, sans limite de durée — contrairement à la
// route commerciale, aucune protection à entretenir une fois livrée.
function updateRelicIncome(dt){
  if(!G.relics||!G.relics.length) return;
  for(const f of factionsJouantes()){
    let n=0; for(const r of G.relics) if(r.bankedBy===f.id) n++;
    if(n>0) f.res.gold+=n*RELIC_GOLD_RATE*dt;
  }
}

// ── MERVEILLE ────────────────────────────────────────────
// Le décompte tourne tant que la Merveille reste achevée et debout ; il n'est
// PAS répliqué tel quel sur le réseau (trop de trafic pour une seule barre de
// progression) — seul le franchissement du seuil l'est, via f.merveilleAchevee
// (un simple booléen de faction, qui suit le même chemin que f.vaincu).
function updateWonders(dt){
  for(const b of G.buildings){
    if(b.type!==BT.WONDER||b.constructing) continue;
    b.wonderTimer=(b.wonderTimer||0)+dt;
    if(estLocal(b)){
      const restant=Math.max(0,MERVEILLE_WIN_TIME-b.wonderTimer);
      if(restant>0&&Math.floor(restant)%60===0&&Math.abs(restant-Math.floor(restant))<dt){
        notify(`🏛️ Merveille : victoire dans ${Math.ceil(restant/60)} min si elle tient debout`,'#d8c078');
      }
    }
    if(b.wonderTimer>=MERVEILLE_WIN_TIME){
      const fo=fac(b.owner); if(fo) fo.merveilleAchevee=true;
    }
  }
}
// Vérifie la victoire/défaite par Merveille — appelé depuis update() (hôte)
// ET updateVisuel() (client), comme f.vaincu : seule la donnée de faction
// (déjà synchronisée) fait foi, jamais un minuteur local.
function checkMerveilleVictory(){
  if(G.victory||G.gameOver) return false;
  const gagnant=factionsJouantes().find(f=>f.merveilleAchevee);
  if(!gagnant) return false;
  if(gagnant.id===G.me){ G.victory=true; showVictory(); }
  else { G.gameOver=true; showGameOver(); }
  return true;
}

function spawnUnit(type,building,owner){
  const d=BDEF[building.type];
  const wx=(building.tx+d.w/2)*BASE_TILE+(Math.random()-.5)*BASE_TILE;
  const wy=(building.ty+d.h)*BASE_TILE+BASE_TILE*.6;
  const u=mkUnit(type,wx,wy,owner);
  // Point de ralliement
  if(building.rally){
    u.destX=building.rally.x+(Math.random()-.5)*BASE_TILE;
    u.destY=building.rally.y+(Math.random()-.5)*BASE_TILE;
    u.state='moving';
  }
  G.units.push(u);
  const fo=fac(owner);
  if(fo){ fo.pop++; fo.stats.trained++; }
  if(estLocal(u)) sfx('train');
  // Les bonus d'âge/recherche sont désormais appliqués par mkUnit pour TOUS
  // les camps : l'IA n'a plus qu'à poster sa recrue en garde.
  if(estIA(u)) aiAdoptUnit(u,fo);
  return u;
}

// Rayon de vigilance d'une garnison de point d'intérêt : assez large pour
// couvrir le camp et ses tours (≈ portée d'un Donjon), mais borné — sans
// quoi nearPlayerBuildingSmart (sans limite de distance) leur faisait
// repérer le Centre Ville du joueur dès la 1ère image et partir l'assiéger
// avant même la première vague.
const GUARD_AGGRO_RADIUS = BASE_TILE*7;
// Variante bornée de nearPlayerBuildingSmart, pour les gardes de camp
// uniquement : un bâtiment du joueur ne les intéresse que s'il empiète sur
// leur zone de garde (ex. le joueur construit collé au camp).
function nearPlayerBuildingWithin(x,y,r,src){
  let best=null,bd=r*r;
  for(const b of G.buildings){
    if(!estHostile(src,b)||b.type===BT.WALL) continue;
    const dx=b.x-x,dy=b.y-y,d2=dx*dx+dy*dy;
    if(d2<bd){bd=d2;best=b;}
  }
  return best;
}

function updateEnemyAI(dt){
  for(const u of G.units){
    if(fac(u)&&fac(u).genre==='humain') continue; // assaillants : IA et pillards
    // Les villageois de l'IA de Conquête vivent sur la machine à états du
    // joueur (récolte, dépôt, chantier — voir updateAIVillager) : les faire
    // aussi passer par la boucle de combat les enverrait charger l'ennemi
    // au lieu de travailler. Le Moine de l'IA (voir updateUnits) vit
    // maintenant sur ce même automate — même exclusion, pour la même raison.
    if(estIA(u)&&(u.type===UT.VIL||u.type===UT.MONK)) continue;
    u.atkCd=Math.max(0,u.atkCd-dt);
    // Reciblage 4×/s au lieu de 60×/s : le déplacement reste fluide, mais on
    // ne rebalaie plus tout le voisinage à chaque image (c'était 70% du CPU).
    u.aiCd=(u.aiCd||0)-dt;
    let tgt=null;
    if(u.aiCd>0&&u.target!=null){
      tgt=unitById(u.target)||bldById(u.target);
      if(tgt&&(tgt.hp<=0||!estHostile(u,tgt))) tgt=null;
    }
    if(!tgt){
      u.aiCd=0.25+Math.random()*0.15;                     // désynchronise les ennemis
      if(u.camp){
        // Garde de point d'intérêt : ne réagit qu'aux intrus dans SA zone
        // de garde, jamais à un bâtiment repéré à l'autre bout de la carte
        // comme un pillard de vague — le camp doit rester dormant tant
        // qu'on ne vient pas l'attaquer.
        tgt=nearestBy(u.campX,u.campY,GUARD_AGGRO_RADIUS,e=>e.hp>0&&estHostile(u,e))
          ||nearPlayerBuildingWithin(u.campX,u.campY,GUARD_AGGRO_RADIUS,u);
      } else {
        // Stratégie : villageois proche (cible molle) > unité militaire proche > bâtiment prioritaire
        tgt=nearestBy(u.x,u.y,u.rng*4,e=>e.type===UT.VIL&&e.hp>0&&estHostile(u,e)) // chasse les villageois
          ||prochainHostileUnite(u.x,u.y,u.rng*3,u)      // sinon militaire proche
          ||nearPlayerBuildingSmart(u.x,u.y,u);          // sinon bâtiment intelligent
      }
      u.target=tgt?tgt.id:null;
    }
    if(!tgt){
      // Une garde sans cible retourne à son poste au lieu de dériver —
      // sans ça, elle resterait plantée là où le dernier combat l'a menée.
      if(u.camp&&Math.hypot(u.campX-u.x,u.campY-u.y)>BASE_TILE*1.5){
        u.state='moving'; u.moving=true;
        advance(u,u.campX,u.campY,dt);
        continue;
      }
      u.state='idle';u.moving=false;continue;
    }
    const dx=tgt.x-u.x,dy=tgt.y-u.y,d=Math.sqrt(dx*dx+dy*dy);
    if(d>u.rng+8){
      u.state='moving';
      if(advance(u,tgt.x,tgt.y,dt)){
        // bloqué : on cherche d'abord à contourner ; on ne casse la palissade
        // que si elle enferme réellement la base (aucun chemin praticable).
        const r=requestPath(u);
        if(!u.path&&r!==null){
          const spd=u.spd*BASE_TILE*dt;
          const nx=u.x+dx/d*spd, ny=u.y+dy/d*spd;
          const w=blockingBuildingAt(nx,ny)||blockingBuildingAt(u.x+Math.sign(dx)*BASE_TILE*0.6,u.y)||blockingBuildingAt(u.x,u.y+Math.sign(dy)*BASE_TILE*0.6);
          if(w){ tgt=w; u.target=w.id; u.state='attack'; u.moving=false;
            if(u.atkCd<=0){
              u.atkCd=1/u.atkSpd;
              // Même calcul que le chemin d'attaque normal ci-dessous : ce
              // repli servait des dégâts nus, rendant une unité anormalement
              // faible contre un mur simplement parce qu'elle l'a atteint par
              // ce chemin-ci. degatsDe() est désormais LE point de passage
              // unique — aura de Héros, bonus de contre et armure compris.
              dealDmg(w,degatsDe(u,w),u); if(w.hp<=0) awardKillXP(u.id);
            } }
        }
      }
    } else {
      u.state='attack'; u.moving=false; u.dir=Math.atan2(dy,dx);
      if(u.atkCd<=0){
        u.atkCd=1/u.atkSpd;
        // Le boss casse toujours les murs vite : son ancien ×1,6 contre les
        // bâtiments est repris tel quel par BONUS[ENEMI_BOSS].bat.
        if(u.rng>BASE_TILE*1.5) shootProj(u,tgt);
        else { const dmg=degatsDe(u,tgt); dealDmg(tgt,dmg,u); if(tgt.hp<=0) awardKillXP(u.id); }
      }
    }
  }
}

// Ciblage bâtiment intelligent : préfère éco (villageois-producteurs) puis TC
function nearPlayerBuildingSmart(x,y,src){
  const prio={[BT.MILL]:3,[BT.FARM]:3,[BT.LUMBER]:3,[BT.MINE]:3,[BT.MARKET]:2,
              [BT.HOUSE]:2,[BT.TC]:4,[BT.FORGE]:1,[BT.UNIV]:1};
  let best=null,bestScore=-Infinity;
  for(const b of G.buildings){
    // Un mur n'est jamais une cible PRINCIPALE : c'est un obstacle passif.
    // Sans cette exclusion, un mur proche gagnait le score (distance très
    // faible) même avec sa priorité basse, et l'ennemi l'attaquait direct-
    // ement au lieu de chercher un chemin — la logique de repli plus bas
    // (n'attaquer un mur QUE si le pathfinding échoue vraiment) n'était
    // alors jamais consultée.
    if(!estHostile(src,b)||b.type===BT.WALL) continue;
    const d=Math.hypot(b.x-x,b.y-y);
    const p=prio[b.type]||0.5;
    // score : priorité élevée et proche = meilleur
    const score=p*200 - d;
    if(score>bestScore){bestScore=score;best=b;}
  }
  return best;
}

// ── CIBLAGE ─────────────────────────────────────────────
// Le ciblage était binaire (joueur contre 'enemy'). Il passe par estHostile(),
// qui connaît les équipes : indispensable dès qu'un troisième camp existe.
// `src` est l'entité qui cherche une cible (on lit son owner).
function prochainHostileUnite(x,y,r,src){
  return nearestBy(x,y,r,u=>u.hp>0&&estHostile(src,u));
}
// Unités ET bâtiments hostiles (les tours prennent aussi les bâtiments).
function prochainHostileToute(x,y,r,src){
  const u=prochainHostileUnite(x,y,r,src);
  if(u) return u;
  let best=null,bd=r;
  for(const b of G.buildings){
    if(b.hp<=0||!estHostile(src,b)) continue;
    const d=Math.hypot(b.x-x,b.y-y);
    if(d<bd){bd=d;best=b;}
  }
  return best;
}
// Allié (même camp) du type demandé — sert à l'IA et aux gardes.
function prochainAllieType(x,y,r,type,src){
  return nearestBy(x,y,r,u=>u.owner===(src&&src.owner)&&u.type===type);
}

// Enveloppes historiques, liées à la faction LOCALE : conservées pour le code
// d'interface (survol, mini-carte, anneaux de sélection) qui raisonne
// toujours du point de vue du joueur qui regarde.
function nearPlayerUnitType(x,y,r,type){
  return nearestBy(x,y,r,u=>estLocal(u)&&u.type===type);
}
function nearEnemy(x,y,r){
  return nearestBy(x,y,r,u=>u.hp>0&&estHostile(moi()&&{owner:G.me},u));
}
function nearEnemyAll(x,y,r){ return nearEnemy(x,y,r); }
function nearPlayerUnit(x,y,r){
  return nearestBy(x,y,r,u=>estLocal(u)&&u.hp>0);
}

// Couleur d'un camp sur la mini-carte (unités légèrement plus claires).
const COUL_FACTION={ bleu:['#3498db','#5dade2'], vert:['#27ae60','#52d68a'],
                     rouge:['#e74c3c','#ff6666'], violet:['#8e44ad','#b07cc6'] };
function couleurMinimap(e,unite){
  const f=fac(e), c=COUL_FACTION[f?f.teinte:'rouge']||COUL_FACTION.rouge;
  return unite?c[1]:c[0];
}

// Le booléen `isEnemy` ne servait qu'à colorer le trait : on mémorise
// désormais le camp tireur, qui donne la teinte ET crédite les dégâts.
// Le projectile emporte le PROFIL de son tireur (force + type d'unité), pas
// un nombre de dégâts figé au départ : il survit à son tireur, et un tir de
// siège touche en zone des cibles que celui-ci ne visait pas — chaque
// victime doit être résolue contre SA propre armure (voir updateProjs).
// `from` peut être une unité ou un pseudo-tireur de bâtiment (Tour/Château),
// qui n'a pas de `type` : degatsContre le traite alors comme un trait sans
// bonus de contre.
function shootProj(from,tgt){
  const d0=Math.max(1,Math.hypot(tgt.x-from.x,tgt.y-from.y));
  G.projs.push({id:G.nid++,x:from.x,y:from.y,tx:tgt.x,ty:tgt.y,
    targetId:tgt.id,
    atk:from.type!=null?from.atk*heroAuraMult(from):from.atk,
    srcType:from.type!=null?from.type:null,   // type d'UNITÉ du tireur (null = tir de bâtiment), pas le 'm'/'p' d'UDEF.atkType
    spd:8*BASE_TILE,owner:from.owner,life:1,d0,
    siege:!!(from.type&&UDEF[from.type]&&UDEF[from.type].siege),
    // Tireur exact, pour créditer l'XP de vétérance au bon endroit (voir
    // awardKillXP) — undefined pour un tir de bâtiment (Tour/Château, objet
    // sans id d'unité), qui n'a de toute façon pas de rang à gagner.
    shooterId:from.id});
}

// shake : secoue la caméra d'autant de pixels max (décroît vite, voir update()).
// Les impacts s'accumulent sans jamais dépasser la plus forte secousse en cours.
function shakeScreen(mag){ G.shake.mag=Math.max(G.shake.mag,mag); }

// `source` : l'entité (ou le camp) qui frappe — mémorisée sur la cible pour
// créditer le bon camp du kill ou de la destruction.
function dealDmg(tgt,dmg,source){
  if(source){
    tgt.dernierAgresseur=(typeof source==='string')?source:source.owner;
    // Retient aussi L'UNITÉ auteure du coup (pas seulement sa faction) : sert
    // à créditer la vétérance (awardKillXP) quand une garnison meurt avec le
    // bâtiment qui l'abritait, voir updateBuildings/Destruction.
    if(typeof source==='object'&&source.id!=null) tgt.dernierAgresseurUnit=source.id;
  }
  tgt.hp=Math.max(0,tgt.hp-dmg);
  sfx('hit');
  spawnParts(tgt.x,tgt.y,'#e74c3c',3);
  spawnParts(tgt.x,tgt.y,'#fff2b8',2); // étincelles claires : casse le nuage rouge uniforme, lit "impact" pas juste "blessure"
  addFText(tgt.x,tgt.y-10,`-${dmg}`,'#ff5544');
  tgt.hitFlash=0.15;
  if(dmg>=18) shakeScreen(Math.min(9,dmg*0.35)); // gros coup = secousse ressentie, pas juste un chiffre qui saute
  // alerte si un bâtiment du joueur est frappé (hors champ de vision surtout)
  if(estLocal(tgt)&&tgt.maxHp>=180&&typeof alertAttack==='function') alertAttack(tgt.x,tgt.y);
}

function updateProjs(dt){
  for(const p of G.projs){
    const dx=p.tx-p.x,dy=p.ty-p.y,d=Math.hypot(dx,dy);
    if(d<10){
      if(p.siege){
        // Dégâts de zone autour du point d'impact + secousse : un boulet de pierre doit se sentir
        spawnParts(p.tx,p.ty,'#aa8855',16);
        spawnParts(p.tx,p.ty,'#e0d8c8',6);
        shakeScreen(7);
        const splash=2*BASE_TILE;
        // Chaque victime de la zone est résolue contre SA propre armure :
        // un boulet qui rase un mur ne fait pas les mêmes dégâts au piquier
        // planté à côté. C'est précisément ce qu'un montant figé au départ
        // ne pouvait pas exprimer.
        const prof={atk:p.atk,type:p.srcType};
        for(const u of G.units){
          if(estHostile(p,u)&&Math.hypot(u.x-p.tx,u.y-p.ty)<splash){ dealDmg(u,degatsContre(prof,u),p); if(u.hp<=0) awardKillXP(p.shooterId); }
        }
        for(const b of G.buildings){
          // Même crédit d'XP que le tir ciblé ci-dessous (else) : sans le
          // if(b.hp<=0) awardKillXP, un Trébuchet — qui tire quasi toujours
          // en zone — ne montait jamais en grade en rasant des bâtiments,
          // pourtant son usage principal.
          if(estHostile(p,b)&&Math.hypot(b.x-p.tx,b.y-p.ty)<splash){ dealDmg(b,degatsContre(prof,b),p); if(b.hp<=0) awardKillXP(p.shooterId); }
        }
      } else {
        const t=unitById(p.targetId)||bldById(p.targetId);
        if(t&&t.hp>0){ dealDmg(t,degatsContre({atk:p.atk,type:p.srcType},t),p); if(t.hp<=0) awardKillXP(p.shooterId); }
      }
      p.life=0;
    } else {
      const s=p.spd*dt;
      p.x+=dx/d*s; p.y+=dy/d*s;
    }
  }
  G.projs=G.projs.filter(p=>p.life>0);
}

// Plafonds des effets purement décoratifs. Une grande bataille (ou la
// vitesse ×3, ou une partie laissée tourner) peut en accumuler des milliers
// sans qu'aucun n'apporte plus rien à l'écran : au-delà, on abandonne les
// PLUS ANCIENS, ceux qui sont déjà presque éteints.
const MAX_PARTS=400, MAX_FTEXTS=80, MAX_DEATHFX=60;
function plafonner(arr,max){ return arr.length>max?arr.slice(arr.length-max):arr; }

function updateParts(dt){
  for(const p of G.parts){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt*1.6;}
  G.parts=plafonner(G.parts.filter(p=>p.life>0),MAX_PARTS);
}

function updateFTexts(dt){
  for(const ft of G.ftexts){ft.y-=22*dt;ft.life-=dt*.8;}
  G.ftexts=plafonner(G.ftexts.filter(ft=>ft.life>0),MAX_FTEXTS);
}

function updateDeathFx(dt){
  for(const d of G.deathfx) d.life-=dt*1.7;
  G.deathfx=plafonner(G.deathfx.filter(d=>d.life>0),MAX_DEATHFX);
}

function spawnParts(x,y,col,n){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2,s=Math.random()*60+20;
    G.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-25,col,r:1.5+Math.random()*2,life:1});
  }
}

function addFText(x,y,txt,col){
  G.ftexts.push({x,y,txt,col,life:1});
}

function updateWaves(dt){
  // Mode Conquête : aucune vague scriptée — la barre du haut sert à suivre
  // l'adversaire vivant à la place (voir refreshConquestBar).
  if(G.gmode!=='survival'){ refreshConquestBar(); return; }
  // Retour en Survie (chargement d'une sauvegarde depuis une partie de
  // Conquête) : on rétablit l'affichage du compteur de vagues.
  {
    const sv=document.getElementById('wb-survival'), cq=document.getElementById('wb-conquest');
    if(sv&&sv.style.display==='none'){ sv.style.display=''; if(cq) cq.style.display='none'; }
  }
  if(G.waveActive){
    // Les gardes de point d'intérêt (u.camp) sont des ennemis permanents,
    // indépendants des vagues : ils ne doivent jamais compter comme "vague
    // repoussée", sans quoi une garnison encore vivante bloquerait à jamais
    // la détection de fin de vague.
    if(G.units.filter(u=>u.owner===FAC.PILL&&!u.camp).length===0){
      const diff=DIFFS[G.difficulty]||DIFFS.normal;
      G.waveActive=false;
      const reward=Math.round((50+G.wave*20)*diff.rewardMult);
      G.res.gold+=reward;
      notify(`✅ Vague ${G.wave} repoussée ! +${reward}💰`,'#2ecc71');
      G.waveTimer=Math.max(WAVE_MIN_DELAY, (WAVE_BASE_DELAY-G.wave*18)*diff.waveDelayMult);
      _autoTimer=0; autoSave('vague '+G.wave);
    }
    document.getElementById('wtimer').textContent='⚔️ EN COURS';
    return;
  }
  G.waveTimer-=dt;
  const m=Math.floor(G.waveTimer/60), s=Math.ceil(G.waveTimer%60);
  document.getElementById('wtimer').textContent=G.waveTimer>60?`${m}m${String(s).padStart(2,'0')}`:Math.ceil(G.waveTimer)+'s';
  if(G.waveTimer<=0) spawnWave();
}

function spawnWave(){
  const diff=DIFFS[G.difficulty]||DIFFS.normal;
  G.wave++;
  document.getElementById('wnum').textContent=G.wave;
  G.waveActive=true;
  sfx('wave');
  const isBoss=G.wave%5===0;
  // Effectif de base à difficulté Normal, puis mis à l'échelle par diff.enemyCount —
  // au moins 1 pillard de base pour ne jamais annuler complètement une vague.
  const cnt=Math.max(1,Math.round((2+Math.ceil(G.wave*1.3))*diff.enemyCount));
  const arcs=Math.round((G.wave>=4?Math.floor((G.wave-3)/2):0)*diff.enemyCount);
  const cavs=Math.round((G.wave>=7?Math.floor((G.wave-6)/2):0)*diff.enemyCount);
  const giants=Math.round((G.wave>=10?Math.floor((G.wave-9)/3):0)*diff.enemyCount);
  const total=cnt+arcs+cavs+giants;

  if(isBoss){
    bigBanner(`☠️ VAGUE BOSS ${G.wave} ☠️`);
    notify(`☠️ Un Seigneur de Guerre approche !`,'#e74c3c');
  } else {
    notify(`⚠️ Vague ${G.wave} ! (${total} ennemis)`,'#e74c3c');
  }

  const spawn=(type,scaleHp,scaleAtk)=>{
    // tirage rejeté tant que la case est de l'eau ou un mur : un pillard
    // apparu dans un lac partait avec plusieurs secondes de handicap.
    let x,y,tries=0;
    do{
      const e=['top','bottom','left','right'][Math.random()*4|0];
      if(e==='top')        {x=Math.random()*COLS*BASE_TILE; y=BASE_TILE*2;}
      else if(e==='bottom'){x=Math.random()*COLS*BASE_TILE; y=(ROWS-2)*BASE_TILE;}
      else if(e==='left')  {x=BASE_TILE*2; y=Math.random()*ROWS*BASE_TILE;}
      else                 {x=(COLS-2)*BASE_TILE; y=Math.random()*ROWS*BASE_TILE;}
    } while(++tries<40 && tileBlocked((x/BASE_TILE)|0,(y/BASE_TILE)|0));
    const u=mkUnit(type,x,y,FAC.PILL);
    u.hp=Math.round(u.hp*(1+G.wave*.07)*scaleHp*diff.enemyHp); u.maxHp=u.hp;
    u.atk=Math.round(u.atk*(1+G.wave*.05)*scaleAtk*diff.enemyAtk);
    u.spd=u.spd*Math.min(1.6,0.85+G.wave*0.03);
    G.units.push(u);
  };

  for(let i=0;i<cnt;i++)    spawn(UT.ENEMI,1,1);
  for(let i=0;i<arcs;i++)   spawn(UT.ENEMIA,1,1);
  for(let i=0;i<cavs;i++)   spawn(UT.ENEMI_C,1,1);
  for(let i=0;i<giants;i++) spawn(UT.ENEMI_G,1,1);
  if(isBoss) spawn(UT.ENEMI_BOSS,1+G.wave*0.04,1);
}
