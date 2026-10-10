import type { Tuning } from '../config/tuning';
import { createBall, launchBallAt, netContactHeight, stepBall, type Ball, type BallEvent } from './ball';
import { missReason, tryHit, type HitResult, type MissReason } from './hit';
import { createPlayer, NEUTRAL_INTENT, stepPlayer, type HitKind, type Intent, type Player } from './player';

export type Team = 0 | 1;


export type SimEvent =
  | BallEvent
  | ({ type: 'hit' } & HitResult)
  // The player released a spike or pass (whether or not it connects).
  | { type: 'swing'; playerId: number; kind: HitKind; power: number }
  // A swing's buffer ran out without touching the ball.
  | { type: 'whiff'; playerId: number; kind: HitKind; reason: MissReason }
  // The ball came off the net, so the other team must now play it.
  | { type: 'possession'; team: Team }
  | { type: 'point'; team: Team }
  | { type: 'gameOver'; winner: Team };

/**
 * The whole game state: a 1v1 rally game. The team in possession gets up to
 * MAX_TOUCHES to put the ball on the net, which hands possession to the other
 * team. A 4th touch is refused, so if the ball hits the ground the team in
 * possession loses the point. Rally scoring to `match.pointsToWin`, win by 2.
 */
export interface World {
  tick: number;
  ball: Ball;
  players: Player[];
  // Events from the most recent tick only.
  events: SimEvent[];
  // The team that must play the ball now.
  possession: Team;
  // Touches the team in possession has used.
  touches: number;
  // Tick when the current possession started (bots use it to react).
  possessionTick: number;
  // The team that last sent the ball (by hitting or serving it).
  lastHitTeam: Team;
  score: [number, number];
  winner: Team | null;
  // Ticks since the ball died; the next serve comes after a short pause.
  deadTicks: number;
  // The team that receives the next serve.
  nextReceiver: Team;
}

export function createWorld(t: Tuning): World {
  const world: World = {
    tick: 0,
    ball: createBall(),
    // Blue starts on the camera side, red across the net.
    players: [createPlayer(0, 0, -1.8, -1.8), createPlayer(1, 1, 1.8, 1.8)],
    events: [],
    possession: 0,
    touches: 0,
    possessionTick: 0,
    lastHitTeam: 1,
    score: [0, 0],
    winner: null,
    deadTicks: 0,
    nextReceiver: 0,
  };
  serve(world, 0, t);
  return world;
}

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

/** Advance the world one fixed tick. `intents[i]` drives `players[i]`. */
export function stepWorld(world: World, intents: readonly Intent[], t: Tuning): void {
  world.tick++;
  world.events.length = 0;

  world.players.forEach((p, i) => {
    const swing = stepPlayer(p, intents[i] ?? NEUTRAL_INTENT, t);
    if (swing) world.events.push({ type: 'swing', playerId: p.id, ...swing });
  });
  separatePlayers(world, t);

  const turn = { possession: world.possession, touches: world.touches };
  world.players.forEach((p, i) => {
    const hit = tryHit(p, world.ball, intents[i] ?? NEUTRAL_INTENT, t, turn);
    if (hit) {
      world.events.push({ type: 'hit', ...hit });
      world.touches++;
      world.lastHitTeam = p.team;
    } else if (p.hitBuffer && p.hitBuffer.ticksLeft <= 0) {
      const reason = missReason(p, world.ball, t, turn) ?? 'tooFar';
      world.events.push({ type: 'whiff', playerId: p.id, kind: p.hitBuffer.kind, reason });
      p.hitBuffer = null;
    }
  });

  const ballEvents: BallEvent[] = [];
  stepBall(world.ball, t, ballEvents);
  for (const e of ballEvents) {
    world.events.push(e);
    if (e.type === 'net') {
      // Whoever sent it onto the net hands the ball to the other team.
      world.possession = otherTeam(world.lastHitTeam);
      world.touches = 0;
      world.possessionTick = world.tick;
      world.events.push({ type: 'possession', team: world.possession });
    } else if (e.type === 'ground') {
      scorePoint(world, otherTeam(world.possession), t);
    }
  }

  if (world.ball.alive || world.winner !== null) {
    world.deadTicks = 0;
  } else if (++world.deadTicks >= t.practice.resetDelayTicks) {
    serve(world, world.nextReceiver, t);
  }
}

function scorePoint(world: World, team: Team, t: Tuning): void {
  world.score[team]++;
  world.events.push({ type: 'point', team });
  // In roundnet the team that wins the point serves, so the loser receives.
  world.nextReceiver = otherTeam(team);
  const [a, b] = world.score;
  if (Math.max(a, b) >= t.match.pointsToWin && Math.abs(a - b) >= 2) {
    world.winner = a > b ? 0 : 1;
    world.events.push({ type: 'gameOver', winner: world.winner });
  }
}

/** Start a new match, keeping players where they are. */
export function restartMatch(world: World, t: Tuning): void {
  world.score = [0, 0];
  world.winner = null;
  serve(world, 0, t);
}

/**
 * Put a new ball in play: tossed off the net toward the receiving team's
 * player, who then has possession. (Stand-in until real serving exists.)
 */
export function serve(world: World, receiver: Team, t: Tuning): void {
  const p = world.players.find((pl) => pl.team === receiver) ?? world.players[0];
  let ux = p.pos.x;
  let uz = p.pos.z;
  const d = Math.hypot(ux, uz);
  if (d < 1e-3) {
    ux = 0;
    uz = receiver === 0 ? -1 : 1;
  } else {
    ux /= d;
    uz /= d;
  }

  const ball = world.ball;
  ball.pos = { x: -ux * t.practice.feedDistance, y: t.practice.feedHeight, z: -uz * t.practice.feedDistance };
  ball.alive = true;
  ball.lastTouch = 'feed';
  launchBallAt(ball, { x: ux * 0.15, y: netContactHeight(t), z: uz * 0.15 }, t.practice.feedSpeed, t);

  // The serving team "sent" it, so the net hands possession to the receiver.
  world.lastHitTeam = otherTeam(receiver);
  world.possession = otherTeam(receiver);
  world.touches = 0;
  world.possessionTick = world.tick;
  world.deadTicks = 0;
}

/**
 * Players can't overlap. The team in possession has right of way: a defender
 * who runs into them is pushed aside, so you can't block the other team's play.
 */
function separatePlayers(world: World, t: Tuning): void {
  const minDist = t.player.radius * 2;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const overlap = minDist - d;
      const nx = dx / d;
      const nz = dz / d;
      // Share of the push each player takes.
      const aHasBall = a.team === world.possession;
      const bHasBall = b.team === world.possession;
      const aShare = aHasBall === bHasBall ? 0.5 : aHasBall ? 0 : 1;
      a.pos.x -= nx * overlap * aShare;
      a.pos.z -= nz * overlap * aShare;
      b.pos.x += nx * overlap * (1 - aShare);
      b.pos.z += nz * overlap * (1 - aShare);
    }
  }
}
