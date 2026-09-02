// Charge le jeu dans un contexte Node isolé et rend ses symboles
// accessibles aux tests.
//
// Pourquoi ça marche sans build : le jeu est une suite de <script> CLASSIQUES
// (pas de modules ES), sans import ni dépendance. On lit leur liste et leur
// ORDRE dans index.html, on évalue chaque fichier séparément dans un `vm`
// muni des bouchons DOM — comme le ferait le navigateur, portée globale
// commune comprise — puis on ajoute une ligne d'export. Les `const` de
// premier niveau d'un script `vm` restent dans SA portée lexicale et ne
// remontent pas au contexte : il faut donc les publier explicitement.
//
// Le second bloc <script type="module"> (Firebase) est délibérément ignoré :
// il ne publie que window.MP, et tout le jeu l'appelle derrière des gardes
// `window.MP?.…`. Son absence est donc exactement le cas « multijoueur non
// configuré », déjà pris en charge.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installer } = require('./stub-dom');

const RACINE = path.join(__dirname, '..');

// Tout ce dont les tests ont besoin. Une entrée absente du fichier ferait
// planter l'export avec un ReferenceError explicite — c'est voulu : mieux
// vaut un échec net qu'un test qui vérifie `undefined`.
const EXPORTS = [
  'G', 'update', 'SIM_DT', 'startGame', 'initState', 'genMap', 'setGraine',
  'pickMode', 'pickDifficulty', 'mkUnit', 'mkBuilding', 'placeBuilding',
  'rebuildGrid', 'rebuildIndex', 'unitById', 'bldById', 'nodeById',
  'findPath', 'tileBlocked', 'wallAt', 'losClear',
  'construireSnap', 'appliquerSnap', 'construireDelta', 'appliquerDelta',
  'buildSaveData', 'migrerSauvegarde', 'RESEAU', 'PROTO_VERSION',
  'UT', 'BT', 'RT', 'UDEF', 'BDEF', 'FAC', 'CIVS', 'AGES', 'RDEF',
  'COLS', 'ROWS', 'BASE_TILE', 'MODES', 'DIFFS',
  'estHostile', 'fac', 'moi', 'estLocal', 'isMilitary',
  'degatsContre', 'degatsDe', 'armureDe', 'classeDe', 'BONUS', 'BLD_ARMOR',
  'gatherCap', 'gatherMult', 'separerUnites', 'heroAuraMult', 'majHeros',
  'estSel', 'selMilitary', 'ASSET_EXT',
  'applyCommand', 'pickCiv', 'civKeyOf', 'civOf', 'PRODUCTION', 'ORD', 'mkFaction',
  'CARTES', 'pickCarte', 'carteCfg', 'poserMursArene', 'construireSalut', 'T_WATER',
  'TAILLES', 'pickTaille', 'departsHumains',
  'SOLS', 'DECORS_SOL', 'GRASS_VARIANTS', 'solCfg',
  'TCOST', 'TROCS', 'AGE_BONUS', 'RELIC_COUNT', 'FARM_RESEED_COST', 'FARM_FOOD',
  'MERVEILLE_WIN_TIME', 'canAfford', 'spend', 'resPool', 'updatePopCap',
  'aiNextBuild', 'AI_TRAINERS', 'trainTime', 'possedeBatiment', 'appliquerDemolition',
  'tryAutoReseed', 'hasAdjacentWater', 'updateUneIA', 'aiVilTarget', 'updateVisuel',
  'awardKillXP', 'veterancyRank', 'RANK_THRESHOLDS',
  'cibleAssaillant', 'prochainHostileUnite', 'prochainHostileToute', 'updateEnemyAI',
  // Correctifs « l'IA joue aux mêmes règles » : chacun a son test de
  // non-régression dans le groupe `ia`.
  'cibleMerveille', 'nearPlayerBuildingSmart', 'majPhaseAssaut', 'aiMerveilleHostile',
  'aiRepare', 'AI_REPAIR_MAX', 'aiUniteUnique', 'aiLogement', 'AI_HLM_DEFICIT',
  'aiTroquer', 'aiCout', 'AI_BOAT_MAX', 'aiCount',
];

