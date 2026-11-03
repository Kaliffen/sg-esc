// The simulation. `state` is plain data (quicksave = structuredClone). `view` is derived per tick (vision polygons).
import { dist, sub, norm, angleOf, turnToward, wrapAngle, pointInPolygon, pointInRect, TAU, clamp } from '../core/math.js';
import { visionSegments, rebuildGrid, bushAt, locationAt } from '../world/map.js';
import { routeLayers } from '../world/nav.js';
import { visibilityPolygon, hasLOS, inCone } from '../world/vision.js';
import { ENEMY_TYPES, NEAR_ZONE, NEAR_RATE, FAR_RATE_NEAR, FAR_RATE_FAR, DECAY, SUSPICIOUS_AT, CALM_AT } from './enemies.js';
import { sneakSpeed, runSpeed, viewRange, stealthMult, takedownTime, canCarry, canLift, canClimbVine } from './characters.js';

export const DT = 1 / 60;
export const SAVE_VERSION = 1;
export const DEFAULT_OPTS = { detectMult: 1, stones: 3, smoke: 1, blind: false, reminder: true };
const PLAYER_FOV = (120 * Math.PI) / 180;
const ABILITY_RANGE = { stone: 12, smoke: 10 };
const NOISE = { run: 7, stone: 9, winch: 6, grate: 5, whistle: 14 };

export class Sim {
  constructor(world, squad, opts = {}) {
    this.world = world;
    this.opts = { ...DEFAULT_OPTS, ...opts };
    this.events = [];
    this.fx = { cancel: {} };
    this.uiPaused = false;
    this.state = this.makeInitialState(squad);
    this.view = { cones: {}, squadVision: {}, enemyVisible: {} };
    this.segCache = {};
    this.rebuildSegments();
    this.computeView();
  }

  makeInitialState(squad) {
    const w = this.world;
    const chars = squad.map((c, i) => ({
      id: c.id, name: c.name, epithet: c.epithet, color: c.color, attrs: { ...c.attrs }, abilities: c.abilities.slice(),
      consumables: { stone: this.opts.stones, smoke: this.opts.smoke },
      layer: w.start.layer, x: w.start.x + (i % 2) * 1.2, z: w.start.z + Math.floor(i / 2) * 1.2, facing: -Math.PI / 2,
      stance: 'sneak', orders: [], legs: null, delay: 0, waitLeft: 0, action: null, carrying: null, hidden: false, moving: false,
      inventory: [], runNoiseT: 0, planT: 0,
    }));
    const enemies = w.enemies.map((e) => {
      const p0 = e.route[0];
      return {
        id: e.id, type: e.type, name: e.name, layer: e.layer, x: p0.x, z: p0.z, facing: p0.face ?? 0,
        route: e.route, routeIdx: 0, waitLeft: p0.wait, faceTarget: p0.face, sweep: e.sweep || null,
        seesLayers: e.seesLayers || [e.layer],
        state: 'patrol', prevState: null, path: null, detect: 0, detectTarget: null, investigatePt: null,
        lookLeft: 0, lookBase: 0, alertLook: null, lastSeen: null, carried: false, hiddenBody: false, moving: false,
      };
    });
    return {
      t: 0, status: 'playing', failReason: '',
      doorLocked: Object.fromEntries(w.doors.map((d) => [d.id, d.locked])),
      transitions: Object.fromEntries(w.transitions.map((t) => [t.id, { open: !t.closed }])),
      items: Object.fromEntries(w.items.map((it) => [it.id, { layer: it.layer, x: it.x, z: it.z, heldBy: null }])),
      interactables: Object.fromEntries(w.interactables.map((it) => [it.id, { used: false }])),
      chars, enemies, smokes: [], noises: [], firedEvents: {}, seen: {},
      stats: { takedowns: 0, layers: { [w.start.layer]: true } },
    };
  }

