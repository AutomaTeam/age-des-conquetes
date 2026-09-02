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
  GRAINE:20260902, CARTE:'plaines',
  SURCOUT_IMAGE:2.4,     // voir la note sur l'estimation d'images/s, plus bas
  // L'atlas pèse le moins : c'est aussi, de loin, la mesure la plus bruitée
  // (allocation de ~250 canvas d'un coup, donc à la merci d'une collecte
  // mémoire — écart mesuré de 24 à 34 ms pour le même travail), et la moins
  // représentative du confort de jeu puisqu'on ne la paie qu'aux changements
  // de zoom. Lui laisser 0,2 faisait basculer le RANG affiché d'un essai à
  // l'autre alors que la machine, elle, n'avait pas changé.
  POIDS:{atlas:0.15, sim:0.40, rendu:0.45},
};
// Deux épreuves. La normale répond à « le jeu tournera-t-il bien chez moi ? »,
// l'extrême à « jusqu'où ma machine tient-elle ? » — et elles ne se mesurent
// pas sur la même chose : l'extrême met en scène une BATAILLE (deux camps
// hostiles qui se cherchent, se tirent dessus et meurent), parce que le vrai
// pire cas du moteur n'est pas « beaucoup d'unités » mais « beaucoup d'unités
// AU CONTACT » — ciblage, projectiles, morts et séparation se paient tous
// ensemble. Les temps de référence sont relevés séparément pour chacune : à
// 1600 unités le coût par pas n'a plus rien à voir, un score commun ne
// voudrait rien dire.
const BENCH_PROFILS={
  normal:{
    nom:'Épreuve normale', ico:'📊',
    intro:'Une partie de milieu de jeu, carte normale : ce que votre machine fera réellement la plupart du temps.',
    // RAYON en tuiles : le disque dans lequel les unités sont semées. ~10
    // tuiles = la largeur d'un écran au zoom normal, donc une bonne part de
    // l'armée est réellement DESSINÉE — c'est ce qu'on paie en jeu.
    TAILLE:'normale', UNITES:220, BATAILLE:false, BATIMENTS:22, RAYON:10,
    // L'épreuve normale est rapide (~1 s) : on peut se payer plus d'essais,
    // et le meilleur de N resserre d'autant la mesure.
    // Chauffe généreuse : mesuré, un banc lancé APRÈS d'autres activités de la
    // page (une partie jouée puis quittée) rendait 798 points là où les essais
    // suivants donnaient 895 à 940 — code déoptimisé et mémoire à collecter.
    // Toutes les séries de CE lancement étaient lentes, donc le meilleur-de-N
    // n'y pouvait rien : seule une vraie chauffe en amont corrige.
    PAS_SIM:150, IMAGES:90, CHAUFFE_SIM:120, CHAUFFE_RENDU:30,
    ESSAIS_ATLAS:4, ESSAIS_SIM:3, ESSAIS_RENDU:3,
    // Temps de référence en ms, RELEVÉS APRÈS CHAUFFE sur la machine étalon
    // (Windows 11, Chrome, 24 cœurs, DPR 1,25) : 1000 points par poste =
    // cette machine. Seul étalonnage du banc.
    // Étalonné dans les conditions RÉELLES d'usage — page ayant déjà fait
    // tourner des parties —, pas sur un onglet fraîchement ouvert : mesuré,
    // la même machine rend 0,47 ms sur page neuve et 0,60 après deux parties
    // jouées. Étalonner sur le cas neuf plaçait la machine étalon à 889
    // points, pile sur la frontière d'un rang, qui basculait alors d'un essai
    // à l'autre. Sur ces valeurs-ci elle tombe à ~1000, au milieu de son rang.
    REF:{atlas:31, sim:0.60, rendu:1.72},
    PALIERS:[
      {min:1400,nom:'Forge de guerre',ico:'🔥',txt:'Tout à fond : grande carte, 4 camps, zoom libre. La machine n’est pas la limite.'},
      {min:900, nom:'Solide',         ico:'⚔️',txt:'Confortable partout. Grande carte et mode 2 rivaux sans réserve.'},
      {min:550, nom:'Correct',        ico:'🛡️',txt:'À l’aise en carte normale. La grande carte reste jouable, avec quelques à-coups en fin de partie.'},
      {min:300, nom:'Juste ce qu’il faut',ico:'🪓',txt:'Préférez les cartes petite ou moyenne, et évitez le mode 2 rivaux en grande carte.'},
      {min:0,   nom:'Terrain difficile',ico:'🐌',txt:'Carte petite conseillée, vitesse ×1. Fermer les autres onglets aide beaucoup.'},
    ],
  },
  extreme:{
    nom:'Épreuve extrême', ico:'🔥',
    intro:'Grande carte 320×320, <strong>3 000 unités en pleine bataille</strong> et 60 bâtiments. Bien au-delà d’une vraie partie : c’est un test de rupture, pas un objectif.',
    TAILLE:'grande', UNITES:3000, BATAILLE:true, BATIMENTS:60, RAYON:13,
    // Beaucoup moins d'itérations : à ce niveau un seul pas coûte des
    // millisecondes, et le banc doit rester sous la dizaine de secondes.
    PAS_SIM:40, IMAGES:30, CHAUFFE_SIM:16, CHAUFFE_RENDU:8,
    ESSAIS_ATLAS:3, ESSAIS_SIM:2, ESSAIS_RENDU:2,   // l'atlas est le plus bruité : 3 essais
    // Références RELEVÉES sur la machine étalon pour CETTE épreuve — pas
    // question de réutiliser celles de l'épreuve normale : à 3 000 unités le
    // coût par pas n'a plus rien à voir (0,42 ms contre ~9 ms).
    // Étalonnage relevé une fois la mêlée VRAIMENT formée : les deux armées
    // marchent l'une sur l'autre pendant la chauffe, donc au moment du
    // chronomètre elles sont au contact, au centre de l'écran — le rendu passe
    // de 11 à 41 ms parce qu'il dessine alors des milliers d'unités empilées
    // au lieu d'une nuée dispersée. C'est le pire cas recherché, et il est
    // reproductible (aléa semé) ; mais il dépend du nombre de pas joués avant
    // la mesure : toucher à CHAUFFE_SIM impose de réétalonner ces trois
    // nombres.
    REF:{atlas:33, sim:32.7, rendu:41.5},
    // Les libellés ne promettent PAS que tout va bien : à 3 000 unités au
    // contact, même la machine étalon dépasse le budget temps réel (34 ms par
    // pas pour 33 disponibles). C'est le propre d'un test de rupture, et le
    // verdict temps réel affiché juste en dessous le dit sans détour — les
    // textes doivent rester cohérents avec lui.
    PALIERS:[
      {min:1400,nom:'Hors catégorie',ico:'🔥',txt:'Encaisse sans broncher une charge que le jeu ne produira jamais de lui-même.'},
      {min:900, nom:'Taillée pour la guerre',ico:'⚔️',txt:'Parmi les meilleures sur cette épreuve. En partie réelle, dix fois plus légère, aucune limite.'},
      {min:550, nom:'Solide sous le feu',ico:'🛡️',txt:'Bon comportement sur une charge démesurée. Aucune inquiétude pour une vraie partie.'},
      {min:300, nom:'Atteint ses limites',ico:'🪓',txt:'La charge extrême passe mal — c’est attendu. Fiez-vous à l’épreuve normale pour juger le confort de jeu.'},
      {min:0,   nom:'Dépassée',        ico:'🐌',txt:'Cette épreuve est hors de portée, ce qui ne présage rien d’une vraie partie : lancez l’épreuve normale.'},
    ],
  },
};

