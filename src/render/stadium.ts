// The stadium bowl around the pitch: smooth tiered stands with real seat
// rows, aisles with steps and a front railing; nature-shaped touches
// (tree-trunk light towers, leaf canopies); a 3D crowd of all kinds of
// wildlife (crowd.ts); and a jumbotron. Seats and fans are thin instances.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createCrowd, type Seat } from './crowd';
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';

// Stands start this far from the net (the "medium" distance).
export const STAND_INNER_RADIUS = 18;
const ROWS = 10;
const ROW_DEPTH = 0.9;
const ROW_RISE = 0.55;
const FRONT_WALL_HEIGHT = 1.1;
export const STAND_OUTER_RADIUS = STAND_INNER_RADIUS + ROWS * ROW_DEPTH;
const TOP_HEIGHT = FRONT_WALL_HEIGHT + ROWS * ROW_RISE;

// One muted color for all the seating, for a grown-up pro-arena look.
const SEATS = new Color3(0.24, 0.32, 0.44);
const CONCRETE = new Color3(0.8, 0.8, 0.78);
// Seat spacing along a row, and the aisles (with steps) that break up the rows.
const SEAT_SPACING = 0.55;
const AISLES = 16;
const AISLE_WIDTH = 0.9;
const BARK = new Color3(0.47, 0.31, 0.18);
const LEAF = new Color3(0.3, 0.66, 0.27);

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

/** Yaw that turns a plane (which faces -z) toward the center from angle `a`. */
const faceCenterYaw = (a: number) => Math.PI / 2 - a;

export interface Stadium {
  /** Animate the crowd; call every frame. */
  update(time: number): void;
  /** Show two lines on the jumbotron under the logo (e.g. the score, or the rally count). */
  setJumbotron(main: string, sub: string): void;
}

export function createStadium(scene: Scene): Stadium {
  const seats = buildStands(scene);
  buildCanopiesAndTowers(scene);
  const crowd = createCrowd(scene, seats);
  const jumbotron = buildJumbotron(scene);
  return {
    update: (time) => crowd.update(time),
    setJumbotron: jumbotron,
  };
}

/** A flat ring (annulus) at height y, normals up. */
function flatRing(name: string, inner: number, outer: number, y: number, scene: Scene): Mesh {
  const segments = 160;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Texture repeats every TEXTURE_TILE meters along the ring.
  const along = (Math.PI * 2 * (inner + outer)) / 2 / TEXTURE_TILE;
  const across = (outer - inner) / TEXTURE_TILE;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    positions.push(c * inner, y, sn * inner, c * outer, y, sn * outer);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push((i / segments) * along, 0, (i / segments) * along, across);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  return mesh;
}

// Real-world size (m) of one repeat of the concrete and wall textures.
const TEXTURE_TILE = 3;

/** Poured concrete: a base tone with fine speckle and expansion joints, tileable. */
function concreteTexture(scene: Scene, name: string, base: [number, number, number]): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * 18;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // An expansion joint along one edge of each tile.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(0, 0, 2, size);
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** A material using a texture, tiled around a circle of `radius` (for cylinder walls). */
function wrappedMaterial(scene: Scene, name: string, tex: DynamicTexture, radius: number, height: number): StandardMaterial {
  const mat = material(scene, name, new Color3(1, 1, 1));
  const t = tex.clone();
  t.uScale = (Math.PI * 2 * radius) / TEXTURE_TILE;
  t.vScale = height / TEXTURE_TILE;
  mat.diffuseTexture = t;
  return mat;
}

