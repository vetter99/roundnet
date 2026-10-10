import type { Tuning } from '../config/tuning';
import { predictDescentTo } from '../sim/hit';
import { NEUTRAL_INTENT, type HitKind, type Intent, type Player } from '../sim/player';
import type { Vec3 } from '../sim/vec';
import { serverTeam, type World } from '../sim/world';

// A simple computer player. It's deterministic (no randomness) like the sim,
// and deliberately imperfect: it reacts a little late, and mistimes its swings
// by a varying amount each possession.
//
// Most of the time it plays two touches like a real roundnet player: it
// passes the ball up to itself, then spikes the second touch onto the net.
// The pass buys time, so that spike is usually more charged.

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
// Out of 10 possessions, how many start with a pass to itself.
const PASS_FIRST_OUT_OF_10 = 7;
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
// How hard the pass leans toward the net (0 = straight up), for a better spike angle.
const PASS_TOWARD_NET = 0.25;
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
function roll(world: World): number {
  return (Math.imul(world.possessionTick + 1, 2654435761) >>> 0) / 4294967296;
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

function passesFirst(world: World): boolean {
  return (world.possessionTick * 131 + world.possession * 17) % 10 < PASS_FIRST_OUT_OF_10;
}

export function botIntent(world: World, index: number, t: Tuning): Intent {
  const me = world.players[index];
  const opponent = world.players.find((p) => p.team !== me.team);
  const ball = world.ball;
  const intent: Intent = { ...NEUTRAL_INTENT };

  if (world.waitingForServe && serverTeam(world) === me.team) {
    // Steer the aim to one side (alternating serve to serve), then charge and release.
    const side = world.serveReadyTick % 2 === 0 ? 1 : -1;
    const dx = side * SERVE_AIM_SIDE * t.net.radius - world.serve.aim.x;
    const dz = -world.serve.aim.z;
    intent.moveX = Math.max(-1, Math.min(1, dx * 6));
    intent.moveZ = Math.max(-1, Math.min(1, dz * 6));
    const elapsed = world.tick - world.serveReadyTick;
    intent.spike = elapsed >= SERVE_DELAY_TICKS && elapsed < SERVE_DELAY_TICKS + SERVE_CHARGE_TICKS;
    return intent;
  }

  const myLastHit = ball.lastTouch === 'player' && world.lastHitTeam === me.team;
  // A ball we passed to ourselves is ours to spike; one we spiked is on its way to the net.
  const secondTouch = myLastHit && world.lastHitKind === 'pass';
  const waitingForNet = myLastHit && (world.lastHitKind === 'spike' || world.lastHitKind === 'drop');
  const myBall = world.possession === me.team && ball.alive && !waitingForNet;
  const reaction =
    REACTION_TICKS + Math.round(Math.abs(slop(world, 0)) * REACTION_SLOP_TICKS) + (misreads(world) ? MISREAD_EXTRA_TICKS : 0);

  if (!myBall || (!secondTouch && world.tick - world.possessionTick < reaction)) {
    // Wait across the net from the opponent, where their shots tend to go.
    if (opponent && world.possession !== me.team) {
      const d = Math.hypot(opponent.pos.x, opponent.pos.z) || 1;
      moveToward(intent, me, { x: (-opponent.pos.x / d) * WAIT_DISTANCE, y: 0, z: (-opponent.pos.z / d) * WAIT_DISTANCE });
    }
    return intent;
  }

  const plan = predictDescentTo(ball, t.player.contactHeight, t);
  if (!plan) return intent;
  moveToward(intent, me, plan.point);

  const kind: HitKind = secondTouch || !passesFirst(world) ? 'spike' : 'pass';
  const drop = kind === 'spike' && playsDrop(world, opponent);
  // A drop shot is a quick tap: press just before contact so it barely charges.
  const lead = drop ? 1 : kind === 'pass' ? PASS_LEAD_TICKS : secondTouch ? SET_SPIKE_LEAD_TICKS : SPIKE_LEAD_TICKS;
  const inReach = Math.hypot(plan.point.x - me.pos.x, plan.point.z - me.pos.z) < t.player.reach;

  if (me.charge) {
    // Keep holding until the ball falls to (roughly) contact height, then release.
    // Drop shots release right away so the tap stays under drop-shot power.
    const error = drop ? 0.2 : (me.charge.kind === 'pass' ? PASS_TIMING_ERROR : SPIKE_TIMING_ERROR) * slop(world, secondTouch ? 2 : 1);
    const release = ball.vel.y < 0 && ball.pos.y <= t.player.contactHeight + error;
    intent[me.charge.kind] = !release;
    if (release && me.charge.kind === 'pass') aimPass(intent, me);
  } else if (inReach && plan.ticks <= lead && plan.ticks > 0) {
    intent[kind] = true;
  }
  return intent;
}

/** Pop a released pass up, drifting slightly toward the net (spikes aren't aimed). */
function aimPass(intent: Intent, me: Player): void {
  const d = Math.hypot(me.pos.x, me.pos.z) || 1;
  intent.moveX = (-me.pos.x / d) * PASS_TOWARD_NET;
  intent.moveZ = (-me.pos.z / d) * PASS_TOWARD_NET;
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
