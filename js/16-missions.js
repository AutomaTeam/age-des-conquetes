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
//   roles       : {p1:{civ, age, res, recherches, depart, base, unites, batiments, murs, enceintes}, p2:{…, solo}}
//   factions    : {ia:{civ, nom, equipe, depart, age, tune, unites, batiments, diplomatie}, ia2:{…}, pill:{unites, batiments}}
//   surcouche   : [{op:'eau'|'lac'|'terre'|'gue'|'degager'|'foret'|'baies'|'poissons'|'gisement'|'relique'|'faune', …}]
//   objectifs   : [{id, txt, type:'principal'|'secondaire', cache, test:M=>bool, echec:M=>bool, echecTxt,
//                   compte:M=>[n, sur]}]   (compte : l'avancement « n/sur » affiché à côté du texte)
//   declencheurs: [{id, si:M=>bool, alors:M=>{…}, repete, intervalle}]
//   orateurs    : {cle:{nom, ico}} ; dialogues : {cle:[[orateur, texte], …]}
//   etoiles     : ['victoire', M=>bool, …]
//   victoire / defaite / causes : textes de fin
//
// Unités : [type, nombre, tag] ou {type, n, tag, zone, garde, pv}.
// Bâtiments : [type, dx, dy, tag] (relatif au départ) ou {type, zone, tag}.
// Murs : {de:[x,y], a:[x,y], portes:n, tag} ; enceintes : {zone, r, ferme, tag}.
// Diplomatie d'un seigneur : absente = aucun pourparler (le défaut en
// mission) ; true = la règle ordinaire ; {si, prix, refus} — voir
// diplomatieMission, js/15-campagne.js.
// Une troupe d'un seigneur postée par la mission (`garde`, ou `vers` dans
// M.vague/M.renfort) tient les ordres de la mission : le cerveau de l'IA ne
// la réquisitionne pas. Une vague de PILLARDS, elle, est hostile à tous —
// lâchée près du camp d'un seigneur, elle commence par lui.
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
  byzantins: { nom:'Le Rempart du Monde',       heros:'byzantins', ico:'🛡️', missions:['by1','by2','by3','by4','by5','by6'] },
  chinois:   { nom:'Le Mandat du Ciel',         heros:'chinois',   ico:'📯', missions:['ch1','ch2','ch3','ch4','ch5','ch6'] },
  mongols:   { nom:'Les Cavaliers de la Steppe', heros:'mongols',  ico:'🏇', missions:['mo1','mo2','mo3','mo4','mo5','mo6'] },
  gitanos:   { nom:'La Route',                  heros:'gitanos',   ico:'🎻', missions:['gi1','gi2','gi3','gi4','gi5','gi6'] },
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
    { id:'fermes',    txt:'Faites pousser 6 fermes', test:M=>M.compteEquipe(BT.FARM)>=6, compte:M=>[M.compteEquipe(BT.FARM),6] },
    { id:'feodal',    txt:"Passez à l'Âge Féodal", test:M=>M.age('p1')>=1 },
    { id:'camp_nord', txt:'Chassez les brigands du camp nord et abattez leur tour de guet',
      zone:'camp_nord', test:M=>M.detruit('camp_nord') },
    { id:'camp_est',  txt:"Chassez les brigands du camp de l'est et abattez leur tour de guet",
      zone:'camp_est', test:M=>M.detruit('camp_est') },
    { id:'charles',   txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé. Le royaume de Pépin n'aura pas d'héritier." },
    { id:'chasse',    txt:'Chassez 4 bêtes sauvages pour les greniers', type:'secondaire',
      test:M=>M.statsEquipe('wildlifeHunted')>=4, compte:M=>[M.statsEquipe('wildlifeHunted'),4] },
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
    { id:'tenir',   txt:"Tenez Eresburg jusqu'à l'arrivée de l'ost royal (15 min)", test:M=>M.temps()>=900, compte:M=>[M.temps()/60,15] },
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
      compte:M=>[M.reliquesEquipe(),3],
      echec:M=>M.reliques('ia')>=3,
      echecTxt:"Les Saxons ont emporté trois reliques. La chapelle d'Aix restera vide." },
    { id:'charles',  txt:'Charles doit survivre', echec:M=>M.mort('charles'),
      echecTxt:"Charles est tombé. Aix n'aura ni chapelle ni empereur." },
    { id:'toutes',   txt:'Rapportez les cinq reliques', type:'secondaire', test:M=>M.reliquesEquipe()>=5, compte:M=>[M.reliquesEquipe(),5] },
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

// ══════════════════════════════════════════════════════════
//  CAMPAGNE DES BYZANTINS — « Le Rempart du Monde »
// ══════════════════════════════════════════════════════════
// Bélisaire, de Dara (530) à Mélantias (559). Le plan d'origine allait
// jusqu'au Feu Grégeois (674) et à Basile le Tueur de Bulgares (1014) : des
// siècles après la mort de son héros. Comme Poitiers chez les Francs, ces deux
// missions sont remplacées par des batailles de Bélisaire lui-même — Ravenne
// et Mélantias —, et la mécanique qu'elles devaient montrer est gardée : la
// diplomatie (Ravenne), les murs, les Tours et le Feu Grégeois (Mélantias).
// Mécaniques vedettes : chantiers rapides, murs et portails, réparation,
// Cataphractaire, capture de villes, diplomatie, Feu Grégeois.

