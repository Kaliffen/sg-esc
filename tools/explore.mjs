// Exploration helper: answers routing questions about the map without playing it.
import { Driver, squad } from './driver.mjs';
const d = new Driver({ squad: squad(3) });
const q = (label, name, x, z, layer) => console.log(label.padEnd(44), d.reachable(name, x, z, layer) ? 'REACHABLE' : 'no route');
console.log('start', d.where('Ren'));
q('Ren -> warehouse roof (6.5,104) L1', 'Ren', 6.5, 104, 1);
q('Ren -> south row roof (60,105) L1', 'Ren', 60, 105, 1);
q('Ren -> smithy roof (105,102) L1', 'Ren', 105, 102, 1);
q('Ren -> guardhouse roof (139,78) L1', 'Ren', 139, 78, 1);
q('Ren -> sewer main drain (62,100) L-1', 'Ren', 62, 100, -1);
q('Ren -> sewer north drain below sluice (66,70) L-1', 'Ren', 66, 70, -1);
q('Ren -> sewer north drain above sluice (66,60) L-1', 'Ren', 66, 60, -1);
q('Ren -> guardhouse inside (118,100) L0', 'Ren', 118, 100, 0);
q('Ren -> key ring (142.5,79) L0', 'Ren', 142.5, 79, 0);
q('Ren -> temple grounds (46,64) L0', 'Ren', 46, 64, 0);
q('Ren -> noble quarter (67,44) L0', 'Ren', 67, 44, 0);
q('Ren -> exit (154,36) L0', 'Ren', 154, 36, 0);
q('Mei (STR5 AGI4) -> sewer (62,100) L-1', 'Mei', 62, 100, -1);
q('Mei (STR5 AGI4) -> warehouse roof L1', 'Mei', 6.5, 104, 1);
// enemy timing table: 60 s of patrol, print facing of sentinel and positions of key guards every 2 s
console.log('\nt    sentinel°  door-guard            wall-guard            elite1               gate1/gate2 facing');
for (let i = 0; i < 30; i++) {
  d.run(2);
  const e = (id) => { const x = d.enemy(id); return `(${x.x.toFixed(0)},${x.z.toFixed(0)}) ${String(Math.round(x.facing * 180 / Math.PI)).padStart(4)}°`; };
  console.log(`${d.t.toFixed(0).padStart(3)}  ${String(d.facingDeg('e_sentinel')).padStart(5)}      ${e('e_door').padEnd(20)}  ${e('e_m2').padEnd(20)}  ${e('e_elite1').padEnd(20)} ${d.facingDeg('e_gate1')}/${d.facingDeg('e_gate2')}`);
}
console.log('status', d.s.status);
