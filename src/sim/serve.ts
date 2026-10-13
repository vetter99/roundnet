// The serve duel: the server stands at a fixed spot behind the serve line
// with the receiver opposite. Like real roundnet, the serve is a toss and a
// hit:
// 1. Aim: hold the stick toward where on the net to serve; the ball, held
//    out in the off paw, leans that way as a preview (no marker; the
//    receiver reads the paw).
// 2. Toss: hold pass to charge and release to toss: a tap goes a short way
//    up; a full charge goes higher and drifts further in the held direction
//    (changing where the serve is struck from). The aim locks.
// 3. Hit: hold spike to charge while it's in the air (sideways stick sets
//    spin: the arm cocks, then sweeps across; stick up / down sets topspin /
//    backspin), and release to hit. Timing is
//    like a rally hit: at the sweet spot (`serve.contactHeight`) it goes where
//    aimed at full power; hit early (ball high) it sails long, late (low) it
//    drops short and slower.
// More charge also wobbles the aim, so power costs accuracy. A serve that
// misses the net, or a toss that's never hit, is a fault; after
// `serve.tries` faults the serve is lost.

import type { Tuning } from '../config/tuning';
import { launchBallAt, netContactHeight, netOuterRadius } from './ball';
import { hitQuality } from './hit';
import { chargePower, stickOf, stickTopspin, type Intent, type Player } from './player';
import { clamp, lerp } from './vec';
import { otherTeam, serverTeam, teamPlayers, type Team, type World } from './world';

export interface ServeState {
  // Who serves and who receives this serve (player ids). In 2v2 the serve
  // goes to the opponent straight across; the partners stand to the sides.
  serverId: number;
  receiverId: number;
  // Where on the net the server is aiming (x, z; the net is centered at 0).
  aim: { x: number; z: number };
  // Sidespin chosen while charging, -1..1: positive curves to the server's
  // right (as they face the net), negative to their left.
  spin: number;
  // Topspin (positive, stick up) or backspin (negative, stick down), -1..1,
  // also set while charging.
  topspin: number;
  // The ball has been tossed and is in the air, waiting to be hit.
  tossed: boolean;
  // Faults on the current serve so far.
  faults: number;
  // A serve is in the air and hasn't reached the net yet.
  inFlight: boolean;
  // The serve duel is on until the receiving team touches the ball (or the
  // rally ends); the renderer keeps its duel camera for this long.
  returnPending: boolean;
}

export function createServeState(): ServeState {
  return { serverId: 1, receiverId: 0, aim: { x: 0, z: 0 }, spin: 0, topspin: 0, tossed: false, faults: 0, inFlight: false, returnPending: false };
}

/** Which side of the net (along z) a team serves from: Blue from -z, Red from +z. */
function sideOf(team: Team): number {
  return team === 0 ? -1 : 1;
}

/** The server's fixed spot, just behind the serve line. */
export function serverSpot(team: Team, t: Tuning): { x: number; z: number } {
  return { x: 0, z: sideOf(team) * (netOuterRadius(t) + t.court.serveLineDistance + t.serve.behindLine) };
}

/** Where the receiver starts: behind their serve line, opposite the server (then free to move). */
export function receiverSpot(team: Team, t: Tuning): { x: number; z: number } {
  return { x: 0, z: sideOf(team) * (netOuterRadius(t) + t.court.serveLineDistance + t.serve.receiverBack) };
}

/**
 * Where a server's or receiver's partner starts in 2v2: out to the side, so
 * the four players stand at the compass points around the net (the server's
 * partner on one side, the receiver's partner on the other).
 */
export function partnerSpot(serving: boolean, t: Tuning): { x: number; z: number } {
  const r = netOuterRadius(t) + t.court.serveLineDistance + t.serve.receiverBack;
  return { x: serving ? r : -r, z: 0 };
}

/**
 * Hand the serve to the other side, or keep it, so `receiver` receives next.
 * A team that wins the serve back rotates its server (in 2v2 the two
 * teammates take turns).
 */
export function setNextReceiver(world: World, receiver: Team): void {
  if (receiver === world.nextReceiver) return;
  world.nextReceiver = receiver;
  const servingTeam = otherTeam(receiver);
  world.serveOrder[servingTeam] = (world.serveOrder[servingTeam] + 1) % teamPlayers(world, servingTeam).length;
}

