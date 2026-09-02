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
  syncShelterBtn(); // idem : aucun villageois en garnison au démarrage, sauf reprise d'une sauvegarde
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

// ══════════════════════════════════════════════════════════
//  BANC D'ESSAI (écran-titre)
// ══════════════════════════════════════════════════════════
// Mesure la machine sur le VRAI moteur, pas sur une boucle de calcul
// synthétique : les trois postes chronométrés sont exactement ceux qui
// coûtent en jeu (mesuré, voir les invariants de performance) —
//   1. l'ATLAS de sprites, l'opération la plus lourde du jeu (elle se rejoue
//      à chaque changement de zoom) ;
//   2. la SIMULATION, qui porte le pathfinding, le ciblage et la séparation
//      des unités — le poste qui grossit avec la population ;
//   3. le RENDU d'une image complète.
// Un score synthétique n'aurait rien dit d'utile : une machine peut être
// bonne en calcul pur et mauvaise en canvas 2D, et c'est le canvas qui
// décide ici.
//
// La charge est IDENTIQUE partout (graine, taille de carte, effectifs et
// nombre d'itérations figés) : deux machines comparent bien la même chose.
const BENCH={
  GRAINE:20260902, TAILLE:'normale', CARTE:'plaines',
  UNITES:220,            // effectif réaliste de milieu/fin de partie
  PAS_SIM:150, IMAGES:90,
  CHAUFFE_SIM:40, CHAUFFE_RENDU:8,   // voir la note sur la chauffe, plus bas
  // Temps de référence en ms, RELEVÉS APRÈS CHAUFFE sur la machine étalon
  // (Windows 11, Chrome, 24 cœurs, DPR 1,25) : un score de 1000 par poste =
  // cette machine. Ces trois nombres sont le seul étalonnage du banc.
  REF:{atlas:36, sim:0.42, rendu:1.20},
  // Surcoût par image qui n'est PAS dans render() : composition du navigateur,
  // HUD, rAF. Mesuré en jeu réel sur la machine étalon (image à 4,2 ms pour
  // 1,31 ms de rendu et 0,49 ms de simulation) — sans lui, l'estimation
  // d'images/s annonçait 622 là où le jeu en affichait 238.
  SURCOUT_IMAGE:2.4,
  // Poids : le rendu et la simulation pèsent le plus lourd (ils tournent à
  // chaque image), l'atlas ne se paie qu'aux changements de zoom.
  POIDS:{atlas:0.2, sim:0.4, rendu:0.4},
};
const BENCH_PALIERS=[
  {min:1400, nom:'Forge de guerre',  ico:'🔥', txt:'Tout à fond : grande carte, 4 camps, zoom libre. La machine n’est pas la limite.'},
  {min:900,  nom:'Solide',           ico:'⚔️', txt:'Confortable partout. Grande carte et mode 2 rivaux sans réserve.'},
  {min:550,  nom:'Correct',          ico:'🛡️', txt:'À l’aise en carte normale. La grande carte reste jouable, avec quelques à-coups en fin de partie.'},
  {min:300,  nom:'Juste ce qu’il faut',ico:'🪓',txt:'Préférez les cartes petite ou moyenne, et évitez le mode 2 rivaux en grande carte.'},
  {min:0,    nom:'Terrain difficile',ico:'🐌', txt:'Carte petite conseillée, vitesse ×1. Fermer les autres onglets aide beaucoup.'},
];

let _benchEnCours=false;
function ouvrirBenchmark(){
  document.getElementById('benchpanel').style.display='flex';
  const c=document.getElementById('benchcorps');
  c.innerHTML='<p class="benchsub">Le banc rejoue les trois opérations qui coûtent réellement en jeu — construction des sprites, simulation, rendu — sur une charge identique pour toutes les machines.<br><br>Comptez une quinzaine de secondes, sans changer d’onglet : un onglet en arrière-plan est délibérément ralenti par le navigateur et fausserait la mesure.</p>'
    +'<button class="bigbtn sheen" id="benchgo" onclick="lancerBenchmark()">▶️ Lancer le test</button>';
}
function fermerBenchmark(){
  if(_benchEnCours) return;                    // jamais au milieu d'une mesure
  document.getElementById('benchpanel').style.display='none';
}
window.ouvrirBenchmark=ouvrirBenchmark; window.fermerBenchmark=fermerBenchmark;

// Rend la main au navigateur entre deux phases : sans ça tout le banc
// s'exécute dans une seule tâche, la barre de progression ne se peint jamais
// et l'onglet paraît figé.
const benchSouffler=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));

function benchProgres(pct,txt){
  const b=document.getElementById('benchbarre'), t=document.getElementById('benchetat');
  if(b) b.style.width=Math.round(pct*100)+'%';
  if(t) t.textContent=txt;
}

