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

// Retour d'une fin de mission : rouvre le briefing laissé en partant (voir
// allerAuBriefing, js/15-campagne.js). Ici, et pas dans le moteur : il faut
// que les campagnes soient remplies.
// Et l'onglet Campagne a pu être restauré (voir js/13-cloud.js) AVANT que
// les campagnes ne soient remplies : sa liste était alors vide.
try{ if(typeof selectedPlayTab!=='undefined'&&selectedPlayTab==='campagne') afficherListeCampagnes(); }catch(e){}
try{ reprendreEcranCampagne(); }catch(e){}
