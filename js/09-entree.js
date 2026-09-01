'use strict';
// ======================================================================
//  09-entree.js
// ======================================================================
// Entree : tactile, souris, clavier, groupes de controle, survol,
// selection et emission des ordres locaux.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── ENTRÉE TACTILE ────────────────────────────────────────
let tSX=0,tSY=0,tST=0,isDrag=false,dCX=0,dCY=0;
let lastTapT=0,lastTapX=0,lastTapY=0;
let boxSelecting=false;
let pinching=false, pinchD0=0, pinchT0=0, pinchMX=0, pinchMY=0;
let dblHold=false, dblHoldMoved=false;
let velX=0, velY=0, lastMoveT=0;
let glideX=0, glideY=0;
let noGlideUntil=0;              // pas d'inertie juste après un pincement
const MAX_VEL=26;                // px par image : borne dure contre les téléportations
const clampVel=v=>Math.max(-MAX_VEL,Math.min(MAX_VEL,v));

const dist2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Ancre le déplacement à un doigt (appelé au début ET après la levée d'un doigt)
function anchorPan(p){
  tSX=p.x; tSY=p.y; dCX=G.cam.x; dCY=G.cam.y;
  isDrag=false; velX=velY=0; glideX=glideY=0; lastMoveT=Date.now();
}

// Termine un pincement : régénère les sprites à l'échelle finale
function endPinch(){
  if(!pinching) return;
  pinching=false;
  velX=velY=0; glideX=glideY=0;
  noGlideUntil=Date.now()+260; // le relâchement d'un pincement ne doit rien projeter
  // Même barreau d'échelle qu'à la molette (voir sprRungFor) : comparer à TILE
  // exact ferait regenerer l'atlas à la fin de CHAQUE pincement, alors que
  // l'échelle atteinte tombe presque toujours dans la tolérance du barreau
  // déjà en place — c'est le geste de zoom du mobile, celui qui doit le
  // moins accrocher.
  const rung=sprRungFor(TILE);
  if(SPR.refT!==rung) demarrerAtlas(rung);
}

// ── DÉBUT DE GESTE ──
function gestureStart(pts){
  glideX=glideY=0; // couper l'inertie
  if(pts.length>=2){
    pinching=true; boxSelecting=false; isDrag=false; dblHold=false;
    G.selBox=null;
    pinchD0=Math.max(1,dist2(pts[0],pts[1]));
    pinchT0=TILE;                       // référence = taille réelle, pas une échelle qui dérive
    pinchMX=(pts[0].x+pts[1].x)/2; pinchMY=(pts[0].y+pts[1].y)/2;
    return;
  }
  const p=pts[0];
  tST=Date.now();
  anchorPan(p);
  boxSelecting=false; dblHoldMoved=false;
  // second appui rapide au même endroit et maintenu => rectangle de sélection
  dblHold=(tST-lastTapT<320 && Math.hypot(p.x-lastTapX,p.y-lastTapY)<36);
}

// ── DÉPLACEMENT ──
function gestureMove(pts){
  // Pincement à deux doigts : zoom ancré + glissement simultané
  if(pinching&&pts.length>=2){
    const d=Math.max(1,dist2(pts[0],pts[1]));
    const mx=(pts[0].x+pts[1].x)/2, my=(pts[0].y+pts[1].y)/2;
    applyZoomToTile(pinchT0*(d/pinchD0), mx, my);
    G.cam.x-=(mx-pinchMX); G.cam.y-=(my-pinchMY);
    pinchMX=mx; pinchMY=my;
    clampCam();
    return;
  }
  // Un doigt restant après un pincement : on ré-ancre au lieu de sauter
  if(pinching&&pts.length===1){ endPinch(); anchorPan(pts[0]); return; }
  if(!pts.length) return;

  const p=pts[0];
  const dx=p.x-tSX, dy=p.y-tSY;

  // Double-tap maintenu puis glissé => rectangle
  if(dblHold&&G.mode!=='build'){
    if(!boxSelecting&&(Math.abs(dx)>6||Math.abs(dy)>6)){
      boxSelecting=true;
      G.selBox={x0:tSX,y0:tSY,x1:p.x,y1:p.y};
    }
    if(boxSelecting){
      dblHoldMoved=true;
      G.selBox.x1=p.x; G.selBox.y1=p.y;
      return;
    }
  }

  // Sinon : un doigt = déplacement de la carte — SAUF en mode construction,
  // où le doigt fait glisser l'aperçu à la place (voir plus bas). Faire
  // bouger le monde SOUS l'aperçu pendant qu'on essaie de le viser était
  // exactement la confusion décrite ("on sait pas trop où ça tombe") : le
  // pincement à deux doigts reste disponible pour recadrer la vue pendant
  // la pose (voir plus haut, avant ce bloc).
  if(Math.abs(dx)>5||Math.abs(dy)>5){
    isDrag=true;
    if(G.mode!=='build'){
      const now=Date.now(), dtm=Math.max(10,now-lastMoveT);
      const prevX=G.cam.x, prevY=G.cam.y;
      G.cam.x=dCX-dx; G.cam.y=dCY-dy;
      clampCam();
      // vitesse instantanée (delta de cette image seulement), bornée
      velX=clampVel((prevX-G.cam.x)/dtm*16);
      velY=clampVel((prevY-G.cam.y)/dtm*16);
      lastMoveT=now;
    }
  }
  if(G.mode==='build'){
    const {x:wx,y:wy}=sw(p.x,p.y);
    updateGhost(wx/BASE_TILE|0, wy/BASE_TILE|0);
  }
}

// ── FIN DE GESTE ── (pts = doigts encore posés, ended = doigt relevé)
function gestureEnd(pts,ended){
  if(pinching){
    if(pts.length>=2) return;          // encore deux doigts : rien à faire
    endPinch();
    if(pts.length===1){ anchorPan(pts[0]); return; } // reprise du déplacement, sans saut
    return;                             // plus aucun doigt
  }

  if(boxSelecting&&G.selBox){
    applyBoxSelection(G.selBox);
    G.selBox=null; boxSelecting=false; isDrag=false; dblHold=false;
    return;
  }

  const wasDbl=dblHold; dblHold=false;
  if(isDrag){
    isDrag=false;
    const now=Date.now();
    const moving=(now-lastMoveT)<90;       // doigt encore en mouvement à la levée
    const allowed=now>=noGlideUntil;       // pas juste après un pincement
    if(moving&&allowed&&(Math.abs(velX)>1.5||Math.abs(velY)>1.5)){
      glideX=clampVel(velX); glideY=clampVel(velY);
    } else { glideX=glideY=0; }
    velX=velY=0;
    return;
  }
  if(!ended) return;
  const sx=ended.x, sy=ended.y;
  const bp=document.getElementById('botpanel').getBoundingClientRect();
  if(sy>bp.top||sy<54) return;

  if(wasDbl&&!dblHoldMoved){ handleDoubleTap(sx,sy); lastTapT=0; return; }
  lastTapT=Date.now(); lastTapX=sx; lastTapY=sy;
  handleTap(sx,sy);
}

const toPts=(tl)=>Array.from(tl).map(t=>({x:t.clientX,y:t.clientY}));
// Horodatage du dernier contact tactile — sert de garde-fou pour le clic
// droit (voir plus bas) : un appui long au doigt peut, sur certains
// navigateurs Android, déclencher malgré tout un évènement `contextmenu`
// natif même quand touchstart a appelé preventDefault(). Sans ce garde-fou,
// un appui long tactile désélectionnerait par erreur au lieu de lancer le
// rectangle de sélection (double-tap maintenu).
let _lastTouchAt=0;
// À la souris, le survol montre l'aperçu de construction AVANT le clic (voir
// le mousemove plus bas) : cliquer confirme donc ce qu'on a déjà vu. Au
// doigt, rien ne montre l'aperçu avant le premier contact — poser au premier
// tap revenait à construire un bâtiment qu'on n'avait jamais vu ("on sait pas
// trop où ça tombe"). Ce drapeau distingue les deux pour handleTap (voir plus
// bas) : tactile positionne seulement, la confirmation passe par ✓.
let _touchDriven=false;
canvas.addEventListener('touchstart',e=>{ _lastTouchAt=Date.now(); _touchDriven=true; e.preventDefault(); gestureStart(toPts(e.touches));},{passive:false});
canvas.addEventListener('touchmove', e=>{e.preventDefault(); gestureMove(toPts(e.touches));},{passive:false});
canvas.addEventListener('touchend',  e=>{e.preventDefault();
  const ch=e.changedTouches[0];
  gestureEnd(toPts(e.touches), ch?{x:ch.clientX,y:ch.clientY}:null);
},{passive:false});
canvas.addEventListener('touchcancel',()=>{
  endPinch(); boxSelecting=false; dblHold=false; isDrag=false; G.selBox=null;
},{passive:false});

// ── SOURIS (PC) ──────────────────────────────────────────
// La souris n'a pas de multi-touch : on réutilise directement la même
// machine à états que le tactile (gestureStart/Move/End) avec un tableau
// à un seul point — clic-glisser = déplacement de la caméra, double-clic
// maintenu puis glissé = rectangle de sélection (exactement la même
// logique que le double-tap tactile, alimentée par des clics à la place).
// Le pincement (zoom) n'a pas d'équivalent souris : c'est la molette qui
// s'en charge séparément, ancrée sous le curseur.
let mouseDown=false;
function resetMouseGesture(){
  mouseDown=false; endPinch(); boxSelecting=false; dblHold=false; isDrag=false; G.selBox=null;
}
canvas.addEventListener('mousedown',e=>{
  if(e.button!==0) return; // seul le clic gauche pilote le geste (le droit gère la désélection, voir contextmenu)
  mouseDown=true; _touchDriven=false;
  gestureStart([{x:e.clientX,y:e.clientY}]);
});
canvas.addEventListener('mousemove',e=>{
  // Aperçu de placement en mode construction : suit le curseur même sans
  // bouton enfoncé (le tactile ne peut pas faire ça, faute de survol).
  if(G.mode==='build'){
    const {x:wx,y:wy}=sw(e.clientX,e.clientY);
    updateGhost(wx/BASE_TILE|0, wy/BASE_TILE|0);
  }
  if(mouseDown) gestureMove([{x:e.clientX,y:e.clientY}]);
  // Survol (souris uniquement, pas de doigt enfoncé) : met en évidence la
  // cible sous le curseur et adapte le curseur — confort desktop pur.
  if(!mouseDown) updateHoverAt(e.clientX,e.clientY);
  updateCursor();
});
canvas.addEventListener('mouseleave',()=>{ G.hover=null; canvas.style.cursor='default'; });
window.addEventListener('mouseup',e=>{
  if(!mouseDown||e.button!==0) return;
  mouseDown=false;
  gestureEnd([], {x:e.clientX,y:e.clientY});
});
window.addEventListener('blur',resetMouseGesture); // alt-tab pendant un glisser : ne pas rester bloqué
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const dir=e.deltaY<0?1:-1; // molette vers le haut = zoom avant, comme sur une carte
  applyZoomToTile(TILE*(dir>0?1.12:0.9), e.clientX, e.clientY);
  // pas de buildSprites() immédiat ici : applyZoomToTile a déjà appelé
  // markSpritesDirty(), qui régénère l'atlas une seule fois après une
  // courte pause — un défilement rapide de molette ne doit pas déclencher
  // une regénération coûteuse à chaque cran.
},{passive:false});
// Clic droit = désélection rapide (et annule un mode de construction / marche
// d'attaque en cours), exactement comme Échap — pratique souris sans avoir à
// viser le bouton ✕. Le menu contextuel du navigateur reste bloqué (voir plus
// bas), donc le clic droit ne fait jamais rien d'autre ici.
// Ignoré juste après un contact tactile (voir _lastTouchAt) : un appui long
// au doigt ne doit jamais désélectionner par accident.
canvas.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(Date.now()-_lastTouchAt<600) return;
  cancelOrDeselect();
});
window.addEventListener('keydown',e=>{
  if(e.key==='Escape') cancelOrDeselect();
});