  // ---------- infrastructure ----------
  doorMap() { return new Map(Object.entries(this.state.doorLocked)); }
  rebuildSegments() {
    const dm = this.doorMap();
    for (const id of this.world.layerIds) this.segCache[id] = visionSegments(this.world, id, dm);
  }
  rebuildNav(layerId) { rebuildGrid(this.world, layerId, this.doorMap()); this.rebuildSegments(); }
  grid(layer) { return this.world.layers[layer].grid; }
  segments(layer) { return this.segCache[layer]; }
  /** Segments of `layer` as seen by `viewer`; when looking across layers, ignore the obstacle the viewer stands on. */
  segmentsFor(viewer, layer) {
    const segs = this.segCache[layer];
    if (viewer.layer === layer) return segs;
    return segs.filter((sg) => !(sg.o && pointInRect(viewer, sg.o, 0.05)));
  }
  circles(layer) { return this.state.smokes.filter((s) => s.layer === layer && s.tEnd > this.state.t); }
  msg(text, kind = 'info') { this.events.push({ text, kind, t: this.state.t }); }
  char(id) { return this.state.chars.find((c) => c.id === id); }
  enemy(id) { return this.state.enemies.find((e) => e.id === id); }
  location(c) { return locationAt(this.world, c.layer, c); }
  snapshot() { return { saveVersion: SAVE_VERSION, map: this.world.name, state: structuredClone(this.state) }; }
  restore(snap) {
    if (!snap || snap.saveVersion !== SAVE_VERSION) { this.msg('Save is from another version; refusing to load it.', 'warn'); return false; }
    this.state = structuredClone(snap.state);
    for (const id of this.world.layerIds) rebuildGrid(this.world, id, this.doorMap());
    this.rebuildSegments();
    this.computeView();
    return true;
  }
  blocked() {
    if (this.opts.blind && this.uiPaused) { this.msg('Blind preset: orders cannot be issued while paused.', 'warn'); return true; }
    return false;
  }

