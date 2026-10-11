// The park around the court: a mowed lawn, rounded trees, bushes, rocks and
// flowers, soft sunlight with shadows, and a light haze in the distance.
// Textures are drawn on canvases at startup, so there are no image files.

import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
// Registers the scene component that renders shadow maps.
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
// Registers Mesh.createInstance.
import '@babylonjs/core/Meshes/instancedMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { STAND_OUTER_RADIUS } from './stadium';

const GROUND_SIZE = 160;
// Width of one mowed stripe on the lawn, in meters.
const STRIPE_WIDTH = 4.5;
export const SKY = new Color3(0.62, 0.8, 0.96);

/** A repeatable pseudo-random sequence, so the park is laid out the same every time. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.04, 0.04, 0.04);
  return mat;
}

/** Fog that fades the far edges of the park into the sky color (or `color`, from `start` to `end` m). */
export function addHaze(scene: Scene, color = SKY, start = 40, end = 110): void {
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = color;
  // By default: clear inside the stadium; trees beyond the stands fade into the sky.
  scene.fogStart = start;
  scene.fogEnd = end;
}

/** Soft shadows from the sun, for the players and the net. Add casters with `addShadowCaster`. */
export function createShadows(sun: DirectionalLight): ShadowGenerator {
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  // 0 = black shadows, 1 = none.
  shadows.darkness = 0.15;
  return shadows;
}

/**
 * A stadium-grade pitch: vivid green with a fine, even grain and very subtle
 * wide mowing stripes. The grain is per-pixel noise, so it reads as crisp,
 * dense turf up close and smooths out with distance.
 */
