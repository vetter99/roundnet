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

describe('bot two-touch play', () => {
  it('usually passes to itself first, then spikes the second touch', () => {
    const world = createWorld();
    let touches: string[] = [];
    const patterns: string[] = [];
    for (let i = 0; i < 60 * 300; i++) {
      stepWorld(world, [botIntent(world, 0, t), botIntent(world, 1, t)], t);
      for (const e of world.events) {
        if (e.type === 'hit') touches.push(e.kind);
        if (e.type === 'possession' || e.type === 'ground') {
          if (touches.length) patterns.push(touches.join('>'));
          touches = [];
        }
      }
    }
    const passThenSpike = patterns.filter((p) => p === 'pass>spike').length;
    expect(passThenSpike / patterns.length).toBeGreaterThan(0.5);
    // It never passes and then forgets to play its second touch.
    expect(patterns.every((p) => p === 'spike' || p === 'pass>spike')).toBe(true);
  });
});
