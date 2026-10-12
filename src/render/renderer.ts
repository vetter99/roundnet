// Deep imports keep the bundle small; importing from '@babylonjs/core' pulls in everything.
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import type { Tuning } from '../config/tuning';
import { predictLanding, type LandingPrediction } from '../sim/ball';
import { isPlayable, predictDescentTo } from '../sim/hit';
import type { ShotKind } from '../sim/player';
import { DT } from '../sim/time';
import { cameraPosition, frame, type Framing } from './cameraFraming';
import { Character } from './character';
import { addHaze, createBallMaterial, createLawn, createScenery, createShadows, SKY } from './environment';
import { buildRoundnetSet } from './roundnetSet';
import { SEAT_CHARACTERS, type CharacterKind } from './roster';
import { createStadium, type Stadium } from './stadium';
import { createPark, HORIZON, makeEvening } from './park';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { chargePower, diveRecoveryTicks, diveTicks } from '../sim/player';
import { clamp, lerp, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';
import { serveHand, serveWobble } from '../sim/serve';

// The net's trampoline dent: depth (m) per m/s of impact speed, within
// [MIN, MAX]; how wide the dimple is (m); how much of the dent is the local
// dimple vs. the whole net sagging; and when it has settled (s).
const NET_DENT_PER_SPEED = 0.016;
const NET_DENT_MIN = 0.025;
const NET_DENT_MAX = 0.17;
const NET_DENT_RADIUS = 0.24;
const NET_DENT_LOCAL = 0.75;
const NET_DENT_SETTLE = 1;
// Spray-painted court lines: the painted strip is this many times wider than
// the line's core (room for overspray), and the paint pattern repeats every
// this many meters along it.
const SPRAY_SPREAD = 3;
const SPRAY_TILE = 2.5;
// A ball that moves further than this (m) in one tick was teleported, not thrown.
const BALL_JUMP = 1.5;
// Saturated team colors, for the jerseys.
const TEAM_COLORS = [new Color3(0.08, 0.36, 1), new Color3(1, 0.16, 0.12)];

/** Positions from the previous tick, used to interpolate between ticks. */
export interface Snapshot {
  ball: Vec3;
  players: Vec3[];
}

export function snapshot(world: World): Snapshot {
  return {
    ball: { ...world.ball.pos },
    players: world.players.map((p) => ({ ...p.pos })),
  };
}

interface PlayerView {
  // Which team, slot and character the view was built for (rebuilt if any changes, e.g. 1v1 → 2v2).
  team: 0 | 1;
  slot: number;
  kind: CharacterKind;
  character: Character;
  reachRing: Mesh;
  meter: ChargeMeter;
}

interface ChargeMeter {
  root: TransformNode;
  fill: Mesh;
  fillMat: StandardMaterial;
}

// The ball's trail fades in between these speeds (m/s): nearly every ball in
// the air leaves a streak, which helps track where it's going.
const TRAIL_MIN_SPEED = 3;
const TRAIL_FULL_SPEED = 8;
const TRAIL_MAX_ALPHA = 0.7;
// Even a slow ball (e.g. at the top of a pass) keeps a faint trail while in play.
const TRAIL_MIN_ALPHA = 0.25;
// Spin you can read: the ball turns about its vertical axis at this many
// rad/s per m/s² of curve (full serve spin ≈ 4 turns a second), and a tinted
// trail shows behind any spun ball.
const SPIN_VISUAL = 8;
const TRAIL_PLAIN = new Color3(1, 0.95, 0.7);
// A spun ball's trail turns cyan or magenta depending on which way it curves
// (as seen along its flight), stronger with more spin: SPIN_FULL is the visual
// spin rate (rad/s) that counts as full spin.
const TRAIL_SPIN_LEFT = new Color3(0.15, 0.9, 1);
const TRAIL_SPIN_RIGHT = new Color3(1, 0.3, 0.85);
const SPIN_FULL = 30;
// Every ball in flight tumbles forward this fast (rad/s per m/s of speed),
// up to a cap, so it never looks like it's sliding flat through the air.
const BALL_TUMBLE = 1.6;
const BALL_TUMBLE_MAX = 22;
const TRAIL_SPIN_ALPHA = 0.9;

const METER_WIDTH = 0.5;
const METER_HEIGHT = 0.07;
const METER_LOW = new Color3(1, 0.85, 0.2);
const METER_HIGH = new Color3(1, 0.25, 0.1);

/**
 * Draws the world. It only reads sim state and never changes it.
 */
export class Renderer {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly ball: Mesh;
  private readonly trailMat: StandardMaterial;
  // The ball's visible sidespin (rad/s about the vertical axis). It keeps
  // turning after the net bounce, so the returner can read the kick.
  private ballSpin = 0;
  // Landing spot + timing guide: a fixed target ring and an approach ring
  // that shrinks onto it as the ball nears the PERFECT moment.
  private readonly marker: TransformNode;
  private readonly approachRing: Mesh;
  private readonly approachMat: StandardMaterial;
  private readonly targetRing: Mesh;
  private readonly targetMat: StandardMaterial;
  private readonly players: PlayerView[] = [];
  // The character in each seat (Blue 1, Blue 2, Red 1, Red 2).
  private seatCharacters: CharacterKind[] = [...SEAT_CHARACTERS];
  private court: TransformNode | null = null;
  private netSurface: Mesh | null = null;
  // Trampoline wobble after the ball hits the net: a decaying spring.
  // The net's trampoline bounce: a dent at (x, z) that springs back over time.
  private netWobble = { amplitude: 0, time: 0, x: 0, z: 0 };
  // The net surface's resting vertex positions, to dent from.
  private netBase: Float32Array | null = null;
  private readonly shadows: ShadowGenerator;
  private readonly stadium: Stadium;
  private readonly ballShadow: Mesh;
  private readonly ballShadowMat: StandardMaterial;
  private courtKey = '';
  private time = 0;
  // The camera's current (smoothed) framing; null until the first frame.
  private cameraFraming: Framing | null = null;
  // 0 = broadcast camera, 1 = serve-duel camera behind the receiver; eased between.
  private duelBlend = 0;
  // The camera's yaw (0 = looking along +z), so input can follow the view.
  private yaw = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true });
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);

    this.camera = new UniversalCamera('broadcast', new Vector3(0, 7, -10), scene);
    this.camera.inputs.clear();

    // Bright, warm afternoon light: a sky fill plus a sun that casts soft shadows.
    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55;
    hemi.diffuse = new Color3(1, 0.98, 0.93);
    hemi.groundColor = new Color3(0.38, 0.46, 0.33);
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene);
    sun.position = new Vector3(13, 30, -10);
    sun.intensity = 1.05;
    sun.diffuse = new Color3(1, 0.95, 0.85);
    this.shadows = createShadows(sun);

    // The park (default) or the stadium (add ?stadium to the URL).
    const stadium = typeof location !== 'undefined' && new URLSearchParams(location.search).has('stadium');
    createLawn(scene);
    // Out in the country there's only a sparse tree line on the horizon.
    createScenery(scene, stadium ? 70 : 12);
    this.stadium = stadium ? createStadium(scene) : createPark(scene);
    if (stadium) {
      addHaze(scene);
    } else {
      // Evening in the country: you can see a long way across the flat land.
      makeEvening(scene, sun, hemi, this.shadows);
      addHaze(scene, HORIZON, 70, 650);
    }

    // A soft dark disc under the ball; it shrinks and fades as the ball rises.
    this.ballShadow = MeshBuilder.CreateDisc('ballShadow', { radius: 1, tessellation: 32 }, scene);
    this.ballShadow.rotation.x = Math.PI / 2;
    this.ballShadow.isPickable = false;
    this.ballShadowMat = flatMaterial('ballShadow', new Color3(0, 0, 0), scene);
    this.ballShadowMat.disableLighting = true;
    this.ballShadow.material = this.ballShadowMat;

    this.ball = MeshBuilder.CreateSphere('ball', { diameter: 1, segments: 20 }, scene);
    this.ball.material = createBallMaterial(scene);
    // A faint streak behind fast spikes.
    const trail = new TrailMesh('ballTrail', this.ball, scene, { diameter: 0.3, length: 14, sections: 8, autoStart: true });
    this.trailMat = flatMaterial('ballTrail', new Color3(1, 0.95, 0.7), scene);
    this.trailMat.disableLighting = true;
    this.trailMat.emissiveColor = new Color3(1, 0.95, 0.7);
    this.trailMat.backFaceCulling = false;
    this.trailMat.alpha = 0;
    trail.material = this.trailMat;
    trail.isPickable = false;

    this.marker = new TransformNode('marker', scene);
    // Soft glows lying on the grass: bright at the ring line, fading out on
    // both sides. Unit-radius rings scaled per frame (the glow scales too).
    this.approachMat = glowMaterial('approach', glowRingTexture('approachGlow', 0.08, false, scene), scene);
    this.targetMat = glowMaterial('target', glowRingTexture('targetGlow', 0.22, true, scene), scene);
    this.approachRing = MeshBuilder.CreateGround('approachRing', { width: 2.4, height: 2.4 }, scene);
    this.approachRing.material = this.approachMat;
    this.targetRing = MeshBuilder.CreateGround('targetRing', { width: 2.4, height: 2.4 }, scene);
    this.targetRing.material = this.targetMat;
    for (const m of [this.approachRing, this.targetRing]) {
      m.parent = this.marker;
      m.isPickable = false;
    }
  }

  resize(): void {
    this.engine.resize();
  }

  /** Update every mesh from the sim. `alpha` blends prev → current tick. */
  sync(world: World, prev: Snapshot, alpha: number, t: Tuning, frameSeconds: number): void {
    this.time += frameSeconds;
    const landing = predictLanding(world.ball, t);
    this.updateCamera(world, landing, t, frameSeconds);
    this.rebuildCourtIfChanged(t);

    const b = world.ball.pos;
    // A ball that jumped (e.g. from the ground into the server's hand) isn't blended.
    const jumped = Math.hypot(b.x - prev.ball.x, b.y - prev.ball.y, b.z - prev.ball.z) > BALL_JUMP;
    const a = jumped ? 1 : alpha;
    this.ball.position.set(lerp(prev.ball.x, b.x, a), lerp(prev.ball.y, b.y, a), lerp(prev.ball.z, b.z, a));
    this.ball.scaling.setAll(t.ball.radius * 2);
    // Waiting for the serve, the ball sits in the server's paw (none once the game is over).
    // (Until it's tossed: then it's a real ball in the air.)
    const holder =
      world.waitingForServe && world.winner === null && !world.serve.tossed ? world.players.find((p) => p.id === world.serve.serverId) : undefined;
    const held = holder ? serveHand(world, holder, t) : undefined;
    if (held) this.ball.position.set(held.x, held.y, held.z);
    this.ball.isVisible = !world.waitingForServe || held !== undefined || world.serve.tossed;
    const v = world.ball.vel;
    const fast = clamp((Math.hypot(v.x, v.y, v.z) - TRAIL_MIN_SPEED) / (TRAIL_FULL_SPEED - TRAIL_MIN_SPEED), 0, 1);
    const spin = this.updateBallSpin(world, frameSeconds);
    const spinAmount = Math.abs(spin);
    this.trailMat.alpha = world.ball.alive ? Math.max(lerp(TRAIL_MIN_ALPHA, TRAIL_MAX_ALPHA, fast), spinAmount * TRAIL_SPIN_ALPHA) : 0;
    this.trailMat.emissiveColor = Color3.Lerp(TRAIL_PLAIN, spin < 0 ? TRAIL_SPIN_LEFT : TRAIL_SPIN_RIGHT, Math.min(1, spinAmount * 1.5));
    this.updateBallShadow(this.ball.position, world.ball.alive, t);
    this.updateNetWobble(frameSeconds, t);

    // Views for players that no longer exist (e.g. after switching 2v2 → 1v1) go away.
    for (const view of this.players.splice(world.players.length)) this.disposePlayerView(view);
    world.players.forEach((p, i) => {
      const slot = world.players.filter((q) => q.team === p.team).indexOf(p);
      const kind = this.seatCharacters[p.team * 2 + slot];
      let view: PlayerView | undefined = this.players[i];
      if (view && (view.team !== p.team || view.slot !== slot || view.kind !== kind)) {
        this.disposePlayerView(view);
        view = undefined;
      }
      view ??= this.players[i] = this.createPlayerView(p.team, slot, kind);
      const from = prev.players[i] ?? p.pos;
      const x = lerp(from.x, p.pos.x, alpha);
      const z = lerp(from.z, p.pos.z, alpha);
      const y = lerp(from.y, p.pos.y, alpha);
      const charge = p.charge ? { kind: p.charge.kind, power: chargePower(p.charge.ticks, t) } : null;
      const lunge = diveTicks(t);
      const dive = p.dive
        ? p.dive.ticks < lunge
          ? { lunging: true, progress: p.dive.ticks / lunge }
          : { lunging: false, progress: (p.dive.ticks - lunge) / diveRecoveryTicks(t) }
        : null;
      // The server shows their aim only through their body (no marker): they
      // face and lean toward it, swaying with the charge wobble.
      const aiming = world.waitingForServe && world.winner === null && p.id === world.serve.serverId;
      const wobble = aiming ? serveWobble(world, p, t) : null;
      const aim = wobble ? { x: world.serve.aim.x + wobble.x, z: world.serve.aim.z + wobble.z } : undefined;
      // Spin shows in the arm: cocked to one side while charging a serve or spike.
      const spin = aiming ? world.serve.spin : p.charge?.kind === 'spike' ? p.charge.spin : 0;
      view.character.update(p, x, y, z, t.player.size, frameSeconds, charge, dive, world.waitingForServe, aim, spin, aiming ? held : undefined);
      this.updateMeter(view.meter, charge?.power ?? null, x, y + 1.55 * t.player.size, z);
      // Reach rings are a debug aid only (they were confused with the timing rings).
      view.reachRing.isVisible = t.debug.showReach;
      view.reachRing.position.set(x, 0.02, z);
      view.reachRing.scaling.set(t.player.reach, 1, t.player.reach);
    });

    this.updateMarker(world, landing, t);
    this.stadium.update(this.time);
    this.scene.render();
  }

  /**
   * Turn the ball to show its sidespin. While a spun serve curves, the spin
   * matches the curve's direction (the side of the ball moving backward is
   * the side it curves toward); afterwards it keeps spinning, slowly fading,
   * until someone hits it. Returns how much spin is showing, -1..1 (the sign is the curve direction).
   */
  private updateBallSpin(world: World, dt: number): number {
    const ball = world.ball;
    const c = ball.curve;
    if (c && Math.hypot(c.x, c.z) > 0.01) {
      const side = Math.sign(ball.vel.x * c.z - ball.vel.z * c.x);
      this.ballSpin = -side * Math.hypot(c.x, c.z) * SPIN_VISUAL;
    } else if (!ball.alive || ball.lastTouch === 'player' || world.waitingForServe) {
      this.ballSpin *= Math.exp(-6 * dt);
    } else {
      this.ballSpin *= Math.exp(-0.4 * dt);
    }
    // Turn the ball: the sidespin twist about the vertical, plus a forward
    // tumble (like topspin) about the horizontal axis across its flight,
    // faster the faster it flies, so its stripes visibly roll on every shot.
    const v = ball.vel;
    const flat = Math.hypot(v.x, v.z);
    const tumble = ball.alive && !world.waitingForServe ? Math.min(Math.hypot(v.x, v.y, v.z) * BALL_TUMBLE, BALL_TUMBLE_MAX) : 0;
    const q = this.ball.rotationQuaternion ?? Quaternion.Identity();
    if (Math.abs(this.ballSpin) > 1e-3) q.multiplyInPlace(Quaternion.RotationAxis(Vector3.Up(), this.ballSpin * dt));
    if (tumble > 0 && flat > 0.05) {
      // The axis across the flight (velocity x up), so the top rolls forward.
      const across = new Vector3(v.z / flat, 0, -v.x / flat);
      q.copyFrom(Quaternion.RotationAxis(across, tumble * dt).multiply(q));
    }
    this.ball.rotationQuaternion = q;
    // Signed amount, -1..1: the sign says which way it curves.
    return clamp(this.ballSpin / SPIN_FULL, -1, 1);
  }

  /**
   * The ball hit the net at `at` (world x, z) this fast: dent the net there,
   * deeper for harder hits, like a trampoline, then spring back.
   */
  netImpact(impactSpeed: number, at: { x: number; z: number }): void {
    this.netWobble = { amplitude: clamp(impactSpeed * NET_DENT_PER_SPEED, NET_DENT_MIN, NET_DENT_MAX), time: 0, x: at.x, z: at.z };
  }

  private updateNetWobble(dt: number, t: Tuning): void {
    const net = this.netSurface;
    if (!net) return;
    if (!this.netBase) {
      const base = net.getVerticesData(VertexBuffer.PositionKind);
      if (!base) return;
      this.netBase = new Float32Array(base);
    }
    const w = this.netWobble;
    w.time += dt;
    // Dips first, then bounces back with a few quick wobbles, then rests.
    const depth = -w.amplitude * Math.exp(-7 * w.time) * Math.cos(26 * w.time);
    if (w.time > NET_DENT_SETTLE && w.amplitude === 0) return;
    if (w.time > NET_DENT_SETTLE) w.amplitude = 0;
    const base = this.netBase;
    const positions = new Float32Array(base);
    const radius = t.net.radius;
    for (let i = 0; i < positions.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      // Mostly a dimple around the impact, plus a little sag of the whole net.
      const d2 = ((x - w.x) ** 2 + (z - w.z) ** 2) / (NET_DENT_RADIUS * NET_DENT_RADIUS);
      const r2 = (x * x + z * z) / (radius * radius);
      const shape = NET_DENT_LOCAL * Math.exp(-d2) + (1 - NET_DENT_LOCAL) * Math.max(0, 1 - r2);
      positions[i + 1] = base[i + 1] + depth * shape;
    }
    net.updateVerticesData(VertexBuffer.PositionKind, positions);
  }

  private updateBallShadow(ballPos: Vector3, alive: boolean, t: Tuning): void {
    this.ballShadow.isVisible = alive;
    if (!alive) return;
    // Land on the net surface when the ball is over the net, else on the grass.
    const overNet = Math.hypot(ballPos.x, ballPos.z) < t.net.radius + t.net.frameWidth;
    const floor = overNet ? t.net.height + 0.012 : 0.015;
    const height = Math.max(0, ballPos.y - floor);
    const radius = t.ball.radius * (0.9 + height * 0.12);
    this.ballShadow.position.set(ballPos.x, floor, ballPos.z);
    this.ballShadow.scaling.setAll(radius);
    this.ballShadowMat.alpha = 0.45 / (1 + height * 0.5);
  }

  /** Show a power bar above a charging player; hidden when power is null. */
  private updateMeter(meter: ChargeMeter, power: number | null, x: number, y: number, z: number): void {
    meter.root.setEnabled(power !== null);
    if (power === null) return;
    meter.root.position.set(x, y, z);
    const width = Math.max(power, 0.001) * METER_WIDTH;
    meter.fill.scaling.x = width / METER_WIDTH;
    meter.fill.position.x = (width - METER_WIDTH) / 2;
    // Yellow to red as it charges; pulses white when full.
    const color = Color3.Lerp(METER_LOW, METER_HIGH, power);
    meter.fillMat.emissiveColor = power >= 1 && Math.sin(this.time * 30) > 0 ? new Color3(1, 1, 1) : color;
  }

  /** Show two lines on the jumbotron (the score in a match, the rally count in practice). */
  setJumbotron(main: string, sub: string): void {
    this.stadium.setJumbotron(main, sub);
  }

  /** Play the pass or spike animation for a player. */
  /** A player swings; with spin (-1..1) the arm also sweeps across in that direction. */
  playSwing(playerId: number, kind: ShotKind, spin = 0, power = 0.5): void {
    this.players[playerId]?.character.playSwing(kind, spin, power);
  }

  /** A player just hit the ball at `at`: their hand(s) reach to it. */
  playContact(playerId: number, kind: ShotKind, at: { x: number; y: number; z: number }): void {
    this.players[playerId]?.character.playContact(kind, at);
  }

  /** Ease toward the closest view that keeps the players, ball, landing spot and net on screen. */
  private updateCamera(world: World, landing: LandingPrediction | null, t: Tuning, dt: number): void {
    const c = t.camera;
    const pitch = (c.pitchDeg * Math.PI) / 180;
    const points = [{ x: 0, y: t.net.height, z: 0 }];
    for (const p of world.players) {
      points.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, { x: p.pos.x, y: p.pos.y + t.player.contactHeight, z: p.pos.z });
      // Where they'll be shortly, so the camera leads their movement.
      points.push({ x: p.pos.x + p.vel.x * c.lookAhead, y: 0, z: p.pos.z + p.vel.z * c.lookAhead });
    }
    if (world.ball.alive) points.push({ ...world.ball.pos });
    if (landing) {
      // The whole timing guide, not just its center.
      const r = t.marker.maxRadius;
      const { x, z } = landing.point;
      points.push({ x: x - r, y: 0, z }, { x: x + r, y: 0, z }, { x, y: 0, z: z - r }, { x, y: 0, z: z + r });
    }

    const goal = frame(points, {
      pitch,
      fovY: c.fov,
      aspect: this.engine.getAspectRatio(this.camera),
      margin: c.margin,
      minDistance: c.minDistance,
      maxDistance: c.maxDistance,
    });
    const cur = this.cameraFraming ?? (this.cameraFraming = goal);
    // Pull back quickly so fast balls stay in view; come back in gently.
    const zoomRate = goal.distance > cur.distance ? c.zoomOutSpeed : c.zoomInSpeed;
    cur.distance += (goal.distance - cur.distance) * (1 - Math.exp(-zoomRate * dt));
    const pan = 1 - Math.exp(-c.panSpeed * dt);
    cur.center.x += (goal.center.x - cur.center.x) * pan;
    cur.center.z += (goal.center.z - cur.center.z) * pan;

    const broadcastPos = cameraPosition(cur, pitch);
    const broadcastTarget = cur.center;

    // Serve duel: a low camera behind the receiver, looking across the net at
    // the server, from setup until the receiving side plays the ball.
    const duel = world.waitingForServe || world.serve.returnPending;
    this.duelBlend += ((duel ? 1 : 0) - this.duelBlend) * (1 - Math.exp(-c.duelBlendSpeed * dt));
    const receiver = world.players.find((p) => p.id === world.serve.receiverId) ?? world.players[0];
    const server = world.players.find((p) => p.id === world.serve.serverId) ?? world.players[0];
    const away = Math.hypot(receiver.pos.x, receiver.pos.z) || 1;
    const ux = receiver.pos.x / away;
    const uz = receiver.pos.z / away;
    // Straight behind the receiver (duelSide moves it over a shoulder).
    const duelPos = {
      x: receiver.pos.x + ux * c.duelBack + uz * c.duelSide,
      y: c.duelHeight,
      z: receiver.pos.z + uz * c.duelBack - ux * c.duelSide,
    };
    // Look across the net toward the server, about where the serve will come from.
    const duelTarget = { x: server.pos.x * 0.3, y: 0.5, z: server.pos.z * 0.3 };

    const b = this.duelBlend;
    const pos = { x: lerp(broadcastPos.x, duelPos.x, b), y: lerp(broadcastPos.y, duelPos.y, b), z: lerp(broadcastPos.z, duelPos.z, b) };
    const target = {
      x: lerp(broadcastTarget.x, duelTarget.x, b),
      y: lerp(broadcastTarget.y, duelTarget.y, b),
      z: lerp(broadcastTarget.z, duelTarget.z, b),
    };
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.setTarget(new Vector3(target.x, target.y, target.z));
    this.camera.fov = lerp(c.fov, c.duelFov, b);
    // The camera is almost inside the receiver, so make them see-through.
    world.players.forEach((p, i) => {
      const receiving = p.id === world.serve.receiverId;
      this.players[i]?.character.setOpacity(receiving ? lerp(1, c.duelReceiverOpacity, b) : 1);
    });
    this.yaw = Math.atan2(target.x - pos.x, target.z - pos.z);
  }

  /** The camera's yaw: 0 when looking along +z (the broadcast view), PI when looking back along -z. */
  viewYaw(): number {
    return this.yaw;
  }

  private updateMarker(world: World, landing: LandingPrediction | null, t: Tuning): void {
    const ball = world.ball;
    // No marker under a serve toss (it's the server's to hit, not anyone's to play).
    const show = landing !== null && !world.serve.tossed && (t.marker.mode === 'always' || !landing.viaNet);
    this.marker.setEnabled(show);
    if (!landing || !show) return;
    this.marker.position.set(landing.point.x, 0.03, landing.point.z);
    this.targetRing.scaling.setAll(t.marker.targetRadius);

    // The PERFECT window for a player standing on the ground: the ball falling
    // through contact height, within perfectWindow above or below it.
    const window = t.hit.perfectWindow;
    const heightError = ball.pos.y - t.player.contactHeight;
    const inWindow = isPlayable(ball) && ball.vel.y < 0 && Math.abs(heightError) <= window;
    const upcoming = inWindow ? null : predictDescentTo(ball, t.player.contactHeight + window, t);

    if (inWindow) {
      // Swing now: both rings flash green.
      this.approachRing.isVisible = true;
      this.approachRing.scaling.setAll(t.marker.targetRadius);
      setGlow(this.approachMat, PERFECT_GREEN, 1);
      setGlow(this.targetMat, PERFECT_GREEN, 1);
    } else if (upcoming && upcoming.ticks > 0) {
      // Closing in: the approach ring meets the target as the window opens.
      const closing = clamp((upcoming.ticks * DT) / t.marker.approachTime, 0, 1);
      this.approachRing.isVisible = true;
      this.approachRing.scaling.setAll(lerp(t.marker.targetRadius, t.marker.maxRadius, closing));
      setGlow(this.approachMat, APPROACH_ORANGE, 0.95);
      setGlow(this.targetMat, TARGET_WHITE, 0.9);
    } else {
      // The window has passed (or the ball won't reach contact height).
      this.approachRing.isVisible = false;
      setGlow(this.targetMat, TARGET_WHITE, 0.35);
    }
  }

  /** Choose the character for each seat (Blue 1, Blue 2, Red 1, Red 2); players are rebuilt as needed. */
  setSeatCharacters(kinds: CharacterKind[]): void {
    this.seatCharacters = [...kinds];
  }

  private createPlayerView(team: 0 | 1, slot: number, kind: CharacterKind): PlayerView {
    const scene = this.scene;
    // Teammates wear numbers 1 and 2.
    const character = new Character(scene, TEAM_COLORS[team], kind, slot + 1);
    for (const mesh of character.root.getChildMeshes()) this.shadows.addShadowCaster(mesh);

    const reachRing = MeshBuilder.CreateTorus('reach', { diameter: 2, thickness: 0.04, tessellation: 48 }, scene);
    const reachMat = flatMaterial('reach', TEAM_COLORS[team], scene);
    reachMat.alpha = 0.7;
    reachMat.disableLighting = true;
    reachMat.emissiveColor = TEAM_COLORS[team];
    reachRing.material = reachMat;

    return { team, slot, kind, character, reachRing, meter: this.createMeter() };
  }

  private disposePlayerView(view: PlayerView): void {
    view.character.root.dispose();
    view.reachRing.dispose();
    view.meter.root.dispose();
  }

  private createMeter(): ChargeMeter {
    const scene = this.scene;
    const root = new TransformNode('chargeMeter', scene);
    // Always face the camera.
    root.billboardMode = TransformNode.BILLBOARDMODE_ALL;

    const back = MeshBuilder.CreatePlane('meterBack', { width: METER_WIDTH + 0.04, height: METER_HEIGHT + 0.04 }, scene);
    const backMat = flatMaterial('meterBack', new Color3(0, 0, 0), scene);
    backMat.disableLighting = true;
    backMat.alpha = 0.6;
    back.material = backMat;
    back.parent = root;

    const fill = MeshBuilder.CreatePlane('meterFill', { width: METER_WIDTH, height: METER_HEIGHT }, scene);
    const fillMat = flatMaterial('meterFill', METER_LOW, scene);
    fillMat.disableLighting = true;
    fill.material = fillMat;
    fill.parent = root;
    // Slightly in front of the background (planes face -z).
    fill.position.z = -0.005;
    root.setEnabled(false);
    return { root, fill, fillMat };
  }

  /** Net and serve line are rebuilt whenever their tuning values change. */
  private rebuildCourtIfChanged(t: Tuning): void {
    const key = [t.net.radius, t.net.frameWidth, t.net.height, t.court.serveLineDistance, t.court.noSpikeZoneDistance, t.court.lineWidth].join('|');
    if (key === this.courtKey) return;
    this.courtKey = key;
    this.court?.dispose(false, true);

    const scene = this.scene;
    const court = (this.court = new TransformNode('court', scene));
    const { radius, frameWidth, height } = t.net;

    const set = buildRoundnetSet(scene, radius, frameWidth, height, this.shadows);
    set.root.parent = court;
    this.netSurface = set.net;
    this.netBase = null;

    // Spray-painted lines, measured out from the net's edge: the serve line
    // and the no-spike zone line close to the net.
    const lineMat = flatMaterial('courtLine', new Color3(1, 1, 1), scene);
    lineMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    lineMat.opacityTexture = sprayPaintTexture(scene);
    lineMat.backFaceCulling = false;
    const edge = radius + frameWidth;
    for (const [name, distance] of [
      ['serveLine', t.court.serveLineDistance],
      ['noSpikeLine', t.court.noSpikeZoneDistance],
    ] as const) {
      // The mesh is wider than the line itself, to leave room for overspray.
      const r = edge + distance;
      const line = paintedRing(name, r, t.court.lineWidth * SPRAY_SPREAD, scene, Math.round((Math.PI * 2 * r) / SPRAY_TILE));
      line.material = lineMat;
      line.parent = court;
    }
  }
}

