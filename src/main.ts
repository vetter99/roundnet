import { botIntent } from './ai/bot';
import { Sfx } from './audio/sfx';
import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import { LocalInput, PASS_KEY_LABEL, type InputFrame, type KeyboardScheme } from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import type { MissReason } from './sim/hit';
import { chargePower, isDiving } from './sim/player';
import { DT } from './sim/time';
import { createMatch, resetRally, restartGame, serverTeam, stepWorld, type SimEvent, type Team } from './sim/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stats = document.querySelector('#hud .stats') as HTMLElement;
const last = document.querySelector('#hud .last') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const help = document.getElementById('help') as HTMLElement;
const soundButton = document.getElementById('sound') as HTMLButtonElement;
const prompt = document.getElementById('prompt') as HTMLElement;
const seatButtons = [document.getElementById('blueSeat'), document.getElementById('redSeat')] as HTMLButtonElement[];
const modeButton = document.getElementById('mode') as HTMLButtonElement;

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
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) sfx.muted = !sfx.muted;
});
// Per player: whether their charge was already full, to ding once on reaching it.
const chargeWasFull = [false, false];
const input = new LocalInput(window);
const world = createMatch(tuning);
createTuningPane(tuning);
canvas.focus();

let prev = snapshot(world);
let accumulator = 0;
let lastTime = performance.now();
let flashTimer = 0;
// A device is a keyboard scheme, the CPU, or a gamepad.
type Device = KeyboardScheme | 'cpu' | Gamepad;

// Practice (endless rallies) or Match (scored games), toggled on screen.
modeButton.addEventListener('click', () => {
  restartGame(world, tuning, world.mode === 'match' ? 'practice' : 'match');
  modeButton.textContent = world.mode === 'match' ? '🏆 Match (to 11)' : '🎯 Practice';
  rally = 0;
  modeButton.blur();
  canvas.focus();
});
// Ticks since the game ended; with no humans playing, the CPUs rematch on their own.
let gameOverTicks = 0;

// Who plays each side: a human or the CPU, toggled with the on-screen buttons.
// Default: you play Blue against a CPU Red. Both CPU = watch AI vs AI.
const human = [true, false];
const SEAT_LABELS = [
  ['🤖 Blue: CPU', '🎮 Blue: You'],
  ['🤖 Red: CPU', '🎮 Red: Player 2'],
];
seatButtons.forEach((button, i) => {
  const refresh = () => (button.textContent = SEAT_LABELS[i][human[i] ? 1 : 0]);
  refresh();
  button.addEventListener('click', () => {
    human[i] = !human[i];
    refresh();
    button.blur();
    canvas.focus();
  });
});

/**
 * Decide which device drives each player: [Blue, Red]. Human players get
 * controllers in order; any human left over gets the keyboard (the whole
 * keyboard for one, or a WASD half and an arrow-keys half for two). Players
 * not set to human are the CPU.
 */
function assignDevices(): [Device, Device] {
  const pads = input.gamepads();
  const devices: Device[] = ['cpu', 'cpu'];
  const needKeyboard: number[] = [];
  let nextPad = 0;
  human.forEach((isHuman, i) => {
    if (!isHuman) return;
    if (nextPad < pads.length) devices[i] = pads[nextPad++];
    else needKeyboard.push(i);
  });
  if (needKeyboard.length === 1) devices[needKeyboard[0]] = 'all';
  if (needKeyboard.length === 2) [devices[0], devices[1]] = ['left', 'right'];
  return [devices[0], devices[1]];
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

renderer.engine.runRenderLoop(() => {
  const now = performance.now();
  // Cap catch-up time so a background tab doesn't fast-forward the game.
  const frameSeconds = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  accumulator += frameSeconds;

  const devices = assignDevices();
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

  sfx.setVolume(tuning.audio.volume, tuning.audio.music);
  renderer.sync(world, prev, accumulator / DT, tuning, frameSeconds);
  updateHud(frameSeconds, devices);
});

window.addEventListener('resize', () => renderer.resize());

// Net hits by players in the current rally, and the best rally so far (jumbotron).
let rally = 0;
let bestRally = 0;
// Consecutive perfect hits by you (Blue); the perfect ding rises with it.
let playerPerfectStreak = 0;

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
    renderer.playSwing(e.playerId, drop ? 'drop' : e.kind);
    sfx.swing(e.power);
  } else if (e.type === 'whiff') {
    lastMiss = { team: world.players[e.playerId].team, reason: e.reason };
  } else if (e.type === 'hit') {
    lastHit = e;
    lastMiss = null;
    const mine = world.players[e.playerId].team === 0;
    sfx.hit(e.kind, e.power, e.quality, mine);
    if (mine) playerPerfectStreak = e.quality >= 1 ? playerPerfectStreak + 1 : 0;
    if (e.quality >= 1) {
      if (mine) showFlash('Perfect', '#5ee07a', 0.45);
      sfx.perfect(mine, mine ? playerPerfectStreak - 1 : 0);
    }
  } else if (e.type === 'net') {
    lastNet = e;
    // The serve's bounce doesn't count; every player hit that reaches the net does.
    if (world.lastHitKind !== null) {
      rally++;
      bestRally = Math.max(bestRally, rally);
    }
    renderer.netImpact(e.speed);
    sfx.net(e.speed);
  } else if (e.type === 'ground') {
    sfx.ground();
    rally = 0;
  } else if (e.type === 'point') {
    showFlash(`Point ${TEAM_NAMES[e.team]}`, TEAM_CSS[e.team], 1);
  } else if (e.type === 'gameOver') {
    showFlash(`${TEAM_NAMES[e.winner]} wins ${Math.max(...world.score)}–${Math.min(...world.score)}!`, TEAM_CSS[e.winner], 3);
    sfx.perfect(true, 4);
  } else if (e.type === 'serve') {
    renderer.playServe(e.playerId, e.spin);
    sfx.hit('spike', e.power, 1, world.players[e.playerId].team === 0);
  } else if (e.type === 'fault') {
    sfx.ground();
    showFlash(e.lost ? `Double fault: serve goes to ${TEAM_NAMES[1 - e.team]}` : 'Fault: 2nd serve', '#ffd84a', 1.2);
  } else if (e.type === 'dive') {
    sfx.swing(1);
  } else if (e.type === 'diveLand') {
    sfx.diveLand();
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
    const dive = !p.dive ? '' : isDiving(p, tuning) ? ' · diving' : ' · getting up';
    body += row(`${teamSpan(p.team)} <small>${deviceName(devices[i])}</small>`, `${speed.toFixed(1)} m/s${air}${dive}`);
    if (p.charge) {
      const power = chargePower(p.charge.ticks, tuning);
      body += row(`&nbsp;&nbsp;charging ${p.charge.kind}`, `${percentBar(power, '#ff9a3d')} ${Math.round(power * 100)}%`);
    }
  });
  return section('Live', body);
}

