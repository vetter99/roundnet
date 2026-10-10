import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import { LocalInput } from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import type { MissReason } from './sim/hit';
import { DT } from './sim/time';
import { createWorld, feedBall, stepWorld, type SimEvent } from './sim/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stats = document.querySelector('#hud .stats') as HTMLElement;
const last = document.querySelector('#hud .last') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const help = document.getElementById('help') as HTMLElement;

const renderer = new Renderer(canvas);
const input = new LocalInput(window);
const world = createWorld(tuning);
createTuningPane(tuning);
canvas.focus();

let prev = snapshot(world);
let accumulator = 0;
let lastTime = performance.now();
let flashTimer = 0;

renderer.engine.runRenderLoop(() => {
  const now = performance.now();
  // Cap catch-up time so a background tab doesn't fast-forward the game.
  const frameSeconds = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  accumulator += frameSeconds;

  while (accumulator >= DT) {
    prev = snapshot(world);
    const frame = input.poll();
    if (frame.feed) feedBall(world, tuning);
    stepWorld(world, [frame], tuning);
    for (const e of world.events) onEvent(e);
    accumulator -= DT;
  }

  renderer.sync(world, prev, accumulator / DT, tuning, frameSeconds);
  updateHud(frameSeconds);
});

window.addEventListener('resize', () => renderer.resize());

function onEvent(e: SimEvent): void {
  if (e.type === 'swing') {
    renderer.playSwing(e.playerId, e.kind);
  } else if (e.type === 'whiff') {
    last.textContent = `Missed: ${MISS_MESSAGES[e.reason]}`;
  } else if (e.type === 'hit') {
    const pct = Math.round(e.quality * 100);
    const label = e.quality >= 1 ? 'PERFECT' : e.quality >= 0.6 ? 'Good' : 'Weak';
    last.textContent = `Last hit: ${e.kind} · ${label} (${pct}%)`;
    if (e.quality >= 1) showFlash('PERFECT');
  } else if (e.type === 'rim') {
    showFlash('RIM!');
  }
}

const MISS_MESSAGES: Record<MissReason, string> = {
  cooldown: 'too soon after your last hit',
  noBall: 'no ball in play (press X or R for a new one)',
  notYet: 'too early, wait for the ball to come off the net',
  tooFar: 'too far away, get closer to the ball',
  tooHigh: 'ball too high, jump to reach it',
  tooLow: 'ball too low, get under it sooner',
};

function showFlash(text: string): void {
  flash.textContent = text;
  flash.style.opacity = '1';
  flashTimer = 0.6;
}

function updateHud(frameSeconds: number): void {
  stats.textContent = `Returns in a row: ${world.streak}   Best: ${Math.max(world.bestStreak, world.streak)}`;
  if (flashTimer > 0 && (flashTimer -= frameSeconds) <= 0) flash.style.opacity = '0';
  const held = input.padButtonsHeld.length ? input.padButtonsHeld.join(', ') : 'none';
  const pad = input.padName
    ? `Controller: stick move/aim · A pass · B spike · Y jump · X new ball  [${input.padMapping} layout, buttons held: ${held}]`
    : 'Plug in a controller and press a button to use it';
  help.textContent = `Keyboard: WASD move/aim · J pass · K spike · Space jump · R new ball · \` tuning  |  ${pad}`;
}
