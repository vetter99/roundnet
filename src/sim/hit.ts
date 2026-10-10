import type { Tuning } from '../config/tuning';
import { cloneBall, launchBallAt, netContactHeight, stepBall, type Ball, type BallEvent } from './ball';
import { isDiving, isRecovering, stickOf, type HitKind, type Intent, type Player } from './player';
import { clamp, lerp, type Vec3 } from './vec';

export interface HitResult {
  playerId: number;
  kind: HitKind;
  // 1 = perfectly timed, 0 = barely made contact.
  quality: number;
  // How charged the hit was, 0..1.
  power: number;
  // Ball height minus the ideal contact height at contact (m): + high, - low.
  heightError: number;
  // Ball speed right after the hit (m/s).
  launchSpeed: number;
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

export interface DescentPrediction {
  // Where the ball will be, and how many ticks from now (0 = already there).
  point: Vec3;
  ticks: number;
}

/**
 * When and where a playable ball will next be falling at or below `height`
 * (e.g. a player's contact height). Looks through net bounces. Null if it
 * lands first or never becomes playable.
 */
export function predictDescentTo(current: Ball, height: number, t: Tuning, maxTicks = 180): DescentPrediction | null {
  const ball = cloneBall(current);
  const events: BallEvent[] = [];
  for (let tick = 0; tick < maxTicks && ball.alive; tick++) {
    if (isPlayable(ball) && ball.vel.y < 0 && ball.pos.y <= height) return { point: ball.pos, ticks: tick };
    events.length = 0;
    stepBall(ball, t, events);
  }
  return null;
}

export type MissReason =
  | 'cooldown'
  | 'recovering'
  | 'noBall'
  | 'notYet'
  | 'notYourBall'
  | 'tooFar'
  | 'tooHigh'
  | 'tooLow';

/** Whose ball it is. Omitted = anyone may play. */
export interface Turn {
  possession: 0 | 1;
}

/** Horizontal reach right now: longer while lunging in a dive. */
export function reachOf(p: Player, t: Tuning): number {
  return t.player.reach + (isDiving(p, t) ? t.player.dive.reachBonus : 0);
}

/** Where reach is measured from: the feet, or the outstretched paws mid-dive. */
export function reachCenterOf(p: Player, t: Tuning): { x: number; z: number } {
  if (!isDiving(p, t) || !p.dive) return { x: p.pos.x, z: p.pos.z };
  const ahead = t.player.dive.reachOffset;
  return { x: p.pos.x + p.dive.dirX * ahead, z: p.pos.z + p.dive.dirZ * ahead };
}

/** How far above the ideal contact height a ball can still be hit. */
function highReachOf(p: Player, t: Tuning): number {
  return isDiving(p, t) ? t.player.dive.highReach : t.player.highReach;
}

/** Ideal contact height above the feet right now: low while diving. */
export function contactHeightOf(p: Player, t: Tuning): number {
  return isDiving(p, t) ? t.player.dive.contactHeight : t.player.contactHeight;
}

// How far ahead (ticks) to look for where the ball will be when choosing a dive direction.
const DIVE_AIM_TICKS = 10;

/**
 * Automatic dives (like Mario Tennis 64): if a player has released a hit but
 * the ball is just out of reach, and it won't come into reach on its own
 * before the swing expires, return where to dive (the ball's position a moment
 * from now). Null means don't dive: the ball is reachable anyway, too far, too
 * high, or not this player's to play.
 */
export function autoDiveTarget(p: Player, ball: Ball, t: Tuning, turn?: Turn): Vec3 | null {
  if (!p.hitBuffer || p.dive || !p.grounded) return null;
  if (missReason(p, ball, t, turn) !== 'tooFar') return null;

  const sim = cloneBall(ball);
  const events: BallEvent[] = [];
  let aim: Vec3 | null = null;
  const lookTicks = Math.max(p.hitBuffer.ticksLeft, DIVE_AIM_TICKS);
  for (let tick = 1; tick <= lookTicks && sim.alive; tick++) {
    events.length = 0;
    stepBall(sim, t, events);
    // If it drifts into standing reach before the swing expires, no need to dive.
    if (tick <= p.hitBuffer.ticksLeft && missReason(p, sim, t, turn) === null) return null;
    if (tick === DIVE_AIM_TICKS) aim = { ...sim.pos };
  }
  aim ??= { ...sim.pos };

  const distance = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z);
  if (distance > t.player.reach + t.player.dive.autoRange) return null;
  if (aim.y > p.pos.y + t.player.dive.contactHeight + t.player.dive.highReach) return null;
  return aim;
}

/** Why a swing right now would not connect, or null if it would. */
export function missReason(p: Player, ball: Ball, t: Tuning, turn?: Turn): MissReason | null {
  if (p.cooldown > 0) return 'cooldown';
  if (isRecovering(p, t)) return 'recovering';
  if (!ball.alive) return 'noBall';
  if (!isPlayable(ball)) return 'notYet';
  if (turn && turn.possession !== p.team) return 'notYourBall';
  const from = reachCenterOf(p, t);
  if (Math.hypot(ball.pos.x - from.x, ball.pos.z - from.z) > reachOf(p, t)) return 'tooFar';
  const heightError = ball.pos.y - (p.pos.y + contactHeightOf(p, t));
  if (heightError > highReachOf(p, t)) return 'tooHigh';
  if (heightError < -t.player.lowReach) return 'tooLow';
  return null;
}

/** Hit the ball if the player has a buffered hit and the ball is in reach. */
export function tryHit(p: Player, ball: Ball, intent: Intent, t: Tuning, turn?: Turn): HitResult | null {
  if (!p.hitBuffer || missReason(p, ball, t, turn) !== null) return null;

  const heightError = ball.pos.y - (p.pos.y + contactHeightOf(p, t));
  const quality = hitQuality(heightError, t);
  const { kind } = p.hitBuffer;
  // Dive hits are saves, not attacks.
  const power = p.hitBuffer.power * (isDiving(p, t) ? t.player.dive.powerScale : 1);
  const aim = stickOf(intent);

  if (kind === 'spike') {
    spike(ball, quality, power, t);
  } else {
    pass(ball, aim, quality, power, t);
  }

  p.hitBuffer = null;
  p.cooldown = t.hit.cooldownTicks;
  ball.lastTouch = 'player';
  const launchSpeed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  return { playerId: p.id, kind, quality, power, heightError, launchSpeed };
}

function spike(ball: Ball, quality: number, power: number, t: Tuning): void {
  // Spikes always go at the center of the net (the stick only aims passes).
  // A badly timed spike drifts past the center along its path and can miss.
  const target = { x: 0, y: netContactHeight(t), z: 0 };
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
