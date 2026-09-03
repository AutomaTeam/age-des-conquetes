// Harnais de test du jeu — sans navigateur, sans dépendance, sans build.
//
//   node tests/run.js            tout (103 tests, ~30 s)
//   node tests/run.js ordres     un seul groupe — lui seul TOURNE
//
// Groupes : carte, reseau, sauvegarde, chemin, combat, civilisations,
// cartes, tailles, ordres, economie, ages, finpartie, ia, delta, charge.
// Les groupes `delta` et `ia` pèsent à eux deux la moitié du temps total :
// ils simulent de vraies parties, c'est le prix pour observer des
// comportements qui n'existent qu'apres plusieurs minutes de jeu.
//
// Ce que ces tests gardent, ce sont les zones qu'on NE PEUT PAS vérifier à
// l'œil : la sérialisation réseau, la migration de sauvegarde, le
// déterminisme de la carte et le contournement d'obstacle. Le rendu n'est
// pas testé (les bouchons ne dessinent rien) et ne doit pas l'être ici.

'use strict';
const { charger } = require('./harness');

// ── micro-cadre de test ────────────────────────────────────
// Le groupe demandé en argument est filtré DANS `groupe()`, avant d'exécuter
// quoi que ce soit : filtrer le rapport à la fin ferait tourner les 15
// groupes pour n'en afficher qu'un, et `node tests/run.js reseau` coûterait
// les 30 s de la suite complète. La liste des noms est recueillie au passage
// pour refuser un groupe inconnu (voir le rapport) : une faute de frappe
// affichait « 0/0 tests passent » et sortait au VERT.
const cible = process.argv[2];
let groupeCourant = '';
const groupesConnus = [];
const resultats = [];
function groupe(nom, fn) {
  groupesConnus.push(nom);
  if (cible && nom !== cible) return;
  groupeCourant = nom;
  fn();
}
function test(nom, fn) {
  const t0 = Date.now();
  try {
    fn();
    resultats.push({ groupe: groupeCourant, nom, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    resultats.push({ groupe: groupeCourant, nom, ok: false, ms: Date.now() - t0, err: e.message });
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'attendu vrai'); }
function egal(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'égalité'} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function egalJSON(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) {
    // Localise la première divergence : sur des états de 100 Ko, un diff
    // brut est illisible.
    let i = 0; while (i < x.length && x[i] === y[i]) i++;
    throw new Error(`${msg || 'structures'} diffèrent à l'offset ${i}\n    attendu …${x.slice(Math.max(0, i - 60), i + 60)}…\n    obtenu …${y.slice(Math.max(0, i - 60), i + 60)}…`);
  }
}

// ── empreintes d'état ──────────────────────────────────────
const empreinteCarte = (j) => ({
  seed: j.G.seed,
  tuiles: j.G.tiles.map((l) => l.join('')).join('|'),
  gisements: j.G.nodes.map((n) => [n.id, n.type, Math.round(n.x), Math.round(n.y), Math.round(n.amt)]),
  reliques: (j.G.relics || []).map((r) => [r.id, Math.round(r.x), Math.round(r.y)]),
  faune: (j.G.wildlife || []).map((w) => [w.id, w.type, Math.round(w.x), Math.round(w.y), w.hp]),
});
const empreinteUnites = (j) => j.G.units.slice().sort((a, b) => a.id - b.id)
  .map((u) => [u.id, u.type, u.owner, Math.round(u.x), Math.round(u.y), Math.round(u.hp), u.state]);
const empreinteBatiments = (j) => j.G.buildings.slice().sort((a, b) => a.id - b.id)
  .map((b) => [b.id, b.type, b.owner, b.tx, b.ty, Math.round(b.hp), !!b.constructing]);
const empreinteBmap = (j) => j.G.bmap.map((l) => l.join('')).join('|');

// ── utilitaires de scénario ────────────────────────────────
// Pose un bâtiment TERMINÉ. Ne jamais faire `G.buildings.push` en plus :
// placeBuilding pousse lui-même (voir le groupe `cartes`).
function batir(j, type, tx, ty, owner) {
  const b = j.mkBuilding(type, tx, ty, owner != null ? owner : j.G.me);
  b.constructing = false; b.progress = 1;
  j.placeBuilding(b);
  j.rebuildIndex();
  return b;
}
// Caisse pleine pour un camp donné : la plupart des tests d'ordres veulent
// vérifier une RÈGLE, pas se heurter au prix.
function riche(j, owner) {
  Object.assign(j.resPool(owner != null ? owner : j.G.me),
    { food: 99999, wood: 99999, stone: 99999, gold: 99999 });
}
// Émet un ordre comme le ferait le réseau : directement dans applyCommand,
// sans passer par l'interface. C'est le chemin qu'emprunte un client, donc
// celui qui doit être verrouillé.
function ordreDe(j, owner, t, charge) {
  return j.applyCommand(Object.assign({ t, f: owner != null ? owner : j.G.me }, charge || {}));
}
// Une case libre proche d'un point, pour poser sans se heurter au terrain.
function caseLibre(j, tx, ty, w, h) {
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 1 || y < 1 || x + w >= j.COLS || y + h >= j.ROWS) continue;
      let libre = true;
      for (let a = 0; a < h && libre; a++) for (let b = 0; b < w && libre; b++) if (j.G.bmap[y + a][x + b] !== 0) libre = false;
      if (libre) return { tx: x, ty: y };
    }
  }
  return null;
}

function partie(j, { graine = 4242, mode = 'conquest', diff = 'normal', pas = 0 } = {}) {
  j.__sandbox.selectedMode = mode;
  j.pickMode(mode);
  j.pickDifficulty(diff);
  j.setGraine(graine);
  j.startGame();
  for (let k = 0; k < pas; k++) j.update(j.SIM_DT);
  return j;
}

// ════════════════════════════════════════════════════════════
groupe('carte', () => {
  test('même graine → carte strictement identique', () => {
    const a = empreinteCarte(partie(charger(), { graine: 12345 }));
    const b = empreinteCarte(partie(charger(), { graine: 12345 }));
    egalJSON(a, b, 'cartes');
  });

  test('graine différente → carte différente', () => {
    const a = empreinteCarte(partie(charger(), { graine: 111 }));
    const b = empreinteCarte(partie(charger(), { graine: 222 }));
    ok(JSON.stringify(a.gisements) !== JSON.stringify(b.gisements), 'deux graines donnent les mêmes gisements');
  });

  test('reliques, faune et poissons suivent la graine', () => {
    // Ces trois-là ne voyagent PAS en position sur le réseau (voir
    // construireSnap) : le client les régénère depuis la graine. Une
    // divergence ici casserait silencieusement le multijoueur.
    const a = empreinteCarte(partie(charger(), { graine: 777 }));
    const b = empreinteCarte(partie(charger(), { graine: 777 }));
    egalJSON(a.reliques, b.reliques, 'reliques');
    egalJSON(a.faune, b.faune, 'faune');
    ok(a.reliques.length > 0, 'aucune relique générée');
    ok(a.faune.length > 0, 'aucune faune générée');
  });

  test('aucun gisement sous le Centre Ville de départ', () => {
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    ok(!!tc, 'pas de Centre Ville');
    const dessous = j.G.nodes.filter((n) => {
      const tx = Math.floor(n.x / j.BASE_TILE), ty = Math.floor(n.y / j.BASE_TILE);
      return tx >= tc.tx && tx < tc.tx + tc.w && ty >= tc.ty && ty < tc.ty + tc.h;
    });
    egal(dessous.length, 0, 'gisements piégés sous le Centre Ville');
  });
});

// ════════════════════════════════════════════════════════════
groupe('reseau', () => {
  test('snapshot : hôte → client reproduit unités, bâtiments et blocage', () => {
    const hote = partie(charger(), { graine: 4242, pas: 900 });
    const snap = hote.construireSnap();

    // Le client part de la MÊME graine (c'est le contrat de construireSalut)
    // puis applique le snapshot.
    const client = partie(charger(), { graine: 4242 });
    client.appliquerSnap(JSON.parse(JSON.stringify(snap)));

    egalJSON(empreinteUnites(hote), empreinteUnites(client), 'unités');
    egalJSON(empreinteBatiments(hote), empreinteBatiments(client), 'bâtiments');
    // Invariant explicite d'appliquerSnap : la grille de blocage doit
    // refléter celle de l'hôte, sinon le pathfinding local diverge. On
    // rapporte un RÉSUMÉ, pas les deux cartes : 57 600 cases à l'écran ne
    // disent rien à personne.
    const ecarts = [];
    for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) {
      const a = hote.G.bmap[y][x], b = client.G.bmap[y][x];
      if (a !== b && ecarts.length < 6) ecarts.push(`(${x},${y}) hôte=${a} client=${b}`);
    }
    let n = 0;
    for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) if (hote.G.bmap[y][x] !== client.G.bmap[y][x]) n++;
    ok(n === 0, `grille de blocage : ${n} case(s) divergentes — ${ecarts.join(', ')}`);
  });

  test('snapshot : appliquer deux fois ne duplique rien', () => {
    const hote = partie(charger(), { graine: 4242, pas: 600 });
    const snap = hote.construireSnap();
    const client = partie(charger(), { graine: 4242 });
    client.appliquerSnap(JSON.parse(JSON.stringify(snap)));
    const apres1 = empreinteBatiments(client);
    client.appliquerSnap(JSON.parse(JSON.stringify(snap)));
    egalJSON(apres1, empreinteBatiments(client), 'bâtiments après double application');
  });

  test('un message ABIME ne fait pas tomber le destinataire', () => {
    // Le decodage lisait ses lots en `(m.x||[])` : cela couvre l'absence et le
    // null, mais pas un `{}` ni une chaine, qui passent la garde et font lever
    // l'iteration. Un seul message tordu suffisait alors a faire tomber la page
    // du destinataire EN PLEINE PARTIE. Deux niveaux de degats sont eprouves
    // ici : la cle du message, et les ELEMENTS du lot — c'est le second qui
    // atteignait le plus loin, une faction sans age valide empoisonnant non pas
    // le decodage mais `updatePopCap`, une image plus tard, loin d'ici.
    const hote = charger();
    hote.RESEAU.actif = true; hote.RESEAU.role = 'hote';
    hote.RESEAU.adversaire = { id: hote.FAC.P2, nom: 'Invite' }; hote.RESEAU.tick = 0;
    partie(hote, { graine: 4242, pas: 900 });
    const p2 = hote.G.factions[hote.FAC.P2];
    for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) p2.fog[y][x] = 2;

    const monterClient = () => {
      const c = charger();
      c.RESEAU.actif = true; c.RESEAU.role = 'hote';
      c.RESEAU.adversaire = { id: c.FAC.P2, nom: 'Invite' };
      partie(c, { graine: 4242 });
      c.G.me = c.FAC.P2; c.G.hote = false;
      return c;
    };
    const client = monterClient();
    client.appliquerSnap(JSON.parse(JSON.stringify(hote.construireSnap())));
    for (let k = 0; k < 60; k++) hote.update(hote.SIM_DT);

    // 1.5 n'est pas decoratif : un indice de tuile FRACTIONNAIRE indexe
    // G.bmap tout aussi mal qu'une chaine, mais franchit un simple test de
    // bornes — c'est le seul cas que le controle d'entier attrape.
    const POISONS = [null, 0, 1, 1.5, '', 'x', [], {}, true, [null], [{}], [[]], [0, 0]];
    const abimer = (sain) => {
      const lots = [];
      for (const k of Object.keys(sain)) {
        for (const v of POISONS) {
          const d = JSON.parse(JSON.stringify(sain)); d[k] = v;
          lots.push(['.' + k + '=' + JSON.stringify(v), d]);
        }
        const d0 = JSON.parse(JSON.stringify(sain)); delete d0[k];
        lots.push(['sans .' + k, d0]);
        if (Array.isArray(sain[k]) && sain[k].length) {
          for (const v of POISONS) {
            const d = JSON.parse(JSON.stringify(sain));
            d[k] = d[k].slice(); d[k][0] = v;
            lots.push(['.' + k + '[0]=' + JSON.stringify(v), d]);
          }
        }
      }
      for (const d of [{}, null, undefined, 42, 'ordre', []]) lots.push(['enveloppe ' + JSON.stringify(d), d]);
      // Troisieme niveau : un descripteur bien forme SAUF un de ses champs.
      // C'est celui qui porte le plus loin — un age de faction fantaisiste ne
      // casse pas le decodage mais `updatePopCap`, une image plus tard.
      for (const k of Object.keys(sain)) {
        const prem = Array.isArray(sain[k]) ? sain[k][0] : null;
        if (!prem || typeof prem !== 'object' || Array.isArray(prem)) continue;
        for (const champ of Object.keys(prem)) for (const v of POISONS) {
          const d = JSON.parse(JSON.stringify(sain));
          d[k] = d[k].slice(); d[k][0] = Object.assign({}, prem); d[k][0][champ] = v;
          lots.push(['.' + k + '[0].' + champ + '=' + JSON.stringify(v), d]);
        }
      }
      return lots;
    };

    const rates = [];
    const deltas = abimer(JSON.parse(JSON.stringify(hote.construireDelta())));
    for (const [nom, d] of deltas) {
      try { client.appliquerDelta(d); client.updateVisuel(client.SIM_DT); }
      catch (e) { rates.push('delta ' + nom + ' -> ' + e.message); }
    }
    // Un SEUL client pour les snapshots, remis d'aplomb par un snapshot SAIN
    // entre deux cas : remonter une partie neuve a chaque fois coutait 24 s a
    // lui seul, soit les deux tiers de tout le fichier de tests.
    const sain = JSON.parse(JSON.stringify(hote.construireSnap()));
    const snaps = abimer(sain);
    const cs = monterClient();
    for (const [nom, sn] of snaps) {
      try { cs.appliquerSnap(sn); cs.updateVisuel(cs.SIM_DT); }
      catch (e) { rates.push('snap ' + nom + ' -> ' + e.message); }
      try { cs.appliquerSnap(JSON.parse(JSON.stringify(sain))); } catch (e) { /* couvert ci-dessus */ }
    }
    ok(deltas.length > 150 && snaps.length > 150, 'le fuzz doit couvrir assez de cas (' + deltas.length + '/' + snaps.length + ')');
    ok(!rates.length, rates.length + ' message(s) abime(s) font tomber le destinataire :\n        ' + rates.slice(0, 6).join('\n        '));

    // Et surtout : apres tout ce traitement, un message SAIN doit encore
    // remettre le client d'aplomb. Un durcissement qui laisse l'etat corrompu
    // ne vaudrait pas mieux qu'un plantage franc.
    for (let k = 0; k < 300; k++) {
      hote.update(hote.SIM_DT);
      if (k % 10 === 9) {
        for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) p2.fog[y][x] = 2;
        client.appliquerDelta(JSON.parse(JSON.stringify(hote.construireDelta())));
      }
      client.updateVisuel(client.SIM_DT);
    }
    const eh = new Set(hote.G.units.filter((u) => u.hp > 0).map((u) => u.id));
    const ec = new Set(client.G.units.filter((u) => u.hp > 0).map((u) => u.id));
    const manq = [...eh].filter((i) => !ec.has(i));
    ok(!manq.length, manq.length + ' unite(s) manquent au client apres la reprise : ' + manq.slice(0, 6));
    ok(Math.abs(hote.G.gameTime - client.G.gameTime) < 0.5, 'le temps de jeu a diverge');
  });

  test('le snapshot survit à un aller-retour JSON', () => {
    const hote = partie(charger(), { graine: 4242, pas: 300 });
    const snap = hote.construireSnap();
    egalJSON(snap, JSON.parse(JSON.stringify(snap)), 'snapshot sérialisable');
  });
});

