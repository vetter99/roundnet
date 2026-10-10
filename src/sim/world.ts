import type { Tuning } from '../config/tuning';
import { createBall, launchBallAt, netContactHeight, stepBall, type Ball, type BallEvent } from './ball';
import { autoDiveTarget, missReason, tryHit, type HitResult, type MissReason } from './hit';
import { createPlayer, diveTicks, NEUTRAL_INTENT, startDive, stepPlayer, type HitKind, type Intent, type Player } from './player';

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
  // A player started a dive, and later hit the ground at the end of the lunge.
  | { type: 'dive'; playerId: number }
  | { type: 'diveLand'; playerId: number };

/**
 * The whole game state: 1v1 rallies for working on mechanics. When the ball
 * comes off the net, the other team has possession and must put it back on
 * the net. No scoring or touch limit yet: when the ball lands, the serve
 * switches sides and the game waits for the server to press pass (A) to serve.
 */
export interface World {
  tick: number;
  ball: Ball;
  players: Player[];
  // Events from the most recent tick only.
  events: SimEvent[];
  // The team that must play the ball now.
  possession: Team;
  // Tick when the current possession started (bots use it to react).
  possessionTick: number;
  // The team that last sent the ball (by hitting or serving it).
  lastHitTeam: Team;
  // The kind of the last player hit (null after a serve), e.g. so a player
  // knows a ball they passed to themselves is theirs to play again.
  lastHitKind: HitKind | null;
  // Charge power (0..1) of the last player hit; 0 after a serve.
  lastHitPower: number;
  // Ticks since the ball died; the serve prompt appears after a short pause.
  deadTicks: number;
  // True while the game waits for the server to serve (press and release pass).
  waitingForServe: boolean;
  // Tick when the wait for the serve started (the CPU serves after a pause).
  serveReadyTick: number;
  // The team that receives the next serve; the other team serves it.
  nextReceiver: Team;
}

export function createWorld(): World {
  const world: World = {
    tick: 0,
    ball: createBall(),
    // Blue starts on the camera side, red across the net.
    players: [createPlayer(0, 0, -1.8, -1.8), createPlayer(1, 1, 1.8, 1.8)],
    events: [],
    possession: 0,
    possessionTick: 0,
    lastHitTeam: 1,
    lastHitKind: null,
    lastHitPower: 0,
    deadTicks: 0,
    waitingForServe: true,
    serveReadyTick: 0,
    nextReceiver: 0,
  };
  return world;
}

/** The team that serves next. */
export function serverTeam(world: World): Team {
  return otherTeam(world.nextReceiver);
}

/** End the current rally now (e.g. a stuck ball) and wait for the next serve. */
export function resetRally(world: World): void {
  world.ball.alive = false;
  world.waitingForServe = true;
  world.serveReadyTick = world.tick;
}

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

/** Advance the world one fixed tick. `intents[i]` drives `players[i]`. */
export function stepWorld(world: World, intents: readonly Intent[], t: Tuning): void {
  world.tick++;
  world.events.length = 0;

  world.players.forEach((p, i) => {
    const wasDiving = p.dive !== null;
    const swing = stepPlayer(p, intents[i] ?? NEUTRAL_INTENT, t);
    if (p.dive && !wasDiving) world.events.push({ type: 'dive', playerId: p.id });
    if (p.dive?.ticks === diveTicks(t)) world.events.push({ type: 'diveLand', playerId: p.id });
    if (!swing) return;
    world.events.push({ type: 'swing', playerId: p.id, ...swing });
    // The server's pass swing puts the ball in play instead of hitting.
    if (world.waitingForServe && swing.kind === 'pass' && p.team === serverTeam(world)) {
      p.hitBuffer = null;
      serve(world, world.nextReceiver, t);
    }
  });
  separatePlayers(world, t);

  const turn = { possession: world.possession };
  world.players.forEach((p, i) => {
    // A swing at a ball just out of reach turns into a dive automatically.
    const diveTo = autoDiveTarget(p, world.ball, t, turn);
    if (diveTo) {
      startDive(p, diveTo.x - p.pos.x, diveTo.z - p.pos.z);
      world.events.push({ type: 'dive', playerId: p.id });
    }
    const hit = tryHit(p, world.ball, intents[i] ?? NEUTRAL_INTENT, t, turn);
    if (hit) {
      world.events.push({ type: 'hit', ...hit });
      world.lastHitTeam = p.team;
      world.lastHitKind = hit.kind;
      world.lastHitPower = hit.power;
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
      world.possessionTick = world.tick;
      world.events.push({ type: 'possession', team: world.possession });
    } else if (e.type === 'ground') {
      world.nextReceiver = otherTeam(world.nextReceiver);
    }
  }

  if (world.ball.alive) {
    world.deadTicks = 0;
  } else if (!world.waitingForServe && ++world.deadTicks >= t.practice.resetDelayTicks) {
    world.waitingForServe = true;
    world.serveReadyTick = world.tick;
  }
}

/**
 * Put a new ball in play: tossed off the net toward the receiving team's
 * player, who then has possession. (Stand-in until real serving exists.)
 * Usually triggered by the server's pass swing while waitingForServe.
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
  world.lastHitKind = null;
  world.lastHitPower = 0;
  world.possession = otherTeam(receiver);
  world.possessionTick = world.tick;
  world.deadTicks = 0;
  world.waitingForServe = false;
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