let _benchEnCours=false;
function ouvrirBenchmark(){
  document.getElementById('benchpanel').style.display='flex';
  const c=document.getElementById('benchcorps');
  c.innerHTML='<p class="benchsub">Le banc rejoue les opérations qui coûtent réellement en jeu — construction des sprites, simulation, rendu — sur une charge identique pour toutes les machines. La durée dépend donc de la machine : c’est un peu le principe.<br><br>Restez sur l’onglet pendant la mesure : un onglet en arrière-plan est délibérément ralenti par le navigateur et fausserait le résultat.</p>'
    +'<button class="bigbtn sheen" onclick="lancerBenchmark(\'normal\')">📊 Épreuve normale</button>'
    +'<p class="benchsub" style="margin-top:-2px;">Une partie de milieu de jeu, carte normale — <span class="benchduree">quelques secondes</span>.</p>'
    +'<button class="bigbtn benchextreme" onclick="lancerBenchmark(\'extreme\')">🔥 Épreuve extrême</button>'
    +'<p class="benchsub" style="margin-top:-2px;">3 000 unités en pleine bataille sur une carte 320×320 — <span class="benchduree">un peu plus long</span>. Test de rupture : il est normal qu’une machine modeste y peine.</p>';
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

// ── ALÉA SEMÉ PENDANT TOUT LE BANC ────────────────────────
// Sans ça le banc ne mesure pas deux fois la même chose : le ciblage, la
// chasse et les particules tirent Math.random en pleine boucle, donc la
// bataille se déroule autrement à chaque essai — effectif différent au moment
// du chronomètre, donc coût différent. C'est exactement le piège déjà
// rencontré sur les bancs hors navigateur, et c'est LE levier de stabilité :
// on veut mesurer la MACHINE, pas le hasard de la partie.
// Même générateur que le harnais de test (LCG), et surtout : on restaure
// le vrai Math.random ensuite, sinon toute la session de jeu qui suit
// tournerait sur une suite prévisible.
let _randVrai=null;
function benchSemer(graine){
  if(!_randVrai) _randVrai=Math.random;
  let s=(graine>>>0)||1;
  Math.random=function(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; };
}
function benchRendreAleaVrai(){
  if(_randVrai){ Math.random=_randVrai; _randVrai=null; }
}

// Construit une scène de VRAIE partie : une base bâtie, des villageois qui
// récoltent pour de bon (via assignGatherers, le chemin du jeu) et une armée
// groupée autour de la base. Sans ça le banc mesurait 220 unités qui marchent
// en file indienne sur une carte vide — et, la spirale s'étant élargie lors de
// l'ajout de l'épreuve extrême, la plupart tombaient même HORS DE L'ÉCRAN :
// le rendu chronométré ne dessinait presque rien (0,36 ms au lieu de 1,20).
function benchScene(P,tc,camps){
  const nBat=P.BATIMENTS, TYPES=[BT.HOUSE,BT.FARM,BT.MILL,BT.LUMBER,BT.BARRACKS,BT.TOWER,BT.MINE,BT.STABLE];
  for(let i=0;i<nBat;i++){
    const a=i*2.399963, r=BASE_TILE*(6+(i%6)*3);
    const bt=TYPES[i%TYPES.length], d=BDEF[bt];
    const btx=Math.max(2,Math.min(COLS-1-d.w,(tc.tx+Math.cos(a)*r/BASE_TILE)|0));
    const bty=Math.max(2,Math.min(ROWS-1-d.h,(tc.ty+Math.sin(a)*r/BASE_TILE)|0));
    let libre=true;
    for(let dy=0;dy<d.h&&libre;dy++) for(let dx=0;dx<d.w&&libre;dx++) if(G.bmap[bty+dy][btx+dx]!==0) libre=false;
    if(!libre) continue;
    const b=mkBuilding(bt,btx,bty,camps[i%camps.length]);
    b.constructing=false; b.progress=1; placeBuilding(b);
  }
  // Unités GROUPÉES autour de la base (rayon ~10 tuiles) : c'est ce qu'on a
  // réellement sous les yeux en jeu, et donc ce que le rendu doit payer.
  const vils=[];
  for(let i=0;i<P.UNITES;i++){
    const camp=camps[i%camps.length];
    const cote=(camps.length>1&&(i%2))?1:-1;
    // Disque de Vogel (spirale dorée) : réparti sans amas ni file indienne.
    const k=i/P.UNITES, a=i*2.399963, r=Math.sqrt(k)*BASE_TILE*P.RAYON;
    const cx=tc.x+(P.BATAILLE?cote*BASE_TILE*11:0);
    const x=Math.max(BASE_TILE,Math.min((COLS-1)*BASE_TILE,cx+Math.cos(a)*r));
    const y=Math.max(BASE_TILE,Math.min((ROWS-1)*BASE_TILE,tc.y+Math.sin(a)*r));
    const t=(i%4===0)?UT.VIL:(i%5===0)?UT.ARC:(i%11===0)?UT.KNIGHT:UT.MIL;
    const u=mkUnit(t,x,y,camp);
    if(P.BATAILLE){ u.state='moving'; u.destX=tc.x-cote*BASE_TILE*11; u.destY=tc.y; }
    else { u.state='moving'; u.destX=tc.x; u.destY=tc.y; }
    G.units.push(u);
    if(t===UT.VIL&&camp===camps[0]) vils.push(u);
  }
  // Villageois RÉELLEMENT à la récolte : on passe par assignGatherers, la
  // fonction du jeu, pour que homeNode/dropoff/state soient posés comme en
  // partie — un villageois « en récolte » bricolé à la main ne ferait pas
  // travailler doGather de la même façon.
  const noeuds=G.nodes.filter(n=>n.amt>0)
    .sort((a,b)=>Math.hypot(a.x-tc.x,a.y-tc.y)-Math.hypot(b.x-tc.x,b.y-tc.y)).slice(0,24);
  if(noeuds.length&&vils.length){
    const parNoeud=Math.max(1,Math.ceil(vils.length/noeuds.length));
    for(let i=0;i<noeuds.length;i++){
      const lot=vils.slice(i*parNoeud,(i+1)*parNoeud);
      if(lot.length) assignGatherers(lot,noeuds[i]);
    }
  }
}

async function lancerBenchmark(profilNom){
  if(_benchEnCours) return;
  const P=BENCH_PROFILS[profilNom]||BENCH_PROFILS.normal;
  _benchEnCours=true;
  const c=document.getElementById('benchcorps');
  c.innerHTML=`<p class="benchsub"><strong>${P.ico} ${P.nom}</strong></p>`
    +'<div class="benchjauge"><div id="benchbarre"></div></div>'
    +'<p class="benchsub" id="benchetat">Préparation…</p>';

  // L'écran-titre a ses propres choix (mode, carte, taille, graine) : le banc
  // en impose d'autres pour être comparable, on les remet donc ensuite.
  const sauve={mode:selectedMode, carte:selectedCarte, taille:selectedTaille,
               civ:selectedCiv, diff:selectedDifficulty, graine:grainePartie, tile:TILE};
  // `series` garde TOUTES les valeurs retenues, pas seulement la meilleure :
  // l'écart entre elles est ce qui dit si la mesure est fiable ou si la
  // machine était occupée ailleurs. C'est une information que le joueur doit
  // voir, pas quelque chose à cacher derrière un chiffre unique.
  const res={series:{atlas:[],sim:[],rendu:[]}};
  const tDebut=performance.now();
  // Onglet mis en arrière-plan : le navigateur bride alors les minuteurs et le
  // rendu. On ne peut pas l'empêcher, mais on peut le DÉTECTER et le dire,
  // plutôt que d'afficher un mauvais score sans explication.
  let masque=document.hidden;
  const surVisibilite=()=>{ if(document.hidden) masque=true; };
  document.addEventListener('visibilitychange',surVisibilite);
  try{
    benchSemer(BENCH.GRAINE);   // voir benchSemer : la stabilité tient d'abord à ça
    selectedMode='survival'; selectedCarte=BENCH.CARTE;
    pickTaille(P.TAILLE); grainePartie=BENCH.GRAINE;
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
    for(let e=0;e<=P.ESSAIS_ATLAS;e++){         // e=0 : échauffement, non retenu
      benchProgres(0.14+e*0.03,'Construction des sprites…');
      const t=performance.now();
      buildSprites(sprRungFor(BASE_TILE));
      const d=performance.now()-t;
      await benchSouffler();
      if(e===0) continue;
      res.series.atlas.push(d);
      res.atlas=(res.atlas==null)?d:Math.min(res.atlas,d);
    }

    // ── 2. Simulation ──
    benchProgres(0.3,'Mise en place de la cité…');
    const dep=(G.departs&&G.departs.length)?G.departs:resoudreDeparts();
    const tc=mkBuilding(BT.TC,dep[0][0],dep[0][1],FAC.P1); placeBuilding(tc);
    // Épreuve extrême : deux camps RÉELLEMENT hostiles qui vont se chercher et
    // se battre. `hostileATous` + des équipes distinctes suffisent (même
    // montage que les tests de combat) ; sans ça 3 000 unités se contenteraient
    // de marcher côte à côte, et on mesurerait une promenade, pas une bataille.
    let camps=[FAC.P1];
    if(P.BATAILLE){
      G.factions.benchA=mkFaction('benchA',{genre:'neutre',equipe:81,hostileATous:true,civ:'francs',nom:'Rouge'});
      G.factions.benchB=mkFaction('benchB',{genre:'neutre',equipe:82,hostileATous:true,civ:'mongols',nom:'Bleu'});
      camps=['benchA','benchB'];
    }
    benchScene(P,tc,camps);
    const sx=G.units.length;
    res.batiments=G.buildings.length;
    res.unitesDepart=sx;
    rebuildIndex(); rebuildGrid();
    await benchSouffler();
    for(let k=0;k<P.CHAUFFE_SIM;k++) update(SIM_DT);   // chauffe, NON mesurée
    await benchSouffler();
    // Même principe qu'au-dessus : plusieurs séries, on garde la meilleure.
    // Découpé en tranches avec une respiration : à 1 600 unités une série
    // entière d'un bloc fige l'onglet plusieurs secondes sans rien afficher.
    // La série e=0 est une SÉRIE D'ÉCHAUFFEMENT : chronométrée mais jetée.
    // Mesuré en enchaînant cinq bancs après deux parties jouées, les trois
    // postes s'améliorent encore d'un banc à l'autre (atlas 35→28 ms, sim
    // 0,67→0,60, rendu 1,90→1,67) : c'est la compilation par paliers de V8 qui
    // continue de progresser sur plusieurs invocations COMPLÈTES, ce qu'une
    // simple chauffe en amont ne rattrape pas. Sans cette série jetée, le tout
    // premier résultat affiché était systématiquement ~12 % sous les suivants
    // — donc un rang trop bas pour qui ne lance le test qu'une fois.
    for(let e=0;e<=P.ESSAIS_SIM;e++){
      let tot=0;
      for(let bloc=0;bloc<4;bloc++){
        benchProgres(0.42+(e*4+bloc)*0.03,`Simulation de ${sx} unités${P.BATAILLE?' en bataille':''}…`);
        const t=performance.now();
        for(let k=0;k<P.PAS_SIM/4;k++) update(SIM_DT);
        tot+=performance.now()-t;
        await benchSouffler();
      }
      if(e===0) continue;                       // échauffement, non retenu
      const d=tot/P.PAS_SIM;
      res.series.sim.push(d);
      res.sim=(res.sim==null)?d:Math.min(res.sim,d);
    }
    res.vivants=G.units.length;

    // ── 3. Rendu ──
    camCenterOn(tc.x,tc.y);
    // Combien d'unités le rendu dessine-t-il RÉELLEMENT ? Tout ce qui sort du
    // cadre est éliminé avant dessin, donc « 3 000 unités » ne dit rien du
    // coût : c'est ce compte-là qui l'explique.
    { let vus=0; for(const u of G.units){ const s=ws(u.x,u.y);
        if(s.x>-40&&s.x<W+40&&s.y>14&&s.y<H+40) vus++; } res.aLEcran=vus; }
    { const etats={}; for(const u of G.units) etats[u.state]=(etats[u.state]||0)+1; res.etats=etats; }
    for(let k=0;k<P.CHAUFFE_RENDU;k++) render();       // chauffe, NON mesurée
    await benchSouffler();
    for(let e=0;e<=P.ESSAIS_RENDU;e++){         // e=0 : échauffement, non retenu
      benchProgres(0.78+e*0.05,'Rendu…');
      const t=performance.now();
      for(let k=0;k<P.IMAGES;k++) render();
      const d=(performance.now()-t)/P.IMAGES;
      await benchSouffler();
      if(e===0) continue;
      res.series.rendu.push(d);
      res.rendu=(res.rendu==null)?d:Math.min(res.rendu,d);
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
    // Les deux camps de l'épreuve extrême sont des factions POSTICHES : les
    // laisser dans G.factions les ferait apparaître dans la partie suivante
    // (bandeau adverse, conditions de victoire, delta réseau).
    delete G.factions.benchA; delete G.factions.benchB;
    // Le VRAI Math.random doit revenir : une partie jouée derrière un
    // générateur semé rejouerait la même chose à l'infini.
    benchRendreAleaVrai();
    document.removeEventListener('visibilitychange',surVisibilite);
  }
  _benchEnCours=false;
  res.masque=masque;
  res.duree=performance.now()-tDebut;
  afficherResultatBenchmark(res,P,profilNom);
}
window.lancerBenchmark=lancerBenchmark;

// ── SIGNALEMENT DE LA MACHINE ─────────────────────────────
// Tout est lu sur place et affiché sur place : rien n'est envoyé nulle part.
// Le nom de la puce graphique vient de WebGL — le jeu, lui, dessine en
// canvas 2D, mais c'est le seul moyen d'identifier l'appareil, ce qui compte
// justement pour comparer un téléphone à un autre.
function benchGPU(){
  try{
    const c=document.createElement('canvas');
    const gl=c.getContext('webgl')||c.getContext('experimental-webgl');
    if(!gl) return null;
    const d=gl.getExtension('WEBGL_debug_renderer_info');
    let nom=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    if(!nom) return null;
    nom=String(nom);
    // Chrome/Windows renvoie « ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Laptop
    // GPU (0x000027E0), Direct3D11 vs_5_0 ps_5_0, D3D11) » : trois segments
    // après le vendeur, pas un seul. On jette les segments de PILOTE et
    // l'identifiant matériel pour ne garder que le nom de la puce — sinon la
    // troncature coupait en plein milieu (« …(0x000027E0) Dire »).
    if(/^ANGLE \(/.test(nom)){
      const parts=nom.replace(/^ANGLE \(/,'').replace(/\)$/,'')
        .split(/,\s*/)
        .filter(p=>p&&!/^(Direct3D|D3D|OpenGL|Vulkan|Metal|vs_|ps_)/i.test(p));
      if(parts.length){
        // parts[0] = vendeur, parts[1] = puce (souvent déjà préfixée du vendeur)
        nom=(parts[1]&&parts[1].toLowerCase().startsWith(parts[0].toLowerCase()))?parts[1]
           :(parts[1]?parts[0]+' '+parts[1]:parts[0]);
      }
    }
    // Le pilote n'est PAS toujours dans son propre segment : Chrome rend
    // « …Laptop GPU (0x000027E0) Direct3D11 vs_5_0 ps_5_0, D3D11 », tout collé
    // au nom de la puce. Découper par virgules ne suffit donc pas — on coupe
    // aussi net devant le premier marqueur de pilote ou d'identifiant.
    nom=nom.split(/\s*\(0x|\s+Direct3D|\s+D3D\d|\s+OpenGL|\s+Vulkan|\s+Metal|\s+vs_|\s+ps_/i)[0];
    return nom.replace(/\s*\((?:R|C|TM)\)/g,'').replace(/\s+/g,' ').trim().slice(0,52);
  }catch(e){ return null; }
}
function benchNavigateur(){
  const u=navigator.userAgent;
  const nav=/Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/Firefox\//.test(u)?'Firefox'
    :/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'navigateur inconnu';
  const os=/Android/.test(u)?'Android':/iPhone|iPad|iPod/.test(u)?'iOS'
    :/Windows/.test(u)?'Windows':/Mac OS X/.test(u)?'macOS':/Linux/.test(u)?'Linux':'système inconnu';
  return nav+' · '+os;
}
// Dispersion entre les séries retenues : c'est l'indicateur de CONFIANCE.
// Un écart serré veut dire que la machine n'était occupée à rien d'autre ;
// un écart large, que le résultat mérite d'être refait.
function benchEcart(serie){
  if(!serie||serie.length<2) return null;
  const mn=Math.min(...serie), mx=Math.max(...serie);
  return mn>0?(mx-mn)/mn*100:null;
}

// Score : rapport au temps de référence, borné, puis moyenne pondérée.
// Plus haut = mieux. Le plafond de 3 évite qu'un poste très rapide (un atlas
// mis en cache par le navigateur, par exemple) n'écrase les deux autres.
function benchScore(res,P){
  const part=(ref,vu)=>Math.max(0.05,Math.min(3,ref/Math.max(0.0001,vu)));
  const a=part(P.REF.atlas,res.atlas), s=part(P.REF.sim,res.sim), r=part(P.REF.rendu,res.rendu);
  const g=a*BENCH.POIDS.atlas+s*BENCH.POIDS.sim+r*BENCH.POIDS.rendu;
  return {points:Math.round(g*1000), a:Math.round(a*1000), s:Math.round(s*1000), r:Math.round(r*1000)};
}

function afficherResultatBenchmark(res,P,profilNom){
  const sc=benchScore(res,P);
  const palier=P.PALIERS.find(p=>sc.points>=p.min)||P.PALIERS[P.PALIERS.length-1];
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
  // La simulation tourne à 30 pas/s : au-delà de 33 ms par pas, la machine ne
  // tient plus le temps réel et le jeu ralentirait. C'est LE verdict d'une
  // épreuve de rupture, bien plus parlant qu'un score.
  // TROIS états et non deux : la mesure a ±3 % de dispersion, et sur l'épreuve
  // extrême la machine étalon tombe pile sur la limite (32,5 à 36 ms selon
  // l'essai). Un verdict binaire y basculerait du vert au orange d'un essai à
  // l'autre sans que rien n'ait changé — annoncer « à la limite » est à la
  // fois plus honnête et plus stable qu'un couperet à 33,0 ms.
  const marge=Math.round(33/Math.max(0.01,res.sim)*10)/10;
  const etatTR=(res.sim<=33/1.15)?'ok':(res.sim<=33*1.15)?'limite':'dep';

  // ── Fiabilité de CE relevé ──
  // L'écart entre les séries retenues dit si la machine était tranquille. On
  // l'affiche plutôt que de le taire : un score pris pendant qu'un autre
  // programme tournait ne vaut rien, et seul ce chiffre permet de s'en douter.
  // L'ATLAS est délibérément EXCLU de cet indicateur : c'est la mesure la plus
  // bruitée du banc (allocation de ~250 canvas, donc à la merci d'une collecte
  // mémoire — écart relevé jusqu'à 109 % entre deux séries du même essai),
  // alors que le meilleur-de-N l'absorbe déjà et qu'elle ne pèse que 15 % du
  // score. L'inclure faisait crier au loup sur des relevés parfaitement sains,
  // ce qui aurait appris au joueur à ignorer l'avertissement.
  const ecarts=[benchEcart(res.series.sim),benchEcart(res.series.rendu)].filter(x=>x!=null);
  const ecartMax=ecarts.length?Math.max(...ecarts):null;
  // Seuils larges à dessein : même au repos, un chronomètre JavaScript sur
  // trois séries donne couramment 10 à 25 % d'écart (collecte mémoire, autres
  // onglets, fréquence du processeur qui varie). Des seuils serrés auraient
  // affiché « dispersé » sur des relevés parfaitement bons.
  const fiab=ecartMax==null?null
    :ecartMax<15 ?{col:'#7fc98a',txt:`🎯 Relevé stable (écart entre séries : ${ecartMax.toFixed(0)} %).`}
    :ecartMax<35?{col:'#e8c060',txt:`➖ Relevé un peu dispersé (${ecartMax.toFixed(0)} %) — refaire le test donnera un chiffre plus sûr.`}
    :{col:'#e08a5a',txt:`⚠️ Relevé dispersé (${ecartMax.toFixed(0)} %) : quelque chose d’autre occupait la machine. À refaire, autres applications fermées.`};

  // ── Détail complet ──
  const gpu=benchGPU(), navOS=benchNavigateur();
  const mo=(window.performance&&performance.memory)
    ?Math.round(performance.memory.usedJSHeapSize/1048576)+' Mo utilisés':null;
  const serie=a=>a.length?a.map(v=>v<10?v.toFixed(2):Math.round(v)).join(' · '):'—';
  const etats=Object.entries(res.etats||{}).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`${({idle:'au repos',moving:'en marche',gather:'à la récolte',attack:'au combat',build:'au chantier',return:'au dépôt',farm:'aux champs',amove:'en assaut',heal:'en soin',garrison:'en garnison'})[k]||k} ${v}`).join(', ');
  const det=(k,v)=>`<div class="benchinfo"><span>${k}</span><span>${v}</span></div>`;
  const bloc=`<div class="benchbloc"><div class="benchblocT">La machine</div>`
    +det('Navigateur',navOS)
    +(gpu?det('Puce graphique',gpu):'')
    +det('Processeur',(navigator.hardwareConcurrency||'?')+' cœurs logiques')
    +(navigator.deviceMemory?det('Mémoire',navigator.deviceMemory+' Go'):'')
    +(mo?det('Tas JavaScript',mo):'')
    +det('Fenêtre',`${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)} @${(window.devicePixelRatio||1).toFixed(2)}× (${Math.round(window.innerWidth*(window.devicePixelRatio||1))}×${Math.round(window.innerHeight*(window.devicePixelRatio||1))} px réels)`)
    +det('Écran',`${screen.width}×${screen.height}`)
    +`<div class="benchblocT">L’épreuve</div>`
    +det('Carte',`${TAILLES[P.TAILLE].nom} — ${TAILLES[P.TAILLE].n}×${TAILLES[P.TAILLE].n}`)
    +det('Unités',`${res.unitesDepart} au départ, ${res.vivants} au chronomètre`)
    +det('Dessinées à l’écran',`${res.aLEcran} (le reste est hors cadre)`)
    +det('Bâtiments',res.batiments)
    +(etats?det('États',etats):'')
    +det('Mesure',`meilleur de ${P.ESSAIS_SIM} séries · ${P.PAS_SIM} pas · ${P.IMAGES} images`)
    +`<div class="benchblocT">Les séries retenues (ms)</div>`
    +det('Sprites',serie(res.series.atlas))
    +det('Simulation',serie(res.series.sim))
    +det('Rendu',serie(res.series.rendu))
    +det('Durée du test',(res.duree/1000).toFixed(1)+' s')
    +`</div>`;

  // Rapport en texte brut, pour comparer d'une machine à l'autre.
  const texte=[
    `Âge des Conquêtes — ${P.nom}`,
    `${sc.points} points (${palier.nom})`,
    `Sprites ${Math.round(res.atlas)} ms (${sc.a}) · Simulation ${res.sim.toFixed(2)} ms (${sc.s}) · Rendu ${res.rendu.toFixed(2)} ms (${sc.r})`,
    `≈ ${fps} images/s · ${etatTR==='ok'?'temps réel tenu':etatTR==='limite'?'à la limite du temps réel':'au-delà du temps réel'}`,
    `Carte ${TAILLES[P.TAILLE].n}×${TAILLES[P.TAILLE].n} · ${res.vivants} unités (${res.aLEcran} à l'écran) · ${res.batiments} bâtiments`,
    `${navOS}${gpu?' · '+gpu:''} · ${navigator.hardwareConcurrency||'?'} cœurs${navigator.deviceMemory?' · '+navigator.deviceMemory+' Go':''}`,
    `Fenêtre ${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)} @${(window.devicePixelRatio||1).toFixed(2)}×`,
    `Écart entre séries ${ecartMax==null?'—':ecartMax.toFixed(0)+' %'}${res.masque?' · ONGLET MASQUÉ, à refaire':''}`,
  ].join('\n');

  document.getElementById('benchcorps').innerHTML=
    `<p class="benchsub"><strong>${P.ico} ${P.nom}</strong></p>`
    +`<div class="benchscore"><div class="bsico">${palier.ico}</div>`
    +`<div class="bspts">${sc.points}</div><div class="bslbl">points</div>`
    +`<div class="bsrang">${palier.nom}</div></div>`
    +`<p class="benchsub">${palier.txt}</p>`
    +`<div class="benchtable">`
    +ligne('🎨 Sprites',Math.round(res.atlas)+' ms',sc.a,'Reconstruction complète de l’atlas — ce qu’on paie à chaque changement de zoom.')
    +ligne('⚙️ Simulation',res.sim.toFixed(2)+' ms',sc.s,`Un pas de jeu avec ${res.vivants||P.UNITES} unités${P.BATAILLE?' en pleine bataille':' en mouvement'} (déplacement, ciblage, séparation).`)
    +ligne('🖼️ Rendu',res.rendu.toFixed(2)+' ms',sc.r,'Une image complète : sol, bâtiments, unités, brouillard.')
    +`</div>`
    +`<p class="benchsub">≈ <strong>${fps} images/s</strong> estimées sous cette charge.<br>`
    +(etatTR==='ok'
      ? `<span style="color:#7fc98a;">✅ Temps réel tenu — ${marge}× de marge sur le pas de simulation.</span>`
      : etatTR==='limite'
      ? `<span style="color:#e8c060;">➖ Pile à la limite du temps réel, sous CETTE charge seulement — une vraie partie est bien plus légère.</span>`
      : `<span style="color:#e08a5a;">⚠️ Au-delà du temps réel : sous CETTE charge le jeu ralentirait. Une vraie partie est bien plus légère.</span>`)
    +(res.masque?`<br><span style="color:#e08a5a;">⚠️ L’onglet est passé en arrière-plan pendant la mesure : le navigateur l’a bridé, ce résultat est à refaire.</span>`:'')
    +(fiab?`<br><span style="color:${fiab.col};">${fiab.txt}</span>`:'')
    +`</p>`
    +bloc
    +`<button class="bigbtn" onclick="lancerBenchmark('${profilNom==='extreme'?'extreme':'normal'}')">↻ Refaire</button>`
    +(profilNom==='extreme'
      ? `<button class="bigbtn" onclick="lancerBenchmark('normal')">📊 Épreuve normale</button>`
      : `<button class="bigbtn benchextreme" onclick="lancerBenchmark('extreme')">🔥 Passer à l’épreuve extrême</button>`)
    +`<button class="bigbtn" onclick="copierResultatBenchmark()">📋 Copier le rapport</button>`;
  window.__benchTexte=texte;
}

// Le rapport en texte brut : c'est ce qui permet de COMPARER deux machines
// pour de bon (se l'envoyer, le coller quelque part), plutôt que de comparer
// deux chiffres sortis de leur contexte.
function copierResultatBenchmark(){
  const t=window.__benchTexte||'';
  const fini=()=>notify('📋 Rapport copié','#2ecc71');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(fini,()=>benchCopieSecours(t));
  } else benchCopieSecours(t);
}
// Repli pour les navigateurs (ou contextes non sécurisés) sans presse-papiers :
// on sélectionne le texte dans un champ, l'utilisateur n'a plus qu'à copier.
function benchCopieSecours(t){
  try{
    const z=document.createElement('textarea');
    z.value=t; z.style.cssText='position:fixed;left:8px;right:8px;bottom:8px;height:120px;z-index:900;';
    document.body.appendChild(z); z.focus(); z.select();
    const ok=document.execCommand&&document.execCommand('copy');
    document.body.removeChild(z);
    notify(ok?'📋 Rapport copié':'Sélectionnez puis copiez le texte','#f0c040');
  }catch(e){ notify('Copie impossible sur ce navigateur','#e67e22'); }
}
window.copierResultatBenchmark=copierResultatBenchmark;

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