  // ---------- orders API (called by UI) ----------
  _push(c, order, append) {
    if (this.state.status !== 'playing') return;
    if (this.blocked()) return;
    if (!append) { c.orders = []; c.legs = null; c.action = null; c.waitLeft = 0; }
    c.orders.push(order);
  }
  orderMove(charId, pt, layer, append) {
    const c = this.char(charId);
    if (!this.grid(layer).nearestWalkable(pt.x, pt.z, 4)) { this.msg('Cannot go there.', 'warn'); return; }
    this._push(c, { type: 'move', x: pt.x, z: pt.z, layer, wait: 0 }, append);
  }
  orderUseTransition(charId, id, append) {
    const c = this.char(charId); const t = this.world.transitionById[id];
    if (!this.canUseTransition(c, t)) {
      if (t.req) this.msg(`${c.name} needs ${t.req.attr} ${t.req.min} for the ${t.name.toLowerCase()}.`, 'warn');
      else this.msg(`${c.name} cannot use that.`, 'warn');
      return;
    }
    // go to the far side
    const side = t.a.layer === c.layer ? t.b : t.a;
    this._push(c, { type: 'move', x: side.x, z: side.z, layer: side.layer, wait: 0, label: t.name }, append);
  }
  orderUseDoor(charId, id, append) {
    const c = this.char(charId); const d = this.world.doorById[id];
    if (!this.state.doorLocked[id]) { this.msg(`${d.name} is open.`, 'info'); return; }
    if (d.opensBy) { this.msg(`${d.name} is operated elsewhere (${d.opensBy}).`, 'warn'); return; }
    const hasKey = d.key && c.inventory.includes(d.key);
    const pick = d.pickable && c.abilities.includes('lockpick');
    if (!hasKey && !pick) { this.msg(`${c.name} cannot open ${d.name}: needs ${d.key ? 'the key' : ''}${d.key && d.pickable ? ' or ' : ''}${d.pickable ? 'Lockpick' : ''}.`, 'warn'); return; }
    const cx = d.x + d.w / 2, cz = d.z + d.h / 2;
    const horiz = d.w < d.h; // door is a vertical bar → approach from ±x
    const cand = horiz ? [{ x: cx - 1.1, z: cz }, { x: cx + 1.1, z: cz }] : [{ x: cx, z: cz - 1.1 }, { x: cx, z: cz + 1.1 }];
    this._push(c, { type: 'use', kind: 'door', id, x: cx, z: cz, layer: d.layer, approach: cand, duration: hasKey ? 1 : 3, label: hasKey ? 'Unlock' : 'Lockpick' }, append);
  }
  orderPickItem(charId, id, append) {
    const c = this.char(charId); const it = this.state.items[id]; const def = this.world.items.find((i) => i.id === id);
    if (it.heldBy) return;
    this._push(c, { type: 'use', kind: 'item', id, x: it.x, z: it.z, layer: it.layer, duration: 0.8, label: `Take ${def.name}` }, append);
  }
  orderInteract(charId, id, append) {
    const c = this.char(charId); const def = this.world.interactables.find((i) => i.id === id);
    if (this.state.interactables[id].used) { this.msg(`${def.name} already used.`, 'info'); return; }
    this._push(c, { type: 'use', kind: 'interactable', id, x: def.x, z: def.z, layer: def.layer, duration: def.duration, label: `Use ${def.name}` }, append);
  }
  orderTakedown(charId, enemyId, append) {
    const c = this.char(charId); const e = this.enemy(enemyId); const T = ENEMY_TYPES[e.type];
    if (!c.abilities.includes('takedown')) { this.msg(`${c.name} has no Takedown.`, 'warn'); return; }
    if (!T.takedownable) { this.msg(`${e.name} (${T.name}) cannot be taken down. Distract or avoid.`, 'warn'); return; }
    if (e.state === 'ko') return;
    if (c.carrying) { this.msg(`${c.name} is carrying a body.`, 'warn'); return; }
    this._push(c, { type: 'takedown', enemyId, x: e.x, z: e.z, layer: e.layer, label: 'Takedown' }, append);
  }
  orderCarry(charId, enemyId, append) {
    const c = this.char(charId); const e = this.enemy(enemyId);
    if (!canCarry(c)) { this.msg(`${c.name} needs Strength 5 to carry a body.`, 'warn'); return; }
    if (c.carrying) { this.msg(`${c.name} already carries a body.`, 'warn'); return; }
    if (e.state !== 'ko' || e.carried) return;
    this._push(c, { type: 'use', kind: 'body', id: enemyId, x: e.x, z: e.z, layer: e.layer, duration: 0.8, label: 'Pick up body' }, append);
  }
  orderDropAt(charId, pt, layer, append) {
    const c = this.char(charId);
    if (!c.carrying) return;
    this._push(c, { type: 'use', kind: 'drop', x: pt.x, z: pt.z, layer, duration: 0.6, label: 'Drop body' }, append);
  }
  dropNow(charId) {
    const c = this.char(charId);
    if (!c.carrying) return;
    this.dropBody(c);
  }
  orderAbility(charId, ability, pt, append) {
    const c = this.char(charId);
    if (!c.abilities.includes(ability)) { this.msg(`${c.name} has no ${ability}.`, 'warn'); return; }
    if (c.consumables[ability] !== undefined && c.consumables[ability] <= 0) { this.msg(`${c.name} is out of ${ability}s.`, 'warn'); return; }
    if (ability === 'whistle') { this._push(c, { type: 'ability', ability, x: c.x, z: c.z, layer: c.layer, duration: 0.5, label: 'Whistle', self: true }, append); return; }
    this._push(c, { type: 'ability', ability, x: pt.x, z: pt.z, layer: c.layer, duration: 0.6, label: ability === 'stone' ? 'Throw stone' : 'Smoke bomb', range: ABILITY_RANGE[ability] }, append);
  }
  setWait(charId, idx, wait) { if (this.blocked()) return; const c = this.char(charId); const o = c.orders[idx]; if (o && o.type === 'move') o.wait = clamp(wait, 0, 60); }
  setDelay(charId, delay) { if (this.blocked()) return; const c = this.char(charId); c.delay = clamp(delay, 0, 60); c.delayTotal = c.delay; }
  clearOrders(charId) { const c = this.char(charId); if (c.orders.length) this.fx.cancel[charId] = performance.now(); c.orders = []; c.legs = null; c.action = null; c.waitLeft = 0; c.delay = 0; }
  fireEvent(key) {
    const ev = this.world.events[key];
    if (!ev || this.state.firedEvents[key]) return;
    this.state.firedEvents[key] = true;
    for (const sw of ev.swaps || []) {
      const e = this.enemy(sw.enemy);
      if (!e || e.state === 'ko' || e.state === 'alarmed') continue;
      e.route = sw.route; e.routeIdx = 0; e.path = null; e.waitLeft = 0; e.faceTarget = null;
      if (e.state === 'look' || e.state === 'investigate') e.state = 'patrol';
    }
    if (ev.message) this.msg(ev.message, 'event');
  }
  toggleStance(charId) { const c = this.char(charId); c.stance = c.stance === 'sneak' ? 'run' : 'sneak'; }

  canUseTransition(c, t) {
    const meets = !t.req || c.attrs[t.req.attr] >= t.req.min;
    if (t.type === 'vine') return meets;
    if (t.closed && !this.state.transitions[t.id].open) return meets;
    return true;
  }

  /** Plan legs from char to (layer, target). Returns legs array or null. */
  planLegs(c, targetLayer, target) {
    const options = routeLayers(this.world, c.layer, targetLayer, (t) => this.canUseTransition(c, t));
    let best = null, bestLen = Infinity;
    for (const hops of options) {
      const legs = [];
      let curLayer = c.layer, curPos = { x: c.x, z: c.z }, total = 0, ok = true;
      for (const hop of hops) {
        const path = this.grid(curLayer).findPath(curPos, hop.from);
        if (!path) { ok = false; break; }
        total += pathLength(curPos, path) + 3; // transition cost
        if (total >= bestLen) { ok = false; break; }
        legs.push({ layer: curLayer, path, transition: hop.transition, toSide: hop.to });
        curLayer = hop.to.layer; curPos = { x: hop.to.x, z: hop.to.z };
      }
      if (!ok) continue;
      const path = this.grid(targetLayer).findPath(curPos, target);
      if (!path) continue;
      total += pathLength(curPos, path);
      if (total < bestLen) { bestLen = total; legs.push({ layer: targetLayer, path, transition: null }); best = legs; }
    }
    return best;
  }

