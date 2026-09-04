'use strict';
// ======================================================================
//  11-interface.js
// ======================================================================
// Interface : HUD, barre d'action, panneaux, sons, notifications,
// succes, bilan de partie, pause, zoom, vitesse.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ── UI ────────────────────────────────────────────────────
function clearSelection(){
  if(!G.sel.length) return;
  G.sel=[];
  G.mode='select';
  refreshUI();
  buzz(6);
}

function updateDeselBtn(){
  const btn=document.getElementById('deselbtn');
  if(!btn) return;
  const show=G.sel.length>0&&G.mode!=='build';
  btn.style.display=show?'flex':'none';
  if(show){
    const nU=G.units.filter(u=>estSel(u.id)).length;
    document.getElementById('deselcnt').textContent=nU>1?String(nU):'';
  }
}

function refreshUI(){
  updateActBar();
  const e=G.sel.length===1?(G.units.find(u=>u.id===G.sel[0])||G.buildings.find(b=>b.id===G.sel[0])):null;
  updateSelInfo(e);
  updateDeselBtn();
}

// ── ÉCRITURES DOM PAR DIFFÉRENCE ──────────────────────────
// Le HUD était réécrit intégralement à chaque image : une dizaine de
// textContent, un innerHTML COMPLET pour la barre d'âge (donc ses <img>
// d'icônes reconstruites et reparseées soixante fois par seconde) et un
// G.units.filter() sur toute l'armée pour compter les villageois inactifs.
// Trois millisecondes par image pour un affichage qui, l'immense majorité
// du temps, ne change pas d'un pixel — à lui seul plus cher que tout le
// rendu de la carte. On ne touche désormais au DOM que lorsque la valeur
// affichée a réellement changé.
const _hudCache=new Map();
// applyStaticIcons() réécrit ces mêmes éléments de son côté (arrivée des
// icônes illustrées) : le cache doit être vidé après son passage, sinon il
// croirait à jour un contenu qu'elle vient d'écraser.
function viderCacheHUD(){ _hudCache.clear(); }
function setTxt(id,v){
  if(_hudCache.get(id)===v) return;
  _hudCache.set(id,v);
  const el=document.getElementById(id); if(el) el.textContent=v;
}
function setHtml(id,v){
  const k='h:'+id;
  if(_hudCache.get(k)===v) return;
  _hudCache.set(k,v);
  const el=document.getElementById(id); if(el) el.innerHTML=v;
}
function setCls(id,v){
  const k='c:'+id;
  if(_hudCache.get(k)===v) return;
  _hudCache.set(k,v);
  const el=document.getElementById(id); if(el) el.className=v;
}
// Bascule UNE classe sans toucher aux autres — setCls écrase `className` en
// entier, ce qui effacerait par exemple le .insuff que trainUnit pose sur la
// même case pendant sa demi-seconde de clignotement. Même cache par
// différence que le reste du HUD : rien ne touche au DOM tant que l'état ne
// change pas.
function setFlag(id,cls,on){
  const k='f:'+id+':'+cls;
  if(_hudCache.get(k)===on) return;
  _hudCache.set(k,on);
  const el=document.getElementById(id); if(el) el.classList.toggle(cls,on);
}

// ═══ FORMAT COMPACT DES RESSOURCES (petits écrans) ═════════════════
// La barre du haut réserve deux zones intouchables — le bouton pause à gauche,
// le badge villageois inactifs à droite (voir .tb-spacer dans index.html) — et
// tout le reste doit tenir ENTRE les deux. Les tailles de police y ont été
// resserrées jusqu'à faire tenir le pire cas réaliste sur un écran de 375px :
// 4 chiffres par ressource, débits affichés, 300/300 de population. Il reste
// alors 4px de jeu. Un CINQUIÈME chiffre par ressource redonne ~14px de
// débordement et la population repasse sous le badge.
//
// On abrège donc à partir de 10 000, et seulement là : sur un écran plus large
// comme en deçà du seuil, le compte exact reste affiché chiffre pour chiffre.
//
// Arrondi VERS LE BAS, jamais vers le haut : qui lit « 12k » doit être sûr
// d'avoir AU MOINS ça. Afficher 13k avec 12 999 en caisse mentirait
// exactement dans le sens qui compte au moment de payer.
//
// La précision perdue ne coûte aucune décision : le bâtiment le plus cher du
// jeu (Merveille) vaut 800 bois / 800 pierre / 400 or. Passé 10 000 de stock,
// savoir si on a 12 300 ou 12 400 ne change plus aucun choix — et le compte
// exact reste disponible dans l'infobulle de la case (voir majRessource).
const RES_ABREGE_MIN=10000;
const _mqCompact=(typeof window!=='undefined'&&typeof window.matchMedia==='function')
  ? window.matchMedia('(max-width:440px)') : null;
let _resCompact=!!(_mqCompact&&_mqCompact.matches);
// Relu à chaque rafraîchissement du HUD, et NON sur le seul événement `change`
// de la media-query : cet événement ne se déclenche pas dans tous les
// contextes (mesuré : un viewport redimensionné par émulation ne l'émet pas,
// alors même que le CSS, lui, se réévalue). Le drapeau restait alors figé sur
// l'état du chargement et la barre gardait ses stocks abrégés sur un écran
// large. Une lecture de propriété par image est gratuite à côté du reste de
// updateHUD, et elle ne peut pas se désynchroniser.
function majSeuilCompact(){ if(_mqCompact) _resCompact=_mqCompact.matches; }

// Renvoie un NOMBRE quand il n'y a rien à abréger, et non une chaîne : c'est
// le cas de très loin le plus fréquent, appelé 4 fois par image, et le cache de
// setTxt compare alors deux nombres sans qu'aucune chaîne soit allouée.
function fmtRes(v){
  v=v|0;
  if(!_resCompact||v<RES_ABREGE_MIN) return v;
  if(v>=1000000) return (Math.floor(v/100000)/10).toString().replace('.',',')+'M';
  return Math.floor(v/1000)+'k';
}

// Débit par seconde affiché sous chaque ressource. G.rateShow est arrondi au
// dixième (voir 07-simulation.js), ce qui donnait des chaînes de CINQ
// caractères comme « +48.7 » : à elles seules, sur un écran de 375px, elles
// repoussaient la population sous le badge des villageois inactifs, et ce
// avec des stocks parfaitement ordinaires à 4 chiffres — c'était le vrai
// point de rupture de la barre, pas la taille des stocks.
//
// Une décimale sous 10, un entier au-dessus : à +0,6/s elle dit qu'on récolte
// VRAIMENT (afficher « +0 » ferait croire à l'arrêt, c'est là que le dixième
// compte), à +48/s elle n'apprend plus rien et coûte un caractère. Quatre
// caractères au maximum dans tous les cas.
//
// Et une virgule, pas un point : toute l'interface est en français.
function fmtTaux(v){
  if(!(v>0)) return '';
  if(v>=9.95) return '+'+Math.round(v);
  const s=v.toFixed(1);
  return '+'+(s.slice(-2)==='.0' ? s.slice(0,-2) : s.replace('.',','));
}

// Affiche le stock (abrégé si besoin) et garde le compte EXACT dans
// l'infobulle de la case : abréger doit rendre le chiffre discret, jamais
// inatteignable.
function majRessource(idVal,idCase,nom,v){
  v=v|0;
  setTxt(idVal,fmtRes(v));
  // Signature -1 tant qu'on n'abrège pas : l'infobulle vaut alors le simple
  // nom de la ressource, écrit une seule fois pour toute la partie. Dès qu'on
  // abrège, elle suit la valeur — et repasse au nom seul si l'écran
  // s'élargit, puisque la signature redevient -1.
  const k='t:'+idVal, sig=(_resCompact&&v>=RES_ABREGE_MIN)?v:-1;
  if(_hudCache.get(k)===sig) return;
  _hudCache.set(k,sig);
  const el=document.getElementById(idCase);
  if(el) el.setAttribute('title', sig<0 ? nom : nom+' : '+v);
}

function updateHUD(){
  majSeuilCompact();
  majRessource('vfood','ri-food','Nourriture',G.res.food);
  majRessource('vwood','ri-wood','Bois',G.res.wood);
  majRessource('vstone','ri-stone','Pierre',G.res.stone);
  majRessource('vgold','ri-gold','Or',G.res.gold);
  setTxt('vpop',G.pop);
  setTxt('vmaxpop',G.maxPop);
  // Plafond atteint : la case passe à l'orange. Le joueur le découvrait
  // jusqu'ici en échouant à former une unité — l'information était déjà
  // à l'écran ("5 / 5"), simplement muette.
  setFlag('ri-pop','full',G.pop>=G.maxPop);
  // Taux par seconde
  const setRate=(id,v)=>setTxt(id,fmtTaux(v));
  setRate('rfood',G.rateShow.food); setRate('rwood',G.rateShow.wood);
  setRate('rstone',G.rateShow.stone); setRate('rgold',G.rateShow.gold);
  // Badge villageois inactifs — compté sans allouer de tableau intermédiaire
  let idleCount=0;
  for(const u of G.units) if(u.type===UT.VIL&&u.state==='idle'&&estLocal(u)) idleCount++;
  setTxt('vidle',idleCount);
  setCls('idlebtn-inner',idleCount>0?'active':'zero');
  // Barre d'âge
  updateAgeBar();
  updateBandeauAdverse();
  // Groupes de contrôle : un groupe peut fondre en plein combat sans qu'on
  // l'ait rappelé entretemps (voir syncGroupBar) — le tenir à jour à chaque
  // image coûte 9 petits filtres, négligeable à côté du reste de cette
  // fonction (voir le commentaire d'en-tête sur le coût du DOM par différence).
  syncGroupBar();
}

// Panneau commun aux trois bâtiments de ressource améliorables (Camp
// Forestier, Camp Minier, Moulin) : rappel du rôle, niveau courant, et
// bouton d'amélioration façon Tour Défensive (voir drawBuildAct/TOWER).
function drawCampUpgrade(bar,b,ico,resLabel){
  const tbl=CAMP_LEVELS[b.type], lv=b.level||1, cfg=tbl[lv], next=tbl[lv+1];
  const info=document.createElement('div');
  info.style.cssText='color:#d4ac0d;font-size:11px;padding:5px 8px;text-align:center;font-family:Crimson Text,serif;';
  info.innerHTML=`${ico} ${cfg.nom} (Niv.${lv}/3) — récolte de ${resLabel}<br>`+
    `<span style="color:#999;font-size:10px;">Vitesse de récolte ×${cfg.rate.toFixed(2)}</span>`;
  bar.appendChild(info);
  if(next){
    const locked=next.reqAge!=null&&G.age<next.reqAge;
    const upCost=scaleCost(next.cost);
    mkBtn(bar,'⬆️',locked?`Améliorer\n🔒 ${AGES[next.reqAge].nom}`:'Améliorer\n'+costLabel(upCost),
      ()=>upgradeCamp(b), locked, upCost);
    const preview=document.createElement('div');
    preview.style.cssText='color:#8fbc44;font-size:9px;padding:0 4px 3px;width:100%;text-align:center;';
    preview.textContent=`→ ${next.nom} : récolte ×${next.rate.toFixed(2)}`;
    bar.appendChild(preview);
  } else {
    const maxed=document.createElement('div');
    maxed.style.cssText='color:#f0c040;font-size:10px;padding:2px 4px;width:100%;text-align:center;';
    maxed.textContent='🏆 Niveau maximum';
    bar.appendChild(maxed);
  }
  // Démolir est ajouté par le catch-all en fin de drawBuildAct — pas ici,
  // pour éviter le double bouton que produit déjà le bloc Tour Défensive.
}

// Bloc commun aux trois bâtiments garnissables (Centre Ville, Tour, Château) :
// effectif actuel / capacité, et un bouton pour tout faire ressortir.
// L'ENTRÉE en garnison ne passe pas par un bouton (sauf pour les villageois
// du Centre Ville, voir ci-dessous) : elle se fait en sélectionnant des
// unités puis en tapant le bâtiment (voir handleTap), exactement comme
// l'affectation à une ferme ou à un chantier.
function drawGarrisonInfo(bar,b){
  const cap=BDEF[b.type].garrisonCap; if(!cap) return;
  const n=G.units.filter(u=>u.state==='garrison'&&u.target===b.id).length;
  const info=document.createElement('div');
  info.style.cssText='color:#9fc9e8;font-size:10px;padding:3px 6px;width:100%;text-align:center;';
  // Le CV n'accepte plus les villageois par simple clic (voir handleTap,
  // js/09-entree.js) : l'indication renvoie vers le bouton 🔔 dédié plutôt
  // que vers un geste qui ne marche plus pour eux. La Tour et le Château,
  // eux, gardent l'ancien geste tel quel.
  const astuce=b.type===BT.TC
    ? ' — 🔔 pour les villageois, ou sélectionnez d’autres unités puis tapez ce bâtiment'
    : ' — sélectionnez des unités puis tapez ce bâtiment';
  info.textContent=`🏰 Garnison : ${n}/${cap}`+(n===0?astuce:'');
  bar.appendChild(info);
  if(n>0) mkBtn(bar,'🚪','Sortir\nla garnison',()=>degarrirTous(b));
}
function degarrirTous(b){
  const r=emettreOrdre(ordre(ORD.DEGARNIR,{bId:b.id}));
  if(!r.ok) return;
  notify(`🚪 ${r.n} unité(s) sortie(s) de garnison`,'#3498db'); buzz(6);
  refreshUI();
  if(b.type===BT.TC) syncShelterBtn();
}

// Bloc Marché : route commerciale active, ou bouton pour en lancer une.
function drawTradeRoute(bar,b){
  if(b.tradeRoute){
    const to=bldById(b.tradeRoute.toId);
    const info=document.createElement('div');
    info.style.cssText='color:#f0c040;font-size:10px;padding:3px 6px;width:100%;text-align:center;';
    const gold=Math.round(10+(b.tradeRoute.dist/BASE_TILE)*0.6);
    info.textContent=to?`🐫 Route vers ${BDEF[to.type].nom} — +${gold}💰 par trajet`:'🐫 Route commerciale';
    bar.appendChild(info);
    mkBtn(bar,'✖️','Annuler\nla route',()=>{
      const r=emettreOrdre(ordre(ORD.ROUTE_COMMERCIALE,{bId:b.id,toId:null}));
      if(r.ok){ notify('🐫 Route commerciale annulée','#95a5a6'); refreshUI(); }
    });
  } else {
    mkBtn(bar,'🐫','Envoyer une\ncaravane',()=>enterRoute(b.id));
  }
}
function enterRoute(bId){
  G.mode='route'; G.routeFrom=bId;
  document.getElementById('bcancel').style.display='flex';
  notify('Tapez un autre Marché (le vôtre ou celui d\'un allié) pour établir la route','#3498db');
  refreshUI();
}
function exitRoute(){
  G.mode='select'; G.routeFrom=null;
  document.getElementById('bcancel').style.display='none';
  refreshUI();
}