function updateHud(frameSeconds: number, devices: [Device, Device]): void {
  const team: Team = world.possession;
  const server = serverTeam(world);
  const serverDevice = devices[world.players.findIndex((p) => p.team === server)];
  const showServePrompt = world.waitingForServe && world.winner === null;
  prompt.style.display = showServePrompt ? 'block' : 'none';
  if (showServePrompt) {
    const key = serverDevice === 'cpu' ? '' : typeof serverDevice === 'string' ? PASS_KEY_LABEL[serverDevice] : 'A';
    const second = world.serve.faults > 0 ? ' <small>(2nd serve)</small>' : '';
    prompt.innerHTML =
      serverDevice === 'cpu'
        ? `${teamSpan(server)} is serving…${second}`
        : `${teamSpan(server)}: stick aims · hold <b>${key}</b> to charge (stick ←→ while holding = spin) · release to serve${second}`;
  }
  const match = world.mode === 'match';
  const touches = match && world.ball.alive && world.ball.lastTouch !== 'feed' ? ` · touch ${world.touches} of ${tuning.match.maxTouches}` : '';
  const status =
    world.winner !== null
      ? `${teamSpan(world.winner)} wins! Press A / J for a rematch`
      : world.waitingForServe
        ? `${teamSpan(server)} serves to ${teamSpan(world.nextReceiver)}`
        : world.ball.lastTouch === 'feed'
          ? `${teamSpan(team)} serves to ${teamSpan(team === 0 ? 1 : 0)}`
          : world.ball.alive
            ? `${teamSpan(team)}'s ball${touches}`
            : 'Ball down, next serve coming';
  const scoreLine = match ? `${teamSpan(0)} ${world.score[0]} – ${world.score[1]} ${teamSpan(1)}<br>` : '';
  stats.innerHTML = scoreLine + status;
  renderer.setJumbotron(
    match ? `${world.score[0]} – ${world.score[1]}` : `RALLY ${rally}`,
    match ? (world.winner !== null ? `${TEAM_NAMES[world.winner].toUpperCase()} WINS` : `FIRST TO ${tuning.match.pointsToWin}`) : `BEST ${bestRally}`,
  );

  const miss = lastMiss ? `<div class="miss">${teamSpan(lastMiss.team)} missed: ${MISS_MESSAGES[lastMiss.reason]}</div>` : '';
  last.innerHTML = hitSection() + miss + netSection() + liveSection(devices);
  if (flashTimer > 0 && (flashTimer -= frameSeconds) <= 0) flash.style.opacity = '0';

  soundButton.style.display = sfx.locked ? 'block' : 'none';
  const sound = sfx.muted ? 'Sound muted (M)' : 'M mute';
  const [blue, red] = devices;
  const side = (name: string, d: Device) => (d === 'cpu' ? `${name}: CPU` : `${name} (${deviceName(d)}): ${controlsHelp(d)}`);
  help.textContent =
    `${sound} · \` tuning · swing at a ball just out of reach to dive   |   ${side('Blue', blue)}   |   ${side('Red', red)}`;
}