export function createLawn(scene: Scene): Mesh {
  const size = 1024;
  const tex = new DynamicTexture('lawn', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const stripes = 2;
  const stripeW = size / stripes;
  const rand = seeded(7);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Light and dark stripes differ only slightly, like real mowing.
      const dark = Math.floor(x / stripeW) % 2 === 1;
      const grain = (rand() - 0.5) * 26;
      const i = (y * size + x) * 4;
      img.data[i] = (dark ? 70 : 74) + grain * 0.5;
      img.data[i + 1] = (dark ? 147 : 154) + grain;
      img.data[i + 2] = 34 + grain * 0.3;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const tile = GROUND_SIZE / (stripes * STRIPE_WIDTH);
  tex.uScale = tile;
  tex.vScale = tile;
  // Keeps the stripes crisp when seen at the camera's shallow angle.
  tex.anisotropicFilteringLevel = 8;

  const lawn = MeshBuilder.CreateGround('lawn', { width: GROUND_SIZE, height: GROUND_SIZE }, scene);
  const mat = material(scene, 'lawn', new Color3(1, 1, 1));
  mat.diffuseTexture = tex;
  lawn.material = mat;
  lawn.receiveShadows = true;
  return lawn;
}

/**
 * Big trees outside the stadium bowl, tall enough to show over the stands, so
 * it still feels like a park. Nothing goes on the field itself.
 */
export function createScenery(scene: Scene, treeCount = 70): void {
  const rand = seeded(42);
  // Trees get a soft dark patch underneath instead of real shadows, which
  // would stretch the shadow map over the whole park and blur the players'.
  const blob = MeshBuilder.CreateDisc('blobShadow', { radius: 1, tessellation: 20 }, scene);
  blob.rotation.x = Math.PI / 2;
  const blobMat = material(scene, 'blobShadow', new Color3(0, 0, 0));
  blobMat.disableLighting = true;
  blobMat.alpha = 0.22;
  blob.material = blobMat;
  blob.isVisible = false;
  const leafColors = [new Color3(0.27, 0.56, 0.24), new Color3(0.33, 0.62, 0.27), new Color3(0.22, 0.5, 0.26)];

  const trunk = MeshBuilder.CreateCylinder('trunk', { height: 1.8, diameterTop: 0.22, diameterBottom: 0.34, tessellation: 7 }, scene);
  trunk.material = material(scene, 'bark', new Color3(0.45, 0.3, 0.18));
  trunk.isVisible = false;
  const canopies = leafColors.map((color, i) => {
    const canopy = MeshBuilder.CreateSphere(`canopy${i}`, { diameter: 2.6, segments: 16 }, scene);
    canopy.material = material(scene, `leaves${i}`, color);
    canopy.isVisible = false;
    return canopy;
  });

  const place = (base: Mesh, x: number, y: number, z: number, scale: number, shadowRadius: number): AbstractMesh => {
    const inst = base.createInstance(`${base.name}-${x.toFixed(1)}-${z.toFixed(1)}`);
    inst.position.set(x, y, z);
    inst.scaling.setAll(scale);
    inst.rotation.y = rand() * Math.PI * 2;
    if (shadowRadius > 0) {
      const shadow = blob.createInstance(`shadow-${inst.name}`);
      shadow.position.set(x, 0.02, z);
      shadow.scaling.setAll(shadowRadius);
    }
    return inst;
  };

  for (let i = 0; i < treeCount; i++) {
    const angle = rand() * Math.PI * 2;
    const r = STAND_OUTER_RADIUS + 4 + rand() * 18;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const s = 2.4 + rand() * 1.2;
    place(trunk, x, 0.9 * s, z, s, 1.5 * s);
    const canopy = canopies[Math.floor(rand() * canopies.length)];
    place(canopy, x, (1.8 + 0.9) * s, z, s, 0);
    if (rand() > 0.5) place(canopy, x + 0.5 * s, 2.2 * s, z - 0.3 * s, s * 0.7, 0);
  }
}

// Half-width of the ball's two navy stripes (as sin of the angle from their center line).
const BALL_STRIPE_WIDTH = 0.16;

/**
 * A yellow ball with volleyball-style panels: each of the six sides of a cube
 * wrapped onto the sphere is split into three strips, with neighboring sides'
 * strips running crosswise, and thin gold seams between panels.
 */
export function createBallMaterial(scene: Scene): StandardMaterial {
  const w = 1024;
  const h = 512;
  const tex = new DynamicTexture('ballTex', { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  const seam = 0.045;
  for (let py = 0; py < h; py++) {
    const lat = (py / (h - 1) - 0.5) * Math.PI;
    for (let px = 0; px < w; px++) {
      const lon = (px / w) * Math.PI * 2;
      // The point on the sphere for this texel.
      const d = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const abs = d.map(Math.abs);
      const major = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
      // Position across this cube side (-1..1), and the coordinate its strips split along.
      const others = [0, 1, 2].filter((k) => k !== major).map((k) => d[k] / abs[major]);
      const across = others[major === 1 ? 0 : 1];
      const strip = across < -1 / 3 ? 0 : across > 1 / 3 ? 2 : 1;
      const nearStripEdge = Math.abs(Math.abs(across) - 1 / 3) < seam;
      const nearSideEdge = others.some((c) => 1 - Math.abs(c) < seam);
      let r: number;
      let g: number;
      let b: number;
      // Two bold navy stripes pole to pole, so the ball's spin is easy to see.
      const stripe = Math.min(Math.abs(Math.sin(lon)), 1) < BALL_STRIPE_WIDTH;
      if (stripe) {
        [r, g, b] = [30, 50, 130];
      } else if (nearStripEdge || nearSideEdge) {
        [r, g, b] = [176, 142, 52];
      } else if (strip === 1) {
        [r, g, b] = [232, 218, 132];
      } else {
        [r, g, b] = [226, 198, 84];
      }
      const i = (py * w + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  const mat = material(scene, 'ball', new Color3(1, 1, 1));
  mat.diffuseTexture = tex;
  // A touch of self-glow keeps it readable in shade without looking neon.
  mat.emissiveColor = new Color3(0.16, 0.14, 0.05);
  mat.specularColor = new Color3(0.15, 0.15, 0.13);
  return mat;
}
