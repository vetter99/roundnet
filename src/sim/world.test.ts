import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { hitQuality, tryHit } from './hit';
import { createPlayer, NEUTRAL_INTENT, stepPlayer, type Intent } from './player';
import { createWorld, stepWorld, type SimEvent, type World } from './world';

const t = createTuning();

describe('hits', () => {
  function setup(ballHeightError: number) {
    const p = createPlayer(0, 0, 0, -2.5);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5, power: 0.5 };
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
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(t.net.radius + t.net.frameWidth + t.player.radius - 1e-9);
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
    spike: tick % 17 < 4,
    pass: tick % 29 < 6,
  });

  it('is deterministic: same inputs give the exact same state', () => {
    const a = createWorld(t);
    const b = createWorld(t);
    for (let i = 0; i < 2000; i++) {
      stepWorld(a, [script(i), script(i + 7)], t);
      stepWorld(b, [script(i), script(i + 7)], t);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the serve bounces off the net toward the receiver, who gets possession', () => {
    const world = createWorld(t);
    const receiver = world.players[0];
    let possession: SimEvent | undefined;
    for (let i = 0; i < 120 && !possession; i++) {
      stepWorld(world, [], t);
      possession = world.events.find((e) => e.type === 'possession');
    }
    expect(possession).toEqual({ type: 'possession', team: 0 });
    expect(Math.sign(world.ball.vel.z)).toBe(Math.sign(receiver.pos.z));
  });
});

