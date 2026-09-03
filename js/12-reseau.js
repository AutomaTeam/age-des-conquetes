'use strict';
// ======================================================================
//  12-reseau.js
// ======================================================================
// Multijoueur : transport, protocole (instantane et delta),
// routage des messages, salon et reprise de session.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.

// ══════════════════════════════════════════════════════════
//  TRANSPORT : branchement
// Le protocole ci-dessus ne connait ni Firebase ni WebRTC : il ecrit dans
// RESEAU.envoi et lit par recevoirReseau. On peut donc l'eprouver sur
// n'importe quel canal - window.MP en production, une boucle locale en test.
function brancherTransport(envoi){ RESEAU.envoi=envoi; }
window.brancherTransport=brancherTransport;

// Canal de TEST : relie deux onglets du jeu sans Firebase, pour valider le
// protocole independamment du transport reseau.
function transportLocal(canalNom){
  const bc=new BroadcastChannel(canalNom||'adc-test');
  bc.onmessage=e=>{ try{ recevoirReseau(e.data); }catch(err){ console.error('reseau:',err); } };
  brancherTransport(m=>{ bc.postMessage(m); return true; });
  return bc;
}
window.transportLocal=transportLocal;

//  SALON MULTIJOUEUR (interface)
// ══════════════════════════════════════════════════════════
// Le transport vit dans un module séparé (window.MP, voir tout en bas du
// fichier). Ici on ne fait que piloter l'interface : tout appel est gardé par
// `window.MP?.` pour que le jeu reste intact si le module n'a pas chargé.


// ═══════════════════════════════════════════════════════════════
//  BOUCLE RESEAU  (hote autoritaire)
// ═══════════════════════════════════════════════════════════════
// La simulation n'est PAS deterministe (Math.random dans update, dt variable
// avant P0, coordonnees flottantes) : rejouer les memes ordres des deux cotes
// divergerait. L'hote fait donc tourner la seule simulation qui fasse foi ; le
// client ne fait qu'envoyer des ordres et afficher l'etat recu, interpole.
//
//   hote   : update() -> etat -> deltas 10 Hz -> client
//   client : ordres -> hote ;  deltas -> interpolation -> rendu
//
// Le transport est abstrait (RESEAU.envoi) : window.MP en production, une
// simple boucle locale pour les tests. Rien ici ne connait Firebase.

// v2 : la SALUT porte la taille de carte (champ `taille`). Un client v1 ne
// la lirait pas et générerait un monde 240×240 face à un hôte qui en a
// choisi un autre — tout diverge dès la première image, donc incompatible.
// v3 : le masque d'unité gagne M_ATK et M_XP, et la ligne de bâtiment deux
// cases (`autoTrain`, `rally`). Les bits du masque se lisent EN ORDRE (chaque
// `if` consomme une case du tableau) : un client v2 ne connaît pas les deux
// nouveaux, ne les dépile pas, et tout ce qui suit dans SA lecture tombe à
// côté. Un écart de version doit donc refuser la connexion, pas la
// dégrader — d'où le bump.
const PROTO_VERSION = 4;   // v4 : equipe suivie en cours de partie, autoRepair emis
const DELTA_HZ      = 10;
const DELTA_PERIODE = 1/DELTA_HZ;
const SEUIL_POS     = 1;    // unites-monde : en deca, on ne renvoie pas la position

const RESEAU = {
  actif:false,
  role:null,          // 'hote' | 'client'
  envoi:null,         // fonction(objet) -> bool, fournie par le transport
  moi:null,           // faction locale
  adversaire:null,    // {id, nom}
  tick:0,
  accDelta:0,
  pret:false,         // le client a fini de generer sa carte
  snapEnVol:false,    // un SNAP est en cours de compression : aucun delta ne doit le doubler
  dernier:new Map(),  // id -> derniere valeur envoyee (hote)
  connusU:new Set(), connusB:new Set(), connusW:new Set(),
  attente:new Map(),  // seq -> ordre en attente d'acquittement (client)
  latence:0,
  // Robustesse (P7)
  dernierRecu:0,            // horodatage du dernier message recu, tous types
  enAttenteReconnexion:false,
  decisionRequise:false,    // hote : la fenetre de reconnexion a expire, il doit choisir
  finRecue:null,            // bilan de fin de partie envoye par l'hote
  pausesRestantes:3, pauseMinuteur:null,
  // Crochets fournis par le TRANSPORT (Firebase en prod, no-op en test) :
  // la logique de reconnexion elle-meme (renegociation WebRTC) est
  // specifique au transport ; ce qui se passe cote jeu (geler, afficher,
  // decider) ne l'est pas et vit entierement ici.
  tenterReconnexion:null,   // ()=>void, appele une fois en entrant en attente
  onSalonSupprime:null,     // callback pose par le transport ; appele quand
                            // l'hote a explicitement ferme le salon
};
window.RESEAU=RESEAU;

function reseauActif(){ return RESEAU.actif; }
function estHote(){ return !RESEAU.actif || RESEAU.role==='hote'; }

function envoyerReseau(m){
  if(!RESEAU.actif||!RESEAU.envoi) return false;
  // Le SNAP est le seul message assez gros pour justifier la compression
  // (24 Ko environ a l'echelle du plan) : tout le reste tient deja en
  // quelques centaines d'octets. Envoi asynchrone, sans bloquer l'appelant
  // (aucun site n'attend le retour de envoyerReseau pour un SNAP).
  if(m&&m.t==='SNAP'){ envoyerSnapCompresse(m); return true; }
  try{ return !!RESEAU.envoi(m); }catch(e){ return false; }
}

// Compresse le SNAP en gzip (CompressionStream, API Web standard) avant de
// le confier au transport sous forme d'ArrayBuffer. Repli silencieux vers
// le JSON tel quel si l'API n'est pas disponible (anciens navigateurs) ou
// en cas d'echec — le protocole reste fonctionnel, juste plus verbeux.
const MARQUEUR_SNAP_GZ = 0x53; // 'S'
async function envoyerSnapCompresse(m){
  // Le SNAP part de facon ASYNCHRONE (compression) quand tout le reste part
  // synchrone : sans ce drapeau, un delta emis dans l'intervalle doublait le
  // SNAP sur le fil et etait jete par le client (pas encore `pret`) — en
  // emportant une image de changements que l'hote croyait pourtant livree.
  RESEAU.snapEnVol=true;
  try{
    if(typeof CompressionStream==='undefined'){ RESEAU.envoi(m); return; }
    const octets=new TextEncoder().encode(JSON.stringify(m));
    const cs=new CompressionStream('gzip');
    const w=cs.writable.getWriter();
    w.write(octets); w.close();
    const gz=new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const enveloppe=new Uint8Array(gz.byteLength+1);
    enveloppe[0]=MARQUEUR_SNAP_GZ;
    enveloppe.set(gz,1);
    RESEAU.envoi(enveloppe.buffer);
  }catch(e){ try{ RESEAU.envoi(m); }catch(e2){} }
  finally{ RESEAU.snapEnVol=false; }
}

// Decodage d'un message binaire recu (pour l'instant : uniquement le SNAP
// compresse). Appele par recevoirReseau() quand le transport livre un
// ArrayBuffer plutot qu'un objet JSON deja decode.
async function decoderMessageBinaire(buf){
  try{
    const octets=new Uint8Array(buf);
    if(octets[0]===MARQUEUR_SNAP_GZ){
      const ds=new DecompressionStream('gzip');
      const w=ds.writable.getWriter();
      w.write(octets.subarray(1)); w.close();
      const texte=await new Response(ds.readable).text();
      recevoirReseau(JSON.parse(texte));
    }
  }catch(e){ console.error('multijoueur : decodage binaire echoue',e); }
}

// ── SERIALISATION ──────────────────────────────────────────────
// On ne transmet que ce qui ne se rededuit pas : la carte vient de la graine
// (P4), les projectiles sont peu nombreux, et la mort d'une unite se lit dans
// la liste des retraits.
// `a` (atk), `e` (xp) et `r` (rang) voyagent EXPLICITEMENT, au meme titre que
// `m` (maxHp). deserialiserUnite reconstruit l'unite par mkUnit, qui recalcule
// l'atk depuis les recherches et l'age que le CLIENT connait du proprietaire :
// pour une unite adverse il n'en connait souvent rien, et il n'a de toute
// facon aucun moyen de deviner une promotion de veterance (voir awardKillXP).
function serialiserUnite(u){
  return {i:u.id, t:u.type, o:u.owner,
          x:Math.round(u.x), y:Math.round(u.y),
          h:u.hp, m:u.maxHp, s:u.state, g:u.target||null,
          d:+(u.dir||0).toFixed(2), v:u.inv||0, w:u.invT||null,
          c:u.camp||null, k:u.stance||null,
          a:u.atk, e:u.xp||0, r:u.rank||0};
}
function deserialiserUnite(d){
  const u=mkUnit(d.t, d.x, d.y, d.o);
  u.id=d.i; u.hp=d.h; u.maxHp=d.m; u.state=d.s; u.target=d.g;
  u.dir=d.d; u.inv=d.v; u.invT=d.w; u.camp=d.c; u.stance=d.k;
  if(d.a!=null) u.atk=d.a;
  u.xp=d.e||0; u.rank=d.r||0;
  u._netX=d.x; u._netY=d.y;
  return u;
}
function serialiserBatiment(b){
  return {i:b.id, t:b.type, o:b.owner, x:b.tx, y:b.ty,
          h:b.hp, m:b.maxHp, c:b.constructing?1:0, p:+(b.progress||0).toFixed(3),
          q:b.trainQ||[], r:b.trainTimer||0, l:b.level||1,
          g:b.open?1:0, f:b.foodLeft||0, a:b.autoTrain?1:0,
          y2:b.rally?[Math.round(b.rally.x),Math.round(b.rally.y)]:null};
}
function deserialiserBatiment(d){
  const b=mkBuilding(d.t, d.x, d.y, d.o);
  b.id=d.i; b.hp=d.h; b.maxHp=d.m;
  b.constructing=!!d.c; b.progress=d.p;
  b.trainQ=d.q||[]; b.trainTimer=d.r; b.level=d.l;
  b.open=!!d.g; b.foodLeft=d.f; b.autoTrain=!!d.a;
  b.rally=d.y2?{x:d.y2[0],y:d.y2[1]}:null;
  return b;
}
// `prive` : joint ou non ce que le brouillard de guerre est cense cacher —
// caisse, recherches, files d'age et de recherche. Reserve aux factions du
// MEME CAMP que le destinataire : sans ce filtre, le client lisait dans
// G.factions les ressources et la liste de recherches exactes de l'hote et
// des IA (le bandeau adverse s'interdit deja de les AFFICHER, mais la donnee
// voyageait quand meme). Accessoirement ce sont les seuls champs qui bougent
// en permanence : les retirer est ce qui rend le differentiel de
// construireDelta reellement efficace.
function serialiserFaction(f,prive){
  const d={i:f.id, g:f.genre, e:f.equipe, t:f.teinte, n:f.nom, cv:f.civ,
           ht:f.hostileATous?1:0, a:f.age,
           p:f.pop, mp:f.maxPop, v:f.vaincu?1:0, mv:f.merveilleAchevee?1:0, hr:f.heroTrained?1:0};
  // La reparation automatique est decidee par l'HOTE (applyCommand pose
  // f.autoRepair), mais l'interface du client lit G.autoRepair — un shim vers
  // sa propre faction. Sans ce champ, le client basculait le reglage, l'hote
  // l'appliquait vraiment, et le bouton du client restait eteint pour de bon.
  if(prive){ d.r=f.res; d.q=f.ageUpQ; d.rc=f.research; d.rq=f.researchQ; d.ar=f.autoRepair?1:0; }
  return d;
}
// Toutes les factions telles que le DESTINATAIRE a le droit de les voir : la
// sienne et celles de son equipe en entier, les autres amputees du prive.
function factionsPour(dest){
  const eq=dest?dest.equipe:null;
  return Object.values(G.factions).map(f=>serialiserFaction(f,
    !dest||f.id===dest.id||(eq!=null&&f.equipe===eq)));
}
function appliquerFaction(d){
  let f=G.factions[d.i];
  if(!f){
    f=mkFaction(d.i,{genre:d.g,equipe:d.e,teinte:d.t,nom:d.n,hostileATous:!!d.ht,civ:d.cv});
    G.factions[d.i]=f;
  }
  // Les champs prives manquent legitimement pour une faction adverse (voir
  // serialiserFaction) : ne JAMAIS les ecraser par undefined — mkUnit et
  // mkBuilding lisent f.research a chaque deserialisation.
  if(d.r!=null)  f.res=d.r;
  else if(f.res&&f.res.food==null) f.res={food:0,wood:0,stone:0,gold:0};
  if(d.rc!=null) f.research=d.rc;
  if('q'  in d)  f.ageUpQ=d.q;
  if('rq' in d)  f.researchQ=d.rq;
  if('ar' in d) f.autoRepair=!!d.ar;
  // L'EQUIPE change en cours de partie (ORD.DIPLOMATIE fait passer une IA
  // dans l'equipe du joueur qui s'allie a elle). Elle n'etait posee qu'a la
  // CREATION de la faction : le client gardait donc l'equipe du debut, et son
  // estHostile() repondait l'inverse de celui de l'hote — il voyait son propre
  // allie en rouge, le prenait pour cible, et le comptait encore parmi les
  // rivaux a abattre pour gagner.
  if(d.e!=null) f.equipe=d.e;
  f.age=d.a;
  f.pop=d.p; f.maxPop=d.mp; f.vaincu=!!d.v; f.nom=d.n; f.teinte=d.t;
  if(d.cv) f.civ=d.cv;
  f.merveilleAchevee=!!d.mv;
  f.heroTrained=!!d.hr;
  return f;
}

