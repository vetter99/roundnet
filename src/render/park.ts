// A small-town Midwest park instead of the stadium: the court is set up on
// the open, mowed lawn of a quiet country park. Around it, kept low-key:
// families on picnic blankets, a handful of shade trees, a
// farm pond with ducks, a split-rail fence at the
// park's edge, and beyond it cornfields and a water tower on the horizon.
// (The score is on screen; there's no physical scoreboard.) Neighborhood
// critters watch from their picnic blankets.
// Low-poly and flat-shaded like everything else. Visual only.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
// Registers thin instances (the cornfields).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { createCrowd, type Seat } from './crowd';
import { SMOOTH } from './style';
import type { Stadium } from './stadium';

// Families on picnic blankets sit this far out from the net (m; the court's
// players stay within about 7 m), and kids are this size next to grown-ups.
const FAMILY_RADIUS = 16.5;
const KID_SIZE = 0.62;
// Trees and the pond are placed around the field relative to this radius (m).
const PATH_RADIUS = 13;

type V3 = [number, number, number];

function mat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  return m;
}

/** Builds flat-shaded low-poly shapes. */
class Builder {
  constructor(readonly scene: Scene) {}

  private put(mesh: Mesh, m: StandardMaterial, pos: V3, rot?: V3, parent?: TransformNode): Mesh {
    if (!SMOOTH) mesh.convertToFlatShadedMesh();
    mesh.material = m;
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    if (parent) mesh.parent = parent;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }

  box(size: V3, m: StandardMaterial, pos: V3, rot?: V3, parent?: TransformNode): Mesh {
    return this.put(MeshBuilder.CreateBox('park', { width: size[0], height: size[1], depth: size[2] }, this.scene), m, pos, rot, parent);
  }

  cylinder(height: number, top: number, bottom: number, m: StandardMaterial, pos: V3, rot?: V3, tessellation = 9, parent?: TransformNode): Mesh {
    const mesh = MeshBuilder.CreateCylinder('park', { height, diameterTop: top, diameterBottom: bottom, tessellation }, this.scene);
    return this.put(mesh, m, pos, rot, parent);
  }

  blob(radius: number, m: StandardMaterial, pos: V3, scale: V3 = [1, 1, 1], parent?: TransformNode): Mesh {
    const shape = SMOOTH
      ? MeshBuilder.CreateSphere('park', { diameter: radius * 2, segments: 16 }, this.scene)
      : MeshBuilder.CreateIcoSphere('park', { radius, subdivisions: 1 }, this.scene);
    const mesh = this.put(shape, m, pos, undefined, parent);
    mesh.scaling.set(...scale);
    return mesh;
  }

  node(pos: V3, rotY = 0): TransformNode {
    const n = new TransformNode('parkGroup', this.scene);
    n.position.set(...pos);
    n.rotation.y = rotY;
    return n;
  }
}

/** Yaw that turns a seat's -z (or a prop's front) toward the middle of the field. */
const faceCenter = (x: number, z: number) => Math.atan2(x, z);

/** A point at `angle` around the field, `r` out (angle 0 = +x, PI/2 = +z, the far side). */
const around = (angle: number, r: number): [number, number] => [Math.cos(angle) * r, Math.sin(angle) * r];

export function createPark(scene: Scene): Stadium {
  const b = new Builder(scene);
  const seats: Seat[] = [];
  buildTrees(b);
  buildBlankets(b, seats);
  buildPond(b);
  buildParkFence(b);
  buildCornfields(b);
  buildWaterTower(b);
  // Every seat taken: it's a small crowd of families and neighbors.
  const crowd = createCrowd(scene, seats, 1);
  return {
    update: (time) => crowd.update(time),
    // No physical scoreboard here: the score is on screen.
    setJumbotron: () => {},
  };
}

