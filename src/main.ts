import { botIntent } from './ai/bot';
import { Sfx } from './audio/sfx';
import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import {
  LocalInput,
  PASS_KEY_LABEL,
  SPIKE_KEY_LABEL,
  type InputFrame,
  type KeyboardScheme,
  type MenuDevice,
  type MenuPress,
} from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import { CHARACTERS, SEAT_CHARACTERS, type CharacterKind } from './render/roster';
import type { MissReason } from './sim/hit';
import { chargePower, isDiving, type Player } from './sim/player';
import { DT } from './sim/time';
import { createMatch, otherTeam, resetRally, restartGame, stepWorld, type PointReason, type SimEvent, type Team } from './sim/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stats = document.querySelector('#hud .stats') as HTMLElement;
const last = document.querySelector('#hud .last') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const help = document.getElementById('help') as HTMLElement;
const soundButton = document.getElementById('sound') as HTMLButtonElement;
const prompt = document.getElementById('prompt') as HTMLElement;
// Seats: Blue 1, Blue 2, Red 1, Red 2 (the 2s only in 2v2).
const seatButtons = [0, 1, 2, 3].map((i) => document.getElementById(`seat${i}`)) as HTMLButtonElement[];
// Next to each seat: which character plays it (click to cycle).
const pickButtons = [0, 1, 2, 3].map((i) => document.getElementById(`pick${i}`)) as HTMLButtonElement[];
const modeButton = document.getElementById('mode') as HTMLButtonElement;
const formatButton = document.getElementById('format') as HTMLButtonElement;

const TEAM_NAMES = ['Blue', 'Red'];
const TEAM_CSS = ['#5b8cff', '#ff6b5b'];

const renderer = new Renderer(canvas);
const sfx = new Sfx();
// "Stage 1" from Chiptune Adventures by Juhani Junkala, CC0 (public domain).
// A seamless loop; credit isn't required but is shown on screen and in the README.
void sfx.playMusic('music/chiptune-adventures-stage-1.m4a');
soundButton.addEventListener('click', () => {
  sfx.unlock();
  canvas.focus();
});
// The tuning panel (` toggles it on its own).
const tuningPane = createTuningPane(tuning);
// The stats panel, and with it the tuning panel: hidden until you turn them
// on (the Stats button or I); the × hides them again. Remembered on this browser.
const statsPanel = document.querySelector('#hud .panel') as HTMLElement;
const statsButton = document.getElementById('statsToggle') as HTMLButtonElement;
const STATS_SHOWN_KEY = 'roundnet.statsShown';
function setStatsHidden(hidden: boolean): void {
  statsPanel.classList.toggle('hidden', hidden);
  tuningPane.hidden = hidden;
  statsButton.textContent = hidden ? '📊 Show stats' : '📊 Hide stats';
  try {
    localStorage.setItem(STATS_SHOWN_KEY, hidden ? '0' : '1');
  } catch {
    // Storage can be unavailable (private mode); the panel still works.
  }
}
let statsShown = false;
try {
  statsShown = localStorage.getItem(STATS_SHOWN_KEY) === '1';
} catch {
  // Hidden by default.
}
setStatsHidden(!statsShown);
(document.getElementById('closeStats') as HTMLButtonElement).addEventListener('click', () => {
  setStatsHidden(true);
  canvas.focus();
});
statsButton.addEventListener('click', () => {
  setStatsHidden(!statsPanel.classList.contains('hidden'));
  statsButton.blur();
  canvas.focus();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) sfx.muted = !sfx.muted;
  if (e.code === 'KeyI' && !e.repeat) setStatsHidden(!statsPanel.classList.contains('hidden'));
});
// Per player: whether their charge was already full, to ding once on reaching it.
const chargeWasFull = [false, false, false, false];
const input = new LocalInput(window);
const world = createMatch(tuning, 'match', '2v2');
canvas.focus();

let prev = snapshot(world);
let accumulator = 0;
let lastTime = performance.now();
let flashTimer = 0;
// A device is a keyboard scheme, the CPU, or a gamepad.
type Device = KeyboardScheme | 'cpu' | Gamepad;
// Who drives each player right now (for rumble).
let currentDevices: Device[] = [];

/** Rumble a player's controller, if they're on one: `strong` / `weak` motors 0..1, for `ms`. */
function rumble(playerId: number, strong: number, weak: number, ms: number): void {
  const d = currentDevices[playerId];
  if (!d || typeof d === 'string') return;
  const pad = navigator.getGamepads?.()[d.index];
  const actuator = pad?.vibrationActuator as { playEffect?: (type: string, params: object) => Promise<unknown> } | null | undefined;
  void actuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {});
}