/** Get ready for a serve: pick and place server and receiver (and partners), reset the aim. */
export function setUpServe(world: World, t: Tuning): void {
  // Serve practice with a chosen server: they serve, to the player across from them.
  const practiced = world.mode === 'serves' ? world.players.find((p) => p.id === world.servePracticeId) : undefined;
  if (practiced) world.nextReceiver = otherTeam(practiced.team);
  const server = serverTeam(world);
  const servers = teamPlayers(world, server);
  const receivers = teamPlayers(world, world.nextReceiver);
  const slot = practiced ? servers.indexOf(practiced) : world.serveOrder[server] % servers.length;
  world.serve.serverId = servers[slot].id;
  world.serve.receiverId = receivers[slot % receivers.length].id;
  world.lastHitterId = null;
  world.waitingForServe = true;
  world.serveReadyTick = world.tick;
  world.serve.aim = { x: 0, z: 0 };
  world.serve.spin = 0;
  world.serve.topspin = 0;
  world.serve.tossed = false;
  world.serve.inFlight = false;
  world.serve.returnPending = false;
  world.returnTick = null;
  world.touches = 0;
  for (const p of world.players) {
    const spot =
      p.id === world.serve.serverId
        ? serverSpot(server, t)
        : p.id === world.serve.receiverId
          ? receiverSpot(p.team, t)
          : partnerSpot(p.team === server, t);
    p.pos = { x: spot.x, y: 0, z: spot.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grounded = true;
    p.charge = null;
    p.hitBuffer = null;
    p.dive = null;
  }
}

/** The server can't move while aiming: the stick steers the aim instead. */
export function serverIntent(intent: Intent): Intent {
  return { ...intent, moveX: 0, moveZ: 0, jump: false };
}

/** The server's right-hand direction as they face their aim (x, z). */
function serveSide(world: World, server: Player, t: Tuning): { x: number; z: number } {
  const spot = serverSpot(server.team, t);
  const dx = world.serve.aim.x - spot.x;
  const dz = world.serve.aim.z - spot.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: dz / d, z: -dx / d };
}

/**
 * Before the toss, the aim follows the stick (full stick = the edge of the
 * aim range; let go and it's the net center). After the toss the aim is
 * locked, and while charging the hit, the stick sets the spin (sideways:
 * sidespin; up / down: topspin / backspin). The
 * server stays on their spot.
 */
export function stepServeAim(world: World, server: Player, intent: Intent, t: Tuning): void {
  const stick = stickOf(intent);
  if (world.serve.tossed) {
    // Spin while charging; on the release tick the button is up, so keep the
    // spin from the last held tick.
    if (server.charge?.kind === 'spike' && intent.spike) {
      const side = serveSide(world, server, t);
      world.serve.spin = clamp(stick.x * side.x + stick.z * side.z, -1, 1);
      world.serve.topspin = stickTopspin(intent);
    }
  } else if (server.charge?.kind === 'pass' && !intent.pass) {
    // The toss is being released this tick: keep the aim from the last held
    // tick (the stick may have been let go at the same moment).
  } else {
    const limit = t.net.radius * t.serve.aimLimit;
    const r = Math.hypot(stick.x, stick.z);
    const scale = r > 1 ? limit / r : limit;
    world.serve.aim = { x: stick.x * scale, z: stick.z * scale };
    world.serve.spin = 0;
    world.serve.topspin = 0;
  }
  pinServer(server, t);
}

function pinServer(server: Player, t: Tuning): void {
  const spot = serverSpot(server.team, t);
  server.pos.x = spot.x;
  server.pos.z = spot.z;
}

/**
 * Where the server holds the ball before serving: out in front in their off
 * paw, slid toward the aim (sideways, and up for a deeper aim). The serve
 * leaves from here, and the renderer draws the ball here.
 */
