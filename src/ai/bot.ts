import type { Tuning } from '../config/tuning';
import { predictDescentTo } from '../sim/hit';
import { NEUTRAL_INTENT, type HitKind, type Intent, type Player } from '../sim/player';
import type { Vec3 } from '../sim/vec';
import type { World } from '../sim/world';

// A simple computer player. It's deterministic (no randomness) like the sim,
// and deliberately imperfect: it reacts a little late, and mistimes its swings
// by a varying amount each possession.
//
// Most of the time it plays three touches like a real roundnet player. In
// 1v1 it passes the ball up to itself twice, then spikes the third touch onto
// the net; passes often drift to one side to set up a different spike angle,
// and buy time, so the spike is usually more charged. In 2v2 the teammates
// trade touches (no one may touch twice in a row): pass to the partner, set
// back, spike. Whoever is closer plays the ball; the other moves to support,
// and on defense the two spread out to cover both sides.

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
// Returning a serve: reacts this many ticks after it comes off the net, and
// misreads it this fraction as often as a rally spike.
const SERVE_RETURN_REACTION_TICKS = 4;
const SERVE_MISREAD_SCALE = 0.4;
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
// 2v2: on defense the two teammates stand this far (radians) to either side
// of the spot across from the attacker.
const DEFEND_SPREAD = 0.6;
// 2v2: while the partner plays the ball, stand this far from the net, about
// a quarter turn around it from where the ball is, ready for the pass.
const SUPPORT_DISTANCE = 2.2;
const SUPPORT_ANGLE = 1.5;
// 2v2: a pass to the partner uses full stick at this distance (m) or more,
// less when the partner is closer.
const PASS_TO_PARTNER_REACH = 3.5;
// Serving: the CPU aims a little to one side of the net center, then after a
// pause tosses, starts charging as the toss slows below SERVE_CHARGE_FROM_VY
// (m/s upward; about two-thirds power by the hit), and releases as the ball
// drops to the sweet spot, off by up to SERVE_TIMING_ERROR (m) each serve.
const SERVE_DELAY_TICKS = 50;
const SERVE_CHARGE_FROM_VY = 1.5;
const SERVE_TIMING_ERROR = 0.12;
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
function misreads(world: World, scale = 1): boolean {
  const power = world.lastHitPower;
  return roll(world) < (MISREAD_BASE + MISREAD_FROM_POWER * power * power) * scale;
}

/** Whether this possession's spike should be a drop shot (opponents all far back, some of the time). */
function playsDrop(world: World, opponents: Player[]): boolean {
  if (opponents.length === 0 || opponents.some((o) => Math.hypot(o.pos.x, o.pos.z) < DROP_WHEN_OPPONENT_BEYOND)) return false;
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
  const opponents = world.players.filter((p) => p.team !== me.team);
  const partner = world.players.find((p) => p.team === me.team && p.id !== me.id);
  const ball = world.ball;
  const intent: Intent = { ...NEUTRAL_INTENT };

  if (world.waitingForServe && world.winner === null && world.serve.serverId === me.id) {
    // Hold the stick toward one side (alternating serve to serve) to aim
    // there, toss, then charge and time the hit.
    const side = world.serveReadyTick % 2 === 0 ? 1 : -1;
    intent.moveX = (side * SERVE_AIM_SIDE) / t.serve.aimLimit;
    intent.moveZ = 0;
    const elapsed = world.tick - world.serveReadyTick;
    if (!world.serve.tossed) {
      intent.pass = elapsed >= SERVE_DELAY_TICKS;
      return intent;
    }
    // Tossed: charge from near the top of the toss, release at the sweet spot (give or take).
    intent.moveX = 0;
    intent.moveZ = 0;
    const error = ((((world.serveReadyTick * 7919) % 9) - 4) / 4) * SERVE_TIMING_ERROR;
    const release = ball.vel.y < 0 && ball.pos.y <= t.serve.contactHeight + error;
    intent.spike = (me.charge?.kind === 'spike' || ball.vel.y < SERVE_CHARGE_FROM_VY) && !release;
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
  // Everyone else holds their spot until the serve is in the air.
  if (world.waitingForServe) return intent;

  const ourLastHit = ball.lastTouch === 'player' && world.lastHitTeam === me.team;
  // A ball our side passed is ours to play again; one we spiked is on its way to the net.
  const followUp = ourLastHit && world.lastHitKind === 'pass';
  const waitingForNet = ourLastHit && (world.lastHitKind === 'spike' || world.lastHitKind === 'drop');
  const ourBall = world.possession === me.team && ball.alive && !waitingForNet;
  // In 2v2 only one teammate goes for the ball; the other supports.
  const myBall = ourBall && chaser(world, me, t) === me.id;
  const dropIncoming =
    world.lastHitTeam !== me.team && world.lastHitKind === 'drop' && roll(world, 1) >= DROP_FOOLED_CHANCE;
  // Serves are watched from the toss, so the receiver reacts at once and
  // misreads them less often than rally spikes.
  const returningServe = world.serve.returnPending && world.possession === me.team;
  const reaction = dropIncoming
    ? DROP_REACTION_TICKS
    : returningServe
      ? SERVE_RETURN_REACTION_TICKS + (misreads(world, SERVE_MISREAD_SCALE) ? MISREAD_EXTRA_TICKS : 0)
      : REACTION_TICKS + Math.round(Math.abs(slop(world, 0)) * REACTION_SLOP_TICKS) + (misreads(world) ? MISREAD_EXTRA_TICKS : 0);

  if (!myBall || (!followUp && world.tick - world.possessionTick < reaction)) {
    const dropChaser = !partner || closestTo([me, partner], dropLanding(world, t)) === me.id;
    if (dropIncoming && ball.alive && ball.lastTouch === 'player' && dropChaser) {
      // The opponent tapped a drop shot: start running in to where it will die.
      const plan = playablePlan(world, me, t);
      if (plan) moveToward(intent, me, plan.point);
    } else if (ourBall && partner && !myBall) {
      // The partner is playing it: get open for the pass.
      moveToward(intent, me, supportSpot(world, me, t));
    } else if (opponents.length > 0 && world.possession !== me.team) {
      // Wait across the net from the attacker, where their shots tend to go
      // (in 2v2, spread out with the partner to cover both sides).
      moveToward(intent, me, defendSpot(world, me, partner, opponents));
    }
    return intent;
  }

  const plan = playablePlan(world, me, t);
  if (!plan) return intent;
  moveToward(intent, me, plan.point);

  const touch = world.touches + 1;
  const kind: HitKind = touch < plannedTouches(world, t) ? 'pass' : 'spike';
  const drop = kind === 'spike' && playsDrop(world, opponents);
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
    if (release && me.charge.kind === 'pass') {
      if (partner) aimPassTo(intent, me, partner);
      else aimPass(intent, me, world, touch);
    }
  } else if (inReach && plan.ticks <= lead && plan.ticks > 0) {
    intent[kind] = true;
  }
  return intent;
}

