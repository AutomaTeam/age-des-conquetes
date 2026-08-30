'use strict';
// ======================================================================
//  14-demarrage.js
// ======================================================================
// Boucle de jeu, palissade de l'Arene, demarrage de partie et
// branchements finaux de l'interface.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── BOUCLE DE JEU ─────────────────────────────────────────
// Pas de simulation FIXE (30 Hz), découplé du taux de rafraîchissement de
// l'écran : sur un moniteur 144 Hz l'ancienne boucle simulait ~2,4× plus vite
// qu'à 60 Hz puisque `update(dt)` était rejoué `G.speed` fois avec le dt réel
// de la frame. Ici on accumule le temps réel (multiplié par la vitesse de
// jeu) et on égrène des pas de durée constante SIM_DT — la vitesse de jeu
// n'est plus qu'un facteur qui accélère l'accumulation, jamais le pas
// lui-même. Prérequis pour que des numéros de tick réseau aient un sens.
const SIM_HZ=30, SIM_DT=1/SIM_HZ, SIM_MAX_STEPS=5; // anti « spirale de la mort »
let _simAccum=0;
function loop(ts){
  if(!G.running) return;
  if(G.paused){ G.lastTime=null; _simAccum=0; return; }
  let frameDt=Math.min((ts-(G.lastTime||ts))/1000,.25);
  G.lastTime=ts;
  _simAccum+=frameDt*G.speed;
  let steps=0;
  while(_simAccum>=SIM_DT&&steps<SIM_MAX_STEPS){
    // Le client ne simule RIEN : l'hôte est seul autoritaire. Il se contente
    // d'interpoler vers l'état reçu et de faire vivre les effets locaux.
    if(estHote()) update(SIM_DT); else updateVisuel(SIM_DT);
    if(estHote()) pousserReseau(SIM_DT);
    _simAccum-=SIM_DT;
    steps++;
  }
  if(steps>=SIM_MAX_STEPS) _simAccum=0; // décroche plutôt que de spiraler si la machine rame
  const dt=frameDt; // pour le rafraîchissement UI ci-dessous (cadence réelle, pas simulée)
  // Caméra au clavier : à la cadence d'AFFICHAGE et non au pas de simulation
  // (voir updateCamClavier) — sinon elle irait deux fois plus vite en ×2, et
  // ne bougerait plus du tout chez le client d'une partie en ligne.
  updateCamClavier(dt);
  render();
  updateHUD();
  _uiRefreshCd-=dt;
  if(_uiRefreshCd<=0){
    _uiRefreshCd=0.5;
    if(G.sel.length===1){ const b=bldById(G.sel[0]); if(!(b&&b.constructing)) refreshUI(); }
  }
  if(G.sel.length===1){
    // Par l'INDEX, pas par un balayage : ces deux lignes tournaient à chaque
    // image et parcouraient tout G.units (jusqu'à 900 entrées) pour retrouver
    // une entité dont la table id -> entité donne l'adresse directe. Elle est
    // reconstruite à chaque pas de simulation par rebuildGrid, aussi bien chez
    // l'hôte (update) que chez le client (updateVisuel).
    const e=unitById(G.sel[0])||bldById(G.sel[0]);
    if(e) updateSelInfo(e);
  }
  requestAnimationFrame(loop);
}

