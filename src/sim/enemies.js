// Enemy archetypes. Angles in radians, distances in metres, rates per second.
const D = Math.PI / 180;

export const ENEMY_TYPES = {
  guard:    { name: 'Guard',    fov: 90 * D,  range: 12, baseRate: 1.0, speed: 1.5, runSpeed: 2.6, turnRate: 2.2, takedownable: true,  lookTime: 4, hideDist: 1.5, color: '#ef5350', radius: 0.4 },
  sentinel: { name: 'Sentinel', fov: 50 * D,  range: 24, baseRate: 0.8, speed: 0,   runSpeed: 0,   turnRate: 0.6, takedownable: false, lookTime: 0, hideDist: 1.5, color: '#ff7043', radius: 0.4, stationary: true },
  dog:      { name: 'Dog',      fov: 360 * D, range: 5,  baseRate: 2.0, speed: 2.4, runSpeed: 4.0, turnRate: 6.0, takedownable: true,  lookTime: 2, hideDist: 2.5, color: '#d4a373', radius: 0.3 },
  elite:    { name: 'Elite',    fov: 110 * D, range: 14, baseRate: 1.3, speed: 1.6, runSpeed: 2.8, turnRate: 2.4, takedownable: false, lookTime: 2, hideDist: 1.5, color: '#ab47bc', radius: 0.45 },
  officer:  { name: 'Officer',  fov: 90 * D,  range: 12, baseRate: 1.0, speed: 1.5, runSpeed: 2.6, turnRate: 2.2, takedownable: true,  lookTime: 4, hideDist: 1.5, color: '#ffca28', radius: 0.42, ignoresDistraction: true },
};

export const NEAR_ZONE = 0.4;      // fraction of range that is "instant" detection
export const NEAR_RATE = 4.0;
export const FAR_RATE_NEAR = 1.2;  // at the near/far boundary
export const FAR_RATE_FAR = 0.5;   // at max range
export const DECAY = 0.6;          // meter decay per second when nobody is seen
export const SUSPICIOUS_AT = 0.35;
export const CALM_AT = 0.2;
