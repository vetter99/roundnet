import type { Tuning } from '../config/tuning';
import { cloneBall, stepBall, type BallEvent } from '../sim/ball';
import { MAX_TOUCHES } from '../sim/hit';
import { NEUTRAL_INTENT, type Intent, type Player } from '../sim/player';
import type { Vec3 } from '../sim/vec';
import type { World } from '../sim/world';

// A simple computer player. It's deterministic (no randomness) like the sim,
// and deliberately imperfect: it reacts late and doesn't move at full speed.
const REACTION_TICKS = 12;
const MOVE_EFFORT = 0.85;
// Start charging a spike this many ticks before contact (~half power).
const CHARGE_LEAD_TICKS = 18;
const WAIT_DISTANCE = 2.3;

interface ContactPlan {
  point: Vec3;
  ticks: number;
}

/** Where (and in how many ticks) the ball will drop to this player's contact height. */
function planContact(world: World, t: Tuning): ContactPlan | null {
  const ball = cloneBall(world.ball);
  const events: BallEvent[] = [];
  const contactY = t.player.contactHeight;
  for (let tick = 0; tick < 180 && ball.alive; tick++) {
    const playable = ball.lastTouch === 'net' || ball.lastTouch === 'player';
    if (playable && ball.vel.y < 0 && ball.pos.y <= contactY) return { point: ball.pos, ticks: tick };
    events.length = 0;
    stepBall(ball, t, events);
  }
  return null;
}

export function botIntent(world: World, index: number, t: Tuning): Intent {
  const me = world.players[index];
  const opponent = world.players.find((p) => p.team !== me.team);
  const intent: Intent = { ...NEUTRAL_INTENT };
  const myBall = world.possession === me.team && world.ball.alive && world.touches < MAX_TOUCHES;

  if (!myBall || world.tick - world.possessionTick < REACTION_TICKS) {
    // Wait across the net from the opponent, where their shots tend to go.
    if (opponent) {
      const d = Math.hypot(opponent.pos.x, opponent.pos.z) || 1;
      moveToward(intent, me, { x: (-opponent.pos.x / d) * WAIT_DISTANCE, y: 0, z: (-opponent.pos.z / d) * WAIT_DISTANCE });
    }
    return intent;
  }

  const plan = planContact(world, t);
  if (!plan) return intent;
  moveToward(intent, me, plan.point);

  const inReach = Math.hypot(plan.point.x - me.pos.x, plan.point.z - me.pos.z) < t.player.reach;
  if (me.charge) {
    // Keep holding until the ball reaches contact height, then release.
    intent.spike = plan.ticks > 0;
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