// ════════════════════════════════════════════════════════════
groupe('sauvegarde', () => {
  test('un chargement REPART sans le drapeau de defaite', () => {
    // G.gameOver n'est pas un champ de sauvegarde (une sauvegarde decrit
    // toujours une partie EN COURS), mais loadGame ne le remettait pas a faux
    // non plus : perdre puis recharger le laissait vrai pour le restant de la
    // session. Or update() suspend TOUTES les fins de partie tant qu'il est
    // leve. La partie rechargee ne pouvait donc plus etre ni gagnee ni
    // reperdue — on jouait dans une partie qui ne s'arreterait jamais.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    // Tous les rivaux a terre : la victoire est due.
    for (const f of Object.values(j.G.factions)) if (f.genre !== 'neutre' && f.id !== j.G.me) f.vaincu = true;

    j.G.gameOver = true;                       // etat laisse par une defaite precedente
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    ok(!j.G.victory, 'le drapeau de defaite doit bien geler la fin de partie (sinon ce test ne prouve rien)');

    j.G.gameOver = false;                      // ce que fait desormais loadGame
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    ok(j.G.victory, 'drapeau baisse, la victoire doit enfin tomber');

    // Et le contrat cote chargement : la remise a zero est bien dans loadGame.
    const cloud = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '13-cloud.js'), 'utf8');
    const corps = cloud.slice(cloud.indexOf('async function loadGame'));
    ok(/G\.gameOver\s*=\s*false/.test(corps.slice(0, corps.indexOf('async function') + 12000)),
      'loadGame ne remet pas G.gameOver a faux');
  });

  test('sauvegarde → migration : aucune perte sur un état courant', () => {
    const j = partie(charger(), { graine: 4242, pas: 600 });
    const d = j.buildSaveData();
    const m = j.migrerSauvegarde(JSON.parse(JSON.stringify(d)));
    ok(m && typeof m === 'object', 'migration a rendu autre chose qu\'un objet');
    egalJSON(Object.keys(d).sort(), Object.keys(m).sort(), 'clés de sauvegarde');
  });

  test('migration v6 -> v8 : les pixels redeviennent des coordonnees monde', () => {
    // Le palier v6 -> v7 est le plus intrique de migrerSauvegarde et le seul
    // dont l'echec est SILENCIEUX : les coordonnees v6 etaient des pixels au
    // zoom d'ecriture, pas des unites BASE_TILE. Rate d'un facteur 3, tout
    // reste coherent a l'oeil -- simplement, chaque entite est ailleurs. Le
    // palier v7 -> v8 enchaine derriere et transforme joueur + IA en factions.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 900 });
    const B = j.BASE_TILE, ZOOM = 3;
    const moderne = JSON.parse(JSON.stringify(j.buildSaveData()));

    // Fabrique une VRAIE v6 a partir de l'etat courant : pixels au zoom
    // d'ecriture, destination nommee tx/ty, etat du joueur a plat sur data.
    const v6 = JSON.parse(JSON.stringify(moderne));
    v6.v = 6; v6.tile = B * ZOOM;
    const m = (x) => (typeof x === 'number' ? x * ZOOM : x);
    for (const u of v6.units) {
      u.x = m(u.x); u.y = m(u.y);
      u.tx = m(u.destX); u.ty = m(u.destY); delete u.destX; delete u.destY;
      u.rng = m(u.rng);
      if (u.campX != null) { u.campX = m(u.campX); u.campY = m(u.campY); }
      if (u.anchorX != null) { u.anchorX = m(u.anchorX); u.anchorY = m(u.anchorY); }
      u.owner = u.owner === j.FAC.P1 ? 'player' : 'enemy';
      if (u.camp === j.FAC.IA) u.camp = 'ai';
    }
    for (const b of v6.buildings) {
      b.x = m(b.x); b.y = m(b.y);
      if (b.rally) { b.rally.x = m(b.rally.x); b.rally.y = m(b.rally.y); }
      b.owner = b.owner === j.FAC.P1 ? 'player' : 'enemy';
    }
    for (const n of v6.nodes) { n.x = m(n.x); n.y = m(n.y); }
    const p1 = moderne.factions[j.FAC.P1], ia = moderne.factions[j.FAC.IA];
    v6.res = p1.res; v6.age = p1.age; v6.research = p1.research; v6.pop = p1.pop;
    v6.maxPop = p1.maxPop; v6.stats = p1.stats; v6.fog = p1.fog;
    v6.ai = ia ? { res: ia.res, age: ia.age, pop: ia.pop, baseX: m(ia.baseX),
                   baseY: m(ia.baseY), tcId: ia.tcId, maxPop: ia.maxPop } : null;
    delete v6.factions; delete v6.me;

    const mig = j.migrerSauvegarde(JSON.parse(JSON.stringify(v6)));
    egal(mig.v, 8, 'la chaine de migration ne va pas jusqu au format courant');

    // v6 -> v7 : chaque coordonnee retrouve sa valeur d'origine.
    const proche = (a, b) => Math.abs(a - b) <= 0.001;
    for (let k = 0; k < moderne.units.length; k++) {
      const a = moderne.units[k], c = mig.units[k];
      ok(proche(a.x, c.x) && proche(a.y, c.y),
        'unite ' + a.id + ' mal remise a l echelle : ' + c.x.toFixed(1) + ' au lieu de ' + a.x.toFixed(1));
      ok(proche(a.rng, c.rng), 'la PORTEE de l unite ' + a.id + ' est une distance monde, elle doit suivre');
      if (a.destX != null) ok(proche(a.destX, c.destX), 'destination de l unite ' + a.id);
      ok(!('tx' in c), 'l unite ' + a.id + ' garde le champ tx de la v6, homonyme des indices de tuile');
    }
    for (let k = 0; k < moderne.nodes.length; k++)
      ok(proche(moderne.nodes[k].x, mig.nodes[k].x), 'gisement ' + k + ' mal remis a l echelle');

    // v7 -> v8 : joueur et IA deviennent des factions, l'etat a plat disparait.
    egal(mig.me, j.FAC.P1, 'la faction locale');
    ok(mig.factions[j.FAC.P1] && mig.factions[j.FAC.PILL], 'joueur et pillards doivent exister');
    egal(mig.factions[j.FAC.P1].pop, p1.pop, 'population du joueur');
    egal(Math.round(mig.factions[j.FAC.P1].res.food), Math.round(p1.res.food), 'caisse du joueur');
    for (const u of mig.units) ok(u.owner !== 'player' && u.owner !== 'enemy',
      'un proprietaire v7 (' + u.owner + ') n a pas ete converti en faction');
    ok(!('res' in mig) && !('ai' in mig) && !('fog' in mig),
      'l etat a plat de la v7 doit disparaitre, sinon il fait doublon avec les factions');
    if (ia) ok(proche(mig.factions[j.FAC.IA].baseX, ia.baseX), 'la base de l IA est une coordonnee monde');
  });

  test('sauvegarde ancienne (sans les recherches économiques) : se charge', () => {
    // Les trois recherches du chantier 5 n'existaient pas : leur absence ne
    // doit rien casser, les lectures étant des tests de vérité.
    const j = partie(charger(), { graine: 4242, pas: 300 });
    const d = JSON.parse(JSON.stringify(j.buildSaveData()));
    const vider = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.research) { delete o.research.brouette; delete o.research.charrue; delete o.research.sentiers; }
      Object.values(o).forEach(vider);
    };
    vider(d);
    const m = j.migrerSauvegarde(d);
    ok(!!m, 'migration a échoué');
    // Et les lectures dérivées doivent rester saines.
    ok(Number.isFinite(j.gatherCap(j.G.me)), 'gatherCap invalide');
    ok(Number.isFinite(j.gatherMult(j.G.me)), 'gatherMult invalide');
  });

  test('sauvegarde : le PROTO/version est présent', () => {
    const j = partie(charger(), { graine: 4242 });
    const d = j.buildSaveData();
    const aUneVersion = Object.keys(d).some((k) => /^(v|version|ver)$/i.test(k));
    ok(aUneVersion, 'aucune clé de version dans la sauvegarde : migrerSauvegarde ne pourra pas discriminer');
  });
});

// ════════════════════════════════════════════════════════════
groupe('chemin', () => {
  test('contourne un U de murs au lieu de foncer dedans', () => {
    const j = partie(charger(), { graine: 4242 });
    const T = j.BASE_TILE;
    // Un U ouvert vers le bas, autour d'un point de départ.
    const cx = 40, cy = 40;
    for (let x = cx - 5; x <= cx + 5; x++) { j.G.bmap[cy - 5][x] = 3; }
    for (let y = cy - 5; y <= cy + 5; y++) { j.G.bmap[y][cx - 5] = 3; j.G.bmap[y][cx + 5] = 3; }
    // Destination droit au nord, de l'autre côté du fond du U.
    const p = j.findPath((cx + 0.5) * T, (cy + 0.5) * T, (cx + 0.5) * T, (cy - 12.5) * T);
    ok(Array.isArray(p) && p.length > 0, 'aucun chemin trouvé alors que le U est ouvert');
    // Le chemin ne doit traverser aucune case bloquée.
    for (const pt of p) {
      const tx = Math.floor(pt.x / T), ty = Math.floor(pt.y / T);
      ok(!j.tileBlocked(tx, ty), `le chemin passe par une case bloquée (${tx},${ty})`);
    }
    // Et il doit vraiment sortir par le bas (contournement), pas tirer droit.
    const maxY = Math.max(...p.map((q) => q.y));
    ok(maxY > (cy + 4) * T, 'le chemin ne contourne pas : il ne descend jamais sous le U');
  });

  test('destination enfermée → renvoie null plutôt qu\'un chemin faux', () => {
    const j = partie(charger(), { graine: 4242 });
    const T = j.BASE_TILE;
    const cx = 100, cy = 100;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) j.G.bmap[y][x] = 3;
    // Départ choisi LIBRE : la carte générée a des lacs (eux aussi marqués 3
    // dans bmap, voir genMap), et partir depuis l'un d'eux ferait échouer le
    // test pour une raison qui n'a rien à voir avec ce qu'il vérifie.
    let sx = 0, sy = 0;
    outer: for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) if (!j.tileBlocked(x, y)) { sx = x; sy = y; break outer; }
    ok(sx > 0, 'aucune case libre trouvée pour le départ');
    const p = j.findPath(sx * T, sy * T, cx * T, cy * T);
    // findPath vise la case libre la plus proche de l'arrivée, puis REMPLACE
    // son dernier point par la cible réelle (voir `pts[pts.length-1]={x:gx,
    // y:gy}`) — ce dernier point est donc légitimement dans le mur, et c'est
    // stepBlocked qui arrête l'unité au contact. On vérifie donc tous les
    // points SAUF le dernier. (Attendre le contraire faisait échouer ce test
    // à sa première écriture : l'attente était fausse, pas le code.)
    if (p && p.length > 1) {
      for (let i = 0; i < p.length - 1; i++) {
        const tx = Math.floor(p[i].x / T), ty = Math.floor(p[i].y / T);
        ok(!j.tileBlocked(tx, ty), `point de passage ${i} dans un mur (${tx},${ty})`);
      }
    }
  });

  test('losClear voit à travers le vide et pas à travers un mur', () => {
    const j = partie(charger(), { graine: 4242 });
    const T = j.BASE_TILE;
    const cx = 150, cy = 150;
    for (let y = cy - 3; y <= cy + 3; y++) j.G.bmap[y][cx] = 3;
    ok(!j.losClear((cx - 3) * T, cy * T, (cx + 3) * T, cy * T), 'le mur ne bloque pas la ligne de vue');
    ok(j.losClear((cx - 3) * T, (cy + 8) * T, (cx + 3) * T, (cy + 8) * T), 'ligne de vue bloquée sans obstacle');
  });
});

// ════════════════════════════════════════════════════════════
groupe('combat', () => {
  test('le triangle de contres tient', () => {
    // Joue chaque affrontement sous TROIS graines d'aléa et exige la
    // majorité. La simulation utilise Math.random en pleine boucle (ciblage
    // de l'IA désynchronisé, chasse, particules) : un duel unique est donc
    // instable, et ce test a effectivement échoué par intermittence sur
    // Archer/Piquier avant d'être écrit ainsi. La majorité sur graines
    // fixées donne un résultat à la fois REPRODUCTIBLE et robuste à un
    // affrontement serré.
    const j = partie(charger(), { graine: 4242 });
    const mk = j.__sandbox.mkFaction;
    j.G.factions.tA = mk('tA', { genre: 'neutre', equipe: 91, hostileATous: true, civ: 'francs', nom: 'A' });
    j.G.factions.tB = mk('tB', { genre: 'neutre', equipe: 92, hostileATous: true, civ: 'francs', nom: 'B' });
    // Deux factions JUMELLES : même automate des deux côtés. Opposer une
    // escouade en marche d'attaque à une escouade sur l'automate ennemi
    // biaise massivement le résultat — voir la mémoire du chantier 2.
    const duel = (x, y, n, alea) => {
      j.semerAleatoire(alea);
      j.G.units.length = 0; j.G.projs.length = 0;
      const cx = j.COLS * j.BASE_TILE / 2, cy = j.ROWS * j.BASE_TILE / 2;
      const A = [], B = [];
      for (let i = 0; i < n; i++) {
        A.push(j.mkUnit(x, cx - j.BASE_TILE * 3 + (i % 4) * 14, cy - 40 + ((i / 4) | 0) * 14, 'tA'));
        B.push(j.mkUnit(y, cx + j.BASE_TILE * 3 + (i % 4) * 14, cy - 40 + ((i / 4) | 0) * 14, 'tB'));
      }
      j.G.units.push(...A, ...B);
      for (let k = 0; k < 6000; k++) { j.update(j.SIM_DT); if (!A.some((u) => u.hp > 0) || !B.some((u) => u.hp > 0)) break; }
      return [A.filter((u) => u.hp > 0).length, B.filter((u) => u.hp > 0).length];
    };
    const majorite = (x, y) => {
      let victoires = 0;
      const detail = [];
      for (const alea of [1, 7, 31]) {
        const [a, b] = duel(x, y, 10, alea);
        detail.push(`${a}-${b}`);
        if (a > b) victoires++;
      }
      return { gagne: victoires >= 2, score: `${victoires}/3 (${detail.join(', ')})` };
    };
    for (const [x, y] of [[j.UT.PIKE, j.UT.KNIGHT], [j.UT.ARC, j.UT.PIKE], [j.UT.KNIGHT, j.UT.ARC]]) {
      const r = majorite(x, y);
      ok(r.gagne, `${j.UDEF[x].nom} doit battre ${j.UDEF[y].nom} : ${r.score}`);
    }
  });

  test('un coup fait toujours au moins 1 dégât', () => {
    const j = partie(charger(), { graine: 4242 });
    const faible = { atk: 0, type: j.UT.VIL };
    const blinde = j.mkUnit(j.UT.RAM, 0, 0, j.G.me);
    ok(j.degatsContre(faible, blinde) >= 1, 'une unité suffisamment blindée devient invulnérable');
  });

  test('la signature du Bélier tient : fondu en mêlée, immunisé au trait', () => {
    const j = partie(charger(), { graine: 4242 });
    const ram = j.mkUnit(j.UT.RAM, 0, 0, j.G.me);
    const arc = j.degatsDe(j.mkUnit(j.UT.ARC, 0, 0, j.G.me), ram);
    const pike = j.degatsDe(j.mkUnit(j.UT.PIKE, 0, 0, j.G.me), ram);
    ok(pike > arc * 5, `le Bélier doit fondre en mêlée : archer ${arc}, piquier ${pike}`);
  });

  test('le siège garde son avantage contre les bâtiments', () => {
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    const ram = j.degatsDe(j.mkUnit(j.UT.RAM, 0, 0, j.G.me), tc);
    const mil = j.degatsDe(j.mkUnit(j.UT.MIL, 0, 0, j.G.me), tc);
    ok(ram > mil * 4, `le Bélier doit surclasser le Milicien sur un bâtiment : ${ram} vs ${mil}`);
  });

  test('une unité en garnison est intouchable : ni ciblée, ni blessée', () => {
    // Trouvé en cherchant d'autres subtilités du même genre que la garnison :
    // drawUnits (rendu) et handleTap (sélection) traitent déjà une unité
    // garnie comme invisible/inaffectable, mais AUCUN des chemins de ciblage
    // automatique de la simulation ne l'excluait — un assaillant pouvait la
    // trouver et l'abattre une par une, sans jamais toucher au bâtiment
    // censé la protéger. Ce test verrouille les deux fonctions de ciblage ET
    // le résultat en jeu (PV inchangés après du combat simulé).
    const j = partie(charger(), { graine: 4242 });
    const mk = j.__sandbox.mkFaction;
    j.G.factions.tA = mk('tA', { genre: 'neutre', equipe: 91, hostileATous: true, civ: 'francs', nom: 'Défenseur' });
    j.G.factions.tB = mk('tB', { genre: 'neutre', equipe: 92, hostileATous: true, civ: 'francs', nom: 'Assaillant' });
    j.G.units.length = 0;
    const tc = j.mkBuilding(j.BT.TC, 60, 60, 'tA');
    tc.constructing = false; tc.progress = 1;
    j.placeBuilding(tc);

    const abrite = j.mkUnit(j.UT.VIL, tc.x, tc.y, 'tA');
    abrite.state = 'garrison'; abrite.target = tc.id;
    j.G.units.push(abrite);
    // À portée immédiate : si le ciblage voyait cette unité, ce serait
    // forcément elle, la plus proche possible (même position que le CV).
    const assaillant = j.mkUnit(j.UT.MIL, tc.x, tc.y, 'tB');
    j.G.units.push(assaillant);
    j.rebuildIndex();

    egal(j.cibleAssaillant(assaillant), null, 'cibleAssaillant trouve une unité en garnison');
    egal(j.prochainHostileUnite(tc.x, tc.y, 999, assaillant), null, 'prochainHostileUnite trouve une unité en garnison');

    const hpAvant = abrite.hp;
    for (let k = 0; k < 300; k++) j.update(j.SIM_DT);
    egal(abrite.hp, hpAvant, 'l\'unité en garnison a perdu des PV alors que son bâtiment tient toujours');
    ok(assaillant.target !== abrite.id, 'l\'assaillant a fini par verrouiller l\'unité en garnison comme cible');
  });

  test('un bâtiment abîmé fume, un bâtiment sain jamais', () => {
    // L'état de dégât lui-même (lavis de suie sur le sprite) est du rendu et
    // n'est délibérément pas testé ici (voir l'en-tête du fichier). La fumée,
    // elle, mute G.parts pendant update() : c'est de la simulation, donc
    // testable. Math.random() décide QUAND une particule naît (comme la
    // poussière de chantier) — 300 pas à 30 Hz, soit 10 s simulées, rendent
    // un résultat nul à peu près impossible (≈10 % de chance par pas au
    // palier le plus grave) sans figer de graine dédiée à ce seul geste
    // cosmétique.
    // G.units vidé après startGame() : en Conquête l'IA et la faune tournent
    // déjà, et un raid ou une chasse qui égratigne un bâtiment DANS la
    // fenêtre du test rendait le premier essai (bâtiment sain) flaky — vu en
    // pratique (2-3 particules « fantômes » sur un run sur trois). Sans
    // unité, aucun combat n'est possible : seul le hp qu'on fixe nous-mêmes
    // peut faire varier le résultat.
    const j = partie(charger(), { graine: 4242 });
    // ...mais « à peu près impossible » n'était pas « impossible » : ce test a
    // bel et bien échoué deux fois sur une douzaine de passages, AVANT comme
    // APRÈS le correctif de recul du pathfinding — donc sur son seul aléa.
    // La cause n'est pas le tirage de NAISSANCE (≈10 % par pas, donc ~30
    // particules attendues sur 300 pas) mais le fait de ne REGARDER qu'à la
    // toute fin : une particule vit 1,3 s, il n'en restait donc que 1 à 4 en
    // vol à l'instant du contrôle — et parfois zéro. On sème l'aléa (comme le
    // groupe `combat`) ET on observe pendant toute la fenêtre plutôt qu'au
    // seul dernier instant : un test intermittent est pire que pas de test,
    // il apprend à ignorer les échecs.
    j.semerAleatoire(4242);
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    j.G.units.length = 0;
    const sain = j.mkBuilding(j.BT.BARRACKS, tc.tx + 5, tc.ty, j.G.me);
    sain.constructing = false; sain.progress = 1;
    j.placeBuilding(sain);
    j.G.parts.length = 0;
    let vuesSain = 0;
    for (let k = 0; k < 300; k++) { j.update(j.SIM_DT); vuesSain = Math.max(vuesSain, j.G.parts.length); }
    ok(vuesSain === 0, `un bâtiment à PV pleins ne doit jamais fumer : ${vuesSain} particule(s)`);

    const ruine = j.mkBuilding(j.BT.BARRACKS, tc.tx + 5, tc.ty + 3, j.G.me);
    ruine.constructing = false; ruine.progress = 1; ruine.hp = Math.round(ruine.maxHp * 0.2);
    j.placeBuilding(ruine);
    j.G.parts.length = 0;
    let vuesRuine = 0;
    for (let k = 0; k < 300; k++) { j.update(j.SIM_DT); vuesRuine = Math.max(vuesRuine, j.G.parts.length); }
    ok(vuesRuine > 0, 'un bâtiment à 20% PV doit dégager de la fumée sur 10 s simulées');
  });
});