// ── HOTE : instantane complet ──────────────────────────────────
// N'inclut QUE ce que le destinataire possede ou voit actuellement (P8) —
// exactement le meme critere que construireDelta(). Essentiel : dernier/
// connus* ne doivent memoriser QUE ce qui a reellement ete envoye, sinon un
// futur delta pourrait croire une entite deja connue du client alors qu'elle
// ne lui a jamais ete reveillee (voir le commentaire de visiblePour).
function construireSnap(){
  const dest=RESEAU.adversaire&&G.factions[RESEAU.adversaire.id];
  const visU=G.units.filter(u=>u.owner===(dest&&dest.id)||visiblePour(dest,u.x,u.y));
  const visB=G.buildings.filter(b=>{
    const cx=(b.tx+b.w/2)*BASE_TILE, cy=(b.ty+b.h/2)*BASE_TILE;
    return b.owner===(dest&&dest.id)||visiblePour(dest,cx,cy);
  });
  RESEAU.connusU=new Set(visU.map(u=>u.id));
  RESEAU.connusB=new Set(visB.map(b=>b.id));
  RESEAU.connusW=new Set((G.wildlife||[]).map(w=>w.id));
  RESEAU.dernier.clear();
  for(const u of visU) RESEAU.dernier.set('u'+u.id,{x:u.x,y:u.y,h:u.hp,mh:u.maxHp,s:u.state,g:u.target,d:u.dir});
  for(const b of visB) RESEAU.dernier.set('b'+b.id,{h:b.hp,mh:b.maxHp,p:b.progress,q:JSON.stringify(b.trainQ),f:b.foodLeft,l:b.level,g:b.open,c:!!b.constructing});
  // Amorce le cache du differentiel de factions (voir construireDelta) :
  // ce que le SNAP emporte est, par definition, deja connu du client.
  const facs=factionsPour(dest);
  for(const fs of facs){
    // Amorce sous la MEME forme que construireDelta comparera plus tard : lui
    // retire deja `rc` de l'objet avant de le comparer/mettre en cache (voir
    // plus bas). Amorcer ici avec `fs` TEL QUEL (rc inclus) produisait une
    // chaine que le premier delta ne pouvait plus jamais retrouver egale --
    // chaque connexion se payait donc un envoi complet des factions en trop,
    // l'optimisation ne jouant qu'a partir du DEUXIEME delta. `fs` lui-meme
    // doit rester intact : c'est l'objet renvoye dans le SNAP (facs), amputer
    // `rc` ici priverait le client de la recherche a la premiere reception.
    RESEAU.dernier.set('fr'+fs.i, fs.rc?JSON.stringify(fs.rc):'');
    const{rc,...sansRc}=fs;
    RESEAU.dernier.set('f'+fs.i, JSON.stringify(sansRc));
  }
  return {
    t:'SNAP', tick:RESEAU.tick, gt:+G.gameTime.toFixed(2),
    fac:facs,
    nodes:G.nodes.filter(nd=>nd.amt!==nd.max).map(nd=>[nd.id,nd.amt]), // le reste vient de la graine
    // Reliques : la position vient elle aussi de la graine (genRelics tourne
    // identiquement des deux côtés) — seul le camp qui l'a mise à l'abri voyage.
    relics:(G.relics||[]).filter(r=>r.bankedBy).map(r=>[r.id,r.bankedBy]),
    // Gibier : la position vient elle aussi de la graine ; seuls les PV
    // voyagent. Un animal absent de cette liste = déjà abattu côté hôte.
    wildlife:(G.wildlife||[]).map(w=>[w.id,w.hp]),
    uni:visU.map(serialiserUnite),
    bat:visB.map(serialiserBatiment),
    wave:G.wave, waveTimer:G.waveTimer, waveActive:G.waveActive,
  };
}

// ── HOTE : delta ───────────────────────────────────────────────
// Masque de bits par entite ; seuls les champs qui ont bouge voyagent.
// M_MAXHP : les recherches (Armure de Fer) et les montees d'age recalculent
// le maxHp des unites DEJA sur la carte. Sans ce bit, le client gardait le
// maxHp du jour de leur creation : barres de vie faussees, « PV : 130/100 »
// dans le panneau. Les batiments transmettaient deja le leur (e[8]).
//
// M_ATK et M_XP ferment le MEME trou pour les trois autres champs
// retro-calcules par l'hote, oublies quand M_MAXHP a ete ajoute :
//   • `atk`  — releve par les MEMES deux chemins que maxHp (la boucle de
//     montee d'age, et awardKillXP). Affiche tel quel dans le panneau de
//     selection (« ATK: 13 ») : sans ce bit il y restait fige a vie.
//   • `xp` et `rank` — la veterance (awardKillXP). Le rang se voit a l'ecran
//     (insigne sous l'unite) et dans le panneau (« 🎖️ Veteran (3 victoires) ») ;
//     sans eux, aucune unite n'etait JAMAIS promue chez le client.
// Les deux voyagent, plutot que de recalculer rank=veterancyRank(xp) cote
// client : c'est la meme regle que pour `constructing` — un champ que l'hote
// decide ne se redevine pas chez le destinataire.
const M_X=1, M_Y=2, M_HP=4, M_ETAT=8, M_CIBLE=16, M_DIR=32, M_MAXHP=64,
      M_ATK=128, M_XP=256;

// Brouillard d'une faction ARBITRAIRE (pas forcement la locale, contrairement
// a fogTileAt/G.fog) : sert a filtrer ce que l'hote envoie a l'adversaire.
function fogTileDe(faction,tx,ty){
  if(!faction||!faction.fog||!faction.fog.length) return 2;
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS) return 0;
  return faction.fog[ty][tx];
}
// Une entite est transmise au DESTINATAIRE si elle lui appartient ou si elle
// se trouve sur une case qu'il voit ACTUELLEMENT (fog===2). Ferme une partie
// du trou de securite "le client lit G dans la console et voit toute la
// carte" signale au plan (P6, visibilite v1) : desormais, hors de sa propre
// vue, il ne reçoit tout simplement pas l'entite.
function visiblePour(dest,x,y){
  if(!dest) return true; // pas de destinataire identifie (ex. avant P7) : ne rien filtrer
  return fogTileDe(dest,(x/BASE_TILE)|0,(y/BASE_TILE)|0)===2;
}

// Signature compacte du point de ralliement, pour la comparaison au tour
// precedent. Arrondie comme ce qui part sur le fil : sinon un rally place a
// 12,0001 se croirait different de celui deja envoye a chaque image.
function cleRalliement(b){
  return b.rally?(Math.round(b.rally.x)+','+Math.round(b.rally.y)):'';
}