/** The padded front wall: deep navy panels with seams and a lighter band near the top. */
function paddedWallTexture(scene: Scene): DynamicTexture {
  const w = 256;
  const h = 128;
  const tex = new DynamicTexture('paddedWall', { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#24407a');
  grad.addColorStop(1, '#16284d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Soft highlight across each pad, and seams between pads.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(0, h * 0.12, w, h * 0.18);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, 3, h);
  ctx.fillRect(w / 2, 0, 3, h);
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  return tex;
}

/** An open vertical cylinder wall (no caps), smooth shaded. */
function wall(name: string, radius: number, bottom: number, top: number, mat: StandardMaterial, scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { diameter: radius * 2, height: top - bottom, tessellation: 160, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  mesh.position.y = (top + bottom) / 2;
  mesh.material = mat;
  return mesh;
}

/** Whether an angle (radians) falls inside an aisle at radius r. */
function inAisle(angle: number, r: number): boolean {
  const step = (Math.PI * 2) / AISLES;
  const fromAisle = Math.abs(((angle % step) + step) % step - step / 2);
  return fromAisle < AISLE_WIDTH / 2 / r;
}

/**
 * Smooth tiered stands (curved risers and flat treads) behind a white wall
 * with a railing, individual seats with backs on every row, and aisles with
 * steps. Returns the seats so the crowd can sit in them.
 */
function buildStands(scene: Scene): Seat[] {
  // Treads are a warm light concrete; risers a shade darker so each step reads.
  const treadTex = concreteTexture(scene, 'treadConcrete', [206, 202, 194]);
  const treads = material(scene, 'treads', new Color3(1, 1, 1));
  treads.diffuseTexture = treadTex;
  const midRadius = (STAND_INNER_RADIUS + STAND_OUTER_RADIUS) / 2;
  const risers = wrappedMaterial(scene, 'risers', concreteTexture(scene, 'riserConcrete', [168, 166, 160]), midRadius, ROW_RISE);
  const white = material(scene, 'standWall', new Color3(0.96, 0.96, 0.94));

  // The front wall: padded navy panels, about 1.2 m each.
  const pads = material(scene, 'frontWall', new Color3(1, 1, 1));
  const padTex = paddedWallTexture(scene);
  padTex.uScale = (Math.PI * 2 * STAND_INNER_RADIUS) / 2.4;
  pads.diffuseTexture = padTex;
  wall('standWall', STAND_INNER_RADIUS, 0, FRONT_WALL_HEIGHT, pads, scene);
  const cap = MeshBuilder.CreateTorus('wallCap', { diameter: STAND_INNER_RADIUS * 2, thickness: 0.12, tessellation: 160 }, scene);
  cap.position.y = FRONT_WALL_HEIGHT;
  cap.material = white;

  // Railing along the top of the front wall: a rail on posts.
  const metal = material(scene, 'railing', new Color3(0.55, 0.58, 0.62));
  metal.specularColor = new Color3(0.4, 0.4, 0.4);
  const rail = MeshBuilder.CreateTorus('rail', { diameter: STAND_INNER_RADIUS * 2 - 0.1, thickness: 0.05, tessellation: 160 }, scene);
  rail.position.y = FRONT_WALL_HEIGHT + 0.55;
  rail.material = metal;
  const post = MeshBuilder.CreateCylinder('railPost', { height: 0.55, diameter: 0.04, tessellation: 6 }, scene);
  post.material = metal;
  const postCount = 96;
  const postMatrices = new Float32Array(postCount * 16);
  for (let i = 0; i < postCount; i++) {
    const a = (i / postCount) * Math.PI * 2;
    const r = STAND_INNER_RADIUS - 0.05;
    Matrix.Translation(Math.cos(a) * r, FRONT_WALL_HEIGHT + 0.275, Math.sin(a) * r).copyToArray(postMatrices, i * 16);
  }
  post.thinInstanceSetBuffer('matrix', postMatrices, 16, true);

  // Tiers: a flat tread for each row and a curved riser up to the next.
  for (let row = 0; row < ROWS; row++) {
    const inner = STAND_INNER_RADIUS + row * ROW_DEPTH;
    const h = FRONT_WALL_HEIGHT + row * ROW_RISE;
    flatRing(`tread${row}`, inner, inner + ROW_DEPTH, h, scene).material = treads;
    wall(`riser${row}`, inner + ROW_DEPTH, h, h + ROW_RISE, risers, scene);
  }
  wall('standBack', STAND_OUTER_RADIUS + 0.2, 0, TOP_HEIGHT + 1.2, white, scene);

  // A seat: a pan and a backrest, merged into one mesh, drawn once per seat.
  // Molded plastic seats with a bit of shine.
  const seatMat = material(scene, 'seats', SEATS);
  seatMat.specularColor = new Color3(0.35, 0.35, 0.38);
  seatMat.specularPower = 40;
  const pan = MeshBuilder.CreateBox('seatPan', { width: 0.44, height: 0.07, depth: 0.38 }, scene);
  pan.position.set(0, 0.2, 0);
  const back = MeshBuilder.CreateBox('seatBack', { width: 0.44, height: 0.38, depth: 0.06 }, scene);
  back.position.set(0, 0.4, 0.18);
  const seatMesh = Mesh.MergeMeshes([pan, back], true)!;
  seatMesh.material = seatMat;

  const seats: Seat[] = [];
  const seatMatrices: number[] = [];
  const steps: number[] = [];
  const nosings: number[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = STAND_INNER_RADIUS + (row + 0.55) * ROW_DEPTH;
    const h = FRONT_WALL_HEIGHT + row * ROW_RISE;
    const count = Math.floor((Math.PI * 2 * r) / SEAT_SPACING);
    for (let k = 0; k < count; k++) {
      const a = ((k + 0.5) / count) * Math.PI * 2;
      if (inAisle(a, r)) continue;
      const yaw = faceCenterYaw(a);
      const seat = { x: Math.cos(a) * r, y: h, z: Math.sin(a) * r, yaw };
      seats.push(seat);
      Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(seat.x, seat.y, seat.z)).copyToArray(
        seatMatrices,
        seatMatrices.length,
      );
    }
    // A half-height step in each aisle, between this row and the next.
    for (let i = 0; i < AISLES; i++) {
      const a = ((i + 0.5) / AISLES) * Math.PI * 2;
      const sr = STAND_INNER_RADIUS + (row + 0.75) * ROW_DEPTH;
      const yaw = Quaternion.FromEulerAngles(0, faceCenterYaw(a), 0);
      Matrix.Compose(
        new Vector3(AISLE_WIDTH, ROW_RISE / 2, ROW_DEPTH / 2),
        yaw,
        new Vector3(Math.cos(a) * sr, h + ROW_RISE / 4, Math.sin(a) * sr),
      ).copyToArray(steps, steps.length);
      // Nosing on the half step's front edge, and on the tread's front edge.
      for (const [edgeR, edgeY] of [
        [sr - ROW_DEPTH / 4, h + ROW_RISE / 2],
        [STAND_INNER_RADIUS + row * ROW_DEPTH, h],
      ]) {
        Matrix.Compose(
          new Vector3(AISLE_WIDTH, 0.02, 0.06),
          yaw,
          new Vector3(Math.cos(a) * (edgeR + 0.03), edgeY + 0.011, Math.sin(a) * (edgeR + 0.03)),
        ).copyToArray(nosings, nosings.length);
      }
    }
  }
  seatMesh.thinInstanceSetBuffer('matrix', new Float32Array(seatMatrices), 16, true);
  const stepMesh = MeshBuilder.CreateBox('aisleStep', { size: 1 }, scene);
  stepMesh.material = material(scene, 'aisleStep', CONCRETE.scale(1.1));
  stepMesh.thinInstanceSetBuffer('matrix', new Float32Array(steps), 16, true);
  // Yellow safety strips on the front edge of every step and tread in the aisles.
  const nosing = MeshBuilder.CreateBox('stepNosing', { width: 1, height: 1, depth: 1 }, scene);
  nosing.material = material(scene, 'stepNosing', new Color3(0.98, 0.8, 0.12));
  nosing.thinInstanceSetBuffer('matrix', new Float32Array(nosings), 16, true);
  return seats;
}

/** Leaf-shaped canopies over the top of the stands, and tree-trunk light towers. */
function buildCanopiesAndTowers(scene: Scene): void {
  const leafMat = material(scene, 'canopyLeaf', LEAF);
  const veinMat = material(scene, 'canopyVein', LEAF.scale(0.7));
  const barkMat = material(scene, 'bark', BARK);
  const leaves = 14;
  for (let i = 0; i < leaves; i++) {
    const angle = (i / leaves) * Math.PI * 2;
    const r = STAND_OUTER_RADIUS - 2.5;
    // A broad, flat leaf pointing in toward the field, tilted down at the tip.
    const leaf = MeshBuilder.CreateSphere(`canopy${i}`, { diameter: 1, segments: 12 }, scene);
    leaf.scaling.set(7, 0.22, 3.4);
    leaf.material = leafMat;
    const vein = MeshBuilder.CreateBox(`canopyVein${i}`, { width: 6.4, height: 0.12, depth: 0.18 }, scene);
    vein.material = veinMat;
    vein.position.y = 0.12;
    vein.parent = leaf;
    vein.scaling.set(1 / 7, 1 / 0.22, 1 / 3.4);
    leaf.position.set(Math.cos(angle) * r, TOP_HEIGHT + 3.2, Math.sin(angle) * r);
    leaf.rotation.y = -angle;
    leaf.rotation.z = 0.22;
    // A twisted trunk holding it up from behind.
    const stem = MeshBuilder.CreateCylinder(`canopyStem${i}`, { height: TOP_HEIGHT + 3.4, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 8 }, scene);
    stem.material = barkMat;
    stem.position.set(Math.cos(angle) * (STAND_OUTER_RADIUS + 0.4), (TOP_HEIGHT + 3.4) / 2, Math.sin(angle) * (STAND_OUTER_RADIUS + 0.4));
  }

  // Four tall light towers shaped like trees, with leafy lamp heads.
  const lampMat = material(scene, 'lamp', new Color3(1, 1, 0.9));
  lampMat.emissiveColor = new Color3(1, 0.98, 0.85);
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const r = STAND_OUTER_RADIUS + 2.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const trunk = MeshBuilder.CreateCylinder('towerTrunk', { height: 20, diameterTop: 0.7, diameterBottom: 1.5, tessellation: 9 }, scene);
    trunk.material = barkMat;
    trunk.position.set(x, 10, z);
    const crown = MeshBuilder.CreateIcoSphere('towerCrown', { radius: 2.6, subdivisions: 1 }, scene);
    crown.convertToFlatShadedMesh();
    crown.scaling.set(1.2, 0.75, 1.2);
    crown.material = leafMat;
    crown.position.set(x, 20.5, z);
    // The lights face the field.
    const lamp = MeshBuilder.CreateBox('towerLamp', { width: 3.2, height: 1.4, depth: 0.3 }, scene);
    lamp.material = lampMat;
    lamp.position.set(x * 0.94, 20, z * 0.94);
    lamp.rotation.y = faceCenterYaw(a);
  }
}

/** The jumbotron on the far side: a placeholder logo and two lines of info. */
function buildJumbotron(scene: Scene): (main: string, sub: string) => void {
  const angle = Math.PI / 2; // far side (+z), facing the camera
  const r = STAND_OUTER_RADIUS + 1.5;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  const y = TOP_HEIGHT + 5.5;

  const frame = MeshBuilder.CreateBox('jumbotronFrame', { width: 11, height: 6.4, depth: 0.6 }, scene);
  frame.material = material(scene, 'jumbotronFrame', new Color3(0.15, 0.16, 0.2));
  frame.position.set(x, y, z + 0.35);
  for (const dx of [-3.5, 3.5]) {
    const leg = MeshBuilder.CreateCylinder('jumbotronLeg', { height: y, diameterTop: 0.5, diameterBottom: 0.9, tessellation: 8 }, scene);
    leg.material = material(scene, 'jumbotronLeg', BARK);
    leg.position.set(x + dx, y / 2, z + 0.6);
  }

  const tex = new DynamicTexture('jumbotron', { width: 1024, height: 576 }, scene, true);
  const screen = MeshBuilder.CreatePlane('jumbotronScreen', { width: 10.2, height: 5.7 }, scene);
  const mat = new StandardMaterial('jumbotronScreen', scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  screen.material = mat;
  screen.position.set(x, y, z);

  let shown = '';
  const draw = (main: string, sub: string) => {
    const key = `${main}/${sub}`;
    if (key === shown) return;
    shown = key;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, 576);
    grad.addColorStop(0, '#16348a');
    grad.addColorStop(1, '#0b1a45');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 576);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd21f';
    ctx.font = 'italic 900 150px "Arial Black", Impact, sans-serif';
    ctx.fillText('ROUNDNET', 512, 220);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 96px "Arial Black", Impact, sans-serif';
    ctx.fillText(main, 512, 370);
    ctx.fillStyle = '#9fc2ff';
    ctx.font = '800 56px "Arial Black", Impact, sans-serif';
    ctx.fillText(sub, 512, 470);
    tex.update();
  };
  draw('RALLY 0', 'BEST 0');
  return draw;
}
