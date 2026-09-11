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
  francs:    { nom:'Le Marteau et la Couronne', heros:'francs',    ico:'👑', missions:[] },
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
