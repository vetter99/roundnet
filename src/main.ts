import { botIntent } from './ai/bot';
import { Sfx } from './audio/sfx';
import { tuning } from './config/tuning';
import { createTuningPane } from './debug/tuningPane';
import { LocalInput, PASS_KEY_LABEL, type InputFrame, type KeyboardScheme } from './input/localInput';
import { Renderer, snapshot } from './render/renderer';
import { CHARACTERS, SEAT_CHARACTERS, type CharacterKind } from './render/roster';
import type { MissReason } from './sim/hit';
import { chargePower, isDiving, type Player } from './sim/player';
import { DT } from './sim/time';
import { createMatch, otherTeam, resetRally, restartGame, stepWorld, type SimEvent, type Team } from './sim/world';

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
// The stats panel: hidden until you turn it on (the Stats button or I); the ×
// hides it again. Remembered on this browser.
const statsPanel = document.querySelector('#hud .panel') as HTMLElement;
const statsButton = document.getElementById('statsToggle') as HTMLButtonElement;
const STATS_SHOWN_KEY = 'roundnet.statsShown';
function setStatsHidden(hidden: boolean): void {
  statsPanel.classList.toggle('hidden', hidden);
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
const world = createMatch(tuning, 'practice', '2v2');
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
seatButtons.forEach((button, seat) => {
  button.addEventListener('click', () => {
    human[seat] = !human[seat];
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
  const needKeyboard: number[] = [];
  let nextPad = 0;
  const bySeat = [...world.players].sort((a, b) => seatOf(a) - seatOf(b));
  for (const p of bySeat) {
    if (!human[seatOf(p)]) continue;
    if (nextPad < pads.length) devices[p.id] = pads[nextPad++];
    else needKeyboard.push(p.id);
  }
  if (needKeyboard.length === 1) devices[needKeyboard[0]] = 'all';
  if (needKeyboard.length >= 2) [devices[needKeyboard[0]], devices[needKeyboard[1]]] = ['left', 'right'];
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
    renderer.playSwing(e.playerId, drop ? 'drop' : e.kind);
    sfx.swing(e.power);
  } else if (e.type === 'whiff') {
    lastMiss = { team: world.players[e.playerId].team, reason: e.reason };
  } else if (e.type === 'hit') {
    lastHit = e;
    lastMiss = null;
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
    renderer.netImpact(e.speed);
    sfx.net(e.speed);
  } else if (e.type === 'ground') {
    sfx.ground();
    rally = 0;
  } else if (e.type === 'point') {
    showFlash(`Point ${TEAM_NAMES[e.team]}`, TEAM_CSS[e.team], 1);
  } else if (e.type === 'gameOver') {
    showFlash(`${TEAM_NAMES[e.winner]} wins ${Math.max(...world.score)}–${Math.min(...world.score)}!`, TEAM_CSS[e.winner], 3);
  } else if (e.type === 'serve') {
    renderer.playServe(e.playerId, e.spin);
    const featured = isHuman(e.playerId) || !world.players.some((p) => isHuman(p.id));
    sfx.hit('spike', e.power, 1, featured ? 1 : tuning.audio.cpuHits);
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
    const key = serverDevice === 'cpu' ? '' : typeof serverDevice === 'string' ? PASS_KEY_LABEL[serverDevice] : 'A';
    const second = world.serve.faults > 0 ? ' <small>(2nd serve)</small>' : '';
    prompt.innerHTML =
      serverDevice === 'cpu'
        ? `${playerSpan(serverPlayer)} is serving…${second}`
        : `${playerSpan(serverPlayer)}: stick aims · hold <b>${key}</b> to charge (stick ←→ while holding = spin) · release to serve${second}`;
  }
  const match = world.mode === 'match';
  const touches = match && world.ball.alive && world.ball.lastTouch !== 'feed' ? ` · touch ${world.touches} of ${tuning.match.maxTouches}` : '';
  const status =
    world.winner !== null
      ? `${teamSpan(world.winner)} wins! Press A / J for a rematch`
      : world.waitingForServe
        ? `${playerSpan(serverPlayer)} serves to ${playerSpan(receiverPlayer)}`
        : world.ball.lastTouch === 'feed'
          ? `${teamSpan(team)} serves to ${teamSpan(team === 0 ? 1 : 0)}`
          : world.ball.alive
            ? `${teamSpan(team)}'s ball${touches}`
            : 'Ball down, next serve coming';
  stats.innerHTML = status;
  updateScoreboard();
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
    `${sound} · I stats · \` tuning · swing at a ball just out of reach to dive   |   ${world.players.map(side).join('   |   ')}`;
}
