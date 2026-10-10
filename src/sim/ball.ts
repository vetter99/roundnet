import type { Tuning } from '../config/tuning';
import { DT } from './time';
import { copyVec3, type Vec3 } from './vec';

export type Touch = 'none' | 'feed' | 'player' | 'net' | 'rim';

export interface Ball {
  pos: Vec3;
  vel: Vec3;
  // False once the ball touches the ground; it stops moving until re-served.
  alive: boolean;
  lastTouch: Touch;
}

export type BallEvent =
  | { type: 'net'; at: Vec3; speed: number }
  | { type: 'rim'; at: Vec3 }
  | { type: 'ground'; at: Vec3 };

export function createBall(): Ball {
  return { pos: { x: 0, y: 2, z: 0 }, vel: { x: 0, y: 0, z: 0 }, alive: false, lastTouch: 'none' };
}

export function cloneBall(b: Ball): Ball {
  return { pos: copyVec3(b.pos), vel: copyVec3(b.vel), alive: b.alive, lastTouch: b.lastTouch };
}

// Height of the ball's center when it rests on the net surface.
export function netContactHeight(t: Tuning): number {
  return t.net.height + t.ball.radius;
}

/** Advance the ball one tick, appending any contacts to `events`. */
export function stepBall(ball: Ball, t: Tuning, events: BallEvent[]): void {
  if (!ball.alive) return;
  const dt = DT / t.sim.substeps;
  for (let i = 0; i < t.sim.substeps && ball.alive; i++) {
    stepBallOnce(ball, dt, t, events);
  }
}

function stepBallOnce(ball: Ball, dt: number, t: Tuning, events: BallEvent[]): void {
  const { pos, vel } = ball;
  const prevY = pos.y;

  const drag = Math.max(0, 1 - t.ball.airDrag * dt);
  vel.x *= drag;
  vel.y *= drag;
  vel.z *= drag;
  vel.y -= t.gravity * dt;

  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  const r = t.ball.radius;
  const surface = netContactHeight(t);
  const outer = t.net.radius + t.net.rimWidth + r;
  const d = Math.hypot(pos.x, pos.z);

  // Coming down onto the net from above.
  if (vel.y < 0 && prevY >= surface && pos.y < surface && d <= outer) {
    pos.y = surface;
    if (d <= t.net.radius) {
      netBounce(ball, t, events);
    } else {
      rimHit(ball, d, t, events, true);
    }
    return;
  }

  // Clipping the side of the frame from below the surface.
  if (pos.y < surface && d < outer) {
    rimHit(ball, d, t, events, false);
  }

  if (pos.y <= r) {
    pos.y = r;
    vel.x = vel.y = vel.z = 0;
    ball.alive = false;
    events.push({ type: 'ground', at: copyVec3(pos) });
  }
}

function netBounce(ball: Ball, t: Tuning, events: BallEvent[]): void {
  const { vel } = ball;
  const inSpeed = -vel.y;
  vel.y = Math.max(inSpeed * t.net.bounce, t.net.minUpSpeed);
  vel.x *= t.net.horizontalKeep;
  vel.z *= t.net.horizontalKeep;
  ball.lastTouch = 'net';
  events.push({ type: 'net', at: copyVec3(ball.pos), speed: inSpeed });
}

function rimHit(ball: Ball, d: number, t: Tuning, events: BallEvent[], fromAbove: boolean): void {
  const { pos, vel } = ball;
  // Outward direction from net center (pick one arbitrarily if dead center).
  const nx = d > 1e-6 ? pos.x / d : 0;
  const nz = d > 1e-6 ? pos.z / d : 1;

  if (fromAbove) {
    vel.y = Math.abs(vel.y) * t.net.rimBounce;
  } else {
    // Pushed back outside the frame.
    const outer = t.net.radius + t.net.rimWidth + t.ball.radius;
    pos.x = nx * outer;
    pos.z = nz * outer;
  }

  // Reflect the radial velocity so the ball always deflects away from the net.
  const radial = vel.x * nx + vel.z * nz;
  const outward = Math.max(Math.abs(radial) * 0.6, 1.5);
  vel.x += (outward - radial) * nx;
  vel.z += (outward - radial) * nz;

  ball.lastTouch = 'rim';
  events.push({ type: 'rim', at: copyVec3(pos) });
}

/**
 * Set the ball's velocity so its center reaches `target` with the given
 * horizontal speed (ignoring air drag, which is small).
 */
export function launchBallAt(ball: Ball, target: Vec3, horizontalSpeed: number, t: Tuning): void {
  const dx = target.x - ball.pos.x;
  const dz = target.z - ball.pos.z;
  const dist = Math.hypot(dx, dz);
  const time = Math.max(dist / Math.max(horizontalSpeed, 0.01), t.hit.minFlightTime);
  ball.vel.x = dx / time;
  ball.vel.z = dz / time;
  ball.vel.y = (target.y - ball.pos.y + 0.5 * t.gravity * time * time) / time;
}

export interface LandingPrediction {
  point: Vec3;
  ticks: number;
  // True if the ball touches the net or rim before landing.
  viaNet: boolean;
}

/** Run a copy of the ball forward to find where it will hit the ground. */
export function predictLanding(ball: Ball, t: Tuning, maxTicks = 600): LandingPrediction | null {
  if (!ball.alive) return null;
  const sim = cloneBall(ball);
  const events: BallEvent[] = [];
  let viaNet = false;
  for (let tick = 1; tick <= maxTicks; tick++) {
    events.length = 0;
    stepBall(sim, t, events);
    for (const e of events) {
      if (e.type === 'ground') return { point: e.at, ticks: tick, viaNet };
      viaNet = true;
    }
  }
  return null;
}