// ── CLAVIER ──────────────────────────────────────────────────
// Le jeu ne connaissait que Échap, Ctrl+1-9, 1-9 et Alt+1-4 : agréable au
// doigt sur mobile, pénible au clavier sur PC — l'inverse de ce qu'on attend
// d'un jeu de stratégie. Tout ce qui suit pointe sur les MÊMES fonctions que
// les boutons correspondants, jamais sur une copie de leur logique.
//
// Un raccourci ne doit jamais se déclencher pendant qu'on tape : le chat
// multijoueur, le champ de graine et le pseudo sont des <input>.
function saisieEnCours(e){
  const c=e.target;
  return !!(c&&(c.tagName==='INPUT'||c.tagName==='TEXTAREA'||c.isContentEditable));
}

// ── Caméra aux flèches ──
// Volontairement PAS sur ZQSD/WASD : `A` et `S` sont les touches attendues
// pour « marche d'attaque » et « stop » dans tout le genre (AoE2, StarCraft),
// et la caméra aux flèches est justement la convention d'AoE2. Les deux ne
// pouvaient pas cohabiter ; les commandes ont gagné.
const CAM_KEYS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
const CAM_TILES_PAR_S = 18;   // vitesse en TUILES/s : constante quel que soit le zoom
const _camTouches = new Set();
// Défilement appliqué à la CADENCE D'AFFICHAGE (voir loop), pas dans
// updateGlide : celui-ci tourne au pas de simulation, donc deux fois plus
// souvent en vitesse ×2 — la caméra aurait accéléré avec la vitesse de jeu.
function updateCamClavier(dt){
  if(!_camTouches.size) return;
  let dx=0, dy=0;
  for(const k of _camTouches){ const v=CAM_KEYS[k]; if(v){ dx+=v[0]; dy+=v[1]; } }
  if(!dx&&!dy) return;
  const n=Math.hypot(dx,dy)||1;               // diagonale : même vitesse qu'en ligne droite
  const p=CAM_TILES_PAR_S*TILE*dt;
  G.cam.x+=dx/n*p; G.cam.y+=dy/n*p;
  clampCam();
}