/** A handful of big shade trees in the park (clear of the camera's view of the court). */
function buildTrees(b: Builder): void {
  const scene = b.scene;
  const bark = mat(scene, 'parkBark', new Color3(0.42, 0.29, 0.18));
  const leaves = [new Color3(0.27, 0.56, 0.24), new Color3(0.33, 0.62, 0.27), new Color3(0.22, 0.5, 0.26), new Color3(0.4, 0.62, 0.22)].map((c, i) =>
    mat(scene, `parkLeaves${i}`, c),
  );
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) {
    // On the far side and the flanks (the camera usually looks from the near side).
    const a = -0.4 + (i / 6) * (Math.PI + 0.8) + (rand() - 0.5) * 0.3;
    const r = PATH_RADIUS + 4 + rand() * 4;
    const [x, z] = around(a, r);
    const s = 0.8 + rand() * 0.6;
    b.cylinder(3 * s, 0.35 * s, 0.55 * s, bark, [x, 1.5 * s, z]);
    b.blob(1.8 * s, leaves[i % leaves.length], [x, 3.9 * s, z]);
    b.blob(1.3 * s, leaves[(i + 1) % leaves.length], [x + 1 * s, 3.5 * s, z + 0.4 * s]);
    b.blob(1.2 * s, leaves[(i + 2) % leaves.length], [x - 0.8 * s, 3.7 * s, z - 0.6 * s]);
  }
}

/**
 * Families out on checkered picnic blankets, well back from the court: two
 * grown-ups behind, and one or two kids (smaller critters) up front.
 */
function buildBlankets(b: Builder, seats: Seat[]): void {
  const scene = b.scene;
  const colors = ['#d8383a', '#2f72d6', '#2e9b55', '#e08a1e', '#8a4fd6'];
  const angles = [0.3, 0.95, 1.6, 2.25, 2.85];
  const basket = mat(scene, 'basket', new Color3(0.7, 0.52, 0.3));
  colors.forEach((c, i) => {
    const a = angles[i];
    const [x, z] = around(a, FAMILY_RADIUS);
    const m = mat(scene, `blanket${i}`, new Color3(1, 1, 1));
    m.diffuseTexture = checkerTexture(scene, c);
    b.box([2.6, 0.02, 2], m, [x, 0.012, z], [0, faceCenter(x, z) + 0.15, 0]);
    // Across (along the blanket's width) and toward the court from its middle.
    const across = (d: number): [number, number] => [Math.cos(a + Math.PI / 2) * d, Math.sin(a + Math.PI / 2) * d];
    const forward = (d: number): [number, number] => [-Math.cos(a) * d, -Math.sin(a) * d];
    const [bx, bz] = across(1.05);
    b.box([0.4, 0.25, 0.3], basket, [x + bx, 0.13, z + bz]);
    const sit = (acrossBy: number, forwardBy: number, scale: number) => {
      const [ax, az] = across(acrossBy);
      const [fx, fz] = forward(forwardBy);
      const sx = x + ax + fx;
      const sz = z + az + fz;
      seats.push({ x: sx, y: 0.02, z: sz, yaw: faceCenter(sx, sz), scale });
    };
    // Grown-ups at the back.
    sit(-0.45, -0.4, 1);
    sit(0.4, -0.4, 1);
    // Kids up front: two on some blankets, one on others.
    sit(-0.25, 0.45, KID_SIZE);
    if (i % 2 === 0) sit(0.35, 0.5, KID_SIZE);
  });
}

