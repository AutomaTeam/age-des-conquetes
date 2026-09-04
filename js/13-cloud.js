'use strict';
// ======================================================================
//  13-cloud.js
// ======================================================================
// Connexion Google, Drive (appData), sauvegarde, migration et
// chargement.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── CONNEXION GOOGLE (compte unique — sauvegarde cloud + multijoueur) ──
// Un seul bouton, un seul consentement Google, pour toute l'app : l'identité
// (uid/nom, servant au multijoueur et au classement) et le jeton Drive
// (sauvegarde cloud) sont tous les deux obtenus par window.MP.connecter,
// défini dans le module Firebase tout en bas du fichier (voir « CONFIGURATION
// » là-bas pour créer le projet — voir aussi le README). Tant que Firebase
// n'est pas configuré, window.MP reste un talon inerte : aucun bouton
// n'apparaît, le jeu se comporte comme avant (sauvegarde locale/Canvas
// uniquement) — un dev qui clone le dépôt sans configurer de projet n'est
// donc jamais affecté par cette fonctionnalité.
//
// gAuth n'est plus qu'un miroir local de l'état publié par window.MP.surEtat
// (voir brancherMP plus haut) : le reste du jeu (bouton du menu-titre, menu
// pause, résumé de sauvegarde) continue de lire "gAuth.signedIn/email" sans
// savoir que Firebase est derrière.
let gAuth = { signedIn:false, email:null, nom:null };

async function googleAuthClick(){
  if(!mpDispo()){ notify('☁️ Connexion Google indisponible pour l\'instant','#e74c3c'); return; }
  try{
    if(gAuth.signedIn){
      await window.MP.deconnecter();
      notify('☁️ Déconnecté de Google — sauvegardes locales uniquement','#95a5a6');
    } else {
      const u=await window.MP.connecter();
      notify(u.email?`✅ Connecté : ${u.email}`:'✅ Connecté à Google','#2ecc71');
      if(typeof syncProfilAvecDrive==='function') syncProfilAvecDrive();
    }
  }catch(err){ notify('❌ Connexion Google refusée','#e74c3c'); }
  if(typeof refreshSaveInfo==='function') refreshSaveInfo();
}
window.googleAuthClick=googleAuthClick;

function refreshGoogleUI(){
  const show=mpDispo();
  const qui=gAuth.email||gAuth.nom||'Connecté';
  // Le bouton du MENU PAUSE est un .pmenu-btn pleine largeur : il peut porter
  // l'adresse complète en texte plat.
  const b=document.getElementById('gauthbtn');
  if(b){
    b.style.display=show?'flex':'none';
    b.textContent=gAuth.signedIn?`☁️ ${qui} · Déconnexion`:'☁️ Connexion Google';
  }
  // Celui de l'ÉCRAN-TITRE est un .utilbtn de 84 px, dont la mise en page
  // repose sur deux éléments : .uico (l'icône, 19 px) et .ulabel (le libellé,
  // 10 px). Y écrire du texte plat effaçait ces deux éléments : le bouton
  // repassait à la taille de police héritée, débordait sur deux lignes et
  // devenait plus large et plus haut que ses quatre voisins. On reconstruit
  // donc la même structure, avec un libellé COURT (une adresse mail n'entre
  // pas dans 84 px) — l'identité complète part dans l'infobulle.
  const t=document.getElementById('gauthbtn-title');
  if(t){
    t.style.display=show?'flex':'none';
    t.title=gAuth.signedIn?`Connecté : ${qui} — toucher pour se déconnecter`:'Connexion Google';
    const ico=t.querySelector('.uico'), lbl=t.querySelector('.ulabel');
    if(ico) ico.textContent=gAuth.signedIn?'✅':'☁️';
    if(lbl) lbl.textContent=gAuth.signedIn?'Déconnexion':'Google';
  }
}

// Jeton Drive valide, ou null si non connecté / expiré. Pas de
// rafraîchissement silencieux implémenté (hors scope pour un jeu casual) :
// passé l'expiration (~1h), le joueur reclique simplement pour se
// reconnecter — storageSave/Load retombent entre-temps sur le stockage
// local sans jamais bloquer la sauvegarde.
function googleToken(){
  return window.MP&&window.MP.driveToken ? window.MP.driveToken() : null;
}

