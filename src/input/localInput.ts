import type { Intent } from '../sim/player';

export interface InputFrame extends Intent {
  // End the current rally now (e.g. if the ball gets stuck).
  feed: boolean;
}

const STICK_DEADZONE = 0.2;

/** A menu control: a direction, confirm (A / J / ,) or back (B / K / .). */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
/** Which device pressed it: a gamepad index, or a keyboard half. */
export type MenuDevice = number | 'left' | 'right';
export interface MenuPress {
  device: MenuDevice;
  action: MenuAction;
}

// Menu keys per keyboard half.
const MENU_KEYS: Record<'left' | 'right', Partial<Record<string, MenuAction>>> = {
  left: { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyJ: 'confirm', KeyK: 'back' },
  right: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Comma: 'confirm', Enter: 'confirm', Period: 'back', Backspace: 'back' },
};
// Standard-layout d-pad buttons.
const DPAD: [number, MenuAction][] = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']];
// How far the stick must be pushed to count as a menu direction.
const MENU_STICK = 0.6;

type ButtonLayout = Record<'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'VIEW' | 'MENU', number>;

// Standard gamepad layout (Xbox naming; PlayStation/Switch map to the same slots).
// (VIEW is Back/View/Share/Select, left of the center button; MENU is
// Start/Menu/Options, right of it: the usual pause button.)
const STANDARD_LAYOUT: ButtonLayout = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9 };
// Xbox controllers over Bluetooth can report a raw layout (mapping !== 'standard')
// that skips slots 2 and 5, with the triggers reported as axes instead of buttons.
const XBOX_RAW_LAYOUT: ButtonLayout = { A: 0, B: 1, X: 3, Y: 4, LB: 6, RB: 7, LT: -1, RT: -1, VIEW: 10, MENU: 11 };

// Keys that pause and resume the game.
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

type KeyMap = Record<'up' | 'down' | 'left' | 'right' | 'jump' | 'pass' | 'spike' | 'feed', string[]>;

/**
 * Keyboard layouts. 'all' is for one player (either set of movement keys);
 * 'left' and 'right' split one keyboard between two players.
 */
export type KeyboardScheme = 'all' | 'left' | 'right';

const KEYMAPS: Record<KeyboardScheme, KeyMap> = {
  all: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space'],
    pass: ['KeyJ'],
    spike: ['KeyK'],
    feed: ['KeyR'],
  },
  left: {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    jump: ['Space'],
    pass: ['KeyJ'],
    spike: ['KeyK'],
    feed: ['KeyR'],
  },
  right: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    jump: ['Slash'],
    pass: ['Comma'],
    spike: ['Period'],
    feed: [],
  },
};

/** The key shown in prompts for passing/serving in each scheme. */
export const PASS_KEY_LABEL: Record<KeyboardScheme, string> = { all: 'J', left: 'J', right: ',' };
/** The key shown in prompts for spiking (and hitting the serve) in each scheme. */
export const SPIKE_KEY_LABEL: Record<KeyboardScheme, string> = { all: 'K', left: 'K', right: '.' };

const CAPTURED_KEYS = new Set(Object.values(KEYMAPS).flatMap((map) => Object.values(map).flat()));

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
  // Pause presses since the last check, from the keyboard, and each pad's
  // pause button last time (tracked apart from pollGamepad, which only runs
  // for pads driving a player).
  private pauseKeyPressed = false;
  private readonly prevPauseButton = new Map<number, boolean>();
  // Menu presses since the last pollMenu, and each pad's menu state last time.
  private readonly menuPresses: MenuPress[] = [];
  private readonly prevMenuPad = new Map<number, Set<MenuAction>>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (CAPTURED_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      if (!e.repeat && PAUSE_KEYS.has(e.code)) this.pauseKeyPressed = true;
      if (!e.repeat) {
        for (const half of ['left', 'right'] as const) {
          const action = MENU_KEYS[half][e.code];
          if (action) this.menuPresses.push({ device: half, action });
        }
      }
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /**
   * Read the keyboard once per tick, as a frame for each scheme (so two
   * players can share one keyboard). Presses since the last poll are cleared.
   */
  pollKeyboard(): Record<KeyboardScheme, InputFrame> {
    const isHeld = (codes: string[]) => codes.some((c) => this.held.has(c));
    const wasPressed = (codes: string[]) => codes.some((c) => this.pressed.has(c));
    const read = (keys: KeyMap): InputFrame => ({
      moveX: (isHeld(keys.right) ? 1 : 0) - (isHeld(keys.left) ? 1 : 0),
      moveZ: (isHeld(keys.up) ? 1 : 0) - (isHeld(keys.down) ? 1 : 0),
      jump: wasPressed(keys.jump),
      // Held, not pressed: holding charges the hit and releasing swings.
      pass: isHeld(keys.pass),
      spike: isHeld(keys.spike),
      feed: wasPressed(keys.feed),
    });
    const frames = { all: read(KEYMAPS.all), left: read(KEYMAPS.left), right: read(KEYMAPS.right) };
    this.pressed.clear();
    return frames;
  }

  /** True once for each press of a pause key (Esc, P) or any controller's Menu/Start button. */
  pollPause(): boolean {
    let pressed = this.pauseKeyPressed;
    this.pauseKeyPressed = false;
    for (const pad of this.gamepads()) {
      const i = layoutFor(pad).MENU;
      const down = pad.buttons[i]?.pressed ?? false;
      if (down && !(this.prevPauseButton.get(pad.index) ?? false)) pressed = true;
      this.prevPauseButton.set(pad.index, down);
    }
    return pressed;
  }

  /**
   * Menu presses since the last call, from the keyboard halves and every
   * gamepad (d-pad or left stick, A, B), each tagged with its device.
   */
  pollMenu(): MenuPress[] {
    const presses = this.menuPresses.splice(0);
    for (const pad of this.gamepads()) {
      const layout = layoutFor(pad);
      const down = new Set<MenuAction>();
      const isDown = (i: number) => i >= 0 && (pad.buttons[i]?.pressed ?? false);
      if (isDown(layout.A)) down.add('confirm');
      if (isDown(layout.B)) down.add('back');
      if (pad.mapping === 'standard') for (const [i, action] of DPAD) if (isDown(i)) down.add(action);
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (x < -MENU_STICK) down.add('left');
      if (x > MENU_STICK) down.add('right');
      if (y < -MENU_STICK) down.add('up');
      if (y > MENU_STICK) down.add('down');
      const prev = this.prevMenuPad.get(pad.index) ?? new Set();
      for (const action of down) if (!prev.has(action)) presses.push({ device: pad.index, action });
      this.prevMenuPad.set(pad.index, down);
    }
    return presses;
  }

  /** Forget key presses made while the game wasn't reading them (e.g. while paused). */
  clearPresses(): void {
    this.pressed.clear();
    this.menuPresses.length = 0;
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
      feed: edge(PAD.VIEW),
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