function construireDelta(){
  const d={t:'D', tick:RESEAU.tick, u:[], b:[], n:[], rm:[], rmb:[], rl:[], w:[], rmw:[]};
  const vus=new Set(), vusB=new Set();
  // Faction qui RECEVRA ce delta : c'est TOUJOURS l'adversaire (l'hote ne
  // s'envoie pas de messages a lui-meme).
  const dest=RESEAU.adversaire&&G.factions[RESEAU.adversaire.id];

  for(const u of G.units){
    // Hors de la vue du destinataire et pas la sienne : ne JAMAIS l'inclure,
    // qu'elle soit nouvelle ou deja connue. Si elle etait connue, on la
    // traite comme disparue (voir plus bas) plutot que de risquer un ecart
    // silencieux entre RESEAU.dernier et ce qui a reellement ete envoye.
    if(!visiblePour(dest,u.x,u.y)&&u.owner!==(dest&&dest.id)) continue;
    vus.add(u.id);
    const cle='u'+u.id, av=RESEAU.dernier.get(cle);
    if(!av){                                   // nouvelle unite : complete
      (d.newU||(d.newU=[])).push(serialiserUnite(u));
      RESEAU.dernier.set(cle,{x:u.x,y:u.y,h:u.hp,mh:u.maxHp,s:u.state,g:u.target,d:u.dir,
                             a:u.atk,e:u.xp||0,rk:u.rank||0});
      continue;
    }
    let masque=0; const ch=[];
    if(Math.abs(u.x-av.x)>SEUIL_POS){ masque|=M_X; ch.push(Math.round(u.x)); av.x=u.x; }
    if(Math.abs(u.y-av.y)>SEUIL_POS){ masque|=M_Y; ch.push(Math.round(u.y)); av.y=u.y; }
    if(u.hp!==av.h){ masque|=M_HP; ch.push(u.hp); av.h=u.hp; }
    if(u.state!==av.s){ masque|=M_ETAT; ch.push(u.state); av.s=u.state; }
    if((u.target||null)!==(av.g||null)){ masque|=M_CIBLE; ch.push(u.target||null); av.g=u.target; }
    if(Math.abs((u.dir||0)-(av.d||0))>0.25){ masque|=M_DIR; ch.push(+(u.dir||0).toFixed(2)); av.d=u.dir; }
    if(u.maxHp!==av.mh){ masque|=M_MAXHP; ch.push(u.maxHp); av.mh=u.maxHp; }
    if(u.atk!==av.a){ masque|=M_ATK; ch.push(u.atk); av.a=u.atk; }
    // xp et rang bougent ENSEMBLE (awardKillXP) : un seul bit pour les deux.
    if((u.xp||0)!==av.e||(u.rank||0)!==av.rk){
      masque|=M_XP; ch.push(u.xp||0,u.rank||0); av.e=u.xp||0; av.rk=u.rank||0;
    }
    if(masque) d.u.push([u.id,masque].concat(ch));
  }
  for(const id of RESEAU.connusU) if(!vus.has(id)){ d.rm.push(id); RESEAU.dernier.delete('u'+id); }
  RESEAU.connusU=vus;

  for(const b of G.buildings){
    // Batiments : une fois VUS, ils restent CONNUS (souvenir, comme dans
    // AoE) — on marque toujours "vusB" un batiment deja connu (jamais de
    // faux retrait pour simple perte de vue), mais on ne le REVELE ni ne le
    // MET A JOUR tant qu'il n'est pas actuellement visible.
    const centreX=(b.tx+b.w/2)*BASE_TILE, centreY=(b.ty+b.h/2)*BASE_TILE;
    const cle='b'+b.id, connu=RESEAU.dernier.has(cle);
    const visible=b.owner===(dest&&dest.id)||visiblePour(dest,centreX,centreY);
    if(!visible&&!connu) continue;         // jamais vu, toujours hors champ : rien a faire
    vusB.add(b.id);
    if(!visible) continue;                 // connu mais hors champ : reste tel quel cote client
    const av=RESEAU.dernier.get(cle);
    if(!av){
      (d.newB||(d.newB=[])).push(serialiserBatiment(b));
      RESEAU.dernier.set(cle,{h:b.hp,mh:b.maxHp,p:b.progress,q:JSON.stringify(b.trainQ),f:b.foodLeft,l:b.level,g:b.open,c:!!b.constructing,
                             a:!!b.autoTrain,ry:cleRalliement(b)});
      continue;
    }
    const q=JSON.stringify(b.trainQ);
    const ry=cleRalliement(b);
    // `constructing` et `maxHp` voyagent EXPLICITEMENT. Les deduire cote
    // client (progress>=1) etait un piege : le dernier pas de chantier fait
    // moins que le seuil de progression, aucun delta n'etait emis, et le
    // batiment restait "en travaux" a jamais chez le client.
    if(b.hp!==av.h||b.maxHp!==av.mh||Math.abs(b.progress-av.p)>0.004||q!==av.q
       ||b.foodLeft!==av.f||b.level!==av.l||b.open!==av.g||(!!b.constructing)!==av.c
       ||(!!b.autoTrain)!==av.a||ry!==av.ry){
      d.b.push([b.id,b.hp,+b.progress.toFixed(3),b.trainQ,b.foodLeft,b.level,
                b.open?1:0,b.constructing?1:0,b.maxHp,
                b.autoTrain?1:0,b.rally?[Math.round(b.rally.x),Math.round(b.rally.y)]:null]);
      av.h=b.hp; av.mh=b.maxHp; av.p=b.progress; av.q=q;
      av.f=b.foodLeft; av.l=b.level; av.g=b.open; av.c=!!b.constructing;
      av.a=!!b.autoTrain; av.ry=ry;
    }
  }
  for(const id of RESEAU.connusB) if(!vusB.has(id)){ d.rmb.push(id); RESEAU.dernier.delete('b'+id); }
  RESEAU.connusB=vusB;

  // Gisements entames depuis le dernier envoi
  for(const nd of G.nodes){
    const cle='n'+nd.id, av=RESEAU.dernier.get(cle);
    if(av===undefined){ if(nd.amt!==nd.max){ d.n.push([nd.id,nd.amt]); RESEAU.dernier.set(cle,nd.amt); } }
    else if(av!==nd.amt){ d.n.push([nd.id,nd.amt]); RESEAU.dernier.set(cle,nd.amt); }
  }

  // Reliques mises a l'abri depuis le dernier envoi (la position ne bouge
  // jamais, seul bankedBy — jamais repris une fois livre, voir doRelic).
  for(const r of (G.relics||[])){
    if(!r.bankedBy) continue;
    const cle='rl'+r.id;
    if(RESEAU.dernier.get(cle)!==r.bankedBy){ d.rl.push([r.id,r.bankedBy]); RESEAU.dernier.set(cle,r.bankedBy); }
  }

  // Gibier : PV entames depuis le dernier envoi, et retrait des animaux abattus.
  const vusW=new Set();
  for(const w of (G.wildlife||[])){
    vusW.add(w.id);
    const cle='w'+w.id, av=RESEAU.dernier.get(cle);
    if(av===undefined){ if(w.hp!==w.maxHp){ d.w.push([w.id,w.hp]); RESEAU.dernier.set(cle,w.hp); } }
    else if(av!==w.hp){ d.w.push([w.id,w.hp]); RESEAU.dernier.set(cle,w.hp); }
  }
  for(const id of RESEAU.connusW) if(!vusW.has(id)){ d.rmw.push(id); RESEAU.dernier.delete('w'+id); }
  RESEAU.connusW=vusW;

  // Factions : caisse, age, population, recherches. DIFFERENTIEL, comme le
  // reste du delta : cet objet pesait a lui seul 2,1 Ko sur les 2,2 Ko d'un
  // delta au repos — 95 % de la bande passante — reexpedies dix fois par
  // seconde alors qu'il ne change qu'a la recolte, a la montee d'age ou a une
  // recherche. Les recherches (240 o par faction) sortent en plus du lot :
  // elles ne bougent que neuf fois dans une partie.
  for(const fs of factionsPour(dest)){
    const cleR='fr'+fs.i, sR=fs.rc?JSON.stringify(fs.rc):'';
    const rcChange=RESEAU.dernier.get(cleR)!==sR;
    if(rcChange) RESEAU.dernier.set(cleR,sR); else delete fs.rc;
    const cle='f'+fs.i, s=JSON.stringify(fs);
    if(!rcChange&&RESEAU.dernier.get(cle)===s) continue;
    RESEAU.dernier.set(cle,s);
    (d.fac||(d.fac=[])).push(fs);
  }
  // Projectiles : trop peu nombreux pour meriter un differentiel
  d.p=G.projs.map(pr=>[pr.x|0,pr.y|0,pr.tx|0,pr.ty|0,pr.owner||'']);
  d.gt=+G.gameTime.toFixed(2);
  d.wave=G.wave;
  return d;
}

// ── CLIENT : application ───────────────────────────────────────
function appliquerSnap(m){
  G.gameTime=m.gt;
  for(const f of m.fac) appliquerFaction(f);
  for(const [id,amt] of (m.nodes||[])){ const nd=G.nodes.find(x=>x.id===id); if(nd) nd.amt=amt; }
  for(const [id,owner] of (m.relics||[])){ const r=G.relics&&G.relics.find(x=>x.id===id); if(r) r.bankedBy=owner; }
  if(m.wildlife){
    const vus=new Set(m.wildlife.map(w=>w[0]));
    G.wildlife=(G.wildlife||[]).filter(w=>vus.has(w.id)); // absent du SNAP = déjà abattu
    for(const [id,hp] of m.wildlife){ const w=G.wildlife.find(x=>x.id===id); if(w) w.hp=hp; }
  }
  // Les batiments repassent par placeBuilding : la grille de blocage doit
  // refleter exactement celle de l'hote, sinon le pathfinding local diverge.
  G.buildings=[];
  // Purge des marques laissees par des batiments (1=ferme, 3=solide,
  // 9=reserve) : le terrain lui-meme (eau, gisements) ne doit pas bouger.
  //
  // ATTENTION : l'EAU est elle aussi marquee 3 par genMap (`b[y][x]=3` sur
  // les lacs) -- exactement la meme valeur qu'un batiment solide. La purge
  // remettait donc les ~1900 cases de lac a 0 : des le PREMIER snapshot
  // recu, les lacs cessaient de bloquer le passage CHEZ LE CLIENT
  // uniquement, ses unites traversaient l'eau et son pathfinding divergeait
  // de celui de l'hote -- l'invariant meme que le commentaire ci-dessus
  // pretend proteger. On re-derive donc la marque du terrain au lieu de la
  // mettre a zero aveuglement. (Trouve par tests/run.js, groupe `reseau` ;
  // invisible a l'oeil : la carte s'affiche pareil, seuls les deplacements
  // divergent, et seulement chez l'invite.)
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    const v=G.bmap[y][x];
    if(v===1||v===3||v===9) G.bmap[y][x]=(G.tiles[y][x]===T_WATER)?3:0;
  }
  for(const bd of m.bat) placeBuilding(deserialiserBatiment(bd)); // placeBuilding pousse lui-meme
  G.units=m.uni.map(deserialiserUnite);
  G.wave=m.wave; G.waveTimer=m.waveTimer; G.waveActive=m.waveActive;
  G.nid=Math.max(...[...G.units,...G.buildings,...G.nodes].map(e=>e.id||0),0)+1;
  rebuildIndex();
  updatePopCap();
  revealFog();
  refreshUI();
}

