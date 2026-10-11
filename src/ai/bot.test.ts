import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { createWorld, stepWorld } from '../sim/world';
import { botIntent } from './bot';

const t = createTuning();

describe('bot', () => {
  it('two bots play real rallies: returns onto the net between serves', () => {
    const world = createWorld();
    let possessionChanges = 0;
    let points = 0;
    for (let i = 0; i < 60 * 90; i++) {
      stepWorld(world, [botIntent(world, 0, t), botIntent(world, 1, t)], t);
      for (const e of world.events) {
        if (e.type === 'possession') possessionChanges++;
        if (e.type === 'ground') points++;
      }
    }
    expect(points).toBeGreaterThan(0);
    // Each serve gives one possession change; more than that means returns.
    expect(possessionChanges).toBeGreaterThan(points * 2);
  });
});

describe('bot touch play', () => {
  /** Two CPUs play for `seconds`; returns each possession's touches, e.g. 'pass>pass>spike'. */
  function patterns(seconds: number) {
    const world = createWorld();
    let touches: string[] = [];
    const out: string[] = [];
    for (let i = 0; i < 60 * seconds; i++) {
      stepWorld(world, [botIntent(world, 0, t), botIntent(world, 1, t)], t);
      for (const e of world.events) {
        if (e.type === 'hit') touches.push(e.kind);
        if (e.type === 'possession' || e.type === 'ground') {
          if (touches.length) out.push(touches.join('>') + (e.type === 'ground' ? ' (dropped)' : ''));
          touches = [];
        }
      }
    }
    return out;
  }

  it('usually passes twice, then spikes the third touch', () => {
    const all = patterns(300);
    const threeTouch = all.filter((p) => p === 'pass>pass>spike').length;
    expect(threeTouch / all.length).toBeGreaterThan(0.5);
    // Every ball it gets back to the net ends with a spike or drop; a pass it
    // then can't reach (a bad pass) is rare.
    const reachedNet = all.filter((p) => !p.endsWith('(dropped)'));
    expect(reachedNet.every((p) => /^(pass>){0,2}(spike|drop)$/.test(p))).toBe(true);
    expect(all.filter((p) => /pass \(dropped\)$/.test(p)).length / all.length).toBeLessThan(0.05);
  });

  it('gets to most drop shots', () => {
    const world = createWorld();
    let drops = 0;
    let returned = 0;
    let pending: number | null = null;
    for (let i = 0; i < 60 * 1200; i++) {
      stepWorld(world, [botIntent(world, 0, t), botIntent(world, 1, t)], t);
      for (const e of world.events) {
        if (e.type === 'hit') {
          const team = world.players[e.playerId].team;
          if (pending !== null && team !== pending) returned++;
          pending = e.kind === 'drop' ? team : null;
          if (e.kind === 'drop') drops++;
        }
        if (e.type === 'ground') pending = null;
      }
    }
    expect(drops).toBeGreaterThan(5);
    expect(returned / drops).toBeGreaterThan(0.5);
  });
});
