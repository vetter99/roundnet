// The serve duel: the server stands at a fixed spot behind the serve line
// with the receiver opposite. The server aims at a spot on the net with the
// stick (shown only by their body turning, never a marker), then holds a hit
// button to charge. While charging, the stick sets spin instead: the arm
// cocks to one side, and on release it sweeps across the ball and the serve
// curves that way. The harder the charge, the more the aim wobbles, so power
// costs accuracy. A serve that misses the net is a fault; after `serve.tries`
// faults the serve is lost.

import type { Tuning } from '../config/tuning';
import { launchBallAt, netContactHeight, netOuterRadius } from './ball';
import { chargePower, stickOf, type Intent, type Player } from './player';
import { DT } from './time';
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
  // Faults on the current serve so far.
  faults: number;
  // A serve is in the air and hasn't reached the net yet.
  inFlight: boolean;
  // The serve duel is on until the receiving team touches the ball (or the
  // rally ends); the renderer keeps its duel camera for this long.
  returnPending: boolean;
}

export function createServeState(): ServeState {
  return { serverId: 1, receiverId: 0, aim: { x: 0, z: 0 }, spin: 0, faults: 0, inFlight: false, returnPending: false };
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
  const server = serverTeam(world);
  const servers = teamPlayers(world, server);
  const receivers = teamPlayers(world, world.nextReceiver);
  const slot = world.serveOrder[server] % servers.length;
  world.serve.serverId = servers[slot].id;
  world.serve.receiverId = receivers[slot % receivers.length].id;
  world.lastHitterId = null;
  world.waitingForServe = true;
  world.serveReadyTick = world.tick;
  world.serve.aim = { x: 0, z: 0 };
  world.serve.spin = 0;
  world.serve.inFlight = false;
  world.serve.returnPending = false;
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
 * Before charging, the stick moves the aim. While charging (the aim is
 * locked), sideways stick sets the spin. The server stays on their spot.
 */
export function stepServeAim(world: World, server: Player, intent: Intent, t: Tuning): void {
  const stick = stickOf(intent);
  if (server.charge) {
    // On the release tick the button is up: keep the spin from the last held tick.
    if (!intent.pass && !intent.spike) return pinServer(server, t);
    const side = serveSide(world, server, t);
    world.serve.spin = clamp(stick.x * side.x + stick.z * side.z, -1, 1);
  } else {
    const aim = world.serve.aim;
    aim.x += stick.x * t.serve.aimSpeed * DT;
    aim.z += stick.z * t.serve.aimSpeed * DT;
    const limit = t.net.radius * t.serve.aimLimit;
    const r = Math.hypot(aim.x, aim.z);
    if (r > limit) {
      aim.x *= limit / r;
      aim.z *= limit / r;
    }
    world.serve.spin = 0;
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
  if (!server.charge) return { x: 0, z: 0 };
  const power = chargePower(server.charge.ticks, t);
  const amp = t.serve.wobble * power * power;
  return { x: Math.sin(world.tick * 0.31) * amp, z: Math.cos(world.tick * 0.23) * amp };
}

/** Serve at the aim (plus the wobble at release), faster the more it was charged. */
export function launchServe(world: World, server: Player, power: number, wobble: { x: number; z: number }, t: Tuning): void {
  const ball = world.ball;
  ball.pos = serveHand(world, server, t);
  ball.alive = true;
  ball.soft = false;
  ball.curve = undefined;
  // Like the old feed: unplayable until it comes off the net.
  ball.lastTouch = 'feed';
  const target = { x: world.serve.aim.x + wobble.x, y: netContactHeight(t), z: world.serve.aim.z + wobble.z };
  launchBallAt(ball, target, lerp(t.serve.speedMin, t.serve.speedMax, clamp(power, 0, 1)), t);
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
  world.serve.inFlight = true;
  world.serve.returnPending = true;
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
