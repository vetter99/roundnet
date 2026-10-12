import type { Tuning } from '../config/tuning';
import { createBall, launchBallAt, netContactHeight, stepBall, type Ball, type BallEvent } from './ball';
import { autoDiveTarget, missReason, tryHit, type HitResult, type MissReason } from './hit';
import { createPlayer, diveTicks, NEUTRAL_INTENT, startDive, stepPlayer, type HitKind, type Intent, type Player, type ShotKind } from './player';
import {
  createServeState,
  faultServe,
  launchServe,
  serverIntent,
  tossServe,
  serveWobble,
  setNextReceiver,
  setUpServe,
  stepServeAim,
  type ServeState,
} from './serve';

export type Team = 0 | 1;


export type SimEvent =
  | BallEvent
  | ({ type: 'hit' } & HitResult)
  // The player released a spike or pass (whether or not it connects).
  // spin: sidespin -1..1 (from the serve or a spike), for the arm sweep.
  | { type: 'swing'; playerId: number; kind: HitKind; power: number; spin: number }
  // A swing's buffer ran out without touching the ball.
  | { type: 'whiff'; playerId: number; kind: HitKind; reason: MissReason }
  // The ball came off the net, so the other team must now play it.
  | { type: 'possession'; team: Team }
  // A serve was hit; a serve that missed the net (lost = out of tries).
  | { type: 'toss'; playerId: number }
  | { type: 'serve'; playerId: number; power: number; spin: number; quality: number }
  | { type: 'fault'; team: Team; lost: boolean }
  // Match mode: a point scored, and the end of a game.
  // Why: see PointReason. `loser` is the team that gave the point away.
  | { type: 'point'; team: Team; reason: PointReason; loser: Team }
  | { type: 'gameOver'; winner: Team }
  // A player started a dive, and later hit the ground at the end of the lunge.
  | { type: 'dive'; playerId: number }
  | { type: 'diveLand'; playerId: number };

/**
 * Why a point ended, from the losing team's side:
 * - doubleFault: both serves missed the net (or the tosses were dropped)
 * - ace: the serve came off the net and they never touched it
 * - notReached: the ball came off the net and they never got a touch on it
 * - missedNet: their spike or drop missed the net
 * - outOfTouches: they used all their touches without getting it onto the net
 * - dropped: they touched it but let it fall before playing it onto the net
 */
export type PointReason = 'doubleFault' | 'ace' | 'notReached' | 'missedNet' | 'outOfTouches' | 'dropped';

/** Practice: endless rallies, serve alternates. Match: scored games (see `match` in tuning). */
export type Mode = 'practice' | 'match';
/** One player per side, or two (where no player may touch the ball twice in a row). */
export type Format = '1v1' | '2v2';

/**
 * The whole game state: 1v1 or 2v2 rallies. When the ball comes off the net, the
 * other team has possession and must put it back on the net. Each rally
 * starts with a serve duel (serve.ts). In practice mode there's no score and
 * the serve alternates; in match mode the side that lets the ball land (or
 * double faults) gives up the point, the point winner serves, there's a
 * touch limit, and games go to `match.pointsToWin`, win by 2.
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
  lastHitKind: ShotKind | null;
  // Charge power (0..1) of the last player hit; 0 after a serve.
  lastHitPower: number;
  // Ticks since the ball died; the serve prompt appears after a short pause.
  deadTicks: number;
  // True while the game waits for the server to serve (aim, charge, release).
  waitingForServe: boolean;
  serve: ServeState;
  // Tick when the wait for the serve started (the CPU serves after a pause).
  serveReadyTick: number;
  // The team that receives the next serve; the other team serves it.
  nextReceiver: Team;
  mode: Mode;
  format: Format;
  // Per team, which teammate (index within the team) serves when it next has the serve.
  serveOrder: [number, number];
  // Who touched the ball last (null after the net or a serve): in 2v2 they
  // can't touch it again until someone else has.
  lastHitterId: number | null;
  score: [number, number];
  winner: Team | null;
  // Touches the team in possession has used (the limit applies in matches).
  touches: number;
}

/**
 * The players for a format, ids in order. 1v1: Blue (0), Red (1). 2v2: Blue
 * 1 and 2 (ids 0, 1), Red 1 and 2 (ids 2, 3). Blue starts on the camera side.
 */
