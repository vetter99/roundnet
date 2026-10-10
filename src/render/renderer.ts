// Deep imports keep the bundle small; importing from '@babylonjs/core' pulls in everything.
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import type { Tuning } from '../config/tuning';
import { predictLanding } from '../sim/ball';
import { isPlayable, predictDescentTo } from '../sim/hit';
import type { HitKind } from '../sim/player';
import { DT } from '../sim/time';
import { Character, FUR } from './character';
import { chargePower } from '../sim/player';
import { clamp, lerp, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';

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
  private readonly ballShadow: Mesh;
  private readonly ballShadowMat: StandardMaterial;
  private courtKey = '';
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true });
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);

    this.camera = new UniversalCamera('broadcast', new Vector3(0, 7, -10), scene);
    this.camera.inputs.clear();

    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.35, 0.4, 0.35);
    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
    sun.intensity = 0.6;

    const grass = MeshBuilder.CreateGround('grass', { width: 60, height: 60 }, scene);
    grass.material = flatMaterial('grass', new Color3(0.3, 0.55, 0.28), scene);

    // A soft dark disc under the ball; it shrinks and fades as the ball rises.
    this.ballShadow = MeshBuilder.CreateDisc('ballShadow', { radius: 1, tessellation: 32 }, scene);
    this.ballShadow.rotation.x = Math.PI / 2;
    this.ballShadow.isPickable = false;
    this.ballShadowMat = flatMaterial('ballShadow', new Color3(0, 0, 0), scene);
    this.ballShadowMat.disableLighting = true;
    this.ballShadow.material = this.ballShadowMat;

    this.ball = MeshBuilder.CreateSphere('ball', { diameter: 1, segments: 20 }, scene);
    const ballMat = flatMaterial('ball', new Color3(1, 0.88, 0.1), scene);
    ballMat.emissiveColor = new Color3(0.25, 0.2, 0);
    this.ball.material = ballMat;

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
    this.updateCamera(t);
    this.rebuildCourtIfChanged(t);

    const b = world.ball.pos;
    this.ball.position.set(lerp(prev.ball.x, b.x, alpha), lerp(prev.ball.y, b.y, alpha), lerp(prev.ball.z, b.z, alpha));
    this.ball.scaling.setAll(t.ball.radius * 2);
    // No ball on court between rallies; it reappears with the serve.
    this.ball.isVisible = !world.waitingForServe;
    this.updateBallShadow(this.ball.position, world.ball.alive, t);
    this.updateNetWobble(frameSeconds, t);

    world.players.forEach((p, i) => {
      const view = this.players[i] ?? (this.players[i] = this.createPlayerView(p.team));
      const from = prev.players[i] ?? p.pos;
      const x = lerp(from.x, p.pos.x, alpha);
      const z = lerp(from.z, p.pos.z, alpha);
      const y = lerp(from.y, p.pos.y, alpha);
      const charge = p.charge ? { kind: p.charge.kind, power: chargePower(p.charge.ticks, t) } : null;
      view.character.update(p, x, y, z, t.player.size, frameSeconds, charge);
      this.updateMeter(view.meter, charge?.power ?? null, x, y + 1.55 * t.player.size, z);
      // A team-colored ring marks the player(s) whose ball it is.
      const myBall = p.team === world.possession && world.ball.alive && world.ball.lastTouch !== 'feed';
      view.reachRing.isVisible = myBall || t.debug.showReach;
      view.reachRing.position.set(x, 0.02, z);
      view.reachRing.scaling.set(t.player.reach, 1, t.player.reach);
    });

    this.updateMarker(world, t);
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

  /** Play the pass or spike animation for a player. */
  playSwing(playerId: number, kind: HitKind): void {
    this.players[playerId]?.character.playSwing(kind);
  }

  private updateCamera(t: Tuning): void {
    this.camera.position.set(0, t.camera.height, -t.camera.distance);
    this.camera.setTarget(new Vector3(0, 0, t.camera.lookAtZ));
    this.camera.fov = t.camera.fov;
  }

  private updateMarker(world: World, t: Tuning): void {
    const ball = world.ball;
    const landing = predictLanding(ball, t);
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
    const character = new Character(scene, TEAM_COLORS[team], team === 0 ? FUR.red : FUR.gray);

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
    const key = `${t.net.radius}|${t.net.frameWidth}|${t.net.height}|${t.court.serveLineDistance}`;
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
    const netMat = flatMaterial('netSurface', new Color3(0.08, 0.08, 0.08), scene);
    netMat.alpha = 0.9;
    netSurface.material = netMat;
    netSurface.parent = court;

    const frame = MeshBuilder.CreateTorus('frame', { diameter: radius * 2 + frameWidth, thickness: frameWidth, tessellation: 64 }, scene);
    frame.position.y = height;
    frame.material = flatMaterial('frame', new Color3(1, 0.85, 0.1), scene);
    frame.parent = court;

    const legMat = flatMaterial('leg', new Color3(0.15, 0.15, 0.15), scene);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const leg = MeshBuilder.CreateCylinder('leg', { diameter: 0.035, height }, scene);
      leg.position.set(Math.cos(angle) * (radius + frameWidth / 2), height / 2, Math.sin(angle) * (radius + frameWidth / 2));
      leg.material = legMat;
      leg.parent = court;
    }

    const serveDiameter = (radius + frameWidth + t.court.serveLineDistance) * 2;
    const serveLine = MeshBuilder.CreateTorus('serveLine', { diameter: serveDiameter, thickness: 0.04, tessellation: 96 }, scene);
    serveLine.position.y = 0.01;
    serveLine.scaling.y = 0.1;
    const lineMat = flatMaterial('serveLine', new Color3(1, 1, 1), scene);
    lineMat.alpha = 0.6;
    serveLine.material = lineMat;
    serveLine.parent = court;
  }
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
