import type { Tuning } from '../config/tuning';
import { predictDescentTo } from '../sim/hit';
import { NEUTRAL_INTENT, type HitKind, type Intent, type Player } from '../sim/player';
import type { Vec3 } from '../sim/vec';
import { serverTeam, type World } from '../sim/world';

// A simple computer player. It's deterministic (no randomness) like the sim,
// and deliberately imperfect: it reacts a little late, and mistimes its swings
// by a varying amount each possession.
//
// Most of the time it plays three touches like a real roundnet player: it
// passes the ball up to itself twice, then spikes the third touch onto the
// net. Passes often drift to one side to set up a different spike angle, and
// the passes buy time, so the spike is usually more charged.

// Reacts this many ticks after the ball comes off the net, plus up to
// REACTION_SLOP_TICKS more depending on the possession.
const REACTION_TICKS = 10;
const REACTION_SLOP_TICKS = 12;
// Sometimes it misreads the ball and reacts this much later, usually too late
// to get there. Harder incoming spikes are misread more often:
// chance = MISREAD_BASE + MISREAD_FROM_POWER * power^2 (about 1 in 4 at full power).
const MISREAD_EXTRA_TICKS = 36;
const MISREAD_BASE = 0.05;
const MISREAD_FROM_POWER = 0.2;
const MOVE_EFFORT = 0.95;
// Out of 10 possessions, how many play three touches (pass, pass, spike) and
// how many two (pass, spike); the rest spike the first touch.
const THREE_TOUCH_OUT_OF_10 = 7;
const TWO_TOUCH_OUT_OF_10 = 2;
// Start holding the button this many ticks before contact. Longer holds charge
// harder hits; a spike after its own pass has plenty of time to load up.
const PASS_LEAD_TICKS = 6;
const SPIKE_LEAD_TICKS = 18;
const SET_SPIKE_LEAD_TICKS = 32;
// Timing mistakes: release up to this far (m) above or below the ideal height.
const SPIKE_TIMING_ERROR = 0.3;
const PASS_TIMING_ERROR = 0.15;
// Drop shots: when the opponent stands this far from the net, the CPU taps a
// drop shot instead of spiking on DROP_OUT_OF_10 possessions out of 10.
const DROP_WHEN_OPPONENT_BEYOND = 2.8;
const DROP_OUT_OF_10 = 4;
// How hard the pass leans toward the net (0 = straight up), for a better spike
// angle, and how far it can drift sideways (stick amount) to change the angle.
const PASS_TOWARD_NET = 0.25;
const PASS_SIDEWAYS = 0.8;
// Heights (m) it tries to play the ball at, best first: the ideal contact
// height, then lower ones when it can't get there in time (e.g. a drop shot
// that never pops up that high).
const LOW_HEIGHTS = [0.9, 0.55, 0.3];
// Ticks of slack it allows itself when judging whether it can get somewhere in time.
const ARRIVE_SLACK_TICKS = 4;
// Drop shots are read from the opponent's soft tap: it reacts this fast,
// except that it's fooled by DROP_FOOLED_CHANCE of them (and reacts as if to
// a normal ball, usually too late).
const DROP_REACTION_TICKS = 3;
const DROP_FOOLED_CHANCE = 0.2;
const WAIT_DISTANCE = 2.3;
// Serving: the CPU aims a little to one side of the net center, then after a
// pause charges for SERVE_CHARGE_TICKS (about two-thirds power) and releases.
const SERVE_DELAY_TICKS = 50;
const SERVE_CHARGE_TICKS = 22;
const SERVE_AIM_SIDE = 0.35;

/** A repeatable pseudo-random value in [-1, 1] for this possession; `salt` varies it per touch. */
function slop(world: World, salt: number): number {
  return (((world.possessionTick * 7919 + world.possession * 31 + salt * 104729) % 9) - 4) / 4;
}

/** A repeatable pseudo-random roll in [0, 1) for this possession. */
function roll(world: World, salt = 0): number {
  return (Math.imul(world.possessionTick + 1 + salt * 7777, 2654435761) >>> 0) / 4294967296;
}