function appliquerDelta(m){
  if(m.gt!=null) G.gameTime=m.gt;
  if(m.wave!=null) G.wave=m.wave;
  if(m.fac) for(const f of m.fac) appliquerFaction(f);

  // Resolution par INDEX plutot que par balayage : un `find` sur les ~460
  // gisements pour chaque entree du delta, dix fois par seconde, finissait
  // par couter plus cher que tout le reste du decodage reuni.
  for(const nd of (m.n||[])){ const x=nodeById(nd[0]); if(x) x.amt=nd[1]; }
  if(m.rl&&m.rl.length&&G.relics)
    for(const rl of m.rl){ const x=G.relics.find(z=>z.id===rl[0]); if(x&&!x.bankedBy) x.bankedBy=rl[1]; }
  if((m.w&&m.w.length)||(m.rmw&&m.rmw.length)){
    const iw=new Map(); for(const w of (G.wildlife||[])) iw.set(w.id,w);
    for(const wd of (m.w||[])){ const x=iw.get(wd[0]); if(x) x.hp=wd[1]; }
    if(m.rmw&&m.rmw.length){
      const abattus=new Set(m.rmw);              // un seul balayage pour tout le lot
      G.wildlife=(G.wildlife||[]).filter(z=>!abattus.has(z.id));
    }
  }

  // bldById/unitById plutot que .some() : l'index est reconstruit a la fin
  // de chaque delta, et l'hote ne peut pas annoncer deux fois la meme entite
  // dans un meme lot (il les tire d'un Set).
  for(const bd of (m.newB||[])){
    if(bldById(bd.i)) continue;
    placeBuilding(deserialiserBatiment(bd));
  }
  for(const ud of (m.newU||[])){
    if(unitById(ud.i)) continue;
    G.units.push(deserialiserUnite(ud));
  }
  rebuildIndex();

  for(const e of (m.u||[])){
    const u=unitById(e[0]); if(!u) continue;
    const masque=e[1]; let k=2;
    if(masque&M_X)     u._netX=e[k++];
    if(masque&M_Y)     u._netY=e[k++];
    if(masque&M_HP)    { const av=u.hp; u.hp=e[k++]; if(u.hp<av) u.hitFlash=0.15; }
    if(masque&M_ETAT)  u.state=e[k++];
    if(masque&M_CIBLE) u.target=e[k++];
    if(masque&M_DIR)   u.dir=e[k++];
    if(masque&M_MAXHP) u.maxHp=e[k++];
    if(masque&M_ATK)   u.atk=e[k++];
    if(masque&M_XP)    { u.xp=e[k++]; u.rank=e[k++]; }
  }
  for(const e of (m.b||[])){
    const b=bldById(e[0]); if(!b) continue;
    const avHp=b.hp, avOuvert=b.open;
    b.hp=e[1]; b.progress=e[2]; b.trainQ=e[3]; b.foodLeft=e[4];
    b.level=e[5]; b.open=!!e[6];
    b.constructing=!!e[7];        // autoritaire : jamais deduit
    if(e[8]!=null) b.maxHp=e[8];
    // `autoTrain` et `rally` ne sont poses que par applyCommand, donc par
    // l'HOTE. Sans eux ici, le client gardait un autoTrain eteint a vie : son
    // bouton affichait « Auto OFF » en permanence et renvoyait donc toujours
    // actif:true — il pouvait allumer la production continue, jamais
    // l'eteindre. Et son drapeau de ralliement ne s'affichait jamais.
    if(e[9]!=null) b.autoTrain=!!e[9];
    if(e[10]!==undefined) b.rally=e[10]?{x:e[10][0],y:e[10][1]}:null;
    if(b.hp<avHp) b.hitFlash=0.15;
    // Un portail qui s'ouvre ou se ferme change la grille de blocage : sans
    // ca le pathfinding local du client diverge de celui de l'hote.
    if(b.open!==avOuvert&&b.type===BT.GATE){
      const mark=b.open?0:3;
      for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++)
        if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=mark;
    }
  }

  // Retraits : c'est ici que le client apprend les morts et les destructions.
  // Un seul balayage du tableau pour TOUT le lot : reconstruire G.units a
  // chaque identifiant retire coutait autant de copies du tableau qu'il y
  // avait de morts — precisement au moment ou le lot est le plus gros.
  if((m.rm||[]).length){
    const morts=new Set();
    for(const id of m.rm){
      const u=unitById(id); if(!u) continue;
      morts.add(id);
      G.deathfx.push({type:u.type,x:u.x,y:u.y,dir:u.dir||0,life:1,teinte:(fac(u)||{}).teinte||'rouge',civ:civKeyOf(u.owner)});
      spawnParts(u.x,u.y,couleurMinimap(u,true),8);
    }
    if(morts.size){
      G.units=G.units.filter(z=>!morts.has(z.id));
      G.sel=G.sel.filter(z=>!morts.has(z));
    }
  }
  if((m.rmb||[]).length){
    const rases=new Set();
    for(const id of m.rmb){
      const b=bldById(id); if(!b) continue;
      rases.add(id);
      spawnParts(b.x,b.y,'#e74c3c',14);
      for(let dy=0;dy<b.h;dy++) for(let dx=0;dx<b.w;dx++) if(G.bmap[b.ty+dy]) G.bmap[b.ty+dy][b.tx+dx]=0;
    }
    if(rases.size){
      G.buildings=G.buildings.filter(z=>!rases.has(z.id));
      G.sel=G.sel.filter(z=>!rases.has(z));
    }
  }
  if((m.rm||[]).length||(m.rmb||[]).length){ rebuildIndex(); updatePopCap(); }

  // Projectiles : etat complet, ils sont trop peu nombreux pour un differentiel
  if(m.p){
    G.projs=m.p.map(q=>({id:G.nid++,x:q[0],y:q[1],tx:q[2],ty:q[3],owner:q[4]||null,
                         targetId:null,atk:0,spd:8*BASE_TILE,life:1,d0:1}));
  }
}

// ── CLIENT : mise a jour purement visuelle ─────────────────────
// Le client ne simule RIEN : il interpole vers l'etat recu et fait vivre les
// effets locaux (particules, textes flottants, silhouettes de mort, camera).
let _fogClientT=0;
function updateVisuel(dt){
  G.dt=dt;
  G.gameTime+=dt;                       // avance douce entre deux deltas
  G.dayPhase=(G.gameTime/90)%1;
  rebuildGrid();          // reconstruit deja l'index id -> entite, inutile de le refaire

  const k=Math.min(1,dt*14);            // lissage de l'interpolation
  for(const u of G.units){
    if(u._netX==null){ u._netX=u.x; u._netY=u.y; }
    const dx=u._netX-u.x, dy=u._netY-u.y;
    const dist=Math.hypot(dx,dy);
    if(dist>BASE_TILE*2){                // teleportation ou resynchronisation
      u.x=u._netX; u.y=u._netY; u.moving=false;
    } else if(dist>0.5){
      u.x+=dx*k; u.y+=dy*k;
      u.moving=true; u.dir=Math.atan2(dy,dx);
      u.animT+=dt;
    } else {
      u.moving=false;
    }
    if(u.hitFlash) u.hitFlash=Math.max(0,u.hitFlash-dt);
    if(u.atkCd) u.atkCd=Math.max(0,u.atkCd-dt);
  }
  for(const b of G.buildings) if(b.hitFlash) b.hitFlash=Math.max(0,b.hitFlash-dt);

  updateProjs(dt); updateParts(dt); updateFTexts(dt); updateDeathFx(dt);
  if(G.shake.mag>0) G.shake.mag=Math.max(0,G.shake.mag-dt*14);
  updateSpriteRebuild(dt);
  updateGlide(dt);
  G.mtTimer=Math.max(0,G.mtTimer-dt);

  _fogClientT-=dt;
  if(_fogClientT<=0){ revealFog(); _fogClientT=0.2; }

  // Fin de partie : l'hote fait foi, mais l'affichage est local.
  if(moi()&&moi().vaincu&&!G.gameOver){ G.gameOver=true; showGameOver(); }
  checkMerveilleVictory();
  if(!G.victory&&!G.gameOver){
    const rivaux=factionsJouantes().filter(f=>f.id!==G.me&&f.equipe!==(moi()?moi().equipe:-1));
    if(rivaux.length&&rivaux.every(f=>f.vaincu)){ G.victory=true; showVictory(); }
  }
}

// ── ROUTAGE DES MESSAGES ───────────────────────────────────────
function recevoirReseau(m){
  // Un SNAP compresse (ou, plus tard, un delta binaire) arrive comme
  // ArrayBuffer plutot que comme objet deja decode : le decodage est
  // asynchrone, recevoirReseau() sera rappelee une fois le contenu pret.
  if(m instanceof ArrayBuffer){ decoderMessageBinaire(m); return; }
  if(!m||!m.t) return;
  RESEAU.dernierRecu=Date.now();
  // Tout message reçu prouve que le lien est vivant : sortir immédiatement
  // de l'attente de reconnexion plutôt que d'attendre le prochain battement.
  if(RESEAU.enAttenteReconnexion&&m.t!=='PAUSE'&&m.t!=='REPRISE') sortirAttenteReconnexion();
  switch(m.t){
    case 'SALUT':  demarrerPartieClient(m); break;
    case 'PRET':   if(RESEAU.role==='hote'){ RESEAU.pret=true; envoyerReseau(construireSnap()); } break;
    case 'SNAP':   appliquerSnap(m); RESEAU.pret=true; break;
    case 'D':      if(RESEAU.pret) appliquerDelta(m); break;
    case 'ORDRE':  traiterOrdreDistant(m); break;
    case 'REJ':    traiterRejet(m); break;
    case 'BAT':    break; // pouls : dernierRecu vient d'etre rafraichi plus haut
    case 'CHAT':   break; // gere par le panneau de salon
    case 'PAUSE':  appliquerPauseDistante(true,m.par,m.nom); break;
    case 'REPRISE':appliquerPauseDistante(false,m.par,m.nom); break;
    case 'ABANDON':traiterAbandon(m); break;
    case 'EMOTE':  afficherEmote(m.par,m.code,false); break;
    case 'FIN':    RESEAU.finRecue=m; break;
    case 'RESYNC': traiterResync(); break;
    case 'RESYNC_ECHEC':
      notify('🔌 Impossible de reprendre : '+(m.raison||'la partie est terminée'),'#e74c3c');
      effacerRejoinEnLigne();
      break;
  }
}

// Hôte : un client revenu d'un rechargement de page demande l'état courant
// (pas l'état initial) — on lui renvoie le même message SALUT qu'au tout
// premier lancement ; demarrerPartieClient() le traite alors exactement
// comme un lancement normal, sans code séparé à maintenir. RESEAU.adversaire
// n'a pas bougé : le salon (même code, même uid Firebase) désigne toujours
// le même camp.
function traiterResync(){
  if(RESEAU.role!=='hote'||!RESEAU.actif){
    envoyerReseau({t:'RESYNC_ECHEC',raison:'la partie est terminée'});
    return;
  }
  const f=RESEAU.adversaire&&G.factions[RESEAU.adversaire.id];
  if(!f||f.genre!=='humain'||f.vaincu){
    envoyerReseau({t:'RESYNC_ECHEC',
      raison:(f&&f.genre==='ia')?'votre camp a été repris par l\'IA en votre absence':'la partie est terminée'});
    return;
  }
  envoyerReseau(construireSalut());
  notify('🔌 '+(f.nom||'Votre allié')+' a rejoint la partie en cours','#2ecc71');
}

// Hote : un ordre venu du client. applyCommand revalide TOUT (P3) — c'est la
// seule protection contre un ordre forge, et elle suffit pour l'invite.
function traiterOrdreDistant(m){
  if(RESEAU.role!=='hote') return;
  const cmd=m.cmd;
  if(!cmd||cmd.f!==RESEAU.adversaire.id) return;   // on ne joue pas pour l'autre
  const r=applyCommand(cmd);
  if(!r.ok) envoyerReseau({t:'REJ',seq:cmd.seq,raison:r.raison});
}

