import type { Tuning } from '../config/tuning';
import { netOuterRadius } from './ball';
import { DT } from './time';
import { clamp, type Vec3 } from './vec';

/** The hit buttons. */
export type HitKind = 'spike' | 'pass';
/** The shot that results: a spike released with almost no charge is a drop shot. */
export type ShotKind = HitKind | 'drop';

/**
 * What a player wants to do this tick. Input devices and bots both produce
 * Intents; the sim never knows which one it came from.
 */
export interface Intent {
  // Movement / aim stick, each in [-1, 1]. +z is away from the camera.
  moveX: number;
  moveZ: number;
  // Jump is a press this tick (an edge).
  jump: boolean;
  // Spike and pass are held state: holding charges the hit, releasing swings.
  spike: boolean;
  pass: boolean;
}

export const NEUTRAL_INTENT: Intent = { moveX: 0, moveZ: 0, jump: false, spike: false, pass: false };

export interface Player {
  id: number;
  team: 0 | 1;
  // pos.y is the height of the feet (0 when standing).
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  // A hit button being held down, charging up power. `spin` (-1..1) is the
  // sidespin a spike will have, from the stick while charging (see stepHitButtons).
  charge: { kind: HitKind; ticks: number; spin: number } | null;
  // A released swing that fires as soon as the ball is in reach. The world
  // turns it into a 'whiff' event when ticksLeft runs out. Power is 0..1.
  hitBuffer: { kind: HitKind; ticksLeft: number; power: number; spin: number } | null;
  cooldown: number;
  // An active dive: a short lunge (where you can still pass or spike with
  // extra reach), then lying on the ground recovering. `ticks` counts up from 0.
  // Dives start automatically (see autoDiveTarget in hit.ts), not from a button.
  dive: { ticks: number; dirX: number; dirZ: number } | null;
}

export function createPlayer(id: number, team: 0 | 1, x: number, z: number): Player {
  return {
    id,
    team,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    charge: null,
    hitBuffer: null,
    cooldown: 0,
    dive: null,
  };
}

export function diveTicks(t: Tuning): number {
  return Math.round(t.player.dive.duration / DT);
}

export function diveRecoveryTicks(t: Tuning): number {
  return Math.round(t.player.dive.recovery / DT);
}

/** Lunging through the air in a dive (can still hit, with extra reach). */
export function isDiving(p: Player, t: Tuning): boolean {
  return p.dive !== null && p.dive.ticks < diveTicks(t);
}

/** Down on the ground after a dive: can't move, jump or hit. */
export function isRecovering(p: Player, t: Tuning): boolean {
  return p.dive !== null && p.dive.ticks >= diveTicks(t);
}

/** Stick input clamped to unit length. */
export function stickOf(intent: Intent): { x: number; z: number } {
  const len = Math.hypot(intent.moveX, intent.moveZ);
  return len > 1 ? { x: intent.moveX / len, z: intent.moveZ / len } : { x: intent.moveX, z: intent.moveZ };
}

/** Charge power 0..1 after holding a hit button for `ticks`. */
export function chargePower(ticks: number, t: Tuning): number {
  return clamp((ticks * DT) / t.hit.chargeTime, 0, 1);
}

export interface Swing {
  kind: HitKind;
  power: number;
  // Sidespin, -1..1: positive curves to the hitter's right as they face the net.
  spin: number;
}

/** Advance a player one tick. Returns the swing released this tick, if any. */
export function stepPlayer(p: Player, intent: Intent, t: Tuning): Swing | null {
  const stick = stickOf(intent);
  const moving = stick.x !== 0 || stick.z !== 0;

  if (p.dive) return stepDive(p, intent, t);

  // Accelerate horizontal velocity toward the stick's target velocity.
  // Charging a hit slows you down: power costs mobility.
  const topSpeed = t.player.maxSpeed * (p.charge ? t.hit.chargeMoveFactor : 1);
  const targetX = stick.x * topSpeed;
  const targetZ = stick.z * topSpeed;
  const control = p.grounded ? 1 : t.player.airControl;
  const maxDelta = (moving ? t.player.accel : t.player.decel) * control * DT;
  const dx = targetX - p.vel.x;
  const dz = targetZ - p.vel.z;
  const dlen = Math.hypot(dx, dz);
  if (dlen <= maxDelta) {
    p.vel.x = targetX;
    p.vel.z = targetZ;
  } else {
    p.vel.x += (dx / dlen) * maxDelta;
    p.vel.z += (dz / dlen) * maxDelta;
  }
  p.pos.x += p.vel.x * DT;
  p.pos.z += p.vel.z * DT;

  if (intent.jump && p.grounded) {
    p.vel.y = t.player.jumpSpeed;
    p.grounded = false;
  }
  if (!p.grounded) {
    p.vel.y -= t.gravity * DT;
    p.pos.y += p.vel.y * DT;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.grounded = true;
    }
  }

  keepOutOfNet(p, t);
  return stepHitButtons(p, intent, t);
}

