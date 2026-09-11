'use strict';
// ======================================================================
//  16-missions.js
// ======================================================================
// Contenu du mode Campagne : les cinq campagnes et leurs missions. Le moteur
// qui les fait vivre est dans js/15-campagne.js ; ici, que des tables.
//
// Charge comme SCRIPT CLASSIQUE, dans l'ordre fixe par index.html.
// Ni import ni export : tous ces fichiers partagent le meme
// environnement lexical global, exactement comme quand ils ne
// formaient qu'un seul <script>. L'ORDRE est donc significatif.
//
// ── ÉCRIRE UNE MISSION ────────────────────────────────────
// Positions et zones en FRACTIONS de la carte (x, y, et r en fraction du
// côté) : la mission tient à toutes les tailles. Clés de camp : p1, p2 (le
// second commandant : l'ami en coop, sinon `solo:'fusion'|'ia'|'absent'`),
// ia, ia2, pill.
//
//   carte       : {graine, type (CARTES), taille (TAILLES), reliques:false?, faune:false?}
//   zones       : {nom:{x,y,r}}
//   roles       : {p1:{civ, age, res, recherches, depart, base, unites, batiments}, p2:{…, solo}}
//   factions    : {ia:{civ, nom, equipe, depart, age, tune, unites, batiments}, ia2:{…}, pill:{unites, batiments}}
//   surcouche   : [{op:'eau'|'lac'|'terre'|'gue'|'degager'|'foret'|'baies'|'poissons'|'gisement'|'relique'|'faune', …}]
//   objectifs   : [{id, txt, type:'principal'|'secondaire', cache, test:M=>bool, echec:M=>bool, echecTxt}]
//   declencheurs: [{id, si:M=>bool, alors:M=>{…}, repete, intervalle}]
//   orateurs    : {cle:{nom, ico}} ; dialogues : {cle:[[orateur, texte], …]}
//   etoiles     : ['victoire', M=>bool, …]
//   victoire / defaite / causes : textes de fin
//
// Unités : [type, nombre, tag] ou {type, n, tag, zone, garde, pv}.
// Bâtiments : [type, dx, dy, tag] (relatif au départ) ou {type, zone, tag}.
//
// Ce qu'un déclencheur NE PEUT PAS faire en cours de partie : créer un
// gisement, une relique, du gibier ou de l'eau. Ces choses-là ne voyagent
// pas vers l'invité — elles se posent dans la surcouche, au démarrage.

// ── CAMPAGNES ─────────────────────────────────────────────
// Une par civilisation, autour de son héros (voir HEROES). Leurs missions
// arrivent lot par lot : une campagne sans mission n'est pas encore
// proposée.
Object.assign(CAMPAGNES, {
  francs:    { nom:'Le Marteau et la Couronne', heros:'francs',    ico:'👑', missions:['fr1'] },
  byzantins: { nom:'Le Rempart du Monde',       heros:'byzantins', ico:'🛡️', missions:[] },
  chinois:   { nom:'Le Mandat du Ciel',         heros:'chinois',   ico:'📯', missions:[] },
  mongols:   { nom:'Les Cavaliers de la Steppe', heros:'mongols',  ico:'🏇', missions:[] },
  gitanos:   { nom:'La Route',                  heros:'gitanos',   ico:'🎻', missions:[] },
});

