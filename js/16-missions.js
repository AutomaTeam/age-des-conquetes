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
  francs:    { nom:'Le Marteau et la Couronne', heros:'francs',    ico:'👑', missions:['fr1','fr2','fr3','fr4','fr5','fr6'] },
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

// ── 2. La Marche de Saxe ─────────────────────────────────
// Défense (~20 min) : tenir Eresburg quinze minutes contre des vagues saxonnes
// de plus en plus lourdes, pendant que Roland tient le gué du nord. Des
// vagues de PILLARDS et non un seigneur complet : une vague lâchée chasse
// d'elle-même (updateEnemyAI), sans être rappelée en garde par une économie.
MISSIONS.fr2 = {
  campagne:'francs', num:2,
  titre:'La Marche de Saxe', lieu:'Eresburg, en Saxe', date:'774',
  briefing:[
    "Pendant que Charles guerroyait en Italie, les Saxons de Widukind ont franchi la marche et brûlé les églises de Hesse.",
    "Eresburg est la clé de la frontière. Tenez-la jusqu'à ce que l'ost royal arrive — quinze minutes — et que Roland garde le gué du nord.",
  ],
  carte:{ graine:7740925, type:'foret', taille:'petite', reliques:false },
  zones:{
    gue_nord: { x:0.552, y:0.28, r:0.03 },
    gue_sud:  { x:0.566, y:0.72, r:0.03 },
    est_nord: { x:0.95,  y:0.25, r:0.03 },
    est_sud:  { x:0.95,  y:0.75, r:0.03 },
    ouest:    { x:0.04,  y:0.55, r:0.03 },
    camp:     { x:0.86,  y:0.50, r:0.05 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:1, res:{food:300,wood:450,stone:250,gold:120},
         depart:[0.26,0.58], base:'village',
         unites:[[UT.VIL,7],[UT.MIL,4],[UT.ARC,4],[UT.HERO,1,'charles']],
         batiments:[[BT.BARRACKS,5,-5],[BT.TOWER,7,2],[BT.TOWER,6,-8]] },
    p2:{ civ:'francs', nom:'Roland', solo:'fusion', age:1, res:{food:100,wood:150,stone:100,gold:50},
         depart:[0.44,0.26], base:'rien',
         unites:[[UT.KNIGHT,4],[UT.ARC,4]],
         batiments:[{ type:BT.TOWER, zone:'gue_nord' }] },
  },
  factions:{
    pill:{
      unites:[
        { type:UT.ENEMI,  n:5, zone:'camp', tag:'camp', garde:true },
        { type:UT.ENEMIA, n:3, zone:'camp', tag:'camp', garde:true },
      ],
      batiments:[{ type:BT.OUTPOST, zone:'camp', tag:'camp' }],
    },
  },
  regles:{ ageMax:2 },
  surcouche:[
    // La Diemel, du nord au sud, et ses deux gués.
    { op:'eau', trace:[[0.54,0],[0.56,0.3],[0.55,0.55],[0.57,0.75],[0.56,1]], largeur:0.016 },
    { op:'gue', zone:'gue_nord' },
    { op:'gue', zone:'gue_sud' },
    { op:'degager', zone:'camp' },
    { op:'gisement', zone:{ x:0.20, y:0.72, r:0.04 }, type:RT.GOLD, n:6, amt:500 },
    { op:'gisement', zone:{ x:0.18, y:0.40, r:0.04 }, type:RT.STONE, n:6, amt:500 },
  ],
  objectifs:[
    { id:'tenir',   txt:"Tenez Eresburg jusqu'à l'arrivée de l'ost royal (15 min)", test:M=>M.temps()>=900 },
    { id:'charles', txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé sur la marche. Les Saxons ont repris l'Eresburg." },
    { id:'camp',    txt:'Brûlez le camp de Widukind, au-delà de la rivière', type:'secondaire',
      zone:'camp', test:M=>M.detruit('camp') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2, alors:M=>M.dire('intro') },
    { id:'roland', si:M=>M.temps()>=14, alors:M=>M.dire('roland','p2') },
    // Une vague toutes les 75 s, par l'un puis l'autre gué, de plus en plus
    // lourde : fantassins, puis archers, puis cavaliers.
    { id:'vague', repete:true, intervalle:75, si:M=>M.temps()>=100&&M.temps()<840,
      alors:M=>{
        const n=M.tirs('vague');
        const compo=[[UT.ENEMI,3+n]];
        if(n>=2) compo.push([UT.ENEMIA,Math.floor(n/2)]);
        if(n>=4) compo.push([UT.ENEMI_C,Math.floor((n-2)/2)]);
        M.vague('pill',compo,n%2?'est_nord':'est_sud');
        if(n===1) M.dire('vague1');
      } },
    { id:'renfort', si:M=>M.temps()>=450, alors:M=>{ M.dire('renfort'); M.renfort('p1',[[UT.KNIGHT,4]],'ouest',{vers:'gue_sud'}); } },
    { id:'widukind', si:M=>M.temps()>=840, alors:M=>{
        M.dire('widukind');
        M.vague('pill',[[UT.ENEMI_BOSS,1],[UT.ENEMI_C,4],[UT.ENEMI,6]],'est_sud',{tag:'widukind'});
      } },
    { id:'ost', si:M=>M.temps()>=880, alors:M=>M.dire('ost') },
    { id:'camp_ok', si:M=>M.fait('camp'), alors:M=>M.dire('camp_ok') },
  ],
  orateurs:{
    charles:  { nom:'Charles',  ico:'👑' },
    roland:   { nom:'Roland',   ico:'⚔️' },
    eclaireur:{ nom:'Un éclaireur', ico:'🏇' },
    widukind: { nom:'Widukind', ico:'🐺' },
  },
  dialogues:{
    intro:[
      ['eclaireur',"Sire, des colonnes saxonnes descendent des bois de l'est. Elles passeront par les gués."],
      ['charles',"Alors nous les attendrons aux gués. L'ost royal est en marche : tenons jusqu'à son arrivée."],
    ],
    roland:[['roland',"Je tiens le gué du nord, mon oncle. Qu'ils essaient de passer."]],
    vague1:[['eclaireur',"Ils reviennent, et plus nombreux. Des archers suivent les haches."]],
    renfort:[['eclaireur',"Des cavaliers de l'avant-garde royale arrivent par l'ouest !"]],
    widukind:[['widukind',"Franc ! La Saxe n'a pas de roi, elle n'en aura jamais. Viens le prouver toi-même."]],
    ost:[['eclaireur',"Les bannières de l'ost ! Elles sont en vue, sire !"]],
    camp_ok:[['roland',"Le camp de Widukind brûle. Il n'aura plus d'abri de ce côté-ci de la rivière."]],
  },
  etoiles:['victoire', M=>M.fait('camp'), M=>M.statsEquipe('bldLost')===0],
  victoire:"L'ost royal atteint Eresburg : la marche tient. Widukind s'enfuit vers le nord — pour cette fois.",
};

// ── 3. Roncevaux ─────────────────────────────────────────
// Escorte sans base (~15 min) : le trésor de l'expédition d'Espagne traverse
// les Pyrénées par un défilé ; des embuscades basques s'éveillent au passage.
// Personne n'a de Centre Ville (dispense d'élimination, voir installerMission) :
// ce sont les objectifs qui décident.
MISSIONS.fr3 = {
  campagne:'francs', num:3,
  titre:'Roncevaux', lieu:'Le col de Roncevaux', date:'778',
  briefing:[
    "L'expédition d'Espagne a tourné court. L'armée repasse les Pyrénées avec le trésor, par un défilé que dominent des montagnards qui ne l'aiment pas.",
    "Charles mène les porteurs vers la sortie du col. Roland commande l'arrière-garde : qu'il tienne jusqu'à ce que le trésor soit passé.",
  ],
  carte:{ graine:7780815, type:'foret', taille:'normale', reliques:false, faune:false },
  zones:{
    entree: { x:0.06, y:0.50, r:0.03 },
    e1:     { x:0.32, y:0.50, r:0.06 },
    e2:     { x:0.54, y:0.50, r:0.06 },
    e3:     { x:0.76, y:0.50, r:0.06 },
    a1:     { x:0.40, y:0.50, r:0.02 },
    a2:     { x:0.62, y:0.50, r:0.02 },
    a3:     { x:0.84, y:0.50, r:0.02 },
    arriere:{ x:0.12, y:0.50, r:0.02 },
    g1:     { x:0.47, y:0.50, r:0.03 },
    g2:     { x:0.71, y:0.50, r:0.03 },
    sortie: { x:0.95, y:0.50, r:0.04 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.10,0.50], base:'rien',
         unites:[[UT.VIL,6,'convoi'],[UT.HERO,1,'charles'],[UT.KNIGHT,4],[UT.ARC,4]] },
    p2:{ civ:'francs', nom:'Roland', solo:'fusion', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.04,0.50], base:'rien',
         unites:[[UT.PALADIN,1,'roland'],[UT.KNIGHT,5],[UT.PIKE,4]] },
  },
  // Le défilé : deux massifs d'eau (des « à-pics » infranchissables) qui ne
  // laissent qu'un couloir d'une vingtaine de cases de large.
  surcouche:[
    { op:'eau', trace:[[0.16,0.30],[0.4,0.36],[0.6,0.33],[0.86,0.37]], largeur:0.07 },
    { op:'eau', trace:[[0.16,0.70],[0.4,0.64],[0.6,0.67],[0.86,0.63]], largeur:0.07 },
    { op:'degager', zone:{ x:0.5, y:0.5, r:0.08 } },
  ],
  // Deux abattis barrent le défilé, archers postés derrière : il faut les
  // abattre sous le feu, convoi à l'arrêt — c'est là que se joue la mission.
  factions:{
    pill:{
      murs:[
        { de:[0.44,0.38], a:[0.44,0.62], tag:'abattis1' },
        { de:[0.68,0.38], a:[0.68,0.62], tag:'abattis2' },
      ],
      unites:[
        { type:UT.ENEMIA, n:4, zone:'g1', garde:true }, { type:UT.ENEMI, n:3, zone:'g1', garde:true },
        { type:UT.ENEMIA, n:5, zone:'g2', garde:true }, { type:UT.ENEMI, n:4, zone:'g2', garde:true },
      ],
    },
  },
  regles:{ ageMax:1 },
  objectifs:[
    { id:'convoi',  txt:'Menez au moins 4 porteurs du trésor à la sortie du col', zone:'sortie',
      test:M=>M.tagDansZone('convoi','sortie',4), echec:M=>M.restants('convoi')<4,
      echecTxt:"Trop de porteurs sont tombés : le trésor de l'expédition est perdu dans la montagne." },
    { id:'roland',  txt:"Roland doit tenir l'arrière-garde jusqu'au passage du trésor",
      test:M=>M.fait('convoi'), echec:M=>M.mort('roland')&&!M.fait('convoi'),
      echecTxt:"Roland est tombé avant le passage du trésor. L'arrière-garde a cédé." },
    { id:'charles', txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé dans le col. L'armée n'a plus de roi." },
    { id:'tous',    txt:'Ne perdez aucun porteur', type:'secondaire', test:M=>M.tagDansZone('convoi','sortie',6) },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2, alors:M=>M.dire('intro') },
    { id:'e1', si:M=>M.dansZone('e1','p1')||M.dansZone('e1','p2'), alors:M=>{
        M.dire('e1'); M.vague('pill',[[UT.ENEMI,4],[UT.ENEMIA,3]],'a1',{vers:'convoi'});
      } },
    { id:'e2', si:M=>M.dansZone('e2','p1')||M.dansZone('e2','p2'), alors:M=>{
        M.dire('e2'); M.vague('pill',[[UT.ENEMI,5],[UT.ENEMIA,4]],'a2',{vers:'convoi'}); M.vague('pill',[[UT.ENEMI,3]],'arriere',{vers:'roland'});
      } },
    { id:'e3', si:M=>M.dansZone('e3','p1')||M.dansZone('e3','p2'), alors:M=>{
        M.dire('e3'); M.vague('pill',[[UT.ENEMI,6],[UT.ENEMIA,4],[UT.ENEMI_C,2]],'a3',{vers:'convoi'});
      } },
    // Le cor : l'arrière-garde est prise à revers quand le trésor passe.
    { id:'cor', si:M=>M.fait('convoi'), alors:M=>M.dire('cor') },
    { id:'harcelement', repete:true, intervalle:60, si:M=>M.temps()>=90&&!M.fait('convoi'),
      alors:M=>M.vague('pill',[[UT.ENEMIA,2],[UT.ENEMI,1+Math.floor(M.tirs('harcelement')/2)]],'arriere',{vers:'roland'}) },
    { id:'abattis1_ok', si:M=>M.detruit('abattis1')||M.restants('abattis1')<18, alors:M=>M.dire('abattis') },
  ],
  orateurs:{
    charles:{ nom:'Charles', ico:'👑' },
    roland: { nom:'Roland',  ico:'⚔️' },
    olivier:{ nom:'Olivier', ico:'🛡️' },
  },
  dialogues:{
    intro:[
      ['charles',"Les porteurs d'abord, et serrés. Nul ne s'arrête dans le défilé."],
      ['roland',"Allez, mon oncle. L'arrière-garde est à moi : tant que je tiens, rien ne vous atteindra par derrière."],
    ],
    e1:[['olivier',"Des pierres roulent des hauteurs ! Ils nous attendaient !"]],
    e2:[['olivier',"Ils sont devant et derrière, Roland ! Sonne du cor, que le roi revienne !"],
        ['roland',"Jamais. Le roi a le trésor à sauver. Nous tiendrons."]],
    e3:[['charles',"La sortie du col est en vue. Encore un effort, et nous serons en terre franque."]],
    cor:[['charles',"Le trésor est passé... J'entends un cor, très loin derrière nous. Roland !"]],
    abattis:[['olivier',"L'abattis cède ! Faites passer les porteurs, vite, avant qu'ils ne le referment !"]],
  },
  etoiles:['victoire', M=>M.vivant('roland'), M=>M.fait('tous')],
  victoire:"Le trésor est sauf. Au fond du col, la chanson de Roland commence à peine.",
};