function updateActBar(){
  const bar=document.getElementById('actbar');
  bar.innerHTML='';
  if(G.sel.length===0){
    bar.innerHTML='<div class="tip">Tapez une unité ou un bâtiment pour le sélectionner</div>';
    return;
  }
  const e=G.sel.length===1?(G.units.find(u=>u.id===G.sel[0])||G.buildings.find(b=>b.id===G.sel[0])):null;
  if(!e&&G.sel.length>1){
    // Multi-sélection
    mkBtn(bar,'🛑','Stop',()=>emettreOrdre(ordre(ORD.STOP,{ids:G.units.filter(u=>estSel(u.id)&&estLocal(u)).map(u=>u.id)})));
    const mils=selMilitary();
    if(mils.length){
      mkBtn(bar,'🎯','Marche\nd\'attaque',orderAMove);
      const st=mils[0].stance||'agg';
      mkBtn(bar,STANCE_ICO[st],'Posture\n'+STANCE_LBL[st],cycleStance);
    }
    mkBtn(bar,'🔄','Grouper',()=>notify('Tapez une destination','#f1c40f'));
    return;
  }
  if(!e) return;
  if(G.units.find(u=>u.id===e.id)){
    drawUnitAct(bar,e);
  } else {
    drawBuildAct(bar,e);
  }
}

const BICO_ECO = [
  [BT.HOUSE,    '🏠','Maison',       {wood:25}],
  [BT.HLM,      '🏢','Immeuble HLM', {wood:150,stone:100}],
  [BT.MILL,     '💨','Moulin',        {wood:100}],
  [BT.FARM,     '🌾','Ferme',         {wood:60}],
  [BT.LUMBER,   '🪵','Camp Bois',     {wood:80}],
  [BT.MINE,     '⛏️','Minier',        {wood:80}],
  [BT.MARKET,   '🏪','Marché',        {wood:150,gold:50}],
  [BT.DOCK,     '⛵','Quai',          {wood:100}],
];
const BICO_MIL = [
  [BT.BARRACKS, '⚔️','Caserne',       {wood:200,stone:80}],
  [BT.STABLE,   '🐴','Écurie',        {wood:175,stone:60}],
  [BT.MONASTERY,'⛪','Monastère',     {wood:175,stone:50}],
  [BT.SIEGE,    '🛠️','Atelier Siège', {wood:220,stone:140}],
];
const BICO_DEF = [
  [BT.TOWER,    '🗼','Tour',          {wood:60,stone:180}],
  [BT.CASTLE,   '🏯','Château Fort',  {wood:300,stone:300,gold:100}],
  [BT.OUTPOST,  '🚩','Avant-poste',   {wood:50}],
  [BT.WALL,     '🪵','Mur',           {wood:20}],
  [BT.GATE,     '🚪','Portail',       {wood:40,stone:20}],
];
const BICO_UPG = [
  [BT.FORGE,    '⚒️','Forge',         {wood:150,stone:100}],
  [BT.UNIV,     '🎓','Université',    {wood:200,stone:150}],
  [BT.WONDER,   '🏛️','Merveille',     {wood:800,stone:800,gold:400}],
];

function fmtCost(cost){
  return Object.entries(cost).map(([r,v])=>`${v}${r==='food'?'🍖':r==='wood'?'🪵':r==='stone'?'🪨':'💰'}`).join(' ');
}

function drawUnitAct(bar,u){
  if(u.type===UT.VIL){
    // ── Tabs ── (4 catégories : les bâtiments défensifs et de recherche ont
    // chacun leur propre onglet, séparés de la Caserne/Écurie/Monastère qui
    // ne font qu'entraîner des troupes — plus facile à retrouver à mesure
    // que la liste de bâtiments s'est allongée)
    const tabRow=document.createElement('div');
    tabRow.style.cssText='width:100%;display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-bottom:5px;flex-shrink:0;';
    for(const[label,idx] of [['🏗️ Économie',0],['⚔️ Militaire',1],['🛡️ Défense',2],['🔬 Amélioration',3]]){
      const tb=document.createElement('button');
      const active=G.buildTab===idx;
      tb.style.cssText=`flex:1 1 105px;max-width:120px;padding:5px 6px;border-radius:7px;
        font-family:Cinzel,serif;font-size:10.5px;border:1.5px solid;cursor:pointer;
        background:${active?'#5a3000':'#1e0e00'};
        border-color:${active?'#f0c040':'#6b4510'};
        color:${active?'#f0c040':'#888'};`;
      tb.textContent=label;
      tb.addEventListener('click',()=>{G.buildTab=idx;refreshUI();});
      tabRow.appendChild(tb);
    }
    bar.appendChild(tabRow);
    const list=[BICO_ECO,BICO_MIL,BICO_DEF,BICO_UPG][G.buildTab]||BICO_ECO;
    for(const[bt,ico,nom,cost] of list){
      // Le Château Fort n'était jusqu'ici verrouillé par aucun âge malgré
      // ce que sa description prétendait — on tape juste le bouton, il se
      // construisait dès l'Âge Sombre si on avait les ressources.
      if((bt===BT.CASTLE||bt===BT.SIEGE)&&G.age<2){
        mkBtn(bar,ico,nom+'\n🔒 Âge Châteaux',()=>{},true);
        continue;
      }
      if(bt===BT.WONDER&&G.age<3){
        mkBtn(bar,ico,nom+'\n🔒 Âge Impérial',()=>{},true);
        continue;
      }
      if(bt===BT.WONDER&&G.buildings.some(bb=>bb.owner===G.me&&bb.type===BT.WONDER)){
        mkBtn(bar,ico,nom+'\n🏆 Déjà en construction',()=>{},true);
        continue;
      }
      // cost (BICO_ECO/BICO_MIL/BICO_DEF/BICO_UPG) = tarif de base ; le coût
      // réellement prélevé (voir confirmBuild) est mis à l'échelle par la
      // difficulté — le bouton doit toujours afficher ce montant final,
      // jamais le tarif de base.
      const realCost=scaleCost(cost);
      mkBtn(bar,ico,nom+'\n'+fmtCost(realCost),()=>enterBuild(bt),false,realCost);
    }
    if(u.state!=='idle') mkBtn(bar,'🛑','Stop',()=>emettreOrdre(ordre(ORD.STOP,{ids:[u.id]})));
  } else if(u.type===UT.MONK){
    mkBtn(bar,'✨','Auto-Soin',()=>notify('Le moine soigne auto les unités blessées !','#2ecc71'));
    mkBtn(bar,'🛑','Stop',()=>emettreOrdre(ordre(ORD.STOP,{ids:[u.id]})));
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:4px 6px;line-height:1.6;';
    info.innerHTML=`Soin: ${G.research.faith?5:3} PV/s | PV: ${u.hp}/${u.maxHp}`;
    bar.appendChild(info);
  } else {
    mkBtn(bar,'⚔️','Attaquer',()=>notify('Tapez sur un ennemi','#f1c40f'));
    mkBtn(bar,'🎯','Marche\nd\'attaque',orderAMove);
    const st=u.stance||'agg';
    mkBtn(bar,STANCE_ICO[st],'Posture\n'+STANCE_LBL[st],cycleStance);
    mkBtn(bar,'🛑','Stop',()=>emettreOrdre(ordre(ORD.STOP,{ids:[u.id]})));
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:4px 6px;line-height:1.6;';
    const heroLine=u.type===UT.HERO?`${u.heroIco} <strong style="color:#f0c040">${u.heroNom}</strong> — aura : +${Math.round((HERO_AURA_MULT-1)*100)}% ATK aux alliés proches<br>`:'';
    const rankLine=u.rank>0?`${RANK_THRESHOLDS[u.rank-1].ico} <strong style="color:#f0c040">${RANK_THRESHOLDS[u.rank-1].nom}</strong> (${u.xp||0} victoires)<br>`:'';
    info.innerHTML=`${heroLine}${rankLine}ATK: ${u.atk} | ${u.rng>BASE_TILE*1.5?'🏹 Distance':'⚔️ Corps à corps'}<br>PV: ${u.hp}/${u.maxHp}`;
    bar.appendChild(info);
  }
}

function tradeRes(fromR,fromV,toR,toV){
  const r=emettreOrdre(ordre(ORD.TROC,{donne:fromR, qteDonne:fromV, recoit:toR, qteRecoit:toV}));
  if(!r.ok){ notify('Ressources insuffisantes !','#e74c3c'); flashResources({[fromR]:fromV}); return; }
  const ico=x=>x==='food'?'🍖':x==='wood'?'🪵':x==='stone'?'🪨':'💰';
  notify(`Commerce: ${fromV}${ico(fromR)} → ${toV}${ico(toR)}`,'#f0c040');
  refreshUI();
}

function addCommonBuildingBtns(bar,b){
  if(b.type===BT.TC) return; // le Centre Ville n'est pas démolissable
  const btn=mkBtn(bar,'🧨','Démolir\n+25%',()=>{
    if(b._confirmDemo){ demolishBuilding(b); return; }
    b._confirmDemo=true;
    notify('Touchez à nouveau 🧨 pour confirmer','#e67e22');
    setTimeout(()=>{ b._confirmDemo=false; },3000);
  },false);
  // Jamais atteignable au clavier (voir actionBarre) : la démolition est la
  // seule action destructrice de la barre, et elle occupe le DERNIER
  // emplacement — donc pile sous Q/W/E/R sur une Caserne ou une Écurie, qui
  // n'ont que deux ou trois boutons. La double confirmation ne suffit pas :
  // deux appuis sur la même touche, c'est précisément ce qu'un doigt fait
  // quand il croit que le premier n'a pas pris.
  btn.classList.add('nohotkey');
}

