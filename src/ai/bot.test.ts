import { describe, expect, it } from 'vitest';
import { createTuning } from '../config/tuning';
import { createWorld, stepWorld } from '../sim/world';
import { botIntent } from './bot';

const t = createTuning();

describe('bot', () => {
  it('two bots play real rallies: returns onto the net between serves', () => {
    const world = createWorld(t);
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
