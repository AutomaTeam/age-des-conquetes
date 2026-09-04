'use strict';
// ======================================================================
//  10-ordres.js
// ======================================================================
// Couche d'ordres : le SEUL point ou l'etat de jeu est mute pour
// le compte d'un joueur. C'est ici que l'hote fait autorite sur l'arbre
// technologique et les taux du Marche.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ══════════════════════════════════════════════════════════
//  COUCHE D'ORDRES
// ══════════════════════════════════════════════════════════
// Jusqu'ici, cliquer mutait G directement depuis handleTap et les boutons du
// panneau : il n'existait aucun point de passage où insérer le réseau. Tout
// ce que le joueur DEMANDE devient un ordre sérialisable, validé puis
// appliqué en un seul endroit.
//
//   émission  : emettreOrdre(cmd)  — appelé par l'interface locale
//   exécution : applyCommand(cmd)  — hôte (ou solo) uniquement
//
// Ne passent PAS par ici, car purement locaux et devant répondre
// instantanément : sélection, caméra, zoom, ouverture de panneaux, mini-carte.

const ORD = {
  DEPL:'DEPL', ATK:'ATK', AMOVE:'AMOVE', RECOLTE:'RECOLTE', FERME:'FERME',
  CHANTIER:'CHANTIER', REPARE:'REPARE', POSTURE:'POSTURE', STOP:'STOP',
  BATIR:'BATIR', FORMER:'FORMER', RECHERCHE:'RECHERCHE', AGE:'AGE',
  RALLIEMENT:'RALLIEMENT', PORTAIL:'PORTAIL', AMELIORER_TOUR:'AMELIORER_TOUR',
  DEMOLIR:'DEMOLIR', AUTO_FORMATION:'AUTO_FORMATION', AUTO_REPARE:'AUTO_REPARE',
  TROC:'TROC', ANNULER_FORMATION:'ANNULER_FORMATION', AMELIORER_CAMP:'AMELIORER_CAMP',
  GARNIR:'GARNIR', DEGARNIR:'DEGARNIR', ROUTE_COMMERCIALE:'ROUTE_COMMERCIALE',
  RELIQUE:'RELIQUE', CHASSER:'CHASSER', DIPLOMATIE:'DIPLOMATIE', PECHER:'PECHER', NAVIGUER:'NAVIGUER',
};

let _ordSeq=0;
// Construit l'enveloppe. `f` (faction) et `seq` permettront l'acquittement,
// la déduplication et le rejeu côté réseau.
function ordre(t,charge){ return Object.assign({seq:++_ordSeq, f:G.me, t}, charge||{}); }

// Route un ordre. En solo (et chez l'hôte) il s'applique immédiatement ;
// c'est ici que le client multijoueur l'enverra sur le réseau (P6).
function emettreOrdre(cmd,predire){
  if(_journalOrdres) _journalOrdres.push({at:+G.gameTime.toFixed(3), cmd:JSON.parse(JSON.stringify(cmd))});
  // Solo, ou hôte : on applique tout de suite, c'est nous qui faisons foi.
  if(estHote()) return applyCommand(cmd);
  // Client : l'ordre part chez l'hôte, qui le validera. En attendant, on
  // répond localement (prédiction optimiste) pour que l'interface ne donne
  // pas l'impression d'être morte pendant un aller-retour réseau.
  if(!envoyerReseau({t:'ORDRE',cmd})) return {ok:false,raison:'reseau'};
  const pred=predire?predire():null;
  // Seul un REJ retire une entree, or l'ecrasante majorite des ordres sont
  // acceptes : la table grossissait donc pendant toute la partie. Un rejet
  // revient en un aller-retour ; passe dix secondes, l'ordre est forcement
  // accepte et l'entree ne sert plus a rien.
  const maintenant=Date.now();
  RESEAU.attente.set(cmd.seq,{cmd, annuler:pred&&pred.annuler, t:maintenant});
  if(RESEAU.attente.size>64)
    for(const [seq,e] of RESEAU.attente) if(maintenant-(e.t||0)>10000) RESEAU.attente.delete(seq);
  return pred&&pred.resultat ? pred.resultat : {ok:true, optimiste:true};
}