  // ---------- main update ----------
  update(dt) {
    const s = this.state;
    if (s.status !== 'playing') return;
    s.t += dt;
    s.smokes = s.smokes.filter((sm) => sm.tEnd > s.t);
    s.noises = s.noises.filter((n) => n.t + 1.2 > s.t);
    for (const c of s.chars) this.updateChar(c, dt);
    for (const e of s.enemies) this.updateEnemy(e, dt);
    this.computeView();
    // win check
    const ex = this.world.exit;
    if (s.chars.every((c) => c.layer === ex.layer && pointInRect(c, ex))) { s.status = 'won'; this.msg('The Veil slips out of Kurogane. Mission complete.', 'win'); }
  }

  // ---------- characters ----------
  updateChar(c, dt) {
    const s = this.state;
    c.hidden = !!bushAt(this.world, c.layer, c);
    c.moving = false;
    s.stats.layers[c.layer] = true;
    if (c.carrying) { const e = this.enemy(c.carrying); e.x = c.x; e.z = c.z; e.layer = c.layer; }
    if (c.delay > 0) { c.delay = Math.max(0, c.delay - dt); return; }
    if (c.action) { this.tickAction(c, dt); return; }
    if (c.waitLeft > 0) { c.waitLeft -= dt; if (c.waitLeft <= 0) { c.waitLeft = 0; c.orders.shift(); } return; }
    const o = c.orders[0];
    if (!o) return;
    if (!o.started) {
      o.started = true;
      if (!this.startOrder(c, o)) { c.orders.shift(); return; }
    }
    if (o.type === 'takedown') {
      const e = this.enemy(o.enemyId);
      if (e.state === 'ko') { c.orders.shift(); c.legs = null; return; }
      if (e.layer === c.layer && dist(c, e) <= 1.15) { c.legs = null; c.facing = angleOf(sub(e, c)); c.action = { type: 'takedown', timeLeft: takedownTime(c), total: takedownTime(c), enemyId: e.id }; return; }
      c.planT -= dt;
      if (c.planT <= 0 || !c.legs) { c.planT = 0.4; const legs = this.planLegs(c, e.layer, e); if (legs) c.legs = legs; }
    }
    if (c.legs) { this.followLegs(c, dt); if (c.legs) return; }
    // arrived
    this.onArrive(c, o);
  }

  startOrder(c, o) {
    if (o.type === 'ability' && o.self) { c.action = { type: 'ability', ability: o.ability, timeLeft: o.duration, total: o.duration, x: o.x, z: o.z }; return true; }
    if (o.type === 'ability') {
      if (this.canThrowFrom(c, o)) { c.legs = null; return true; }
      const dir = norm(sub(c, o));
      const stand = { x: o.x + dir.x * (o.range - 1.5), z: o.z + dir.z * (o.range - 1.5) };
      let legs = this.planLegs(c, o.layer, stand);
      if (!legs) legs = this.planLegs(c, o.layer, o);
      if (!legs) { this.msg(`${c.name}: no way to reach the throw.`, 'warn'); return false; }
      c.legs = legs; return true;
    }
    if (o.type === 'takedown') { c.planT = 0; return true; }
    let target = o;
    if (o.type === 'use' && o.approach) {
      let best = null, bestLen = Infinity;
      for (const p of o.approach) {
        const legs = this.planLegs(c, o.layer, p);
        if (!legs) continue;
        const l = legs.reduce((a, L) => a + L.path.length, 0);
        if (l < bestLen) { bestLen = l; best = legs; }
      }
      if (!best) { this.msg(`${c.name}: no route to ${o.label}.`, 'warn'); return false; }
      c.legs = best; return true;
    }
    const legs = this.planLegs(c, o.layer, target);
    if (!legs) { this.msg(`${c.name}: no route there${o.label ? ` (${o.label})` : ''}.`, 'warn'); return false; }
    c.legs = legs;
    return true;
  }

  canThrowFrom(c, o) {
    if (c.layer !== o.layer) return false;
    if (dist(c, o) > o.range) return false;
    return hasLOS(c, o, this.segments(c.layer), null);
  }