function drawBuildAct(bar,b){
  if(b.constructing){
    const nb=G.units.filter(u=>u.state==='build'&&u.buildTarget===b.id).length;
    bar.innerHTML=`<div style="color:#3498db;font-family:Cinzel,serif;font-size:12px;padding:6px 8px;width:100%;text-align:center;">
      🔨 Construction : ${(b.progress*100)|0}% ${nb>0?'· 👷×'+nb:''}</div>
      <div style="color:${nb?'#888':'#f39c12'};font-size:9px;padding:0 4px 4px;width:100%;text-align:center;">
      ${nb?'Chantier en cours':'⚠️ Chantier à l\'arrêt — sélectionnez des villageois puis tapez le bâtiment'}</div>`;
    addCommonBuildingBtns(bar,b);
    return;
  }

  // ── Ferme ──
  if(b.type===BT.FARM){
    const info=document.createElement('div');
    info.style.cssText='color:#8fbc44;font-family:Cinzel,serif;font-size:12px;padding:6px 8px;width:100%;text-align:center;';
    const nb=(b.farmers||[]).length;
    info.innerHTML=`🌾 Nourriture: ${b.foodLeft|0}/${FARM_FOOD}`+(nb>0?` · 👷×${nb}`:'');
    bar.appendChild(info);
    const tip=document.createElement('div');
    tip.style.cssText='font-size:9px;padding:1px 4px;width:100%;text-align:center;';
    if(b.foodLeft<=0){
      const ok=canAfford(FARM_RESEED_COST);
      tip.style.color=ok?'#8fbc44':'#e67e22';
      tip.textContent=ok?'🌱 Re-semis automatique…'
        :`⏳ En attente de ${FARM_RESEED_COST.wood}🪵 pour re-semer`;
    } else {
      tip.style.color='#888';
      tip.textContent='Sélectionnez des villageois puis tapez la ferme';
    }
    bar.appendChild(tip);
    addCommonBuildingBtns(bar,b);
    return;
  }

  // ── Centre Ville ──
  if(b.type===BT.TC){
    mkBtn(bar,'👷','Villageois\n'+costLabel(TCOST[UT.VIL]),()=>trainUnit(b,UT.VIL),false,TCOST[UT.VIL]);
    mkBtn(bar,b.autoTrain?'♾️':'🔁',(b.autoTrain?'Auto ON':'Auto OFF')+'\nVillageois',()=>{
      const r=emettreOrdre(ordre(ORD.AUTO_FORMATION,{bId:b.id, actif:!b.autoTrain}));
      if(!r.ok) return;
      notify(r.actif?'♾️ Production continue activée':'⏹ Production continue arrêtée',
             r.actif?'#2ecc71':'#95a5a6'); buzz(6);
    });
    drawGarrisonInfo(bar,b);
  }

  // ── Caserne ──
  if(b.type===BT.BARRACKS){
    // Unités de base disponibles dès la construction (la Forge les améliore, elle ne les débloque plus)
    mkBtn(bar,'⚔️','Milicien\n'+costLabel(TCOST[UT.MIL]),()=>trainUnit(b,UT.MIL),false,TCOST[UT.MIL]);
    mkBtn(bar,'🏹','Archer\n'+costLabel(TCOST[UT.ARC]),()=>trainUnit(b,UT.ARC),false,TCOST[UT.ARC]);
    // Piquier débloqué à l'Âge Féodal
    if(G.age>=1){
      mkBtn(bar,'🔱','Piquier\n'+costLabel(TCOST[UT.PIKE]),()=>trainUnit(b,UT.PIKE),false,TCOST[UT.PIKE]);
    }
    if(!G.research.iron_sword||!G.research.bow_craft){
      const t=document.createElement('div');
      t.style.cssText='color:#8fbc44;font-size:10px;padding:2px 4px;font-style:italic;width:100%;text-align:center;';
      t.textContent='⚒️ Forge : améliore les dégâts de ces unités';
      bar.appendChild(t);
    }
    if(G.age<1){
      const t=document.createElement('div');
      t.style.cssText='color:#888;font-size:9px;padding:1px 4px;width:100%;text-align:center;';
      t.textContent='🌅 Âge Féodal → Piquier (anti-cavalerie)';
      bar.appendChild(t);
    }
  }

  // ── Écurie ──
  if(b.type===BT.STABLE){
    mkBtn(bar,'💨','Éclaireur\n'+costLabel(TCOST[UT.SCOUT]),()=>trainUnit(b,UT.SCOUT),false,TCOST[UT.SCOUT]);
    mkBtn(bar,'🐴','Chevalier\n'+costLabel(TCOST[UT.KNIGHT]),()=>trainUnit(b,UT.KNIGHT),false,TCOST[UT.KNIGHT]);
    if(!G.research.cavalry){
      const t=document.createElement('div');
      t.style.cssText='color:#8fbc44;font-size:10px;padding:2px 4px;font-style:italic;width:100%;text-align:center;';
      t.textContent='⚒️ Forge : Cavalerie renforce vos montures';
      bar.appendChild(t);
    }
  }

  // ── Monastère ──
  if(b.type===BT.MONASTERY){
    mkBtn(bar,'⛪','Moine\n'+costLabel(TCOST[UT.MONK]),()=>trainUnit(b,UT.MONK),false,TCOST[UT.MONK]);
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:3px 6px;width:100%;text-align:center;';
    info.textContent='Soigne automatiquement les unités blessées';
    bar.appendChild(info);
    const nRelics=(G.relics||[]).filter(r=>r.bankedBy===G.me).length;
    if(nRelics>0){
      const ri=document.createElement('div');
      ri.style.cssText='color:#f0c040;font-size:10px;padding:2px 6px;width:100%;text-align:center;';
      ri.textContent=`🏺 ${nRelics} relique(s) — +${(nRelics*RELIC_GOLD_RATE).toFixed(2)}💰/s`;
      bar.appendChild(ri);
    }
  }

  // ── Château Fort ──
  if(b.type===BT.CASTLE){
    const pU=G.research.faith;
    mkBtn(bar,'🌟','Paladin\n'+costLabel(TCOST[UT.PALADIN]),()=>trainUnit(b,UT.PALADIN),!pU,TCOST[UT.PALADIN]);
    // Arbalétrier à l'Âge des Châteaux
    if(G.age>=2){
      mkBtn(bar,'🎯','Arbalétrier\n'+costLabel(TCOST[UT.XBOW]),()=>trainUnit(b,UT.XBOW),false,TCOST[UT.XBOW]);
    }
    // Trébuchet à l'Âge Impérial
    if(G.age>=3){
      mkBtn(bar,'🪨','Trébuchet\n'+costLabel(TCOST[UT.TREB]),()=>trainUnit(b,UT.TREB),false,TCOST[UT.TREB]);
    }
    if(!pU){
      const t=document.createElement('div');
      t.style.cssText='color:#f39c12;font-size:10px;padding:2px 4px;font-style:italic;width:100%;text-align:center;';
      t.textContent='🎓 Foi Divine requise (Université)';
      bar.appendChild(t);
    }
    // Unité unique de civilisation, à l'Âge des Châteaux. Le bouton lit
    // PRODUCTION plutôt que de recopier la règle : une entrée ajoutée là
    // apparaît ici sans rien toucher, et l'interface ne peut pas diverger de
    // ce que l'hôte autorise réellement.
    const maCiv=civKeyOf(G.me);
    for(const o of (PRODUCTION[BT.CASTLE]||[])){
      if(o.civ!==maCiv) continue;
      const verrou=(o.age!=null&&G.age<o.age);
      const libelle=UDEF[o.u].nom+'\n'+(verrou?'🔒 '+AGES[o.age].nom:costLabel(TCOST[o.u]));
      mkBtn(bar,UNIT_ICO[o.u]||'⭐',libelle,()=>trainUnit(b,o.u),verrou,verrou?null:TCOST[o.u]);
    }
    // Héros : une seule fois par partie, même s'il meurt — voir HEROES/ORD.FORMER.
    const heroDone=G.factions[G.me].heroTrained;
    const heroDef=HEROES[G.factions[G.me].civ]||HEROES.francs;
    mkBtn(bar,heroDef.ico,(heroDone?'Déjà formé\n':'')+heroDef.nom+'\n'+costLabel(TCOST[UT.HERO]),
      ()=>trainUnit(b,UT.HERO), heroDone, TCOST[UT.HERO]);
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:3px 6px;';
    info.textContent='⚔️ Défense auto longue portée';
    bar.appendChild(info);
    drawGarrisonInfo(bar,b);
  }

  // ── Atelier de Siège ──
  if(b.type===BT.SIEGE){
    mkBtn(bar,'🐏','Bélier\n'+costLabel(TCOST[UT.RAM]),()=>trainUnit(b,UT.RAM),false,TCOST[UT.RAM]);
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:3px 6px;';
    info.textContent='🏚️ Dégâts x1.5 contre les bâtiments';
    bar.appendChild(info);
  }

  // ── Avant-poste ──
  if(b.type===BT.OUTPOST){
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:4px 6px;line-height:1.5;';
    info.textContent='🚩 Petit poste de garde peu coûteux : étend votre champ de vision.';
    bar.appendChild(info);
  }

  // ── Forge ──
  if(b.type===BT.FORGE){
    mkBtn(bar,'🔬','Recherches',()=>openRP('forge'));
    if(G.researchQ.length>0){
      const t=document.createElement('div');
      t.style.cssText='color:#3498db;font-size:10px;padding:3px 6px;';
      t.textContent=`⏳ ${RDEF[G.researchQ[0].type].nom}: ${Math.ceil(G.researchQ[0].timer)}s`;
      bar.appendChild(t);
    }
  }

  // ── Université ──
  if(b.type===BT.UNIV){
    mkBtn(bar,'🎓','Recherches\nAvancées',()=>openRP('univ'));
    if(G.researchQ.length>0&&RDEF[G.researchQ[0].type]?.cat==='univ'){
      const t=document.createElement('div');
      t.style.cssText='color:#3498db;font-size:10px;padding:3px 6px;';
      t.textContent=`⏳ ${RDEF[G.researchQ[0].type].nom}: ${Math.ceil(G.researchQ[0].timer)}s`;
      bar.appendChild(t);
    }
  }

  // ── Marché ──
  if(b.type===BT.MARKET){
    // Derives de TROCS, pas recopies : l'hote refuse tout taux qui n'y
    // figure pas, un bouton qui divergerait ne produirait qu'un rejet.
    const icoR=x=>x==='food'?'🍖':x==='wood'?'🪵':x==='stone'?'🪨':'💰';
    for(const t of TROCS)
      mkBtn(bar, icoR(t.donne)+'→'+icoR(t.recoit),
            t.qte+icoR(t.donne)+'\n→'+t.rend+icoR(t.recoit),
            ()=>tradeRes(t.donne,t.qte,t.recoit,t.rend), false, {[t.donne]:t.qte});
    drawTradeRoute(bar,b);
  }

  // ── Quai ──
  if(b.type===BT.DOCK){
    mkBtn(bar,'⛵','Barque de\nPêche\n'+costLabel(TCOST[UT.BOAT]),()=>trainUnit(b,UT.BOAT),false,TCOST[UT.BOAT]);
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:10px;padding:3px 6px;width:100%;text-align:center;';
    info.textContent='🐟 Envoyez une Barque pêcher un banc de poissons visible sur l\'eau';
    bar.appendChild(info);
  }

  // ── Camp Forestier / Camp Minier / Moulin : récolte + amélioration ──
  if(b.type===BT.LUMBER) drawCampUpgrade(bar,b,'🪵','bois');
  if(b.type===BT.MINE)   drawCampUpgrade(bar,b,'⛏️','pierre et or');
  if(b.type===BT.MILL){
    drawCampUpgrade(bar,b,'🌿','nourriture (baies et fermes)');
    // Le Moulin abrite les recherches ÉCONOMIQUES : c'est le premier
    // bâtiment de production que tout le monde pose, donc l'arbitrage
    // « économie ou armée » se présente tôt, quand il compte encore.
    mkBtn(bar,'🌾','Recherches\nÉconomiques',()=>openRP('eco'));
    if(G.researchQ.length>0&&RDEF[G.researchQ[0].type]?.cat==='eco'){
      const t=document.createElement('div');
      t.style.cssText='color:#3498db;font-size:10px;padding:3px 6px;';
      t.textContent=`⏳ ${RDEF[G.researchQ[0].type].nom}: ${Math.ceil(G.researchQ[0].timer)}s`;
      bar.appendChild(t);
    }
  }

  // ── Tour Défensive : stats actuelles + amélioration ──
  if(b.type===BT.TOWER){
    const lv=b.level||1, cfg=TOWER_LEVELS[lv], next=TOWER_LEVELS[lv+1];
    const info=document.createElement('div');
    info.style.cssText='color:#e8d5a0;font-family:Cinzel,serif;font-size:12px;padding:4px 8px;width:100%;text-align:center;';
    info.innerHTML=`🗼 ${cfg.nom} (Niv.${lv}/3)<br>`+
      `<span style="color:#999;font-size:10px;">ATK ${cfg.atk} · Portée ${cfg.range.toFixed(1)} · Cadence ${cfg.cd}s</span>`;
    bar.appendChild(info);
    if(next){
      const locked=next.reqAge!=null&&G.age<next.reqAge;
      const upCost=scaleCost(next.cost);
      mkBtn(bar,'⬆️',locked?`Améliorer\n🔒 ${AGES[next.reqAge].nom}`:'Améliorer\n'+costLabel(upCost),
        ()=>upgradeTower(b), locked, upCost);
      const hpGain=Math.round((towerMaxHp(lv+1)/b.maxHp-1)*100);
      const preview=document.createElement('div');
      preview.style.cssText='color:#8fbc44;font-size:9px;padding:0 4px 3px;width:100%;text-align:center;';
      preview.textContent=`→ ${next.nom} : ATK ${next.atk} · Portée ${next.range.toFixed(1)} · +${hpGain}% PV`;
      bar.appendChild(preview);
    } else {
      const maxed=document.createElement('div');
      maxed.style.cssText='color:#f0c040;font-size:10px;padding:2px 4px;width:100%;text-align:center;';
      maxed.textContent='🏆 Niveau maximum';
      bar.appendChild(maxed);
    }
    drawGarrisonInfo(bar,b);
    addCommonBuildingBtns(bar,b);
  }

  // ── Merveille (info + décompte de victoire) ──
  if(b.type===BT.WONDER){
    const info=document.createElement('div');
    info.style.cssText='color:#d8c078;font-family:Cinzel,serif;font-size:12px;padding:5px 8px;text-align:center;';
    const restant=Math.max(0,MERVEILLE_WIN_TIME-(b.wonderTimer||0));
    const mm=Math.floor(restant/60), ss=Math.ceil(restant%60);
    info.innerHTML=`🏛️ Merveille<br><span style="color:#999;font-size:10px;">PV: ${b.hp}/${b.maxHp}</span>`+
      (restant>0?`<br><span style="color:#f0c040;font-size:11px;">⏳ Victoire dans ${mm}m${String(ss).padStart(2,'0')} si elle tient debout</span>`
                :`<br><span style="color:#2ecc71;font-size:11px;">🏆 Décompte achevé !</span>`);
    bar.appendChild(info);
  }

  // ── Immeuble HLM (info) ──
  if(b.type===BT.HLM){
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:11px;padding:5px 8px;text-align:center;';
    info.innerHTML=`🏢 Immeuble HLM : +25 population<br>PV: ${b.hp}/${b.maxHp}`;
    bar.appendChild(info);
  }

  // ── Mur (info) ──
  if(b.type===BT.WALL){
    // Le nom et l'icône suivent l'habillage visuel de la case précédente
    // (palissade → pierre → fortifié) : pas de palier séparé à acheter,
    // le mur se renforce tout seul avec chaque montée d'âge du joueur.
    const wallNames=['🪵 Palissade de Bois','🪵 Palissade Renforcée','🧱 Mur de Pierre','🏯 Mur Fortifié'];
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:11px;padding:5px 8px;text-align:center;';
    info.innerHTML=`${wallNames[G.age]||wallNames[0]}<br>PV: ${b.hp}/${b.maxHp}`;
    bar.appendChild(info);
  }

  // ── Portail : ouvrir/fermer le passage à travers le mur ──
  if(b.type===BT.GATE){
    mkBtn(bar,b.open?'🔓':'🔒',(b.open?'Ouvert\nFermer le passage':'Fermé\nOuvrir le passage'),()=>toggleGate(b));
    const info=document.createElement('div');
    info.style.cssText='color:#888;font-size:11px;padding:5px 8px;text-align:center;';
    info.innerHTML=`🚪 Portail : ${b.open?'ouvert, laisse passer les unités':'fermé, bloque le passage'}<br>PV: ${b.hp}/${b.maxHp}`;
    bar.appendChild(info);
  }

  // ── File de formation ── chaque emplacement affiche son icône et, pour
  // celui en cours, une barre de progression ; un clic l'annule — n'importe
  // lequel de la file, pas seulement le dernier. Passe par le même circuit
  // d'ordres (ORD.ANNULER_FORMATION) que la mise en file : l'ancien bouton
  // unique mutait trainQ et les ressources directement, y compris côté
  // CLIENT en multijoueur, sans jamais passer par l'hôte autoritaire.
  if(b.trainQ?.length>0){
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;gap:4px;flex-wrap:wrap;padding:4px 6px;align-items:flex-end;';
    b.trainQ.forEach((type,i)=>{
      const slot=document.createElement('button');
      const enCours=i===0;
      slot.style.cssText='position:relative;width:32px;height:32px;padding:0;overflow:hidden;'+
        'border:1.5px solid '+(enCours?'#f1c40f':'#5a4a2a')+';border-radius:6px;'+
        'background:rgba(20,12,0,.7);cursor:pointer;';
      slot.title=(enCours?'En formation — ':'En attente — ')+(UDEF[type]?.nom||type)+'\n(clic : annuler, 50% remboursé)';
      if(enCours){
        const pct=Math.max(0,Math.min(1,1-b.trainTimer/trainTime(type)));
        const fond=document.createElement('div');
        fond.style.cssText=`position:absolute;left:0;bottom:0;width:100%;height:${Math.round(pct*100)}%;`+
          'background:rgba(241,196,15,.3);pointer-events:none;';
        slot.appendChild(fond);
      }
      const ic=document.createElement('span');
      ic.style.cssText='position:relative;pointer-events:none;';
      ic.innerHTML=iconImg(UNIT_ICO[type]||'❓',22);
      slot.appendChild(ic);
      slot.addEventListener('click',()=>{
        const r=emettreOrdre(ordre(ORD.ANNULER_FORMATION,{bId:b.id,index:i}));
        if(r.ok){ sfx('tap'); notify('Formation annulée (50% remboursé)','#f39c12'); refreshUI(); }
      });
      wrap.appendChild(slot);
    });
    bar.appendChild(wrap);
  }
  addCommonBuildingBtns(bar,b); // bouton Démolir sur tous les autres bâtiments
}

// locked   = verrou « dur » (âge/prérequis non rempli) : grisé ET inerte, comme avant.
// costObj  = coût à vérifier ; s'il n'est pas couvert (et que le bouton n'est
//            pas déjà `locked`), le bouton reste grisé mais RESTE cliquable :
//            l'appui fait clignoter les ressources manquantes au lieu de ne
//            rien faire — avant, un bouton trop cher était aussi silencieux
//            qu'un bouton verrouillé par l'âge, sans dire pourquoi.
function mkBtn(parent,ico,label,onClick,locked=false,costObj=null){
  const b=document.createElement('button');
  const shortfall=!locked&&costObj&&!canAfford(costObj);
  b.className='btn'+(locked?' locked':shortfall?' costlock':'');
  b.innerHTML=`<span class="bico">${iconImg(ico,19)}</span><span>${label.replace('\n','<br>')}</span>`;
  if(shortfall) b.title='Il manque : '+missingLabel(costObj);
  if(!locked){
    b.addEventListener('click',()=>{
      if(shortfall){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(costObj); buzz(8); return; }
      sfx('tap'); onClick(); refreshUI();
    });
  }
  parent.appendChild(b);
  return b;
}