// ── 1. Dara ──────────────────────────────────────────────
// Défense (~15 min) et prise en main des chantiers byzantins (+30 %) : une
// tranchée à creuser — vingt sections de palissade — avant l'arrivée des
// Perses, un vrai seigneur rival qui attaque tôt, et les Immortels.
MISSIONS.by1 = {
  campagne:'byzantins', num:1,
  titre:'Dara', lieu:'Dara, aux marches de la Perse', date:'530',
  briefing:[
    "Le Grand Roi a lancé son armée sur Dara, la forteresse que l'empereur a plantée face à la Perse. Bélisaire a vingt-cinq ans, et deux fois moins d'hommes que l'ennemi.",
    "Il n'attendra pas derrière les murs : il fait creuser une tranchée devant la ville. Vos bâtisseurs vont vite — profitez-en. Tenez jusqu'à ce que les Perses renoncent.",
  ],
  carte:{ graine:5300612, type:'arides', taille:'petite', reliques:false },
  zones:{
    dara:    { x:0.22, y:0.52, r:0.05 },
    tranchee:{ x:0.42, y:0.50, r:0.07 },
    est:     { x:0.96, y:0.50, r:0.03 },
    colline: { x:0.34, y:0.10, r:0.03 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:1, res:{food:250,wood:520,stone:220,gold:100},
         depart:[0.22,0.52], base:'village',
         unites:[[UT.VIL,8],[UT.MIL,5],[UT.ARC,5],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,5,-5],[BT.TOWER,7,2]] },
    p2:{ civ:'byzantins', nom:'Hermogène', solo:'fusion', age:1, res:{food:100,wood:200,stone:50,gold:50},
         depart:[0.30,0.76], base:'rien',
         unites:[[UT.KNIGHT,4],[UT.PIKE,4]] },
  },
  factions:{
    // Un vrai seigneur, bien doté dès le départ : sur une carte aride, un rival
    // parti de quatre villageois n'avait encore rien lancé de sérieux à la
    // neuvième minute (mesuré à la sonde).
    ia:{ civ:'mongols', nom:'Perses de Firouz', equipe:3, depart:[0.84,0.50], age:1,
         ageMax:2, heros:false, merveille:false,
         tune:{ firstAtk:300, atkEvery:140, start:{food:450,wood:550,stone:200,gold:250} },
         unites:[[UT.VIL,6],[UT.ENEMI,5],[UT.ENEMIA,4],[UT.ENEMI_C,2]] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'degager', zone:'tranchee' },
    { op:'foret', zone:{ x:0.90, y:0.28, r:0.05 }, n:30 },
    { op:'foret', zone:{ x:0.90, y:0.74, r:0.05 }, n:30 },
    { op:'foret', zone:{ x:0.34, y:0.12, r:0.06 }, n:24 },
    { op:'gisement', zone:{ x:0.14, y:0.30, r:0.04 }, type:RT.STONE, n:6, amt:500 },
  ],
  objectifs:[
    { id:'tenir',     txt:"Tenez jusqu'à la retraite des Perses (15 min)", test:M=>M.temps()>=900,
      compte:M=>[M.temps()/60,15] },
    { id:'dara',      txt:'Dara doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Le Centre Ville de Dara est tombé. La frontière est ouverte." },
    { id:'belisaire', txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Bélisaire est tombé devant Dara. L'empereur n'aura pas son général." },
    { id:'tranchee',  txt:'Creusez la tranchée : 20 sections de palissade', type:'secondaire',
      zone:'tranchee', test:M=>M.compteEquipe(BT.WALL)>=20, compte:M=>[M.compteEquipe(BT.WALL),20] },
    { id:'immortels', txt:'Brisez les Immortels', type:'secondaire', cache:true, test:M=>M.detruit('immortels') },
  ],
  declencheurs:[
    { id:'intro',     si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'hermogene', si:M=>M.temps()>=16, alors:M=>M.dire('hermogene','p2') },
    { id:'tranchee_ok', si:M=>M.fait('tranchee'), alors:M=>M.dire('tranchee_ok') },
    { id:'avantgarde', si:M=>M.temps()>=300, alors:M=>M.dire('avantgarde') },
    // L'armée du Grand Roi, colonne après colonne : fantassins, archers, puis
    // cavaliers. Elle marche sur Dara ; la tranchée est sur son chemin.
    { id:'colonne', repete:true, intervalle:90, si:M=>M.temps()>=240&&M.temps()<840,
      alors:M=>{
        const n=M.tirs('colonne');
        const compo=[[UT.ENEMI,3+n]];
        if(n>=2) compo.push([UT.ENEMIA,Math.floor(n/2)+1]);
        if(n>=4) compo.push([UT.ENEMI_C,n-3]);
        M.vague('ia',compo,'est',{vers:'dara'});
      } },
    { id:'immortels', si:M=>M.temps()>=540, alors:M=>{
        M.dire('immortels'); M.objectif('immortels','ajout');
        // Au nom des PERSES, pas des pillards : une vague de pillards, hostile
        // à tous, aurait d'abord rasé le camp perse, tout proche de l'est.
        M.vague('ia',[[UT.ENEMI_G,2],[UT.ENEMI,6],[UT.ENEMIA,4]],'est',{tag:'immortels',vers:'dara'});
      } },
    // Les Huns de Sunicas, cachés derrière la colline, prennent les Immortels
    // de flanc — comme à la vraie bataille.
    { id:'huns', si:M=>M.temps()>=600, alors:M=>{
        M.dire('huns'); M.renfort('p2',[[UT.CAVARC,5]],'colline',{vers:'tranchee'});
      } },
    { id:'retraite', si:M=>M.temps()>=880, alors:M=>M.dire('retraite') },
    { id:'immortels_ok', si:M=>M.fait('immortels'), alors:M=>M.dire('immortels_ok') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    hermogene:{ nom:'Hermogène', ico:'📜' },
    sunicas:  { nom:'Sunicas',   ico:'🏹' },
    firouz:   { nom:'Firouz',    ico:'🦁' },
  },
  dialogues:{
    intro:[
      ['belisaire',"Une tranchée, devant la ville, avec des passages pour nos cavaliers. Qu'ils viennent se briser dessus."],
      ['hermogene',"Nos ouvriers bâtissent plus vite que ceux de n'importe quel empire. Vingt sections, et l'ennemi ne passera qu'où nous voudrons."],
    ],
    hermogene:[['hermogene',"Je tiens l'aile sud avec les piquiers. Surveillez les cavaliers perses : ils chercheront le flanc."]],
    tranchee_ok:[['belisaire',"La tranchée est creusée. Maintenant, nous attendons."]],
    avantgarde:[['firouz',"Préparez les bains, Romains : demain je dîne à Dara."]],
    immortels:[['hermogene',"Les Immortels ! La garde du Grand Roi marche sur la tranchée !"]],
    huns:[['sunicas',"Mes cavaliers descendent de la colline. Ils ne nous ont pas vus venir !"]],
    retraite:[['hermogene',"Les Perses se replient ! Ils abandonnent leurs étendards dans la plaine !"]],
    immortels_ok:[['belisaire',"Les Immortels n'ont pas été immortels bien longtemps."]],
  },
  etoiles:['victoire', M=>M.fait('tranchee'), M=>M.fait('immortels')],
  victoire:"Les Perses repassent la frontière. Pour la première fois depuis des générations, l'empire les a battus en bataille rangée.",
};

// ── 2. La Sédition Nika ──────────────────────────────────
// Émeute (~12 min) : la ville se soulève contre l'empereur. Des vagues
// d'émeutiers sortent des quartiers ; les Verts tiennent l'Hippodrome, qu'il
// faut reprendre. Les Bleus, eux, peuvent être achetés — l'or de Narsès.
MISSIONS.by2 = {
  campagne:'byzantins', num:2,
  titre:'La Sédition Nika', lieu:'Constantinople', date:'532',
  briefing:[
    "Les factions de l'Hippodrome, Bleus et Verts, se sont unies contre l'empereur. Aux cris de « Nika ! », la foule brûle la ville et proclame un autre empereur.",
    "Justinien songe à fuir. Bélisaire et Mundus tiennent le Grand Palais : reprenez l'Hippodrome et tenez jusqu'à l'aube. Narsès, le trésorier, a une autre idée pour les Bleus.",
  ],
  carte:{ graine:5320113, type:'plaines', taille:'petite', reliques:false, faune:false },
  zones:{
    palais:     { x:0.74, y:0.66, r:0.04 },
    hippodrome: { x:0.52, y:0.60, r:0.05 },
    bleus:      { x:0.30, y:0.76, r:0.04 },
    q_ouest:    { x:0.04, y:0.46, r:0.03 },
    q_nord:     { x:0.42, y:0.05, r:0.03 },
    q_mese:     { x:0.16, y:0.18, r:0.03 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:1, res:{food:200,wood:300,stone:150,gold:120},
         depart:[0.74,0.66], base:'village',
         unites:[[UT.VIL,5],[UT.MIL,6],[UT.ARC,4],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,-6,-3]] },
    p2:{ civ:'byzantins', nom:'Mundus', solo:'fusion', age:1, res:{food:100,wood:100,stone:0,gold:50},
         depart:[0.64,0.40], base:'rien',
         unites:[[UT.KNIGHT,4],[UT.MIL,4]] },
  },
  factions:{
    pill:{
      unites:[
        { type:UT.ENEMI,  n:8, zone:'hippodrome', tag:'verts', garde:true },
        { type:UT.ENEMIA, n:3, zone:'hippodrome', tag:'verts', garde:true },
        { type:UT.ENEMI,  n:6, zone:'bleus', tag:'bleus', garde:true },
        { type:UT.ENEMIA, n:2, zone:'bleus', tag:'bleus', garde:true },
      ],
    },
  },
  regles:{ ageMax:1 },
  surcouche:[
    // La mer : le Bosphore à l'est, la Propontide au sud.
    { op:'eau', trace:[[1,0],[1,1]], largeur:0.05 },
    { op:'eau', trace:[[0.45,1],[1,1]], largeur:0.04 },
    { op:'degager', zone:'hippodrome' },
    { op:'degager', zone:'bleus' },
  ],
  objectifs:[
    { id:'aube',       txt:"Tenez jusqu'à l'aube (12 min)", test:M=>M.temps()>=720, compte:M=>[M.temps()/60,12] },
    { id:'hippodrome', txt:"Reprenez l'Hippodrome : chassez les Verts de l'arène", zone:'hippodrome',
      test:M=>M.detruit('verts') },
    { id:'palais',     txt:'Le Grand Palais doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Le Palais est tombé. Justinien a pris la mer, et la ville a un autre empereur." },
    { id:'belisaire',  txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Bélisaire est tombé dans les rues en flammes." },
    { id:'bleus',      txt:"Narsès achètera les Bleus dès que le trésor aura 300 d'or", type:'secondaire', zone:'bleus',
      test:M=>M.possede('bleus'), echec:M=>M.mort('bleus'), compte:M=>[M.res('p1','gold'),300] },
    { id:'hypatius',   txt:"Arrêtez l'usurpateur Hypatius", type:'secondaire', cache:true, test:M=>M.detruit('hypatius') },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'mundus', si:M=>M.temps()>=14, alors:M=>M.dire('mundus','p2') },
    { id:'emeute', repete:true, intervalle:65, si:M=>M.temps()>=80&&M.temps()<660,
      alors:M=>{
        const n=M.tirs('emeute');
        const compo=[[UT.ENEMI,3+n]];
        if(n>=2) compo.push([UT.ENEMIA,Math.floor(n/2)]);
        M.vague('pill',compo,['q_ouest','q_nord','q_mese'][n%3]);
        if(n===1) M.dire('emeute');
      } },
    { id:'theodora', si:M=>M.temps()>=220, alors:M=>M.dire('theodora') },
    { id:'couronne', si:M=>M.temps()>=300, alors:M=>{
        M.dire('couronne'); M.objectif('hypatius','ajout');
        M.vague('pill',[[UT.ENEMI_G,1]],'q_mese',{tag:'hypatius'});
        M.vague('pill',[[UT.ENEMI,5]],'q_mese');
      } },
    // L'or de Narsès : prélevé dès qu'il est là — l'objectif le dit.
    { id:'achat', si:M=>M.vivant('bleus')&&!M.possede('bleus')&&M.res('p1','gold')>=300,
      alors:M=>{ M.donner('p1',{gold:-300}); M.convertir('bleus','p1'); M.dire('achat'); } },
    { id:'hippodrome_ok', si:M=>M.fait('hippodrome'), alors:M=>M.dire('hippodrome_ok') },
    { id:'aube', si:M=>M.temps()>=700, alors:M=>M.dire('aube') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    mundus:   { nom:'Mundus',    ico:'⚔️' },
    theodora: { nom:"L'impératrice Théodora", ico:'👑' },
    narses:   { nom:'Narsès',    ico:'💰' },
  },
  dialogues:{
    intro:[
      ['belisaire',"Les Verts tiennent l'Hippodrome, les Bleus la Mésè. Tant qu'ils restent unis, la ville est à eux."],
      ['narses',"Unis ? Les Bleus ont toujours aimé l'or plus que les Verts. Trouvez-moi trois cents pièces, et je leur rappelle qui paie leurs courses."],
    ],
    mundus:[['mundus',"Mes Hérules sont au nord du Palais. Dites où frapper, et nous frappons."]],
    emeute:[['mundus',"Ils sortent de tous les quartiers ! Ils en veulent au Palais !"]],
    theodora:[['theodora',"Que ceux qui veulent fuir fuient. La mer est libre. Moi, je reste : la pourpre fait un beau linceul."]],
    couronne:[['narses',"La foule a couronné Hypatius, le neveu d'un vieil empereur. Il marche sur le Palais depuis la Mésè !"]],
    achat:[['narses',"C'est fait. Les Bleus se souviennent soudain qu'ils ont toujours soutenu l'empereur."]],
    hippodrome_ok:[['belisaire',"L'Hippodrome est à nous. La sédition n'a plus de cœur."]],
    aube:[['mundus',"Le jour se lève. La ville se tait."]],
  },
  etoiles:['victoire', M=>M.fait('bleus'), M=>M.fait('hypatius')],
  victoire:"L'aube se lève sur une ville noircie, mais Justinien règne toujours. On rebâtira Sainte-Sophie, plus grande qu'avant.",
};

// ── 3. La Reconquête de l'Afrique ─────────────────────────
// Marche (~25 min) : trois villes tenues par des garnisons vandales, à libérer
// l'une après l'autre. Une ville se prend en chassant sa garnison puis en y
// entrant : ses bâtiments passent alors au joueur (M.convertir — un
// remplacement, pour que l'invité le voie aussi). Ad Decimum est une embuscade.
MISSIONS.by3 = {
  campagne:'byzantins', num:3,
  titre:"La Reconquête de l'Afrique", lieu:'De Caput Vada à Carthage', date:'533',
  briefing:[
    "Il y a un siècle, les Vandales ont pris Carthage à l'empire. Bélisaire a débarqué à Caput Vada avec quinze mille hommes et l'ordre de la reprendre.",
    "Libérez les villes de la côte l'une après l'autre : chassez la garnison vandale, puis entrez-y — et que personne ne pille, les habitants sont romains. Gélimer, le roi vandale, rassemble son armée à l'ouest.",
  ],
  carte:{ graine:5330901, type:'arides', taille:'moyenne' },
  zones:{
    v1:      { x:0.70, y:0.60, r:0.05 },
    v2:      { x:0.52, y:0.38, r:0.05 },
    decimum: { x:0.38, y:0.27, r:0.06 },
    v3:      { x:0.20, y:0.16, r:0.06 },
    ouest:   { x:0.03, y:0.40, r:0.03 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:2, res:{food:400,wood:500,stone:200,gold:250},
         depart:[0.84,0.82], base:'tc',
         unites:[[UT.VIL,8],[UT.KNIGHT,6],[UT.ARC,6],[UT.MIL,6],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,5,-5],[BT.HOUSE,-3,3],[BT.HOUSE,-3,5]] },
    p2:{ civ:'byzantins', nom:"Jean l'Arménien", solo:'fusion', age:2, res:{food:100,wood:100,stone:0,gold:100},
         depart:[0.74,0.80], base:'rien',
         unites:[[UT.KNIGHT,5],[UT.SCOUT,3]] },
  },
  factions:{
    ia:{ civ:'francs', nom:'Gélimer, roi des Vandales', equipe:3, depart:[0.12,0.74], age:2,
         role:'passif', ageMax:2, heros:false, merveille:false },
    pill:{
      // Les trois villes : leurs bâtiments sont romains (ils passeront au
      // joueur), leur garnison vandale.
      batiments:[
        { type:BT.MARKET, zone:'v1', tag:'v1' }, { type:BT.HOUSE, zone:'v1', tag:'v1' },
        { type:BT.HOUSE,  zone:'v1', tag:'v1' }, { type:BT.TOWER, zone:'v1', tag:'v1' },
        { type:BT.MARKET, zone:'v2', tag:'v2' }, { type:BT.HOUSE, zone:'v2', tag:'v2' },
        { type:BT.HOUSE,  zone:'v2', tag:'v2' }, { type:BT.HOUSE, zone:'v2', tag:'v2' },
        { type:BT.TOWER,  zone:'v2', tag:'v2' },
        { type:BT.MARKET, zone:'v3', tag:'v3' }, { type:BT.HOUSE, zone:'v3', tag:'v3' },
        { type:BT.HOUSE,  zone:'v3', tag:'v3' }, { type:BT.HOUSE, zone:'v3', tag:'v3' },
        { type:BT.MONASTERY, zone:'v3', tag:'v3' },
        { type:BT.TOWER,  zone:'v3', tag:'v3' }, { type:BT.TOWER, zone:'v3', tag:'v3' },
      ],
      unites:[
        { type:UT.ENEMI,  n:5, zone:'v1', tag:'g1', garde:true }, { type:UT.ENEMIA, n:3, zone:'v1', tag:'g1', garde:true },
        { type:UT.ENEMI,  n:6, zone:'v2', tag:'g2', garde:true }, { type:UT.ENEMIA, n:4, zone:'v2', tag:'g2', garde:true },
        { type:UT.ENEMI_C,n:2, zone:'v2', tag:'g2', garde:true },
        { type:UT.ENEMI,  n:8, zone:'v3', tag:'g3', garde:true }, { type:UT.ENEMIA, n:6, zone:'v3', tag:'g3', garde:true },
        { type:UT.ENEMI_C,n:3, zone:'v3', tag:'g3', garde:true }, { type:UT.ENEMI_G, n:1, zone:'v3', tag:'g3', garde:true },
      ],
    },
  },
  surcouche:[
    // La mer, au nord et à l'est.
    { op:'eau', trace:[[0,0],[0.7,0]], largeur:0.035 },
    { op:'eau', trace:[[1,0.3],[1,1]], largeur:0.035 },
    { op:'degager', zone:'v1' }, { op:'degager', zone:'v2' }, { op:'degager', zone:'v3' },
    { op:'gisement', zone:{ x:0.90, y:0.64, r:0.03 }, type:RT.GOLD, n:5, amt:500 },
  ],
  objectifs:[
    { id:'villes',    txt:'Libérez les trois villes : chassez la garnison vandale, puis entrez-y',
      test:M=>M.tirs('prise1')+M.tirs('prise2')+M.tirs('prise3')>=3,
      compte:M=>[M.tirs('prise1')+M.tirs('prise2')+M.tirs('prise3'),3] },
    { id:'belisaire', txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Bélisaire est tombé en Afrique. Carthage restera vandale." },
    { id:'ammatas',   txt:"Ad Decimum : abattez Ammatas, le frère du roi", type:'secondaire', cache:true,
      test:M=>M.detruit('ammatas') },
    { id:'gelimer',   txt:'Chassez Gélimer : rasez son Centre Ville', type:'secondaire', test:M=>M.vaincu('ia') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'jean',  si:M=>M.temps()>=16, alors:M=>M.dire('jean','p2') },
    // Une ville est prise quand sa garnison est tombée et que le joueur y est.
    { id:'prise1', si:M=>M.detruit('g1')&&M.equipeDansZone('v1',2)&&!M.hostilesDansZone('v1'),
      alors:M=>{ M.convertir('v1','p1'); M.dire('prise1'); } },
    { id:'prise2', si:M=>M.detruit('g2')&&M.equipeDansZone('v2',2)&&!M.hostilesDansZone('v2'),
      alors:M=>{ M.convertir('v2','p1'); M.dire('prise2'); M.ia('ia',{role:'normal',lancer:true}); } },
    { id:'prise3', si:M=>M.detruit('g3')&&M.equipeDansZone('v3',2)&&!M.hostilesDansZone('v3'),
      alors:M=>{ M.convertir('v3','p1'); M.dire('prise3'); } },
    // Ad Decimum : au dixième mille avant Carthage, Ammatas attend.
    { id:'decimum', si:M=>M.equipeDansZone('decimum',1), alors:M=>{
        M.dire('decimum'); M.objectif('ammatas','ajout');
        M.vague('pill',[[UT.ENEMI_G,1]],'v3',{tag:'ammatas',vers:'decimum'});
        M.vague('pill',[[UT.ENEMI_C,3],[UT.ENEMI,4]],'v3',{vers:'decimum'});
        M.vague('pill',[[UT.ENEMI_C,3]],'ouest',{vers:'decimum'});
      } },
    { id:'gelimer_marche', si:M=>M.temps()>=1200, alors:M=>{ M.ia('ia',{role:'normal',lancer:true}); M.dire('gelimer_marche'); } },
    { id:'ammatas_ok', si:M=>M.fait('ammatas'), alors:M=>M.dire('ammatas_ok') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    jean:     { nom:"Jean l'Arménien", ico:'🏇' },
    procope:  { nom:'Procope, son secrétaire', ico:'📜' },
  },
  dialogues:{
    intro:[
      ['belisaire',"Nous ne sommes pas des conquérants ici : ces gens sont romains. Le premier qui pille, je le fais pendre."],
      ['procope',"Leptis, puis Hadrumète, puis Carthage. Chaque ville libérée nous ouvrira ses marchés et ses tours."],
    ],
    jean:[['jean',"Mon avant-garde éclaire la route de la côte. Je vous signale tout ce qui bouge."]],
    prise1:[['procope',"Leptis ouvre ses portes ! Les habitants apportent du pain aux soldats."]],
    prise2:[['procope',"Hadrumète est libre. Gélimer ne peut plus nous ignorer : son armée se met en marche."]],
    prise3:[['belisaire',"Carthage. Ce soir, je dînerai dans le palais du roi vandale — et nos soldats paieront leur pain."]],
    decimum:[['jean',"Des Vandales devant nous, et d'autres qui arrivent par l'ouest ! C'est une embuscade !"]],
    gelimer_marche:[['jean',"Gélimer a quitté son camp avec toute son armée !"]],
    ammatas_ok:[['jean',"Ammatas est tombé ! La route de Carthage est ouverte."]],
  },
  etoiles:['victoire', M=>M.fait('ammatas'), M=>M.fait('gelimer')],
  victoire:"Carthage est romaine à nouveau. À Constantinople, Bélisaire aura droit au triomphe — le premier depuis des siècles.",
};

// ── 4. Rome assiégée ─────────────────────────────────────
// Siège défensif (~16 min) : une enceinte à quatre portails, des camps goths
// qui envoient des béliers, et la réparation — villageois et Réparation
// automatique — qui décide de tout. Bessas tient la porte sud.
MISSIONS.by4 = {
  campagne:'byzantins', num:4,
  titre:'Rome assiégée', lieu:'Rome', date:'537',
  briefing:[
    "Bélisaire a repris Rome sans combat. Maintenant, le roi goth Vitigès revient avec toute son armée, et la ville est trop grande pour les cinq mille hommes qui la gardent.",
    "Tenez les murs un an durant. Les Goths amènent des béliers : réparez sans relâche, et faites des sorties contre leurs camps quand vous le pourrez.",
  ],
  carte:{ graine:5370302, type:'plaines', taille:'moyenne', reliques:false },
  zones:{
    rome:    { x:0.46, y:0.50, r:0.10 },
    camp1:   { x:0.46, y:0.10, r:0.04 },
    camp2:   { x:0.88, y:0.46, r:0.04 },
    camp3:   { x:0.52, y:0.90, r:0.04 },
    pont:    { x:0.20, y:0.52, r:0.03 },
    renforts:{ x:0.04, y:0.52, r:0.03 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:2, res:{food:500,wood:700,stone:400,gold:300},
         depart:[0.45,0.47], base:'village',
         // Cinq mille hommes pour des murs faits pour vingt mille : peu de
         // soldats, beaucoup de murs. C'est la Caserne et les réparations qui
         // doivent tenir la ville, pas une garnison de départ.
         unites:[[UT.VIL,10],[UT.ARC,6],[UT.MIL,4],[UT.KNIGHT,2],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,6,-5]],
         enceintes:[{ zone:'rome', r:0.10, ferme:true }] },
    p2:{ civ:'byzantins', nom:'Bessas', solo:'fusion', age:2, res:{food:150,wood:150,stone:100,gold:50},
         depart:[0.47,0.56], base:'rien',
         unites:[[UT.PIKE,4],[UT.ARC,3]],
         batiments:[{ type:BT.TOWER, zone:{ x:0.50, y:0.58, r:0 } }] },
  },
  factions:{
    // Les camps goths sont au roi — pas aux pillards : une bande hostile à
    // tous, lâchée à côté de son camp, commençait par raser Vitigès lui-même
    // (mesuré : les Goths tombaient à la quatrième minute).
    ia:{ civ:'francs', nom:'Goths de Vitigès', equipe:3, depart:[0.84,0.14], age:2,
         ageMax:2, heros:false, merveille:false, tune:{ firstAtk:420, atkEvery:130 },
         batiments:[
           { type:BT.OUTPOST, zone:'camp1', tag:'camp1' }, { type:BT.SIEGE, zone:'camp1', tag:'camp1' },
           { type:BT.OUTPOST, zone:'camp2', tag:'camp2' }, { type:BT.SIEGE, zone:'camp2', tag:'camp2' },
           { type:BT.OUTPOST, zone:'camp3', tag:'camp3' }, { type:BT.SIEGE, zone:'camp3', tag:'camp3' },
         ],
         unites:[
           { type:UT.ENEMI, n:5, zone:'camp1', tag:'camp1', garde:true }, { type:UT.ENEMIA, n:3, zone:'camp1', tag:'camp1', garde:true },
           { type:UT.ENEMI, n:5, zone:'camp2', tag:'camp2', garde:true }, { type:UT.ENEMIA, n:3, zone:'camp2', tag:'camp2', garde:true },
           { type:UT.ENEMI, n:5, zone:'camp3', tag:'camp3', garde:true }, { type:UT.ENEMIA, n:3, zone:'camp3', tag:'camp3', garde:true },
         ] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    // Le Tibre, à l'ouest de la ville, et le pont Milvius.
    { op:'eau', trace:[[0.22,0],[0.19,0.35],[0.22,0.7],[0.20,1]], largeur:0.014 },
    { op:'gue', zone:'pont' },
    { op:'degager', zone:'camp1' }, { op:'degager', zone:'camp2' }, { op:'degager', zone:'camp3' },
    { op:'gisement', zone:{ x:0.40, y:0.56, r:0.03 }, type:RT.STONE, n:5, amt:600 },
  ],
  objectifs:[
    { id:'tenir',     txt:'Tenez Rome un an durant (16 min)', test:M=>M.temps()>=960, compte:M=>[M.temps()/60,16] },
    { id:'rome',      txt:'Le cœur de Rome doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Les Goths sont dans la ville. Rome est perdue." },
    { id:'belisaire', txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Bélisaire est tombé sur les murs de Rome." },
    { id:'camps',     txt:'Sorties : brûlez les trois camps goths', type:'secondaire',
      test:M=>M.detruit('camp1')&&M.detruit('camp2')&&M.detruit('camp3'),
      compte:M=>[['camp1','camp2','camp3'].filter(c=>M.detruit(c)).length,3] },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'bessas', si:M=>M.temps()>=14, alors:M=>M.dire('bessas','p2') },
    { id:'reparer',si:M=>M.temps()>=150, alors:M=>M.dire('reparer') },
    // Chaque camp debout envoie son bélier et son escorte, à tour de rôle.
    { id:'assaut', repete:true, intervalle:80, si:M=>M.temps()>=120&&M.temps()<930,
      alors:M=>{
        const n=M.tirs('assaut'), debout=['camp1','camp2','camp3'].filter(c=>M.vivant(c));
        if(!debout.length) return;
        const camp=debout[n%debout.length];
        const compo=[[UT.RAM,1+Math.floor(n/3)],[UT.ENEMI,5+n]];
        if(n>=1) compo.push([UT.ENEMIA,2+Math.floor(n/2)]);
        if(n>=4) compo.push([UT.ENEMI_C,1+Math.floor(n/3)]);
        M.vague('ia',compo,camp,{vers:'rome'});
        // Dès la mi-siège, deux camps frappent ensemble : les défenseurs ne
        // peuvent plus courir d'un mur à l'autre.
        if(n>=5&&debout.length>1) M.vague('ia',[[UT.RAM,1],[UT.ENEMI,4+Math.floor(n/2)]],debout[(n+1)%debout.length],{vers:'rome'});
        if(n===1) M.dire('belier');
      } },
    { id:'jean', si:M=>M.temps()>=600, alors:M=>{ M.dire('jean'); M.renfort('p1',[[UT.KNIGHT,6],[UT.ARC,4]],'renforts',{vers:'pont'}); } },
    { id:'camp_ok', si:M=>['camp1','camp2','camp3'].some(c=>M.detruit(c)), alors:M=>M.dire('camp_ok') },
    { id:'fin', si:M=>M.temps()>=930, alors:M=>M.dire('fin') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    bessas:   { nom:'Bessas',    ico:'🗡️' },
    antonina: { nom:'Antonina',  ico:'📜' },
    vitiges:  { nom:'Vitigès',   ico:'🐗' },
  },
  dialogues:{
    intro:[
      ['vitiges',"Rendez Rome, Grec. Vous n'avez pas assez d'hommes pour garnir le quart de ces murs."],
      ['belisaire',"Alors je les ferai courir d'un mur à l'autre. Portes closes : on n'ouvre un portail que pour une sortie, et on le referme derrière soi."],
    ],
    bessas:[['bessas',"Je tiens la porte sud. Mes piquiers attendent leurs cavaliers."]],
    reparer:[['antonina',"Les maçons sont prêts. Sélectionnez un villageois : la Réparation automatique les enverra d'eux-mêmes à chaque brèche."]],
    belier:[['bessas',"Un bélier ! Les piquiers sur lui — les flèches glissent sur ses mantelets !"]],
    jean:[['antonina',"Des renforts d'Orient passent le Tibre au pont Milvius !"]],
    camp_ok:[['belisaire',"Un camp goth brûle. Ils sauront que nous pouvons sortir."]],
    fin:[['antonina',"Les Goths lèvent le camp. La fièvre et la faim les ont vaincus avant nous."]],
  },
  etoiles:['victoire', M=>M.fait('camps'), M=>M.compteEquipe(BT.GATE)>=4],
  victoire:"Après un an de siège, Vitigès lève le camp et remonte vers Ravenne. Rome a tenu.",
};

// ── 5. Ravenne ───────────────────────────────────────────
// Deux façons de prendre la ville (~30 min) : l'assaut, ou la ruse. Les Goths
// ne traitent pas tant que leur grenier du Pô est plein — brûlez-le, et ils
// offriront la couronne d'Occident à Bélisaire (diplomatie de mission). Les
// Francs de Théodebert, eux, ravagent tout le monde.
MISSIONS.by5 = {
  campagne:'byzantins', num:5,
  titre:'Ravenne', lieu:'Ravenne, dans les marais du Pô', date:'540',
  briefing:[
    "Vitigès s'est enfermé dans Ravenne, derrière ses marais. La ville ne se prend pas d'assaut facilement — mais elle mange ce que le Pô lui apporte.",
    "Brûlez le grenier des Goths, et ils voudront traiter : ouvrez alors la Diplomatie. Ils vous offriront une couronne — acceptez-la en apparence. Ou prenez la ville par les armes.",
  ],
  carte:{ graine:5400517, type:'lacs', taille:'moyenne', reliques:false },
  zones:{
    ravenne: { x:0.78, y:0.40, r:0.06 },
    grenier: { x:0.64, y:0.80, r:0.04 },
    nordouest:{ x:0.30, y:0.03, r:0.03 },
    gue_po:  { x:0.40, y:0.66, r:0.03 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:2, res:{food:500,wood:600,stone:300,gold:300},
         depart:[0.20,0.40], base:'village',
         unites:[[UT.VIL,10],[UT.KNIGHT,6],[UT.ARC,6],[UT.MIL,6],[UT.CATA,3],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,6,-5],[BT.STABLE,6,4]] },
    p2:{ civ:'byzantins', nom:'Jean le Sanguinaire', solo:'fusion', age:2, res:{food:200,wood:200,stone:100,gold:100},
         depart:[0.28,0.84], base:'tc',
         unites:[[UT.VIL,4],[UT.KNIGHT,5],[UT.ARC,4]] },
  },
  factions:{
    ia:{ civ:'francs', nom:'Goths de Vitigès', equipe:3, depart:[0.78,0.40], age:2,
         role:'forteresse', ageMax:2, heros:false, merveille:false, enceinte:true, tune:{ vilTarget:8 },
         diplomatie:{ si:M=>M.fait('grenier'), refus:"Vitigès ne traitera pas tant que son grenier du Pô est plein." },
         batiments:[[BT.CASTLE,-5,-8],[BT.TOWER,8,-5],[BT.BARRACKS,-7,4],
                    { type:BT.MILL, zone:'grenier', tag:'grenier' }, { type:BT.MARKET, zone:'grenier', tag:'grenier' },
                    { type:BT.TOWER, zone:'grenier', tag:'grenier' }],
         unites:[[UT.ENEMI_C,4],[UT.ENEMIA,4],[UT.ENEMI,4],
                 { type:UT.ENEMI, n:4, zone:'grenier', garde:true }, { type:UT.ENEMIA, n:3, zone:'grenier', garde:true }] },
  },
  surcouche:[
    // Le Pô, d'ouest en est, et son gué.
    { op:'eau', trace:[[0,0.66],[0.3,0.64],[0.6,0.68],[1,0.66]], largeur:0.012 },
    { op:'gue', zone:'gue_po' },
    { op:'gue', zone:{ x:0.64, y:0.68, r:0.03 } },
    { op:'terre', zone:'ravenne' },
    { op:'terre', zone:'grenier' },
    { op:'degager', zone:'grenier' },
  ],
  objectifs:[
    { id:'ravenne',   txt:'Entrez dans Ravenne — par les armes ou par la ruse', zone:'ravenne',
      test:M=>M.vaincu('ia')||M.allie('ia') },
    { id:'belisaire', txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Bélisaire est tombé dans les marais. L'Italie reste gothe." },
    { id:'grenier',   txt:'Coupez le ravitaillement : brûlez le grenier des Goths sur le Pô', type:'secondaire', zone:'grenier',
      test:M=>M.detruit('grenier') },
    { id:'francs',    txt:'Repoussez les Francs de Théodebert', type:'secondaire', cache:true,
      test:M=>M.tirs('francs')>=3&&!M.vivant('francs') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'jean',  si:M=>M.temps()>=16, alors:M=>M.dire('jean','p2') },
    { id:'grenier_ok', si:M=>M.fait('grenier'), alors:M=>M.dire('grenier_ok') },
    { id:'francs', repete:true, intervalle:150, si:M=>M.temps()>=480&&M.tirs('francs')<3,
      alors:M=>{
        const n=M.tirs('francs');
        M.vague('pill',[[UT.ENEMI,5+2*n],[UT.ENEMI_C,1+n],[UT.ENEMIA,2]],'nordouest',{tag:'francs'});
        if(n===1){ M.dire('francs'); M.objectif('francs','ajout'); }
      } },
    { id:'couronne', si:M=>M.allie('ia'), alors:M=>M.dire('couronne') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    jean:     { nom:'Jean le Sanguinaire', ico:'🏇' },
    procope:  { nom:'Procope', ico:'📜' },
    vitiges:  { nom:'Vitigès', ico:'🐗' },
  },
  dialogues:{
    intro:[
      ['procope',"Ravenne ne tombera pas par les murs : les marais la protègent mieux que n'importe quelle palissade. Mais elle mange ce que le Pô lui apporte."],
      ['belisaire',"Alors affamons-la. Et gardons une armée prête, au cas où Vitigès serait plus têtu que son ventre."],
    ],
    jean:[['jean',"Je tiens la rive sud du Pô. Le grenier des Goths est à portée de mes cavaliers."]],
    grenier_ok:[['vitiges',"Bélisaire ! Les Goths sont prêts à traiter. Venez nous parler — nous avons une offre qu'aucun général n'a jamais reçue."]],
    francs:[['jean',"Les Francs de Théodebert descendent les Alpes ! Ils pillent tout, Goths comme Romains !"]],
    couronne:[
      ['vitiges',"Les Goths vous offrent la couronne d'Occident. Régnez sur l'Italie, et nous vous suivrons."],
      ['belisaire',"J'accepte... Ouvrez les portes de Ravenne à votre nouveau roi. (Il n'a jamais eu l'intention de trahir son empereur.)"],
    ],
  },
  etoiles:['victoire', M=>M.allie('ia'), M=>M.fait('francs')],
  victoire:"Ravenne ouvre ses portes. Les Goths comprennent trop tard que Bélisaire est resté fidèle à Justinien : l'Italie est rendue à l'empire.",
};

// ── 6. Mélantias ─────────────────────────────────────────
// Finale (~20 min) : le vieux général, rappelé une dernière fois. Les
// Koutrigoures de Zabergan marchent sur la Cité ; les Longs Murs sont
// percés. Bélisaire cache ses vétérans dans les bois de Mélantias — la horde
// qui entre dans la plaine y trouve son piège. Les Dèmes de la Cité (le second
// commandant, confié à l'IA en solo) tiennent le nord.
MISSIONS.by6 = {
  campagne:'byzantins', num:6,
  titre:'Mélantias', lieu:'Aux portes de Constantinople', date:'559',
  briefing:[
    "Bélisaire a près de soixante ans et vit retiré. Mais les Koutrigoures de Zabergan ont franchi le Danube, et l'empereur n'a plus personne d'autre.",
    "Il n'a que trois cents vétérans et des paysans. Tenez la Cité vingt minutes ou rasez le camp de Zabergan ; et si la horde s'avance dans la plaine de Mélantias, les vétérans cachés dans les bois l'y attendront.",
  ],
  carte:{ graine:5590604, type:'plaines', taille:'normale', reliques:false },
  zones:{
    cite:      { x:0.84, y:0.50, r:0.06 },
    melantias: { x:0.42, y:0.50, r:0.07 },
    bois_n:    { x:0.44, y:0.30, r:0.03 },
    bois_s:    { x:0.44, y:0.70, r:0.03 },
    steppe:    { x:0.24, y:0.50, r:0.03 },
    bord_nord: { x:0.58, y:0.06, r:0.03 },
    bord_sud:  { x:0.58, y:0.94, r:0.03 },
    porte_n:   { x:0.68, y:0.25, r:0.02 },
    porte_c:   { x:0.68, y:0.50, r:0.02 },
    porte_s:   { x:0.68, y:0.75, r:0.02 },
  },
  roles:{
    p1:{ civ:'byzantins', nom:'Bélisaire', age:2, res:{food:800,wood:800,stone:600,gold:600},
         depart:[0.84,0.56], base:'village',
         unites:[[UT.VIL,12],[UT.ARC,6],[UT.MIL,6],[UT.CATA,2],[UT.HERO,1,'belisaire']],
         batiments:[[BT.BARRACKS,6,-5],[BT.UNIV,-6,5]],
         // Le mur de Théodose, d'une mer à l'autre, percé de trois portes.
         murs:[{ de:[0.68,0], a:[0.68,1], portes:3, tag:'theodose' }] },
    p2:{ civ:'byzantins', nom:'Les Dèmes de la Cité', solo:'ia', age:2, res:{food:300,wood:300,stone:150,gold:150},
         depart:[0.84,0.24], base:'tc',
         unites:[[UT.VIL,5],[UT.MIL,5],[UT.ARC,4]] },
  },
  factions:{
    ia:{ civ:'mongols', nom:'Koutrigoures de Zabergan', equipe:3, depart:[0.12,0.50], age:2,
         ageMax:3, heros:false, merveille:false, cible:'cite',
         tune:{ firstAtk:480, atkEvery:140, start:{food:600,wood:600,stone:300,gold:300} },
         // De quoi LOGER et former dès le départ : parti d'un seul Centre
         // Ville, il plafonnait sa population sept minutes durant (mesuré).
         batiments:[[BT.BARRACKS,6,-5],[BT.STABLE,-7,4],[BT.HLM,7,2],[BT.HOUSE,-4,-6],[BT.HOUSE,-6,-6]],
         unites:[[UT.VIL,8],[UT.ENEMI_C,6],[UT.ENEMI,6],[UT.ENEMIA,4]] },
  },
  regles:{ ageMax:3 },
  surcouche:[
    // La Corne d'Or au nord, la Propontide au sud : la Cité est une presqu'île.
    { op:'eau', trace:[[0.62,0],[1,0]], largeur:0.05 },
    { op:'eau', trace:[[0.62,1],[1,1]], largeur:0.05 },
    { op:'foret', zone:'bois_n', n:30 }, { op:'foret', zone:'bois_s', n:30 },
    { op:'degager', zone:'melantias' },
    { op:'gisement', zone:{ x:0.92, y:0.40, r:0.03 }, type:RT.GOLD, n:6, amt:700 },
    { op:'gisement', zone:{ x:0.92, y:0.64, r:0.03 }, type:RT.STONE, n:6, amt:700 },
  ],
  objectifs:[
    { id:'cite',      txt:'Sauvez la Cité : tenez 20 minutes, ou rasez le camp de Zabergan',
      test:M=>M.temps()>=1200||M.vaincu('ia'), compte:M=>[M.temps()/60,20] },
    { id:'belisaire', txt:'Bélisaire doit survivre', echec:M=>M.mort('belisaire'),
      echecTxt:"Le vieux général est tombé. Zabergan campe sous les murs de la Cité." },
    { id:'murailles', txt:'La Cité doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"La Cité est tombée." },
    { id:'piege',     txt:'Le piège de Mélantias : écrasez la horde dans la plaine', type:'secondaire', cache:true, zone:'melantias',
      test:M=>M.detruit('horde') },
    { id:'feu',       txt:'Donnez aux Tours le Feu Grégeois (Université, Âge Impérial)', type:'secondaire',
      test:M=>M.rechercheEquipe('feu_gregeois') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'demes', si:M=>M.temps()>=16, alors:M=>M.dire('demes') },
    { id:'horde', si:M=>M.temps()>=420, alors:M=>{
        M.dire('horde'); M.objectif('piege','ajout');
        M.vague('ia',[[UT.ENEMI_C,9],[UT.ENEMI,12],[UT.ENEMIA,6]],'steppe',{tag:'horde',vers:'cite',via:['melantias','porte_c']});
      } },
    // Les vétérans sortent des bois quand la horde est dans la plaine.
    { id:'embuscade', si:M=>M.tagDansZone('horde','melantias',4), alors:M=>{
        M.dire('embuscade');
        M.renfort('p1',[[UT.CATA,4],[UT.ARC,3]],'bois_n',{vers:'melantias',tag:'veterans'});
        M.renfort('p1',[[UT.CATA,3],[UT.ARC,3]],'bois_s',{vers:'melantias',tag:'veterans'});
      } },
    { id:'raids', repete:true, intervalle:120, si:M=>M.temps()>=540&&M.temps()<1150,
      alors:M=>{
        const n=M.tirs('raids');
        M.vague('ia',[[UT.ENEMI_C,3+n],[UT.ENEMI,5+n],[UT.ENEMIA,2+Math.floor(n/2)]],n%2?'bord_nord':'bord_sud',{vers:'cite',via:[n%2?'porte_n':'porte_s']});
        if(n===1) M.dire('raids');
      } },
    // Zabergan jette ses dernières forces avant que l'hiver ne le renvoie.
    { id:'derniere', si:M=>M.temps()>=960, alors:M=>{
        M.dire('derniere');
        M.vague('ia',[[UT.ENEMI_C,8],[UT.ENEMI,10],[UT.ENEMI_G,2],[UT.ENEMIA,6]],'steppe',{vers:'cite',via:['melantias','porte_c']});
      } },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
    { id:'piege_ok', si:M=>M.fait('piege'), alors:M=>M.dire('piege_ok') },
  ],
  orateurs:{
    belisaire:{ nom:'Bélisaire', ico:'🛡️' },
    demes:    { nom:'Les Dèmes', ico:'🏛️' },
    zabergan: { nom:'Zabergan',  ico:'🐎' },
    ingenieur:{ nom:"L'ingénieur", ico:'🔥' },
  },
  dialogues:{
    intro:[
      ['zabergan',"On dit que Byzance n'a plus que des vieillards pour la défendre. Nous verrons s'ils savent encore courir."],
      ['belisaire',"Qu'il le croie. Les paysans traîneront des branches derrière les chariots : que sa horde voie une armée là où il n'y a que de la poussière."],
    ],
    demes:[['demes',"Les Dèmes de la Cité tiennent le nord. Nous n'avons pas combattu depuis Nika, mais nous nous souvenons de qui nous a épargnés."]],
    horde:[['belisaire',"La horde s'avance vers la plaine de Mélantias. Que personne ne bouge avant qu'ils y soient."]],
    embuscade:[['belisaire',"Maintenant ! Sortez des bois !"]],
    raids:[['demes',"Des cavaliers koutrigoures longent les côtes pour contourner les murs !"]],
    derniere:[['zabergan',"Tout ce qui a encore un cheval, en selle ! La Cité tombera avant l'hiver !"]],
    imperial:[['ingenieur',"L'Âge Impérial ! À l'Université, je peux donner à vos Tours le feu grégeois — il brûle même sur l'eau."]],
    piege_ok:[['belisaire',"La horde est brisée. Zabergan croyait trouver des vieillards."]],
  },
  etoiles:['victoire', M=>M.fait('piege'), M=>M.fait('feu')],
  victoire:"Zabergan repasse le Danube. Pour la dernière fois, Bélisaire a sauvé la Cité — et la Cité lui a rendu hommage.",
};

// ══════════════════════════════════════════════════════════
//  CAMPAGNE DES MONGOLS — « Les Cavaliers de la Steppe »
// ══════════════════════════════════════════════════════════
// Temüjin, de l'orphelin traqué des bords de l'Onon au Khan qui meurt en
// campagne chez les Xia. Mécaniques vedettes : chasse (×2), Cavalier-Archer,
// raid sans siège, retraite simulée, diplomatie à tribut, deux fronts.

// ── 1. Temüjin ───────────────────────────────────────────
// Sans Centre Ville (~15 min) : une bande de cavaliers, une famille, deux
// yourtes. On chasse, on conduit Temüjin jusqu'au site du campement — il y
// est dressé par la mission (un Centre Ville ne se bâtit pas) —, puis on
// délivre Börte, enlevée par les Merkits.
MISSIONS.mo1 = {
  campagne:'mongols', num:1,
  titre:'Temüjin', lieu:"Les rives de l'Onon", date:'1184',
  briefing:[
    "Son père empoisonné, son clan dispersé, Temüjin a grandi en fuyant. Il n'a plus qu'une poignée de fidèles, deux yourtes — et la steppe.",
    "Chassez pour nourrir les vôtres, menez Temüjin jusqu'au bord de l'Onon où le campement sera dressé, et ramenez Börte, sa femme, que les Merkits ont enlevée.",
  ],
  carte:{ graine:1184031, type:'plaines', taille:'petite', reliques:false },
  zones:{
    onon:     { x:0.62, y:0.36, r:0.05 },
    merkit:   { x:0.84, y:0.78, r:0.05 },
    chasse_n: { x:0.28, y:0.20, r:0.08 },
    chasse_s: { x:0.44, y:0.76, r:0.07 },
    bord_est: { x:0.97, y:0.55, r:0.03 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Temüjin', age:1, res:{food:80,wood:260,stone:60,gold:40},
         depart:[0.18,0.60], base:'rien',
         unites:[[UT.VIL,6],[UT.HERO,1,'temujin'],[UT.CAVARC,3],[UT.SCOUT,2]],
         batiments:[[BT.HOUSE,2,0],[BT.HOUSE,4,1]] },
    p2:{ civ:'mongols', nom:'Djamuqa', solo:'fusion', age:1, res:{food:50,wood:100,stone:0,gold:0},
         depart:[0.26,0.86], base:'rien',
         unites:[[UT.CAVARC,4],[UT.SCOUT,2]] },
  },
  factions:{
    pill:{
      batiments:[{ type:BT.OUTPOST, zone:'merkit', tag:'merkit' }, { type:BT.OUTPOST, zone:'merkit', tag:'merkit' }],
      unites:[
        { type:UT.ENEMI,   n:4, zone:'merkit', tag:'merkit', garde:true },
        { type:UT.ENEMIA,  n:3, zone:'merkit', tag:'merkit', garde:true },
        { type:UT.ENEMI_C, n:2, zone:'merkit', tag:'merkit', garde:true },
      ],
    },
  },
  regles:{ ageMax:1 },
  surcouche:[
    // L'Onon, de l'ouest à l'est, au nord du futur campement.
    { op:'eau', trace:[[0.46,0.24],[0.7,0.28],[1,0.25]], largeur:0.012 },
    { op:'degager', zone:'onon' }, { op:'degager', zone:'merkit' },
    { op:'baies', zone:{ x:0.68, y:0.42, r:0.03 }, n:6 },
    { op:'foret', zone:{ x:0.52, y:0.46, r:0.05 }, n:26 },
    { op:'gisement', zone:{ x:0.74, y:0.44, r:0.03 }, type:RT.GOLD, n:4, amt:400 },
    { op:'faune', zone:'chasse_n', type:'deer', n:7 },
    { op:'faune', zone:'chasse_s', type:'deer', n:5 },
    { op:'faune', zone:'chasse_s', type:'boar', n:3 },
  ],
  objectifs:[
    { id:'chasse',    txt:'Nourrissez le clan : chassez 8 bêtes', test:M=>M.statsEquipe('wildlifeHunted')>=8,
      compte:M=>[M.statsEquipe('wildlifeHunted'),8] },
    { id:'campement', txt:"Menez Temüjin sur la rive de l'Onon : le campement y sera dressé", zone:'onon',
      test:M=>M.tire('fondation') },
    { id:'borte',     txt:'Délivrez Börte : abattez le camp des Merkits', zone:'merkit', test:M=>M.detruit('merkit') },
    { id:'temujin',   txt:'Temüjin doit survivre', echec:M=>M.mort('temujin'),
      echecTxt:"Temüjin est tombé. La steppe l'oubliera avant l'hiver." },
    { id:'grande',    txt:'Grande chasse : 14 bêtes', type:'secondaire', test:M=>M.statsEquipe('wildlifeHunted')>=14,
      compte:M=>[M.statsEquipe('wildlifeHunted'),14] },
  ],
  declencheurs:[
    { id:'intro',   si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'djamuqa', si:M=>M.temps()>=16, alors:M=>M.dire('djamuqa','p2') },
    // Le campement : dressé par la mission quand Temüjin arrive — et le clan,
    // qui a désormais un foyer, peut le perdre (M.eliminable).
    { id:'fondation', si:M=>M.tagDansZone('temujin','onon',1), alors:M=>{
        M.poser('p1',BT.TC,'onon'); M.eliminable('p1',true); M.dire('fondation');
      } },
    { id:'raid1', si:M=>M.temps()>=300, alors:M=>{ M.dire('raid'); M.vague('pill',[[UT.ENEMI_C,2],[UT.ENEMI,2]],'bord_est'); } },
    { id:'raid2', si:M=>M.temps()>=560, alors:M=>M.vague('pill',[[UT.ENEMI_C,3],[UT.ENEMI,3],[UT.ENEMIA,2]],'bord_est') },
    { id:'borte_ok', si:M=>M.fait('borte'), alors:M=>{ M.renfort('p1',[[UT.VIL,1,'borte']],'merkit'); M.dire('borte_ok'); } },
    { id:'chasse_ok', si:M=>M.fait('chasse'), alors:M=>M.dire('chasse_ok') },
  ],
  orateurs:{
    temujin:{ nom:'Temüjin', ico:'🏇' },
    djamuqa:{ nom:'Djamuqa', ico:'🏹' },
    hoelun: { nom:'Hoelun, sa mère', ico:'🔥' },
    borte:  { nom:'Börte', ico:'🌙' },
  },
  dialogues:{
    intro:[
      ['hoelun',"Nous n'avons plus de troupeaux, mon fils. Il faudra vivre de ce que la steppe donne : le cerf, le sanglier, la baie."],
      ['temujin',"Alors nous chasserons — les cavaliers abattent le gibier, un Moulin près des yourtes recevra la viande. Et nous dresserons le camp au bord de l'Onon."],
    ],
    djamuqa:[['djamuqa',"Mon anda ! Mes cavaliers sont avec toi. Les Merkits tiennent Börte au sud-est : dis un mot, et nous y allons."]],
    fondation:[['hoelun',"Les yourtes sont dressées au bord de l'eau. Nous avons un foyer, à nouveau — il faudra le défendre."]],
    raid:[['djamuqa',"Des cavaliers merkits rôdent autour du camp ! Ils cherchent nos bêtes et nos gens."]],
    borte_ok:[['borte',"Temüjin ! Je savais que tu viendrais."]],
    chasse_ok:[['hoelun',"Assez de viande séchée pour l'hiver. Personne n'aura faim."]],
  },
  etoiles:['victoire', M=>M.fait('grande'), M=>M.temps()<14*60],
  victoire:"Börte est revenue, le camp est dressé. Les familles dispersées de la steppe commencent à parler d'un certain Temüjin.",
};

// ── 2. L'Union des Clans ─────────────────────────────────
// Diplomatie à tribut (~30 min) : les Kereits de Toghrul se rallient contre
// 400 🍖 et 200 💰 — le prix se lit sur le bouton, il est prélevé à l'accord
// —, les Naimans doivent être soumis. Une alliance n'est jamais sûre : Toghrul
// peut trahir s'il devient bien plus fort que vous (la trahison de l'IA alliée,
// voir js/08-ia.js) — comme il l'a fait en 1203.
MISSIONS.mo2 = {
  campagne:'mongols', num:2,
  titre:"L'Union des Clans", lieu:'La steppe mongole', date:'1204',
  briefing:[
    "Deux puissances se partagent encore la steppe : les Kereits de Toghrul, le vieux protecteur de Temüjin, et les Naimans de Tayang Khan, qui ont accueilli Djamuqa devenu rival.",
    "Ralliez les Kereits — Toghrul ne donne rien pour rien : ouvrez la Diplomatie, le tribut est sur le bouton — et soumettez les Naimans. Méfiez-vous des vieux protecteurs qui deviennent trop forts.",
  ],
  carte:{ graine:1204017, type:'plaines', taille:'moyenne' },
  zones:{
    ordu:  { x:0.18, y:0.46, r:0.05 },
    kereit:{ x:0.40, y:0.84, r:0.05 },
    naiman:{ x:0.84, y:0.30, r:0.05 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Temüjin', age:1, res:{food:450,wood:450,stone:150,gold:250},
         depart:[0.18,0.46], base:'village',
         unites:[[UT.VIL,10],[UT.CAVARC,6],[UT.SCOUT,3],[UT.ARC,4],[UT.HERO,1,'temujin']],
         batiments:[[BT.STABLE,6,-5],[BT.BARRACKS,-6,5]] },
    p2:{ civ:'mongols', nom:'Qasar', solo:'fusion', age:1, res:{food:150,wood:150,stone:50,gold:50},
         depart:[0.26,0.24], base:'tc',
         unites:[[UT.VIL,4],[UT.CAVARC,4],[UT.SCOUT,2]] },
  },
  factions:{
    ia: { civ:'chinois', nom:'Naimans de Tayang Khan', equipe:3, depart:[0.84,0.30], age:1, ageMax:2,
          heros:false, merveille:false, cible:'ordu', tune:{ firstAtk:540, atkEvery:170 },
          unites:[{ type:UT.ENEMI_C, n:1, tag:'djamuqa', pv:3 }] },
    ia2:{ civ:'mongols', nom:'Kereits de Toghrul', equipe:4, depart:[0.40,0.84], age:1, ageMax:2,
          heros:false, merveille:false, role:'passif',
          diplomatie:{ prix:{ food:400, gold:200 }, refus:'Toghrul ne donne rien pour rien.' } },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'gisement', zone:{ x:0.10, y:0.30, r:0.04 }, type:RT.GOLD, n:6, amt:600 },
    { op:'faune', zone:{ x:0.30, y:0.60, r:0.08 }, type:'deer', n:6 },
  ],
  objectifs:[
    { id:'kereits', txt:'Ralliez les Kereits de Toghrul (Diplomatie, dans le menu ⏸)', zone:'kereit',
      test:M=>M.allie('ia2'), echec:M=>M.vaincu('ia2'),
      echecTxt:"Les Kereits sont tombés avant d'avoir juré alliance. Seul, Temüjin n'unira pas la steppe." },
    { id:'naimans', txt:'Soumettez les Naimans : rasez le Centre Ville de Tayang Khan', zone:'naiman', test:M=>M.vaincu('ia') },
    { id:'temujin', txt:'Temüjin doit survivre', echec:M=>M.mort('temujin'),
      echecTxt:"Temüjin est tombé. Les clans retournent à leurs querelles." },
    { id:'djamuqa', txt:'Capturez Djamuqa, le frère juré devenu rival', type:'secondaire', test:M=>M.detruit('djamuqa') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'qasar', si:M=>M.temps()>=16, alors:M=>M.dire('qasar','p2') },
    // Le passif ne tient que tant qu'on ne l'a pas rallié : allié, Toghrul
    // part en guerre contre les Naimans à nos côtés.
    { id:'alliance', si:M=>M.allie('ia2'), alors:M=>{ M.dire('alliance'); M.ia('ia2',{role:'normal',cible:'naiman',lancer:true}); } },
    { id:'trahison', si:M=>M.fait('kereits')&&!M.allie('ia2')&&!M.vaincu('ia2'), alors:M=>M.dire('trahison') },
    { id:'naimans_ok', si:M=>M.fait('naimans'), alors:M=>M.dire('naimans_ok') },
  ],
  orateurs:{
    temujin:{ nom:'Temüjin', ico:'🏇' },
    qasar:  { nom:'Qasar',   ico:'🏹' },
    toghrul:{ nom:'Toghrul', ico:'🐺' },
    tayang: { nom:'Tayang Khan', ico:'🦅' },
  },
  dialogues:{
    intro:[
      ['tayang',"Il n'y a qu'un soleil dans le ciel. Il n'y aura qu'un khan dans la steppe, et ce sera moi."],
      ['temujin',"Toghrul fut l'ami de mon père. Il sait ce qu'il en coûte de m'avoir pour allié — et pour ennemi."],
    ],
    qasar:[['qasar',"Mon frère, je tiens les pâturages du nord. Si les Naimans passent, ils passeront sur moi."]],
    alliance:[['toghrul',"Les Kereits chevaucheront avec toi, fils de Yesügei. Contre les Naimans — pour commencer."]],
    trahison:[['qasar',"Toghrul a rompu l'alliance ! Ses cavaliers se retournent contre nous !"]],
    naimans_ok:[['temujin',"Tayang Khan est tombé. Il n'y a plus qu'un soleil dans la steppe."]],
  },
  etoiles:['victoire', M=>M.fait('djamuqa'), M=>M.allie('ia2')],
  victoire:"Au printemps 1206, sur les bords de l'Onon, les clans réunis en kurultaï proclament Temüjin souverain universel : Gengis Khan.",
};

// ── 3. Le Raid sur les Xia ───────────────────────────────
// Raid sans siège (~15 min) : Yinchuan, derrière ses murs, est imprenable
// pour une armée de cavaliers — la mission interdit l'Atelier de Siège. On
// pille ses champs et ses moulins hors les murs, puis on rentre au camp avant
// que l'armée des Xia ne revienne de la frontière.
MISSIONS.mo3 = {
  campagne:'mongols', num:3,
  titre:'Le Raid sur les Xia', lieu:'Le royaume Xia, sur le fleuve Jaune', date:'1209',
  briefing:[
    "Le royaume tangoute des Xia est riche, et sa capitale, Yinchuan, derrière ses murs, ne craint pas des cavaliers sans machines.",
    "Alors ne prenez pas la ville : prenez ce qui la nourrit. Pillez six de ses fermes et de ses moulins, hors les murs, et ramenez l'armée au camp avant que l'armée des Xia ne revienne de la frontière.",
  ],
  carte:{ graine:1209055, type:'arides', taille:'moyenne', reliques:false },
  zones:{
    camp:    { x:0.14, y:0.50, r:0.06 },
    yinchuan:{ x:0.74, y:0.40, r:0.06 },
    champs1: { x:0.56, y:0.66, r:0.05 },
    champs2: { x:0.88, y:0.72, r:0.05 },
    champs3: { x:0.60, y:0.16, r:0.04 },
    sud:     { x:0.70, y:0.97, r:0.03 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Gengis Khan', age:2, res:{food:300,wood:300,stone:100,gold:200},
         depart:[0.14,0.50], base:'tc',
         unites:[[UT.VIL,6],[UT.CAVARC,10],[UT.SCOUT,4],[UT.KNIGHT,4],[UT.HERO,1,'gengis']],
         batiments:[[BT.STABLE,6,-4],[BT.HOUSE,-3,3],[BT.HOUSE,-3,5],[BT.HOUSE,-5,4]] },
    p2:{ civ:'mongols', nom:'Subötei', solo:'fusion', age:2, res:{food:100,wood:100,stone:0,gold:100},
         depart:[0.20,0.80], base:'rien',
         unites:[[UT.CAVARC,6],[UT.SCOUT,2]] },
  },
  factions:{
    ia:{ civ:'chinois', nom:'Royaume Xia', equipe:3, depart:[0.74,0.40], age:2,
         role:'forteresse', ageMax:2, heros:false, merveille:false, enceinte:true, tune:{ vilTarget:8 },
         batiments:[[BT.CASTLE,-5,-8],[BT.TOWER,8,-5],[BT.TOWER,-7,6],
           { type:BT.FARM, zone:'champs1', tag:'greniers' }, { type:BT.FARM, zone:'champs1', tag:'greniers' },
           { type:BT.MILL, zone:'champs1', tag:'greniers' },
           { type:BT.FARM, zone:'champs2', tag:'greniers' }, { type:BT.MILL, zone:'champs2', tag:'greniers' },
           { type:BT.FARM, zone:'champs3', tag:'greniers' }, { type:BT.MILL, zone:'champs3', tag:'greniers' }],
         unites:[[UT.ENEMIA,4],[UT.ENEMI,4],
           { type:UT.ENEMI, n:3, zone:'champs1', garde:true }, { type:UT.ENEMIA, n:2, zone:'champs1', garde:true },
           { type:UT.ENEMI, n:3, zone:'champs2', garde:true }, { type:UT.ENEMIA, n:2, zone:'champs2', garde:true },
           { type:UT.ENEMIA, n:3, zone:'champs3', garde:true }] },
  },
  regles:{ ageMax:2, interdits:[BT.SIEGE] },
  surcouche:[
    { op:'degager', zone:'champs1' }, { op:'degager', zone:'champs2' }, { op:'degager', zone:'champs3' },
    { op:'foret', zone:{ x:0.22, y:0.30, r:0.05 }, n:26 },
  ],
  objectifs:[
    { id:'pillage', txt:'Pillez 6 greniers des Xia : fermes et moulins, hors les murs',
      test:M=>7-M.restants('greniers')>=6, compte:M=>[7-M.restants('greniers'),6] },
    { id:'retour',  txt:"Ramenez l'armée au camp : 12 cavaliers au camp", cache:true, zone:'camp',
      test:M=>M.armeeDansZone('camp',12) },
    { id:'gengis',  txt:'Gengis Khan doit survivre', echec:M=>M.mort('gengis'),
      echecTxt:"Gengis Khan est tombé sous les murs de Yinchuan." },
    { id:'camp',    txt:'Le camp doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"L'armée des Xia a brûlé le camp. Le butin est perdu." },
    { id:'vite',    txt:"Pillez tout avant le retour de l'armée des Xia (12 min)", type:'secondaire',
      test:M=>M.fait('pillage'), echec:M=>M.temps()>=720&&!M.fait('pillage') },
  ],
  declencheurs:[
    { id:'intro',   si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'subotei', si:M=>M.temps()>=16, alors:M=>M.dire('subotei','p2') },
    // Chaque grenier tombé paie son butin, sur-le-champ.
    { id:'butin', repete:true, intervalle:0.5, si:M=>7-M.restants('greniers')>M.tirs('butin'),
      alors:M=>M.donner('p1',{food:120,gold:60}) },
    { id:'pillage_ok', si:M=>M.fait('pillage'), alors:M=>{ M.dire('pillage_ok'); M.objectif('retour','ajout'); } },
    { id:'armee_xia', si:M=>M.temps()>=720, alors:M=>{
        M.dire('armee_xia');
        M.vague('ia',[[UT.ENEMI_C,6],[UT.ENEMI,10],[UT.ENEMIA,6],[UT.ENEMI_G,1]],'sud',{vers:'camp',tag:'armee_xia'});
      } },
    { id:'murs', si:M=>M.equipeDansZone('yinchuan',1), alors:M=>M.dire('murs') },
  ],
  orateurs:{
    gengis: { nom:'Gengis Khan', ico:'🏇' },
    subotei:{ nom:'Subötei', ico:'🏹' },
    eclaireur:{ nom:'Un éclaireur', ico:'🦅' },
  },
  dialogues:{
    intro:[
      ['gengis',"Leurs murs sont hauts et nous n'avons pas de machines. Tant mieux : nous ne sommes pas venus pour leurs murs."],
      ['eclaireur',"Les champs et les moulins sont hors de la ville, peu gardés. L'armée des Xia est à la frontière — elle reviendra."],
    ],
    subotei:[['subotei',"Mes archers montés prennent les champs du sud. Frappez vite, ne vous attardez pas."]],
    pillage_ok:[['gengis',"Assez ! Les chariots sont pleins. Tout le monde au camp, avant que leur armée ne revienne."]],
    armee_xia:[['eclaireur',"L'armée des Xia arrive par le sud ! Elle marche droit sur le camp !"]],
    murs:[['subotei',"Pas sous les murs, Khan ! Leurs tours tirent loin, et nous n'avons rien pour les abattre."]],
  },
  etoiles:['victoire', M=>M.fait('vite'), M=>M.statsEquipe('lost')<=6],
  victoire:"Les Xia paient tribut et livrent des chameaux, des soieries et des faucons. La porte de la Chine est entrouverte.",
};

// ── 4. La Kalka ──────────────────────────────────────────
// Retraite simulée (~15 min) : l'avant-garde de Djebe provoque l'armée des
// princes russes, puis recule jusqu'à la rivière Kalka, où Subötei attend.
// La poursuite est scriptée (M.traquer) : une troupe lâchée ne court après
// une armée sans base que si on lui dit où elle est.
MISSIONS.mo4 = {
  campagne:'mongols', num:4,
  titre:'La Kalka', lieu:'La rivière Kalka, au nord de la mer Noire', date:'1223',
  briefing:[
    "Djebe et Subötei poursuivent le Shah jusqu'au bout du monde connu. Les princes russes, alliés aux Coumans, ont réuni une armée trois fois plus nombreuse que la leur.",
    "Djebe les provoquera, puis reculera — des jours s'il le faut — jusqu'à la rivière Kalka, où Subötei attend. Faites entrer l'armée des princes dans la plaine de la Kalka : le piège fera le reste.",
  ],
  carte:{ graine:1223531, type:'plaines', taille:'moyenne', reliques:false },
  zones:{
    avantposte:{ x:0.70, y:0.50, r:0.05 },
    rus:       { x:0.84, y:0.50, r:0.06 },
    kalka:     { x:0.28, y:0.50, r:0.08 },
    bois_n:    { x:0.24, y:0.22, r:0.04 },
    bois_s:    { x:0.24, y:0.78, r:0.04 },
    gue:       { x:0.40, y:0.50, r:0.04 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Djebe', age:2, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.56,0.50], base:'rien',
         unites:[[UT.CAVARC,9,'avantgarde'],[UT.SCOUT,3,'avantgarde']] },
    p2:{ civ:'mongols', nom:'Subötei', solo:'fusion', age:2, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.12,0.50], base:'rien',
         unites:[[UT.SCOUT,3]] },
  },
  factions:{
    pill:{
      batiments:[{ type:BT.OUTPOST, zone:'rus' }, { type:BT.OUTPOST, zone:'rus' }],
      unites:[
        { type:UT.ENEMI,   n:14, zone:'rus', tag:'rus', garde:true },
        { type:UT.ENEMIA,  n:7,  zone:'rus', tag:'rus', garde:true },
        { type:UT.ENEMI_C, n:4,  zone:'rus', tag:'rus', garde:true },
        { type:UT.ENEMI_G, n:1,  zone:'rus', tag:'mstislav', garde:true, pv:1.5 },
      ],
    },
  },
  regles:{ ageMax:2 },
  surcouche:[
    // La Kalka, du nord au sud, et son gué : le piège se referme de l'autre côté.
    { op:'eau', trace:[[0.40,0],[0.38,0.3],[0.41,0.7],[0.39,1]], largeur:0.012 },
    { op:'gue', zone:'gue' },
    { op:'foret', zone:'bois_n', n:24 }, { op:'foret', zone:'bois_s', n:24 },
    { op:'degager', zone:'kalka' }, { op:'degager', zone:'rus' },
  ],
  objectifs:[
    { id:'rus',   txt:"Écrasez l'armée des princes", test:M=>M.detruit('rus')&&M.detruit('mstislav'),
      compte:M=>[27-M.restants('rus')-M.restants('mstislav'),27] },
    // Le piège est la leçon, pas une porte fermée : une avant-garde qui
    // écrase les princes sans lui (possible en Facile) doit pouvoir gagner.
    { id:'piege', txt:"Attirez l'armée des princes au-delà de la Kalka, dans la plaine", type:'secondaire', zone:'kalka',
      test:M=>M.tire('embuscade'), echec:M=>!M.tire('embuscade')&&M.detruit('rus')&&M.detruit('mstislav') },
    // L'avant-garde de DJEBE : les éclaireurs de Subötei, postés derrière la
    // rivière, ne comptent pas — sans quoi, l'avant-garde tombée, les princes
    // poursuivaient ces éclaireurs jusque dans le piège, et un joueur qui ne
    // faisait rien gagnait la mission (mesuré à la sonde).
    { id:'avantgarde', txt:"L'avant-garde de Djebe ne doit pas être anéantie avant le piège",
      echec:M=>!M.tire('embuscade')&&!M.vivant('avantgarde'),
      echecTxt:"L'avant-garde de Djebe a été rattrapée et taillée en pièces." },
    { id:'mstislav', txt:'Abattez le prince Mstislav', type:'secondaire', test:M=>M.detruit('mstislav') },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'subotei',si:M=>M.temps()>=16, alors:M=>M.dire('subotei','p2') },
    // La provocation lâche les princes ; passé huit minutes, ils perdent
    // patience et marchent d'eux-mêmes.
    { id:'provocation', si:M=>M.equipeDansZone('avantposte',1)||M.temps()>=480, alors:M=>{
        M.dire('provocation'); M.lacher('rus'); M.lacher('mstislav');
      } },
    { id:'poursuite', repete:true, intervalle:2, si:M=>M.tire('provocation')&&(M.vivant('rus')||M.vivant('mstislav')),
      alors:M=>{ M.traquer('rus'); M.traquer('mstislav'); } },
    { id:'embuscade', si:M=>M.dansZone('kalka','pill',6), alors:M=>{
        M.dire('embuscade');
        M.renfort('p2',[[UT.CAVARC,8],[UT.KNIGHT,5]],'bois_n',{vers:'kalka'});
        M.renfort('p2',[[UT.CAVARC,8],[UT.KNIGHT,5]],'bois_s',{vers:'kalka'});
      } },
    { id:'mstislav_ok', si:M=>M.fait('mstislav'), alors:M=>M.dire('mstislav_ok') },
  ],
  orateurs:{
    djebe:  { nom:'Djebe',   ico:'🏹' },
    subotei:{ nom:'Subötei', ico:'🦅' },
    mstislav:{ nom:'Mstislav', ico:'⚔️' },
  },
  dialogues:{
    intro:[
      ['djebe',"Ils sont trois fois plus nombreux que nous. Parfait : un grand troupeau se mène plus facilement qu'un petit."],
      ['subotei',"Montre-toi, frappe, et recule. Ne te retourne pas avant d'avoir passé la Kalka."],
    ],
    subotei:[['subotei',"Mes hommes sont dans les bois, au-delà de la rivière. Pas un feu, pas un cheval qui hennit."]],
    provocation:[['mstislav',"Les voilà, les cavaliers du Diable ! Ils fuient déjà ! Tous à leurs trousses !"]],
    embuscade:[['subotei',"Ils sont dans la plaine. Maintenant !"]],
    mstislav_ok:[['djebe',"Le prince est tombé. La steppe s'en souviendra."]],
  },
  etoiles:['victoire', M=>M.fait('piege'), M=>M.statsEquipe('lost')<=8],
  victoire:"L'armée des princes est brisée sur la Kalka. Djebe et Subötei ont parcouru plus de cinq mille kilomètres — et repartent vers l'est.",
};

// ── 5. Samarcande ────────────────────────────────────────
// Siège (~30 min) : la plus riche cité du Khwarezm, derrière ses murs. Les
// Kanglis, mercenaires turcs de la garnison, changent de camp quand l'armée
// mongole est aux faubourgs (M.convertir). Le Shah tente de fuir vers le sud.
MISSIONS.mo5 = {
  campagne:'mongols', num:5,
  titre:'Samarcande', lieu:'Samarcande, en Transoxiane', date:'1220',
  briefing:[
    "Le Shah du Khwarezm a fait massacrer une caravane de marchands mongols, puis tuer les ambassadeurs venus demander justice. Gengis Khan est venu en personne.",
    "Samarcande a des murs, une citadelle et une garnison de mercenaires kanglis qui n'aiment pas beaucoup le Shah. Amenez vos Béliers, approchez des faubourgs — et gardez un œil sur la route du sud.",
  ],
  carte:{ graine:1220314, type:'arides', taille:'moyenne' },
  zones:{
    samarcande:{ x:0.74, y:0.44, r:0.06 },
    faubourg:  { x:0.58, y:0.44, r:0.05 },
    porte_est: { x:0.86, y:0.46, r:0.03 },
    fuite:     { x:0.96, y:0.94, r:0.04 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Gengis Khan', age:2, res:{food:700,wood:900,stone:300,gold:500},
         depart:[0.16,0.46], base:'village',
         unites:[[UT.VIL,10],[UT.CAVARC,8],[UT.KNIGHT,6],[UT.PIKE,6],[UT.RAM,3],[UT.HERO,1,'gengis']],
         batiments:[[BT.SIEGE,6,5],[BT.STABLE,6,-5],[BT.BARRACKS,-6,5]] },
    p2:{ civ:'mongols', nom:'Djebe', solo:'fusion', age:2, res:{food:200,wood:200,stone:0,gold:100},
         depart:[0.44,0.86], base:'rien',
         unites:[[UT.SCOUT,4],[UT.CAVARC,6]] },
  },
  factions:{
    ia:{ civ:'chinois', nom:'Khwarezm', equipe:3, depart:[0.74,0.44], age:2,
         role:'forteresse', ageMax:2, heros:false, merveille:false, enceinte:true, tune:{ vilTarget:8 },
         batiments:[[BT.CASTLE,-5,-8],[BT.TOWER,8,-6],[BT.TOWER,8,7],[BT.BARRACKS,-7,4]],
         unites:[[UT.ENEMI_C,4],[UT.ENEMIA,6],[UT.ENEMI,6],
           { type:UT.ENEMI,  n:6, zone:'faubourg', tag:'kanglis', garde:true },
           { type:UT.ENEMI_C,n:3, zone:'faubourg', tag:'kanglis', garde:true }] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'degager', zone:'faubourg' },
    { op:'gisement', zone:{ x:0.10, y:0.26, r:0.04 }, type:RT.STONE, n:6, amt:600 },
  ],
  objectifs:[
    { id:'samarcande', txt:'Prenez Samarcande : rasez le Centre Ville du Khwarezm', zone:'samarcande', test:M=>M.vaincu('ia') },
    { id:'gengis',     txt:'Gengis Khan doit survivre', echec:M=>M.mort('gengis'),
      echecTxt:"Gengis Khan est tombé devant Samarcande. Le siège est levé." },
    { id:'kanglis',    txt:'Approchez des faubourgs : les Kanglis pourraient changer de camp', type:'secondaire', zone:'faubourg',
      test:M=>M.tire('defection') },
    { id:'shah',       txt:"Rattrapez le Shah avant qu'il ne s'enfuie par le sud", type:'secondaire', cache:true,
      test:M=>M.detruit('shah'), echec:M=>M.tagDansZone('shah','fuite',1) },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'djebe', si:M=>M.temps()>=16, alors:M=>M.dire('djebe','p2') },
    { id:'defection', si:M=>M.armeeDansZone('faubourg',6)&&M.vivant('kanglis'), alors:M=>{
        M.convertir('kanglis','p1'); M.dire('defection');
      } },
    { id:'shah', si:M=>M.temps()>=420, alors:M=>{
        M.dire('shah'); M.objectif('shah','ajout');
        M.renfort('ia',[{ type:UT.ENEMI_C, n:1, tag:'shah', pv:3 }],'porte_est',{vers:'fuite'});
        M.renfort('ia',[[UT.ENEMI_C,4]],'porte_est',{vers:'fuite'});
      } },
    { id:'shah_ok', si:M=>M.fait('shah'), alors:M=>M.dire('shah_ok') },
    { id:'breche', si:M=>M.compte('ia',BT.WALL)+M.compte('ia',BT.GATE)<24, alors:M=>M.dire('breche') },
  ],
  orateurs:{
    gengis:{ nom:'Gengis Khan', ico:'🏇' },
    djebe: { nom:'Djebe', ico:'🏹' },
    kangli:{ nom:'Un chef kangli', ico:'🗡️' },
  },
  dialogues:{
    intro:[
      ['gengis',"Les Béliers aux portes, les archers derrière. Et que la cavalerie reste hors de portée des tours."],
      ['djebe',"Je tiens la route du sud. Si le Shah tente de fuir, il passera par là."],
    ],
    djebe:[['djebe',"Mes éclaireurs sont en place au sud. Rien ne sortira de la ville sans que je le voie."]],
    defection:[['kangli',"Le Shah nous paie mal et nous méprise. Les Kanglis ouvrent leurs rangs au Khan !"]],
    shah:[['djebe',"Une colonne sort par la porte est et file vers le sud ! Le Shah est avec eux !"]],
    shah_ok:[['djebe',"Le Shah ne fuira plus."]],
    breche:[['gengis',"La muraille cède ! Par la brèche !"]],
  },
  etoiles:['victoire', M=>M.fait('shah'), M=>M.fait('kanglis')],
  victoire:"Samarcande est tombée. Le Khwarezm, qui se croyait l'empire le plus puissant de l'Islam, n'a pas tenu un an.",
};

// ── 6. Le Bout du Monde ──────────────────────────────────
// Finale à deux fronts (~50 min) : le fils du Shah, Djalal ad-Din, à l'ouest ;
// le royaume Xia, qui a rompu son serment, à l'est. Le second commandant tient
// l'est — l'ami en coop, une IA alliée en solo.
MISSIONS.mo6 = {
  campagne:'mongols', num:6,
  titre:'Le Bout du Monde', lieu:"De l'Indus au fleuve Jaune", date:'1227',
  briefing:[
    "L'empire s'étend de la Chine à la Perse, mais il brûle aux deux bouts : Djalal ad-Din, le fils du Shah, a levé une armée à l'ouest ; les Xia ont renié leur serment à l'est.",
    "Gengis Khan tient l'ouest, Mukhali tient l'est. Les deux capitales doivent tomber — et le vieux Khan doit voir la fin de cette guerre.",
  ],
  carte:{ graine:1227818, type:'plaines', taille:'normale' },
  zones:{
    ouest:{ x:0.08, y:0.50, r:0.05 },
    est:  { x:0.92, y:0.50, r:0.05 },
  },
  roles:{
    p1:{ civ:'mongols', nom:'Gengis Khan', age:2, res:{food:900,wood:1000,stone:500,gold:700},
         depart:[0.34,0.50], base:'village',
         unites:[[UT.VIL,14],[UT.CAVARC,8],[UT.KNIGHT,6],[UT.PIKE,4],[UT.HERO,1,'gengis']],
         batiments:[[BT.STABLE,6,-5],[BT.BARRACKS,-6,5],[BT.SIEGE,6,5]] },
    p2:{ civ:'mongols', nom:'Mukhali', solo:'ia', age:2, res:{food:500,wood:500,stone:250,gold:300},
         depart:[0.66,0.50], base:'village',
         unites:[[UT.VIL,10],[UT.CAVARC,6],[UT.KNIGHT,4]] },
  },
  factions:{
    // Deux vraies puissances, bâties et armées dès le départ : parti d'un
    // Centre Ville nu, le royaume Xia tombait à la douzième minute sous les
    // seuls coups de l'IA alliée, sans que le joueur ait bougé (sonde).
    ia: { civ:'francs',  nom:'Djalal ad-Din', equipe:3, depart:[0.08,0.50], age:2, ageMax:3,
          heros:false, merveille:false, tune:{ firstAtk:540, start:{food:700,wood:700,stone:400,gold:400} },
          batiments:[[BT.BARRACKS,6,-5],[BT.STABLE,-7,4],[BT.HLM,7,2],[BT.HOUSE,-4,-6],[BT.HOUSE,-6,-6]],
          unites:[[UT.VIL,10],[UT.ENEMI_C,6],[UT.ENEMI,8],[UT.ENEMIA,6]] },
    ia2:{ civ:'chinois', nom:'Royaume Xia', equipe:3, depart:[0.92,0.50], age:2, ageMax:3,
          heros:false, merveille:false, tune:{ firstAtk:660, start:{food:700,wood:700,stone:400,gold:400} },
          batiments:[[BT.BARRACKS,-6,-5],[BT.STABLE,7,4],[BT.HLM,-7,2],[BT.HOUSE,4,-6],[BT.HOUSE,6,-6],[BT.TOWER,-5,5]],
          unites:[[UT.VIL,10],[UT.ENEMI,8],[UT.ENEMIA,8],[UT.ENEMI_C,4]] },
  },
  regles:{ ageMax:3 },
  surcouche:[
    { op:'gisement', zone:{ x:0.30, y:0.30, r:0.04 }, type:RT.GOLD, n:8, amt:700 },
    { op:'gisement', zone:{ x:0.70, y:0.70, r:0.04 }, type:RT.GOLD, n:8, amt:700 },
  ],
  objectifs:[
    { id:'deux', txt:"Faites tomber les deux capitales : Djalal ad-Din à l'ouest, les Xia à l'est",
      test:M=>M.vaincu('ia')&&M.vaincu('ia2'), compte:M=>[(M.vaincu('ia')?1:0)+(M.vaincu('ia2')?1:0),2] },
    { id:'gengis', txt:'Gengis Khan doit survivre', echec:M=>M.mort('gengis'),
      echecTxt:"Le Khan est tombé. L'empire se déchire entre ses fils." },
    { id:'etriers', txt:"Donnez à la cavalerie les Étriers de Fer (Université, Âge Impérial)", type:'secondaire',
      test:M=>M.rechercheEquipe('etriers') },
  ],
  declencheurs:[
    { id:'intro',   si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'mukhali', si:M=>M.temps()>=16, alors:M=>M.dire('mukhali') },
    { id:'ouest_ok', si:M=>M.vaincu('ia'),  alors:M=>M.dire('ouest_ok') },
    { id:'est_ok',   si:M=>M.vaincu('ia2'), alors:M=>M.dire('est_ok') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
  ],
  orateurs:{
    gengis: { nom:'Gengis Khan', ico:'🏇' },
    mukhali:{ nom:'Mukhali', ico:'🦅' },
    djalal: { nom:'Djalal ad-Din', ico:'⚔️' },
  },
  dialogues:{
    intro:[
      ['djalal',"Mon père a fui devant toi. Moi, je ne fuirai pas."],
      ['gengis',"Ton père aussi disait cela, avant Samarcande."],
    ],
    mukhali:[['mukhali',"Je tiens l'est, Khan. Les Xia ne passeront pas le fleuve tant que je vivrai."]],
    ouest_ok:[['gengis',"Djalal ad-Din a traversé l'Indus à la nage pour m'échapper. Voilà un fils que j'aurais aimé avoir."]],
    est_ok:[['mukhali',"Yinchuan est tombée. Les Xia ne renieront plus de serment."]],
    imperial:[['gengis',"À l'Université, qu'on forge des étriers de fer : nos cavaliers iront plus vite que la nouvelle de leur arrivée."]],
  },
  etoiles:['victoire', M=>M.fait('etriers'), M=>M.temps()<40*60],
  victoire:"Les deux capitales sont tombées. Gengis Khan meurt peu après, au milieu de son armée ; il laisse à ses fils le plus grand empire d'un seul tenant que le monde ait connu.",
};

// ══════════════════════════════════════════════════════════
//  CAMPAGNE DES CHINOIS — « Le Mandat du Ciel »
// ══════════════════════════════════════════════════════════
// Sun Tzu au service du royaume de Wu, de l'épreuve devant le roi Helü
// (512 av. J.-C.) au siège de Kuaiji (494). Le plan d'origine citait la
// Route de la Soie, qui s'ouvre trois siècles plus tard : la mission du
// commerce devient une route de marchands entre Wu et le royaume de Qi.
// Mécaniques vedettes : la table des contres (exercices), récolte, murailles,
// commerce, diplomatie à plusieurs rivaux, Arbalétrier à Répétition, siège.

// Les quatre exercices de la première mission : une troupe, un adversaire à
// armes égales (sans mise à l'échelle de difficulté : c'est la table des
// contres qu'on apprend), un lieu. Une troupe anéantie est rendue — la leçon
// se recommence, ce n'est pas une défaite.
const EXERCICES_SUNTZU = [
  { id:'d1', zone:'terrain1', depuis:'e1', troupe:[[UT.PIKE,8]],   adverse:[[UT.ENEMI_C,5]] },
  { id:'d2', zone:'terrain2', depuis:'e2', troupe:[[UT.ARC,10]],   adverse:[[UT.ENEMI,9]] },
  { id:'d3', zone:'terrain3', depuis:'e3', troupe:[[UT.KNIGHT,6]], adverse:[[UT.ENEMIA,12]] },
];

// ── 1. L'Art de la Guerre ────────────────────────────────
MISSIONS.ch1 = {
  campagne:'chinois', num:1,
  titre:"L'Art de la Guerre", lieu:'Gusu, capitale du royaume de Wu', date:'512 av. J.-C.',
  briefing:[
    "Un lettré de Qi a écrit treize chapitres sur la guerre. Le roi Helü de Wu les a lus, et veut voir si leur auteur, Sun Tzu, sait aussi commander.",
    "Trois exercices, puis une vraie bataille. Chaque arme a son contre : la pique arrête la charge, la flèche use l'infanterie, le cavalier fond sur les archers. Choisissez la bonne troupe pour chaque adversaire.",
  ],
  carte:{ graine:5120401, type:'plaines', taille:'petite', reliques:false, faune:false },
  zones:{
    camp:     { x:0.18, y:0.50, r:0.05 },
    terrain1: { x:0.44, y:0.24, r:0.04 },
    terrain2: { x:0.44, y:0.76, r:0.04 },
    terrain3: { x:0.68, y:0.50, r:0.04 },
    e1:       { x:0.62, y:0.20, r:0.03 },
    e2:       { x:0.62, y:0.80, r:0.03 },
    e3:       { x:0.88, y:0.50, r:0.03 },
    bord_est: { x:0.97, y:0.50, r:0.03 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.18,0.50], base:'rien',
         unites:[[UT.HERO,1,'suntzu']] },
    p2:{ civ:'chinois', nom:'Wu Zixu', solo:'fusion', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.22,0.40], base:'rien',
         unites:[[UT.SCOUT,2]] },
  },
  regles:{ ageMax:1 },
  surcouche:[
    { op:'degager', zone:'terrain1' }, { op:'degager', zone:'terrain2' }, { op:'degager', zone:'terrain3' },
  ],
  objectifs:[
    { id:'d1', txt:'Premier exercice : brisez la charge des cavaliers avec les Piquiers', cache:true, zone:'terrain1',
      test:M=>M.tire('ex_d1')&&M.detruit('e_d1') },
    { id:'d2', txt:"Deuxième exercice : usez l'infanterie avec les Archers", cache:true, zone:'terrain2',
      test:M=>M.tire('ex_d2')&&M.detruit('e_d2') },
    { id:'d3', txt:'Troisième exercice : fondez sur les archers avec les Chevaliers', cache:true, zone:'terrain3',
      test:M=>M.tire('ex_d3')&&M.detruit('e_d3') },
    { id:'bataille', txt:"La bataille : repoussez l'armée de Chu avec toutes les armes", cache:true, zone:'camp',
      test:M=>M.tire('bataille')&&M.detruit('chu') },
    { id:'suntzu', txt:'Sun Tzu doit survivre', echec:M=>M.mort('suntzu'),
      echecTxt:"Sun Tzu est tombé. Le roi Helü referme le livre des treize chapitres." },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2, alors:M=>M.dire('intro') },
    // Les exercices s'enchaînent : chacun s'ouvre quand le précédent est
    // accompli (le premier au départ).
    ...EXERCICES_SUNTZU.map((ex,i)=>({ id:'ex_'+ex.id,
      si:M=>M.temps()>=6&&(i===0||M.fait(EXERCICES_SUNTZU[i-1].id)),
      alors:M=>{
        M.dire(ex.id); M.objectif(ex.id,'ajout');
        M.renfort('p1',ex.troupe,ex.zone,{tag:'t_'+ex.id});
        // L'adversaire attend à son poste : c'est au joueur d'y mener la
        // bonne troupe (lâché sur elle, il gagnait l'exercice tout seul).
        M.renfort('pill',ex.adverse,ex.depuis,{tag:'e_'+ex.id,garde:true,egal:true});
      } })),
    // Une troupe anéantie avant d'avoir vaincu : on la rend, la leçon recommence.
    ...EXERCICES_SUNTZU.map(ex=>({ id:'reprise_'+ex.id, repete:true, intervalle:4,
      si:M=>M.tire('ex_'+ex.id)&&!M.fait(ex.id)&&!M.vivant('t_'+ex.id)&&M.vivant('e_'+ex.id),
      alors:M=>{ M.dire('reprise'); M.renfort('p1',ex.troupe,ex.zone,{tag:'t_'+ex.id}); } })),
    { id:'bataille', si:M=>M.fait('d3'), alors:M=>{
        M.dire('bataille'); M.objectif('bataille','ajout');
        M.renfort('p1',[[UT.PIKE,6],[UT.ARC,8],[UT.KNIGHT,4],[UT.ARBRAP,4]],'camp');
        M.vague('pill',[[UT.ENEMI,10],[UT.ENEMIA,6],[UT.ENEMI_C,4]],'bord_est',{tag:'chu',vers:'camp'});
      } },
  ],
  orateurs:{
    suntzu:{ nom:'Sun Tzu', ico:'📯' },
    helu:  { nom:'Le roi Helü', ico:'👑' },
    wuzixu:{ nom:'Wu Zixu', ico:'🗡️' },
  },
  dialogues:{
    intro:[
      ['helu',"J'ai lu vos treize chapitres. Montrez-moi qu'ils valent plus que l'encre qui les a écrits."],
      ['suntzu',"Connais l'ennemi et connais-toi toi-même : en cent batailles, tu ne seras jamais en péril. Commençons par connaître nos armes."],
    ],
    d1:[['suntzu',"Des cavaliers campent au-delà du premier terrain. Menez-y les Piquiers : la pique longue arrête la charge, un Piquier frappe la cavalerie bien plus fort que tout autre."]],
    d2:[['suntzu',"De l'infanterie tient le deuxième terrain. Approchez les Archers à portée et tirez : chaque trait l'use avant le contact."]],
    d3:[['suntzu',"Des archers tiennent le troisième terrain. Ils fondent au corps à corps : envoyez les Chevaliers droit sur eux, sans leur laisser le temps de tirer."]],
    reprise:[['wuzixu',"La troupe est tombée. Le maître en envoie une autre : recommencez, et choisissez mieux votre approche."]],
    bataille:[['helu',"Assez d'exercices. L'armée de Chu franchit la frontière — toutes les armes, maintenant !"]],
  },
  etoiles:['victoire', M=>!EXERCICES_SUNTZU.some(ex=>M.tirs('reprise_'+ex.id)>0), M=>M.temps()<10*60],
  victoire:"Le roi Helü fait de Sun Tzu son général. Les treize chapitres deviendront L'Art de la Guerre.",
};

// ── 2. Les Greniers de Wu ────────────────────────────────
// Course économique (~20 min) : 3 000 de nourriture récoltée avant l'hiver,
// sous des raids qui visent les champs. La récolte chinoise (+15 %) et les
// deux villageois de plus au départ font la différence.
MISSIONS.ch2 = {
  campagne:'chinois', num:2,
  titre:'Les Greniers de Wu', lieu:'Les rizières du lac Tai', date:'511 av. J.-C.',
  briefing:[
    "Une armée se nourrit avant de se battre, disent les treize chapitres. Avant de marcher sur Chu, Wu doit remplir ses greniers.",
    "Récoltez 3 000 de nourriture et 600 d'or avant l'hiver — vingt minutes. Des pillards de Yue viendront brûler les champs : Wu Zixu tient les archers.",
  ],
  carte:{ graine:5110722, type:'lacs', taille:'moyenne', reliques:false },
  zones:{
    grenier:  { x:0.30, y:0.56, r:0.06 },
    bord_sud: { x:0.60, y:0.97, r:0.03 },
    bord_est: { x:0.97, y:0.44, r:0.03 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:1, res:{food:200,wood:450,stone:100,gold:100},
         depart:[0.30,0.56], base:'village',
         unites:[[UT.VIL,12],[UT.HERO,1,'suntzu']] },
    p2:{ civ:'chinois', nom:'Wu Zixu', solo:'fusion', age:1, res:{food:100,wood:150,stone:50,gold:50},
         depart:[0.44,0.70], base:'rien',
         unites:[[UT.ARC,6],[UT.PIKE,3]],
         batiments:[{ type:BT.TOWER, zone:{ x:0.46, y:0.72, r:0 } }] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'terre', zone:'grenier' },
    { op:'gisement', zone:{ x:0.18, y:0.40, r:0.04 }, type:RT.GOLD, n:6, amt:500 },
    { op:'baies', zone:{ x:0.40, y:0.46, r:0.03 }, n:8 },
  ],
  objectifs:[
    { id:'vivres', txt:"Récoltez 3 000 de nourriture avant l'hiver (20 min)", test:M=>M.recolte('food')>=3000,
      echec:M=>M.temps()>=1200&&M.recolte('food')<3000, compte:M=>[M.recolte('food'),3000],
      echecTxt:"L'hiver est venu, les greniers à moitié vides. L'armée ne marchera pas cette année." },
    { id:'or',     txt:"Récoltez 600 d'or", test:M=>M.recolte('gold')>=600, compte:M=>[M.recolte('gold'),600] },
    { id:'village',txt:'Le village doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Les pillards de Yue ont brûlé le village." },
    { id:'fermes', txt:'Faites pousser 12 fermes', type:'secondaire', test:M=>M.compteEquipe(BT.FARM)>=12,
      compte:M=>[M.compteEquipe(BT.FARM),12] },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'wuzixu', si:M=>M.temps()>=16, alors:M=>M.dire('wuzixu','p2') },
    { id:'raid', repete:true, intervalle:100, si:M=>M.temps()>=240&&M.temps()<1150,
      alors:M=>{
        const n=M.tirs('raid');
        const compo=[[UT.ENEMI,2+n]];
        if(n>=2) compo.push([UT.ENEMIA,1+Math.floor(n/2)]);
        if(n>=5) compo.push([UT.ENEMI_C,Math.floor(n/3)]);
        M.vague('pill',compo,n%2?'bord_sud':'bord_est');
        if(n===1) M.dire('raid');
      } },
    { id:'mi_chemin', si:M=>M.recolte('food')>=1500, alors:M=>M.dire('mi_chemin') },
    { id:'hiver', si:M=>M.temps()>=1080&&!M.fait('vivres'), alors:M=>M.dire('hiver') },
  ],
  orateurs:{
    suntzu:{ nom:'Sun Tzu', ico:'📯' },
    wuzixu:{ nom:'Wu Zixu', ico:'🗡️' },
    intendant:{ nom:"L'intendant des greniers", ico:'🌾' },
  },
  dialogues:{
    intro:[
      ['suntzu',"Celui qui transporte ses vivres sur mille li épuise son peuple. Nourrissons l'armée ici, avant de partir."],
      ['intendant',"Trois mille mesures, seigneur, et de l'or pour les forges. Les rizières sont bonnes, si on les défend."],
    ],
    wuzixu:[['wuzixu',"Mes archers gardent les champs au sud. Qu'on me prévienne si la fumée monte ailleurs."]],
    raid:[['wuzixu',"Les pillards de Yue ! Ils brûlent tout ce qui pousse !"]],
    mi_chemin:[['intendant',"La moitié des greniers est pleine. Encore un effort avant l'hiver."]],
    hiver:[['intendant',"Les premières gelées arrivent, seigneur. Il reste peu de temps."]],
  },
  etoiles:['victoire', M=>M.fait('fermes'), M=>M.statsEquipe('bldLost')===0],
  victoire:"Les greniers de Wu débordent. L'armée peut marcher — et elle ne mangera pas le blé de ses propres paysans.",
};

// ── 3. La Muraille du Nord ───────────────────────────────
// Fortification (~16 min) : deux lacs, une trouée entre eux. Une palissade
// continue — portails fermés — doit la barrer avant l'arrivée des cavaliers
// (M.coupe : plus AUCUN chemin praticable entre le nord et le sud).
MISSIONS.ch3 = {
  campagne:'chinois', num:3,
  titre:'La Muraille du Nord', lieu:'La frontière du Nord', date:'508 av. J.-C.',
  briefing:[
    "Des cavaliers des steppes descendent chaque automne piller les marches du Nord. Entre deux grands lacs, une seule trouée leur ouvre le chemin.",
    "Fermez-la : une palissade continue, d'un lac à l'autre, et des portails fermés. Puis tenez-la jusqu'à ce que les cavaliers renoncent.",
  ],
  carte:{ graine:5080312, type:'plaines', taille:'moyenne', reliques:false },
  zones:{
    steppe: { x:0.50, y:0.08, r:0.04 },
    wu:     { x:0.50, y:0.74, r:0.05 },
    trouee: { x:0.50, y:0.42, r:0.07 },
    nord_o: { x:0.30, y:0.03, r:0.03 },
    nord_e: { x:0.70, y:0.03, r:0.03 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:1, res:{food:300,wood:700,stone:250,gold:100},
         depart:[0.50,0.70], base:'village',
         unites:[[UT.VIL,12],[UT.ARC,4],[UT.PIKE,4],[UT.HERO,1,'suntzu']],
         batiments:[[BT.BARRACKS,6,-5]] },
    p2:{ civ:'chinois', nom:'Wu Zixu', solo:'fusion', age:1, res:{food:100,wood:200,stone:100,gold:0},
         depart:[0.36,0.54], base:'rien',
         unites:[[UT.VIL,4],[UT.ARC,4]] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    // Deux lacs allongés d'un bord à l'autre, et la trouée entre eux.
    { op:'eau', trace:[[0,0.42],[0.40,0.42]], largeur:0.025 },
    { op:'eau', trace:[[0.60,0.42],[1,0.42]], largeur:0.025 },
    { op:'degager', zone:'trouee' },
    { op:'foret', zone:{ x:0.30, y:0.62, r:0.06 }, n:40 },
    { op:'gisement', zone:{ x:0.66, y:0.62, r:0.04 }, type:RT.STONE, n:6, amt:600 },
  ],
  objectifs:[
    { id:'muraille', txt:"Fermez la trouée : une palissade continue d'un lac à l'autre, portails fermés", zone:'trouee',
      test:M=>M.coupe('steppe','wu') },
    { id:'tenir',    txt:"Tenez la frontière jusqu'au départ des cavaliers (16 min)", test:M=>M.temps()>=960,
      compte:M=>[M.temps()/60,16] },
    { id:'village',  txt:'Le village doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Les cavaliers ont passé la trouée et brûlé le village." },
    { id:'tot',      txt:'Muraille fermée avant la première charge (6 min)', type:'secondaire',
      test:M=>M.fait('muraille'), echec:M=>M.temps()>=360&&!M.fait('muraille') },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'wuzixu', si:M=>M.temps()>=16, alors:M=>M.dire('wuzixu','p2') },
    { id:'muraille_ok', si:M=>M.fait('muraille'), alors:M=>M.dire('muraille_ok') },
    { id:'charge', repete:true, intervalle:80, si:M=>M.temps()>=360&&M.temps()<930,
      alors:M=>{
        const n=M.tirs('charge');
        const compo=[[UT.ENEMI_C,2+n],[UT.ENEMI,2+Math.floor(n/2)]];
        if(n>=3) compo.push([UT.ENEMI_G,1]);
        M.vague('pill',compo,n%2?'nord_o':'nord_e');
        if(n===1) M.dire('charge');
      } },
    { id:'breche', si:M=>M.fait('muraille')&&!M.coupe('steppe','wu'), alors:M=>M.dire('breche') },
  ],
  orateurs:{
    suntzu:{ nom:'Sun Tzu', ico:'📯' },
    wuzixu:{ nom:'Wu Zixu', ico:'🗡️' },
    guetteur:{ nom:'Un guetteur', ico:'🔭' },
  },
  dialogues:{
    intro:[
      ['suntzu',"L'invincibilité dépend de nous ; la vulnérabilité de l'ennemi dépend de lui. Fermons la trouée, et laissons-les se briser dessus."],
      ['guetteur',"Les lacs sont infranchissables. Il n'y a que la trouée : une palissade bien jointe, et des portails qu'on garde fermés."],
    ],
    wuzixu:[['wuzixu',"Mes bûcherons sont à l'ouest. Du bois pour mille pas de palissade, s'il le faut."]],
    muraille_ok:[['guetteur',"La trouée est fermée ! Plus rien ne passe du nord au sud."]],
    charge:[['guetteur',"Les cavaliers des steppes ! Ils foncent sur la trouée !"]],
    breche:[['wuzixu',"Brèche dans la muraille ! Qu'on la referme, vite !"]],
  },
  etoiles:['victoire', M=>M.fait('tot'), M=>M.statsEquipe('bldLost')<=5],
  victoire:"Les cavaliers repartent vers le nord, les mains vides. La muraille tient — et tiendra encore des siècles, sous d'autres noms.",
};

// ── 4. La Route des Marchands ────────────────────────────
// Commerce (~20 min) : une route entre deux Marchés éloignés, à faire
// rapporter 1 000 d'or. Le relais de l'est est isolé : Wu Zixu le tient.
MISSIONS.ch4 = {
  campagne:'chinois', num:4,
  titre:'La Route des Marchands', lieu:'De Gusu au royaume de Qi', date:'507 av. J.-C.',
  briefing:[
    "Une guerre coûte mille pièces d'or par jour, disent les treize chapitres. Wu n'a pas cet or : il faut le faire venir.",
    "Ouvrez une route commerciale entre le Marché de Gusu et celui du relais de l'est, et qu'elle rapporte 1 000 d'or. Les pillards ont vu passer les caravanes : le relais devra tenir.",
  ],
  carte:{ graine:5070915, type:'plaines', taille:'moyenne' },
  zones:{
    gusu:   { x:0.16, y:0.50, r:0.05 },
    relais: { x:0.84, y:0.44, r:0.05 },
    nord:   { x:0.60, y:0.03, r:0.03 },
    sud:    { x:0.66, y:0.97, r:0.03 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:1, res:{food:300,wood:500,stone:100,gold:150},
         depart:[0.16,0.50], base:'village',
         unites:[[UT.VIL,10],[UT.ARC,3],[UT.HERO,1,'suntzu']] },
    p2:{ civ:'chinois', nom:'Wu Zixu', solo:'fusion', age:1, res:{food:150,wood:250,stone:100,gold:50},
         depart:[0.84,0.44], base:'tc',
         unites:[[UT.VIL,4],[UT.ARC,5],[UT.PIKE,3]],
         batiments:[[BT.MARKET,4,-4],[BT.TOWER,-3,4]] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'degager', zone:'relais' },
  ],
  objectifs:[
    { id:'route',  txt:"Faites rapporter 1 000 d'or à vos caravanes (Marché → route commerciale)",
      test:M=>M.statsEquipe('tradeGold')>=1000, compte:M=>[M.statsEquipe('tradeGold'),1000] },
    { id:'relais', txt:"Le relais de l'est doit tenir", zone:'relais', echec:M=>!M.bati(BT.TC,'relais'),
      echecTxt:"Le relais de l'est est tombé. La route est coupée." },
    { id:'suntzu', txt:'Sun Tzu doit survivre', echec:M=>M.mort('suntzu'),
      echecTxt:"Sun Tzu est tombé sur la route." },
    { id:'trois',  txt:'Ouvrez une seconde route : trois Marchés', type:'secondaire', test:M=>M.compteEquipe(BT.MARKET)>=3,
      compte:M=>[M.compteEquipe(BT.MARKET),3] },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'wuzixu', si:M=>M.temps()>=16, alors:M=>M.dire('wuzixu','p2') },
    { id:'premiere', si:M=>M.statsEquipe('tradeGold')>0, alors:M=>M.dire('premiere') },
    { id:'pillards', repete:true, intervalle:110, si:M=>M.temps()>=300&&!M.fait('route'),
      alors:M=>{
        const n=M.tirs('pillards');
        M.vague('pill',[[UT.ENEMI,3+n],[UT.ENEMIA,1+Math.floor(n/2)]],n%2?'nord':'sud',{vers:'relais'});
        if(n===1) M.dire('pillards');
      } },
  ],
  orateurs:{
    suntzu:{ nom:'Sun Tzu', ico:'📯' },
    wuzixu:{ nom:'Wu Zixu', ico:'🗡️' },
    marchand:{ nom:'Un marchand de Qi', ico:'💰' },
  },
  dialogues:{
    intro:[
      ['marchand',"Le sel de Qi contre la soie de Wu : les deux marchés s'enrichiront. Plus la route est longue, plus la caravane rapporte."],
      ['suntzu',"Sélectionnez un Marché, choisissez l'autre comme destination : les caravanes feront le reste."],
    ],
    wuzixu:[['wuzixu',"Le relais de l'est a son Marché. Je le tiens — mais il est loin de tout."]],
    premiere:[['marchand',"La première caravane est arrivée ! L'or commence à couler."]],
    pillards:[['wuzixu',"Des pillards convergent vers le relais ! Ils en veulent aux caravanes !"]],
  },
  etoiles:['victoire', M=>M.fait('trois'), M=>M.temps()<16*60],
  victoire:"Les caravanes vont et viennent entre Wu et Qi. Le trésor de guerre est plein.",
};

// ── 5. Boju ──────────────────────────────────────────────
// Conquête à trois (~40 min) : prendre Ying, la capitale de Chu, pendant que
// Yue attaque Wu dans le dos. Yue peut être apaisé par la diplomatie (la
// règle ordinaire : il n'accepte que s'il n'est pas le plus fort) — et peut
// trahir s'il le devient.
MISSIONS.ch5 = {
  campagne:'chinois', num:5,
  titre:'Boju', lieu:'Du royaume de Wu à Ying, capitale de Chu', date:'506 av. J.-C.',
  briefing:[
    "Chu est le plus grand royaume du Sud. Sun Tzu a remonté la rivière Han, battu son armée à Boju, et marche sur Ying.",
    "Prenez Ying. Pendant ce temps, Yue attaque Wu dans le dos : Fugai tient la frontière. Yue acceptera peut-être une trêve — s'il n'est pas le plus fort.",
  ],
  carte:{ graine:5061122, type:'plaines', taille:'normale' },
  zones:{
    ying:  { x:0.84, y:0.34, r:0.06 },
    wu:    { x:0.18, y:0.46, r:0.05 },
    yue:   { x:0.34, y:0.88, r:0.05 },
    gue_han:{ x:0.56, y:0.40, r:0.03 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:2, res:{food:700,wood:800,stone:400,gold:500},
         depart:[0.18,0.46], base:'village',
         unites:[[UT.VIL,14],[UT.ARBRAP,6],[UT.PIKE,6],[UT.KNIGHT,4],[UT.HERO,1,'suntzu']],
         batiments:[[BT.BARRACKS,6,-5],[BT.CASTLE,-7,4]] },
    p2:{ civ:'chinois', nom:'Fugai', solo:'fusion', age:2, res:{food:250,wood:250,stone:150,gold:150},
         depart:[0.26,0.70], base:'tc',
         unites:[[UT.VIL,5],[UT.ARC,6],[UT.PIKE,4]],
         batiments:[[BT.TOWER,5,4]] },
  },
  factions:{
    // Deux royaumes bâtis et armés dès le départ (partis d'un Centre Ville nu,
    // un joueur inactif tenait encore à la 21e minute en Normal — sonde).
    ia: { civ:'francs',  nom:'Royaume de Chu', equipe:3, depart:[0.84,0.34], age:2, ageMax:3,
          heros:false, merveille:false, tune:{ firstAtk:600, start:{food:700,wood:700,stone:400,gold:400} },
          batiments:[[BT.BARRACKS,-6,-5],[BT.STABLE,7,4],[BT.HLM,-7,2],[BT.HOUSE,4,-6],[BT.HOUSE,6,-6],[BT.TOWER,-5,5]],
          unites:[[UT.VIL,10],[UT.ENEMI,8],[UT.ENEMIA,6],[UT.ENEMI_C,4]] },
    ia2:{ civ:'mongols', nom:'Royaume de Yue', equipe:4, depart:[0.34,0.88], age:2, ageMax:3,
          heros:false, merveille:false, cible:'wu', diplomatie:true,
          tune:{ firstAtk:480, start:{food:500,wood:500,stone:250,gold:250} },
          batiments:[[BT.BARRACKS,6,-5],[BT.HLM,-7,2],[BT.HOUSE,4,5]],
          unites:[[UT.VIL,8],[UT.ENEMI,6],[UT.ENEMIA,4],[UT.ENEMI_C,2]] },
  },
  regles:{ ageMax:3 },
  surcouche:[
    // La rivière Han, du nord au sud, entre Wu et Chu.
    { op:'eau', trace:[[0.58,0],[0.56,0.4],[0.60,0.7],[0.58,1]], largeur:0.012 },
    { op:'gue', zone:'gue_han' },
    { op:'gue', zone:{ x:0.60, y:0.74, r:0.03 } },
  ],
  objectifs:[
    { id:'ying',   txt:'Prenez Ying : rasez le Centre Ville de Chu', zone:'ying', test:M=>M.vaincu('ia') },
    { id:'wu',     txt:'Wu doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Yue a brûlé la capitale de Wu pendant que l'armée était au loin." },
    { id:'suntzu', txt:'Sun Tzu doit survivre', echec:M=>M.mort('suntzu'),
      echecTxt:"Sun Tzu est tombé sur la route de Ying." },
    { id:'yue',    txt:'Réglez le sort de Yue : une trêve (Diplomatie), ou sa défaite', type:'secondaire', zone:'yue',
      test:M=>M.allie('ia2')||M.vaincu('ia2') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'fugai', si:M=>M.temps()>=16, alors:M=>M.dire('fugai','p2') },
    { id:'yue_attaque', si:M=>M.temps()>=460, alors:M=>M.dire('yue_attaque') },
    { id:'treve', si:M=>M.allie('ia2'), alors:M=>M.dire('treve') },
    { id:'trahison', si:M=>M.tire('treve')&&!M.allie('ia2')&&!M.vaincu('ia2'), alors:M=>M.dire('trahison') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
  ],
  orateurs:{
    suntzu:{ nom:'Sun Tzu', ico:'📯' },
    fugai: { nom:'Fugai', ico:'🗡️' },
    helu:  { nom:'Le roi Helü', ico:'👑' },
  },
  dialogues:{
    intro:[
      ['helu',"Chu nous a humiliés pendant trois générations. Qu'elle apprenne ce que vaut Wu."],
      ['suntzu',"La guerre est tout entière fondée sur la ruse. Frappons là où ils ne nous attendent pas : par le gué de la Han."],
    ],
    fugai:[['fugai',"Je tiens la frontière du sud. Si Yue bouge, je le verrai."]],
    yue_attaque:[['fugai',"Yue a franchi la frontière ! Leurs colonnes marchent sur Wu !"]],
    treve:[['fugai',"Yue accepte une trêve. Pour combien de temps, je ne sais pas."]],
    trahison:[['fugai',"Yue a rompu la trêve ! Ils nous attaquent à nouveau !"]],
    imperial:[['suntzu',"À l'Université, qu'on étudie l'arc composite : nos tireurs porteront plus loin que les leurs."]],
  },
  etoiles:['victoire', M=>M.fait('yue'), M=>M.temps()<35*60],
  victoire:"Ying est tombée. Pour la première fois, Wu est la première puissance du Sud.",
};

// ── 6. Kuaiji ────────────────────────────────────────────
// Siège final (~45 min) : le roi Goujian de Yue s'est retranché sur le mont
// Kuaiji. Âge Impérial autorisé : Trébuchets, Arbalétriers à Répétition, Arc
// Composite. Chu envoie une armée de secours.
MISSIONS.ch6 = {
  campagne:'chinois', num:6,
  titre:'Kuaiji', lieu:'Le mont Kuaiji, au royaume de Yue', date:'494 av. J.-C.',
  briefing:[
    "Le vieux roi Helü est mort d'une blessure reçue contre Yue. Son fils Fuchai a juré de le venger, et Sun Tzu marche une dernière fois.",
    "Le roi Goujian s'est retranché sur le mont Kuaiji, derrière une enceinte et un château. Montez à l'Âge Impérial, amenez les Trébuchets — et gardez un œil sur l'armée de secours de Chu.",
  ],
  carte:{ graine:4941030, type:'foret', taille:'normale' },
  zones:{
    kuaiji: { x:0.80, y:0.66, r:0.06 },
    wu:     { x:0.18, y:0.30, r:0.05 },
    chu:    { x:0.80, y:0.14, r:0.05 },
  },
  roles:{
    p1:{ civ:'chinois', nom:'Sun Tzu', age:2, res:{food:1000,wood:1200,stone:700,gold:900},
         depart:[0.18,0.30], base:'village',
         unites:[[UT.VIL,16],[UT.ARBRAP,8],[UT.PIKE,6],[UT.KNIGHT,6],[UT.RAM,2],[UT.HERO,1,'suntzu']],
         batiments:[[BT.BARRACKS,6,-5],[BT.CASTLE,-7,4],[BT.SIEGE,7,4],[BT.UNIV,-6,-6]] },
    p2:{ civ:'chinois', nom:'Fuchai', solo:'fusion', age:2, res:{food:300,wood:300,stone:200,gold:200},
         depart:[0.26,0.64], base:'tc',
         unites:[[UT.VIL,5],[UT.ARC,6],[UT.KNIGHT,4]] },
  },
  factions:{
    ia: { civ:'mongols', nom:'Yue de Goujian', equipe:3, depart:[0.80,0.66], age:3,
          role:'forteresse', heros:false, merveille:false, enceinte:true, tune:{ vilTarget:10 },
          batiments:[[BT.CASTLE,-5,-8],[BT.TOWER,8,-6],[BT.TOWER,8,7],[BT.TOWER,-7,7],[BT.BARRACKS,-8,3]],
          unites:[[UT.ENEMI_C,6],[UT.ENEMIA,6],[UT.ENEMI,8]] },
    // Une armée de secours, pas un village : bâtie et armée dès le départ
    // (partie d'un Centre Ville nu, elle ne menaçait personne en 21 minutes).
    ia2:{ civ:'francs', nom:'Armée de secours de Chu', equipe:3, depart:[0.80,0.14], age:2, ageMax:3,
          heros:false, merveille:false, cible:'wu', tune:{ firstAtk:600, start:{food:700,wood:700,stone:400,gold:400} },
          batiments:[[BT.BARRACKS,-6,4],[BT.STABLE,7,4],[BT.HLM,-7,-2],[BT.HOUSE,4,-4]],
          unites:[[UT.VIL,10],[UT.ENEMI,10],[UT.ENEMIA,6],[UT.ENEMI_C,6]] },
  },
  regles:{ ageMax:3 },
  surcouche:[
    { op:'degager', zone:'kuaiji' },
    { op:'gisement', zone:{ x:0.10, y:0.46, r:0.04 }, type:RT.STONE, n:8, amt:700 },
    { op:'gisement', zone:{ x:0.30, y:0.14, r:0.04 }, type:RT.GOLD, n:8, amt:700 },
  ],
  objectifs:[
    { id:'kuaiji', txt:'Prenez Kuaiji : rasez le Centre Ville de Goujian', zone:'kuaiji', test:M=>M.vaincu('ia') },
    { id:'suntzu', txt:'Sun Tzu doit survivre', echec:M=>M.mort('suntzu'),
      echecTxt:"Sun Tzu est tombé au pied du mont Kuaiji." },
    { id:'wu',     txt:'Wu doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"L'armée de Chu a brûlé la capitale de Wu." },
    { id:'arc',    txt:"Étudiez l'Arc Composite (Université, Âge Impérial)", type:'secondaire',
      test:M=>M.rechercheEquipe('arc_composite') },
    { id:'chu',    txt:"Brisez l'armée de secours de Chu", type:'secondaire', test:M=>M.vaincu('ia2') },
  ],
  declencheurs:[
    { id:'intro',  si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'fuchai', si:M=>M.temps()>=16, alors:M=>M.dire('fuchai','p2') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
    { id:'secours', si:M=>M.temps()>=700, alors:M=>M.dire('secours') },
    { id:'breche', si:M=>M.compte('ia',BT.WALL)+M.compte('ia',BT.GATE)<24, alors:M=>M.dire('breche') },
  ],
  orateurs:{
    suntzu:  { nom:'Sun Tzu', ico:'📯' },
    fuchai:  { nom:'Fuchai',  ico:'👑' },
    goujian: { nom:'Goujian', ico:'🐍' },
  },
  dialogues:{
    intro:[
      ['goujian',"Wu a perdu son roi. Qu'elle perde aussi son général sur ma montagne."],
      ['suntzu',"Assiéger une ville fortifiée est le pire des partis. Mais quand il le faut, qu'on amène les trébuchets, et qu'on ne laisse aucune issue."],
    ],
    fuchai:[['fuchai',"Je n'oublierai pas mon père. Je tiens Wu pendant que vous montez à Kuaiji."]],
    imperial:[['suntzu',"L'Âge Impérial : les Trébuchets portent plus loin que leurs tours. Et à l'Université, l'arc composite."]],
    secours:[['fuchai',"L'armée de Chu descend du nord ! Elle marche sur Wu !"]],
    breche:[['suntzu',"L'enceinte est ouverte. Ne laissez pas Goujian s'échapper."]],
  },
  etoiles:['victoire', M=>M.fait('arc'), M=>M.fait('chu')],
  victoire:"Goujian se rend et devient le serviteur de Fuchai. On dit que Sun Tzu se retira alors, loin des cours — laissant ses treize chapitres au monde.",
};

// ══════════════════════════════════════════════════════════
//  CAMPAGNE DES GITANOS — « La Route »
// ══════════════════════════════════════════════════════════
// Zaïda la Voyageuse, meneuse de caravane, de l'arrivée en Aragon (1425, un
// sauf-conduit du roi Alphonse V) au Grand Rassemblement. Consigne d'écriture,
// tenue pour chaque réplique : un peuple de la route, de marchands, de
// forgerons, de maquignons et de musiciens ; la famille, la parole donnée,
// l'hospitalité. Jamais de vol, de malédiction ni de « diseuse » : les
// adversaires sont des seigneurs qui veulent les chasser, pas l'inverse.
// Mécaniques vedettes : escorte de Roulottes, commerce (+50 %), Hospice,
// diplomatie à tribut, Roues Cerclées, ralliement par le commerce, Merveille.

// ── 1. La Caravane ───────────────────────────────────────
// Escorte sans base (~12 min) : quatre roulottes et les familles, des
// Pyrénées à Saragosse. Un abattis de routiers barre le gué ; au poste
// frontière, les roulottes doivent attendre qu'on vise le sauf-conduit —
// une minute sous les coups. Les routiers POURSUIVENT le convoi
// (M.traquer) : lancée sur sa position du moment, une embuscade arrivait
// derrière un convoi déjà passé (mesuré : Saragosse en 116 s, Brutal, sans
// une perte).
MISSIONS.gi1 = {
  campagne:'gitanos', num:1,
  titre:'La Caravane', lieu:"Des Pyrénées à Saragosse", date:'1425',
  briefing:[
    "Après des années de route, la compagnie de Zaïda arrive aux portes de l'Aragon. Le roi Alphonse a signé un sauf-conduit : ils peuvent voyager librement dans tout le royaume.",
    "Encore faut-il arriver. Faites viser le sauf-conduit au poste frontière, puis menez les roulottes jusqu'à Saragosse — au moins trois sur quatre. Des bandes de routiers, qui ne savent pas lire les sceaux royaux, guettent la route.",
  ],
  carte:{ graine:1425061, type:'foret', taille:'moyenne', reliques:false },
  zones:{
    col:       { x:0.06, y:0.18, r:0.04 },
    approche:  { x:0.30, y:0.36, r:0.07 },
    gue:       { x:0.40, y:0.44, r:0.03 },
    poste:     { x:0.58, y:0.60, r:0.04 },
    a1:        { x:0.36, y:0.18, r:0.03 },
    a2:        { x:0.78, y:0.46, r:0.03 },
    a3:        { x:0.50, y:0.86, r:0.03 },
    saragosse: { x:0.92, y:0.82, r:0.05 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.08,0.20], base:'rien',
         unites:[[UT.ROUL,4,'caravane'],[UT.VIL,6,'famille'],[UT.HERO,1,'zaida'],[UT.MIL,5]] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:1, res:{food:0,wood:0,stone:0,gold:0},
         depart:[0.14,0.26], base:'rien',
         unites:[[UT.SCOUT,3],[UT.ARC,4]] },
  },
  factions:{
    pill:{
      // L'abattis des routiers en travers du gué, leurs archers derrière.
      murs:[{ de:[0.41,0.40], a:[0.41,0.48], tag:'abattis' }],
      unites:[
        { type:UT.ENEMIA, n:4, zone:{ x:0.45, y:0.44, r:0.01 }, tag:'gue_garde', garde:true },
        { type:UT.ENEMI,  n:3, zone:{ x:0.45, y:0.44, r:0.01 }, tag:'gue_garde', garde:true },
      ],
    },
  },
  regles:{ ageMax:1 },
  surcouche:[
    // Le Gállego, qu'on passe à gué.
    { op:'eau', trace:[[0.42,0],[0.40,0.44],[0.44,1]], largeur:0.012 },
    { op:'gue', zone:'gue' },
    { op:'degager', zone:'gue' },
    { op:'degager', zone:'poste' },
    { op:'degager', zone:'saragosse' },
  ],
  objectifs:[
    { id:'poste',   txt:"Faites viser le sauf-conduit : 3 roulottes au poste frontière, le temps qu'il faut", zone:'poste',
      test:M=>M.tirs('attente')>=60, compte:M=>[M.tirs('attente'),60] },
    { id:'arrivee', txt:"Menez au moins 3 roulottes jusqu'à Saragosse", zone:'saragosse',
      test:M=>M.tagDansZone('caravane','saragosse',3), echec:M=>M.restants('caravane')<3,
      compte:M=>[M.tagCompteZone('caravane','saragosse'),3],
      echecTxt:"Trop de roulottes sont perdues. La compagnie repartira — mais plus pauvre, et plus seule." },
    { id:'zaida',   txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée sur la route. La compagnie se disperse." },
    { id:'tous',    txt:'Personne en arrière : les quatre roulottes à Saragosse', type:'secondaire',
      test:M=>M.tagDansZone('caravane','saragosse',4) },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    { id:'approche', si:M=>M.equipeDansZone('approche',1), alors:M=>{
        M.dire('approche'); M.vague('pill',[[UT.ENEMI,4],[UT.ENEMIA,2]],'a1',{tag:'routiers'});
      } },
    // Le gué est ouvert dès qu'un chemin passe de nouveau d'une rive à l'autre.
    { id:'abattis_ok', si:M=>!M.coupe('col','poste'), alors:M=>M.dire('abattis_ok') },
    // Le visa du sauf-conduit : une seconde de plus à chaque seconde passée au
    // poste avec au moins trois roulottes. À la première, l'embuscade.
    { id:'attente', repete:true, intervalle:1, si:M=>!M.fait('poste')&&M.tagCompteZone('caravane','poste')>=3,
      alors:M=>{
        if(M.tirs('attente')===1){
          M.dire('poste');
          M.vague('pill',[[UT.ENEMI,4],[UT.ENEMIA,3]],'a2',{tag:'routiers'});
          M.vague('pill',[[UT.ENEMI,3],[UT.ENEMI_C,2]],'a3',{tag:'routiers'});
        }
        if(M.tirs('attente')===30){
          M.dire('renfort_routiers');
          M.vague('pill',[[UT.ENEMI,3],[UT.ENEMIA,2]],'a2',{tag:'routiers'});
        }
      } },
    // Les routiers lâchés courent après le convoi, où qu'il soit.
    { id:'poursuite', repete:true, intervalle:2, si:M=>M.vivant('routiers'), alors:M=>M.traquer('routiers') },
    { id:'poste_ok', si:M=>M.fait('poste'), alors:M=>M.dire('poste_ok') },
    { id:'saragosse', si:M=>M.tagDansZone('caravane','saragosse',1), alors:M=>M.dire('saragosse') },
  ],
  orateurs:{
    zaida:   { nom:'Zaïda', ico:'🎻' },
    tomas:   { nom:'Tomás', ico:'🐎' },
    abuela:  { nom:'La grand-mère Rosa', ico:'🧶' },
    capitaine:{ nom:'Le capitaine du poste', ico:'📜' },
  },
  dialogues:{
    intro:[
      ['zaida',"Le sceau du roi est sur ce parchemin. Mais un parchemin n'arrête pas une flèche : on reste groupés, les roulottes au milieu."],
      ['abuela',"J'ai passé plus de montagnes que tu n'as vu d'hivers, ma fille. Celle-là ne sera pas la dernière."],
    ],
    tomas:[['tomas',"Je pars devant avec les cavaliers. Des routiers ont barré le gué d'un abattis : il faudra l'abattre avant de passer."]],
    approche:[['tomas',"Des routiers sortent des bois ! Ils en veulent aux roulottes !"]],
    abattis_ok:[['zaida',"L'abattis cède ! Faites passer les roulottes, vite."]],
    poste:[
      ['capitaine',"Un sauf-conduit du roi ? Voyons ce sceau... Attendez ici. Cela prendra le temps qu'il faudra."],
      ['tomas',"Pendant qu'il lit, les routiers attaquent de deux côtés ! Protégez les roulottes !"],
    ],
    renfort_routiers:[['abuela',"Encore des routiers ! Tenez bon, le capitaine n'a pas fini de lire."]],
    poste_ok:[['capitaine',"Le sceau est bon. Passez, et que Dieu vous garde sur la route de Saragosse."]],
    saragosse:[['zaida',"Les tours de Saragosse ! On est arrivés. Ce soir, on joue et on danse."]],
  },
  etoiles:['victoire', M=>M.fait('tous'), M=>M.tagDansZone('famille','saragosse',6)],
  victoire:"La compagnie entre dans Saragosse au son des violons. Les gens de la ville sortent pour voir passer ces voyageurs venus de si loin.",
};

// ── 2. La Foire de Saint-Jacques ─────────────────────────
// Commerce (~20 min) : un campement dressé près de la foire, deux Marchés
// éloignés, 800 d'or de commerce — le +50 % des Gitanos fait la moitié du
// chemin. Un Hospice pour les pèlerins, en secondaire.
MISSIONS.gi2 = {
  campagne:'gitanos', num:2,
  titre:'La Foire de Saint-Jacques', lieu:'Sur le chemin de Compostelle', date:'1430',
  briefing:[
    "Chaque été, la grande foire du chemin de Saint-Jacques attire des marchands de tout le royaume. La compagnie de Zaïda y a monté son campement.",
    "Chevaux, chaudrons, musique : il y a de quoi faire. Élevez deux Marchés, l'un au campement et l'autre à la foire, et que les caravanes rapportent 800 d'or. Des brigands rôdent sur les chemins.",
  ],
  carte:{ graine:1430720, type:'plaines', taille:'moyenne' },
  zones:{
    campement:{ x:0.18, y:0.62, r:0.05 },
    foire:    { x:0.82, y:0.34, r:0.06 },
    bois:     { x:0.50, y:0.10, r:0.04 },
    sud:      { x:0.60, y:0.97, r:0.03 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:1, res:{food:250,wood:450,stone:100,gold:150},
         depart:[0.18,0.62], base:'village',
         unites:[[UT.VIL,10],[UT.MIL,3],[UT.HERO,1,'zaida']] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:1, res:{food:100,wood:200,stone:50,gold:100},
         depart:[0.76,0.40], base:'rien',
         unites:[[UT.VIL,4],[UT.ARC,4],[UT.SCOUT,2]] },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'degager', zone:'foire' },
  ],
  objectifs:[
    { id:'marches',  txt:'Élevez deux Marchés : un au campement, un à la foire', zone:'foire',
      test:M=>M.bati(BT.MARKET,'foire')&&M.compteEquipe(BT.MARKET)>=2, compte:M=>[M.compteEquipe(BT.MARKET),2] },
    { id:'commerce', txt:"Faites rapporter 800 d'or aux caravanes", test:M=>M.statsEquipe('tradeGold')>=800,
      compte:M=>[M.statsEquipe('tradeGold'),800] },
    { id:'zaida',    txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée. La foire se termine dans le silence." },
    { id:'hospice',  txt:'Élevez un Hospice pour les pèlerins du chemin', type:'secondaire', test:M=>M.compteEquipe(BT.HOSPICE)>=1 },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    { id:'route', si:M=>M.statsEquipe('tradeGold')>0, alors:M=>M.dire('route') },
    { id:'brigands', repete:true, intervalle:110, si:M=>M.temps()>=300&&!M.fait('commerce'),
      alors:M=>{
        const n=M.tirs('brigands');
        M.vague('pill',[[UT.ENEMI,3+n],[UT.ENEMIA,1+Math.floor(n/2)]],n%2?'bois':'sud',{vers:'foire'});
        if(n===1) M.dire('brigands');
      } },
    { id:'hospice_ok', si:M=>M.fait('hospice'), alors:M=>M.dire('hospice_ok') },
  ],
  orateurs:{
    zaida:{ nom:'Zaïda', ico:'🎻' },
    tomas:{ nom:'Tomás', ico:'🐎' },
    pelerin:{ nom:'Un pèlerin', ico:'🐚' },
  },
  dialogues:{
    intro:[
      ['zaida',"Les meilleurs chevaux de la foire viendront de chez nous, et les meilleurs chaudrons aussi. Qu'on nous voie, qu'on nous entende."],
      ['tomas',"Un Marché au campement, un autre à la foire : plus la route entre les deux est longue, plus elle rapporte."],
    ],
    tomas:[['tomas',"Je suis à la foire avec quelques-uns des nôtres. Il y a de la place pour un Marché, près des étals."]],
    route:[['zaida',"La première caravane est arrivée ! Les pièces sonnent mieux que les tambourins."]],
    brigands:[['tomas',"Des brigands sortent des bois ! Ils vont droit sur la foire !"]],
    hospice_ok:[['pelerin',"Un toit et une soupe chaude sur le chemin... Que Dieu garde votre compagnie."]],
  },
  etoiles:['victoire', M=>M.fait('hospice'), M=>M.temps()<16*60],
  victoire:"La foire se termine en musique. Les marchands de tout le royaume parlent maintenant de la compagnie de Zaïda — et de ses chevaux.",
};

// ── 3. Le Décret ─────────────────────────────────────────
// Deux façons de gagner (~20 min) : tenir le campement jusqu'à ce que le
// décret tombe de lui-même, ou le racheter — la Diplomatie d'un seigneur qui
// accepte de traiter contre 800 d'or (le prix est sur le bouton).
MISSIONS.gi3 = {
  campagne:'gitanos', num:3,
  titre:'Le Décret', lieu:'La vallée de l\'Èbre', date:'1452',
  briefing:[
    "Le comte de la vallée a changé d'avis : il a signé un décret qui chasse la compagnie de ses terres, sauf-conduit royal ou pas. Ses hommes d'armes sont en route.",
    "Deux chemins. Tenir le campement vingt minutes, jusqu'à ce que le roi, alerté, fasse annuler le décret. Ou le racheter : le comte traitera contre 800 d'or — la Diplomatie est dans le menu ⏸.",
  ],
  carte:{ graine:1452318, type:'plaines', taille:'moyenne' },
  zones:{
    campement:{ x:0.24, y:0.56, r:0.05 },
    chateau:  { x:0.80, y:0.40, r:0.05 },
    marche2:  { x:0.30, y:0.14, r:0.05 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:1, res:{food:300,wood:400,stone:150,gold:250},
         depart:[0.24,0.56], base:'village',
         unites:[[UT.VIL,10],[UT.MIL,4],[UT.ARC,4],[UT.HERO,1,'zaida']],
         batiments:[[BT.MARKET,5,4]] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:1, res:{food:150,wood:150,stone:50,gold:100},
         depart:[0.30,0.80], base:'rien',
         unites:[[UT.ARC,4],[UT.PIKE,3]] },
  },
  factions:{
    ia:{ civ:'francs', nom:'Le comte de la vallée', equipe:3, depart:[0.80,0.40], age:1, ageMax:2,
         heros:false, merveille:false, cible:'campement',
         tune:{ firstAtk:300, atkEvery:130, start:{food:450,wood:450,stone:200,gold:200} },
         batiments:[[BT.BARRACKS,-6,-5],[BT.HOUSE,4,5],[BT.HOUSE,6,5],[BT.HOUSE,-4,6]],
         unites:[[UT.VIL,8],[UT.ENEMI,6],[UT.ENEMIA,4],[UT.ENEMI_C,2]],
         diplomatie:{ prix:{ gold:800 }, refus:'Le comte veut 800 d’or pour lever le décret.' } },
  },
  regles:{ ageMax:2 },
  surcouche:[
    { op:'degager', zone:'marche2' },
    { op:'gisement', zone:{ x:0.12, y:0.40, r:0.04 }, type:RT.GOLD, n:5, amt:500 },
  ],
  objectifs:[
    { id:'decret',    txt:"Tenez 20 minutes — ou rachetez le décret (Diplomatie, 800 d'or)",
      test:M=>M.temps()>=1200||M.allie('ia'), compte:M=>[M.temps()/60,20] },
    { id:'campement', txt:'Le campement doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Le campement est brûlé. La compagnie reprend la route, le cœur lourd." },
    { id:'zaida',     txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée en défendant les siens." },
    { id:'route',     txt:"Ouvrez une route commerciale jusqu'au marché du nord", type:'secondaire', zone:'marche2',
      test:M=>M.bati(BT.MARKET,'marche2')&&M.statsEquipe('tradeGold')>0 },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    // Les hommes d'armes du comte, colonne après colonne, jusqu'à ce que le
    // décret tombe (inactif, le campement tenait vingt minutes même en
    // Brutal sous les seuls assauts du seigneur — sonde).
    { id:'hommes', repete:true, intervalle:95, si:M=>M.temps()>=180&&M.temps()<1140&&!M.allie('ia'),
      alors:M=>{
        const n=M.tirs('hommes');
        const compo=[[UT.ENEMI,3+n]];
        if(n>=2) compo.push([UT.ENEMIA,1+Math.floor(n/2)]);
        if(n>=4) compo.push([UT.ENEMI_C,Math.floor(n/3)]);
        M.vague('ia',compo,'chateau',{vers:'campement'});
        if(n===1) M.dire('hommes');
      } },
    { id:'or_pret', si:M=>M.res('p1','gold')>=800&&!M.allie('ia'), alors:M=>M.dire('or_pret') },
    { id:'rachat', si:M=>M.allie('ia'), alors:M=>M.dire('rachat') },
    { id:'roi', si:M=>M.temps()>=1140&&!M.allie('ia'), alors:M=>M.dire('roi') },
  ],
  orateurs:{
    zaida:{ nom:'Zaïda', ico:'🎻' },
    tomas:{ nom:'Tomás', ico:'🐎' },
    comte:{ nom:'Le comte', ico:'🏰' },
  },
  dialogues:{
    intro:[
      ['comte',"Sauf-conduit ou pas, je ne veux pas de vous sur mes terres. Partez, ou mes hommes vous feront partir."],
      ['zaida',"On ne part pas sous la menace. Mais un comte qui aime tant son or l'aimera peut-être plus que son décret."],
    ],
    tomas:[['tomas',"Je tiens le sud du campement. Le marché du nord achète nos chevaux : une route jusque-là rapporterait vite."]],
    hommes:[['tomas',"Les hommes d'armes du comte sortent du château ! Ils marchent sur le campement."]],
    or_pret:[['zaida',"Nous avons les 800 pièces. Si on veut racheter le décret, c'est dans la Diplomatie, maintenant."]],
    rachat:[['comte',"Hum. Tout bien réfléchi, votre compagnie peut rester. Pour cette saison."]],
    roi:[['tomas',"Un messager du roi ! Le décret est annulé : le sauf-conduit vaut sur toutes les terres du royaume."]],
  },
  etoiles:['victoire', M=>M.allie('ia'), M=>M.fait('route')],
  victoire:"Le décret est levé. Ce soir, dans le campement, on chante plus fort que d'habitude.",
};

// ── 4. Les Roues Cerclées ────────────────────────────────
// Technologie et percée (~25 min) : passer à l'Âge Impérial, rechercher les
// Roues Cerclées, former des Roulottes de Guerre, et briser le péage fortifié
// qui barre la route du sud.
MISSIONS.gi4 = {
  campagne:'gitanos', num:4,
  titre:'Les Roues Cerclées', lieu:'Le col du Péage', date:'1460',
  briefing:[
    "Un seigneur a barré le seul col vers le sud d'un péage fortifié : des tours, une palissade, et un droit de passage que personne ne peut payer.",
    "Les forgerons de la compagnie ont une idée : des roues cerclées de fer, qui rendront les roulottes assez rapides pour passer sous les flèches. Âge Impérial, Université, Château — et six Roulottes de Guerre pour briser le péage.",
  ],
  carte:{ graine:1460907, type:'arides', taille:'moyenne', reliques:false },
  zones:{
    campement:{ x:0.20, y:0.36, r:0.05 },
    peage:    { x:0.66, y:0.66, r:0.06 },
    sud:      { x:0.86, y:0.90, r:0.04 },
    nord:     { x:0.50, y:0.04, r:0.03 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:2, res:{food:1400,wood:900,stone:500,gold:900},
         depart:[0.20,0.36], base:'village',
         unites:[[UT.VIL,14],[UT.MIL,4],[UT.ARC,4],[UT.ROUL,2],[UT.HERO,1,'zaida']],
         batiments:[[BT.CASTLE,6,-6],[BT.UNIV,-6,5]] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:2, res:{food:200,wood:200,stone:100,gold:100},
         depart:[0.34,0.20], base:'rien',
         unites:[[UT.SCOUT,3],[UT.PIKE,4]] },
  },
  factions:{
    // Le péage barre le col d'un à-pic à l'autre : une palissade, trois
    // tours derrière elle. Il n'y a pas d'autre passage vers le sud.
    pill:{
      murs:[{ de:[0.70,0.50], a:[0.50,0.70], tag:'barriere' }],
      batiments:[
        { type:BT.TOWER, zone:{ x:0.64, y:0.64, r:0 }, tag:'peage' },
        { type:BT.TOWER, zone:{ x:0.71, y:0.58, r:0 }, tag:'peage' },
        { type:BT.TOWER, zone:{ x:0.58, y:0.71, r:0 }, tag:'peage' },
        { type:BT.OUTPOST, zone:'peage', tag:'peage' },
      ],
      unites:[
        { type:UT.ENEMIA, n:8, zone:'peage', garde:true }, { type:UT.ENEMI, n:6, zone:'peage', garde:true },
        { type:UT.ENEMI_C, n:3, zone:'peage', garde:true },
      ],
    },
  },
  regles:{ ageMax:3 },
  surcouche:[
    // Les deux à-pics du col, jusqu'aux bords de la carte.
    { op:'eau', trace:[[0.70,0.50],[1,0.18]], largeur:0.02 },
    { op:'eau', trace:[[0.50,0.70],[0.18,1]], largeur:0.02 },
    { op:'degager', zone:'peage' },
    { op:'degager', zone:{ x:0.60, y:0.60, r:0.06 } },
    { op:'foret', zone:{ x:0.10, y:0.60, r:0.06 }, n:40 },
  ],
  objectifs:[
    { id:'roues',     txt:"Recherchez les Roues Cerclées (Université, Âge Impérial)", test:M=>M.rechercheEquipe('roues_cerclees') },
    { id:'roulottes', txt:'Formez 6 Roulottes de Guerre (Château)', test:M=>M.compteEquipe(UT.ROUL)>=6,
      compte:M=>[M.compteEquipe(UT.ROUL),6] },
    { id:'peage',     txt:'Brisez le péage : abattez ses trois tours', zone:'peage', test:M=>M.detruit('peage') },
    { id:'zaida',     txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée devant le péage." },
    { id:'sud',       txt:'Faites passer une Roulotte de Guerre au-delà du col', type:'secondaire', zone:'sud',
      test:M=>M.dansZone('sud','p1')||M.dansZone('sud','p2') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
    { id:'roues_ok', si:M=>M.fait('roues'), alors:M=>M.dire('roues_ok') },
    // Les hommes du seigneur battent la campagne au nord du col.
    { id:'patrouilles', repete:true, intervalle:130, si:M=>M.temps()>=420&&M.vivant('peage'),
      alors:M=>{ M.vague('pill',[[UT.ENEMI,3+M.tirs('patrouilles')],[UT.ENEMI_C,1]],'nord',{vers:'campement'}); } },
    { id:'peage_ok', si:M=>M.fait('peage'), alors:M=>M.dire('peage_ok') },
  ],
  orateurs:{
    zaida:  { nom:'Zaïda', ico:'🎻' },
    tomas:  { nom:'Tomás', ico:'🐎' },
    forgeron:{ nom:'Le forgeron Andrés', ico:'⚒️' },
  },
  dialogues:{
    intro:[
      ['forgeron',"Des roues cerclées de fer, Zaïda. Plus lourdes à forger, mais la roulotte file comme un cheval. Il me faut l'Âge Impérial et l'Université."],
      ['zaida',"Alors on forge. Et quand elles rouleront, le péage verra passer la compagnie sans payer."],
    ],
    tomas:[['tomas',"Je surveille le col. Leurs archers sont nombreux, mais ils ne sortent guère de derrière leurs pieux."]],
    imperial:[['forgeron',"L'Âge Impérial ! Passez à l'Université : les Roues Cerclées sont prêtes à forger."]],
    roues_ok:[['forgeron',"Les roues sont cerclées ! Au Château, qu'on attelle les Roulottes de Guerre."]],
    peage_ok:[['zaida',"Le péage est tombé. La route du sud est ouverte — pour tout le monde."]],
  },
  etoiles:['victoire', M=>M.fait('sud'), M=>M.temps()<22*60],
  victoire:"Les roulottes passent le col en chantant. Derrière elles, marchands et pèlerins empruntent la route libérée.",
};

// ── 5. L'Alliance des Routes ─────────────────────────────
// Ralliement par le commerce (~25 min) : deux villes neutres, que le comte
// veut soumettre. Une ville se rallie quand une route commerciale de la
// compagnie aboutit à un Marché bâti chez elle (M.routeVers) : ses bâtiments
// passent alors à Zaïda.
MISSIONS.gi5 = {
  campagne:'gitanos', num:5,
  titre:"L'Alliance des Routes", lieu:'Les villes du Levant', date:'1471',
  briefing:[
    "Le comte de Lanza veut soumettre les deux villes libres du Levant, et fermer leurs marchés aux voyageurs. Les villes hésitent : qui les défendra ?",
    "Ceux qui font vivre leurs marchés. Bâtissez un Marché dans chaque ville et reliez-le au vôtre par une route commerciale : la ville ralliera la compagnie. Tenez tête au comte pendant ce temps.",
  ],
  carte:{ graine:1471512, type:'plaines', taille:'normale' },
  zones:{
    campement:{ x:0.16, y:0.50, r:0.05 },
    valence:  { x:0.52, y:0.18, r:0.07 },
    alcoy:    { x:0.56, y:0.80, r:0.07 },
    comte:    { x:0.88, y:0.50, r:0.05 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:2, res:{food:600,wood:700,stone:300,gold:400},
         depart:[0.16,0.50], base:'village',
         unites:[[UT.VIL,12],[UT.ROUL,3],[UT.PIKE,4],[UT.ARC,4],[UT.HERO,1,'zaida']],
         batiments:[[BT.MARKET,5,4],[BT.BARRACKS,6,-5]] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:2, res:{food:200,wood:250,stone:100,gold:150},
         depart:[0.26,0.24], base:'rien',
         unites:[[UT.VIL,4],[UT.SCOUT,3],[UT.ARC,3]] },
  },
  factions:{
    ia:{ civ:'francs', nom:'Le comte de Lanza', equipe:3, depart:[0.88,0.50], age:2, ageMax:3,
         heros:false, merveille:false, tune:{ firstAtk:540, start:{food:700,wood:700,stone:400,gold:400} },
         batiments:[[BT.BARRACKS,-6,-5],[BT.STABLE,7,4],[BT.HLM,-7,2],[BT.HOUSE,4,-6]],
         unites:[[UT.VIL,10],[UT.ENEMI,8],[UT.ENEMIA,6],[UT.ENEMI_C,4]] },
    // Les deux villes : leurs bâtiments ne combattent pas, et passeront à la
    // compagnie quand elles se rallieront.
    pill:{
      batiments:[
        { type:BT.HOUSE, zone:'valence', tag:'valence' }, { type:BT.HOUSE, zone:'valence', tag:'valence' },
        { type:BT.HOUSE, zone:'valence', tag:'valence' }, { type:BT.MILL, zone:'valence', tag:'valence' },
        { type:BT.HOUSE, zone:'alcoy', tag:'alcoy' }, { type:BT.HOUSE, zone:'alcoy', tag:'alcoy' },
        { type:BT.HOUSE, zone:'alcoy', tag:'alcoy' }, { type:BT.FORGE, zone:'alcoy', tag:'alcoy' },
      ],
    },
  },
  regles:{ ageMax:3 },
  surcouche:[
    { op:'degager', zone:'valence' }, { op:'degager', zone:'alcoy' },
  ],
  objectifs:[
    { id:'valence', txt:"Ralliez Valence : une route commerciale jusqu'à un Marché bâti dans la ville", zone:'valence',
      test:M=>M.tire('ralliement_valence') },
    { id:'alcoy',   txt:"Ralliez Alcoy : une route commerciale jusqu'à un Marché bâti dans la ville", zone:'alcoy',
      test:M=>M.tire('ralliement_alcoy') },
    { id:'zaida',   txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée. Les villes n'ont plus personne en qui croire." },
    { id:'campement', txt:'Le campement doit tenir', echec:M=>M.compteEquipe(BT.TC)===0,
      echecTxt:"Le comte a brûlé le campement." },
    { id:'or',      txt:"Faites rapporter 1 500 d'or aux caravanes", type:'secondaire',
      test:M=>M.statsEquipe('tradeGold')>=1500, compte:M=>[M.statsEquipe('tradeGold'),1500] },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    { id:'ralliement_valence', si:M=>M.routeVers('valence'), alors:M=>{ M.convertir('valence','p1'); M.dire('valence'); } },
    { id:'ralliement_alcoy',   si:M=>M.routeVers('alcoy'),   alors:M=>{ M.convertir('alcoy','p1'); M.dire('alcoy'); } },
    // Le comte ne regarde pas faire : dès la première ville ralliée, il frappe.
    { id:'colere', si:M=>M.tire('ralliement_valence')||M.tire('ralliement_alcoy'), alors:M=>{
        M.dire('colere'); M.ia('ia',{lancer:true});
      } },
  ],
  orateurs:{
    zaida:{ nom:'Zaïda', ico:'🎻' },
    tomas:{ nom:'Tomás', ico:'🐎' },
    jurat:{ nom:'Un juré de la ville', ico:'⚖️' },
    comte:{ nom:'Le comte de Lanza', ico:'🏰' },
  },
  dialogues:{
    intro:[
      ['jurat',"Nos villes vivent de leurs marchés. Si le comte les ferme, nous mourrons lentement — mais si nous lui résistons seuls, nous mourrons vite."],
      ['zaida',"Alors ne restez pas seuls. Nos caravanes feront vivre vos marchés, et nous défendrons la route."],
    ],
    tomas:[['tomas',"Valence au nord, Alcoy au sud. Il y a de la place dans chaque ville pour un Marché."]],
    valence:[['jurat',"Valence se range aux côtés de la compagnie ! Ses maisons et son moulin sont à vous."]],
    alcoy:[['jurat',"Alcoy ouvre ses portes ! Ses forgerons travailleront pour vous."]],
    colere:[['comte',"Des villes libres qui s'allient à des vagabonds ? Je vais leur rappeler qui gouverne cette province."]],
  },
  etoiles:['victoire', M=>M.fait('or'), M=>M.statsEquipe('bldLost')<=3],
  victoire:"Les deux villes et la compagnie signent une charte : les routes du Levant resteront ouvertes à tous les voyageurs.",
};

// ── 6. Le Grand Rassemblement ────────────────────────────
// Finale (~50 min) : toutes les compagnies de la route se retrouvent pour la
// Grande Foire — une Merveille — que deux seigneurs coalisés veulent empêcher.
// Deux façons de gagner, comme la Couronne d'Occident : la Merveille tenue
// dix minutes, ou les deux seigneurs abattus.
MISSIONS.gi6 = {
  campagne:'gitanos', num:6,
  titre:'Le Grand Rassemblement', lieu:'La plaine de la Grande Foire', date:'1480',
  briefing:[
    "Pour la première fois, toutes les compagnies de la route se retrouvent au même endroit : musiciens, forgerons, maquignons, familles venues de dix royaumes.",
    "Élevez la Grande Foire — une Merveille — et gardez-la debout dix minutes ; ou abattez les deux seigneurs qui se sont coalisés pour l'empêcher. Tomás tiendra le camp de l'est.",
  ],
  carte:{ graine:1480801, type:'plaines', taille:'normale' },
  zones:{
    foire:   { x:0.34, y:0.50, r:0.06 },
    comte_n: { x:0.82, y:0.20, r:0.05 },
    comte_s: { x:0.82, y:0.80, r:0.05 },
  },
  roles:{
    p1:{ civ:'gitanos', nom:'Zaïda', age:2, res:{food:1200,wood:1400,stone:1000,gold:900},
         depart:[0.24,0.50], base:'village',
         unites:[[UT.VIL,16],[UT.ROUL,4],[UT.PIKE,6],[UT.ARC,6],[UT.HERO,1,'zaida']],
         batiments:[[BT.BARRACKS,6,-5],[BT.CASTLE,-7,4],[BT.MARKET,6,5]] },
    p2:{ civ:'gitanos', nom:'Tomás', solo:'fusion', age:2, res:{food:300,wood:300,stone:200,gold:200},
         depart:[0.46,0.24], base:'tc',
         unites:[[UT.VIL,5],[UT.ARC,4],[UT.SCOUT,3]],
         batiments:[[BT.MARKET,4,4]] },
  },
  factions:{
    ia: { civ:'francs',  nom:'Le comte de Lanza', equipe:3, depart:[0.82,0.20], age:2, ageMax:3,
          heros:false, merveille:false, cible:'foire', tune:{ firstAtk:600, start:{food:800,wood:800,stone:450,gold:450} },
          batiments:[[BT.BARRACKS,-6,4],[BT.STABLE,7,4],[BT.HLM,-7,-2],[BT.HOUSE,4,-4]],
          unites:[[UT.VIL,10],[UT.ENEMI,8],[UT.ENEMIA,6],[UT.ENEMI_C,4]] },
    ia2:{ civ:'byzantins', nom:'Le marquis du Sud', equipe:3, depart:[0.82,0.80], age:2, ageMax:3,
          heros:false, merveille:false, tune:{ firstAtk:780, start:{food:800,wood:800,stone:450,gold:450} },
          batiments:[[BT.BARRACKS,-6,-4],[BT.STABLE,7,-4],[BT.HLM,-7,2],[BT.HOUSE,4,4]],
          unites:[[UT.VIL,10],[UT.ENEMI,8],[UT.ENEMIA,6],[UT.ENEMI_C,4]] },
  },
  surcouche:[
    { op:'degager', zone:'foire' },
    { op:'gisement', zone:{ x:0.14, y:0.30, r:0.04 }, type:RT.STONE, n:8, amt:700 },
    { op:'gisement', zone:{ x:0.14, y:0.70, r:0.04 }, type:RT.GOLD, n:8, amt:700 },
  ],
  objectifs:[
    { id:'rassemblement', txt:"Élevez la Grande Foire (une Merveille) et gardez-la debout 10 minutes — ou abattez les deux seigneurs",
      test:M=>M.vaincu('ia')&&M.vaincu('ia2') },
    { id:'zaida', txt:'Zaïda doit survivre', echec:M=>M.mort('zaida'),
      echecTxt:"Zaïda est tombée. Le Rassemblement se disperse sans elle." },
    { id:'roues', txt:'Recherchez les Roues Cerclées', type:'secondaire', test:M=>M.rechercheEquipe('roues_cerclees') },
  ],
  declencheurs:[
    { id:'intro', si:M=>M.temps()>=2,  alors:M=>M.dire('intro') },
    { id:'tomas', si:M=>M.temps()>=16, alors:M=>M.dire('tomas','p2') },
    { id:'imperial', si:M=>M.age('p1')>=3, alors:M=>M.dire('imperial') },
    { id:'foire', si:M=>M.compteEquipe(BT.WONDER)>=1, alors:M=>{
        M.dire('foire'); M.ia('ia',{lancer:true}); M.ia('ia2',{lancer:true});
      } },
    { id:'compagnies', repete:true, intervalle:300, si:M=>M.temps()>=600&&M.tirs('compagnies')<3,
      alors:M=>{ M.renfort('p1',[[UT.ROUL,2],[UT.VIL,3]],'foire'); M.dire('compagnies'); } },
  ],
  orateurs:{
    zaida:{ nom:'Zaïda', ico:'🎻' },
    tomas:{ nom:'Tomás', ico:'🐎' },
    abuela:{ nom:'La grand-mère Rosa', ico:'🧶' },
  },
  dialogues:{
    intro:[
      ['abuela',"J'ai attendu toute ma vie de voir toutes les compagnies réunies. Faites-moi une foire dont on parlera dans cent ans."],
      ['zaida',"Une foire que deux seigneurs veulent empêcher. Tant mieux : on la fera assez grande pour qu'ils la voient de chez eux."],
    ],
    tomas:[['tomas',"Je tiens le camp de l'est, avec son Marché. Les caravanes passeront par chez moi."]],
    imperial:[['zaida',"L'Âge Impérial. Il faut de la pierre et de l'or pour la Grande Foire — beaucoup."]],
    foire:[['abuela',"La Grande Foire est debout ! Les seigneurs vont tout jeter contre elle : tenez dix minutes !"]],
    compagnies:[['tomas',"Une nouvelle compagnie arrive par la route de l'ouest, avec ses roulottes !"]],
  },
  etoiles:['victoire', M=>M.fait('roues'), M=>M.statsEquipe('bldLost')<=10],
  victoire:"La Grande Foire dure trois jours et trois nuits. On y joue, on y danse, on y marie des enfants de dix compagnies — et la route continue.",
};

// Retour d'une fin de mission : rouvre le briefing laissé en partant (voir
// allerAuBriefing, js/15-campagne.js). Ici, et pas dans le moteur : il faut
// que les campagnes soient remplies.
// Et l'onglet Campagne a pu être restauré (voir js/13-cloud.js) AVANT que
// les campagnes ne soient remplies : sa liste était alors vide.
try{ if(typeof selectedPlayTab!=='undefined'&&selectedPlayTab==='campagne') afficherListeCampagnes(); }catch(e){}
try{ reprendreEcranCampagne(); }catch(e){}