// Journal d'ordres : ordres + graine = rejeu complet d'une partie. Sert
// surtout à déboguer une désynchronisation réseau (P6). Il s'active depuis la
// console — `demarrerJournal()` puis `journalOrdres()` — et reste éteint tant
// qu'on ne l'a pas demandé (emettreOrdre ne paie qu'un test de nullité).
// Exposé sur `window` : sans ça, rien ne pouvait l'allumer, `_journalOrdres`
// restait null à vie et l'outil était mort-né.
let _journalOrdres=null;
function demarrerJournal(){ _journalOrdres=[]; return 'journal d\'ordres démarré'; }
function journalOrdres(){ return _journalOrdres; }
window.demarrerJournal=demarrerJournal;
window.journalOrdres=journalOrdres;

// Helpers de validation
function _unitesDe(cmd){
  if(!cmd.ids||!cmd.ids.length) return [];
  // Ensemble plutot que includes() : la resolution reste un BALAYAGE de
  // G.units — c'est un choix, voir la note juste dessous — mais le test
  // d'appartenance passe de O(ids) a O(1). Un ordre de deplacement sur 200
  // unites selectionnees valait 200 x 900 comparaisons a chaque clic droit.
  const vises=new Set(cmd.ids);
  return G.units.filter(u=>vises.has(u.id)&&u.owner===cmd.f&&u.hp>0);
}
// Resolution PAR BALAYAGE, volontairement : IU/IB ne sont reconstruits qu'une
// fois par image (rebuildIndex), or un ordre peut arriver a tout moment — y
// compris avant la premiere image, ou juste apres qu'un batiment vient d'etre
// pose. Un ordre par seconde ne justifie pas de dependre de cette fraicheur.
function _bldDe(cmd,id){
  const cible=(id!=null?id:cmd.bId);
  const b=G.buildings.find(x=>x.id===cible);
  return (b&&b.owner===cmd.f&&b.hp>0)?b:null;
}
const KO=r=>({ok:false,raison:r});
const OK=info=>Object.assign({ok:true},info||{});

// -- ARBRE TECHNOLOGIQUE : SOURCE DE VERITE DE L'HOTE --------------------
// La barre d'action n'affiche que ces memes possibilites, mais un ordre venu
// du RESEAU ne passe jamais par elle : sans ces tables, applyCommand ne
// verifiait que le prix. Un client pouvait donc former un Paladin depuis une
// Maison des l'Age Sombre, ou lancer Tactiques sans Universite -- il payait,
// c'est tout. `age` : age minimum ; `rech` : recherche prealable.
const PRODUCTION = {
  [BT.TC]:        [{u:UT.VIL}],
  [BT.BARRACKS]:  [{u:UT.MIL},{u:UT.ARC},{u:UT.PIKE,age:1}],
  [BT.STABLE]:    [{u:UT.SCOUT},{u:UT.KNIGHT}],
  [BT.MONASTERY]: [{u:UT.MONK}],
  // `civ` : reserve l'entree a une civilisation. C'est la SOURCE DE VERITE de
  // l'hote -- sans elle, un client pouvait former le Cataphractaire byzantin
  // en jouant Mongols, l'interface ne verrouillant que l'affichage.
  [BT.CASTLE]:    [{u:UT.PALADIN,rech:'faith'},{u:UT.XBOW,age:2},{u:UT.TREB,age:3},{u:UT.HERO},
                   {u:UT.CATA,   age:2, civ:'byzantins'},
                   {u:UT.CAVARC, age:2, civ:'mongols'},
                   {u:UT.ARBRAP, age:2, civ:'chinois'}],
  [BT.SIEGE]:     [{u:UT.RAM}],
  [BT.DOCK]:      [{u:UT.BOAT}],
};
// Taux de change du Marche. Meme raison d'etre : ORD.TROC recopiait
// aveuglement les DEUX quantites envoyees par le client, en se contentant de
// verifier qu'il avait de quoi payer. Un {donne:'wood',qteDonne:0,
// recoit:'gold',qteRecoit:999999} passait le controle et creditait 999 999
// pieces -- ressources infinies pour l'invite d'une partie en ligne.
const TROCS = [
  {donne:'food',  qte:100, recoit:'gold', rend:60},
  {donne:'wood',  qte:100, recoit:'gold', rend:60},
  {donne:'stone', qte:100, recoit:'gold', rend:80},
  {donne:'gold',  qte:80,  recoit:'wood', rend:100},
];
// Le camp possede-t-il un batiment de ce type, bati et debout ?
function possedeBatiment(owner,type){
  return G.buildings.some(b=>b.owner===owner&&b.type===type&&!b.constructing&&b.hp>0);
}