// Client : l'hote a refuse un ordre — on annule la prediction optimiste.
function traiterRejet(m){
  const att=RESEAU.attente.get(m.seq);
  RESEAU.attente.delete(m.seq);
  if(!att) return;
  if(att.annuler) try{ att.annuler(); }catch(e){}
  const t={ressources:'Ressources insuffisantes !', pop:'Population maximale !',
           age:'Age requis non atteint', occupe:'Placement impossible !',
           invalide:'Action impossible', cible:'Cible invalide'};
  notify(t[m.raison]||'Action refusee','#e74c3c');
  refreshUI();
}

// ── DEMARRAGE D'UNE PARTIE EN RESEAU ───────────────────────────
// Construit le message SALUT decrivant l'etat courant (pas forcement
// l'etat INITIAL : reutilise tel quel pour renvoyer un etat a jour a un
// client qui revient d'un rechargement de page, voir RESYNC plus bas).
function construireSalut(){
  return {
    t:'SALUT', proto:PROTO_VERSION,
    // Le type de carte voyage AVEC la graine : les deux ensemble decident du
    // monde genere. Sans lui, l'hote en Grands Lacs et l'invite en Plaines
    // partaient sur deux cartes differentes avec la meme graine, et TOUT
    // divergeait des la premiere image.
    // Idem pour la TAILLE de la carte : type et taille ensemble décident du
    // monde que la graine engendre.
    seed:G.seed, carte:G.carte, taille:G.taille, gmode:G.gmode, difficulty:G.difficulty,
    cols:COLS, rows:ROWS, simHz:SIM_HZ,
    fac:factionsPour(RESEAU.adversaire&&G.factions[RESEAU.adversaire.id]),
    toi:FAC.P2,
  };
}

// L'hote lance la partie, puis decrit au client ce qu'il doit generer.
function demarrerPartieHote(adversaire){
  RESEAU.actif=true; RESEAU.role='hote';
  RESEAU.adversaire={id:FAC.P2, nom:adversaire&&adversaire.nom||'Adversaire'};
  RESEAU.tick=0; RESEAU.accDelta=0; RESEAU.pret=false;
  RESEAU.pausesRestantes=3; RESEAU.finRecue=null;
  startGame();
  mpVerrouillerVitesse();
  demarrerVeilleReseau();
  envoyerReseau(construireSalut());
}

// Le client regenere la MEME carte a partir de la graine (P4) : seuls les
// entites et l'etat des camps voyagent, jamais les 57 600 tuiles.
function demarrerPartieClient(m){
  if(m.proto!==PROTO_VERSION){ notify('Version de protocole incompatible','#e74c3c'); return; }
  RESEAU.actif=true; RESEAU.role='client'; RESEAU.pret=false;
  RESEAU.adversaire={id:FAC.P1, nom:(m.fac.find(f=>f.i===FAC.P1)||{}).n||'Hote'};

  SFX.unlock();
  document.getElementById('overlay').style.display='none';
  const mp=document.getElementById('mppanel'); if(mp) mp.style.display='none';
  resizeCanvas();

  selectedMode=m.gmode; selectedDifficulty=m.difficulty;
  // AVANT initState : c'est lui qui fige G.carte ET G.taille pour la partie
  // (et c'est appliquerTailleCarte, appelé par initState, qui pose COLS/ROWS).
  if(m.carte&&CARTES[m.carte]) selectedCarte=m.carte;
  if(m.taille&&TAILLES[m.taille]) selectedTaille=m.taille;
  grainePartie=m.seed;
  initState();
  G.seed=m.seed;
  G.factions={};
  for(const f of m.fac) appliquerFaction(f);
  G.me=m.toi; G.hote=false;

  TILE=Math.round(BASE_TILE*ZOOMS[zoomLevel]);
  genMap();                 // meme graine => carte identique a celle de l'hote
  buildSprites();
  G.running=true;
  setSpeed(1);
  rebuildIndex();
  applyDifficultyBadge();
  refreshUI();
  RESEAU.pausesRestantes=3; RESEAU.finRecue=null;
  mpVerrouillerVitesse();
  demarrerVeilleReseau();
  sauverRejoinEnLigne(_mpEtat.code);
  envoyerReseau({t:'PRET'});
  requestAnimationFrame(loop);
  notify('Partie en ligne — en attente de l\'etat initial…','#3498db');
}

// ── EMISSION DES DELTAS (hote) ─────────────────────────────────
function pousserReseau(dt){
  if(!RESEAU.actif||RESEAU.role!=='hote'||!RESEAU.pret||RESEAU.snapEnVol) return;
  RESEAU.accDelta+=dt;
  if(RESEAU.accDelta<DELTA_PERIODE) return;
  RESEAU.accDelta=0;
  RESEAU.tick++;
  envoyerReseau(construireDelta());
}


// \u2500\u2500 PAUSE PARTAGEE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// N'importe qui peut mettre en pause ou reprendre ; cote hote, c'est cette
// pause qui gele reellement la simulation (loop() respecte G.paused quel
// que soit le role). Limite anti-abus : 3 pauses de 90 s par joueur et par
// partie, pour eviter qu'un camp ne fige la partie a volonte.
// Appele par openPause() AVANT d'afficher le menu : decompte le budget,
// previent l'adversaire, arme la reprise automatique a 90 s. Le menu
// pause LUI-MEME sert d'indicateur visuel pour qui l'a ouvert ; le voile
// leger (#mp-pause-voile) n'est montre qu'a l'AUTRE camp, voir plus bas.
function mpDemanderPause(){
  if(RESEAU.pausesRestantes<=0){ notify('Plus de pause disponible pour cette partie','#e67e22'); return false; }
  RESEAU.pausesRestantes--;
  envoyerReseau({t:'PAUSE', par:G.me, nom:(moi()&&moi().nom)||'Joueur'});
  RESEAU.pauseMinuteur=setTimeout(()=>closePause(),90000);
  return true;
}
// Appele par closePause() apres avoir referme le menu localement.
function mpLeverPause(){
  if(RESEAU.pauseMinuteur){ clearTimeout(RESEAU.pauseMinuteur); RESEAU.pauseMinuteur=null; }
  envoyerReseau({t:'REPRISE', par:G.me});
}
// Reaction a une pause/reprise decidee par l'AUTRE camp. La pause est un
// etat PARTAGE et symetrique ("n'importe qui peut mettre en pause, n'importe
// qui peut reprendre") : peu importe qui a initie, un REPRISE recu leve
// TOUJOURS la pause ici, y compris en refermant mon propre menu s'il etait
// ouvert \u2014 sans quoi l'hote (seul a faire tourner la simulation) resterait
// gele meme apres que l'adversaire ait explicitement repris.
function appliquerPauseDistante(actif,par,nom){
  if(actif){
    if(G.paused) return;
    G.paused=true;
    // Si MON propre menu est deja ouvert (pause quasi simultanee des deux
    // cotes), il fait deja office d'indicateur : pas besoin du voile en plus.
    if(document.getElementById('pausemenu').style.display!=='flex') afficherVoilePause(true,nom||'Votre adversaire');
  } else {
    G.paused=false;
    afficherVoilePause(false);
    if(RESEAU.pauseMinuteur){ clearTimeout(RESEAU.pauseMinuteur); RESEAU.pauseMinuteur=null; }
    const pm=document.getElementById('pausemenu');
    if(pm.style.display==='flex'){
      pm.style.display='none';
      document.getElementById('pausebtn-inner').innerHTML=iconImg('\u23f8',16);
    }
    requestAnimationFrame(loop);
  }
}
function afficherVoilePause(visible,nom){
  const el=document.getElementById('mp-pause-voile');
  if(!el) return;
  el.style.display=visible?'flex':'none';
  if(visible) el.querySelector('.mpv-qui').textContent='Pause demand\u00e9e par '+nom;
}
// Bouton "Reprendre" du voile leger : n'importe qui peut lever la pause,
// que ce soit la sienne ou celle de l'adversaire (voir appliquerPauseDistante
// pour la symetrie du cote reception).
function mpLeverPauseDepuisVoile(){
  G.paused=false;
  afficherVoilePause(false);
  if(RESEAU.pauseMinuteur){ clearTimeout(RESEAU.pauseMinuteur); RESEAU.pauseMinuteur=null; }
  envoyerReseau({t:'REPRISE', par:G.me});
  requestAnimationFrame(loop);
}
window.mpLeverPauseDepuisVoile=mpLeverPauseDepuisVoile;

// \u2500\u2500 ABANDON \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function mpAbandonner(){
  if(!reseauActif()) return;
  const texteAbandon=mpEstCoop()
    ? 'Abandonner la partie ? Votre alli\u00e9 continuera seul contre l\'IA.'
    : 'Abandonner la partie ? Votre adversaire remportera la victoire.';
  if(!confirm(texteAbandon)) return;
  effacerRejoinEnLigne();
  envoyerReseau({t:'ABANDON', par:G.me});
  const f=G.factions[G.me]; if(f) f.vaincu=true;
  if(!G.gameOver){ G.gameOver=true; showGameOver(); }
}
window.mpAbandonner=mpAbandonner;
function traiterAbandon(m){
  const f=G.factions[m.par]; if(!f) return;
  f.vaincu=true; // le controle habituel de fin de partie (update()) tranche a la prochaine image
  notify('\uD83C\uDFF3\uFE0F '+f.nom+' a abandonn\u00e9','#f0c040');
  // Celui qui abandonne coupe aussi son pouls : sans ce nettoyage, le camp
  // reste en place voyait trois secondes plus tard un bandeau « connexion
  // perdue », puis la boite « votre adversaire ne revient pas » — alors
  // qu'il vient precisement d'apprendre que l'autre a renonce.
  if(RESEAU.role==='hote'){
    // L'hote garde la simulation : la partie continue hors ligne, contre les
    // IA restantes (en 1v1+IA comme en 2v1 coop).
    quitterSessionReseau();
  } else {
    // Le client, lui, ne simule RIEN : sans l'hote plus aucune image ne peut
    // avancer. On lui sert tout de suite l'ecran deja prevu pour ce cas
    // plutot que de le laisser trois minutes devant un plateau fige.
    afficherEcranHoteParti();
  }
}