// ════════════════════════════════════════════════════════════
groupe('civilisations', () => {
  const civs = ['francs', 'byzantins', 'chinois', 'mongols'];

  test('chaque civilisation a une identité mécanique, pas seulement un multiplicateur', () => {
    const j = charger();
    for (const c of civs) {
      const d = j.CIVS[c];
      ok(!!d, `civilisation ${c} absente`);
      ok(!!d.techCiv, `${c} n'a pas de recherche exclusive`);
      ok(!!j.RDEF[d.techCiv], `${c} : recherche ${d.techCiv} absente de RDEF`);
      egal(j.RDEF[d.techCiv].civ, c, `${c} : la recherche n'est pas filtrée sur la bonne civ`);
    }
    // Trois unités uniques ; les Francs gardent le Paladin, qui est commun —
    // c'est assumé et documenté dans CIVS.
    const uniques = civs.map((c) => j.CIVS[c].unique).filter(Boolean);
    egal(uniques.length, 3, 'nombre d\'unités uniques');
    egal(new Set(uniques).size, 3, 'deux civilisations partagent la même unité unique');
  });

  test('l\'unité unique est refusée à une autre civilisation, même par ordre réseau', () => {
    // C'est le point qui compte : l'interface ne montre que la sienne, mais
    // seule la validation de l'hôte empêche un ordre forgé de passer.
    for (const c of civs) {
      const j = charger();
      j.__sandbox.selectedCiv = c;
      j.__sandbox.pickCiv(c);
      partie(j, { graine: 4242 });
      const f = j.moi();
      egal(f.civ, c, 'civ de la faction');
      f.age = 3;
      Object.assign(f.res, { food: 9999, wood: 9999, gold: 9999, stone: 9999 });
      const castle = j.mkBuilding(j.BT.CASTLE, 30, 30, j.G.me);
      castle.constructing = false; castle.progress = 1;
      j.G.buildings.push(castle); j.placeBuilding(castle); j.rebuildIndex();
      // APRÈS placeBuilding : celui-ci recalcule maxPop depuis les bâtiments
      // et écraserait la valeur posée avant lui.
      f.maxPop = 200;
      for (const autre of civs) {
        const u = j.CIVS[autre].unique;
        if (!u) continue;
        const r = j.__sandbox.applyCommand({ t: 'FORMER', f: j.G.me, bId: castle.id, unitType: u });
        if (autre === c) ok(r.ok, `${c} ne peut pas former sa propre unité unique (${r.raison})`);
        else egal(r.ok, false, `${c} a pu former l'unité unique des ${autre}`);
      }
    }
  });

  test('la recherche exclusive est refusée à une autre civilisation', () => {
    const j = charger();
    j.__sandbox.selectedCiv = 'mongols'; j.__sandbox.pickCiv('mongols');
    partie(j, { graine: 4242 });
    const f = j.moi();
    f.age = 3;
    Object.assign(f.res, { food: 9999, wood: 9999, gold: 9999, stone: 9999 });
    const univ = j.mkBuilding(j.BT.UNIV, 34, 34, j.G.me);
    univ.constructing = false; univ.progress = 1;
    j.G.buildings.push(univ); j.placeBuilding(univ); j.rebuildIndex();
    const sienne = j.__sandbox.applyCommand({ t: 'RECHERCHE', f: j.G.me, cle: 'etriers' });
    ok(sienne.ok, `les Mongols ne peuvent pas lancer Étriers de Fer (${sienne.raison})`);
    const autre = j.__sandbox.applyCommand({ t: 'RECHERCHE', f: j.G.me, cle: 'feu_gregeois' });
    egal(autre.ok, false, 'les Mongols ont pu lancer le Feu Grégeois byzantin');
  });

  test('la recherche exclusive est refusée avant l\'Âge Impérial', () => {
    const j = charger();
    j.__sandbox.selectedCiv = 'francs'; j.__sandbox.pickCiv('francs');
    partie(j, { graine: 4242 });
    const f = j.moi();
    f.age = 2;   // Âge des Châteaux : pas encore
    Object.assign(f.res, { food: 9999, wood: 9999, gold: 9999, stone: 9999 });
    const univ = j.mkBuilding(j.BT.UNIV, 34, 34, j.G.me);
    univ.constructing = false; univ.progress = 1;
    j.G.buildings.push(univ); j.placeBuilding(univ); j.rebuildIndex();
    egal(j.__sandbox.applyCommand({ t: 'RECHERCHE', f: j.G.me, cle: 'chevalerie' }).ok, false, 'lancée trop tôt');
    f.age = 3;
    ok(j.__sandbox.applyCommand({ t: 'RECHERCHE', f: j.G.me, cle: 'chevalerie' }).ok, 'refusée à l\'Âge Impérial');
  });

  test('les bonus économiques agissent réellement', () => {
    // Chinois : deux villageois de départ en plus.
    const ch = charger(); ch.__sandbox.selectedCiv = 'chinois'; ch.__sandbox.pickCiv('chinois');
    partie(ch, { graine: 4242 });
    const fr = charger(); fr.__sandbox.selectedCiv = 'francs'; fr.__sandbox.pickCiv('francs');
    partie(fr, { graine: 4242 });
    const vils = (j) => j.G.units.filter((u) => u.type === j.UT.VIL && j.estLocal(u)).length;
    egal(vils(ch) - vils(fr), 2, 'les Chinois ne démarrent pas avec 2 villageois de plus');
  });

  test('l\'unité unique tient sa niche : le Cataphractaire encaisse le Piquier', () => {
    const j = charger();
    partie(j, { graine: 4242 });
    const pike = j.mkUnit(j.UT.PIKE, 0, 0, j.G.me);
    const cata = j.mkUnit(j.UT.CATA, 0, 0, j.G.me);
    const knight = j.mkUnit(j.UT.KNIGHT, 0, 0, j.G.me);
    const vsCata = j.degatsDe(pike, cata), vsKnight = j.degatsDe(pike, knight);
    ok(vsCata < vsKnight, `le Cataphractaire doit encaisser mieux que le Chevalier : ${vsCata} vs ${vsKnight}`);
    // ...mais il ne doit pas devenir invulnérable au contre.
    ok(vsCata > j.degatsDe(j.mkUnit(j.UT.MIL, 0, 0, j.G.me), cata), 'le Piquier ne contre plus du tout le Cataphractaire');
  });
});

// ════════════════════════════════════════════════════════════
groupe('cartes', () => {
  const presets = ['plaines', 'foret', 'arides', 'lacs', 'arene'];
  const avecCarte = (k, opts) => {
    const j = charger();
    j.__sandbox.selectedCarte = k;
    j.pickCarte(k);
    return partie(j, opts);
  };

  test('même preset + même graine → carte strictement identique', () => {
    for (const k of presets) {
      egalJSON(empreinteCarte(avecCarte(k, { graine: 909 })),
               empreinteCarte(avecCarte(k, { graine: 909 })), `preset ${k}`);
    }
  });

  test('chaque preset produit un monde réellement différent', () => {
    const sigs = presets.map((k) => {
      const j = avecCarte(k, { graine: 909 });
      const n = {};
      for (const nd of j.G.nodes) n[nd.type] = (n[nd.type] || 0) + 1;
      let eau = 0;
      for (let y = 0; y < j.ROWS; y++) for (let x = 0; x < j.COLS; x++) if (j.G.tiles[y][x] === j.T_WATER) eau++;
      return JSON.stringify([n, eau]);
    });
    egal(new Set(sigs).size, presets.length, 'deux presets donnent le même monde');
  });

  test('les presets tiennent leur promesse', () => {
    const compte = (k) => {
      const j = avecCarte(k, { graine: 909 });
      const n = {};
      for (const nd of j.G.nodes) n[nd.type] = (n[nd.type] || 0) + 1;
      let eau = 0;
      for (let y = 0; y < j.ROWS; y++) for (let x = 0; x < j.COLS; x++) if (j.G.tiles[y][x] === j.T_WATER) eau++;
      return { arbres: n.T || 0, or: n.G || 0, pierre: n.S || 0, poissons: n.PO || 0, eau };
    };
    const p = compte('plaines'), f = compte('foret'), a = compte('arides'), l = compte('lacs');
    ok(f.arbres > p.arbres * 1.6, `Grande Forêt : ${f.arbres} arbres contre ${p.arbres} en Plaines`);
    ok(f.or < p.or, 'Grande Forêt : l\'or devrait être plus rare');
    ok(a.arbres < p.arbres * 0.7, `Terres Arides : ${a.arbres} arbres contre ${p.arbres}`);
    ok(a.or > p.or && a.pierre > p.pierre, 'Terres Arides : filons plus généreux attendus');
    ok(l.eau > p.eau * 2, `Grands Lacs : ${l.eau} cases d'eau contre ${p.eau}`);
    ok(l.poissons > p.poissons * 1.5, 'Grands Lacs : plus de poisson attendu');
  });

  test('Arène : une enceinte par camp, percée de portails OUVERTS', () => {
    const j = avecCarte('arene', { graine: 909 });
    const murs = j.G.buildings.filter((b) => b.type === j.BT.WALL);
    const portails = j.G.buildings.filter((b) => b.type === j.BT.GATE);
    ok(murs.length > 60, `trop peu de murs : ${murs.length}`);
    ok(portails.length >= 6, `trop peu de portails : ${portails.length}`);
    ok(portails.every((g) => g.open), 'un portail de départ est fermé');
    // Un portail fermé enfermerait le camp : la case doit être franchissable.
    ok(portails.every((g) => !j.tileBlocked(g.tx, g.ty)), 'un portail bloque le passage');
    // Chaque camp a la sienne — sinon le preset offrirait une palissade
    // gratuite au seul joueur humain.
    const camps = new Set(j.G.buildings.filter((b) => b.type === j.BT.TC).map((b) => b.owner));
    for (const c of camps) ok(murs.some((m) => m.owner === c), `le camp ${c} n'a pas d'enceinte`);
    // Aucun bâtiment en double (placeBuilding pousse lui-même dans
    // G.buildings : un push explicite en plus insérait chaque mur deux fois).
    const ids = j.G.buildings.map((b) => b.id);
    egal(new Set(ids).size, ids.length, 'des bâtiments apparaissent en double dans G.buildings');
  });

  test('Arène : l\'enceinte est ÉTANCHE — pas de brèche autour d\'un arbre', () => {
    // Un gisement pose bmap=2, qui ne BLOQUE PAS (seul 3 bloque). La pose du
    // mur y était sautée : chaque arbre pris dans le tracé ouvrait une brèche
    // franchissable, et l'on entrait dans l'arène « entre la palissade et
    // l'arbre ». Le défaut dépend de la graine — d'où le balayage plutôt
    // qu'une seule carte.
    for (const graine of [909, 1234, 4242, 77777, 31415]) {
      const j = avecCarte('arene', { graine });
      for (const tc of j.G.buildings.filter((b) => b.type === j.BT.TC)) {
        const r = 6;
        const x0 = tc.tx + (tc.w >> 1) - r, y0 = tc.ty + (tc.h >> 1) - r;
        const x1 = tc.tx + (tc.w >> 1) + r, y1 = tc.ty + (tc.h >> 1) + r;
        const mx = (x0 + x1) >> 1, my = (y0 + y1) >> 1;
        const cases = [];
        for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) cases.push([x, y, x === mx]);
        for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) cases.push([x, y, y === my]);
        for (const [x, y, estPortail] of cases) {
          if (estPortail) continue;              // les 4 portails DOIVENT laisser passer
          if (x < 1 || y < 1 || x >= j.COLS - 1 || y >= j.ROWS - 1) continue;
          ok(j.tileBlocked(x, y),
             `graine ${graine} : brèche en ${x},${y} (bmap ${j.G.bmap[y][x]})`);
        }
      }
    }
  });


  test('aucun preset n\'enferme un camp : la base adverse reste atteignable', () => {
    // LE test qui compte. Une palissade sans portail praticable, ou un lac
    // qui coupe la carte en deux, rendrait la partie impossible à terminer —
    // et ça ne se voit pas à l'œil sur une carte de 240×240.
    for (const k of presets) {
      const j = avecCarte(k, { graine: 909 });
      const tcs = j.G.buildings.filter((b) => b.type === j.BT.TC);
      ok(tcs.length >= 2, `${k} : moins de deux Centres Ville`);
      const [a, b] = tcs;
      const p = j.findPath(a.x, a.y + j.BASE_TILE * 3, b.x, b.y + j.BASE_TILE * 3);
      ok(Array.isArray(p) && p.length > 0, `${k} : aucun chemin entre les deux bases`);
    }
  });

  test('le type de carte voyage avec la graine (sinon désync garantie)', () => {
    const j = avecCarte('lacs', { graine: 909 });
    const salut = j.construireSalut();
    egal(salut.carte, 'lacs', 'construireSalut n\'emporte pas le type de carte');
    egal(salut.seed, j.G.seed, 'construireSalut n\'emporte pas la graine');
  });

  // ── SOL ────────────────────────────────────────────────────
  // Le sol n'est plus une herbe unique repeinte d'un voile : chaque carte
  // décrit sa MATIÈRE (voir SOLS), et buildTerrain peint ses huit variantes
  // avec. Rien de tout cela n'est vérifiable en pixels ici — les bouchons DOM
  // ne dessinent pas —, mais la TABLE, elle, se vérifie : c'est elle qui a
  // laissé passer pendant longtemps une steppe fleurie de marguerites.
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const moyenne = (cols) => {
    const t = cols.map(hexRGB).reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
    return t.map((v) => Math.round(v / cols.length));
  };

  test('chaque carte décrit un sol complet', () => {
    for (const k of Object.keys(charger().CARTES)) {
      const j = charger();
      const sol = j.SOLS[j.CARTES[k].sol];
      ok(!!sol, `la carte ${k} n'a pas de sol`);
      egal(sol.base.length, j.GRASS_VARIANTS, `${k} : il faut un fond par variante d'herbe`);
      for (const champ of ['touffe', 'brins', 'grain', 'decors', 'macro', 'macroL', 'sable', 'terre', 'mini']) {
        ok(sol[champ] != null, `${k} : champ ${champ} manquant`);
      }
      egal(sol.decors.length, 4, `${k} : quatre décors attendus (une variante sur deux)`);
      for (const d of sol.decors) ok(typeof j.DECORS_SOL[d] === 'function', `${k} : décor inconnu « ${d} »`);
      egal(sol.sable.length, 3, `${k} : la rive veut fond, ton sombre, ton clair`);
      egal(sol.brins.cols.length, 3, `${k} : un brin se peint en trois tons`);
    }
  });

  test('deux cartes ne partagent jamais le même sol', () => {
    // C'est TOUT l'objet du changement : avec un simple voile, la Grande Forêt
    // et les Plaines rendaient le même vert à 26 % près, et seule la mini-carte
    // les distinguait.
    const j = charger();
    const vus = new Map();
    for (const k of Object.keys(j.CARTES)) {
      const sol = j.SOLS[j.CARTES[k].sol];
      const sig = moyenne(sol.base).join(',');
      ok(!vus.has(sig), `${k} et ${vus.get(sig)} ont le même sol`);
      vus.set(sig, k);
    }
    // …et l'écart doit être VISIBLE, pas seulement non nul.
    const cles = Object.keys(j.CARTES);
    for (let a = 0; a < cles.length; a++) for (let b = a + 1; b < cles.length; b++) {
      const ca = moyenne(j.SOLS[j.CARTES[cles[a]].sol].base);
      const cb = moyenne(j.SOLS[j.CARTES[cles[b]].sol].base);
      const d = Math.max(...ca.map((v, i) => Math.abs(v - cb[i])));
      ok(d >= 8, `${cles[a]} et ${cles[b]} : sols trop proches (${d} au canal le plus écarté)`);
    }
  });

  test('la mini-carte ne contredit pas le terrain', () => {
    // Une carte aride qui se lit verte en miniature ment au joueur : c'est sur
    // la mini-carte qu'il choisit où aller.
    const j = charger();
    for (const k of Object.keys(j.CARTES)) {
      const sol = j.SOLS[j.CARTES[k].sol];
      const base = moyenne(sol.base), mini = hexRGB(sol.mini);
      const d = Math.max(...base.map((v, i) => Math.abs(v - mini[i])));
      ok(d <= 20, `${k} : la couleur de mini-carte s'écarte de ${d} du sol réel`);
    }
  });

  test('le voile de biome a bien disparu', () => {
    // Il valait mieux le retirer que le réduire : opaque, il effaçait le grain
    // et les brins qu'il recouvrait. Si le champ revient, c'est que quelqu'un
    // a réintroduit la passe de fillRect par case.
    const j = charger();
    for (const k of Object.keys(j.CARTES)) {
      ok(j.SOLS[j.CARTES[k].sol].teinte === undefined, `${k} : le voile « teinte » est de retour`);
    }
  });

  test('la sauvegarde retient le type de carte', () => {
    const j = avecCarte('arides', { graine: 909, pas: 60 });
    egal(j.buildSaveData().carte, 'arides', 'type de carte absent de la sauvegarde');
  });
});

