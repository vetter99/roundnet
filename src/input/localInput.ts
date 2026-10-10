import type { Intent } from '../sim/player';

export interface InputFrame extends Intent {
  // End the current rally now (e.g. if the ball gets stuck).
  feed: boolean;
}

const STICK_DEADZONE = 0.2;

type ButtonLayout = Record<'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT', number>;

// Standard gamepad layout (Xbox naming; PlayStation/Switch map to the same slots).
const STANDARD_LAYOUT: ButtonLayout = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7 };
// Xbox controllers over Bluetooth can report a raw layout (mapping !== 'standard')
// that skips slots 2 and 5, with the triggers reported as axes instead of buttons.
const XBOX_RAW_LAYOUT: ButtonLayout = { A: 0, B: 1, X: 3, Y: 4, LB: 6, RB: 7, LT: -1, RT: -1 };

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  pass: ['KeyJ'],
  spike: ['KeyK'],
  feed: ['KeyR'],
};

const CAPTURED_KEYS = new Set(Object.values(KEYS).flat());

/**
 * Reads the keyboard and every connected gamepad separately, so each can
 * drive a different player. Presses are remembered until the next poll so
 * quick taps are never missed.
 */
export class LocalInput {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  // Previous buttons per gamepad index, to detect new presses.
  private readonly prevPadButtons = new Map<number, boolean[]>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (CAPTURED_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  pollKeyboard(): InputFrame {
    const isHeld = (codes: string[]) => codes.some((c) => this.held.has(c));
    const wasPressed = (codes: string[]) => codes.some((c) => this.pressed.has(c));
    const frame: InputFrame = {
      moveX: (isHeld(KEYS.right) ? 1 : 0) - (isHeld(KEYS.left) ? 1 : 0),
      moveZ: (isHeld(KEYS.up) ? 1 : 0) - (isHeld(KEYS.down) ? 1 : 0),
      jump: wasPressed(KEYS.jump),
      // Held, not pressed: holding charges the hit and releasing swings.
      pass: isHeld(KEYS.pass),
      spike: isHeld(KEYS.spike),
      feed: wasPressed(KEYS.feed),
    };
    this.pressed.clear();
    return frame;
  }

  /** Connected gamepads in the order the browser lists them. */
  gamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return navigator.getGamepads().filter((p): p is Gamepad => p !== null && p.connected);
  }

  pollGamepad(pad: Gamepad): InputFrame {
    const PAD = layoutFor(pad);
    const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    // Compare against last poll's buttons to detect new presses.
    const prevButtons = this.prevPadButtons.get(pad.index) ?? [];
    this.prevPadButtons.set(pad.index, buttons);
    const edge = (i: number) => (buttons[i] ?? false) && !(prevButtons[i] ?? false);
    const down = (i: number) => buttons[i] ?? false;

    const frame: InputFrame = {
      moveX: 0,
      moveZ: 0,
      pass: down(PAD.A) || down(PAD.LB) || down(PAD.LT),
      spike: down(PAD.B) || down(PAD.RB) || down(PAD.RT),
      jump: edge(PAD.Y),
      feed: edge(PAD.X),
    };
    const sx = pad.axes[0] ?? 0;
    // Stick up is negative on gamepads; up should mean away from the camera.
    const sz = -(pad.axes[1] ?? 0);
    const mag = Math.hypot(sx, sz);
    if (mag > STICK_DEADZONE) {
      // Rescale so movement starts at zero just outside the deadzone.
      const scaled = Math.min((mag - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1) / mag;
      frame.moveX = sx * scaled;
      frame.moveZ = sz * scaled;
    }
    return frame;
  }
}

function layoutFor(pad: Gamepad): ButtonLayout {
  if (pad.mapping === 'standard') return STANDARD_LAYOUT;
  return /xbox|045e/i.test(pad.id) ? XBOX_RAW_LAYOUT : STANDARD_LAYOUT;
}
