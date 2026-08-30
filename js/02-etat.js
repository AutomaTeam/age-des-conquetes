'use strict';
// ======================================================================
//  02-etat.js
// ======================================================================
// Etat global (G) et factions : creation, lecture, hostilite, shims.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── ÉTAT GLOBAL ───────────────────────────────────────────
let G = {};

// Compteurs de partie : alimentés aux mêmes points de passage que les effets
// de jeu correspondants (dépôt de ressources, mort d'unité, fin de chantier…)
// pour ne jamais diverger de ce qui s'est réellement produit. Servent à la
// fois au bilan de fin de partie et à la validation des succès.
function initStats(){
  return {
    trained:0, lost:0, killed:0, bossKilled:0,
    built:0, wallsBuilt:0, bldLost:0, bldDestroyed:0,
    gathered:{food:0,wood:0,stone:0,gold:0},
    peakPop:0, peakMil:0, peakFarms:0,
    research:0, campsCleared:0, tradesDone:0,
    wildlifeHunted:0, garrisonUses:0, hadEliteUnit:false,
  };
}

// ── FACTIONS ─────────────────────────────────────────────
// Un camp = une faction. Jusqu'ici le jeu n'avait que deux propriétaires
// ('player' / 'enemy') dans lesquels TROIS camps étaient écrasés : le joueur,
// l'adversaire de Conquête (marqué ai:true) et les pillards de vague. Un duel
// 1v1 avec IA en plus impose de les distinguer réellement : chaque faction a
// sa caisse, son âge, ses recherches, sa population, son brouillard et ses
// compteurs.
const FAC = { P1:'p1', P2:'p2', IA:'ia', IA2:'ia2', PILL:'pillards' };

// Teinte de sprites par défaut de chaque faction (voir PAL_FACTION).
const TEINTE_DEF = { p1:'bleu', p2:'vert', ia:'rouge', ia2:'violet', pillards:'rouge' };

function initResearch(){
  return { iron_sword:false, bow_craft:false, iron_armor:false, masonry:false,
           cavalry:false, longbow:false, tactics:false, faith:false, engineering:false,
           siege_smithing:false, cavalry_lance:false, fortification:false, logistics:false,
           brouette:false, charrue:false, sentiers:false,
           chevalerie:false, feu_gregeois:false, arc_composite:false, etriers:false };
}
// Lecture seule : recherches d'un camp qui n'en a pas (pillards).
const EMPTY_RESEARCH = initResearch();

// genre  : 'humain' (joue et voit) | 'ia' (cerveau updateAI) | 'neutre' (pillards)
// equipe : deux factions de MÊME équipe ne s'attaquent pas
function mkFaction(id,o){
  return {
    id,
    genre:o.genre, equipe:o.equipe,
    civ:o.civ||'francs',
    teinte:o.teinte||TEINTE_DEF[id]||'rouge',
    nom:o.nom||id,
    hostileATous:!!o.hostileATous, // pillards : hostiles à tout le monde
    res:{...(o.res||{})},
    age:0, ageUpQ:null,
    research:initResearch(), researchQ:[],
    pop:0, maxPop:o.maxPop!=null?o.maxPop:5,
    fog:[],                        // propre à chaque faction humaine
    stats:initStats(),
    autoRepair:false,
    vaincu:false,
    merveilleAchevee:false, // Merveille achevée et restée debout MERVEILLE_WIN_TIME : victoire immédiate
    heroTrained:false, // Héros déjà formé cette partie (même s'il est mort depuis) — jamais de remplaçant
    allieDe:null, // faction humaine qui a conclu une alliance avec ce camp IA — voir ORD.DIPLOMATIE
    // Les factions 'ia' reçoivent en plus, via initAI(), leur cerveau :
    // baseX, baseY, tcId, think, ageQ, atkTimer, atkMin, raids, vilTarget.
  };
}

// Faction d'une entité (ou d'un identifiant de faction).
function fac(o){ const id=(o&&typeof o==='object')?o.owner:o; return G.factions?G.factions[id]:null; }
// Faction locale : celle que CE navigateur joue, et dont on affiche le HUD.
function moi(){ return G.factions?G.factions[G.me]:null; }
function estLocal(e){ return !!e && e.owner===G.me; }
function estIA(e){ const f=fac(e); return !!f && f.genre==='ia'; }
function factionsIA(){ return G.factions?Object.values(G.factions).filter(f=>f.genre==='ia'):[]; }
function factionsHumaines(){ return G.factions?Object.values(G.factions).filter(f=>f.genre==='humain'):[]; }
// Factions réellement en lice (les pillards ne « perdent » ni ne « gagnent »).
function factionsJouantes(){ return G.factions?Object.values(G.factions).filter(f=>f.genre!=='neutre'):[]; }