// ════════════════════════════════════════════════════════════
// COLS/ROWS ne sont plus des constantes. Tout ce qui était dimensionné une
// fois pour toutes au chargement (grille de séparation, buffers A*, échelle
// SC() de la génération) doit suivre — un oubli ne se voit pas à l'œil : il
// écrit hors des bornes ou tasse toute la carte dans un coin.
groupe('tailles', () => {
  const cles = ['petite', 'moyenne', 'normale', 'grande'];
  const lire = (j, n) => j.__sandbox.__lire(n);
  const avecTaille = (k, opts) => {
    const j = charger();
    j.pickTaille(k);
    return partie(j, opts);
  };
  // Deux humains, montés comme l'hôte d'une partie en ligne : c'est le seul
  // cas où plusieurs départs coexistent.
  const duo = (opts = {}) => {
    const j = charger();
    if (opts.taille) j.pickTaille(opts.taille);
    j.RESEAU.actif = true; j.RESEAU.role = 'hote';
    j.RESEAU.adversaire = { id: j.FAC.P2, nom: 'Invité' };
    return partie(j, opts);
  };
  const tcDe = (j, id) => j.G.buildings.find((b) => b.type === j.BT.TC && b.owner === id);

  test('chaque taille produit une carte à ses dimensions', () => {
    for (const k of cles) {
      const j = avecTaille(k, { graine: 909 });
      const n = j.TAILLES[k].n;
      egal(lire(j, 'COLS'), n, `${k} : COLS`);
      egal(lire(j, 'ROWS'), n, `${k} : ROWS`);
      egal(j.G.tiles.length, n, `${k} : lignes de tuiles`);
      egal(j.G.tiles[0].length, n, `${k} : colonnes de tuiles`);
      egal(j.G.bmap.length, n, `${k} : lignes de blocage`);
      egal(j.G.taille, k, `${k} : taille non figée dans l'état`);
    }
  });

  test('même taille + même graine → carte strictement identique', () => {
    for (const k of ['petite', 'grande']) {
      egalJSON(empreinteCarte(avecTaille(k, { graine: 909 })),
               empreinteCarte(avecTaille(k, { graine: 909 })), `taille ${k}`);
    }
  });

  test('une carte redimensionnée reste jouable (grilles et A* suivent)', () => {
    // La grille de séparation et les buffers du pathfinding sont des tableaux
    // TYPÉS dimensionnés sur COLS*ROWS : oublier de les réallouer ne lève rien
    // tout de suite, ça écrit simplement à côté. On fait donc tourner de vraies
    // parties, aux deux extrêmes, en exigeant un chemin de bout en bout.
    for (const k of ['petite', 'grande']) {
      const j = avecTaille(k, { graine: 909, pas: 120 });
      const n = j.TAILLES[k].n;
      ok(!!tcDe(j, j.FAC.P1), `${k} : pas de Centre Ville`);
      // Un chemin COURT mais dans le coin le plus éloigné de l'origine : ses
      // indices (ty*COLS+tx) sont les plus grands de la carte, donc les
      // premiers à sortir des buffers si ceux-ci étaient restés dimensionnés
      // pour la taille précédente. Court, parce que le budget d'exploration
      // (PF_BUDGET) ne permet de toute façon pas de traverser 320 cases.
      // Le coin peut être un lac : on prend les deux cases praticables les
      // plus proches, sinon on testerait le blocage, pas les buffers.
      const praticable = (depuis) => {
        for (let d = depuis; d < depuis + 40; d++) if (!j.tileBlocked(n - d, n - d)) return n - d;
        throw new Error(`${k} : aucune case praticable sur la diagonale`);
      };
      const t1 = praticable(20), t2 = praticable(6);
      const c = (t) => (t + 0.5) * j.BASE_TILE;
      const p = j.findPath(c(t1), c(t1), c(t2), c(t2));
      ok(Array.isArray(p) && p.length > 0,
         `${k} : aucun chemin dans le coin lointain (buffers non redimensionnés ?)`);
      for (const u of j.G.units) {
        ok(u.x >= 0 && u.y >= 0 && u.x <= n * j.BASE_TILE && u.y <= n * j.BASE_TILE,
           `${k} : unité hors carte en ${Math.round(u.x)},${Math.round(u.y)}`);
      }
    }
  });

  test("les gisements suivent la taille : une grande carte n'est pas un désert", () => {
    const compte = (k) => avecTaille(k, { graine: 909 }).G.nodes.length;
    const p = compte('petite'), n = compte('normale'), g = compte('grande');
    ok(p < n && n < g, `gisements : petite ${p}, normale ${n}, grande ${g}`);
    // Densité au moins comparable : la grande carte a 1,78 fois la surface de
    // la normale, elle doit avoir nettement plus d'un gisement de plus.
    ok(g > n * 1.2, `la grande carte n'est pas assez fournie : ${g} contre ${n}`);
  });

  test('la taille voyage avec la graine (sinon désync garantie)', () => {
    const j = duo({ graine: 909, taille: 'petite' });
    const salut = j.construireSalut();
    egal(salut.taille, 'petite', "construireSalut n'emporte pas la taille de carte");
    egal(j.buildSaveData().taille, 'petite', 'taille absente de la sauvegarde');
  });

  test('à deux, les départs sont éloignés — jamais côte à côte', () => {
    for (const graine of [909, 1234, 4242, 77777, 31415]) {
      const j = duo({ graine });
      const a = tcDe(j, j.FAC.P1), b = tcDe(j, j.FAC.P2);
      ok(!!a && !!b, `graine ${graine} : il manque un Centre Ville`);
      const d = Math.hypot(a.tx - b.tx, a.ty - b.ty);
      ok(d > lire(j, 'COLS') * 0.5,
         `graine ${graine} : bases distantes de ${Math.round(d)} cases seulement`);
    }
  });

  test('les départs varient avec la graine (et non deux coins figés)', () => {
    // Graines VOISINES, à dessein : c'est ce qu'un joueur tape quand il veut
    // « une autre carte ». Un générateur de Lehmer non brassé sort la même
    // valeur à 0,0005 près pour 11 et 22 — mêmes angles, mêmes départs, alors
    // que six graines éloignées, elles, passaient sans rien voir.
    const vus = new Set();
    for (const graine of [11, 12, 13, 22, 33, 44]) {
      const j = duo({ graine });
      const tc = tcDe(j, j.FAC.P1);
      vus.add(tc.tx + ',' + tc.ty);
    }
    ok(vus.size >= 5, `six graines n'ont produit que ${vus.size} départs distincts`);
  });

  test("aucun départ dans l'eau, aucun gisement sous une base", () => {
    for (const graine of [909, 1234, 4242, 77777, 31415]) {
      const j = duo({ graine });
      for (const tc of j.G.buildings.filter((b) => b.type === j.BT.TC)) {
        for (let dy = 0; dy < tc.h; dy++) for (let dx = 0; dx < tc.w; dx++) {
          egal(j.G.tiles[tc.ty + dy][tc.tx + dx], 0,
               `graine ${graine} : base ${tc.owner} posée sur de l'eau`);
        }
        const dessous = j.G.nodes.filter((n) => n.amt > 0
          && n.tx >= tc.tx && n.tx < tc.tx + tc.w && n.ty >= tc.ty && n.ty < tc.ty + tc.h);
        egal(dessous.length, 0, `graine ${graine} : gisement enseveli sous la base ${tc.owner}`);
      }
    }
  });

  test('alliés : le mode coopératif les pose côte à côte, pas aux antipodes', () => {
    const j = duo({ graine: 909, mode: 'coop2v1' });
    const a = tcDe(j, j.FAC.P1), b = tcDe(j, j.FAC.P2);
    const d = Math.hypot(a.tx - b.tx, a.ty - b.ty);
    ok(d > 8, `alliés collés l'un à l'autre : ${Math.round(d)} cases`);
    ok(d < lire(j, 'COLS') * 0.35, `alliés trop éloignés pour s'entraider : ${Math.round(d)} cases`);
  });
});

// ════════════════════════════════════════════════════════════
// applyCommand est la SEULE porte par laquelle un joueur mute l'état, et en
// ligne c'est elle qui reçoit les ordres du client. Tout ce qu'elle ne
// vérifie pas est exploitable : l'interface, elle, ne verrouille que
// l'affichage. Ces tests visent donc les REFUS, pas les cas nominaux.
groupe('ordres', () => {
  test('un ordre ne peut pas déplacer les unités d\'un AUTRE camp', () => {
    const j = partie(charger(), { graine: 4242 });
    const sien = j.G.units.find((u) => j.estLocal(u));
    const autre = j.G.units.find((u) => !j.estLocal(u) && u.hp > 0);
    ok(!!autre, 'aucune unité adverse pour le test');
    const avant = { x: autre.x, y: autre.y, s: autre.state };
    const r = ordreDe(j, j.G.me, 'DEPL', { ids: [autre.id], x: 100, y: 100 });
    egal(r.ok, false, 'un camp a pu ordonner le déplacement des unités adverses');
    egalJSON([autre.x, autre.y, autre.state], [avant.x, avant.y, avant.s], 'unité adverse déplacée');
    ok(ordreDe(j, j.G.me, 'DEPL', { ids: [sien.id], x: 100, y: 100 }).ok, 'son propre ordre est refusé');
  });

  test('BATIR : verrous d\'âge, case occupée, hors carte, Quai sans eau', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const p = caseLibre(j, 60, 60, 3, 3);
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.CASTLE, tx: p.tx, ty: p.ty }).ok, false, 'Château bâti avant l\'Âge des Châteaux');
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.SIEGE, tx: p.tx, ty: p.ty }).ok, false, 'Atelier de siège bâti trop tôt');
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.WONDER, tx: p.tx, ty: p.ty }).ok, false, 'Merveille bâtie avant l\'Âge Impérial');
    f.age = 2;
    ok(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.CASTLE, tx: p.tx, ty: p.ty }).ok, 'Château refusé à l\'Âge des Châteaux');
    // La même case n'est plus libre.
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.HOUSE, tx: p.tx, ty: p.ty }).ok, false, 'bâtiment posé sur une case occupée');
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.HOUSE, tx: -5, ty: 10 }).ok, false, 'bâtiment posé hors carte');
    egal(ordreDe(j, j.G.me, 'BATIR', { type: 'PAS_UN_TYPE', tx: 20, ty: 20 }).ok, false, 'type de bâtiment inventé accepté');
    // Quai : doit toucher l'eau.
    let sec = null;
    for (let y = 2; y < 60 && !sec; y++) for (let x = 2; x < 60 && !sec; x++) {
      if (j.G.bmap[y][x] === 0 && j.G.bmap[y + 1][x] === 0 && j.G.bmap[y][x + 1] === 0 && j.G.bmap[y + 1][x + 1] === 0
          && !j.__sandbox.hasAdjacentWater(x, y, 2, 2)) sec = { x, y };
    }
    if (sec) egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.DOCK, tx: sec.x, ty: sec.y }).ok, false, 'Quai bâti loin de l\'eau');
  });

  test('BATIR : sans les ressources, rien n\'est posé ni prélevé', () => {
    const j = partie(charger(), { graine: 4242 });
    const f = j.moi();
    Object.assign(f.res, { food: 0, wood: 0, stone: 0, gold: 0 });
    const n = j.G.buildings.length;
    const p = caseLibre(j, 60, 60, 2, 2);
    egal(ordreDe(j, j.G.me, 'BATIR', { type: j.BT.BARRACKS, tx: p.tx, ty: p.ty }).ok, false, 'bâti sans ressources');
    egal(j.G.buildings.length, n, 'un bâtiment a été posé quand même');
    egalJSON([f.res.wood, f.res.stone], [0, 0], 'des ressources ont été prélevées');
  });

  test('FORMER : l\'arbre technologique est vérifié côté hôte', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi(); f.maxPop = 200;
    const p = caseLibre(j, 60, 60, 3, 3);
    const castle = batir(j, j.BT.CASTLE, p.tx, p.ty);
    f.maxPop = 200;
    egal(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.PALADIN }).ok, false, 'Paladin formé sans Foi Divine');
    egal(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.XBOW }).ok, false, 'Arbalétrier formé avant l\'Âge des Châteaux');
    // Un bâtiment qui ne produit pas cette unité doit refuser.
    const p2 = caseLibre(j, 70, 70, 1, 1);
    const maison = batir(j, j.BT.HOUSE, p2.tx, p2.ty);
    egal(ordreDe(j, j.G.me, 'FORMER', { bId: maison.id, unitType: j.UT.PALADIN }).ok, false, 'Paladin formé depuis une Maison');
    f.research.faith = true; f.age = 3; f.maxPop = 200;
    ok(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.PALADIN }).ok, 'Paladin refusé alors que tout est réuni');
  });

  test('FORMER : le plafond de population est respecté', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    f.maxPop = f.pop;   // plein
    egal(ordreDe(j, j.G.me, 'FORMER', { bId: tc.id, unitType: j.UT.VIL }).ok, false, 'unité formée au-delà du plafond');
    f.maxPop = f.pop + 5;
    ok(ordreDe(j, j.G.me, 'FORMER', { bId: tc.id, unitType: j.UT.VIL }).ok, 'unité refusée alors qu\'il reste de la place');
  });

  test('FORMER : le Héros est unique, et son annulation rend la chance', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi(); f.age = 3; f.maxPop = 200;
    const p = caseLibre(j, 60, 60, 3, 3);
    const castle = batir(j, j.BT.CASTLE, p.tx, p.ty);
    f.maxPop = 200;
    ok(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.HERO }).ok, 'premier Héros refusé');
    egal(f.heroTrained, true, 'heroTrained non posé');
    egal(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.HERO }).ok, false, 'deuxième Héros accepté');
    const i = castle.trainQ.indexOf(j.UT.HERO);
    ok(ordreDe(j, j.G.me, 'ANNULER_FORMATION', { bId: castle.id, index: i }).ok, 'annulation refusée');
    egal(f.heroTrained, false, 'annuler le Héros ne rend pas la chance de la partie');
    ok(ordreDe(j, j.G.me, 'FORMER', { bId: castle.id, unitType: j.UT.HERO }).ok, 'Héros refusé après annulation');
  });

  test('TROC : le taux vient de la table, jamais de l\'ordre', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const p = caseLibre(j, 60, 60, 2, 2);
    batir(j, j.BT.MARKET, p.tx, p.ty);
    const t = j.TROCS[0];
    const or0 = f.res.gold;
    // Taux forgé : c'est l'exploit que TROCS ferme (ressources infinies).
    egal(ordreDe(j, j.G.me, 'TROC', { donne: t.donne, recoit: t.recoit, qteDonne: 0, qteRecoit: 999999 }).ok, false, 'taux de troc forgé accepté');
    egal(f.res.gold, or0, 'de l\'or a été crédité par un troc forgé');
    // Taux légitime.
    const avant = { d: f.res[t.donne], r: f.res[t.recoit] };
    ok(ordreDe(j, j.G.me, 'TROC', { donne: t.donne, recoit: t.recoit, qteDonne: t.qte, qteRecoit: t.rend }).ok, 'troc légitime refusé');
    egal(f.res[t.donne], avant.d - t.qte, 'quantité donnée incorrecte');
    egal(f.res[t.recoit], avant.r + t.rend, 'quantité reçue incorrecte');
  });

  test('TROC : sans Marché, aucun échange', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const t = j.TROCS[0];
    egal(j.possedeBatiment(j.G.me, j.BT.MARKET), false, 'le camp a déjà un Marché');
    egal(ordreDe(j, j.G.me, 'TROC', { donne: t.donne, recoit: t.recoit, qteDonne: t.qte, qteRecoit: t.rend }).ok, false, 'troc sans Marché');
  });

  test('DEMOLIR : le Centre Ville est indestructible par ordre', () => {
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    egal(ordreDe(j, j.G.me, 'DEMOLIR', { bId: tc.id }).ok, false, 'Centre Ville démoli par ordre');
    ok(j.G.buildings.some((b) => b.id === tc.id), 'le Centre Ville a disparu');
    // ...et on ne démolit pas non plus celui du voisin.
    const adverse = j.G.buildings.find((b) => b.type === j.BT.TC && !j.estLocal(b));
    if (adverse) egal(ordreDe(j, j.G.me, 'DEMOLIR', { bId: adverse.id }).ok, false, 'bâtiment adverse démoli');
  });

  test('GARNIR : capacité respectée, siège exclu', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const p = caseLibre(j, 60, 60, 1, 2);
    const tour = batir(j, j.BT.TOWER, p.tx, p.ty);
    const cap = j.BDEF[j.BT.TOWER].garrisonCap;
    const ids = [];
    for (let i = 0; i < cap + 3; i++) { const u = j.mkUnit(j.UT.ARC, tour.x, tour.y, j.G.me); j.G.units.push(u); ids.push(u.id); }
    const belier = j.mkUnit(j.UT.RAM, tour.x, tour.y, j.G.me); j.G.units.push(belier);
    j.rebuildIndex();
    const r = ordreDe(j, j.G.me, 'GARNIR', { ids, bId: tour.id });
    ok(r.ok, 'garnison refusée');
    egal(r.n, cap, `la tour a accepté ${r.n} unités pour une capacité de ${cap}`);
    const r2 = ordreDe(j, j.G.me, 'GARNIR', { ids: [belier.id], bId: tour.id });
    egal(r2.ok, false, 'un Bélier est entré en garnison');
  });

  test('ROUTE_COMMERCIALE : deux Marchés distincts, et pas celui de l\'ennemi', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const a = batir(j, j.BT.MARKET, ...Object.values(caseLibre(j, 60, 60, 2, 2)));
    const b = batir(j, j.BT.MARKET, ...Object.values(caseLibre(j, 70, 60, 2, 2)));
    egal(ordreDe(j, j.G.me, 'ROUTE_COMMERCIALE', { bId: a.id, toId: a.id }).ok, false, 'route vers soi-même');
    ok(ordreDe(j, j.G.me, 'ROUTE_COMMERCIALE', { bId: a.id, toId: b.id }).ok, 'route légitime refusée');
    ok(!!a.tradeRoute, 'route non posée');
    // Marché ennemi
    const ia = j.G.factions.ia;
    if (ia) {
      const e = batir(j, j.BT.MARKET, ...Object.values(caseLibre(j, 80, 60, 2, 2)), ia.id);
      egal(ordreDe(j, j.G.me, 'ROUTE_COMMERCIALE', { bId: a.id, toId: e.id }).ok, false, 'route commerciale vers un Marché ennemi');
    }
  });

  test('RELIQUE : un seul Moine par relique', () => {
    const j = partie(charger(), { graine: 4242 });
    const relic = (j.G.relics || [])[0];
    ok(!!relic, 'aucune relique sur la carte');
    const m1 = j.mkUnit(j.UT.MONK, relic.x, relic.y, j.G.me);
    const m2 = j.mkUnit(j.UT.MONK, relic.x, relic.y, j.G.me);
    j.G.units.push(m1, m2); j.rebuildIndex();
    ok(ordreDe(j, j.G.me, 'RELIQUE', { ids: [m1.id], relicId: relic.id }).ok, 'premier Moine refusé');
    egal(ordreDe(j, j.G.me, 'RELIQUE', { ids: [m2.id], relicId: relic.id }).ok, false, 'deux Moines sur la même relique');
  });

  test('AGE : coût prélevé une fois, pas de double file', () => {
    const j = partie(charger(), { graine: 4242 });
    const f = j.moi();
    Object.assign(f.res, { food: 0, wood: 0, stone: 0, gold: 0 });
    egal(ordreDe(j, j.G.me, 'AGE', {}).ok, false, 'montée d\'âge sans ressources');
    riche(j);
    const cout = j.AGES[1].cost.food;
    const avant = f.res.food;
    ok(ordreDe(j, j.G.me, 'AGE', {}).ok, 'montée d\'âge refusée');
    egal(f.res.food, avant - cout, 'coût de montée d\'âge incorrect');
    egal(ordreDe(j, j.G.me, 'AGE', {}).ok, false, 'deuxième montée d\'âge mise en file');
  });

  test('un villageois réaffecté quitte proprement son ancien poste', () => {
    // BUG trouvé à l'audit : quitter une ferme ou un gisement par un ORDRE
    // (au lieu de la sortie naturelle de doFarm/doGather — gisement épuisé,
    // inventaire plein) ne retirait jamais l'unité de `farmers`/`gatherers`.
    // Symptômes réels : effectif affiché faux sur une ferme, points de
    // récolteurs qui tournent pour toujours autour d'un arbre déjà quitté.
    // quitterPoste() (js/07-simulation.js) centralise ce nettoyage ; ce test
    // verrouille deux chemins représentatifs (récolte→garnison,
    // ferme→déplacement), pas les neuf ordres qui l'appellent désormais.
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    j.G.units.length = 0;

    // Récolte → garnison : le gisement doit se vider.
    const arbre = j.G.nodes.find((n) => n.type === j.RT.TREE && n.amt > 0);
    ok(!!arbre, 'aucun arbre sur la carte');
    const bucheron = j.mkUnit(j.UT.VIL, arbre.x, arbre.y, j.G.me);
    j.G.units.push(bucheron);
    ok(ordreDe(j, j.G.me, 'RECOLTE', { ids: [bucheron.id], nodeId: arbre.id }).ok, 'récolte refusée');
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    ok(arbre.gatherers.includes(bucheron.id), 'le bûcheron ne rejoint jamais son arbre');
    ok(ordreDe(j, j.G.me, 'GARNIR', { ids: [bucheron.id], bId: tc.id }).ok, 'garnison refusée');
    egal(arbre.gatherers.includes(bucheron.id), false, 'le bûcheron reste fantôme sur son ancien arbre après garnison');
    egal(bucheron.homeNode, null, 'homeNode pas nettoyé après garnison');

    // Ferme → déplacement : la ferme doit se vider.
    const ferme = j.mkBuilding(j.BT.FARM, tc.tx + 3, tc.ty, j.G.me);
    ferme.constructing = false; ferme.progress = 1;
    j.placeBuilding(ferme);
    const fermier = j.mkUnit(j.UT.VIL, ferme.x, ferme.y, j.G.me);
    j.G.units.push(fermier);
    ok(ordreDe(j, j.G.me, 'FERME', { ids: [fermier.id], bId: ferme.id }).ok, 'affectation à la ferme refusée');
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    ok(ferme.farmers.includes(fermier.id), 'le fermier ne rejoint jamais son champ');
    ok(ordreDe(j, j.G.me, 'DEPL', { ids: [fermier.id], x: ferme.x + 500, y: ferme.y }).ok, 'déplacement refusé');
    egal(ferme.farmers.includes(fermier.id), false, 'le fermier reste fantôme sur son ancienne ferme après déplacement');
    egal(fermier.homeFarm, null, 'homeFarm pas nettoyé après déplacement');
  });

  test('DEGARNIR : reprend l\'activité d\'avant garnison, ou reste idle si elle a disparu', () => {
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    j.G.units.length = 0;

    // Ferme toujours là à la sortie → le fermier y retourne.
    const ferme = batir(j, j.BT.FARM, tc.tx + 3, tc.ty);
    const fermier = j.mkUnit(j.UT.VIL, ferme.x, ferme.y, j.G.me);
    j.G.units.push(fermier); j.rebuildIndex();
    ok(ordreDe(j, j.G.me, 'FERME', { ids: [fermier.id], bId: ferme.id }).ok, 'affectation à la ferme refusée');
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    egal(fermier.state, 'farm', 'le fermier ne rejoint jamais son champ');
    ok(ordreDe(j, j.G.me, 'GARNIR', { ids: [fermier.id], bId: tc.id }).ok, 'garnison refusée');
    egalJSON(fermier.avantGarnison, { type: 'farm', id: ferme.id }, 'activité pas mémorisée à l\'entrée en garnison');
    ok(ordreDe(j, j.G.me, 'DEGARNIR', { bId: tc.id }).ok, 'sortie de garnison refusée');
    egal(fermier.state, 'farm', 'le fermier ne reprend pas sa ferme en sortant de garnison');
    egal(fermier.target, ferme.id, 'le fermier ne vise plus SA ferme en sortant de garnison');
    egal(fermier.avantGarnison, null, 'la mémoire d\'activité doit être consommée après usage');

    // Gisement épuisé PENDANT l'absence → repli sur idle, pas de plantage.
    const arbre = j.G.nodes.find((n) => n.type === j.RT.TREE && n.amt > 0);
    const bucheron = j.mkUnit(j.UT.VIL, arbre.x, arbre.y, j.G.me);
    j.G.units.push(bucheron); j.rebuildIndex();
    ok(ordreDe(j, j.G.me, 'RECOLTE', { ids: [bucheron.id], nodeId: arbre.id }).ok, 'récolte refusée');
    for (let k = 0; k < 30; k++) j.update(j.SIM_DT);
    egal(bucheron.state, 'gather', 'le bûcheron ne rejoint jamais son arbre');
    ok(ordreDe(j, j.G.me, 'GARNIR', { ids: [bucheron.id], bId: tc.id }).ok, 'garnison refusée');
    arbre.amt = 0; // épuisé pendant que le bûcheron est à l'abri
    ok(ordreDe(j, j.G.me, 'DEGARNIR', { ids: [bucheron.id], bId: tc.id }).ok, 'sortie de garnison refusée');
    egal(bucheron.state, 'idle', 'un gisement épuisé entre-temps ne doit pas être repris');
  });

  test('GARNIR : la charge en cours de dépôt est créditée, pas perdue', () => {
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    const porteur = j.mkUnit(j.UT.VIL, tc.x, tc.y, j.G.me);
    porteur.inv = 7; porteur.invT = j.RT.STONE; porteur.state = 'return';
    j.G.units.push(porteur); j.rebuildIndex();
    const avant = j.resPool(j.G.me).stone;
    ok(ordreDe(j, j.G.me, 'GARNIR', { ids: [porteur.id], bId: tc.id }).ok, 'garnison refusée');
    egal(j.resPool(j.G.me).stone, avant + 7, 'la pierre portée a disparu au lieu d\'être créditée');
    egal(porteur.inv, 0, 'inv pas remis à zéro après dépôt');
  });

  test('RECOLTE/FERME : changer de ressource en pleine charge crédite l\'ancienne', () => {
    // Même famille que le test GARNIR ci-dessus : n'importe quelle
    // réaffectation qui change le TYPE de ressource portée (pas seulement la
    // garnison) jetait l'inventaire en cours. RECOLTE est la réaffectation la
    // plus fréquente du jeu — c'était donc la fuite la plus probable de toutes.
    const j = partie(charger(), { graine: 4242 });
    const bois = j.G.nodes.find((n) => n.type === j.RT.TREE && n.amt > 0);
    const or = j.G.nodes.find((n) => n.type === j.RT.GOLD && n.amt > 0);
    ok(!!bois && !!or, 'arbre ou gisement d\'or introuvable');

    const bucheron = j.mkUnit(j.UT.VIL, bois.x, bois.y, j.G.me);
    bucheron.inv = 4; bucheron.invT = j.RT.TREE; bucheron.state = 'gather'; bucheron.target = bois.id; bucheron.homeNode = bois.id;
    j.G.units.push(bucheron); j.rebuildIndex();
    const boisAvant = j.resPool(j.G.me).wood;
    ok(ordreDe(j, j.G.me, 'RECOLTE', { ids: [bucheron.id], nodeId: or.id }).ok, 'récolte refusée');
    egal(j.resPool(j.G.me).wood, boisAvant + 4, 'le bois porté a disparu en changeant de ressource');

    const tc = j.G.buildings.find((b) => b.type === j.BT.TC);
    const ferme = batir(j, j.BT.FARM, tc.tx + 3, tc.ty);
    const mineur = j.mkUnit(j.UT.VIL, ferme.x, ferme.y, j.G.me);
    mineur.inv = 5; mineur.invT = j.RT.GOLD; mineur.state = 'gather';
    j.G.units.push(mineur); j.rebuildIndex();
    const orAvant = j.resPool(j.G.me).gold;
    ok(ordreDe(j, j.G.me, 'FERME', { ids: [mineur.id], bId: ferme.id }).ok, 'affectation à la ferme refusée');
    egal(j.resPool(j.G.me).gold, orAvant + 5, 'l\'or porté a disparu en passant à la ferme');
  });
});