  followLegs(c, dt) {
    const leg = c.legs[0];
    if (leg.path.length === 0) {
      if (leg.transition) {
        const t = leg.transition;
        const closed = t.closed && !this.state.transitions[t.id].open;
        c.action = { type: closed ? 'lift' : 'climb', timeLeft: closed ? 2.5 : 1.2, total: closed ? 2.5 : 1.2, transition: t, toSide: leg.toSide };
        return;
      }
      c.legs.shift();
      if (c.legs.length === 0) c.legs = null;
      return;
    }
    const target = leg.path[0];
    const speed = (c.stance === 'run' ? runSpeed(c) : sneakSpeed(c)) * (c.carrying ? 0.7 : 1);
    const d = dist(c, target);
    const step = speed * dt;
    const dir = norm(sub(target, c));
    if (d <= step) { c.x = target.x; c.z = target.z; leg.path.shift(); }
    else { c.x += dir.x * step; c.z += dir.z * step; }
    if (d > 0.01) c.facing = turnToward(c.facing, angleOf(dir), 10 * dt);
    c.moving = true;
    if (c.stance === 'run') { c.runNoiseT -= dt; if (c.runNoiseT <= 0) { c.runNoiseT = 0.5; this.emitNoise(c.x, c.z, c.layer, NOISE.run, 'steps', false); } }
  }

  onArrive(c, o) {
    switch (o.type) {
      case 'move':
        if (o.wait > 0) { c.waitLeft = o.wait; } else c.orders.shift();
        return;
      case 'use':
        if (o.kind === 'door') c.facing = angleOf(sub(o, c));
        c.action = { type: 'use', kind: o.kind, id: o.id, timeLeft: o.duration, total: o.duration, x: o.x, z: o.z };
        return;
      case 'ability':
        if (!this.canThrowFrom(c, o)) {
          // walk closer (fallback to the target point itself)
          const legs = this.planLegs(c, o.layer, o);
          if (legs && legs.some((L) => L.path.length)) { c.legs = legs; return; }
        }
        c.facing = angleOf(sub(o, c));
        c.action = { type: 'ability', ability: o.ability, timeLeft: o.duration, total: o.duration, x: o.x, z: o.z };
        return;
      case 'takedown':
        // enemy moved away; keep chasing
        return;
      default:
        c.orders.shift();
    }
  }

  tickAction(c, dt) {
    const a = c.action;
    a.timeLeft -= dt;
    if (a.timeLeft > 0) return;
    c.action = null;
    const s = this.state;
    switch (a.type) {
      case 'climb': case 'lift': {
        const t = a.transition;
        if (a.type === 'lift') { s.transitions[t.id].open = true; this.emitNoise(c.x, c.z, c.layer, NOISE.grate, 'grate'); this.msg(`${c.name} lifts the ${t.name.toLowerCase()}. It stays open.`, 'info'); this.fireEvent(`transition:${t.id}`); }
        c.layer = a.toSide.layer; c.x = a.toSide.x; c.z = a.toSide.z;
        if (c.carrying) { const e = this.enemy(c.carrying); e.layer = c.layer; e.x = c.x; e.z = c.z; }
        c.legs.shift(); if (c.legs.length === 0) c.legs = null;
        return;
      }
      case 'takedown': {
        const e = this.enemy(a.enemyId);
        if (e.state !== 'ko' && dist(c, e) <= 1.6) { e.state = 'ko'; e.detect = 0; e.path = null; e.moving = false; s.stats.takedowns++; this.msg(`${c.name} knocks out ${e.name}.`, 'good'); }
        c.orders.shift();
        return;
      }
      case 'use': this.applyUse(c, a); c.orders.shift(); return;
      case 'ability': this.applyAbility(c, a); c.orders.shift(); return;
    }
  }

  applyUse(c, a) {
    const s = this.state, w = this.world;
    switch (a.kind) {
      case 'door': {
        const d = w.doorById[a.id];
        if (dist(c, a) > 2.2) { this.msg(`${c.name} is not at the door.`, 'warn'); return; }
        s.doorLocked[a.id] = false; this.rebuildNav(d.layer);
        this.msg(`${c.name} opens ${d.name}.`, 'good');
        this.fireEvent(`door:${a.id}`);
        return;
      }
      case 'item': {
        const it = s.items[a.id]; const def = w.items.find((i) => i.id === a.id);
        if (it.heldBy || dist(c, it) > 1.8 || it.layer !== c.layer) return;
        it.heldBy = c.id; c.inventory.push(a.id);
        this.msg(`${c.name} takes the ${def.name}.`, 'good');
        this.fireEvent(`item:${a.id}`);
        return;
      }
      case 'interactable': {
        const def = w.interactables.find((i) => i.id === a.id);
        if (dist(c, def) > 1.8) return;
        s.interactables[a.id].used = true;
        if (def.noise) this.emitNoise(c.x, c.z, c.layer, def.noise, 'winch');
        if (def.opens) { s.doorLocked[def.opens] = false; this.rebuildNav(w.doorById[def.opens].layer); }
        this.msg(`${c.name} works the ${def.name.toLowerCase()}. You hear water rushing below.`, 'good');
        this.fireEvent(`use:${a.id}`);
        if (def.opens) this.fireEvent(`door:${def.opens}`);
        return;
      }
      case 'body': {
        const e = this.enemy(a.id);
        if (e.state !== 'ko' || e.carried || dist(c, e) > 1.8) return;
        e.carried = true; e.hiddenBody = false; c.carrying = e.id;
        this.msg(`${c.name} picks up ${e.name}.`, 'info');
        return;
      }
      case 'drop': this.dropBody(c); return;
    }
  }