// Deux entités sont-elles hostiles ? Remplace le test binaire player/enemy :
// gère les équipes et les pillards hostiles à tous.
function estHostile(a,b){
  if(!a||!b) return false;
  // Raccourci « même propriétaire ». C'est le cas le plus courant dans une
  // mêlée — on croise surtout les siens — et il valait deux lectures de table
  // par candidat balayé, sur la fonction la plus appelée de la simulation.
  // Le test explicite sur `undefined` est indispensable : `estHostile` accepte
  // aussi un identifiant de camp NU — updateUneIA appelle `estHostile(a.id,e)`
  // pour sa garde de Centre Ville — et deux chaînes d'identifiant ont toutes
  // les deux `.owner === undefined`, ce qui les rendrait amies entre elles.
  if(a.owner!==undefined&&a.owner===b.owner) return false;
  const fa=fac(a), fb=fac(b);
  if(!fa||!fb||fa===fb) return false;
  if(fa.hostileATous||fb.hostileATous) return true;
  return fa.equipe!==fb.equipe;
}

// Accesseurs par camp — remplacent les ternaires codés en dur player/IA.
function resPool(owner){ const f=fac(owner); return f?f.res:null; }
function ageOf(owner){ const f=fac(owner); return f?f.age:0; }
function rechercheDe(owner){ const f=fac(owner); return f?f.research:EMPTY_RESEARCH; }
function popDe(owner){ const f=fac(owner); return f?f.pop:0; }
function maxPopDe(owner){ const f=fac(owner); return f?f.maxPop:0; }
// Point de passage UNIQUE du taux de récolte : âge, civilisation, et
// désormais la Charrue Lourde. Multiplier ici plutôt que dans doGather ET
// doFarm ET doFish évite qu'un des trois chemins oublie le bonus.
function gatherMult(owner){
  return AGE_BONUS[ageOf(owner)].gather
       * (civOf(owner).gatherMult||1)
       * (rechercheDe(owner).charrue?1.15:1);
}

// Raccourcis vers la faction LOCALE. Tout le code d'interface (HUD, panneaux,
// sélection, brouillard affiché) continue de lire G.res / G.age / G.stats…
// comme avant : ce sont désormais des vues sur G.factions[G.me].
function installerShims(){
  const lien=(prop,champ)=>Object.defineProperty(G,prop,{
    configurable:true, enumerable:true,
    get(){ const f=moi(); return f?f[champ]:undefined; },
    set(v){ const f=moi(); if(f) f[champ]=v; },
  });
  lien('res','res'); lien('age','age'); lien('ageUpQ','ageUpQ');
  lien('research','research'); lien('researchQ','researchQ');
  lien('stats','stats'); lien('fog','fog');
  lien('pop','pop'); lien('maxPop','maxPop'); lien('autoRepair','autoRepair');
  // G.ai — cerveau du PREMIER adversaire IA. Conservé tel quel pour tout le
  // code (et les sauvegardes) qui ne raisonne qu'avec un seul rival.
  Object.defineProperty(G,'ai',{configurable:true, enumerable:true,
    get(){ return G.factions?(G.factions[FAC.IA]||null):null; },
    set(v){ if(G.factions){ if(v) G.factions[FAC.IA]=v; else delete G.factions[FAC.IA]; } },
  });
}

