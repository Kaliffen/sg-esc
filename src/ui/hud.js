// DOM HUD: top bar, squad portraits, action bar, order panel, toasts, world labels, overlays.
import { ABILITIES, ATTRS, ATTR_SHORT } from '../sim/characters.js';
import { fmt } from '../core/math.js';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor(sim, input, game) {
    this.sim = sim; this.input = input; this.game = game;
    this.root = el('hud');
    this.toasts = el('toasts');
    this.labelsEl = el('labels');
    this.helpOpen = false;
    this.lastSig = '';
    this.labelPool = [];
    this.listeners = [];
    const on = (id, type, fn) => { el(id).addEventListener(type, fn); this.listeners.push([el(id), type, fn]); };
    on('help-close', 'click', () => this.toggleHelp());
    on('btn-help', 'click', () => this.toggleHelp());
    on('btn-pause', 'click', () => game.togglePause());
    on('overlay', 'click', (e) => { if (e.target.dataset.action === 'restart') game.restart(); if (e.target.dataset.action === 'load') game.quickload(); if (e.target.dataset.action === 'squad') game.toSquadSelect(); });
    on('portraits', 'click', (e) => { const b = e.target.closest('[data-char]'); if (b) { input.select(b.dataset.char); input.ui.followLayer = true; } });
    on('actions', 'click', (e) => { const b = e.target.closest('[data-act]'); if (b) this.action(b.dataset.act); });
    on('orders', 'click', (e) => { const b = e.target.closest('[data-op]'); if (b) this.orderOp(b.dataset.op, Number(b.dataset.idx), Number(b.dataset.delta)); });
    el('help').classList.add('hidden');
  }
  dispose() { for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn); this.listeners = []; this.labelsEl.innerHTML = ''; this.toasts.innerHTML = ''; }

  toggleHelp() { this.helpOpen = !this.helpOpen; el('help').classList.toggle('hidden', !this.helpOpen); }

  toast(text, kind = 'info') {
    const d = document.createElement('div'); d.className = `toast ${kind}`; d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), kind === 'fail' || kind === 'win' ? 12000 : 5000);
    setTimeout(() => d.remove(), kind === 'fail' || kind === 'win' ? 13000 : 6000);
    while (this.toasts.children.length > 6) this.toasts.firstChild.remove();
  }

  action(act) {
    const sel = this.input.selected; if (!sel) return;
    const ui = this.input.ui;
    switch (act) {
      case 'stance': this.sim.toggleStance(sel.id); break;
      case 'hold': this.sim.clearOrders(sel.id); break;
      case 'drop': this.sim.dropNow(sel.id); break;
      case 'use': this.input.useNearby(false); break;
      default: if (ABILITIES[act] && ABILITIES[act].self) this.sim.orderAbility(sel.id, act, null, false); else if (ABILITIES[act]) ui.armed = ui.armed === act ? null : act;
    }
  }
  orderOp(op, idx, delta) {
    const sel = this.input.selected; if (!sel) return;
    if (op === 'wait') this.sim.setWait(sel.id, idx, (sel.orders[idx]?.wait || 0) + delta);
    if (op === 'delay') this.sim.setDelay(sel.id, sel.delay + delta);
    if (op === 'clear') this.sim.clearOrders(sel.id);
    if (op === 'remove') { sel.orders.splice(idx, 1); if (idx === 0) { sel.legs = null; sel.action = null; sel.waitLeft = 0; } }
  }

  update(renderer) {
    const s = this.sim.state, ui = this.input.ui, sel = this.input.selected;
    // drain sim events
    for (const ev of this.sim.events) this.toast(ev.text, ev.kind);
    this.sim.events.length = 0;
    // top bar
    const L = this.sim.world.layers[ui.viewLayer];
    el('top-loc').textContent = sel ? `${sel.name} · ${this.sim.location(sel).name}` : 'No one selected';
    el('top-time').textContent = `T+${fmt(s.t, 1)}s`;
    const bell = el('top-bell');
    const needSave = this.game.reminderOn && this.sim.opts.reminder && s.status === 'playing' && s.t - this.game.lastSaveT > 90;
    bell.classList.toggle('hidden', !needSave);
    el('top-layer').textContent = `Layer: ${L.name}${ui.followLayer ? '' : ' (Tab)'}`;
    el('btn-pause').textContent = ui.paused ? '▶ Resume (Space)' : '❚❚ Pause (Space)';
    el('paused-banner').classList.toggle('hidden', !ui.paused || s.status !== 'playing');
    el('cursor-hint').textContent = ui.armed ? `${ABILITIES[ui.armed].name}: click a target (Esc to cancel)` : (ui.hover?.label || '');
    el('cursor-hint').style.left = `${this.input.mouse.x + 16}px`; el('cursor-hint').style.top = `${this.input.mouse.y + 18}px`;
    // portraits
    const sig = s.chars.map((c) => `${c.id}${c.id === ui.selectedId ? '*' : ''}${c.stance}${c.boost ? c.boost.kind : ''}${c.hidden ? 'h' : ''}${c.carrying || ''}${c.inventory.join()}${c.consumables.stone}${c.consumables.smoke}${c.consumables.sprint}${c.consumables.ghost}${c.orders.length}${c.delay.toFixed(1)}${c.layer}`).join('|') + `|${ui.armed}|${s.status}|${this.input.nearbyUse()?.label}`;
    if (sig !== this.lastSig) { this.lastSig = sig; this.renderPortraits(); this.renderActions(); }
    this.renderOrders();
    // world labels
    this.renderLabels(renderer);
    // overlay
    const ov = el('overlay');
    const ovSig = `${s.status}|${s.failReason}|${JSON.stringify(this.game.lastBadges)}`;
    if (ovSig === this.ovSig) { /* overlay already rendered for this state */ }
    else if ((this.ovSig = ovSig, s.status === 'failed')) { ov.classList.remove('hidden'); ov.innerHTML = `<div class="panel fail"><h1>SPOTTED</h1><p>${s.failReason}</p><p class="muted">You lose the map when the alarm is raised. Learn the cone, try again.</p><div class="row"><button data-action="load">Quickload (F9)</button><button data-action="restart">Restart map (R)</button><button data-action="squad">Change squad</button></div></div>`; }
    else if (s.status === 'won') {
      const b = this.game.lastBadges || {};
      const badges = Object.entries(b).map(([k, on]) => `<span class="badge ${on ? 'on' : ''}">${k}</span>`).join('');
      ov.classList.remove('hidden'); ov.innerHTML = `<div class="panel win"><h1>ESCAPED</h1><p>The Veil is outside the walls of Kurogane after ${fmt(s.t, 0)} seconds. Takedowns: ${s.stats.takedowns}.</p><div class="badges">${badges}</div><div class="row"><button data-action="restart">Play again</button><button data-action="squad">Change squad</button></div></div>`;
    }
    else ov.classList.add('hidden');
  }

  renderPortraits() {
    const s = this.sim.state, ui = this.input.ui;
    el('portraits').innerHTML = s.chars.map((c, i) => `
      <div class="portrait ${c.id === ui.selectedId ? 'sel' : ''}" data-char="${c.id}" style="--c:${c.color}">
        <div class="pkey">${i + 1}</div>
        <div class="pdot"></div>
        <div class="pname">${c.name}</div>
        <div class="pinfo">${c.boost ? (c.boost.kind === 'sprint' ? 'SPRINT' : 'GHOST STEP') : c.stance === 'run' ? 'RUN' : 'sneak'}${c.hidden ? ' · hidden' : ''}${c.carrying ? ' · carrying' : ''}${c.inventory.length ? ' · 🔑' : ''}</div>
        <div class="pattrs">${ATTRS.map((a) => `<span title="${a}">${ATTR_SHORT[a]} ${c.attrs[a]}</span>`).join('')}</div>
        <div class="pabil">${c.abilities.map((a) => ABILITIES[a].name + (c.consumables[a] !== undefined ? ` ×${c.consumables[a]}` : '')).join(' · ')}</div>
      </div>`).join('');
  }

  renderActions() {
    const sel = this.input.selected, ui = this.input.ui;
    const a = el('actions');
    if (!sel) { a.innerHTML = '<span class="muted">Select a character (click or 1–4)</span>'; return; }
    const btn = (act, label, key, on = false, dis = false) => `<button data-act="${act}" class="${on ? 'on' : ''}" ${dis ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`;
    let h = btn('stance', sel.stance === 'run' ? 'Running' : 'Sneaking', 'R', sel.stance === 'run');
    for (const ab of sel.abilities) {
      const d = ABILITIES[ab];
      const count = sel.consumables[ab];
      h += btn(ab, d.name + (count !== undefined ? ` ×${count}` : ''), d.key, ui.armed === ab, count === 0);
    }
    if (sel.carrying) h += btn('drop', 'Drop body', 'C');
    const u = this.input.nearbyUse(sel);
    if (u) h += btn('use', u.label, 'E', u.ok, !u.ok);
    h += btn('hold', 'Hold / clear orders', 'H');
    a.innerHTML = h;
  }

  renderOrders() {
    const sel = this.input.selected;
    const o = el('orders');
    if (!sel) { o.innerHTML = ''; o.classList.add('hidden'); return; }
    o.classList.remove('hidden');
    const sig = `${sel.id}|${sel.delay.toFixed(1)}|${sel.orders.map((x) => `${x.type}${x.label || ''}${x.wait ?? ''}${x.x.toFixed(0)},${x.z.toFixed(0)}`).join(';')}`;
    if (sig === this.ordersSig) return;
    this.ordersSig = sig;
    const rows = sel.orders.map((x, i) => {
      const what = x.type === 'move' ? `Move to (${x.x.toFixed(0)}, ${x.z.toFixed(0)})${x.label ? ' via ' + x.label : ''}` : x.label || x.type;
      const wait = x.type === 'move' ? `<span class="wait">wait ${x.wait.toFixed(1)}s <button data-op="wait" data-idx="${i}" data-delta="-0.5">−</button><button data-op="wait" data-idx="${i}" data-delta="0.5">+</button></span>` : '';
      return `<div class="orow"><span class="n">${i + 1}</span><span class="what">${what}</span>${wait}<button class="x" data-op="remove" data-idx="${i}" title="remove">×</button></div>`;
    }).join('');
    o.innerHTML = `<div class="ohead"><b>${sel.name}'s orders</b> <span class="delay">start delay ${sel.delay.toFixed(1)}s <button data-op="delay" data-delta="-0.5">−</button><button data-op="delay" data-delta="0.5">+</button></span><button class="x" data-op="clear" title="clear all">clear</button></div>
      ${rows || '<div class="muted">Right-click to move · Shift+right-click to add waypoints · wheel over a waypoint to set its wait · Ctrl+wheel for start delay</div>'}`;
  }

  renderLabels(renderer) {
    const vp = renderer.viewport;
    const labels = renderer.labels;
    while (this.labelPool.length < labels.length) { const d = document.createElement('div'); this.labelsEl.appendChild(d); this.labelPool.push(d); }
    for (let i = 0; i < this.labelPool.length; i++) {
      const d = this.labelPool[i];
      if (i >= labels.length) { d.style.display = 'none'; continue; }
      const l = labels[i];
      const p = vp.worldToScreen(l.x, l.z);
      if (p.x < -200 || p.y < -50 || p.x > vp.w + 200 || p.y > vp.h + 50) { d.style.display = 'none'; continue; }
      d.style.display = 'block';
      d.className = `lbl ${l.cls}`;
      d.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -50%)`;
      if (d.textContent !== l.text) d.textContent = l.text;
    }
  }
}
