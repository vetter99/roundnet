// The stadium bowl around the park lawn: a bright modern arena with
// nature-shaped touches (tree-trunk light towers, leaf canopies), a
// cardboard-cutout crowd of all kinds of wildlife, and a jumbotron.
// Everything is low-poly and instanced; textures are drawn on canvases.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
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
const FAN_SHIRTS = ['#ff4d4d', '#2f7bff', '#ffcc1f', '#2fc46b', '#ff8a1f', '#ffffff'];
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
  /** Show the current and best rally length on the jumbotron. */
  setRally(rally: number, best: number): void;
}

export function createStadium(scene: Scene): Stadium {
  buildStands(scene);
  buildCanopiesAndTowers(scene);
  const crowd = buildCrowd(scene);
  const jumbotron = buildJumbotron(scene);
  return {
    update(time) {
      // Fans bob in their seats, each on its own rhythm; a few wave higher.
      for (const fan of crowd) {
        const bob = Math.max(0, Math.sin(time * fan.speed + fan.phase));
        fan.mesh.position.y = fan.baseY + bob * fan.height;
      }
    },
    setRally: jumbotron,
  };
}

/** Continuous tiered seating all the way around, behind a white wall. */
function buildStands(scene: Scene): void {
  const wall = MeshBuilder.CreateCylinder(
    'standWall',
    { diameter: STAND_INNER_RADIUS * 2, height: FRONT_WALL_HEIGHT, tessellation: 96, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  wall.position.y = FRONT_WALL_HEIGHT / 2;
  wall.material = material(scene, 'standWall', new Color3(0.96, 0.96, 0.94));
  const trim = MeshBuilder.CreateTorus('wallTrim', { diameter: STAND_INNER_RADIUS * 2, thickness: 0.18, tessellation: 96 }, scene);
  trim.position.y = FRONT_WALL_HEIGHT;
  trim.material = material(scene, 'wallTrim', SEATS.scale(0.8));

  // The stepped profile of the stands (radius, height), spun around the field.
  const profile: Vector3[] = [new Vector3(STAND_INNER_RADIUS, FRONT_WALL_HEIGHT, 0)];
  for (let row = 0; row < ROWS; row++) {
    const r = STAND_INNER_RADIUS + row * ROW_DEPTH;
    const h = FRONT_WALL_HEIGHT + row * ROW_RISE;
    profile.push(new Vector3(r, h, 0), new Vector3(r + ROW_DEPTH, h, 0), new Vector3(r + ROW_DEPTH, h + ROW_RISE, 0));
  }
  profile.push(new Vector3(STAND_OUTER_RADIUS, 0, 0));
  const stands = MeshBuilder.CreateLathe('stands', { shape: profile, tessellation: 120, sideOrientation: Mesh.DOUBLESIDE }, scene);
  // Flat shading gives each step a crisp edge (treads lit, risers darker).
  stands.convertToFlatShadedMesh();
  stands.material = material(scene, 'seats', SEATS);

  // The concourse wall closing off the back of the stands.
  const back = MeshBuilder.CreateCylinder(
    'standBack',
    { diameter: STAND_OUTER_RADIUS * 2 + 0.4, height: TOP_HEIGHT + 1.2, tessellation: 96, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  back.position.y = (TOP_HEIGHT + 1.2) / 2;
  back.material = material(scene, 'standBack', new Color3(0.92, 0.92, 0.9));
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

interface Fan {
  mesh: InstancedMesh;
  baseY: number;
  height: number;
  speed: number;
  phase: number;
}

type DrawSpecies = (ctx: CanvasRenderingContext2D) => void;

/** Cardboard-cutout fans: one canvas drawing per species and shirt color, instanced around the stands. */
function buildCrowd(scene: Scene): Fan[] {
  const species: DrawSpecies[] = [bear, fox, rabbit, deer, owl, frog, raccoon, hedgehog, beaver, turtle];
  const cutouts: Mesh[] = [];
  species.forEach((draw, si) => {
    FAN_SHIRTS.forEach((shirt, ci) => {
      if ((si + ci) % 2) return; // half the combinations is plenty of variety
      const tex = new DynamicTexture(`fan-${si}-${ci}`, { width: 128, height: 160 }, scene, true);
      tex.hasAlpha = true;
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 128, 160);
      drawBody(ctx, shirt);
      draw(ctx);
      tex.update();
      const mat = new StandardMaterial(`fan-${si}-${ci}`, scene);
      mat.diffuseTexture = tex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
      mat.backFaceCulling = false;
      mat.specularColor = new Color3(0, 0, 0);
      mat.emissiveColor = new Color3(0.25, 0.25, 0.25);
      const plane = MeshBuilder.CreatePlane(`fan-${si}-${ci}`, { width: 0.8, height: 1 }, scene);
      plane.material = mat;
      plane.isVisible = false;
      cutouts.push(plane);
    });
  });

  // Repeatable pseudo-random seating.
  let seed = 99;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const fans: Fan[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = STAND_INNER_RADIUS + (row + 0.35) * ROW_DEPTH;
    const top = FRONT_WALL_HEIGHT + row * ROW_RISE;
    const seats = Math.floor((Math.PI * 2 * r) / 0.75);
    for (let k = 0; k < seats; k++) {
      if (rand() > 0.72) continue; // some empty seats
      const angle = ((k + 0.5) / seats) * Math.PI * 2;
      const fan = cutouts[Math.floor(rand() * cutouts.length)].createInstance(`fan-${row}-${k}`);
      const baseY = top + 0.48;
      fan.position.set(Math.cos(angle) * r, baseY, Math.sin(angle) * r);
      fan.rotation.y = faceCenterYaw(angle);
      fans.push({ mesh: fan, baseY, height: rand() > 0.85 ? 0.35 : 0.1, speed: 3 + rand() * 4, phase: rand() * 10 });
    }
  }
  return fans;
}

/** Shirt and arms shared by every fan; the species drawing adds the head. */
function drawBody(ctx: CanvasRenderingContext2D, shirt: string): void {
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.roundRect(30, 88, 68, 72, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function head(ctx: CanvasRenderingContext2D, color: string, r = 30, y = 62): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function eyes(ctx: CanvasRenderingContext2D, y = 58, spread = 11, size = 4.5, color = '#1a1a1a'): void {
  ctx.fillStyle = color;
  for (const dx of [-spread, spread]) {
    ctx.beginPath();
    ctx.arc(64 + dx, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function ellipse(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function bear(ctx: CanvasRenderingContext2D): void {
  ellipse(ctx, '#7a4a28', 40, 36, 12, 12);
  ellipse(ctx, '#7a4a28', 88, 36, 12, 12);
  head(ctx, '#8b5a2f');
  ellipse(ctx, '#d9b38c', 64, 72, 13, 10);
  eyes(ctx);
  ellipse(ctx, '#1a1a1a', 64, 68, 5, 4);
}

function fox(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#e8741f';
  ctx.beginPath();
  ctx.moveTo(38, 52);
  ctx.lineTo(42, 18);
  ctx.lineTo(58, 40);
  ctx.moveTo(90, 52);
  ctx.lineTo(86, 18);
  ctx.lineTo(70, 40);
  ctx.fill();
  head(ctx, '#ef7f2a');
  ellipse(ctx, '#ffffff', 64, 76, 16, 12);
  eyes(ctx);
  ellipse(ctx, '#1a1a1a', 64, 72, 4, 3.5);
}

function rabbit(ctx: CanvasRenderingContext2D): void {
  ellipse(ctx, '#e9e2da', 50, 22, 8, 26, -0.15);
  ellipse(ctx, '#e9e2da', 78, 22, 8, 26, 0.15);
  ellipse(ctx, '#f4b6c2', 50, 24, 3.5, 18, -0.15);
  ellipse(ctx, '#f4b6c2', 78, 24, 3.5, 18, 0.15);
  head(ctx, '#efe9e2');
  eyes(ctx);
  ellipse(ctx, '#f08aa0', 64, 70, 4, 3);
}

function deer(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(64 + side * 16, 40);
    ctx.lineTo(64 + side * 30, 10);
    ctx.moveTo(64 + side * 24, 24);
    ctx.lineTo(64 + side * 40, 18);
  }
  ctx.stroke();
  head(ctx, '#b07a45', 28, 64);
  ellipse(ctx, '#f0dcc2', 64, 76, 12, 10);
  eyes(ctx, 60);
  ellipse(ctx, '#1a1a1a', 64, 74, 4.5, 3.5);
}

function owl(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath();
  ctx.moveTo(40, 44);
  ctx.lineTo(44, 24);
  ctx.lineTo(56, 38);
  ctx.moveTo(88, 44);
  ctx.lineTo(84, 24);
  ctx.lineTo(72, 38);
  ctx.fill();
  head(ctx, '#9a7652', 31);
  ellipse(ctx, '#ffffff', 52, 60, 11, 11);
  ellipse(ctx, '#ffffff', 76, 60, 11, 11);
  eyes(ctx, 60, 12, 5);
  ctx.fillStyle = '#f2a516';
  ctx.beginPath();
  ctx.moveTo(58, 70);
  ctx.lineTo(70, 70);
  ctx.lineTo(64, 80);
  ctx.fill();
}

function frog(ctx: CanvasRenderingContext2D): void {
  head(ctx, '#56b84a', 30, 66);
  ellipse(ctx, '#56b84a', 48, 40, 12, 12);
  ellipse(ctx, '#56b84a', 80, 40, 12, 12);
  ellipse(ctx, '#ffffff', 48, 40, 8, 8);
  ellipse(ctx, '#ffffff', 80, 40, 8, 8);
  eyes(ctx, 40, 16, 4);
  ctx.strokeStyle = '#1f5a1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 70, 14, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function raccoon(ctx: CanvasRenderingContext2D): void {
  ellipse(ctx, '#6e6e74', 42, 38, 10, 12);
  ellipse(ctx, '#6e6e74', 86, 38, 10, 12);
  head(ctx, '#8d8d93');
  ellipse(ctx, '#2b2b30', 64, 58, 26, 9);
  ellipse(ctx, '#e8e8ea', 64, 76, 12, 9);
  eyes(ctx, 58, 11, 4, '#ffffff');
  ellipse(ctx, '#1a1a1a', 64, 72, 4, 3);
}

function hedgehog(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#5a3f2a';
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 26, 62 + Math.sin(a) * 26);
    ctx.lineTo(64 + Math.cos(a) * 44, 62 + Math.sin(a) * 44);
    ctx.lineTo(64 + Math.cos(a + 0.25) * 26, 62 + Math.sin(a + 0.25) * 26);
    ctx.fill();
  }
  head(ctx, '#d9b48a', 28, 64);
  eyes(ctx, 60);
  ellipse(ctx, '#1a1a1a', 64, 74, 4.5, 4);
}

function beaver(ctx: CanvasRenderingContext2D): void {
  ellipse(ctx, '#6b4426', 40, 42, 8, 8);
  ellipse(ctx, '#6b4426', 88, 42, 8, 8);
  head(ctx, '#7f5230');
  ellipse(ctx, '#c79a6e', 64, 72, 14, 10);
  eyes(ctx);
  ellipse(ctx, '#1a1a1a', 64, 67, 4.5, 3.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(58, 76, 5, 9);
  ctx.fillRect(65, 76, 5, 9);
}

function turtle(ctx: CanvasRenderingContext2D): void {
  head(ctx, '#7ab65a', 26, 66);
  eyes(ctx, 62, 10);
  ctx.strokeStyle = '#3d6b2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 70, 10, 0.3, Math.PI - 0.3);
  ctx.stroke();
}

/** The jumbotron on the far side: a placeholder logo and the rally counter. */
function buildJumbotron(scene: Scene): (rally: number, best: number) => void {
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
  const draw = (rally: number, best: number) => {
    const key = `${rally}/${best}`;
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
    ctx.fillText(`RALLY ${rally}`, 512, 370);
    ctx.fillStyle = '#9fc2ff';
    ctx.font = '800 56px "Arial Black", Impact, sans-serif';
    ctx.fillText(`BEST ${best}`, 512, 470);
    tex.update();
  };
  draw(0, 0);
  return draw;
}