  dropBody(c) {
    const e = this.enemy(c.carrying);
    const water = this.world.layers[c.layer].obstacles.find((o) => o.kind === 'water' && pointInRect(c, o, 1.3));
    if (water) {
      e.carried = false; e.gone = true; e.hiddenBody = true; e.x = -50; e.z = -50; c.carrying = null;
      this.msg(`${e.name} sinks into the ${water.name.toLowerCase()}. Gone.`, 'good');
      return;
    }
    e.carried = false; e.x = c.x + 0.4; e.z = c.z + 0.3; e.layer = c.layer;
    e.hiddenBody = !!bushAt(this.world, c.layer, e, -0.2);
    c.carrying = null;
    this.msg(e.hiddenBody ? `${c.name} hides ${e.name} in the bushes.` : `${c.name} drops ${e.name}.`, e.hiddenBody ? 'good' : 'info');
  }

  applyAbility(c, a) {
    const s = this.state;
    switch (a.ability) {
      case 'stone':
        c.consumables.stone--;
        s.noises.push({ x: a.x, z: a.z, layer: c.layer, r: NOISE.stone, t: s.t, kind: 'stone' });
        this.notifyNoise({ x: a.x, z: a.z, layer: c.layer, r: NOISE.stone, kind: 'stone' });
        this.msg(`${c.name} throws a stone.`, 'info');
        return;
      case 'smoke':
        c.consumables.smoke--;
        s.smokes.push({ x: a.x, z: a.z, layer: c.layer, r: 5, tEnd: s.t + 8 });
        this.msg(`${c.name} drops a smoke bomb.`, 'info');
        return;
      case 'whistle':
        s.noises.push({ x: c.x, z: c.z, layer: c.layer, r: NOISE.whistle, t: s.t, kind: 'whistle' });
        this.notifyNoise({ x: c.x, z: c.z, layer: c.layer, r: NOISE.whistle, kind: 'whistle', nearestOnly: true });
        this.msg(`${c.name} whistles.`, 'info');
        return;
    }
  }

  emitNoise(x, z, layer, r, kind, log = true) {
    this.state.noises.push({ x, z, layer, r, t: this.state.t, kind });
    this.notifyNoise({ x, z, layer, r, kind });
  }

  notifyNoise(n) {
    const segs = this.segments(n.layer);
    let cands = [];
    for (const e of this.state.enemies) {
      if (e.layer !== n.layer || e.state === 'ko' || e.state === 'alarmed') continue;
      const d = dist(e, n);
      const r = hasLOS(e, n, segs) ? n.r : n.r * 0.5;
      if (d <= r) cands.push({ e, d });
    }
    if (n.nearestOnly) { cands.sort((a, b) => a.d - b.d); cands = cands.slice(0, 1); }
    for (const { e } of cands) {
      const T = ENEMY_TYPES[e.type];
      if (T.stationary || T.ignoresDistraction) { e.alertLook = { ang: angleOf(sub(n, e)), t: 3 }; continue; }
      if (e.state === 'suspicious') continue;
      if (e.state === 'patrol') e.prevState = 'patrol';
      e.state = 'investigate'; e.investigatePt = { x: n.x, z: n.z }; e.path = null;
      e.faceTarget = angleOf(sub(n, e));
    }
  }

