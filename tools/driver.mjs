// Headless remote control for the VEIL simulation. No browser, no three.js: runs src/sim + src/world in Node.
//   import { Driver, squad } from './driver.mjs'
//   const d = new Driver({ squad: squad(), log: true });
//   d.move('Ren', 30, 92); d.until(() => d.idle('Ren'), 30); console.log(d.s.status)
import { MAP } from '../src/world/map-data.js';
import { buildWorld } from '../src/world/map.js';
import { Sim, DT } from '../src/sim/sim.js';
import { ENEMY_TYPES } from '../src/sim/enemies.js';
import { dist } from '../src/core/math.js';

/** A deterministic squad that can solve the map: lockpick+takedown climber/lifter, distraction specialist, second takedown. */
export function squad(n = 3) {
  const all = [
    { id: 'ren', name: 'Ren', epithet: 'the Quiet', color: '#4fc3f7', attrs: { stealth: 9, speed: 6, perception: 6, strength: 8, agility: 8 }, abilities: ['takedown', 'lockpick'] },
    { id: 'mei', name: 'Mei', epithet: 'Halfmoon', color: '#a5d6a7', attrs: { stealth: 8, speed: 6, perception: 8, strength: 5, agility: 4 }, abilities: ['stone', 'smoke'] },
    { id: 'taro', name: 'Taro', epithet: 'Two-Knives', color: '#ffcc80', attrs: { stealth: 8, speed: 7, perception: 6, strength: 7, agility: 7 }, abilities: ['takedown', 'whistle'] },
    { id: 'saki', name: 'Saki', epithet: 'Longstride', color: '#f48fb1', attrs: { stealth: 7, speed: 9, perception: 5, strength: 4, agility: 9 }, abilities: ['stone', 'whistle'] },
  ];
  return all.slice(0, n);
}

const deg = (r) => Math.round((r * 180) / Math.PI);

