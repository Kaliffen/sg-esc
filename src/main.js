// Boot: roster → squad select → mission. Fixed-step loop with pause.
import { MAP } from './world/map-data.js';
import { buildWorld } from './world/map.js';
import { generateRoster } from './sim/characters.js';
import { Sim, DT } from './sim/sim.js';
import { Renderer } from './render/renderer.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { showSquadSelect, PRESETS } from './ui/squad-select.js';

const ROSTER_KEY = 'veil.roster.v1';
const BADGES_KEY = 'veil.badges.kurogane';

class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.world = buildWorld(MAP);
    this.renderer = new Renderer(this.canvas, this.world);
    this.sim = null; this.input = null; this.hud = null;
    this.acc = 0; this.last = performance.now();
    this.quick = null;
    this.running = false;
    this.reminderOn = true;
    this.lastSaveT = 0;
    this.lastBadges = null;
    this.loadRoster();
    const params = new URLSearchParams(location.search);
    if (params.has('auto')) {
      const n = Number(params.get('auto')) || 3;
      this.startMission(this.rosterData.roster.slice(0, n), PRESETS.veil);
      this.input.ui.paused = false;
      if (params.has('reveal')) this.input.ui.reveal = true;
      if (params.has('layer')) { this.input.ui.viewLayer = Number(params.get('layer')); this.input.ui.followLayer = false; }
      if (params.has('cx')) this.renderer.viewport.centerOn(Number(params.get('cx')), Number(params.get('cz')));
      if (params.has('ppm')) { this.renderer.viewport.ppm = Number(params.get('ppm')); this.renderer.viewport.update(); }
      const ff = Number(params.get('sim')) || 0;
      for (let i = 0; i < ff * 60; i++) this.sim.update(DT);
    } else this.toSquadSelect();
    requestAnimationFrame((t) => this.frame(t));
  }

  loadRoster() {
    try { const saved = JSON.parse(localStorage.getItem(ROSTER_KEY)); if (saved && saved.roster && saved.roster.length) { this.rosterData = saved; return; } } catch { /* ignore */ }
    this.rosterData = generateRoster();
    localStorage.setItem(ROSTER_KEY, JSON.stringify(this.rosterData));
  }

  toSquadSelect() {
    this.running = false;
    if (this.input) { this.input.dispose(); this.input = null; }
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
    let badges = {};
    try { badges = JSON.parse(localStorage.getItem(BADGES_KEY)) || {}; } catch { /* ignore */ }
    showSquadSelect(this.rosterData.roster, {
      badges,
      onStart: (squad, preset) => this.startMission(squad, preset),
      onReroll: () => { this.rosterData = generateRoster(); localStorage.setItem(ROSTER_KEY, JSON.stringify(this.rosterData)); this.toSquadSelect(); },
    });
  }

  startMission(squad, preset = PRESETS.veil) {
    this.squad = squad; this.preset = preset;
    this.sim = new Sim(this.world, squad, preset.opts);
    this.lastSaveT = 0; this.lastBadges = null;
    for (const id of this.world.layerIds) this.renderer.fog[id].clear();
    this.resetDynamic();
    if (this.input) this.input.dispose();
    if (this.hud) this.hud.dispose();
    this.input = new Input(this.canvas, this.sim, this.renderer, null, this);
    this.hud = new Hud(this.sim, this.input, this);
    this.input.hud = this.hud;
    this.input.ui.paused = true;
    this.quick = null;
    document.getElementById('hud').classList.remove('hidden');
    this.renderer.viewport.ppm = 14;
    this.renderer.viewport.centerOn(this.world.start.x + 22, this.world.start.z - 14);
    this.running = true;
    this.hud.toast('Paused. Select someone (1–4), right-click to move, Space to run time. F1 for help.', 'info');
    this.hud.toast('Objective: get the whole squad out through the Main Gate in the north-east.', 'info');
  }

  resetDynamic() {
    const r = this.renderer;
    for (const g of Object.values(r.charObjs)) r.dyn.remove(g);
    for (const o of Object.values(r.enemyObjs)) { r.dyn.remove(o.g); r.dyn.remove(o.far.mesh); r.dyn.remove(o.near.mesh); r.dyn.remove(o.ghost); }
    r.charObjs = {}; r.enemyObjs = {};
  }

  restart() {
    this.startMission(this.squad, this.preset);
  }
  onWin() {
    const s = this.sim.state;
    const b = { ghost: s.stats.takedowns === 0, duo: this.squad.length === 2, street: !s.stats.layers[1] && !s.stats.layers[-1], clockwork: s.t < 480 };
    this.lastBadges = b;
    try {
      const prev = JSON.parse(localStorage.getItem(BADGES_KEY)) || {};
      for (const k of Object.keys(b)) if (b[k]) prev[k] = true;
      localStorage.setItem(BADGES_KEY, JSON.stringify(prev));
    } catch { /* ignore */ }
  }
  togglePause() {
    if (!this.input || this.sim.state.status !== 'playing') return;
    this.input.ui.paused = !this.input.ui.paused;
  }
  quicksave() {
    if (!this.sim || this.sim.state.status !== 'playing') return;
    this.quick = this.sim.snapshot();
    this.lastSaveT = this.sim.state.t;
    this.hud.toast('Quicksaved.', 'good');
  }
  quickload() {
    if (!this.sim || !this.quick) { if (this.hud) this.hud.toast('No quicksave yet (F5).', 'warn'); return; }
    if (!this.sim.restore(this.quick)) return;
    this.lastSaveT = this.sim.state.t;
    this.lastBadges = null; // a win after this load is a new win
    this.input.ui.paused = true;
    this.hud.toast('Quickloaded (paused).', 'good');
  }

  frame(t) {
    requestAnimationFrame((t2) => this.frame(t2));
    const dtReal = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.running) return;
    this.input.update(dtReal);
    this.sim.uiPaused = this.input.ui.paused;
    let simDt = 0;
    if (!this.input.ui.paused && this.sim.state.status === 'playing') {
      this.acc += dtReal;
      let steps = 0;
      while (this.acc >= DT && steps < 5) { this.sim.update(DT); this.acc -= DT; steps++; simDt += DT; }
      if (this.sim.state.status !== 'playing') { this.input.ui.paused = true; if (this.sim.state.status === 'won' && !this.lastBadges) this.onWin(); }
    } else this.acc = 0;
    this.renderer.render(this.sim, this.input.ui, simDt);
    this.hud.update(this.renderer);
    if (!this.loggedReady) { this.loggedReady = true; console.log(`VEIL ready: frame rendered, t=${this.sim.state.t.toFixed(1)}s, ${this.sim.state.chars.length} chars, ${this.sim.state.enemies.length} enemies`); }
  }
}

window.game = new Game();
