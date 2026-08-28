// Charge le jeu (index.html) dans un contexte Node isolé et rend ses
// symboles accessibles aux tests.
//
// Pourquoi ça marche sans build : le jeu est un unique <script> classique,
// sans import ni dépendance. On extrait ce bloc, on l'évalue dans un `vm`
// muni des bouchons DOM, et on lui ajoute une ligne d'export — les `const`
// de premier niveau d'un script `vm` restent dans SA portée lexicale et ne
// remontent pas au contexte, il faut donc les publier explicitement.
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
];

function extraireScript(html) {
  // Premier bloc <script> sans attribut (le grand script classique).
  const i = html.indexOf('<script>');
  if (i < 0) throw new Error("bloc <script> introuvable dans index.html");
  const j = html.indexOf('</script>', i);
  if (j < 0) throw new Error("</script> introuvable");
  return html.slice(i + '<script>'.length, j);
}

function charger({ silencieux = true } = {}) {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const src = extraireScript(html);

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
  vm.runInContext(src + exportLigne, ctx, { filename: 'index.html', timeout: 60000 });

  const jeu = sandbox.__jeu;
  const manquants = EXPORTS.filter((n) => jeu[n] === undefined);
  if (manquants.length) {
    throw new Error('symboles introuvables dans index.html : ' + manquants.join(', '));
  }
  // `G` est réassigné par initState() : on relit toujours la valeur vivante.
  Object.defineProperty(jeu, 'G', { get: () => sandbox.__lire('G'), configurable: true });
  jeu.__ctx = ctx;
  jeu.__sandbox = sandbox;
  return jeu;
}

module.exports = { charger, EXPORTS };