async function lancerBenchmark(){
  if(_benchEnCours) return;
  _benchEnCours=true;
  const c=document.getElementById('benchcorps');
  c.innerHTML='<div class="benchjauge"><div id="benchbarre"></div></div>'
    +'<p class="benchsub" id="benchetat">Préparation…</p>';

  // L'écran-titre a ses propres choix (mode, carte, taille, graine) : le banc
  // en impose d'autres pour être comparable, on les remet donc ensuite.
  const sauve={mode:selectedMode, carte:selectedCarte, taille:selectedTaille,
               civ:selectedCiv, diff:selectedDifficulty, graine:grainePartie, tile:TILE};
  const res={};
  try{
    selectedMode='survival'; selectedCarte=BENCH.CARTE;
    pickTaille(BENCH.TAILLE); grainePartie=BENCH.GRAINE;
    resizeCanvas();
    await benchSouffler();

    // ── 1. Carte + atlas de sprites ──
    // CHAUFFE OBLIGATOIRE, et c'est le piège principal de ce banc : mesuré,
    // le tout premier atlas coûte 317 ms et les suivants 35 ms — un rapport
    // de NEUF. Le premier paie le décodage des planches illustrées et leur
    // détourage, qui sont ensuite mis en cache (voir TRIM_CACHE/BLD_IMG_CACHE
    // dans 05-sprites.js). Chronométrer le premier donnerait donc un score
    // qui dépend surtout de « est-ce la première fois que vous cliquez ? ».
    // On mesure le régime ÉTABLI, celui qu'on paie réellement à chaque zoom
    // pendant une partie. Même raison pour la simulation et le rendu : V8 a
    // besoin de quelques tours avant de compiler pour de bon.
    benchProgres(0.05,'Génération de la carte…');
    initState(); genMap();
    await benchSouffler();
    benchProgres(0.12,'Préparation des sprites…');
    buildSprites(sprRungFor(BASE_TILE));           // chauffe, NON mesurée
    await benchSouffler();
    // MEILLEUR de trois, et pas la moyenne : reconstruire l'atlas alloue
    // ~250 canvas d'un coup, donc un passage tombe parfois en pleine collecte
    // mémoire. Mesuré sur quatre essais d'affilée : 30, 64, 56 puis 79 ms pour
    // le même travail — de quoi faire varier le rang affiché. Le bruit ne peut
    // que RALENTIR, jamais accélérer : le minimum est donc l'estimation
    // honnête de ce dont la machine est capable, et c'est ce que font les
    // bancs d'essai sérieux.
    for(let e=0;e<3;e++){
      benchProgres(0.16+e*0.04,'Construction des sprites…');
      const t=performance.now();
      buildSprites(sprRungFor(BASE_TILE));
      const d=performance.now()-t;
      res.atlas=(res.atlas==null)?d:Math.min(res.atlas,d);
      await benchSouffler();
    }

    // ── 2. Simulation ──
    // On peuple avec des unités RÉPARTIES (le piège documenté : les entasser
    // au même pixel donne un profil qui n'a rien à voir avec une partie).
    benchProgres(0.3,'Mise en place des troupes…');
    const dep=(G.departs&&G.departs.length)?G.departs:resoudreDeparts();
    const tc=mkBuilding(BT.TC,dep[0][0],dep[0][1],FAC.P1); placeBuilding(tc);
    let sx=0;
    for(let i=0;i<BENCH.UNITES;i++){
      const a=i*2.399963, r=(1+(i%9))*BASE_TILE*2.2;   // spirale : réparties, pas empilées
      const x=Math.max(BASE_TILE,Math.min((COLS-1)*BASE_TILE,tc.x+Math.cos(a)*r));
      const y=Math.max(BASE_TILE,Math.min((ROWS-1)*BASE_TILE,tc.y+Math.sin(a)*r));
      const t=(i%5===0)?UT.ARC:(i%7===0)?UT.VIL:UT.MIL;
      const u=mkUnit(t,x,y,FAC.P1);
      u.state='moving'; u.destX=tc.x; u.destY=tc.y;     // tout le monde en mouvement
      G.units.push(u); sx++;
    }
    rebuildIndex(); rebuildGrid();
    await benchSouffler();
    for(let k=0;k<BENCH.CHAUFFE_SIM;k++) update(SIM_DT);   // chauffe, NON mesurée
    await benchSouffler();
    // Même principe qu'au-dessus : deux séries, on garde la meilleure.
    for(let e=0;e<2;e++){
      benchProgres(0.5+e*0.08,`Simulation de ${sx} unités…`);
      const t=performance.now();
      for(let k=0;k<BENCH.PAS_SIM;k++) update(SIM_DT);
      const d=(performance.now()-t)/BENCH.PAS_SIM;
      res.sim=(res.sim==null)?d:Math.min(res.sim,d);
      await benchSouffler();
    }

    // ── 3. Rendu ──
    camCenterOn(tc.x,tc.y);
    for(let k=0;k<BENCH.CHAUFFE_RENDU;k++) render();       // chauffe, NON mesurée
    await benchSouffler();
    for(let e=0;e<2;e++){
      benchProgres(0.72+e*0.1,'Rendu…');
      const t=performance.now();
      for(let k=0;k<BENCH.IMAGES;k++) render();
      const d=(performance.now()-t)/BENCH.IMAGES;
      res.rendu=(res.rendu==null)?d:Math.min(res.rendu,d);
      await benchSouffler();
    }
    benchProgres(0.95,'Calcul du score…');
    await benchSouffler();
  } catch(e){
    _benchEnCours=false;
    c.innerHTML='<p class="benchsub">Le test n’a pas pu aller au bout ('+(e&&e.message?e.message:'erreur')+').</p>'
      +'<button class="bigbtn" onclick="ouvrirBenchmark()">Réessayer</button>';
    return;
  } finally {
    // Remise en état : le banc a écrasé G, la carte et les sprites. On rend
    // l'écran-titre exactement comme on l'a trouvé, sinon « Commencer la
    // partie » repartirait sur la carte du banc.
    selectedMode=sauve.mode; selectedCarte=sauve.carte; pickTaille(sauve.taille);
    selectedCiv=sauve.civ; selectedDifficulty=sauve.diff; grainePartie=sauve.graine;
    TILE=sauve.tile;
    G.running=false; G.units.length=0; G.buildings.length=0;
  }
  _benchEnCours=false;
  afficherResultatBenchmark(res);
}
window.lancerBenchmark=lancerBenchmark;