// L'ORDRE de chargement est significatif (scripts classiques partageant une
// seule portée globale). On le lit donc dans index.html plutôt que de le
// recopier ici : une seule source de vérité, et un fichier ajouté au jeu
// entre automatiquement dans les tests.
function sourcesDuJeu() {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const re = /<script\s+src="(js\/[^"]+)"><\/script>/g;
  const fichiers = [...html.matchAll(re)].map((m) => m[1]);
  if (!fichiers.length) throw new Error('aucun <script src="js/…"> dans index.html');
  return fichiers.map((f) => ({ nom: f, code: fs.readFileSync(path.join(RACINE, f), 'utf8') }));
}

function charger({ silencieux = true } = {}) {
  const sources = sourcesDuJeu();

  const sandbox = Object.create(null);
  installer(sandbox);
  sandbox.console = silencieux
    ? { log() {}, warn() {}, error() {}, info() {}, debug() {} }
    : console;

  const exportLigne =
    '\n;globalThis.__jeu = {' +
    EXPORTS.map((n) => `${JSON.stringify(n)}: typeof ${n}!=="undefined" ? ${n} : undefined`).join(',') +
    '};\n' +
    // Certains symboles doivent être RÉAFFECTABLES depuis les tests (G est
    // remplacé par initState). On expose donc aussi un accesseur vivant.
    ';globalThis.__lire = (n) => eval(n);\n';

  const ctx = vm.createContext(sandbox);
  // Chaque fichier est évalué SÉPARÉMENT, comme le navigateur le fait. C'est
  // ce qui reproduit fidèlement le découpage — en particulier le fait qu'une
  // fonction déclarée dans un fichier n'est PAS hissée dans les précédents.
  // Le nom du fichier est passé à `vm` pour que les traces d'erreur désignent
  // le bon fichier et la bonne ligne.
  for (const { nom, code } of sources) {
    try {
      vm.runInContext(code, ctx, { filename: nom, timeout: 60000 });
    } catch (e) {
      e.message = `${nom} : ${e.message}`;
      throw e;
    }
  }
  // L'export doit voir les déclarations de TOUS les fichiers : leur portée
  // lexicale globale est commune, un dernier script suffit donc.
  vm.runInContext(exportLigne, ctx, { filename: 'exports', timeout: 60000 });

  const jeu = sandbox.__jeu;
  const manquants = EXPORTS.filter((n) => jeu[n] === undefined);
  if (manquants.length) {
    throw new Error('symboles introuvables dans index.html : ' + manquants.join(', '));
  }
  // `G` est réassigné par initState() : on relit toujours la valeur vivante.
  Object.defineProperty(jeu, 'G', { get: () => sandbox.__lire('G'), configurable: true });

  // Math.random DÉTERMINISTE, sur demande. La simulation en utilise en pleine
  // boucle de jeu (ciblage de l'IA désynchronisé, chasse occasionnelle,
  // particules) : tout test qui dépend de l'issue d'un combat est donc
  // instable par nature. Le semer rend le résultat reproductible — et un test
  // intermittent est pire que pas de test, il apprend à ignorer les échecs.
  //
  // On remplace Math.random DANS le contexte vm, pas celui de Node : les
  // intrinsèques y sont distincts, le harnais lui-même n'est pas affecté.
  jeu.semerAleatoire = (graine) => {
    vm.runInContext(
      'Math.random = (function(){ let s = ' + ((graine >>> 0) || 1) + ';' +
      ' return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();',
      ctx, { filename: 'semerAleatoire' });
  };
  jeu.__ctx = ctx;
  jeu.__sandbox = sandbox;
  return jeu;
}

module.exports = { charger, EXPORTS };