function updateSelInfo(e){
  const si=document.getElementById('selinfo');
  const hpr=document.getElementById('hprow');
  if(!e){
    // Sélection multiple : afficher un résumé plutôt que rien
    const units=G.units.filter(u=>estSel(u.id));
    if(units.length>1){
      si.style.display='block';
      document.getElementById('seltitle').textContent=units.length+' unités sélectionnées';
      // Jauge de PV AGRÉGÉE (total actuel / total max de tout le groupe) —
      // avant, la jauge disparaissait purement et simplement dès la 2e unité
      // sélectionnée, aucun moyen de voir d'un coup d'œil si l'armée tenait
      // encore debout ou fondait déjà.
      if(hpr){
        hpr.style.display='';
        let hp=0,maxHp=0; for(const u of units){ hp+=u.hp; maxHp+=u.maxHp; }
        const r=maxHp>0?hp/maxHp:0;
        document.getElementById('hpfill').style.width=(r*100)+'%';
        document.getElementById('hpfill').style.background=r>.6?'#2ecc71':r>.3?'#f39c12':'#e74c3c';
        document.getElementById('hptxt').textContent=`${hp|0}/${maxHp|0} (total)`;
      }
      const counts={};
      for(const u of units) counts[u.type]=(counts[u.type]||0)+1;
      // Chaque type est un chip cliquable : touche « Chevalier ×5 » pour ne
      // garder que les chevaliers dans une armée mixte, sans devoir la
      // reconstituer à la main au lasso.
      const sd=document.getElementById('seldesc');
      sd.textContent=''; sd.title='';
      Object.entries(counts).forEach(([t,c],i)=>{
        if(i>0) sd.appendChild(document.createTextNode(' · '));
        const chip=document.createElement('span');
        chip.textContent=UDEF[t].nom+' ×'+c;
        chip.style.cssText='cursor:pointer;text-decoration:underline dotted;';
        chip.title='Ne garder que : '+UDEF[t].nom;
        chip.addEventListener('click',ev=>{
          ev.stopPropagation();
          G.sel=units.filter(u=>u.type===t).map(u=>u.id);
          refreshUI(); buzz(6);
        });
        sd.appendChild(chip);
      });
      return;
    }
    si.style.display='none'; return;
  }
  if(hpr) hpr.style.display='';
  si.style.display='block';
  const isUnit=!!G.units.find(u=>u.id===e.id);
  let name=isUnit?UDEF[e.type].nom:BDEF[e.type].nom;
  if(!isUnit&&e.type===BT.TOWER) name+=` (Niv.${e.level||1})`;
  const nSel=G.sel.length;
  document.getElementById('seltitle').textContent=nSel>1?`${name} ×${nSel}`:name;
  const r=e.hp/e.maxHp;
  document.getElementById('hpfill').style.width=(r*100)+'%';
  document.getElementById('hpfill').style.background=r>.6?'#2ecc71':r>.3?'#f39c12':'#e74c3c';
  document.getElementById('hptxt').textContent=`${e.hp|0}/${e.maxHp}`;
  const stateLabels={idle:'Inactif',moving:'En route',gather:'Récolte',farm:'Aux champs 🌾',repair:'Réparation 🛠',return:'Retour dépôt',build:'Construction',attack:'Combat',amove:'Marche d\'attaque ⚔️',heal:'Soin ✨'};
  const desc=[];
  if(G.units.find(u=>u.id===e.id)&&e.state!=='idle') desc.push(stateLabels[e.state]||e.state);
  if(e.trainQ?.length>0) desc.push(`File: ${e.trainQ.length}`);
  // Armure et contres : un système de contre invisible ne sert à rien — le
  // joueur doit pouvoir lire POURQUOI son Piquier fond sous les flèches et
  // écrase la cavalerie. Bâtiments compris : leur armure est réelle aussi.
  const arm=armureDe(e);
  if(arm.m||arm.p) desc.push(`🛡 ${arm.m}/${arm.p}`);
  if(isUnit){
    const cb=BONUS[e.type];
    if(cb) desc.push('⚔ +'+Object.entries(cb).map(([c,v])=>`${v} vs ${CLS_NOM[c]||c}`).join(', '));
  }
  document.getElementById('seldesc').textContent=desc.join(' | ');
  // Le détail tient rarement sur une ligne dans le bandeau : l'info-bulle
  // reprend tout, y compris ce que la classe de l'unité lui fait SUBIR.
  const sd=document.getElementById('seldesc');
  if(isUnit){
    const d=UDEF[e.type];
    sd.title=`${name} — ${CLS_NOM[d.cls]||d.cls}\n`+
      `Attaque ${e.atk} (${d.atkType==='m'?'mêlée':'perforant'})\n`+
      `Armure ${arm.m} mêlée / ${arm.p} perforant`;
  } else sd.title=`${name}\nArmure ${arm.m} mêlée / ${arm.p} perforant`;
}

// ── PANNEAU RECHERCHE ─────────────────────────────────────
function openRP(cat='forge'){
  const panel=document.getElementById('rpanel');
  const list=document.getElementById('rlist');
  const titles={forge:'⚒️ Forge — Recherches',univ:'🎓 Université — Recherches Avancées',
                eco:'💨 Moulin — Recherches Économiques'};
  document.querySelector('#rpanel h2').textContent=titles[cat]||'🔬 Recherches';
  list.innerHTML='';
  const maCiv=civKeyOf(G.me);
  for(const[key,r] of Object.entries(RDEF)){
    if(r.cat!==cat) continue;
    // Recherche exclusive : une civilisation ne voit QUE la sienne. Ce n'est
    // pas seulement de l'affichage — ORD.RECHERCHE refuse la même chose côté
    // hôte, un ordre réseau forgé ne passe pas.
    if(r.civ&&r.civ!==maCiv) continue;
    const done=G.research[key];
    const inQ=G.researchQ.some(q=>q.type===key);
    const ageManquant=(r.age!=null&&G.age<r.age);
    const costStr=Object.entries(r.cost).map(([k,v])=>`${v}${k==='wood'?'🪵':k==='stone'?'🪨':k==='gold'?'💰':'🍖'}`).join(' ');
    const el=document.createElement('div'); el.className='ritem';
    el.innerHTML=`<h3>${iconImg(r.ico,16)} ${r.nom}</h3>
      <div class="rcost">${r.desc} — Coût: ${costStr} — ${r.time}s</div>
      ${done?'<div class="rdone">✅ Terminé</div>':inQ?'<div class="rdone">⏳ En cours…</div>':ageManquant?`<div class="rdone">🔒 ${AGES[r.age].nom} requis</div>`:''}`;
    if(!done&&!inQ&&!ageManquant){
      const btn=document.createElement('button');
      // Volontairement JAMAIS `disabled` : un bouton grisé-mais-cliquable
      // qui répond par un flash de ressources en dit plus qu'un bouton
      // muet — voir mkBtn() pour le même principe côté actbar.
      const rShort=!canAfford(r.cost);
      btn.className='rbtn'+(rShort?' costlock':'');
      btn.textContent='Lancer';
      if(rShort) btn.title='Il manque : '+missingLabel(r.cost);
      btn.addEventListener('click',()=>{
        const res=emettreOrdre(ordre(ORD.RECHERCHE,{cle:key}));
        if(!res.ok){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(r.cost); return; }
        closeRP();
        notify(`🔬 ${res.nom} en cours…`,'#3498db');
      });
      el.appendChild(btn);
    }
    list.appendChild(el);
  }
  panel.style.display='flex';
}
function closeRP(){ document.getElementById('rpanel').style.display='none'; }
window.closeRP=closeRP;
window.toggleSfx=toggleSfx;

// ── SONS (WebAudio, synthèse pure : aucun fichier à charger) ──
// iOS n'autorise l'audio qu'après un geste utilisateur : le contexte est créé
// au premier appui, et tout est silencieux tant qu'il n'existe pas.
const SFX={
  ctx:null, master:null, noise:null, on:true, last:{},
  init(){
    if(this.ctx) return;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return;                       // pas d'audio disponible : le jeu tourne quand même
    try{ this.ctx=new AC(); }catch(e){ return; }
    this.master=this.ctx.createGain();
    this.master.gain.value=0.34;
    this.master.connect(this.ctx.destination);
    // bruit blanc décroissant réutilisable (impacts, coups de hache)
    const n=(this.ctx.sampleRate*0.4)|0;
    const buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    this.noise=buf;
  },
  unlock(){ this.init(); if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); },
  // anti-spam : 30 villageois qui récoltent ne doivent pas produire 30 sons
  ok(name,cd){
    if(!this.on||!this.ctx) return false;
    const t=this.ctx.currentTime;
    if(cd&&this.last[name]!=null&&t-this.last[name]<cd) return false;
    this.last[name]=t; return true;
  },
  tone(freq,dur,type,vol,slideTo){
    const t=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type||'square'; o.frequency.setValueAtTime(freq,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo),t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(vol==null?0.3:vol,t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+dur+0.02);
  },
  burst(dur,vol,freq){
    const t=this.ctx.currentTime;
    const s=this.ctx.createBufferSource(), g=this.ctx.createGain(), f=this.ctx.createBiquadFilter();
    s.buffer=this.noise; f.type='bandpass'; f.frequency.value=freq||900; f.Q.value=1.3;
    g.gain.setValueAtTime(vol||0.22,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t+dur);
  },
  seq(notes,step,type,vol){
    const t0=this.ctx.currentTime;
    for(let i=0;i<notes.length;i++){
      const t=t0+i*step, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=type||'triangle'; o.frequency.setValueAtTime(notes[i],t);
      g.gain.setValueAtTime(0.0001,t);
      g.gain.linearRampToValueAtTime(vol==null?0.26:vol,t+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001,t+step*0.95);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t+step+0.02);
    }
  },
};
function sfx(name){
  if(!SFX.ctx||!SFX.on) return;
  switch(name){
    case 'chop':  if(SFX.ok('chop',0.11))  SFX.burst(0.07,0.15,430); break;   // hache dans le bois
    case 'mine':  if(SFX.ok('chop',0.11))  SFX.burst(0.05,0.13,1500); break;  // pioche sur la roche
    case 'pick':  if(SFX.ok('chop',0.13))  SFX.burst(0.05,0.10,2400); break;  // cueillette
    case 'drop':  if(SFX.ok('drop',0.16))  SFX.tone(660,0.09,'triangle',0.17,990); break;
    case 'tap':   if(SFX.ok('tap',0.04))   SFX.tone(520,0.05,'square',0.11); break;
    case 'build': if(SFX.ok('build',0.25)) SFX.seq([523,659,784,1047],0.09,'triangle',0.25); break;
    case 'train': if(SFX.ok('train',0.2))  SFX.seq([392,523],0.08,'triangle',0.2); break;
    case 'hit':   if(SFX.ok('hit',0.07))   SFX.burst(0.08,0.12,230); break;
    case 'death': if(SFX.ok('death',0.14)) SFX.tone(220,0.22,'sawtooth',0.15,70); break;
    case 'alert': if(SFX.ok('alert',1.5))  SFX.seq([330,247,330,247],0.16,'square',0.23); break;
    case 'wave':  if(SFX.ok('wave',2))     SFX.seq([147,131,110],0.28,'sawtooth',0.25); break;
    case 'age':   if(SFX.ok('age',1))      SFX.seq([523,659,784,1047,1319],0.11,'triangle',0.28); break;
    case 'error': if(SFX.ok('error',0.35)) SFX.tone(180,0.14,'square',0.17,120); break;
  }
}
// Déblocage au premier contact (exigence iOS Safari)
(function(){
  const unlock=()=>{
    SFX.unlock();
    document.removeEventListener('touchstart',unlock);
    document.removeEventListener('click',unlock);
  };
  document.addEventListener('touchstart',unlock,{passive:true});
  document.addEventListener('click',unlock);
  try{ if(localStorage.getItem('adc_sfx')==='0') SFX.on=false; }catch(e){}
})();
function toggleSfx(){
  SFX.on=!SFX.on;
  try{ localStorage.setItem('adc_sfx',SFX.on?'1':'0'); }catch(e){}
  const el=document.getElementById('zsound');
  if(el){ el.innerHTML=`${iconImg(SFX.on?'🔊':'🔇',18)} Son : ${SFX.on?'Activé':'Coupé'}`; el.style.opacity=SFX.on?'1':'.7'; }
  if(SFX.on){ SFX.unlock(); sfx('tap'); }
  notify(SFX.on?'🔊 Son activé':'🔇 Son coupé','#95a5a6');
  syncOptionsUI();
}

// ── MENU OPTIONS (écran-titre + menu pause) ────────────────
// Bascules globales compatibles mobile ET PC : Son (SFX ci-dessus, juste
// relié ici), Vibrations, Plein écran, Réduire les animations. Chacune se
// grise/se désactive toute seule si l'appareil ne la supporte pas (voir
// optRowAvailability()) plutôt que de disparaître — un joueur PC voit encore
// la rangée Vibrations, juste marquée indisponible, au lieu de se demander
// où elle est passée.

// Vibrations : buzz() (juste au-dessus) est le SEUL point d'entrée de toute
// vibration du jeu — cette bascule suffit donc à tout couper d'un coup.
// Activées par défaut (comportement historique inchangé tant que le joueur
// n'a rien réglé).
const VIBR={ on:true };
try{ if(localStorage.getItem('adc_vibr')==='0') VIBR.on=false; }catch(e){}
function toggleVibr(){
  VIBR.on=!VIBR.on;
  try{ localStorage.setItem('adc_vibr',VIBR.on?'1':'0'); }catch(e){}
  if(VIBR.on) buzz(10);
  notify(VIBR.on?'📳 Vibrations activées':'📴 Vibrations coupées','#95a5a6');
  syncOptionsUI();
}
window.toggleVibr=toggleVibr;

// Plein écran : API standard, avec repli webkit (vieux Safari). Le bouton
// n'est que le déclencheur — l'état réel vient de document.fullscreenElement
// (voir syncOptionsUI()), car on peut aussi en sortir avec Échap sans passer
// par lui : d'où les écouteurs fullscreenchange qui re-synchronisent le
// libellé dans ce cas.
function toggleFullscreen(){
  const el=document.documentElement;
  const isFs=!!(document.fullscreenElement||document.webkitFullscreenElement);
  try{
    // Peut être refusé sans que ce soit une erreur du jeu (page dans un
    // cadre sans permission plein écran, iOS Safari qui ne l'expose pas du
    // tout…) : la promesse rejetée est avalée en silence plutôt que de
    // remonter en rejet non traité dans la console — syncOptionsUI() via
    // fullscreenchange dit de toute façon la vérité, pas ce bouton.
    if(!isFs){
      const req=el.requestFullscreen||el.webkitRequestFullscreen;
      if(req){ const p=req.call(el); if(p&&p.catch) p.catch(()=>{}); }
    } else {
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(exit){ const p=exit.call(document); if(p&&p.catch) p.catch(()=>{}); }
    }
  }catch(e){}
}
window.toggleFullscreen=toggleFullscreen;
document.addEventListener('fullscreenchange', ()=>syncOptionsUI());
document.addEventListener('webkitfullscreenchange', ()=>syncOptionsUI());