// ── GOOGLE DRIVE : dossier « appData », cache et propre à ce jeu ─────────
// (invisible dans le Drive normal du joueur, illisible par toute autre
// application — portée volontairement la plus étroite possible).
async function driveFind(name){
  const tok=googleToken(); if(!tok) return null;
  const q=encodeURIComponent(`name='${name}' and trashed=false`);
  const r=await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`,
    {headers:{Authorization:'Bearer '+tok}});
  if(!r.ok) throw new Error('drive find '+r.status);
  const j=await r.json();
  return (j.files&&j.files[0])?j.files[0].id:null;
}
async function driveSave(name,json){
  const tok=googleToken(); if(!tok) return false;
  const id=await driveFind(name);
  if(id){
    // Écrasement conditionnel : si le même compte est connecté sur un autre
    // appareil/onglet et a écrit une sauvegarde plus récente (ts) entre-temps,
    // on refuse d'écraser plutôt que de perdre silencieusement la partie la
    // plus avancée — ce n'est pas une garantie d'atomicité (course toujours
    // possible à la même seconde près), mais ça couvre le cas courant d'un
    // appareil resté en retard qui autosave par-dessus une partie déjà
    // continuée ailleurs.
    try{
      const r0=await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,{headers:{Authorization:'Bearer '+tok}});
      if(r0.ok){
        const distant=await r0.json();
        const local=JSON.parse(json);
        if(distant&&distant.ts&&local&&local.ts&&distant.ts>local.ts){
          console.warn('Sauvegarde Drive plus récente que la locale — écrasement refusé');
          return false;
        }
      }
    }catch(e){ /* lecture de vérification échouée : on retente quand même l'écriture, mieux vaut une sauvegarde qu'aucune */ }
    const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      {method:'PATCH',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:json});
    if(!r.ok) throw new Error('drive update '+r.status);
  } else {
    const boundary='adcbnd'+Date.now();
    const meta=JSON.stringify({name,parents:['appDataFolder']});
    const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`+
               `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':`multipart/related; boundary=${boundary}`},body});
    if(!r.ok) throw new Error('drive create '+r.status);
  }
  return true;
}
async function driveLoad(name){
  const tok=googleToken(); if(!tok) return null;
  const id=await driveFind(name);
  if(!id) return null;
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,{headers:{Authorization:'Bearer '+tok}});
  if(!r.ok) throw new Error('drive load '+r.status);
  return await r.json();
}
async function driveExists(name){
  try{ return !!(await driveFind(name)); }catch(e){ return false; }
}

// ── STOCKAGE (Google Drive → Canvas Claude → localStorage) ─
const SAVE_KEY  = 'adc_save_v1';      // sauvegarde manuelle
const AUTO_KEY  = 'adc_autosave_v1';  // sauvegarde automatique (séparée : n'écrase jamais la manuelle)
const AUTOSAVE_INTERVAL = 180;        // secondes de jeu entre deux sauvegardes auto

async function storageSave(data,key=SAVE_KEY){
  const json=JSON.stringify(data);
  // 0. Google Drive si connecté — a la priorité : la sauvegarde suit alors
  // le compte plutôt que l'appareil. Échec silencieux (jeton expiré, hors-
  // ligne…) : on retombe sur les paliers suivants, jamais de sauvegarde
  // perdue pour une simple coupure réseau côté Drive.
  if(googleToken()){
    // driveSave() renvoie false (sans lever d'exception) quand elle a refusé
    // d'écraser une sauvegarde distante plus récente — dans ce cas on NE
    // rapporte PAS un succès Drive fictif, on retombe sur les paliers
    // suivants comme pour tout autre échec.
    try{ if(await driveSave(key+'.json', json)) return 'google'; } catch(e){ console.warn('Sauvegarde Drive échouée',e); }
  }
  // 1. Essayer window.storage (Claude Canvas)
  if(window.storage){
    try{ await window.storage.set(key, json); return 'canvas'; } catch(e){}
  }
  // 2. Fallback localStorage (Safari iOS)
  try{ localStorage.setItem(key, json); return 'local'; } catch(e){}
  return null;
}

async function storageLoad(key=SAVE_KEY){
  // 0. Google Drive
  if(googleToken()){
    try{ const d=await driveLoad(key+'.json'); if(d) return d; } catch(e){ console.warn('Lecture Drive échouée',e); }
  }
  // 1. window.storage
  if(window.storage){
    try{
      const r=await window.storage.get(key);
      if(r&&r.value) return JSON.parse(r.value);
    } catch(e){}
  }
  // 2. localStorage
  try{
    const raw=localStorage.getItem(key);
    if(raw) return JSON.parse(raw);
  } catch(e){}
  return null;
}

async function checkSaveExists(key=SAVE_KEY){
  if(googleToken()){
    try{ if(await driveExists(key+'.json')) return true; } catch(e){}
  }
  if(window.storage){
    try{ const r=await window.storage.get(key); return !!(r&&r.value); } catch(e){}
  }
  try{ return !!localStorage.getItem(key); } catch(e){}
  return false;
}

// Résumé lisible d'une sauvegarde (pour savoir ce qu'on recharge)
function saveLabel(d){
  if(!d) return null;
  const dt=new Date(d.ts||Date.now());
  const ages=['Sombre','Féodal','Châteaux','Impérial'];
  const jour=dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
  const heure=dt.getHours()+':'+String(dt.getMinutes()).padStart(2,'0');
  return `Vague ${d.wave} · Âge ${ages[d.age||0]} · ${jour} ${heure}`;
}

// Affiche l'état des deux emplacements dans le menu pause
async function refreshSaveInfo(){
  const el=document.getElementById('save-info');
  if(!el) return;
  const [man,auto]=await Promise.all([storageLoad(SAVE_KEY),storageLoad(AUTO_KEY)]);
  const lines=[];
  if(gAuth.signedIn) lines.push(`☁️ Compte : <b>${gAuth.email||'connecté'}</b>`);
  lines.push(man?`💾 Manuelle : <b>${saveLabel(man)}</b>`:'💾 Manuelle : <b>aucune</b>');
  lines.push(auto?`⏱️ Auto : <b>${saveLabel(auto)}</b>`:'⏱️ Auto : <b>aucune</b>');
  el.innerHTML=lines.join('<br>');
  const ab=document.getElementById('autoloadbtn');
  if(ab) ab.style.display=auto?'block':'none';
}

// ── SAUVEGARDER ───────────────────────────────────────────
async function saveGame(){
  const st=document.getElementById('save-status');
  st.textContent='💾 Sauvegarde en cours…';
  st.style.color='#f0c040';
  try{
    const data=buildSaveData();
    const medium=await storageSave(data);
    if(medium){
      const where=medium==='google'?'Google Drive':medium==='canvas'?'Claude Canvas':'cet appareil';
      st.textContent=`✅ Sauvegardé (${where}) — ${saveLabel(data)}`;
      st.style.color='#2ecc71';
      refreshSaveInfo();
    } else {
      st.textContent='❌ Échec — stockage indisponible';
      st.style.color='#e74c3c';
    }
  } catch(err){
    st.textContent='❌ Erreur : '+err.message;
    st.style.color='#e74c3c';
  }
}

function buildSaveData(){
    return {
      v:8,         // v8 : N factions (v7 : coordonnées monde en unités BASE_TILE)
      ts:Date.now(),
      tile:TILE,   // zoom courant — purement cosmétique depuis la v7 (on le
                   // restaure pour retrouver la même vue), mais indispensable
                   // pour convertir les sauvegardes v6 dont les positions
                   // étaient exprimées en pixels à CE zoom. Voir migrerSauvegarde().
      difficulty:G.difficulty,
      mode:G.gmode,
      seed:G.seed,
      carte:G.carte,
      // Taille de la carte (voir TAILLES). Le chargement la relit d'abord
      // dans les tuiles sauvegardées, ce champ n'est qu'un confort de
      // lecture — mais il permet de revenir à l'écran-titre sur le bon
      // réglage après avoir repris une partie.
      taille:G.taille,
      // Tous les camps, brouillard compris (chaque faction humaine a le sien).
      factions:JSON.parse(JSON.stringify(G.factions)),
      me:G.me,
      campTotal:G.campTotal||0,
      wave:G.wave, waveTimer:G.waveTimer, waveActive:G.waveActive,
      cam:{...G.cam},
      gameTime:G.gameTime, targetWaves:G.targetWaves, victory:G.victory,
      tiles:G.tiles, bmap:G.bmap,
      nodes:G.nodes.map(n=>({...n, gatherers:[]})),
      relics:(G.relics||[]).map(r=>({...r})),
      wildlife:(G.wildlife||[]).map(w=>({...w})),
      buildings:G.buildings.map(b=>({...b, trainQ:[...b.trainQ]})),
      units:G.units.map(u=>({...u, pendingAction:null})),
    };
}

// ── SAUVEGARDE AUTOMATIQUE (silencieuse, emplacement séparé) ──
let _autoTimer=0, _autoBusy=false;
async function autoSave(reason){
  if(_autoBusy||!G.running||G.victory) return;
  _autoBusy=true;
  try{
    const ok=await storageSave(buildSaveData(),AUTO_KEY);
    if(ok){
      notify('💾 Sauvegarde auto'+(reason?' ('+reason+')':''),'#7f8c8d');
      refreshSaveInfo();
    }
  }catch(e){}
  _autoBusy=false;
}

function updateAutoSave(dt){
  if(!G.running||G.paused) return;
  _autoTimer+=dt;
  if(_autoTimer>=AUTOSAVE_INTERVAL){ _autoTimer=0; autoSave(); }
}

// ── MIGRATION DES SAUVEGARDES ─────────────────────────────
// Chaînée : chaque palier ne connaît que le passage de v(n) à v(n+1).
//
// v6 -> v7 : jusqu'à la v6, les coordonnées monde étaient des pixels au zoom
// courant (champ `tile`). Elles sont désormais en unités BASE_TILE, fixes.
// On divise donc tout ce qui est une coordonnée ou une distance monde par
// l'échelle à laquelle la sauvegarde a été écrite. Les indices de tuile
// (b.tx/b.ty, n.tx/n.ty) n'ont jamais dépendu du zoom : on n'y touche pas.
function migrerSauvegarde(data){
  if(!data||typeof data!=='object') return data;
  if((data.v||0)<7){
    const k=(data.tile||BASE_TILE)/BASE_TILE; // échelle d'écriture
    if(k&&k!==1){
      const d=v=>(typeof v==='number'?v/k:v);
      for(const u of (data.units||[])){
        u.x=d(u.x); u.y=d(u.y);
        // v6 nommait ces champs tx/ty (destination), homonymes des indices
        // de tuile des bâtiments — renommés destX/destY depuis.
        u.destX=d(u.destX!=null?u.destX:u.tx); u.destY=d(u.destY!=null?u.destY:u.ty);
        delete u.tx; delete u.ty;
        u.rng=d(u.rng);
        if(u.path) for(const wp of u.path){ wp.x=d(wp.x); wp.y=d(wp.y); }
        if(u.pathGoal){ u.pathGoal.x=d(u.pathGoal.x); u.pathGoal.y=d(u.pathGoal.y); }
        if(u.campX!=null){ u.campX=d(u.campX); u.campY=d(u.campY); }
        if(u.anchorX!=null){ u.anchorX=d(u.anchorX); u.anchorY=d(u.anchorY); }
        if(u.amove){ u.amove.x=d(u.amove.x); u.amove.y=d(u.amove.y); }
      }
      // b.x/b.y et n.x/n.y sont de toute façon recalculés depuis tx/ty par
      // refreshNodePos() au chargement ; on les corrige quand même pour ne
      // pas laisser de valeurs incohérentes dans l'objet.
      for(const b of (data.buildings||[])){
        b.x=d(b.x); b.y=d(b.y);
        if(b.rally){ b.rally.x=d(b.rally.x); b.rally.y=d(b.rally.y); }
      }
      for(const n of (data.nodes||[])){ n.x=d(n.x); n.y=d(n.y); }
      if(data.ai){ data.ai.baseX=d(data.ai.baseX); data.ai.baseY=d(data.ai.baseY); }
    } else {
      // Même à l'échelle 1, le renommage tx/ty -> destX/destY s'applique.
      for(const u of (data.units||[])){
        if(u.destX==null&&u.tx!=null){ u.destX=u.tx; u.destY=u.ty; }
        delete u.tx; delete u.ty;
      }
    }
    data.v=7;
  }
  // v7 -> v8 : un joueur + une IA deviennent des factions nommées. Les
  // propriétaires 'player'/'enemy' sont réécrits ; 'enemy' se scinde selon
  // que l'entité appartenait à l'IA de Conquête (marqueur .ai) ou aux
  // pillards de vague / garnisons de points d'intérêt.
  if((data.v||0)<8){
    const versFaction=e=>{
      if(e.owner==='player') return FAC.P1;
      if(e.owner==='enemy')  return (e.ai||e.camp==='ai')?FAC.IA:FAC.PILL;
      return e.owner;
    };
    for(const u of (data.units||[])) u.owner=versFaction(u);
    for(const b of (data.buildings||[])) b.owner=versFaction(b);
    // Une garde de camp repérait son poste par u.camp==='ai' : désormais
    // c'est l'identifiant de faction.
    for(const u of (data.units||[])) if(u.camp==='ai') u.camp=FAC.IA;

    const diff=DIFFS[data.difficulty]||DIFFS.normal;
    const facs={};
    const p1=mkFaction(FAC.P1,{genre:'humain',equipe:1,nom:'Vous',res:data.res||diff.startRes,maxPop:data.maxPop||5,civ:data.civ});
    p1.age=data.age||0; p1.ageUpQ=data.ageUpQ||null;
    p1.research=Object.assign(initResearch(),data.research||{});
    p1.researchQ=(data.researchQ||[]).map(r=>({...r}));
    p1.pop=data.pop||0;
    p1.stats=Object.assign(initStats(),data.stats||{});
    p1.stats.gathered=Object.assign({food:0,wood:0,stone:0,gold:0},(data.stats&&data.stats.gathered)||{});
    p1.autoRepair=!!data.autoRepair;
    p1.fog=data.fog||[];
    facs[FAC.P1]=p1;
    facs[FAC.PILL]=mkFaction(FAC.PILL,{genre:'neutre',equipe:0,hostileATous:true});
    if(data.ai){
      const ia=mkFaction(FAC.IA,{genre:'ia',equipe:3,nom:'Seigneur rival',res:data.ai.res,maxPop:data.ai.maxPop,civ:data.ai.civ});
      Object.assign(ia,{
        age:data.ai.age||0, pop:data.ai.pop||0,
        baseX:data.ai.baseX, baseY:data.ai.baseY, tcId:data.ai.tcId,
        think:data.ai.think||0, ageQ:data.ai.ageQ||null,
        atkTimer:data.ai.atkTimer, atkMin:data.ai.atkMin, raids:data.ai.raids||0,
        vilTarget:data.ai.vilTarget,
      });
      facs[FAC.IA]=ia;
    }
    data.factions=facs; data.me=FAC.P1;
    delete data.res; delete data.pop; delete data.maxPop; delete data.research;
    delete data.researchQ; delete data.age; delete data.ageUpQ; delete data.stats;
    delete data.autoRepair; delete data.fog; delete data.ai;
    data.v=8;
  }
  return data;
}

// ── CHARGER ───────────────────────────────────────────────
async function loadAutoSave(){ return loadGame(AUTO_KEY); }

async function loadGame(key=SAVE_KEY){
  const st=document.getElementById('save-status');
  // Le bouton est déjà masqué en ligne (voir openPause), mais on bloque ici
  // aussi : charger une sauvegarde remplace G.units/buildings/factions sans
  // toucher RESEAU, ce qui désynchronise durablement les deux joueurs.
  if(reseauActif()){
    notify('📂 Chargement indisponible en partie en ligne','#e74c3c');
    return;
  }
  if(st) { st.textContent='📂 Chargement…'; st.style.color='#3498db'; }
  try{
    let data=await storageLoad(key);
    if(!data){
      if(st){ st.textContent='❌ Aucune sauvegarde trouvée'; st.style.color='#e74c3c'; }
      notify('❌ Aucune sauvegarde trouvée','#e74c3c');
      return;
    }
    // Met la sauvegarde au format courant AVANT toute lecture de ses champs.
    data=migrerSauvegarde(data);
    // Fermer les menus
    document.getElementById('pausemenu').style.display='none';
    document.getElementById('overlay').style.display='none';
    document.getElementById('pausebtn-inner').innerHTML=iconImg('⏸',16);
    resizeCanvas();
    // Taille de la carte AVANT toute lecture de COLS/ROWS ci-dessous (repli
    // du brouillard, bornage des unités, re-marquage des bâtiments) : une
    // partie 320×320 rechargée avec COLS resté à 240 laisserait un tiers de
    // la carte hors des grilles. La source de vérité est la TAILLE RÉELLE
    // des tuiles enregistrées — les sauvegardes antérieures à ce champ
    // s'ouvrent donc correctement elles aussi.
    {
      const n=(data.tiles&&data.tiles.length)
              ||(TAILLES[data.taille]&&TAILLES[data.taille].n)||240;
      appliquerTailleCarte(n);
      if(data.taille&&TAILLES[data.taille]) selectedTaille=data.taille;
    }
    // Type de carte AVANT buildSprites() ci-dessous : depuis que chaque carte
    // a sa propre texture de sol (voir SOLS), c'est lui qui décide de la
    // matière peinte dans l'atlas. Restauré trop tard, une partie « Terres
    // Arides » se rouvrait avec l'herbe de la carte précédente.
    // G.carte n'était d'ailleurs pas restauré du tout : le sol, la mini-carte
    // et les multiplicateurs de preset lisent tous carteCfg()/solCfg().
    selectedCarte=(data.carte&&CARTES[data.carte])?data.carte:'plaines';
    G.carte=selectedCarte;
    G.taille=selectedTaille;
    // On restaure le TILE EXACT de la sauvegarde plutôt que de le recalculer
    // depuis zoomLevel (qui ne suit plus le zoom réel depuis les pincements
    // libres) : sans ça, les positions sauvegardées — en pixels, à l'ancien
    // zoom — ne correspondent plus aux cases de tuile une fois rechargées,
    // ce qui décale l'affichage des bâtiments par rapport à leur zone de
    // clic et fait apparaître les villageois loin de leur poste (ferme, etc).
    TILE=data.tile?Math.max(TILE_MIN,Math.min(TILE_MAX,Math.round(data.tile)))
                  :Math.round(BASE_TILE*ZOOMS[zoomLevel]); // anciennes sauvegardes sans ce champ
    buildSprites(); // pré-rendu pixel art à la bonne échelle
    // Restaurer l'état
    G.running=false; G.paused=false;
    // Sauvegardes antérieures à ce champ : Normal par défaut (comportement historique)
    G.difficulty=(data.difficulty&&DIFFS[data.difficulty])?data.difficulty:'normal';
    selectedDifficulty=G.difficulty; // cohérence si le joueur revient à l'écran-titre
    // Sauvegardes antérieures au mode Conquête : Survie par défaut, sans IA.
    G.gmode=(data.mode&&MODES[data.mode])?data.mode:'survival';
    selectedMode=G.gmode;
    // Toutes les factions d'un coup : chacune porte sa caisse, son âge, ses
    // recherches, sa population, son brouillard et ses compteurs. Les
    // sauvegardes antérieures ont été converties par migrerSauvegarde().
    G.factions={};
    for(const[id,f] of Object.entries(data.factions||{})){
      const nf=mkFaction(id,{genre:f.genre,equipe:f.equipe,teinte:f.teinte,nom:f.nom,
                             hostileATous:f.hostileATous,res:f.res,maxPop:f.maxPop});
      Object.assign(nf,f);
      nf.research=Object.assign(initResearch(),f.research||{});
      nf.stats=Object.assign(initStats(),f.stats||{});
      nf.stats.gathered=Object.assign({food:0,wood:0,stone:0,gold:0},(f.stats&&f.stats.gathered)||{});
      nf.fog=f.fog||[];
      G.factions[id]=nf;
    }
    G.me=(data.me&&G.factions[data.me])?data.me:FAC.P1;
    G.seed=data.seed||G.seed;
    G.campTotal=data.campTotal||0;
    G.wave=data.wave; G.waveTimer=data.waveTimer; G.waveActive=data.waveActive;
    G.cam={...data.cam};
    clampCam(); // même défaut que pour les bâtiments : une vieille sauvegarde
                // sans le zoom exact peut placer la caméra hors de la carte
    G.gameTime=data.gameTime||0; G.targetWaves=data.targetWaves||20; G.victory=data.victory||false;
    // Une sauvegarde decrit TOUJOURS une partie en cours (autoSave refuse une
    // partie finie, et on ne sauvegarde pas depuis l'ecran de defaite). Le
    // drapeau de defaite, lui, ne repartait jamais a faux : perdre puis
    // recharger laissait G.gameOver=true pour le restant de la session, et
    // update() saute alors TOUTES les conditions de fin (voir sa ligne
    // `if(!G.victory&&!G.gameOver)` et checkMerveilleVictory) — la partie
    // rechargee ne pouvait plus etre ni gagnee ni reperdue. G.victory, lui,
    // est bien restaure : on peut continuer a jouer apres une victoire.
    G.gameOver=false;
    G.tiles=data.tiles; G.bmap=data.bmap;
    invalidateTerrainChunks(); // les pavés en cache décrivent la carte précédente
    _mmFondVer=-1;             // idem pour le fond de mini-carte
    // Compat : brouillard absent (très vieille sauvegarde) = tout révélé
    for(const f of factionsHumaines()){
      if(f.fog&&f.fog.length) continue;
      const g=[]; for(let y=0;y<ROWS;y++){ g[y]=[]; for(let x=0;x<COLS;x++) g[y][x]=1; }
      f.fog=g;
    }
    G.nodes=data.nodes.map(n=>({...n, gatherers:[]}));
    // Anciennes sauvegardes sans reliques (v8 pré-reliques) : liste vide,
    // sans crash — elles réapparaîtront simplement à la prochaine partie.
    G.relics=(data.relics||[]).map(r=>({...r, carrier:null}));
    // Anciennes sauvegardes sans gibier : liste vide, sans crash.
    G.wildlife=(data.wildlife||[]).map(w=>({...w}));
    G.buildings=data.buildings.map(b=>({...b, trainQ:[...(b.trainQ||[])], farmers:[],
      level: b.level||1, // anciennes sauvegardes : pas de niveau -> Tour de Guet (niveau 1)
      foodLeft: b.type===BT.FARM ? (b.foodLeft!=null?b.foodLeft:FARM_FOOD) : (b.foodLeft||0)}));
    // Recalcule TOUJOURS x,y depuis tx,ty (indices de tuile, indépendants du
    // zoom) au TILE actuel, sans se fier au x,y sauvegardé. Nécessaire même
    // avec le champ "tile" ajouté ci-dessus : les sauvegardes déjà écrites
    // par une version antérieure du jeu n'ont pas ce champ et restent sinon
    // décalées pour toujours — c'est ce qui rendait les bâtiments non
    // cliquables (le clic teste tx*TILE, le rendu dessinait l'ancien x,y).
    refreshNodePos();
    G.units=data.units.map(u=>({...u, pendingAction:null}));
    // Filet de sécurité pour les mêmes vieilles sauvegardes (zoom perdu) :
    // sans repère de grille pour une unité, on ne peut pas recalculer sa
    // position exacte comme pour les bâtiments — on s'assure juste qu'elle
    // ne se retrouve pas visuellement hors de la carte ; le pathing la
    // ramène ensuite naturellement vers sa tâche (ferme, gisement, etc).
    {
      const mw=COLS*BASE_TILE, mh=ROWS*BASE_TILE;
      for(const u of G.units){
        u.x=Math.max(0,Math.min(mw,u.x));
        u.y=Math.max(0,Math.min(mh,u.y));
      }
    }
    // Re-marque tout bâtiment comme solide (sauf Ferme), y compris pour les
    // sauvegardes antérieures à cette règle : leur grille stockée reflète
    // l'ancien comportement (seuls les murs bloquaient) et resterait sinon
    // franchissable pour toujours après un chargement.
    for(const b of G.buildings) if(b.type!==BT.FARM){
      const mark=(b.type===BT.GATE&&b.open)?0:3;
      for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++)
        if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=mark;
    }
    G.projs=[]; G.parts=[]; G.ftexts=[]; G.sel=[]; G.deathfx=[]; G.shake={mag:0};
    G.mode='select'; G.buildType=null; G.ghost=null; G.wallLine=null;
    // Un chargement en pleine pose de bâtiment laissait ✕/✓ affichés pour de
    // bon (rien ne les cache jamais côté chargement) — G.mode repasse à
    // 'select' juste au-dessus, l'affichage doit suivre.
    const bc=document.getElementById('bcancel'); if(bc) bc.style.display='none';
    const bk=document.getElementById('bconfirm'); if(bk) bk.style.display='none';
    const bp=document.getElementById('bpin'); if(bp) bp.style.display='none';
    _wallAnchor=null; _wallLinePending=false;
    G.speed=1; G.rateAcc={food:0,wood:0,stone:0,gold:0}; G.rateShow={food:0,wood:0,stone:0,gold:0}; G.rateTimer=0;
    G.nid=Math.max(...[...G.units,...G.buildings,...G.nodes].map(e=>e.id||0),0)+1;
    G.lastTime=null;
    G.running=true;
    rebuildIndex(); // même raison qu'au démarrage : l'index doit être prêt avant la 1ère image
    setSpeed(1);
    applyDifficultyBadge();
    syncAutoRepairBtn();
    syncShelterBtn();
    refreshUI();
    requestAnimationFrame(loop);
    const d=new Date(data.ts);
    const label=`Vague ${G.wave} — ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    notify(`📂 Partie restaurée — ${label}`,'#2ecc71');
  } catch(err){
    if(st){ st.textContent='❌ Erreur : '+err.message; st.style.color='#e74c3c'; }
    notify('❌ Erreur de chargement','#e74c3c');
  }
}

