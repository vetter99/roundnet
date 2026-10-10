import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { hitQuality, tryHit } from './hit';
import { createPlayer, NEUTRAL_INTENT, stepPlayer, type Intent } from './player';
import { createWorld, stepWorld } from './world';

const t = createTuning();

describe('hits', () => {
  function setup(ballHeightError: number) {
    const p = createPlayer(0, 0, 0, -2.5);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5 };
    const ball = {
      pos: { x: 0, y: t.player.contactHeight + ballHeightError, z: -2.3 },
      vel: { x: 0, y: -1, z: 0 },
      alive: true,
      lastTouch: 'net' as const,
    };
    return { p, ball };
  }

  it('a perfectly timed spike has full quality and heads to the net', () => {
    const { p, ball } = setup(0);
    const hit = tryHit(p, ball, NEUTRAL_INTENT, t)!;
    expect(hit.quality).toBe(1);
    expect(ball.vel.z).toBeGreaterThan(0);
    expect(p.cooldown).toBe(t.hit.cooldownTicks);
  });

  it('a mistimed spike is weaker', () => {
    const good = setup(0);
    const bad = setup(-0.6);
    tryHit(good.p, good.ball, NEUTRAL_INTENT, t);
    const hit = tryHit(bad.p, bad.ball, NEUTRAL_INTENT, t)!;
    expect(hit.quality).toBeLessThan(1);
    expect(Math.hypot(bad.ball.vel.x, bad.ball.vel.z)).toBeLessThan(Math.hypot(good.ball.vel.x, good.ball.vel.z));
  });

  it('cannot hit a ball on its way to the net', () => {
    const { p, ball } = setup(0);
    const fed = { ...ball, lastTouch: 'feed' as const };
    expect(tryHit(p, fed, NEUTRAL_INTENT, t)).toBeNull();
  });

  it('cannot hit a ball out of reach', () => {
    const { p, ball } = setup(0);
    ball.pos.x = 5;
    expect(tryHit(p, ball, NEUTRAL_INTENT, t)).toBeNull();
  });

  it('quality falls off outside the perfect window', () => {
    expect(hitQuality(t.hit.perfectWindow, t)).toBe(1);
    expect(hitQuality(t.hit.perfectWindow + t.hit.qualityFalloff, t)).toBe(0);
  });
});

describe('player', () => {
  it('cannot walk into the net', () => {
    const p = createPlayer(0, 0, 0, -1);
    const forward: Intent = { ...NEUTRAL_INTENT, moveZ: 1 };
    for (let i = 0; i < 120; i++) stepPlayer(p, forward, t);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(t.net.radius + t.net.rimWidth + t.player.radius - 1e-9);
  });

  it('jumps and lands', () => {
    const p = createPlayer(0, 0, 0, -2);
    stepPlayer(p, { ...NEUTRAL_INTENT, jump: true }, t);
    expect(p.grounded).toBe(false);
    for (let i = 0; i < 120; i++) stepPlayer(p, NEUTRAL_INTENT, t);
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBe(0);
  });
});

describe('world', () => {
  // A scripted player: run around, jump and swing on a fixed pattern.
  const script = (tick: number): Intent => ({
    moveX: Math.sin(tick / 20),
    moveZ: Math.cos(tick / 33),
    jump: tick % 45 === 0,
    spike: tick % 17 === 0,
    pass: tick % 29 === 0,
  });

  it('is deterministic: same inputs give the exact same state', () => {
    const a = createWorld(t);
    const b = createWorld(t);
    for (let i = 0; i < 2000; i++) {
      stepWorld(a, [script(i)], t);
      stepWorld(b, [script(i)], t);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the feed bounces off the net toward the player', () => {
    const world = createWorld(t);
    const p = world.players[0];
    let netTick = -1;
    for (let i = 0; i < 120 && netTick < 0; i++) {
      stepWorld(world, [NEUTRAL_INTENT], t);
      if (world.events.some((e) => e.type === 'net')) netTick = i;
    }
    expect(netTick).toBeGreaterThan(0);
    // After the bounce the ball moves toward the player's side.
    expect(Math.sign(world.ball.vel.z)).toBe(Math.sign(p.pos.z));
  });

  it('counts a player spike that hits the net as a streak point', () => {
    const world = createWorld(t);
    const p = world.players[0];
    world.ball.pos = { x: p.pos.x, y: t.player.contactHeight, z: p.pos.z + 0.2 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.ball.lastTouch = 'net';
    let netHit = false;
    for (let i = 0; i < 60 && !netHit; i++) {
      stepWorld(world, [{ ...NEUTRAL_INTENT, spike: i === 0 }], t);
      netHit = world.events.some((e) => e.type === 'net');
    }
    expect(netHit).toBe(true);
    expect(world.streak).toBe(1);
  });
});

describe('receiving drill', () => {
  // Plays like a decent human: waits for the net bounce, moves under the ball
  // and spikes when it drops to contact height.
  function playDrill(ticks: number) {
    const tn = createTuning();
    const world = createWorld(tn);
    const hits: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const p = world.players[0];
      const b = world.ball;
      const intent: Intent = { ...NEUTRAL_INTENT };
      if (b.lastTouch === 'net' && b.alive) {
        const dx = b.pos.x - p.pos.x;
        const dz = b.pos.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          intent.moveX = (Math.min(1, dist * 3) * dx) / dist;
          intent.moveZ = (Math.min(1, dist * 3) * dz) / dist;
        }
        intent.spike = b.vel.y < 0 && Math.abs(b.pos.y - tn.player.contactHeight) < 0.1;
      }
      stepWorld(world, [intent], tn);
      for (const e of world.events) if (e.type === 'hit') hits.push(e.quality);
    }
    return { world, hits };
  }

  it('a well-timed player builds a streak of clean returns', () => {
    const { world, hits } = playDrill(60 * 30);
    expect(hits.length).toBeGreaterThan(5);
    expect(Math.min(...hits)).toBe(1);
    expect(world.streak).toBe(hits.length);
  });

  it('missing the ball resets the streak', () => {
    const world = createWorld(t);
    world.streak = 4;
    for (let i = 0; i < 300; i++) stepWorld(world, [NEUTRAL_INTENT], t);
    expect(world.streak).toBe(0);
    expect(world.bestStreak).toBe(4);
  });
});

describe('swing feedback', () => {
  function runUntilWhiff(world: ReturnType<typeof createWorld>) {
    stepWorld(world, [{ ...NEUTRAL_INTENT, spike: true }], t);
    expect(world.events.some((e) => e.type === 'swing')).toBe(true);
    for (let i = 0; i < t.hit.inputBufferTicks + 2; i++) {
      stepWorld(world, [NEUTRAL_INTENT], t);
      const whiff = world.events.find((e) => e.type === 'whiff');
      if (whiff) return whiff;
    }
    return undefined;
  }

  it('explains a swing at a ball still heading to the net', () => {
    const world = createWorld(t); // fresh feed, on its way to the net
    expect(runUntilWhiff(world)).toMatchObject({ type: 'whiff', reason: 'notYet' });
  });

  it('explains a swing at a playable ball that is out of reach', () => {
    const world = createWorld(t);
    world.ball.lastTouch = 'net';
    world.ball.pos = { x: 3, y: 1.3, z: 3 };
    world.ball.vel = { x: 0, y: 6, z: 0 };
    expect(runUntilWhiff(world)).toMatchObject({ type: 'whiff', reason: 'tooFar' });
  });
});