export function serveHand(world: World, server: Player, t: Tuning): { x: number; y: number; z: number } {
  const spot = serverSpot(server.team, t);
  // The server faces the net straight on: forward is toward it, right is their right.
  const fz = -Math.sign(spot.z) || 1;
  const right = { x: fz, z: 0 };
  const limit = t.net.radius * t.serve.aimLimit || 1;
  const aim = world.serve.aim;
  const across = clamp((aim.x * right.x + aim.z * right.z) / limit, -1, 1);
  const deep = clamp((aim.z * fz) / limit, -1, 1);
  const lateral = -t.serve.handSide + across * t.serve.handReach;
  return {
    x: spot.x + right.x * lateral,
    y: t.serve.handHeight + deep * t.serve.handLift,
    z: spot.z + fz * t.serve.handForward + right.z * lateral,
  };
}

/** How far the aim is thrown off right now by the server's charge (wobbles more with power). */
export function serveWobble(world: World, server: Player, t: Tuning): { x: number; z: number } {
  if (server.charge?.kind !== 'spike') return { x: 0, z: 0 };
  const power = chargePower(server.charge.ticks, t);
  const amp = t.serve.wobble * power * power;
  return { x: Math.sin(world.tick * 0.31) * amp, z: Math.cos(world.tick * 0.23) * amp };
}

/** Toss the ball up out of the server's paw, higher and wider the more it was charged (0..1). */
export function tossServe(world: World, server: Player, power: number, t: Tuning): void {
  const ball = world.ball;
  ball.pos = serveHand(world, server, t);
  // Higher with more charge, drifting toward the aim (further with more charge).
  const p = clamp(power, 0, 1);
  const up = lerp(t.serve.tossSpeedMin, t.serve.tossSpeedMax, p);
  const drift = lerp(t.serve.tossDriftMin, t.serve.tossDriftMax, p);
  const limit = t.net.radius * t.serve.aimLimit || 1;
  ball.vel = { x: (world.serve.aim.x / limit) * drift, y: up, z: (world.serve.aim.z / limit) * drift };
  ball.alive = true;
  ball.soft = false;
  ball.curve = undefined;
  ball.topspin = undefined;
  // Nobody can play it until it comes off the net.
  ball.lastTouch = 'feed';
  world.serve.tossed = true;
}

/**
 * Hit the tossed ball at the aim (plus the wobble at release), faster the
 * more it was charged. Returns the timing quality (0..1): mistimed hits go
 * long (early, ball high) or short (late, ball low), and slower.
 */
export function launchServe(world: World, server: Player, power: number, wobble: { x: number; z: number }, t: Tuning): number {
  const ball = world.ball;
  const heightError = ball.pos.y - t.serve.contactHeight;
  const quality = hitQuality(heightError, t);
  const spot = serverSpot(server.team, t);
  const toNet = -Math.sign(spot.z) || 1;
  const long = Math.sign(heightError) * (1 - quality) * t.serve.mistimeDrift;
  ball.curve = undefined;
  // Topspin dips, backspin floats; set before launching so the arc allows for it.
  ball.topspin = world.serve.topspin !== 0 ? world.serve.topspin : undefined;
  const target = { x: world.serve.aim.x + wobble.x, y: netContactHeight(t), z: world.serve.aim.z + wobble.z + toNet * long };
  const speed = lerp(t.serve.speedMin, t.serve.speedMax, clamp(power, 0, 1)) * lerp(t.hit.minQualityPower, 1, quality);
  launchBallAt(ball, target, speed, t);
  // Spin from the arm's sweep: a steady sideways pull for the whole flight.
  if (world.serve.spin !== 0) {
    const side = serveSide(world, server, t);
    const pull = world.serve.spin * t.serve.spinCurve;
    ball.curve = { x: side.x * pull, z: side.z * pull };
  }

  world.lastHitTeam = server.team;
  world.lastHitKind = null;
  world.lastHitPower = power;
  world.possession = server.team;
  world.possessionTick = world.tick;
  world.deadTicks = 0;
  world.waitingForServe = false;
  world.serve.tossed = false;
  world.serve.inFlight = true;
  world.serve.returnPending = true;
  return quality;
}

/**
 * A serve that lands before reaching the net is a fault. Returns true if the
 * serve is lost (out of tries), in which case the serve passes to the other
 * side; otherwise the same server serves again.
 */
export function faultServe(world: World, t: Tuning): boolean {
  world.serve.inFlight = false;
  world.serve.returnPending = false;
  world.serve.faults++;
  if (world.serve.faults < t.serve.tries) return false;
  world.serve.faults = 0;
  setNextReceiver(world, otherTeam(world.nextReceiver));
  return true;
}
