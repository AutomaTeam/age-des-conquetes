// Sonde d'équilibrage d'une mission de campagne — hors de la suite de tests :
// elle MESURE, elle ne garde rien.
//
//   node outils/sonde-mission.js <mission> [difficulte] [minutes]
//   node outils/sonde-mission.js fr2 brutal 16
//
// Lance la mission sans navigateur (même harnais que les tests), laisse le
// joueur INACTIF — ses unités ne se défendent que d'elles-mêmes, ses
// villageois ne récoltent pas — et relève chaque minute les effectifs de
// chaque camp, l'état des objectifs et les déclencheurs tirés. C'est une
// BORNE BASSE : ce qu'un joueur qui ne fait rien encaisse. Repères retenus
// pour la campagne des Francs (2026-09-12) : en Facile un joueur inactif
// tient ou presque ; en Normal il doit tomber, mais pas avant plusieurs
// minutes (le temps de comprendre et de réagir) ; en Brutal nettement plus tôt.
//
// Les missions qui ne se jouent pas en défense (escorte, siège) demandent une
// sonde SCRIPTÉE — des ordres réels passés par applyCommand, comme un joueur
// qui ne micro-gère pas. Voir le commit « campagne des Francs » pour les deux
// qui ont servi à calibrer Roncevaux et le Ring des Avars.
'use strict';
const path = require('path');
const { charger } = require(path.join(__dirname, '..', 'tests', 'harness'));

const cle = process.argv[2] || 'fr2';
const diff = process.argv[3] || 'normal';
const minutes = +(process.argv[4] || 10);

const j = charger({ silencieux: true });
if (!j.MISSIONS[cle]) { console.error(`Mission inconnue : ${cle}. Connues : ${Object.keys(j.MISSIONS).join(', ')}`); process.exit(1); }
j.pickDifficulty(diff);
j.lancerMission(cle);
const G = j.G;
const resume = () => Object.keys(G.factions).map((id) => {
  const u = G.units.filter((x) => x.owner === id && x.hp > 0).length;
  const b = G.buildings.filter((x) => x.owner === id).length;
  return `${id}:u${u}/b${b}${G.factions[id].vaincu ? '💀' : ''}`;
}).join(' ');

console.log(`${cle} (${j.MISSIONS[cle].titre}) — ${diff} — carte ${j.lire('COLS')}×${j.lire('ROWS')}`);
console.log(`départ  ${resume()}`);
const t0 = Date.now();
for (let s = 1; s <= minutes * 60; s++) {
  for (let k = 0; k < 30; k++) { j.update(j.SIM_DT); if (G.gameOver || G.victory) break; }
  if (s % 60 === 0) console.log(`${String(s / 60).padStart(3)} min ${resume()}  objectifs ${JSON.stringify(G.scn.obj)}  déclencheurs ${Object.keys(G.scn.decl).join(',')}`);
  if (G.gameOver || G.victory) {
    console.log(`FIN à ${Math.round(G.gameTime)} s : ${G.victory ? 'victoire' : 'défaite'} — ${j.texteFinMission()}`);
    break;
  }
}
console.log(`(${Date.now() - t0} ms de simulation)`);
process.exit(0);
