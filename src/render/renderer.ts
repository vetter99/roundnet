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
import type { HitKind } from '../sim/player';
import { DT } from '../sim/time';
import { Character } from './character';
import { clamp, lerp, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';

// Real roundnet: servers stand 6ft (1.83m) back from the rim.
const SERVE_LINE_DISTANCE = 1.83;
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
}

/**
 * Draws the world. It only reads sim state and never changes it.
 */
export class Renderer {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly ball: Mesh;
  private readonly marker: TransformNode;
  private readonly markerMat: StandardMaterial;
  private readonly players: PlayerView[] = [];
  private court: TransformNode | null = null;
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

    this.ball = MeshBuilder.CreateSphere('ball', { diameter: 1, segments: 20 }, scene);
    const ballMat = flatMaterial('ball', new Color3(1, 0.88, 0.1), scene);
    ballMat.emissiveColor = new Color3(0.25, 0.2, 0);
    this.ball.material = ballMat;

    this.marker = new TransformNode('marker', scene);
    this.markerMat = flatMaterial('marker', new Color3(1, 0.45, 0.1), scene);
    this.markerMat.emissiveColor = new Color3(1, 0.45, 0.1);
    this.markerMat.disableLighting = true;
    const ring = MeshBuilder.CreateTorus('markerRing', { diameter: 2, thickness: 0.08, tessellation: 48 }, scene);
    const dot = MeshBuilder.CreateDisc('markerDot', { radius: 0.12, tessellation: 24 }, scene);
    dot.rotation.x = Math.PI / 2;
    for (const m of [ring, dot]) {
      m.material = this.markerMat;
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

    world.players.forEach((p, i) => {
      const view = this.players[i] ?? (this.players[i] = this.createPlayerView(p.team));
      const from = prev.players[i] ?? p.pos;
      const x = lerp(from.x, p.pos.x, alpha);
      const z = lerp(from.z, p.pos.z, alpha);
      view.character.update(p, x, lerp(from.y, p.pos.y, alpha), z, t.player.size, frameSeconds);
      view.reachRing.isVisible = t.debug.showReach;
      view.reachRing.position.set(x, 0.02, z);
      view.reachRing.scaling.set(t.player.reach, 1, t.player.reach);
    });

    this.updateMarker(world, t);
    this.scene.render();
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
    const landing = predictLanding(world.ball, t);
    const show = landing !== null && (t.marker.mode === 'always' || !landing.viaNet);
    this.marker.setEnabled(show);
    if (!landing || !show) return;

    const secondsLeft = landing.ticks * DT;
    const shrink = clamp(secondsLeft / t.marker.shrinkTime, 0, 1);
    const radius = lerp(t.marker.minRadius, t.marker.maxRadius, shrink);
    this.marker.position.set(landing.point.x, 0.03, landing.point.z);
    this.marker.scaling.set(radius, 1, radius);
    this.markerMat.alpha = 0.85 + 0.15 * Math.sin(this.time * 12);
  }

  private createPlayerView(team: 0 | 1): PlayerView {
    const scene = this.scene;
    const character = new Character(scene, TEAM_COLORS[team]);

    const reachRing = MeshBuilder.CreateTorus('reach', { diameter: 2, thickness: 0.02, tessellation: 48 }, scene);
    const reachMat = flatMaterial('reach', new Color3(1, 1, 1), scene);
    reachMat.alpha = 0.35;
    reachMat.disableLighting = true;
    reachMat.emissiveColor = new Color3(1, 1, 1);
    reachRing.material = reachMat;

    return { character, reachRing };
  }

  /** Net and serve line are rebuilt whenever their tuning values change. */
  private rebuildCourtIfChanged(t: Tuning): void {
    const key = `${t.net.radius}|${t.net.rimWidth}|${t.net.height}`;
    if (key === this.courtKey) return;
    this.courtKey = key;
    this.court?.dispose(false, true);

    const scene = this.scene;
    const court = (this.court = new TransformNode('court', scene));
    const { radius, rimWidth, height } = t.net;

    const netSurface = MeshBuilder.CreateCylinder('netSurface', { diameter: radius * 2, height: 0.01, tessellation: 64 }, scene);
    netSurface.position.y = height;
    const netMat = flatMaterial('netSurface', new Color3(0.08, 0.08, 0.08), scene);
    netMat.alpha = 0.9;
    netSurface.material = netMat;
    netSurface.parent = court;

    const rim = MeshBuilder.CreateTorus('rim', { diameter: radius * 2 + rimWidth, thickness: rimWidth, tessellation: 64 }, scene);
    rim.position.y = height;
    rim.material = flatMaterial('rim', new Color3(1, 0.85, 0.1), scene);
    rim.parent = court;

    const legMat = flatMaterial('leg', new Color3(0.15, 0.15, 0.15), scene);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const leg = MeshBuilder.CreateCylinder('leg', { diameter: 0.035, height }, scene);
      leg.position.set(Math.cos(angle) * (radius + rimWidth / 2), height / 2, Math.sin(angle) * (radius + rimWidth / 2));
      leg.material = legMat;
      leg.parent = court;
    }

    const serveDiameter = (radius + rimWidth + SERVE_LINE_DISTANCE) * 2;
    const serveLine = MeshBuilder.CreateTorus('serveLine', { diameter: serveDiameter, thickness: 0.04, tessellation: 96 }, scene);
    serveLine.position.y = 0.01;
    serveLine.scaling.y = 0.1;
    const lineMat = flatMaterial('serveLine', new Color3(1, 1, 1), scene);
    lineMat.alpha = 0.6;
    serveLine.material = lineMat;
    serveLine.parent = court;
  }
}

function flatMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  return mat;
}
