// Roster / squad selection screen (DOM).
import { ABILITIES, ATTRS, ATTR_SHORT, squadWarnings } from '../sim/characters.js';

export const PRESETS = {
  veil:  { name: 'Veil',  desc: 'As designed.', opts: {} },
  hard:  { name: 'Hard',  desc: 'Detection ×1.4, 2 stones, no smoke, no save reminder.', opts: { detectMult: 1.4, stones: 2, smoke: 0, reminder: false } },
  blind: { name: 'Blind', desc: 'As Hard, and orders cannot be issued while paused.', opts: { detectMult: 1.4, stones: 2, smoke: 0, reminder: false, blind: true } },
};
export const BADGES = { ghost: 'Ghost — no takedowns', duo: 'Duo — squad of exactly 2', street: 'Street Level — never roofs or sewers', clockwork: 'Clockwork — out in under 8:00' };

export function showSquadSelect(roster, { onStart, onReroll, badges = {} }) {
  const root = document.getElementById('squad');
  root.classList.remove('hidden');
  const chosen = new Set(roster.slice(0, 3).map((c) => c.id));
  let preset = 'veil';
  const render = () => {
    const squad = roster.filter((c) => chosen.has(c.id));
    const warns = squadWarnings(squad);
    root.innerHTML = `
      <div class="squad-panel">
        <h1>VEIL <span>— Escape from Kurogane</span></h1>
        <p class="muted">The job went wrong and the town is locked down. Pick 2–4 of your people. Everyone you bring must make it out of the Main Gate. Being spotted loses the map. Press F1 in-game for controls.</p>
        <div class="roster">
          ${roster.map((c) => `
            <div class="card ${chosen.has(c.id) ? 'on' : ''}" data-id="${c.id}" style="--c:${c.color}">
              <div class="cdot"></div>
              <div class="cname">${c.name} <small>${c.epithet}</small></div>
              <div class="cattrs">${ATTRS.map((a) => `<div><span>${ATTR_SHORT[a]}</span><i style="width:${c.attrs[a] * 10}%"></i><b>${c.attrs[a]}</b></div>`).join('')}</div>
              <div class="cabil">${c.abilities.map((a) => `<span title="${ABILITIES[a].desc}">${ABILITIES[a].name}</span>`).join('')}</div>
              <div class="ctags">${c.attrs.strength >= 7 ? '<em>lifts grates</em>' : ''}${c.attrs.agility >= 7 ? '<em>climbs vines</em>' : ''}${c.attrs.strength >= 5 ? '<em>carries bodies</em>' : ''}</div>
            </div>`).join('')}
        </div>
        <div class="warns">${warns.length ? warns.map((w) => `<div>⚠ ${w}</div>`).join('') : '<div class="ok">✓ This squad has an answer for every blocker on the map.</div>'}</div>
        <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<label class="${preset === k ? 'on' : ''}"><input type="radio" name="preset" value="${k}" ${preset === k ? 'checked' : ''}> <b>${p.name}</b> <span>${p.desc}</span></label>`).join('')}</div>
        <div class="badges">${Object.entries(BADGES).map(([k, d]) => `<span class="badge ${badges[k] ? 'on' : ''}" title="${d}">${badges[k] ? '★' : '☆'} ${d}</span>`).join('')}</div>
        <div class="row">
          <button id="sq-start" ${squad.length < 2 || squad.length > 4 ? 'disabled' : ''}>Start infiltration (${squad.length}/4)</button>
          <button id="sq-reroll" class="secondary">Reroll roster</button>
        </div>
      </div>`;
    root.querySelectorAll('.card').forEach((card) => card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (chosen.has(id)) chosen.delete(id); else if (chosen.size < 4) chosen.add(id);
      render();
    }));
    root.querySelectorAll('input[name=preset]').forEach((r) => r.addEventListener('change', () => { preset = r.value; render(); }));
    root.querySelector('#sq-start').addEventListener('click', () => { root.classList.add('hidden'); onStart(roster.filter((c) => chosen.has(c.id)), PRESETS[preset]); });
    root.querySelector('#sq-reroll').addEventListener('click', () => onReroll());
  };
  render();
}
