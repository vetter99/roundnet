import { botIntent } from './ai/bot';
import { Sfx } from './audio/sfx';
import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import { LocalInput, type InputFrame } from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import type { MissReason } from './sim/hit';
import { chargePower } from './sim/player';
import { DT } from './sim/time';
import { createWorld, serve, stepWorld, type SimEvent, type Team } from './sim/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stats = document.querySelector('#hud .stats') as HTMLElement;
const last = document.querySelector('#hud .last') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const help = document.getElementById('help') as HTMLElement;

const TEAM_NAMES = ['Blue', 'Red'];
const TEAM_CSS = ['#5b8cff', '#ff6b5b'];

const renderer = new Renderer(canvas);
const sfx = new Sfx();
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) sfx.muted = !sfx.muted;
});
// Per player: whether their charge was already full, to ding once on reaching it.
const chargeWasFull = [false, false];
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
      serve(world, world.nextReceiver, tuning);
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

  sfx.setVolume(tuning.audio.volume);
  renderer.sync(world, prev, accumulator / DT, tuning, frameSeconds);
  updateHud(frameSeconds, devices);
});

window.addEventListener('resize', () => renderer.resize());

// Latest details for the dev stats panel.
type HitEvent = Extract<SimEvent, { type: 'hit' }>;
type NetEvent = Extract<SimEvent, { type: 'net' }>;
let lastHit: HitEvent | null = null;
let lastNet: NetEvent | null = null;
let lastMiss: { team: Team; reason: MissReason } | null = null;

function onEvent(e: SimEvent): void {
  if (e.type === 'swing') {
    renderer.playSwing(e.playerId, e.kind);
    sfx.swing(e.power);
  } else if (e.type === 'whiff') {
    lastMiss = { team: world.players[e.playerId].team, reason: e.reason };
  } else if (e.type === 'hit') {
    lastHit = e;
    lastMiss = null;
    sfx.hit(e.kind, e.power, e.quality);
    if (e.quality >= 1) {
      showFlash('PERFECT');
      sfx.perfect();
    }
  } else if (e.type === 'net') {
    lastNet = e;
    renderer.netImpact(e.speed);
    sfx.net(e.speed);
  } else if (e.type === 'ground') {
    sfx.ground();
  }
}

function teamSpan(team: Team): string {
  return `<span style="color:${TEAM_CSS[team]}">${TEAM_NAMES[team]}</span>`;
}

const MISS_MESSAGES: Record<MissReason, string> = {
  cooldown: 'too soon after the last hit',
  noBall: 'no ball in play',
  notYet: 'too early, wait for the ball to come off the net',
  notYourBall: "not your ball, it's the other player's turn",
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
    row('Player', `${teamSpan(world.players[h.playerId].team)} ${h.kind}`) +
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

function liveSection(devices: [Device, Device]): string {
  const b = world.ball;
  const ballSpeed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  let body = row('Ball', `${ballSpeed.toFixed(1)} m/s · ${b.pos.y.toFixed(2)} m up`);
  world.players.forEach((p, i) => {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const air = p.grounded ? '' : ` · air ${p.pos.y.toFixed(2)} m`;
    body += row(`${teamSpan(p.team)} <small>${deviceName(devices[i])}</small>`, `${speed.toFixed(1)} m/s${air}`);
    if (p.charge) {
      const power = chargePower(p.charge.ticks, tuning);
      body += row(`&nbsp;&nbsp;charging ${p.charge.kind}`, `${percentBar(power, '#ff9a3d')} ${Math.round(power * 100)}%`);
    }
  });
  return section('Live', body);
}

function updateHud(frameSeconds: number, devices: [Device, Device]): void {
  const team: Team = world.possession;
  stats.innerHTML =
    world.ball.lastTouch === 'feed'
      ? `${teamSpan(team)} serves to ${teamSpan(team === 0 ? 1 : 0)}`
      : world.ball.alive
        ? `${teamSpan(team)}'s ball`
        : 'Ball down, next serve coming';

  const miss = lastMiss ? `<div class="miss">${teamSpan(lastMiss.team)} missed: ${MISS_MESSAGES[lastMiss.reason]}</div>` : '';
  last.innerHTML = hitSection() + miss + netSection() + liveSection(devices);
  if (flashTimer > 0 && (flashTimer -= frameSeconds) <= 0) flash.style.opacity = '0';

  const join = devices[1] === 'cpu' ? ' (press a key or connect a 2nd controller to play Red)' : '';
  const sound = sfx.locked ? 'Click the page to turn on sound' : sfx.muted ? 'Sound muted (M)' : 'M mute';
  help.textContent =
    `${sound}   |   Blue: ${deviceName(devices[0])} · Red: ${deviceName(devices[1])}${join}   |   ` +
    `Controller: stick move/aim · hold A pass · hold B spike · Y jump · X new serve   |   ` +
    `Keyboard: WASD · hold J pass · hold K spike · Space jump · R new serve · \` tuning`;
}