// Applique un ordre validé. SEULE fonction autorisée à muter l'état de jeu
// pour le compte d'un joueur — la simulation (update) et l'IA gardent
// leurs propres chemins.
function applyCommand(cmd){
  const f=G.factions&&G.factions[cmd.f];
  if(!f) return KO('faction');
  if(f.vaincu) return KO('vaincu');

  switch(cmd.t){

  // ── Ordres d'unités ───────────────────────────────────
  case ORD.DEPL: {
    const us=_unitesDe(cmd); if(!us.length) return KO('aucune');
    // La formation est calculée ICI, pas chez l'appelant : deux clients ne
    // doivent pas répartir les unités différemment autour du même point.
    const fmt=formation(cmd.x,cmd.y,us.length);
    us.forEach((u,i)=>{
      quitterPoste(u); // voir 07-simulation.js : sans ça, un récolteur/fermier déplacé laisse un fantôme derrière lui
      u.destX=fmt[i].x; u.destY=fmt[i].y; u.state='moving';
      u.target=null; u.pendingAction=null; u.amove=null;
      u.anchorX=fmt[i].x; u.anchorY=fmt[i].y;   // point de garde des postures
    });
    return OK({n:us.length});
  }

  case ORD.AMOVE: {
    const us=_unitesDe(cmd).filter(u=>isMilitary(u.type));
    if(!us.length) return KO('aucune');
    const fmt=formation(cmd.x,cmd.y,us.length);
    us.forEach((u,i)=>{
      u.amove={x:fmt[i].x,y:fmt[i].y};
      u.destX=fmt[i].x; u.destY=fmt[i].y;
      u.anchorX=fmt[i].x; u.anchorY=fmt[i].y;
      u.state='amove'; u.target=null; u.pendingAction=null;
    });
    return OK({n:us.length});
  }

  case ORD.ATK: {
    const us=_unitesDe(cmd); if(!us.length) return KO('aucune');
    const cible=(cmd.genreCible==='b')?G.buildings.find(x=>x.id===cmd.cible)
                                      :G.units.find(x=>x.id===cmd.cible);
    if(!cible||cible.hp<=0) return KO('cible');
    if(!estHostile({owner:cmd.f},cible)) return KO('cible'); // on n'attaque pas les siens
    us.forEach(u=>{quitterPoste(u);u.state='attack';u.target=cible.id;});
    return OK({n:us.length});
  }

  case ORD.STOP: {
    const us=_unitesDe(cmd); if(!us.length) return KO('aucune');
    us.forEach(u=>{quitterPoste(u);u.state='idle';u.target=null;u.amove=null;});
    return OK({n:us.length});
  }

  case ORD.POSTURE: {
    const us=_unitesDe(cmd).filter(u=>isMilitary(u.type));
    if(!us.length) return KO('aucune');
    if(!STANCES.includes(cmd.posture)) return KO('invalide');
    us.forEach(u=>{ u.stance=cmd.posture; u.anchorX=u.x; u.anchorY=u.y; });
    return OK({n:us.length,posture:cmd.posture});
  }

  case ORD.RECOLTE: {
    const vils=_unitesDe(cmd).filter(u=>u.type===UT.VIL);
    if(!vils.length) return KO('aucune');
    const nd=G.nodes.find(x=>x.id===cmd.nodeId&&x.amt>0);
    if(!nd) return KO('cible');
    const r=assignGatherers(vils,nd);
    return OK(r);
  }

  case ORD.FERME: {
    const vils=_unitesDe(cmd).filter(u=>u.type===UT.VIL);
    if(!vils.length) return KO('aucune');
    const b=_bldDe(cmd); if(!b||b.type!==BT.FARM||b.constructing) return KO('cible');
    for(const v of vils){
      quitterPoste(v); // sans ça, passer d'une AUTRE ferme (ou d'un gisement) à celle-ci y laissait un fermier fantôme
      // Un bûcheron à moitié chargé, réaffecté à une ferme, jetait son bois
      // en route : la nourriture qu'on lui demande de produire n'a rien à
      // voir avec ce qu'il portait déjà.
      if(v.invT!=='farm'){ crediterInventaire(v); v.inv=0; }
      v.state='farm'; v.target=b.id; v.homeFarm=b.id; v.invT='farm';
    }
    return OK({n:vils.length, vide:b.foodLeft<=0});
  }

  case ORD.CHANTIER: {
    const vils=_unitesDe(cmd).filter(u=>u.type===UT.VIL);
    if(!vils.length) return KO('aucune');
    const b=_bldDe(cmd); if(!b||!b.constructing) return KO('cible');
    for(const v of vils){ quitterPoste(v); v.state='build'; v.buildTarget=b.id; }
    return OK({n:vils.length});
  }

  case ORD.REPARE: {
    const vils=_unitesDe(cmd).filter(u=>u.type===UT.VIL);
    if(!vils.length) return KO('aucune');
    const b=_bldDe(cmd); if(!b||b.constructing||b.hp>=b.maxHp) return KO('cible');
    for(const v of vils){ quitterPoste(v); v.state='repair'; v.target=b.id; }
    return OK({n:vils.length});
  }

  // ── Production et économie ──────────────────────────────
  case ORD.BATIR: {
    const d=BDEF[cmd.type]; if(!d) return KO('invalide');
    if((cmd.type===BT.CASTLE||cmd.type===BT.SIEGE)&&f.age<2) return KO('age');
    if(cmd.type===BT.WONDER&&f.age<3) return KO('age');
    if(cmd.type===BT.WONDER&&G.buildings.some(bb=>bb.owner===cmd.f&&bb.type===BT.WONDER)) return KO('invalide'); // une seule Merveille à la fois
    // Emplacement réellement libre : un client ne décide pas seul où poser.
    const tx=cmd.tx, ty=cmd.ty;
    if(!(tx>=0&&ty>=0&&tx+d.w<=COLS&&ty+d.h<=ROWS)) return KO('invalide');
    for(let dy=0;dy<d.h;dy++) for(let dx=0;dx<d.w;dx++)
      if(G.bmap[ty+dy][tx+dx]!==0) return KO('occupe');
    if(cmd.type===BT.DOCK&&!hasAdjacentWater(tx,ty,d.w,d.h)) return KO('invalide'); // doit toucher l'eau
    const cost=scaleCost(d.cost);
    if(!canAfford(cost,cmd.f)) return KO('ressources');
    spend(cost,cmd.f);
    const b=mkBuilding(cmd.type,tx,ty,cmd.f);
    b.constructing=true; b.progress=0;
    placeBuilding(b);
    const vils=G.units.filter(u=>u.owner===cmd.f&&u.type===UT.VIL&&(cmd.batisseurs||[]).includes(u.id));
    vils.forEach(v=>{ quitterPoste(v); v.state='build'; v.buildTarget=b.id; });
    return OK({b, nom:d.nom});
  }

  case ORD.FORMER: {
    const b=_bldDe(cmd); if(!b||b.constructing) return KO('cible');
    const cost=TCOST[cmd.unitType]; if(!cost) return KO('invalide');
    // Ce batiment produit-il REELLEMENT cette unite, et le camp y a-t-il
    // droit ? (voir PRODUCTION -- l'interface montre exactement ces regles)
    const offre=(PRODUCTION[b.type]||[]).find(o=>o.u===cmd.unitType);
    if(!offre) return KO('invalide');
    if(offre.age!=null&&f.age<offre.age) return KO('age');
    if(offre.rech&&!f.research[offre.rech]) return KO('invalide');
    if(offre.civ&&f.civ!==offre.civ) return KO('civilisation');   // unite unique d'une AUTRE civilisation
    // Héros : un seul par partie, même mort — pas de remplaçant (voir HEROES).
    if(cmd.unitType===UT.HERO){
      if(f.heroTrained||b.trainQ.includes(UT.HERO)) return KO('deja');
      if(G.units.some(u=>u.owner===cmd.f&&u.type===UT.HERO&&u.hp>0)) return KO('deja');
    }
    if(!canAfford(cost,cmd.f)) return KO('ressources');
    // Total des files de TOUS les bâtiments d'entraînement de la faction, pas
    // juste celle de `b` : sinon, mettre en file depuis la Caserne A puis
    // immédiatement depuis la Caserne B (place restante pour une seule
    // recrue) passait les deux vérifications — chacune ne voyant que sa
    // propre file, toujours vide de son point de vue — et payait deux unités
    // pour une seule place de population réellement disponible.
    const enFile=G.buildings.reduce((s,bb)=>bb.owner===cmd.f?s+bb.trainQ.length:s,0);
    if(f.pop+enFile>=f.maxPop) return KO('pop');
    spend(cost,cmd.f);
    b.trainQ.push(cmd.unitType);
    if(cmd.unitType===UT.HERO) f.heroTrained=true;
    if(b.trainQ.length===1) b.trainTimer=trainTime(cmd.unitType);
    return OK({nom:UDEF[cmd.unitType].nom});
  }

  case ORD.AUTO_FORMATION: {
    const b=_bldDe(cmd); if(!b||b.type!==BT.TC) return KO('cible');
    b.autoTrain=!!cmd.actif;
    return OK({actif:b.autoTrain});
  }

  // Retire UN élément précis de la file (pas forcément le dernier) et
  // rembourse 50% de son coût, comme une annulation de chantier classique.
  // L'élément retiré si `index===0` était EN COURS de formation : le
  // suivant repart de zéro plutôt que d'hériter du temps déjà écoulé.
  case ORD.ANNULER_FORMATION: {
    const b=_bldDe(cmd); if(!b) return KO('cible');
    const i=cmd.index;
    if(!(i>=0)||i>=b.trainQ.length) return KO('invalide');
    const type=b.trainQ[i];
    const cost=TCOST[type]||{};
    const pool=resPool(cmd.f);
    if(pool) Object.entries(cost).forEach(([r,v])=>{ pool[r]=(pool[r]||0)+(v>>1); });
    b.trainQ.splice(i,1);
    if(i===0) b.trainTimer=b.trainQ.length>0?trainTime(b.trainQ[0]):0;
    // Formation de Héros annulée : rend la seule chance de la partie.
    if(type===UT.HERO) f.heroTrained=false;
    return OK({nom:UDEF[type].nom});
  }

  case ORD.RECHERCHE: {
    const r=RDEF[cmd.cle]; if(!r) return KO('invalide');
    // Le panneau de recherche s'ouvre depuis la Forge (cat 'forge') ou
    // l'Universite (cat 'univ') : c'est ce batiment-la qui en donne le droit.
    if(r.cat==='eco'){ if(!possedeBatiment(cmd.f,BT.MILL)) return KO('cible'); }
    else if(!possedeBatiment(cmd.f, r.cat==='univ'?BT.UNIV:BT.FORGE)) return KO('cible');
    if(r.civ&&f.civ!==r.civ) return KO('civilisation');   // recherche exclusive d'une AUTRE civilisation
    if(r.age!=null&&f.age<r.age) return KO('age');
    if(f.research[cmd.cle]) return KO('deja');
    if(f.researchQ.some(x=>x.type===cmd.cle)) return KO('deja');
    if(!canAfford(r.cost,cmd.f)) return KO('ressources');
    spend(r.cost,cmd.f);
    f.researchQ.push({type:cmd.cle,timer:r.time});
    return OK({nom:r.nom});
  }

  case ORD.AGE: {
    if(f.age>=AGES.length-1) return KO('max');
    if(f.ageUpQ) return KO('deja');
    if(!G.buildings.find(b=>b.type===BT.TC&&b.owner===cmd.f)) return KO('tc');
    const next=AGES[f.age+1];
    if(!canAfford(next.cost,cmd.f)) return KO('ressources');
    spend(next.cost,cmd.f);
    const t=[0,60,90,120][f.age+1]||90;
    f.ageUpQ={timer:t, total:t};
    return OK({next});
  }

  case ORD.RALLIEMENT: {
    const b=_bldDe(cmd); if(!b) return KO('cible');
    if(![BT.TC,BT.BARRACKS,BT.STABLE,BT.MONASTERY,BT.CASTLE,BT.SIEGE].includes(b.type)) return KO('invalide');
    b.rally={x:cmd.x,y:cmd.y};
    return OK();
  }

  case ORD.PORTAIL: {
    const b=_bldDe(cmd); if(!b||b.type!==BT.GATE) return KO('cible');
    return OK(appliquerPortail(b));
  }

  case ORD.AMELIORER_TOUR: {
    const b=_bldDe(cmd); if(!b||b.type!==BT.TOWER) return KO('cible');
    return appliquerUpgradeTour(b,cmd.f);
  }

  case ORD.AMELIORER_CAMP: {
    const b=_bldDe(cmd); if(!b||!CAMP_LEVELS[b.type]) return KO('cible');
    return appliquerUpgradeCamp(b,cmd.f);
  }

  // ── Garnison : un villageois ou un soldat entré dans un Centre Ville /
  // Tour / Château est invisible au ciblage (retiré de la grille spatiale,
  // voir rebuildGrid), donc invulnérable, sans pour autant quitter la partie
  // (population inchangée). Les archers/arbalétriers garnis boostent en
  // prime l'attaque automatique du bâtiment (voir updateBuildings).
  case ORD.GARNIR: {
    const b=_bldDe(cmd); if(!b||b.constructing) return KO('cible');
    const cap=BDEF[b.type].garrisonCap; if(!cap) return KO('invalide');
    const us=_unitesDe(cmd).filter(u=>u.state!=='garrison'&&u.type!==UT.TREB&&u.type!==UT.RAM);
    if(!us.length) return KO('aucune');
    const cur=G.units.filter(u=>u.state==='garrison'&&u.target===b.id).length;
    const room=Math.max(0,cap-cur);
    if(room<=0) return KO('plein');
    const admis=us.slice(0,room);
    for(const u of admis){
      u.avantGarnison=posteActuel(u); // pour ORD.DEGARNIR : AVANT quitterPoste, qui efface state/target
      quitterPoste(u); // gatherers/farmers restaient fantômes ici — homeNode n'était même pas nettoyé
      // Un villageois en chemin vers le dépôt (ou juste en cours de charge)
      // portait déjà quelque chose : le lui faire perdre en s'abritant
      // serait puni pour avoir bien travaillé — « sain et sauf » vaut aussi
      // pour la récolte du jour (voir crediterInventaire).
      crediterInventaire(u);
      u.state='garrison'; u.target=b.id; u.x=b.x; u.y=b.y;
      u.moving=false; u.path=null; u.buildTarget=null; u.inv=0; u.invT=null;
    }
    if(admis.length) f.stats.garrisonUses+=admis.length;
    return OK({n:admis.length, refuses:us.length-admis.length});
  }

  // ── Route commerciale : une caravane fait la navette entre deux Marchés
  // et rapporte de l'or à chaque arrivée — plus le trajet est long, plus la
  // caravane paie, mais plus elle expose le joueur (aucune protection en v1 :
  // la route continue même si le chemin traverse un territoire hostile).
  case ORD.ROUTE_COMMERCIALE: {
    const b=_bldDe(cmd); if(!b||b.type!==BT.MARKET||b.constructing) return KO('cible');
    if(cmd.toId==null){ b.tradeRoute=null; return OK({}); }
    const to=G.buildings.find(x=>x.id===cmd.toId);
    if(!to||to.type!==BT.MARKET||to.constructing||to.id===b.id) return KO('cible');
    const tf=fac(to.owner);
    if(to.owner!==cmd.f&&(!tf||tf.equipe!==f.equipe)) return KO('cible'); // à soi ou à un allié
    const dist=Math.hypot(to.x-b.x,to.y-b.y);
    b.tradeRoute={toId:to.id, dist, t:0, dur:Math.max(20,dist/CARAVAN_SPEED), dir:1};
    return OK({dist:Math.round(dist/BASE_TILE)});
  }

  // Un seul Moine à la fois par relique — la validation se fait ici (hôte
  // autoritaire) pour qu'une double-commande en ligne ne fasse jamais
  // porter la même relique par deux moines.
  case ORD.RELIQUE: {
    const monks=_unitesDe(cmd).filter(u=>u.type===UT.MONK); if(!monks.length) return KO('aucune');
    const relic=G.relics&&G.relics.find(r=>r.id===cmd.relicId);
    if(!relic||!relicFree(relic)) return KO('cible');
    const u=monks[0];
    relic.carrier=u.id;
    quitterPoste(u);
    u.state='relic'; u.target=relic.id; u.inv=0; u.invT=null; u.moving=false; u.relicHeld=false;
    return OK({});
  }

  // Chasse : n'importe quelle unité (villageois compris, à ses risques) peut
  // être envoyée sur un animal — plusieurs chasseurs peuvent viser la même
  // proie, pas d'exclusivité comme pour les reliques (pas de risque de
  // blocage : un animal mort disparaît simplement de G.wildlife).
  case ORD.NAVIGUER: {
    const us=_unitesDe(cmd).filter(u=>u.type===UT.BOAT); if(!us.length) return KO('aucune');
    for(const u of us){ u.state='sailing'; u.destX=cmd.x; u.destY=cmd.y; u.target=null; }
    return OK({n:us.length});
  }

  case ORD.PECHER: {
    const us=_unitesDe(cmd).filter(u=>u.type===UT.BOAT); if(!us.length) return KO('aucune');
    const n=G.nodes.find(x=>x.id===cmd.nodeId&&x.type===RT.FISH&&x.amt>0);
    if(!n) return KO('cible');
    for(const u of us){ u.state='fish'; u.target=n.id; u.homeNode=n.id; }
    return OK({n:us.length});
  }

  case ORD.CHASSER: {
    const us=_unitesDe(cmd); if(!us.length) return KO('aucune');
    const w=(G.wildlife||[]).find(x=>x.id===cmd.wildlifeId);
    if(!w||w.hp<=0) return KO('cible');
    for(const u of us){ quitterPoste(u); u.state='hunt'; u.target=w.id; u.moving=false; }
    return OK({n:us.length});
  }

  // Diplomatie : une alliance FUSIONNE l'équipe du rival avec celle du
  // proposant — estHostile() est purement basée sur l'équipe, donc les deux
  // camps cessent immédiatement de se combattre (les unités déjà engagées
  // se désengagent au prochain recalcul de cible, voir updateEnemyAI).
  // Rompre restaure l'équipe d'origine, mémorisée à la conclusion.
  case ORD.DIPLOMATIE: {
    const cible=G.factions[cmd.cibleId];
    if(!cible||cible.genre!=='ia'||cible.vaincu) return KO('cible');
    if(cmd.action==='proposer'){
      if(cible.equipe===f.equipe) return KO('deja');
      // L'IA n'accepte que si elle n'est pas clairement la plus forte des
      // rivaux IA restants : sans intérêt à se lier si elle domine déjà.
      const autres=factionsIA().filter(x=>x.id!==cible.id&&!x.vaincu);
      const armeeDe=id=>G.units.filter(u=>u.owner===id&&u.hp>0&&isMilitary(u.type)).length;
      const armeeCible=armeeDe(cible.id);
      const armeeAutre=autres.length?Math.max(...autres.map(x=>armeeDe(x.id))):0;
      if(autres.length&&armeeCible>armeeAutre*1.1) return {ok:false,raison:'refuse',nom:cible.nom};
      cible._equipeAvant=cible.equipe;
      cible.equipe=f.equipe;
      cible.allieDe=cmd.f;
      return OK({nom:cible.nom});
    } else {
      if(cible.equipe!==f.equipe) return KO('pasallie');
      cible.equipe=cible._equipeAvant!=null?cible._equipeAvant:cible.equipe;
      cible.allieDe=null;
      return OK({nom:cible.nom});
    }
  }

  case ORD.DEGARNIR: {
    const b=_bldDe(cmd); if(!b) return KO('cible');
    const tous=G.units.filter(u=>u.owner===cmd.f&&u.state==='garrison'&&u.target===b.id);
    if(!tous.length) return KO('aucune');
    const sortants=(cmd.ids&&cmd.ids.length)?tous.filter(u=>cmd.ids.includes(u.id)):tous;
    sortants.forEach((u,i)=>{
      const ang=(i/Math.max(1,sortants.length))*Math.PI*2;
      const r=bldContact(b,0.6);
      u.x=b.x+Math.cos(ang)*r; u.y=b.y+Math.sin(ang)*r;
      u.state='idle'; u.target=null;
      reprendrePoste(u); // reprend récolte/ferme/chantier/réparation si la cible mémorisée tient toujours, sinon reste idle
    });
    return OK({n:sortants.length});
  }

  case ORD.DEMOLIR: {
    const b=_bldDe(cmd); if(!b) return KO('cible');
    if(b.type===BT.TC) return KO('invalide');
    return OK(appliquerDemolition(b,cmd.f));
  }

  case ORD.AUTO_REPARE: {
    f.autoRepair=!!cmd.actif;
    return OK({actif:f.autoRepair});
  }

  case ORD.TROC: {
    // Le taux vient de TROCS, JAMAIS de l'ordre : les quantites recues ne
    // servent qu'a identifier laquelle des quatre lignes du Marche est
    // demandee (voir TROCS pour l'exploit que cela ferme).
    const t=TROCS.find(x=>x.donne===cmd.donne&&x.recoit===cmd.recoit
                        &&x.qte===cmd.qteDonne&&x.rend===cmd.qteRecoit);
    if(!t) return KO('invalide');
    if(!possedeBatiment(cmd.f,BT.MARKET)) return KO('cible');
    const p=resPool(cmd.f); if(!p) return KO('faction');
    if((p[t.donne]||0)<t.qte) return KO('ressources');
    p[t.donne]-=t.qte;
    p[t.recoit]=(p[t.recoit]||0)+t.rend;
    f.stats.tradesDone++;
    return OK();
  }

  }
  return KO('inconnu');
}