  // ---------- enemies ----------
  updateEnemy(e, dt) {
    const s = this.state;
    const T = ENEMY_TYPES[e.type];
    e.moving = false;
    if (e.state === 'ko' || e.state === 'alarmed') return;

    // perception
    let maxRate = 0, seen = null;
    for (const c of s.chars) {
      if (!e.seesLayers.includes(c.layer)) continue;
      const d = inCone(e, e.facing, T.fov, T.range, c);
      if (d < 0) continue;
      if (c.hidden && d > T.hideDist) continue;
      if (!hasLOS(e, c, this.segmentsFor(e, c.layer), this.circles(c.layer))) continue;
      if (c.layer !== e.layer && this.circles(e.layer).length && !hasLOS(e, c, [], this.circles(e.layer))) continue;
      const nearR = T.range * NEAR_ZONE;
      const still = !c.moving;
      let zone, stance;
      if (d <= nearR) { zone = NEAR_RATE; stance = c.stance === 'run' ? 1.6 : still ? 0.7 : 1.0; }
      else {
        if (still) continue; // far zone detects movement only (design 5.1)
        const f = (d - nearR) / (T.range - nearR); zone = FAR_RATE_NEAR + (FAR_RATE_FAR - FAR_RATE_NEAR) * f;
        stance = c.stance === 'run' ? 1.6 : 1.0;
      }
      const rate = T.baseRate * zone * stance * stealthMult(c) * this.opts.detectMult;
      if (rate > maxRate) { maxRate = rate; seen = c; }
    }
    if (maxRate > 0) { e.detect = Math.min(1, e.detect + maxRate * dt); e.detectTarget = { x: seen.x, z: seen.z }; }
    else e.detect = Math.max(0, e.detect - DECAY * dt);
    if (e.detect >= 1) { this.alarm(e, `${e.name} spotted ${seen.name} in ${this.location(seen).name}.`); return; }

    // bodies
    for (const b of s.enemies) {
      if (b === e || b.state !== 'ko' || b.carried || b.hiddenBody || !e.seesLayers.includes(b.layer)) continue;
      if (inCone(e, e.facing, T.fov, T.range, b) < 0) continue;
      if (!hasLOS(e, b, this.segmentsFor(e, b.layer), this.circles(b.layer))) continue;
      this.alarm(e, `${e.name} found ${b.name}'s body in ${locationAt(this.world, b.layer, b).name}.`); return;
    }

    // state machine
    if (e.detect >= SUSPICIOUS_AT && e.state !== 'suspicious') { e.prevState = e.state; e.state = 'suspicious'; e.path = null; }
    if (e.state === 'suspicious') {
      if (e.detectTarget) e.facing = turnToward(e.facing, angleOf(sub(e.detectTarget, e)), T.turnRate * 2 * dt);
      if (e.detect < CALM_AT) { e.state = e.prevState === 'investigate' || e.prevState === 'look' ? 'investigate' : 'patrol'; e.path = null; }
      return;
    }
    if (T.stationary) { this.updateSentinel(e, dt, T); return; }
    if (e.alertLook) {
      e.alertLook.t -= dt;
      e.facing = turnToward(e.facing, e.alertLook.ang, T.turnRate * 2 * dt);
      if (e.alertLook.t <= 0) e.alertLook = null;
      return;
    }
    if (e.state === 'investigate') {
      if (!e.path) { e.path = this.grid(e.layer).findPath(e, e.investigatePt); if (!e.path) { e.state = 'patrol'; return; } }
      this.moveEnemy(e, dt, T.speed * 1.3, T.turnRate);
      if (e.path.length === 0) { e.state = 'look'; e.lookLeft = T.lookTime; e.lookBase = e.facing; e.path = null; }
      return;
    }
    if (e.state === 'look') {
      e.lookLeft -= dt;
      const phase = (T.lookTime - e.lookLeft) * 1.8;
      e.facing = turnToward(e.facing, e.lookBase + Math.sin(phase) * 1.1, T.turnRate * dt);
      if (e.lookLeft <= 0) { e.state = 'patrol'; e.path = null; e.waitLeft = 0; }
      return;
    }
    // patrol
    const pt = e.route[e.routeIdx];
    if (e.waitLeft > 0) {
      e.waitLeft -= dt;
      if (e.faceTarget != null) e.facing = turnToward(e.facing, e.faceTarget, T.turnRate * dt);
      if (e.waitLeft <= 0) { e.routeIdx = (e.routeIdx + 1) % e.route.length; e.path = null; }
      return;
    }
    if (!e.path) {
      e.path = this.grid(e.layer).findPath(e, pt) || [];
    }
    if (e.path.length === 0) {
      const np = e.route[e.routeIdx];
      e.waitLeft = Math.max(np.wait, 0.05); e.faceTarget = np.face;
      return;
    }
    this.moveEnemy(e, dt, T.speed, T.turnRate);
  }