// Practice (endless rallies) or Match (scored games), toggled on screen.
modeButton.addEventListener('click', () => {
  restartGame(world, tuning, world.mode === 'match' ? 'practice' : 'match');
  modeButton.textContent = world.mode === 'match' ? '🏆 Match (to 11)' : '🎯 Practice';
  rally = 0;
  modeButton.blur();
  canvas.focus();
});
// 1v1 or 2v2, toggled on screen (restarts the game).
formatButton.addEventListener('click', () => {
  restartGame(world, tuning, world.mode, world.format === '2v2' ? '1v1' : '2v2');
  rally = 0;
  refreshSeats();
  formatButton.blur();
  canvas.focus();
});
// Ticks since the game ended; with no humans playing, the CPUs rematch on their own.
let gameOverTicks = 0;

// Who plays each seat (Blue 1, Blue 2, Red 1, Red 2): a human or the CPU,
// toggled with the on-screen buttons. Default: all CPU (watch AI vs AI)
// until someone takes a seat. In 1v1 only the "1" seats are used.
const human = [false, false, false, false];

/** A player's seat: Blue 1, Blue 2, Red 1, Red 2 = 0..3. */
function seatOf(p: Player): number {
  return p.team * 2 + world.players.filter((q) => q.team === p.team).indexOf(p);
}

function isHuman(playerId: number): boolean {
  const p = world.players[playerId];
  return p !== undefined && human[seatOf(p)];
}

/** A player's name: "Blue", or "Blue 1" / "Blue 2" in 2v2. */
function playerName(p: Player): string {
  const slot = seatOf(p) % 2;
  return world.format === '2v2' ? `${TEAM_NAMES[p.team]} ${slot + 1}` : TEAM_NAMES[p.team];
}

function playerSpan(p: Player): string {
  return `<span style="color:${TEAM_CSS[p.team]}">${playerName(p)}</span>`;
}

// The character in each seat; remembered on this browser.
const CHARACTERS_KEY = 'roundnet.characters';
const seatCharacters: CharacterKind[] = [...SEAT_CHARACTERS];
try {
  const saved = JSON.parse(localStorage.getItem(CHARACTERS_KEY) ?? 'null') as unknown;
  if (Array.isArray(saved)) {
    saved.forEach((kind, seat) => {
      if (seat < 4 && CHARACTERS.some((c) => c.kind === kind)) seatCharacters[seat] = kind as CharacterKind;
    });
  }
} catch {
  // Defaults it is.
}
renderer.setSeatCharacters(seatCharacters);
pickButtons.forEach((button, seat) => {
  button.addEventListener('click', () => {
    const i = CHARACTERS.findIndex((c) => c.kind === seatCharacters[seat]);
    seatCharacters[seat] = CHARACTERS[(i + 1) % CHARACTERS.length].kind;
    renderer.setSeatCharacters(seatCharacters);
    try {
      localStorage.setItem(CHARACTERS_KEY, JSON.stringify(seatCharacters));
    } catch {
      // Not remembered; still works for this visit.
    }
    refreshSeats();
    button.blur();
    canvas.focus();
  });
});

function refreshSeats(): void {
  seatButtons.forEach((button, seat) => {
    const team = seat < 2 ? 0 : 1;
    const slot = seat % 2;
    const used = world.format === '2v2' || slot === 0;
    (button.parentElement as HTMLElement).style.display = used ? '' : 'none';
    const character = CHARACTERS.find((c) => c.kind === seatCharacters[seat]);
    pickButtons[seat].textContent = `${character?.name ?? ''} ▸`;
    pickButtons[seat].title = 'Click to change character';
    const name = world.format === '2v2' ? `${TEAM_NAMES[team]} ${slot + 1}` : TEAM_NAMES[team];
    button.textContent = human[seat] ? `🎮 ${name}: Human` : `🤖 ${name}: CPU`;
  });
  formatButton.textContent = world.format === '2v2' ? '👥 2v2' : '👤 1v1';
}
// Which device claimed each seat on the join screen (null: none; the seat's
// human/CPU toggle then decides, and humans get devices in seat order).
const seatBinding: (MenuDevice | null)[] = [null, null, null, null];

