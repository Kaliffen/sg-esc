// three.js renderer: a view of sim.state + sim.view. Nothing here mutates the simulation.
import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { FogLayer } from './fog.js';
import { ENEMY_TYPES } from '../sim/enemies.js';
import { pointInPolygon, clamp } from '../core/math.js';

const Y = { ground: 0, floor: 0.01, exit: 0.03, bush: 0.3, cone: 0.15, door: 0.5, marker: 0.4, body: 0.5, line: 0.45, ui: 0.6, smoke: 0.9 };

function circleGeo(r, n = 28) { const g = new THREE.CircleGeometry(r, n); g.rotateX(-Math.PI / 2); return g; }
function ringGeo(r0, r1, n = 32, thetaLength = Math.PI * 2) { const g = new THREE.RingGeometry(r0, r1, n, 1, 0, thetaLength); g.rotateX(-Math.PI / 2); return g; }
function planeGeo(w, h) { const g = new THREE.PlaneGeometry(w, h); g.rotateX(-Math.PI / 2); return g; }
function mat(color, opacity = 1, extra = {}) { return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1 || !!extra.transparent, opacity, depthWrite: false, side: THREE.DoubleSide, ...extra }); }
function mesh(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; }
function rectMesh(r, y, m, h = 0) {
  const o = h > 0 ? new THREE.Mesh(new THREE.BoxGeometry(r.w, h, r.h), m) : new THREE.Mesh(planeGeo(r.w, r.h), m);
  o.position.set(r.x + r.w / 2, h > 0 ? y + h / 2 : y, r.z + r.h / 2);
  return o;
}
function tickGeo(r) {
  const s = new THREE.Shape();
  s.moveTo(r * 0.2, -r * 0.55); s.lineTo(r * 1.35, 0); s.lineTo(r * 0.2, r * 0.55); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2); // shape (x, y) → (x, 0, y)
  return g;
}

const stripeVert = `varying vec3 wp; void main(){ wp = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`;
const stripeFrag = `uniform vec3 color; uniform float opacity; varying vec3 wp;
  void main(){ float s = fract((wp.x + wp.z) * 0.9); float a = s < 0.55 ? opacity : opacity * 0.3; gl_FragColor = vec4(color, a); }`;
function stripeMat(color, opacity) {
  return new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity } }, vertexShader: stripeVert, fragmentShader: stripeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