// Réduire les animations : pose/retire html.reduce-motion (voir index.html,
// section juste après le @media prefers-reduced-motion existant) — ne cible
// QUE les animations décoratives en boucle infinie, jamais celles qui
// portent une temporisation fonctionnelle (toasts, succès, bannières).
const MOTION={ reduced:false };
try{ if(localStorage.getItem('adc_reduce_motion')==='1') MOTION.reduced=true; }catch(e){}
function applyReduceMotion(){
  document.documentElement.classList.toggle('reduce-motion', MOTION.reduced);
}
function toggleReduceMotion(){
  MOTION.reduced=!MOTION.reduced;
  try{ localStorage.setItem('adc_reduce_motion',MOTION.reduced?'1':'0'); }catch(e){}
  applyReduceMotion();
  notify(MOTION.reduced?'🎞️ Animations réduites':'🎞️ Animations normales','#95a5a6');
  syncOptionsUI();
}
window.toggleReduceMotion=toggleReduceMotion;
applyReduceMotion(); // reprend le réglage de la dernière session dès le chargement

// Une bascule sans effet sur cet appareil (Vibrations sur PC, Plein écran si
// l'API n'existe pas) reste visible mais se grise et se désactive — évalué
// une seule fois, la disponibilité ne change pas en cours de session.
function optRowAvailability(){
  if(!('vibrate' in navigator)){
    const row=document.getElementById('opt-row-vibr'), btn=document.getElementById('opt-vibr-state');
    if(row) row.classList.add('optrow-unavail');
    if(btn){ btn.disabled=true; btn.textContent='Indisponible'; btn.classList.remove('on'); }
  }
  const canFs=!!(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen);
  if(!canFs){
    const row=document.getElementById('opt-row-fs'), btn=document.getElementById('opt-fs-state');
    if(row) row.classList.add('optrow-unavail');
    if(btn){ btn.disabled=true; btn.textContent='Indisponible'; }
  }
}
optRowAvailability();

function syncOptionsUI(){
  const setRow=(id,on,onLabel,offLabel)=>{
    const el=document.getElementById(id);
    if(!el||el.disabled) return; // indisponible sur cet appareil : garder "Indisponible"
    el.textContent=on?onLabel:offLabel;
    el.classList.toggle('on',on);
  };
  setRow('opt-sfx-state', SFX.on, 'Activé','Coupé');
  setRow('opt-vibr-state', VIBR.on, 'Activées','Coupées');
  setRow('opt-fs-state', !!(document.fullscreenElement||document.webkitFullscreenElement), 'Activé','Désactivé');
  setRow('opt-motion-state', MOTION.reduced, 'Réduites','Normales');
}
window.syncOptionsUI=syncOptionsUI;
function openOptions(){ syncOptionsUI(); document.getElementById('optionspanel').style.display='flex'; }
function closeOptions(){ document.getElementById('optionspanel').style.display='none'; }
window.openOptions=openOptions; window.closeOptions=closeOptions;

// ── RÉPARATION AUTOMATIQUE ────────────────────────────────
// Bascule globale (comme le son) : quand elle est active, tout villageois
// qui retombe à l'état 'idle' (voir updatePlayerUnit) part réparer seul le
// bâtiment endommagé le plus proche, sans qu'il faille le sélectionner à
// la main à chaque fois. Ne mobilise jamais un villageois déjà occupé
// (récolte, construction, ferme…) : ça ne change que ce que fait un
// villageois qui, de toute façon, ne faisait déjà plus rien.
function toggleAutoRepair(){
  emettreOrdre(ordre(ORD.AUTO_REPARE,{actif:!G.autoRepair}));
  syncAutoRepairBtn();
  notify(G.autoRepair
    ? '🔧 Réparation auto activée — les villageois inactifs répareront seuls'
    : '🔧 Réparation auto désactivée', G.autoRepair?'#2ecc71':'#95a5a6');
  buzz(6);
}
window.toggleAutoRepair=toggleAutoRepair;
function syncAutoRepairBtn(){
  const el=document.getElementById('zrepair');
  if(el) el.classList.toggle('active', !!G.autoRepair);
}

// ── VILLAGEOIS À L'ABRI (cloche) ──────────────────────────────
// Un seul bouton, aucune sélection préalable : rentre TOUS les villageois du
// joueur dans son/ses Centre(s) Ville, ou les fait tous ressortir — bascule
// sur l'état ACTUEL (des villageois déjà dedans ? on vide ; sinon on
// remplit) plutôt que deux boutons séparés. C'est le geste d'urgence qui
// remplace le clic villageois+CV retiré de handleTap (voir 09-entree.js) :
// il ne doit pas exiger de sélectionner qui que ce soit sous le feu.
function toggleVillageoisAbri(){
  const tcs=G.buildings.filter(b=>estLocal(b)&&b.type===BT.TC&&!b.constructing);
  if(!tcs.length){ notify('Aucun Centre Ville','#e67e22'); return; }
  const dedans=G.units.filter(u=>u.state==='garrison'&&u.type===UT.VIL&&tcs.some(b=>b.id===u.target));
  if(dedans.length>0){
    let n=0;
    for(const b of tcs){
      const r=emettreOrdre(ordre(ORD.DEGARNIR,{bId:b.id}));
      if(r.ok) n+=r.n;
    }
    notify(`🔔 ${n} villageois sorti(s) du Centre Ville`,'#3498db'); buzz(8);
    syncShelterBtn(); return;
  }
  const vils=G.units.filter(u=>estLocal(u)&&u.type===UT.VIL&&u.state!=='garrison');
  if(!vils.length){ notify('Aucun villageois à mettre à l’abri','#e67e22'); return; }
  // Chaque villageois rejoint le CV le plus proche ENCORE DISPONIBLE : avec
  // plusieurs Centres Ville, ils se répartissent par proximité plutôt que
  // de tous viser le premier trouvé et laisser les autres vides.
  const restant=new Map(tcs.map(b=>[b.id, BDEF[b.type].garrisonCap-G.units.filter(u=>u.state==='garrison'&&u.target===b.id).length]));
  const parCV=new Map();
  for(const v of vils){
    let best=null,bd=Infinity;
    for(const b of tcs){
      if((restant.get(b.id)||0)<=0) continue;
      const d=Math.hypot(b.x-v.x,b.y-v.y);
      if(d<bd){bd=d;best=b;}
    }
    if(!best) continue; // toutes les garnisons visées sont déjà pleines
    restant.set(best.id,restant.get(best.id)-1);
    if(!parCV.has(best.id)) parCV.set(best.id,[]);
    parCV.get(best.id).push(v.id);
  }
  let n=0,refuses=0;
  for(const[bId,ids] of parCV){
    const r=emettreOrdre(ordre(ORD.GARNIR,{ids,bId}));
    if(r.ok){ n+=r.n; refuses+=r.refuses||0; }
  }
  if(n===0){ notify('🏰 Garnison pleine !','#e74c3c'); return; }
  notify(refuses>0?`🔔 ${n} villageois à l’abri (garnison pleine, ${refuses} dehors)`:`🔔 ${n} villageois à l’abri`,'#3498db');
  buzz(8);
  syncShelterBtn();
}
window.toggleVillageoisAbri=toggleVillageoisAbri;
function syncShelterBtn(){
  const el=document.getElementById('zshelter');
  if(!el) return;
  el.classList.toggle('active', G.units.some(u=>u.state==='garrison'&&u.type===UT.VIL&&estLocal(u)));
}

// Trouve le bâtiment du joueur endommagé le plus proche (hors chantier en
// cours, déjà géré par l'état 'build') — portée illimitée : un villageois
// inactif n'a par définition rien de mieux à faire ailleurs sur la carte.
function nearestDamagedBuilding(x,y){
  let best=null,bd=Infinity;
  for(const b of G.buildings){
    if(!estLocal(b)||b.constructing||b.hp>=b.maxHp) continue;
    const dx=b.x-x,dy=b.y-y,d2=dx*dx+dy*dy;
    if(d2<bd){bd=d2;best=b;}
  }
  return best;
}

// ── AFFICHAGE DE LA DIFFICULTÉ EN JEU ─────────────────────
function applyDifficultyBadge(){
  const el=document.getElementById('wdiff');
  if(!el) return;
  const d=DIFFS[G.difficulty]||DIFFS.normal;
  el.textContent=d.ico;
  el.title='Difficulté : '+d.nom;
}

// ── NOTIFICATIONS ─────────────────────────────────────────
// Alerte d'attaque : notification cliquable qui recentre la vue
let _lastAlert=0;
function alertAttack(x,y){
  const t=G.gameTime||0;
  if(t-_lastAlert<8) return; // pas de spam
  _lastAlert=t;
  buzz([12,60,12]); sfx('alert');
  const c=document.getElementById('notif');
  while(c.children.length>=NOTIF_MAX) c.removeChild(c.children[0]);
  const el=document.createElement('div');
  el.className='nmsg'; el.style.color='#e74c3c'; el.style.borderColor='#e74c3c';
  el.style.cursor='pointer';
  el.textContent='⚠️ Base attaquée — toucher pour voir';
  el.addEventListener('click',()=>{
    camCenterOn(x,y);
    el.remove();
  });
  c.appendChild(el);
  setTimeout(()=>el.remove(),5000);
}

// Retour haptique léger (mobile). Point d'entrée UNIQUE de toute vibration
// du jeu (une trentaine d'appels dans tout le code) : VIBR.on (menu Options,
// voir toggleVibr() plus bas) suffit donc à tout couper d'un coup, sans
// toucher aucun appelant.
function buzz(ms){ if(!VIBR.on) return; try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }


// Plafond de toasts simultanés : une rafale (siège qui rase plusieurs
// bâtiments d'un coup, chacun avec son propre notify()) ne doit pas empiler
// une colonne sans fin par-dessus la carte — on ne garde que les plus
// récents, les autres disparaissent immédiatement plutôt que d'attendre
// leur tour derrière le plafond CSS de #notif (voir index.html).
const NOTIF_MAX=5;
function notify(msg,col='#f1c40f',wide=false){
  if(col==='#e74c3c') sfx('error');
  const c=document.getElementById('notif');
  while(c.children.length>=NOTIF_MAX) c.removeChild(c.children[0]);
  const el=document.createElement('div');
  el.className='nmsg'+(wide?' wide':''); el.style.color=col; el.style.borderColor=col;
  el.textContent=msg; c.appendChild(el);
  setTimeout(()=>el.remove(),wide?4600:2800);
}
// Indice contextuel affiché UNE SEULE FOIS par partie (G.hints), au moment
// où le système qu'il présente devient concrètement disponible — bien plus
// efficace qu'un tutoriel figé de 7 étapes qui les évoquerait tous d'un
// coup avant même le premier villageois. Voir doBuild/updateAgeUp pour les
// points de déclenchement.
function hintOnce(key,msg,col){
  if(!G.hints) G.hints=new Set();
  if(G.hints.has(key)) return;
  G.hints.add(key);
  notify(msg,col||'#f0c040',true);
}

// Fait clignoter en rouge les ressources manquantes dans la barre du haut —
// feedback immédiat sur QUOI manque, en plus du message texte générique.
function flashResources(cost){
  for(const r of Object.keys(cost||{})){
    const el=document.getElementById('ri-'+r);
    if(!el) continue;
    el.classList.remove('insuff');
    void el.offsetWidth; // reflow : relance l'animation même si déjà en cours
    el.classList.add('insuff');
    clearTimeout(el._insuffT);
    el._insuffT=setTimeout(()=>el.classList.remove('insuff'),820); // durée de resFlash (2×.4s)
  }
}

// Grande bannière centrale (annonces majeures)
function bigBanner(txt){
  const b=document.getElementById('bigbanner');
  b.textContent=txt;
  b.style.animation='none';
  void b.offsetWidth; // reflow
  b.style.animation='bannerflash 2.4s forwards';
}

// ═══════════════════════════════════════════════════════════
//  SUCCÈS & BILAN DE PARTIE
// ═══════════════════════════════════════════════════════════
// Les compteurs vivent dans G.stats (remis à zéro à chaque partie), les
// succès débloqués dans un profil persistant séparé : une victoire acquise
// reste acquise même après une défaite, un rechargement ou un changement de
// difficulté.
const PROFILE_KEY='adc_profile_v1';
let PROFILE={ unlocked:[], games:0, wins:0, bestWave:0 };
// Chargement initial : storageLoad() suit déjà la même cascade Drive → Canvas
// → localStorage que la sauvegarde de partie (voir plus bas dans le fichier),
// mais tant que le joueur ne s'est pas connecté à Google (cas du tout premier
// appel, avant même que le SDK Google ne soit chargé) elle retombe sans délai
// sur localStorage — aucun ralentissement au démarrage pour qui ne l'utilise
// jamais.
async function loadProfile(){
  try{
    const p=await storageLoad(PROFILE_KEY);
    if(p){
      PROFILE={ unlocked:Array.isArray(p.unlocked)?p.unlocked:[],
                games:p.games||0, wins:p.wins||0, bestWave:p.bestWave||0 };
    }
  }catch(e){}
}
// Écriture asynchrone (Drive quand connecté, sinon repli local automatique) :
// un garde anti-chevauchement rejoue le dernier appel une fois l'écriture en
// cours terminée plutôt que de laisser deux requêtes Drive se doubler et
// risquer qu'une réponse tardive écrase un déblocage plus récent.
let _profilSauveEnCours=false, _profilSauveEnAttente=false;
function saveProfile(){
  try{ localStorage.setItem(PROFILE_KEY,JSON.stringify(PROFILE)); }catch(e){}
  if(_profilSauveEnCours){ _profilSauveEnAttente=true; return; }
  _profilSauveEnCours=true;
  storageSave(PROFILE,PROFILE_KEY).catch(()=>{}).then(()=>{
    _profilSauveEnCours=false;
    if(_profilSauveEnAttente){ _profilSauveEnAttente=false; saveProfile(); }
  });
}
// Appelée juste après une connexion Google réussie : fusionne le profil
// Drive (parties jouées sur un autre appareil) avec celui déjà en mémoire au
// lieu de l'écraser dans un sens ou l'autre — un succès débloqué localement
// avant la toute première connexion ne doit jamais disparaître, et
// inversement pour un succès débloqué ailleurs.
async function syncProfilAvecDrive(){
  try{
    const cloud=await driveLoad(PROFILE_KEY+'.json');
    if(cloud){
      const fusion=new Set([...(PROFILE.unlocked||[]), ...(Array.isArray(cloud.unlocked)?cloud.unlocked:[])]);
      PROFILE={
        unlocked:[...fusion],
        games:Math.max(PROFILE.games||0, cloud.games||0),
        wins:Math.max(PROFILE.wins||0, cloud.wins||0),
        bestWave:Math.max(PROFILE.bestWave||0, cloud.bestWave||0),
      };
      refreshAchCount();
      if(document.getElementById('achpanel').style.display==='flex') openAch();
    }
  }catch(e){ console.warn('Synchronisation des succès Drive échouée',e); }
  saveProfile(); // republie le résultat fusionné (utile côté Drive si le profil local était en avance)
}

