// End-to-end headless scenarios: `node tools/e2e.mjs [lose|win|saveload|all] [-v]`
// Each scenario drives the real simulation (src/sim) through tools/driver.mjs and asserts the outcome. No browser.
import { Driver, squad } from './driver.mjs';

const verbose = process.argv.includes('-v');
const which = process.argv.slice(2).find((a) => !a.startsWith('-')) || 'all';
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); return ok; }

/* ---------------- lose: walk into the door guard's cone ---------------- */
function lose() {
  const d = new Driver({ squad: squad(3), log: verbose });
  d.until(() => d.enemy('e_door').x < 38 && Math.abs(d.facingDeg('e_door')) > 170, 30, 'guard faces the door');
  d.stance('Ren', 'run').move('Ren', 40, 88);
  const st = d.run(20);
  check('lose: running into a guard cone fails the map', st === 'failed', d.s.failReason);
  check('lose: an alarmed enemy has a full meter', d.enemy('e_door').detect === 1 && d.enemy('e_door').state === 'alarmed');
  return d;
}

/* ---------------- save / load: snapshot is a faithful plain-data copy ---------------- */
function saveload() {
  const d = new Driver({ squad: squad(3) });
  d.move('Ren', 20, 96); d.run(2); d.save();
  const before = JSON.stringify(d.s);
  d.run(5);
  const after = JSON.stringify(d.s);
  check('saveload: state changes while running', before !== after);
  d.load();
  check('saveload: restore returns the saved state exactly', JSON.stringify(d.s) === before);
  d.run(5);
  check('saveload: replay after load is deterministic', JSON.stringify(d.s) === after);
  // quickload must also restore nav (door locks) — unlock a door, save, lock-state replay
  const d2 = new Driver({ squad: squad(3) });
  d2.s.doorLocked.temple_gate = false; d2.sim.rebuildNav(0); d2.save();
  d2.s.doorLocked.temple_gate = true; d2.sim.rebuildNav(0);
  check('saveload: nav blocked while door locked', !d2.reachable('Ren', 46, 64, 0));
  d2.load();
  check('saveload: nav rebuilt from restored door state', d2.reachable('Ren', 46, 64, 0));
}

/* ---------------- win: full playthrough ---------------- */
function win() {
  const d = new Driver({ squad: squad(3), log: verbose });
  const all = ['Ren', 'Mei', 'Taro'];
  const phase = (name, fn) => { if (d.s.status !== 'playing') return false; if (verbose) console.log(`--- ${name} (t=${d.t.toFixed(1)})`); const ok = fn(); if (!ok || d.s.status === 'failed') { console.log(`  phase "${name}" failed at t=${d.t.toFixed(1)}: ${d.s.failReason || 'timeout'}`); d.report(); for (const ev of d.events.slice(-6)) console.log(`    ev t=${ev.t} ${ev.kind} ${ev.text}`); console.log('    exit reachable by Ren:', d.reachable('Ren', 154, 36, 0), 'wicket locked:', d.s.doorLocked.wicket); return false; } return true; };
  const allIdle = () => all.every((n) => d.idle(n));
  const allAt = (x, z, r = 1.5) => all.every((n) => d.at(n, x, z, r));
  const goAll = (x, z, o) => { for (const n of all) d.move(n, x, z, o); };
  const guardTurnedEast = () => d.enemy('e_door').x < 38.5 && Math.abs(d.facingDeg('e_door')) < 10; // just turned at the west end: ~12 s before he faces the door again

  const hop = (label, issue, done, o) => phase(label, () => d.attempt(label, issue, done, o));
  let ok = hop('stage inside the warehouse', () => goAll(30, 80), allIdle, { hopMax: 30 });
  ok = ok && hop('out of the door and into the bush north of it', () => goAll(46, 74.5), () => allAt(46, 74.5, 1.4), { hopMax: 25 });
  ok = ok && hop('pick the Temple Gate', () => d.door('Ren', 'temple_gate'), () => !d.s.doorLocked.temple_gate, { hopMax: 12 });
  ok = ok && hop('through the gate', () => goAll(46, 64), () => allAt(46, 64, 1.6), { hopMax: 10 });
  ok = ok && hop("to the bush inside the officer's loop", () => goAll(20, 45), () => allAt(20, 45, 1.4), { hopMax: 25 });
  ok = ok && hop('work the sluice winch', () => d.interact('Ren', 'winch'), () => d.s.interactables.winch.used && d.idle('Ren'), { hopMax: 12 });
  ok = ok && hop('back to the loop bush', () => d.move('Ren', 20, 45), () => d.at('Ren', 20, 45, 1.4), { hopMax: 10 });
  ok = ok && hop('bush hop: garden middle', () => goAll(40, 40), () => allAt(40, 40, 1.6), { hopMax: 20 });
  ok = ok && hop('bush hop: below the shrine', () => goAll(54, 30), () => allAt(54, 30, 1.6), { hopMax: 15 });
  ok = ok && hop('bush hop: shrine bush by the east door', () => goAll(58, 16), () => allAt(58, 16, 1.4), { hopMax: 15 });
  ok = ok && hop('run through the east door past the samurai', () => { for (const n of all) d.stance(n, 'run').move(n, 66, 36); }, () => allAt(66, 36, 1.6), { hopMax: 12, every: 0.5 });
  if (ok) for (const n of all) d.stance(n, 'sneak');
  ok = ok && hop('manor corner', () => goAll(70, 27), () => allAt(70, 27, 1.6), { hopMax: 12 });
  ok = ok && hop('east along the manor wall', () => goAll(128, 27), () => allAt(128, 27, 1.6), { hopMax: 40, every: 2 });
  ok = ok && hop('stage in the bush south of the gate', () => goAll(136, 44), () => allAt(136, 44, 1.4), { hopMax: 20, every: 2 });
  ok = ok && hop('smoke between the gate guards, double takedown under it, pick the wicket', () => {
    d.ability('Mei', 'smoke', 143, 35);
    d.delay('Ren', 2.0); d.takedown('Ren', 'e_gate1'); d.door('Ren', 'wicket', true);
    d.delay('Taro', 1.5); d.takedown('Taro', 'e_gate2');
  }, () => !d.s.doorLocked.wicket, { hopMax: 30, every: 1 });
  ok = ok && hop('everyone out', () => goAll(154, 36), () => d.s.status !== 'playing', { hopMax: 20 });
  check('win: the map can be completed', d.s.status === 'won', `t=${d.t.toFixed(1)}s takedowns=${d.s.stats.takedowns} steps=${d.steps}`);
  check('win: events fired on the way', !!d.s.firedEvents['door:temple_gate'] && !!d.s.firedEvents['door:sluice'], Object.keys(d.s.firedEvents).join(','));
  return d;
}