// ════════════════════════════════════════════════════════════
groupe('economie', () => {
  test('la récolte crédite la caisse du BON camp', () => {
    const j = partie(charger(), { graine: 4242 });
    const ia = j.G.factions.ia;
    ok(!!ia, 'pas d\'IA en mode Conquête');
    const bois0 = { p1: j.moi().res.wood, ia: ia.res.wood };
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const arbre = j.G.nodes.filter((n) => n.type === j.RT.TREE && n.amt > 0)
      .sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0];
    for (let i = 0; i < 4; i++) {
      const u = j.mkUnit(j.UT.VIL, tc.x + 20, tc.y + 20, j.G.me);
      u.state = 'gather'; u.target = arbre.id; j.G.units.push(u); j.moi().pop++;
    }
    j.rebuildIndex();
    for (let k = 0; k < 2400; k++) j.update(j.SIM_DT);
    ok(j.moi().res.wood > bois0.p1, 'le joueur n\'a rien récolté');
    // L'IA récolte de son côté, mais JAMAIS dans la caisse du joueur : ce
    // qu'on garde ici, c'est qu'aucun camp ne se sert dans l'autre.
    ok(j.moi().res.wood - bois0.p1 > 50, 'récolte anormalement faible');
  });

  test('le re-semis d\'une ferme est facturé à SON propriétaire', () => {
    // Le commentaire de tryAutoReseed documente précisément ce piège : sans
    // owner explicite, l'hôte payait pour les champs du client.
    const j = partie(charger(), { graine: 4242 });
    const ia = j.G.factions.ia;
    riche(j, j.G.me); riche(j, ia.id);
    const p = caseLibre(j, 60, 60, 2, 2);
    const ferme = batir(j, j.BT.FARM, p.tx, p.ty, ia.id);
    ferme.foodLeft = 0;
    const boisJoueur = j.moi().res.wood, boisIA = ia.res.wood;
    j.__sandbox.tryAutoReseed(ferme);
    egal(j.moi().res.wood, boisJoueur, 'le joueur a payé le champ de l\'IA');
    egal(ia.res.wood, boisIA - j.FARM_RESEED_COST.wood, 'l\'IA n\'a pas payé son propre champ');
    egal(ferme.foodLeft, j.FARM_FOOD, 'le champ n\'a pas été re-semé');
  });

  test('Francs : le re-semis est gratuit', () => {
    const j = charger();
    j.__sandbox.selectedCiv = 'francs'; j.pickCiv('francs');
    partie(j, { graine: 4242 });
    riche(j);
    const p = caseLibre(j, 60, 60, 2, 2);
    const ferme = batir(j, j.BT.FARM, p.tx, p.ty, j.G.me);
    ferme.foodLeft = 0;
    const bois = j.moi().res.wood;
    j.__sandbox.tryAutoReseed(ferme);
    egal(j.moi().res.wood, bois, 'les Francs ont payé leur re-semis');
    egal(ferme.foodLeft, j.FARM_FOOD, 'champ non re-semé');
  });

  test('les reliques mises à l\'abri rapportent de l\'or', () => {
    const j = partie(charger(), { graine: 4242 });
    const relic = (j.G.relics || [])[0];
    relic.bankedBy = j.G.me;
    const or0 = j.moi().res.gold;
    for (let k = 0; k < 1800; k++) j.update(j.SIM_DT);   // 60 s
    ok(j.moi().res.gold > or0, 'une relique à l\'abri ne rapporte rien');
  });
});

// ════════════════════════════════════════════════════════════
groupe('ages', () => {
  test('la montée d\'âge applique ses bonus RÉTROACTIVEMENT', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const u = j.mkUnit(j.UT.MIL, tc.x, tc.y, j.G.me); j.G.units.push(u); j.rebuildIndex();
    const avant = { bat: tc.maxHp, uHp: u.maxHp, uAtk: u.atk };
    ok(ordreDe(j, j.G.me, 'AGE', {}).ok, 'montée d\'âge refusée');
    // Le minuteur doit s'écouler : sinon rien ne s'applique.
    for (let k = 0; k < 30 * 90; k++) { j.update(j.SIM_DT); if (f.age >= 1) break; }
    egal(f.age, 1, 'l\'âge n\'a pas été atteint');
    ok(tc.maxHp > avant.bat, `PV du bâtiment non relevés : ${avant.bat} → ${tc.maxHp}`);
    ok(u.maxHp > avant.uHp, `PV de l'unité déjà en jeu non relevés : ${avant.uHp} → ${u.maxHp}`);
    ok(u.atk > avant.uAtk, `ATK de l'unité déjà en jeu non relevée : ${avant.uAtk} → ${u.atk}`);
  });

  test('une unité formée APRÈS a les mêmes statistiques qu\'une unité relevée', () => {
    // C'est l'invariant qui casse le plus discrètement : mkUnit et les effets
    // rétroactifs doivent viser exactement les mêmes bonus.
    const j = partie(charger(), { graine: 4242 });
    const f = j.moi();
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const ancienne = j.mkUnit(j.UT.MIL, tc.x, tc.y, j.G.me); j.G.units.push(ancienne); j.rebuildIndex();
    riche(j);
    ok(ordreDe(j, j.G.me, 'AGE', {}).ok);
    for (let k = 0; k < 30 * 90; k++) { j.update(j.SIM_DT); if (f.age >= 1) break; }
    const nouvelle = j.mkUnit(j.UT.MIL, tc.x, tc.y, j.G.me);
    egal(ancienne.maxHp, nouvelle.maxHp, 'PV divergents entre unité relevée et unité neuve');
    egal(ancienne.atk, nouvelle.atk, 'ATK divergente entre unité relevée et unité neuve');
  });

  test('le plafond de population suit les bâtiments et l\'âge', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const avant = f.maxPop;
    const p = caseLibre(j, 60, 60, 1, 1);
    batir(j, j.BT.HOUSE, p.tx, p.ty);
    j.updatePopCap();
    egal(f.maxPop, avant + j.AGE_BONUS[f.age].housePop, 'une Maison n\'ajoute pas la bonne population');
  });
});

// ════════════════════════════════════════════════════════════
groupe('finpartie', () => {
  test('un camp sans Centre Ville est éliminé', () => {
    const j = partie(charger(), { graine: 4242 });
    const ia = j.G.factions.ia;
    egal(ia.vaincu, false, 'l\'IA démarre vaincue');
    for (const b of j.G.buildings.filter((b) => b.owner === ia.id && b.type === j.BT.TC)) b.hp = 0;
    for (let k = 0; k < 60; k++) j.update(j.SIM_DT);
    egal(ia.vaincu, true, 'un camp sans Centre Ville reste en lice');
  });

  test('Conquête : la victoire tombe quand tous les rivaux sont éliminés', () => {
    const j = partie(charger(), { graine: 4242 });
    egal(j.G.victory, false, 'victoire acquise dès le départ');
    for (const b of j.G.buildings.filter((b) => !j.estLocal(b) && b.type === j.BT.TC)) b.hp = 0;
    for (let k = 0; k < 120; k++) { j.update(j.SIM_DT); if (j.G.victory) break; }
    egal(j.G.victory, true, 'aucune victoire malgré tous les rivaux éliminés');
  });

  test('la défaite tombe quand le joueur perd son Centre Ville', () => {
    const j = partie(charger(), { graine: 4242 });
    for (const b of j.G.buildings.filter((b) => j.estLocal(b) && b.type === j.BT.TC)) b.hp = 0;
    for (let k = 0; k < 120; k++) { j.update(j.SIM_DT); if (j.G.gameOver) break; }
    egal(j.G.gameOver, true, 'aucune défaite malgré la perte du Centre Ville');
  });

  test('Merveille : victoire seulement APRÈS le délai, et pas avant', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi(); f.age = 3;
    const p = caseLibre(j, 60, 60, 3, 3);
    batir(j, j.BT.WONDER, p.tx, p.ty);
    // À peine achevée : rien ne doit se produire.
    for (let k = 0; k < 300; k++) j.update(j.SIM_DT);
    egal(j.G.victory, false, `la Merveille donne la victoire avant les ${j.MERVEILLE_WIN_TIME} s réglementaires`);
    // Puis on laisse filer le compte à rebours.
    for (let k = 0; k < 30 * (j.MERVEILLE_WIN_TIME + 20); k++) { j.update(j.SIM_DT); if (j.G.victory) break; }
    egal(j.G.victory, true, 'la Merveille achevée et tenue ne donne pas la victoire');
  });
});

