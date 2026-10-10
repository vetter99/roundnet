// The stadium crowd: small rounded 3D critter fans sitting in the seats,
// bobbing and cheering. Each body part (body, head, ears, eyes) is one mesh
// drawn as thousands of thin instances with per-fan colors, so the whole
// crowd is a handful of draw calls.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
// Registers thin instances on meshes.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

/** A seat: where it is and which way it faces (yaw that turns local -z toward the field). */
export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

type EarShape = 'pointy' | 'round' | 'long' | 'none';

interface FanSpecies {
  fur: string;
  ears: EarShape;
  earColor: string;
}

const SPECIES: FanSpecies[] = [
  { fur: '#c8722c', ears: 'pointy', earColor: '#c8722c' }, // squirrel
  { fur: '#8d8d93', ears: 'round', earColor: '#2b2b30' }, // raccoon
  { fur: '#8b5a2f', ears: 'round', earColor: '#7a4a28' }, // bear
  { fur: '#efe9e2', ears: 'long', earColor: '#efe9e2' }, // rabbit
  { fur: '#e8741f', ears: 'pointy', earColor: '#3a2a1f' }, // fox
  { fur: '#56b84a', ears: 'round', earColor: '#56b84a' }, // frog (eye bumps)
  { fur: '#9a7652', ears: 'pointy', earColor: '#8a6a4a' }, // owl (tufts)
  { fur: '#d9b48a', ears: 'none', earColor: '#d9b48a' }, // hedgehog
  { fur: '#7f5230', ears: 'round', earColor: '#6b4426' }, // beaver
  { fur: '#b07a45', ears: 'long', earColor: '#b07a45' }, // deer
];
const SHIRTS = ['#e84a4a', '#2f6fe8', '#f2c21f', '#2fb062', '#f07d1f', '#f4f4f4', '#7a5ce0'];

// How many fans fill the seats (the rest stay empty).
const FILL = 0.6;

interface Part {
  mesh: Mesh;
  matrices: Float32Array;
  // For each instance, which fan it belongs to and its resting height.
  fan: number[];
  baseY: number[];
}

export interface Crowd {
  update(time: number): void;
}

export function createCrowd(scene: Scene, seats: Seat[]): Crowd {
  let seed = 4242;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  const material = (name: string) => {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    return mat;
  };
  const sharedMat = material('fan');
  const eyeMat = material('fanEye');
  eyeMat.diffuseColor = new Color3(0.08, 0.07, 0.07);

  const base: Record<string, Mesh> = {
    body: MeshBuilder.CreateSphere('fanBody', { diameter: 1, segments: 10 }, scene),
    head: MeshBuilder.CreateSphere('fanHead', { diameter: 0.32, segments: 12 }, scene),
    pointy: MeshBuilder.CreateCylinder('fanEarPointy', { height: 0.13, diameterTop: 0, diameterBottom: 0.1, tessellation: 8 }, scene),
    round: MeshBuilder.CreateSphere('fanEarRound', { diameter: 0.11, segments: 8 }, scene),
    long: MeshBuilder.CreateSphere('fanEarLong', { diameter: 0.08, segments: 8 }, scene),
    eye: MeshBuilder.CreateSphere('fanEye', { diameter: 0.045, segments: 6 }, scene),
  };
  for (const [key, mesh] of Object.entries(base)) {
    mesh.material = key === 'eye' ? eyeMat : sharedMat;
    mesh.isPickable = false;
  }

  // Collect each part's instances as (matrix, color, fan index).
  const pending: Record<string, { m: Matrix; c: Color3; fan: number }[]> = {};
  for (const key of Object.keys(base)) pending[key] = [];
  const add = (key: string, fan: number, seat: Seat, local: Vector3, scale: Vector3, color: Color3, roll = 0) => {
    const q = Quaternion.FromEulerAngles(0, seat.yaw, roll);
    const offset = local.applyRotationQuaternion(Quaternion.FromEulerAngles(0, seat.yaw, 0));
    const m = Matrix.Compose(scale, q, new Vector3(seat.x + offset.x, seat.y + offset.y, seat.z + offset.z));
    pending[key].push({ m, c: color, fan });
  };

  let fans = 0;
  for (const seat of seats) {
    if (rand() > FILL) continue;
    const fan = fans++;
    const species = SPECIES[Math.floor(rand() * SPECIES.length)];
    const fur = Color3.FromHexString(species.fur);
    const shirt = Color3.FromHexString(SHIRTS[Math.floor(rand() * SHIRTS.length)]);
    const earColor = Color3.FromHexString(species.earColor);
    const one = new Vector3(1, 1, 1);
    // Local space: -z faces the field, y up, origin at the seat.
    add('body', fan, seat, new Vector3(0, 0.3, 0.02), new Vector3(0.38, 0.44, 0.32), shirt);
    add('head', fan, seat, new Vector3(0, 0.62, -0.02), one, fur);
    if (species.ears !== 'none') {
      for (const side of [-1, 1]) {
        const shape = species.ears;
        const y = shape === 'long' ? 0.86 : 0.77;
        const scale = shape === 'long' ? new Vector3(1, 2.4, 0.7) : shape === 'round' ? new Vector3(1, 1, 0.55) : one;
        add(shape, fan, seat, new Vector3(side * 0.1, y, 0), scale, earColor, -side * 0.25);
      }
    }
    for (const side of [-1, 1]) add('eye', fan, seat, new Vector3(side * 0.06, 0.65, -0.15), one, fur);
  }

  const parts: Part[] = [];
  for (const [key, items] of Object.entries(pending)) {
    const mesh = base[key];
    if (items.length === 0) {
      mesh.isVisible = false;
      continue;
    }
    const matrices = new Float32Array(items.length * 16);
    const colors = new Float32Array(items.length * 4);
    items.forEach((item, i) => {
      item.m.copyToArray(matrices, i * 16);
      colors.set([item.c.r, item.c.g, item.c.b, 1], i * 4);
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    if (key !== 'eye') mesh.thinInstanceSetBuffer('color', colors, 4, true);
    parts.push({ mesh, matrices, fan: items.map((it) => it.fan), baseY: items.map((_, i) => matrices[i * 16 + 13]) });
  }

  // Each fan bobs on its own rhythm; about one in six jumps up and down to cheer.
  const speed: number[] = [];
  const phase: number[] = [];
  const height: number[] = [];
  for (let f = 0; f < fans; f++) {
    speed.push(3 + rand() * 4);
    phase.push(rand() * 10);
    height.push(rand() > 0.84 ? 0.3 : 0.07);
  }
  const bob = new Float32Array(fans);
  let frame = 0;

  return {
    update(time) {
      // Half rate is plenty for background motion, and halves the upload cost.
      if (frame++ % 2) return;
      for (let f = 0; f < fans; f++) bob[f] = Math.max(0, Math.sin(time * speed[f] + phase[f])) * height[f];
      for (const part of parts) {
        for (let i = 0; i < part.fan.length; i++) part.matrices[i * 16 + 13] = part.baseY[i] + bob[part.fan[i]];
        part.mesh.thinInstanceBufferUpdated('matrix');
      }
    },
  };
}