/**
 * A flat ring on the grass, centered on the net, `width` wide. UVs: u runs
 * around it (`repeats` times), v across it (0 inside, 1 outside).
 */
function paintedRing(name: string, radius: number, width: number, scene: Scene, repeats = 1): Mesh {
  const segments = 128;
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * inner, 0.012, s * inner, c * outer, 0.012, s * outer);
    normals.push(0, 1, 0, 0, 1, 0);
    const u = (i / segments) * repeats;
    uvs.push(u, 0, u, 1);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

/**
 * Spray paint, as an opacity texture for a strip (u along it, v across): a
 * soft-edged core that wanders a little and thins in places, speckled, with
 * overspray dots fading out to either side. Tiles seamlessly along u.
 */
function sprayPaintTexture(scene: Scene): DynamicTexture {
  const w = 512;
  const h = 64;
  const tex = new DynamicTexture('sprayPaint', { width: w, height: h }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  let seed = 99;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Smooth, tiling wobble of the core's center and density along the strip.
  const wave = (x: number, f: number, p: number) => Math.sin(((x / w) * f + p) * Math.PI * 2);
  for (let x = 0; x < w; x++) {
    const center = h / 2 + (wave(x, 3, 0.1) * 0.5 + wave(x, 7, 0.6) * 0.3) * (h / SPRAY_SPREAD) * 0.35;
    const density = 0.82 + wave(x, 5, 0.3) * 0.1 + wave(x, 11, 0.8) * 0.06;
    const core = h / SPRAY_SPREAD / 2;
    for (let y = 0; y < h; y++) {
      const d = Math.abs(y - center) / core;
      // Solid-ish core with a soft falloff, then a faint misty halo.
      let a = d < 0.7 ? 1 : d < 1.3 ? 1 - (d - 0.7) / 0.6 : 0;
      a = a * density + Math.max(0, 0.18 * (1 - d / 3));
      // Speckle: paint droplets missing in the core, landing outside it.
      const r = rand();
      if (d < 1.2) a *= r < 0.12 ? 0.55 : 1;
      else if (r < 0.06 * Math.max(0, 1 - (d - 1.2) / 2.2)) a = 0.5 + rand() * 0.5;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.CLAMP_ADDRESSMODE;
  return tex;
}

const PERFECT_GREEN = new Color3(0.35, 1, 0.45);
const APPROACH_ORANGE = new Color3(1, 0.5, 0.1);
const TARGET_WHITE = new Color3(1, 1, 1);

/** An unlit material whose color and opacity are set per frame. */
function glowMaterial(name: string, glow: DynamicTexture, scene: Scene): StandardMaterial {
  const mat = flatMaterial(name, new Color3(0, 0, 0), scene);
  mat.disableLighting = true;
  mat.emissiveColor = TARGET_WHITE;
  mat.opacityTexture = glow;
  mat.backFaceCulling = false;
  return mat;
}

/**
 * A soft glowing ring for a 2.4 x 2.4 ground square: opaque at radius 1 and
 * fading to nothing `width` (in radius units) to either side, and optionally
 * a faint glow in the middle that marks the center.
 */
function glowRingTexture(name: string, width: number, center: boolean, scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const unit = size / 2.4;
  const ring = ctx.createRadialGradient(c, c, (1 - width) * unit, c, c, (1 + width) * unit);
  ring.addColorStop(0, 'rgba(255,255,255,0)');
  ring.addColorStop(0.5, 'rgba(255,255,255,1)');
  ring.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);
  if (center) {
    const dot = ctx.createRadialGradient(c, c, 0, c, c, 0.3 * unit);
    dot.addColorStop(0, 'rgba(255,255,255,0.7)');
    dot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = dot;
    ctx.fillRect(0, 0, size, size);
  }
  tex.update();
  return tex;
}

function setGlow(mat: StandardMaterial, color: Color3, alpha: number): void {
  mat.emissiveColor = color;
  mat.alpha = alpha;
}

function flatMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  return mat;
}
