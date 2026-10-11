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
import { otherTeam, serverTeam, type Team, type World } from './world';

export interface ServeState {
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
  return { aim: { x: 0, z: 0 }, spin: 0, faults: 0, inFlight: false, returnPending: false };
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

/** Get ready for a serve: place server and receiver, reset the aim. */
export function setUpServe(world: World, t: Tuning): void {
  const server = serverTeam(world);
  world.waitingForServe = true;
  world.serveReadyTick = world.tick;
  world.serve.aim = { x: 0, z: 0 };
  world.serve.spin = 0;
  world.serve.inFlight = false;
  world.serve.returnPending = false;
  world.touches = 0;
  for (const p of world.players) {
    const spot = p.team === server ? serverSpot(server, t) : receiverSpot(p.team, t);
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

/** How far the aim is thrown off right now by the server's charge (wobbles more with power). */
export function serveWobble(world: World, server: Player, t: Tuning): { x: number; z: number } {
  if (!server.charge) return { x: 0, z: 0 };
  const power = chargePower(server.charge.ticks, t);
  const amp = t.serve.wobble * power * power;
  return { x: Math.sin(world.tick * 0.31) * amp, z: Math.cos(world.tick * 0.23) * amp };
}

/** Serve at the aim (plus the wobble at release), faster the more it was charged. */
export function launchServe(world: World, server: Player, power: number, wobble: { x: number; z: number }, t: Tuning): void {
  const spot = serverSpot(server.team, t);
  const toNet = -Math.sign(spot.z) || 1;
  const ball = world.ball;
  ball.pos = { x: spot.x, y: t.serve.handHeight, z: spot.z + toNet * 0.35 };
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
  world.nextReceiver = otherTeam(world.nextReceiver);
  return true;
}