function createPlayers(format: Format): Player[] {
  if (format === '1v1') return [createPlayer(0, 0, -1.8, -1.8), createPlayer(1, 1, 1.8, 1.8)];
  return [createPlayer(0, 0, -1.8, -1.8), createPlayer(1, 0, 1.8, -1.8), createPlayer(2, 1, 1.8, 1.8), createPlayer(3, 1, -1.8, 1.8)];
}

/** A team's players, in id order. */
export function teamPlayers(world: World, team: Team): Player[] {
  return world.players.filter((p) => p.team === team);
}

export function createWorld(format: Format = '1v1'): World {
  const world: World = {
    tick: 0,
    ball: createBall(),
    players: createPlayers(format),
    events: [],
    possession: 0,
    possessionTick: 0,
    lastHitTeam: 1,
    lastHitKind: null,
    lastHitPower: 0,
    deadTicks: 0,
    waitingForServe: true,
    serve: createServeState(),
    serveReadyTick: 0,
    nextReceiver: 0,
    mode: 'practice',
    format,
    // Red serves first; Blue's first serve (when it wins the serve) rotates to its slot 0.
    serveOrder: [format === '2v2' ? 1 : 0, 0],
    lastHitterId: null,
    score: [0, 0],
    winner: null,
    touches: 0,
  };
  return world;
}

/** A new world, set up for the first serve (Red serves to Blue). */
export function createMatch(t: Tuning, mode: Mode = 'practice', format: Format = '1v1'): World {
  const world = createWorld(format);
  world.mode = mode;
  setUpServe(world, t);
  return world;
}

/** Start over (optionally in a new mode or format): zero the score and set up the first serve (Red to Blue). */
export function restartGame(world: World, t: Tuning, mode: Mode = world.mode, format: Format = world.format): void {
  world.mode = mode;
  if (format !== world.format) {
    world.format = format;
    world.players = createPlayers(format);
  }
  world.serveOrder = [format === '2v2' ? 1 : 0, 0];
  world.score = [0, 0];
  world.winner = null;
  world.nextReceiver = 0;
  world.ball.alive = false;
  world.serve.faults = 0;
  setUpServe(world, t);
}

function scorePoint(world: World, team: Team, reason: PointReason, t: Tuning): void {
  world.score[team]++;
  world.events.push({ type: 'point', team, reason, loser: otherTeam(team) });
  const [a, b] = world.score;
  if (Math.max(a, b) >= t.match.pointsToWin && Math.abs(a - b) >= 2) {
    world.winner = a > b ? 0 : 1;
    world.events.push({ type: 'gameOver', winner: world.winner });
  }
}

/** Why the team in possession lost the rally when the ball landed (see PointReason). */
function rallyLossReason(world: World, t: Tuning): PointReason {
  const loser = world.possession;
  const theyTouchedIt = world.ball.lastTouch === 'player' && world.lastHitTeam === loser;
  if (!theyTouchedIt) return world.serve.returnPending ? 'ace' : 'notReached';
  if (world.lastHitKind === 'spike' || world.lastHitKind === 'drop') return 'missedNet';
  return world.mode === 'match' && world.touches >= t.match.maxTouches ? 'outOfTouches' : 'dropped';
}

/** The team that serves next. */
export function serverTeam(world: World): Team {
  return otherTeam(world.nextReceiver);
}

/** End the current rally now (e.g. a stuck ball) and set up the next serve. */
export function resetRally(world: World, t: Tuning): void {
  world.ball.alive = false;
  setUpServe(world, t);
}

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