// \u2500\u2500 SIGNAUX RAPIDES (chat 1 clic, touches 1-4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const EMOTES=[
  {code:'attaque', ico:'\u2694\uFE0F', texte:"J'attaque !"},
  {code:'aide',    ico:'🛡',  texte:'\u00c0 l\'aide !'},
  {code:'ok',      ico:'👍',  texte:'Bien re\u00e7u'},
  {code:'rire',    ico:'😄',  texte:'Ha !'},
];
function mpEmote(code){
  if(!reseauActif()) return;
  envoyerReseau({t:'EMOTE', par:G.me, code});
  afficherEmote(G.me,code,true);
}
window.mpEmote=mpEmote;
function afficherEmote(par,code,local){
  const e=EMOTES.find(x=>x.code===code); if(!e) return;
  const nom=local?((moi()&&moi().nom)||'Vous'):((RESEAU.adversaire&&RESEAU.adversaire.nom)||'Adversaire');
  mpLigne(e.ico+' '+nom+' : '+e.texte, local?'moi':'lui');
  if(!local) notify(e.ico+' '+nom+' : '+e.texte,'#f0c040');
  buzz(6);
}
// Touches Alt+1-4 : raccourci clavier pour les emotes (le bouton tactile
// reste le chemin principal, indispensable sur mobile). Alt et non les
// chiffres nus : 1-9 sont deja pris par les groupes de controle.
window.addEventListener('keydown',e=>{
  if(!reseauActif()) return;
  if(!e.altKey) return;
  const cible=e.target;
  if(cible&&(cible.tagName==='INPUT'||cible.tagName==='TEXTAREA')) return;
  const idx='1234'.indexOf(e.key);
  if(idx>=0&&EMOTES[idx]){ mpEmote(EMOTES[idx].code); e.preventDefault(); }
});

// \u2500\u2500 VITESSE VERROUILLEE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// setSpeed() est deja la SEULE porte d'entree pour changer G.speed : on y
// impose 1 en reseau plutot que de dupliquer la regle a chaque appelant.
function mpVerrouillerVitesse(){
  document.querySelectorAll('.spd-ctrl').forEach(el=>el.classList.toggle('locked',reseauActif()));
}

// \u2500\u2500 BANDEAU ADVERSE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Nom, teinte, age, population \u2014 jamais les ressources : c'est la seule
// information que le brouillard de guerre ne cache pas deja.
// Même principe que updateHUD : en solo (le cas le plus courant) ce bandeau
// est masqué en permanence, et il ne servait à rien d'aller réécrire son
// style et cinq champs de texte soixante fois par seconde.
let _bandeauEtat='';
function updateBandeauAdverse(){
  const el=document.getElementById('mp-adv-bar');
  if(!el) return;
  const f=(reseauActif()&&RESEAU.adversaire)?G.factions[RESEAU.adversaire.id]:null;
  if(!f){
    if(_bandeauEtat!=='off'){ _bandeauEtat='off'; el.style.display='none'; }
    return;
  }
  const etat=[f.nom||RESEAU.adversaire.nom||'Adversaire',f.teinte,f.age,f.pop,f.maxPop,f.vaincu?1:0].join('|');
  if(_bandeauEtat===etat) return;
  _bandeauEtat=etat;
  el.style.display='flex';
  el.querySelector('.mpa-nom').textContent=f.nom||RESEAU.adversaire.nom||'Adversaire';
  el.querySelector('.mpa-teinte').style.background=(COUL_FACTION[f.teinte]||COUL_FACTION.rouge)[0];
  el.querySelector('.mpa-age').textContent=AGES[f.age]?AGES[f.age].ico:'';
  el.querySelector('.mpa-pop').textContent=f.pop+'/'+f.maxPop;
  el.querySelector('.mpa-etat').textContent=f.vaincu?'💀':'';
}

// \u2500\u2500 BASCULE IA (l'adversaire ne revient pas) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Reutilise integralement la mecanique d'IA existante (P2) : il suffit de
// faire ressembler la faction humaine deconnectee a une faction IA pour
// qu'updateAI() la prenne en charge d'elle-meme, avec son propre budget de
// difficulte, comme n'importe quel rival de Conquete.
function convertirEnIA(factionId){
  const f=G.factions[factionId]; if(!f||f.genre==='ia') return;
  f.genre='ia';
  const tc=G.buildings.find(b=>b.owner===factionId&&b.type===BT.TC);
  const tune=AI_TUNE[G.difficulty]||AI_TUNE.normal;
  Object.assign(f,{
    baseX:tc?tc.x:0, baseY:tc?tc.y:0, tcId:tc?tc.id:null,
    think:0, atkTimer:tune.firstAtk, atkMin:tune.atkMin, raids:0, vilTarget:tune.vilTarget,
  });
  for(const u of G.units) if(u.owner===factionId) u.ai=true;
  notify('🤖 '+f.nom+' est d\u00e9sormais men\u00e9e par l\'IA','#f0c040');
}

// \u2500\u2500 FENETRE DE RECONNEXION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const DELAI_GEL_RECO = 3000;   // silence avant de considerer la connexion perdue
const FENETRE_RECO   = 180000; // duree de la tentative de reconnexion (3 min : coupures wifi/4G, pas seulement un blip)

// ── REPRISE APRÈS RECHARGEMENT DE MA PROPRE PAGE ────────────────
// La fenêtre de reconnexion ci-dessus ne couvre que les coupures de LIEN
// (wifi, onglet mis en arrière-plan) : les deux G restent en mémoire, seul
// le canal WebRTC est renégocié. Si c'est MA page qui recharge ou plante,
// mon G disparaît entièrement — jusqu'ici la partie était perdue sans appel.
// On mémorise donc le code du salon en cours ; au prochain chargement, un
// bouton sur l'écran-titre permet de rejoindre à nouveau CE salon (le canal
// se renégocie normalement) puis de demander à l'hôte (toujours vivant, lui,
// puisque son G n'a jamais disparu) un état à jour via RESYNC — voir plus
// bas. Portée volontairement limitée au rôle CLIENT : côté hôte, c'est tout
// l'état autoritatif de la partie qui vit en mémoire, rien à récupérer d'un
// simple code de salon.
const REJOIN_KEY = 'adc_mp_rejoin_v1';
const REJOIN_TTL = 900000; // 15 min : au-delà, on ne propose plus le bouton (l'hôte a sûrement refermé)
function sauverRejoinEnLigne(code){
  if(!code) return;
  try{ localStorage.setItem(REJOIN_KEY, JSON.stringify({code, ts:Date.now()})); }catch(e){}
}
function effacerRejoinEnLigne(){
  try{ localStorage.removeItem(REJOIN_KEY); }catch(e){}
}
function lireRejoinEnLigne(){
  try{
    const raw=localStorage.getItem(REJOIN_KEY);
    if(!raw) return null;
    const r=JSON.parse(raw);
    if(!r||!r.code||Date.now()-r.ts>REJOIN_TTL) return null;
    return r;
  }catch(e){ return null; }
}
// Averti AVANT de perdre la partie plutôt que de compter sur le bouton de
// reprise après coup : un rechargement accidentel reste la cause la plus
// fréquente d'abandon involontaire d'une partie en ligne.
window.addEventListener('beforeunload',e=>{
  if(!reseauActif()||!G.running) return; // rien a perdre une fois la partie finie
  e.preventDefault(); e.returnValue='';
});

// Pouls APPLICATIF, distinct du PING/PONG du transport. Celui-la est
// intercepte par le transport lui-meme (voir recevoir(), tout en bas) et
// n'atteint JAMAIS recevoirReseau : il ne rafraichit donc jamais dernierRecu.
// Or le client n'emet rien spontanement — un message ne part que lorsque le
// joueur donne un ordre. Sans ce battement, l'hote constatait trois secondes
// de silence des que son adversaire cessait de cliquer : il gelait la partie,
// affichait « connexion perdue » et renegociait le WebRTC pour rien. Emis par
// les DEUX camps, et par setInterval — surtout pas par la boucle de jeu, qui
// s'arrete justement pendant une pause partagee ou un gel.
const BAT_PERIODE = 1000;
let _minuteurVeille=null, _minuteurDecision=null, _minuteurBattement=null;
function demarrerVeilleReseau(){
  RESEAU.dernierRecu=Date.now();
  if(_minuteurVeille) clearInterval(_minuteurVeille);
  _minuteurVeille=setInterval(()=>{
    if(!RESEAU.actif||RESEAU.enAttenteReconnexion||RESEAU.decisionRequise) return;
    if(Date.now()-RESEAU.dernierRecu>DELAI_GEL_RECO) entrerAttenteReconnexion();
  },500);
  if(_minuteurBattement) clearInterval(_minuteurBattement);
  _minuteurBattement=setInterval(()=>{ if(RESEAU.actif) envoyerReseau({t:'BAT'}); },BAT_PERIODE);
}
// La partie est finie (victoire, defaite, retour au menu) : il n'y a plus
// rien a surveiller. Sans cet arret la veille continuait de tourner par-dessus
// l'ecran de fin, y affichait le bandeau « connexion perdue » au bout de trois
// secondes, puis trois minutes plus tard la boite « votre adversaire ne
// revient pas » — le tout en renegociant un WebRTC dont plus personne n'a
// l'usage.
function arreterVeilleReseau(){
  if(_minuteurVeille){ clearInterval(_minuteurVeille); _minuteurVeille=null; }
  if(_minuteurBattement){ clearInterval(_minuteurBattement); _minuteurBattement=null; }
  if(_minuteurDecision){ clearTimeout(_minuteurDecision); _minuteurDecision=null; }
  if(RESEAU.pauseMinuteur){ clearTimeout(RESEAU.pauseMinuteur); RESEAU.pauseMinuteur=null; }
  RESEAU.enAttenteReconnexion=false;
  afficherBandeauReconnexion(false);
}
// Quitter une partie EN LIGNE doit remettre le jeu en mode solo. Sans cette
// remise a zero, RESEAU.actif restait vrai apres un retour au menu : la
// partie solo suivante voyait estHote() faux et faisait tourner
// updateVisuel() a la place d'update() — plus aucune simulation, un temps de
// jeu qui s'emballe et des villageois qui ne recoltent plus.
// `fermerSalon` : supprimer aussi le salon cote serveur. Reserve au retour
// explicite au menu — a la fin d'une partie, l'adversaire est peut-etre en
// train d'afficher son propre ecran de fin, et lui faire disparaitre le salon
// sous les pieds le renverrait vers « l'hote a quitte » au lieu de son
// resultat. Le salon retombe de toute facon tout seul (onDisconnect).
function quitterSessionReseau(fermerSalon){
  if(!RESEAU.actif) return;
  arreterVeilleReseau();
  RESEAU.actif=false; RESEAU.role=null; RESEAU.pret=false; RESEAU.snapEnVol=false;
  RESEAU.adversaire=null; RESEAU.finRecue=null; RESEAU.decisionRequise=false;
  RESEAU.tick=0; RESEAU.accDelta=0; RESEAU.latence=0;
  RESEAU.dernier.clear(); RESEAU.attente.clear();
  RESEAU.connusU.clear(); RESEAU.connusB.clear(); RESEAU.connusW.clear();
  afficherVoilePause(false);
  const dec=document.getElementById('mp-decision-hote'); if(dec) dec.style.display='none';
  mpVerrouillerVitesse();
  if(fermerSalon) try{ window.MP&&window.MP.quitter&&window.MP.quitter(); }catch(e){}
}
function entrerAttenteReconnexion(){
  if(RESEAU.enAttenteReconnexion) return;
  RESEAU.enAttenteReconnexion=true;
  G.paused=true;
  afficherBandeauReconnexion(true);
  if(typeof RESEAU.tenterReconnexion==='function'){ try{ RESEAU.tenterReconnexion(); }catch(e){} }
  _minuteurDecision=setTimeout(()=>{
    if(!RESEAU.enAttenteReconnexion) return; // reconnecte entre-temps
    RESEAU.enAttenteReconnexion=false;
    afficherBandeauReconnexion(false);
    if(RESEAU.role==='hote') ouvrirDecisionHote();
    else afficherEcranHoteParti();
  },FENETRE_RECO);
}
function sortirAttenteReconnexion(){
  if(!RESEAU.enAttenteReconnexion) return;
  RESEAU.enAttenteReconnexion=false;
  if(_minuteurDecision){ clearTimeout(_minuteurDecision); _minuteurDecision=null; }
  afficherBandeauReconnexion(false);
  G.paused=false; // la reconnexion a priorite sur une pause manuelle anterieure
  notify('🔌 Reconnect\u00e9','#2ecc71');
  requestAnimationFrame(loop);
}
function afficherBandeauReconnexion(visible){
  const el=document.getElementById('mp-reco-bandeau');
  if(el) el.style.display=visible?'flex':'none';
}
// Signal ferme, immediat : le TRANSPORT appelle ceci des qu'il constate que
// l'hote a explicitement supprime le salon (bouton Quitter, pas une simple
// coupure) \u2014 inutile d'attendre les 60 s dans ce cas-la.
function signalerSalonSupprime(){
  if(RESEAU.role!=='client') return;
  // Course frequente : c'est MOI qui viens d'abandonner, l'hote a repris la
  // main hors ligne et referme le salon dans la foulee. Mon ecran de fin est
  // deja affiche — le remplacer par « l'hote a quitte » serait un contresens.
  if(G.gameOver||G.victory||!G.running) return;
  if(_minuteurDecision){ clearTimeout(_minuteurDecision); _minuteurDecision=null; }
  RESEAU.enAttenteReconnexion=false;
  afficherBandeauReconnexion(false);
  afficherEcranHoteParti();
}
RESEAU.onSalonSupprime=signalerSalonSupprime;