// ── Prochain villageois inactif ──
// Le badge 👷 de la barre du haut promettait « cliquez pour les
// sélectionner » depuis toujours... sans le moindre gestionnaire de clic.
// Une seule fonction sert désormais les deux entrées, badge et touche.
let _idleIdx=0;
function villageoisInactifSuivant(){
  const libres=G.units.filter(u=>u.type===UT.VIL&&u.state==='idle'&&estLocal(u));
  if(!libres.length){ notify('Aucun villageois inactif','#95a5a6'); return; }
  _idleIdx=_idleIdx%libres.length;
  const u=libres[_idleIdx];
  _idleIdx=(_idleIdx+1)%libres.length;        // appuis successifs : on parcourt la liste
  G.sel=[u.id]; G.mode='select';
  camCenterOn(u.x,u.y);
  refreshUI(); sfx('tap');
  notify(`👷 Villageois inactif (${libres.length} au total)`,'#f0c040');
}
{
  const badge=document.getElementById('idlebtn-inner');
  if(badge) badge.addEventListener('click',villageoisInactifSuivant);
}

// ── Retour au Centre Ville ──
function allerCentreVille(){
  const tc=G.buildings.find(b=>b.type===BT.TC&&estLocal(b));
  if(!tc){ notify('Plus de Centre Ville','#e74c3c'); return; }
  camCenterOn(tc.x,tc.y); sfx('tap');
}

// ── Onglet construction ──
// N'ouvre rien de neuf : sélectionne un villageois (celui déjà sélectionné,
// sinon un inactif, sinon n'importe lequel) et bascule sur l'onglet
// Économie, ce qui fait dessiner la barre de construction par drawUnitAct.
function ouvrirConstruction(){
  const dejaVil=G.units.find(u=>estSel(u.id)&&u.type===UT.VIL&&estLocal(u));
  const v=dejaVil
    || G.units.find(u=>u.type===UT.VIL&&u.state==='idle'&&estLocal(u))
    || G.units.find(u=>u.type===UT.VIL&&estLocal(u));
  if(!v){ notify('Aucun villageois disponible','#e67e22'); return; }
  if(!dejaVil) G.sel=[v.id];
  G.mode='select'; G.buildTab=0;
  refreshUI(); sfx('tap');
}

// ── Q/W/E/R : les quatre premières actions d'un BÂTIMENT sélectionné ──
// Réservé aux bâtiments, et c'est ce qui évite toute collision : un bâtiment
// n'a ni marche d'attaque (A), ni stop (S), ni posture (C). On déclenche le
// VRAI bouton de la barre — donc le même coût, le même flash de ressources,
// le même verrou d'âge, sans rien réimplémenter.
const ACT_KEYS = ['KeyQ','KeyW','KeyE','KeyR'];
function actionBarre(i){
  const bar=document.getElementById('actbar');
  const btns=bar?bar.querySelectorAll('.btn:not(.locked):not(.nohotkey)'):[];
  if(i>=btns.length){ notify('Aucune action à cet emplacement','#95a5a6'); return; }
  btns[i].click();
}

window.addEventListener('keydown',e=>{
  if(!G.running||G.paused||saisieEnCours(e)) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;   // Ctrl+1-9 et Alt+1-4 ont déjà leur gestionnaire
  if(CAM_KEYS[e.key]){ _camTouches.add(e.key); e.preventDefault(); return; }
  const selBld=G.sel.length===1&&G.buildings.find(b=>b.id===G.sel[0]&&estLocal(b));
  if(selBld){
    const i=ACT_KEYS.indexOf(e.code);
    if(i>=0){ actionBarre(i); e.preventDefault(); return; }
  }
  switch(e.code){
    case 'KeyH':          allerCentreVille(); break;
    case 'Period':
    case 'NumpadDecimal': villageoisInactifSuivant(); break;
    case 'KeyB':          ouvrirConstruction(); break;
    case 'KeyA':          orderAMove(); break;
    case 'KeyC':          cycleStance(); break;
    case 'KeyS': {
      const ids=G.units.filter(u=>estSel(u.id)&&estLocal(u)).map(u=>u.id);
      if(!ids.length){ notify('Aucune unité sélectionnée','#e67e22'); break; }
      emettreOrdre(ordre(ORD.STOP,{ids})); sfx('tap');
      break;
    }
    default: return;
  }
  e.preventDefault();
});
window.addEventListener('keyup',e=>{ _camTouches.delete(e.key); });
// Sans ça, une flèche encore enfoncée au moment où l'on quitte l'onglet
// reste « appuyée » pour toujours : la caméra part en glissade au retour.
window.addEventListener('blur',()=>_camTouches.clear());

