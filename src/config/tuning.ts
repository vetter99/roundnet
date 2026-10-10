// Every gameplay number lives here. The tuning panel (backtick key) edits the
// live `tuning` object; use its "Copy JSON" button to paste good values back
// into DEFAULT_TUNING.
//
// Units: meters, seconds, meters/second. Coordinates: x = right, y = up,
// z = away from the broadcast camera. The net is centered at the origin.

export type MarkerMode = 'always' | 'hideUntilNet';

export const DEFAULT_TUNING = {
  // Real gravity is 9.81. Higher feels snappier and more arcade-like.
  gravity: 14,

  sim: {
    // Ball physics substeps per 60Hz tick, so fast spikes can't skip through the net.
    substeps: 4,
  },

  ball: {
    radius: 0.13,
    // Fraction of velocity lost per second to air resistance.
    airDrag: 0.02,
  },

  net: {
    // Radius of the bouncy surface (a real net is ~0.45m).
    radius: 0.5,
    rimWidth: 0.05,
    height: 0.25,
    // Vertical speed kept after a net bounce (1 = perfect trampoline).
    bounce: 0.8,
    // Horizontal speed kept after a net bounce.
    horizontalKeep: 0.85,
    // Even a soft touch pops up at least this fast.
    minUpSpeed: 3,
    // Vertical speed kept after a rim hit.
    rimBounce: 0.4,
  },

  player: {
    maxSpeed: 6,
    accel: 45,
    decel: 35,
    // Fraction of ground acceleration available mid-air.
    airControl: 0.35,
    jumpSpeed: 5.5,
    // Collision radius against the net.
    radius: 0.3,
    // Visual scale of the character model only; doesn't change reach or timing.
    size: 1,
    // Height above the player's feet where a perfectly timed hit happens
    // (chest height; jump to meet higher balls).
    contactHeight: 1.3,
    // Horizontal distance from the player within which the ball can be hit.
    reach: 0.95,
    // How far below / above the contact height the ball can still be hit.
    lowReach: 1.2,
    highReach: 0.8,
  },

  hit: {
    // Horizontal speed of a perfect spike.
    spikeSpeed: 11,
    // Power of a worst-quality hit, as a fraction of a perfect one.
    minQualityPower: 0.6,
    // How far from net center the stick can aim, as a fraction of net radius.
    aimSpread: 0.6,
    // A bad hit drifts this far (in net radii) past the aim point, toward the rim.
    mishitDrift: 1.1,
    // Contact within this height of the ideal counts as perfect.
    perfectWindow: 0.15,
    // Quality falls from 1 to 0 over this much extra height error.
    qualityFalloff: 0.6,
    passUpSpeed: 7,
    passHorizontalSpeed: 2,
    // Shortest allowed flight time when aiming at a point, to avoid absurd speeds.
    minFlightTime: 0.12,
    // A hit pressed this many ticks early still fires when the ball arrives.
    inputBufferTicks: 6,
    cooldownTicks: 15,
  },

  marker: {
    mode: 'always' as MarkerMode,
    // The marker shrinks from maxRadius to minRadius over the last shrinkTime seconds.
    maxRadius: 0.9,
    minRadius: 0.22,
    shrinkTime: 1.0,
  },

  practice: {
    // Ticks after the ball dies before the next feed (60 = 1 second).
    resetDelayTicks: 50,
    feedDistance: 2.2,
    feedHeight: 2.2,
    feedSpeed: 5,
  },

  camera: {
    height: 7.5,
    distance: 10.5,
    fov: 0.75,
    lookAtZ: 0.8,
  },

  debug: {
    showReach: true,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

export function createTuning(): Tuning {
  return structuredClone(DEFAULT_TUNING);
}

// The live, mutable tuning used by the running game.
export const tuning: Tuning = createTuning();
