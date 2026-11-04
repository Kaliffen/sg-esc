// Roster generation: names, attributes, abilities. Guarantees the roster as a whole can solve the map.
import { makeRng } from '../core/rng.js';

const NAMES = ['Hana', 'Kaito', 'Ren', 'Sora', 'Yuki', 'Aiko', 'Jiro', 'Mei', 'Taro', 'Rin', 'Kenji', 'Nao', 'Hiro', 'Saki', 'Ryo', 'Emi', 'Goro', 'Tomoe', 'Shun', 'Kiku'];
const EPITHETS = ['the Quiet', 'Nightwalker', 'of the Reeds', 'Two-Knives', 'the Patient', 'Ashfoot', 'Mistborn', 'the Wall', 'Crow', 'Longstride', 'Halfmoon', 'the Shadow'];
const COLORS = ['#4fc3f7', '#a5d6a7', '#ffcc80', '#f48fb1', '#ce93d8', '#80cbc4', '#fff59d', '#ffab91'];

export const ABILITIES = {
  takedown: { name: 'Takedown', key: 'T', desc: 'Silently knock out an adjacent enemy (not Elites). Leaves a body.' },
  stone:    { name: 'Throw Stone', key: 'S', desc: 'Noise at a point up to 12 m away. Nearby enemies investigate. 3 stones.' },
  lockpick: { name: 'Lockpick', key: 'L', desc: 'Open a locked door or gate (3 s).' },
  smoke:    { name: 'Smoke Bomb', key: 'B', desc: '5 m smoke cloud for 8 s, blocks sight both ways. 1 bomb.' },
  whistle:  { name: 'Whistle', key: 'W', desc: 'Lure the nearest enemy within 14 m to your position.', self: true },
  // Rare speed skills (about one character in eight rolls one as a third skill)
  sprint:   { name: 'Sprint', key: 'V', desc: 'Rare. For 3 s move at 1.7x run speed. Loud and easy to spot, like running. Unlimited.', self: true, rare: true, duration: 3 },
  ghost:    { name: 'Stealth Sprint', key: 'G', desc: 'Rare. For 2.5 s move at run speed silently and counted as sneaking. 1 per map.', self: true, rare: true, duration: 2.5, charges: 1 },
};
export const ATTRS = ['stealth', 'speed', 'perception', 'strength', 'agility'];
export const ATTR_SHORT = { stealth: 'STL', speed: 'SPD', perception: 'PER', strength: 'STR', agility: 'AGI' };

// Wide spread on purpose: SPD 1 sneaks at 1.7 m/s and runs at 3.9, SPD 10 sneaks at 3.2 and runs at 7.0.
export function sneakSpeed(c) { return 1.5 + 0.17 * c.attrs.speed; }
export function runSpeed(c) { return 3.5 + 0.35 * c.attrs.speed; }
export function viewRange(c) { return 9 + 0.8 * c.attrs.perception; }
export function stealthMult(c) { return 1.3 - 0.06 * c.attrs.stealth; }
export function takedownTime(c) { return 1.1 - 0.04 * c.attrs.agility; }
export const canCarry = (c) => c.attrs.strength >= 5;
export const canLift = (c) => c.attrs.strength >= 7;
export const canClimbVine = (c) => c.attrs.agility >= 7;

function rollAttrs(rng) {
  // 26-point-ish spread: two highs, rest average
  const a = {};
  for (const k of ATTRS) a[k] = rng.int(2, 6);
  const highs = rng.shuffle(ATTRS).slice(0, 2);
  for (const k of highs) a[k] = rng.int(7, 10);
  return a;
}

export function generateRoster(seed = Date.now() & 0xffffffff, count = 8) {
  const rng = makeRng(seed);
  const names = rng.shuffle(NAMES).slice(0, count);
  const roster = [];
  for (let i = 0; i < count; i++) {
    const abilityKeys = Object.keys(ABILITIES).filter((k) => !ABILITIES[k].rare);
    const abilities = rng.shuffle(abilityKeys).slice(0, 2);
    if (rng.next() < 0.12) abilities.push(rng.pick(Object.keys(ABILITIES).filter((k) => ABILITIES[k].rare)));
    roster.push({
      id: `c${i}`,
      name: names[i],
      epithet: rng.pick(EPITHETS),
      color: COLORS[i % COLORS.length],
      attrs: rollAttrs(rng),
      abilities,
    });
  }
  // Coverage guarantees
  const have = (ab) => roster.filter((c) => c.abilities.includes(ab)).length;
  const ensureAbility = (ab) => {
    if (have(ab)) return;
    // overwrite a slot whose ability is not the roster's only copy, so earlier guarantees survive
    const cands = roster.filter((c) => have(c.abilities[1]) > 1);
    const c = cands.length ? rng.pick(cands) : rng.pick(roster);
    c.abilities[1] = ab;
  };
  ensureAbility('takedown'); ensureAbility('lockpick'); ensureAbility('stone'); ensureAbility('smoke'); ensureAbility('whistle');
  // at least two takedown specialists for the gate puzzle
  if (roster.filter((c) => c.abilities.includes('takedown')).length < 2) {
    const cands = roster.filter((c) => !c.abilities.includes('takedown') && have(c.abilities[0]) > 1);
    const c = cands[0] || roster.find((c) => !c.abilities.includes('takedown'));
    c.abilities[0] = 'takedown';
  }
  const ensureAttr = (attr, min) => {
    if (roster.some((c) => c.attrs[attr] >= min)) return;
    rng.pick(roster).attrs[attr] = rng.int(min, 10);
  };
  ensureAttr('strength', 7); ensureAttr('agility', 7); ensureAttr('strength', 5);
  return { seed, roster };
}

/** Human-readable capability warnings for a squad. */
export function squadWarnings(squad) {
  const w = [];
  const has = (ab) => squad.some((c) => c.abilities.includes(ab));
  if (!has('takedown')) w.push('Nobody can perform takedowns — every guard must be avoided or distracted.');
  else if (squad.filter((c) => c.abilities.includes('takedown')).length < 2) w.push('Only one takedown specialist — synchronised double takedowns are off the table.');
  if (!has('lockpick')) w.push('Nobody can lockpick — locked gates need the Captain\'s Key Ring.');
  if (!has('stone') && !has('whistle')) w.push('No distraction tools (stone/whistle) — Elites must be timed or smoked.');
  if (!has('smoke')) w.push('No smoke bomb.');
  if (!squad.some(canLift)) w.push('Nobody has Strength 7 — sewer grates cannot be lifted.');
  if (!squad.some(canClimbVine)) w.push('Nobody has Agility 7 — vines cannot be climbed.');
  if (!squad.some(canCarry)) w.push('Nobody has Strength 5 — bodies cannot be moved.');
  return w;
}
