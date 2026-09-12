// Harnais de test du jeu — sans navigateur, sans dépendance, sans build.
//
//   node tests/run.js            tout (200 tests, ~45 s)
//   node tests/run.js ordres     un seul groupe — lui seul TOURNE
//
// Groupes : carte, reseau, sauvegarde, chemin, combat, civilisations,
// cartes, tailles, ordres, economie, ages, finpartie, ia, delta, charge,
// triche, promesses, campagne.
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

  test('les lacs ne sont plus des carrés, et gardent leur surface', () => {
    // Chaque lac était un carré de (2r+1) cases : taux de remplissage de sa
    // boîte englobante = 100 %. Un disque ondulé tombe vers 75-80 %. On
    // exige aussi une vraie surface — la forme ne doit pas s'être payée en
    // lacs rabougris (Grands Lacs promet plus du double d'eau des Plaines,
    // voir le groupe `cartes`).
    const j = partie(charger(), { graine: 909 });
    const vu = new Uint8Array(j.COLS * j.ROWS);
    const lacs = [];
    for (let y = 0; y < j.ROWS; y++) for (let x = 0; x < j.COLS; x++) {
      if (j.G.tiles[y][x] !== j.T_WATER || vu[y * j.COLS + x]) continue;
      let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      const pile = [[x, y]]; vu[y * j.COLS + x] = 1;
      while (pile.length) {
        const [cx, cy] = pile.pop(); n++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= j.COLS || ny >= j.ROWS) continue;
          if (j.G.tiles[ny][nx] !== j.T_WATER || vu[ny * j.COLS + nx]) continue;
          vu[ny * j.COLS + nx] = 1; pile.push([nx, ny]);
        }
      }
      lacs.push({ n, rempli: n / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
    }
    ok(lacs.length >= 8, `seulement ${lacs.length} lacs`);
    for (const l of lacs) {
      ok(l.rempli < 0.9, `un lac de ${l.n} cases remplit ${Math.round(l.rempli * 100)} % de sa boîte : c'est encore un carré`);
      ok(l.rempli > 0.6, `un lac de ${l.n} cases ne remplit que ${Math.round(l.rempli * 100)} % de sa boîte : forme déchiquetée`);
    }
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
  // ══ CE QUI A DÉJÀ ÉTÉ MONTRÉ UNE FOIS ══════════════
  // `G.hints` retient les indices contextuels et les bannières plein écran
  // « une seule fois par partie ». C'est un `Set` : il ne se sérialise pas tout
  // seul en JSON, il serait parti en `{}` SANS UN MOT. Sans lui, reprendre une
  // partie rejouait tous les indices d'ouverture et une bannière par type de
  // bâtiment déjà construit — le déluge de bannières signalé en production sur
  // petit écran, que ce compteur avait justement été introduit pour éteindre.
  const notifs = (j) => (j.__sandbox.document.getElementById('notif').children || []).length;

  test('les indices d\'un `Set` survivent à la sérialisation de la sauvegarde', () => {
    const j = partie(charger());
    j.hintOnce('hero', 'un indice', '#fff');
    j.hintOnce('bannerBld:HO', 'une bannière', '#fff');
    // Le passage par JSON n'est pas décoratif : c'est LUI qui transformait
    // silencieusement le Set en `{}`.
    const d = JSON.parse(JSON.stringify(j.buildSaveData()));
    ok(Array.isArray(d.hints), `hints n'est pas un tableau après JSON : ${JSON.stringify(d.hints)}`);
    ok(d.hints.includes('hero') && d.hints.includes('bannerBld:HO'),
      `la sauvegarde a perdu les indices déjà montrés : ${JSON.stringify(d.hints)}`);
  });

  test('un indice d\'une sauvegarde reprise ne se rejoue pas, un nouveau si', () => {
    const j = partie(charger());
    j.hintOnce('hero', 'un indice', '#fff');
    const d = JSON.parse(JSON.stringify(j.buildSaveData()));
    // Ce que fait loadGame en repartant de la sauvegarde.
    j.G.hints = new Set(Array.isArray(d.hints) ? d.hints : []);
    const avant = notifs(j);
    j.hintOnce('hero', 'un indice', '#fff');
    egal(notifs(j), avant, "l'indice déjà vu s'est rejoué après la reprise");
    j.hintOnce('relic', 'un autre', '#fff');
    egal(notifs(j), avant + 1, "un indice JAMAIS vu ne s'affiche plus : le compteur bloque tout");
  });

  test('une VIEILLE sauvegarde sans le champ donne un Set vide, pas `undefined`', () => {
    const j = partie(charger());
    const d = JSON.parse(JSON.stringify(j.buildSaveData()));
    delete d.hints;                        // sauvegarde d'avant ce champ
    j.G.hints = new Set(Array.isArray(d.hints) ? d.hints : []);
    const avant = notifs(j);
    j.hintOnce('hero', 'un indice', '#fff');
    egal(notifs(j), avant + 1, 'une vieille sauvegarde devrait rejouer ses indices UNE fois');
    j.hintOnce('hero', 'un indice', '#fff');
    egal(notifs(j), avant + 1, 'et une seule : le compteur doit repartir, pas rester mort');
  });

  test('initState DÉCLARE hints : un champ qu\'on ne voit pas est un champ qu\'on oublie de sauver', () => {
    const j = partie(charger());
    // `instanceof Set` ÉCHOUE ici : le jeu tourne dans un contexte `vm`, ses
    // Set ne sont pas ceux de Node. On pose donc la question DANS le contexte.
    egal(j.lire('G.hints instanceof Set'), true, "G.hints n'est pas un Set dès la création de l'état");
    // Le vrai garde-fou : AUCUN champ de G ne doit être absent de la
    // sauvegarde sans raison. C'est ce diff qui avait repéré `hints`.
    const sauve = j.buildSaveData();
    ok('hints' in sauve, 'hints est retombé hors de buildSaveData');
  });


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

  test('les groupes de contrôle survivent à une sauvegarde', () => {
    const j = partie(charger(), { graine: 4242, pas: 30 });
    const ids = j.G.units.filter((u) => j.estLocal(u)).slice(0, 3).map((u) => u.id);
    ok(ids.length >= 2, 'pas assez d\'unités locales pour constituer un groupe');
    j.G.groupes[1] = ids.slice();
    const d = j.buildSaveData();
    ok(d.groupes, 'la sauvegarde ne contient aucun champ `groupes` : les groupes de contrôle sont perdus au rechargement');
    egalJSON(d.groupes[1], ids, 'le groupe de contrôle 1 n\'est pas celui qui était assigné');
    // Et il doit survivre à la migration, comme le reste de l'état.
    const m = j.migrerSauvegarde(JSON.parse(JSON.stringify(d)));
    ok(m.groupes, 'la migration a fait disparaître le champ `groupes`');
    egalJSON(m.groupes[1], ids, 'le groupe de contrôle 1 est perdu à la migration');
  });

  test('le compteur d\'identifiants repart au-dessus de TOUTES les entités', () => {
    // units/buildings/nodes ne sont pas les seuls à puiser dans G.nid :
    // reliques et faune aussi (voir genMap). Le recalcul doit tous les
    // couvrir, sinon une unité formée après un chargement peut porter l'id
    // d'une entité vivante — et l'index en désigner une pour l'autre.
    const j = partie(charger(), { graine: 4242, pas: 30 });
    const G = j.G;
    const toutes = [...G.units, ...G.buildings, ...G.nodes, ...(G.relics || []), ...(G.wildlife || [])];
    const maxId = Math.max(...toutes.map((e) => e.id || 0));
    // Les deux chemins de reprise (sauvegarde et réseau) recalculent nid ;
    // on vérifie la formule qu'ils appliquent, sur les mêmes collections.
    for (const [nom, fichier] of [['chargement', '13-cloud.js'], ['réseau', '12-reseau.js']]) {
      const code = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', fichier), 'utf8');
      const ligne = /G\.nid=Math\.max\(([^;]*)\)\+1;/.exec(code);
      ok(ligne, `${nom} : aucun recalcul de G.nid trouvé dans ${fichier}`);
      for (const coll of ['relics', 'wildlife', 'nodes', 'units', 'buildings']) {
        ok(ligne[1].includes(coll),
          `${nom} : le recalcul de G.nid ignore G.${coll}, qui puise pourtant dans le même compteur`);
      }
    }
    ok(maxId > 0, 'aucune entité en jeu : ce test ne prouverait rien');
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
  test('l\'éclair d\'impact d\'un bâtiment s\'éteint (il restait allumé à jamais chez l\'hôte)', () => {
    // dealDmg pose hitFlash sur toute cible, bâtiment compris, mais seule
    // la boucle des UNITÉS le faisait décroître côté hôte : invisible tant
    // que le rendu ignorait l'éclair des bâtiments, un bâtiment frappé une
    // fois aurait clignoté tout le reste de la partie dès qu'il le lit.
    const j = partie(charger(), { graine: 4242 });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    j.dealDmg(tc, 5, 'pillards');
    ok(tc.hitFlash > 0, 'dealDmg ne pose plus d\'éclair');
    for (let k = 0; k < 20; k++) j.update(j.SIM_DT);
    egal(tc.hitFlash, 0, 'éclair d\'impact du Centre Ville');
  });

  test('des textes flottants nés au même point s\'empilent au lieu de se couvrir', () => {
    // Une charge qui abat quatre pillards d'un coup faisait naître quatre
    // « +4 💰 » au même pixel.
    const j = partie(charger(), { graine: 4242 });
    j.G.ftexts.length = 0;
    for (let i = 0; i < 4; i++) j.addFText(1000, 1000, '+4 💰', '#f1c40f');
    const ys = j.G.ftexts.map((f) => Math.round(f.y));
    egal(new Set(ys).size, 4, `ordonnées confondues : ${ys.join(', ')}`);
    // Un texte loin des autres, lui, naît à sa place.
    j.addFText(2000, 1000, '-5', '#ff5544');
    egal(j.G.ftexts[4].y, 1000, 'un texte isolé a été décalé');
  });

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

  test('une unité qui se fait tirer dessus riposte, sans attendre son propre balayage', () => {
    // Avant ce correctif, le SEUL moyen pour une unité de remarquer un
    // agresseur était le balayage périodique (doIdle/doAMove), à un rayon
    // proportionnel à SA PROPRE portée — jamais à celle du tireur. Une
    // unité en 'moving' ne scannait même pas du tout. dealDmg() doit donc
    // faire riposter la cible dès le premier coup reçu, sans attendre.
    const j = partie(charger(), { graine: 4242 });
    const mk = j.__sandbox.mkFaction;
    j.G.factions.tA = mk('tA', { genre: 'neutre', equipe: 91, hostileATous: true, civ: 'francs', nom: 'Cible' });
    j.G.factions.tB = mk('tB', { genre: 'neutre', equipe: 92, hostileATous: true, civ: 'francs', nom: 'Tireur' });
    j.G.units.length = 0;
    // Chevalier en ROUTE vers un point lointain (jamais 'idle') : sans la
    // riposte, moveTo() ne scanne jamais et il encaisse sans jamais réagir.
    const cible = j.mkUnit(j.UT.KNIGHT, 0, 0, 'tA');
    cible.state = 'moving'; cible.destX = 5000; cible.destY = 0;
    j.G.units.push(cible);
    const tireur = j.mkUnit(j.UT.ARC, 6 * j.BASE_TILE, 0, 'tB');
    j.G.units.push(tireur);
    j.rebuildIndex();
    j.dealDmg(cible, 5, tireur);
    egal(cible.state, 'attack', 'la cible encaisse sans riposter');
    egal(cible.target, tireur.id, 'la cible riposte contre la mauvaise unité');
  });

  test('la riposte ne s\'applique ni aux gardes postés ni à un combat déjà engagé', () => {
    const j = partie(charger(), { graine: 4242 });
    const mk = j.__sandbox.mkFaction;
    j.G.factions.tA = mk('tA', { genre: 'neutre', equipe: 91, hostileATous: true, civ: 'francs', nom: 'Cible' });
    j.G.factions.tB = mk('tB', { genre: 'neutre', equipe: 92, hostileATous: true, civ: 'francs', nom: 'Tireur' });
    j.G.units.length = 0;
    // Gardé (camp non nul) : sa dormance jusqu'à l'approche est un choix de
    // conception (voir majPhaseAssaut/updateEnemyAI), pas un oubli d'ici.
    const garde = j.mkUnit(j.UT.PIKE, 0, 0, 'tA');
    garde.state = 'idle'; garde.camp = 'campX';
    j.G.units.push(garde);
    // Déjà engagée contre une autre cible : une flèche perdue ne doit pas
    // lui faire lâcher son adversaire du moment.
    const engagee = j.mkUnit(j.UT.PIKE, 100, 0, 'tA');
    const cibleActuelle = j.mkUnit(j.UT.MIL, 105, 0, 'tB');
    engagee.state = 'attack'; engagee.target = cibleActuelle.id;
    j.G.units.push(engagee, cibleActuelle);
    const tireur = j.mkUnit(j.UT.ARC, 200, 0, 'tB');
    j.G.units.push(tireur);
    j.rebuildIndex();
    j.dealDmg(garde, 5, tireur);
    egal(garde.state, 'idle', 'un garde posté riposte alors que sa dormance est volontaire');
    j.dealDmg(engagee, 5, tireur);
    egal(engagee.target, cibleActuelle.id, 'une flèche perdue a fait lâcher le combat en cours');
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
    // La fumée D'AMBIANCE (2026-09-08) rend maintenant fumants les bâtiments
    // HABITÉS (Centre Ville, Maison, Immeuble) même à pleine santé — les deux
    // Centre Ville déjà sur la carte (le joueur ET l'IA) en émettent
    // légitimement pendant les 10 s du test. Une Caserne, elle, n'en fait PAS
    // partie (ni popGain ni file de formation) : la question posée par CE
    // test reste « cette Caserne-ci fume-t-elle ? », pas « existe-t-il la
    // moindre particule sur toute la carte ? » — d'où le filtre de proximité.
    const pres = (b) => j.G.parts.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < j.BASE_TILE * 2);
    let vuesSain = false;
    for (let k = 0; k < 300; k++) { j.update(j.SIM_DT); if (pres(sain)) vuesSain = true; }
    ok(!vuesSain, 'une Caserne à PV pleins ne doit jamais fumer');

    const ruine = j.mkBuilding(j.BT.BARRACKS, tc.tx + 5, tc.ty + 3, j.G.me);
    ruine.constructing = false; ruine.progress = 1; ruine.hp = Math.round(ruine.maxHp * 0.2);
    j.placeBuilding(ruine);
    j.G.parts.length = 0;
    let vuesRuine = false;
    for (let k = 0; k < 300; k++) { j.update(j.SIM_DT); if (pres(ruine)) vuesRuine = true; }
    ok(vuesRuine, 'un bâtiment à 20% PV doit dégager de la fumée sur 10 s simulées');
  });
});

// ════════════════════════════════════════════════════════════
groupe('civilisations', () => {
  test('le bord détouré perd sa couronne blanche sans ronger un sujet clair', () => {
    // Toutes les illustrations passent par defrangerBord (voir
    // computeStripBgTrimmed). Deux sujets sur une image 12×12 : un carré
    // VERT dont la première rangée est délavée de blanc à 50 % (la couronne
    // que laisse la réduction d'une planche peinte sur blanc), et un carré
    // GRIS CLAIR (un mur chaulé) qui doit rester strictement intact.
    const j = charger();
    const W = 12, H = 12, d = new Uint8ClampedArray(W * H * 4), st = new Uint8Array(W * H);
    const px = (x, y, r, g, b) => { const q = (y * W + x) * 4; d[q] = r; d[q + 1] = g; d[q + 2] = b; d[q + 3] = 255; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { px(x, y, 255, 255, 255); st[y * W + x] = 2; }
    for (let y = 3; y < 9; y++) for (let x = 1; x < 6; x++) { px(x, y, 40, 110, 30); st[y * W + x] = 0; }
    for (let x = 1; x < 6; x++) px(x, 3, 148, 182, 142);   // 50 % vert + 50 % blanc
    for (let y = 3; y < 9; y++) for (let x = 7; x < 11; x++) { px(x, y, 205, 205, 200); st[y * W + x] = 0; }
    const avant = Array.from(d);
    j.defrangerBord(d, st, W, H);
    const q = (3 * W + 3) * 4;
    ok(d[q + 1] < 130 && d[q] < 70, `la couronne reste délavée : ${d[q]},${d[q + 1]},${d[q + 2]}`);
    ok(d[q + 3] > 90 && d[q + 3] < 170, `alpha de couronne attendu vers 128 : ${d[q + 3]}`);
    const c = (5 * W + 3) * 4;
    egalJSON(Array.from(d.slice(c, c + 4)), avant.slice(c, c + 4), 'le cœur du sujet a été retouché');
    for (let y = 3; y < 9; y++) for (let x = 7; x < 11; x++) {
      const m = (y * W + x) * 4;
      egalJSON(Array.from(d.slice(m, m + 4)), avant.slice(m, m + 4), `le mur clair a été rongé en ${x},${y}`);
    }
  });

  // L'invité d'une partie en ligne choisit désormais SA civilisation : elle
  // remonte du salon dans RESEAU.adversaire.civ, et l'hôte — seul à créer
  // l'état de partie — la pose sur FAC.P2. Auparavant il lui en imposait une,
  // prise juste après la sienne dans la table.
  const partieEnLigne = (civInvite) => {
    const j = charger();
    j.RESEAU.actif = true; j.RESEAU.role = 'hote';
    j.RESEAU.adversaire = { id: j.FAC.P2, nom: 'Ami', civ: civInvite };
    j.pickCiv('francs');          // l'hôte joue Francs
    j.setGraine(4242); j.pickMode('conquest');
    j.startGame();
    return j;
  };

  test('le sélecteur de civilisation existe AUSSI dans le salon, et les deux suivent', () => {
    // Choisir sa civilisation obligeait l'invité à fermer le salon, déplier
    // le résumé de configuration de l'écran-titre, choisir, puis rouvrir.
    // Le sélecteur est donc dupliqué dans la carte du salon — et pickCiv doit
    // surligner LES DEUX rangées, sinon l'écran-titre contredirait le salon.
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const j = charger();
    for (const rangee of ['civrow', 'mpcivrow']) {
      const i = html.indexOf('id="' + rangee + '"');
      ok(i > 0, `la rangée de civilisations #${rangee} est absente de index.html`);
      const bloc = html.slice(i, html.indexOf('</div>', i));
      for (const civ of Object.keys(j.CIVS)) {
        ok(bloc.includes(`data-c="${civ}"`), `#${rangee} ne propose pas ${civ}`);
      }
      ok((bloc.match(/civbtn/g) || []).length === Object.keys(j.CIVS).length,
        `#${rangee} : toutes les civilisations doivent porter la classe civbtn, sinon pickCiv en oublie`);
    }
    // pickCiv doit viser la CLASSE commune, pas une seule des deux rangées.
    const regles = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '01-regles.js'), 'utf8');
    const corps = regles.slice(regles.indexOf('function pickCiv'), regles.indexOf('function pickCiv') + 900);
    ok(/querySelectorAll\('\.civbtn'\)/.test(corps),
      'pickCiv ne met à jour qu\'une rangée : le salon et l\'écran-titre vont se contredire');
  });

  test('l\'invité joue la civilisation QU\'IL a choisie', () => {
    for (const choix of ['byzantins', 'chinois', 'mongols', 'francs']) {
      const j = partieEnLigne(choix);
      egal(j.G.factions[j.FAC.P2].civ, choix,
        `l'invité voulait ${choix} et l'hôte lui a donné autre chose`);
    }
    // Y compris la MÊME que l'hôte : c'est un choix, pas une distribution.
    const j = partieEnLigne('francs');
    egal(j.G.factions[j.FAC.P1].civ, 'francs', 'l\'hôte ne joue plus sa propre civilisation');
    egal(j.G.factions[j.FAC.P2].civ, 'francs', 'la civilisation de l\'invité a été refusée car identique à l\'hôte');
  });

  test('sans choix connu, l\'ancien repli tient toujours', () => {
    // Invité sur une version antérieure, ou salon rejoint avant qu'il n'ait
    // choisi : mieux vaut deux camps aux bonus différents qu'un camp sans civ.
    for (const absent of [null, undefined, '', 'civ_inexistante']) {
      const j = partieEnLigne(absent);
      const civP2 = j.G.factions[j.FAC.P2].civ;
      ok(j.CIVS[civP2], `repli sur une civilisation inexistante : ${civP2}`);
      ok(civP2 !== 'francs', 'le repli doit donner une civilisation différente de celle de l\'hôte');
    }
  });

  test('la civilisation de l\'invité VOYAGE jusqu\'à lui', () => {
    // L'invité ne crée pas FAC.P2 lui-même : il la reçoit dans le SALUT de
    // l'hôte. Sans le champ `cv`, il jouerait une civ et en verrait une autre.
    const j = partieEnLigne('mongols');
    const salut = j.construireSalut();
    const p2 = salut.fac.find((f) => f.i === j.FAC.P2);
    ok(p2, 'FAC.P2 absente du SALUT envoyé à l\'invité');
    egal(p2.cv, 'mongols', 'le SALUT n\'emporte pas la civilisation de l\'invité');
  });

  test('les tables de regles ne designent que des choses qui existent', () => {
    // PRODUCTION, TCOST, CIVS et BONUS se lisent partout dans le jeu, sans
    // garde. Une entree qui designe un type inexistant ne leve pas forcement —
    // elle rend `undefined`, et le defaut ressort trois ecrans plus loin : une
    // unite formable sans prix dans TCOST serait GRATUITE (applyCommand lit
    // `TCOST[type]`), une unite unique mal orthographiee rendrait la civ
    // muette. Ces tables sont ecrites a la main, donc elles derivent.
    const j = charger();
    const RES = ['food', 'wood', 'stone', 'gold'];
    const pbs = [];
    const formables = new Set();

    for (const [bt, entrees] of Object.entries(j.PRODUCTION)) {
      if (!j.BDEF[bt]) pbs.push('batiment producteur inconnu : ' + bt);
      for (const e of entrees) {
        if (!j.UDEF[e.u]) { pbs.push(bt + ' forme un type inconnu : ' + e.u); continue; }
        formables.add(e.u);
        const cost = j.TCOST[e.u];
        if (!cost) { pbs.push(bt + '/' + e.u + ' : aucun prix dans TCOST, l unite serait GRATUITE'); continue; }
        for (const [r, v] of Object.entries(cost)) {
          if (!RES.includes(r)) pbs.push(e.u + ' : ressource inconnue ' + r);
          if (!(v > 0)) pbs.push(e.u + ' : prix ' + r + '=' + v);
        }
        if (e.age != null && !(e.age >= 0 && e.age <= 3)) pbs.push(bt + '/' + e.u + ' : age hors bornes ' + e.age);
        if (e.rech && !j.RDEF[e.rech]) pbs.push(bt + '/' + e.u + ' exige une recherche inconnue : ' + e.rech);
        if (e.civ && !j.CIVS[e.civ]) pbs.push(bt + '/' + e.u + ' exige une civ inconnue : ' + e.civ);
      }
    }
    for (const u of Object.keys(j.TCOST))
      if (!formables.has(u)) pbs.push('TCOST donne un prix a ' + u + ', que AUCUN batiment ne forme');

    // Une unite unique doit exister, et n'appartenir qu'a UNE civilisation.
    const uniques = [];
    for (const [k, c] of Object.entries(j.CIVS)) {
      if (!c.nom) pbs.push(k + ' : civilisation sans nom');
      if (c.unique) {
        if (!j.UDEF[c.unique]) pbs.push(k + ' : unite unique inconnue ' + c.unique);
        if (uniques.includes(c.unique)) pbs.push('unite unique partagee par deux civs : ' + c.unique);
        uniques.push(c.unique);
        // Et elle doit etre REELLEMENT verrouillee dans PRODUCTION, sinon
        // « unique » n'est qu'une etiquette (le groupe `civilisations` teste
        // deja le refus, ici on garde la table qui le rend possible).
        const offres = Object.values(j.PRODUCTION).flat().filter((o) => o.u === c.unique);
        ok(offres.length && offres.every((o) => o.civ === k),
          c.unique + ' est annoncee unique aux ' + k + ' mais PRODUCTION ne la verrouille pas');
      }
      if (c.techCiv && !j.RDEF[c.techCiv]) pbs.push(k + ' : recherche exclusive inconnue ' + c.techCiv);
    }

    // Le triangle de contres ne doit viser que des classes declarees.
    const connues = new Set(Object.values(j.UDEF).map((d) => d.cls).filter(Boolean));
    connues.add('bat');   // les batiments, cible legitime des bonus de siege
    for (const [src, table] of Object.entries(j.BONUS || {})) {
      if (!j.UDEF[src] && !connues.has(src)) pbs.push('BONUS : source inconnue ' + src);
      for (const cible of Object.keys(table || {}))
        if (!connues.has(cible)) pbs.push('BONUS[' + src + '] vise une classe inexistante : ' + cible);
    }

    ok(!pbs.length, pbs.length + ' incoherence(s) :\n        ' + pbs.slice(0, 10).join('\n        '));
  });

  // DÉRIVÉE de CIVS, jamais recopiée : la liste était écrite en dur, si bien
  // qu'ajouter une cinquième civilisation laissait TOUS les tests de ce
  // groupe au vert sans jamais l'avoir testée — le pire des faux positifs.
  const civs = Object.keys(charger().CIVS);

  test('chaque civilisation a une identité mécanique, pas seulement un multiplicateur', () => {
    const j = charger();
    ok(civs.length >= 4, 'liste de civilisations vide ou tronquée');
    for (const c of civs) {
      const d = j.CIVS[c];
      ok(!!d, `civilisation ${c} absente`);
      ok(!!d.techCiv, `${c} n'a pas de recherche exclusive`);
      ok(!!j.RDEF[d.techCiv], `${c} : recherche ${d.techCiv} absente de RDEF`);
      egal(j.RDEF[d.techCiv].civ, c, `${c} : la recherche n'est pas filtrée sur la bonne civ`);
      ok(!!(d.nom && d.ico && d.desc), `${c} : nom, icône ou description manquants`);
      // Un héros nommé par camp : mkUnit lit HEROES[civ] avec repli SILENCIEUX
      // sur les Francs (voir js/04-entites.js). Une civ oubliée ici sortirait
      // donc Charlemagne sous son propre drapeau, sans le moindre signal.
      ok(!!(j.HEROES[c] && j.HEROES[c].nom && j.HEROES[c].ico),
        `${c} n'a pas de héros dans HEROES : il jouerait celui des Francs`);
    }
    const noms = civs.map((c) => j.HEROES[c].nom);
    egal(new Set(noms).size, noms.length, 'deux civilisations partagent le même héros');
    // Les Francs gardent le Paladin, qui est commun — c'est assumé et
    // documenté dans CIVS ; toutes les autres ont leur unité à elles.
    const uniques = civs.map((c) => j.CIVS[c].unique).filter(Boolean);
    egal(uniques.length, civs.length - 1, 'nombre d\'unités uniques');
    egal(new Set(uniques).size, uniques.length, 'deux civilisations partagent la même unité unique');
  });

  test('chaque unité unique a une icône ET un sprite qui lui est propre', () => {
    // Deux replis SILENCIEUX se cumulent sur une unité neuve :
    //   • UNIT_ICO — le bouton de formation et la file d'attente retombent
    //     sur '⭐' / '❓' (voir js/11-interface.js) ;
    //   • buildUnitSprite — sans case dédiée ni planche illustrée, une unité
    //     sort sous le corps HUMANOÏDE générique. Une Roulotte de Guerre
    //     ressemblerait à un fantassin en tunique brune.
    // Le second ne lève rien et ne se voit qu'en jouant : d'où ce test.
    const j = charger();
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '05-sprites.js'), 'utf8');
    for (const c of civs) {
      const u = j.CIVS[c].unique;
      if (!u) continue;
      ok(!!j.UNIT_ICO[u], `${c} : l'unité unique ${u} n'a pas d'icône dans UNIT_ICO`);
      const illustree = !!j.UNIT_SPRITE_FILES[u];
      // Une case dédiée dans buildUnitSprite se reconnaît au nom du type : les
      // unités non humanoïdes (Trébuchet, Bélier, Barque, Roulotte) ont chacune
      // leur draw*Sprite branché sur un booléen `is*`.
      const cle = Object.keys(j.UT).find((k) => j.UT[k] === u);
      const dediee = src.includes('type===UT.' + cle + ';') || src.includes('type===UT.' + cle + ')');
      ok(illustree || dediee,
        `${c} : ${u} n'a ni planche dans UNIT_SPRITE_FILES ni case dédiée dans buildUnitSprite — elle sortirait sous la silhouette humanoïde générique`);
    }
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

  // ── GITANOS ──────────────────────────────────────────────
  // Cinquième civilisation. Ses deux bonus ne passent PAS par les points de
  // lecture déjà couverts plus haut (gatherMult, cavHpMult, rangedAtkMult) :
  // ils touchent une boucle de simulation (routes commerciales) et la vitesse
  // d'un civil. Chacun a donc son test, sinon rien ne les tient.

  const enGitanos = (opts) => {
    const j = charger();
    j.__sandbox.selectedCiv = 'gitanos';
    j.pickCiv('gitanos');
    return partie(j, opts || { graine: 4242 });
  };

  test('Gitanos : la route commerciale rapporte réellement +50%', () => {
    // La règle vit dans updateTradeRoutes, qui tourne côté HÔTE pour les
    // marchés des DEUX camps : elle doit lire la civ du PROPRIÉTAIRE du
    // marché, pas celle du joueur local. On monte donc la même route pour un
    // camp franc et un camp gitan et on compare l'or encaissé.
    const orDUneLivraison = (civ) => {
      const j = charger();
      j.__sandbox.selectedCiv = civ; j.pickCiv(civ);
      partie(j, { graine: 4242 });
      const f = j.moi();
      const a = caseLibre(j, 40, 40, 2, 2), b = caseLibre(j, 52, 40, 2, 2);
      const m1 = batir(j, j.BT.MARKET, a.tx, a.ty), m2 = batir(j, j.BT.MARKET, b.tx, b.ty);
      const dist = Math.hypot(m2.x - m1.x, m2.y - m1.y);
      m1.tradeRoute = { toId: m2.id, dist, t: 0, dur: 1, dir: 1 };
      const avant = f.res.gold;
      // Un seul pas assez long pour déclencher exactement UNE livraison.
      j.update(1.05);
      return f.res.gold - avant;
    };
    const franc = orDUneLivraison('francs'), gitan = orDUneLivraison('gitanos');
    ok(franc > 0, 'la route commerciale ne paie rien : le test ne prouverait rien');
    // Le gain est arrondi DEUX fois (une par camp), d'où la tolérance d'un
    // point d'or plutôt qu'une égalité stricte sur franc × 1,5.
    ok(Math.abs(gitan - franc * 1.5) <= 1,
      `route gitane : ${gitan} or au lieu de ~${Math.round(franc * 1.5)} (franc : ${franc})`);
  });

  test('Gitanos : les villageois sont réellement plus rapides', () => {
    const vit = (civ) => {
      const j = charger();
      j.__sandbox.selectedCiv = civ; j.pickCiv(civ);
      partie(j, { graine: 4242 });
      return j.mkUnit(j.UT.VIL, 0, 0, j.G.me).spd;
    };
    const g = vit('gitanos'), f = vit('francs');
    ok(g > f, `villageois gitan ${g} contre franc ${f} : le bonus de vitesse n'est pas appliqué`);
    // Et il ne déborde PAS sur l'armée : c'est un bonus civil, pas un
    // +15% de vitesse pour tout le camp.
    const jg = enGitanos(), jf = charger(); jf.pickCiv('francs'); partie(jf, { graine: 4242 });
    egal(jg.mkUnit(jg.UT.MIL, 0, 0, jg.G.me).spd, jf.mkUnit(jf.UT.MIL, 0, 0, jf.G.me).spd,
      'le bonus gitan déborde sur les unités militaires');
  });

  test('Roulotte : le seul tireur qui tient la ligne, et l\'infanterie le paie', () => {
    // Sa niche tient en une phrase : elle encaisse ce qui efface un Archer,
    // mais l'infanterie qui la REJOINT la démonte. Si l'un des deux bouts
    // lâche, ce n'est plus une niche — c'est un archer lourd que rien
    // n'arrête, ou un tas de bois inutile.
    const j = enGitanos();
    const me = j.G.me;
    const roul = j.mkUnit(j.UT.ROUL, 0, 0, me);
    const arc = j.mkUnit(j.UT.ARC, 0, 0, me);
    const xbow = j.mkUnit(j.UT.XBOW, 0, 0, me);
    const pike = j.mkUnit(j.UT.PIKE, 0, 0, me);
    // Sous le trait : la Roulotte encaisse bien mieux que les tireurs.
    const surRoul = j.degatsContre(xbow, roul), surArc = j.degatsContre(xbow, arc);
    ok(surRoul < surArc, `sous le trait : ${surRoul} sur la Roulotte contre ${surArc} sur l'Archer`);
    // Et elle a la masse pour en profiter : plus de PV que les deux tireurs.
    ok(roul.maxHp > arc.maxHp * 2, `Roulotte ${roul.maxHp} PV : trop fragile pour tenir une ligne`);
    // Au corps à corps, en revanche, l'infanterie la démonte.
    ok(j.degatsContre(pike, roul) > j.degatsContre(pike, arc),
      'le Piquier ne contre pas la Roulotte : elle n\'a plus de défaut');
    // Et elle roule sur les lignes de tireurs, c'est sa raison d'être.
    ok(j.degatsContre(roul, arc) > j.degatsContre(roul, pike),
      'la Roulotte ne frappe pas plus fort les tireurs que l\'infanterie');
  });

  test('Roues Cerclées : ce que le libellé annonce est EXACTEMENT ce qui accélère', () => {
    // Famille « l'interface ne doit pas mentir ». La recherche annonce trois
    // unités nommées : ni plus (un bonus caché sur toute l'armée), ni moins
    // (une des trois oubliée dans ROUES_TYPES).
    const j = enGitanos();
    const me = j.G.me;
    const avant = {};
    for (const t of Object.keys(j.UDEF)) avant[t] = j.mkUnit(t, 0, 0, me).spd;
    j.moi().research.roues_cerclees = true;
    const accelerees = Object.keys(j.UDEF).filter((t) => j.mkUnit(t, 0, 0, me).spd > avant[t] + 1e-9);
    egalJSON(accelerees.sort(), [j.UT.ROUL, j.UT.RAM, j.UT.TREB].sort(),
      'Roues Cerclées n\'accélère pas exactement les Roulottes, Béliers et Trébuchets');
    const desc = j.RDEF.roues_cerclees.desc;
    for (const t of accelerees) {
      const mot = j.UDEF[t].nom.split(' ')[0].replace(/s$/, '');
      ok(desc.includes(mot), `le libellé « ${desc} » ne nomme pas ${j.UDEF[t].nom}, qu'il accélère pourtant`);
    }
  });

  test('aucune civilisation ne joue dans le décor d\'une autre', () => {
    // Le piège documenté dans assets/README.md : une civilisation SANS jeu
    // d'illustrations retombe SILENCIEUSEMENT sur la planche de base, c'est-
    // à-dire sur le style FRANC. Un camp gitan sortait en bourg à colombages.
    // Chaque civ non-franque doit donc avoir, pour chaque type de bâtiment,
    // soit une planche dédiée, soit une livrée (voir CIV_LIVERY).
    //
    // Et la couverture doit être TOUT ou RIEN. La livrée couvre tous les types
    // d'un coup, donc une civ qui en a une passe ce test quoi qu'il arrive :
    // si on lui retirait une seule de ses planches, la livrée reprendrait le
    // décor FRANC pour ce bâtiment-là, en silence, au milieu de vingt autres
    // correctement stylés. C'est exactement l'état intermédiaire qu'ont connu
    // les Gitanos entre leurs 19 premières planches et les 2 dernières —
    // assumé le temps d'une passe, pas un état où revenir par accident.
    const j = charger();
    const manques = [], partielles = [];
    // Ne compter que les types qui ont DÉJÀ une planche de base (francs,
    // BLD_SPRITE_FILES) : la divergence stylistique que ce test traque n'a
    // de sens que par rapport à un style de référence existant. Un type
    // tout neuf, sans planche nulle part (pas même en francs), rend le
    // MÊME sprite procédural pour toutes les civs — ce n'est pas un cas
    // « une civ dans le décor d'une autre », juste un bâtiment pas encore
    // illustré (voir BDEF[BT.HOSPICE]). Sans ce filtre, en ajouter un
    // ferait échouer ce test pour les 4 civs déjà à 100% de couverture,
    // sur un manque qui n'a rien d'une régression.
    const typesIllustres = Object.keys(j.BDEF).filter((bt) => j.BLD_SPRITE_FILES[bt]);
    for (const c of civs) {
      if (c === 'francs') continue;               // son style EST la planche de base
      const sans = typesIllustres.filter((bt) => {
        const tbl = j.BLD_CIV_SPRITE_FILES[bt];
        return !tbl || !tbl[c];
      });
      const avec = typesIllustres.length - sans.length;
      if (!sans.length) continue;                 // couverture complète
      if (avec) partielles.push(c + ' (' + avec + ' planches, ' + sans.length + ' manquantes : ' + sans.join(', ') + ')');
      else if (!j.CIV_LIVERY[c]) manques.push(c); // aucune planche ET aucune livrée
    }
    ok(!manques.length,
      'civilisation(s) sans planches NI livrée, tout leur bâti sortirait en francs : ' + manques.join(', '));
    ok(!partielles.length,
      'couverture de civilisation PARTIELLE — les bâtiments manquants sortiraient en francs sous la livrée, ' +
      'au milieu des autres correctement stylés :\n        ' + partielles.join('\n        '));
  });

  test('toute planche nommée dans le code existe vraiment sur le disque', () => {
    // Le repli des illustrations est SILENCIEUX par construction : un fichier
    // introuvable ne lève rien, ne trace rien, et le sprite procédural reste
    // affiché (voir withIllustration). Une faute de frappe dans un nom de
    // planche est donc invisible jusqu'à ce qu'on remarque, en jouant, qu'un
    // bâtiment n'a pas changé d'aspect — c'est le défaut que assets/README.md
    // signale déjà à propos de ASSET_EXT. Et ces tables sont écrites À LA
    // MAIN, une ligne par civilisation et par bâtiment.
    const fs = require('fs'), path = require('path');
    const j = charger();
    const racine = path.join(__dirname, '..', 'assets');
    const attendus = [];
    const pousser = (dossier, v) => {
      if (typeof v === 'string') attendus.push(dossier + '/' + v);
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) pousser(dossier, v[k]);
    };
    pousser('batiments', j.BLD_SPRITE_FILES);
    pousser('batiments', j.BLD_AGE_SPRITE_FILES);
    pousser('batiments', j.BLD_LEVEL_SPRITE_FILES);
    pousser('batiments', j.BLD_CIV_SPRITE_FILES);
    pousser('unites', j.UNIT_SPRITE_FILES);
    pousser('unites', j.UNIT_CIV_SPRITE_FILES);
    const absents = [...new Set(attendus)]
      .filter((rel) => !fs.existsSync(path.join(racine, rel + j.ASSET_EXT)));
    ok(!absents.length,
      absents.length + ' planche(s) nommée(s) dans le code sont absentes de assets/, ' +
      'le jeu retomberait EN SILENCE sur le rendu procédural :\n        ' +
      absents.slice(0, 10).join(', '));
  });

  test('l\'aperçu de construction (drawGhost) montre la planche de LA civilisation, pas la générique', () => {
    // drawGhost() faisait `SPR.bld[G.buildType]` — une simple table plate,
    // sans passer par civKeyOf/BLD_CIV_SPRITE_FILES comme drawBuildings().
    // Résultat : l'aperçu affiché avant de poser un bâtiment montrait
    // TOUJOURS la planche générique (non teintée, non habillée à l'âge),
    // puis le bâtiment RÉEL — byzantin, gitan, etc. — apparaissait une fois
    // posé. L'aperçu mentait sur ce que le joueur allait réellement obtenir.
    // Pas de rendu ici (voir la note en tête de fichier) : on vérifie que
    // la fonction consulte bien la même table que le bâtiment réel, comme
    // le fait déjà le test sur popGain pour le menu de construction.
    const fs = require('fs'), path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', '06-rendu.js'), 'utf8');
    const debut = source.indexOf('function drawGhost(');
    ok(debut >= 0, 'drawGhost() introuvable dans 06-rendu.js');
    const corps = source.slice(debut, source.indexOf('\nfunction ', debut + 10));
    ok(/BLD_CIV_SPRITE_FILES/.test(corps),
      'drawGhost() ne consulte pas BLD_CIV_SPRITE_FILES : l\'aperçu retombe sur la planche générique');
    ok(/civKeyOf\(G\.me\)/.test(corps),
      'drawGhost() ne lit pas la civilisation du joueur (civKeyOf(G.me))');
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
  test('un refus d\'âge dit LEQUEL, et pas toujours le même', () => {
    // BATIR refuse pour DEUX exigences derrière le même motif : Château et
    // Atelier de Siège à l'Âge des Châteaux, Merveille à l'Impérial. Le
    // message de confirmBuild annonçait « Âge des Châteaux » dans les deux
    // cas. L'âge requis voyage désormais avec le refus.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    riche(j, j.G.me);
    j.moi().age = 0;
    const p = caseLibre(j, 60, 60, 3, 3);
    const chateau = ordreDe(j, j.G.me, j.ORD.BATIR, { type: j.BT.CASTLE, tx: p.tx, ty: p.ty, batisseurs: [] });
    egal(chateau.raison, 'age', 'le Château passe à l\'Âge Sombre');
    egal(chateau.reqAge, 2, 'le refus du Château n\'annonce pas l\'Âge des Châteaux');

    const merveille = ordreDe(j, j.G.me, j.ORD.BATIR, { type: j.BT.WONDER, tx: p.tx, ty: p.ty, batisseurs: [] });
    egal(merveille.raison, 'age', 'la Merveille passe à l\'Âge Sombre');
    egal(merveille.reqAge, 3, 'le refus de la Merveille annonce le mauvais âge');
    ok(chateau.reqAge !== merveille.reqAge,
      'les deux exigences rendent le même âge : le message ne peut pas être juste pour les deux');

    // Et le message doit être composé depuis ce champ, pas écrit en dur.
    const entree = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '09-entree.js'), 'utf8');
    const corps = entree.slice(entree.indexOf('function confirmBuild'), entree.indexOf('function confirmBuild') + 1400);
    ok(/AGES\[r\.reqAge/.test(corps),
      'confirmBuild écrit le nom de l\'âge en dur : il ne peut pas être juste pour les deux exigences');
  });

  test('BATIR refuse le Centre Ville : il ne coûte rien et n\'est jamais dans le menu', () => {
    // Le Centre Ville n'existe QUE via departsHumains/genMap. BDEF[BT.TC].cost
    // vaut {} (juste pour que la table reste complète) — sans un refus
    // explicite, un ordre BATIR forgé passait tous les contrôles restants
    // (coût nul, case libre) et posait un second Centre Ville gratuit.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    const p = caseLibre(j, 70, 70, 2, 2);
    const avantRes = { ...j.G.res };
    const avantN = j.G.buildings.filter((b) => b.owner === j.G.me && b.type === j.BT.TC).length;
    const r = ordreDe(j, j.G.me, j.ORD.BATIR, { type: j.BT.TC, tx: p.tx, ty: p.ty, batisseurs: [] });
    egal(r.ok, false, 'un Centre Ville gratuit passe l\'ordre BATIR');
    const apresN = j.G.buildings.filter((b) => b.owner === j.G.me && b.type === j.BT.TC).length;
    egal(apresN, avantN, 'un second Centre Ville a été posé malgré le refus');
    egalJSON(j.G.res, avantRes, 'des ressources ont bougé alors que l\'ordre est refusé');
  });

  test('un refus de recherche dit LE bon motif, pas « ressources »', () => {
    // Le panneau de recherche annonçait « Ressources insuffisantes ! » pour
    // les six motifs de refus d'ORD.RECHERCHE. Le cas qui ment vraiment :
    // la Forge détruite pendant que le panneau est ouvert — on disait au
    // joueur qu'il était pauvre, en faisant clignoter des ressources qu'il
    // avait. Ici on épingle les motifs eux-mêmes, puis on vérifie que le
    // panneau les distingue.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    riche(j, j.G.me);
    const p = caseLibre(j, 60, 60, 2, 2);
    const forge = batir(j, j.BT.FORGE, p.tx, p.ty);

    // Avec la Forge : la recherche part.
    egal(ordreDe(j, j.G.me, j.ORD.RECHERCHE, { cle: 'iron_sword' }).ok, true,
      'la recherche est refusée alors que la Forge est debout et la caisse pleine');

    // Sans la Forge : motif `cible`, et surtout PAS `ressources` — la caisse
    // est pleine, c'est tout l'intérêt du test.
    forge.hp = 0;
    for (let k = 0; k < 5; k++) j.update(j.SIM_DT);
    const refus = ordreDe(j, j.G.me, j.ORD.RECHERCHE, { cle: 'bow_craft' });
    egal(refus.ok, false, 'une recherche passe sans Forge');
    egal(refus.raison, 'cible', 'le motif du refus n\'est pas celui du bâtiment manquant');
    ok(j.resPool(j.G.me).gold > 1000, 'la caisse doit être pleine pour que ce test prouve quelque chose');

    // Et le panneau doit brancher sur le motif, pas tout ramener aux
    // ressources (même découpage que trainUnit, js/10-ordres.js).
    const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    const bloc = ui.slice(ui.indexOf('function openRP'), ui.indexOf('function closeRP'));
    ok(/raison==='cible'/.test(bloc),
      'le panneau de recherche ne distingue pas le bâtiment détruit : il annonce « Ressources insuffisantes » à tort');
  });

  // ── Les douze ordres que rien n'eprouvait ────────────────
  // Le groupe vise les REFUS : c'est ce que l'interface ne verrouille pas.
  // Ces douze-la n'avaient ni test de refus ni test nominal, alors que chacun
  // est une porte que le reseau ouvre directement sur l'etat de jeu.

  // Un theatre commun : une poignee d'unites a soi, une a l'adversaire.
  function scene(opts) {
    const j = partie(charger(), Object.assign({ graine: 4242, mode: 'conquest', pas: 5 }, opts || {}));
    riche(j, j.G.me);
    const B = j.BASE_TILE;
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const rival = Object.values(j.G.factions).find((f) => f.genre === 'ia');
    const poser = (type, dtx, dty, owner) => {
      const u = j.mkUnit(type, (tc.tx + dtx) * B, (tc.ty + dty) * B, owner != null ? owner : j.G.me);
      j.G.units.push(u); j.rebuildIndex(); return u;
    };
    return { j, B, tc, rival, poser };
  }

  test('ATK : on n attaque ni les siens, ni un mort, ni avec les unites d un autre', () => {
    const { j, poser, rival } = scene();
    const mien = poser(j.UT.MIL, 4, 4);
    const allie = poser(j.UT.MIL, 5, 4);
    const ennemi = poser(j.UT.MIL, 8, 8, rival.id);

    egal(ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: allie.id }).ok, false,
      'attaquer sa propre unite doit etre refuse');
    ennemi.hp = 0;
    egal(ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: ennemi.id }).ok, false,
      'attaquer un cadavre doit etre refuse');
    ennemi.hp = ennemi.maxHp;
    // Ordre forge : le client commande une unite qui ne lui appartient pas.
    egal(ordreDe(j, j.G.me, 'ATK', { ids: [ennemi.id], cible: mien.id }).ok, false,
      'commander l unite d un autre camp doit etre refuse');
    // Et le cas nominal.
    const r = ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: ennemi.id });
    ok(r.ok, 'attaquer un ennemi vivant : ' + JSON.stringify(r));
    egal(mien.state, 'attack', 'etat de l assaillant');
    egal(mien.target, ennemi.id, 'cible de l assaillant');
  });

  test('ATK sur un BATIMENT passe par genreCible, et respecte le camp', () => {
    const { j, poser, rival, tc } = scene();
    const mien = poser(j.UT.MIL, 4, 4);
    const p = caseLibre(j, tc.tx + 14, tc.ty + 14, 2, 2);
    const bEnnemi = batir(j, j.BT.HOUSE, p.tx, p.ty, rival.id);
    // Sans genreCible, l'identifiant est cherche parmi les UNITES : rien.
    egal(ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: bEnnemi.id }).ok, false,
      'un batiment vise sans genreCible ne doit pas etre trouve');
    ok(ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: bEnnemi.id, genreCible: 'b' }).ok,
      'batiment ennemi vise correctement');
    const mienB = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    egal(ordreDe(j, j.G.me, 'ATK', { ids: [mien.id], cible: mienB.id, genreCible: 'b' }).ok, false,
      'on ne doit pas pouvoir viser son propre batiment');
  });

  test('AMOVE et POSTURE sont reserves aux MILITAIRES', () => {
    const { j, poser } = scene();
    const vil = poser(j.UT.VIL, 4, 4);
    const sold = poser(j.UT.MIL, 5, 4);

    egal(ordreDe(j, j.G.me, 'AMOVE', { ids: [vil.id], x: 100, y: 100 }).ok, false,
      'un villageois ne fait pas d attaque-deplacement');
    egal(ordreDe(j, j.G.me, 'POSTURE', { ids: [vil.id], posture: 'agg' }).ok, false,
      'un villageois n a pas de posture');

    const r = ordreDe(j, j.G.me, 'AMOVE', { ids: [vil.id, sold.id], x: 100, y: 100 });
    egal(r.n, 1, 'seul le militaire doit partir en attaque-deplacement');
    egal(sold.state, 'amove', 'etat du soldat');
    ok(sold.amove && sold.amove.x != null, 'le point d attaque-deplacement doit etre memorise');

    // Posture forgee : l'interface n'en propose que trois.
    egal(ordreDe(j, j.G.me, 'POSTURE', { ids: [sold.id], posture: 'invincible' }).ok, false,
      'une posture inventee doit etre refusee');
    egal(ordreDe(j, j.G.me, 'POSTURE', { ids: [sold.id], posture: null }).ok, false,
      'une posture absente doit etre refusee');
    for (const st of ['agg', 'def', 'hold']) {
      ok(ordreDe(j, j.G.me, 'POSTURE', { ids: [sold.id], posture: st }).ok, 'posture ' + st + ' refusee');
      egal(sold.stance, st, 'posture appliquee');
    }
  });

  test('STOP relache le poste au lieu de laisser un fantome derriere', () => {
    const { j, poser } = scene();
    const vil = poser(j.UT.VIL, 4, 4);
    // Sur SON gisement : `gatherers` n'est garni qu'a l'arrivee (doGather),
    // mais `homeNode` est pose des l'ordre — c'est lui que quitterPoste doit
    // relacher, et lui qui laisse un fantome quand on l'oublie.
    const nd = j.G.nodes.find((n) => n.amt > 0);
    ok(ordreDe(j, j.G.me, 'RECOLTE', { ids: [vil.id], nodeId: nd.id }).ok, 'mise au travail');
    egal(vil.homeNode, nd.id, 'le gisement doit etre memorise par l ordre');
    // On simule l'arrivee : c'est la que le villageois s'inscrit reellement.
    nd.gatherers.push(vil.id);

    ok(ordreDe(j, j.G.me, 'STOP', { ids: [vil.id] }).ok, 'STOP refuse');
    egal(vil.state, 'idle', 'etat apres STOP');
    egal(vil.homeNode, null, 'STOP doit relacher le gisement memorise');
    ok(!nd.gatherers.includes(vil.id),
      'STOP doit DESINSCRIRE du gisement : un fantome y bloquerait une place pour toujours');
    ok(!vil.target && !vil.amove, 'STOP doit aussi effacer cible et attaque-deplacement');
    egal(ordreDe(j, j.G.me, 'STOP', { ids: [] }).ok, false, 'STOP sans unite doit etre refuse');

    // Et il ne stoppe que les SIENNES.
    const rival = Object.values(j.G.factions).find((f) => f.genre === 'ia');
    const sien = poser(j.UT.MIL, 8, 8, rival.id);
    sien.state = 'attack';
    egal(ordreDe(j, j.G.me, 'STOP', { ids: [sien.id] }).ok, false,
      'stopper l unite d un autre camp doit etre refuse');
    egal(sien.state, 'attack', 'et son etat ne doit pas avoir bouge');
  });

  test('CHANTIER ne vise qu un chantier, REPARE ne vise qu un blesse', () => {
    const { j, poser, tc, rival } = scene();
    const vil = poser(j.UT.VIL, 4, 4);
    const p = caseLibre(j, tc.tx + 8, tc.ty + 8, 2, 2);
    const fini = batir(j, j.BT.HOUSE, p.tx, p.ty);

    egal(ordreDe(j, j.G.me, 'CHANTIER', { ids: [vil.id], bId: fini.id }).ok, false,
      'on n envoie pas batir un batiment DEJA fini');
    egal(ordreDe(j, j.G.me, 'REPARE', { ids: [vil.id], bId: fini.id }).ok, false,
      'on ne repare pas un batiment intact');

    fini.hp = fini.maxHp * 0.5;
    ok(ordreDe(j, j.G.me, 'REPARE', { ids: [vil.id], bId: fini.id }).ok, 'reparer un blesse');
    egal(vil.state, 'repair', 'etat du reparateur');

    // Chantier en cours : la ou CHANTIER vaut, et REPARE non.
    fini.constructing = true; fini.progress = 0.3;
    ok(ordreDe(j, j.G.me, 'CHANTIER', { ids: [vil.id], bId: fini.id }).ok, 'batir un chantier');
    egal(vil.state, 'build', 'etat du batisseur');
    egal(ordreDe(j, j.G.me, 'REPARE', { ids: [vil.id], bId: fini.id }).ok, false,
      'on ne repare pas ce qui n est pas encore bati');

    // Le batiment d un autre camp, jamais.
    const q = caseLibre(j, tc.tx + 16, tc.ty + 16, 2, 2);
    const autre = batir(j, j.BT.HOUSE, q.tx, q.ty, rival.id);
    autre.hp = autre.maxHp * 0.5;
    egal(ordreDe(j, j.G.me, 'REPARE', { ids: [vil.id], bId: autre.id }).ok, false,
      'reparer le batiment de l ennemi doit etre refuse');
    autre.constructing = true;
    egal(ordreDe(j, j.G.me, 'CHANTIER', { ids: [vil.id], bId: autre.id }).ok, false,
      'batir le chantier de l ennemi doit etre refuse');

    // Et un soldat ne bricole pas.
    const sold = poser(j.UT.MIL, 6, 4);
    fini.constructing = false; fini.hp = fini.maxHp * 0.5;
    egal(ordreDe(j, j.G.me, 'REPARE', { ids: [sold.id], bId: fini.id }).ok, false,
      'seul un villageois repare');
  });

  test('PORTAIL bascule le passage DANS LA GRILLE, pas seulement a l ecran', () => {
    const { j, tc } = scene();
    const p = caseLibre(j, tc.tx + 6, tc.ty + 6, 1, 1);
    const porte = batir(j, j.BT.GATE, p.tx, p.ty);
    const lu = () => j.G.bmap[porte.ty][porte.tx];

    // Ferme au depart : la case doit bloquer.
    egal(porte.open, false, 'un portail neuf doit etre ferme');
    egal(lu(), 3, 'ferme, la case doit etre solide dans bmap');

    const r = ordreDe(j, j.G.me, 'PORTAIL', { bId: porte.id });
    ok(r.ok && r.open === true, 'ouverture refusee : ' + JSON.stringify(r));
    egal(lu(), 0, 'ouvert, la case doit devenir franchissable — sinon le pathfinding contourne une porte ouverte');
    ok(!j.tileBlocked(porte.tx, porte.ty), 'tileBlocked doit suivre la grille');

    ok(ordreDe(j, j.G.me, 'PORTAIL', { bId: porte.id }).open === false, 'refermeture');
    egal(lu(), 3, 'referme, la case doit rebloquer');

    // Tout autre batiment est refuse — sans ce test, PORTAIL sur un Centre
    // Ville en aurait perce la grille de blocage.
    egal(ordreDe(j, j.G.me, 'PORTAIL', { bId: tc.id }).ok, false, 'PORTAIL sur un Centre Ville');
  });

  test('AMELIORER_TOUR : verrous d age, de prix, de plafond et de cible', () => {
    const { j, tc } = scene();
    const p = caseLibre(j, tc.tx + 6, tc.ty + 6, 1, 1);
    const tour = batir(j, j.BT.TOWER, p.tx, p.ty);
    const f = j.G.factions[j.G.me];
    egal(tour.level, 1, 'une tour neuve est de niveau 1');

    f.age = 0;
    egal(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).raison, 'age',
      'niveau 2 avant l Age Feodal');

    f.age = 1;
    Object.assign(f.res, { food: 0, wood: 0, stone: 0, gold: 0 });
    egal(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).raison, 'ressources',
      'ameliorer sans payer');

    riche(j, j.G.me);
    const avantHp = tour.maxHp;
    ok(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).ok, 'niveau 2 a l Age Feodal');
    egal(tour.level, 2, 'niveau apres amelioration');
    ok(tour.maxHp > avantHp, 'la Tour de Garde doit encaisser davantage');

    egal(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).raison, 'age',
      'le Donjon exige l Age des Chateaux');
    f.age = 3;
    ok(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).ok, 'niveau 3');
    egal(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tour.id }).raison, 'max',
      'il n y a rien apres le Donjon');

    // Les degats subis ne doivent pas etre effaces par une amelioration.
    const q = caseLibre(j, tc.tx + 10, tc.ty + 10, 1, 1);
    const t2 = batir(j, j.BT.TOWER, q.tx, q.ty);
    t2.hp = t2.maxHp - 300;
    ok(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: t2.id }).ok, 'amelioration de la tour blessee');
    egal(t2.maxHp - t2.hp, 300, 'les degats subis doivent etre conserves, pas soignes gratuitement');

    egal(ordreDe(j, j.G.me, 'AMELIORER_TOUR', { bId: tc.id }).ok, false, 'AMELIORER_TOUR sur un Centre Ville');
  });

  test('AMELIORER_CAMP ne vaut que pour les trois camps de ressource', () => {
    const { j, tc } = scene();
    const f = j.G.factions[j.G.me];
    f.age = 1;
    const camps = [j.BT.LUMBER, j.BT.MINE, j.BT.MILL].filter((t) => j.BDEF[t]);
    ok(camps.length === 3, 'les trois camps de ressource doivent exister');
    for (const type of camps) {
      const d = j.BDEF[type];
      const p = caseLibre(j, tc.tx + 8, tc.ty + 8, d.w, d.h);
      const b = batir(j, type, p.tx, p.ty);
      riche(j, j.G.me);
      const r = ordreDe(j, j.G.me, 'AMELIORER_CAMP', { bId: b.id });
      ok(r.ok, d.nom + ' : amelioration refusee — ' + JSON.stringify(r));
      egal(b.level, 2, d.nom + ' : niveau apres amelioration');
    }
    // Une Maison n est pas un camp : la table CAMP_LEVELS fait foi. Le verrou
    // est DOUBLE (applyCommand et appliquerUpgradeCamp le testent tous deux),
    // donc en retirer un seul ne change rien — verifie a l ecriture ; il faut
    // les retirer TOUS LES DEUX pour faire tomber ce test.
    const p = caseLibre(j, tc.tx + 14, tc.ty + 14, 2, 2);
    const maison = batir(j, j.BT.HOUSE, p.tx, p.ty);
    egal(ordreDe(j, j.G.me, 'AMELIORER_CAMP', { bId: maison.id }).ok, false,
      'ameliorer une Maison comme un camp');
    egal(ordreDe(j, j.G.me, 'AMELIORER_CAMP', { bId: tc.id }).ok, false,
      'ameliorer un Centre Ville comme un camp');
  });

  test('CHASSER : une proie vivante, et le gibier n appartient a personne', () => {
    const { j, poser } = scene();
    const vil = poser(j.UT.VIL, 4, 4);
    ok((j.G.wildlife || []).length, 'pas de gibier sur cette carte, le test ne mesure rien');
    const proie = j.G.wildlife[0];

    egal(ordreDe(j, j.G.me, 'CHASSER', { ids: [vil.id], wildlifeId: -999 }).ok, false,
      'chasser un animal qui n existe pas');
    proie.hp = 0;
    egal(ordreDe(j, j.G.me, 'CHASSER', { ids: [vil.id], wildlifeId: proie.id }).ok, false,
      'chasser une carcasse');
    proie.hp = 20;
    ok(ordreDe(j, j.G.me, 'CHASSER', { ids: [vil.id], wildlifeId: proie.id }).ok, 'chasse refusee');
    egal(vil.state, 'hunt', 'etat du chasseur');
    egal(vil.target, proie.id, 'cible du chasseur');
    // Contrairement aux reliques, plusieurs chasseurs peuvent viser la meme
    // proie : pas d exclusivite, donc pas de blocage possible.
    const sold = poser(j.UT.MIL, 5, 4);
    ok(ordreDe(j, j.G.me, 'CHASSER', { ids: [sold.id], wildlifeId: proie.id }).ok,
      'un second chasseur sur la meme proie doit etre accepte');
  });

  test('PECHER et NAVIGUER sont reserves aux BATEAUX', () => {
    const { j, poser } = scene();
    const vil = poser(j.UT.VIL, 4, 4);
    const bateau = poser(j.UT.BOAT, 5, 4);
    const banc = j.G.nodes.find((n) => n.type === j.RT.FISH && n.amt > 0);
    const bois = j.G.nodes.find((n) => n.type !== j.RT.FISH && n.amt > 0);

    egal(ordreDe(j, j.G.me, 'NAVIGUER', { ids: [vil.id], x: 100, y: 100 }).ok, false,
      'un villageois ne navigue pas');
    ok(ordreDe(j, j.G.me, 'NAVIGUER', { ids: [bateau.id], x: 100, y: 100 }).ok, 'navigation refusee');
    egal(bateau.state, 'sailing', 'etat du bateau');

    // Toutes les cartes en portent (6 au minimum, sur les Terres Arides) :
    // un test qui se contenterait de sauter en leur absence ne garderait rien.
    ok(banc, 'aucun banc de poisson sur cette carte, le test ne mesure rien');
    {
      egal(ordreDe(j, j.G.me, 'PECHER', { ids: [vil.id], nodeId: banc.id }).ok, false,
        'un villageois ne peche pas depuis la berge');
      egal(ordreDe(j, j.G.me, 'PECHER', { ids: [bateau.id], nodeId: bois.id }).ok, false,
        'on ne peche pas dans une foret');
      egal(ordreDe(j, j.G.me, 'PECHER', { ids: [bateau.id], nodeId: -999 }).ok, false,
        'banc inexistant');
      ok(ordreDe(j, j.G.me, 'PECHER', { ids: [bateau.id], nodeId: banc.id }).ok, 'peche refusee');
      egal(bateau.state, 'fish', 'etat du pecheur');
      egal(bateau.homeNode, banc.id, 'le banc doit etre memorise pour les allers-retours');
      const vide = banc.amt; banc.amt = 0;
      egal(ordreDe(j, j.G.me, 'PECHER', { ids: [bateau.id], nodeId: banc.id }).ok, false,
        'on ne peche pas un banc epuise');
      banc.amt = vide;
    }
  });

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

  test('tuer l\'armée de l\'IA de Conquête ne rapporte pas de prime — seuls les pillards de vague payent', () => {
    // L'IA de Conquête RECYCLE exactement le roster reskinné des pillards de
    // vague (ENEMI/ENEMIA/ENEMI_G/ENEMI_C/ENEMI_BOSS, voir AI_TRAINERS) : le
    // TYPE seul ne peut donc pas distinguer un Cavalier Noir de l'IA d'un
    // Cavalier Noir de vague — le code ne regardait QUE le type, jamais le
    // propriétaire. Résultat mesuré : harceler l'armée de l'IA rapportait
    // 4 à 15💰 par mort, sans limite, contredisant le commentaire du code
    // lui-même ("ne verse pas de prime au joueur").
    const j = partie(charger(), { graine: 4242, mode: 'conquest' });
    const or0 = j.G.res.gold;
    const u = j.mkUnit(j.UT.ENEMI_C, 500, 500, j.FAC.IA); // vrai roster de l'IA — voir AI_TRAINERS[BT.STABLE]
    j.G.units.push(u); j.rebuildIndex();
    u.hp = 0; u.dernierAgresseur = j.G.me;
    for (let k = 0; k < 3; k++) j.update(j.SIM_DT);
    egal(j.G.res.gold, or0, 'une unité de l\'IA de Conquête a versé une prime en or');

    // Le même type, propriété d'un pillard de vague, DOIT payer.
    const p = j.mkUnit(j.UT.ENEMI_C, 500, 500, j.FAC.PILL);
    j.G.units.push(p); j.rebuildIndex();
    p.hp = 0; p.dernierAgresseur = j.G.me;
    for (let k = 0; k < 3; k++) j.update(j.SIM_DT);
    egal(j.G.res.gold, or0 + 8, 'le même type de pillard, lui, ne paye plus rien');
  });

  test('le Seigneur de Guerre rapporte bien ses 200 pièces d\'or promises', () => {
    // La formule de prime listait `ENEMI_BOSS?200:...`, mais cette branche
    // était INATTEIGNABLE : elle vivait dans le `else` du test « ce type
    // EST un Seigneur de Guerre », qui ne fait que compter bossKilled.
    // Le Seigneur de Guerre — la mort la plus dure à obtenir du jeu — ne
    // payait donc jamais rien.
    const j = partie(charger(), { graine: 4242 });
    const or0 = j.G.res.gold;
    const boss = j.mkUnit(j.UT.ENEMI_BOSS, 500, 500, j.FAC.PILL);
    j.G.units.push(boss); j.rebuildIndex();
    boss.hp = 0; boss.dernierAgresseur = j.G.me;
    for (let k = 0; k < 3; k++) j.update(j.SIM_DT);
    egal(j.G.res.gold, or0 + 200, 'le Seigneur de Guerre ne paie pas les 200💰 promis par la formule');
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

  test('un chantier à peine posé ne loge encore personne', () => {
    // batir() (l'helper ci-dessus) simule un bâtiment déjà FINI — ce test-ci
    // pose la fondation elle-même (constructing:true, progress:0), le cas
    // qu'un simple ordre BATIR produit réellement. Sans le garde-fou de
    // updatePopCap, le plafond sautait AVANT le premier coup de marteau ;
    // doBuild rappelle updatePopCap() au moment où constructing passe à
    // false (voir 07-simulation.js), donc la place reste due, juste rendue
    // plus tard.
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi();
    const avant = f.maxPop;
    const p = caseLibre(j, 60, 60, 1, 1);
    const maison = j.mkBuilding(j.BT.HOUSE, p.tx, p.ty, j.G.me);
    maison.constructing = true; maison.progress = 0;
    j.placeBuilding(maison);
    j.updatePopCap();
    egal(f.maxPop, avant, 'une fondation à 0% loge déjà des villageois');
    maison.constructing = false; maison.progress = 1;
    j.updatePopCap();
    egal(f.maxPop, avant + j.AGE_BONUS[f.age].housePop, 'le chantier achevé ne loge personne à son tour');
  });

  test('la bannière plein écran ne marque que la PREMIÈRE fois qu\'un type de bâtiment est achevé', () => {
    // Signalé le 2026-09-08, capture d'écran à l'appui (iPhone/Chrome) : une
    // simple Maison achevée en pleine partie faisait s'afficher le même
    // aplat à 30px plein centre qu'une montée d'âge ou une Merveille — alors
    // qu'un joueur en pose des dizaines par partie. Recouvrait littéralement
    // la carte sur un petit écran. Le petit toast (notify()) continue de
    // confirmer CHAQUE bâtiment ; seule bigBanner() devient un événement
    // rare, une fois par TYPE de bâtiment et par partie (voir doBuild,
    // js/07-simulation.js).
    //
    // Passe par doBuild() plutôt que de forcer constructing/progress à la
    // main (comme le test précédent) : le code à vérifier ici s'exécute au
    // moment même de la bascule, pas après.
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const banniere = j.__sandbox.document.getElementById('bigbanner');
    const toasts = j.__sandbox.document.getElementById('notif');

    function batirEtAcheverUneMaison(tx, ty) {
      const p = caseLibre(j, tx, ty, 1, 1);
      ok(p, 'aucune case libre pour poser la Maison');
      const b = j.mkBuilding(j.BT.HOUSE, p.tx, p.ty, j.G.me);
      b.constructing = true; b.progress = 0.999999;
      j.placeBuilding(b);
      j.rebuildIndex(); // bldById (lu par doBuild) s'appuie sur l'index, jamais à jour hors update()
      const vil = j.mkUnit(j.UT.VIL, b.x, b.y, j.G.me);
      vil.buildTarget = b.id;
      j.doBuild(vil, 1); // au contact (distance 0) : franchit 1 en un pas
      ok(!b.constructing, 'le chantier ne se termine pas');
    }

    banniere.textContent = '';
    const avantToasts = toasts.children.length;
    batirEtAcheverUneMaison(20, 20);
    ok(banniere.textContent.includes('Maison'), 'la première Maison ne déclenche pas la bannière plein écran');
    egal(toasts.children.length, avantToasts + 1, 'le petit toast ne confirme pas la première Maison');

    banniere.textContent = ''; // l'animation précédente est retombée
    batirEtAcheverUneMaison(30, 30);
    egal(banniere.textContent, '', 'une SECONDE Maison redéclenche la bannière plein écran');
    egal(toasts.children.length, avantToasts + 2, 'le petit toast, lui, doit confirmer la seconde Maison aussi');
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

  // ── Modes proposés en Solo / en Multijoueur ──
  // L'écran-titre filtre les modes par onglet (voir pickPlayTab), mais la
  // VRAIE contrainte est ici : le client d'une partie en ligne n'évalue que
  // la victoire par élimination (js/12-reseau.js), là où l'hôte connaît en
  // plus la victoire aux vagues (js/07-simulation.js). Un mode à vagues
  // proposé en ligne serait donc gagnable par l'hôte seul — l'invité pouvait
  // survivre aux 20 vagues sans jamais voir sa victoire.
  test('aucun mode à vagues n\'est proposé en Multijoueur', () => {
    const j = charger();
    for (const [cle, m] of Object.entries(j.MODES)) {
      if ((m.targetWaves || 0) > 0) {
        egal(j.modeDispo(cle, 'multi'), false,
          `le mode « ${m.nom} » se gagne aux vagues : l'invité ne pourrait jamais gagner en ligne`);
      }
    }
  });

  test('chaque onglet propose au moins un mode, et le coop reste hors Solo', () => {
    const j = charger();
    const cles = Object.keys(j.MODES);
    ok(cles.some((k) => j.modeDispo(k, 'solo')), 'aucun mode jouable en Solo');
    ok(cles.some((k) => j.modeDispo(k, 'multi')), 'aucun mode jouable en Multijoueur');
    // Sans second humain, un mode coop retombe sur « 1 rival IA » : c'est
    // Conquête à l'identique, un doublon dans le sélecteur solo.
    for (const [cle, m] of Object.entries(j.MODES)) {
      if (m.coop) egal(j.modeDispo(cle, 'solo'), false, `le mode coop « ${m.nom} » est proposé en Solo`);
    }
  });

  test('changer d\'onglet ramène toujours sur un mode proposé par cet onglet', () => {
    const j = charger();
    for (const depart of Object.keys(j.MODES)) {
      for (const onglet of ['solo', 'multi']) {
        j.pickMode(depart);
        j.pickPlayTab(onglet);
        const apres = j.lire('selectedMode');
        ok(j.modeDispo(apres, onglet),
          `parti de « ${depart} » vers ${onglet}, on reste sur « ${apres} » qui n'y est pas proposé`);
      }
    }
  });

  test('un aller-retour entre onglets ne fait pas perdre son mode au joueur', () => {
    const j = charger();
    // Survie n'existe pas en Multijoueur : l'aller impose donc un repli.
    // Le retour doit rendre au joueur SON mode, pas le défaut de l'onglet.
    j.pickPlayTab('solo');
    j.pickMode('survival');
    j.pickPlayTab('multi');
    ok(j.modeDispo(j.lire('selectedMode'), 'multi'), 'le repli multi n\'est pas un mode multi');
    j.pickPlayTab('solo');
    egal(j.lire('selectedMode'), 'survival', 'la Survie choisie en Solo a été perdue en passant par Multijoueur');
  });

  // Le Héros est une chance UNIQUE par partie (f.heroTrained, voir
  // ORD.FORMER) : l'annulation la rend explicitement. Restait un trou — un
  // Château qui tombe avec le Héros encore en file. Le joueur avait payé,
  // ne recevait rien, et ne pouvait plus jamais en former.
  const scenarioHeroEnFile = (j) => {
    const p = caseLibre(j, 60, 60, 3, 3);
    const chateau = batir(j, j.BT.CASTLE, p.tx, p.ty);
    riche(j);
    const f = j.moi(); f.age = 3; f.maxPop = 200;
    const r = ordreDe(j, j.G.me, j.ORD.FORMER, { bId: chateau.id, unitType: j.UT.HERO });
    ok(r.ok, 'la formation du Héros a été refusée : ' + (r.raison || ''));
    egal(f.heroTrained, true, 'la chance du Héros n\'a pas été réservée');
    return { chateau, f };
  };

  test('un Château rasé avec le Héros en file ne coûte pas le Héros de la partie', () => {
    const j = partie(charger(), { graine: 4242 });
    const { chateau, f } = scenarioHeroEnFile(j);
    chateau.hp = 0; // rasé au combat
    for (let k = 0; k < 5; k++) j.update(j.SIM_DT);
    egal(f.heroTrained, false, 'le Château rasé a emporté la seule chance de Héros de la partie');
    // Et la chance est réellement réutilisable, pas juste remise à zéro.
    const p2 = caseLibre(j, 70, 70, 3, 3);
    const c2 = batir(j, j.BT.CASTLE, p2.tx, p2.ty);
    ok(ordreDe(j, j.G.me, j.ORD.FORMER, { bId: c2.id, unitType: j.UT.HERO }).ok,
      'impossible de reformer un Héros après la perte du premier Château');
  });

  test('démolir un Château avec le Héros en file ne coûte pas le Héros non plus', () => {
    const j = partie(charger(), { graine: 4242 });
    const { chateau, f } = scenarioHeroEnFile(j);
    j.appliquerDemolition(chateau);
    egal(f.heroTrained, false, 'la démolition volontaire a emporté la chance de Héros');
  });

  // ── Ce que l'interface PROMET doit être ce que le code FAIT ──
  // Les trois tests qui suivent gardent des libellés, pas des mécaniques :
  // chacun a menti à un joueur, et rien ne le signalait.
  test('le raccourci d\'émotion marche aussi sur un clavier AZERTY', () => {
    const j = charger();
    // Sur AZERTY, la touche physique marquée « 1 » ne produit pas '1' : e.key
    // vaut '&', puis 'é', '"', ''' pour les suivantes. Seul e.code est stable.
    const azerty = ['&', 'é', '"', "'"];
    for (let i = 0; i < 4; i++) {
      egal(j.indexEmoteDepuisTouche({ altKey: true, code: `Digit${i + 1}`, key: azerty[i] }), i,
        `Alt+${i + 1} ignoré sur un clavier AZERTY (e.key='${azerty[i]}')`);
      egal(j.indexEmoteDepuisTouche({ altKey: true, code: `Digit${i + 1}`, key: String(i + 1) }), i,
        `Alt+${i + 1} ignoré sur un clavier QWERTY`);
    }
    // Et rien ne se déclenche hors du contrat : sans Alt, ou au-delà des
    // émotions existantes (les chiffres nus appartiennent aux groupes).
    egal(j.indexEmoteDepuisTouche({ altKey: false, code: 'Digit1', key: '1' }), -1, 'émotion déclenchée sans Alt');
    egal(j.indexEmoteDepuisTouche({ altKey: true, code: `Digit${j.EMOTES.length + 1}`, key: '9' }), -1,
      'une touche au-delà des émotions existantes renvoie une émotion');
  });

  test('le texte de difficulté ne parle pas de vagues dans un mode sans vagues', () => {
    const j = charger();
    for (const [mk, m] of Object.entries(j.MODES)) {
      const sansVagues = m.targetWaves === 0;
      for (const dk of Object.keys(j.DIFFS)) {
        const txt = j.diffDesc(dk, mk);
        ok(txt && txt.length, `aucun texte de difficulté pour ${dk}/${mk}`);
        if (sansVagues) {
          ok(!/vague/i.test(txt),
            `le mode « ${m.nom} » n'a aucune vague, mais sa difficulté ${dk} annonce : « ${txt} »`);
        }
      }
    }
  });

  test('le bonus annoncé à chaque âge correspond à AGE_BONUS', () => {
    const j = charger();
    const pct = (v) => Math.round((v - 1) * 100);
    for (let i = 1; i < j.AGES.length; i++) {
      const txt = j.AGES[i].bonus, b = j.AGE_BONUS[i];
      // Chaque pourcentage annoncé doit exister dans la table.
      for (const [champ, attendu] of [['bldHp', b.bldHp], ['gather', b.gather], ['unitHp', b.unitHp], ['milAtk', b.milAtk]]) {
        ok(new RegExp('\\+' + pct(attendu) + '%').test(txt),
          `l'${j.AGES[i].nom} applique ${champ} +${pct(attendu)}% mais ne l'annonce pas : « ${txt} »`);
      }
      ok(new RegExp('\\+' + b.housePop + ' par Maison').test(txt),
        `l'${j.AGES[i].nom} donne ${b.housePop} par Maison, texte : « ${txt} »`);
      // Un plafond de population chiffré ne doit être annoncé que s'il change
      // vraiment d'un âge à l'autre — « pop. max 80 » a longtemps été affiché
      // alors que popCap valait 300 partout.
      const annonce = /pop\.?\s*max\s*(\d+)/i.exec(txt);
      if (annonce) {
        egal(+annonce[1], b.popCap, `l'${j.AGES[i].nom} annonce un plafond de population faux`);
        ok(b.popCap !== j.AGE_BONUS[i - 1].popCap,
          `l'${j.AGES[i].nom} annonce un plafond de population que l'âge précédent avait déjà`);
      }
    }
  });

  test('une attente de reconnexion ne se fait pas dégeler par la pause', () => {
    // La reprise automatique de la pause en ligne est armée pour 90 s, la
    // fenêtre de reconnexion dure 60 s : si la connexion tombe pendant qu'un
    // joueur a son menu ouvert, le minuteur se déclenche APRÈS l'escalade.
    // closePause() levait alors la pause sans condition — l'hôte voyait sa
    // simulation repartir seule pendant qu'on lui demandait encore s'il
    // voulait continuer. L'attente DÉTIENT la pause : elle seule la lève.
    const j = partie(charger(), { graine: 4242, mode: 'conquest', pas: 5 });
    j.RESEAU.actif = true; j.RESEAU.role = 'hote';
    j.RESEAU.adversaire = { id: j.FAC.P2, nom: 'Ami' };

    j.entrerAttenteReconnexion();
    egal(j.G.paused, true, 'l\'attente de reconnexion ne gèle pas la partie (sinon ce test ne prouve rien)');

    j.closePause(); // la reprise automatique de la pause
    egal(j.G.paused, true, 'la partie a été dégelée alors que l\'attente de reconnexion court toujours');
    egal(j.RESEAU.enAttenteReconnexion, true, 'l\'attente de reconnexion a été annulée par la pause');

    // Et la reconnexion, elle, dégèle bien : la garde ne bloque pas la sortie.
    j.sortirAttenteReconnexion();
    egal(j.G.paused, false, 'la reconnexion réussie ne dégèle plus la partie');

    // Hors attente, closePause() reprend normalement — la garde ne doit pas
    // transformer la pause manuelle en aller simple.
    j.G.paused = true;
    j.closePause();
    egal(j.G.paused, false, 'la garde empêche désormais toute reprise manuelle');
  });

  test('quitter APRÈS un écran de fin ne laisse pas le joueur sans écran-titre', () => {
    // showVictory/showGameOver réécrivent tout #overlay : la carte-titre
    // n'existe plus. quitGame() se contentait de réafficher #overlay, donc
    // l'ANCIEN écran de fin — sans bouton pour relancer quoi que ce soit.
    // Chemin réel : gagner en Survie, « Continuer (sans fin) », puis quitter
    // par le menu pause. Reproduit puis corrigé en navigateur ; ici on garde
    // le contrat, le harnais ne pouvant pas exprimer « cet élément a disparu »
    // (getElementById y rend toujours un élément).
    const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    const corps = ui.slice(ui.indexOf('function quitGame'), ui.indexOf('function quitGame') + 1800);
    ok(/playtabs/.test(corps) && /location\.reload/.test(corps),
      'quitGame() ne vérifie plus que la carte-titre existe encore : quitter après un écran de fin rend le jeu inatteignable');
    // Et la lecture de #loadbtn, qui arrive APRÈS le retour de quitGame
    // (promesse), doit tolérer que l'élément ait disparu — sinon l'erreur
    // ne remonte qu'en rejet non traité, donc en silence.
    ok(/const lb=document\.getElementById\('loadbtn'\);\s*if\(lb\)/.test(corps),
      'quitGame() lit #loadbtn sans vérifier qu\'il existe : erreur silencieuse si la carte-titre a été détruite');
    // continuePlay() quitte l'écran de fin : sa mise en page ne doit pas
    // rester armée sur #overlay, que l'écran-titre partage.
    const cp = ui.slice(ui.indexOf('function continuePlay'), ui.indexOf('function continuePlay') + 500);
    ok(/classList\.remove\('endscreen'\)/.test(cp),
      'continuePlay() laisse la classe endscreen sur #overlay, que l\'écran-titre partage');
  });

  test('le gain de population affiché est celui qui est réellement appliqué', () => {
    const j = partie(charger(), { graine: 4242, pas: 5 });
    const moi = j.moi();
    const loge = Object.keys(j.BDEF).filter((bt) => j.popGain(bt, j.G.me) > 0);
    ok(loge.length >= 3, 'moins de trois bâtiments qui logent : ce test est à revoir');
    // popGain doit être la SEULE source : ce que le menu affiche et ce que
    // updatePopCap additionne doivent bouger ensemble, à tous les âges.
    for (let age = 0; age < j.AGE_BONUS.length; age++) {
      moi.age = age;
      // La Maison suit l'âge, les autres non — c'est précisément le piège
      // qu'un `popBonus` figé sur la Maison recréerait.
      egal(j.popGain(j.BT.HOUSE, j.G.me), j.AGE_BONUS[age].housePop,
        `à l'âge ${age}, la Maison n'annonce pas la capacité de son âge`);
      const avant = (() => { j.updatePopCap(); return moi.maxPop; })();
      const maison = j.G.buildings.filter((b) => b.owner === j.G.me && b.type === j.BT.HOUSE).length;
      ok(avant >= maison * j.popGain(j.BT.HOUSE, j.G.me) || avant === j.AGE_BONUS[age].popCap,
        `à l'âge ${age}, le plafond calculé ignore ce que popGain annonce`);
    }
    // Et l'affichage passe bien par popGain, pas par une seconde formule.
    const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    ok(/popGain\(/.test(ui), 'le menu de construction n\'utilise pas popGain : le chiffre affiché peut diverger du réel');
  });

  test('une unité qui résiste aux contres le dit à l\'écran', () => {
    const j = charger();
    // `resistBonus` divise les bonus de contre reçus (voir degatsContre) :
    // c'est la mécanique la plus distinctive du jeu, et elle est INVISIBLE
    // si l'affichage de sélection ne la mentionne pas — ni pour celui qui
    // possède l'unité, ni pour l'adversaire dont les contres sous-performent.
    const porteuses = Object.entries(j.UDEF).filter(([, d]) => d.resistBonus != null && d.resistBonus !== 1);
    ok(porteuses.length, 'plus aucune unité ne porte resistBonus : ce test est à revoir');
    const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    const bloc = ui.slice(ui.indexOf('const stateLabels'), ui.indexOf('// ── PANNEAU RECHERCHE'));
    ok(/resistBonus/.test(bloc),
      'l\'affichage de sélection ne mentionne jamais resistBonus : la résistance aux contres reste invisible');
    // Et la mécanique fait bien ce que l'affichage annoncera : le bonus reçu
    // est réduit dans cette proportion exacte, pas l'attaque de base.
    for (const [type, d] of porteuses) {
      const cible = { type, owner: j.G.me };
      const contre = Object.entries(j.BONUS).find(([, b]) => b[d.cls] > 0);
      if (!contre) continue;
      const [tAtt, bonus] = contre;
      const attaquant = { type: tAtt, atk: 10 };
      const attendu = Math.max(1, Math.round(10 + Math.round(bonus[d.cls] * d.resistBonus) - (d.armor[j.UDEF[tAtt].atkType] || 0)));
      egal(j.degatsContre(attaquant, cible), attendu,
        `resistBonus de ${d.nom} n'est pas appliqué comme annoncé`);
    }
  });

  test('une civilisation n\'annonce que ce qui lui est propre', () => {
    const j = charger();
    // Le Paladin s'obtient par une recherche ouverte à tous (RDEF.faith, sans
    // champ `civ`) : aucune civilisation ne peut le présenter comme un trait
    // distinctif. Même règle pour toute recherche non exclusive.
    const commun = Object.keys(j.RDEF).filter((k) => !j.RDEF[k].civ);
    ok(commun.includes('faith'), 'RDEF.faith est devenue exclusive : ce test est à revoir');
    for (const [ck, c] of Object.entries(j.CIVS)) {
      ok(!/Paladin/i.test(c.desc),
        `la civilisation « ${c.nom} » (${ck}) annonce le Paladin, que les quatre camps peuvent former`);
      // Et l'unité exclusive annoncée, quand il y en a une, existe vraiment.
      if (c.unique) ok(j.UDEF[c.unique], `l'unité exclusive de « ${c.nom} » n'existe pas dans UDEF`);
    }
  });

  test('Merveille : victoire seulement APRÈS le délai, et pas avant', () => {
    const j = partie(charger(), { graine: 4242 });
    riche(j);
    const f = j.moi(); f.age = 3;
    const p = caseLibre(j, 60, 60, 3, 3);
    const w = batir(j, j.BT.WONDER, p.tx, p.ty);
    // Phase 1, BOUT EN BOUT : le vrai update() doit faire tourner le compte à
    // rebours, et ne rien accorder tant qu'il n'est pas échu.
    for (let k = 0; k < 300; k++) j.update(j.SIM_DT);
    egal(j.G.victory, false, `la Merveille donne la victoire avant les ${j.MERVEILLE_WIN_TIME} s réglementaires`);
    ok(w.wonderTimer > 0, "update() ne fait pas avancer wonderTimer : la phase 2 ne prouverait plus que la règle est branchée");
    // Phase 2 : on pousse le seul minuteur, sans faire tourner dix minutes de
    // partie complète. Ce test simulait auparavant le délai entier avec
    // update() ; à 600 s (contre 300), l'IA rase la base d'un joueur qui ne
    // fait RIEN d'autre que poser sa Merveille, et le test échouait sur une
    // défaite — vrai fait de jeu, mais qui n'est pas ce qu'il garde.
    for (let k = 0; k < 30 * (j.MERVEILLE_WIN_TIME + 20) && !f.merveilleAchevee; k++) j.updateWonders(j.SIM_DT);
    egal(f.merveilleAchevee, true, "le seuil de la Merveille n'est jamais franchi");
    egal(j.checkMerveilleVictory(), true, 'la Merveille achevée et tenue ne donne pas la victoire');
    egal(j.G.victory, true, "la victoire par Merveille n'est pas affichée");
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
      "l'IA vise " + j.BDEF[cible.type].nom + " au lieu de la Merveille, qui gagne la partie en " + Math.round(j.MERVEILLE_WIN_TIME / 60) + " min");
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
    // DÉRIVÉ de CIVS, comme la liste du groupe `civilisations` : la table
    // était écrite en dur, donc une civilisation ajoutée n'était jamais
    // vérifiée ici — son IA aurait pu ne jamais former son unité unique sans
    // qu'un seul test rougisse.
    const attendu = {};
    for (const [k, c] of Object.entries(j.CIVS)) if (c.unique) attendu[k] = c.unique;
    ok(Object.keys(attendu).length >= 3, 'aucune unité unique à vérifier');
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

  // ══ FORTIFICATION (chantier « murs de l'IA », écarté à l'audit du
  // 2026-08-28, repris le 2026-09-07 sous une forme volontairement bornée :
  // une LIGNE tournée vers l'ennemi, jamais un anneau) ══════════════

  test("l'IA fortifie sa base d'une ligne de palissade tournée vers l'ennemi, jamais un anneau fermé", () => {
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    a.age = 1;
    riche(j, a.id);
    for (let i = 0; i < 6; i++) j.G.units.push(j.mkUnit(j.UT.VIL, a.baseX, a.baseY, a.id));
    j.rebuildIndex();
    // aiFortify plafonne les chantiers SIMULTANÉS (AI_WALL_MAX_SITES), pas le
    // total : chaque passage termine aussitôt ce qui est en cours (comme le
    // ferait le temps réel) pour laisser l'arc progresser jusqu'à épuisement
    // des cases plaçables.
    for (let k = 0; k < 60; k++) {
      j.aiFortify(a);
      for (const b of j.G.buildings)
        if (b.owner === a.id && b.constructing && (b.type === j.BT.WALL || b.type === j.BT.GATE)) { b.constructing = false; b.progress = 1; }
    }
    const murs = j.G.buildings.filter((b) => b.owner === a.id && (b.type === j.BT.WALL || b.type === j.BT.GATE));
    ok(murs.length >= 10, `l'IA n'a posé que ${murs.length} section(s) de palissade`);
    const portails = murs.filter((b) => b.type === j.BT.GATE);
    egal(portails.length, 1, `l'IA pose ${portails.length} portail(s) au lieu d'un seul`);
    ok(portails[0].open === true, "le portail de l'IA n'est pas ouvert — elle se couperait elle-même de sa propre armée");
    // Jamais un anneau fermé : aucune section ne doit se trouver au DOS de la
    // base (à plus de 135° de la direction de l'ennemi) — sans quoi un
    // gisement de ce côté pourrait s'y retrouver enfermé.
    const cible = j.aiCibleBase(a);
    const ang0 = Math.atan2(cible.y - a.baseY, cible.x - a.baseX);
    const auDos = murs.some((b) => {
      let diff = Math.abs(Math.atan2(b.y - a.baseY, b.x - a.baseX) - ang0);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      return diff > Math.PI * 0.75;
    });
    ok(!auDos, "une section de palissade se trouve au DOS de la base : ce n'est plus une ligne, c'est un anneau");
  });

  test("la palissade de l'IA saute un gisement plutôt que de le recouvrir ou le vider", () => {
    // `poserMursArene` (palissade de DÉPART, avant toute économie) dégage les
    // gisements pris sur son tracé — sans rien à perdre, à ce moment-là.
    // `aiFortify` tourne en pleine partie : recopier ce geste raserait une
    // ressource que l'IA exploite peut-être déjà. Elle doit SAUTER la case.
    const j = partie(charger(), { graine: 4242 });
    const a = j.G.factions.ia;
    a.age = 1;
    riche(j, a.id);
    const cible = j.aiCibleBase(a);
    ok(!!cible, 'aucune base hostile trouvée : le test ne prouve rien');
    const ang0 = Math.atan2(cible.y - a.baseY, cible.x - a.baseX);
    const cx = Math.round(a.baseX / j.BASE_TILE), cy = Math.round(a.baseY / j.BASE_TILE);
    // Première case de l'arc (même formule que dans aiFortify, i=0) : un
    // gisement y est planté AVANT le premier passage.
    const ang = ang0 - j.AI_WALL_SPAN / 2;
    const gx = Math.round(cx + Math.cos(ang) * j.AI_WALL_R), gy = Math.round(cy + Math.sin(ang) * j.AI_WALL_R);
    j.G.bmap[gy][gx] = 2;
    j.G.nodes.push({ id: j.G.nid++, type: j.RT.TREE, tx: gx, ty: gy,
      x: (gx + 0.5) * j.BASE_TILE, y: (gy + 0.5) * j.BASE_TILE, amt: 100, max: 100, gatherers: [] });
    j.rebuildIndex();
    for (let k = 0; k < 60; k++) {
      j.aiFortify(a);
      for (const b of j.G.buildings)
        if (b.owner === a.id && b.constructing && (b.type === j.BT.WALL || b.type === j.BT.GATE)) { b.constructing = false; b.progress = 1; }
    }
    egal(j.G.bmap[gy][gx], 2, "l'IA a recouvert le gisement d'un mur au lieu de sauter la case");
    const survivant = j.G.nodes.find((n) => n.tx === gx && n.ty === gy);
    ok(survivant && survivant.amt === 100, "le gisement a été rasé pour faire de la place — acceptable au tout début de partie, pas en pleine économie");
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
  function paireEnLigne({ graine = 4242, vueTotale = true, mode = 'conquest' } = {}) {
    const hote = charger();
    hote.RESEAU.actif = true; hote.RESEAU.role = 'hote';
    hote.RESEAU.adversaire = { id: hote.FAC.P2, nom: 'Invité' };
    hote.RESEAU.tick = 0;
    partie(hote, { graine, mode });      // initState voit RESEAU.actif → crée P2
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
    partie(client, { graine, mode });
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

  test('M_OWNER : une conversion (Wololo) traverse le delta — le client voit le NOUVEAU propriétaire', () => {
    const { hote, client, pousser, tourner } = paireEnLigne();
    const ia = hote.G.factions.ia;
    const cible = hote.mkUnit(hote.UT.MIL, hote.COLS * hote.BASE_TILE / 2, hote.ROWS * hote.BASE_TILE / 2, ia.id);
    hote.G.units.push(cible); hote.rebuildIndex();
    pousser(); tourner(1);
    const avant = client.G.units.find((u) => u.id === cible.id);
    ok(!!avant, "le client ne connaît pas encore l'unité, avant même toute conversion");
    egal(avant.owner, ia.id, "le client devrait d'abord voir l'unité chez l'IA");

    hote.convertirUnite(cible, hote.FAC.P1);
    pousser(); tourner(1);
    const apres = client.G.units.find((u) => u.id === cible.id);
    ok(!!apres, "l'unité a disparu chez le client après sa conversion");
    egal(apres.owner, hote.FAC.P1, "le client n'a pas reçu le changement de propriétaire (bit M_OWNER)");
  });

  test('le petit logo de triche ne s\'affiche PAS sur la toute première valeur reçue (SNAP/reconnexion), seulement sur un VRAI changement', () => {
    const j = partie(charger());
    const notifEl = j.__sandbox.document.getElementById('notif');
    // Simule un client qui rejoint une partie où un code a DÉJÀ servi avant
    // sa connexion : la faction adverse arrive avec un `tr` déjà rempli.
    const d1 = { i: 'p9', g: 'humain', e: 0, t: 'bleu', n: 'Rival', a: 0, p: 0, mp: 5, tr: ['fortune', 12.5] };
    j.appliquerFaction(d1);
    egal(notifEl.children.length, 0, "un badge est apparu à la connexion, pour un code déjà utilisé avant même de rejoindre");
    // Un VRAI nouveau code (horodatage différent), lui, doit avertir.
    j.appliquerFaction(Object.assign({}, d1, { tr: ['polo', 40] }));
    egal(notifEl.children.length, 1, "aucun badge n'est apparu pour un nouveau code, après la connexion");
    // Rejouer le MÊME tr ne doit pas réafficher un second badge.
    j.appliquerFaction(Object.assign({}, d1, { tr: ['polo', 40] }));
    egal(notifEl.children.length, 1, 'le même tr (rejoué, ex. un SNAP de reconnexion) a déclenché un second badge');
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

  test('la reparation automatique repare les batiments de l INVITE, pas ceux de l hote', () => {
    // Le test ci-dessus garde que le RÉGLAGE voyage. Celui-ci garde que la
    // FONCTIONNALITÉ marche une fois allumée : nearestDamagedBuilding()
    // tournait sur estLocal() — "appartient à G.me" — jamais sur le
    // propriétaire du villageois qui scanne. update() ne s'exécute que côté
    // hôte, où G.me vaut TOUJOURS la faction de l'hôte, quelle que soit
    // l'unité en cours de traitement dans la boucle : un villageois de P2 au
    // repos cherchait donc des bâtiments endommagés DE L'HÔTE, jamais les
    // siens. Aucune erreur, aucun exploit (doRepair rejette ensuite la cible
    // mal assignée via `_b.owner===u.owner`) — juste un réglage qui restait
    // silencieusement mort pour l'invité, quoi qu'il fasse.
    const { hote } = paireEnLigne();
    const P2 = hote.FAC.P2;
    hote.G.factions[P2].autoRepair = true;
    const tcP2 = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === P2);
    tcP2.hp = Math.round(tcP2.maxHp * 0.3);
    const vilP2 = hote.G.units.find((u) => u.owner === P2 && u.type === hote.UT.VIL);
    vilP2.state = 'idle'; vilP2.target = null;
    const hpAvant = tcP2.hp;
    for (let k = 0; k < 300; k++) hote.update(hote.SIM_DT); // 10 s simulées
    ok(tcP2.hp > hpAvant, `le Centre Ville de l'invité n'a jamais été réparé : ${hpAvant} → ${tcP2.hp}`);
  });

  test('les pics (population, armée) de l INVITE sont suivis, pas seulement ceux de l hote', () => {
    // Même défaut, sur les succès : `G.stats.peakMil=Math.max(...)` ne
    // visait que G.stats, un SHIM vers moi() — donc toujours l'hôte pendant
    // update(). Un second joueur humain qui lève une armée voyait son
    // propre peakMil rester bloqué à 0, et les succès qui en dépendent
    // (Métropole, Grenier Plein, Chef de Guerre, Nettoyeur) hors d'atteinte
    // quoi qu'il construise réellement — checkAchievements(), lui, lit bien
    // G.stats (donc SA faction) sur chaque machine séparément : la SOURCE
    // manquait, pas la lecture.
    const { hote } = paireEnLigne();
    const P2 = hote.FAC.P2;
    for (let i = 0; i < 45; i++) hote.G.units.push(hote.mkUnit(hote.UT.MIL, 2000 + i * 5, 2000, P2));
    hote.rebuildIndex();
    for (let k = 0; k < 40; k++) hote.update(hote.SIM_DT); // laisse le statsTick (1/s) tourner
    egal(hote.G.factions[hote.G.me].stats.peakMil, 0, "l'hôte, qui n'a rien levé, ne doit rien avoir de plus");
    ok(hote.G.factions[P2].stats.peakMil >= 45, `l'armée de l'invité n'a jamais été comptée : ${hote.G.factions[P2].stats.peakMil}`);
  });

  test('le Seigneur de Guerre tué par l INVITE lui revient, pas à l hote', () => {
    // Juste au-dessus de `tueur.stats.killed++` (qui, lui, ciblait déjà la
    // bonne faction), `G.stats.bossKilled++` retombait sur G.stats — encore
    // l'hôte. Le succès « Tueur de Seigneurs » se débloquait donc chez
    // l'hôte même quand c'est l'invité qui avait porté le coup fatal, et
    // jamais chez lui.
    const { hote } = paireEnLigne();
    const P2 = hote.FAC.P2;
    const boss = hote.mkUnit(hote.UT.ENEMI_BOSS, 2100, 2100, hote.FAC.PILL);
    boss.hp = 1;
    hote.G.units.push(boss);
    const tueurP2 = hote.mkUnit(hote.UT.MIL, 2100, 2098, P2);
    hote.G.units.push(tueurP2);
    hote.rebuildIndex();
    hote.dealDmg(boss, 5, tueurP2);
    for (let k = 0; k < 3; k++) hote.update(hote.SIM_DT); // laisse le nettoyage des morts tourner
    egal(hote.G.factions[hote.G.me].stats.bossKilled, 0, "l'hôte, qui n'a rien tué, se voit crédité du kill");
    egal(hote.G.factions[P2].stats.bossKilled, 1, "le kill de l'invité ne lui est jamais revenu");
  });

  test('une unité de l HOTE tuée par l INVITE crédite bien le kill à l INVITE', () => {
    // `if(estLocal(u)){ moi().stats.lost++; } else { ... tueur.stats.killed++ ... }`
    // : quand la victime ÉTAIT G.me (l'hôte), tout le crédit de kill était
    // sauté — ce cas tombait dans le premier `if`, jamais dans le `else` qui
    // seul créditait le tueur. Sans effet en coop (les alliés ne
    // s'entretuent pas), mais bien réel en « 2 rivaux » en ligne, où l'ami
    // rejoint comme ADVERSAIRE hostile : ses kills sur l'hôte ne comptaient
    // jamais, bloquant Premier Sang/Boucher pour lui quoi qu'il fasse.
    const { hote } = paireEnLigne();
    const P2 = hote.FAC.P2;
    const victimeHote = hote.mkUnit(hote.UT.MIL, 500, 500, hote.G.me);
    hote.G.units.push(victimeHote);
    hote.rebuildIndex();
    victimeHote.hp = 0; victimeHote.dernierAgresseur = P2;
    for (let k = 0; k < 3; k++) hote.update(hote.SIM_DT);
    egal(hote.G.factions[P2].stats.killed, 1, "le kill de l'invité sur l'hôte ne lui a jamais été crédité");
    egal(hote.G.factions[hote.G.me].stats.lost, 1, "la perte de l'hôte n'est plus comptée");
  });

  test('le bilan de fin de partie livre enfin les stats au CLIENT — sans lui, tous les correctifs ci-dessus restaient invisibles pour lui', () => {
    // Toutes les corrections qui précèdent (peakMil, bossKilled, killed,
    // lost) rendent le calcul CÔTÉ HÔTE correct pour chaque faction. Mais
    // serialiserFaction() n'inclut jamais `stats` dans le flux régulier
    // (2,1 Ko à lui seul, et ça bouge à quasi chaque image — voir le
    // commentaire de construireDelta) : sans un canal dédié, le CLIENT ne
    // recevait ces valeurs par AUCUN moyen, et voyait donc pour toujours
    // stats.peakMil=0 sur SA PROPRE machine, quoi que l'hôte ait
    // correctement calculé de son côté. Le bilan de fin de partie ('FIN')
    // est ce canal — encore fallait-il qu'il RECOPIE les valeurs reçues
    // dans G.factions[id].stats (pas seulement les afficher), et relance
    // checkAchievements() pour rattraper ce qu'une détection locale trop
    // précoce (avant l'arrivée du message) aurait manqué.
    const { hote, client } = paireEnLigne();
    const P2 = hote.FAC.P2;
    for (let i = 0; i < 45; i++) hote.G.units.push(hote.mkUnit(hote.UT.MIL, 2000 + i * 5, 2000, P2));
    hote.rebuildIndex();
    for (let k = 0; k < 40; k++) hote.update(hote.SIM_DT); // laisse le statsTick (1/s) tourner
    egal(client.G.factions[P2].stats.peakMil, 0, 'le client aurait déjà ces stats sans le bilan : le témoin ne prouve plus rien');

    let capture = null;
    hote.RESEAU.envoi = (m) => { capture = m; return true; };
    hote.envoyerBilanReseau();
    ok(capture && capture.t === 'FIN', 'envoyerBilanReseau() n\'a rien envoyé');
    client.G.me = P2; // le client, c'est l'invité — comme dans toute vraie partie en ligne
    client.appliquerBilanFin(capture);

    ok(client.G.factions[P2].stats.peakMil >= 45, `le bilan n'a pas livré peakMil au client : ${client.G.factions[P2].stats.peakMil}`);
    ok(client.PROFILE.unlocked.includes('warlord'), 'le succès Chef de Guerre ne s\'est jamais débloqué chez le client malgré 45 unités');
  });

  test('un second joueur éliminé TÔT reçoit son bilan sans attendre la fin de la partie de l HOTE', () => {
    // envoyerBilanReseau() n'était appelée QUE depuis showVictory/
    // showGameOver — donc seulement quand G.me (l'hôte LUI-MÊME) gagne ou
    // perd. En coop 2v1 ou 2 rivaux en ligne, chaque camp a son propre
    // Centre Ville : un invité éliminé tôt tombait sur son écran de défaite
    // (stats encore à zéro) bien avant que l'hôte ne termine SA partie —
    // parfois jamais, s'il quitte après sa défaite. La boucle d'élimination
    // envoie maintenant le bilan dès qu'un joueur HUMAIN (pas l'IA) tombe,
    // sans attendre l'hôte.
    const hote = charger();
    hote.RESEAU.actif = true; hote.RESEAU.role = 'hote';
    hote.RESEAU.adversaire = { id: hote.FAC.P2, nom: 'Invité' };
    partie(hote, { graine: 4242, mode: 'conquest2' });
    const P2 = hote.FAC.P2;

    let capture = null;
    hote.RESEAU.envoi = (m) => { capture = m; return true; };
    const tcP2 = hote.G.buildings.find((b) => b.type === hote.BT.TC && b.owner === P2);
    hote.G.buildings = hote.G.buildings.filter((b) => b !== tcP2);
    hote.update(hote.SIM_DT);

    egal(hote.G.factions[P2].vaincu, true, "l'invité n'a pas été éliminé");
    egal(hote.G.gameOver, false, "la partie de l'hôte s'arrête alors qu'il n'a ni gagné ni perdu");
    ok(capture && capture.t === 'FIN', "aucun bilan envoyé alors que l'invité vient d'être éliminé");

    // Et ça ne doit PAS se déclencher pour l'élimination d'une IA — bruit
    // réseau inutile, elle n'a ni PROFILE ni succès.
    capture = null;
    const tcIA = hote.G.buildings.find((b) => b.type === hote.BT.TC && hote.G.factions[b.owner] && hote.G.factions[b.owner].genre === 'ia');
    hote.G.buildings = hote.G.buildings.filter((b) => b !== tcIA);
    hote.update(hote.SIM_DT);
    egal(capture, null, "l'élimination d'une IA a déclenché un envoi de bilan");
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

  // ══ INVARIANT N° 6, v6 : TROIS ÉTATS QUE L'HÔTE FAIT AVANCER ══
  // Ils n'avaient aucun effet sur la simulation — seulement sur ce que
  // l'invité LIT — et c'est pour ça qu'ils avaient échappé aux tests de
  // convergence : deux états peuvent converger parfaitement sur tout ce qui
  // bouge et laisser l'interface du client mentir.

  test("le décompte de la Merveille arrive chez l'invité (il restait figé jusqu'à la victoire)", () => {
    const { hote, client, pousser, tourner } = paireEnLigne();
    const p = caseLibre(hote, 60, 60, 3, 3);
    const w = batir(hote, hote.BT.WONDER, p.tx, p.ty, hote.FAC.P2);
    pousser();
    for (let k = 0; k < 200; k++) { hote.update(hote.SIM_DT); tourner(1); if (k % 10 === 9) pousser(); }
    const wc = client.bldById(w.id);
    ok(!!wc, "la Merveille n'est jamais arrivée chez le client");
    ok(w.wonderTimer > 1, "le décompte n'a pas tourné côté hôte : le test ne prouverait rien");
    ok(Math.abs((wc.wonderTimer || 0) - w.wonderTimer) <= 1.5,
      `décompte figé chez l'invité : ${wc.wonderTimer} contre ${Math.round(w.wonderTimer)} chez l'hôte`);
  });

  test("la route commerciale d'un Marché arrive chez l'invité, et sa suppression aussi", () => {
    const { hote, client, pousser } = paireEnLigne();
    const p1 = caseLibre(hote, 55, 55, 2, 2), m1 = batir(hote, hote.BT.MARKET, p1.tx, p1.ty, hote.FAC.P2);
    const p2 = caseLibre(hote, 70, 70, 2, 2), m2 = batir(hote, hote.BT.MARKET, p2.tx, p2.ty, hote.FAC.P2);
    pousser();
    egal(ordreDe(hote, hote.FAC.P2, 'ROUTE_COMMERCIALE', { bId: m1.id, toId: m2.id }).ok, true, 'la route a été refusée');
    pousser();
    const c1 = client.bldById(m1.id);
    ok(!!c1.tradeRoute, "le panneau de l'invité propose encore « Envoyer une caravane » alors que la route tourne");
    egal(c1.tradeRoute.toId, m2.id, 'la route reçue ne désigne pas le bon Marché');
    ok(Math.abs(c1.tradeRoute.dist - m1.tradeRoute.dist) <= 1, 'la distance reçue est fausse');
    // L'or annoncé par le panneau doit être celui que l'hôte verse.
    egal(client.gainCaravane(c1), hote.gainCaravane(m1), "l'or par trajet diffère entre l'hôte et l'invité");
    // Et l'annulation doit voyager aussi, sinon la route reste affichée à vie.
    egal(ordreDe(hote, hote.FAC.P2, 'ROUTE_COMMERCIALE', { bId: m1.id, toId: null }).ok, true, "l'annulation a été refusée");
    pousser();
    egal(!!client.bldById(m1.id).tradeRoute, false, "la route annulée reste affichée chez l'invité");
  });

  test("le nombre de fermiers d'une Ferme arrive chez l'invité", () => {
    const { hote, client, pousser } = paireEnLigne();
    const p = caseLibre(hote, 58, 58, 2, 2);
    const f = batir(hote, hote.BT.FARM, p.tx, p.ty, hote.FAC.P2);
    const vils = [];
    for (let i = 0; i < 3; i++) { const u = hote.mkUnit(hote.UT.VIL, f.x, f.y, hote.FAC.P2); hote.G.units.push(u); vils.push(u.id); }
    hote.rebuildGrid();
    pousser();
    egal(ordreDe(hote, hote.FAC.P2, 'FERME', { ids: vils, bId: f.id }).ok, true, "l'ordre FERME a été refusé");
    // `b.farmers` n'est pas rempli par l'ordre mais par doFarm, quand le
    // villageois est ARRIVÉ au champ : il faut faire tourner la simulation.
    for (let k = 0; k < 30; k++) hote.update(hote.SIM_DT);
    pousser();
    egal(hote.fermiersDe(f), 3, "l'hôte lui-même ne compte pas 3 fermiers : le test ne prouverait rien");
    egal(client.fermiersDe(client.bldById(f.id)), 3, "le « 👷×N » du panneau de Ferme reste vide chez l'invité");
  });

  // ══ LES RETOURS D'INTERFACE DE L'INVITÉ ══════════════
  // Tout ce que le jeu DIT au joueur était écrit dans update(), qui ne tourne
  // que chez l'hôte : un invité passait un âge sans un son ni une ligne.

  const messages = (j) => {
    const n = j.__sandbox.document.getElementById('notif');
    return (n.children || []).map((c) => c.textContent || '');
  };

  test("l'invité reçoit les retours d'interface de SON camp (il n'en recevait aucun)", () => {
    const { hote, client, pousser } = paireEnLigne();
    const f = hote.G.factions[hote.FAC.P2];
    riche(hote, f.id);
    const avant = messages(client).length;
    f.ageUpQ = { timer: 0.01 };
    for (let k = 0; k < 5; k++) hote.update(hote.SIM_DT);
    pousser();
    const recus = messages(client).slice(avant).join(' | ');
    egal(hote.G.factions[hote.FAC.P2].age, 1, "l'hôte n'a pas fait monter l'invité d'âge : le test ne prouverait rien");
    ok(/atteint/.test(recus), `l'invité est monté d'âge sans un mot — reçu : « ${recus} »`);
  });

  test("un retour est joué UNE fois : la file se vide avec le delta qui l'emporte", () => {
    const { hote, client, pousser } = paireEnLigne();
    const f = hote.G.factions[hote.FAC.P2];
    hote.retour(f.id, 'relique', {});
    egal((f.evq || []).length, 1, "le retour n'a pas été mis en file pour l'invité");
    const avant = messages(client).length;
    pousser();
    egal((f.evq || []).length, 0, 'la file devrait être vidée par le delta qui l\'emporte');
    egal(messages(client).length, avant + 1, "l'invité n'a pas reçu le retour");
    pousser();
    egal(messages(client).length, avant + 1, 'le retour a été rejoué une seconde fois');
  });

  test('un code de retour inconnu ne fait pas tomber le delta', () => {
    const { hote, client, pousser } = paireEnLigne();
    const f = hote.G.factions[hote.FAC.P2];
    f.evq = [['ceci-nexiste-pas', {}], ['relique', {}]];
    const avant = messages(client).length;
    pousser();
    egal(messages(client).length, avant + 1, 'le code inconnu a emporté le retour valide qui le suivait');
  });

  test("un coup reçu produit un chiffre chez l'invité (son combat était muet)", () => {
    const { hote, client, pousser } = paireEnLigne();
    const tc = hote.G.buildings.find((b) => b.owner === hote.FAC.P2 && b.type === hote.BT.TC);
    ok(!!tc, "pas de Centre Ville pour l'invité");
    pousser();
    const avant = (client.G.ftexts || []).length;
    tc.hp -= 200;
    pousser();
    const nouveaux = (client.G.ftexts || []).slice(avant).map((t) => t.txt);
    ok(nouveaux.some((t) => /-200/.test(t)),
      `aucun chiffre de dégâts chez l'invité — obtenu : ${JSON.stringify(nouveaux)}`);
    // Et l'alerte : c'est le retour le plus important de la liste — sans lui,
    // un invité perdait son Centre Ville sans le moindre avertissement.
    ok(messages(client).some((t) => /attaquée/.test(t)),
      "aucune alerte « base attaquée » chez l'invité dont on démolit le Centre Ville");
  });

  // ══ VISION PARTAGÉE ══════════════════════════
  test("un allié éclaire mon brouillard, un ennemi non", () => {
    const j = partie(charger(), { graine: 4242 });
    const moi = j.moi();
    // Deux camps neufs, l'un dans mon équipe, l'autre non, chacun avec une
    // unité dans un coin que je n'ai jamais exploré.
    j.G.factions.copain = j.mkFaction('copain', { genre: 'humain', equipe: moi.equipe, nom: 'Copain' });
    j.G.factions.rival2 = j.mkFaction('rival2', { genre: 'humain', equipe: moi.equipe + 50, nom: 'Rival' });
    const posA = { x: 20 * j.BASE_TILE, y: 20 * j.BASE_TILE };
    const posE = { x: 20 * j.BASE_TILE, y: 60 * j.BASE_TILE };
    j.G.units.push(j.mkUnit(j.UT.MIL, posA.x, posA.y, 'copain'));
    j.G.units.push(j.mkUnit(j.UT.MIL, posE.x, posE.y, 'rival2'));
    j.rebuildGrid();
    j.revealFog();
    egal(j.fogTileDe(moi, 20, 20), 2, "le coin où se tient mon ALLIÉ reste dans le noir");
    ok(j.fogTileDe(moi, 20, 60) !== 2, "le coin où se tient un RIVAL m'est révélé : la vision fuit");
  });

  test("les unités d'un allié arrivent chez l'invité, même hors de sa propre vue", () => {
    const { hote, client, pousser } = paireEnLigne({ vueTotale: false });
    // Coop : l'hôte et l'invité dans la même équipe.
    const p2 = hote.G.factions[hote.FAC.P2];
    p2.equipe = hote.G.factions[hote.FAC.P1].equipe;
    const u = hote.mkUnit(hote.UT.MIL, 25 * hote.BASE_TILE, 25 * hote.BASE_TILE, hote.FAC.P1);
    hote.G.units.push(u);
    hote.rebuildGrid();
    // Calque de l'invité mis à « exploré mais pas visible » PARTOUT : c'est la
    // seule façon d'isoler la clause d'équipe du filtre réseau de l'effet de
    // bord de la vision partagée (qui, elle, aurait de toute façon allumé la
    // case). Ce n'est pas un cas de laboratoire : revealFog tourne à 5 Hz et
    // le delta à 10 Hz, il existe donc une image sur deux où un allié qui
    // vient de bouger n'est pas encore dans le calque.
    for (let y = 0; y < hote.ROWS; y++) for (let x = 0; x < hote.COLS; x++) p2.fog[y][x] = 1;
    pousser();
    ok(!!client.unitById(u.id), "l'unité de mon allié ne m'est jamais transmise");
  });

  test("la vision n'est PAS partagée avec un camp hostile (contrôle négatif)", () => {
    const { hote, client, pousser } = paireEnLigne({ vueTotale: false });
    // Équipes distinctes : c'est le réglage par défaut du 1v1.
    ok(hote.G.factions[hote.FAC.P1].equipe !== hote.G.factions[hote.FAC.P2].equipe, 'les deux camps sont alliés : le contrôle ne prouve rien');
    const u = hote.mkUnit(hote.UT.MIL, 25 * hote.BASE_TILE, 25 * hote.BASE_TILE, hote.FAC.P1);
    hote.G.units.push(u);
    hote.rebuildGrid();
    hote.revealFog();
    pousser();
    egal(!!client.unitById(u.id), false, "une unité ENNEMIE hors de vue est transmise à l'invité : fuite d'information");
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

  // ══ FIN DE PARTIE À DEUX ══════════════════════════
  // Jusqu'ici, rien ne testait une fin de partie EN LIGNE autrement qu'en
  // solo : la paire ci-dessus fait passer les deltas à la main, sans jamais
  // emprunter le transport. Or c'est précisément là que la fin cassait —
  // l'écran de fin de l'hôte refermait la session avant que le dernier état
  // ne parte. On branche donc ici le VRAI transport (RESEAU.envoi), et le
  // client reçoit par recevoirReseau, comme en jeu : seul ce que le code
  // envoie lui-même arrive de l'autre côté.
  function brancherTransport(hote, client) {
    const file = [];
    hote.RESEAU.envoi = (m) => { file.push(JSON.parse(JSON.stringify(m))); return true; };
    hote.RESEAU.pret = true;
    client.RESEAU.role = 'client'; client.RESEAU.pret = true;
    client.RESEAU.envoi = () => true;
    const livrer = () => { while (file.length) client.recevoirReseau(file.shift()); };
    return { file, livrer };
  }
  const raserTC = (j, owner) => {
    for (const b of j.G.buildings.filter((b) => b.owner === owner && b.type === j.BT.TC)) b.hp = 0;
  };

  test("coop : l'hôte éliminé ne fige pas la partie de son allié encore debout", () => {
    const { hote, client } = paireEnLigne({ mode: 'coop2v1' });
    brancherTransport(hote, client);
    raserTC(hote, hote.FAC.P1);
    for (let k = 0; k < 120 && !hote.G.gameOver; k++) hote.update(hote.SIM_DT);
    egal(hote.G.gameOver, true, "l'hôte n'a pas constaté sa propre élimination");
    egal(hote.G.factions[hote.FAC.P2].vaincu, false, "l'allié invité a été éliminé avec l'hôte");
    // L'hôte est le SEUL à simuler : s'il s'arrête, l'invité est figé, puis
    // reçoit « l'hôte a quitté » trois minutes plus tard.
    egal(hote.G.running, true, "la simulation s'est arrêtée alors que l'allié joue encore");
    egal(hote.RESEAU.actif, true, "la session réseau a été fermée alors que l'allié joue encore");
  });

  test("coop : le dernier état part avant la fermeture — l'invité voit la victoire de son équipe", () => {
    const { hote, client, tourner } = paireEnLigne({ mode: 'coop2v1' });
    const { livrer } = brancherTransport(hote, client);
    raserTC(hote, hote.FAC.IA);
    for (let k = 0; k < 120 && !hote.G.victory; k++) hote.update(hote.SIM_DT);
    egal(hote.G.victory, true, "l'hôte n'a pas constaté la victoire de l'équipe");
    livrer(); tourner(1);
    egal(client.G.factions[client.FAC.IA].vaincu, true, "l'élimination du rival n'est jamais parvenue à l'invité");
    egal(client.G.victory, true, "l'invité n'a jamais vu la victoire de son équipe");
  });

  test("coop : l'invité éliminé ne met pas l'hôte en attente de reconnexion", () => {
    const { hote, client } = paireEnLigne({ mode: 'coop2v1' });
    brancherTransport(hote, client);
    raserTC(hote, hote.FAC.P2);
    for (let k = 0; k < 120 && !hote.G.factions[hote.FAC.P2].vaincu; k++) hote.update(hote.SIM_DT);
    egal(hote.G.factions[hote.FAC.P2].vaincu, true, "l'invité n'a pas été éliminé");
    // L'invité éliminé affiche son écran de fin et coupe son pouls : c'est un
    // départ LÉGITIME, pas une coupure. Dix secondes de silence ensuite…
    hote.RESEAU.dernierRecu = Date.now() - 10000;
    hote.verifierVeilleReseau();
    egal(hote.RESEAU.enAttenteReconnexion, false, "l'hôte attend la reconnexion d'un joueur éliminé");
    egal(hote.G.paused, false, "la partie de l'hôte est gelée par le départ d'un joueur éliminé");
  });

  test("coop : l'hôte éliminé en spectateur ferme la session quand son allié l'emporte", () => {
    const { hote, client, tourner } = paireEnLigne({ mode: 'coop2v1' });
    const { livrer } = brancherTransport(hote, client);
    raserTC(hote, hote.FAC.P1);
    for (let k = 0; k < 120 && !hote.G.gameOver; k++) hote.update(hote.SIM_DT);
    raserTC(hote, hote.FAC.IA);
    for (let k = 0; k < 120 && hote.RESEAU.actif; k++) hote.update(hote.SIM_DT);
    egal(hote.RESEAU.actif, false, "l'hôte spectateur garde la session ouverte après la fin réelle de la partie");
    egal(hote.G.running, false, "l'hôte spectateur simule encore après la fin réelle de la partie");
    livrer(); tourner(1);
    egal(client.G.victory, true, "l'allié resté seul n'a jamais vu sa victoire");
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

  test('la livrée de civilisation ne relit JAMAIS les pixels d\'un sprite', () => {
    // Mesuré en jeu sur un camp de 39 bâtiments : la première image après un
    // changement de zoom passait de 3,6 ms (Francs) à 219 ms (Gitanos). Toute
    // la différence tenait à UN appel — `getImageData`, pour retrouver après
    // coup le rectangle réellement peint dans le canevas. Une lecture coûte
    // 24 ms à froid puis 2 à 4 ms, là où peindre la livrée elle-même en coûte
    // 0,4. Le rectangle est donc NOTÉ à la construction du sprite
    // (`fitBuildingImage`, `buildBuildings`) et transporté par toutes les
    // copies (teinte d'équipe, lavis ennemi, fondu du portail, dégâts).
    //
    // Le test COMPTE les lectures de pixels, il ne les rend pas fatales :
    // `_contentBox` avale l'échec dans un try/catch (canevas « taint »), un
    // test par exception passerait donc à vide. Les deux moitiés sont
    // vérifiées : avec une boîte, zéro lecture ; sans boîte, au moins une —
    // sans quoi le test ne prouverait plus rien le jour où le repli change.
    const j = charger();
    const doc = j.__sandbox.document;
    const creerVrai = doc.createElement.bind(doc);
    let lectures = 0;
    const espionner = (el) => {
      const cx = el.getContext('2d');
      const vrai = cx.getImageData.bind(cx);
      cx.getImageData = (...a) => { lectures++; return vrai(...a); };
      return el;
    };
    doc.createElement = (tag) => {
      const el = creerVrai(tag);
      return String(tag).toLowerCase() === 'canvas' ? espionner(el) : el;
    };
    const sprite = (avecBoite) => {
      const c = espionner(creerVrai('canvas'));
      c.width = 120; c.height = 180;
      const s = { c, cx: c.getContext('2d') };
      if (avecBoite) s.box = { minX: 0, minY: 20, maxX: 120, maxY: 180 };
      return s;
    };

    j.resetLiveryBudget();
    const avec = sprite(true);
    lectures = 0;
    const orne = j.liverySprite(avec, 'gitanos', j.BT.HOUSE, 'HO');
    ok(orne && orne.c !== avec.c, 'la livrée n\'a produit aucun sprite');
    egal(lectures, 0, 'la livrée relit les pixels alors que la boîte est connue');
    egalJSON(orne.box, avec.box, 'la livrée perd la boîte : la copie suivante la relirait');

    j.resetLiveryBudget();
    lectures = 0;
    j.liverySprite(sprite(false), 'gitanos', j.BT.HOUSE, 'HO2');
    ok(lectures > 0, 'sans boîte, la livrée ne relit plus les pixels : ce test ne prouve plus rien');
    doc.createElement = creerVrai;
  });

  test('tout sprite de bâtiment porte la boîte de son contenu peint', () => {
    // L'autre moitié de l'invariant ci-dessus : la boîte doit être posée sur
    // TOUTES les clés de SPR.bld, variantes comprises (âges du Centre Ville,
    // niveaux de la Tour, portail ouvert, versions ennemies). Une seule clé
    // oubliée et c'est ce bâtiment-là qui repart en lecture de pixels, une
    // fois par teinte d'équipe et à chaque changement de zoom.
    const j = partie(charger(), { graine: 4242 });
    const SPR = j.lire('SPR');
    const cles = Object.keys(SPR.bld || {});
    ok(cles.length > 20, 'aucun sprite de bâtiment construit : le test ne prouverait rien');
    const sans = cles.filter((k) => {
      const b = SPR.bld[k] && SPR.bld[k].box;
      return !b || !(b.maxX > b.minX) || !(b.maxY > b.minY);
    });
    ok(!sans.length, sans.length + ' sprite(s) sans boîte : ' + sans.slice(0, 8).join(', '));
  });

  test('la surcouche illustrée est ÉTALÉE en tranches, jamais entassée en une étape', () => {
    // L'atlas se reconstruit à chaque changement de zoom, une étape par IMAGE.
    // C'est donc la PLUS LOURDE des étapes qui décide de l'à-coup ressenti, pas
    // leur total : une étape à 24 ms coûte une image perdue à chaque geste de
    // zoom, quel que soit le soin mis à étaler le reste.
    // Le découpage d'origine partageait BDEF au NOMBRE de types et laissait la
    // surcouche illustrée entière (générique 8,5 ms + par civilisation 15,7 ms)
    // accrochée à la seconde moitié — alors que le procédural qu'elle
    // accompagnait ne coûtait, lui, que 1,5 ms. Mesuré en jeu réel : pire image
    // 50,7 ms avant, 21,3 ms après.
    // Ce test ne chronomètre rien (une mesure de temps serait instable en CI) :
    // il tient la STRUCTURE dont le temps découle — les deux surcouches sont
    // bien appelées par tranches, ces tranches pavent exactement la liste des
    // types, et buildBuildings passe avant elles.
    const j = partie(charger(), { graine: 4242 });
    const S = j.__sandbox;
    // Les tables sont des `const` de haut niveau : elles vivent dans la portée
    // lexicale du script, pas sur l'objet global du vm — d'où lire(), comme
    // pour SPR ailleurs dans ce fichier. Les FONCTIONS, elles, sont bien sur
    // l'objet global, donc remplaçables par une espionne juste en dessous.
    const nbIll = Object.keys(j.lire('BLD_SPRITE_FILES')).length;
    const nbCiv = Object.keys(j.lire('BLD_CIV_SPRITE_FILES')).length;
    ok(nbIll > 4 && nbCiv > 4, 'trop peu de types illustrés : le test ne prouverait rien');

    const vus = { ill: [], civ: [], bat: [] };
    const vrais = {
      ill: S.upgradeBuildingSprites, civ: S.upgradeCivBuildingSprites, bat: S.buildBuildings,
    };
    let rang = 0;
    S.upgradeBuildingSprites = (a, b) => { vus.ill.push({ a, b, rang: rang }); };
    S.upgradeCivBuildingSprites = (a, b) => { vus.civ.push({ a, b, rang: rang }); };
    S.buildBuildings = () => { vus.bat.push({ rang: rang }); };
    try {
      const etapes = S.etapesAtlas(24);   // petit T : on veut la structure, pas des pixels
      etapes.forEach((e, i) => { rang = i; e(); });
    } finally {
      S.upgradeBuildingSprites = vrais.ill;
      S.upgradeCivBuildingSprites = vrais.civ;
      S.buildBuildings = vrais.bat;
    }

    // Chaque surcouche est bien COUPÉE, et pas jouée d'un bloc.
    ok(vus.ill.length >= 2, 'la surcouche générique n\'est pas découpée (' + vus.ill.length + ' étape)');
    ok(vus.civ.length >= 2, 'la surcouche par civilisation n\'est pas découpée (' + vus.civ.length + ' étape)');

    // Les tranches PAVENT la liste : aucun type oublié, aucun fait deux fois.
    // Un type oublié, c'est un bâtiment qui repart en sprite procédural au
    // premier zoom ; un type traité deux fois, c'est du travail payé en double.
    const pave = (liste, n, quoi) => {
      const tri = liste.slice().sort((x, y) => x.a - y.a);
      let bord = 0;
      for (const t of tri) {
        egal(t.a, bord, quoi + ' : trou ou recouvrement à la tranche ' + JSON.stringify(t));
        ok(t.b > t.a, quoi + ' : tranche vide ' + JSON.stringify(t));
        bord = t.b;
      }
      egal(bord, n, quoi + ' : les tranches s\'arrêtent à ' + bord + ' au lieu de ' + n);
    };
    pave(vus.ill, nbIll, 'surcouche générique');
    pave(vus.civ, nbCiv, 'surcouche par civilisation');

    // ORDRE : buildBuildings remet SPR.bld/SPR.bldCiv à zéro, il doit donc
    // passer AVANT toute surcouche — sinon elle serait effacée juste après.
    const premiereSurcouche = Math.min(...vus.ill.concat(vus.civ).map((t) => t.rang));
    ok(vus.bat.length > 0, 'buildBuildings n\'est plus appelé par etapesAtlas');
    ok(Math.max(...vus.bat.map((t) => t.rang)) < premiereSurcouche,
      'buildBuildings passe APRÈS une surcouche : elle serait effacée');
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

groupe('triche', () => {
  test('le Wololo a des PV énormes et une vitesse très inférieure à toute autre unité', () => {
    const j = charger();
    const w = j.UDEF[j.UT.WOLOLO];
    const autres = Object.keys(j.UDEF).filter((t) => t !== j.UT.WOLOLO).map((t) => j.UDEF[t]);
    ok(w.hp > Math.max(...autres.map((d) => d.hp)),
      `le Wololo (${w.hp} PV) devrait dépasser toute autre unité (max ${Math.max(...autres.map((d) => d.hp))})`);
    ok(w.spd < Math.min(...autres.map((d) => d.spd)),
      `le Wololo (vitesse ${w.spd}) devrait être plus lent que toute autre unité (min ${Math.min(...autres.map((d) => d.spd))})`);
  });

  test('convertit une unité hostile À PORTÉE, pas une hors de portée', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const wo = j.mkUnit(j.UT.WOLOLO, tc.x, tc.y, j.G.me);
    j.G.units.push(wo);
    const proche = j.mkUnit(j.UT.ENEMI_C, tc.x + j.WOLOLO_RADIUS * 0.5, tc.y, j.G.factions.ia.id);
    const loin = j.mkUnit(j.UT.ENEMI_C, tc.x + j.WOLOLO_RADIUS * 3, tc.y, j.G.factions.ia.id);
    j.G.units.push(proche, loin);
    j.rebuildIndex(); j.rebuildGrid();
    // WOLOLO_TICK + marge, en plusieurs pas (comme le ferait update() via loop()).
    for (let i = 0; i < 20; i++) j.updateWololo(j.WOLOLO_TICK / 10);
    egal(proche.owner, j.G.me, "l'unité à portée n'a pas été convertie");
    egal(loin.owner, j.G.factions.ia.id, "l'unité hors de portée a été convertie à tort");
  });

  test('ne touche pas une unité déjà alliée', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const tc = j.G.buildings.find((b) => b.type === j.BT.TC && j.estLocal(b));
    const wo = j.mkUnit(j.UT.WOLOLO, tc.x, tc.y, j.G.me);
    const allie = j.mkUnit(j.UT.MIL, tc.x + j.BASE_TILE, tc.y, j.G.me);
    j.G.units.push(wo, allie);
    j.rebuildIndex(); j.rebuildGrid();
    for (let i = 0; i < 20; i++) j.updateWololo(j.WOLOLO_TICK / 10);
    egal(allie.owner, j.G.me, 'un allié a été « converti » par son propre camp');
  });

  test('la conversion ajuste la population des DEUX factions', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const ia = j.G.factions.ia;
    const cible = j.mkUnit(j.UT.MIL, 0, 0, ia.id);
    j.G.units.push(cible); j.rebuildIndex();
    const popIaAvant = ia.pop, popMoiAvant = j.moi().pop;
    j.convertirUnite(cible, j.G.me);
    egal(ia.pop, popIaAvant - 1, "la population de l'ancien propriétaire n'a pas baissé");
    egal(j.moi().pop, popMoiAvant + 1, "la population du nouveau propriétaire n'a pas monté");
    egal(cible.owner, j.G.me, "convertirUnite n'a pas changé le propriétaire");
  });

  test('un villageois converti quitte le gisement où il récoltait', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const ia = j.G.factions.ia;
    const node = j.G.nodes.find((n) => n.type === j.RT.TREE && n.amt > 0);
    const vil = j.mkUnit(j.UT.VIL, node.x, node.y, ia.id);
    vil.homeNode = node.id;
    node.gatherers.push(vil.id);
    j.G.units.push(vil); j.rebuildIndex();
    j.convertirUnite(vil, j.G.me);
    ok(!node.gatherers.includes(vil.id), "le villageois converti est resté dans la liste des récolteurs de l'ancien camp");
    egal(vil.homeNode, null, 'homeNode aurait dû être libéré par quitterPoste');
    egal(vil.state, 'idle', "l'unité convertie devrait repartir idle, pas dans son ancien état");
  });

  test('CHEATS.fortune ajoute 1000 à chaque ressource DU CAMP PASSÉ EN PARAMÈTRE', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const ia = j.G.factions.ia;
    const avantMoi = Object.assign({}, j.G.res);
    const avantIa = Object.assign({}, j.resPool(ia.id));
    j.CHEATS.fortune.run(ia.id);
    for (const r of ['food', 'wood', 'stone', 'gold']) {
      egal(j.resPool(ia.id)[r], avantIa[r] + 1000, `${r} de l'IA n'a pas reçu +1000`);
      egal(j.G.res[r], avantMoi[r], `fortune(ia.id) a modifié MES ressources au lieu de celles de l'IA`);
    }
  });

  test('CHEATS.polo révèle le brouillard DU CAMP PASSÉ EN PARAMÈTRE, sans jamais rétrograder une case déjà visible', () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.G.fog[5][5] = 0; j.G.fog[6][6] = 2;
    j.CHEATS.polo.run(j.G.me);
    egal(j.G.fog[5][5], 1, 'une case inexplorée devrait passer à 1 (explorée)');
    egal(j.G.fog[6][6], 2, 'une case déjà VISIBLE (2) ne doit jamais redescendre à 1');
  });

  test('CHEATS.polo est sans effet mais ne plante pas pour un camp SANS brouillard (l\'IA voit déjà tout)', () => {
    // L'IA et les pillards n'ont pas de calque de brouillard du tout
    // (initFog, js/02-etat.js — ils voient toute la carte par construction) :
    // .fog reste [] à vie pour eux. run() doit le détecter proprement plutôt
    // que de lever en indexant un tableau vide.
    const j = partie(charger(), { mode: 'conquest' });
    const ia = j.G.factions.ia;
    ok(!ia.fog.length, "prérequis du test invalide : l'IA a un vrai calque de brouillard");
    const r = j.CHEATS.polo.run(ia.id);
    ok(typeof r === 'string' && r.length > 0, 'run() aurait dû renvoyer un message, pas planter');
  });

  test('ORD.TRICHE fonctionne aussi en HÉBERGEANT une partie en ligne, pas seulement en solo', () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.RESEAU.actif = true; j.RESEAU.role = 'hote'; // « j'héberge », pas « je suis solo »
    const nAvant = j.G.units.filter((u) => u.type === j.UT.WOLOLO).length;
    const r = ordreDe(j, j.G.me, 'TRICHE', { code: 'wololo' });
    ok(r.ok, `le code aurait dû être accepté en ligne : ${JSON.stringify(r)}`);
    egal(j.G.units.filter((u) => u.type === j.UT.WOLOLO).length, nAvant + 1, 'aucun Wololo supplémentaire malgré RESEAU.actif');
  });

  test('ORD.TRICHE crédite le camp qui a VRAIMENT tapé le code (cmd.f), jamais G.me en dur', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const ia = j.G.factions.ia;
    const avantMoi = Object.assign({}, j.G.res), avantIa = Object.assign({}, j.resPool(ia.id));
    const r = ordreDe(j, ia.id, 'TRICHE', { code: 'fortune' });
    ok(r.ok, `refusé : ${JSON.stringify(r)}`);
    egal(j.resPool(ia.id).food, avantIa.food + 1000, "l'IA (émettrice réelle de l'ordre) n'a pas reçu la fortune");
    egal(j.G.res.food, avantMoi.food, "G.me a reçu la fortune alors que c'est l'IA qui a émis l'ordre");
  });

  test('ORD.TRICHE avec un code inconnu est refusé proprement', () => {
    const j = partie(charger(), { mode: 'conquest' });
    egal(ordreDe(j, j.G.me, 'TRICHE', { code: 'ceci-nexiste-pas' }).ok, false, 'un code inconnu aurait dû être refusé');
  });

  test('ORD.TRICHE pose f.dernierTriche et affiche le petit logo localement (annoncerTriche)', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const notifEl = j.__sandbox.document.getElementById('notif');
    const avant = notifEl.children.length;
    ordreDe(j, j.G.me, 'TRICHE', { code: 'fortune' });
    ok(!!j.moi().dernierTriche, 'f.dernierTriche aurait dû être posé après un code accepté');
    egal(j.moi().dernierTriche[0], 'fortune', 'dernierTriche ne porte pas le bon code');
    egal(notifEl.children.length, avant + 1, "aucun badge (notify) n'est apparu après le code");
  });

  test('un code inconnu tapé dans le terminal ne fait planter ni la partie ni le terminal', () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.__sandbox.document.getElementById('cheatinput').value = 'ceci-nexiste-pas';
    ok(j.soumettreCheat({ preventDefault() {} }) === false, 'soumettreCheat devrait retourner false (bloque le submit du <form>)');
  });

  test('le code wololo tapé dans le terminal invoque une unité UT.WOLOLO appartenant au joueur local', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const nAvant = j.G.units.filter((u) => u.type === j.UT.WOLOLO).length;
    j.__sandbox.document.getElementById('cheatinput').value = 'WOLOLO'; // insensible à la casse
    j.soumettreCheat({ preventDefault() {} });
    const wolos = j.G.units.filter((u) => u.type === j.UT.WOLOLO);
    egal(wolos.length, nAvant + 1, 'aucun Wololo supplémentaire trouvé après le code');
    ok(wolos[wolos.length - 1].owner === j.G.me, "le Wololo invoqué n'appartient pas au joueur local");
  });
});

// ══ PASSE DE CONTRÔLE « L'INTERFACE PROMET X » ═════════════
// Même famille que le groupe `finpartie` : on ne vérifie pas qu'un mécanisme
// marche, on vérifie qu'il fait ce que le jeu ANNONCE au joueur. Les cinq
// écarts ci-dessous ont tous été trouvés à la lecture, aucun n'était attrapé
// par la suite d'avant — et aucun ne fait planter quoi que ce soit, ce qui
// est précisément pourquoi ils avaient survécu.
groupe('promesses', () => {

  // ── 1. Recherches rétroactives ──────────────────────
  // `mkUnit` pose les bonus à la NAISSANCE, updateResearchFaction les
  // rattrape sur les unités DÉJÀ en jeu. Les deux doivent viser exactement
  // les mêmes types, sans quoi deux exemplaires du même type n'ont pas les
  // mêmes statistiques selon leur date de naissance.
  const chercher = (j, owner, type) => {
    const f = j.fac(owner);
    f.researchQ = [{ type, timer: 0.01 }];
    j.updateResearchFaction(1, f);
    egal(f.research[type], true, `la recherche ${type} n'est pas terminée`);
  };

  // Une unité posée AVANT la recherche, puis une posée APRÈS : à la fin,
  // elles doivent être identiques. Cette formulation attrape les deux sens
  // de l'erreur (liste trop courte d'un côté ou de l'autre).
  const memeStatAvantApres = (j, type, tech, champ) => {
    const avant = j.mkUnit(type, 100, 100, j.G.me);
    j.G.units.push(avant);
    chercher(j, j.G.me, tech);
    const apres = j.mkUnit(type, 100, 100, j.G.me);
    return { avant: avant[champ], apres: apres[champ] };
  };

  for (const [tech, champ, types] of [
    ['bow_craft', 'atk', ['ARBRAP', 'CAVARC']],
    ['cavalry', 'maxHp', ['CATA', 'CAVARC']],
    ['cavalry_lance', 'atk', ['CATA', 'CAVARC']],
  ]) {
    for (const nom of types) {
      test(`${tech} : un ${nom} déjà sur la carte reçoit le même bonus qu'un ${nom} formé après`, () => {
        const j = partie(charger(), { mode: 'conquest' });
        const r = memeStatAvantApres(j, j.UT[nom], tech, champ);
        egal(r.avant, r.apres,
          `${champ} d'un ${nom} né avant la recherche ≠ né après — la liste rétroactive de ${tech} ne couvre pas ce type`);
      });
    }
  }

  test('les listes de bonus de recherche sont PARTAGÉES, pas recopiées', () => {
    const j = charger();
    ok(j.RANGED_BONUS_TYPES.includes(j.UT.ARBRAP) && j.RANGED_BONUS_TYPES.includes(j.UT.CAVARC),
      'RANGED_BONUS_TYPES a perdu une unité unique de tir');
    ok(j.CAV_BONUS_TYPES.includes(j.UT.CATA) && j.CAV_BONUS_TYPES.includes(j.UT.CAVARC),
      'CAV_BONUS_TYPES a perdu une unité unique de cavalerie');
    // Les archétypes des vagues ennemies n'ont rien à faire là : ce sont les
    // recherches du roster JOUABLE.
    for (const t of [j.UT.ENEMI, j.UT.ENEMIA, j.UT.ENEMI_C, j.UT.ENEMI_BOSS])
      ok(!j.CAV_BONUS_TYPES.includes(t) && !j.RANGED_BONUS_TYPES.includes(t) && !j.MELEE_BONUS_TYPES.includes(t),
        'un archétype ennemi est entré dans une liste de bonus de recherche');
    // Roulotte : `siege_smithing` annonce « Béliers et Trébuchets ».
    ok(!j.SIEGE_BONUS_TYPES.includes(j.UT.ROUL),
      'la Roulotte est entrée dans SIEGE_BONUS_TYPES, dans le dos du libellé de Forge de Siège');
  });

  // ── 2. Re-semis gratuit des Francs, IA comprise ─────────
  // aiResemer et non updateUneIA : au meme tic l'IA achete aussi des
  // batiments, des unites et des recherches, et sa depense totale ne dit plus
  // rien du re-semis. C'est ce qui a rendu la premiere version de ce test
  // illisible (150 bois depenses pour un re-semis a 30).
  const semisIA = (civ) => {
    const j = partie(charger(), { mode: 'conquest' });
    const a = j.G.factions.ia;
    a.civ = civ;
    riche(j, a.id);
    const p = caseLibre(j, Math.round(a.baseX / j.BASE_TILE) + 4, Math.round(a.baseY / j.BASE_TILE) + 4, 2, 2);
    const ferme = batir(j, j.BT.FARM, p.tx, p.ty, a.id);
    ferme.foodLeft = 0;
    const bois = a.res.wood;
    j.aiResemer(a);
    return { j, ferme, depense: bois - a.res.wood };
  };

  test('une IA franque ne paie pas son re-semis, comme le joueur franc', () => {
    const r = semisIA('francs');
    egal(r.ferme.foodLeft, r.j.FARM_FOOD, "le champ de l'IA n'a pas été re-semé");
    egal(r.depense, 0, "l'IA franque a payé son re-semis alors que sa civilisation l'en dispense");
  });

  test("une IA NON franque paie bien son re-semis (sans quoi le test précédent ne prouverait rien)", () => {
    const r = semisIA('mongols');
    egal(r.ferme.foodLeft, r.j.FARM_FOOD, "le champ de l'IA n'a pas été re-semé");
    egal(r.depense, r.j.FARM_RESEED_COST.wood, "l'IA mongole n'a pas payé son re-semis");
  });

  // ── 3. « Allié » veut dire ÉQUIPE ────────────────────
  // Le cercle du Héros est dessiné en doré pour un coéquipier (drawHeroAuras)
  // et la fiche annonce « aux alliés proches » : l'aura doit donc porter à
  // l'échelle de l'équipe, pas du seul propriétaire.
  const coop = () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.G.factions.allie = j.mkFaction('allie', { genre: 'humain', equipe: j.moi().equipe, nom: 'Allié' });
    return j;
  };

  test("l'aura du Héros porte sur les unités d'un COÉQUIPIER, comme la fiche le promet", () => {
    const j = coop();
    const hero = j.mkUnit(j.UT.HERO, 500, 500, 'allie');
    const mien = j.mkUnit(j.UT.MIL, 505, 505, j.G.me);
    j.G.units.push(hero, mien);
    j.majHeros();
    ok(j.heroAuraMult(mien) > 1,
      'le Héros du coéquipier dessine un cercle doré sous mes troupes et ne leur donne rien');
  });

  test("l'aura d'un Héros HOSTILE ne profite toujours pas à mes unités", () => {
    const j = coop();
    const hero = j.mkUnit(j.UT.HERO, 500, 500, j.G.factions.ia.id);
    const mien = j.mkUnit(j.UT.MIL, 505, 505, j.G.me);
    j.G.units.push(hero, mien);
    j.majHeros();
    egal(j.heroAuraMult(mien), 1, 'un Héros ennemi galvanise mes troupes');
  });

  test("l'Hospice soigne les unités d'un coéquipier, et jamais celles d'un ennemi", () => {
    const j = coop();
    const p = caseLibre(j, 40, 40, 2, 2);
    const h = batir(j, j.BT.HOSPICE, p.tx, p.ty, j.G.me);
    h.atkCd = 0;
    const dedans = (owner) => {
      const u = j.mkUnit(j.UT.MIL, h.x + 4, h.y + 4, owner);
      u.hp = 10;
      j.G.units.push(u);
      return u;
    };
    const ami = dedans('allie'), ennemi = dedans(j.G.factions.ia.id), mien = dedans(j.G.me);
    j.rebuildGrid();   // et non rebuildIndex : forNearby lit la GRILLE spatiale
    j.updateBuildings(1);
    egal(mien.hp, 10 + j.HOSPICE_HEAL_RATE, "l'Hospice ne soigne même plus mes propres unités");
    egal(ami.hp, 10 + j.HOSPICE_HEAL_RATE, "l'Hospice annonce « unités alliées » et ignore le coéquipier");
    egal(ennemi.hp, 10, "l'Hospice soigne une unité ENNEMIE postée à côté");
  });

  // ── 4. L'ATK affichée d'une Tour est celle qui tire ────────
  test("le panneau d'une Tour ne peut plus annoncer une ATK que la Tour ne tire pas", () => {
    const j = partie(charger(), { mode: 'conquest' });
    const p = caseLibre(j, 40, 40, 1, 2);
    const tour = batir(j, j.BT.TOWER, p.tx, p.ty, j.G.me);
    const brut = j.TOWER_LEVELS[1].atk;
    egal(j.bldAtk(tour, 0), brut, 'une Tour nue ne tire pas le chiffre de son palier');
    const cap = j.garnBonusCap(tour);
    egal(j.bldAtk(tour, 2), brut + 8, 'la garnison de la Tour ne compte pas dans son ATK');
    egal(j.bldAtk(tour, cap + 5), brut + cap * 4, 'le plafond de garnison ne tient plus');
    // Feu Grégeois : APRÈS la garnison, donc il multiplie aussi son apport.
    j.moi().research.feu_gregeois = true;
    egal(j.bldAtk(tour, 2), Math.round((brut + 8) * 1.3), "le Feu Grégeois ne s'applique plus à la Tour");
  });

  test("le tir réel d'une Tour passe bien par bldAtk (sinon l'affichage corrigé mentirait à l'envers)", () => {
    const j = partie(charger(), { mode: 'conquest' });
    const p = caseLibre(j, 40, 40, 1, 2);
    const tour = batir(j, j.BT.TOWER, p.tx, p.ty, j.G.me);
    tour.atkCd = 0;
    j.moi().research.feu_gregeois = true;
    const cible = j.mkUnit(j.UT.ENEMI, tour.x + j.BASE_TILE * 2, tour.y, j.G.factions.ia.id);
    j.G.units.push(cible);
    j.rebuildGrid();   // idem : sans la grille, la Tour ne voit personne
    const avant = (j.G.projs || []).length;
    j.updateBuildings(0.1);
    const tirs = (j.G.projs || []).slice(avant);
    ok(tirs.length > 0, "la Tour n'a pas tiré : le test ne prouve rien");
    egal(tirs[0].atk, j.bldAtk(tour, 0), "le projectile de la Tour n'a pas l'ATK annoncée par bldAtk");
  });

  // ── 6. L'invité en ligne lit les mêmes messages que l'hôte ──
  // Chez un client, emettreOrdre ne peut pas connaître le résultat de l'hôte :
  // il rend une réponse OPTIMISTE. Sans les champs prédits, onze messages
  // d'interface interpolaient `undefined` ou choisissaient la mauvaise
  // branche — dont « Production continue arrêtée » au moment de l'ACTIVER.
  const enClient = (j) => {
    j.RESEAU.actif = true; j.RESEAU.role = 'client';
    j.RESEAU.envoi = () => true;
    j.RESEAU.attente = new Map();
    j.RESEAU.adversaire = { id: j.FAC.P2 };
    return j;
  };

  test("un client reçoit les champs qu'il a lui-même prédits, pas `undefined`", () => {
    const j = enClient(partie(charger(), { mode: 'conquest' }));
    const ids = j.G.units.filter((u) => u.owner === j.G.me).slice(0, 3).map((u) => u.id);
    const r = j.emettreOrdre(j.ordre(j.ORD.AMOVE, { ids, x: 1000, y: 1000 }), { n: ids.length });
    egal(r.ok, true, "l'ordre optimiste devrait être accepté");
    egal(r.optimiste, true, "le résultat devrait être marqué optimiste");
    egal(r.n, ids.length, '« ⚔️ ${r.n} unité(s) en marche d\'attaque » affiche encore undefined');
  });

  test("sans champ prédit, un client n'a toujours que ok/optimiste (le défaut d'origine)", () => {
    const j = enClient(partie(charger(), { mode: 'conquest' }));
    const r = j.emettreOrdre(j.ordre(j.ORD.AMOVE, { ids: [], x: 1, y: 1 }));
    egal(r.n, undefined, 'un appel SANS prédiction ne doit rien inventer');
  });

  test("une bascule booléenne prédite annonce le bon sens chez un client", () => {
    const j = enClient(partie(charger(), { mode: 'conquest' }));
    // On ACTIVE la production continue : le message doit dire « activée ».
    const r = j.emettreOrdre(j.ordre(j.ORD.AUTO_FORMATION, { bId: 1, actif: true }), { actif: true });
    egal(r.actif, true, "le client annonçait « ⏹ Production continue arrêtée » en l'ACTIVANT");
  });

  test('tout appelant qui LIT un champ du résultat doit le PRÉDIRE', () => {
    // Garde-fou mécanique : c'est ce balayage qui a trouvé les onze sites.
    // Il relit les sources et exige qu'un `emettreOrdre` dont le résultat est
    // interrogé (au-delà de .ok / .raison / .optimiste) passe un second
    // argument. Sans lui, la prochaine commande ajoutée refera la même faute.
    const fs = require('fs'), path = require('path');
    const racine = path.join(__dirname, '..');
    const manquants = [];
    for (const f of ['js/09-entree.js', 'js/11-interface.js', 'js/14-demarrage.js']) {
      const lignes = fs.readFileSync(path.join(racine, f), 'utf8').split('\n');
      for (let i = 0; i < lignes.length; i++) {
        const m = /\b(?:const|let|var)\s+(\w+)\s*=\s*emettreOrdre\(/.exec(lignes[i]);
        if (!m) continue;
        const v = m[1];
        // L'appel peut tenir sur plusieurs lignes : on cherche la prédiction
        // dans la fenêtre d'appel, et les lectures dans la fenêtre d'usage.
        const appel = lignes.slice(i, i + 4).join(' ');
        const usage = lignes.slice(i, i + 12).join('\n');
        const champs = new Set();
        const re = new RegExp('\\b' + v + '\\.(\\w+)', 'g');
        let x;
        while ((x = re.exec(usage))) {
          if (['ok', 'raison', 'optimiste'].includes(x[1])) continue;
          // Une lecture sur une ligne qui REDÉCLARE le même nom dans une
          // lambda (`G.relics.find(r=>…r.x…)`) ne parle pas du résultat.
          const avant = usage.slice(0, x.index).split('\n').pop();
          const apres = usage.slice(x.index).split('\n')[0];
          if (new RegExp('\\b' + v + '\\s*=>').test(avant + apres)) continue;
          // Un repli explicite (`r.msg || '…'`) est une réponse VALIDE : c'est
          // ce que fait le terminal de triche, dont le résultat réel ne peut
          // pas se prédire côté client.
          if (new RegExp('\\b' + v + '\\.' + x[1] + '\\s*\\|\\|').test(usage)) continue;
          champs.add(x[1]);
        }
        if (!champs.size) continue;
        if (!/\)\s*,\s*\{/.test(appel)) manquants.push(`${f}:${i + 1} lit ${[...champs].join('/')} sans prédiction ni repli`);
      }
    }
    egal(manquants.length, 0, 'sites sans prédiction optimiste :\n      ' + manquants.join('\n      '));
  });

  // ── 8. Taper un coéquipier n'est pas un ordre d'attaque ──
  test("taper un allié n'envoie aucun ordre d'attaque et le DIT", () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.G.factions.copain = j.mkFaction('copain', { genre: 'humain', equipe: j.moi().equipe, nom: 'Copain' });
    const allie = j.mkUnit(j.UT.MIL, 500, 500, 'copain');
    const mien = j.G.units.find((u) => u.owner === j.G.me && j.isMilitary(u.type))
              || j.G.units.find((u) => u.owner === j.G.me);
    j.G.units.push(allie);
    j.rebuildGrid();
    j.G.sel = [mien.id];
    const n = j.__sandbox.document.getElementById('notif');
    const avant = (n.children || []).length;
    j.cmdAttack(allie);
    egal(mien.state === 'attack', false, "mes troupes ont reçu l'ordre d'attaquer mon propre allié");
    egal((n.children || []).length, avant + 1, 'le geste est resté sans un mot');
    // Et le contrôle : sur une cible VRAIMENT hostile, l'ordre part.
    const ennemi = j.mkUnit(j.UT.ENEMI, 520, 520, j.G.factions.ia.id);
    j.G.units.push(ennemi);
    j.rebuildGrid();
    j.cmdAttack(ennemi);
    egal(mien.state, 'attack', "l'ordre d'attaque ne part plus sur une cible hostile");
  });

  test('le débit de ressources tourne aussi chez un client', () => {
    // majDebits vivait dans update(), qui ne tourne que chez l'hôte : les
    // quatre compteurs sous la barre de ressources restaient à 0,0 chez un
    // invité pendant que son économie tournait.
    const j = partie(charger(), { mode: 'conquest' });
    j.G.rateAcc.wood = 40;
    j.majDebits(2.5);
    ok(j.G.rateShow.wood > 0, 'majDebits ne calcule plus le débit');
    egal(j.G.rateAcc.wood, 0, "l'accumulateur n'a pas été remis à zéro");
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '12-reseau.js'), 'utf8');
    ok(/majDebits\(/.test(src), 'updateVisuel n\'appelle pas majDebits : le client reste à 0,0');
  });

  // ── 9. CONTRECOUPS DE LA VISION PARTAGÉE ───────────
  // Le rendu et le curseur ne connaissaient que DEUX réponses : à moi, ou
  // ennemi. Tant qu'on ne voyait jamais son coéquipier, ça tenait. Depuis que
  // la vision est partagée, un allié s'affichait avec le liséré ROUGE des
  // ennemis et le curseur promettait de l'attaquer.
  const avecAllie = () => {
    const j = partie(charger(), { mode: 'conquest' });
    j.G.factions.copain = j.mkFaction('copain', { genre: 'humain', equipe: j.moi().equipe, nom: 'Copain', teinte: 'bleu' });
    return j;
  };

  test('un coéquipier n\'est ni moi ni un ennemi : les trois cas se distinguent', () => {
    const j = avecAllie();
    const mien = j.G.units.find((u) => u.owner === j.G.me);
    const ami = j.mkUnit(j.UT.MIL, 500, 500, 'copain');
    const ennemi = j.mkUnit(j.UT.ENEMI, 520, 520, j.G.factions.ia.id);
    j.G.units.push(ami, ennemi);
    egal(j.estAmi(mien), true, 'je ne suis pas de mon propre camp ?');
    egal(j.estAmi(ami), true, "mon coéquipier n'est pas reconnu comme ami");
    egal(j.estAmi(ennemi), false, 'un ennemi passe pour un ami');
    // Liséré : rien pour les miennes, la TEINTE du camp pour un allié, le
    // rouge d'origine pour un hostile.
    egal(j.couleurLisere(mien), null, 'mes unités portent un liséré d\'appartenance');
    egal(j.couleurLisere(ennemi), '#e74c3c', "l'ennemi a perdu son liséré rouge d'origine");
    const cAmi = j.couleurLisere(ami);
    ok(cAmi && cAmi !== '#e74c3c', `mon coéquipier est dessiné comme un ennemi : ${cAmi}`);
    egal(cAmi, j.couleurMinimap(ami, true), "le liséré d'un allié devrait être la teinte de son camp, comme sur la mini-carte");
  });

  test('le curseur ne promet pas d\'attaquer son propre coéquipier', () => {
    const j = avecAllie();
    egal(j.curseurSurvol(j.G.me), 'pointer', 'mes entités ne sont plus sélectionnables au curseur');
    egal(j.curseurSurvol(j.G.factions.ia.id), 'crosshair', "l'ennemi n'est plus signalé comme attaquable");
    egal(j.curseurSurvol('copain'), 'default', 'le curseur promet encore une attaque sur un allié');
  });

  test("une file de retours sous le feu ne jette pas les évènements rares", () => {
    // `alerte` part de dealDmg, donc à CHAQUE coup reçu : quarante coups sur un
    // Centre Ville remplissaient la file entière et chassaient le
    // « Âge Féodal atteint ! » qui y attendait. Le camp sous le feu était le
    // seul à ne plus rien recevoir d'autre.
    const j = partie(charger(), { mode: 'conquest' });
    j.RESEAU.actif = true; j.RESEAU.role = 'hote'; j.RESEAU.adversaire = { id: j.FAC.P2 };
    const f = j.mkFaction(j.FAC.P2, { genre: 'humain', equipe: 2, nom: 'Invité' });
    j.G.factions[j.FAC.P2] = f;
    j.retour(f.id, 'age', { ico: 'x', nom: 'Féodal', bonus: '', n: 1 });
    for (let k = 0; k < 40; k++) j.retour(f.id, 'alerte', { x: k, y: k });
    ok(f.evq.some((e) => e[0] === 'age'), "l'évènement rare a été chassé par les alertes répétées");
    egal(f.evq.filter((e) => e[0] === 'alerte').length, 1, 'les alertes ne sont pas fusionnées');
    egalJSON(f.evq.find((e) => e[0] === 'alerte')[1], { x: 39, y: 39 },
      "la fusion doit garder la position la PLUS RÉCENTE, pas la première");
    // Contrôle : un code non fusionnant s'empile bien.
    egal(j.RETOURS_COALESCENTS.has('construit'), false, 'construit ne doit PAS fusionner : deux bâtiments, deux messages');
    for (let k = 0; k < 3; k++) j.retour(f.id, 'forme', {});
    egal(f.evq.filter((e) => e[0] === 'forme').length, 3, 'un code ordinaire ne devrait pas fusionner');
  });

  test("l'alliance annonce désormais la vision partagée (c'est son vrai gain)", () => {
    // Mesuré : conclure une alliance DOUBLE la surface visible (253 → 506
    // cases sur la graine 4242). Aucun texte ne le disait.
    const j = partie(charger(), { mode: 'conquest' });
    const compte = () => { let n = 0; const f = j.moi().fog; for (let y = 0; y < j.ROWS; y++) for (let x = 0; x < j.COLS; x++) if (f[y][x] === 2) n++; return n; };
    j.revealFog();
    const avant = compte();
    egal(ordreDe(j, j.G.me, 'DIPLOMATIE', { cibleId: j.G.factions.ia.id, action: 'proposer' }).ok, true, 'alliance refusée');
    j.revealFog();
    ok(compte() > avant, "l'alliance ne partage pas la vision : la promesse du panneau est fausse");
  });

  // ── 10. LA SÉLECTION SURVIT À CE QU'ELLE DÉSIGNE ──────
  // `G.sel` était purgé à la mort d'une unité et à la destruction d'un bâtiment
  // (quatre endroits le font), mais PAS dans les deux cas où une entité cesse
  // d'être à nos ordres sans disparaître : convertie (Wololo) ou mise en
  // garnison autrement que par le geste de tap. Le panneau continuait alors
  // d'offrir toutes ses actions — on pouvait entrer en mode construction avec
  // un « bâtisseur » enfermé dans un Centre Ville, et le chantier était payé,
  // posé, puis abandonné à 0 % pour toujours.
  test('une unité CONVERTIE quitte la sélection de son ancien propriétaire', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const mien = j.G.units.find((u) => u.owner === j.G.me && u.type === j.UT.VIL);
    j.G.sel = [mien.id];
    j.convertirUnite(mien, j.G.factions.ia.id);
    egal(j.G.sel.includes(mien.id), true, 'la conversion ne devrait pas purger elle-même : le point unique est purgerSelection');
    j.purgerSelection();
    egal(j.G.sel.includes(mien.id), false, "une unité passée à l'ennemi reste sélectionnée");
  });

  test('une unité MISE EN GARNISON quitte la sélection', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const tc = j.G.buildings.find((b) => b.owner === j.G.me && b.type === j.BT.TC);
    const v = j.G.units.find((u) => u.owner === j.G.me && u.type === j.UT.VIL);
    j.G.sel = [v.id];
    egal(ordreDe(j, j.G.me, 'GARNIR', { ids: [v.id], bId: tc.id }).ok, true, 'garnison refusée');
    j.purgerSelection();
    egal(j.G.sel.includes(v.id), false, "une unité à l'abri reste sélectionnée et son panneau propose encore de bâtir");
  });

  test('la purge épargne ce qui est bel et bien commandable', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const v = j.G.units.find((u) => u.owner === j.G.me && u.type === j.UT.VIL);
    const tc = j.G.buildings.find((b) => b.owner === j.G.me && b.type === j.BT.TC);
    j.G.sel = [v.id];
    j.purgerSelection();
    egal(j.G.sel.length, 1, 'la purge emporte une unité parfaitement normale');
    j.G.sel = [tc.id];
    j.purgerSelection();
    egal(j.G.sel.length, 1, 'la purge emporte un BÂTIMENT à moi (elle ne doit viser que les unités hors service)');
  });

  test("le panneau d'action purge la sélection de lui-même", () => {
    // C'est le point d'appel qui compte : la purge doit tourner sans que
    // personne n'ait à y penser, sur toutes les causes — y compris celles
    // qu'on n'a pas encore inventées.
    const j = partie(charger(), { mode: 'conquest' });
    const mien = j.G.units.find((u) => u.owner === j.G.me && u.type === j.UT.VIL);
    j.G.sel = [mien.id];
    j.convertirUnite(mien, j.G.factions.ia.id);
    j.updateActBar();
    egal(j.G.sel.length, 0, "updateActBar n'appelle pas purgerSelection");
  });

  // ── 11. « RÉDUIRE LES ANIMATIONS » COUVRE-T-IL TOUT ? ────
  test("l'option « Réduire les animations » ne laisse échapper aucune boucle infinie", () => {
    // Question mécanisée plutôt qu'inspectée : chaque `animation: … infinite`
    // d'index.html doit avoir son sélecteur dans le bloc `html.reduce-motion`.
    // Rien n'échappe aujourd'hui (7 sur 7) — ce test est là pour que la
    // PROCHAINE animation décorative ne s'ajoute pas en silence à côté d'une
    // option qui promet de les arrêter.
    const fs = require('fs'), path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    // Le bloc de la bascule : du sélecteur `html.reduce-motion` jusqu'à son `}`.
    const bloc = /((?:html\.reduce-motion[^{]*,?\s*)+)\{[^}]*animation\s*:\s*none/.exec(html);
    ok(!!bloc, 'le bloc html.reduce-motion a disparu d\'index.html');
    const couverts = bloc[1];
    const manquants = [];
    // Chaque règle CSS qui déclare une animation INFINIE.
    const re = /([^{}]+)\{([^}]*animation\s*:[^;}]*\binfinite\b[^;}]*)/g;
    let m;
    while ((m = re.exec(html))) {
      const selecteurs = m[1].split('\n').pop().trim();
      if (!selecteurs || selecteurs.startsWith('@') || selecteurs.startsWith('/*')) continue;
      // Un sélecteur est couvert si son dernier élément apparaît dans le bloc.
      const couvert = selecteurs.split(',').every((sel) => {
        const noyau = sel.trim().replace(/^html\.reduce-motion\s*/, '');
        return couverts.includes(noyau);
      });
      if (!couvert) manquants.push(selecteurs);
    }
    egal(manquants.length, 0,
      'boucles infinies hors de la bascule « Réduire les animations » :\n      ' + manquants.join('\n      '));
  });

  // ── 12. AUCUN RETOUR NE DOIT RESTER DERRIÈRE UN `estLocal` ──
  // La conversion des retours d'interface (voir le canal `d.ev`) n'avait
  // balayé que js/07-simulation.js. Quatre retours vivaient encore dans
  // js/01-regles.js et js/03-carte.js, et trois autres derrière une
  // comparaison à `G.me` : un invité ne savait ni que ses fermes attendaient
  // du bois, ni qu'une de ses unités montait en grade, ni que sa chasse avait
  // abouti, ni qu'une recherche était terminée — et sa pêche n'entrait même
  // pas dans son compteur de débit. Ce test remplace l'œil : c'est lui qui
  // aurait attrapé les sept.
  test("aucun retour d'interface ne reste enfermé dans la simulation", () => {
    const fs = require('fs'), path = require('path');
    const racine = path.join(__dirname, '..');
    // Fichiers dont le code tourne DANS update(), c'est-à-dire chez l'hôte
    // seul. js/09 et js/11 sont de l'interface : ils sont locaux par nature.
    const SIMULATION = ['js/01-regles.js', 'js/03-carte.js', 'js/04-entites.js',
      'js/07-simulation.js', 'js/08-ia.js', 'js/10-ordres.js'];
    const RETOURS_UI = /\b(notify|sfx|bigBanner|hintOnce|addFText|buzz)\s*\(|G\.rateAcc/;
    const GARDE = /estLocal\s*\(|\bG\.me\b/;
    const fautes = [];
    for (const f of SIMULATION) {
      const lignes = fs.readFileSync(path.join(racine, f), 'utf8').split('\n');
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        if (l.trim().startsWith('//') || !GARDE.test(l)) continue;
        // La garde et le retour sur la même ligne, ou le retour dans les
        // trois lignes du bloc qu'elle ouvre.
        const fenetre = lignes.slice(i, i + 4).join('\n').split('\n')
          .filter((x) => !x.trim().startsWith('//')).join('\n');
        if (RETOURS_UI.test(fenetre)) fautes.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
      }
    }
    egal(fautes.length, 0,
      'retours d\'interface encore gardés par estLocal/G.me dans la simulation — un invité ne les recevra jamais :\n      '
      + fautes.join('\n      '));
  });

  test("un bâtiment de l'IA ne consomme pas les indices à usage unique du joueur", () => {
    // Défaut introduit par la conversion elle-même : la bannière et les trois
    // indices étaient restés HORS de retour(), donc ils s'exécutaient pour tout
    // bâtiment achevé. Quand l'IA finissait un Château, le joueur lisait
    // « vous pouvez former votre Héros » — et le drapeau à usage unique était
    // brûlé, si bien qu'il ne le verrait JAMAIS en bâtissant le sien.
    const acheverChateau = (owner) => {
      const j = partie(charger(), { mode: 'conquest' });
      const p = caseLibre(j, 60, 60, 3, 3);
      const b = j.mkBuilding(j.BT.CASTLE, p.tx, p.ty, owner(j));
      b.constructing = true; b.progress = 0.999;
      j.placeBuilding(b);
      const v = j.mkUnit(j.UT.VIL, b.x, b.y, b.owner);
      v.state = 'build'; v.buildTarget = b.id;
      j.G.units.push(v); j.rebuildGrid();
      const n = j.__sandbox.document.getElementById('notif');
      const avant = (n.children || []).length;
      j.doBuild(v, 0.5);
      return { j, recus: (n.children || []).slice(avant).map((c) => c.textContent || '').join(' | ') };
    };
    const mien = acheverChateau((j) => j.G.me);
    ok(/Héros/.test(mien.recus), `mon propre Château ne déclenche plus son indice : « ${mien.recus} »`);
    ok(mien.j.lire("[...(G.hints||[])].join(',')").includes('hero'), 'le drapeau devrait être posé par MON château');
    const adverse = acheverChateau((j) => j.G.factions.ia.id);
    egal(adverse.recus, '', `le Château de l'IA parle au joueur : « ${adverse.recus} »`);
    egal(adverse.j.lire("[...(G.hints||[])].join(',')"), '',
      "le Château de l'IA brûle les drapeaux à usage unique du joueur");
  });

  test('les retours de recherche sont adressés au camp qui a cherché', () => {
    const j = partie(charger(), { mode: 'conquest' });
    const n = j.__sandbox.document.getElementById('notif');
    // MOI : je dois lire les deux messages (fin de recherche + effet).
    const f = j.moi();
    f.researchQ = [{ type: 'masonry', timer: 0.01 }];
    let avant = (n.children || []).length;
    j.updateResearchFaction(1, f);
    ok((n.children || []).length > avant, "je ne suis plus averti de MA propre recherche");
    // L'IA : je ne dois RIEN lire.
    const a = j.G.factions.ia;
    a.researchQ = [{ type: 'masonry', timer: 0.01 }];
    avant = (n.children || []).length;
    j.updateResearchFaction(1, a);
    egal((n.children || []).length, avant, "la recherche de l'IA m'est annoncée comme la mienne");
  });

  // ── 7. Deux formules écrites deux fois, réunies ─────────
  test("l'or d'une caravane est le même au panneau et à la caisse, Gitanos compris", () => {
    const j = partie(charger(), { mode: 'conquest' });
    riche(j);
    const p1 = caseLibre(j, 55, 55, 2, 2), m1 = batir(j, j.BT.MARKET, p1.tx, p1.ty);
    const p2 = caseLibre(j, 72, 72, 2, 2), m2 = batir(j, j.BT.MARKET, p2.tx, p2.ty);
    egal(ordreDe(j, j.G.me, 'ROUTE_COMMERCIALE', { bId: m1.id, toId: m2.id }).ok, true, 'route refusée');
    const base = j.gainCaravane(m1);
    ok(base > 0, "la caravane ne rapporte rien : le test ne prouverait rien");
    // Le bonus de civilisation DOIT se voir dans le chiffre annoncé : c'est
    // l'argument n° 1 des Gitanos, et le panneau l'ignorait.
    j.moi().civ = 'gitanos';
    const attendu = Math.round(base * j.CIVS.gitanos.tradeMult);
    egal(j.gainCaravane(m1), attendu,
      "le chiffre annoncé au Gitanos n'inclut pas ses +50% : il lisait 22 et touchait 33");
    // Et la caisse doit recevoir EXACTEMENT ce chiffre.
    const or = j.moi().res.gold;
    m1.tradeRoute.t = m1.tradeRoute.dur;      // la caravane arrive
    j.updateBuildings(0.001);
    j.lire('updateTradeRoutes')(0.001);
    egal(Math.round(j.moi().res.gold - or), attendu, "la caisse ne reçoit pas le chiffre annoncé");
  });

  test("le PANNEAU du Marché affiche bien ce chiffre-là, pas une formule recopiée", () => {
    // Le test précédent tient `gainCaravane` ; celui-ci tient le fait que
    // l'interface le LISE. Sans lui, remettre la formule recopiée dans le
    // panneau ne faisait tomber aucun test — vérifié par mutation.
    const j = partie(charger(), { mode: 'conquest' });
    riche(j);
    j.moi().civ = 'gitanos';
    const p1 = caseLibre(j, 55, 55, 2, 2), m1 = batir(j, j.BT.MARKET, p1.tx, p1.ty);
    const p2 = caseLibre(j, 72, 72, 2, 2), m2 = batir(j, j.BT.MARKET, p2.tx, p2.ty);
    egal(ordreDe(j, j.G.me, 'ROUTE_COMMERCIALE', { bId: m1.id, toId: m2.id }).ok, true, 'route refusée');
    j.G.sel = [m1.id];
    j.updateActBar();
    const bar = j.__sandbox.document.getElementById('actbar');
    const textes = [];
    const lire = (n) => { if (n.textContent) textes.push(String(n.textContent)); (n.children || []).forEach(lire); };
    (bar.children || []).forEach(lire);
    const ligne = textes.find((t) => /par trajet/.test(t)) || '';
    ok(ligne.includes(String(j.gainCaravane(m1))),
      `le panneau annonce « ${ligne} » alors que la caisse reçoit ${j.gainCaravane(m1)}`);
  });

  test("la barre de formation sait mesurer un bâtiment de l'IA (elle valait NaN)", () => {
    const j = charger();
    // TTIME ne contient AUCUN type du roster de l'IA — ils sont dans AI_TTIME,
    // et seul trainTime() interroge les deux. Le rendu lisait TTIME en direct :
    // `1 - timer/undefined` vaut NaN, et fillRect avale une largeur NaN sans
    // un mot, donc la barre au-dessus d'une Caserne adverse ne se remplissait
    // jamais.
    for (const t of [j.UT.ENEMI, j.UT.ENEMIA, j.UT.ENEMI_C, j.UT.ENEMI_G, j.UT.ENEMI_BOSS, j.UT.WOLOLO]) {
      ok(j.TTIME[t] === undefined, `TTIME connaît ${t} : ce test ne garde plus rien`);
      const duree = j.trainTime(t);
      ok(Number.isFinite(duree) && duree > 0, `trainTime(${t}) ne rend pas une durée utilisable : ${duree}`);
      ok(Number.isFinite(1 - 10 / duree), `la barre de formation vaut encore NaN pour ${t}`);
    }
  });

  // ── 5. Le message de re-semis ne facture plus les Francs ───
  test("le message de re-semis n'annonce un coût que s'il a été prélevé", () => {
    const semer = (civ) => {
      const j = partie(charger(), { mode: 'conquest' });
      j.moi().civ = civ;
      riche(j);
      const p = caseLibre(j, 40, 40, 2, 2);
      const f = batir(j, j.BT.FARM, p.tx, p.ty, j.G.me);
      f.foodLeft = 0;
      j.G.gameTime = (j.G.gameTime || 0) + 100; // dépasse l'anti-spam de 3 s
      j.tryAutoReseed(f);
      egal(f.foodLeft, j.FARM_FOOD, 'le champ n\'a pas été re-semé');
      // `children`, pas `lastChild` : le bouchon DOM des tests ne fournit pas
      // le second (meme piege que dans le groupe `triche`).
      const n = j.__sandbox.document.getElementById('notif');
      const dernier = n.children[n.children.length - 1];
      return dernier ? (dernier.textContent || '') : '';
    };
    const cout = String(charger().FARM_RESEED_COST.wood);
    ok(semer('mongols').includes(cout), "le re-semis payant n'annonce plus son coût");
    ok(!semer('francs').includes(cout),
      'le message facture le bois au joueur franc, dont la civilisation le dispense de payer');
  });
});

// ════════════════════════════════════════════════════════════
// Moteur de CAMPAGNE (js/15-campagne.js). La mission d'essai (MISSIONS.essai,
// js/16-missions.js) exerce chaque pièce du moteur sur une petite carte ; les
// variantes montées ici n'en changent qu'un détail à la fois.
groupe('campagne', () => {
  const mission = (j, cle = 'essai', diff = 'normal') => {
    j.pickDifficulty(diff);
    ok(j.lancerMission(cle), `la mission « ${cle} » ne se lance pas`);
    return j;
  };
  // Une variante de la mission d'essai, enregistrée sous une autre clé : la
  // table MISSIONS est partagée par référence avec le bac à sable.
  const variante = (j, cle, retouche) => {
    const base = j.MISSIONS.essai;
    const v = Object.assign({}, base, {
      roles: { p1: Object.assign({}, base.roles.p1), p2: Object.assign({}, base.roles.p2) },
      factions: Object.assign({}, base.factions),
    });
    retouche(v);
    j.MISSIONS[cle] = v;
    return j;
  };
  const jusquA = (j, sec, arret) => {
    for (let k = 0; k < sec * 30; k++) { j.update(j.SIM_DT); if (arret && arret()) break; }
  };

  test("la mission d'essai démarre avec SES réglages : mode, carte, graine, civilisations, seigneur", () => {
    const j = mission(charger());
    const def = j.MISSIONS.essai;
    egal(j.G.gmode, 'mission', 'mode de partie');
    egal(j.G.mission, 'essai', 'mission en cours');
    egal(j.G.seed, def.carte.graine, "la graine de la mission n'est pas imposée");
    egal(j.lire('COLS'), j.TAILLES[def.carte.taille].n, "la taille de la mission n'est pas imposée");
    egal(j.G.factions.p1.civ, 'francs', 'civilisation du rôle p1');
    egal(j.G.factions.p1.age, 1, 'âge de départ du rôle p1');
    const ia = j.G.factions.ia;
    ok(ia && ia.genre === 'ia', "le seigneur de la mission n'existe pas");
    egal(ia.civ, 'mongols', 'civilisation imposée au seigneur');
    egal(ia.equipe, 3, 'équipe imposée au seigneur');
    egal(j.lire('missionChoisie'), null, 'la mission reste choisie : « Commencer la partie » la relancerait');
  });

  test('second commandant en solo : fusionné, sa base et ses unités reviennent au joueur', () => {
    const j = mission(charger());
    egal(j.G.factions.p2, undefined, 'une faction P2 existe alors que le rôle est fusionné');
    egal(j.G.buildings.filter((b) => b.owner === 'p1' && b.type === j.BT.TC).length, 2,
      "le joueur n'a pas reçu le Centre Ville du second commandant");
    egal(j.facMission('p2'), 'p1', "une mission qui parle à « p2 » ne s'adresse pas au joueur");
  });

  test("second commandant en solo : confié à l'IA, allié, avec sa propre base", () => {
    const j = variante(charger(), 'essai_ia', (v) => { v.roles.p2 = Object.assign({}, v.roles.p2, { solo: 'ia' }); });
    mission(j, 'essai_ia');
    const p2 = j.G.factions.p2;
    ok(p2 && p2.genre === 'ia', "le second commandant n'est pas mené par l'IA");
    egal(p2.equipe, j.G.factions.p1.equipe, "le second commandant n'est pas dans l'équipe du joueur");
    ok(j.G.buildings.some((b) => b.owner === 'p2' && b.type === j.BT.TC), "le second commandant n'a pas de base");
    jusquA(j, 10);
    egal(p2.vaincu, false, 'le second commandant est tombé dès le départ');
  });

  test('la surcouche est déterministe, et elle a bien creusé, asséché, semé et posé', () => {
    const a = mission(charger()), b = mission(charger());
    egalJSON(empreinteCarte(a), empreinteCarte(b), 'deux lancements de la même mission');
    const C = a.lire('COLS'), R = a.lire('ROWS');
    const gue = a.zoneMission('gue'), camp = a.zoneMission('camp');
    egal(a.G.tiles[gue.ty][gue.tx], 0, "le gué est resté sous l'eau");
    // La rivière coupe la carte du nord au sud sur la colonne centrale.
    let eau = 0; for (let y = 0; y < R; y++) if (a.G.tiles[y][Math.round(0.5 * (C - 1))] === a.T_WATER) eau++;
    ok(eau > R * 0.8, `la rivière ne coupe pas la carte (${eau}/${R} cases d'eau)`);
    const dans = (o) => Math.hypot(o.tx - camp.tx, o.ty - camp.ty) <= camp.r + 1;
    ok(a.G.nodes.some((n) => n.infinite && dans(n)), 'aucun filon inépuisable dans le camp');
    ok(a.G.relics.some(dans), 'aucune relique dans le camp');
  });

  test("le client obtient la même carte que l'hôte : la surcouche passe par genMap, pas par startGame", () => {
    const hote = mission(charger());
    // Ce que fait demarrerPartieClient : initState puis genMap, jamais startGame.
    const client = charger();
    client.pickDifficulty('normal');
    client.choisirMission('essai');
    client.initState();
    client.genMap();
    egalJSON(empreinteCarte(client), empreinteCarte(hote), "carte du client ≠ carte de l'hôte");
  });

  test('aucun camp vaincu à la première image, y compris un camp parti SANS Centre Ville', () => {
    const j = variante(charger(), 'essai_sansbase', (v) => {
      v.roles.p1 = Object.assign({}, v.roles.p1, { base: 'rien' });
      v.roles.p2 = Object.assign({}, v.roles.p2, { base: 'rien' });
    });
    mission(j, 'essai_sansbase');
    egal(j.G.buildings.filter((b) => b.owner === 'p1' && b.type === j.BT.TC).length, 0, 'le camp a reçu un Centre Ville');
    jusquA(j, 3);
    egal(j.G.factions.p1.vaincu, false, "un camp parti sans Centre Ville est déclaré vaincu d'office");
    egal(j.G.gameOver, false, 'la mission est perdue à la première image');
  });

  test('victoire : les principaux tenus gagnent la mission, et les étoiles se comptent', () => {
    const j = mission(charger());
    jusquA(j, 140, () => j.G.victory || j.G.gameOver);
    egal(j.G.victory, true, 'aucune victoire après avoir tenu deux minutes');
    egal(j.G.scn.fin.issue, 'victoire', 'issue de la mission');
    // Un objectif sans `test` (« le héros doit survivre ») se MAINTIENT : sans
    // cette règle il ne se remplissait jamais et bloquait toute victoire.
    egal(j.G.scn.obj.heros, 'fait', "l'objectif à maintenir n'a pas été validé à la victoire");
    // 'victoire' + héros vivant ; le camp secondaire n'a pas été dispersé.
    egal(j.G.scn.etoiles, 2, 'étoiles comptées');
  });

  test('défaite : le héros tombe, la mission est perdue — avec la cause de CET objectif', () => {
    const j = mission(charger());
    jusquA(j, 2);
    for (const u of j.G.units.filter((u) => u.tag === 'heros')) u.hp = 0;
    jusquA(j, 3, () => j.G.gameOver);
    egal(j.G.gameOver, true, 'la mort du héros protégé ne perd pas la mission');
    egal(j.G.scn.fin.cause, 'obj:heros', 'cause de la défaite');
    ok(/héros est tombé/.test(j.texteFinMission()), 'le texte de fin ne dit pas pourquoi : ' + j.texteFinMission());
  });

  test('raser le seigneur ne gagne PAS une mission qui demandait autre chose', () => {
    const j = mission(charger());
    for (const b of j.G.buildings.filter((b) => b.owner === 'ia' && b.type === j.BT.TC)) b.hp = 0;
    jusquA(j, 5);
    egal(j.G.factions.ia.vaincu, true, 'le seigneur sans Centre Ville reste en lice');
    egal(j.G.victory, false, 'la victoire par élimination de la Conquête a court-circuité les objectifs');
  });

  test('déclencheurs : chacun tire UNE fois, la réplique est journalisée, le renfort arrive tagué', () => {
    const j = mission(charger());
    jusquA(j, 65);
    egal(j.G.scn.decl.intro, 1, "l'introduction a tiré plusieurs fois (ou jamais)");
    egal(j.G.scn.decl.renfort, 1, 'le renfort a tiré plusieurs fois (ou jamais)');
    egalJSON(j.G.scn.dlg.map((d) => d.k), ['intro', 'renfort'], 'journal des répliques');
    egal(j.G.units.filter((u) => u.tag === 'renfort').length, 2, "renfort (allié : effectif tel qu'écrit)");
    egal(j.G.scn.obj.camp, 'actif', "l'objectif caché n'a pas été révélé par le déclencheur");
  });

  test('une fermeture de mission qui lève une erreur perd son déclencheur, pas la partie', () => {
    const j = variante(charger(), 'essai_faute', (v) => {
      v.declencheurs = [{ id: 'boum', si: () => true, alors: () => { throw new Error('faute de scénariste'); } }]
        .concat(v.declencheurs);
    });
    mission(j, 'essai_faute');
    jusquA(j, 65);
    egal(j.G.scn.decl.renfort, 1, 'une erreur dans un déclencheur a bloqué les suivants');
  });

  test('une mission impose ses réglages à SON seigneur ; la difficulté fixe le reste', () => {
    const j = mission(charger(), 'essai', 'hard');
    const ia = j.G.factions.ia;
    egal(ia.atkTimer, 900, 'le premier assaut imposé par la mission est ignoré');
    egal(j.aiTune(ia).hpMult, j.AI_TUNE.hard.hpMult, 'les autres réglages ne suivent plus la difficulté');
    // Hors mission, rien ne change : même lecture qu'avant.
    const k = partie(charger(), { diff: 'hard' });
    egal(k.aiTune(k.G.factions.ia), k.AI_TUNE.hard, 'une IA de Conquête ne lit plus AI_TUNE');
  });

  test('ni le succès Conquérant, ni Guerre Éclair, ni le classement ne se gagnent en mission', () => {
    const j = charger();
    const ctx = { won: true, gmode: 'mission', time: 60 };
    for (const id of ['conqueror', 'blitz']) {
      const a = j.ACH.find((x) => x.id === id);
      egal(a.test({}, ctx), false, `le succès « ${a.nom} » se débloque en gagnant une mission`);
    }
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    const i = src.indexOf('function soumettreClassement');
    ok(/gmode==='mission'\)\s*return/.test(src.slice(i, i + 700)), 'soumettreClassement envoie un temps de mission au classement Conquête');
  });

  test("le mode Campagne ne se propose dans aucun onglet : on n'y entre que par une mission", () => {
    const j = charger();
    egal(j.modeDispo('mission', 'solo'), false, 'proposé en Solo');
    egal(j.modeDispo('mission', 'multi'), false, 'proposé en Multijoueur');
    // Sélectionné sans mission (reliquat d'une sauvegarde), il retombe sur Survie.
    j.__sandbox.selectedMode = 'mission';
    j.initState();
    egal(j.G.gmode, 'survival', 'le mode Campagne lancé sans mission');
  });

  test('sauvegarde : la mission et son état partent, et reviennent en données pures', () => {
    const j = mission(charger());
    jusquA(j, 65);
    const s = JSON.parse(JSON.stringify(j.buildSaveData()));
    egal(s.mission, 'essai', 'la sauvegarde oublie la mission');
    egalJSON(s.scn.decl, j.G.scn.decl, 'déclencheurs tirés');
    egalJSON(s.scn.obj, j.G.scn.obj, 'état des objectifs');
    // Le contrat côté chargement : loadGame relit bien les deux champs.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '13-cloud.js'), 'utf8');
    const corps = src.slice(src.indexOf('async function loadGame'));
    ok(/G\.mission\s*=/.test(corps) && /G\.scn\s*=/.test(corps), 'loadGame ne restaure pas la mission');
  });

  // ══ INTERFACE ET PROGRESSION (lot L2) ══════════════════════
  // Campagne de test à deux missions (des clones de la mission d'essai) :
  // de quoi vérifier le déblocage sans dépendre du contenu réel.
  const campagneTest = (j) => {
    for (const cle of ['essai_a', 'essai_b']) {
      variante(j, cle, (v) => { v.campagne = 'test'; v.titre = 'Essai ' + cle.slice(-1).toUpperCase(); });
    }
    j.CAMPAGNES.test = { nom: 'Campagne de test', heros: 'francs', ico: '🧪', missions: ['essai_a', 'essai_b'] };
    return j;
  };
  // Tous les camps humains de l'équipe du joueur vont d'une case à une autre
  // (bmap 3 = seul obstacle, voir tileBlocked) : un parcours en largeur suffit.
  const chemin = (j, a, b) => {
    const C = j.lire('COLS'), R = j.lire('ROWS');
    const vu = new Uint8Array(C * R), file = [a.tx + a.ty * C];
    vu[file[0]] = 1;
    while (file.length) {
      const c = file.shift(), x = c % C, y = (c / C) | 0;
      if (Math.abs(x - b.tx) <= 1 && Math.abs(y - b.ty) <= 1) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, n = nx + ny * C;
        if (nx < 0 || ny < 0 || nx >= C || ny >= R || vu[n] || j.G.bmap[ny][nx] === 3) continue;
        vu[n] = 1; file.push(n);
      }
    }
    return false;
  };

  test('progression : la fusion garde, mission par mission, la meilleure difficulté, le plus d\'étoiles, le meilleur temps', () => {
    const j = charger();
    const a = { essai_a: { v: 1, diff: 'brutal', etoiles: 2, temps: 900 }, essai_b: { v: 1, diff: 'easy', etoiles: 1, temps: 600 } };
    const b = { essai_a: { v: 1, diff: 'easy', etoiles: 3, temps: 700 }, fr1: { v: 1, diff: 'normal', etoiles: 1, temps: 1200 } };
    const f = j.fusionProgression(a, b);
    egalJSON(f.essai_a, { v: 1, diff: 'brutal', etoiles: 3, temps: 700 }, 'fusion d\'une mission présente des deux côtés');
    ok(f.essai_b && f.fr1, 'une mission présente d\'un seul côté a été perdue à la fusion');
  });

  test('le profil charge ET fusionne la campagne (les trois endroits où un champ se perd sinon)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '11-interface.js'), 'utf8');
    ok(/let PROFILE=\{[^}]*campagne:\{\}/.test(src), 'PROFILE ne déclare pas campagne');
    const charge = src.slice(src.indexOf('async function loadProfile'), src.indexOf('function saveProfile'));
    ok(/campagne:/.test(charge), 'loadProfile ne relit pas la campagne : elle disparaît au rechargement');
    const drive = src.slice(src.indexOf('async function syncProfilAvecDrive'), src.indexOf('async function syncProfilAvecDrive') + 2000);
    ok(/fusionProgression\(/.test(drive), 'la synchronisation Drive écrase la campagne au lieu de la fusionner');
  });

  test('gagner une mission l\'inscrit au profil et ouvre la suivante — la perdre, non', () => {
    const j = campagneTest(charger());
    j.PROFILE.campagne = {};
    egal(j.missionDebloquee('essai_a'), true, 'la première mission est fermée');
    egal(j.missionDebloquee('essai_b'), false, 'la seconde est ouverte avant d\'avoir gagné la première');
    // Défaite d'abord : rien ne s'ouvre.
    mission(j, 'essai_a');
    jusquA(j, 2);
    for (const u of j.G.units.filter((u) => u.tag === 'heros')) u.hp = 0;
    jusquA(j, 3, () => j.G.gameOver);
    egal(j.missionDebloquee('essai_b'), false, 'une DÉFAITE a ouvert la mission suivante');
    // Puis victoire.
    const k = campagneTest(charger());
    k.PROFILE.campagne = {};
    mission(k, 'essai_a', 'hard');
    jusquA(k, 140, () => k.G.victory || k.G.gameOver);
    egal(k.G.victory, true, 'la mission n\'a pas été gagnée');
    const r = k.PROFILE.campagne.essai_a;
    ok(r, 'la victoire n\'est pas inscrite au profil');
    egal(r.diff, 'hard', 'difficulté inscrite');
    egal(r.etoiles, k.G.scn.etoiles, 'étoiles inscrites');
    egal(k.missionDebloquee('essai_b'), true, 'la mission suivante reste fermée après la victoire');
  });

  test('écran de fin : « Mission suivante » seulement s\'il y en a une, et jamais « Nouvelle partie » en mission', () => {
    const j = campagneTest(charger());
    mission(j, 'essai_a');
    ok(/Mission suivante/.test(j.boutonsFinMission('victoire')), 'pas de mission suivante proposée après la première');
    const k = campagneTest(charger());
    mission(k, 'essai_b');
    ok(!/Mission suivante/.test(k.boutonsFinMission('victoire')), 'une « mission suivante » est proposée après la dernière');
    jusquA(k, 140, () => k.G.victory);
    const ov = k.__sandbox.document.getElementById('overlay').innerHTML;
    ok(/Retour à la campagne/.test(ov), 'l\'écran de victoire d\'une mission ne ramène pas à la campagne');
    ok(!/Nouvelle partie/.test(ov), 'l\'écran de victoire d\'une mission propose « Nouvelle partie »');
  });

  test('l\'onglet Campagne ne montre QUE les campagnes qui ont des missions', () => {
    const j = charger();
    j.afficherListeCampagnes();
    const html = j.__sandbox.document.getElementById('campbloc').innerHTML;
    for (const [cle, c] of Object.entries(j.CAMPAGNES)) {
      egal(html.includes(`ouvrirCampagne('${cle}')`), c.missions.length > 0,
        `campagne « ${cle} » (${c.missions.length} mission(s)) : affichage`);
    }
  });

  test('en mission : le panneau montre les objectifs visibles, et le bandeau lit le journal des répliques', () => {
    const j = mission(charger());
    jusquA(j, 2);
    j.majInterfaceScenario();
    const obj = j.__sandbox.document.getElementById('objpanel').innerHTML;
    ok(/Tenez deux minutes/.test(obj), 'objectif principal absent du panneau');
    ok(/Dispersez le camp/.test(obj), 'objectif révélé par un déclencheur absent du panneau');
    const dlg = j.__sandbox.document.getElementById('dlgbandeau').innerHTML;
    ok(/capitaine/.test(dlg) && /Tenez la rivière/.test(dlg), 'la réplique d\'introduction n\'est pas affichée : ' + dlg.slice(0, 120));
  });

  test('Herstal : départs praticables, gués ouverts, camps et bord de raid atteignables depuis le village', () => {
    const j = mission(charger(), 'fr1');
    const tc = j.G.buildings.find((b) => b.owner === 'p1' && b.type === j.BT.TC);
    const depart = { tx: tc.tx - 1, ty: tc.ty + tc.h + 1 };
    for (const z of ['gue_nord', 'gue_sud']) {
      const zn = j.zoneMission(z);
      egal(j.G.tiles[zn.ty][zn.tx], 0, `le ${z} est sous l'eau`);
    }
    for (const z of ['camp_nord', 'camp_est', 'bord_est']) {
      ok(chemin(j, depart, j.zoneMission(z)), `aucun chemin du village jusqu'à ${z}`);
    }
    egal(j.G.units.filter((u) => u.owner === 'p1' && u.type === j.UT.KNIGHT).length, 5, 'les cavaliers de Roland n\'ont pas rejoint le joueur');
    egal(j.G.units.filter((u) => u.tag === 'charles').length, 1, 'Charles n\'est pas sur la carte');
    jusquA(j, 300);
    egal(j.G.gameOver, false, 'la mission est perdue sans que le joueur ait rien fait en cinq minutes');
    for (const f of Object.values(j.G.factions)) egal(f.vaincu, false, `${f.id} vaincu en cinq minutes`);
  });

  test('Herstal : les quatre objectifs principaux remplis gagnent la mission, et la victoire est inscrite', () => {
    const j = mission(charger(), 'fr1');
    j.PROFILE.campagne = {};
    const tc = j.G.buildings.find((b) => b.owner === 'p1' && b.type === j.BT.TC);
    for (let i = 0; i < 6; i++) { const p = caseLibre(j, tc.tx + 6, tc.ty, 2, 2); batir(j, j.BT.FARM, p.tx, p.ty, 'p1'); }
    j.G.factions.p1.age = 1;
    for (const e of [...j.G.units, ...j.G.buildings]) if (e.tag === 'camp_nord' || e.tag === 'camp_est') e.hp = 0;
    jusquA(j, 5, () => j.G.victory || j.G.gameOver);
    egal(j.G.victory, true, 'la mission n\'est pas gagnée : ' + JSON.stringify(j.G.scn.obj));
    ok(j.PROFILE.campagne.fr1, 'la victoire de Herstal n\'est pas inscrite au profil');
  });

  // ══ À DEUX (lot L3) ══════════════════════════════
  // Une vraie paire : l'hôte lance la mission, l'invité démarre par
  // demarrerPartieClient — le chemin exact du jeu, qui ne passe jamais par
  // startGame — et ne reçoit que ce que l'hôte envoie par son transport.
  const paireMission = (cle = 'fr1', civInvite = null) => {
    const hote = charger();
    hote.RESEAU.actif = true; hote.RESEAU.role = 'hote';
    hote.RESEAU.adversaire = { id: hote.FAC.P2, nom: 'Invité', civ: civInvite };
    hote.RESEAU.tick = 0;
    mission(hote, cle);
    const file = [];
    hote.RESEAU.envoi = (m) => { file.push(JSON.parse(JSON.stringify(m))); return true; };
    const salut = JSON.parse(JSON.stringify(hote.construireSalut()));
    const brancher = () => {
      const c = charger();
      c.pickDifficulty('normal');
      c.demarrerPartieClient(JSON.parse(JSON.stringify(salut)));
      c.RESEAU.envoi = () => true;
      c.recevoirReseau(JSON.parse(JSON.stringify(hote.construireSnap())));
      return c;
    };
    const client = brancher();
    hote.RESEAU.pret = true;
    const livrer = () => { while (file.length) client.recevoirReseau(file.shift()); };
    const tour = (sec) => {
      for (let k = 0; k < sec * 30; k++) {
        hote.update(hote.SIM_DT); hote.pousserReseau(hote.SIM_DT);
        livrer(); client.updateVisuel(client.SIM_DT);
      }
    };
    return { hote, client, salut, livrer, tour, brancher };
  };

  test("à deux : le SALUT porte la mission, et l'invité regénère la MÊME carte, surcouche comprise", () => {
    const { hote, client, salut } = paireMission();
    egal(salut.mission, 'fr1', 'le SALUT ne dit pas quelle mission regénérer');
    egal(hote.PROTO_VERSION, 8, 'la mission change le monde regénéré : PROTO_VERSION doit passer à 8');
    egal(client.G.mission, 'fr1', "l'invité ne sait pas qu'il joue une mission");
    egalJSON(empreinteCarte(client), empreinteCarte(hote), "la carte de l'invité n'est pas celle de l'hôte");
  });

  test("à deux : le second commandant est l'ami — sa base, ses unités, la civilisation de SON rôle", () => {
    const { hote, client } = paireMission('fr1', 'mongols');
    const p2 = hote.G.factions.p2;
    egal(p2.genre, 'humain', 'le second commandant n\'est pas tenu par l\'invité');
    egal(p2.equipe, hote.G.factions.p1.equipe, "l'invité n'est pas l'allié de l'hôte");
    egal(p2.civ, 'francs', "l'invité garde sa civilisation de salon au lieu de celle de son rôle");
    egal(hote.G.units.filter((u) => u.owner === 'p2' && u.type === hote.UT.KNIGHT).length, 5, 'les cavaliers de Roland ne sont pas à l\'invité');
    egal(client.G.factions.p2.civ, 'francs', "chez l'invité, sa propre civilisation n'est pas celle du rôle");
    ok(client.SCN_API.coop() && hote.SCN_API.coop(), 'la mission ne se sait pas jouée à deux');
  });

  test("à deux : l'état de mission voyage, et la réplique adressée au second commandant n'est dite qu'à lui", () => {
    const { hote, client, tour } = paireMission();
    tour(20);
    egalJSON(client.G.scn.dlg.map((d) => d.k), hote.G.scn.dlg.map((d) => d.k), 'journal des répliques');
    ok(hote.G.scn.dlg.some((d) => d.k === 'roland' && d.d === 'p2'), 'la réplique de Roland n\'a pas été adressée à p2');
    egal(client.destinataireLocal('p2'), true, "l'invité n'entend pas ce qui est dit à son rôle");
    egal(hote.destinataireLocal('p2'), false, "l'hôte entend ce qui est dit au rôle de son allié");
    egalJSON(client.G.scn.obj, hote.G.scn.obj, 'état des objectifs');
    client.majInterfaceScenario();
    ok(/fermes/.test(client.__sandbox.document.getElementById('objpanel').innerHTML), "le panneau d'objectifs de l'invité est vide");
  });

  test("à deux : le delta ne renvoie l'état de mission QUE lorsqu'il change", () => {
    const { hote, tour } = paireMission();
    tour(3);
    hote.construireDelta();
    egal(hote.construireDelta().scn, undefined, "l'état de mission repart à chaque delta, changé ou non");
    hote.SCN_API.dire('intro');
    ok(hote.construireDelta().scn, "un changement de l'état de mission n'est pas parti");
  });

  test("à deux : l'issue tranchée par l'hôte arrive chez l'invité, qui l'inscrit à SON profil", () => {
    const { hote, client, tour } = paireMission();
    client.PROFILE.campagne = {};
    tour(2);
    const tc = hote.G.buildings.find((b) => b.owner === 'p1' && b.type === hote.BT.TC);
    for (let i = 0; i < 6; i++) { const p = caseLibre(hote, tc.tx + 6, tc.ty, 2, 2); batir(hote, hote.BT.FARM, p.tx, p.ty, 'p1'); }
    hote.G.factions.p1.age = 1;
    for (const e of [...hote.G.units, ...hote.G.buildings]) if (e.tag === 'camp_nord' || e.tag === 'camp_est') e.hp = 0;
    tour(3);
    egal(hote.G.victory, true, "l'hôte n'a pas gagné la mission");
    egal(client.G.victory, true, "l'invité n'a jamais vu la victoire de la mission");
    ok(client.PROFILE.campagne.fr1, "la victoire n'est pas inscrite au profil de l'invité");
    egal(client.PROFILE.campagne.fr1.etoiles, hote.G.scn.etoiles, "l'invité n'a pas les mêmes étoiles que l'hôte");
  });

  test("rejoindre en cours de route : l'invité reçoit tout l'état, sans subir tout le récit d'un coup", () => {
    const { hote, tour, brancher } = paireMission();
    tour(40);
    const tard = brancher();
    egal(tard.G.scn.dlg.length, hote.G.scn.dlg.length, "le SNAP n'emporte pas le journal");
    tard.majInterfaceScenario();
    egal(tard.__sandbox.document.getElementById('dlgbandeau').style.display === 'flex', false,
      'un invité qui rejoint à la 40e seconde se voit rejouer des répliques anciennes');
  });

  test('en coop, les renforts ADVERSES grossissent de coopMult — pas les alliés', () => {
    const { hote } = paireMission();
    egal(hote.SCN_API.vague('pill', [[hote.UT.ENEMI, 10]], 'bord_est').length, 13, 'vague adverse à deux (×1,3)');
    egal(hote.SCN_API.renfort('p1', [[hote.UT.KNIGHT, 10]], 'bord_est').length, 10, 'renfort allié à deux');
    const solo = mission(charger(), 'fr1');
    egal(solo.SCN_API.vague('pill', [[solo.UT.ENEMI, 10]], 'bord_est').length, 10, 'vague adverse en solo');
  });

  test("un état de mission tordu ne fait pas tomber la page de l'invité", () => {
    const { client } = paireMission();
    const avant = JSON.stringify(client.G.scn);
    client.appliquerScenario({ obj: 'x' });
    client.appliquerScenario({ obj: {}, dlg: 'pas une liste' });
    client.appliquerDelta({ t: 'D', scn: 42 });
    egal(JSON.stringify(client.G.scn), avant, 'un état tordu a été appliqué');
  });

  test("salon : ouvert depuis le briefing, il est coopératif et n'arme la mission qu'au LANCEMENT", () => {
    const j = charger();
    j.mpOuvrir({ mission: 'fr1' });
    egal(j.lire('missionSalon'), 'fr1', 'le salon ne retient pas la mission');
    egal(j.lire('missionChoisie'), null, "la mission est armée dès l'ouverture : « Commencer la partie » la lancerait");
    egal(j.mpEstCoop(), true, "un salon de mission n'est pas coopératif");
    j.mpOuvrir();
    egal(j.lire('missionSalon'), null, "le salon ordinaire garde la mission d'avant");
  });

  test("salon rejoint : l'invité apprend la mission et son rôle, et le sélecteur de civilisation — sans effet — disparaît", () => {
    const j = charger();
    const row = j.__sandbox.document.getElementById('mpcivrow');
    const chat = j.__sandbox.document.getElementById('mpchat');
    j.recevoirReseau({ t: 'MISSION_SALON', mission: 'fr1' });
    egal(row.style.display, 'none', "le choix de civilisation reste proposé alors que le rôle l'impose");
    const txt = chat.children.map((c) => c.textContent).join(' | ');
    ok(/Terres de Herstal/.test(txt) && /Roland/.test(txt), "l'invité n'apprend ni la mission ni son rôle : " + txt);
    j.recevoirReseau({ t: 'MISSION_SALON', mission: '<img src=x>' });
    ok(/ne connaît pas/.test(chat.children[chat.children.length - 1].textContent), 'une clé de mission inconnue ne prévient pas');
    j.mpOuvrir();
    egal(row.style.display, '', 'un salon ordinaire rouvert garde le sélecteur masqué');
  });

  // ══ RÈGLES DE MISSION ET RÔLES D'IA (lot L4) ════════════════
  const avecRegles = (j) => variante(j, 'essai_regles', (v) => {
    v.regles = { ageMax: 1, interdits: [j.BT.STABLE, j.UT.PIKE], recherchesInterdites: ['iron_armor'], merveille: false };
  });

  test("règles : âge, bâtiment, unité et recherche interdits sont REFUSÉS par l'hôte, avec leur raison", () => {
    const j = mission(avecRegles(charger()), 'essai_regles');
    riche(j, 'p1');
    const f = j.G.factions.p1;
    egal(f.age, 1, 'âge de départ du rôle');
    const age = ordreDe(j, 'p1', j.ORD.AGE);
    egal(age.raison, 'mission', "la montée au-delà de l'âge maximum de la mission passe");
    ok(/Âge maximum/.test(age.msg), 'le refus ne dit pas pourquoi : ' + age.msg);
    const p = caseLibre(j, 40, 60, 2, 2);
    egal(ordreDe(j, 'p1', j.ORD.BATIR, { type: j.BT.STABLE, tx: p.tx, ty: p.ty }).raison, 'mission', "l'Écurie interdite se bâtit");
    const cas = batir(j, j.BT.BARRACKS, p.tx, p.ty, 'p1');
    egal(ordreDe(j, 'p1', j.ORD.FORMER, { bId: cas.id, unitType: j.UT.PIKE }).raison, 'mission', 'le Piquier interdit se forme');
    ok(ordreDe(j, 'p1', j.ORD.FORMER, { bId: cas.id, unitType: j.UT.MIL }).ok, 'une unité AUTORISÉE est refusée elle aussi');
    const q = caseLibre(j, 50, 60, 2, 2);
    batir(j, j.BT.FORGE, q.tx, q.ty, 'p1');
    egal(ordreDe(j, 'p1', j.ORD.RECHERCHE, { cle: 'iron_armor' }).raison, 'mission', 'la recherche interdite se lance');
    f.age = 3;
    const w = caseLibre(j, 30, 30, 3, 3);
    egal(ordreDe(j, 'p1', j.ORD.BATIR, { type: j.BT.WONDER, tx: w.tx, ty: w.ty }).raison, 'mission', 'la Merveille se bâtit malgré merveille:false');
  });

  test("règles : un ordre FORGÉ de l'invité est refusé tout pareil", () => {
    const { hote } = paireMission('fr1');
    hote.MISSIONS.fr1.regles = { interdits: [hote.BT.STABLE] };
    riche(hote, 'p2');
    const p = caseLibre(hote, 50, 40, 2, 2);
    const r = hote.applyCommand({ t: hote.ORD.BATIR, f: 'p2', type: hote.BT.STABLE, tx: p.tx, ty: p.ty });
    delete hote.MISSIONS.fr1.regles;
    egal(r.raison, 'mission', "l'invité contourne une règle de mission en forgeant l'ordre");
  });

  // Le bouchon DOM n'agrège pas le innerHTML des enfants : on lit bouton par bouton.
  const bouton = (bar, nom) => bar.children.find((c) => (c.innerHTML || '').includes(nom));
  test("règles : l'interface grise EXACTEMENT ce que l'hôte refuse, avec la même raison", () => {
    const j = mission(avecRegles(charger()), 'essai_regles');
    const bar = j.__sandbox.document.createElement('div');
    const vil = j.G.units.find((u) => u.owner === 'p1' && u.type === j.UT.VIL);
    j.G.buildTab = 1; // onglet Militaire : l'Écurie y est
    j.drawUnitAct(bar, vil);
    const ecurie = bouton(bar, 'Écurie');
    ok(ecurie && /Interdit dans cette mission/.test(ecurie.innerHTML) && /locked/.test(ecurie.className),
      "le menu de construction propose l'Écurie interdite");
    const p = caseLibre(j, 40, 60, 2, 2);
    const cas = batir(j, j.BT.BARRACKS, p.tx, p.ty, 'p1');
    const bar2 = j.__sandbox.document.createElement('div');
    j.drawBuildAct(bar2, cas);
    const piq = bouton(bar2, 'Piquier'), mil = bouton(bar2, 'Milicien');
    ok(piq && /Interdit dans cette mission/.test(piq.innerHTML) && /locked/.test(piq.className), 'la Caserne propose le Piquier interdit');
    ok(mil && !/🚫/.test(mil.innerHTML) && !/locked/.test(mil.className), 'une unité autorisée apparaît interdite');
    j.updateAgeBar();
    ok(/maxage/.test(j.__sandbox.document.getElementById('agebtn').className || ''), "la barre d'âge promet l'âge suivant malgré ageMax");
  });

  const iaAvecArmee = (j, n) => {
    const a = j.G.factions.ia;
    for (let i = 0; i < n; i++) {
      const u = j.mkUnit(j.UT.ENEMI, a.baseX + (i % 5) * 20, a.baseY + 60 + ((i / 5) | 0) * 20, a.id);
      j.G.units.push(u);
    }
    j.rebuildIndex();
    return a;
  };
  const armeeDe = (j, a) => j.G.units.filter((u) => u.owner === a.id && u.type !== j.UT.VIL && u.type !== j.UT.MONK);

  test("rôle passif : armée prête et minuteur à zéro, aucun assaut — jusqu'à ce que la mission le lance", () => {
    const j = mission(charger());
    const a = iaAvecArmee(j, 14);
    j.SCN_API.ia('ia', { role: 'passif' });
    a.atkTimer = 0; a.atkMin = 4;
    for (let k = 0; k < 20; k++) j.majPhaseAssaut(0.5, a, armeeDe(j, a));
    ok(a.phase !== 'rassemble' && a.phase !== 'assaut', 'le rival passif a lancé un assaut');
    j.SCN_API.ia('ia', { role: 'normal', lancer: true });
    j.majPhaseAssaut(0.5, a, armeeDe(j, a));
    egal(a.phase, 'rassemble', "relancé par la mission, le rival ne se met pas en marche");
  });

  test("rôle cible : l'assaut se rallie vers la zone désignée par la mission", () => {
    const j = mission(charger());
    const a = iaAvecArmee(j, 14);
    j.SCN_API.ia('ia', { cible: 'camp', lancer: true });
    a.atkMin = 4;
    j.majPhaseAssaut(0.5, a, armeeDe(j, a));
    const zn = j.zoneMission('camp');
    egal(a.phase, 'rassemble', "l'assaut n'est pas parti");
    ok(Math.hypot(a.cibleX - zn.x, a.cibleY - zn.y) < 1, "l'assaut vise autre chose que la zone de la mission");
  });

  test("consignes d'IA : pas au-delà de son âge maximum, ni Héros ni Merveille si la mission l'interdit", () => {
    const j = mission(charger());
    const a = j.G.factions.ia;
    j.SCN_API.ia('ia', { ageMax: 1, heros: false, merveille: false });
    Object.assign(a.res, { food: 99999, wood: 99999, stone: 99999, gold: 99999 });
    a.vilTarget = 1;
    const p = caseLibre(j, Math.round(a.baseX / j.BASE_TILE) + 6, Math.round(a.baseY / j.BASE_TILE), 3, 3);
    batir(j, j.BT.CASTLE, p.tx, p.ty, 'ia');
    for (let k = 0; k < 400; k++) { a.think = 0; j.updateUneIA(0.5, a); if (a.ageQ) { a.ageQ.timer = 0; } }
    ok(a.age <= 1, `l'IA a dépassé son âge maximum (âge ${a.age})`);
    egal(a.heroTrained, false, "l'IA a formé un Héros malgré heros:false");
    egal(j.G.buildings.some((b) => b.owner === 'ia' && b.type === j.BT.WONDER), false, "l'IA bâtit une Merveille malgré merveille:false");
  });

  test("la barre du haut ne promet pas d'assaut d'un rival qui n'attaquera pas", () => {
    const j = mission(charger());
    j.SCN_API.ia('ia', { role: 'passif' });
    const a = iaAvecArmee(j, 14);
    a.atkTimer = 0; a.atkMin = 4;
    j.refreshConquestBar();
    const txt = j.__sandbox.document.getElementById('wb-conquest').innerHTML;
    ok(!/assaut/.test(txt), 'la barre annonce un assaut : ' + txt);
    ok(/attend son heure/.test(txt), 'la barre ne dit pas que le rival attend : ' + txt);
  });

  test("second commandant confié à l'IA : un allié, pas un second rival", () => {
    const j = variante(charger(), 'essai_ia2', (v) => { v.roles.p2 = Object.assign({}, v.roles.p2, { solo: 'ia' }); });
    mission(j, 'essai_ia2');
    const p2 = j.G.factions.p2;
    egal(p2.role, 'allie', "l'IA du second commandant n'a pas le rôle d'allié");
    ok(j.aiTune(p2).atkEvery > j.aiTune(j.G.factions.ia).atkEvery, "l'allié attaque aussi souvent qu'un rival");
  });

  // ══ CAMPAGNE DES FRANCS (lot L5) ═══════════════════════════
  // Terrain connexe : le parcours en largeur ne bute que sur l'EAU. Les
  // palissades et abattis (bmap 3 eux aussi) s'abattent, ils ne doivent pas
  // faire croire qu'une zone est inaccessible.
  const relie = (j, a, b) => {
    const C = j.lire('COLS'), R = j.lire('ROWS');
    const vu = new Uint8Array(C * R), file = [a.tx + a.ty * C];
    vu[file[0]] = 1;
    for (let i = 0; i < file.length; i++) {
      const c = file[i], x = c % C, y = (c / C) | 0;
      if (Math.abs(x - b.tx) <= Math.max(1, b.r) && Math.abs(y - b.ty) <= Math.max(1, b.r)) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, n = nx + ny * C;
        if (nx < 0 || ny < 0 || nx >= C || ny >= R || vu[n] || j.G.tiles[ny][nx] === j.T_WATER) continue;
        vu[n] = 1; file.push(n);
      }
    }
    return false;
  };

  test('Francs : les six missions se lancent, aucun camp ne tombe d\'office, et chaque lieu nommé est accessible par la terre', () => {
    const cles = charger().CAMPAGNES.francs.missions;
    egal(cles.length, 6, 'la campagne des Francs n\'a pas ses six missions');
    for (const cle of cles) {
      const j = mission(charger(), cle);
      const p1 = j.G.units.find((u) => u.owner === 'p1');
      const dep = { tx: (p1.x / j.BASE_TILE) | 0, ty: (p1.y / j.BASE_TILE) | 0 };
      for (const z of Object.keys(j.MISSIONS[cle].zones || {})) {
        ok(relie(j, dep, j.zoneMission(z)), `${cle} : la zone « ${z} » est coupée du départ par l'eau`);
      }
      jusquA(j, 3);
      for (const f of Object.values(j.G.factions)) egal(f.vaincu, false, `${cle} : ${f.id} vaincu dès le départ`);
      egal(j.G.gameOver, false, `${cle} : mission perdue dès le départ`);
    }
  });

  test("Marche de Saxe : un joueur inactif tient au moins quatre minutes en Normal (le temps de réagir)", () => {
    const j = mission(charger(), 'fr2');
    jusquA(j, 240, () => j.G.gameOver);
    egal(j.G.gameOver, false, 'Eresburg tombe avant quatre minutes sans laisser le temps de réagir');
    ok(j.SCN_API.tirs('vague') >= 2, 'les vagues saxonnes ne sont pas parties');
  });

  test("Roncevaux : une vague lancée vers une ÉTIQUETTE marche sur elle au lieu de rester plantée", () => {
    const j = mission(charger(), 'fr3');
    const roland = j.G.units.find((u) => u.tag === 'roland');
    const poses = j.SCN_API.vague('pill', [[j.UT.ENEMI, 3]], 'e3', { vers: 'roland' });
    ok(poses.length >= 3, 'la vague n\'est pas posée');
    for (const u of poses) ok(Math.hypot(u.campX - roland.x, u.campY - roland.y) < 1, 'la vague ne vise pas Roland');
    ok(j.G.buildings.filter((b) => b.tag === 'abattis1').length >= 10, "l'abattis ne barre pas le défilé");
  });

  test("Reliques d'Aix : le rival passif plafonne son armée, puis se réveille à la deuxième relique", () => {
    const j = mission(charger(), 'fr4');
    const a = j.G.factions.ia;
    egal(a.role, 'passif', 'les Saxons ne démarrent pas passifs');
    // Garnison au complet, caisse pleine, Caserne bâtie : il ne forme plus rien
    // de militaire. (Mesuré sans ce plafond : 73 unités à la 19e minute.)
    iaAvecArmee(j, 12);
    Object.assign(a.res, { food: 99999, wood: 99999, stone: 99999, gold: 99999 });
    a.vilTarget = 1;
    // De la place pour loger : l'IA recalcule son plafond de population à
    // chaque décision (depuis ses bâtiments), un maxPop posé à la main ne
    // tiendrait pas — et faute de logement elle ne formerait rien, plafond
    // d'armée ou pas : le test ne prouverait rien.
    const bx = Math.round(a.baseX / j.BASE_TILE), by = Math.round(a.baseY / j.BASE_TILE);
    for (let i = 0; i < 2; i++) { const h = caseLibre(j, bx - 6, by + 6 * i, 2, 2); batir(j, j.BT.HLM, h.tx, h.ty, 'ia'); }
    const p = caseLibre(j, bx + 5, by, 2, 2);
    const cas = batir(j, j.BT.BARRACKS, p.tx, p.ty, 'ia');
    for (let k = 0; k < 6; k++) { a.think = 0; j.updateUneIA(0.5, a); }
    egal(cas.trainQ.length, 0, 'le rival passif, garnison au complet, forme encore des soldats');
    for (const r of j.G.relics.slice(0, 2)) r.bankedBy = 'p1';
    jusquA(j, 1);
    egal(a.role, 'normal', 'deux reliques à l\'abri et les Saxons dorment encore');
  });

  test("Ring des Avars : une place forte ceinte, qui ne sort jamais, et dont les secours cessent avec le Marché", () => {
    const j = mission(charger(), 'fr5');
    ok(j.G.buildings.filter((b) => b.owner === 'ia' && (b.type === j.BT.WALL || b.type === j.BT.GATE)).length >= 20, "le Ring n'a pas d'enceinte");
    ok(j.G.buildings.some((b) => b.tag === 'marche'), 'le Marché des Avars manque');
    jusquA(j, 300);
    egal(j.G.factions.ia.raids || 0, 0, 'la forteresse a lancé un assaut');
    const avant = j.SCN_API.tirs('secours');
    ok(avant >= 1, 'aucune colonne de secours');
    for (const b of j.G.buildings.filter((b) => b.tag === 'marche')) b.hp = 0;
    jusquA(j, 260);
    egal(j.SCN_API.tirs('secours'), avant, 'les secours arrivent encore après la chute du Marché');
  });

  test("Couronne d'Occident : SA Merveille tenue gagne la mission par la fin de mission — celle d'un rival la perd", () => {
    const j = mission(charger(), 'fr6');
    jusquA(j, 1);
    j.G.factions.p1.merveilleAchevee = true;
    j.checkMerveilleVictory();
    egal(j.G.victory, true, 'la Merveille achevée ne gagne pas la mission');
    egal(j.G.scn.fin && j.G.scn.fin.issue, 'victoire', 'la victoire par Merveille contourne la fin de mission (ni étoiles ni progression)');
    ok(j.G.scn.etoiles >= 1, 'aucune étoile comptée');
    const k = mission(charger(), 'fr6');
    jusquA(k, 1);
    k.G.factions.ia2.merveilleAchevee = true;
    k.checkMerveilleVictory();
    egal(k.G.gameOver, true, 'la Merveille danoise ne perd pas la mission');
    egal(k.G.scn.fin.cause, 'merveille', 'cause de la défaite');
    ok(/Merveille/.test(k.texteFinMission()), 'le texte de fin ne dit pas pourquoi : ' + k.texteFinMission());
  });

  test('format : chaque mission et chaque campagne est bien formée', () => {
    const j = charger();
    const clesFac = new Set(['p1', 'p2', 'ia', 'ia2', 'pill']);
    const ops = new Set(['eau', 'lac', 'terre', 'gue', 'degager', 'foret', 'baies', 'poissons', 'gisement', 'relique', 'faune']);
    const dansCarte = (p, ou) => {
      const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
      ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${ou} : position hors de la carte (${x}, ${y})`);
    };
    for (const [cle, m] of Object.entries(j.MISSIONS)) {
      const ou = `mission « ${cle} »`;
      ok(m.titre, `${ou} sans titre`);
      ok(m.carte && m.carte.graine, `${ou} sans graine fixe`);
      ok(!m.carte.taille || j.TAILLES[m.carte.taille], `${ou} : taille inconnue`);
      ok(!m.carte.type || j.CARTES[m.carte.type], `${ou} : type de carte inconnu`);
      ok(m.roles && m.roles.p1, `${ou} sans rôle p1`);
      for (const [k, r] of Object.entries(m.roles)) {
        ok(k === 'p1' || k === 'p2', `${ou} : rôle inconnu « ${k} »`);
        ok(!r.civ || j.CIVS[r.civ], `${ou} : civilisation inconnue pour ${k}`);
        if (r.depart) dansCarte(r.depart, `${ou}, départ de ${k}`);
      }
      for (const k of Object.keys(m.factions || {})) ok(clesFac.has(k), `${ou} : faction inconnue « ${k} »`);
      for (const [nom, z] of Object.entries(m.zones || {})) dansCarte(z, `${ou}, zone ${nom}`);
      const ids = (m.objectifs || []).map((o) => o.id);
      egal(new Set(ids).size, ids.length, `${ou} : deux objectifs portent le même id`);
      ok((m.objectifs || []).some((o) => o.type !== 'secondaire' && o.test), `${ou} : aucun objectif principal ne peut être rempli`);
      for (const o of (m.objectifs || [])) ok(o.txt, `${ou} : objectif « ${o.id} » sans texte`);
      for (const d of (m.declencheurs || [])) ok(d.id && typeof d.si === 'function' && typeof d.alors === 'function', `${ou} : déclencheur mal formé`);
      for (const op of (m.surcouche || [])) ok(ops.has(op.op), `${ou} : opération de surcouche inconnue « ${op.op} »`);
      for (const lignes of Object.values(m.dialogues || {})) for (const [qui] of lignes)
        ok(m.orateurs && m.orateurs[qui], `${ou} : orateur « ${qui} » sans fiche`);
    }
    for (const [cle, c] of Object.entries(j.CAMPAGNES)) {
      ok(j.HEROES[c.heros], `campagne « ${cle} » : héros inconnu`);
      for (const id of c.missions) {
        ok(j.MISSIONS[id], `campagne « ${cle} » : mission « ${id} » introuvable`);
        egal(j.MISSIONS[id].campagne, cle, `mission « ${id} » : campagne mal renseignée`);
      }
    }
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