// ── ARÈNE : palissade de départ ────────────────────────────────
// Un anneau de palissade autour d'un Centre Ville, percé de QUATRE PORTAILS
// OUVERTS (un par face). Les portails sont indispensables : un mur pose
// bmap=3, donc un anneau plein enfermerait les villageois loin de tout
// gisement et le camp mourrait de faim — c'est exactement le risque qui a
// fait écarter les murs de l'IA au chantier 4. Ouverts, ils laissent passer
// (appliquerPortail met la case a 0) tout en restant fermables d'un clic.
//
// Une case d'EAU ou de batiment (bmap 3) est sautee : un mur qui ecrase un
// lac serait pire que pas de mur, et l'eau bloque deja les unites terrestres,
// donc l'anneau reste etanche.
//
// Une case de GISEMENT (bmap 2), en revanche, ne doit PAS etre sautee : un
// arbre ne bloque rien (bmap 2 n'est pas 3, voir estBloque), donc chaque
// arbre pris dans le trace ouvrait une breche franchissable dans l'enceinte
// — on entrait dans l'arene en passant « entre la palissade et l'arbre ».
// Le gisement est donc degage sous la palissade. C'est deterministe (meme
// graine, memes gisements, memes retraits), donc l'hote et le client
// obtiennent la meme enceinte.
function poserMursArene(tx,ty,w,h,owner){
  const r=6;                                   // rayon de l'enceinte, en cases
  const x0=tx+(w>>1)-r, y0=ty+(h>>1)-r, x1=tx+(w>>1)+r, y1=ty+(h>>1)+r;
  const mx=(x0+x1)>>1, my=(y0+y1)>>1;          // milieux de face : les portails
  const poses=[];
  for(let x=x0;x<=x1;x++) for(const y of [y0,y1]) poses.push([x,y,(x===mx)]);
  for(let y=y0+1;y<y1;y++) for(const x of [x0,x1]) poses.push([x,y,(y===my)]);
  let murs=0, portails=0, degages=0;
  for(const [x,y,estPortail] of poses){
    if(x<1||y<1||x>=COLS-1||y>=ROWS-1) continue;
    // Gisement sur le trace : on le degage plutot que de laisser une breche.
    if(G.bmap[y][x]===2){
      for(const nd of G.nodes) if(nd.tx===x&&nd.ty===y&&nd.amt>0){ nd.amt=0; degages++; }
      G.bmap[y][x]=0;
    }
    if(G.bmap[y][x]!==0) continue;             // eau, batiment : on saute
    const b=mkBuilding(estPortail?BT.GATE:BT.WALL,x,y,owner);
    b.constructing=false; b.progress=1;
    // `open:true` AVANT placeBuilding : celui-ci lit deja b.open pour choisir
    // sa marque (0 si ouvert, 3 sinon), donc rien a rebasculer ensuite.
    // Et surtout PAS de G.buildings.push() ici : placeBuilding pousse
    // lui-meme. Le faire en plus inserait chaque mur DEUX FOIS dans la liste
    // (mesure : 94 batiments pour un anneau de 47), avec le meme id — tout
    // ce qui balaye G.buildings aurait compte double.
    if(estPortail) b.open=true;
    placeBuilding(b);
    if(estPortail) portails++; else murs++;
  }
  return {murs,portails,degages};
}

// ── DÉMARRAGE ─────────────────────────────────────────────
// Champ graine de l'écran-titre. Vide = tirage aléatoire à chaque partie
// (comportement historique) ; renseigné = carte reproductible à l'identique,
// et socle de l'accord de carte entre deux joueurs en multijoueur.
function setGraine(v){
  const t=String(v==null?'':v).trim();
  if(!t){ grainePartie=null; return; }
  const k=parseInt(t.replace(/[^0-9]/g,''),10);
  // La graine utilisée doit être CELLE QUE LE JOUEUR A TAPÉE : elle se
  // partage entre joueurs, la voir changer sous ses yeux serait déroutant.
  // Seule contrainte de srnd : rester dans 1..2147483646.
  grainePartie=(isNaN(k)||k<=0)?null:((k%2147483646)||1);
}
window.setGraine=setGraine;
function viderGraine(){
  grainePartie=null;
  const el=document.getElementById('seedin');
  if(el) el.value='';
  notify('\u{1F3B2} Carte aléatoire à chaque partie','#95a5a6');
}
window.viderGraine=viderGraine;
// Affiche la graine réellement utilisée, pour la rejouer ou la partager.
function afficherGraine(){
  const el=document.getElementById('seedin');
  if(el&&G.seed) el.value=G.seed;
}

