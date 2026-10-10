// Every gameplay number lives here. The tuning panel (backtick key) edits the
// live `tuning` object; use its "Copy JSON" button to paste good values back
// into DEFAULT_TUNING.
//
// Units: meters, seconds, meters/second. Coordinates: x = right, y = up,
// z = away from the broadcast camera. The net is centered at the origin.

export type MarkerMode = 'always' | 'hideUntilNet';

export const DEFAULT_TUNING = {
  // Real gravity is 9.81. Higher feels snappier and more arcade-like.
  gravity: 12,

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
    // Radius of the bouncy surface (a real net is ~0.45m; bigger is friendlier).
    radius: 0.65,
    // Width of the frame around the surface. It bounces like the net (no rim faults).
    frameWidth: 0.05,
    height: 0.25,
    // Vertical speed kept after a net bounce (1 = perfect trampoline).
    bounce: 0.8,
    // Horizontal speed kept after a net bounce.
    horizontalKeep: 0.5,
    // Even a soft or flat hit pops up at least this fast. This is what gives
    // the defender time to react; flat spikes otherwise skim off low and fast.
    minUpSpeed: 5,
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
    reach: 1.05,
    // How far below / above the contact height the ball can still be hit.
    lowReach: 1.2,
    highReach: 0.8,
  },

  hit: {
    // Horizontal speed of a perfectly timed spike: a quick tap vs. full charge.
    spikeSpeedMin: 8,
    spikeSpeedMax: 14,
    // Power of a worst-quality hit, as a fraction of a perfect one.
    minQualityPower: 0.6,
    // A spike's drift past the net center at the worst timing, in net radii.
    // Above ~1.2 the worst-timed spikes miss the net entirely; at 1.3 only
    // spikes timed below ~10% miss.
    mishitDrift: 1.3,
    // Contact within this height of the ideal counts as perfect.
    perfectWindow: 0.15,
    // Quality falls from 1 to 0 over this much extra height error.
    qualityFalloff: 0.8,
    // Upward speed of a pass: a quick tap vs. full charge.
    passUpSpeedMin: 5.5,
    passUpSpeedMax: 10.5,
    passHorizontalSpeed: 2,
    // Shortest allowed flight time when aiming at a point, to avoid absurd speeds.
    minFlightTime: 0.12,
    // Seconds of holding a hit button to reach full power.
    chargeTime: 0.6,
    // Movement speed multiplier while charging.
    chargeMoveFactor: 0.55,
    // A hit released this many ticks early still fires when the ball arrives.
    inputBufferTicks: 8,
    cooldownTicks: 15,
  },

  marker: {
    mode: 'always' as MarkerMode,
    // Timing guide at the landing spot: an outer ring shrinks from maxRadius
    // onto the target ring (targetRadius) over the last approachTime seconds,
    // meeting it when the ball enters the PERFECT window at contact height.
    maxRadius: 1.1,
    targetRadius: 0.3,
    approachTime: 0.9,
  },

  court: {
    // Servers stand behind this line, measured out from the net's edge
    // (real roundnet uses 6ft = 1.83m).
    serveLineDistance: 2.4,
  },

  // The temporary serve: a ball fed off the net toward the receiving player.
  practice: {
    // Ticks after the ball dies before the serve prompt appears (60 = 1 second).
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

  audio: {
    // Master volume, 0..1. M mutes.
    volume: 0.6,
    // Background music, relative to master.
    music: 0.35,
  },

  debug: {
    // Show every player's reach ring, not just the team in possession.
    showReach: false,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

export function createTuning(): Tuning {
  return structuredClone(DEFAULT_TUNING);
}

// The live, mutable tuning used by the running game.
export const tuning: Tuning = createTuning();