// Hote : la fenetre de reconnexion a expire sans nouvelles de l'invite.
function ouvrirDecisionHote(){
  RESEAU.decisionRequise=true;
  const el=document.getElementById('mp-decision-hote');
  if(el){ el.style.display='flex'; el.querySelector('.mpd-nom').textContent=(RESEAU.adversaire&&RESEAU.adversaire.nom)||'Votre adversaire'; }
}
function mpDecisionContinuerIA(){
  document.getElementById('mp-decision-hote').style.display='none';
  RESEAU.decisionRequise=false;
  convertirEnIA(RESEAU.adversaire.id);
  G.paused=false;
  requestAnimationFrame(loop);
}
window.mpDecisionContinuerIA=mpDecisionContinuerIA;
function mpDecisionTerminer(){
  document.getElementById('mp-decision-hote').style.display='none';
  RESEAU.decisionRequise=false;
  const f=G.factions[RESEAU.adversaire.id]; if(f) f.vaincu=true;
  G.paused=false;
  if(!G.gameOver){ update(SIM_DT); } // laisse update() constater la victoire par abandon
}
window.mpDecisionTerminer=mpDecisionTerminer;

// Invite : l'hote est parti pour de bon (salon supprime, ou 60 s ecoulees
// sans qu'il ne revienne). On ne laisse JAMAIS ce joueur sur un ecran fige
// \u2014 c'est le pire ressenti possible : il repart soit avec sa sauvegarde,
// soit vers le menu.
function afficherEcranHoteParti(){
  effacerRejoinEnLigne();
  arreterVeilleReseau();
  G.paused=true; RESEAU.actif=false;
  const ov=document.getElementById('overlay');
  ov.style.display='flex'; ov.classList.add('endscreen');
  ov.innerHTML=
    '<div style="font-size:48px">🔌</div>'+
    '<h1>L\'h\u00f4te a quitt\u00e9</h1>'+
    '<p>La connexion avec '+((RESEAU.adversaire&&RESEAU.adversaire.nom)||'votre adversaire')+' a \u00e9t\u00e9 perdue et n\'a pas pu \u00eatre r\u00e9tablie.</p>'+
    '<button class="bigbtn" onclick="mpSauverEtQuitter()">💾 Sauvegarder ma partie</button>'+
    '<button class="bigbtn" onclick="location.reload()">🏠 Retour au menu</button>';
}
async function mpSauverEtQuitter(){
  // storageSave() n'echoue JAMAIS par exception meme si les 3 paliers
  // (Drive/Canvas/localStorage) echouent : elle retourne alors null. Tester
  // seulement le try/catch annoncerait un succes bidon puis rechargerait la
  // page, perdant la partie pour de bon (voir commentaire plus haut).
  let medium=null;
  try{ medium=await storageSave(buildSaveData(),SAVE_KEY); }catch(e){}
  if(medium) notify('Partie sauvegard\u00e9e','#2ecc71');
  else notify('\u00c9chec de la sauvegarde','#e74c3c');
  setTimeout(()=>location.reload(),900);
}
window.mpSauverEtQuitter=mpSauverEtQuitter;

// \u2500\u2500 FIN DE PARTIE A DEUX COLONNES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// L'hote diffuse le bilan des DEUX camps une seule fois, au moment ou la
// partie se termine ; le client l'affiche a cote du sien. Si le message
// n'arrive jamais (l'hote se deconnecte pile a la fin), l'ecran normal
// (une colonne) s'affiche quand meme : la fonction rend '' dans ce cas.
function envoyerBilanReseau(){
  if(!reseauActif()||RESEAU.role!=='hote') return;
  const bilan={};
  for(const id of [FAC.P1,FAC.P2]){
    const f=G.factions[id]; if(!f) continue;
    bilan[id]={nom:f.nom, teinte:f.teinte, age:f.age, vaincu:!!f.vaincu, stats:f.stats};
  }
  envoyerReseau({t:'FIN', bilan, gagnant:G.victory?G.me:null});
}
function bilanDeuxColonnes(){
  if(!reseauActif()) return '';
  const m=RESEAU.finRecue; if(!m||!m.bilan) return '';
  const colonne=function(id){
    const b=m.bilan[id]; if(!b) return '';
    const s=b.stats||{}, g=s.gathered||{};
    return '<div style="flex:1;min-width:150px;">'+
      '<div class="statsec" style="color:'+((COUL_FACTION[b.teinte]||COUL_FACTION.rouge)[0])+'">'+b.nom+(b.vaincu?' 💀':'')+'</div>'+
      '<div class="statgrid">'+
        statCell('\u2694\uFE0F',s.killed||0,'Ennemis abattus')+
        statCell('\uD83C\uDFDB\uFE0F',s.built||0,'B\u00e2timents b\u00e2tis')+
        statCell('👥',s.peakPop||0,'Population max')+
        statCell('\u26CF\uFE0F',((g.food||0)+(g.wood||0)+(g.stone||0)+(g.gold||0)).toLocaleString('fr-FR'),'R\u00e9colte totale')+
      '</div></div>';
  };
  return '<div class="statsec">📊 Bilan des deux camps</div>'+
    '<div style="display:flex;gap:10px;width:100%;max-width:400px;flex-wrap:wrap;">'+colonne(FAC.P1)+colonne(FAC.P2)+'</div>';
}

let _mpEtat={dispo:false};

function mpDispo(){ return !!(window.MP&&_mpEtat.dispo); }

// Le second joueur est-il un ALLIÉ (mode 2v1 coop) ou un adversaire (1v1
// classique) ? Avant le lancement, seul le mode choisi sur l'écran-titre le
// dit (selectedMode) ; une fois en partie, la vérité est G.gmode.
function mpEstCoop(){ return !!(MODES[typeof G!=='undefined'&&G&&G.gmode?G.gmode:selectedMode]||{}).coop; }

function mpOuvrir(){
  document.getElementById('mppanel').style.display='flex';
  const ps=document.getElementById('mppseudo');
  if(ps&&!ps.value) ps.value=localStorage.getItem('adc_pseudo')||'';
  const intro=document.getElementById('mpintro');
  if(intro) intro.textContent=mpEstCoop()
    ? "Rejoignez-vous à un ami pour affronter ensemble un seul seigneur IA — réglez sa difficulté sur l'écran-titre."
    : "Affrontez un ami sur la même carte, avec l'IA rivale en troisième camp.";
  mpRafraichir();
}
window.mpOuvrir=mpOuvrir;
function mpFermer(){ document.getElementById('mppanel').style.display='none'; }
window.mpFermer=mpFermer;

// Écran-titre : reprendre une partie en ligne dont MA page a redémarré (voir
// REJOIN_KEY plus haut). Rejoint le même salon puis, dès que le canal est de
// nouveau ouvert, demande à l'hôte un RESYNC — voir traiterResync().
let _enAttenteResync=false;
async function mpReprendrePartieEnLigne(){
  const r=lireRejoinEnLigne();
  if(!r){ notify('Aucune partie en ligne à reprendre','#95a5a6'); return; }
  if(!mpDispo()){ notify('Multijoueur indisponible pour l\'instant','#e74c3c'); return; }
  _enAttenteResync=true;
  notify('🔌 Reconnexion à la partie '+r.code+'…','#3498db');
  try{ await window.MP.rejoindreSalon(r.code); }
  catch(err){
    _enAttenteResync=false;
    notify('Impossible de rejoindre : '+err.message,'#e74c3c');
    effacerRejoinEnLigne();
    const btn=document.getElementById('mprejoinbtn'); if(btn) btn.style.display='none';
  }
}
window.mpReprendrePartieEnLigne=mpReprendrePartieEnLigne;

function mpLigne(txt,cls){
  const c=document.getElementById('mpchat');
  if(!c) return;
  const d=document.createElement('div');
  d.className=cls||'sys'; d.textContent=txt;
  c.appendChild(d); c.scrollTop=c.scrollHeight;
}

// Reflete l'état du transport dans le panneau — y compris quelle(s) carte(s)
// « étape » afficher : jamais plus d'un choix à la fois (compte → trouver un
// ami → salon actif), pour que le lobby reste lisible d'un coup d'œil au
// lieu d'empiler tous les contrôles en permanence.
function mpEtapes(dispo,uid,code){
  const salon=document.getElementById('mpcard-salon');
  const actif=document.getElementById('mpcard-lobbyactif');
  if(salon) salon.style.display=(dispo&&uid&&!code)?'flex':'none';
  if(actif) actif.style.display=(dispo&&uid&&code)?'flex':'none';
}