// ── 4. Les Reliques d'Aix ────────────────────────────────
// Exploration (~25 min) : cinq reliques dispersées, gardées par des brigands,
// à rapporter au Monastère pour la chapelle d'Aix. Les Saxons rebelles, au
// nord-est, se tiennent cois (rôle passif)... jusqu'à la deuxième relique.
// Ils cherchent les reliques eux aussi : s'ils en emportent trois, c'est perdu.
MISSIONS.fr4 = {
  campagne:'francs', num:4,
  titre:"Les Reliques d'Aix", lieu:'Aix-la-Chapelle', date:'794',
  briefing:[
    "Charles fait bâtir à Aix une chapelle digne d'un empire. Il lui faut des reliques — et les plus précieuses dorment dans des sanctuaires que tiennent des brigands.",
    "Alcuin mènera les moines. Mettez trois reliques à l'abri avant que les Saxons rebelles, qui les convoitent aussi, ne s'en emparent.",
  ],
  carte:{ graine:7940112, type:'plaines', taille:'moyenne', reliques:false },
  zones:{
    r1:{ x:0.14, y:0.18, r:0.04 },
    r2:{ x:0.50, y:0.12, r:0.04 },
    r3:{ x:0.52, y:0.86, r:0.04 },
    r4:{ x:0.86, y:0.62, r:0.04 },
    r5:{ x:0.64, y:0.42, r:0.04 },
    saxe:{ x:0.84, y:0.24, r:0.03 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:1, res:{food:350,wood:350,stone:150,gold:200},
         depart:[0.28,0.58], base:'village',
         unites:[[UT.VIL,8],[UT.KNIGHT,3],[UT.ARC,3],[UT.HERO,1,'charles']],
         batiments:[[BT.MONASTERY,5,4]] },
    p2:{ civ:'francs', nom:'Alcuin', solo:'fusion', age:1, res:{food:100,wood:100,stone:0,gold:100},
         depart:[0.36,0.36], base:'rien',
         unites:[[UT.MONK,3],[UT.SCOUT,2],[UT.KNIGHT,2]] },
  },
  factions:{
    ia:{ civ:'byzantins', nom:'Saxons rebelles', equipe:3, depart:[0.84,0.24], age:1, role:'passif', ageMax:2, heros:false, merveille:false },
    pill:{
      unites:[
        { type:UT.ENEMI,  n:3, zone:'r1', garde:true }, { type:UT.ENEMIA, n:1, zone:'r1', garde:true },
        { type:UT.ENEMI,  n:3, zone:'r2', garde:true }, { type:UT.ENEMIA, n:2, zone:'r2', garde:true },
        { type:UT.ENEMI,  n:4, zone:'r3', garde:true }, { type:UT.ENEMIA, n:2, zone:'r3', garde:true },
        { type:UT.ENEMI,  n:5, zone:'r4', garde:true }, { type:UT.ENEMI_G, n:1, zone:'r4', garde:true },
        { type:UT.ENEMI,  n:4, zone:'r5', garde:true }, { type:UT.ENEMIA, n:3, zone:'r5', garde:true },
      ],
    },
  },
  surcouche:[
    { op:'degager', zone:'r1' }, { op:'relique', zone:'r1' },
    { op:'degager', zone:'r2' }, { op:'relique', zone:'r2' },
    { op:'degager', zone:'r3' }, { op:'relique', zone:'r3' },
    { op:'degager', zone:'r4' }, { op:'relique', zone:'r4' },
    { op:'degager', zone:'r5' }, { op:'relique', zone:'r5' },
  ],
  objectifs:[
    { id:'reliques', txt:"Mettez 3 reliques à l'abri dans votre Monastère", test:M=>M.reliquesEquipe()>=3,
      echec:M=>M.reliques('ia')>=3,
      echecTxt:"Les Saxons ont emporté trois reliques. La chapelle d'Aix restera vide." },
    { id:'charles',  txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé. Aix n'aura ni chapelle ni empereur." },
    { id:'toutes',   txt:'Rapportez les cinq reliques', type:'secondaire', test:M=>M.reliquesEquipe()>=5 },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'alcuin', si:M=>M.temps()>=16, alors:M=>M.dire('alcuin','p2') },
    { id:'premiere', si:M=>M.reliquesEquipe()>=1, alors:M=>M.dire('premiere') },
    // Le réveil des Saxons : ils ne regardent plus faire.
    { id:'reveil', si:M=>M.reliquesEquipe()>=2||M.temps()>=900, alors:M=>{
        M.dire('reveil'); M.ia('ia',{role:'normal',lancer:true});
      } },
    { id:'saxons_relique', si:M=>M.reliques('ia')>=1, alors:M=>M.dire('saxons_relique') },
  ],
  orateurs:{
    charles:{ nom:'Charles', ico:'👑' },
    alcuin: { nom:'Alcuin',  ico:'📖' },
  },
  dialogues:{
    intro:[['charles',"Cinq sanctuaires, cinq reliques. Trois suffiront à consacrer la chapelle — mais je les veux toutes."]],
    alcuin:[['alcuin',"Mes moines portent les reliques, sire, mais ils ne se battent pas. Qu'on nous ouvre le chemin, et nous ferons le reste."]],
    premiere:[['alcuin',"La première est à l'abri ! Elle rapporte déjà des dons au Monastère."]],
    reveil:[['alcuin',"Les Saxons ont compris ce que nous faisions. Leur armée se met en marche !"]],
    saxons_relique:[['alcuin',"Un moine saxon a emporté une relique ! S'ils en prennent trois, tout est perdu."]],
  },
  etoiles:['victoire', M=>M.fait('toutes'), M=>M.temps()<25*60],
  victoire:"La chapelle d'Aix est consacrée. Les pèlerins viendront de toute la chrétienté.",
};

