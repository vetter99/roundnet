import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { stepBall, type Ball, type BallEvent } from './ball';
import { autoDiveTarget, hitQuality, tryHit } from './hit';
import { createPlayer, NEUTRAL_INTENT, startDive, stepPlayer, type Intent } from './player';
import { serveHand, setNextReceiver, setUpServe } from './serve';
import { createMatch, createWorld, feedBall, otherTeam, stepWorld, type SimEvent, type World } from './world';

const t = createTuning();

/**
 * Serve the real-roundnet way for whoever is serving: toss with pass, hold
 * spike, and release as the ball drops to the sweet spot (or `releaseAt` m
 * above / below it). `tap` holds spike only for the last moment (a soft
 * serve); `spinX` is sideways stick while charging; `aimX` is the stick held
 * (along x) as the ball is tossed, which sets the aim. Runs until the serve is
 * hit (or the toss lands) and returns every event along the way.
 */
const TOSS_CHARGE_TICKS = 20;

function tossAndServe(world: World, tt = t, opts: { tap?: boolean; spinX?: number; releaseAt?: number; aimX?: number } = {}): SimEvent[] {
  const idx = world.players.findIndex((p) => p.id === world.serve.serverId);
  const as = (i: Partial<Intent>) => world.players.map((_, k) => (k === idx ? { ...NEUTRAL_INTENT, ...i } : NEUTRAL_INTENT));
  const events: SimEvent[] = [];
  const step = (i: Partial<Intent>) => {
    stepWorld(world, as(i), tt);
    events.push(...world.events);
  };
  // A medium toss: charged for a third of a second.
  for (let i = 0; i < TOSS_CHARGE_TICKS; i++) step({ pass: true, moveX: opts.aimX ?? 0 });
  step({ moveX: opts.aimX ?? 0 });
  const releaseHeight = tt.serve.contactHeight + (opts.releaseAt ?? 0);
  for (let i = 0; i < 120 && world.waitingForServe; i++) {
    const b = world.ball;
    const release = b.vel.y < 0 && b.pos.y <= releaseHeight;
    const holding = !opts.tap || (b.vel.y < 0 && b.pos.y <= releaseHeight + 0.15);
    step(release || !holding ? {} : { spike: true, moveX: opts.spinX ?? 0 });
  }
  return events;
}