  updateSentinel(e, dt, T) {
    if (e.alertLook) {
      e.alertLook.t -= dt;
      e.facing = turnToward(e.facing, e.alertLook.ang, T.turnRate * 3 * dt);
      if (e.alertLook.t <= 0) e.alertLook = null;
      return;
    }
    if (e.sweep) {
      const target = e.sweep.center + e.sweep.amp * Math.sin((TAU * this.state.t) / e.sweep.period);
      e.facing = turnToward(e.facing, target, T.turnRate * 3 * dt);
    }
  }

  moveEnemy(e, dt, speed, turnRate) {
    const target = e.path[0];
    const d = dist(e, target);
    const step = speed * dt;
    const dir = norm(sub(target, e));
    if (d <= step) { e.x = target.x; e.z = target.z; e.path.shift(); }
    else { e.x += dir.x * step; e.z += dir.z * step; }
    if (d > 0.01) e.facing = turnToward(e.facing, angleOf(dir), turnRate * 3 * dt);
    e.moving = true;
  }

  alarm(e, reason) {
    const s = this.state;
    e.state = 'alarmed'; e.detect = 1;
    s.status = 'failed'; s.failReason = reason;
    this.msg(reason, 'fail');
  }

  // ---------- derived view (vision polygons) ----------
  computeView() {
    const s = this.state;
    const cones = {};
    for (const e of s.enemies) {
      if (e.state === 'ko' || e.gone) continue;
      const T = ENEMY_TYPES[e.type];
      const byLayer = {};
      for (const L of e.seesLayers) {
        const r = visibilityPolygon(e.x, e.z, e.facing, T.fov, T.range, this.segmentsFor(e, L), this.circles(L));
        byLayer[L] = { poly: r.poly, hits: r.hits, full: r.full, near: nearPoly(e, r, T.range * NEAR_ZONE) };
      }
      cones[e.id] = byLayer;
    }
    const squadVision = {};
    for (const id of this.world.layerIds) squadVision[id] = [];
    for (const c of s.chars) {
      const range = viewRange(c);
      const layers = c.layer === 1 ? [1, 0] : [c.layer];
      for (const L of layers) {
        const r = visibilityPolygon(c.x, c.z, c.facing, PLAYER_FOV, range, this.segmentsFor(c, L), this.circles(L));
        squadVision[L].push(r.poly);
        // small awareness circle around the character
        squadVision[L].push(circlePoly(c.x, c.z, 2.2));
      }
    }
    // points of interest discovered by the squad
    if (!this.poi) {
      this.poi = [];
      for (const d of this.world.doors) this.poi.push({ id: `door:${d.id}`, layer: d.layer, x: d.x + d.w / 2, z: d.z + d.h / 2 });
      for (const t of this.world.transitions) for (const side of [t.a, t.b]) this.poi.push({ id: `tr:${t.id}:${side.layer}`, layer: side.layer, x: side.x, z: side.z });
      for (const it of this.world.items) this.poi.push({ id: `item:${it.id}`, layer: it.layer, x: it.x, z: it.z });
      for (const it of this.world.interactables) this.poi.push({ id: `use:${it.id}`, layer: it.layer, x: it.x, z: it.z });
      for (const l of this.world.locations) this.poi.push({ id: `loc:${l.id}`, layer: l.layer, rect: l });
    }
    for (const p of this.poi) {
      if (s.seen[p.id]) continue;
      if (p.rect) { if (s.chars.some((c) => c.layer === p.layer && pointInRect(c, p.rect))) s.seen[p.id] = true; continue; }
      const q = { x: p.x, z: p.z };
      for (const poly of squadVision[p.layer]) if (pointInPolygon(q, poly)) { s.seen[p.id] = true; break; }
    }
    const enemyVisible = {};
    for (const e of s.enemies) {
      if (e.gone) { enemyVisible[e.id] = false; continue; }
      let vis = false;
      for (const poly of squadVision[e.layer]) if (pointInPolygon(e, poly)) { vis = true; break; }
      if (e.carried) vis = true;
      enemyVisible[e.id] = vis;
      if (vis) e.lastSeen = { x: e.x, z: e.z, layer: e.layer, t: s.t, facing: e.facing, state: e.state };
    }
    this.view = { cones, squadVision, enemyVisible };
  }
}

function pathLength(from, path) {
  let l = 0, p = from;
  for (const q of path) { l += dist(p, q); p = q; }
  return l;
}
function nearPoly(e, r, nearR) {
  const poly = [{ x: e.x, z: e.z }];
  for (const h of r.hits) { const t = Math.min(h.t, nearR); poly.push({ x: e.x + Math.cos(h.ang) * t, z: e.z + Math.sin(h.ang) * t }); }
  if (r.full && r.hits.length) poly.push(poly[1]);
  return poly;
}
function circlePoly(x, z, r, n = 24) {
  const p = [{ x, z }];
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; p.push({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r }); }
  return p;
}
