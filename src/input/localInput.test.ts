import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalInput } from './localInput';

// A fake standard-layout controller whose held buttons the test controls.
function fakePad(held: number[]) {
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    mapping: 'standard',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
  };
}

function setup() {
  let held: number[] = [];
  vi.stubGlobal('navigator', { getGamepads: () => [{ ...fakePad(held), index: 0 }] });
  const local = new LocalInput(new EventTarget() as unknown as Window);
  // Poll the first gamepad, the way the game does each tick.
  const input = { poll: () => local.pollGamepad(local.gamepads()[0]) };
  return { input, hold: (buttons: number[]) => (held = buttons) };
}

describe('LocalInput gamepad', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps A to pass, B to spike, X to dive, Y to jump, View to reset', () => {
    const cases: [number, 'pass' | 'spike' | 'jump' | 'dive' | 'feed'][] = [
      [0, 'pass'],
      [1, 'spike'],
      [2, 'dive'],
      [3, 'jump'],
      [8, 'feed'],
    ];
    for (const [button, action] of cases) {
      const { input, hold } = setup();
      input.poll();
      hold([button]);
      expect(input.poll()[action], `button ${button}`).toBe(true);
    }
  });

  it('jump fires once per press, not every tick while held', () => {
    const { input, hold } = setup();
    input.poll();
    hold([3]);
    expect(input.poll().jump).toBe(true);
    expect(input.poll().jump).toBe(false);
    hold([]);
    input.poll();
    hold([3]);
    expect(input.poll().jump).toBe(true);
  });

  it('pass and spike report held state so hits can charge', () => {
    const { input, hold } = setup();
    hold([1]);
    expect(input.poll().spike).toBe(true);
    expect(input.poll().spike).toBe(true);
    hold([]);
    expect(input.poll().spike).toBe(false);
  });
});