/** Start a dive in direction (dx, dz). */
export function startDive(p: Player, dx: number, dz: number): void {
  const len = Math.hypot(dx, dz) || 1;
  p.dive = { ticks: 0, dirX: dx / len, dirZ: dz / len };
}

function stepDive(p: Player, intent: Intent, t: Tuning): Swing | null {
  const dive = p.dive!;
  const lunge = diveTicks(t);
  if (dive.ticks < lunge) {
    // The lunge slows down as you reach the ground.
    const speed = t.player.dive.speed * (1 - 0.6 * (dive.ticks / lunge));
    p.vel.x = dive.dirX * speed;
    p.vel.z = dive.dirZ * speed;
  } else {
    p.vel.x = 0;
    p.vel.z = 0;
    // Lying on the ground: any charge is dropped and new presses are ignored.
    p.charge = null;
  }
  p.pos.x += p.vel.x * DT;
  p.pos.z += p.vel.z * DT;
  keepOutOfNet(p, t);

  const swing = dive.ticks < lunge ? stepHitButtons(p, intent, t) : tickTimers(p);
  // A pass or spike released mid-lunge stays ready for the rest of the lunge,
  // so it connects as soon as the ball comes into the dive's reach.
  if (p.hitBuffer && dive.ticks < lunge) p.hitBuffer.ticksLeft = Math.max(p.hitBuffer.ticksLeft, lunge - dive.ticks);
  if (++dive.ticks >= lunge + diveRecoveryTicks(t)) p.dive = null;
  return swing;
}

function tickTimers(p: Player): null {
  if (p.cooldown > 0) p.cooldown--;
  if (p.hitBuffer) p.hitBuffer.ticksLeft--;
  return null;
}

/**
 * The spin a spike gets from the stick: its sideways part, across the line
 * from the player to the net (the net is at the origin). Positive is the
 * player's right as they face the net.
 */
export function spikeSpin(p: Player, intent: Intent): number {
  const d = Math.hypot(p.pos.x, p.pos.z);
  if (d < 1e-6) return 0;
  // Facing the net, (-x, -z)/d; the right-hand side is (-z, x)/d.
  const stick = stickOf(intent);
  return clamp((stick.x * -p.pos.z + stick.z * p.pos.x) / d, -1, 1);
}

/** Hold a hit button to charge; letting go (or switching buttons) releases the swing. */
function stepHitButtons(p: Player, intent: Intent, t: Tuning): Swing | null {
  tickTimers(p);

  const held: HitKind | null = intent.spike ? 'spike' : intent.pass ? 'pass' : null;
  if (p.charge && held === p.charge.kind) {
    p.charge.ticks++;
    // Spin for a spike: the stick across the line from the player to the net.
    if (held === 'spike') p.charge.spin = spikeSpin(p, intent);
    return null;
  }
  let swing: Swing | null = null;
  if (p.charge) {
    swing = { kind: p.charge.kind, power: chargePower(p.charge.ticks, t), spin: p.charge.spin };
    p.hitBuffer = { ...swing, ticksLeft: t.hit.inputBufferTicks };
    p.charge = null;
  }
  if (held) p.charge = { kind: held, ticks: 0, spin: 0 };
  return swing;
}

/** Players can't stand on or inside the net. */
function keepOutOfNet(p: Player, t: Tuning): void {
  const minDist = netOuterRadius(t) + t.player.radius;
  const d = Math.hypot(p.pos.x, p.pos.z);
  if (d < minDist) {
    const nx = d > 1e-6 ? p.pos.x / d : 0;
    const nz = d > 1e-6 ? p.pos.z / d : -1;
    p.pos.x = nx * minDist;
    p.pos.z = nz * minDist;
  }
}
