import type { Tuning } from '../config/tuning';
import { createBall, launchBallAt, netContactHeight, stepBall, type Ball, type BallEvent } from './ball';
import { missReason, tryHit, type HitResult, type MissReason } from './hit';
import { createPlayer, NEUTRAL_INTENT, stepPlayer, type HitKind, type Intent, type Player } from './player';

export type SimEvent =
  | BallEvent
  | ({ type: 'hit' } & HitResult)
  // The player pressed spike or set (whether or not it connects).
  | { type: 'swing'; playerId: number; kind: HitKind }
  // A swing's buffer ran out without touching the ball.
  | { type: 'whiff'; playerId: number; kind: HitKind; reason: MissReason };

/**
 * The whole game state. Phase 0 is a solo receiving drill: a feeder bounces
 * the ball off the net toward player 0, who must return it onto the net.
 * `streak` counts clean returns in a row; a miss or rim hit resets it.
 */
export interface World {
  tick: number;
  ball: Ball;
  players: Player[];
  // Events from the most recent tick only.
  events: SimEvent[];
  deadTicks: number;
  // True while the ball is in flight from a player's hit (not a feed or net bounce).
  flightFromPlayer: boolean;
  // True once the current feed has been returned onto the net.
  feedReturned: boolean;
  streak: number;
  bestStreak: number;
}

export function createWorld(t: Tuning): World {
  const world: World = {
    tick: 0,
    ball: createBall(),
    players: [createPlayer(0, 0, -1.7, -1.7)],
    events: [],
    deadTicks: 0,
    flightFromPlayer: false,
    feedReturned: false,
    streak: 0,
    bestStreak: 0,
  };
  feedBall(world, t);
  return world;
}

/** Advance the world one fixed tick. `intents[i]` drives `players[i]`. */
export function stepWorld(world: World, intents: readonly Intent[], t: Tuning): void {
  world.tick++;
  world.events.length = 0;

  world.players.forEach((p, i) => {
    const intent = intents[i] ?? NEUTRAL_INTENT;
    stepPlayer(p, intent, t);
    if (intent.spike || intent.pass) world.events.push({ type: 'swing', playerId: p.id, kind: intent.spike ? 'spike' : 'pass' });
  });
  world.players.forEach((p, i) => {
    const hit = tryHit(p, world.ball, intents[i] ?? NEUTRAL_INTENT, t);
    if (hit) {
      world.events.push({ type: 'hit', ...hit });
      world.flightFromPlayer = true;
    } else if (p.hitBuffer && p.hitBuffer.ticksLeft <= 0) {
      const reason = missReason(p, world.ball, t) ?? 'tooFar';
      world.events.push({ type: 'whiff', playerId: p.id, kind: p.hitBuffer.kind, reason });
      p.hitBuffer = null;
    }
  });

  const ballEvents: BallEvent[] = [];
  stepBall(world.ball, t, ballEvents);
  for (const e of ballEvents) {
    world.events.push(e);
    // Only count net hits the player made, not the feed.
    if (e.type === 'net' && world.flightFromPlayer && !world.feedReturned) {
      world.feedReturned = true;
      world.streak++;
    }
    if ((e.type === 'rim' || e.type === 'ground') && !world.feedReturned) endStreak(world);
    world.flightFromPlayer = false;
  }

  if (world.ball.alive) {
    world.deadTicks = 0;
  } else if (++world.deadTicks >= t.practice.resetDelayTicks) {
    feedBall(world, t);
  }
}

function endStreak(world: World): void {
  world.bestStreak = Math.max(world.bestStreak, world.streak);
  world.streak = 0;
}

/** Toss a new ball off the net toward player 0. */
export function feedBall(world: World, t: Tuning): void {
  const p = world.players[0];
  let ux = p.pos.x;
  let uz = p.pos.z;
  const d = Math.hypot(ux, uz);
  if (d < 1e-3) {
    ux = 0;
    uz = -1;
  } else {
    ux /= d;
    uz /= d;
  }

  const ball = world.ball;
  ball.pos = { x: -ux * t.practice.feedDistance, y: t.practice.feedHeight, z: -uz * t.practice.feedDistance };
  ball.alive = true;
  ball.lastTouch = 'feed';
  world.flightFromPlayer = false;
  world.feedReturned = false;
  launchBallAt(ball, { x: ux * 0.15, y: netContactHeight(t), z: uz * 0.15 }, t.practice.feedSpeed, t);
  world.deadTicks = 0;
}