// ── GROUPES DE CONTRÔLE ──────────────────────────────────────
// Ctrl+1..9 assigne la sélection courante, 1..9 la rappelle ; un second
// appui rapide (<400 ms) sur le même chiffre recentre la caméra dessus —
// standard du genre (AoE2, StarCraft...), absent jusqu'ici. Les unités
// mortes ou passées à un autre camp sont purgées du groupe au RAPPEL
// seulement (jamais à l'assignation, sans quoi un groupe pourrait "fondre"
// pendant que le joueur regarde ailleurs).
// `e.code` (touche physique) plutôt que `e.key` : sur un clavier AZERTY,
// les chiffres nus produisent des caractères ('&','é','"'...) sans Shift —
// seul `e.code` ('Digit1'..'Digit9') reste fiable quel que soit le clavier.
let _dernierGroupeAppui=0, _dernierGroupeTouche=null;
function assignerGroupe(n){
  const ids=G.units.filter(u=>estSel(u.id)&&estLocal(u)).map(u=>u.id);
  if(!ids.length) return;
  G.groupes[n]=ids;
  notify(`Groupe ${n} : ${ids.length} unité(s) assignée(s)`,'#3498db');
  syncGroupBar();
}
function rappelerGroupe(n){
  const ids=(G.groupes[n]||[]).filter(id=>{ const u=unitById(id); return u&&estLocal(u)&&u.state!=='garrison'; });
  G.groupes[n]=ids;
  if(!ids.length){ notify(`Groupe ${n} vide`,'#95a5a6'); return; }
  const maintenant=Date.now();
  const recentrer=_dernierGroupeTouche===n&&(maintenant-_dernierGroupeAppui)<400;
  _dernierGroupeTouche=n; _dernierGroupeAppui=maintenant;
  G.sel=ids.slice(); G.mode='select';
  refreshUI(); syncGroupBar();
  if(recentrer){ const u=unitById(ids[0]); if(u) camCenterOn(u.x,u.y); }
  notify(`Groupe ${n} sélectionné (${ids.length})`,'#f0c040');
}
window.addEventListener('keydown',e=>{
  if(!G.running) return;
  const cible=e.target;
  if(cible&&(cible.tagName==='INPUT'||cible.tagName==='TEXTAREA')) return;
  const m=/^Digit([1-9])$/.exec(e.code)||/^Numpad([1-9])$/.exec(e.code);
  if(!m) return;
  const n=+m[1];
  if(e.ctrlKey||e.metaKey){ assignerGroupe(n); e.preventDefault(); }
  else { rappelerGroupe(n); }
});

// ── GROUPES DE CONTRÔLE — barre tactile ──────────────────────
// Ctrl+1..9/1..9 ci-dessus n'ont toujours eu qu'un gestionnaire clavier :
// un joueur au doigt ne pouvait ni créer ni rappeler un groupe, alors que le
// reste du HUD soigne le tactile (cibles 44px, vibrations, panneau
// repliable...). Une rangée de 9 cases dans #botpanel comble l'écart, sans
// dupliquer la logique : elle appelle exactement assignerGroupe/rappelerGroupe.
// Toucher bref = rappeler (retoucher vite deux fois recentre, comme au
// clavier — même fonction, même fenêtre de 400 ms). Appui maintenu avec une
// sélection active = assigner ; sans sélection, l'appui maintenu ne fait rien
// (juste un petit buzz, pour dire "il n'y a rien à mettre ici").
const GROUP_HOLD_MS=500;
function construireGroupBar(){
  const bar=document.getElementById('groupbar');
  if(!bar||bar.children.length) return; // déjà construite
  for(let n=1;n<=9;n++){
    const el=document.createElement('div');
    el.className='gbtn'; el.id='gbtn'+n; el.title='Groupe '+n;
    el.textContent=n;
    const cnt=document.createElement('span');
    cnt.className='gcnt'; cnt.id='gcnt'+n; cnt.style.display='none';
    el.appendChild(cnt);
    let timer=null, longFired=false;
    const start=()=>{
      longFired=false; el.classList.add('held');
      timer=setTimeout(()=>{
        longFired=true; el.classList.remove('held');
        if(G.units.some(u=>estSel(u.id)&&estLocal(u))){ assignerGroupe(n); buzz([10,30,10]); }
        else buzz(6);
        syncGroupBar();
      },GROUP_HOLD_MS);
    };
    const stop=recall=>{
      clearTimeout(timer); el.classList.remove('held');
      if(recall&&!longFired) rappelerGroupe(n);
    };
    el.addEventListener('mousedown',e=>{ if(e.button!==0) return; start(); });
    el.addEventListener('mouseup',()=>stop(true));
    el.addEventListener('mouseleave',()=>stop(false));
    el.addEventListener('touchstart',e=>{ e.preventDefault(); start(); },{passive:false});
    el.addEventListener('touchend',e=>{ e.preventDefault(); stop(true); },{passive:false});
    el.addEventListener('touchcancel',()=>stop(false));
    bar.appendChild(el);
  }
}
// Reflète l'état de G.groupes sur les 9 cases — appelée après assignation/
// rappel, et à chaque image depuis updateHUD (voir 11-interface.js) pour que
// le compte suive un groupe qui fond au combat sans qu'on l'ait rappelé.
// Écriture par différence (comme setTxt/setCls, voir 11-interface.js) : à
// 60 im/s, ne toucher le DOM que si l'effectif d'une case a changé — pas de
// classList.toggle/textContent à vide sur les 9 cases à chaque image.
// classList.toggle('filled',…) seul (jamais une réécriture de className
// complet) : la case peut porter 'held' pendant un appui maintenu, que cette
// fonction ne doit surtout pas effacer en repassant derrière.
const _groupBarCache=new Array(10).fill(-1);
function syncGroupBar(){
  for(let n=1;n<=9;n++){
    const ids=(G.groupes&&G.groupes[n])||[];
    const vivants=ids.filter(id=>{ const u=unitById(id); return u&&estLocal(u)&&u.state!=='garrison'; }).length;
    if(_groupBarCache[n]===vivants) continue;
    _groupBarCache[n]=vivants;
    const el=document.getElementById('gbtn'+n); if(!el) continue;
    el.classList.toggle('filled',vivants>0);
    const cnt=document.getElementById('gcnt'+n);
    if(cnt){ cnt.textContent=vivants>9?'9+':String(vivants); cnt.style.display=vivants>0?'flex':'none'; }
  }
}
construireGroupBar();