// ── ÉCONOMIE ─────────────────────────────────────────────
// Le camp est explicite : un ordre venu du réseau paie dans SA caisse, pas
// dans celle du joueur qui regarde.
function canAfford(cost,owner){ const p=resPool(owner||G.me); return !!p&&Object.entries(cost).every(([r,v])=>(p[r]||0)>=v); }
function spend(cost,owner){ const p=resPool(owner||G.me); if(p) Object.entries(cost).forEach(([r,v])=>{ p[r]=Math.max(0,(p[r]||0)-v); }); }

function trainUnit(b,type){
  const r=emettreOrdre(ordre(ORD.FORMER,{bId:b.id, unitType:type}));
  if(!r.ok){
    if(r.raison==='ressources'){ notify('Ressources insuffisantes !','#e74c3c'); flashResources(TCOST[type]); }
    else if(r.raison==='pop'){
      notify('Population maximale !','#e67e22');
      const el=document.getElementById('ri-pop');
      if(el){
        el.classList.remove('insuff'); void el.offsetWidth; el.classList.add('insuff');
        clearTimeout(el._insuffT);
        el._insuffT=setTimeout(()=>el.classList.remove('insuff'),820);
      }
    }
    else if(r.raison==='deja') notify('Déjà formé cette partie !','#e67e22');
    return;
  }
  notify(`Formation de ${r.nom}…`,'#3498db'); buzz(8);
  refreshUI();
}

