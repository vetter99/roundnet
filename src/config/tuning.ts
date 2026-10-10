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
    dive: {
      // Lunge speed at the start of a dive (it slows toward the end).
      speed: 10,
      // Seconds lunging, when you can still pass or spike.
      duration: 0.38,
      // Seconds lying on the ground afterward: no moving, jumping or hitting.
      recovery: 0.12,
      // While diving, reach is measured from the outstretched paws, this far
      // ahead of the feet in the dive direction, plus a bonus.
      reachOffset: 0.7,
      reachBonus: 0.7,
      // Ideal contact height while diving: you're stretched out low.
      contactHeight: 0.6,
      // How far above the dive contact height a ball can still be hit.
      highReach: 1.2,
      // Dive hits are saves: their power is scaled down by this.
      powerScale: 0.6,
      // There's no dive button: swinging at a ball that's out of reach, but no
      // more than this far beyond it, dives for it automatically.
      autoRange: 1.8,
    },
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
    // A spike released below this charge power (a quick tap) is a drop shot.
    dropShotMaxPower: 0.15,
    // Horizontal speed of the drop shot's soft lob onto the net, and how far
    // past the net center it lands (so its pop carries it off the far edge).
    dropSpeed: 4,
    dropPastCenter: 0.4,
    // Off the net, a drop shot pops up only this fast and keeps this fraction
    // of its horizontal speed, so it dies within ~1-1.5 m of the net.
    dropBounceUp: 2.2,
    dropHorizontalKeep: 0.35,
    // Upward speed of a pass: a quick tap vs. full charge.
    passUpSpeedMin: 4.5,
    passUpSpeedMax: 13.5,
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
    serveLineDistance: 3.2,
    // The no-spike zone line, this far out from the net's edge.
    // Drawn only; the rule isn't enforced yet.
    noSpikeZoneDistance: 0.7,
    // Width of the painted lines.
    lineWidth: 0.045,
  },

  // The serve duel (see src/sim/serve.ts).
  serve: {
    // The server stands this far behind the serve line.
    behindLine: 0.4,
    // How fast the stick moves the aim across the net (m/s), and how far out
    // it can go (fraction of the net radius; 1 = the edge).
    aimSpeed: 1.4,
    aimLimit: 1,
    // How far the aim wobbles at full charge (m): power costs accuracy.
    wobble: 0.35,
    // Serve speed for a tap vs. a full charge (m/s).
    speedMin: 6,
    speedMax: 12,
    handHeight: 1.1,
    // Attempts per serve before it's lost.
    tries: 2,
    // Spin: pushing the stick sideways after release curves the serve this
    // hard (m/s² at full stick; a slow serve bends ~0.6 m, a fast one ~0.15 m),
    // and the net kicks it sideways by the curve times spinKick (s).
    spinCurve: 3,
    spinKick: 0.22,
  },

  // Rally timing, and a ball fed off the net (a practice/test helper).
  practice: {
    // Ticks after the ball dies before the serve prompt appears (60 = 1 second).
    resetDelayTicks: 50,
    feedDistance: 2.2,
    feedHeight: 2.2,
    feedSpeed: 5,
  },

  // Smart-framing broadcast camera behind the near (-z) side. Its angle is
  // fixed; it pans and zooms to keep the players, ball, landing spot and net
  // on screen, sitting as close as it can.
  camera: {
    // Downward tilt in degrees (higher = more top-down).
    pitchDeg: 36,
    fov: 0.75,
    // How close it sits when the action is tight, and how far it may pull back.
    minDistance: 12,
    maxDistance: 26,
    // Fraction of the screen the action may fill (lower = more breathing room).
    margin: 0.78,
    // How quickly it pulls back, comes back in, and pans (higher = snappier).
    zoomOutSpeed: 7,
    zoomInSpeed: 1.2,
    panSpeed: 5,
    // Seconds of player movement to look ahead, so running toward the camera
    // shows where you're going before you get there.
    lookAhead: 0.5,
    // Serve duel camera: this far behind and this high above the receiver,
    // with this field of view, easing in/out at duelBlendSpeed.
    duelBack: 3.2,
    duelHeight: 2.3,
    duelFov: 0.85,
    duelBlendSpeed: 3,
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