/* ---------------- features: facing on arrival, rare speed skills, roof route, restart re-locks nav ---------------- */
function features() {
  const d = new Driver({ squad: squad(3) });
  const ren = d.char('Ren');
  d.sim.orderMove(ren.id, { x: 16, z: 96 }, 0, false, Math.PI / 2);
  d.until(() => d.idle('Ren'), 20);
  check('face: character faces the dragged direction on arrival', Math.abs(ren.facing - Math.PI / 2) < 1e-9, `facing=${ren.facing.toFixed(3)}`);
  ren.abilities.push('sprint', 'ghost');
  d.ability('Ren', 'sprint'); d.move('Ren', 30, 96, { append: true });
  d.run(0.5);
  const x0 = ren.x; d.run(1.0);
  check('sprint: boosted, loud, and faster than running', ren.boost && ren.boost.kind === 'sprint' && ren.loud && (ren.x - x0) > 6, `moved ${(ren.x - x0).toFixed(2)} m in 1 s`);
  d.until(() => d.idle('Ren'), 20); d.run(3);
  check('sprint: unlimited (no charge counter) and boost expired', ren.consumables.sprint === undefined && !ren.boost);
  d.ability('Ren', 'ghost'); d.move('Ren', 12, 96, { append: true }); d.run(0.5);
  const x1 = ren.x; d.run(1.0);
  check('stealth sprint: boosted, silent, run speed', ren.boost && ren.boost.kind === 'ghost' && !ren.loud && ren.moving && (x1 - ren.x) > 3.5, `moved ${(x1 - ren.x).toFixed(2)} m in 1 s`);
  check('speed spread: SPD 1 vs SPD 10 differ by 2x', (() => { const lo = { attrs: { speed: 1 } }, hi = { attrs: { speed: 10 } }; const f = (c) => 1.5 + 0.17 * c.attrs.speed; return f(hi) / f(lo) > 1.9; })());
  check('roof route: warehouse roof connects to the smithy vine', d.reachable('Ren', 109, 100, 1));
  // restart must re-lock doors on the shared nav grid
  d.s.doorLocked.temple_gate = false; d.sim.rebuildNav(0);
  check('restart: nav open after unlocking in run 1', d.reachable('Ren', 46, 64, 0));
  const d2 = new Driver({ squad: squad(3) }); // same process, same shared world module
  check('restart: a new mission re-locks the Temple Gate on the nav grid', !d2.reachable('Ren', 46, 64, 0));
  // blind preset refuses orders while paused
  const d3 = new Driver({ squad: squad(2), opts: { blind: true } });
  d3.sim.uiPaused = true; d3.move('Ren', 20, 96);
  check('blind: no orders while paused', d3.char('Ren').orders.length === 0);
  d3.sim.uiPaused = false; d3.move('Ren', 20, 96);
  check('blind: orders accepted while running', d3.char('Ren').orders.length === 1);
}

const t0 = Date.now();
if (which === 'lose' || which === 'all') lose();
if (which === 'saveload' || which === 'all') saveload();
if (which === 'features' || which === 'all') features();
if (which === 'win' || which === 'all') win();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