/** Whether the CPU misreads the incoming ball this possession. */
function misreads(world: World): boolean {
  const power = world.lastHitPower;
  return roll(world) < MISREAD_BASE + MISREAD_FROM_POWER * power * power;
}

/** Whether this possession's spike should be a drop shot (opponent far back, some of the time). */
function playsDrop(world: World, opponent: Player | undefined): boolean {
  if (!opponent || Math.hypot(opponent.pos.x, opponent.pos.z) < DROP_WHEN_OPPONENT_BEYOND) return false;
  return (world.possessionTick * 92821 + world.possession * 7) % 10 < DROP_OUT_OF_10;
}

/** How many touches the CPU means to use this possession (the last one is the spike). */
function plannedTouches(world: World, t: Tuning): number {
  const r = (world.possessionTick * 131 + world.possession * 17) % 10;
  const planned = r < THREE_TOUCH_OUT_OF_10 ? 3 : r < THREE_TOUCH_OUT_OF_10 + TWO_TOUCH_OUT_OF_10 ? 2 : 1;
  return world.mode === 'match' ? Math.min(planned, t.match.maxTouches) : planned;
}

export function botIntent(world: World, index: number, t: Tuning): Intent {
  const me = world.players[index];
  const opponent = world.players.find((p) => p.team !== me.team);
  const ball = world.ball;
  const intent: Intent = { ...NEUTRAL_INTENT };

  if (world.waitingForServe && world.winner === null && serverTeam(world) === me.team) {
    // Steer the aim to one side (alternating serve to serve), then charge and release.
    const side = world.serveReadyTick % 2 === 0 ? 1 : -1;
    const dx = side * SERVE_AIM_SIDE * t.net.radius - world.serve.aim.x;
    const dz = -world.serve.aim.z;
    intent.moveX = Math.max(-1, Math.min(1, dx * 6));
    intent.moveZ = Math.max(-1, Math.min(1, dz * 6));
    const elapsed = world.tick - world.serveReadyTick;
    intent.spike = elapsed >= SERVE_DELAY_TICKS && elapsed < SERVE_DELAY_TICKS + SERVE_CHARGE_TICKS;
    // While charging, on about half of serves push the stick sideways for spin.
    const spinChoice = (world.serveReadyTick * 48271) % 4;
    if (me.charge && spinChoice < 2) {
      // Sideways relative to the line from the server to its aim.
      const ax = world.serve.aim.x - me.pos.x;
      const az = world.serve.aim.z - me.pos.z;
      const d = Math.hypot(ax, az) || 1;
      const dir = spinChoice === 0 ? 1 : -1;
      intent.moveX = (az / d) * dir;
      intent.moveZ = (-ax / d) * dir;
    }
    return intent;
  }


  const myLastHit = ball.lastTouch === 'player' && world.lastHitTeam === me.team;
  // A ball we passed to ourselves is ours to play again; one we spiked is on its way to the net.
  const followUp = myLastHit && world.lastHitKind === 'pass';
  const waitingForNet = myLastHit && (world.lastHitKind === 'spike' || world.lastHitKind === 'drop');
  const myBall = world.possession === me.team && ball.alive && !waitingForNet;
  const dropIncoming =
    world.lastHitTeam !== me.team && world.lastHitKind === 'drop' && roll(world, 1) >= DROP_FOOLED_CHANCE;
  const reaction = dropIncoming
    ? DROP_REACTION_TICKS
    : REACTION_TICKS + Math.round(Math.abs(slop(world, 0)) * REACTION_SLOP_TICKS) + (misreads(world) ? MISREAD_EXTRA_TICKS : 0);

  if (!myBall || (!followUp && world.tick - world.possessionTick < reaction)) {
    if (dropIncoming && ball.alive && ball.lastTouch === 'player') {
      // The opponent tapped a drop shot: start running in to where it will die.
      const plan = playablePlan(world, me, t);
      if (plan) moveToward(intent, me, plan.point);
    } else if (opponent && world.possession !== me.team) {
      // Wait across the net from the opponent, where their shots tend to go.
      const d = Math.hypot(opponent.pos.x, opponent.pos.z) || 1;
      moveToward(intent, me, { x: (-opponent.pos.x / d) * WAIT_DISTANCE, y: 0, z: (-opponent.pos.z / d) * WAIT_DISTANCE });
    }
    return intent;
  }

  const plan = playablePlan(world, me, t);
  if (!plan) return intent;
  moveToward(intent, me, plan.point);

  const touch = world.touches + 1;
  const kind: HitKind = touch < plannedTouches(world, t) ? 'pass' : 'spike';
  const drop = kind === 'spike' && playsDrop(world, opponent);
  // A drop shot is a quick tap: press just before contact so it barely charges.
  const lead = drop ? 1 : kind === 'pass' ? PASS_LEAD_TICKS : followUp ? SET_SPIKE_LEAD_TICKS : SPIKE_LEAD_TICKS;
  const distance = Math.hypot(plan.point.x - me.pos.x, plan.point.z - me.pos.z);
  // Out of reach and can't get there: swing anyway, and the swing becomes a dive.
  const inReach = distance < t.player.reach || (!plan.inTime && distance < t.player.reach + t.player.dive.autoRange);

  if (me.charge) {
    // Keep holding until the ball falls to (roughly) the planned height, then release.
    // Drop shots release right away so the tap stays under drop-shot power.
    const error = drop ? 0.2 : (me.charge.kind === 'pass' ? PASS_TIMING_ERROR : SPIKE_TIMING_ERROR) * slop(world, touch);
    const release = ball.vel.y < 0 && ball.pos.y <= plan.height + error;
    intent[me.charge.kind] = !release;
    if (release && me.charge.kind === 'pass') aimPass(intent, me, world, touch);
  } else if (inReach && plan.ticks <= lead && plan.ticks > 0) {
    intent[kind] = true;
  }
  return intent;
}