// Point d'entrée commun Échap / clic droit : annule d'abord le mode en cours
// (construction, marche d'attaque), sinon désélectionne.
function cancelOrDeselect(){
  if(G.mode==='build'){ exitBuild(); return; }
  if(G.mode==='amove'){
    G.mode='select';
    document.getElementById('bcancel').style.display='none';
    notify('Marche d\'attaque annulée','#95a5a6');
    refreshUI();
    return;
  }
  if(G.sel.length){ clearSelection(); notify('Sélection annulée','#95a5a6'); }
}

// ── SURVOL SOURIS (desktop) ─────────────────────────────────
// Repère ce qui se trouve sous le curseur, sans effet de bord (contrairement
// à handleTap) — sert uniquement au feedback visuel (anneau + curseur).
function updateHoverAt(sx,sy){
  if(G.mode!=='select'){ G.hover=null; return; }
  const {x:wx,y:wy}=sw(sx,sy);
  const tUnit=G.units.find(u=>u.state!=='garrison'&&Math.hypot(u.x-wx,u.y-wy)<16);
  if(tUnit){ G.hover={kind:'unit',id:tUnit.id,owner:tUnit.owner}; return; }
  const tBuilding=G.buildings.find(b=>wx>=b.tx*BASE_TILE&&wx<=(b.tx+b.w)*BASE_TILE&&wy>=b.ty*BASE_TILE&&wy<=(b.ty+b.h)*BASE_TILE);
  if(tBuilding){ G.hover={kind:'building',id:tBuilding.id,owner:tBuilding.owner}; return; }
  const tNode=G.nodes.find(n=>n.amt>0&&Math.hypot(n.x-wx,n.y-wy)<BASE_TILE*.9);
  if(tNode){ G.hover={kind:'node',id:tNode.id}; return; }
  G.hover=null;
}
function updateCursor(){
  let cur='default';
  if(G.mode==='build'||G.mode==='amove') cur='crosshair';
  else if(isDrag) cur='grabbing';
  else if(G.hover){
    if(G.hover.kind==='node') cur='pointer';
    else cur = G.hover.owner===G.me ? 'pointer' : 'crosshair';
  }
  canvas.style.cursor=cur;
}

// Inertie de déplacement
function updateGlide(dt){
  if(Math.abs(glideX)<0.5&&Math.abs(glideY)<0.5){ glideX=glideY=0; return; }
  G.cam.x-=glideX; G.cam.y-=glideY;
  clampCam();
  const damp=Math.pow(0.86,dt*60);
  glideX*=damp; glideY*=damp;
}

// Sélectionne toutes les unités du même type visibles à l'écran
function handleDoubleTap(sx,sy){
  const {x:wx,y:wy}=sw(sx,sy);
  const tU=G.units.find(u=>estLocal(u)&&Math.hypot(u.x-wx,u.y-wy)<16);
  if(!tU){
    // double-tap dans le vide = désélectionner (le simple tap sert à donner des ordres)
    if(G.sel.length){ clearSelection(); notify('Sélection annulée','#95a5a6'); }
    return;
  }
  const type=tU.type;
  const sel=[];
  const tl=sw(0,54), br=sw(W,54+gameH());
  const x0=tl.x,y0=tl.y,x1=br.x,y1=br.y;
  for(const u of G.units){
    if(!estLocal(u)||u.type!==type||u.state==='garrison') continue;
    if(u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1) sel.push(u.id);
  }
  G.sel=sel;
  refreshUI();
  notify(`${sel.length} ${UDEF[type].nom}(s) sélectionné(s)`,'#f0c040');
}

// Applique la sélection rectangle (unités joueur seulement)
function applyBoxSelection(box){
  const a=sw(Math.min(box.x0,box.x1),Math.min(box.y0,box.y1));
  const b2=sw(Math.max(box.x0,box.x1),Math.max(box.y0,box.y1));
  const x0=a.x, x1=b2.x, y0=a.y, y1=b2.y;
  const sel=[];
  for(const u of G.units){
    if(!estLocal(u)||u.state==='garrison') continue;
    if(u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1) sel.push(u.id);
  }
  // Priorité aux unités militaires si mélange (façon AoE2 : un rectangle qui
  // engloberait aussi des villageois ne doit pas risquer de les envoyer au
  // combat par erreur). Documenté dans l'écran Contrôles, mais totalement
  // silencieux jusqu'ici — un joueur qui ne connaît pas cette convention
  // voit juste "certaines unités ne se sélectionnent pas", ce qui a été
  // signalé comme un bug. On le rend explicite dans la notification.
  const mil=sel.filter(id=>{const u=G.units.find(v=>v.id===id);return u&&isMilitary(u.type);});
  const ignores=mil.length>0 ? sel.length-mil.length : 0;
  G.sel = mil.length>0 ? mil : sel;
  refreshUI();
  if(G.sel.length>0){
    notify(`${G.sel.length} unité(s) sélectionnée(s)`+(ignores>0?` (${ignores} villageois ignoré(s) — priorité au militaire)`:''),'#f0c040');
  }
}

