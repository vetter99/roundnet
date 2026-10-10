import { botIntent } from './ai/bot';
import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import { LocalInput, type InputFrame } from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import { MAX_TOUCHES, type MissReason } from './sim/hit';
import { DT } from './sim/time';
import { createWorld, restartMatch, serve, stepWorld, type SimEvent, type Team } from './sim/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stats = document.querySelector('#hud .stats') as HTMLElement;
const last = document.querySelector('#hud .last') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const help = document.getElementById('help') as HTMLElement;

const TEAM_NAMES = ['Blue', 'Red'];
const TEAM_CSS = ['#5b8cff', '#ff6b5b'];

const renderer = new Renderer(canvas);
const input = new LocalInput(window);
const world = createWorld(tuning);
createTuningPane(tuning);
canvas.focus();

let prev = snapshot(world);
let accumulator = 0;
let lastTime = performance.now();
let flashTimer = 0;
// Once someone uses the keyboard while P1 is on a controller, the keyboard
// takes over P2 from the CPU for the rest of the session.
let keyboardIsP2 = false;

type Device = 'keyboard' | 'cpu' | Gamepad;

/** Decide which device drives each player: [P1, P2]. */
function assignDevices(): [Device, Device] {
  const pads = input.gamepads();
  if (pads.length > 0 && input.keyboardUsed) keyboardIsP2 = true;
  const p1: Device = pads[0] ?? 'keyboard';
  const p2: Device = pads[1] ?? (pads[0] && keyboardIsP2 ? 'keyboard' : 'cpu');
  return [p1, p2];
}

function deviceName(d: Device): string {
  return d === 'keyboard' ? 'Keyboard' : d === 'cpu' ? 'CPU' : 'Controller';
}

renderer.engine.runRenderLoop(() => {
  const now = performance.now();
  // Cap catch-up time so a background tab doesn't fast-forward the game.
  const frameSeconds = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  accumulator += frameSeconds;

  const devices = assignDevices();
  while (accumulator >= DT) {
    prev = snapshot(world);
    const keyboard = input.pollKeyboard();
    const frames: InputFrame[] = devices.map((d, i) => {
      if (d === 'keyboard') return keyboard;
      if (d === 'cpu') return { ...botIntent(world, i, tuning), feed: false };
      return input.pollGamepad(d);
    });
    if (frames.some((f) => f.feed) || (keyboard.feed && !devices.includes('keyboard'))) {
      if (world.winner !== null) restartMatch(world, tuning);
      else serve(world, world.nextReceiver, tuning);
    }
    stepWorld(world, frames, tuning);
    for (const e of world.events) onEvent(e);
    accumulator -= DT;
  }

  renderer.sync(world, prev, accumulator / DT, tuning, frameSeconds);
  updateHud(frameSeconds, devices);
});

window.addEventListener('resize', () => renderer.resize());

function onEvent(e: SimEvent): void {
  if (e.type === 'swing') {
    renderer.playSwing(e.playerId, e.kind);
  } else if (e.type === 'whiff') {
    last.textContent = `${playerLabel(e.playerId)} missed: ${MISS_MESSAGES[e.reason]}`;
  } else if (e.type === 'hit') {
    const pct = Math.round(e.quality * 100);
    const label = e.quality >= 1 ? 'PERFECT' : e.quality >= 0.6 ? 'Good' : 'Weak';
    last.textContent = `${playerLabel(e.playerId)}: ${e.kind} · ${label} (${pct}%) · power ${Math.round(e.power * 100)}%`;
    if (e.quality >= 1) showFlash('PERFECT');
  } else if (e.type === 'point') {
    showFlash(`Point ${TEAM_NAMES[e.team]}!`, TEAM_CSS[e.team]);
  } else if (e.type === 'gameOver') {
    showFlash(`${TEAM_NAMES[e.winner]} wins!`, TEAM_CSS[e.winner], Infinity);
  }
}

function playerLabel(playerId: number): string {
  return TEAM_NAMES[world.players[playerId].team];
}

const MISS_MESSAGES: Record<MissReason, string> = {
  cooldown: 'too soon after the last hit',
  noBall: 'no ball in play',
  notYet: 'too early, wait for the ball to come off the net',
  notYourBall: "not your ball, it's the other team's turn",
  noTouchesLeft: `out of touches (${MAX_TOUCHES} max)`,
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

function updateHud(frameSeconds: number, devices: [Device, Device]): void {
  const [blue, red] = world.score;
  const team: Team = world.possession;
  stats.innerHTML =
    `<span style="color:${TEAM_CSS[0]}">Blue ${blue}</span> – <span style="color:${TEAM_CSS[1]}">${red} Red</span>` +
    `<div style="font-size:14px;margin-top:4px">` +
    (world.winner !== null
      ? 'Press X / R for a rematch'
      : world.ball.lastTouch === 'feed'
        ? `<span style="color:${TEAM_CSS[team]}">${TEAM_NAMES[team]}</span> serves to ` +
          `<span style="color:${TEAM_CSS[1 - team]}">${TEAM_NAMES[1 - team]}</span>`
        : `<span style="color:${TEAM_CSS[team]}">${TEAM_NAMES[team]}'s ball</span> · touches ${world.touches} / ${MAX_TOUCHES}`) +
    `</div>`;
  if (flashTimer > 0 && (flashTimer -= frameSeconds) <= 0) flash.style.opacity = '0';

  const join = devices[1] === 'cpu' ? ' (press a key or connect a 2nd controller to play)' : '';
  help.textContent =
    `Blue: ${deviceName(devices[0])} · Red: ${deviceName(devices[1])}${join}   |   ` +
    `Controller: stick move/aim · hold A pass · hold B spike · Y jump · X new serve   |   ` +
    `Keyboard: WASD · hold J pass · hold K spike · Space jump · R new serve · \` tuning`;
}