/** Where the ball first falls to contact height (or lower), for deciding who goes for it. */
function dropLanding(world: World, t: Tuning): Vec3 {
  for (const height of [t.player.contactHeight, ...LOW_HEIGHTS]) {
    const descent = predictDescentTo(world.ball, height, t);
    if (descent) return descent.point;
  }
  return world.ball.pos;
}

/** Of these players, the id of the one closest (along the ground) to `point`; ties go to the lower id. */
function closestTo(players: Player[], point: Vec3): number {
  let best = players[0];
  let bestDist = Infinity;
  for (const p of players) {
    const d = Math.hypot(point.x - p.pos.x, point.z - p.pos.z);
    if (d < bestDist - 1e-6) {
      best = p;
      bestDist = d;
    }
  }
  return best.id;
}

/**
 * Which player on my team should go for the ball: in 1v1 always me; in 2v2
 * the closer teammate who is allowed to touch it (not the last hitter).
 */
function chaser(world: World, me: Player, t: Tuning): number {
  const team = world.players.filter((p) => p.team === me.team && !(world.format === '2v2' && p.id === world.lastHitterId));
  if (team.length === 0) return -1;
  return closestTo(team, dropLanding(world, t));
}

/** 2v2 support: a quarter turn around the net from where the ball comes down, on my side of it. */
function supportSpot(world: World, me: Player, t: Tuning): Vec3 {
  const at = dropLanding(world, t);
  const ballAngle = Math.atan2(at.z, at.x);
  const myAngle = Math.atan2(me.pos.z, me.pos.x);
  const side = Math.sin(myAngle - ballAngle) >= 0 ? 1 : -1;
  const a = ballAngle + side * SUPPORT_ANGLE;
  return { x: Math.cos(a) * SUPPORT_DISTANCE, y: 0, z: Math.sin(a) * SUPPORT_DISTANCE };
}

/**
 * Defense: across the net from the attacker (the opponent nearest the ball).
 * With a partner, the two spread to either side of that spot, each taking
 * the side they're already on.
 */
function defendSpot(world: World, me: Player, partner: Player | undefined, opponents: Player[]): Vec3 {
  const ball = world.ball.alive ? world.ball.pos : { x: 0, y: 0, z: 0 };
  const attacker = opponents.find((o) => o.id === closestTo(opponents, ball)) ?? opponents[0];
  const base = Math.atan2(-attacker.pos.z, -attacker.pos.x);
  let a = base;
  if (partner) {
    // Whoever is further counterclockwise from the base spot takes that side.
    const offset = (p: Player) => Math.sin(Math.atan2(p.pos.z, p.pos.x) - base);
    const mine = offset(me);
    const theirs = offset(partner);
    const ccw = mine > theirs || (mine === theirs && me.id < partner.id);
    a = base + (ccw ? DEFEND_SPREAD : -DEFEND_SPREAD);
  }
  return { x: Math.cos(a) * WAIT_DISTANCE, y: 0, z: Math.sin(a) * WAIT_DISTANCE };
}

/** 2v2: pass toward the partner (full stick when they're far, less when close). */
function aimPassTo(intent: Intent, me: Player, partner: Player): void {
  const dx = partner.pos.x - me.pos.x;
  const dz = partner.pos.z - me.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const amount = Math.min(1, d / PASS_TO_PARTNER_REACH);
  intent.moveX = (dx / d) * amount;
  intent.moveZ = (dz / d) * amount;
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