interface Plan {
  point: Vec3;
  ticks: number;
  // The height it plans to play the ball at.
  height: number;
  // Whether it can get there in time.
  inTime: boolean;
}

/**
 * Where to play the ball: where it falls to the ideal contact height if the
 * CPU can get there in time, otherwise the first lower height it can still
 * reach (or, failing all, the lowest one, to dive for).
 */
function playablePlan(world: World, me: Player, t: Tuning): Plan | null {
  let fallback: Plan | null = null;
  for (const height of [t.player.contactHeight, ...LOW_HEIGHTS]) {
    const descent = predictDescentTo(world.ball, height, t);
    if (!descent) continue;
    const run = Math.max(0, Math.hypot(descent.point.x - me.pos.x, descent.point.z - me.pos.z) - t.player.reach * 0.5);
    const inTime = (run / t.player.maxSpeed) * 60 <= descent.ticks + ARRIVE_SLACK_TICKS;
    const plan = { point: descent.point, ticks: descent.ticks, height, inTime };
    if (inTime) return plan;
    fallback = plan;
  }
  return fallback;
}

/**
 * Pop a released pass up, leaning slightly toward the net, and on many passes
 * drifting to one side to set up a different angle for the next touch (spikes
 * aren't aimed, so the angle comes from where it hits from).
 */
function aimPass(intent: Intent, me: Player, world: World, touch: number): void {
  const d = Math.hypot(me.pos.x, me.pos.z) || 1;
  const inX = -me.pos.x / d;
  const inZ = -me.pos.z / d;
  // Sideways is perpendicular to the line to the net; about a third of passes go straight.
  const s = slop(world, 10 + touch);
  const side = Math.abs(s) < 0.3 ? 0 : s * PASS_SIDEWAYS;
  intent.moveX = inX * PASS_TOWARD_NET + inZ * side;
  intent.moveZ = inZ * PASS_TOWARD_NET - inX * side;
}

function moveToward(intent: Intent, me: Player, target: Vec3): void {
  const dx = target.x - me.pos.x;
  const dz = target.z - me.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return;
  // Ease off when close so the bot doesn't overshoot.
  const effort = Math.min(1, dist * 2.5) * MOVE_EFFORT;
  intent.moveX = (dx / dist) * effort;
  intent.moveZ = (dz / dist) * effort;
}
