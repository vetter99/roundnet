// The roundnet set: a woven net that sags slightly like a trampoline, a
// glossy segmented frame with joints at each leg, elastic bands where the net
// is attached, and legs that splay outward onto rubber feet. Visual only; the
// physics uses the radius/height from tuning.

import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
// Registers Mesh.createInstance (used for the elastic bands).
import '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';

const LEGS = 5;
// How far the net dips at its center, and how far out the feet splay.
const SAG = 0.03;
const LEG_SPLAY = 0.14;
const BANDS = 40;

const FRAME_YELLOW = new Color3(1, 0.82, 0.08);
const BLACK = new Color3(0.08, 0.08, 0.09);

export interface RoundnetSet {
  root: TransformNode;
  // The net surface, which the renderer moves for the trampoline wobble.
  net: Mesh;
}

function material(scene: Scene, name: string, color: Color3, shine: number, power = 32): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(shine, shine, shine);
  mat.specularPower = power;
  return mat;
}

/** Rotation that turns the +y axis to point along `dir`. */
function alignY(dir: Vector3): Quaternion {
  const d = dir.normalizeToNew();
  const axis = Vector3.Cross(Vector3.Up(), d);
  const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(Vector3.Up(), d))));
  return axis.lengthSquared() < 1e-9 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), angle);
}

/** A woven cord pattern with see-through gaps (alpha-tested). */
function netMaterial(scene: Scene): StandardMaterial {
  const size = 512;
  const tex = new DynamicTexture('netWeave', { width: size, height: size }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#26262a';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  // Two diagonal sets of cords make a diamond mesh.
  const gap = 22;
  for (let k = -size; k < size * 2; k += gap) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + size, size);
    ctx.moveTo(k, size);
    ctx.lineTo(k + size, 0);
    ctx.stroke();
  }
  // Knots where cords cross.
  ctx.fillStyle = '#0e0e10';
  for (let y = 0; y <= size; y += gap / 2) {
    for (let x = (y / (gap / 2)) % 2 === 0 ? 0 : gap / 2; x <= size; x += gap) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  tex.update();
  const mat = material(scene, 'net', new Color3(1, 1, 1), 0.15, 20);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  mat.backFaceCulling = false;
  return mat;
}

/** A disc that dips slightly toward its center, with planar UVs. */
function saggingDisc(name: string, radius: number, scene: Scene): Mesh {
  const rings = 14;
  const segments = 72;
  const positions: number[] = [0, -SAG, 0];
  const uvs: number[] = [0.5, 0.5];
  const normals: number[] = [0, 1, 0];
  const indices: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * radius;
    const y = -SAG * (1 - (rr / radius) ** 2);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      positions.push(x, y, z);
      // About one texture repeat across the net: diamond cells of ~5 cm.
      uvs.push((x / radius) * 0.55 + 0.5, (z / radius) * 0.55 + 0.5);
      normals.push(0, 1, 0);
    }
  }
  const ring = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * segments + (s % segments));
  for (let s = 0; s < segments; s++) indices.push(0, ring(1, s + 1), ring(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      indices.push(ring(r, s), ring(r, s + 1), ring(r + 1, s), ring(r, s + 1), ring(r + 1, s + 1), ring(r + 1, s));
    }
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(mesh);
  return mesh;
}

export function buildRoundnetSet(scene: Scene, radius: number, frameWidth: number, height: number, shadows: ShadowGenerator): RoundnetSet {
  const root = new TransformNode('roundnetSet', scene);
  const yellow = material(scene, 'frame', FRAME_YELLOW, 0.6, 64);
  const black = material(scene, 'legs', BLACK, 0.3, 48);
  const rubber = material(scene, 'rubber', new Color3(0.14, 0.14, 0.15), 0.05);
  const caster = (m: Mesh) => {
    m.parent = root;
    shadows.addShadowCaster(m);
    return m;
  };

  const net = saggingDisc('netSurface', radius, scene);
  net.material = netMaterial(scene);
  net.position.y = height;
  net.receiveShadows = true;
  net.parent = root;

  // The frame: a smooth glossy rim.
  const rimRadius = radius + frameWidth / 2;
  const rim = MeshBuilder.CreateTorus('frame', { diameter: rimRadius * 2, thickness: frameWidth, tessellation: 128 }, scene);
  rim.material = yellow;
  rim.position.y = height;
  caster(rim);

  // Elastic bands looping around the rim where the net is attached.
  const band = MeshBuilder.CreateTorus('band', { diameter: frameWidth * 1.5, thickness: 0.012, tessellation: 12 }, scene);
  band.material = black;
  band.parent = root;
  band.isVisible = false;
  for (let i = 0; i < BANDS; i++) {
    const a = ((i + 0.5) / BANDS) * Math.PI * 2;
    const loop = band.createInstance(`band${i}`);
    loop.position.set(Math.cos(a) * (rimRadius - 0.01), height, Math.sin(a) * (rimRadius - 0.01));
    // The loop's axis runs along the rim, so it wraps the frame tube.
    loop.rotationQuaternion = alignY(new Vector3(-Math.sin(a), 0, Math.cos(a)));
  }

  for (let i = 0; i < LEGS; i++) {
    const a = (i / LEGS) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const tangent = new Vector3(-sin, 0, cos);
    const top = new Vector3(cos * rimRadius, height, sin * rimRadius);
    const foot = new Vector3(cos * (rimRadius + LEG_SPLAY), 0.02, sin * (rimRadius + LEG_SPLAY));

    // A black joint coupling the frame segments at each leg.
    const joint = MeshBuilder.CreateCylinder('joint', { height: 0.1, diameter: frameWidth * 1.45, tessellation: 20 }, scene);
    joint.material = black;
    joint.position.copyFrom(top);
    joint.rotationQuaternion = alignY(tangent);
    caster(joint);

    // The leg, angled outward from the joint down to a rubber foot.
    const along = foot.subtract(top);
    const leg = MeshBuilder.CreateCylinder('leg', { height: along.length(), diameterTop: 0.034, diameterBottom: 0.028, tessellation: 16 }, scene);
    leg.material = black;
    leg.position.copyFrom(top.add(along.scale(0.5)));
    leg.rotationQuaternion = alignY(along.scale(-1));
    caster(leg);

    const pad = MeshBuilder.CreateSphere('foot', { diameter: 0.07, segments: 12 }, scene);
    pad.scaling.y = 0.45;
    pad.material = rubber;
    pad.position.copyFrom(foot);
    caster(pad);
  }

  return { root, net };
}