// Chaque succès porte sa propre condition, évaluée contre un contexte unique
// (compteurs de la partie + issue + profil). Aucune n'est câblée ailleurs
// dans le code : ajouter un succès se fait entièrement ici.
const ACH = [
  { id:'first_blood', ico:'⚔️',  nom:'Premier Sang',       desc:'Abattre 10 ennemis.',                         test:(s)=>s.killed>=10 },
  { id:'butcher',     ico:'💀',  nom:'Boucher',            desc:'Abattre 250 ennemis en une partie.',          test:(s)=>s.killed>=250 },
  { id:'builder',     ico:'🏗️',  nom:'Bâtisseur',          desc:'Achever 30 bâtiments en une partie.',         test:(s)=>s.built>=30 },
  { id:'metropolis',  ico:'🏙️',  nom:'Métropole',          desc:'Atteindre 60 de population.',                 test:(s)=>s.peakPop>=60 },
  { id:'imperial',    ico:'👑',  nom:"Âge d'Or",           desc:"Atteindre l'Âge Impérial.",                   test:(s,c)=>c.age>=3 },
  { id:'lumberjack',  ico:'🪵',  nom:'Scieur',             desc:'Récolter 5 000 de bois en une partie.',       test:(s)=>s.gathered.wood>=5000 },
  { id:'croesus',     ico:'💰',  nom:'Crésus',             desc:"Récolter 3 000 d'or en une partie.",          test:(s)=>s.gathered.gold>=3000 },
  { id:'quarryman',   ico:'🪨',  nom:'Carrier',            desc:'Récolter 2 500 de pierre en une partie.',     test:(s)=>s.gathered.stone>=2500 },
  { id:'farmer',      ico:'🌾',  nom:'Grenier Plein',      desc:'Exploiter 12 fermes en même temps.',          test:(s)=>s.peakFarms>=12 },
  { id:'warlord',     ico:'🎺',  nom:"Chef de Guerre",     desc:'Aligner 40 unités militaires simultanément.', test:(s)=>s.peakMil>=40 },
  { id:'scholar',     ico:'🎓',  nom:'Érudit',             desc:'Terminer les 9 recherches.',                  test:(s)=>s.research>=9 },
  { id:'rampart',     ico:'🧱',  nom:'Rempart',            desc:'Poser 50 sections de mur.',                   test:(s)=>s.wallsBuilt>=50 },
  { id:'slayer',      ico:'🐉',  nom:'Tueur de Seigneurs', desc:'Abattre un Seigneur de Guerre.',              test:(s)=>s.bossKilled>=1 },
  { id:'siegemaster', ico:'💥',  nom:'Assiégeur',          desc:'Détruire 25 bâtiments ennemis.',              test:(s)=>s.bldDestroyed>=25 },
  { id:'cleaner',     ico:'🏆',  nom:'Nettoyeur',          desc:"Nettoyer entièrement un point d'intérêt.",    test:(s)=>s.campsCleared>=1 },
  { id:'survivor',    ico:'🛡️',  nom:'Survivant',          desc:'Remporter une partie en mode Survie.',        test:(s,c)=>c.won&&c.gmode==='survival' },
  { id:'conqueror',   ico:'🏴',  nom:'Conquérant',         desc:'Raser le Centre Ville adverse en Conquête.',  test:(s,c)=>c.won&&c.gmode!=='survival' },
  { id:'blitz',       ico:'⚡',  nom:'Guerre Éclair',      desc:'Gagner une Conquête en moins de 25 minutes.', test:(s,c)=>c.won&&c.gmode!=='survival'&&c.time<1500 },
  { id:'flawless',    ico:'✨',  nom:'Inébranlable',       desc:'Gagner sans perdre un seul bâtiment.',        test:(s,c)=>c.won&&s.bldLost===0 },
  { id:'tactician',   ico:'🔥',  nom:'Tacticien',          desc:'Gagner en difficulté Difficile.',             test:(s,c)=>c.won&&c.diff==='hard' },
  { id:'legend',      ico:'☠️',  nom:'Légende',            desc:'Gagner en difficulté Brutal.',                test:(s,c)=>c.won&&c.diff==='brutal' },
  { id:'veteran',     ico:'🎖️',  nom:'Vétéran',            desc:'Terminer 10 parties.',                        test:(s,c)=>c.games>=10 },
  { id:'reliquaire',  ico:'🏺',  nom:'Reliquaire',         desc:'Mettre 3 reliques à l\'abri en une partie.',  test:(s,c)=>c.relicsBanked>=3 },
  { id:'posterite',   ico:'🏛️',  nom:'Postérité',          desc:'Achever une Merveille et la garder debout.',  test:(s,c)=>c.merveille },
  { id:'legendaire',  ico:'⭐',  nom:'Légendaire',         desc:'Former un Héros de civilisation.',            test:(s,c)=>c.heroTrained },
  { id:'chasseur',    ico:'🏹',  nom:'Chasseur',           desc:'Abattre 10 animaux sauvages en une partie.',  test:(s)=>s.wildlifeHunted>=10 },
  { id:'negociant',   ico:'🐫',  nom:'Négociant',          desc:'Réaliser 20 opérations commerciales en une partie.', test:(s)=>s.tradesDone>=20 },
  { id:'forteresse',  ico:'🏰',  nom:'Forteresse',         desc:'Mettre 15 unités à l\'abri en garnison en une partie.', test:(s)=>s.garrisonUses>=15 },
  { id:'elite_unit',  ico:'⭐',  nom:'Aguerrie',           desc:'Faire passer une unité au rang Élite (8 victoires).', test:(s)=>!!s.hadEliteUnit },
];

function achContext(won){
  const mo=moi();
  return { won:!!won, gmode:G.gmode, diff:G.difficulty, age:G.age,
           wave:G.wave, time:G.gameTime||0, games:PROFILE.games,
           merveille:!!(mo&&mo.merveilleAchevee), heroTrained:!!(mo&&mo.heroTrained),
           relicsBanked:(G.relics||[]).filter(r=>r.bankedBy===G.me).length };
}

// Évalue tous les succès non encore acquis. Renvoie ceux qui viennent d'être
// débloqués, pour que l'appelant décide de l'affichage (bandeau en cours de
// partie, liste sur l'écran de fin).
function checkAchievements(won){
  if(!G||!G.stats) return [];
  const ctx=achContext(won);
  const fresh=[];
  for(const a of ACH){
    if(PROFILE.unlocked.includes(a.id)) continue;
    let ok=false;
    try{ ok=!!a.test(G.stats,ctx); }catch(e){}
    if(ok){ PROFILE.unlocked.push(a.id); fresh.push(a); }
  }
  if(fresh.length){
    saveProfile();
    refreshAchCount();
    if(!won) for(const a of fresh) achToast(a); // en fin de partie, l'écran de bilan s'en charge
  }
  return fresh;
}

// Bandeau discret en haut de l'écran quand un succès tombe en pleine partie.
function achToast(a){
  const c=document.getElementById('achpop');
  if(!c) return;
  const el=document.createElement('div');
  el.className='achtoast';
  el.innerHTML=`<span class="ti">${a.ico}</span><span><span class="tt">Succès débloqué</span><br><span class="tn">${a.nom}</span></span>`;
  c.appendChild(el);
  sfx('age'); buzz([8,40,8]);
  setTimeout(()=>el.remove(),4200);
}

function refreshAchCount(){
  const txt=`${PROFILE.unlocked.length}/${ACH.length}`;
  for(const id of ['achcount','achcount2']){
    const el=document.getElementById(id);
    if(el) el.textContent=txt;
  }
}

function openAch(){
  const list=document.getElementById('achlist');
  const prog=document.getElementById('achprog');
  if(!list) return;
  prog.innerHTML=`<b style="color:var(--gold-l)">${PROFILE.unlocked.length}</b> / ${ACH.length} débloqués `
    +`&nbsp;·&nbsp; ${PROFILE.games} partie${PROFILE.games>1?'s':''} · ${PROFILE.wins} victoire${PROFILE.wins>1?'s':''}`;
  // Acquis en tête : la progression se lit d'un coup d'œil sans dérouler.
  const sorted=[...ACH].sort((a,b)=>(PROFILE.unlocked.includes(b.id)?1:0)-(PROFILE.unlocked.includes(a.id)?1:0));
  list.innerHTML=sorted.map(a=>{
    const got=PROFILE.unlocked.includes(a.id);
    return `<div class="aitem${got?' got':''}"><span class="aico">${a.ico}</span>`
      +`<span class="atxt"><span class="anom">${a.nom}</span><span class="adesc">${a.desc}</span></span></div>`;
  }).join('');
  document.getElementById('achpanel').style.display='flex';
}
function closeAch(){ document.getElementById('achpanel').style.display='none'; }
window.openAch=openAch; window.closeAch=closeAch;