// ── 5. Le Ring des Avars ─────────────────────────────────
// Siège (~35 min) : le Ring, camp retranché des Avars, est une forteresse
// (rôle `forteresse` : elle n'attaque jamais, se retranche sans cesse) ceinte
// d'une palissade. Tant que son Marché tient, des renforts arrivent de l'est.
MISSIONS.fr5 = {
  campagne:'francs', num:5,
  titre:'Le Ring des Avars', lieu:'Le Ring, en Pannonie', date:'795',
  briefing:[
    "Au cœur de la plaine pannonienne, les Avars ont entassé deux siècles de butin derrière les palissades du Ring.",
    "Charles l'assiège par l'ouest. Son fils Pépin coupera la route de l'est : tant que le Marché des Avars tient, les renforts afflueront.",
  ],
  carte:{ graine:7950318, type:'plaines', taille:'moyenne' },
  zones:{
    marche:   { x:0.72, y:0.84, r:0.04 },
    route_est:{ x:0.97, y:0.55, r:0.03 },
    ring:     { x:0.78, y:0.48, r:0.06 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:2, res:{food:700,wood:900,stone:350,gold:550},
         depart:[0.18,0.48], base:'village',
         unites:[[UT.VIL,10],[UT.KNIGHT,8],[UT.ARC,6],[UT.PIKE,6],[UT.RAM,3],[UT.HERO,1,'charles']],
         batiments:[[BT.BARRACKS,6,-5],[BT.SIEGE,6,5],[BT.STABLE,-6,5]] },
    p2:{ civ:'francs', nom:'Pépin', solo:'fusion', age:2, res:{food:300,wood:300,stone:100,gold:200},
         depart:[0.36,0.84], base:'tc',
         unites:[[UT.VIL,4],[UT.KNIGHT,6],[UT.SCOUT,3]] },
  },
  factions:{
    ia:{ civ:'mongols', nom:'Khagan des Avars', equipe:3, depart:[0.78,0.48], age:2,
         role:'forteresse', ageMax:2, heros:false, merveille:false, enceinte:true,
         // Une place forte qui se défend, pas une puissance qui s'étend : son
         // économie plafonne bas, et la garnison ne grossit que lentement.
         tune:{ vilTarget:6 },
         batiments:[[BT.CASTLE,-4,-9],[BT.TOWER,8,-6],[BT.TOWER,8,7],[BT.BARRACKS,-7,4],
                    { type:BT.MARKET, zone:'marche', tag:'marche' }],
         unites:[[UT.ENEMI_C,4],[UT.ENEMIA,4],[UT.ENEMI,4]] },
  },
  objectifs:[
    { id:'ring',    txt:'Prenez le Ring : rasez le Centre Ville des Avars', zone:'ring', test:M=>M.vaincu('ia') },
    { id:'charles', txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé devant le Ring. Le siège est levé." },
    { id:'marche',  txt:"Détruisez le Marché des Avars : la route de l'est sera coupée", type:'secondaire',
      zone:'marche', test:M=>M.detruit('marche') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2, alors:M=>M.dire('intro') },
    { id:'pepin', si:M=>M.temps()>=16, alors:M=>M.dire('pepin','p2') },
    // Tant que le Marché tient, une colonne de secours toutes les deux
    // minutes — elle rejoint la garnison (aiAdoptUnit la poste en défense).
    { id:'secours', repete:true, intervalle:120, si:M=>M.temps()>=150&&M.vivant('marche')&&!M.vaincu('ia'),
      alors:M=>{ M.renfort('ia',[[UT.ENEMI_C,2],[UT.ENEMIA,1]],'route_est'); if(M.tirs('secours')===1) M.dire('secours'); } },
    { id:'marche_ok', si:M=>M.fait('marche'), alors:M=>M.dire('marche_ok') },
    { id:'breche', si:M=>M.compte('ia',BT.WALL)+M.compte('ia',BT.GATE)<20, alors:M=>M.dire('breche') },
  ],
  orateurs:{
    charles:{ nom:'Charles', ico:'👑' },
    pepin:  { nom:'Pépin',   ico:'🗡️' },
    eric:   { nom:'Éric de Frioul', ico:'🛡️' },
  },
  dialogues:{
    intro:[
      ['eric',"Le Ring a neuf enceintes, dit-on. Il n'en a qu'une — mais elle est gardée."],
      ['charles',"Les béliers d'abord, les tours ensuite. Et que personne ne pille avant que le Khagan ne soit tombé."],
    ],
    pepin:[['pepin',"Je tiens le sud, père. Le Marché des Avars est à portée : je vais leur couper la route."]],
    secours:[['eric',"Une colonne de cavaliers arrive de l'est pour renforcer le Ring !"]],
    marche_ok:[['pepin',"Le Marché brûle. Plus rien ne passera par l'est."]],
    breche:[['eric',"La palissade cède ! Par la brèche, sire !"]],
  },
  etoiles:['victoire', M=>M.fait('marche'), M=>M.temps()<30*60],
  victoire:"Le Ring est tombé. Quinze chariots de trésor prennent la route d'Aix.",
};

// ── 6. La Couronne d'Occident ────────────────────────────
// Finale (~50 min) : deux rivaux coalisés, Saxons et Danois. Deux façons de
// gagner — une Merveille achevée et tenue (la victoire par Merveille passe par
// la fin de mission, voir checkMerveilleVictory), ou les deux rivaux abattus.
MISSIONS.fr6 = {
  campagne:'francs', num:6,
  titre:"La Couronne d'Occident", lieu:'Aix-la-Chapelle', date:'800',
  briefing:[
    "Le pape attend Charles à Rome pour la Noël. Mais Saxons et Danois se sont coalisés pour que l'empereur ne quitte jamais ses terres.",
    "Élevez à Aix une Merveille qui dise au monde qu'un empire est né, et gardez-la debout dix minutes — ou abattez les deux rivaux. Louis tiendra la ville pendant que vous frapperez.",
  ],
  carte:{ graine:8001225, type:'plaines', taille:'normale' },
  zones:{
    aix:     { x:0.24, y:0.46, r:0.05 },
    cote:    { x:0.60, y:0.97, r:0.03 },
    foret_n: { x:0.55, y:0.18, r:0.08 },
  },
  roles:{
    p1:{ civ:'francs', nom:'Charles', age:2, res:{food:900,wood:1100,stone:900,gold:700},
         depart:[0.22,0.58], base:'village',
         unites:[[UT.VIL,14],[UT.KNIGHT,6],[UT.ARC,6],[UT.PIKE,4],[UT.HERO,1,'charles']],
         batiments:[[BT.BARRACKS,6,-5],[BT.STABLE,7,4],[BT.FORGE,-6,4]] },
    p2:{ civ:'francs', nom:'Louis', solo:'fusion', age:2, res:{food:300,wood:300,stone:300,gold:200},
         depart:[0.24,0.30], base:'tc',
         unites:[[UT.VIL,5],[UT.KNIGHT,4],[UT.ARC,4]],
         batiments:[[BT.TOWER,5,4]] },
  },
  factions:{
    ia: { civ:'byzantins', nom:'Saxons', equipe:3, depart:[0.80,0.28], age:2, tune:{ firstAtk:540 }, cible:'aix' },
    ia2:{ civ:'mongols',   nom:'Danois', equipe:3, depart:[0.80,0.76], age:2, tune:{ firstAtk:720 } },
  },
  surcouche:[
    { op:'foret', zone:'foret_n', n:50 },
    { op:'gisement', zone:{ x:0.14, y:0.70, r:0.04 }, type:RT.STONE, n:8, amt:700 },
    { op:'gisement', zone:{ x:0.34, y:0.74, r:0.04 }, type:RT.GOLD, n:8, amt:700 },
  ],
  objectifs:[
    { id:'couronne', txt:"Achevez une Merveille et gardez-la debout 10 minutes — ou abattez les deux rivaux",
      test:M=>M.vaincu('ia')&&M.vaincu('ia2') },
    { id:'charles',  txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé. L'Occident attendra encore un empereur." },
    { id:'saxons',   txt:'Soumettez les Saxons', type:'secondaire', test:M=>M.vaincu('ia') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2, alors:M=>M.dire('intro') },
    { id:'louis', si:M=>M.temps()>=16, alors:M=>M.dire('louis','p2') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
    { id:'merveille', si:M=>M.compteEquipe(BT.WONDER)>=1, alors:M=>{
        M.dire('merveille'); M.ia('ia',{lancer:true}); M.ia('ia2',{lancer:true});
      } },
    { id:'vikings', repete:true, intervalle:240, si:M=>M.temps()>=900,
      alors:M=>{ M.vague('pill',[[UT.ENEMI,4+M.tirs('vikings')],[UT.ENEMIA,2]],'cote'); if(M.tirs('vikings')===1) M.dire('vikings'); } },
    { id:'saxons_ok', si:M=>M.fait('saxons'), alors:M=>M.dire('saxons_ok') },
  ],
  orateurs:{
    charles:{ nom:'Charles', ico:'👑' },
    louis:  { nom:'Louis',   ico:'🛡️' },
    alcuin: { nom:'Alcuin',  ico:'📖' },
  },
  dialogues:{
    intro:[
      ['alcuin',"Sire, Rome vous attend. Mais Widukind a trouvé des alliés chez les Danois, et ils marchent sur Aix."],
      ['charles',"Alors Aix sera le premier monument de l'empire. Qu'on le voie depuis Rome."],
    ],
    louis:[['louis',"Je garde la ville, père. Faites ce qui doit être fait."]],
    imperial:[['alcuin',"L'Âge Impérial ! Les maîtres d'œuvre sont prêts : il ne manque que la pierre et l'or pour la Merveille."]],
    merveille:[['alcuin',"La Merveille est achevée ! Saxons et Danois vont tout jeter contre elle : tenez dix minutes !"]],
    vikings:[['louis',"Des drakkars sur la côte sud ! Ils pillent tout ce qu'ils trouvent."]],
    saxons_ok:[['charles',"La Saxe est soumise. Il ne reste que les Danois."]],
  },
  etoiles:['victoire', M=>M.fait('saxons'), M=>M.temps()<45*60],
  victoire:"À la Noël de l'an 800, à Rome, Charles reçoit la couronne d'empereur d'Occident.",
};

// Retour d'une fin de mission : rouvre le briefing laissé en partant (voir
// allerAuBriefing, js/15-campagne.js). Ici, et pas dans le moteur : il faut
// que les campagnes soient remplies.
// Et l'onglet Campagne a pu être restauré (voir js/13-cloud.js) AVANT que
// les campagnes ne soient remplies : sa liste était alors vide.
try{ if(typeof selectedPlayTab!=='undefined'&&selectedPlayTab==='campagne') afficherListeCampagnes(); }catch(e){}
try{ reprendreEcranCampagne(); }catch(e){}