// Restaure la difficulté choisie la dernière fois et synchronise l'écran-titre
// (surbrillance du bouton, texte explicatif, délai de paix annoncé) avec elle.
try{
  const savedDiff=localStorage.getItem('adc_diff');
  if(savedDiff&&DIFFS[savedDiff]) selectedDifficulty=savedDiff;
}catch(e){}
try{ pickDifficulty(selectedDifficulty); }catch(e){}

// Idem pour la civilisation.
try{
  const savedCiv=localStorage.getItem('adc_civ');
  if(savedCiv&&CIVS[savedCiv]) selectedCiv=savedCiv;
}catch(e){}
try{ pickCiv(selectedCiv); }catch(e){}

// Idem pour le type et la taille de carte. pickCarte() et pickTaille()
// écrivaient déjà leur choix dans localStorage, mais personne ne le relisait :
// l'écran-titre revenait aux Plaines à chaque ouverture, quel qu'ait été le
// dernier choix.
try{
  const savedCarte=localStorage.getItem('adc_carte');
  if(savedCarte&&CARTES[savedCarte]) selectedCarte=savedCarte;
}catch(e){}
try{ pickCarte(selectedCarte); }catch(e){}
try{
  const savedTaille=localStorage.getItem('adc_taille');
  if(savedTaille&&TAILLES[savedTaille]) selectedTaille=savedTaille;
}catch(e){}
try{ pickTaille(selectedTaille); }catch(e){}

