import type { Tuning } from '../config/tuning';
import { launchBallAt, netContactHeight, type Ball } from './ball';
import { stickOf, type HitKind, type Intent, type Player } from './player';
import { clamp, lerp } from './vec';

export interface HitResult {
  playerId: number;
  kind: HitKind;
  // 1 = perfectly timed, 0 = barely made contact.
  quality: number;
  // How charged the hit was, 0..1.
  power: number;
}

/**
 * Timing quality from how far the ball is above or below the player's ideal
 * contact height. Jumping to meet the ball at the right moment is the skill.
 */
export function hitQuality(heightError: number, t: Tuning): number {
  const extra = Math.abs(heightError) - t.hit.perfectWindow;
  return extra <= 0 ? 1 : clamp(1 - extra / t.hit.qualityFalloff, 0, 1);
}

/**
 * Roundnet rule: the ball is only playable once it comes off the net (or off a
 * player). Nobody may touch it on its way to the net.
 */
export function isPlayable(ball: Ball): boolean {
  return ball.alive && (ball.lastTouch === 'net' || ball.lastTouch === 'player');
}

export type MissReason =
  | 'cooldown'
  | 'noBall'
  | 'notYet'
  | 'notYourBall'
  | 'noTouchesLeft'
  | 'tooFar'
  | 'tooHigh'
  | 'tooLow';

/** Whose ball it is and how many touches they've used. Omitted = anyone may play. */
export interface Turn {
  possession: 0 | 1;
  touches: number;
}

export const MAX_TOUCHES = 3;

/** Why a swing right now would not connect, or null if it would. */
export function missReason(p: Player, ball: Ball, t: Tuning, turn?: Turn): MissReason | null {
  if (p.cooldown > 0) return 'cooldown';
  if (!ball.alive) return 'noBall';
  if (!isPlayable(ball)) return 'notYet';
  if (turn && turn.possession !== p.team) return 'notYourBall';
  if (turn && turn.touches >= MAX_TOUCHES) return 'noTouchesLeft';
  if (Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z) > t.player.reach) return 'tooFar';
  const heightError = ball.pos.y - (p.pos.y + t.player.contactHeight);
  if (heightError > t.player.highReach) return 'tooHigh';
  if (heightError < -t.player.lowReach) return 'tooLow';
  return null;
}

/** Hit the ball if the player has a buffered hit and the ball is in reach. */
export function tryHit(p: Player, ball: Ball, intent: Intent, t: Tuning, turn?: Turn): HitResult | null {
  if (!p.hitBuffer || missReason(p, ball, t, turn) !== null) return null;

  const heightError = ball.pos.y - (p.pos.y + t.player.contactHeight);
  const quality = hitQuality(heightError, t);
  const { kind, power } = p.hitBuffer;
  const aim = stickOf(intent);

  if (kind === 'spike') {
    spike(ball, aim, quality, power, t);
  } else {
    pass(ball, aim, quality, power, t);
  }

  p.hitBuffer = null;
  p.cooldown = t.hit.cooldownTicks;
  ball.lastTouch = 'player';
  return { playerId: p.id, kind, quality, power };
}

function spike(ball: Ball, aim: { x: number; z: number }, quality: number, power: number, t: Tuning): void {
  // The stick picks a point on the net; a bad hit drifts past it and can miss.
  const target = {
    x: aim.x * t.net.radius * t.hit.aimSpread,
    y: netContactHeight(t),
    z: aim.z * t.net.radius * t.hit.aimSpread,
  };
  const dx = target.x - ball.pos.x;
  const dz = target.z - ball.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-6) {
    const drift = (1 - quality) * t.hit.mishitDrift * t.net.radius;
    target.x += (dx / dist) * drift;
    target.z += (dz / dist) * drift;
  }
  const speed = lerp(t.hit.spikeSpeedMin, t.hit.spikeSpeedMax, power) * lerp(t.hit.minQualityPower, 1, quality);
  launchBallAt(ball, target, speed, t);
}

function pass(ball: Ball, aim: { x: number; z: number }, quality: number, power: number, t: Tuning): void {
  ball.vel.x = aim.x * t.hit.passHorizontalSpeed;
  ball.vel.z = aim.z * t.hit.passHorizontalSpeed;
  ball.vel.y = lerp(t.hit.passUpSpeedMin, t.hit.passUpSpeedMax, power) * lerp(0.75, 1, quality);
}
