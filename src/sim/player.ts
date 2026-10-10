import type { Tuning } from '../config/tuning';
import { DT } from './time';
import type { Vec3 } from './vec';

export type HitKind = 'spike' | 'pass';

/**
 * What a player wants to do this tick. Input devices and bots both produce
 * Intents; the sim never knows which one it came from.
 */
export interface Intent {
  // Movement / aim stick, each in [-1, 1]. +z is away from the camera.
  moveX: number;
  moveZ: number;
  // Button presses this tick (edges, not holds).
  jump: boolean;
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
  // A recently pressed hit that fires as soon as the ball is in reach. The
  // world turns it into a 'whiff' event when ticksLeft runs out.
  hitBuffer: { kind: HitKind; ticksLeft: number } | null;
  cooldown: number;
}

export function createPlayer(id: number, team: 0 | 1, x: number, z: number): Player {
  return {
    id,
    team,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    hitBuffer: null,
    cooldown: 0,
  };
}

/** Stick input clamped to unit length. */
export function stickOf(intent: Intent): { x: number; z: number } {
  const len = Math.hypot(intent.moveX, intent.moveZ);
  return len > 1 ? { x: intent.moveX / len, z: intent.moveZ / len } : { x: intent.moveX, z: intent.moveZ };
}

export function stepPlayer(p: Player, intent: Intent, t: Tuning): void {
  const stick = stickOf(intent);
  const moving = stick.x !== 0 || stick.z !== 0;

  // Accelerate horizontal velocity toward the stick's target velocity.
  const targetX = stick.x * t.player.maxSpeed;
  const targetZ = stick.z * t.player.maxSpeed;
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

  // Players can't stand on or inside the net.
  const minDist = t.net.radius + t.net.rimWidth + t.player.radius;
  const d = Math.hypot(p.pos.x, p.pos.z);
  if (d < minDist) {
    const nx = d > 1e-6 ? p.pos.x / d : 0;
    const nz = d > 1e-6 ? p.pos.z / d : -1;
    p.pos.x = nx * minDist;
    p.pos.z = nz * minDist;
  }

  if (intent.spike) {
    p.hitBuffer = { kind: 'spike', ticksLeft: t.hit.inputBufferTicks };
  } else if (intent.pass) {
    p.hitBuffer = { kind: 'pass', ticksLeft: t.hit.inputBufferTicks };
  } else if (p.hitBuffer) {
    p.hitBuffer.ticksLeft--;
  }
  if (p.cooldown > 0) p.cooldown--;
}
