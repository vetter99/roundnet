import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { launchBallAt, netContactHeight, predictLanding, stepBall, type Ball, type BallEvent } from './ball';

const t = createTuning();

function ballAt(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Ball {
  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, alive: true, lastTouch: 'feed' };
}

/** Step until the first event (or give up), returning it. */
function firstEvent(ball: Ball, maxTicks = 600): BallEvent | undefined {
  const events: BallEvent[] = [];
  for (let i = 0; i < maxTicks && events.length === 0; i++) stepBall(ball, t, events);
  return events[0];
}

describe('ball vs net', () => {
  it('bounces up off the middle of the net', () => {
    const ball = ballAt(0, 2, 0);
    expect(firstEvent(ball)?.type).toBe('net');
    expect(ball.vel.y).toBeGreaterThan(0);
    expect(ball.lastTouch).toBe('net');
  });

  it('keeps horizontal direction so the ball skips across the net', () => {
    const ball = ballAt(-1.5, 1.6, 0);
    launchBallAt(ball, { x: 0, y: netContactHeight(t), z: 0 }, 10, t);
    firstEvent(ball);
    expect(ball.vel.x).toBeGreaterThan(0);
    expect(ball.vel.y).toBeGreaterThan(0);
  });

  it('a flat hit skips off low and fast; a steep one pops up high and slow', () => {
    // Same speed into the net center, from far out (flat) and from high up (steep).
    const flat = ballAt(-3, 0.9, 0);
    launchBallAt(flat, { x: 0, y: netContactHeight(t), z: 0 }, 12, t);
    const steep = ballAt(-0.9, 2.6, 0);
    launchBallAt(steep, { x: 0, y: netContactHeight(t), z: 0 }, 12, t);
    const flatHit = firstEvent(flat);
    const steepHit = firstEvent(steep);
    expect(flatHit?.type === 'net' && steepHit?.type === 'net').toBe(true);
    if (flatHit?.type !== 'net' || steepHit?.type !== 'net') return;
    expect(flatHit.steepness).toBeLessThan(steepHit.steepness);
    expect(flat.vel.y).toBeLessThan(steep.vel.y);
    expect(Math.abs(flat.vel.x)).toBeGreaterThan(Math.abs(steep.vel.x));
  });

  it('treats the frame as part of the net (no rim faults)', () => {
    const frameCenter = t.net.radius + t.net.frameWidth / 2;
    const ball = ballAt(frameCenter, 2, 0);
    expect(firstEvent(ball)?.type).toBe('net');
    expect(ball.vel.y).toBeGreaterThan(0);
  });

  it('lands on the ground away from the net', () => {
    const ball = ballAt(3, 2, 0);
    expect(firstEvent(ball)?.type).toBe('ground');
    expect(ball.alive).toBe(false);
  });

  it('does not tunnel through the net on a very fast spike', () => {
    const ball = ballAt(0, 2.5, -2);
    launchBallAt(ball, { x: 0, y: netContactHeight(t), z: 0 }, 30, t);
    expect(firstEvent(ball)?.type).toBe('net');
  });
});

describe('launchBallAt', () => {
  it('hits the targeted point on the net', () => {
    const ball = ballAt(0.3, 1.7, -2.5);
    const target = { x: 0.2, y: netContactHeight(t), z: -0.1 };
    launchBallAt(ball, target, 11, t);
    const e = firstEvent(ball);
    expect(e?.type).toBe('net');
    expect(Math.hypot(e!.at.x - target.x, e!.at.z - target.z)).toBeLessThan(0.05);
  });
});

describe('predictLanding', () => {
  it('matches where the ball actually lands, including net bounces', () => {
    const ball = ballAt(-1, 1.6, -1.5);
    launchBallAt(ball, { x: 0, y: netContactHeight(t), z: 0 }, 9, t);
    const prediction = predictLanding(ball, t)!;
    expect(prediction.viaNet).toBe(true);

    const events: BallEvent[] = [];
    let ticks = 0;
    while (ball.alive) {
      stepBall(ball, t, events);
      ticks++;
    }
    const ground = events.find((e) => e.type === 'ground')!;
    expect(ticks).toBe(prediction.ticks);
    expect(ground.at).toEqual(prediction.point);
  });

  it('returns null for a dead ball', () => {
    expect(predictLanding({ ...ballAt(0, 0, 0), alive: false }, t)).toBeNull();
  });
});