function mpRafraichir(){
  const e=_mpEtat;
  const emoterow=document.getElementById('mp-emoterow');
  if(emoterow) emoterow.style.display=e.connecte?'flex':'none';
  const etat=document.getElementById('mpetat');
  const compte=document.getElementById('mpcompte');
  const bCo=document.getElementById('mpbtn-connexion');
  const bCr=document.getElementById('mpbtn-creer');
  const bRj=document.getElementById('mpbtn-rejoindre');
  if(!etat) return;

  if(!window.MP||!e.dispo){
    etat.innerHTML='<span class="bad">Multijoueur indisponible</span> — '+
      (e.raison==='sdk'?'SDK Firebase injoignable (hors-ligne ?)':'non configur\u00e9 (voir README)');
    if(compte) compte.textContent='\u2014';
    [bCo,bCr,bRj].forEach(b=>{ if(b) b.disabled=true; });
    mpEtapes(false,false,false);
    return;
  }
  [bCo,bCr,bRj].forEach(b=>{ if(b) b.disabled=false; });

  if(!e.uid){
    if(compte) compte.textContent='Non connect\u00e9';
    if(bCo){ bCo.textContent='Se connecter avec Google'; bCo.style.display=''; }
    if(bCr) bCr.disabled=true;
    if(bRj) bRj.disabled=true;
    etat.innerHTML='<span class="warn">Connexion requise pour jouer en ligne</span>';
    mpEtapes(true,false,false);
    return;
  }
  if(compte) compte.textContent=e.nom||'Connect\u00e9';
  if(bCo){ bCo.textContent='Se d\u00e9connecter'; }
  mpEtapes(true,true,!!e.code);

  const code=document.getElementById('mpcode');
  const copier=document.getElementById('mpbtn-copier');
  if(e.code){
    if(code){ code.textContent=e.code; code.style.display=''; }
    if(copier) copier.style.display='';
  } else {
    if(code) code.style.display='none';
    if(copier) copier.style.display='none';
  }

  const lancer=document.getElementById('mpbtn-lancer');
  if(lancer) lancer.style.display=(e.role==='hote'&&e.connecte&&e.adversaire)?'':'none';
  const parts=[];
  const labelAutre=mpEstCoop()?'Allié':'Adversaire';
  if(e.code) parts.push(`Salon <b>${e.code}</b> — ${e.role==='hote'?'vous h\u00e9bergez':'vous avez rejoint'}`);
  if(e.adversaire) parts.push(`<span class="ok">${labelAutre} connecté : <b>${e.adversaire.nom||'…'}</b></span>`);
  else if(e.code&&e.role==='hote') parts.push(`<span class="warn mpwait">En attente ${mpEstCoop()?"d'un allié":"d'un adversaire"}…</span>`);
  if(e.connecte){
    parts.push(e.canal==='p2p'
      ? `<span class="ok">P2P \u00e9tabli</span>${e.rtt!=null?` (RTT ${e.rtt} ms)`:''}`
      : `<span class="warn">Relais \u2014 latence \u00e9lev\u00e9e</span>${e.rtt!=null?` (RTT ${e.rtt} ms)`:''}`);
  } else if(e.code){
    parts.push('Signalisation…');
  }
  etat.innerHTML=parts.join('<br>')||'Pr\u00eat';
}

async function mpConnexion(){
  if(!mpDispo()) return;
  try{
    if(_mpEtat.uid){ await window.MP.deconnecter(); mpLigne('D\u00e9connect\u00e9.','sys'); }
    else { const u=await window.MP.connecter(); mpLigne(`Connect\u00e9 en tant que ${u.nom}.`,'sys'); }
  }catch(err){ mpLigne('\u00c9chec de connexion : '+err.message,'sys'); }
}
window.mpConnexion=mpConnexion;

function mpPseudo(v){ if(window.MP&&window.MP.definirPseudo) window.MP.definirPseudo(v); }
window.mpPseudo=mpPseudo;

async function mpCreer(){
  if(!mpDispo()) return;
  try{
    const code=await window.MP.creerSalon({
      gmode:selectedMode, difficulty:selectedDifficulty,
      seed:(grainePartie!=null?grainePartie:(Math.random()*2147483646|0)+1),
      avecIA:(MODES[selectedMode]||{}).rivaux||0,
    });
    mpLigne(`Partie cr\u00e9\u00e9e — code ${code}. Transmettez-le \u00e0 ${mpEstCoop()?'votre alli\u00e9':'votre adversaire'}.`,'sys');
  }catch(err){ mpLigne('Impossible de cr\u00e9er : '+err.message,'sys'); }
}
window.mpCreer=mpCreer;

async function mpRejoindre(){
  if(!mpDispo()) return;
  const el=document.getElementById('mpjoin');
  const code=(el?el.value:'').toUpperCase().trim();
  if(code.length!==5){ mpLigne('Le code fait 5 caract\u00e8res.','sys'); return; }
  try{
    const r=await window.MP.rejoindreSalon(code);
    mpLigne(`Vous avez rejoint la partie de ${r.hote?r.hote.nom:'l\'h\u00f4te'}.`,'sys');
  }catch(err){ mpLigne('Impossible de rejoindre : '+err.message,'sys'); }
}
window.mpRejoindre=mpRejoindre;

// navigator.share en priorit\u00e9 (mobile : ouvre directement Messages/WhatsApp/
// etc. sur le lien) \u2014 bien plus direct pour "envoyer le salon \u00e0 un ami" que
// de copier puis devoir soi-m\u00eame choisir o\u00f9 coller. Repli presse-papiers sur
// desktop / navigateurs sans Web Share, comme avant.
function mpCopierLien(){
  if(!_mpEtat.code) return;
  const lien=location.origin+location.pathname+'?p='+_mpEtat.code;
  const texte=`Rejoins ma partie sur \u00c2ge des Conqu\u00eates \u2014 code ${_mpEtat.code}`;
  if(navigator.share){
    navigator.share({title:'\u00c2ge des Conqu\u00eates',text:texte,url:lien}).catch(()=>{}); // annulation utilisateur = silencieux
    return;
  }
  if(navigator.clipboard) navigator.clipboard.writeText(lien).then(
    ()=>mpLigne('Lien copi\u00e9 : '+lien,'sys'),
    ()=>mpLigne('Lien : '+lien,'sys'));
  else mpLigne('Lien : '+lien,'sys');
}
window.mpCopierLien=mpCopierLien;

// L'hote lance la partie : il demarre la simulation et decrit au client ce
// qu'il doit generer (graine, mode, camps).
// Garde explicite sur les TROIS conditions (rôle hôte, canal ouvert, ami
// effectivement présent) plutôt que de compter uniquement sur le bouton
// #mpbtn-lancer resté caché (voir mpRafraichir) : ce garde-fou vaut aussi si
// la fonction est un jour appelée autrement (ex. raccourci clavier, appel
// direct en console) — jamais de partie en ligne lancée sans adversaire
// réellement connecté en face.
function mpLancer(){
  if(_mpEtat.role!=='hote'){ return; }
  if(!_mpEtat.connecte||!_mpEtat.adversaire){
    notify(`⏳ En attente ${mpEstCoop()?"de l'allié":"de l'adversaire"}…`,'#e67e22');
    return;
  }
  mpFermer();
  demarrerPartieHote(_mpEtat.adversaire);
}
window.mpLancer=mpLancer;

// Quitter le salon actif (cr\u00e9\u00e9 ou rejoint) sans quitter le compte Google \u2014
// remet l'\u00c9tape 2 (cr\u00e9er/rejoindre) au premier plan. Absent jusqu'ici : le
// seul moyen de renoncer \u00e0 un salon \u00e9tait de fermer le panneau, en le
// laissant vivre c\u00f4t\u00e9 serveur.
async function mpQuitter(){
  if(!window.MP||!window.MP.quitter) return;
  try{ await window.MP.quitter(); mpLigne('Salon quitt\u00e9.','sys'); }
  catch(err){ mpLigne('Erreur en quittant le salon : '+err.message,'sys'); }
  const j=document.getElementById('mpjoin'); if(j) j.value='';
}
window.mpQuitter=mpQuitter;

function mpEnvoyerChat(){
  const el=document.getElementById('mpmsg');
  const txt=(el?el.value:'').trim();
  if(!txt) return;
  if(!window.MP||!window.MP.envoyer({t:'CHAT',texte:txt})){
    mpLigne('Pas de canal — message non envoy\u00e9.','sys'); return;
  }
  mpLigne((_mpEtat.nom||'Moi')+' : '+txt,'moi');
  el.value='';
}
window.mpEnvoyerChat=mpEnvoyerChat;

// Branchement au transport d\u00e8s qu'il est l\u00e0 (le module se charge de fa\u00e7on
// asynchrone : on r\u00e9essaie quelques fois avant d'abandonner).
(function brancherMP(essai){
  if(window.MP&&window.MP.surEtat){
    let _connecteAvant=false, _uidAvant=null, _dispoAvant=false;
    window.MP.surEtat(e=>{
      // PING/PONG (le vrai pouls du transport) sont interceptes AVANT
      // d'atteindre recevoirReseau — la reconnexion ne peut donc pas
      // compter uniquement sur "un message de jeu est arrive". Le passage
      // false -> true de e.connecte EST la preuve que le canal revit ; on
      // s'en sert directement plutot que d'attendre un hypothetique delta.
      if(e.connecte&&!_connecteAvant&&RESEAU.enAttenteReconnexion) sortirAttenteReconnexion();
      if(e.connecte&&!_connecteAvant&&_enAttenteResync){ _enAttenteResync=false; window.MP.envoyer({t:'RESYNC'}); }
      _connecteAvant=e.connecte;
      _mpEtat=e; mpRafraichir();
      // Compte unique (voir CONNEXION GOOGLE plus bas) : gAuth n'est qu'un
      // miroir de cet état — on le resynchronise à chaque publication, et on
      // ne touche l'UI que quand quelque chose a réellement changé (identité
      // ou disponibilité), pour ne pas re-render à chaque tick réseau.
      gAuth.signedIn=!!e.uid; gAuth.email=e.email||null; gAuth.nom=e.nom||null;
      if(e.uid!==_uidAvant||e.dispo!==_dispoAvant){
        _uidAvant=e.uid; _dispoAvant=e.dispo;
        if(typeof refreshGoogleUI==='function') refreshGoogleUI();
        if(typeof refreshSaveInfo==='function') refreshSaveInfo();
      }
    });
    window.MP.surMessage(m=>{
      if(m&&m.t==='CHAT'){ mpLigne((_mpEtat.adversaire&&_mpEtat.adversaire.nom||'Adversaire')+' : '+m.texte,'lui'); return; }
      recevoirReseau(m);   // tout le reste releve du protocole de jeu
    });
    brancherTransport(m=>window.MP.envoyer(m));
    // Lien de partage ?p=CODE : pr\u00e9-remplit le code et ouvre le panneau.
    const pc=new URLSearchParams(location.search).get('p');
    if(pc){
      const el=document.getElementById('mpjoin');
      if(el) el.value=pc.toUpperCase();
      mpOuvrir();
    }
    return;
  }
  if((essai||0)<40) setTimeout(()=>brancherMP((essai||0)+1),150);
  else mpRafraichir();
})(0);