// ════════════════════════════════════════════════════════════
groupe('ia', () => {
  test('les Moines de l\'IA sont plafonnés au nombre de reliques', () => {
    // On teste la RÈGLE, pas son apparition au bout d'un quart d'heure. La
    // première version simulait 15 minutes puis vérifiait `monks <=
    // RELIC_COUNT` : elle passait À VIDE, parce que l'IA n'a en fait produit
    // aucun Moine sur cette durée (0 <= 5 est vrai). Un test qui ne peut pas
    // échouer ne garde rien.
    const monter = (nMoines) => {
      const j = partie(charger(), { graine: 4242 });
      const a = j.G.factions.ia;
      riche(j, a.id);
      a.maxPop = 200;
      a.vilTarget = 1;                                  // l'IA ne cherche plus de villageois
      const p = caseLibre(j, Math.round(a.baseX / j.BASE_TILE) + 4, Math.round(a.baseY / j.BASE_TILE) + 4, 1, 2);
      const mo = batir(j, j.BT.MONASTERY, p.tx, p.ty, a.id);
      for (let i = 0; i < nMoines; i++) j.G.units.push(j.mkUnit(j.UT.MONK, a.baseX, a.baseY, a.id));
      j.rebuildIndex();
      // Plusieurs tics de décision : `a.think` ne laisse passer la boucle de
      // production qu'une fois par AI_THINK.
      for (let k = 0; k < 40; k++) { a.think = 0; j.updateUneIA(0.5, a); }
      return mo.trainQ.filter((t) => t === j.UT.MONK).length;
    };
    const cap = charger().RELIC_COUNT;
    ok(monter(0) > 0, "l'IA ne met aucun Moine en file quand elle n'en a aucun : le test ne prouverait rien");
    egal(monter(cap), 0, `l'IA met encore des Moines en file alors qu'elle en a déjà ${cap} (une par relique)`);
  });

  test('l\'IA sait produire du siège, et seulement à partir de l\'Âge des Châteaux', () => {
    const j = partie(charger(), { graine: 4242 });
    ok(!!j.AI_TRAINERS[j.BT.SIEGE], 'l\'IA n\'a aucun bâtiment de siège dans son roster');
    ok(j.AI_TRAINERS[j.BT.SIEGE].includes(j.UT.RAM), 'l\'Atelier de siège de l\'IA ne produit pas de Bélier');
    // L'atelier doit apparaître dans son plan de construction à l'âge 2.
    const a = j.G.factions.ia;
    a.age = 2;
    const vus = new Set();
    for (let i = 0; i < 40; i++) {
      const n = j.aiNextBuild(30, a);
      if (!n) break;
      vus.add(n.type);
      // On simule sa construction pour passer au suivant.
      const p = caseLibre(j, Math.round(a.baseX / j.BASE_TILE), Math.round(a.baseY / j.BASE_TILE), j.BDEF[n.type].w, j.BDEF[n.type].h);
      if (!p) break;
      batir(j, n.type, p.tx, p.ty, a.id);
    }
    ok(vus.has(j.BT.SIEGE), 'l\'Atelier de siège n\'apparaît jamais dans le plan de construction de l\'IA');
  });

  // ══ « L'IA JOUE AUX MÊMES RÈGLES » ═══════════════════════════
  // Le mode Conquête annonce un rival qui joue avec les mêmes règles que le
  // joueur. Cinq écarts le démentaient, tous dans le même sens. Ces tests
  // verrouillent chacun d'eux : aucun n'était attrapé par la suite d'avant.

  test("la Merveille adverse passe avant toute autre cible de bâtiment", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    // Un assaillant de l'IA, une Ferme du joueur COLLÉE à lui, une Merveille
    // du joueur à vingt tuiles. Avant le correctif, la Merveille valait 0,5 et
    // la Ferme 3 : l'IA allait raser la grange pendant que le compte à rebours
    // de victoire adverse tournait.
    const bx = Math.round(a.baseX / j.BASE_TILE), by = Math.round(a.baseY / j.BASE_TILE);
    const pf = caseLibre(j, bx + 2, by, 2, 2);
    batir(j, j.BT.FARM, pf.tx, pf.ty, j.G.me);
    const pw = caseLibre(j, bx + 20, by, 3, 3);
    batir(j, j.BT.WONDER, pw.tx, pw.ty, j.G.me);
    const src = j.mkUnit(j.UT.ENEMI, a.baseX, a.baseY, a.id);
    j.rebuildIndex();
    const cible = j.nearPlayerBuildingSmart(src.x, src.y, src);
    egal(cible.type, j.BT.WONDER,
      "l'IA vise " + j.BDEF[cible.type].nom + " au lieu de la Merveille, qui gagne la partie en 5 min");
  });

  test("la Merveille achevée prime, le CHANTIER de Merveille non", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    const bx = Math.round(a.baseX / j.BASE_TILE), by = Math.round(a.baseY / j.BASE_TILE);
    const pw = caseLibre(j, bx + 20, by, 3, 3);
    const w = j.mkBuilding(j.BT.WONDER, pw.tx, pw.ty, j.G.me);
    w.constructing = true; w.progress = 0.5;
    j.placeBuilding(w); j.rebuildIndex();
    const src = j.mkUnit(j.UT.ENEMI, a.baseX, a.baseY, a.id);
    j.rebuildIndex();
    // Un chantier n'est pas encore un compte à rebours : l'urgence ne doit pas
    // se déclencher, sinon toute Merveille posée servirait d'appât.
    ok(!j.cibleMerveille(src), "un CHANTIER de Merveille déclenche déjà l'urgence : trop tôt");
    w.constructing = false; w.progress = 1;
    const m = j.cibleMerveille(src);
    ok(!!m, "la Merveille achevée n'est pas repérée comme urgence");
    egal(m.id, w.id, 'mauvaise Merveille repérée');
    // Et elle est bien classée hostile : une Merveille à SOI ne doit rien
    // déclencher du tout.
    const sien = j.mkUnit(j.UT.VIL, a.baseX, a.baseY, j.G.me);
    j.rebuildIndex();
    ok(!j.cibleMerveille(sien), "le joueur se rue sur sa PROPRE Merveille");
  });

  test("une Merveille adverse fait lâcher le rassemblement à l'IA", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    const army = [];
    for (let i = 0; i < 6; i++) army.push(j.mkUnit(j.UT.ENEMI, a.baseX, a.baseY, a.id));
    j.rebuildIndex();
    // Armée postée en rassemblement : dans cet état elle n'engage QUE les
    // intrus de son rayon de garde et ne verrait jamais une Merveille à
    // l'autre bout de la carte. C'est pourquoi le ciblage individuel ne suffit
    // pas et que la machine à phases doit la lâcher.
    // Point de ralliement VOLONTAIREMENT loin des unités, et objectif encore
    // au-delà : sans ça le quorum est atteint d'emblée (tout le monde est déjà
    // sur place) et l'IA lance son assaut — elle a raison, mais le test ne
    // vérifie alors plus rien.
    a.phase = 'rassemble'; a.phaseT = j.G.gameTime;
    a.rallyX = a.baseX + j.BASE_TILE * 20; a.rallyY = a.baseY;
    a.cibleX = a.baseX + j.BASE_TILE * 40; a.cibleY = a.baseY;
    for (const u of army) { u.camp = a.id; u.campX = a.rallyX; u.campY = a.rallyY; }
    j.majPhaseAssaut(0.5, a, army);
    egal(a.phase, 'rassemble', "l'IA quitte son rassemblement sans raison");
    const bx = Math.round(a.baseX / j.BASE_TILE), by = Math.round(a.baseY / j.BASE_TILE);
    const pw = caseLibre(j, bx + 24, by + 6, 3, 3);
    batir(j, j.BT.WONDER, pw.tx, pw.ty, j.G.me);
    j.majPhaseAssaut(0.5, a, army);
    egal(a.phase, 'merveille', "l'IA reste en rassemblement face à une Merveille achevée");
    egal(army.filter((u) => u.camp != null).length, 0,
      'des unités restent postées en garde alors que le sablier adverse tourne');
  });

  test("l'IA répare ses bâtiments, sans y jeter toute sa main-d'œuvre", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    const tc = j.bldById(a.tcId);
    const vils = [];
    for (let i = 0; i < 10; i++) vils.push(j.mkUnit(j.UT.VIL, a.baseX, a.baseY, a.id));
    j.rebuildIndex();
    j.aiRepare(vils, a);
    egal(vils.filter((u) => u.state === 'repair').length, 0,
      "l'IA détourne des villageois sur un bâtiment intact");
    tc.hp = tc.maxHp * 0.4;
    j.aiRepare(vils, a);
    const n1 = vils.filter((u) => u.state === 'repair').length;
    ok(n1 > 0, "l'IA ne répare pas son Centre Ville tombé à 40 % de PV");
    ok(n1 <= j.AI_REPAIR_MAX, "l'IA a détourné " + n1 + " villageois, plafond " + j.AI_REPAIR_MAX);
    // Rappels successifs : les déjà-affectés comptent dans le plafond, sinon
    // toute la main-d'œuvre finit sur le chantier en quelques secondes.
    for (let k = 0; k < 5; k++) j.aiRepare(vils, a);
    const n2 = vils.filter((u) => u.state === 'repair').length;
    ok(n2 <= j.AI_REPAIR_MAX, "après rappels, " + n2 + " réparateurs pour un plafond de " + j.AI_REPAIR_MAX);
  });

  test("l'IA forme l'unité unique de SA civilisation, et seulement la sienne", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    const attendu = { byzantins: j.UT.CATA, mongols: j.UT.CAVARC, chinois: j.UT.ARBRAP };
    for (const civ of Object.keys(attendu)) {
      a.civ = civ;
      a.age = 1;
      egal(j.aiUniteUnique(a), null, civ + " : l'unité unique sort avant l'Âge des Châteaux");
      a.age = 2;
      egal(j.aiUniteUnique(a), attendu[civ], civ + ' : mauvaise unité unique (ou aucune)');
    }
    a.civ = 'francs'; a.age = 3;
    egal(j.aiUniteUnique(a), null, "les Francs reçoivent une unité unique qu'ils n'ont pas");
    // Et son coût est celui du joueur, pas un tarif inventé pour l'IA.
    egalJSON(j.aiCout(j.UT.CATA), j.TCOST[j.UT.CATA],
      'le Cataphractaire ne coûte pas le même prix selon le camp qui le forme');
  });

  test("l'IA bâtit un Immeuble quand il manque beaucoup de places d'un coup", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    riche(j, a.id);
    a.age = 1;
    a.pop = 2; a.maxPop = 20;
    egal(j.aiLogement(a).type, j.BT.HOUSE, "l'IA sort l'Immeuble pour deux places manquantes");
    a.pop = 60; a.maxPop = 60;
    egal(j.aiLogement(a).type, j.BT.HLM, "l'IA enchaîne encore les Maisons à soixante places manquantes");
    // ...mais jamais à crédit : sans la pierre, on retombe sur la Maison.
    a.res.stone = 0;
    egal(j.aiLogement(a).type, j.BT.HOUSE, "l'IA vise un Immeuble qu'elle ne peut pas payer");
  });

  test("l'IA troque au Marché pour se débloquer, et seulement là", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    // Noyée sous le bois, à sec d'or : exactement le blocage que le Marché
    // existe pour dénouer, et que l'IA subissait sans jamais s'en servir.
    const surplus = () => { a.res.wood = 9000; a.res.food = 300; a.res.stone = 200; a.res.gold = 0; };
    surplus();
    j.aiTroquer(a);
    egal(a.res.gold, 0, "l'IA troque sans Marché debout");
    const bx = Math.round(a.baseX / j.BASE_TILE), by = Math.round(a.baseY / j.BASE_TILE);
    const pm = caseLibre(j, bx + 3, by + 3, j.BDEF[j.BT.MARKET].w, j.BDEF[j.BT.MARKET].h);
    batir(j, j.BT.MARKET, pm.tx, pm.ty, a.id);
    surplus();
    j.aiTroquer(a);
    ok(a.res.gold > 0, "Marché debout, bois à 9000, or à 0 : l'IA ne troque toujours pas");
    ok(a.res.wood < 9000, "l'IA reçoit de l'or sans rien donner en échange");
    // Économie équilibrée : on ne brûle rien au mauvais taux.
    a.res.wood = 1000; a.res.food = 1000; a.res.stone = 1000; a.res.gold = 1000;
    const avant = JSON.stringify(a.res);
    j.aiTroquer(a);
    egal(JSON.stringify(a.res), avant, "l'IA troque alors que rien ne la bloque");
  });

  test("l'IA s'installe sur l'eau quand il y a du poisson à pêcher", () => {
    const plan = (j, f) => {
      const vus = new Set();
      for (let i = 0; i < 40; i++) {
        const b = j.aiNextBuild(30, f); if (!b) break; vus.add(b.type);
        const p = caseLibre(j, Math.round(f.baseX / j.BASE_TILE), Math.round(f.baseY / j.BASE_TILE),
          j.BDEF[b.type].w, j.BDEF[b.type].h);
        if (!p) break;
        batir(j, b.type, p.tx, p.ty, f.id);
      }
      return vus;
    };
    const j = partie(charger(), { graine: 4242 });
    ok(!!j.AI_TRAINERS[j.BT.DOCK], 'le Quai ne produit rien dans le roster de l’IA');
    ok(j.AI_TRAINERS[j.BT.DOCK].includes(j.UT.BOAT), 'le Quai de l’IA ne forme pas de Barque');
    // Sans banc à portée, le Quai ne doit JAMAIS entrer au plan : sur une
    // carte sèche ce serait cent bois jetés.
    const a = j.G.factions.ia;
    riche(j, a.id);
    j.G.nodes = j.G.nodes.filter((n) => n.type !== j.RT.FISH);
    j.rebuildIndex();
    ok(!plan(j, a).has(j.BT.DOCK), "l'IA bâtit un Quai sur une carte sans poisson");
    // Un banc à six tuiles de la base, et il entre au plan.
    const j2 = partie(charger(), { graine: 4242 });
    const a2 = j2.G.factions.ia;
    riche(j2, a2.id);
    j2.G.nodes.push({ id: j2.G.nid++, type: j2.RT.FISH, tx: 0, ty: 0,
      x: a2.baseX + j2.BASE_TILE * 6, y: a2.baseY, amt: 500, max: 500, gatherers: [] });
    j2.rebuildIndex();
    ok(plan(j2, a2).has(j2.BT.DOCK), "un banc de poisson à six tuiles de la base, et l'IA n'y pense pas");
  });

  test('l\'assaut passe par un rassemblement avant de partir', () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    const phases = [];
    for (let k = 0; k < 30 * 900; k++) {
      j.update(j.SIM_DT);
      if (phases[phases.length - 1] !== a.phase) phases.push(a.phase);
      if (phases.filter((p) => p === 'assaut').length >= 1) break;
    }
    const i = phases.indexOf('assaut');
    ok(i > 0, 'aucun assaut lancé en 15 minutes');
    egal(phases[i - 1], 'rassemble', `l'assaut n'a pas été précédé d'un rassemblement : ${JSON.stringify(phases)}`);
  });
});