/** Advance the world one fixed tick. `intents[i]` drives `players[i]`. */
export function stepWorld(world: World, intents: readonly Intent[], t: Tuning): void {
  world.tick++;
  world.events.length = 0;

  world.players.forEach((p, i) => {
    const intent = intents[i] ?? NEUTRAL_INTENT;
    // No serving once the game is over (waiting for a rematch).
    const serving = world.waitingForServe && world.winner === null && p.id === world.serve.serverId;
    // Read the wobble before stepping, so a release this tick uses where the aim was.
    const wobble = serving ? serveWobble(world, p, t) : null;
    // Aim (or, while charging, spin) from the stick before the release is processed.
    if (serving) stepServeAim(world, p, intent, t);
    const wasDiving = p.dive !== null;
    const swing = stepPlayer(p, serving ? serverIntent(intent) : intent, t);
    if (p.dive && !wasDiving) world.events.push({ type: 'dive', playerId: p.id });
    if (p.dive?.ticks === diveTicks(t)) world.events.push({ type: 'diveLand', playerId: p.id });
    if (!swing) return;
    // A server's swings never become rally hits (the toss, or a spike before the toss).
    if (serving) p.hitBuffer = null;
    // Serving, step 1: releasing a charged pass tosses the ball up.
    if (serving && !world.serve.tossed && swing.kind === 'pass') {
      tossServe(world, p, swing.power, t);
      world.events.push({ type: 'toss', playerId: p.id });
      return;
    }
    // Serving, step 2: releasing spike while the ball is up hits the serve.
    const serveHit = serving && world.serve.tossed && swing.kind === 'spike';
    if (serving && !serveHit) return;
    world.events.push({ type: 'swing', playerId: p.id, ...swing, spin: serving ? world.serve.spin : swing.spin });
    if (serveHit && wobble) {
      const quality = launchServe(world, p, swing.power, wobble, t);
      world.events.push({ type: 'serve', playerId: p.id, power: swing.power, spin: world.serve.spin, quality });
    }
  });
  separatePlayers(world, t);

  const turn = {
    possession: world.possession,
    touches: world.touches,
    maxTouches: world.mode === 'match' ? t.match.maxTouches : undefined,
    lastHitterId: world.lastHitterId,
    noDoubleTouch: world.format === '2v2',
  };
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
      if (p.team === world.possession) world.touches++;
      // The duel ends once the receiving side plays the ball.
      if (p.team !== world.lastHitTeam) world.serve.returnPending = false;
      world.lastHitTeam = p.team;
      world.lastHitterId = p.id;
      turn.lastHitterId = p.id;
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
      world.touches = 0;
      world.lastHitterId = null;
      world.serve.inFlight = false;
      world.serve.faults = 0;
      world.events.push({ type: 'possession', team: world.possession });
    } else if (e.type === 'ground') {
      if (world.serve.inFlight || world.serve.tossed) {
        // A serve that never reached the net, or a toss that was never hit: a
        // fault. Two in a row lose the serve, and in a match give the
        // receiver the point. Then the next serve is set up after a pause.
        world.serve.tossed = false;
        world.waitingForServe = false;
        const server = otherTeam(world.nextReceiver);
        const receiver = world.nextReceiver;
        const lost = faultServe(world, t);
        world.events.push({ type: 'fault', team: server, lost });
        if (lost && world.mode === 'match') scorePoint(world, receiver, 'doubleFault', t);
      } else {
        const reason = rallyLossReason(world, t);
        world.serve.returnPending = false;
        if (world.mode === 'match') {
          // The side that should have played it loses the rally; the winner serves.
          const loser = world.possession;
          scorePoint(world, otherTeam(loser), reason, t);
          setNextReceiver(world, loser);
        } else {
          // Practice: the serve alternates sides.
          setNextReceiver(world, otherTeam(world.nextReceiver));
        }
      }
    }
  }

  if (world.ball.alive) {
    world.deadTicks = 0;
  } else if (!world.waitingForServe && ++world.deadTicks >= t.practice.resetDelayTicks) {
    setUpServe(world, t);
  }
}

/**
 * Put a ball in play by feeding it off the net toward the receiving team's
 * player, who then has possession. A practice/test helper; real games start
 * rallies with the serve duel (serve.ts).
 */
export function feedBall(world: World, receiver: Team, t: Tuning): void {
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
  ball.soft = false;
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