// Idem pour le mode de partie, puis chargement du profil persistant (succès
// acquis, parties jouées) : l'écran-titre doit afficher la progression réelle
// dès l'ouverture, avant toute partie.
// jamaisChoisi CAPTURÉ AVANT pickMode() : celui-ci écrit lui-même adc_mode,
// la clé existerait donc déjà si on la lisait après.
let _jamaisChoisi=true;
try{
  const savedMode=localStorage.getItem('adc_mode');
  _jamaisChoisi=!savedMode;
  if(savedMode&&MODES[savedMode]) selectedMode=savedMode;
}catch(e){}
// Onglet Solo/Multi restauré AVANT pickMode() : pickPlayTab() décide si le
// bouton "2v1 coop" est visible, et rabat selectedMode sur Conquête s'il
// était resté sur 2v1 Coop côté Solo (voir pickPlayTab(), js/01-regles.js).
try{
  const savedTab=localStorage.getItem('adc_playtab');
  if(savedTab==='multi') selectedPlayTab='multi';
}catch(e){}
try{ pickPlayTab(selectedPlayTab); }catch(e){}
try{ pickMode(selectedMode); }catch(e){}
// Résumé mode+difficulté déplié uniquement au tout premier lancement (aucun
// mode jamais choisi sur cet appareil) : un nouveau joueur doit voir les
// options d'emblée, un joueur qui revient préfère un écran-titre court.
try{
  const det=document.getElementById('cfgdetails');
  const btn=document.getElementById('cfgsummary');
  if(_jamaisChoisi&&det&&btn){ det.style.display='flex'; btn.classList.add('open'); }
}catch(e){}
loadProfile().then(refreshAchCount); // storageLoad() : instantané tant que non connecté à Google

// ── VÉRIFIER SAVE AU LANCEMENT ────────────────────────────
(async()=>{
  const [man,auto]=await Promise.all([storageLoad(SAVE_KEY),storageLoad(AUTO_KEY)]);
  const btn=document.getElementById('loadbtn');
  if(!man&&!auto) return;
  // proposer la sauvegarde la plus récente des deux
  const useAuto=(!man)||(auto&&auto.ts>man.ts);
  const d=useAuto?auto:man;
  btn.style.display='block';
  btn.innerHTML=(useAuto?'⏱️ Reprendre (auto)':'📂 Reprendre la partie')+
    `<div style="font-size:11px;opacity:.75;font-weight:400;margin-top:2px;">${saveLabel(d)}</div>`;
  btn.onclick=()=>loadGame(useAuto?AUTO_KEY:SAVE_KEY);
})();

// Partie en ligne interrompue par un rechargement de MA page : proposer de
// la reprendre (voir REJOIN_KEY). Purement local à localStorage : aucune
// requête réseau tant que le joueur n'a pas cliqué.
(function(){
  const r=lireRejoinEnLigne();
  const btn=document.getElementById('mprejoinbtn');
  if(btn&&r) btn.style.display='block';
})();