export class Driver {
  constructor({ squad: sq = squad(), opts = {}, log = false } = {}) {
    this.world = buildWorld(MAP);
    this.sim = new Sim(this.world, sq, opts);
    this.log = log; this.events = []; this.steps = 0;
  }
  get s() { return this.sim.state; }
  get t() { return this.s.t; }
  char(name) { const c = this.s.chars.find((c) => c.name === name || c.id === name); if (!c) throw new Error('no char ' + name); return c; }
  enemy(id) { const e = this.s.enemies.find((e) => e.id === id || e.name === id); if (!e) throw new Error('no enemy ' + id); return e; }
  idle(name) { const c = this.char(name); return !c.orders.length && !c.action && !c.legs && c.waitLeft <= 0; }
  at(name, x, z, r = 0.8) { const c = this.char(name); return dist(c, { x, z }) <= r; }
  facingDeg(id) { return deg(this.enemy(id).facing); }
  /** Advance the sim by `seconds`; stops early when the status changes. Returns the status. */
  run(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n && this.s.status === 'playing'; i++) { this.sim.update(DT); this.steps++; this.drain(); }
    return this.s.status;
  }
  /** Run until pred() is true or `max` seconds pass. Returns true when the predicate fired. */
  until(pred, max = 60, label = '') {
    const t0 = this.t;
    while (this.t - t0 < max && this.s.status === 'playing') { if (pred()) return true; this.sim.update(DT); this.steps++; this.drain(); }
    if (pred()) return true;
    if (this.log) console.log(`  [timeout${label ? ' ' + label : ''}] after ${max}s (status ${this.s.status})`);
    return false;
  }
  drain() { for (const ev of this.sim.events) { this.events.push({ t: +this.t.toFixed(2), ...ev }); if (this.log) console.log(`  t=${this.t.toFixed(1).padStart(6)} ${ev.kind.padEnd(5)} ${ev.text}`); } this.sim.events.length = 0; }

  // ---- orders (thin wrappers over the Sim API; layer defaults to the character's layer) ----
  move(name, x, z, { layer, append = false, wait = 0 } = {}) { const c = this.char(name); this.sim.orderMove(c.id, { x, z }, layer ?? c.layer, append); const o = c.orders[c.orders.length - 1]; if (o && wait) o.wait = wait; return this; }
  transition(name, id, append = false) { this.sim.orderUseTransition(this.char(name).id, id, append); return this; }
  door(name, id, append = false) { this.sim.orderUseDoor(this.char(name).id, id, append); return this; }
  item(name, id, append = false) { this.sim.orderPickItem(this.char(name).id, id, append); return this; }
  interact(name, id, append = false) { this.sim.orderInteract(this.char(name).id, id, append); return this; }
  takedown(name, enemyId, append = false) { this.sim.orderTakedown(this.char(name).id, enemyId, append); return this; }
  carry(name, enemyId, append = false) { this.sim.orderCarry(this.char(name).id, enemyId, append); return this; }
  dropAt(name, x, z, append = false) { const c = this.char(name); this.sim.orderDropAt(c.id, { x, z }, c.layer, append); return this; }
  ability(name, ab, x, z, append = false) { this.sim.orderAbility(this.char(name).id, ab, x == null ? null : { x, z }, append); return this; }
  stance(name, st) { const c = this.char(name); if (c.stance !== st) this.sim.toggleStance(c.id); return this; }
  hold(name) { this.sim.clearOrders(this.char(name).id); return this; }
  delay(name, secs) { this.sim.setDelay(this.char(name).id, secs); return this; }
  save() { this.snap = this.sim.snapshot(); return this; }
  load() { return this.sim.restore(this.snap); }
  /**
   * Speculative hop: snapshot, issue orders, run until done() or hopMax seconds. On failure (spotted or timeout)
   * restore the snapshot, let `every` seconds pass, and try again, for up to maxWait seconds of waiting.
   * Returns true when a hop succeeded (state is left at its end), false when every attempt failed (state restored).
   */
  attempt(label, issue, done, { maxWait = 150, every = 1.0, hopMax = 45 } = {}) {
    const snap0 = this.sim.snapshot(); const ev0 = this.events.length; let waited = 0; let tries = 0;
    while (waited <= maxWait && this.s.status === 'playing') { // (a won status ends the loop via the ok path)
      const snap = this.sim.snapshot(); const evN = this.events.length; tries++;
      const quiet = this.log; this.log = false;
      issue();
      const ok = this.until(done, hopMax) && this.s.status !== 'failed';
      this.log = quiet;
      if (ok) { if (this.log) console.log(`  [${label}] ok after ${tries} tries, waited ${waited.toFixed(1)}s, t=${this.t.toFixed(1)}`); return true; }
      const why = this.s.failReason || 'timeout';
      this.sim.restore(snap); this.events.length = evN;
      if (this.log && tries <= 3) console.log(`  [${label}] try ${tries} failed: ${why}`);
      this.run(every); waited += every;
    }
    this.sim.restore(snap0); this.events.length = ev0;
    if (this.log) console.log(`  [${label}] gave up after ${tries} tries`);
    return false;
  }

  // ---- inspection ----
  where(name) { const c = this.char(name); return `${c.name} L${c.layer} (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) ${c.stance}${c.hidden ? ' hidden' : ''}${c.carrying ? ' carrying' : ''} orders=${c.orders.length}${c.action ? ' act=' + c.action.type : ''}`; }
  enemyLine(id) { const e = this.enemy(id); return `${e.id.padEnd(10)} ${e.state.padEnd(11)} (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) face ${String(deg(e.facing)).padStart(4)}° meter ${e.detect.toFixed(2)} route#${e.routeIdx}`; }
  report() {
    const s = this.s;
    console.log(`t=${s.t.toFixed(1)} status=${s.status}${s.failReason ? ' (' + s.failReason + ')' : ''}`);
    for (const c of s.chars) console.log('  ' + this.where(c.name));
    for (const e of s.enemies) if (e.state !== 'patrol' || e.detect > 0) console.log('  ' + this.enemyLine(e.id));
  }
  /** Meters of every enemy that currently has a non-zero meter. */
  heat() { return this.s.enemies.filter((e) => e.detect > 0).map((e) => `${e.id}:${e.detect.toFixed(2)}`).join(' '); }
  /** Can `name` reach (x,z) on layer L right now (route planning only, no movement)? */
  reachable(name, x, z, layer) { const c = this.char(name); return !!this.sim.planLegs(c, layer ?? c.layer, { x, z }); }
  /** Is point p on layer L inside enemy e's cone right now (no LOS check)? Returns distance or -1. */
  inCone(id, x, z) { const e = this.enemy(id), T = ENEMY_TYPES[e.type]; const dx = x - e.x, dz = z - e.z, d = Math.hypot(dx, dz); if (d > T.range) return -1; let a = Math.atan2(dz, dx) - e.facing; a = Math.atan2(Math.sin(a), Math.cos(a)); return Math.abs(a) <= T.fov / 2 ? d : -1; }
}
export { DT, MAP };