function handleTap(sx,sy){
  const {x:wx,y:wy}=sw(sx,sy);
  const tx=wx/BASE_TILE|0, ty=wy/BASE_TILE|0;

  // Mode attaque-déplacement
  if(G.mode==='amove'){
    const us=selMilitary();
    G.mode='select';
    document.getElementById('bcancel').style.display='none';
    if(us.length){
      const r=emettreOrdre(ordre(ORD.AMOVE,{ids:us.map(u=>u.id), x:wx, y:wy}));
      if(r.ok){
        G.moveTarget={x:wx,y:wy}; G.mtTimer=1.5;
        notify(`⚔️ ${r.n} unité(s) en marche d'attaque`,'#e74c3c'); buzz(10);
      }
    }
    refreshUI();
    return;
  }

  // Mode construction
  if(G.mode==='build'){
    // Souris : le survol (mousemove ci-dessus) a déjà montré l'aperçu avant
    // ce clic — le confirmer directement ne surprend personne.
    // Tactile : ce tap est la PREMIÈRE fois que ce point de la carte est
    // visé (pas de survol) ; il ne fait donc que positionner l'aperçu, sauf
    // s'il retombe sur la case déjà visée — retoucher deux fois le même
    // endroit vaut alors confirmation, sans obliger à viser le bouton ✓.
    if(!_touchDriven){
      updateGhost(tx,ty);
      if(G.ghost&&G.ghost.valid) confirmBuild(G.ghost.tx,G.ghost.ty);
      else notify('Placement impossible !','#e74c3c');
      return;
    }
    const prev=G.ghost;
    const dejaVise=prev&&prev.tx===tx&&prev.ty===ty;
    updateGhost(tx,ty);
    if(dejaVise){
      if(G.ghost.valid) confirmBuild(tx,ty);
      else notify('Emplacement invalide','#e74c3c');
    }
    return;
  }

  // Mode route commerciale : on attend le second Marché
  if(G.mode==='route'){
    const target=G.buildings.find(b2=>wx>=b2.tx*BASE_TILE&&wx<=(b2.tx+b2.w)*BASE_TILE&&wy>=b2.ty*BASE_TILE&&wy<=(b2.ty+b2.h)*BASE_TILE);
    const fromId=G.routeFrom;
    exitRoute();
    if(!target||target.type!==BT.MARKET||target.id===fromId){
      notify('Choisissez un autre Marché pour établir la route','#e74c3c');
      return;
    }
    const r=emettreOrdre(ordre(ORD.ROUTE_COMMERCIALE,{bId:fromId, toId:target.id}));
    if(r.ok){ notify(`🐫 Route commerciale établie (~${r.dist} tuiles)`,'#f0c040'); buzz(10); }
    else notify('Route impossible (marché adverse)','#e74c3c');
    return;
  }

  // Unité touchée ?
  const tUnit=G.units.find(u=>u.state!=='garrison'&&Math.hypot(u.x-wx,u.y-wy)<16);
  if(tUnit){
    if(estLocal(tUnit)){
      // re-toucher l'unité déjà seule sélectionnée la désélectionne
      if(G.sel.length===1&&G.sel[0]===tUnit.id){ clearSelection(); return; }
      G.sel=[tUnit.id]; refreshUI(); return;
    }
    else { cmdAttack(tUnit); return; }
  }

  // Bâtiment touché ?
  const tBuilding=G.buildings.find(b=>wx>=b.tx*BASE_TILE&&wx<=(b.tx+b.w)*BASE_TILE&&wy>=b.ty*BASE_TILE&&wy<=(b.ty+b.h)*BASE_TILE);
  if(tBuilding){
    if(estLocal(tBuilding)){
      // Ferme avec stock + villageois sélectionnés => les envoyer récolter dessus
      if(tBuilding.type===BT.FARM && !tBuilding.constructing){
        const vils=G.units.filter(u=>estSel(u.id)&&u.type===UT.VIL);
        if(vils.length>0){
          const r=emettreOrdre(ordre(ORD.FERME,{ids:vils.map(u=>u.id), bId:tBuilding.id}));
          if(r.ok){
            G.moveTarget={x:tBuilding.x,y:tBuilding.y}; G.mtTimer=1.5;
            notify(r.vide?'Villageois affectés — en attente de re-semis':'Villageois aux champs…','#8fbc44');
            buzz(6);
          }
          return;
        }
      }
      // Chantier en cours => y envoyer les villageois sélectionnés (reprise de construction)
      if(tBuilding.constructing){
        const vb=G.units.filter(u=>estSel(u.id)&&u.type===UT.VIL);
        if(vb.length>0){
          const r=emettreOrdre(ordre(ORD.CHANTIER,{ids:vb.map(u=>u.id), bId:tBuilding.id}));
          if(r.ok){
            notify(`🔨 ${r.n} villageois sur le chantier…`,'#3498db'); buzz(6);
            G.moveTarget={x:tBuilding.x,y:tBuilding.y}; G.mtTimer=1.5;
          }
          return;
        }
      }
      // Villageois sélectionnés + bâtiment endommagé => réparation
      if(tBuilding.hp<tBuilding.maxHp&&!tBuilding.constructing){
        const vr=G.units.filter(u=>estSel(u.id)&&u.type===UT.VIL);
        if(vr.length>0){
          const r=emettreOrdre(ordre(ORD.REPARE,{ids:vr.map(u=>u.id), bId:tBuilding.id}));
          if(r.ok){
            notify('🛠 Réparation en cours…','#f1c40f'); buzz(6);
            G.moveTarget={x:tBuilding.x,y:tBuilding.y}; G.mtTimer=1.5;
          }
          return;
        }
      }
      // Unités sélectionnées + bâtiment garnissable (Centre Ville/Tour/
      // Château) à pleine santé ou non => les mettre à l'abri dedans.
      // Placé APRÈS la réparation : un villageois envoyé sur un bâtiment
      // endommagé continue de le réparer plutôt que de s'y enfermer.
      // Villageois EXCLUS pour le Centre Ville spécifiquement : un clic sur
      // le CV avec un villageois sélectionné les enfermait par accident dès
      // que le bâtiment était à pleine santé. Ils ont désormais leur propre
      // geste dédié — le bouton 🔔 (toggleVillageoisAbri, js/11-interface.js)
      // qui en rentre/ressort la totalité d'un coup. La Tour et le Château,
      // eux, gardent l'ancien geste : y planquer un villageois isolé pendant
      // un raid reste un cas d'usage réel, et rien ne le remplace.
      const gcap=BDEF[tBuilding.type].garrisonCap;
      if(gcap&&!tBuilding.constructing){
        const gArmy=G.units.filter(u=>estSel(u.id)&&u.state!=='garrison'&&u.type!==UT.TREB&&u.type!==UT.RAM
          &&!(tBuilding.type===BT.TC&&u.type===UT.VIL));
        if(gArmy.length>0){
          const r=emettreOrdre(ordre(ORD.GARNIR,{ids:gArmy.map(u=>u.id), bId:tBuilding.id}));
          if(r.ok){
            notify(r.refuses>0?`🏰 ${r.n} unité(s) en garnison (garnison pleine, ${r.refuses} refusée(s))`:`🏰 ${r.n} unité(s) en garnison`,'#3498db');
            buzz(6); clearSelection();
          } else if(r.raison==='plein') notify('🏰 Garnison pleine !','#e74c3c');
          return;
        }
      }
      if(G.sel.length===1&&G.sel[0]===tBuilding.id){ clearSelection(); return; }
      G.sel=[tBuilding.id]; refreshUI(); return;
    }
    else { cmdAttack(tBuilding); return; }
  }

  // Nœud de ressource touché ? Le poisson est un gisement à part (RT.FISH,
  // voir plus bas) : un villageois ne sait pas nager, donc exclu ici.
  const tNode=G.nodes.find(n=>n.amt>0&&n.type!==RT.FISH&&Math.hypot(n.x-wx,n.y-wy)<BASE_TILE*.9);
  if(tNode){
    const vils=G.units.filter(u=>estSel(u.id)&&u.type===UT.VIL);
    if(vils.length>0){
      const r=emettreOrdre(ordre(ORD.RECOLTE,{ids:vils.map(u=>u.id), nodeId:tNode.id}));
      if(r.ok){
        G.moveTarget={x:tNode.x,y:tNode.y}; G.mtTimer=1.5;
        notify(r.placed>1
          ? `${r.placed} villageois → ${r.spread} gisement${r.spread>1?'s':''}`
          : 'Villageois en route récolter…','#f1c40f');
      }
      return;
    }
  }

  // Banc de poisson touché ? Seules les Barques savent y pêcher.
  const tFish=G.nodes.find(n=>n.type===RT.FISH&&n.amt>0&&Math.hypot(n.x-wx,n.y-wy)<BASE_TILE*.9);
  if(tFish){
    const boats=G.units.filter(u=>estSel(u.id)&&estLocal(u)&&u.type===UT.BOAT);
    if(boats.length>0){
      const r=emettreOrdre(ordre(ORD.PECHER,{ids:boats.map(u=>u.id), nodeId:tFish.id}));
      if(r.ok){ G.moveTarget={x:tFish.x,y:tFish.y}; G.mtTimer=1.5; notify('🐟 Barque en route vers le banc…','#7fb8e8'); }
      return;
    }
  }

  // Relique touchée ? Seul un Moine peut la porter — un seul suffit.
  const tRelic=G.relics&&G.relics.find(r=>relicFree(r)&&Math.hypot(r.x-wx,r.y-wy)<BASE_TILE*.9);
  if(tRelic){
    const monk=G.units.find(u=>estSel(u.id)&&u.type===UT.MONK);
    if(monk){
      const r=emettreOrdre(ordre(ORD.RELIQUE,{ids:[monk.id], relicId:tRelic.id}));
      if(r.ok){ G.moveTarget={x:tRelic.x,y:tRelic.y}; G.mtTimer=1.5; notify('🏺 Le moine part récupérer la relique…','#f0c040'); }
      return;
    }
  }

  // Gibier touché ? N'importe quelle unité sélectionnée peut être envoyée
  // chasser (villageois compris, à ses risques face à un sanglier).
  const tWild=(G.wildlife||[]).find(w=>w.hp>0&&Math.hypot(w.x-wx,w.y-wy)<BASE_TILE*.9);
  if(tWild){
    const hunters=G.units.filter(u=>estSel(u.id)&&estLocal(u)&&u.type!==UT.MONK);
    if(hunters.length>0){
      const r=emettreOrdre(ordre(ORD.CHASSER,{ids:hunters.map(u=>u.id), wildlifeId:tWild.id}));
      if(r.ok){ G.moveTarget={x:tWild.x,y:tWild.y}; G.mtTimer=1.5; notify(`${WILDLIFE_DEF[tWild.type].ico} En chasse…`,'#8fbc44'); }
      return;
    }
  }

  // Sol : déplacer les unités sélectionnées
  if(G.sel.length>0){
    const selUnits=G.units.filter(u=>estSel(u.id)&&estLocal(u));
    if(selUnits.length>0){
      // Les Barques vivent sur un déplacement dédié (voir advanceNaval) :
      // le déplacement terrestre partagé les traiterait à tort comme
      // "déjà bloquées" (l'eau est un mur pour tout le reste) et les
      // laisserait dériver n'importe où, y compris sur la terre ferme.
      const boats=selUnits.filter(u=>u.type===UT.BOAT);
      const others=selUnits.filter(u=>u.type!==UT.BOAT);
      if(boats.length) emettreOrdre(ordre(ORD.NAVIGUER,{ids:boats.map(u=>u.id), x:wx, y:wy}));
      if(others.length){
        const r=emettreOrdre(ordre(ORD.DEPL,{ids:others.map(u=>u.id), x:wx, y:wy}));
        if(r.ok){ G.moveTarget={x:wx,y:wy}; G.mtTimer=1.5; }
      } else if(boats.length){ G.moveTarget={x:wx,y:wy}; G.mtTimer=1.5; }
      return;
    }
    // Bâtiment militaire sélectionné => poser point de ralliement
    const selB=G.buildings.find(b=>b.id===G.sel[0]&&estLocal(b));
    if(selB&&[BT.TC,BT.BARRACKS,BT.STABLE,BT.MONASTERY,BT.CASTLE,BT.SIEGE].includes(selB.type)){
      const r=emettreOrdre(ordre(ORD.RALLIEMENT,{bId:selB.id, x:wx, y:wy}));
      if(r.ok){
        G.moveTarget={x:wx,y:wy}; G.mtTimer=1.5;
        notify('📍 Point de ralliement défini','#3498db');
      }
      return;
    }
  }

  // Désélectionner
  G.sel=[]; refreshUI();
}

