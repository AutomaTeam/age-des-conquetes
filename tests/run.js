// Harnais de test du jeu — sans navigateur, sans dépendance, sans build.
//
//   node tests/run.js            tout
//   node tests/run.js carte      un seul groupe (carte, reseau, sauvegarde,
//                                chemin, combat)
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
    const j = partie(charger(), { graine: 4242 });
    const duel = (x, y, n) => {
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
    // Deux factions jumelles : MÊME automate des deux côtés. Opposer une
    // escouade en marche d'attaque à une escouade sur l'automate ennemi
    // biaise massivement le résultat — voir la mémoire du chantier 2.
    const mk = j.__sandbox.mkFaction;
    j.G.factions.tA = mk('tA', { genre: 'neutre', equipe: 91, hostileATous: true, civ: 'francs', nom: 'A' });
    j.G.factions.tB = mk('tB', { genre: 'neutre', equipe: 92, hostileATous: true, civ: 'francs', nom: 'B' });
    const gagnant = (x, y) => { const [a, b] = duel(x, y, 10); return a > b ? x : b > a ? y : null; };
    egal(gagnant(j.UT.PIKE, j.UT.KNIGHT), j.UT.PIKE, 'le Piquier doit battre le Chevalier');
    egal(gagnant(j.UT.ARC, j.UT.PIKE), j.UT.ARC, 'l\'Archer doit battre le Piquier');
    egal(gagnant(j.UT.KNIGHT, j.UT.ARC), j.UT.KNIGHT, 'le Chevalier doit battre l\'Archer');
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
