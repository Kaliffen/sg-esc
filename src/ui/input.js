// Mouse + keyboard → selection, orders, camera. Owns the transient UI state.
import { dist, pointInRect } from '../core/math.js';
import { ABILITIES } from '../sim/characters.js';
import { ENEMY_TYPES } from '../sim/enemies.js';

export class Input {
  constructor(canvas, sim, renderer, hud, game) {
    this.canvas = canvas; this.sim = sim; this.renderer = renderer; this.hud = hud; this.game = game;
    this.vp = renderer.viewport;
    this.ui = { selectedId: sim.state.chars[0].id, viewLayer: sim.state.chars[0].layer, armed: null, hover: null, cursorWorld: null, followLayer: true, paused: true, reveal: false, drag: null };
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: {}, dragStart: null, panning: false };
    this.bind();
  }

  bind() {
    const c = this.canvas;
    this.listeners = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointermove', (e) => this.onMove(e));
    on(c, 'pointerdown', (e) => this.onDown(e));
    on(c, 'pointerup', (e) => this.onUp(e));
    on(c, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }
  dispose() { for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts); this.listeners = []; }

  get selected() { return this.ui.selectedId ? this.sim.char(this.ui.selectedId) : null; }

  select(id) {
    this.ui.selectedId = id;
    const c = this.selected;
    if (c && this.ui.followLayer) this.ui.viewLayer = c.layer;
    this.ui.armed = null;
  }

  onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
    if (this.mouse.panning) { this.vp.panPixels(e.movementX, e.movementY); }
    this.ui.cursorWorld = this.vp.screenToWorld(this.mouse.x, this.mouse.y);
    if (this.ui.drag) { const d = this.ui.drag; d.fx = this.ui.cursorWorld.x; d.fz = this.ui.cursorWorld.z; d.active = dist(d, { x: d.fx, z: d.fz }) > 0.6; }
    this.ui.hover = this.pick(this.ui.cursorWorld);
  }

  /** What is under the cursor? Returns {kind, id?, pos, label, idx?} */
  pick(p) {
    const s = this.sim.state, w = this.sim.world, L = this.ui.viewLayer, v = this.sim.view;
    const sel = this.selected;
    const near = (q, r) => dist(p, q) <= r;
    // waypoints of the selected
    if (sel && sel.layer === L) for (let i = 0; i < sel.orders.length; i++) { const o = sel.orders[i]; if (o.layer === L && near(o, 0.6)) return { kind: 'waypoint', idx: i, pos: { x: o.x, z: o.z }, label: o.type === 'move' ? `Waypoint ${i + 1} · wait ${o.wait.toFixed(1)}s (wheel to change)` : o.label }; }
    for (const c of s.chars) if (c.layer === L && near(c, 0.7)) return { kind: 'char', id: c.id, pos: c, label: `${c.name} — select` };
    for (const e of s.enemies) if (e.layer === L && v.enemyVisible[e.id] && !e.carried && near(e, 0.8)) {
      const T = ENEMY_TYPES[e.type];
      if (e.state === 'ko') return { kind: 'body', id: e.id, pos: e, label: sel && sel.attrs.strength >= 5 ? `Carry ${e.name}'s body` : `${e.name}'s body (STR 5 to carry)` };
      if (!T.takedownable) return { kind: 'enemy', id: e.id, pos: e, label: `${e.name} (${T.name}) — cannot be taken down` };
      return { kind: 'enemy', id: e.id, pos: e, label: sel && sel.abilities.includes('takedown') ? `Takedown ${e.name}` : `${e.name} (${T.name})` };
    }
    for (const t of w.transitions) for (const side of [t.a, t.b]) if (side.layer === L && near(side, 1.0)) {
      const closed = t.closed && !s.transitions[t.id].open;
      return { kind: 'transition', id: t.id, pos: side, label: `${closed ? 'Lift ' : 'Use '}${t.name}${t.req ? ` (${t.req.attr} ${t.req.min})` : ''}` };
    }
    for (const d of w.doors) if (d.layer === L && pointInRect(p, d, 0.7)) {
      if (!s.doorLocked[d.id]) return { kind: 'door', id: d.id, pos: { x: d.x + d.w / 2, z: d.z + d.h / 2 }, label: `${d.name} (open)` };
      const key = sel && d.key && sel.inventory.includes(d.key);
      const pick = sel && d.pickable && sel.abilities.includes('lockpick');
      return { kind: 'door', id: d.id, pos: { x: d.x + d.w / 2, z: d.z + d.h / 2 }, label: d.opensBy ? `${d.name} — locked (operated elsewhere)` : key ? `Unlock ${d.name}` : pick ? `Lockpick ${d.name}` : `${d.name} — locked (needs key or Lockpick)` };
    }
    for (const it of w.items) { const st = s.items[it.id]; if (!st.heldBy && it.layer === L && near(st, 0.9)) return { kind: 'item', id: it.id, pos: st, label: `Take ${it.name}` }; }
    for (const it of w.interactables) if (it.layer === L && near(it, 1.0)) return { kind: 'interactable', id: it.id, pos: it, label: s.interactables[it.id].used ? `${it.name} (used)` : `Use ${it.name}` };
    if (sel && sel.carrying) for (const b of w.layers[L].bushes) if (near(b, b.r)) return { kind: 'bush', pos: b, label: 'Hide body here' };
    return { kind: 'ground', pos: p, label: '' };
  }

  onDown(e) {
    this.canvas.focus();
    if (e.button === 1) { this.mouse.panning = true; e.preventDefault(); return; }
    const p = this.vp.screenToWorld(this.mouse.x, this.mouse.y);
    const h = this.pick(p);
    const append = e.shiftKey;
    const sel = this.selected;
    if (e.button === 2) { // move
      if (!sel) return;
      if (this.ui.armed) { this.ui.armed = null; return; }
      if (sel.carrying && h.kind === 'bush') { this.sim.orderDropAt(sel.id, h.pos, this.ui.viewLayer, append); return; }
      // hold and drag to choose the facing on arrival; the order is issued on release
      this.ui.drag = { x: p.x, z: p.z, fx: p.x, fz: p.z, append, active: false };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      return;
    }
    if (e.button !== 0) return;
    if (this.ui.armed && sel) {
      const a = this.ui.armed;
      if (a === 'stone' || a === 'smoke') { if (this.ui.viewLayer !== sel.layer) { this.hud.toast(`Aim on ${sel.name}'s own layer (Tab).`, 'warn'); return; } this.sim.orderAbility(sel.id, a, p, append); }
      else if (a === 'takedown' && h.kind === 'enemy') this.sim.orderTakedown(sel.id, h.id, append);
      else if (a === 'lockpick' && h.kind === 'door') this.sim.orderUseDoor(sel.id, h.id, append);
      else { this.hud.toast('Pick a valid target.', 'warn'); return; }
      this.ui.armed = null; return;
    }
    switch (h.kind) {
      case 'char': this.select(h.id); return;
      case 'enemy': if (sel) this.sim.orderTakedown(sel.id, h.id, append); return;
      case 'body': if (sel) this.sim.orderCarry(sel.id, h.id, append); return;
      case 'transition': if (sel) this.sim.orderUseTransition(sel.id, h.id, append); return;
      case 'door': if (sel) this.sim.orderUseDoor(sel.id, h.id, append); return;
      case 'item': if (sel) this.sim.orderPickItem(sel.id, h.id, append); return;
      case 'interactable': if (sel) this.sim.orderInteract(sel.id, h.id, append); return;
      case 'bush': if (sel) this.sim.orderDropAt(sel.id, h.pos, this.ui.viewLayer, append); return;
      case 'waypoint': return;
      default: return;
    }
  }
  onUp(e) {
    if (e.button === 1) this.mouse.panning = false;
    if (e.button === 2 && this.ui.drag) {
      const d = this.ui.drag; this.ui.drag = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const sel = this.selected; if (!sel) return;
      const face = d.active ? Math.atan2(d.fz - d.z, d.fx - d.x) : null;
      this.sim.orderMove(sel.id, { x: d.x, z: d.z }, this.ui.viewLayer, d.append, face);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const sel = this.selected;
    const dir = e.deltaY > 0 ? -1 : 1;
    if (this.ui.hover && this.ui.hover.kind === 'waypoint' && sel) {
      const o = sel.orders[this.ui.hover.idx];
      if (o && o.type === 'move') { this.sim.setWait(sel.id, this.ui.hover.idx, o.wait + dir * 0.5); this.ui.hover = this.pick(this.ui.cursorWorld); return; }
    }
    if (e.ctrlKey && sel) { this.sim.setDelay(sel.id, sel.delay + dir * 0.5); return; }
    this.vp.zoomAt(this.mouse.x, this.mouse.y, dir > 0 ? 1.15 : 1 / 1.15);
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    this.keys.add(e.code);
    const sel = this.selected; const s = this.sim.state;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); this.game.togglePause(); return; }
    if (e.key === 'F5') { e.preventDefault(); this.game.quicksave(); return; }
    if (e.key === 'F9') { e.preventDefault(); this.game.quickload(); return; }
    if (e.key === 'F1') { e.preventDefault(); this.hud.toggleHelp(); return; }
    if (e.key === 'F2') { e.preventDefault(); this.ui.reveal = !this.ui.reveal; this.hud.toast(this.ui.reveal ? 'Reveal mode ON (design view: no fog, all enemies shown)' : 'Reveal mode off', 'info'); return; }
    if (e.key === 'Escape') { if (this.ui.drag) this.ui.drag = null; else if (this.ui.armed) this.ui.armed = null; else if (this.hud.helpOpen) this.hud.toggleHelp(); else this.ui.selectedId = null; return; }
    if (e.key === 'Tab') { e.preventDefault(); const ids = this.sim.world.layerIds; const i = ids.indexOf(this.ui.viewLayer); this.ui.viewLayer = ids[(i + 1) % ids.length]; this.ui.followLayer = false; return; }
    if (k >= '1' && k <= '4') { const c = s.chars[Number(k) - 1]; if (c) { this.select(c.id); this.ui.followLayer = true; } return; }
    if (s.status !== 'playing') { if (k === 'r') this.game.restart(); return; }
    if (!sel) return;
    if (k === 'r') { this.sim.toggleStance(sel.id); return; }
    if (k === 'h' || k === 'x') { this.sim.clearOrders(sel.id); return; }
    if (k === 'f') { this.vp.centerOn(sel.x, sel.z); this.ui.viewLayer = sel.layer; this.ui.followLayer = true; return; }
    if (k === 'c') { if (sel.carrying) this.sim.dropNow(sel.id); else this.hud.toast('Click a body to carry it (STR 5).', 'info'); return; }
    for (const [ab, def] of Object.entries(ABILITIES)) {
      if (k === def.key.toLowerCase()) {
        if (!sel.abilities.includes(ab)) { this.hud.toast(`${sel.name} has no ${def.name}.`, 'warn'); return; }
        if (def.self) { this.sim.orderAbility(sel.id, ab, null, e.shiftKey); return; }
        this.ui.armed = this.ui.armed === ab ? null : ab;
        return;
      }
    }
  }

  /** Called per frame for continuous input (WASD pan). */
  update(dt) {
    const k = this.keys; const sp = 600 * dt;
    let dx = 0, dy = 0;
    if (k.has('ArrowUp')) dy += sp; if (k.has('ArrowDown')) dy -= sp;
    if (k.has('ArrowLeft')) dx += sp; if (k.has('ArrowRight')) dx -= sp;
    if (dx || dy) this.vp.panPixels(dx, dy);
    if (this.ui.followLayer) { const c = this.selected; if (c) this.ui.viewLayer = c.layer; }
    if (this.ui.cursorWorld) this.ui.hover = this.pick(this.ui.cursorWorld);
  }
}