function formation(cx,cy,n){
  const cols=Math.ceil(Math.sqrt(n)),res=[];
  for(let i=0;i<n;i++){
    const c=i%cols, r=i/cols|0;
    res.push({x:cx+(c-cols/2)*BASE_TILE*.65, y:cy+r*BASE_TILE*.65});
  }
  return res;
}

const STANCES=['agg','def','hold'];
const STANCE_LBL={agg:'Agressif',def:'Défensif',hold:'Tenir'};
const STANCE_ICO={agg:'⚔️',def:'🛡',hold:'📍'};
function selMilitary(){ return G.units.filter(u=>estSel(u.id)&&isMilitary(u.type)); }
function cycleStance(){
  const us=selMilitary();
  if(!us.length){ notify('Aucune unité militaire sélectionnée','#e67e22'); return; }
  const nx=STANCES[(STANCES.indexOf(us[0].stance||'agg')+1)%3];
  const r=emettreOrdre(ordre(ORD.POSTURE,{ids:us.map(u=>u.id), posture:nx}));
  if(!r.ok) return;
  notify(`${STANCE_ICO[nx]} Posture : ${STANCE_LBL[nx]}`,'#f0c040'); buzz(6);
}
function orderAMove(){
  if(!selMilitary().length){ notify('Aucune unité militaire sélectionnée','#e67e22'); return; }
  G.mode='amove';
  document.getElementById('bcancel').style.display='flex';
  notify('Tapez la destination — vos unités engageront en chemin','#e74c3c');
}