/** A red-and-white (or other color) gingham pattern. */
function checkerTexture(scene: Scene, color: string): DynamicTexture {
  const tex = new DynamicTexture('checker', { width: 64, height: 64 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#f6f2ea';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(i * 16, 0, 8, 64);
    ctx.fillRect(0, i * 16, 64, 8);
  }
  tex.update();
  tex.uScale = 3;
  tex.vScale = 3;
  return tex;
}

/** A pond off to the right with a few ducks. */
function buildPond(b: Builder): void {
  const scene = b.scene;
  const water = mat(scene, 'pond', new Color3(0.35, 0.62, 0.85));
  water.specularColor = new Color3(0.3, 0.3, 0.3);
  const bank = mat(scene, 'pondBank', new Color3(0.55, 0.5, 0.4));
  const [x, z] = around(0.55, PATH_RADIUS + 8);
  b.cylinder(0.12, 9.5, 9.8, bank, [x, 0.03, z], undefined, 14).scaling.set(1, 1, 0.65);
  b.cylinder(0.1, 9, 9, water, [x, 0.06, z], undefined, 14).scaling.set(1, 1, 0.6);
  const duck = mat(scene, 'duck', new Color3(0.97, 0.96, 0.9));
  const beak = mat(scene, 'duckBeak', new Color3(1, 0.6, 0.1));
  for (const [dx, dz] of [[-1.5, 0.5], [0.5, -1], [2, 1.2]]) {
    b.blob(0.25, duck, [x + dx, 0.2, z + dz], [1.3, 0.8, 1]);
    b.blob(0.14, duck, [x + dx + 0.25, 0.4, z + dz]);
    b.blob(0.06, beak, [x + dx + 0.4, 0.38, z + dz], [1.5, 0.6, 1]);
  }
}

// The park's edge (a split-rail fence) and where the cornfields begin (m from center).
const FENCE_RADIUS = 27;
const FIELDS_START = 32;
const CORN_REACH = 90;

/** A split-rail wooden fence all the way around the park. */
function buildParkFence(b: Builder): void {
  const scene = b.scene;
  const wood = mat(scene, 'railWood', new Color3(0.55, 0.42, 0.3));
  const posts = 56;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const [x, z] = around(a, FENCE_RADIUS);
    b.box([0.18, 1.2, 0.18], wood, [x, 0.6, z], [0, -a, 0]);
    if (prev) {
      const [px, pz] = prev;
      const len = Math.hypot(x - px, z - pz);
      const yaw = Math.atan2(x - px, z - pz);
      for (const y of [0.45, 0.95]) b.box([0.1, 0.12, len], wood, [(x + px) / 2, y, (z + pz) / 2], [0, yaw, 0.1]);
    }
    prev = [x, z];
  }
}

/**
 * Cornfields beyond the fence: rows of tall stalks with leaves and golden
 * tassels, drawn as thin instances so thousands of stalks cost a few draws.
 */