function startGame(){
  SFX.unlock();                     // le clic sur « Commencer » autorise l'audio (iOS)
  document.getElementById('overlay').style.display='none';
  resizeCanvas();
  initState();
  TILE=Math.round(BASE_TILE*ZOOMS[zoomLevel]);
  genMap();
  buildSprites(); // pré-rendu du pixel art

  // Centre-ville de départ. En solo le joueur reste au centre (comportement
  // historique) ; dès qu'un second humain existe, les deux prennent des
  // départs répartis sur un anneau, déterministes, pour que la partie soit
  // équitable et identique des deux côtés de la connexion. Les emplacements
  // ont été arrêtés par genMap (voir departsHumains/resoudreDeparts), qui a
  // aussi réservé la place : les relire ici plutôt que les recalculer garan-
  // tit qu'on pose bien les Centres Villes là où le terrain a été dégagé.
  const dep=(G.departs&&G.departs.length)?G.departs:resoudreDeparts();
  const sTX=dep[0][0], sTY=dep[0][1];
  const tc=mkBuilding(BT.TC,sTX,sTY,FAC.P1);
  placeBuilding(tc);
  // Libère la marge de réservation (le Centre Ville lui-même est déjà
  // correctement marqué solide par placeBuilding juste au-dessus).
  for(let y=sTY-1;y<=sTY+tc.h;y++) for(let x=sTX-1;x<=sTX+tc.w;x++){
    if(x>=0&&y>=0&&x<COLS&&y<ROWS&&G.bmap[y][x]===9) G.bmap[y][x]=0;
  }

  if(carteCfg().murs) poserMursArene(sTX,sTY,tc.w,tc.h,FAC.P1);

  // 3 Villageois (+ le bonus de civilisation : les Chinois en ont 5)
  const nVil=3+(civOf(FAC.P1).vilBonusDepart||0);
  for(let i=0;i<nVil;i++){
    const u=mkUnit(UT.VIL,(sTX+1.5)*BASE_TILE+(i-(nVil-1)/2)*BASE_TILE*.9,(sTY+3)*BASE_TILE,FAC.P1);
    G.units.push(u); G.pop++;
  }

  // Mode Conquête : l'adversaire s'installe une fois la carte semée et le
  // Centre Ville du joueur posé, pour choisir son emplacement en connaissance
  // du terrain réellement occupé.
  // Emplacements deja occupes : les IA devront s'en ecarter.
  const prisSurCarte=[[sTX,sTY]];

  // Base du second joueur humain (partie en ligne). Meme dotation de depart
  // que l'hote, a l'ancrage oppose calcule par departsHumains().
  if(G.factions[FAC.P2]&&dep.length>1){
    const [pTX,pTY]=dep[1];
    const tc2=mkBuilding(BT.TC,pTX,pTY,FAC.P2);
    placeBuilding(tc2);
    for(let y=pTY-1;y<=pTY+tc2.h;y++) for(let x=pTX-1;x<=pTX+tc2.w;x++){
      if(x>=0&&y>=0&&x<COLS&&y<ROWS&&G.bmap[y][x]===9) G.bmap[y][x]=0;
    }
    if(carteCfg().murs) poserMursArene(pTX,pTY,tc2.w,tc2.h,FAC.P2);
    // Meme dotation que le joueur local, bonus de civilisation compris :
    // sans ce miroir, un invite jouant Chinois demarrerait avec 3 villageois
    // au lieu de 5 et sa civilisation ne vaudrait rien en ligne.
    const nVil2=3+(civOf(FAC.P2).vilBonusDepart||0);
    for(let i=0;i<nVil2;i++){
      const u=mkUnit(UT.VIL,(pTX+1.5)*BASE_TILE+(i-(nVil2-1)/2)*BASE_TILE*.9,(pTY+3)*BASE_TILE,FAC.P2);
      G.units.push(u); G.factions[FAC.P2].pop++;
    }
    prisSurCarte.push([pTX,pTY]); // les IA s'ecartent aussi de cette base
  }

  // Autant d'adversaires IA que le mode en réclame. Chacun s'installe en
  // tenant compte des bases déjà posées (joueur compris) pour ne pas se
  // retrouver à partager les mêmes gisements.
  const nbRivaux=MODES[G.gmode].rivaux||0;
  const idsIA=[FAC.IA,FAC.IA2], nomsIA=['Seigneur rival','Seigneur rival II'];
  for(let i=0;i<nbRivaux;i++){
    const a=initAI(sTX,sTY,idsIA[i],nomsIA[i],prisSurCarte);
    if(a) prisSurCarte.push([Math.round(a.baseX/BASE_TILE),Math.round(a.baseY/BASE_TILE)]);
  }

  // Caméra sur le TC
  camCenterOn((sTX+1.5)*BASE_TILE,(sTY+1.5)*BASE_TILE);

  afficherGraine(); // le joueur peut relire ou partager la graine de SA partie
  G.running=true;
  setSpeed(1);
  rebuildIndex(); // sans quoi toute resolution par id echoue avant la 1ere image
  revealFog();
  applyDifficultyBadge();
  syncAutoRepairBtn(); // repart toujours désactivé (voir initState) — resynchronise le bouton après une partie précédente
  refreshUI();
  requestAnimationFrame(loop);

  // Messages de bienvenue — remplacés par le tutoriel pas à pas (ci-dessous)
  // au tout premier lancement en solo, pour ne pas dire deux fois la même
  // chose sur l'écran.
  const premierePartie=tutoDoitDemarrer();
  if(!premierePartie){
    setTimeout(()=>notify('Sélectionnez un villageois, puis tapez une ressource !','#f0c040'),600);
    setTimeout(()=>notify('🪵 Récoltez du bois puis construisez des Maisons !','#e8d5a0'),3200);
  }
  if(G.gmode!=='survival'){
    const nb=MODES[G.gmode].rivaux||1;
    const coop=!!MODES[G.gmode].coop&&!!G.factions[FAC.P2];
    setTimeout(()=>notify(coop?'🤝 Vous et votre allié affrontez ensemble un seul seigneur rival.'
                              :nb>1?'🏴 Deux seigneurs rivaux bâtissent leurs cités — et se combattent entre eux.'
                              :'🏴 Un seigneur rival bâtit sa cité à l\'autre bout de la carte.','#e67e22'),6200);
    setTimeout(()=>notify('🏰 Rasez leur Centre Ville pour l\'emporter — explorez pour les trouver !','#f0c040'),9200);
  } else {
    setTimeout(()=>notify(`⏳ ${peaceLabel()} avant la 1ère attaque — montez les âges !`,'#2ecc71'),6200);
    setTimeout(()=>notify('🏆 Des points d\'intérêt (or illimité, lourdement gardés) sont dispersés sur la carte !','#f0c040'),9200);
  }
  setTimeout(()=>bigBanner('🌑 Âge Sombre'),900);
  if(premierePartie) setTimeout(tutoDemarrer,1400);
}
window.startGame=startGame;