function initState() {
  const diff=DIFFS[selectedDifficulty]||DIFFS.normal;
  const mode=MODES[selectedMode]?selectedMode:'survival';
  // Taille de la carte : figée ICI, AVANT toute allocation de grille (tuiles,
  // blocage, brouillard) et avant genMap. C'est le seul moment où COLS/ROWS
  // changent de valeur — voir appliquerTailleCarte.
  const taille=TAILLES[selectedTaille]?selectedTaille:'normale';
  appliquerTailleCarte(TAILLES[taille].n);
  G = {
    difficulty:selectedDifficulty,
    // gmode = mode de PARTIE (survival/conquest/conquest2). À ne pas confondre
    // avec G.mode juste en dessous, qui est le mode d'INTERACTION en cours
    // (select/build/amove) et que le chargement d'une sauvegarde réinitialise.
    gmode:mode,
    // Type de carte (voir CARTES). Fige a la creation de l'etat, comme gmode :
    // genMap le lit, et il voyage avec la graine en multijoueur (construireSalut).
    carte:selectedCarte,
    // Taille de la carte (voir TAILLES). Figée à la création de l'état comme
    // carte et gmode : elle voyage avec la graine en multijoueur (voir
    // construireSalut) et part dans la sauvegarde.
    taille,
    // Graine de la carte. Deux joueurs qui la partagent génèrent une carte
    // strictement identique : en multijoueur on transmet ces 4 octets au lieu
    // des 3 × 57 600 tuiles de terrain, blocage et brouillard (~500 Ko).
    seed:(grainePartie!=null?grainePartie:(Math.random()*2147483646|0)+1),
    factions:{},   // tous les camps — voir mkFaction()
    me:FAC.P1,     // faction jouée par CE navigateur
    hote:true,     // cette instance fait-elle tourner la simulation ? (multijoueur)
    units:[], buildings:[], nodes:[], projs:[], parts:[], ftexts:[], deathfx:[],
    shake:{mag:0}, // secousse de caméra sur les gros impacts (siège, boss)
    nid:1,
    cam:{ x:0, y:0 },
    sel:[],
    mode:'select',
    buildType:null, ghost:null, routeFrom:null,
    buildTab:0, // 0=Économie 1=Militaire 2=Défense 3=Amélioration
    wave:0, waveTimer:FIRST_WAVE_DELAY*diff.waveDelayMult, waveActive:false,
    paused:false,
    speed:1, // vitesse du jeu 1/2/3
    gameTime:0, // temps de jeu écoulé (s)
    victory:false, targetWaves:MODES[mode].targetWaves, // Survie : survivre à N vagues. Conquête : 0, la victoire vient de la chute du Centre Ville adverse.
    rateAcc:{food:0,wood:0,stone:0,gold:0}, rateShow:{food:0,wood:0,stone:0,gold:0}, rateTimer:0,
    lastTime:0, dt:0,
    moveTarget:null, mtTimer:0,
    selBox:null, // rectangle de sélection
    hover:null, // entité survolée à la souris (desktop) : {kind,id,owner}
    tiles:[], bmap:[], // carte + blocage (le brouillard est par faction)
    running:false, gameOver:false,
    dayPhase:0, // 0..1 cycle jour/nuit
    groupes:{}, // groupes de contrôle Ctrl+1..9 → [id, id, ...] (voir plus bas)
  };
  // Le joueur local. Les adversaires IA sont créés par initAI(), les pillards
  // ne servent qu'en Survie (vagues + garnisons des points d'intérêt).
  // « Vous » convient tant qu'on est seul devant l'ecran, mais ce nom VOYAGE
  // en ligne : le client affichait « Vous » dans son bandeau adverse, dans
  // « Vous a abandonne » et dans le bilan a deux colonnes. En reseau, l'hote
  // se nomme donc de son pseudo, comme il nomme deja son adversaire.
  const nomLocal=(typeof RESEAU!=='undefined'&&RESEAU.actif&&RESEAU.role==='hote')
    ? ((typeof _mpEtat!=='undefined'&&_mpEtat.nom)||localStorage.getItem('adc_pseudo')||'Hôte')
    : 'Vous';
  G.factions[FAC.P1]=mkFaction(FAC.P1,{genre:'humain',equipe:1,nom:nomLocal,res:diff.startRes,maxPop:5,civ:selectedCiv});
  G.factions[FAC.PILL]=mkFaction(FAC.PILL,{genre:'neutre',equipe:0,hostileATous:true});
  // Partie en ligne : le second joueur humain existe des la creation de
  // l'etat, car mkBuilding/mkUnit lisent l'age et les recherches de leur
  // proprietaire — sa faction doit preexister a sa base.
  if(typeof RESEAU!=='undefined'&&RESEAU.actif&&RESEAU.role==='hote'){
    // Mode « 2v1 coop » : le second humain est un ALLIÉ (même équipe que
    // FAC.P1), pas un adversaire — équipe 2 partout ailleurs (1v1 classique).
    // C'est cette seule bascule qui transforme le duel en coopération : le
    // reste (victoire par équipe, brouillard partagé... non, brouillard reste
    // propre à chacun, ciblage IA, bascule en IA à la déconnexion) suit déjà
    // le système d'équipes sans rien connaître de plus sur le mode.
    const allie=(MODES[mode]||{}).coop;
    // Le second joueur humain ne choisit pas encore sa civilisation via le
    // protocole en ligne (hors scope v1) : on lui en attribue une différente
    // de celle de l'hôte, pour au moins varier les bonus des deux côtés.
    const civKeys=Object.keys(CIVS), civP2=civKeys[(civKeys.indexOf(selectedCiv)+1)%civKeys.length];
    G.factions[FAC.P2]=mkFaction(FAC.P2,{genre:'humain',equipe:allie?1:2,
      nom:(RESEAU.adversaire&&RESEAU.adversaire.nom)||'Adversaire',
      res:diff.startRes,maxPop:5,civ:civP2});
  }
  installerShims();
}

// Alloue à chaque faction humaine son propre calque de brouillard. L'IA et
// les pillards n'en ont pas : ils voient toute la carte, comme avant.
function initFog(){
  for(const f of factionsHumaines()){
    const g=[];
    for(let y=0;y<ROWS;y++){ g[y]=[]; for(let x=0;x<COLS;x++) g[y][x]=0; }
    f.fog=g;
  }
}