describe('rally rules', () => {
  /** A world where Blue (player 0) has the ball, ready to play it. */
  function blueHasBall() {
    const world = createWorld(t);
    const p = world.players[0];
    world.possession = 0;
    world.ball.pos = { x: p.pos.x, y: t.player.contactHeight, z: p.pos.z + 0.2 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.ball.lastTouch = 'net';
    return world;
  }

  /** Tap a hit for player `index` (hold one tick, release), then run until `until` fires. */
  function tapAndRun(world: World, index: number, kind: 'spike' | 'pass', until: (e: SimEvent) => boolean) {
    const press: Intent[] = [];
    press[index] = { ...NEUTRAL_INTENT, [kind]: true };
    stepWorld(world, press, t);
    for (let i = 0; i < 120; i++) {
      stepWorld(world, [], t);
      const found = world.events.find(until);
      if (found) return found;
    }
    return undefined;
  }

  it('putting the ball on the net hands possession to the other team', () => {
    const world = blueHasBall();
    const e = tapAndRun(world, 0, 'spike', (ev) => ev.type === 'possession');
    expect(e).toEqual({ type: 'possession', team: 1 });
  });

  it("the other team can't play your ball", () => {
    const world = blueHasBall();
    const red = world.players[1];
    red.pos = { x: world.ball.pos.x + 0.3, y: 0, z: world.ball.pos.z };
    const e = tapAndRun(world, 1, 'spike', (ev) => ev.type === 'whiff' || ev.type === 'hit');
    expect(e).toMatchObject({ type: 'whiff', reason: 'notYourBall' });
  });

  it('when the ball lands, the next serve goes to the other player', () => {
    const world = blueHasBall();
    world.nextReceiver = 0;
    const e = tapAndRun(world, 0, 'pass', (ev) => ev.type === 'ground');
    expect(e?.type).toBe('ground');
    expect(world.nextReceiver).toBe(1);
  });

  it("players can't overlap, and the team with the ball has right of way", () => {
    const world = blueHasBall();
    const [blue, red] = world.players;
    blue.pos = { x: -2, y: 0, z: -2 };
    red.pos = { x: -2.1, y: 0, z: -2 };
    stepWorld(world, [], t);
    expect(Math.hypot(blue.pos.x - red.pos.x, blue.pos.z - red.pos.z)).toBeGreaterThanOrEqual(t.player.radius * 2 - 1e-9);
    // Blue has the ball, so only Red got pushed.
    expect(blue.pos.x).toBeCloseTo(-2);
    expect(red.pos.x).toBeLessThan(-2.1);
  });
});
describe('swing feedback', () => {
  function runUntilWhiff(world: ReturnType<typeof createWorld>) {
    // Tap: hold for one tick, then release (the swing happens on release).
    stepWorld(world, [{ ...NEUTRAL_INTENT, spike: true }], t);
    stepWorld(world, [NEUTRAL_INTENT], t);
    expect(world.events.some((e) => e.type === 'swing')).toBe(true);
    for (let i = 0; i < t.hit.inputBufferTicks + 2; i++) {
      const whiff = world.events.find((e) => e.type === 'whiff');
      if (whiff) return whiff;
      stepWorld(world, [NEUTRAL_INTENT], t);
    }
    return undefined;
  }

  it('explains a swing at a ball still heading to the net', () => {
    const world = createWorld(t); // fresh feed, on its way to the net
    expect(runUntilWhiff(world)).toMatchObject({ type: 'whiff', reason: 'notYet' });
  });

  it('explains a swing at a playable ball that is out of reach', () => {
    const world = createWorld(t);
    world.possession = 0;
    world.ball.lastTouch = 'net';
    world.ball.pos = { x: 3, y: 1.3, z: 3 };
    world.ball.vel = { x: 0, y: 6, z: 0 };
    expect(runUntilWhiff(world)).toMatchObject({ type: 'whiff', reason: 'tooFar' });
  });
});

describe('charging', () => {
  // Hold a hit button for `holdTicks`, release, and return the swing power and ball velocity.
  function chargedHit(kind: 'spike' | 'pass', holdTicks: number) {
    const p = createPlayer(0, 0, 0, -2.5);
    const held: Intent = { ...NEUTRAL_INTENT, [kind]: true };
    for (let i = 0; i < holdTicks; i++) stepPlayer(p, held, t);
    const swing = stepPlayer(p, NEUTRAL_INTENT, t)!;
    const ball = {
      pos: { x: 0, y: t.player.contactHeight, z: -2.3 },
      vel: { x: 0, y: -1, z: 0 },
      alive: true,
      lastTouch: 'net' as const,
    };
    tryHit(p, ball, NEUTRAL_INTENT, t);
    return { swing, vel: ball.vel };
  }

  it('releasing swings with power that grows the longer you hold', () => {
    const tap = chargedHit('spike', 1);
    const full = chargedHit('spike', 60);
    expect(tap.swing.kind).toBe('spike');
    expect(tap.swing.power).toBeLessThan(0.1);
    expect(full.swing.power).toBe(1);
  });

  it('a charged spike is harder and a charged pass goes higher', () => {
    const softSpike = chargedHit('spike', 1).vel;
    const hardSpike = chargedHit('spike', 60).vel;
    expect(Math.hypot(hardSpike.x, hardSpike.z)).toBeGreaterThan(Math.hypot(softSpike.x, softSpike.z) * 1.4);
    expect(chargedHit('pass', 60).vel.y).toBeGreaterThan(chargedHit('pass', 1).vel.y * 1.5);
  });

  it('holding a hit button does not swing until released', () => {
    const p = createPlayer(0, 0, 0, -2.5);
    for (let i = 0; i < 30; i++) expect(stepPlayer(p, { ...NEUTRAL_INTENT, pass: true }, t)).toBeNull();
    expect(p.charge?.kind).toBe('pass');
  });

  it('charging slows movement', () => {
    const free = createPlayer(0, 0, -3, -3);
    const charging = createPlayer(1, 0, -3, -3);
    for (let i = 0; i < 60; i++) {
      stepPlayer(free, { ...NEUTRAL_INTENT, moveX: 1 }, t);
      stepPlayer(charging, { ...NEUTRAL_INTENT, moveX: 1, spike: true }, t);
    }
    expect(charging.vel.x).toBeCloseTo(free.vel.x * t.hit.chargeMoveFactor);
  });
});