describe('hits', () => {
  function setup(ballHeightError: number) {
    const p = createPlayer(0, 0, 0, -2.5);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5, power: 0.5, spin: 0 };
    const ball: Ball = {
      pos: { x: 0, y: t.player.contactHeight + ballHeightError, z: -2.3 },
      vel: { x: 0, y: -1, z: 0 },
      alive: true,
      lastTouch: 'net' as const,
    };
    return { p, ball };
  }

  it('sideways stick while charging a spike sets its spin, and the spike curves that way', () => {
    // Facing the net from -z, the player's right is +x.
    const p = createPlayer(0, 0, 0, -2.5);
    const charge = { ...NEUTRAL_INTENT, spike: true, moveX: 1 };
    for (let i = 0; i < 10; i++) stepPlayer(p, charge, t);
    // (The stick also moves the player a little, so it's nearly full spin.)
    expect(p.charge?.spin).toBeGreaterThan(0.9);
    const swing = stepPlayer(p, NEUTRAL_INTENT, t);
    expect(swing?.kind).toBe('spike');
    expect(swing?.spin).toBeGreaterThan(0.9);

    const { ball } = setup(0);
    p.pos = { x: 0, y: 0, z: -2.5 };
    tryHit(p, ball, NEUTRAL_INTENT, t);
    expect(ball.curve?.x).toBeGreaterThan(0);
    // A pass takes no spin and clears any the ball had.
    p.hitBuffer = { kind: 'pass', ticksLeft: 5, power: 0.5, spin: 1 };
    p.cooldown = 0;
    ball.pos = { x: 0, y: t.player.contactHeight, z: -2.3 };
    ball.vel = { x: 0, y: -1, z: 0 };
    ball.lastTouch = 'net';
    tryHit(p, ball, NEUTRAL_INTENT, t);
    expect(ball.curve).toBeUndefined();
  });

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
    const a = createWorld();
    const b = createWorld();
    for (let i = 0; i < 2000; i++) {
      stepWorld(a, [script(i), script(i + 7)], t);
      stepWorld(b, [script(i), script(i + 7)], t);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('waits for the server to aim and release, then serves to the receiver', () => {
    const world = createMatch(t);
    // Red serves first, to Blue. Nothing happens until Red serves.
    for (let i = 0; i < 120; i++) stepWorld(world, [], t);
    expect(world.waitingForServe).toBe(true);
    expect(world.ball.alive).toBe(false);

    // Red tosses and hits: the serve is in the air.
    tossAndServe(world);
    expect(world.waitingForServe).toBe(false);
    expect(world.ball.alive).toBe(true);

    let possession: SimEvent | undefined;
    for (let i = 0; i < 120 && !possession; i++) {
      stepWorld(world, [], t);
      possession = world.events.find((e) => e.type === 'possession');
    }
    expect(possession).toEqual({ type: 'possession', team: 0 });
    expect(Math.sign(world.ball.vel.z)).toBe(Math.sign(world.players[0].pos.z));
  });

  it("only the server's pass tosses the ball", () => {
    const world = createMatch(t);
    // Blue is receiving, so Blue tapping pass does nothing.
    stepWorld(world, [{ ...NEUTRAL_INTENT, pass: true }], t);
    stepWorld(world, [], t);
    expect(world.waitingForServe).toBe(true);
    expect(world.serve.tossed).toBe(false);
  });

  it('a longer toss charge tosses higher and further toward the aim', () => {
    const toss = (chargeTicks: number) => {
      const world = createMatch(t);
      const red = (intent: Partial<Intent>): Intent[] => [NEUTRAL_INTENT, { ...NEUTRAL_INTENT, ...intent }];
      for (let i = 0; i < chargeTicks; i++) stepWorld(world, red({ pass: true, moveX: -1 }), t);
      stepWorld(world, red({ moveX: -1 }), t);
      return { ...world.ball.vel };
    };
    const tap = toss(1);
    const full = toss(60);
    expect(full.y).toBeGreaterThan(tap.y + 1.5);
    expect(Math.abs(full.x)).toBeGreaterThan(Math.abs(tap.x) * 1.5);
  });

  it('serving takes two steps: pass tosses the ball up, then spike hits it', () => {
    const world = createMatch(t);
    const red = (intent: Partial<Intent>): Intent[] => [NEUTRAL_INTENT, { ...NEUTRAL_INTENT, ...intent }];
    // A spike before the toss does nothing.
    stepWorld(world, red({ spike: true }), t);
    stepWorld(world, red({}), t);
    expect(world.serve.tossed).toBe(false);
    expect(world.waitingForServe).toBe(true);
    // Pass (pressed, then released) tosses it straight up; it's still waiting to be hit.
    stepWorld(world, red({ pass: true }), t);
    expect(world.serve.tossed).toBe(false);
    stepWorld(world, red({}), t);
    expect(world.events).toContainEqual({ type: 'toss', playerId: 1 });
    expect(world.serve.tossed).toBe(true);
    for (let i = 0; i < 5; i++) stepWorld(world, red({}), t);
    expect(world.ball.vel.y).toBeGreaterThan(0);
    expect(world.waitingForServe).toBe(true);
  });

  it('a toss that is never hit is a fault', () => {
    const world = createMatch(t);
    const red = (intent: Partial<Intent>): Intent[] => [NEUTRAL_INTENT, { ...NEUTRAL_INTENT, ...intent }];
    stepWorld(world, red({ pass: true }), t);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      stepWorld(world, red({}), t);
      events.push(...world.events);
    }
    expect(events).toContainEqual({ type: 'fault', team: 1, lost: false });
    // After a pause, Red gets a second serve.
    for (let i = 0; i < t.practice.resetDelayTicks + 2; i++) stepWorld(world, [], t);
    expect(world.waitingForServe).toBe(true);
    expect(world.serve.tossed).toBe(false);
    expect(world.serve.faults).toBe(1);
  });

  it('a well-timed hit is full quality; hit early it goes long, late it goes short', () => {
    /** Serve straight at the net center with the given timing; returns quality and where it hits the net (z). */
    const serveTimed = (releaseAt: number) => {
      const world = createMatch(t);
      const events = tossAndServe(world, t, { tap: true, releaseAt });
      const serve = events.find((e) => e.type === 'serve');
      let net: SimEvent | undefined;
      for (let i = 0; i < 120 && !net; i++) {
        stepWorld(world, [], t);
        net = world.events.find((e) => e.type === 'net' || e.type === 'ground');
      }
      return { quality: serve?.type === 'serve' ? serve.quality : 0, z: net?.type === 'net' ? net.at.z : Infinity };
    };
    const good = serveTimed(0);
    const early = serveTimed(0.3);
    const late = serveTimed(-0.3);
    expect(good.quality).toBeCloseTo(1);
    expect(early.quality).toBeLessThan(1);
    expect(late.quality).toBeLessThan(1);
    // Red serves from +z toward -z: long is more negative z, short more positive.
    expect(early.z).toBeLessThan(good.z);
    expect(late.z).toBeGreaterThan(good.z);
  });

  it('after the ball lands, the game waits for the next serve', () => {
    const world = createWorld();
    feedBall(world, 0, t);
    for (let i = 0; i < 600 && world.ball.alive; i++) stepWorld(world, [], t);
    for (let i = 0; i < t.practice.resetDelayTicks + 1; i++) stepWorld(world, [], t);
    expect(world.waitingForServe).toBe(true);
    // The serve switches sides: Blue serves next.
    expect(world.nextReceiver).toBe(1);
  });
});

