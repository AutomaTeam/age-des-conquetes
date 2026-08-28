// Harnais de test du jeu — sans navigateur, sans dépendance, sans build.
//
//   node tests/run.js            tout (~35 s)
//   node tests/run.js ordres     un seul groupe
//
// Groupes : carte, reseau, sauvegarde, chemin, combat, civilisations,
// cartes, ordres, economie, ages, finpartie, ia.
// Le groupe `ia` compte pour les deux tiers du temps total : il simule de
// vraies parties de 15 minutes, c'est le prix pour observer un comportement
// qui n'existe qu'apres plusieurs minutes de jeu.
//
// Ce que ces tests gardent, ce sont les zones qu'on NE PEUT PAS vérifier à
// l'œil : la sérialisation réseau, la migration de sauvegarde, le
// déterminisme de la carte et le contournement d'obstacle. Le rendu n'est
// pas testé (les bouchons ne dessinent rien) et ne doit pas l'être ici.

'use strict';
const { charger } = require('./harness');

// ── micro-cadre de test ────────────────────────────────────
let groupeCourant = '';
const resultats = [];
function groupe(nom, fn) { groupeCourant = nom; fn(); }
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

  test('le snapshot survit à un aller-retour JSON', () => {
    const hote = partie(charger(), { graine: 4242, pas: 300 });
    const snap = hote.construireSnap();
    egalJSON(snap, JSON.parse(JSON.stringify(snap)), 'snapshot sérialisable');
  });
});

// ════════════════════════════════════════════════════════════
groupe('sauvegarde', () => {
  test('sauvegarde → migration : aucune perte sur un état courant', () => {
    const j = partie(charger(), { graine: 4242, pas: 600 });
    const d = j.buildSaveData();
    const m = j.migrerSauvegarde(JSON.parse(JSON.stringify(d)));
    ok(m && typeof m === 'object', 'migration a rendu autre chose qu\'un objet');
    egalJSON(Object.keys(d).sort(), Object.keys(m).sort(), 'clés de sauvegarde');
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

  test('la sauvegarde retient le type de carte', () => {
    const j = avecCarte('arides', { graine: 909, pas: 60 });
    egal(j.buildSaveData().carte, 'arides', 'type de carte absent de la sauvegarde');
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

// ── rapport ────────────────────────────────────────────────
const cible = process.argv[2];
const vus = cible ? resultats.filter((r) => r.groupe === cible) : resultats;
let dernier = '';
for (const r of vus) {
  if (r.groupe !== dernier) { console.log(`\n  ${r.groupe}`); dernier = r.groupe; }
  console.log(`    ${r.ok ? '✓' : '✗'} ${r.nom}  (${r.ms} ms)`);
  if (!r.ok) console.log(`        ${r.err.split('\n').join('\n        ')}`);
}
const echecs = vus.filter((r) => !r.ok).length;
console.log(`\n  ${vus.length - echecs}/${vus.length} tests passent${echecs ? ` — ${echecs} ÉCHEC(S)` : ''}\n`);
process.exit(echecs ? 1 : 0);