// ── MISSION D'ESSAI DU MOTEUR ─────────────────────────────
// N'appartient à aucune campagne. Elle exerce chaque pièce du moteur sur
// une petite carte — rivière et gué creusés, filon inépuisable, relique
// posée, second commandant fusionné, seigneur IA imposé, camp de pillards
// gardé, objectif caché, renfort, réplique, étoiles — et sert de banc aux
// tests du groupe `campagne`. Jouable depuis la console : lancerMission('essai').
MISSIONS.essai = {
  essai:true,
  titre:'Bac à sable du moteur', lieu:'Nulle part', date:'—',
  briefing:['Une mission de démonstration : tenez deux minutes, gardez votre héros en vie.'],
  carte:{ graine:20260911, type:'plaines', taille:'petite' },
  zones:{
    gue:   { x:0.50, y:0.50, r:0.035 },
    camp:  { x:0.78, y:0.22, r:0.05 },
    ouest: { x:0.10, y:0.50, r:0.03 },
  },
  roles:{
    p1:{ civ:'francs', age:1, res:{food:400,wood:300,stone:100,gold:100},
         depart:[0.25,0.62], base:'village',
         unites:[[UT.VIL,5],[UT.KNIGHT,3],[UT.HERO,1,'heros']] },
    p2:{ civ:'francs', solo:'fusion', depart:[0.25,0.30], base:'tc',
         unites:[[UT.VIL,3],[UT.ARC,4]] },
  },
  factions:{
    ia:  { civ:'mongols', nom:'Émir des Sables', equipe:3, depart:[0.80,0.70],
           tune:{ firstAtk:900 } },
    pill:{ unites:[{type:UT.ENEMI, n:4, zone:'camp', tag:'camp', garde:true}] },
  },
  surcouche:[
    { op:'eau', trace:[[0.5,0],[0.5,1]], largeur:0.012 },
    { op:'gue', zone:'gue' },
    { op:'degager', zone:'camp' },
    { op:'gisement', zone:'camp', type:RT.GOLD, n:5, amt:600, infini:true },
    { op:'relique', zone:'camp' },
  ],
  objectifs:[
    { id:'tenir', txt:'Tenez deux minutes', test:M=>M.temps()>=120 },
    { id:'heros', txt:'Le héros doit survivre', echec:M=>M.mort('heros'),
      echecTxt:'Votre héros est tombé. Sans lui, la ligne a cédé.' },
    { id:'camp',  txt:'Dispersez le camp de pillards', type:'secondaire', cache:true,
      test:M=>M.detruit('camp') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=1, alors:M=>{ M.dire('intro'); M.objectif('camp','ajout'); M.reveler('camp',30); } },
    { id:'renfort', si:M=>M.temps()>=60, alors:M=>{ M.dire('renfort'); M.renfort('p1',[[UT.KNIGHT,2]],'ouest',{tag:'renfort',vers:'gue'}); } },
  ],
  orateurs:{ capitaine:{ nom:'Le capitaine', ico:'🛡️' } },
  dialogues:{
    intro:  [['capitaine','Tenez la rivière. Un camp de pillards campe au nord-est, sur un filon qui ne tarit jamais.']],
    renfort:[['capitaine','Des cavaliers arrivent par l\'ouest !']],
  },
  etoiles:['victoire', M=>M.fait('camp'), M=>M.vivant('heros')],
  victoire:'La rivière a tenu.',
};

// ══════════════════════════════════════════════════════════
//  CAMPAGNE DES FRANCS — « Le Marteau et la Couronne »
// ══════════════════════════════════════════════════════════
// Mécaniques vedettes : fermes, cavalerie, reliques, siège, Merveille.