seatButtons.forEach((button, seat) => {
  button.addEventListener('click', () => {
    human[seat] = !human[seat];
    seatBinding[seat] = null;
    refreshSeats();
    button.blur();
    canvas.focus();
  });
});
refreshSeats();

/**
 * Decide which device drives each player (by player index). Humans get
 * controllers in seat order; any human left over gets the keyboard (the
 * whole keyboard for one, or a WASD half and an arrow-keys half for two).
 * Players not set to human, and humans beyond the two keyboard halves when
 * there aren't enough controllers, are the CPU.
 */
function assignDevices(): Device[] {
  const pads = input.gamepads();
  const devices: Device[] = world.players.map(() => 'cpu');
  const bySeat = [...world.players].sort((a, b) => seatOf(a) - seatOf(b));
  // Seats claimed on the join screen use the device that claimed them. A
  // lone keyboard player gets the whole keyboard.
  const keyboardJoined = bySeat.filter((p) => human[seatOf(p)] && typeof seatBinding[seatOf(p)] === 'string').length;
  const takenPads = new Set(seatBinding.filter((b): b is number => typeof b === 'number'));
  const needKeyboard: number[] = [];
  const freePads = pads.filter((pad) => !takenPads.has(pad.index));
  let nextPad = 0;
  for (const p of bySeat) {
    const seat = seatOf(p);
    if (!human[seat]) continue;
    const bound = seatBinding[seat];
    if (typeof bound === 'number') {
      const pad = pads.find((pd) => pd.index === bound);
      if (pad) devices[p.id] = pad;
    } else if (bound === 'left' || bound === 'right') {
      devices[p.id] = bound;
    } else if (nextPad < freePads.length) {
      // Seats set to human from the menu: controllers in seat order, then the keyboard.
      devices[p.id] = freePads[nextPad++];
    } else {
      needKeyboard.push(p.id);
    }
  }
  if (keyboardJoined === 1) {
    // One keyboard joiner: the whole keyboard, unless another human needs
    // it, who then gets the other half.
    const joiner = bySeat.find((p) => human[seatOf(p)] && typeof seatBinding[seatOf(p)] === 'string');
    const half = joiner ? devices[joiner.id] : 'left';
    if (needKeyboard.length === 0 && joiner) devices[joiner.id] = 'all';
    else if (needKeyboard.length > 0) devices[needKeyboard[0]] = half === 'left' ? 'right' : 'left';
  } else if (keyboardJoined > 1) {
    // Both halves are taken.
  } else if (needKeyboard.length === 1) {
    devices[needKeyboard[0]] = 'all';
  } else if (needKeyboard.length >= 2) {
    [devices[needKeyboard[0]], devices[needKeyboard[1]]] = ['left', 'right'];
  }
  return devices;
}

/** Turn a human's stick from screen directions into world directions: up is always away from the camera. */
function followCamera(frame: InputFrame): InputFrame {
  const yaw = renderer.viewYaw();
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { ...frame, moveX: frame.moveX * c + frame.moveZ * s, moveZ: -frame.moveX * s + frame.moveZ * c };
}

function deviceName(d: Device): string {
  if (d === 'cpu') return 'CPU';
  if (d === 'all') return 'Keyboard';
  if (d === 'left') return 'WASD keys';
  if (d === 'right') return 'Arrow keys';
  return 'Controller';
}

/** Controls help for one device. */
function controlsHelp(d: Device): string {
  if (d === 'cpu') return '';
  if (d === 'right') return 'arrows move · hold , pass/serve · hold . spike · / jump';
  if (d === 'all' || d === 'left') return 'WASD move · hold J pass/serve · hold K spike · Space jump · R reset ball';
  return 'stick move · hold A pass/serve · hold B spike · Y jump · View reset ball';
}

// Pause: freezes the game and all sound. The on-screen button, Esc / P, or
// any controller's Menu (Start) button toggles it.
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const pauseOverlay = document.getElementById('paused') as HTMLElement;
let paused = false;
function setPaused(on: boolean): void {
  paused = on;
  sfx.setPaused(on);
  pauseOverlay.style.display = on ? 'flex' : 'none';
  pauseButton.textContent = on ? '▶ Resume' : '⏸ Pause';
  if (on) {
    setFocus(document.getElementById('resume') as HTMLButtonElement);
  } else {
    if (joinOpen) closeJoin();
    setFocus(null);
    // Ignore keys pressed while paused.
    input.clearPresses();
  }
}
pauseButton.addEventListener('click', () => {
  setPaused(!paused);
  pauseButton.blur();
  canvas.focus();
});
(document.getElementById('resume') as HTMLButtonElement).addEventListener('click', () => {
  setPaused(false);
  canvas.focus();
});