// Score : rapport au temps de référence, borné, puis moyenne pondérée.
// Plus haut = mieux. Le plafond de 3 évite qu'un poste très rapide (un atlas
// mis en cache par le navigateur, par exemple) n'écrase les deux autres.
function benchScore(res){
  const part=(ref,vu)=>Math.max(0.05,Math.min(3,ref/Math.max(0.0001,vu)));
  const a=part(BENCH.REF.atlas,res.atlas), s=part(BENCH.REF.sim,res.sim), r=part(BENCH.REF.rendu,res.rendu);
  const g=a*BENCH.POIDS.atlas+s*BENCH.POIDS.sim+r*BENCH.POIDS.rendu;
  return {points:Math.round(g*1000), a:Math.round(a*1000), s:Math.round(s*1000), r:Math.round(r*1000)};
}

function afficherResultatBenchmark(res){
  const sc=benchScore(res);
  const palier=BENCH_PALIERS.find(p=>sc.points>=p.min)||BENCH_PALIERS[BENCH_PALIERS.length-1];
  // Images par seconde ESTIMÉES : une image paie un rendu, un demi pas de
  // simulation (30 pas/s pour 60 images/s) ET le surcoût du navigateur, qui
  // domine sur une machine rapide. Plafonné à 240 : au-delà c'est l'écran qui
  // décide, plus le jeu — annoncer « 622 images/s » serait une promesse que
  // le moniteur ne tiendra pas.
  const fps=Math.min(240,Math.round(1000/Math.max(0.01,res.rendu+res.sim/2+BENCH.SURCOUT_IMAGE)));
  const nav=navigator.hardwareConcurrency?navigator.hardwareConcurrency+' cœurs':'cœurs inconnus';
  const mem=navigator.deviceMemory?' · '+navigator.deviceMemory+' Go':'';
  const ligne=(nom,val,pts,det)=>`<div class="benchrow"><span class="bn">${nom}</span>`
    +`<span class="bv">${val}</span><span class="bp">${pts}</span></div>`
    +`<div class="benchdet">${det}</div>`;
  document.getElementById('benchcorps').innerHTML=
    `<div class="benchscore"><div class="bsico">${palier.ico}</div>`
    +`<div class="bspts">${sc.points}</div><div class="bslbl">points</div>`
    +`<div class="bsrang">${palier.nom}</div></div>`
    +`<p class="benchsub">${palier.txt}</p>`
    +`<div class="benchtable">`
    +ligne('🎨 Sprites',Math.round(res.atlas)+' ms',sc.a,'Reconstruction complète de l’atlas — ce qu’on paie à chaque changement de zoom.')
    +ligne('⚙️ Simulation',res.sim.toFixed(2)+' ms',sc.s,`Un pas de jeu avec ${BENCH.UNITES} unités en mouvement (déplacement, ciblage, séparation).`)
    +ligne('🖼️ Rendu',res.rendu.toFixed(2)+' ms',sc.r,'Une image complète : sol, bâtiments, unités, brouillard.')
    +`</div>`
    +`<p class="benchsub">≈ <strong>${fps} images/s</strong> estimées en pleine bataille.<br>`
    +`<span style="color:#8a7a5a;font-size:10.5px;">1000 points = machine de référence. ${nav}${mem} · écran ${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)} @${(window.devicePixelRatio||1).toFixed(2)}×</span></p>`
    +`<button class="bigbtn" onclick="lancerBenchmark()">↻ Refaire le test</button>`;
}

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