// ── 1. Les Terres de Herstal ─────────────────────────────
// Tutoriel avancé (~15 min) : l'économie des fermes et la montée à l'Âge
// Féodal pour Charles, le nettoyage des bois pour Roland — le second
// commandant, fusionné avec le joueur en solo. Pas de seigneur rival : de
// simples brigands, deux camps gardés et deux raids.
MISSIONS.fr1 = {
  campagne:'francs', num:1,
  titre:'Les Terres de Herstal', lieu:'Herstal, sur la Meuse', date:'768',
  briefing:[
    "Pépin le Bref est mort. Son fils Charles hérite d'un royaume — et d'un domaine où les greniers sont vides et les bois de l'autre rive infestés de brigands.",
    "Avant de rêver de couronne, il faut nourrir les siens : faites pousser les champs, passez à l'Âge Féodal, et que Roland rende les gués sûrs.",
  ],
  carte:{ graine:7680411, type:'plaines', taille:'petite' },
  zones:{
    gue_nord:  { x:0.608, y:0.30, r:0.03 },
    gue_sud:   { x:0.618, y:0.72, r:0.03 },
    camp_nord: { x:0.80,  y:0.20, r:0.05 },
    camp_est:  { x:0.84,  y:0.70, r:0.05 },
    bord_est:  { x:0.95,  y:0.50, r:0.03 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:0, res:{food:150,wood:320,stone:50,gold:50},
         depart:[0.28,0.55], base:'village',
         unites:[[UT.VIL,6],[UT.HERO,1,'charles']] },
    p2:{ civ:'francs', nom:'Roland', solo:'fusion', age:0, res:{food:100,wood:100,stone:0,gold:50},
         depart:[0.42,0.32], base:'rien',
         unites:[[UT.KNIGHT,5],[UT.ARC,3]] },
  },
  factions:{
    pill:{
      unites:[
        { type:UT.ENEMI,  n:4, zone:'camp_nord', tag:'camp_nord', garde:true },
        { type:UT.ENEMIA, n:2, zone:'camp_nord', tag:'camp_nord', garde:true },
        { type:UT.ENEMI,  n:5, zone:'camp_est',  tag:'camp_est',  garde:true },
        { type:UT.ENEMIA, n:3, zone:'camp_est',  tag:'camp_est',  garde:true },
      ],
      batiments:[
        { type:BT.OUTPOST, zone:'camp_nord', tag:'camp_nord' },
        { type:BT.OUTPOST, zone:'camp_est',  tag:'camp_est' },
      ],
    },
  },
  surcouche:[
    // La Meuse, du nord au sud, avec deux gués.
    { op:'eau', trace:[[0.62,0],[0.60,0.25],[0.64,0.5],[0.61,0.8],[0.63,1]], largeur:0.014 },
    { op:'gue', zone:'gue_nord' },
    { op:'gue', zone:'gue_sud' },
    { op:'degager', zone:'camp_nord' },
    { op:'degager', zone:'camp_est' },
    { op:'foret', zone:{ x:0.80, y:0.45, r:0.08 }, n:40 },
    { op:'baies', zone:{ x:0.20, y:0.70, r:0.04 }, n:8 },
    { op:'faune', zone:{ x:0.35, y:0.18, r:0.08 }, type:'deer', n:4 },
    { op:'faune', zone:{ x:0.18, y:0.85, r:0.06 }, type:'boar', n:2 },
  ],
  objectifs:[
    { id:'fermes',    txt:'Faites pousser 6 fermes', test:M=>M.compteEquipe(BT.FARM)>=6 },
    { id:'feodal',    txt:"Passez à l'Âge Féodal", test:M=>M.age('p1')>=1 },
    { id:'camp_nord', txt:'Chassez les brigands du camp nord et abattez leur tour de guet',
      zone:'camp_nord', test:M=>M.detruit('camp_nord') },
    { id:'camp_est',  txt:"Chassez les brigands du camp de l'est et abattez leur tour de guet",
      zone:'camp_est', test:M=>M.detruit('camp_est') },
    { id:'charles',   txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé. Le royaume de Pépin n'aura pas d'héritier." },
    { id:'chasse',    txt:'Chassez 4 bêtes sauvages pour les greniers', type:'secondaire',
      test:M=>M.statsEquipe('wildlifeHunted')>=4 },
  ],
  declencheurs:[
    { id:'intro',     si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'roland',    si:M=>M.temps()>=16, alors:M=>M.dire('roland','p2') },
    { id:'fermes_ok', si:M=>M.fait('fermes'), alors:M=>M.dire('fermes_ok') },
    { id:'camp1',     si:M=>M.fait('camp_nord')!==M.fait('camp_est'), alors:M=>M.dire('camp1') },
    { id:'raid1',     si:M=>M.temps()>=360, alors:M=>{ M.dire('raid'); M.vague('pill',[[UT.ENEMI,3]],'bord_est'); } },
    { id:'raid2',     si:M=>M.temps()>=660, alors:M=>{ M.dire('raid2'); M.vague('pill',[[UT.ENEMI,3],[UT.ENEMIA,2]],'bord_est'); } },
    { id:'feodal_ok', si:M=>M.fait('feodal'), alors:M=>M.dire('feodal_ok') },
    { id:'chasse_ok', si:M=>M.fait('chasse'), alors:M=>M.dire('chasse_ok') },
  ],
  orateurs:{
    charles:   { nom:'Charles',               ico:'👑' },
    roland:    { nom:'Roland',                ico:'⚔️' },
    intendant: { nom:"L'intendant Éginhard",  ico:'📜' },
  },
  dialogues:{
    intro:[
      ['intendant',"Sire, les greniers de Herstal sont presque vides. Six champs bien semés, et l'hiver ne nous prendra personne."],
      ['charles',"Alors semons. Un roi qui ne nourrit pas son peuple ne reste pas longtemps roi."],
    ],
    roland:[
      ['roland',"Des brigands tiennent les bois de l'autre rive, au nord et à l'est. Donnez-moi mes cavaliers, mon oncle : la Meuse se passe à gué."],
      ['charles',"Va, Roland. Mais abats aussi leurs tours de guet, ou ils reviendront."],
    ],
    fermes_ok:[['intendant',"Six champs ! Il nous faut maintenant de quoi passer à l'Âge Féodal : cinq cents mesures de vivres."]],
    camp1:    [['roland',"Un camp est tombé ! L'autre ne tiendra plus longtemps."]],
    raid:     [['intendant',"Des brigands passent la rivière ! Ils en veulent à nos paysans !"]],
    raid2:    [['roland',"Une bande plus nombreuse arrive de l'est, avec des archers. Serrez les rangs !"]],
    feodal_ok:[['charles',"Herstal n'est plus un domaine : c'est une place forte. Le royaume commence ici."]],
    chasse_ok:[['intendant',"Du gibier pour tout l'hiver. Les veneurs ont bien mérité leur part."]],
  },
  etoiles:['victoire', M=>M.fait('chasse'), M=>M.temps()<15*60],
  victoire:'Les champs sont pleins, les bois sont sûrs. Charles peut maintenant regarder au-delà de la Meuse.',
};

// Retour d'une fin de mission : rouvre le briefing laissé en partant (voir
// allerAuBriefing, js/15-campagne.js). Ici, et pas dans le moteur : il faut
// que les campagnes soient remplies.
// Et l'onglet Campagne a pu être restauré (voir js/13-cloud.js) AVANT que
// les campagnes ne soient remplies : sa liste était alors vide.
try{ if(typeof selectedPlayTab!=='undefined'&&selectedPlayTab==='campagne') afficherListeCampagnes(); }catch(e){}
try{ reprendreEcranCampagne(); }catch(e){}
