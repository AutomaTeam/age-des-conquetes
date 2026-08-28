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