class FanMesh {
  constructor(color, opacity, y, capacity = 2400, striped = false) {
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setDrawRange(0, 0);
    this.striped = striped;
    this.mesh = new THREE.Mesh(geo, striped ? stripeMat(color, opacity) : mat(color, opacity, { side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.position.y = y;
    this.mesh.renderOrder = 5;
  }
  set(poly) {
    const a = this.attr.array; let n = 0;
    for (let i = 1; i + 1 < poly.length; i++) {
      if (n + 9 > a.length) break;
      a[n++] = poly[0].x; a[n++] = 0; a[n++] = poly[0].z;
      a[n++] = poly[i].x; a[n++] = 0; a[n++] = poly[i].z;
      a[n++] = poly[i + 1].x; a[n++] = 0; a[n++] = poly[i + 1].z;
    }
    this.attr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n / 3);
    this.mesh.visible = n > 0;
  }
  hide() { this.mesh.visible = false; }
  setColor(c) { if (this.striped) this.mesh.material.uniforms.color.value.copy(c); else this.mesh.material.color.copy(c); }
}

export class Renderer {
  constructor(canvas, world) {
    this.world = world;
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.three.autoClear = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.viewport = new Viewport(canvas);
    this.labels = [];
    this.layerGroups = {}; this.fog = {}; this.doorMeshes = {}; this.transMeshes = {}; this.itemMeshes = {}; this.interMeshes = {};
    this.charObjs = {}; this.enemyObjs = {}; this.ghostObjs = {};
    this.noisePool = []; this.smokePool = []; this.wpPool = [];
    this.pathLine = null;
    this.timeSinceStart = 0;
    for (const id of world.layerIds) this.buildLayer(id);
    this.dyn = new THREE.Group(); this.scene.add(this.dyn);
    this.buildDynamicPools();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const c = this.three.domElement;
    const w = window.innerWidth, h = window.innerHeight;
    this.three.setSize(w, h, false);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    this.viewport.w = w; this.viewport.h = h; this.viewport.update();
  }

  buildLayer(id) {
    const w = this.world, L = w.layers[id];
    const g = new THREE.Group(); g.name = `layer${id}`;
    const groundColor = id === 0 ? 0x242a33 : id === 1 ? 0x07090e : 0x05070a;
    g.add(rectMesh({ x: 0, z: 0, w: w.width, h: w.height }, Y.ground, mat(groundColor)));
    if (L.floors) {
      const fc = id === 1 ? 0x3a3340 : 0x1b262c;
      for (const f of L.floors) { const m = rectMesh(f, Y.floor, mat(fc)); g.add(m); }
    }
    for (const o of L.obstacles) {
      if (o.kind === 'wall') {
        const big = o.w * o.h > 40;
        const m = rectMesh(o, 0, mat(big ? 0x4a4556 : 0x6e6557), big ? 1.6 : 1.0);
        g.add(m);
        if (big) { const roof = rectMesh({ x: o.x + 0.4, z: o.z + 0.4, w: o.w - 0.8, h: o.h - 0.8 }, 1.61, mat(0x57516a)); g.add(roof); }
      } else if (o.kind === 'fence') g.add(rectMesh(o, 0, mat(0x9aa3ad), 0.4));
      else if (o.kind === 'water') g.add(rectMesh(o, 0.02, mat(0x1b3f66)));
    }
    for (const b of L.bushes) g.add(mesh(circleGeo(b.r, 20), mat(0x2f7a3f, 0.92), b.x, Y.bush, b.z));
    for (const d of w.doors) if (d.layer === id) {
      const grp = new THREE.Group();
      const locked = rectMesh(d, 0, mat(0xb5542b), 1.1); locked.name = 'locked';
      const open = rectMesh(d, 0.04, mat(0x7a5a3a, 0.45)); open.name = 'open';
      grp.add(locked, open); g.add(grp); this.doorMeshes[d.id] = grp;
    }
    for (const t of w.transitions) for (const side of [t.a, t.b]) if (side.layer === id) {
      const color = { ladder: 0xd9b36b, vine: 0x7cb342, hatch: 0xb0bec5, grate: 0x90a4ae }[t.type] || 0xffffff;
      const grp = new THREE.Group();
      grp.add(mesh(planeGeo(1.3, 1.3), mat(color, 0.9), side.x, Y.marker, side.z));
      const inner = mesh(planeGeo(0.8, 0.8), mat(0x05070c, 0.9), side.x, Y.marker + 0.01, side.z); inner.name = 'inner'; grp.add(inner);
      g.add(grp); (this.transMeshes[t.id] ||= []).push({ side, grp });
    }
    for (const it of w.items) if (it.layer === id) {
      const m = mesh(circleGeo(0.55, 4), mat(0xffd54f), it.x, Y.marker, it.z); m.rotation.y = Math.PI / 4;
      g.add(m); this.itemMeshes[it.id] = m;
    }
    for (const it of w.interactables) if (it.layer === id) {
      const m = mesh(planeGeo(1.2, 1.2), mat(0x4dd0e1), it.x, Y.marker, it.z); g.add(m); this.interMeshes[it.id] = m;
    }
    if (w.exit.layer === id) g.add(rectMesh(w.exit, Y.exit, mat(0x43a047, 0.35)));
    // fog
    const fog = new FogLayer(this.three, w.width, w.height);
    g.add(fog.overlay); this.fog[id] = fog;
    this.scene.add(g); this.layerGroups[id] = g;
  }

  buildDynamicPools() {
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.pathLine.position.y = Y.line; this.pathLine.frustumCulled = false; this.dyn.add(this.pathLine);
    this.hoverRing = mesh(ringGeo(0.7, 0.85), mat(0xffffff, 0.7), 0, Y.ui, 0); this.hoverRing.visible = false; this.dyn.add(this.hoverRing);
    this.armRing = mesh(ringGeo(0.2, 0.3), mat(0xffffff, 0.6), 0, Y.ui, 0); this.armRing.visible = false; this.dyn.add(this.armRing);
  }

  makeChar(c) {
    const g = new THREE.Group();
    const body = mesh(circleGeo(0.45), mat(c.color), 0, Y.body, 0); body.name = 'body';
    const tick = mesh(tickGeo(0.45), mat(0xffffff, 0.9), 0, Y.body + 0.01, 0); tick.name = 'tick';
    const sel = mesh(ringGeo(0.62, 0.74), mat(0xffffff, 0.95), 0, Y.body - 0.01, 0); sel.name = 'sel';
    const delay = mesh(ringGeo(0.8, 0.95), mat(0x80d8ff, 0.9), 0, Y.body - 0.01, 0); delay.name = 'delay'; delay.visible = false;
    const act = mesh(ringGeo(0.8, 0.95), mat(0xffffff, 0.9), 0, Y.body - 0.01, 0); act.name = 'act'; act.visible = false;
    const cancel = mesh(ringGeo(0.9, 1.3), mat(0xff1744, 0.8), 0, Y.body - 0.02, 0); cancel.name = 'cancel'; cancel.visible = false;
    const carry = mesh(circleGeo(0.3), mat(0x9e9e9e, 0.9), 0.5, Y.body + 0.02, 0.4); carry.name = 'carry'; carry.visible = false;
    const facing = new THREE.Group(); facing.name = 'facing'; facing.add(tick);
    g.add(body, facing, sel, delay, act, carry, cancel);
    this.dyn.add(g);
    return g;
  }
  makeEnemy(e) {
    const T = ENEMY_TYPES[e.type];
    const g = new THREE.Group();
    const body = mesh(circleGeo(T.radius), mat(T.color), 0, Y.body, 0); body.name = 'body';
    const tick = mesh(tickGeo(T.radius), mat(0xffffff, 0.9), 0, Y.body + 0.01, 0); tick.name = 'tick';
    const facing = new THREE.Group(); facing.name = 'facing'; facing.add(tick);
    const meterBg = mesh(planeGeo(1.4, 0.22), mat(0x000000, 0.6), 0, Y.ui, -0.95); meterBg.name = 'meterBg';
    const meter = mesh(planeGeo(1.4, 0.22), mat(0xffeb3b, 0.95), 0, Y.ui + 0.01, -0.95); meter.name = 'meter';
    g.add(body, facing, meterBg, meter);
    const far = new FanMesh(0xffe082, 0.16, Y.cone, 2400, true), near = new FanMesh(0xffe082, 0.24, Y.cone + 0.01);
    this.dyn.add(g, far.mesh, near.mesh);
    const ghost = new THREE.Group();
    const gb = mesh(circleGeo(T.radius), mat(T.color, 0.28), 0, Y.body, 0);
    const gt = mesh(tickGeo(T.radius), mat(0xffffff, 0.3), 0, Y.body + 0.01, 0);
    const gf = new THREE.Group(); gf.name = 'facing'; gf.add(gt);
    ghost.add(gb, gf); ghost.visible = false; this.dyn.add(ghost);
    return { g, far, near, ghost, elite: !T.takedownable };
  }

  coneColor(detect) {
    const c = new THREE.Color();
    if (detect < 0.35) c.setHex(0xffe082).lerp(new THREE.Color(0xffa000), detect / 0.35);
    else c.setHex(0xffa000).lerp(new THREE.Color(0xff1744), (detect - 0.35) / 0.65);
    return c;
  }

  /** Draw a frame. ui: {selectedId, viewLayer, hover, armed, cursorWorld} */
  render(sim, ui, dt) {
    const s = sim.state, v = sim.view, w = this.world, L = ui.viewLayer;
    this.labels = [];
    for (const id of w.layerIds) this.layerGroups[id].visible = id === L;
    // fog for all layers
    for (const id of w.layerIds) this.fog[id].update(v.squadVision[id] || [], dt);
    // doors / transitions / items / interactables
    const seen = (id) => ui.reveal || s.seen[id];
    for (const id of w.layerIds) this.fog[id].overlay.visible = !ui.reveal;
    for (const d of w.doors) { const g = this.doorMeshes[d.id]; const locked = s.doorLocked[d.id]; g.getObjectByName('locked').visible = locked; g.getObjectByName('open').visible = !locked; if (d.layer === L && locked && seen(`door:${d.id}`)) this.labels.push({ x: d.x + d.w / 2, z: d.z + d.h / 2, text: `🔒 ${d.name}`, cls: 'lbl-door' }); }
    for (const t of w.transitions) for (const { side, grp } of this.transMeshes[t.id]) {
      const closed = t.closed && !s.transitions[t.id].open;
      grp.getObjectByName('inner').material.color.setHex(closed ? 0x5c2b2b : 0x05070c);
      if (side.layer === L && seen(`tr:${t.id}:${side.layer}`)) this.labels.push({ x: side.x, z: side.z + 0.9, text: t.name + (t.req ? ` (${t.req.attr.slice(0, 3).toUpperCase()} ${t.req.min})` : '') + (closed ? ' • closed' : ''), cls: 'lbl-small' });
    }
    for (const it of w.items) { const st = s.items[it.id]; const m = this.itemMeshes[it.id]; m.visible = !st.heldBy; if (!st.heldBy && it.layer === L && seen(`item:${it.id}`)) this.labels.push({ x: it.x, z: it.z + 0.9, text: it.name, cls: 'lbl-item' }); }
    for (const it of w.interactables) { const m = this.interMeshes[it.id]; m.material.color.setHex(s.interactables[it.id].used ? 0x3a6a70 : 0x4dd0e1); if (it.layer === L && seen(`use:${it.id}`)) this.labels.push({ x: it.x, z: it.z + 0.9, text: it.name, cls: 'lbl-item' }); }
    for (const loc of w.locations) if (L === 0 && (seen(`loc:${loc.id}`) || loc.id === 'exit')) this.labels.push({ x: loc.x + loc.w / 2, z: loc.z + 2, text: loc.id === 'exit' ? 'EXIT ▸ everyone here' : loc.name.toUpperCase(), cls: 'lbl-loc' });

    // characters
    for (const c of s.chars) {
      const g = this.charObjs[c.id] || (this.charObjs[c.id] = this.makeChar(c));
      g.visible = c.layer === L;
      g.position.set(c.x, 0, c.z);
      g.getObjectByName('facing').rotation.y = -c.facing;
      g.getObjectByName('body').material.opacity = c.hidden ? 0.5 : 1; g.getObjectByName('body').material.transparent = true;
      g.getObjectByName('sel').visible = c.id === ui.selectedId;
      const dl = g.getObjectByName('delay');
      if (c.delay > 0 && c.orders.length) { dl.visible = true; this.setArc(dl, c.delay / Math.max(0.001, c.delayTotal || c.delay), 0x80d8ff); } else dl.visible = false;
      const ac = g.getObjectByName('act');
      if (c.action) { ac.visible = true; this.setArc(ac, 1 - c.action.timeLeft / c.action.total, 0xffffff); } else ac.visible = false;
      g.getObjectByName('carry').visible = !!c.carrying;
      const cf = sim.fx.cancel[c.id]; const cm = g.getObjectByName('cancel');
      if (cf && performance.now() - cf < 600) { cm.visible = true; cm.material.opacity = 0.8 * (1 - (performance.now() - cf) / 600); } else cm.visible = false;
      if (c.layer === L) this.labels.push({ x: c.x, z: c.z - 0.9, text: c.name + (c.stance === 'run' ? ' »' : '') + (c.hidden ? ' (hidden)' : ''), cls: 'lbl-char' });
    }
    // enemies
    for (const e of s.enemies) {
      const o = this.enemyObjs[e.id] || (this.enemyObjs[e.id] = this.makeEnemy(e));
      const T = ENEMY_TYPES[e.type];
      const visible = (v.enemyVisible[e.id] || ui.reveal) && e.layer === L && !e.carried && !e.gone;
      o.g.visible = visible;
      if (visible) {
        o.g.position.set(e.x, 0, e.z);
        o.g.getObjectByName('facing').rotation.y = -e.facing;
        const body = o.g.getObjectByName('body');
        if (e.state === 'ko') { body.scale.set(1.5, 1, 0.7); body.material.color.setHex(0x616161); o.g.getObjectByName('facing').visible = false; }
        else { body.scale.set(1, 1, 1); body.material.color.setHex(T.color); o.g.getObjectByName('facing').visible = true; }
        const meter = o.g.getObjectByName('meter'), mbg = o.g.getObjectByName('meterBg');
        const show = e.detect > 0.02 && e.state !== 'ko';
        meter.visible = mbg.visible = show;
        if (show) { meter.scale.x = Math.max(0.02, e.detect); meter.position.x = -0.7 + 0.7 * e.detect; meter.material.color.copy(this.coneColor(e.detect)); }
        this.labels.push({ x: e.x, z: e.z - 1.2, text: (o.elite ? '◆ ' : '') + e.name + (e.state === 'ko' ? ' (out cold)' : e.state === 'suspicious' ? ' ?' : e.state === 'investigate' || e.state === 'look' ? ' …' : ''), cls: o.elite ? 'lbl-elite' : 'lbl-enemy' });
      }
      // cone on the viewed layer
      const cone = v.cones[e.id] && v.cones[e.id][L];
      if (cone && e.state !== 'ko' && (visible || ui.reveal || this.coneSeen(cone.poly, v.squadVision[L]))) {
        const col = this.coneColor(e.detect);
        o.far.setColor(col); o.near.setColor(col);
        o.far.set(cone.poly); o.near.set(cone.near);
      } else { o.far.hide(); o.near.hide(); }
      // ghost
      const ls = e.lastSeen;
      const ghostOn = !visible && !e.gone && ls && ls.layer === L && s.t - ls.t < 90 && ls.state !== 'ko';
      o.ghost.visible = !!ghostOn;
      if (ghostOn) { o.ghost.position.set(ls.x, 0, ls.z); o.ghost.getObjectByName('facing').rotation.y = -ls.facing; }
    }
    // selected char orders
    this.drawOrders(sim, ui);
    // noises
    this.drawPool(this.noisePool, s.noises.filter((n) => n.layer === L), (n, m) => {
      const age = (s.t - n.t) / 1.2; m.scale.setScalar(Math.max(0.05, n.r * age)); m.position.set(n.x, Y.ui, n.z); m.material.opacity = 0.5 * (1 - age);
    }, () => mesh(ringGeo(0.9, 1.0, 40), mat(0xffffff, 0.5), 0, Y.ui, 0));
    this.drawPool(this.smokePool, s.smokes.filter((sm) => sm.layer === L), (sm, m) => {
      const left = sm.tEnd - s.t; m.position.set(sm.x, Y.smoke, sm.z); m.scale.setScalar(sm.r); m.material.opacity = Math.min(0.75, left / 2 * 0.75);
    }, () => mesh(circleGeo(1, 36), mat(0xb0bec5, 0.75), 0, Y.smoke, 0));
    // hover / armed
    const h = ui.hover;
    if (h && h.pos && h.kind !== 'ground' && h.kind !== 'waypoint') { this.hoverRing.visible = true; this.hoverRing.position.set(h.pos.x, Y.ui, h.pos.z); } else this.hoverRing.visible = false;
    if (ui.armed && ui.cursorWorld && (ui.armed === 'stone' || ui.armed === 'smoke')) { this.armRing.visible = true; this.armRing.position.set(ui.cursorWorld.x, Y.ui, ui.cursorWorld.z); this.armRing.scale.setScalar(ui.armed === 'smoke' ? 16 : 3); } else this.armRing.visible = false;

    this.three.setRenderTarget(null);
    this.three.render(this.scene, this.viewport.camera);
  }

  coneSeen(poly, squadPolys) {
    if (!squadPolys || !squadPolys.length) return false;
    for (let i = 1; i < poly.length; i += 4) { const p = poly[i]; for (const sp of squadPolys) if (pointInPolygon(p, sp)) return true; }
    return false;
  }
  setArc(ringMesh, frac, color) {
    const r = ringMesh;
    const theta = Math.PI * 2 * clamp(frac, 0.001, 1);
    if (!r.userData.theta || Math.abs(r.userData.theta - theta) > 0.05) {
      r.geometry.dispose(); r.geometry = ringGeo(0.8, 0.95, 40, theta); r.userData.theta = theta;
    }
    r.material.color.setHex(color);
  }
  drawPool(pool, items, apply, make) {
    while (pool.length < items.length) { const m = make(); this.dyn.add(m); pool.push(m); }
    pool.forEach((m, i) => { if (i < items.length) { m.visible = true; apply(items[i], m); } else m.visible = false; });
  }
  drawOrders(sim, ui) {
    const c = ui.selectedId && sim.char(ui.selectedId);
    const pts = [];
    const markers = [];
    if (c && c.layer === ui.viewLayer) {
      pts.push({ x: c.x, z: c.z });
      if (c.legs) for (const leg of c.legs) { if (leg.layer !== ui.viewLayer) break; for (const p of leg.path) pts.push(p); }
      let n = 0;
      for (let i = 0; i < c.orders.length; i++) {
        const o = c.orders[i];
        if (o.layer !== ui.viewLayer) continue;
        n++;
        if (i > 0 || !c.legs) pts.push({ x: o.x, z: o.z });
        markers.push({ o, i, n });
      }
    }
    const geo = this.pathLine.geometry;
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = p.z; });
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.computeBoundingSphere();
    this.pathLine.visible = pts.length > 1;
    this.drawPool(this.wpPool, markers, (mk, m) => {
      m.position.set(mk.o.x, Y.ui, mk.o.z);
      const hov = ui.hover && ui.hover.kind === 'waypoint' && ui.hover.idx === mk.i;
      m.scale.setScalar(hov ? 1.4 : 1);
      m.material.color.setHex(mk.i === 0 && mk.o.started && c.delay <= 0 ? 0x69f0ae : 0xffffff); // executing = green, queued = white
      let txt = `${mk.n}`;
      if (mk.o.type === 'move' && mk.o.wait > 0) txt += ` · wait ${mk.o.wait.toFixed(1)}s`;
      if (mk.o.label) txt += ` · ${mk.o.label}`;
      this.labels.push({ x: mk.o.x, z: mk.o.z + 0.8, text: txt, cls: 'lbl-wp' });
    }, () => mesh(circleGeo(0.32), mat(0xffffff, 0.9), 0, Y.ui, 0));
  }
}