// Démolir un bâtiment (récupère 25% du coût réellement payé — voir scaleCost)
// Mutation pure — rend la liste de ce qui a été remboursé.
function appliquerDemolition(b,owner){
  const cost=scaleCost(BDEF[b.type].cost||{});
  const pool=resPool(owner), refund={};
  for(const k in cost){ const v=Math.floor(cost[k]*0.25); if(v>0){ refund[k]=v; if(pool) pool[k]=(pool[k]||0)+v; } }
  // libérer les cases
  for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++){
    if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=0;
  }
  // les villageois qui y travaillaient repassent inactifs — et la garnison
  // est éjectée saine et sauve (démolition volontaire, pas une perte au combat).
  for(const u of G.units) if(u.target===b.id&&['repair','farm','build','garrison'].includes(u.state)){
    const enGarnison=u.state==='garrison';
    u.state='idle'; u.target=null;
    if(enGarnison) reprendrePoste(u); // une Tour/un Château démoli(e) ne doit pas voler leur activité aux occupants
  }
  libererFileFormation(b); // idem destruction au combat : le Héros en file reste formable
  G.buildings=G.buildings.filter(x=>x.id!==b.id);
  G.sel=G.sel.filter(id=>id!==b.id);
  updatePopCap();
  return {refund, nom:BDEF[b.type].nom, x:b.x, y:b.y};
}
function demolishBuilding(b){
  if(b.type===BT.TC){ notify('Le Centre Ville ne peut être démoli','#e74c3c'); return; }
  const r=emettreOrdre(ordre(ORD.DEMOLIR,{bId:b.id}));
  if(!r.ok) return;
  spawnParts(r.x,r.y,'#8a6a3a',14);
  const txt=Object.keys(r.refund).length?' (+'+Object.entries(r.refund).map(([k,v])=>v+({food:'🍖',wood:'🪵',stone:'🪨',gold:'💰'}[k]||k)).join(' ')+')':'';
  notify('🧨 '+r.nom+' démoli'+txt,'#e67e22'); buzz(12);
  refreshUI();
}
