// Deep imports keep the bundle small; importing from '@babylonjs/core' pulls in everything.
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
import { addHaze, createBallMaterial, createLawn, createNetMaterial, createScenery, createShadows, SKY } from './environment';
import { createStadium, type Stadium } from './stadium';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { chargePower, diveRecoveryTicks, diveTicks } from '../sim/player';
import { clamp, lerp, type Vec3 } from '../sim/vec';
import { serverTeam, type World } from '../sim/world';
import { serveWobble } from '../sim/serve';

const TEAM_COLORS = [new Color3(0.2, 0.45, 0.95), new Color3(0.95, 0.3, 0.25)];

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
  character: Character;
  reachRing: Mesh;
  meter: ChargeMeter;
}

interface ChargeMeter {
  root: TransformNode;
  fill: Mesh;
  fillMat: StandardMaterial;
}

// The ball's speed trail fades in between these speeds (m/s), so only fast
// spikes leave a streak.
const TRAIL_MIN_SPEED = 9;
const TRAIL_FULL_SPEED = 14;
const TRAIL_MAX_ALPHA = 0.45;

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
  // Landing spot + timing guide: a fixed target ring and an approach ring
  // that shrinks onto it as the ball nears the PERFECT moment.
  private readonly marker: TransformNode;
  private readonly approachRing: Mesh;
  private readonly approachMat: StandardMaterial;
  private readonly targetRing: Mesh;
  private readonly targetMat: StandardMaterial;
  private readonly players: PlayerView[] = [];
  private court: TransformNode | null = null;
  private netSurface: Mesh | null = null;
  // Trampoline wobble after the ball hits the net: a decaying spring.
  private netWobble = { amplitude: 0, time: 0 };
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
  // Where the server is aiming on the net during a serve.
  private readonly aimReticle: TransformNode;
  private readonly aimMat: StandardMaterial;

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

    createLawn(scene);
    createScenery(scene);
    this.stadium = createStadium(scene);
    addHaze(scene);

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
    const trail = new TrailMesh('ballTrail', this.ball, scene, { diameter: 0.16, length: 14, sections: 6, autoStart: true });
    this.trailMat = flatMaterial('ballTrail', new Color3(1, 0.95, 0.7), scene);
    this.trailMat.disableLighting = true;
    this.trailMat.emissiveColor = new Color3(1, 0.95, 0.7);
    this.trailMat.backFaceCulling = false;
    this.trailMat.alpha = 0;
    trail.material = this.trailMat;
    trail.isPickable = false;

    this.aimReticle = new TransformNode('aimReticle', scene);
    this.aimMat = glowMaterial('aimReticle', scene);
    const aimRing = MeshBuilder.CreateTorus('aimRing', { diameter: 0.26, thickness: 0.035, tessellation: 32 }, scene);
    const aimDot = MeshBuilder.CreateDisc('aimDot', { radius: 0.035, tessellation: 16 }, scene);
    aimDot.rotation.x = Math.PI / 2;
    for (const m of [aimRing, aimDot]) {
      m.material = this.aimMat;
      m.parent = this.aimReticle;
      m.isPickable = false;
    }

    this.marker = new TransformNode('marker', scene);
    this.approachMat = glowMaterial('approach', scene);
    this.targetMat = glowMaterial('target', scene);
    // Unit-radius rings scaled per frame (their thickness scales along with them).
    this.approachRing = MeshBuilder.CreateTorus('approachRing', { diameter: 2, thickness: 0.11, tessellation: 64 }, scene);
    this.approachRing.material = this.approachMat;
    this.targetRing = MeshBuilder.CreateTorus('targetRing', { diameter: 2, thickness: 0.2, tessellation: 48 }, scene);
    this.targetRing.material = this.targetMat;
    const dot = MeshBuilder.CreateDisc('markerDot', { radius: 0.06, tessellation: 24 }, scene);
    dot.rotation.x = Math.PI / 2;
    dot.material = this.targetMat;
    for (const m of [this.approachRing, this.targetRing, dot]) {
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
    this.ball.position.set(lerp(prev.ball.x, b.x, alpha), lerp(prev.ball.y, b.y, alpha), lerp(prev.ball.z, b.z, alpha));
    this.ball.scaling.setAll(t.ball.radius * 2);
    // No ball on court between rallies; it reappears with the serve.
    this.ball.isVisible = !world.waitingForServe;
    const v = world.ball.vel;
    const fast = clamp((Math.hypot(v.x, v.y, v.z) - TRAIL_MIN_SPEED) / (TRAIL_FULL_SPEED - TRAIL_MIN_SPEED), 0, 1);
    this.trailMat.alpha = world.ball.alive ? fast * TRAIL_MAX_ALPHA : 0;
    this.updateBallShadow(this.ball.position, world.ball.alive, t);
    this.updateNetWobble(frameSeconds, t);

    world.players.forEach((p, i) => {
      const view = this.players[i] ?? (this.players[i] = this.createPlayerView(p.team));
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
      view.character.update(p, x, y, z, t.player.size, frameSeconds, charge, dive, world.waitingForServe);
      this.updateMeter(view.meter, charge?.power ?? null, x, y + 1.55 * t.player.size, z);
      // Reach rings are a debug aid only (they were confused with the timing rings).
      view.reachRing.isVisible = t.debug.showReach;
      view.reachRing.position.set(x, 0.02, z);
      view.reachRing.scaling.set(t.player.reach, 1, t.player.reach);
    });

    this.updateMarker(world, landing, t);
    this.updateAimReticle(world, t);
    this.stadium.update(this.time);
    this.scene.render();
  }

  /** Make the net surface sag and spring back; call when the ball hits the net. */
  netImpact(impactSpeed: number): void {
    this.netWobble = { amplitude: clamp(impactSpeed * 0.012, 0.02, 0.1), time: 0 };
  }

  private updateNetWobble(dt: number, t: Tuning): void {
    if (!this.netSurface) return;
    const w = this.netWobble;
    w.time += dt;
    // Sags first, then bounces back with a few quick wobbles.
    const offset = -w.amplitude * Math.exp(-7 * w.time) * Math.cos(26 * w.time);
    this.netSurface.position.y = t.net.height + offset;
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

  /** Show the rally length and best rally on the jumbotron. */
  setRally(rally: number, best: number): void {
    this.stadium.setRally(rally, best);
  }

  /** Play the pass or spike animation for a player. */
  playSwing(playerId: number, kind: ShotKind): void {
    this.players[playerId]?.character.playSwing(kind);
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
    const receiver = world.players.find((p) => p.team === world.nextReceiver) ?? world.players[0];
    const server = world.players.find((p) => p.team !== world.nextReceiver) ?? world.players[0];
    const away = Math.hypot(receiver.pos.x, receiver.pos.z) || 1;
    const duelPos = {
      x: receiver.pos.x + (receiver.pos.x / away) * c.duelBack,
      y: c.duelHeight,
      z: receiver.pos.z + (receiver.pos.z / away) * c.duelBack,
    };
    const duelTarget = { x: server.pos.x * 0.35, y: 0.7, z: server.pos.z * 0.35 };

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
    this.yaw = Math.atan2(target.x - pos.x, target.z - pos.z);
  }

  /** The camera's yaw: 0 when looking along +z (the broadcast view), PI when looking back along -z. */
  viewYaw(): number {
    return this.yaw;
  }

  /** The server's aim on the net (plus their charge wobble), shown while waiting to serve. */
  private updateAimReticle(world: World, t: Tuning): void {
    const server = world.players.find((p) => p.team === serverTeam(world));
    const show = world.waitingForServe && server !== undefined;
    this.aimReticle.setEnabled(show);
    if (!show || !server) return;
    const wobble = serveWobble(world, server, t);
    this.aimReticle.position.set(world.serve.aim.x + wobble.x, t.net.height + 0.02, world.serve.aim.z + wobble.z);
    const color = TEAM_COLORS[server.team];
    this.aimMat.emissiveColor = Color3.Lerp(color, new Color3(1, 1, 1), 0.35);
    this.aimMat.alpha = 0.95;
  }

  private updateMarker(world: World, landing: LandingPrediction | null, t: Tuning): void {
    const ball = world.ball;
    const show = landing !== null && (t.marker.mode === 'always' || !landing.viaNet);
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

  private createPlayerView(team: 0 | 1): PlayerView {
    const scene = this.scene;
    const character = new Character(scene, TEAM_COLORS[team], team === 0 ? 'squirrel' : 'raccoon');
    for (const mesh of character.root.getChildMeshes()) this.shadows.addShadowCaster(mesh);

    const reachRing = MeshBuilder.CreateTorus('reach', { diameter: 2, thickness: 0.04, tessellation: 48 }, scene);
    const reachMat = flatMaterial('reach', TEAM_COLORS[team], scene);
    reachMat.alpha = 0.7;
    reachMat.disableLighting = true;
    reachMat.emissiveColor = TEAM_COLORS[team];
    reachRing.material = reachMat;

    return { character, reachRing, meter: this.createMeter() };
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

    const netSurface = (this.netSurface = MeshBuilder.CreateCylinder(
      'netSurface',
      { diameter: radius * 2, height: 0.01, tessellation: 64 },
      scene,
    ));
    netSurface.position.y = height;
    netSurface.material = createNetMaterial(scene);
    netSurface.receiveShadows = true;
    netSurface.parent = court;

    const frame = MeshBuilder.CreateTorus('frame', { diameter: radius * 2 + frameWidth, thickness: frameWidth, tessellation: 64 }, scene);
    frame.position.y = height;
    frame.material = flatMaterial('frame', new Color3(1, 0.85, 0.1), scene);
    frame.parent = court;
    this.shadows.addShadowCaster(frame);

    const legMat = flatMaterial('leg', new Color3(0.15, 0.15, 0.15), scene);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const leg = MeshBuilder.CreateCylinder('leg', { diameter: 0.035, height }, scene);
      leg.position.set(Math.cos(angle) * (radius + frameWidth / 2), height / 2, Math.sin(angle) * (radius + frameWidth / 2));
      leg.material = legMat;
      leg.parent = court;
      this.shadows.addShadowCaster(leg);
    }

    // Painted lines, measured out from the net's edge: the serve line and
    // the no-spike zone line close to the net.
    const lineMat = flatMaterial('courtLine', new Color3(1, 1, 1), scene);
    lineMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    lineMat.alpha = 0.85;
    lineMat.backFaceCulling = false;
    const edge = radius + frameWidth;
    for (const [name, distance] of [
      ['serveLine', t.court.serveLineDistance],
      ['noSpikeLine', t.court.noSpikeZoneDistance],
    ] as const) {
      const line = paintedRing(name, edge + distance, t.court.lineWidth, scene);
      line.material = lineMat;
      line.parent = court;
    }
  }
}

/** A flat painted ring on the grass, centered on the net, `width` wide. */
function paintedRing(name: string, radius: number, width: number, scene: Scene): Mesh {
  const segments = 128;
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * inner, 0.012, s * inner, c * outer, 0.012, s * outer);
    normals.push(0, 1, 0, 0, 1, 0);
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
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

const PERFECT_GREEN = new Color3(0.35, 1, 0.45);
const APPROACH_ORANGE = new Color3(1, 0.5, 0.1);
const TARGET_WHITE = new Color3(1, 1, 1);

/** An unlit material whose color and opacity are set per frame. */
function glowMaterial(name: string, scene: Scene): StandardMaterial {
  const mat = flatMaterial(name, TARGET_WHITE, scene);
  mat.disableLighting = true;
  return mat;
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