// ── BADGE VILLAGEOIS INACTIFS ──────────────────────────────
document.getElementById('idlebtn-inner').addEventListener('click',()=>{
  if(!G.running) return;
  const idleVils=G.units.filter(u=>estLocal(u)&&u.type===UT.VIL&&u.state==='idle');
  if(!idleVils.length) return;
  // Tourner parmi les inactifs si on en a déjà un de sélectionné
  let chosen=idleVils[0];
  if(G.sel.length===1){
    const curIdx=idleVils.findIndex(u=>u.id===G.sel[0]);
    if(curIdx>=0) chosen=idleVils[(curIdx+1)%idleVils.length];
  }
  G.sel=[chosen.id];
  // Centrer la caméra sur le villageois
  camCenterOn(chosen.x,chosen.y);
  refreshUI();
  notify(`👷 Villageois inactif sélectionné !`,'#3498db');
});

window.addEventListener('resize',()=>{ resizeCanvas(); });

// ── PREVENT SCROLL ────────────────────────────────────────
// Empêche le rebond/pinch-zoom du navigateur PENDANT UNE PARTIE (glisser sur
// le <canvas> pour déplacer la caméra, pincer pour zoomer — canvas.addEven-
// tListener('touchmove',...) plus haut gère déjà son propre geste). Sans le
// `e.target===canvas` ici aussi (touchstart l'avait, touchmove ne l'avait
// pas), CE handler global bloquait tout défilement tactile ailleurs dans le
// document — écran-titre, menu pause, classement, tutoriel... tous pourtant
// en `overflow-y:auto;touch-action:pan-y` pour être défilables au doigt.
document.body.addEventListener('touchstart',e=>{if(e.target===canvas)e.preventDefault();},{passive:false});
document.body.addEventListener('touchmove',e=>{if(e.target===canvas)e.preventDefault();},{passive:false});
document.body.addEventListener('contextmenu',e=>e.preventDefault());