function cmdAttack(tgt){
  const ids=G.units.filter(u=>estSel(u.id)&&estLocal(u)).map(u=>u.id);
  if(!ids.length) return;
  emettreOrdre(ordre(ORD.ATK,{ids, cible:tgt.id, genreCible:bldById(tgt.id)?'b':'u'}));
}

// Le Quai doit toucher l'eau (sinon aucune barque n'a d'endroit où prendre
// la mer) : une case d'eau adjacente à son emprise, pas forcément dessous —
// la case elle-même reste solide comme n'importe quel bâtiment.
function hasAdjacentWater(tx,ty,w,h){
  for(let dy=-1;dy<=h;dy++) for(let dx=-1;dx<=w;dx++){
    if(dy>=0&&dy<h&&dx>=0&&dx<w) continue; // intérieur de l'emprise, pas le pourtour
    const x=tx+dx, y=ty+dy;
    if(x>=0&&y>=0&&x<COLS&&y<ROWS&&G.tiles[y][x]===T_WATER) return true;
  }
  return false;
}
function updateGhost(tx,ty){
  if(!G.buildType) return;
  const d=BDEF[G.buildType];
  let valid=tx>=0&&ty>=0&&tx+d.w<=COLS&&ty+d.h<=ROWS;
  if(valid) for(let dy=0;dy<d.h&&valid;dy++) for(let dx=0;dx<d.w&&valid;dx++) if(G.bmap[ty+dy][tx+dx]!==0) valid=false;
  if(valid&&G.buildType===BT.DOCK&&!hasAdjacentWater(tx,ty,d.w,d.h)) valid=false;
  G.ghost={tx,ty,valid};
  syncBuildConfirmBtn(); // point de passage unique : tout appelant profite du bouton ✓ à jour
}
// Reflète G.ghost sur le bouton ✓ (voir index.html) : visible dès qu'un
// aperçu existe, « prêt » (vert) seulement s'il est posable ici.
function syncBuildConfirmBtn(){
  const el=document.getElementById('bconfirm'); if(!el) return;
  const show=G.mode==='build'&&!!G.ghost;
  el.style.display=show?'flex':'none';
  el.classList.toggle('ready',show&&G.ghost.valid);
}

function confirmBuild(tx,ty){
  const type=G.buildType, d=BDEF[type];
  const batisseurs=G.units.filter(u=>estSel(u.id)&&estLocal(u)&&u.type===UT.VIL).map(u=>u.id);
  const r=emettreOrdre(ordre(ORD.BATIR,{type, tx, ty, batisseurs}));
  if(!r.ok){
    if(r.raison==='age'){ notify('🔒 Nécessite l\'Âge des Châteaux','#e74c3c'); exitBuild(); }
    else if(r.raison==='ressources'){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(scaleCost(d.cost)); }
    else notify('Placement impossible !','#e74c3c');
    return;
  }
  exitBuild();
  notify(`Construction de ${r.nom} lancée !`,'#3498db');
}

function enterBuild(type){
  G.mode='build'; G.buildType=type;
  // Aperçu affiché DÈS l'entrée en mode construction, au centre de l'écran :
  // au doigt, rien ne le montrait avant le premier contact — poser au tout
  // premier tap revenait à construire un bâtiment qu'on n'avait jamais vu.
  const S=TILE/BASE_TILE;
  const cwx=(G.cam.x+W/2)/S, cwy=(G.cam.y+gameH()/2)/S;
  updateGhost(cwx/BASE_TILE|0, cwy/BASE_TILE|0);
  document.getElementById('bcancel').style.display='flex';
  notify(`Positionnez : ${BDEF[type].nom} — ✓ pour valider`,'#3498db');
  refreshUI();
}

function exitBuild(){
  G.mode='select'; G.buildType=null; G.ghost=null;
  document.getElementById('bcancel').style.display='none';
  document.getElementById('bconfirm').style.display='none';
  refreshUI();
}

document.getElementById('bcancel').addEventListener('click',()=>{ if(G.mode==='route') exitRoute(); else exitBuild(); });
document.getElementById('bconfirm').addEventListener('click',()=>{
  if(G.mode!=='build'||!G.ghost) return;
  if(G.ghost.valid) confirmBuild(G.ghost.tx,G.ghost.ty);
  else { notify('Emplacement invalide','#e74c3c'); buzz(8); }
});