// ════════════════════════════════════════════════════════════
// LE delta est la partie la plus fragile du jeu : il est différentiel, filtré
// par le brouillard, et une divergence n'apparaît qu'en partie en ligne, chez
// l'invité, plusieurs minutes après la cause. Le groupe `reseau` ne couvrait
// que le SNAPSHOT — l'envoi initial — c'est-à-dire le cas facile.
groupe('delta', () => {
  // Monte une paire hôte/client réellement reliée : même graine, SNAP initial,
  // puis flux de deltas. Le client ne simule JAMAIS (architecture hôte
  // autoritaire) : tout ce qu'il sait vient du réseau.
  function paireEnLigne({ graine = 4242, vueTotale = true } = {}) {
    const hote = charger();
    hote.RESEAU.actif = true; hote.RESEAU.role = 'hote';
    hote.RESEAU.adversaire = { id: hote.FAC.P2, nom: 'Invité' };
    hote.RESEAU.tick = 0;
    partie(hote, { graine });            // initState voit RESEAU.actif → crée P2
    ok(!!hote.G.factions[hote.FAC.P2], 'la faction invitée n\'a pas été créée');

    // Vision complète pour l'invité : on teste alors la CONVERGENCE du delta,
    // pas le filtrage par brouillard (qui a son propre test). À RÉAPPLIQUER
    // avant chaque delta : `revealFog()` tourne dans update() et recalcule le
    // brouillard de chaque faction à partir de ses seules unités — une vision
    // posée une fois est effacée au pas suivant.
    hote.voirTout = () => {
      const p2 = hote.G.factions[hote.FAC.P2];
      for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) p2.fog[y][x] = 2;
    };
    if (vueTotale) hote.voirTout();

    const client = charger();
    // Le client est monté avec LES MÊMES factions que l'hôte avant de générer
    // sa carte — c'est ce que fait demarrerPartieClient (il applique m.fac
    // AVANT genMap). Ce n'est pas un détail de mise en scène : depuis que les
    // départs humains se répartissent sur un anneau (voir departsHumains), la
    // carte réserve la place de CHAQUE base, donc le nombre de factions
    // humaines présentes à la génération fait partie de ce qui doit être
    // identique des deux côtés. Un client monté en solo produisait une carte
    // légèrement différente — et le gibier, régénéré depuis la graine, n'y
    // tombait pas au même endroit.
    client.RESEAU.actif = true; client.RESEAU.role = 'hote';
    client.RESEAU.adversaire = { id: client.FAC.P2, nom: 'Invité' };
    partie(client, { graine });
    client.G.me = client.FAC.P2; client.G.hote = false;
    if (vueTotale) hote.voirTout();
    client.appliquerSnap(JSON.parse(JSON.stringify(hote.construireSnap())));
    // Un « tour de réseau » : l'hôte construit, le client applique. Le passage
    // par JSON n'est pas décoratif — c'est ce que fait le transport, et il
    // attrape tout ce qui ne serait pas sérialisable.
    const pousser = () => {
      if (vueTotale) hote.voirTout();
      client.appliquerDelta(JSON.parse(JSON.stringify(hote.construireDelta())));
    };
    // Le client tourne comme un VRAI client : `updateVisuel` a chaque pas
    // (c'est ce que fait `loop()` quand estHote() est faux). Sans lui, les
    // positions recues (`_netX`/`_netY`) ne sont jamais consommees et l'etat
    // du client reste fige au SNAP — mon premier jet comparait donc un etat
    // que personne n'avait rattrape.
    const tourner = (n) => { for (let i = 0; i < n; i++) client.updateVisuel(client.SIM_DT); };
    return { hote, client, pousser, tourner };
  }

  // Le client ne connaît que ce que l'hôte lui a envoyé : on ne compare donc
  // que les entités présentes des DEUX côtés, en signalant les manquantes.
  const etatUnites = (j) => new Map(j.G.units.filter((u) => u.hp > 0)
    .map((u) => [u.id, [u.type, u.owner, Math.round(u.x), Math.round(u.y), u.hp, u.maxHp, u.state]]));
  const etatBatiments = (j) => new Map(j.G.buildings
    .map((b) => [b.id, [b.type, b.owner, b.hp, b.maxHp, +b.progress.toFixed(3), !!b.constructing, b.foodLeft, b.level, !!b.open]]));

  test('convergence : après 60 s de jeu et un flux de deltas, le client voit l\'état de l\'hôte', () => {
    const { hote, client, pousser, tourner } = paireEnLigne();
    // 60 s de jeu, un delta tous les 10 pas (~3 Hz) — le jeu en emet 10 Hz.
    for (let k = 0; k < 1800; k++) {
      hote.update(hote.SIM_DT);
      tourner(1);
      if (k % 10 === 9) pousser();
    }
    // Laisse l'interpolation se poser : elle rattrape a 14 %/s, on ne compare
    // donc pas la position au pixel pres (voir plus bas, TOLERANCE_POS).
    tourner(90);
    const H = etatUnites(hote), C = etatUnites(client);
    const manquantes = [...H.keys()].filter((id) => !C.has(id));
    egal(manquantes.length, 0, `${manquantes.length} unité(s) de l'hôte absentes chez le client`);
    const enTrop = [...C.keys()].filter((id) => !H.has(id));
    egal(enTrop.length, 0, `${enTrop.length} unité(s) fantômes chez le client (retrait non propagé)`);
    // Position : tolerance assumee. Le client LISSE ce qu'il recoit
    // (`updateVisuel` rattrape 14 %/s vers `_netX`/`_netY`) et l'hote ne
    // renvoie pas un deplacement inferieur a SEUIL_POS. Exiger l'egalite au
    // pixel testerait le lissage, pas la synchronisation.
    const TOLERANCE_POS = 12;   // unites-monde, soit moins d'un tiers de tuile
    const divergentes = [];
    for (const id of H.keys()) {
      const h = H.get(id), c = C.get(id);
      const memeReste = JSON.stringify([h[0], h[1], h[4], h[5], h[6]]) === JSON.stringify([c[0], c[1], c[4], c[5], c[6]]);
      const ecart = Math.hypot(h[2] - c[2], h[3] - c[3]);
      if (!memeReste || ecart > TOLERANCE_POS) divergentes.push([id, h, c, Math.round(ecart)]);
    }
    if (divergentes.length) {
      const [id, h, c, e] = divergentes[0];
      throw new Error(`${divergentes.length} unite(s) divergentes — ex. #${id} hote ${JSON.stringify(h)} vs client ${JSON.stringify(c)} (ecart ${e})`);
    }
    const HB = etatBatiments(hote), CB = etatBatiments(client);
    const bDiv = [...HB.keys()].filter((id) => JSON.stringify(HB.get(id)) !== JSON.stringify(CB.get(id)));
    if (bDiv.length) {
      const id = bDiv[0];
      throw new Error(`${bDiv.length} bâtiment(s) divergents — ex. #${id} hôte ${JSON.stringify(HB.get(id))} vs client ${JSON.stringify(CB.get(id))}`);
    }
  });

  test('convergence SOUS LE FEU : 80 unités qui se battent et qui meurent', () => {
    // La partie calme ne prouve pas grand-chose : c'est en bataille que les
    // désyncs apparaissent — retraits en rafale, PV qui changent à chaque
    // pas, cibles qui tournent, projectiles. On force donc un vrai combat.
    const { hote, client, pousser, tourner } = paireEnLigne();
    const p1 = hote.FAC.P1, ia = hote.G.factions.ia;
    const cx = hote.COLS * hote.BASE_TILE / 2, cy = hote.ROWS * hote.BASE_TILE / 2;
    for (let i = 0; i < 40; i++) {
      hote.G.units.push(hote.mkUnit(i % 3 ? hote.UT.MIL : hote.UT.ARC, cx - 120 + (i % 8) * 16, cy - 80 + ((i / 8) | 0) * 16, p1));
      hote.G.units.push(hote.mkUnit(i % 3 ? hote.UT.ENEMI : hote.UT.ENEMIA, cx + 120 + (i % 8) * 16, cy - 80 + ((i / 8) | 0) * 16, ia.id));
    }
    hote.rebuildIndex();
    const depart = hote.G.units.length;
    for (let k = 0; k < 2400; k++) {
      hote.update(hote.SIM_DT);
      tourner(1);
      if (k % 10 === 9) pousser();
    }
    tourner(90);
    ok(hote.G.units.length < depart - 20, `trop peu de pertes (${depart} → ${hote.G.units.length}) : le combat n'a pas eu lieu`);
    const H = etatUnites(hote), C = etatUnites(client);
    egal([...H.keys()].filter((id) => !C.has(id)).length, 0, 'des unités de l\'hôte manquent chez le client');
    egal([...C.keys()].filter((id) => !H.has(id)).length, 0, 'des unités mortes subsistent chez le client');
    const pires = [];
    for (const id of H.keys()) {
      const h = H.get(id), c = C.get(id);
      if (h[4] !== c[4] || h[5] !== c[5]) pires.push(`#${id} PV ${h[4]}/${h[5]} vs ${c[4]}/${c[5]}`);
    }
    egal(pires.length, 0, `PV divergents après bataille : ${pires.slice(0, 3).join(', ')}`);
  });

  test('convergence : les gisements entamés, les reliques et le gibier suivent', () => {
    const { hote, client, pousser, tourner } = paireEnLigne();
    for (let k = 0; k < 2400; k++) {
      hote.update(hote.SIM_DT);
      tourner(1);
      if (k % 10 === 9) pousser();
    }
    const entames = hote.G.nodes.filter((n) => n.amt !== n.max);
    ok(entames.length > 0, 'aucun gisement entamé en 80 s : le test ne prouverait rien');
    for (const n of entames) {
      const c = client.G.nodes.find((x) => x.id === n.id);
      egal(c && c.amt, n.amt, `gisement #${n.id} désynchronisé`);
    }
    egal((client.G.wildlife || []).length, (hote.G.wildlife || []).length, 'gibier abattu non retiré chez le client');
  });

  test('M_MAXHP : un maxHp relevé RÉTROACTIVEMENT arrive bien chez le client', () => {
    // Invariant n°6 du protocole : les recherches et les montées d'âge
    // changent le maxHp d'unités DÉJÀ en jeu. Sans son bit dans le masque, le
    // client garde celui du jour de leur création.
    const { hote, client, pousser } = paireEnLigne();
    const f = hote.G.factions[hote.FAC.P1];
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    const u = hote.mkUnit(hote.UT.MIL, tc.x, tc.y, hote.FAC.P1);
    hote.G.units.push(u); hote.rebuildIndex();
    // Premier delta : le client découvre l'unité.
    pousser();
    const avant = client.G.units.find((x) => x.id === u.id);
    ok(!!avant, 'l\'unité neuve n\'est pas parvenue au client');
    egal(avant.maxHp, u.maxHp, 'maxHp initial déjà divergent');
    // Montée d'âge : maxHp relevé rétroactivement côté hôte.
    riche(hote, hote.FAC.P1);
    ok(ordreDe(hote, hote.FAC.P1, 'AGE', {}).ok, 'montée d\'âge refusée');
    for (let k = 0; k < 30 * 90; k++) { hote.update(hote.SIM_DT); if (f.age >= 1) break; }
    egal(f.age, 1, 'âge non atteint');
    ok(u.maxHp > avant.maxHp, 'le maxHp de l\'hôte n\'a pas bougé : le test ne prouverait rien');
    pousser();
    egal(client.G.units.find((x) => x.id === u.id).maxHp, u.maxHp, 'maxHp non propagé (bit M_MAXHP manquant ?)');
  });

  test('M_ATK : un atk relevé RÉTROACTIVEMENT arrive lui aussi chez le client', () => {
    // Jumeau exact du test précédent. La montée d'âge recalcule maxHp ET atk
    // des unités déjà en jeu (voir la boucle AGE_BONUS dans montéeDÂge) :
    // maxHp avait son bit, atk n'en avait pas, et le panneau de sélection du
    // client affichait donc l'ATK du jour de la création jusqu'à la fin de la
    // partie.
    const { hote, client, pousser } = paireEnLigne();
    const f = hote.G.factions[hote.FAC.P1];
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    const u = hote.mkUnit(hote.UT.MIL, tc.x, tc.y, hote.FAC.P1);
    hote.G.units.push(u); hote.rebuildIndex();
    pousser();
    const avant = client.G.units.find((x) => x.id === u.id);
    ok(!!avant, 'l\'unité neuve n\'est pas parvenue au client');
    egal(avant.atk, u.atk, 'atk initial déjà divergent');
    riche(hote, hote.FAC.P1);
    ok(ordreDe(hote, hote.FAC.P1, 'AGE', {}).ok, 'montée d\'âge refusée');
    for (let k = 0; k < 30 * 90; k++) { hote.update(hote.SIM_DT); if (f.age >= 1) break; }
    egal(f.age, 1, 'âge non atteint');
    ok(u.atk > avant.atk, 'l\'atk de l\'hôte n\'a pas bougé : le test ne prouverait rien');
    pousser();
    egal(client.G.units.find((x) => x.id === u.id).atk, u.atk, 'atk non propagé (bit M_ATK manquant ?)');
  });

  test('vétérance : xp, rang et atk d\'une unité promue arrivent chez le client', () => {
    // awardKillXP relève xp, rank, maxHp ET atk d'une unité DÉJÀ en jeu. Le
    // rang est visible à l'écran (insigne sous l'unité) et dans le panneau
    // (« 🎖️ Vétéran (3 victoires) ») : sans ces champs sur le fil, le client
    // ne voyait jamais promu ce que l'hôte considérait comme vétéran.
    const { hote, client, pousser } = paireEnLigne();
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    const u = hote.mkUnit(hote.UT.MIL, tc.x, tc.y, hote.FAC.P1);
    hote.G.units.push(u); hote.rebuildIndex();
    pousser();
    egal(client.G.units.find((x) => x.id === u.id).rank, 0, 'rang initial non nul');
    // Assez de victoires pour franchir le premier palier (Vétéran, 3 kills).
    const seuil = hote.RANK_THRESHOLDS[0].kills;
    for (let k = 0; k < seuil; k++) hote.awardKillXP(u.id);
    egal(u.rank, 1, 'l\'hôte n\'a pas promu l\'unité : le test ne prouverait rien');
    pousser();
    const c = client.G.units.find((x) => x.id === u.id);
    egal(c.rank, u.rank, 'rang non propagé');
    egal(c.xp, u.xp, 'xp non propagé');
    egal(c.atk, u.atk, 'atk de vétérance non propagé');
    egal(c.maxHp, u.maxHp, 'maxHp de vétérance non propagé');
  });

  test('vétérance : une unité DÉCOUVERTE déjà promue arrive avec son rang', () => {
    // Chemin distinct du précédent : ici l'unité est promue AVANT que le
    // client ne la voie, elle passe donc par serialiserUnite (newU) et non
    // par le masque de bits. Les deux chemins doivent dire la même chose.
    const { hote, client, pousser } = paireEnLigne();
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    const u = hote.mkUnit(hote.UT.MIL, tc.x, tc.y, hote.FAC.P1);
    hote.G.units.push(u); hote.rebuildIndex();
    for (let k = 0; k < hote.RANK_THRESHOLDS[0].kills; k++) hote.awardKillXP(u.id);
    egal(u.rank, 1, 'l\'hôte n\'a pas promu l\'unité');
    pousser();                                   // première découverte : newU
    const c = client.G.units.find((x) => x.id === u.id);
    ok(!!c, 'l\'unité promue n\'est pas parvenue au client');
    egal(c.rank, u.rank, 'rang absent de serialiserUnite');
    egal(c.xp, u.xp, 'xp absent de serialiserUnite');
    egal(c.atk, u.atk, 'atk absent de serialiserUnite');
  });

  test('autoTrain voyage : le client peut RÉÉTEINDRE sa production continue', () => {
    // Même famille que M_ATK, côté bâtiment. `autoTrain` n'est décidé que par
    // applyCommand, donc par l'HÔTE. Sans lui sur le fil, le `b.autoTrain` du
    // client restait false à vie : le bouton affichait « Auto OFF » en
    // permanence et renvoyait donc toujours `actif:true` — l'invité pouvait
    // allumer la production continue, jamais l'éteindre.
    const { hote, client, pousser } = paireEnLigne();
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    pousser();
    egal(client.G.buildings.find((x) => x.id === tc.id).autoTrain, false, 'autoTrain initial non éteint');
    ok(ordreDe(hote, hote.FAC.P1, 'AUTO_FORMATION', { bId: tc.id, actif: true }).ok, 'ordre refusé');
    egal(tc.autoTrain, true, 'l\'hôte n\'a pas allumé : le test ne prouverait rien');
    pousser();
    egal(client.G.buildings.find((x) => x.id === tc.id).autoTrain, true, 'autoTrain non propagé');
    ok(ordreDe(hote, hote.FAC.P1, 'AUTO_FORMATION', { bId: tc.id, actif: false }).ok, 'ordre d\'extinction refusé');
    pousser();
    egal(client.G.buildings.find((x) => x.id === tc.id).autoTrain, false, 'extinction non propagée');
  });

  test('le point de ralliement voyage', () => {
    // `rally` est posé par ORD.RALLIEMENT chez l'hôte, et dessiné à l'écran
    // (drapeau). Le client ne voyait jamais le sien.
    const { hote, client, pousser } = paireEnLigne();
    const tc = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === hote.FAC.P1);
    pousser();
    egal(client.G.buildings.find((x) => x.id === tc.id).rally, null, 'ralliement initial non nul');
    const cx = tc.x + 200, cy = tc.y + 150;
    ok(ordreDe(hote, hote.FAC.P1, 'RALLIEMENT', { bId: tc.id, x: cx, y: cy }).ok, 'ordre refusé');
    pousser();
    const r = client.G.buildings.find((x) => x.id === tc.id).rally;
    ok(!!r, 'ralliement non propagé');
    egal(Math.round(r.x), Math.round(cx), 'ralliement : x divergent');
    egal(Math.round(r.y), Math.round(cy), 'ralliement : y divergent');
  });

  test('constructing et progress voyagent : un chantier achevé ne reste pas en travaux', () => {
    // Le commentaire de construireDelta documente ce piège : déduire
    // `constructing` de `progress>=1` côté client laissait le bâtiment en
    // travaux à jamais, le dernier pas de chantier n'atteignant pas le seuil.
    const { hote, client, pousser } = paireEnLigne();
    riche(hote, hote.FAC.P1);
    const p = caseLibre(hote, 60, 60, 2, 2);
    const r = ordreDe(hote, hote.FAC.P1, 'BATIR', { type: hote.BT.BARRACKS, tx: p.tx, ty: p.ty });
    ok(r.ok, 'construction refusée');
    const b = r.b;
    pousser();
    egal(client.G.buildings.find((x) => x.id === b.id).constructing, true, 'le chantier n\'arrive pas en travaux');
    b.progress = 1; b.constructing = false;      // fin de chantier côté hôte
    pousser();
    egal(client.G.buildings.find((x) => x.id === b.id).constructing, false, 'le bâtiment reste en travaux chez le client');
  });

  test('une unité morte est retirée chez le client', () => {
    const { hote, client, pousser } = paireEnLigne();
    const u = hote.G.units.find((x) => x.owner === hote.FAC.P1);
    pousser();
    ok(client.G.units.some((x) => x.id === u.id), 'unité absente avant la mort');
    u.hp = 0;
    for (let k = 0; k < 3; k++) hote.update(hote.SIM_DT);   // updateUnits purge les morts
    pousser();
    egal(client.G.units.some((x) => x.id === u.id), false, 'unité morte encore présente chez le client');
  });

  test('brouillard : le client ne reçoit PAS ce qu\'il ne voit pas', () => {
    // Fuite d'information = triche : un invité qui lit G dans sa console
    // verrait toute la carte. Le delta doit filtrer à la source.
    const { hote, client } = paireEnLigne({ vueTotale: false });
    const p2 = hote.G.factions[hote.FAC.P2];
    for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) p2.fog[y][x] = 0;  // aveugle
    // Une unité adverse, loin de tout ce que l'invité possède.
    const ia = hote.G.factions.ia;
    const espionne = hote.mkUnit(hote.UT.MIL, ia.baseX, ia.baseY, ia.id);
    hote.G.units.push(espionne); hote.rebuildIndex();
    const d = hote.construireDelta();
    const dansNew = (d.newU || []).some((s) => s[0] === espionne.id || s.id === espionne.id || JSON.stringify(s).includes(String(espionne.id)));
    egal(dansNew, false, 'une unité hors de la vue de l\'invité lui est envoyée');
    client.appliquerDelta(JSON.parse(JSON.stringify(d)));
    egal(client.G.units.some((x) => x.id === espionne.id), false, 'l\'invité connaît une unité qu\'il ne voit pas');
  });

  test('d.fac : les champs PRIVÉS ne partent pas à un camp d\'une autre équipe', () => {
    // Invariant n°2 : `res`, `research`, files de production ne doivent
    // partir qu'aux factions de l'équipe du destinataire. Les envoyer à
    // l'adversaire, c'est lui montrer la caisse et l'arbre technologique.
    const { hote, pousser } = paireEnLigne();
    const p1 = hote.G.factions[hote.FAC.P1], p2 = hote.G.factions[hote.FAC.P2];
    ok(p1.equipe !== p2.equipe, 'les deux camps sont dans la même équipe : le test ne prouverait rien');
    pousser();
    // Changer une valeur PRIVÉE de l'hôte ne doit même pas déclencher un
    // envoi : le destinataire n'y a pas droit, donc sa vue de cette faction
    // est inchangée. (Mon assertion initiale était fausse ici : j'attendais
    // la faction dans le delta après avoir modifié son or.)
    p1.res.gold = 12345;
    egal(hote.construireDelta().fac, undefined, 'un changement privé déclenche un envoi de faction inutile');
    // Quand un champ PUBLIC bouge, la faction repart — amputée du privé.
    p1.pop += 1;
    const facs = hote.construireDelta().fac || [];
    const vueDeP1 = facs.find((f) => f.i === hote.FAC.P1);
    ok(!!vueDeP1, 'la faction de l\'hôte ne repart pas malgré un changement public');
    egal(vueDeP1.r, undefined, 'la caisse de l\'hôte est envoyée à son adversaire');
    egal(vueDeP1.rc, undefined, 'l\'arbre de recherche de l\'hôte est envoyé à son adversaire');
    egal(vueDeP1.rq, undefined, 'la file de recherche de l\'hôte est envoyée à son adversaire');
    egal(vueDeP1.q, undefined, 'la montée d\'âge en cours de l\'hôte est envoyée à son adversaire');
    // ...et le destinataire, lui, reçoit bien SA propre caisse.
    p2.pop += 1;
    const f2 = (hote.construireDelta().fac || []).find((f) => f.i === hote.FAC.P2);
    ok(!!f2 && f2.r !== undefined, 'l\'invité ne reçoit pas sa propre caisse');
  });

  test('d.fac est DIFFÉRENTIEL : un delta au repos ne réexpédie pas les factions', () => {
    // Invariant n°2 (bande passante) : cet objet pesait 2,1 Ko sur les 2,2 Ko
    // d'un delta au repos, dix fois par seconde.
    const { hote, client, pousser } = paireEnLigne();
    pousser();
    const d1 = hote.construireDelta();          // rien n'a changé entre les deux
    egal(d1.fac, undefined, 'les factions repartent alors que rien n\'a bougé');
    hote.G.factions[hote.FAC.P1].pop += 1;      // un champ PUBLIC change
    const d2 = hote.construireDelta();
    ok(Array.isArray(d2.fac) && d2.fac.length > 0, 'un changement de faction ne repart pas');
  });

  test('l EQUIPE change en cours de partie et le changement voyage', () => {
    // ORD.DIPLOMATIE fait passer une IA dans l'equipe du joueur qui s'allie a
    // elle. `equipe` n'etait pose qu'a la CREATION de la faction cote client :
    // il gardait donc l'equipe du debut, et son estHostile() repondait
    // l'INVERSE de celui de l'hote — l'allie restait rouge, ciblable, et
    // comptait encore parmi les rivaux a abattre pour gagner.
    const { hote, client, pousser, tourner } = paireEnLigne();
    const IA = hote.FAC.IA, P2 = hote.FAC.P2;
    ok(hote.G.factions[IA], 'pas de faction IA dans cette partie, le test ne mesure rien');
    egal(client.estHostile(P2, { owner: IA }), true, 'au depart l IA doit etre hostile a l invite');

    const r = hote.applyCommand({ seq: 1, f: P2, t: hote.ORD.DIPLOMATIE, cibleId: IA, action: 'proposer' });
    ok(r.ok, 'l alliance a ete refusee : ' + JSON.stringify(r));
    egal(hote.estHostile(P2, { owner: IA }), false, 'chez l hote, l allie ne doit plus etre hostile');

    for (let k = 0; k < 30; k++) { hote.update(hote.SIM_DT); if (k % 10 === 9) { pousser(); tourner(5); } }
    egal(client.G.factions[IA].equipe, hote.G.factions[IA].equipe, 'l equipe de l IA chez le client');
    egal(client.estHostile(P2, { owner: IA }), false, 'le client voit encore son allie comme un ennemi');
  });

  test('la reparation automatique revient au client qui l a demandee', () => {
    // Le client bascule le reglage, l'ordre part chez l'hote qui l'applique
    // pour de bon — mais rien ne le renvoyait. L'interface du client lit
    // G.autoRepair (un shim vers sa propre faction) : le bouton restait donc
    // eteint et la notification annoncait l'inverse de ce qui se passait.
    const { hote, client, pousser, tourner } = paireEnLigne();
    const P2 = hote.FAC.P2;
    egal(client.G.factions[P2].autoRepair, false, 'etat de depart');

    const r = hote.applyCommand({ seq: 1, f: P2, t: hote.ORD.AUTO_REPARE, actif: true });
    ok(r.ok, 'ordre refuse : ' + JSON.stringify(r));
    egal(hote.G.factions[P2].autoRepair, true, 'chez l hote');

    for (let k = 0; k < 20; k++) { hote.update(hote.SIM_DT); if (k % 10 === 9) { pousser(); tourner(5); } }
    egal(client.G.factions[P2].autoRepair, true, 'le reglage n est jamais revenu chez le client');

    // Et il doit pouvoir le RETEINDRE : un reglage qui ne voyage que dans un
    // sens laisse le client incapable de revenir en arriere.
    hote.applyCommand({ seq: 2, f: P2, t: hote.ORD.AUTO_REPARE, actif: false });
    for (let k = 0; k < 20; k++) { hote.update(hote.SIM_DT); if (k % 10 === 9) { pousser(); tourner(5); } }
    egal(client.G.factions[P2].autoRepair, false, 'l extinction n est pas revenue chez le client');
  });

  test('RECONNEXION : un client qui revient repart d un etat COMPLET', () => {
    // Recharger sa page en pleine partie est banal sur mobile. L'hote reutilise
    // alors construireSalut() puis renvoie un SNAP (voir traiterResync), et le
    // flux de deltas reprend. Ce chemin n'etait couvert par AUCUN test : les
    // autres montent leur client a la premiere image, jamais au milieu d'une
    // partie deja avancee, avec un hote dont les tables `connus*`/`dernier`
    // portent encore la session precedente.
    // Verifie a l'ecriture : reamorcer ces tables n'est PAS ce qui sauve le
    // revenant (le SNAP lui renvoie de toute facon tout ce qu'il voit) — ce
    // test garde la convergence du chemin complet, coupure comprise, pas ce
    // mecanisme-la en particulier.
    const { hote, client: premier, pousser, tourner } = paireEnLigne();

    // Session 1 : 40 s de jeu, le client suit normalement.
    for (let k = 0; k < 1200; k++) { hote.update(hote.SIM_DT); if (k % 10 === 9) pousser(); tourner(1); }
    ok(premier.G.units.length > 0, 'le premier client n a rien recu, le test ne mesure rien');

    // Coupure : l'hote continue SEUL 30 s. Il produit, il construit, des
    // unites naissent et meurent sans que le client absent en sache rien.
    for (let k = 0; k < 900; k++) hote.update(hote.SIM_DT);
    ok(hote.RESEAU.connusU.size > 0, 'l hote a perdu ses tables, le scenario ne tient plus');

    // RESYNC : un client NEUF, monte depuis le SALUT courant.
    const salut = JSON.parse(JSON.stringify(hote.construireSalut()));
    egal(salut.proto, hote.PROTO_VERSION, 'le SALUT de resync doit porter le protocole courant');
    const revenant = charger();
    revenant.RESEAU.actif = true; revenant.RESEAU.role = 'hote';
    revenant.RESEAU.adversaire = { id: revenant.FAC.P2, nom: 'Invite' };
    partie(revenant, { graine: salut.seed });
    revenant.G.me = revenant.FAC.P2; revenant.G.hote = false;
    for (const f of salut.fac) revenant.__sandbox.appliquerFaction(f);
    hote.voirTout();
    revenant.appliquerSnap(JSON.parse(JSON.stringify(hote.construireSnap())));

    // Le flux reprend : 20 s de deltas.
    for (let k = 0; k < 600; k++) {
      hote.update(hote.SIM_DT);
      if (k % 10 === 9) {
        hote.voirTout();
        revenant.appliquerDelta(JSON.parse(JSON.stringify(hote.construireDelta())));
      }
      revenant.updateVisuel(revenant.SIM_DT);
    }

    const eh = etatUnites(hote), ec = etatUnites(revenant);
    const manquantes = [...eh.keys()].filter((id) => !ec.has(id));
    const enTrop = [...ec.keys()].filter((id) => !eh.has(id));
    ok(!manquantes.length, manquantes.length + ' unite(s) que le revenant ne verra JAMAIS : ' + manquantes.slice(0, 6));
    ok(!enTrop.length, enTrop.length + ' unite(s) fantomes chez le revenant : ' + enTrop.slice(0, 6));
    const bh = etatBatiments(hote), bc = etatBatiments(revenant);
    ok(![...bh.keys()].filter((id) => !bc.has(id)).length, 'des batiments manquent au revenant');
    egalJSON(hote.G.factions[hote.FAC.P2].res, revenant.G.factions[revenant.FAC.P2].res,
      'la caisse du revenant');
  });

  test('le delta reste sérialisable et modeste au repos', () => {
    const { hote, client, pousser, tourner } = paireEnLigne();
    for (let k = 0; k < 600; k++) {
      hote.update(hote.SIM_DT);
      tourner(1);
      if (k % 10 === 9) pousser();
    }
    const d = hote.construireDelta();
    egalJSON(d, JSON.parse(JSON.stringify(d)), 'delta non sérialisable');
    const taille = JSON.stringify(d).length;
    ok(taille < 20000, `delta de ${taille} octets : la compression différentielle a-t-elle sauté ?`);
  });
});