// ── PANNEAU DIPLOMATIE (mode 2 rivaux) ──────────────────────
// Un rival IA peut être allié le temps d'une trêve — les deux camps
// cessent de se combattre (voir estHostile, purement basé sur l'équipe) —
// mais l'IA peut y mettre fin d'elle-même si elle prend nettement le
// dessus (voir updateUneIA). Sans intérêt en Survie/Conquête à un seul
// rival (une seule cible possible) ni en coop (l'allié y est déjà humain) :
// le bouton du menu pause ne s'affiche que si ≥2 rivaux IA existent.
function openDiplo(){
  const list=document.getElementById('diplolist');
  if(!list) return;
  list.innerHTML='';
  const rivaux=factionsIA();
  if(!rivaux.length){
    list.innerHTML='<p class="classub">Aucun rival dans ce mode.</p>';
  }
  for(const a of rivaux){
    const allie=a.equipe===moi().equipe;
    const row=document.createElement('div');
    row.className='diprow'+(allie?' allie':'');
    const etat=a.vaincu?'Vaincu':allie?'🤝 Allié — peut trahir si elle prend le dessus':'⚔️ Hostile';
    row.innerHTML=`<div><div class="dipnom">${a.nom}</div><div class="dipetat">${etat}</div></div>`;
    if(!a.vaincu){
      const btn=document.createElement('button');
      btn.className='dipbtn'+(allie?' rompre':'');
      btn.textContent=allie?'Rompre':'Proposer une alliance';
      btn.onclick=()=>diplomatieAction(a.id,allie?'rompre':'proposer');
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  document.getElementById('diplopanel').style.display='flex';
}
function closeDiplo(){ document.getElementById('diplopanel').style.display='none'; }
window.openDiplo=openDiplo; window.closeDiplo=closeDiplo;

function diplomatieAction(cibleId,action){
  const r=emettreOrdre(ordre(ORD.DIPLOMATIE,{cibleId,action}));
  if(!r.ok){
    if(r.raison==='refuse') notify(`🤝 ${r.nom||'Le rival'} refuse votre alliance — trop confiant en ses propres forces.`,'#e67e22');
    else notify('Action diplomatique impossible.','#e74c3c');
    return;
  }
  notify(action==='proposer'?`🤝 Alliance conclue avec ${r.nom} !`:`⚔️ Alliance rompue avec ${r.nom}.`,
         action==='proposer'?'#2ecc71':'#e67e22');
  buzz(8);
  openDiplo(); // rafraîchit la liste tout de suite plutôt qu'à la prochaine ouverture
}
// Bouton du menu pause : visible seulement s'il y a au moins un rival IA
// vivant à qui parler (donc jamais en Survie, jamais après leur défaite).
function updateDiploBtn(){
  const btn=document.getElementById('diplobtn');
  if(!btn) return;
  btn.style.display=(G.running&&factionsIA().some(a=>!a.vaincu))?'block':'none';
}

// ── PANNEAU DES CONTRÔLES ──────────────────────────────────
// Contenu statique (pas de PROFILE à charger, contrairement aux Succès) —
// construit une seule fois, à l'ouverture, pour rester bon marché.
const CONTROLES = [
  { sec:'Souris / tactile' },
  { key:'Clic',          desc:'Sélectionner une unité, un bâtiment, ou donner un ordre (déplacement, récolte, attaque) à la sélection en cours.' },
  { key:'Glisser',        desc:'Rectangle de sélection — plusieurs unités à la fois (priorité aux unités militaires si le rectangle mélange les deux).' },
  { key:'Double-clic',    desc:'Sur une unité : sélectionne toutes les unités du même type visibles à l’écran. Dans le vide : désélectionne.' },
  { key:'Clic droit / Échap', desc:'Annule la construction ou la marche d’attaque en cours, sinon désélectionne.' },
  { key:'Molette / pincement', desc:'Zoom avant/arrière.' },
  { key:'Glisser le fond', desc:'Déplace la caméra (sauf en pose de bâtiment, voir Construction ci-dessous).' },
  { sec:'Construction' },
  { key:'Tapez',   desc:'Positionne l’aperçu. À la souris, ce même geste construit directement (le survol l’a déjà montré avant le clic) ; au doigt, retouchez le même endroit ou validez avec ✓.' },
  { key:'Glissez',  desc:'Déplace l’aperçu sans faire bouger la caméra — pour un Mur, trace toute une ligne (droite ou en diagonale) en un seul geste.' },
  { key:'✓ / ✕',    desc:'Valide ou annule la pose en cours.' },
  { key:'📌',        desc:'Épingle le type de bâtiment choisi : reste en pose après chaque construction pour en aligner plusieurs sans rouvrir le menu.' },
  { key:'🔧',        desc:'Réparation automatique — les villageois inactifs réparent seuls les bâtiments endommagés.' },
  { key:'🔔',        desc:'Fait rentrer tous les villageois en garnison au Centre Ville (ou les fait ressortir).' },
  { sec:'Clavier — caméra' },
  { key:'Flèches',     desc:'Déplace la caméra (maintenir). Deux flèches à la fois pour la diagonale.' },
  { key:'H',           desc:'Recentre la caméra sur votre Centre Ville.' },
  { key:'.',           desc:'Sélectionne le prochain villageois inactif et va le voir. Appuis successifs : on passe au suivant. (Le badge 👷 en haut à droite fait la même chose.)' },
  { sec:'Clavier — ordres' },
  { key:'A',           desc:'Marche d’attaque : vos unités engageront tout ennemi croisé en chemin.' },
  { key:'S',           desc:'Stop — interrompt l’ordre en cours de la sélection.' },
  { key:'C',           desc:'Change la posture des unités militaires sélectionnées (Agressif / Défensif / Tenir).' },
  { key:'B',           desc:'Ouvre le menu de construction (sélectionne un villageois au besoin).' },
  { key:'Q W E R',     desc:'Bâtiment sélectionné : déclenche ses quatre premières actions (former une unité, améliorer…).' },
  { sec:'Clavier — sélection' },
  { key:'Échap',       desc:'Annule / désélectionne.' },
  { key:'Ctrl + 1-9',  desc:'Assigne la sélection courante au groupe de contrôle correspondant. Au doigt : maintenez la case numérotée correspondante (bas de l’écran) avec une sélection active.' },
  { key:'1-9',         desc:'Rappelle ce groupe de contrôle. Un second appui rapide sur le même chiffre recentre la caméra dessus. Au doigt : touchez simplement la case.' },
  { key:'Alt + 1-4',   desc:'En partie en ligne : envoie une émotion rapide à votre allié ou adversaire.' },
];
function openControls(){
  const list=document.getElementById('ctrllist');
  if(!list) return;
  list.innerHTML=CONTROLES.map(c=>c.sec
    ? `<div class="ctrlsec">${c.sec}</div>`
    : `<div class="ctrlrow"><span class="ckey">${c.key}</span><span class="cdesc">${c.desc}</span></div>`
  ).join('');
  document.getElementById('controlspanel').style.display='flex';
}
function closeControls(){ document.getElementById('controlspanel').style.display='none'; }
window.openControls=openControls; window.closeControls=closeControls;

// ── PANNEAU DU CLASSEMENT ──────────────────────────────────
// Lecture seule ici : l'ENVOI d'un score se fait tout seul en fin de partie
// (voir soumettreClassement). Nécessite d'être connecté (même compte que le
// multijoueur, voir mpConnexion) — sans quoi ce panneau se contente
// d'expliquer comment l'activer plutôt que de rester vide sans explication.
async function openClassement(){
  const panel=document.getElementById('classementpanel');
  const list=document.getElementById('clalist');
  if(!panel||!list) return;
  panel.style.display='flex';
  if(!mpDispo()){
    list.innerHTML='<p class="classub">Classement indisponible — multijoueur non configuré (voir README).</p>';
    return;
  }
  if(!_mpEtat.uid){
    // Le bouton de connexion vit dans le panneau "Jouer avec un ami" (même
    // authentification Firebase, voir README) mais le classement N'EST PAS
    // réservé au multijoueur : une victoire solo contre l'IA y figure tout
    // autant qu'une victoire en ligne — d'où la précision ci-dessous.
    list.innerHTML='<p class="classub">Connectez-vous depuis le bouton <b>👥 Jouer avec un ami</b> pour voir le classement et y figurer (c\'est juste l\'écran où se fait la connexion : vos parties SOLO comptent tout autant que le 1v1 réel).</p>';
    return;
  }
  list.innerHTML='<p class="classub">Chargement…</p>';
  // Une section par mode (hors Survie, à part) : les fusionner en un seul
  // "Conquête" mélangeait des victoires qui ne se jouent pas à la même
  // vitesse (solo vs 1 IA, 2 Rivaux à trois camps, 2v1 Coop) — voir
  // CLASSEMENT_CAT. Solo et en ligne comptent pareil dans chaque section.
  const catsConquete=['conquest','conquest2','coop2v1'];
  const [survie,...conquetes]=await Promise.all([
    window.MP.classementLire('survie',10),
    ...catsConquete.map(m=>window.MP.classementLire(CLASSEMENT_CAT[m],10)),
  ]);
  const ligne=(r,i,fmt)=>`<div class="clarow${r.uid===_mpEtat.uid?' moi':''}">`
    +`<span class="clarang">${i+1}</span><span class="clanom">${r.nom||'Joueur'}</span>`
    +`<span class="claval">${fmt(r.valeur)}</span></div>`;
  const section=(titre,rows,fmt)=>`<div class="classec">${titre}</div>`
    +(rows.length?rows.map((r,i)=>ligne(r,i,fmt)).join(''):'<p class="classub">Aucun score pour l\'instant — soyez le premier !</p>');
  list.innerHTML=
    section('🛡️ Survie — meilleure vague',survie,v=>`Vague ${v}`)+
    catsConquete.map((m,i)=>section(`${MODES[m].ico} ${MODES[m].nom} — victoire la plus rapide`,conquetes[i],v=>fmtDuration(v))).join('');
}
function closeClassement(){ document.getElementById('classementpanel').style.display='none'; }
window.openClassement=openClassement; window.closeClassement=closeClassement;

// ── TUTORIEL PAS À PAS (première partie) ────────────────────
// Ne se déclenche qu'au tout premier lancement en solo (jamais en ligne :
// contexte partagé avec un allié/adversaire, pas le lieu pour un didacticiel
// individuel). Chaque étape a sa propre condition d'achèvement, vérifiée par
// un battement léger (700 ms, pas à chaque image) pendant que le panneau est
// affiché — passe automatiquement à la suivante dès que le joueur a
// réellement fait le geste, plutôt que d'attendre un simple clic "Suivant".
const TUTO_STEPS = [
  { txt:'Bienvenue à Âge des Conquêtes ! Sélectionnez un de vos 3 villageois en tapant dessus.',
    fait:()=>G.units.some(u=>estLocal(u)&&u.type===UT.VIL&&estSel(u.id)) },
  { txt:'Bien joué ! Tapez maintenant un arbre, un gisement de pierre/or ou un buisson de baies proche pour l\'envoyer récolter.',
    fait:()=>G.units.some(u=>estLocal(u)&&(u.state==='gather'||u.state==='farm')) },
  { txt:'Ouvrez le menu de construction (icône 🔨 en bas à gauche) et posez une Maison — chaque Maison augmente votre population maximale.',
    fait:()=>G.buildings.some(b=>estLocal(b)&&b.type===BT.HOUSE) },
  { txt:'Sélectionnez votre Centre Ville et formez un nouveau Villageois pour accélérer votre économie.',
    fait:()=>popDe(G.me)>3 },
  { txt:'Construisez une Caserne pour lever votre première armée.',
    fait:()=>G.buildings.some(b=>estLocal(b)&&b.type===BT.BARRACKS) },
  { txt:'Accumulez de la nourriture puis avancez d\'Âge avec le bouton en haut de l\'écran — de nouvelles unités et bonus vous attendent.',
    fait:()=>ageOf(G.me)>0 },
  { txt:'Vous connaissez les bases ! Continuez à récolter, construire et monter en puissance. Bonne chance, seigneur.',
    fait:null }, // dernier pas : seul le bouton "Terminer" le ferme
];
let _tutoIdx=-1, _tutoActif=false, _tutoTimer=null;

function tutoDoitDemarrer(){
  if(typeof RESEAU!=='undefined'&&RESEAU.actif) return false;
  if((PROFILE.games||0)>0) return false;
  try{ if(localStorage.getItem('adc_tuto_vu')) return false; }catch(e){}
  return true;
}
function tutoDemarrer(){
  if(!tutoDoitDemarrer()) return;
  try{ localStorage.setItem('adc_tuto_vu','1'); }catch(e){}
  _tutoActif=true; _tutoIdx=0;
  tutoAfficher();
  if(_tutoTimer) clearInterval(_tutoTimer);
  _tutoTimer=setInterval(()=>{
    if(!_tutoActif||_tutoIdx<0||_tutoIdx>=TUTO_STEPS.length){ return; }
    if(!G.running){ tutoArreter(); return; }
    const etape=TUTO_STEPS[_tutoIdx];
    if(etape.fait&&etape.fait()) tutoSuivant();
  },700);
}
function tutoAfficher(){
  const panel=document.getElementById('tutopanel');
  if(!panel||_tutoIdx<0||_tutoIdx>=TUTO_STEPS.length) return;
  const etape=TUTO_STEPS[_tutoIdx];
  const dernier=_tutoIdx===TUTO_STEPS.length-1;
  panel.innerHTML=
    `<div class="tuto-titre">📖 Tutoriel (${_tutoIdx+1}/${TUTO_STEPS.length})</div>`+
    `<div class="tuto-txt">${etape.txt}</div>`+
    `<div class="tuto-dots">${TUTO_STEPS.map((_,i)=>`<span class="tuto-dot${i<=_tutoIdx?' on':''}"></span>`).join('')}</div>`+
    `<div class="tuto-btns">`+
      (dernier?`<button onclick="tutoArreter()">Terminer</button>`
              :`<button onclick="tutoArreter()">Passer</button><button onclick="tutoSuivant()">Suivant</button>`)+
    `</div>`;
  panel.style.display='flex';
}
function tutoSuivant(){
  if(_tutoIdx>=TUTO_STEPS.length-1){ tutoArreter(); return; }
  _tutoIdx++;
  tutoAfficher();
  buzz(6);
}
function tutoArreter(){
  _tutoActif=false;
  if(_tutoTimer){ clearInterval(_tutoTimer); _tutoTimer=null; }
  const panel=document.getElementById('tutopanel');
  if(panel) panel.style.display='none';
}
window.tutoSuivant=tutoSuivant; window.tutoArreter=tutoArreter;

// ── BILAN DE FIN DE PARTIE ────────────────────────────────
function fmtDuration(sec){
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m>=60?`${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`:`${m}m ${String(s).padStart(2,'0')}s`;
}
function statCell(ico,val,label){
  return `<div class="statcell"><div class="sv">${ico} ${val}</div><div class="sl">${label}</div></div>`;
}
// Bloc HTML commun à la victoire et à la défaite : mêmes chiffres, mêmes
// unités, quelle que soit l'issue — on ne cache pas les mauvaises statistiques.
function statsBlock(){
  const s=G.stats, g=s.gathered;
  const total=g.food+g.wood+g.stone+g.gold;
  return `
    <div class="statsec">⚔️ Guerre</div>
    <div class="statgrid">
      ${statCell('💀',s.killed,'Ennemis abattus')}
      ${statCell('🪦',s.lost,'Unités perdues')}
      ${statCell('💥',s.bldDestroyed,'Bâtiments rasés')}
      ${statCell('🔥',s.bldLost,'Bâtiments perdus')}
    </div>
    <div class="statsec">🏗️ Empire</div>
    <div class="statgrid">
      ${statCell('🏛️',s.built,'Bâtiments bâtis')}
      ${statCell('👥',s.peakPop,'Population max')}
      ${statCell('⚔️',s.peakMil,'Armée max')}
      ${statCell('🔬',s.research+'/9','Recherches')}
    </div>
    <div class="statsec">⛏️ Récolte — ${total.toLocaleString('fr-FR')} au total</div>
    <div class="statgrid">
      ${statCell('🍖',g.food.toLocaleString('fr-FR'),'Nourriture')}
      ${statCell('🪵',g.wood.toLocaleString('fr-FR'),'Bois')}
      ${statCell('🪨',g.stone.toLocaleString('fr-FR'),'Pierre')}
      ${statCell('💰',g.gold.toLocaleString('fr-FR'),'Or')}
    </div>`;
}
// Liste des succès tombés sur cette partie, affichée sous le bilan.
function freshAchBlock(fresh){
  if(!fresh.length) return '';
  return `<div class="statsec">🏆 Succès débloqués</div>`
    +`<div style="display:flex;flex-direction:column;gap:6px;width:100%;max-width:340px;">`
    +fresh.map(a=>`<div class="aitem got"><span class="aico">${a.ico}</span>`
      +`<span class="atxt"><span class="anom">${a.nom}</span><span class="adesc">${a.desc}</span></span></div>`).join('')
    +`</div>`;
}
// Clôture commune : incrémente le profil persistant UNE seule fois par
// partie (le drapeau _ended évite qu'une victoire suivie d'un « continuer »
// puis d'une défaite ne compte deux parties), puis valide les succès.
function finishGame(won){
  if(G._ended) return [];
  G._ended=true;
  effacerRejoinEnLigne();
  PROFILE.games++;
  if(won) PROFILE.wins++;
  PROFILE.bestWave=Math.max(PROFILE.bestWave,G.wave||0);
  saveProfile();
  soumettreClassement(won);
  const fresh=checkAchievements(won);
  refreshAchCount();
  return fresh;
}

// Classement en ligne (léger) : Survie => meilleure vague atteinte (gagnée
// OU perdue — le mode infini après victoire continue de compter) ; tout
// autre mode => durée d'une VICTOIRE seulement (une défaite n'a pas de temps
// à faire valoir). Nécessite d'être connecté au multijoueur (voir
// window.MP.classementEnvoyer) ; échec ou non-connexion = silencieux, la fin
// de partie ne dépend jamais de ce petit plus.
// Une catégorie PAR MODE (et non un unique "conquete" fourre-tout) : une
// victoire solo contre 1 IA, une victoire à trois camps hostiles en 2
// Rivaux et une victoire en 2v1 Coop ne se jouent pas à la même vitesse —
// les mélanger rendait la comparaison entre amis trompeuse. Solo ou en
// ligne compte pareil : rien ici ne distingue une partie 1v1 réelle d'une
// partie contre l'IA, le classement n'a jamais été réservé au multijoueur.
const CLASSEMENT_CAT={conquest:'conquete', conquest2:'conquete2', coop2v1:'coop2v1'};
function soumettreClassement(won){
  if(!mpDispo()||!window.MP.classementEnvoyer) return;
  if(G.gmode==='survival'){
    window.MP.classementEnvoyer('survie',G.wave||0).catch(()=>{});
  } else if(won){
    const cat=CLASSEMENT_CAT[G.gmode]||'conquete';
    window.MP.classementEnvoyer(cat,Math.round(G.gameTime||0)).catch(()=>{});
  }
}

// ── VICTOIRE ──────────────────────────────────────────────
function showVictory(){
  G.running=false;
  envoyerBilanReseau();
  arreterVeilleReseau();
  const fresh=finishGame(true);
  const ov=document.getElementById('overlay');
  ov.style.display='flex';
  ov.classList.add('endscreen');
  // La Merveille prime sur l'exploit habituel du mode (vagues repoussées ou
  // Centre Ville rival abattu) : c'est elle qui a réellement tranché la partie.
  const exploit=moi()&&moi().merveilleAchevee
    ? `Votre Merveille est restée debout ${Math.round(MERVEILLE_WIN_TIME/60)} minutes après son achèvement. La postérité s'en souviendra.`
    : G.gmode!=='survival'
    ? `Le Centre Ville rival est tombé. La carte est à vous.`
    : `Vous avez repoussé ${G.targetWaves} vagues et bâti un empire légendaire !`;
  ov.innerHTML=`
    <div style="font-size:52px">👑</div>
    <h1>Victoire !</h1>
    <p>${exploit}<br>Âge atteint : <strong>${AGES[G.age].nom}</strong> · ${MODES[G.gmode].ico} ${MODES[G.gmode].nom} · ${DIFFS[G.difficulty].ico} ${DIFFS[G.difficulty].nom}</p>
    <p class="lore">Durée de la partie : ${fmtDuration(G.gameTime)}</p>
    ${statsBlock()}
    ${bilanDeuxColonnes()}
    ${freshAchBlock(fresh)}
    <button class="bigbtn" onclick="location.reload()">🔄 Nouvelle partie</button>
    ${G.gmode!=='survival'?'':`<button class="bigbtn" id="contBtn" style="background:linear-gradient(180deg,#1a4a2a,#0d2a18);color:#2ecc71;border:2px solid #2ecc71;" onclick="continuePlay()">⚔️ Continuer (sans fin)</button>`}
    <button class="bigbtn" onclick="openAch()" style="background:linear-gradient(180deg,#3a2a08,#1a1200);color:var(--gold-l);border:1.5px solid var(--gold-d);box-shadow:none;">🏆 Voir tous les succès</button>
  `;
  quitterSessionReseau(); // le bilan est rendu : plus rien a echanger
}
function continuePlay(){
  document.getElementById('overlay').style.display='none';
  G.targetWaves=9999; G.victory=false; G.running=true;
  G.lastTime=null;
  requestAnimationFrame(loop);
  notify('Mode infini activé — survivez le plus longtemps !','#f0c040');
}
window.continuePlay=continuePlay;

// ── GAME OVER ─────────────────────────────────────────────
function showGameOver(){
  G.running=false;
  envoyerBilanReseau();
  arreterVeilleReseau();
  const fresh=finishGame(false);
  const gagnantMerveille=factionsJouantes().find(f=>f.merveilleAchevee&&f.id!==G.me);
  const cause=gagnantMerveille
    ? `${gagnantMerveille.nom} a achevé sa Merveille et l'a gardée debout — la partie est terminée.`
    : G.gmode!=='survival'
    ? `Le seigneur rival a rasé votre Centre Ville.`
    : `Votre Centre Ville a été détruit lors de la vague ${G.wave}.`;
  document.getElementById('overlay').style.display='flex';
  document.getElementById('overlay').classList.add('endscreen');
  document.getElementById('overlay').innerHTML=`
    <div style="font-size:48px">💀</div>
    <h1>Défaite !</h1>
    <p>${cause}<br>Âge atteint : <strong>${AGES[G.age].nom}</strong> · ${MODES[G.gmode].ico} ${MODES[G.gmode].nom} · ${DIFFS[G.difficulty].ico} ${DIFFS[G.difficulty].nom}</p>
    <p class="lore">Durée de la partie : ${fmtDuration(G.gameTime)}</p>
    ${statsBlock()}
    ${bilanDeuxColonnes()}
    ${freshAchBlock(fresh)}
    <button class="bigbtn" onclick="location.reload()">🔄 Recommencer</button>
    <button class="bigbtn" onclick="openAch()" style="background:linear-gradient(180deg,#3a2a08,#1a1200);color:var(--gold-l);border:1.5px solid var(--gold-d);box-shadow:none;">🏆 Voir tous les succès</button>
  `;
  quitterSessionReseau(); // le bilan est rendu : plus rien a echanger
}

// ── VITESSE DE JEU ────────────────────────────────────────
function setSpeed(s){
  if(reseauActif()) s=1; // vitesse verrouillee en ligne : les deux camps doivent voir le meme temps
  s=Math.max(1,Math.min(2,s)); // x3 retiré (charge trop lourde à forte population) : x2 reste le plafond
  G.speed=s;
  document.querySelectorAll('.spd-btn').forEach(b=>{
    b.classList.toggle('on', +b.dataset.spd===s);
  });
}
window.setSpeed=setSpeed;

// ── AVANCEMENT D'ÂGE ──────────────────────────────────────
function tryAgeUp(){
  const next=AGES[G.age+1];
  const r=emettreOrdre(ordre(ORD.AGE,{}));
  if(!r.ok){
    if(r.raison==='max') notify('Âge maximum atteint !','#f0c040');
    else if(r.raison==='deja') notify('Avancement déjà en cours…','#f39c12');
    else if(r.raison==='tc') notify('Centre Ville requis !','#e74c3c');
    else if(r.raison==='ressources'&&next){
      notify(`${next.ico} ${next.nom} — Coût : ${fmtCost(next.cost)}`,'#e74c3c');
      notify(`Apporte : ${next.bonus}`,'#e8d5a0',true);
      flashResources(next.cost);
    }
    return;
  }
  notify(`${r.next.ico} Avancement vers ${r.next.nom}…`,'#3498db');
  notify(`Apporte : ${r.next.bonus}`,'#e8d5a0',true);
  refreshUI();
}
window.tryAgeUp=tryAgeUp;

function updateAgeBar(){
  setTxt('wtarget',G.targetWaves>=9999?'∞':G.targetWaves);
  if(G.ageUpQ){
    const pct=Math.round((1-G.ageUpQ.timer/G.ageUpQ.total)*100);
    setHtml('agebtn',`${iconImg('⏳',14)} ${iconImg(AGES[G.age+1].ico,14)} ${pct}%`);
    setCls('agebtn','');
    return;
  }
  if(G.age>=AGES.length-1){
    setHtml('agebtn',`${iconImg(AGES[G.age].ico,14)} ${AGES[G.age].nom}`);
    setCls('agebtn','maxage');
    return;
  }
  const next=AGES[G.age+1];
  const ready=canAfford(next.cost);
  setHtml('agebtn',`${iconImg(AGES[G.age].ico,14)} ${AGES[G.age].nom} → ${iconImg(next.ico,14)}`);
  setCls('agebtn',ready?'ready':'');
}

// ── ZOOM ──────────────────────────────────────────────────
let zoomLevel=2; // 0=éloigné, 1=normal, 2=rapproché (BASE_TILE = niveau 2)
const ZOOMS=[0.55,0.75,1.0];

// rescaleWorld() a disparu : les coordonnées monde sont désormais exprimées
// en unités BASE_TILE, constantes, et ne dépendent plus du zoom. Changer
// d'échelle ne touche donc plus une seule entité — seule la caméra (exprimée
// en pixels écran zoomés) est recalculée dans applyZoomToTile ci-dessous.
// C'est ce qui supprime toute une classe de bugs de dérive au zoom.

function clampCam(){
  // Bornes inchangées : la carte fait COLS*BASE_TILE unités-monde, soit
  // COLS*BASE_TILE*échelle === COLS*TILE pixels écran.
  G.cam.x=Math.max(0,Math.min(Math.max(0,COLS*TILE-W),G.cam.x));
  G.cam.y=Math.max(0,Math.min(Math.max(0,ROWS*TILE-gameH()),G.cam.y));
}

// Centre la caméra sur un point MONDE (unités BASE_TILE) : point de passage
// unique pour « aller à », qui applique l'échelle de zoom une seule fois.
function camCenterOn(wx,wy){
  const S=TILE/BASE_TILE;
  G.cam.x=wx*S-W/2;
  G.cam.y=wy*S-gameH()/2;
  clampCam();
}

// Régénération des sprites différée : pendant un pincement on se contente
// de redimensionner les sprites existants (fluide), on les regénère à la fin.
let _uiRefreshCd=0;
let _sprDirty=0;
function markSpritesDirty(){ _sprDirty=0.18; }
function updateSpriteRebuild(dt){
  // Une seule étape par IMAGE affichée, et non par pas de simulation : à la
  // vitesse ×3 la boucle appelle update() trois fois avant de rendre, ce qui
  // reconstituerait un gros bloc de travail dans la même image.
  if(_atlasEtapes){
    if(_atlasDerniereImage!==_frameId){ _atlasDerniereImage=_frameId; avancerAtlas(); }
    return;
  }
  if(_sprDirty<=0) return;
  _sprDirty-=dt;
  if(_sprDirty>0) return;
  const rung=sprRungFor(TILE);
  if(SPR.refT!==rung) demarrerAtlas(rung);
}

// ── ZOOM ──────────────────────────────────────────────────
// Source de vérité unique : TILE. Aucune échelle parallèle qui puisse dériver.
const TILE_MIN=Math.round(BASE_TILE*0.45);
const TILE_MAX=Math.round(BASE_TILE*1.7);

// ── BARREAUX D'ECHELLE DES SPRITES ──────────────────────────
// L'atlas n'est plus regenere pour le TILE exact mais pour le barreau le plus
// proche d'une echelle geometrique de raison 1,25 ancree sur BASE_TILE. Un
// cran de molette vaut ~12 % : sans quantification, chaque cran declenchait
// une regeneration complete. Entre deux barreaux, tout le rendu passe deja
// par le facteur k=TILE/SPR.refT (voir drawBuildings/drawNodes/drawUnits) et
// l'ecart residuel — au pire ~11 % sur des sprites generes en 3× puis lisses
// — ne se voit pas.
const SPR_RUNGS=(()=>{
  const a=[BASE_TILE];
  for(let t=BASE_TILE/1.25;t>TILE_MIN;t/=1.25) a.push(Math.round(t));
  for(let t=BASE_TILE*1.25;t<TILE_MAX;t*=1.25) a.push(Math.round(t));
  a.push(TILE_MIN,TILE_MAX);
  return [...new Set(a)].sort((x,y)=>x-y);
})();
function sprRungFor(t){
  t=Math.max(TILE_MIN,Math.min(TILE_MAX,t));
  let best=SPR_RUNGS[0], bd=Infinity;
  for(const r of SPR_RUNGS){ const d=Math.abs(Math.log(r/t)); if(d<bd){ bd=d; best=r; } }
  return best;
}

// Change la taille de tuile en gardant un point d'écran ancré sous le doigt.
function applyZoomToTile(targetT,anchorSX,anchorSY){
  const newT=Math.max(TILE_MIN,Math.min(TILE_MAX,Math.round(targetT)));
  if(newT===TILE) return false;
  if(anchorSX==null){ anchorSX=W/2; anchorSY=54+gameH()/2; }
  // Point monde visé, AVANT changement d'échelle. Aucune entité n'est
  // touchée : leurs coordonnées sont en unités BASE_TILE, invariantes.
  const w=sw(anchorSX,anchorSY);
  TILE=newT;
  // ce même point monde doit rester exactement sous le doigt après le zoom
  const S=TILE/BASE_TILE;
  G.cam.x=w.x*S-anchorSX;
  G.cam.y=w.y*S-(anchorSY-54);
  clampCam();
  markSpritesDirty();
  return true;
}

document.getElementById('zhome').addEventListener('click',()=>{
  const tc=G.buildings.find(b=>estLocal(b)&&b.type===BT.TC)||G.buildings.find(b=>estLocal(b));
  if(!tc){ notify('Aucun bâtiment','#e67e22'); return; }
  camCenterOn(tc.x,tc.y);
  buzz(8);
});
document.getElementById('zarmy').addEventListener('click',()=>{
  // state!=='garrison' : sans ce filtre, les défenseurs planqués dans une
  // Tour/un Château/le Centre Ville étaient aspirés dans la sélection (donc
  // comptés, invisibles, dans "N unités sélectionnées"), et un Stop/une
  // marche d'attaque lancée dessus les éjectait de la garnison en douce —
  // en contournant ORD.DEGARNIR et la reprise d'activité qui va avec.
  const army=G.units.filter(u=>estLocal(u)&&u.type!==UT.VIL&&u.state!=='garrison');
  if(!army.length){ notify('Aucune unité militaire','#e67e22'); return; }
  G.sel=army.map(u=>u.id); G.mode='select'; buzz(10);
  notify(`${army.length} unité${army.length>1?'s':''} sélectionnée${army.length>1?'s':''}`,'#e74c3c');
  refreshUI();
  // Centre la caméra comme zhome/le badge villageois inactif : sélectionner
  // une armée hors écran sans jamais la montrer laissait le joueur à l'aveugle.
  let sx=0,sy=0; for(const u of army){ sx+=u.x; sy+=u.y; }
  camCenterOn(sx/army.length, sy/army.length);
});
document.getElementById('deselbtn').addEventListener('click',()=>{
  clearSelection();
  notify('Sélection annulée','#95a5a6');
});
// Pas de boutons +/− dans le HUD : le zoom se fait à la molette ou au
// pincement, directement via applyZoomToTile (voir plus haut).

// Minimap navigation — un simple `click` forçait à taper case par case pour
// suivre un combat qui se déplace ; on glisse maintenant en continu, souris
// ou doigt, exactement comme sur la carte principale.
function minimapGoTo(clientX,clientY){
  const r=document.getElementById('minimap').getBoundingClientRect();
  // r.width / r.height, et non 88 en dur : la mini-carte est plus grande sur
  // écran large (voir @media), et un diviseur figé y aurait décalé la
  // navigation d'autant.
  const mx=(clientX-r.left)/r.width, my=(clientY-r.top)/r.height;
  camCenterOn(mx*COLS*BASE_TILE,my*ROWS*BASE_TILE);
}
(function(){
  const mmEl=document.getElementById('minimap');
  let dragging=false;
  mmEl.addEventListener('mousedown',e=>{ dragging=true; minimapGoTo(e.clientX,e.clientY); });
  window.addEventListener('mousemove',e=>{ if(dragging) minimapGoTo(e.clientX,e.clientY); });
  window.addEventListener('mouseup',()=>{ dragging=false; });
  mmEl.addEventListener('touchstart',e=>{ e.preventDefault(); dragging=true;
    const t=e.touches[0]; if(t) minimapGoTo(t.clientX,t.clientY);
  },{passive:false});
  mmEl.addEventListener('touchmove',e=>{ if(!dragging) return; e.preventDefault();
    const t=e.touches[0]; if(t) minimapGoTo(t.clientX,t.clientY);
  },{passive:false});
  mmEl.addEventListener('touchend',()=>{ dragging=false; });
  mmEl.addEventListener('touchcancel',()=>{ dragging=false; });
})();

// ── PAUSE ─────────────────────────────────────────────────
function openPause(){
  if(!G.running) return;
  // En ligne, ouvrir CE menu partage aussi la pause avec l'adversaire (voir
  // mpDemanderPause) : le panneau reste le meme (sauvegarde, son, abandon),
  // seule sa consequence reseau change. Si la partie est DEJA en pause (a
  // l'initiative de l'adversaire), on ouvre juste les reglages sans
  // consommer mon propre budget ni ré-annoncer une pause qui existe deja.
  if(reseauActif()&&!G.paused&&!mpDemanderPause()) return; // plus de pause disponible : le menu ne s'ouvre pas
  G.paused=true;
  afficherVoilePause(false); // le menu complet remplace le voile leger, le cas echeant
  document.getElementById('pausemenu').style.display='flex';
  document.getElementById('mpbtn-abandon').style.display=reseauActif()?'block':'none';
  // Sauvegarder/Charger manipulent directement G.units/buildings/factions
  // sans jamais toucher RESEAU : charger une vieille sauvegarde en pleine
  // partie en ligne désynchronise irrémédiablement les deux joueurs, sans
  // qu'aucune erreur ne soit levée. On les masque plutôt que d'ajouter un
  // garde silencieux — le joueur en ligne dispose déjà de "Sauvegarder ma
  // partie" (mpSauverEtQuitter) pour le cas où l'hôte se déconnecte.
  const enLigne=reseauActif();
  document.getElementById('savebtn-pause').style.display=enLigne?'none':'block';
  document.getElementById('loadbtn-pause').style.display=enLigne?'none':'block';
  document.getElementById('mp-save-note').style.display=enLigne?'block':'none';
  if(enLigne) document.getElementById('autoloadbtn').style.display='none';
  updateDiploBtn();
  if(!enLigne) refreshSaveInfo();
  document.getElementById('pausebtn-inner').innerHTML=iconImg('▶',16);
  if(!enLigne) checkSaveExists().then(exists=>{
    const st=document.getElementById('save-status');
    st.textContent=exists?'💾 Une sauvegarde existe':'Aucune sauvegarde';
    st.style.color=exists?'#2ecc71':'#555';
  });
}

function closePause(){
  if(reseauActif()) mpLeverPause();
  G.paused=false;
  document.getElementById('pausemenu').style.display='none';
  document.getElementById('pausebtn-inner').innerHTML=iconImg('⏸',16);
  // Relancer la boucle si elle s'est arrêtée
  requestAnimationFrame(loop);
}

function quitGame(){
  effacerRejoinEnLigne();
  quitterSessionReseau(true);
  tutoArreter();
  G.running=false; G.paused=false;
  document.getElementById('pausemenu').style.display='none';
  document.getElementById('overlay').style.display='flex';
  document.getElementById('pausebtn-inner').innerHTML=iconImg('⏸',16);
  checkSaveExists().then(exists=>{
    document.getElementById('loadbtn').style.display=exists?'block':'none';
  });
}