function buildCornfields(b: Builder): void {
  const scene = b.scene;
  const stalk = MeshBuilder.CreateCylinder('cornStalk', { height: 2.3, diameterTop: 0.04, diameterBottom: 0.07, tessellation: 5 }, scene);
  stalk.material = mat(scene, 'cornStalk', new Color3(0.4, 0.6, 0.22));
  const leaf = MeshBuilder.CreateIcoSphere('cornLeaf', { radius: 0.5, subdivisions: 1 }, scene);
  if (!SMOOTH) leaf.convertToFlatShadedMesh();
  leaf.material = mat(scene, 'cornLeaf', new Color3(0.45, 0.66, 0.25));
  const tassel = MeshBuilder.CreateCylinder('cornTassel', { height: 0.35, diameterTop: 0, diameterBottom: 0.16, tessellation: 5 }, scene);
  tassel.material = mat(scene, 'cornTassel', new Color3(0.9, 0.78, 0.4));
  const parts = [
    { mesh: stalk, data: [] as number[] },
    { mesh: leaf, data: [] as number[] },
    { mesh: tassel, data: [] as number[] },
  ];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const add = (part: (typeof parts)[number], scale: Vector3, rot: Quaternion, pos: Vector3) => {
    const m = Matrix.Compose(scale, rot, pos);
    const arr = new Float32Array(16);
    m.copyToArray(arr);
    part.data.push(...arr);
  };
  // Fields as [x0, x1, z0, z1]; rows run along z (toward the horizon from the camera).
  // Corn all the way around the park, out to CORN_REACH; rows thin out with
  // distance (where the haze hides the gaps) to keep the count down.
  const fields: [number, number, number, number][] = [[-CORN_REACH, CORN_REACH, -CORN_REACH, CORN_REACH]];
  for (const [x0, x1, z0, z1] of fields) {
    for (let x = x0; x <= x1; x += 1.1) {
      for (let z = z0; z <= z1; z += 0.7) {
        // Keep a rounded clearing around the park, and thin the far rows.
        const d = Math.hypot(x, z);
        if (d < FIELDS_START || d > CORN_REACH) continue;
        if (d > 55 && rand() < Math.min(0.75, (d - 55) / 40)) continue;
        const h = 0.85 + rand() * 0.3;
        const px = x + (rand() - 0.5) * 0.3;
        const pz = z + (rand() - 0.5) * 0.3;
        const lean = Quaternion.FromEulerAngles((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
        add(parts[0], new Vector3(1, h, 1), lean, new Vector3(px, 1.15 * h, pz));
        add(parts[1], new Vector3(0.9, 0.08, 0.25), Quaternion.FromEulerAngles(0.4, rand() * Math.PI * 2, 0), new Vector3(px, 1.2 * h, pz));
        add(parts[1], new Vector3(0.8, 0.08, 0.22), Quaternion.FromEulerAngles(-0.3, rand() * Math.PI * 2, 0), new Vector3(px, 1.7 * h, pz));
        add(parts[2], new Vector3(1, 1, 1), lean, new Vector3(px, 2.4 * h, pz));
      }
    }
  }
  for (const part of parts) part.mesh.thinInstanceSetBuffer('matrix', new Float32Array(part.data), 16, true);
}

/** A water tower on the horizon, past the corn. */
function buildWaterTower(b: Builder): void {
  const scene = b.scene;
  const steel = mat(scene, 'towerSteel', new Color3(0.82, 0.85, 0.88));
  const tx = 46;
  const tz = 95;
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) b.cylinder(16, 0.35, 0.5, steel, [tx + dx * 0.7, 8, tz + dz * 0.7], [dz * 0.04, 0, -dx * 0.04], 6);
  b.blob(5, steel, [tx, 19, tz], [1, 0.75, 1]);
  b.cylinder(2, 0.4, 7, steel, [tx, 22.6, tz], undefined, 12);
}

/**
 * Late afternoon out in the country: a soft blue sky dome, warm light with
 * short, faint shadows (so they never hide the play), flat farmland
 * stretching to the horizon, and a light haze far out.
 */
export function makeEvening(scene: Scene, sun: DirectionalLight, hemi: HemisphericLight, shadows: ShadowGenerator): void {
  // Faint shadows, so they never hide the play.
  shadows.darkness = 0.32;
  // The sun is behind the far right of the court as seen from the camera,
  // high enough that player shadows stay short.
  sun.direction = new Vector3(-0.5, -1, -0.4).normalize();
  sun.position = sun.direction.scale(-40);
  // Warm, but bright enough that the players and ball read clearly.
  sun.intensity = 1.15;
  sun.diffuse = new Color3(1, 0.8, 0.58);
  hemi.intensity = 0.72;
  hemi.diffuse = new Color3(0.88, 0.85, 0.95);
  hemi.groundColor = new Color3(0.45, 0.42, 0.32);
  scene.clearColor = new Color4(HORIZON.r, HORIZON.g, HORIZON.b, 1);

  // The sky dome.
  const tex = new DynamicTexture('eveningSky', { width: 8, height: 256 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  // A soft, unremarkable blue, a little paler toward the horizon. (The
  // canvas lands upside down on the dome: the zenith is at the bottom.)
  grad.addColorStop(1, '#7fa6d6');
  grad.addColorStop(0.6, '#9dbde2');
  grad.addColorStop(0.5, '#c4d6e8');
  grad.addColorStop(0, '#c4d6e8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  tex.update();
  const dome = MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 16, sideOrientation: 1 }, scene);
  const skyMat = new StandardMaterial('sky', scene);
  skyMat.emissiveTexture = tex;
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  dome.material = skyMat;
  dome.isPickable = false;
  dome.infiniteDistance = true;

  // Flat farmland past the lawn, out to the horizon.
  const land = MeshBuilder.CreateGround('farmland', { width: 3000, height: 3000 }, scene);
  const landMat = new StandardMaterial('farmland', scene);
  landMat.diffuseColor = new Color3(0.42, 0.52, 0.25);
  landMat.specularColor = new Color3(0, 0, 0);
  land.material = landMat;
  land.position.y = -0.02;
  land.isPickable = false;
}

// The haze color at the horizon.
export const HORIZON = new Color3(0.77, 0.84, 0.91);