// ════════════════════════════════════════════════════════════
// Invariants de CHARGE. Ils ne vérifient pas un résultat mais un COÛT : un
// budget de balayages, une passe qui se termine. Ce sont les seuls défauts de
// ce jeu qui ne se voient pas du tout en petite partie et qui rendent une
// grosse partie injouable — donc exactement ceux qu'un test doit garder.
groupe('charge', () => {
  test('les gardes de camp ne rebalaient pas le voisinage à chaque image', () => {
    // Le reciblage d'updateEnemyAI est censé tourner 4×/s et par unité. Sa
    // garde d'origine (`aiCd>0 && target!=null`) ne tenait QUE pour une unité
    // ayant déjà une cible : celle qui n'en trouve aucune gardait
    // `target=null` et rebalayait donc la grille à CHAQUE image. Or une partie
    // de Survie démarre avec une cinquantaine de gardes de point d'intérêt sur
    // une cinquantaine d'unités — presque toutes, donc — et toutes au repos :
    // le budget de balayage explosait dès l'écran-titre passé.
    const j = partie(charger(), { graine: 4242, mode: 'survival', pas: 30 });
    const gardes = j.G.units.filter((u) => u.camp).length;
    ok(gardes >= 20, `pas assez de gardes de camp pour mesurer (${gardes})`);
    let scans = 0;
    const orig = j.__sandbox.nearestBy;
    j.__sandbox.nearestBy = function (...a) { scans++; return orig.apply(this, a); };
    const images = 60;
    for (let k = 0; k < images; k++) j.update(j.SIM_DT);
    j.__sandbox.nearestBy = orig;
    // Cadence voulue : ~4 balayages par seconde et par unité, soit 0,13 par
    // image. Le plafond laisse 70 % de marge ; la version d'avant en faisait
    // UN PAR IMAGE et par garde, soit huit fois trop. Le budget couvre aussi
    // les TOURS de garde des points d'intérêt, qui rebalayaient elles aussi à
    // chaque image faute de reposer leur minuteur quand elles ne voient rien
    // (voir updateBuildings) — à elles seules elles doublaient le total.
    const plafond = Math.round(gardes * images * 0.2);
    ok(scans < plafond, `${scans} balayages pour ${gardes} gardes sur ${images} images (plafond ${plafond})`);
  });

  test('separerUnites survit à une population qui grossit', () => {
    // Les tampons de la grille de séparation sont réalloués dès que la
    // population dépasse leur capacité, et la LISTE des cellules occupées doit
    // repartir de zéro avec eux. Si elle survit à un tableau de têtes neuf, le
    // chaînage suivi à l'image suivante est périmé et la boucle qui le parcourt
    // ne se termine PLUS : l'onglet se fige sans la moindre erreur. Une
    // régression ici bloque donc ce fichier au lieu de l'échouer — c'est le
    // symptôme lui-même, et il vaut mieux ça que de ne pas le voir du tout.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    const B = j.BASE_TILE;
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const poser = (n, dtx) => {
      for (let i = 0; i < n; i++) j.G.units.push(j.mkUnit(j.UT.MIL, (tc.tx + dtx) * B, (tc.ty + 6) * B, j.G.me));
      j.rebuildIndex(); j.rebuildGrid();
    };
    poser(40, 6);                    // 40 unités au MÊME pixel
    j.separerUnites(j.SIM_DT);
    poser(500, 10);                  // franchit la capacité des tampons
    for (let k = 0; k < 20; k++) j.separerUnites(j.SIM_DT);
    for (const u of j.G.units) ok(Number.isFinite(u.x) && Number.isFinite(u.y), 'position non finie après séparation');
    // Le tas de départ s'est réellement défait : l'amas posé sur un seul pixel
    // s'étale maintenant sur plus d'une tuile.
    const tas = j.G.units.filter((u) => u.type === j.UT.MIL && Math.abs(u.y - (tc.ty + 6) * B) < 6 * B);
    const largeur = Math.max(...tas.map((u) => u.x)) - Math.min(...tas.map((u) => u.x));
    ok(largeur > B, `l'amas ne s'est pas étalé (${largeur.toFixed(1)} px)`);
  });

  test('nearestBy ecarte par la DISTANCE avant d appeler le predicat', () => {
    // forNearby balaie un CARRE de cellules : ses coins tombent hors du rayon,
    // et `bd` retrecit des qu'un candidat est retenu. Appeler le predicat sur
    // ces perdants d'avance, c'est remonter a la faction (estHostile) pour
    // rien -- et ce ciblage tourne pour CHAQUE unite, 4 fois par seconde. Le
    // test compte les appels au predicat, pas le resultat : c'est un invariant
    // de COUT, invisible autrement.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    const B = j.BASE_TILE;
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const cx = (tc.tx + 10) * B, cy = (tc.ty + 10) * B;
    // Un amas serre au centre, puis un chapelet qui s'eloigne bien au-dela du
    // rayon : les lointaines ne doivent JAMAIS atteindre le predicat.
    for (let i = 0; i < 30; i++) j.G.units.push(j.mkUnit(j.UT.MIL, cx + (i % 6) * 4, cy + ((i / 6) | 0) * 4, j.G.me));
    for (let i = 0; i < 30; i++) j.G.units.push(j.mkUnit(j.UT.MIL, cx + (6 + i) * B, cy, j.G.me));
    j.rebuildIndex(); j.rebuildGrid();

    let vus = 0;
    const proche = j.nearestBy(cx, cy, 12 * B, (u) => { vus++; return u.hp > 0; });
    ok(proche, 'aucun voisin trouve, le test ne mesure rien');
    // Sans le tri par distance, le predicat voyait TOUTES les unites des
    // cellules balayees -- carre englobant compris. Avec, il n'en voit jamais
    // plus qu'il n'y en a reellement dans le disque.
    const dansRayon = j.G.units.filter((u) => Math.hypot(u.x - cx, u.y - cy) <= 12 * B).length;
    ok(vus <= dansRayon, 'le predicat a vu ' + vus + ' unites pour ' + dansRayon + ' reellement dans le rayon');
  });

  test('une recherche de chemin qui échoue RECULE au lieu de s\'acharner', () => {
    // Une recherche qui ÉCHOUE épuise tout le budget A* (1200 cases) avant de
    // conclure, là où un chemin trouvé n'en explore que quelques dizaines.
    // Elle repartait pourtant avec le même délai qu'un succès (0,6 s), donc
    // une unité réellement coincée relançait l'A* complet 100 fois par minute
    // pour toujours. Mesuré sur une partie jouée : 3 257 recherches en 60 s,
    // ZÉRO succès, cible à 2 tuiles de médiane — et un p90 d'image à 11,6 ms.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    const B = j.BASE_TILE;
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const u = j.mkUnit(j.UT.MIL, (tc.tx + 8) * B, (tc.ty + 8) * B, j.G.me);
    j.G.units.push(u); j.rebuildIndex();

    // But hors carte : aucun chemin ne peut exister, chaque essai échoue.
    const viserLoin = () => { u.destX = -50 * B; u.destY = -50 * B; };
    const delais = [];
    for (let i = 0; i < 4; i++) {
      // update() remet à zéro le budget de recherches par image : sans une
      // image entre deux essais, tout appel au-delà du 3e sortirait aussitôt
      // sans rien tenter, et le test ne mesurerait rien.
      j.update(j.SIM_DT);
      viserLoin(); u.pathCd = 0;
      j.__sandbox.requestPath(u);
      delais.push(u.pathCd);
    }
    for (let i = 1; i < delais.length; i++) {
      ok(delais[i] > delais[i - 1] || delais[i] >= 5,
        `le délai doit croître après un échec : ${delais.map((d) => d.toFixed(1)).join(' → ')}`);
    }
    ok(delais[delais.length - 1] >= 2,
      `après 4 échecs le délai devrait dépasser 2 s, il vaut ${delais[delais.length - 1]}`);

    // Soupape : un ordre NEUF ne doit pas hériter du recul de l'ancienne cible,
    // sinon une unité longtemps coincée resterait apathique plusieurs secondes
    // après avoir reçu une destination parfaitement praticable.
    u.destX = (tc.tx + 12) * B; u.destY = (tc.ty + 8) * B;
    j.update(j.SIM_DT); u.pathCd = 0;
    j.__sandbox.requestPath(u);
    ok((u.pathEchecs || 0) === 0 && u.pathCd <= 1,
      `un ordre neuf doit repartir sans recul (compteur ${u.pathEchecs}, délai ${u.pathCd})`);
  });
});

// ── rapport ────────────────────────────────────────────────
if (cible && !groupesConnus.includes(cible)) {
  console.log(`
  groupe inconnu : « ${cible} »`);
  console.log(`  groupes disponibles : ${groupesConnus.join(', ')}
`);
  process.exit(2);
}
const vus = resultats;
let dernier = '';
for (const r of vus) {
  if (r.groupe !== dernier) { console.log(`\n  ${r.groupe}`); dernier = r.groupe; }
  console.log(`    ${r.ok ? '✓' : '✗'} ${r.nom}  (${r.ms} ms)`);
  if (!r.ok) console.log(`        ${r.err.split('\n').join('\n        ')}`);
}
const echecs = vus.filter((r) => !r.ok).length;
console.log(`\n  ${vus.length - echecs}/${vus.length} tests passent${echecs ? ` — ${echecs} ÉCHEC(S)` : ''}\n`);
process.exit(echecs ? 1 : 0);
