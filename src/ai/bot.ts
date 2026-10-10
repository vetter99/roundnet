import type { Tuning } from '../config/tuning';
import { predictDescentTo } from '../sim/hit';
import { NEUTRAL_INTENT, type Intent, type Player } from '../sim/player';
import type { Vec3 } from '../sim/vec';
import { serverTeam, type World } from '../sim/world';

// A simple computer player. It's deterministic (no randomness) like the sim,
// and deliberately imperfect: it reacts late, doesn't move at full speed,
// and mistimes its swings by a varying amount each possession.
// Reacts this many ticks after the ball comes off the net, plus up to
// REACTION_SLOP_TICKS more on some possessions (so it sometimes can't get there).
const REACTION_TICKS = 12;
const REACTION_SLOP_TICKS = 24;
const MOVE_EFFORT = 0.85;
// Start charging a spike this many ticks before contact (~half power).
const CHARGE_LEAD_TICKS = 18;
const WAIT_DISTANCE = 2.3;
// Ticks the CPU waits before serving when it's its turn.
const SERVE_DELAY_TICKS = 50;
// Timing mistakes: release up to this far (m) above or below the ideal height.
const TIMING_ERROR = 0.5;

/** A repeatable pseudo-random timing error in [-1, 1] for this possession. */
function timingSlop(world: World): number {
  return (((world.possessionTick * 7919 + world.possession * 31) % 9) - 4) / 4;
}

export function botIntent(world: World, index: number, t: Tuning): Intent {
  const me = world.players[index];
  const opponent = world.players.find((p) => p.team !== me.team);
  const intent: Intent = { ...NEUTRAL_INTENT };

  // Serve with a quick tap of pass (it serves on release) after a short pause.
  if (world.waitingForServe && serverTeam(world) === me.team) {
    intent.pass = world.tick - world.serveReadyTick === SERVE_DELAY_TICKS;
    return intent;
  }
  // Once we've hit it, wait for it to reach the net instead of swinging again.
  const myBall = world.possession === me.team && world.ball.alive && world.ball.lastTouch !== 'player';
  const reaction = REACTION_TICKS + Math.round(Math.abs(timingSlop(world)) * REACTION_SLOP_TICKS);

  if (!myBall || world.tick - world.possessionTick < reaction) {
    // Wait across the net from the opponent, where their shots tend to go.
    if (opponent) {
      const d = Math.hypot(opponent.pos.x, opponent.pos.z) || 1;
      moveToward(intent, me, { x: (-opponent.pos.x / d) * WAIT_DISTANCE, y: 0, z: (-opponent.pos.z / d) * WAIT_DISTANCE });
    }
    return intent;
  }

  const plan = predictDescentTo(world.ball, t.player.contactHeight, t);
  if (!plan) return intent;
  moveToward(intent, me, plan.point);

  const inReach = Math.hypot(plan.point.x - me.pos.x, plan.point.z - me.pos.z) < t.player.reach;
  if (me.charge) {
    // Keep holding until the ball falls to (roughly) contact height, then release.
    const releaseHeight = t.player.contactHeight + timingSlop(world) * TIMING_ERROR;
    intent.spike = !(world.ball.vel.y < 0 && world.ball.pos.y <= releaseHeight);
    if (!intent.spike && opponent) {
      // Aim to the side of the net away from the opponent.
      const d = Math.hypot(opponent.pos.x, opponent.pos.z) || 1;
      intent.moveX = -opponent.pos.x / d;
      intent.moveZ = -opponent.pos.z / d;
    }
  } else if (inReach && plan.ticks <= CHARGE_LEAD_TICKS && plan.ticks > 0) {
    intent.spike = true;
  }
  return intent;
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