// Driving the pause menu with a controller or the keyboard: a highlighted
// button moves with the stick / d-pad / arrows / WASD; A (J, Enter) presses it;
// B (K) resumes.
let focused: HTMLButtonElement | null = null;
function menuButtons(): HTMLButtonElement[] {
  return [...pauseOverlay.querySelectorAll('button')].filter((b) => b.offsetParent !== null) as HTMLButtonElement[];
}
function setFocus(button: HTMLButtonElement | null): void {
  focused?.classList.remove('focus');
  focused = button;
  focused?.classList.add('focus');
}
/** Move the highlight to the nearest button in a direction. */
function moveFocus(dir: 'up' | 'down' | 'left' | 'right'): void {
  const buttons = menuButtons();
  if (!focused || !buttons.includes(focused)) return setFocus(buttons[0] ?? null);
  const from = focused.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLButtonElement | null = null;
  let bestScore = Infinity;
  for (const b of buttons) {
    if (b === focused) continue;
    const r = b.getBoundingClientRect();
    const dx = r.left + r.width / 2 - fx;
    const dy = r.top + r.height / 2 - fy;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (along <= 4) continue;
    // Left / right stay within the row.
    if ((dir === 'left' || dir === 'right') && Math.abs(dy) > r.height / 2) continue;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (best) setFocus(best);
}

// The join screen (from the pause menu): each controller or keyboard half
// presses A / J / , to claim a seat, moves between free seats with left /
// right, and leaves with B / K / .
const pauseMenu = pauseOverlay.querySelector('.menu') as HTMLElement;
const joinView = document.getElementById('join') as HTMLElement;
const joinSeats = joinView.querySelector('.joinSeats') as HTMLElement;
let joinOpen = false;
function openJoin(): void {
  joinOpen = true;
  pauseMenu.style.display = 'none';
  joinView.style.display = '';
  setFocus(null);
  renderJoin();
}
function closeJoin(): void {
  joinOpen = false;
  pauseMenu.style.display = '';
  joinView.style.display = 'none';
  refreshSeats();
  setFocus(document.getElementById('openJoin') as HTMLButtonElement);
}
(document.getElementById('openJoin') as HTMLButtonElement).addEventListener('click', openJoin);
(document.getElementById('closeJoin') as HTMLButtonElement).addEventListener('click', closeJoin);

function seatsInPlay(): number[] {
  return [0, 1, 2, 3].filter((s) => world.format === '2v2' || s % 2 === 0);
}
function deviceLabel(d: MenuDevice): string {
  if (typeof d === 'number') return `Controller ${d + 1}`;
  const keyboards = seatBinding.filter((b) => b === 'left' || b === 'right').length;
  if (keyboards <= 1) return 'Keyboard';
  return d === 'left' ? 'Keyboard (WASD + J / K)' : 'Keyboard (arrows + , / .)';
}
function renderJoin(): void {
  joinSeats.innerHTML = seatsInPlay()
    .map((seat) => {
      const team = seat < 2 ? 0 : 1;
      const name = world.format === '2v2' ? `${TEAM_NAMES[team]} ${(seat % 2) + 1}` : TEAM_NAMES[team];
      const character = CHARACTERS.find((c) => c.kind === seatCharacters[seat])?.name ?? '';
      const bound = seatBinding[seat];
      const who = bound !== null ? `🎮 ${deviceLabel(bound)}` : human[seat] ? '🎮 Human' : '🤖 CPU · press A to join';
      return `<div class="seat${bound !== null ? ' taken' : ''}" style="--team:${TEAM_CSS[team]}"><b style="color:${TEAM_CSS[team]}">${name}</b> · ${character}<div class="who">${who}</div></div>`;
    })
    .join('');
}
function handleJoin(press: MenuPress): void {
  const seats = seatsInPlay();
  const mine = seats.find((s) => seatBinding[s] === press.device);
  const free = (s: number) => seatBinding[s] === null;
  if (press.action === 'confirm' && mine === undefined) {
    const seat = seats.find(free);
    if (seat !== undefined) {
      seatBinding[seat] = press.device;
      human[seat] = true;
    }
  } else if ((press.action === 'left' || press.action === 'right') && mine !== undefined) {
    const step = press.action === 'right' ? 1 : -1;
    const at = seats.indexOf(mine);
    for (let k = 1; k < seats.length; k++) {
      const next = seats[(at + step * k + seats.length * 4) % seats.length];
      if (!free(next)) continue;
      seatBinding[next] = press.device;
      human[next] = true;
      seatBinding[mine] = null;
      human[mine] = false;
      break;
    }
  } else if (press.action === 'back') {
    if (mine === undefined) return closeJoin();
    seatBinding[mine] = null;
    human[mine] = false;
  }
  renderJoin();
}

function handleMenu(presses: MenuPress[]): void {
  for (const press of presses) {
    if (joinOpen) {
      handleJoin(press);
      continue;
    }
    if (press.action === 'confirm') {
      if (focused && menuButtons().includes(focused)) focused.click();
      else setFocus(menuButtons()[0] ?? null);
    } else if (press.action === 'back') {
      setPaused(false);
    } else {
      moveFocus(press.action);
    }
  }
}

renderer.engine.runRenderLoop(() => {
  const now = performance.now();
  // Cap catch-up time so a background tab doesn't fast-forward the game.
  const frameSeconds = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  // The pause key closes the join screen first, then resumes.
  if (input.pollPause()) {
    if (joinOpen) closeJoin();
    else setPaused(!paused);
  }
  const menuPresses = input.pollMenu();
  if (paused) handleMenu(menuPresses);
  const devices = assignDevices();
  currentDevices = devices;
  if (paused) {
    // Frozen: keep drawing the same moment, with no time passing.
    renderer.sync(world, prev, accumulator / DT, tuning, 0);
    return;
  }
  accumulator += frameSeconds;

  // Some browsers count a controller button as permission to play sound.
  if (sfx.locked && input.gamepads().some((pad) => pad.buttons.some((b) => b.pressed))) sfx.unlock();
  while (accumulator >= DT) {
    prev = snapshot(world);
    const keyboard = input.pollKeyboard();
    const frames: InputFrame[] = devices.map((d, i) => {
      if (d === 'cpu') return { ...botIntent(world, i, tuning), feed: false };
      return followCamera(typeof d === 'string' ? keyboard[d] : input.pollGamepad(d));
    });
    if (world.ball.alive && (frames.some((f) => f.feed) || keyboard.all.feed)) resetRally(world, tuning);
    // After a game: any human pressing pass (or reset) starts a rematch.
    if (world.winner !== null) {
      gameOverTicks++;
      const humanWantsRematch = frames.some((f, i) => devices[i] !== 'cpu' && (f.pass || f.feed));
      const cpusOnly = devices.every((d) => d === 'cpu');
      if (humanWantsRematch || (cpusOnly && gameOverTicks > 240)) {
        restartGame(world, tuning);
        gameOverTicks = 0;
      }
    }
    stepWorld(world, frames, tuning);
    for (const e of world.events) onEvent(e);
    world.players.forEach((p, i) => {
      const full = p.charge !== null && chargePower(p.charge.ticks, tuning) >= 1;
      if (full && !chargeWasFull[i]) sfx.chargeFull();
      chargeWasFull[i] = full;
    });
    accumulator -= DT;
  }

  sfx.setVolume(tuning.audio.volume, tuning.audio.music, tuning.audio.duck, tuning.audio.hits);
  renderer.sync(world, prev, accumulator / DT, tuning, frameSeconds);
  updateHud(frameSeconds, devices);
});

window.addEventListener('resize', () => renderer.resize());

// Net hits by players in the current rally, and the best rally so far (jumbotron).
let rally = 0;
let bestRally = 0;

// Latest details for the dev stats panel.
type HitEvent = Extract<SimEvent, { type: 'hit' }>;
type NetEvent = Extract<SimEvent, { type: 'net' }>;
let lastHit: HitEvent | null = null;
let lastNet: NetEvent | null = null;
let lastMiss: { team: Team; reason: MissReason } | null = null;

function onEvent(e: SimEvent): void {
  if (e.type === 'swing') {
    // A tapped spike is a drop shot: play the gentle push instead of the slam.
    const drop = e.kind === 'spike' && e.power < tuning.hit.dropShotMaxPower;
    renderer.playSwing(e.playerId, drop ? 'drop' : e.kind, drop ? 0 : e.spin);
    sfx.swing(e.power);
  } else if (e.type === 'whiff') {
    lastMiss = { team: world.players[e.playerId].team, reason: e.reason };
  } else if (e.type === 'hit') {
    lastHit = e;
    lastMiss = null;
    // A light buzz for passes and drops, a thump for spikes.
    if (e.kind === 'spike') rumble(e.playerId, 0.3 + 0.6 * e.power, 0.4, 90);
    else rumble(e.playerId, 0.05, 0.35, 60);
    const mine = world.players[e.playerId].team === 0;
    // A human's hits (or everyone's, when no one is playing) at full volume.
    const featured = isHuman(e.playerId) || !world.players.some((p) => isHuman(p.id));
    sfx.hit(e.kind, e.power, e.quality, featured ? 1 : tuning.audio.cpuHits);
    if (mine && e.quality >= 1) showFlash('Perfect', '#5ee07a', 0.45);
  } else if (e.type === 'net') {
    lastNet = e;
    // The serve's bounce doesn't count; every player hit that reaches the net does.
    if (world.lastHitKind !== null) {
      rally++;
      bestRally = Math.max(bestRally, rally);
    }
    renderer.netImpact(e.speed, e.at);
    sfx.net(e.speed);
  } else if (e.type === 'ground') {
    sfx.ground();
    rally = 0;
  } else if (e.type === 'point') {
    showFlash(`Point ${TEAM_NAMES[e.team]}`, TEAM_CSS[e.team], 1);
    showReason(e.team, POINT_REASONS[e.reason](teamSpan(e.loser)));
  } else if (e.type === 'gameOver') {
    showFlash(`${TEAM_NAMES[e.winner]} wins ${Math.max(...world.score)}–${Math.min(...world.score)}!`, TEAM_CSS[e.winner], 3);
  } else if (e.type === 'toss') {
    // The toss: a gentle push of the paw.
    renderer.playSwing(e.playerId, 'drop');
    sfx.swing(0.2);
  } else if (e.type === 'serve') {
    rumble(e.playerId, 0.3 + 0.5 * e.power, 0.4, 90);
    const featured = isHuman(e.playerId) || !world.players.some((p) => isHuman(p.id));
    sfx.hit('spike', e.power, e.quality, featured ? 1 : tuning.audio.cpuHits);
  } else if (e.type === 'fault') {
    sfx.ground();
    showFlash(e.lost ? `Double fault: serve goes to ${TEAM_NAMES[1 - e.team]}` : 'Fault: 2nd serve', '#ffd84a', 1.2);
  } else if (e.type === 'dive') {
    sfx.swing(1);
  } else if (e.type === 'diveLand') {
    sfx.diveLand();
    rumble(e.playerId, 0.5, 0.2, 80);
  }
}

function teamSpan(team: Team): string {
  return `<span style="color:${TEAM_CSS[team]}">${TEAM_NAMES[team]}</span>`;
}

const MISS_MESSAGES: Record<MissReason, string> = {
  cooldown: 'too soon after the last hit',
  recovering: 'still getting up from a dive',
  noBall: 'no ball in play',
  notYet: 'too early, wait for the ball to come off the net',
  notYourBall: "not your ball, it's the other player's turn",
  noTouchesLeft: 'out of touches, it had to go on the net',
  doubleTouch: "you just touched it, your partner has to play it next",
  tooFar: 'too far away, get closer to the ball',
  tooHigh: 'ball too high, jump to reach it',
  tooLow: 'ball too low, get under it sooner',
};

function showFlash(text: string, color = '#fff', seconds = 0.9): void {
  flash.textContent = text;
  flash.style.color = color;
  flash.style.opacity = '1';
  flashTimer = seconds;
}

const row = (label: string, value: string) => `<div class="row"><span class="k">${label}</span><span class="v">${value}</span></div>`;
const section = (title: string, body: string) => `<div class="section"><h4>${title}</h4>${body}</div>`;
const percentBar = (fraction: number, color: string) =>
  `<span class="bar"><span style="width:${Math.round(fraction * 100)}%;background:${color}"></span></span>`;

function timingHtml(quality: number): string {
  const [label, color] = quality >= 1 ? ['PERFECT', '#5ee07a'] : quality >= 0.6 ? ['Good', '#ffd84a'] : ['Weak', '#ff7a6b'];
  return `<span style="color:${color}">${label}</span> ${Math.round(quality * 100)}%`;
}

function hitSection(): string {
  if (!lastHit) return section('Last hit', '<div class="empty">none yet</div>');
  const h = lastHit;
  const cm = Math.round(h.heightError * 100);
  const contact = cm === 0 ? 'ideal height' : `${Math.abs(cm)} cm ${cm > 0 ? 'high' : 'low'}`;
  return section(
    'Last hit',
    row('Player', `${playerSpan(world.players[h.playerId])} ${h.kind}`) +
      row('Timing', timingHtml(h.quality)) +
      row('Contact', contact) +
      row('Power', `${percentBar(h.power, '#ff9a3d')} ${Math.round(h.power * 100)}%`) +
      row('Launch speed', `${h.launchSpeed.toFixed(1)} m/s`),
  );
}

function netSection(): string {
  if (!lastNet) return section('Last net bounce', '<div class="empty">none yet</div>');
  return section(
    'Last net bounce',
    row('Hit the net', `${lastNet.speed.toFixed(1)} m/s ↓`) + row('Bounced up', `${lastNet.upSpeed.toFixed(1)} m/s ↑`),
  );
}

function liveSection(devices: Device[]): string {
  const b = world.ball;
  const ballSpeed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  let body = row('Ball', `${ballSpeed.toFixed(1)} m/s · ${b.pos.y.toFixed(2)} m up`);
  world.players.forEach((p, i) => {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const air = p.grounded ? '' : ` · air ${p.pos.y.toFixed(2)} m`;
    const dive = !p.dive ? '' : isDiving(p, tuning) ? ' · diving' : ' · getting up';
    body += row(`${playerSpan(p)} <small>${deviceName(devices[i])}</small>`, `${speed.toFixed(1)} m/s${air}${dive}`);
    if (p.charge) {
      const power = chargePower(p.charge.ticks, tuning);
      body += row(`&nbsp;&nbsp;charging ${p.charge.kind}`, `${percentBar(power, '#ff9a3d')} ${Math.round(power * 100)}%`);
    }
  });
  return section('Live', body);
}

// Why a point ended, shown quietly near the bottom for a few seconds.
const reasonEl = document.getElementById('reason') as HTMLElement;
let reasonTimer: ReturnType<typeof setTimeout> | undefined;
const POINT_REASONS: Record<PointReason, (loser: string) => string> = {
  doubleFault: (l) => `${l} double faulted`,
  ace: (l) => `Ace: ${l} couldn't return the serve`,
  notReached: (l) => `${l} didn't get to the ball`,
  missedNet: (l) => `${l}'s shot missed the net`,
  outOfTouches: (l) => `${l} used all ${tuning.match.maxTouches} touches without hitting the net`,
  dropped: (l) => `${l} let the ball drop`,
};
function showReason(winner: Team, text: string): void {
  reasonEl.innerHTML = `${teamSpan(winner)} point · ${text}`;
  reasonEl.style.opacity = '1';
  clearTimeout(reasonTimer);
  reasonTimer = setTimeout(() => (reasonEl.style.opacity = '0'), 3500);
}

// Touches used by the team with the ball (match mode, while it's in play).
const touchesEl = document.getElementById('touches') as HTMLElement;
const touchDots = [...touchesEl.querySelectorAll('.dot')] as HTMLElement[];
const touchNote = touchesEl.querySelector('.note') as HTMLElement;
function updateTouches(): void {
  const max = tuning.match.maxTouches;
  const inPlay = world.mode === 'match' && world.ball.alive && !world.waitingForServe && !world.serve.inFlight;
  touchesEl.style.display = inPlay ? 'flex' : 'none';
  if (!inPlay) return;
  const team = world.possession;
  touchesEl.style.setProperty('--team', TEAM_CSS[team]);
  const used = world.touches;
  touchDots.forEach((dot, i) => {
    dot.style.display = i < max ? '' : 'none';
    dot.classList.toggle('used', i < used);
    // The last touch left: it has to go onto the net.
    dot.classList.toggle('last', i === max - 1 && used === max - 1);
  });
  touchNote.textContent = used === max - 1 ? 'LAST · ONTO THE NET' : used >= max ? 'NONE LEFT' : '';
}

// The match scoreboard (top center), shown in match mode only.
const scoreboard = document.getElementById('scoreboard') as HTMLElement;
const scoreEls = [...scoreboard.querySelectorAll('.pts')] as HTMLElement[];
const serveEls = [...scoreboard.querySelectorAll('.serve')] as HTMLElement[];
const scoreMid = scoreboard.querySelector('.mid') as HTMLElement;
const shownScore = [-1, -1];

function updateScoreboard(): void {
  const match = world.mode === 'match';
  scoreboard.style.display = match ? 'flex' : 'none';
  if (!match) return;
  world.score.forEach((points, team) => {
    if (points === shownScore[team]) return;
    // A quick pop when a score changes (not on the first draw).
    if (shownScore[team] >= 0) {
      scoreEls[team].classList.add('bump');
      setTimeout(() => scoreEls[team].classList.remove('bump'), 180);
    }
    shownScore[team] = points;
    scoreEls[team].textContent = String(points);
  });
  // The serving team gets the ball marker.
  const serving = otherTeam(world.nextReceiver);
  serveEls.forEach((el, team) => el.classList.toggle('on', world.winner === null && team === serving));
  const [a, b] = world.score;
  const target = tuning.match.pointsToWin;
  const leader = a > b ? 0 : 1;
  scoreMid.textContent =
    world.winner !== null
      ? `${TEAM_NAMES[world.winner].toUpperCase()} WINS`
      : a === b && a >= target - 1
        ? 'WIN BY 2'
        : Math.max(a, b) >= target - 1 && a !== b
          ? `GAME POINT ${TEAM_NAMES[leader].toUpperCase()}`
          : `FIRST TO ${target}`;
}

function updateHud(frameSeconds: number, devices: Device[]): void {
  const team: Team = world.possession;
  const serverPlayer = world.players[world.serve.serverId] ?? world.players[0];
  const receiverPlayer = world.players[world.serve.receiverId] ?? world.players[0];
  const serverDevice = devices[serverPlayer.id];
  const showServePrompt = world.waitingForServe && world.winner === null;
  prompt.style.display = showServePrompt ? 'block' : 'none';
  if (showServePrompt) {
    const keyboard = typeof serverDevice === 'string' && serverDevice !== 'cpu';
    const tossKey = keyboard ? PASS_KEY_LABEL[serverDevice] : 'A';
    const hitKey = keyboard ? SPIKE_KEY_LABEL[serverDevice] : 'B';
    const second = world.serve.faults > 0 ? ' <small>(2nd serve)</small>' : '';
    prompt.innerHTML =
      serverDevice === 'cpu'
        ? `${playerSpan(serverPlayer)} is serving…${second}`
        : world.serve.tossed
          ? `${playerSpan(serverPlayer)}: hold <b>${hitKey}</b>, release as it drops to chest height (stick ←→ = spin)${second}`
          : `${playerSpan(serverPlayer)}: stick aims · <b>${tossKey}</b> to toss${second}`;
  }
  const match = world.mode === 'match';
  const status =
    world.winner !== null
      ? `${teamSpan(world.winner)} wins! Press A / J for a rematch`
      : world.waitingForServe
        ? `${playerSpan(serverPlayer)} serves to ${playerSpan(receiverPlayer)}`
        : world.ball.lastTouch === 'feed'
          ? `${teamSpan(team)} serves to ${teamSpan(team === 0 ? 1 : 0)}`
          : world.ball.alive
            ? `${teamSpan(team)}'s ball`
            : 'Ball down, next serve coming';
  stats.innerHTML = status;
  updateScoreboard();
  updateTouches();
  renderer.setJumbotron(
    match ? `${world.score[0]} – ${world.score[1]}` : `RALLY ${rally}`,
    match ? (world.winner !== null ? `${TEAM_NAMES[world.winner].toUpperCase()} WINS` : `FIRST TO ${tuning.match.pointsToWin}`) : `BEST ${bestRally}`,
  );

  const miss = lastMiss ? `<div class="miss">${teamSpan(lastMiss.team)} missed: ${MISS_MESSAGES[lastMiss.reason]}</div>` : '';
  last.innerHTML = hitSection() + miss + netSection() + liveSection(devices);
  if (flashTimer > 0 && (flashTimer -= frameSeconds) <= 0) flash.style.opacity = '0';

  soundButton.style.display = sfx.locked ? 'block' : 'none';
  const sound = sfx.muted ? 'Sound muted (M)' : 'M mute';
  const side = (p: Player) => {
    const d = devices[p.id];
    return d === 'cpu' ? `${playerName(p)}: CPU` : `${playerName(p)} (${deviceName(d)}): ${controlsHelp(d)}`;
  };
  help.textContent =
    `${sound} · Esc / P / Menu pause · I stats · \` tuning · swing at a ball just out of reach to dive   |   ${world.players.map(side).join('   |   ')}`;
}