describe('rally rules', () => {
  /** A world where Blue (player 0) has the ball, ready to play it. */
  function blueHasBall() {
    const world = createWorld();
    feedBall(world, 0, t);
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
    const world = createWorld();
    feedBall(world, 0, t); // fresh serve, on its way to the net
    expect(runUntilWhiff(world)).toMatchObject({ type: 'whiff', reason: 'notYet' });
  });

  it('explains a swing at a playable ball that is out of reach', () => {
    const world = createWorld();
    feedBall(world, 0, t);
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

describe('spike targeting', () => {
  /** Spike a ball at `height` with the stick pushed (`aimX`, `aimZ`); return where it lands first. */
  function spikeAt(height: number, aimX: number, aimZ: number) {
    const p = createPlayer(0, 0, 0, -2.4);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5, power: 0.5, spin: 0 };
    const ball = { pos: { x: 0, y: height, z: -2.2 }, vel: { x: 0, y: -2, z: 0 }, alive: true, lastTouch: 'net' as const };
    const hit = tryHit(p, ball, { ...NEUTRAL_INTENT, moveX: aimX, moveZ: aimZ }, t)!;
    const events: BallEvent[] = [];
    for (let i = 0; i < 300 && events.length === 0; i++) stepBall(ball, t, events);
    return { quality: hit.quality, first: events[0] };
  }

  it('ignores the stick: spikes always go at the net center', () => {
    const plain = spikeAt(t.player.contactHeight, 0, 0).first;
    const aimed = spikeAt(t.player.contactHeight, 1, 1).first;
    expect(plain?.type).toBe('net');
    expect(aimed).toEqual(plain);
    expect(Math.hypot(plain!.at.x, plain!.at.z)).toBeLessThan(0.1);
  });

  it('a decently timed spike lands on the net', () => {
    const { quality, first } = spikeAt(t.player.contactHeight - 0.45, 0, 0);
    expect(quality).toBeGreaterThan(0.3);
    expect(first?.type).toBe('net');
  });

  it('a terribly timed spike flies past the net', () => {
    const { quality, first } = spikeAt(t.player.contactHeight - 0.9, 0, 0);
    expect(quality).toBeLessThan(0.1);
    expect(first?.type).toBe('ground');
  });
});

describe('dive', () => {
  /** Start a dive along (x, z) and run its first tick. */
  const dive = (p: ReturnType<typeof createPlayer>, x: number, z: number) => {
    startDive(p, x, z);
    stepPlayer(p, NEUTRAL_INTENT, t);
  };
  const ballAt = (x: number, y: number, z: number, vx = 0, vy = -1, vz = 0) => ({
    pos: { x, y, z },
    vel: { x: vx, y: vy, z: vz },
    alive: true,
    lastTouch: 'net' as const,
  });

  it('lunges further than running in the same time, then stays down', () => {
    const diver = createPlayer(0, 0, -3, -3);
    const runner = createPlayer(1, 0, -3, -3);
    const lunge = Math.round(t.player.dive.duration * 60);
    dive(diver, 1, 0);
    stepPlayer(runner, { ...NEUTRAL_INTENT, moveX: 1 }, t);
    for (let i = 1; i < lunge; i++) {
      stepPlayer(diver, { ...NEUTRAL_INTENT, moveX: 1 }, t);
      stepPlayer(runner, { ...NEUTRAL_INTENT, moveX: 1 }, t);
    }
    expect(diver.pos.x - -3).toBeGreaterThan(runner.pos.x - -3);

    // Recovering: holding the stick doesn't move you until you're back up.
    const lyingAt = diver.pos.x;
    const recovery = Math.round(t.player.dive.recovery * 60);
    for (let i = 0; i < recovery - 1; i++) stepPlayer(diver, { ...NEUTRAL_INTENT, moveX: 1 }, t);
    expect(diver.pos.x).toBe(lyingAt);
    for (let i = 0; i < 5; i++) stepPlayer(diver, { ...NEUTRAL_INTENT, moveX: 1 }, t);
    expect(diver.pos.x).toBeGreaterThan(lyingAt);
  });

  it('can hit a ball out of normal reach while lunging, with less power', () => {
    const p = createPlayer(0, 0, 0, -2.5);
    dive(p, 1, 0);
    p.hitBuffer = { kind: 'pass', ticksLeft: 5, power: 1, spin: 0 };
    // Beyond standing reach, but within dive reach, at dive contact height.
    const hit = tryHit(p, ballAt(p.pos.x + t.player.reach + 0.3, t.player.dive.contactHeight, p.pos.z), NEUTRAL_INTENT, t)!;
    expect(hit).not.toBeNull();
    expect(hit.power).toBeCloseTo(t.player.dive.powerScale);
    expect(hit.quality).toBe(1);
  });

  it('measures dive reach from the outstretched paws, ahead of the feet', () => {
    const p = createPlayer(0, 0, 0, -3);
    dive(p, 1, 0);
    p.hitBuffer = { kind: 'pass', ticksLeft: 1, power: 1, spin: 0 };
    const ahead = t.player.dive.reachOffset + t.player.reach + t.player.dive.reachBonus - 0.1;
    expect(tryHit(p, ballAt(p.pos.x + ahead, 1.2, p.pos.z), NEUTRAL_INTENT, t)).not.toBeNull();
  });

  it('keeps a mid-lunge hit ready until the lunge ends', () => {
    const p = createPlayer(0, 0, 0, -3);
    dive(p, 1, 0);
    stepPlayer(p, { ...NEUTRAL_INTENT, pass: true }, t);
    stepPlayer(p, NEUTRAL_INTENT, t); // release: the swing is buffered
    const lunge = Math.round(t.player.dive.duration * 60);
    for (let i = 0; i < lunge - 6; i++) stepPlayer(p, NEUTRAL_INTENT, t);
    expect(p.hitBuffer).not.toBeNull();
  });

  it("can't hit while getting back up", () => {
    const p = createPlayer(0, 0, 0, -2.5);
    dive(p, 1, 0);
    for (let i = 0; i < Math.round(t.player.dive.duration * 60) + 2; i++) stepPlayer(p, NEUTRAL_INTENT, t);
    p.hitBuffer = { kind: 'pass', ticksLeft: 5, power: 1, spin: 0 };
    expect(tryHit(p, ballAt(p.pos.x, t.player.contactHeight, p.pos.z), NEUTRAL_INTENT, t)).toBeNull();
  });
});

describe('automatic dive', () => {
  const swingingPlayer = () => {
    const p = createPlayer(0, 0, 0, -3);
    p.hitBuffer = { kind: 'pass', ticksLeft: 8, power: 0.5, spin: 0 };
    return p;
  };
  const ballAt = (x: number, y: number, z: number, vx = 0, vy = -1, vz = 0) => ({
    pos: { x, y, z },
    vel: { x: vx, y: vy, z: vz },
    alive: true,
    lastTouch: 'net' as const,
  });

  it('dives toward a ball just out of reach', () => {
    const p = swingingPlayer();
    const target = autoDiveTarget(p, ballAt(p.pos.x + t.player.reach + 1, 0.9, p.pos.z), t);
    expect(target).not.toBeNull();
    expect(target!.x).toBeGreaterThan(p.pos.x);
  });

  it("doesn't dive when the ball is coming into reach anyway", () => {
    const p = swingingPlayer();
    // Moving toward the player fast enough to arrive before the swing expires.
    const ball = ballAt(p.pos.x + t.player.reach + 0.4, 1.3, p.pos.z, -6, 0);
    expect(autoDiveTarget(p, ball, t)).toBeNull();
  });

  it("doesn't dive for a ball far beyond diving range, or without a swing", () => {
    const p = swingingPlayer();
    expect(autoDiveTarget(p, ballAt(p.pos.x + t.player.reach + t.player.dive.autoRange + 1.5, 0.9, p.pos.z), t)).toBeNull();
    p.hitBuffer = null;
    expect(autoDiveTarget(p, ballAt(p.pos.x + t.player.reach + 1, 0.9, p.pos.z), t)).toBeNull();
  });

  it("doesn't dive while in the air", () => {
    const p = swingingPlayer();
    p.grounded = false;
    expect(autoDiveTarget(p, ballAt(p.pos.x + t.player.reach + 1, 0.9, p.pos.z), t)).toBeNull();
  });

  it('in a rally, swinging at a ball just out of reach dives and makes the hit', () => {
    const world = createWorld();
    feedBall(world, 0, t);
    const p = world.players[0];
    world.possession = 0;
    world.ball.lastTouch = 'net';
    world.ball.pos = { x: p.pos.x + t.player.reach + 1, y: 1.0, z: p.pos.z };
    world.ball.vel = { x: 0, y: -1.5, z: 0 };
    stepWorld(world, [{ ...NEUTRAL_INTENT, pass: true }], t);
    const events: string[] = [];
    for (let i = 0; i < 30; i++) {
      stepWorld(world, [], t);
      events.push(...world.events.map((e) => e.type));
    }
    expect(events).toContain('dive');
    expect(events).toContain('hit');
  });
});


describe('drop shot', () => {
  /** Hit a spike at `power` from 2.4 m out; return the shot kind and the ball's events until it lands. */
  function shoot(power: number) {
    const p = createPlayer(0, 0, 0, -2.4);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5, power, spin: 0 };
    const ball = { pos: { x: 0, y: t.player.contactHeight, z: -2.2 }, vel: { x: 0, y: -1, z: 0 }, alive: true, lastTouch: 'net' as const };
    const hit = tryHit(p, ball, NEUTRAL_INTENT, t)!;
    const events: BallEvent[] = [];
    for (let i = 0; i < 400 && ball.alive; i++) stepBall(ball, t, events);
    const ground = events.find((e) => e.type === 'ground')!;
    return { kind: hit.kind, nets: events.filter((e) => e.type === 'net').length, landsAt: Math.hypot(ground.at.x, ground.at.z) };
  }

  it('a tapped spike is a drop shot that dies just past the net', () => {
    const drop = shoot(0.05);
    expect(drop.kind).toBe('drop');
    expect(drop.nets).toBe(1);
    expect(drop.landsAt).toBeLessThan(1.5);
  });

  it('a charged spike carries much further', () => {
    const spike = shoot(0.8);
    expect(spike.kind).toBe('spike');
    expect(spike.landsAt).toBeGreaterThan(3);
  });

  it('is safe even when badly timed', () => {
    const p = createPlayer(0, 0, 0, -2.4);
    p.hitBuffer = { kind: 'spike', ticksLeft: 5, power: 0.05, spin: 0 };
    const ball = { pos: { x: 0, y: t.player.contactHeight - 0.9, z: -2.2 }, vel: { x: 0, y: -1, z: 0 }, alive: true, lastTouch: 'net' as const };
    const hit = tryHit(p, ball, NEUTRAL_INTENT, t)!;
    expect(hit.quality).toBeLessThan(0.1);
    const events: BallEvent[] = [];
    for (let i = 0; i < 400 && ball.alive; i++) stepBall(ball, t, events);
    expect(events[0].type).toBe('net');
  });
});

describe('serve duel', () => {
  const red = (intent: Partial<Intent>): Intent[] => [NEUTRAL_INTENT, { ...NEUTRAL_INTENT, ...intent }];

  it('places the server behind the serve line and the receiver opposite', () => {
    const world = createMatch(t);
    const [blue, redPlayer] = world.players;
    expect(Math.hypot(redPlayer.pos.x, redPlayer.pos.z)).toBeGreaterThan(t.net.radius + t.net.frameWidth + t.court.serveLineDistance);
    expect(Math.sign(blue.pos.z)).toBe(-Math.sign(redPlayer.pos.z));
    // The receiver starts behind their serve line.
    expect(Math.hypot(blue.pos.x, blue.pos.z)).toBeCloseTo(t.net.radius + t.net.frameWidth + t.court.serveLineDistance + t.serve.receiverBack);
  });

  it('the ball is held in the paw, slid toward the aim, and tossed up from there', () => {
    const world = createMatch(t);
    const server = world.players[1];
    const center = serveHand(world, server, t);
    // Red faces -z, so its right is -x: holding the stick that way leans the paw there.
    stepWorld(world, red({ moveX: -1 }), t);
    expect(world.serve.aim.x).toBeCloseTo(-t.net.radius * t.serve.aimLimit);
    const right = serveHand(world, server, t);
    expect(right.x).toBeLessThan(center.x - 0.2);
    // Let go and the aim (and paw) go back to center.
    stepWorld(world, red({}), t);
    expect(world.serve.aim.x).toBeCloseTo(0);
    // Toss while holding it: the ball goes up from the paw, drifting that way, and the aim locks.
    stepWorld(world, red({ pass: true, moveX: -1 }), t);
    stepWorld(world, red({ moveX: -1 }), t);
    expect(world.ball.pos.x).toBeCloseTo(right.x, 1);
    expect(world.ball.pos.z).toBeCloseTo(right.z, 1);
    expect(world.ball.vel.x).toBeLessThan(0);
    stepWorld(world, red({ moveX: 1 }), t);
    expect(world.serve.aim.x).toBeCloseTo(-t.net.radius * t.serve.aimLimit);
  });

  it("the server's stick sets the aim, not the server's position", () => {
    const world = createMatch(t);
    const server = world.players[1];
    const spot = { ...server.pos };
    for (let i = 0; i < 20; i++) stepWorld(world, red({ moveX: 1 }), t);
    expect(server.pos.x).toBeCloseTo(spot.x);
    expect(server.pos.z).toBeCloseTo(spot.z);
    expect(world.serve.aim.x).toBeGreaterThan(0.2);
  });

  it('a serve aimed at the net lands on it, near the aim', () => {
    const world = createMatch(t);
    tossAndServe(world, t, { tap: true, aimX: 0.4 });
    const aim = { x: 0.4 * t.net.radius * t.serve.aimLimit, z: 0 };
    let net: SimEvent | undefined;
    for (let i = 0; i < 120 && !net; i++) {
      stepWorld(world, [], t);
      net = world.events.find((e) => e.type === 'net');
    }
    expect(net).toBeDefined();
    if (net?.type === 'net') expect(Math.hypot(net.at.x - aim.x, net.at.z - aim.z)).toBeLessThan(0.1);
  });

  it('two faults lose the serve; one fault gives a second serve', () => {
    // Normally the aim stays on the net and faults come from charge wobble;
    // here we let the aim go off the net to force a fault.
    const loose = createTuning();
    loose.serve.aimLimit = 10;
    const world = createMatch(loose);
    const serveOffNet = () => {
      // Aim 3 m out (the loose limit is 10 net radii).
      const aimX = 3 / (loose.net.radius * loose.serve.aimLimit);
      const faults: SimEvent[] = tossAndServe(world, loose, { tap: true, aimX }).filter((e) => e.type === 'fault');
      for (let i = 0; i < 240 && !world.waitingForServe; i++) {
        stepWorld(world, [], loose);
        faults.push(...world.events.filter((e) => e.type === 'fault'));
      }
      return faults;
    };
    expect(serveOffNet()).toEqual([{ type: 'fault', team: 1, lost: false }]);
    expect(world.nextReceiver).toBe(0); // Red serves again
    expect(serveOffNet()).toEqual([{ type: 'fault', team: 1, lost: true }]);
    expect(world.nextReceiver).toBe(1); // the serve passed to Blue
  });
});

describe('serve spin', () => {
  /**
   * Serve straight at the net center with `spinX` sideways stick held while
   * charging, and `flightX` held after release. Returns where it hits the net
   * and its sideways speed after.
   */
  function serveWithSpin(spinX: number, flightX = 0) {
    const world = createMatch(t);
    const red = (intent: Partial<Intent>): Intent[] => [NEUTRAL_INTENT, { ...NEUTRAL_INTENT, ...intent }];
    // Toss, charge with the stick held sideways for spin, release at the sweet spot.
    tossAndServe(world, t, { spinX });
    let net: SimEvent | undefined;
    for (let i = 0; i < 120 && !net; i++) {
      stepWorld(world, red({ moveX: flightX }), t);
      net = world.events.find((e) => e.type === 'net');
    }
    return { at: net?.type === 'net' ? net.at : undefined, sideways: world.ball.vel.x, aim: world.serve.aim };
  }

  it('curves the serve in the direction the stick is pushed', () => {
    const straight = serveWithSpin(0);
    const right = serveWithSpin(1);
    const left = serveWithSpin(-1);
    // (A charged serve wobbles a little, so compare against the straight one.)
    expect(right.at!.x).toBeGreaterThan(straight.at!.x + 0.05);
    expect(left.at!.x).toBeLessThan(straight.at!.x - 0.05);
  });

  it('kicks the ball sideways off the net in the spin direction', () => {
    expect(serveWithSpin(1).sideways).toBeGreaterThan(serveWithSpin(0).sideways + 0.3);
  });

  it('locks the aim while charging (the stick only sets spin)', () => {
    expect(serveWithSpin(1).aim).toEqual({ x: 0, z: 0 });
  });

  it('cannot be steered after release', () => {
    expect(serveWithSpin(0, 1).at).toEqual(serveWithSpin(0, 0).at);
  });

  it('reports the spin on the serve event', () => {
    const world = createMatch(t);
    const serve = tossAndServe(world, t, { spinX: 1 }).find((e) => e.type === 'serve');
    expect(serve).toMatchObject({ type: 'serve' });
    expect(serve?.type === 'serve' && Math.abs(serve.spin)).toBeCloseTo(1);
  });
});

describe('serve practice', () => {
  it('the chosen player serves every time, with no score, and faults never pass the serve', () => {
    const loose = createTuning();
    loose.serve.aimLimit = 10;
    const world = createWorld('2v2');
    world.mode = 'serves';
    world.servePracticeId = 1; // Blue 2
    setUpServe(world, loose);
    const servers: number[] = [];
    for (let round = 0; round < 4; round++) {
      servers.push(world.serve.serverId);
      // Alternate a good serve and one aimed well off the net (a fault).
      tossAndServe(world, loose, { tap: true, aimX: round % 2 ? 3 / (loose.net.radius * loose.serve.aimLimit) : 0 });
      for (let i = 0; i < 600 && !world.waitingForServe; i++) stepWorld(world, [], loose);
    }
    expect(servers).toEqual([1, 1, 1, 1]);
    expect(world.score).toEqual([0, 0]);
    // The receiver is the Red player straight across.
    expect(world.players[world.serve.receiverId].team).toBe(1);
  });
});

describe('match mode', () => {
  /** A match world where Blue has the ball off the net, ready to play it. */
  function blueHasBallInMatch() {
    const world = createMatch(t, 'match');
    feedBall(world, 0, t);
    const p = world.players[0];
    world.possession = 0;
    world.ball.pos = { x: p.pos.x, y: t.player.contactHeight, z: p.pos.z + 0.2 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.ball.lastTouch = 'net';
    return world;
  }
  const runUntil = (world: World, type: string, maxTicks = 300) => {
    for (let i = 0; i < maxTicks; i++) {
      stepWorld(world, [], t);
      const e = world.events.find((ev) => ev.type === type);
      if (e) return e;
    }
    return undefined;
  };

  it('the side that lets the ball land gives up the point, and the winner serves', () => {
    const world = blueHasBallInMatch();
    // Blue had it off the net and never touched it.
    expect(runUntil(world, 'point')).toEqual({ type: 'point', team: 1, reason: 'notReached', loser: 0 });
    expect(world.score).toEqual([0, 1]);
    expect(world.nextReceiver).toBe(0); // Red won it, so Red serves to Blue
  });

  it('says why a point ended: missed the net, out of touches, dropped, ace, double fault', () => {
    const reasonAfter = (setup: (world: World) => void) => {
      const world = blueHasBallInMatch();
      setup(world);
      const e = runUntil(world, 'point');
      return e?.type === 'point' ? e.reason : undefined;
    };
    const blueTouched = (kind: 'spike' | 'pass', touches: number) => (world: World) => {
      world.ball.lastTouch = 'player';
      world.lastHitTeam = 0;
      world.lastHitKind = kind;
      world.touches = touches;
    };
    expect(reasonAfter(blueTouched('spike', 1))).toBe('missedNet');
    expect(reasonAfter(blueTouched('pass', t.match.maxTouches))).toBe('outOfTouches');
    expect(reasonAfter(blueTouched('pass', 1))).toBe('dropped');
    expect(
      reasonAfter((world) => {
        world.serve.returnPending = true;
      }),
    ).toBe('ace');
  });

  it('refuses a touch beyond the limit', () => {
    const world = blueHasBallInMatch();
    world.touches = t.match.maxTouches;
    stepWorld(world, [{ ...NEUTRAL_INTENT, pass: true }], t);
    expect(runUntil(world, 'whiff', 20)).toMatchObject({ type: 'whiff', reason: 'noTouchesLeft' });
  });

  it('a double fault gives the receiver the point', () => {
    const loose = createTuning();
    loose.serve.aimLimit = 10;
    const world = createMatch(loose, 'match');
    for (let attempt = 0; attempt < 2; attempt++) {
      tossAndServe(world, loose, { tap: true, aimX: 3 / (loose.net.radius * loose.serve.aimLimit) });
      for (let i = 0; i < 240 && !world.waitingForServe; i++) stepWorld(world, [], loose);
    }
    expect(world.score).toEqual([1, 0]);
  });

  it('a double fault is reported as the reason', () => {
    const loose = createTuning();
    loose.serve.aimLimit = 10;
    const world = createMatch(loose, 'match');
    const events: SimEvent[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      events.push(...tossAndServe(world, loose, { tap: true, aimX: 3 / (loose.net.radius * loose.serve.aimLimit) }));
      for (let i = 0; i < 240 && !world.waitingForServe; i++) {
        stepWorld(world, [], loose);
        events.push(...world.events);
      }
    }
    expect(events).toContainEqual({ type: 'point', team: 0, reason: 'doubleFault', loser: 1 });
  });

  it('a game ends at the target score, win by 2', () => {
    const world = blueHasBallInMatch();
    world.score = [t.match.pointsToWin - 1, t.match.pointsToWin - 2];
    // Blue lets it drop: Red scores, the game goes on (no 2-point lead).
    runUntil(world, 'point');
    expect(world.winner).toBeNull();
    // Now Red has the ball and lets it drop: Blue goes 2 up and wins.
    world.score = [t.match.pointsToWin - 1, t.match.pointsToWin - 3];
    feedBall(world, 1, t);
    world.possession = 1;
    world.ball.lastTouch = 'net';
    expect(runUntil(world, 'gameOver')).toEqual({ type: 'gameOver', winner: 0 });
  });

  it('practice mode keeps no score', () => {
    const world = createMatch(t);
    feedBall(world, 0, t);
    runUntil(world, 'ground');
    expect(world.score).toEqual([0, 0]);
  });
});

describe('2v2', () => {
  const passing = (id: number): Intent[] => [0, 1, 2, 3].map((k) => (k === id ? { ...NEUTRAL_INTENT, pass: true } : NEUTRAL_INTENT));

  /** A 2v2 world where Blue has the ball off the net, at contact height next to `id`. */
  function blueBallAt(id: number) {
    const world = createMatch(t, 'practice', '2v2');
    feedBall(world, 0, t);
    const p = world.players[id];
    world.possession = 0;
    world.ball.pos = { x: p.pos.x, y: t.player.contactHeight, z: p.pos.z + 0.2 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.ball.lastTouch = 'net';
    return world;
  }

  /** Hold pass for a tick, release, and run until the player hits or whiffs. */
  function swing(world: World, id: number) {
    stepWorld(world, passing(id), t);
    for (let i = 0; i < 20; i++) {
      stepWorld(world, [], t);
      const e = world.events.find((ev) => (ev.type === 'hit' || ev.type === 'whiff') && ev.playerId === id);
      if (e) return e;
    }
    return undefined;
  }

  it('has two players a side, at the four compass points for the serve', () => {
    const world = createMatch(t, 'practice', '2v2');
    expect(world.players.map((p) => p.team)).toEqual([0, 0, 1, 1]);
    // Red 1 serves to Blue 1, straight across; the partners stand to the sides.
    expect(world.serve.serverId).toBe(2);
    expect(world.serve.receiverId).toBe(0);
    const [blue1, blue2, red1, red2] = world.players;
    expect(blue1.pos.x).toBeCloseTo(0);
    expect(red1.pos.x).toBeCloseTo(0);
    expect(Math.sign(blue1.pos.z)).toBe(-Math.sign(red1.pos.z));
    expect(blue2.pos.z).toBeCloseTo(0);
    expect(red2.pos.z).toBeCloseTo(0);
    expect(Math.sign(blue2.pos.x)).toBe(-Math.sign(red2.pos.x));
  });

  it('no player may touch the ball twice in a row; the partner can', () => {
    const world = blueBallAt(0);
    expect(swing(world, 0)).toMatchObject({ type: 'hit', playerId: 0 });
    // Blue 1 again: refused.
    world.ball.pos = { ...world.players[0].pos, y: t.player.contactHeight };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.players[0].cooldown = 0;
    expect(swing(world, 0)).toMatchObject({ type: 'whiff', reason: 'doubleTouch' });
    // Blue 2 may.
    const blue2 = world.players[1];
    world.ball.pos = { x: blue2.pos.x, y: t.player.contactHeight, z: blue2.pos.z + 0.2 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    expect(swing(world, 1)).toMatchObject({ type: 'hit', playerId: 1 });
  });

  it('1v1 still lets a player pass to themselves', () => {
    const world = createMatch(t);
    feedBall(world, 0, t);
    world.possession = 0;
    const p = world.players[0];
    const at = () => {
      world.ball.pos = { x: p.pos.x, y: t.player.contactHeight, z: p.pos.z + 0.2 };
      world.ball.vel = { x: 0, y: 0, z: 0 };
      world.ball.lastTouch = 'net';
    };
    at();
    const press = () => stepWorld(world, [{ ...NEUTRAL_INTENT, pass: true }], t);
    press();
    for (let i = 0; i < 20 && !world.events.some((e) => e.type === 'hit'); i++) stepWorld(world, [], t);
    at();
    world.ball.lastTouch = 'player';
    p.cooldown = 0;
    press();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      stepWorld(world, [], t);
      hit = world.events.some((e) => e.type === 'hit');
    }
    expect(hit).toBe(true);
  });

  it('a team rotates its server each time it wins the serve back', () => {
    const world = createMatch(t, 'practice', '2v2');
    const servers: number[] = [];
    for (let rally = 0; rally < 4; rally++) {
      servers.push(world.serve.serverId);
      // Practice: the serve alternates every rally.
      setNextReceiver(world, otherTeam(world.nextReceiver));
      setUpServe(world, t);
    }
    // Red 1, Blue 1, Red 2, Blue 2.
    expect(servers).toEqual([2, 0, 3, 1]);
  });

  it('is deterministic in 2v2 too', () => {
    const script = (tick: number): Intent => ({
      moveX: Math.sin(tick / 20),
      moveZ: Math.cos(tick / 33),
      jump: tick % 45 === 0,
      spike: tick % 17 < 4,
      pass: tick % 29 < 6,
    });
    const run = () => {
      const w = createMatch(t, 'match', '2v2');
      for (let i = 0; i < 1500; i++) stepWorld(w, w.players.map((_, k) => script(i + k * 5)), t);
      return JSON.stringify(w);
    };
    expect(run()).toBe(run());
  });
});
