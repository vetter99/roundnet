// The playable characters. Each one is built from simple shapes onto the
// shared rig in character.ts (body, head, two arm pivots, two leg pivots and
// a tail pivot), which does all the animation. Everyone wears a sleeveless
// jersey in their team color with a big white number, so the team reads
// from any angle.
//
// House style (classic Nintendo mascots): big heads (the rig scales the head
// up), prominent noses, big round hands on shoulders that sit in the torso,
// short stubby bodies with big feet, saturated colors, a dark cartoon outline
// on the main shapes (Kit marks them), and one iconic silhouette anchor each
// (a hat, tufts, a mustache, a backbox).

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';

export type CharacterKind = 'bear' | 'cat' | 'truffles' | 'pinball' | 'guy';

/** Every character, in picker order, with display names. */
export const CHARACTERS: { kind: CharacterKind; name: string }[] = [
  { kind: 'bear', name: 'Bear' },
  { kind: 'cat', name: 'Cat' },
  { kind: 'truffles', name: 'TrufflesUpaGus' },
  { kind: 'pinball', name: 'Pinball' },
  { kind: 'guy', name: 'Tattoo Guy' },
];

/** Who plays each seat by default: Blue 1, Blue 2, Red 1, Red 2 (1v1 uses the "1" seats). */
export const SEAT_CHARACTERS: CharacterKind[] = ['bear', 'cat', 'truffles', 'pinball'];

/** The rig's attachment points (see character.ts). Arms and legs hang down (-y) from their pivots. */
export interface Rig {
  scene: Scene;
  bounce: TransformNode;
  // Centered on the head; the face points +z.
  head: TransformNode;
  tail: TransformNode;
  // Index 0 is the left side (-x), 1 the right (+x).
  arms: TransformNode[];
  legs: TransformNode[];
  // Pivots the rig keeps spinning about their y axis (e.g. a propeller), faster while running.
  spinners: TransformNode[];
  // Meshes big enough to get the cartoon outline.
  outlined: Mesh[];
}

type V3 = [number, number, number];

const WHITE = new Color3(0.97, 0.97, 0.95);
const INK = new Color3(0.06, 0.05, 0.06);
const PINK = new Color3(0.95, 0.55, 0.62);
const GOLD = new Color3(0.95, 0.75, 0.22);
const CHROME = new Color3(0.78, 0.8, 0.84);
const SHORTS = new Color3(0.14, 0.14, 0.18);
// Shapes at least this thick (m) get the cartoon outline; smaller details don't.
const OUTLINE_MIN_SIZE = 0.07;

/** Shape-making helpers for one character. Big, solid shapes get the cartoon outline. */
class Kit {
  constructor(
    readonly scene: Scene,
    private readonly outlined: Mesh[],
  ) {}

  /** Mark a mesh for the outline if it's big enough to matter and not see-through. */
  private outline(mesh: Mesh, size: number): Mesh {
    const mat = mesh.material as StandardMaterial | null;
    if (size >= OUTLINE_MIN_SIZE && (mat?.alpha ?? 1) >= 1) this.outlined.push(mesh);
    return mesh;
  }

  mat(name: string, color: Color3, shine = 0.08, power = 32): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(shine, shine, shine);
    m.specularPower = power;
    return m;
  }

  glow(name: string, color: Color3): StandardMaterial {
    const m = this.mat(name, color);
    m.emissiveColor = color;
    m.disableLighting = true;
    return m;
  }

  place(mesh: Mesh, parent: TransformNode, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    mesh.parent = parent;
    mesh.material = mat;
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    if (scale) mesh.scaling.set(...scale);
    return mesh;
  }

  sphere(parent: TransformNode, d: number, mat: StandardMaterial, pos: V3, scale?: V3, rot?: V3, segments = 20): Mesh {
    const mesh = this.place(MeshBuilder.CreateSphere('part', { diameter: d, segments }, this.scene), parent, mat, pos, rot, scale);
    return this.outline(mesh, d * Math.min(...(scale ?? [1, 1, 1])));
  }

  capsule(parent: TransformNode, height: number, radius: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = this.place(MeshBuilder.CreateCapsule('part', { height, radius, tessellation: 14 }, this.scene), parent, mat, pos, rot, scale);
    return this.outline(mesh, radius * 2 * Math.min(...(scale ?? [1, 1, 1])));
  }

  cylinder(parent: TransformNode, height: number, top: number, bottom: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = MeshBuilder.CreateCylinder('part', { height, diameterTop: top, diameterBottom: bottom, tessellation: 20 }, this.scene);
    this.place(mesh, parent, mat, pos, rot, scale);
    return this.outline(mesh, Math.min(height, Math.max(top, bottom)));
  }

  box(parent: TransformNode, size: V3, mat: StandardMaterial, pos: V3, rot?: V3): Mesh {
    const mesh = MeshBuilder.CreateBox('part', { width: size[0], height: size[1], depth: size[2] }, this.scene);
    this.place(mesh, parent, mat, pos, rot);
    return this.outline(mesh, Math.min(...size));
  }

  torus(parent: TransformNode, diameter: number, thickness: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = MeshBuilder.CreateTorus('part', { diameter, thickness, tessellation: 32 }, this.scene);
    this.place(mesh, parent, mat, pos, rot, scale);
    return this.outline(mesh, thickness);
  }

  /** A smooth bent tube through `points`, tapering from `r0` to `r1`. */
  tube(parent: TransformNode, points: V3[], r0: number, r1: number, mat: StandardMaterial): Mesh {
    const path = points.map((p) => new Vector3(...p));
    const length = pathLength(path);
    const mesh = MeshBuilder.CreateTube(
      'part',
      { path: smooth(path), radiusFunction: (_, d) => r0 + (r1 - r0) * Math.min(1, d / length), tessellation: 14, cap: 3 },
      this.scene,
    );
    this.place(mesh, parent, mat, [0, 0, 0]);
    return this.outline(mesh, r0 * 2);
  }

  /** An empty pivot for grouping parts (e.g. a prop tilted as a whole). */
  node(parent: TransformNode, pos: V3, rot?: V3): TransformNode {
    const n = new TransformNode('group', this.scene);
    n.parent = parent;
    n.position.set(...pos);
    if (rot) n.rotation.set(...rot);
    return n;
  }

  /** A shape spun around the y axis: `profile` is [radius, height] pairs from bottom to top. */
  lathe(parent: TransformNode, profile: [number, number][], mat: StandardMaterial, pos: V3, rot?: V3): Mesh {
    const shape = profile.map(([r, y]) => new Vector3(r, y, 0));
    const mesh = MeshBuilder.CreateLathe('part', { shape, tessellation: 40, sideOrientation: 2 }, this.scene);
    this.place(mesh, parent, mat, pos, rot);
    return this.outline(mesh, 1);
  }

  /** A flat card facing +z (both sides drawn), e.g. a number patch or a cape. */
  card(parent: TransformNode, w: number, h: number, mat: StandardMaterial, pos: V3, rot?: V3): Mesh {
    const mesh = MeshBuilder.CreatePlane('part', { width: w, height: h, sideOrientation: 2 }, this.scene);
    return this.place(mesh, parent, mat, pos, rot);
  }
}

function pathLength(path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Vector3.Distance(path[i - 1], path[i]);
  return total || 1;
}

/** Catmull-Rom smoothing so tails and cords curve instead of kinking. */
function smooth(points: Vector3[], steps = 6): Vector3[] {
  if (points.length < 3) return points;
  const out: Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) out.push(Vector3.CatmullRom(p0, p1, p2, p3, s / steps));
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The jersey texture for a sphere torso: team color, white collar and hem,
 * white side piping, and the number big on the front and back.
 */
function jerseyTexture(scene: Scene, team: Color3, number: number): DynamicTexture {
  const w = 512;
  const h = 256;
  const tex = new DynamicTexture('jersey', { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = team.toHexString();
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f6f6f2';
  ctx.fillRect(0, 0, w, 22);
  ctx.fillRect(0, h - 16, w, 16);
  // Side piping at the sides of the body (between front and back).
  for (const x of [0, w / 2]) ctx.fillRect(x - 5, 0, 10, h);
  ctx.fillRect(w - 5, 0, 5, h);
  ctx.font = 'bold 150px "Russo One", Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  // The sphere's texture lands rotated half a turn, so draw the numbers that way.
  ctx.scale(-1, -1);
  for (const x of [w * 0.25, w * 0.75]) {
    ctx.strokeText(String(number), -x, -h * 0.47);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(number), -x, -h * 0.47);
  }
  tex.update();
  return tex;
}

/** A flat number patch (for the pinball machine's cabinet). */
function numberTexture(scene: Scene, team: Color3, number: number): DynamicTexture {
  const s = 256;
  const tex = new DynamicTexture('number', { width: s, height: s }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = team.toHexString();
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#f6f6f2';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, s - 16, s - 16);
  ctx.font = 'bold 170px "Russo One", Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(number), s / 2, s * 0.55);
  tex.update();
  return tex;
}

/** The tank-top jersey: a rounded torso with the jersey texture. */
function jersey(kit: Kit, rig: Rig, team: Color3, number: number, y: number, d: number, scale: V3): Mesh {
  const mat = kit.mat('jersey', new Color3(1, 1, 1), 0.12, 24);
  mat.diffuseTexture = jerseyTexture(kit.scene, team, number);
  const torso = kit.sphere(rig.bounce, d, mat, [0, y, 0], scale, undefined, 32);
  return torso;
}

/** A cartoon eye: white, colored iris, pupil, shine; optional lid covering the top. */
function eye(
  kit: Kit,
  parent: TransformNode,
  pos: V3,
  o: { size: number; iris: StandardMaterial; look?: [number, number]; lid?: StandardMaterial; lidDrop?: number; tilt?: number },
): void {
  const white = kit.mat('eyeWhite', WHITE, 0.4, 48);
  const pupil = kit.mat('pupil', INK, 0.6, 64);
  const shine = kit.glow('shine', new Color3(1, 1, 1));
  const s = o.size;
  kit.sphere(parent, s, white, pos, [1, 1.15, 0.6], undefined, 18);
  const [lx, ly] = o.look ?? [0, 0];
  const front: V3 = [pos[0] + lx * s * 0.18, pos[1] + ly * s * 0.18, pos[2] + s * 0.24];
  kit.sphere(parent, s * 0.62, o.iris, front, [1, 1.1, 0.35], undefined, 14);
  kit.sphere(parent, s * 0.34, pupil, [front[0], front[1], front[2] + s * 0.05], [1, 1.1, 0.4], undefined, 12);
  kit.sphere(parent, s * 0.16, shine, [front[0] + s * 0.12, front[1] + s * 0.15, front[2] + s * 0.09], undefined, undefined, 8);
  if (o.lid) {
    // A lid: a slightly bigger cap over the eye, dropped down over the top part.
    const drop = o.lidDrop ?? 0.35;
    kit.sphere(parent, s * 1.12, o.lid, [pos[0], pos[1] + s * (0.62 - drop), pos[2] + 0.004], [1.04, 0.62, 0.66], [0, 0, o.tilt ?? 0], 18);
  }
}

/** A plain arm: upper and fore arm in one capsule, with a hand at the end (about where the rig expects the paw). */
/**
 * Put the shoulders where the torso's sides are (`halfWidth` out from the
 * middle), so the round shoulder joints sit in the body instead of floating.
 */
function setShoulders(rig: Rig, halfWidth: number): void {
  for (const pivot of rig.arms) pivot.position.x = Math.sign(pivot.position.x) * halfWidth;
}

/**
 * A cartoon arm: a round shoulder joint, an arm tapering from the shoulder to
 * the wrist, and a big round hand (mitten with a thumb and finger bumps).
 * `thickness` is the arm's radius at the shoulder; `handSize` the hand's width.
 */
function arm(kit: Kit, pivot: TransformNode, skin: StandardMaterial, hand: StandardMaterial, thickness = 0.055, handSize = 0.15): void {
  kit.sphere(pivot, thickness * 2.7, skin, [0, -0.005, 0], undefined, undefined, 18);
  kit.tube(pivot, [[0, 0, 0], [0, -0.1, 0.008], [0, -0.2, 0.012]], thickness, thickness * 0.68, skin);
  const side = Math.sign(pivot.position.x) || 1;
  // The hand: a big round mitten, the thumb on the inside, three finger bumps along the front.
  kit.sphere(pivot, handSize, hand, [0, -0.255, 0.012], [1, 0.95, 0.85], undefined, 20);
  kit.sphere(pivot, handSize * 0.42, hand, [-side * handSize * 0.42, -0.235, 0.04], [0.8, 1.1, 0.9], undefined, 12);
  for (let k = -1; k <= 1; k++) {
    kit.sphere(pivot, handSize * 0.34, hand, [k * handSize * 0.24, -0.255 - handSize * 0.4, 0.035], [1, 1.2, 1], undefined, 10);
  }
}

/** A short, chunky leg with a big cartoon sneaker (white sole, colored upper, laces). */
function sneakerLeg(kit: Kit, pivot: TransformNode, skin: StandardMaterial, upper: Color3, thickness = 0.07): void {
  kit.capsule(pivot, 0.2, thickness, skin, [0, -0.09, 0]);
  const shoe = kit.mat('shoe', upper, 0.35, 40);
  const sole = kit.mat('sole', WHITE, 0.1);
  kit.sphere(pivot, 0.2, shoe, [0, -0.18, 0.05], [0.95, 0.62, 1.4], undefined, 20);
  kit.box(pivot, [0.16, 0.04, 0.28], sole, [0, -0.22, 0.055]);
  kit.box(pivot, [0.09, 0.014, 0.06], kit.mat('laces', WHITE), [0, -0.135, 0.12], [0.5, 0, 0]);
}

/** Shorts over the hips. */
function shorts(kit: Kit, rig: Rig, scale: V3, color = SHORTS): void {
  kit.sphere(rig.bounce, 0.38, kit.mat('shorts', color, 0.1), [0, 0.3, 0], scale, undefined, 24);
}

// ---------------------------------------------------------------------------
// 1. The bear: purple and properly ugly (crooked bulbous nose, underbite with
//    snaggle tusks, one bulging bloodshot eye and one squint, warts, mangy
//    patches, drool), covered in big green leaves, in a derpy rainbow
//    propeller beanie, with a giant crayon tucked behind his ear (he draws a lot).

function buildBear(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const fur = kit.mat('fur', new Color3(0.52, 0.27, 0.8), 0.1);
  const pale = kit.mat('muzzle', new Color3(0.74, 0.62, 0.84), 0.05);
  const mange = kit.mat('mange', new Color3(0.8, 0.62, 0.68), 0.05);
  const nose = kit.mat('nose', new Color3(0.42, 0.2, 0.3), 0.5, 40);
  const tooth = kit.mat('tooth', new Color3(0.95, 0.9, 0.68), 0.3);
  const wart = kit.mat('wart', new Color3(0.58, 0.55, 0.4), 0.1);
  const brow = kit.mat('brow', new Color3(0.2, 0.12, 0.28), 0.05);
  const drool = kit.mat('drool', new Color3(0.75, 0.9, 1), 0.9, 64);
  drool.alpha = 0.55;

  // Pudgy body: shorts, a big jersey belly, a mangy patch on the hip.
  shorts(kit, rig, [1.25, 0.85, 1.15]);
  jersey(kit, rig, team, number, 0.52, 0.5, [1.15, 1, 1.05]);

  const h = rig.head;
  kit.sphere(h, 0.52, fur, [0, 0, 0], [1.1, 0.95, 1], undefined, 32);
  // Lumps: the head isn't quite round.
  kit.sphere(h, 0.2, fur, [0.12, 0.17, -0.04]);
  kit.sphere(h, 0.17, fur, [-0.18, 0.06, -0.06]);
  // Mangy bald patches.
  kit.sphere(h, 0.12, mange, [-0.2, 0.0, 0.12], [1, 1, 0.4], [0, -0.9, 0]);
  kit.sphere(h, 0.09, mange, [0.17, 0.14, 0.14], [1, 1, 0.4], [0, 0.7, 0]);
  // Ears: one round, one chewed-looking and lower.
  kit.sphere(h, 0.16, fur, [-0.2, 0.2, -0.02], [1, 1, 0.55]);
  kit.sphere(h, 0.09, pale, [-0.2, 0.2, 0.02], [1, 1, 0.4]);
  kit.sphere(h, 0.12, fur, [0.24, 0.1, -0.02], [1, 0.75, 0.5], [0, 0, -0.6]);

  // A crooked snout and a big bulbous nose, knocked off to one side.
  kit.sphere(h, 0.3, pale, [0.03, -0.1, 0.19], [1.15, 0.78, 0.95], [0, 0, 0.15], 24);
  kit.sphere(h, 0.14, nose, [0.06, -0.03, 0.32], [1.2, 0.95, 0.9]);
  kit.sphere(h, 0.07, nose, [0.12, -0.07, 0.33]);
  // Underbite: the lower jaw juts out past the snout, with snaggle tusks pointing every which way.
  kit.sphere(h, 0.22, pale, [0.02, -0.21, 0.2], [1.2, 0.5, 0.9], undefined, 20);
  kit.cylinder(h, 0.08, 0, 0.04, tooth, [-0.06, -0.15, 0.29], [0.2, 0, 0.35]);
  kit.cylinder(h, 0.1, 0, 0.045, tooth, [0.08, -0.14, 0.28], [-0.1, 0, -0.25]);
  kit.box(h, [0.03, 0.04, 0.02], tooth, [0.01, -0.17, 0.305], [0, 0, 0.4]);
  // Drool hanging from the corner of his mouth.
  kit.capsule(h, 0.12, 0.012, drool, [-0.1, -0.27, 0.27], [0, 0, 0.1]);
  kit.sphere(h, 0.035, drool, [-0.105, -0.33, 0.27]);
  // Eyes: the left one huge, bulging and bloodshot; the right a tiny squint, higher up.
  const bloodshot = kit.mat('bloodshot', new Color3(0.86, 0.3, 0.25), 0.3);
  eye(kit, h, [-0.11, 0.03, 0.22], { size: 0.12, iris: kit.mat('irisL', new Color3(0.75, 0.6, 0.1), 0.3), look: [0.5, -0.4] });
  for (const [rz, len] of [[0.6, 0.06], [-0.7, 0.05], [2.4, 0.055]]) {
    kit.cylinder(h, len, 0.004, 0.004, bloodshot, [-0.11 + Math.cos(rz) * 0.035, 0.03 + Math.sin(rz) * 0.035, 0.257], [0, 0, rz + Math.PI / 2]);
  }
  eye(kit, h, [0.1, 0.08, 0.215], { size: 0.06, iris: kit.mat('irisR', new Color3(0.55, 0.35, 0.15), 0.3), look: [-0.2, 0], lid: fur, lidDrop: 0.6, tilt: 0.35 });
  // A thick, crooked unibrow.
  kit.capsule(h, 0.15, 0.03, brow, [-0.09, 0.14, 0.22], [0, 0, Math.PI / 2 - 0.35]);
  kit.capsule(h, 0.13, 0.028, brow, [0.08, 0.15, 0.215], [0, 0, Math.PI / 2 + 0.2]);
  // Warts, one with a hair.
  for (const p of [[0.15, -0.06, 0.22], [-0.04, 0.17, 0.2], [-0.17, -0.13, 0.17]] as V3[]) kit.sphere(h, 0.045, wart, p, undefined, undefined, 10);
  kit.cylinder(h, 0.06, 0.003, 0.003, brow, [0.155, -0.03, 0.235], [0.3, 0, -0.4]);

  // The derpy rainbow propeller beanie, jammed on crooked: rainbow panels, a
  // red band, and a rainbow propeller on a stalk that spins (faster when he runs).
  const rainbow = ['#ff2d2d', '#ff8a00', '#ffe000', '#2fc83a', '#1f7bff', '#9b3dff'];
  const capMat = kit.mat('beanie', new Color3(1, 1, 1), 0.2);
  capMat.diffuseTexture = panels(kit.scene, rainbow);
  const cap = kit.node(h, [0.02, 0.15, 0], [-0.08, 0, 0.22]);
  kit.sphere(cap, 0.5, capMat, [0, 0, 0], [1.06, 0.6, 1.04], undefined, 36);
  kit.torus(cap, 0.5, 0.05, kit.mat('band', Color3.FromHexString(rainbow[0]), 0.2), [0, -0.01, 0], undefined, [1.04, 1, 1.02]);
  const chrome = kit.mat('stalk', CHROME, 0.9, 96);
  kit.cylinder(cap, 0.1, 0.022, 0.022, chrome, [0, 0.17, 0]);
  const propeller = kit.node(cap, [0, 0.23, 0]);
  rig.spinners.push(propeller);
  kit.sphere(propeller, 0.06, kit.mat('hub', Color3.FromHexString(rainbow[2]), 0.4), [0, 0, 0]);
  [0, 1, 2, 3].forEach((k) => {
    const blade = kit.node(propeller, [0, 0, 0], [0, (k * Math.PI) / 2, 0]);
    kit.sphere(blade, 0.22, kit.mat(`blade${k}`, Color3.FromHexString(rainbow[[0, 1, 3, 4][k]]), 0.4), [0.13, 0, 0], [1, 0.12, 0.38], [0.35, 0, 0]);
  });

  // The giant crayon, tucked behind his right ear under the beanie.
  const crayon = kit.mat('crayon', new Color3(0.93, 0.25, 0.55), 0.3);
  const wrapper = kit.mat('wrapper', new Color3(0.2, 0.1, 0.35), 0.1);
  const crayonRoot = kit.node(h, [0.25, 0.05, -0.08], [0.4, 0.2, -1.1]);
  kit.cylinder(crayonRoot, 0.34, 0.07, 0.07, crayon, [0, 0, 0]);
  kit.cylinder(crayonRoot, 0.2, 0.074, 0.074, wrapper, [0, -0.02, 0]);
  kit.cylinder(crayonRoot, 0.09, 0.0, 0.07, crayon, [0, 0.215, 0]);

  // Big green leaves stuck all over him, sticking out so they read as leaves.
  const leafMats = [leafMaterial(kit, 'leafA', '#46a332', '#c8ec86'), leafMaterial(kit, 'leafB', '#6cc142', '#e2f7a8')];
  // A little glow so the leaves stay bright green in shade.
  for (const m of leafMats) m.emissiveColor = new Color3(0.12, 0.2, 0.06);
  // Each leaf faces out from `center` (the middle of the head or body).
  const stick = (parent: TransformNode, at: V3, size: number, roll: number, i: number, center: V3 = [0, 0, 0]) => {
    const out = new Vector3(at[0] - center[0], at[1] - center[1], at[2] - center[2]).normalize();
    const yaw = Math.atan2(out.x, out.z);
    const pitch = -Math.asin(Math.max(-1, Math.min(1, out.y)));
    // Lean each leaf out from the surface a little, like it's half stuck on.
    kit.card(parent, size, size, leafMats[i % 2], at, [pitch + 0.35, yaw, roll]);
  };
  const headLeaves: V3[] = [
    [0.27, 0.0, 0.05], [-0.28, -0.02, 0.0], [0.17, -0.15, 0.2], [-0.21, -0.1, 0.17], [0.0, 0.05, -0.27], [0.2, 0.1, -0.18],
    [-0.16, 0.12, 0.2], [0.24, 0.24, 0.06], [-0.1, 0.3, -0.06],
  ];
  headLeaves.forEach((at, i) => stick(h, at, 0.2, i * 1.3, i));
  const bodyLeaves: [V3, number][] = [
    [[0.26, 0.64, 0.1], 0.24], [[-0.28, 0.6, 0.08], 0.26], [[0.0, 0.5, -0.29], 0.26], [[0.22, 0.42, -0.2], 0.22],
    [[-0.2, 0.4, -0.22], 0.22], [[0.26, 0.32, 0.16], 0.2], [[-0.26, 0.3, 0.14], 0.2], [[0.08, 0.24, 0.25], 0.18],
    [[-0.22, 0.56, 0.2], 0.22], [[0.24, 0.52, 0.2], 0.2], [[0.12, 0.72, 0.0], 0.24], [[-0.12, 0.73, -0.06], 0.24],
  ];
  bodyLeaves.forEach(([at, size], i) => stick(rig.bounce, at, size, i * 0.9, i + 1, [0, 0.45, 0]));
  rig.arms.forEach((pivot, side) => {
    kit.card(pivot, 0.16, 0.16, leafMats[side], [side ? 0.06 : -0.06, -0.12, 0.02], [0, side ? 1.3 : -1.3, side ? 0.8 : -0.6]);
  });
  rig.legs.forEach((pivot, side) => {
    kit.card(pivot, 0.15, 0.15, leafMats[1 - side], [0, -0.08, 0.08], [0.3, 0, side ? 0.9 : -0.5]);
  });

  // Shoulders in the sides of the big belly; huge pale-padded paws.
  setShoulders(rig, 0.27);
  for (const pivot of rig.arms) arm(kit, pivot, fur, pale, 0.068, 0.18);
  // Bare bear feet with pale pads.
  for (const pivot of rig.legs) {
    kit.capsule(pivot, 0.2, 0.07, fur, [0, -0.09, 0]);
    kit.sphere(pivot, 0.17, fur, [0, -0.2, 0.04], [1, 0.6, 1.35], undefined, 18);
    kit.sphere(pivot, 0.1, pale, [0, -0.205, 0.1], [1, 0.4, 0.8], [0.4, 0, 0], 12);
  }
  kit.sphere(rig.tail, 0.13, fur, [0, 0.04, 0.02]);
}

/** Vertical color bands: wrapped on a sphere they make cap panels. */
function panels(scene: Scene, colors: string[]): DynamicTexture {
  const w = 384;
  const tex = new DynamicTexture('panels', { width: w, height: 64 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  // Each color twice around the cap.
  const all = [...colors, ...colors];
  const band = w / all.length;
  all.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * band, 0, band + 1, 64);
  });
  tex.update();
  return tex;
}

/** A leaf drawn on a see-through card: a pointed, lobed leaf with a stem and light veins. */
function leafMaterial(kit: Kit, name: string, fill: string, vein: string): StandardMaterial {
  const s = 128;
  const tex = new DynamicTexture(name, { width: s, height: s }, kit.scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  // Outline: a pointed tip at the top, two lobes each side, stem at the bottom.
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.bezierCurveTo(84, 26, 112, 30, 104, 52);
  ctx.bezierCurveTo(122, 62, 112, 86, 92, 88);
  ctx.bezierCurveTo(88, 106, 72, 112, 64, 118);
  ctx.bezierCurveTo(56, 112, 40, 106, 36, 88);
  ctx.bezierCurveTo(16, 86, 6, 62, 24, 52);
  ctx.bezierCurveTo(16, 30, 44, 26, 64, 6);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1f4d18';
  ctx.stroke();
  // Veins.
  ctx.strokeStyle = vein;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 124);
  ctx.lineTo(64, 18);
  for (const [y, dx, dy] of [[40, 26, -14], [64, 36, -12], [88, 26, -8]]) {
    ctx.moveTo(64, y);
    ctx.lineTo(64 + dx, y + dy);
    ctx.moveTo(64, y);
    ctx.lineTo(64 - dx, y + dy);
  }
  ctx.stroke();
  tex.update();
  const mat = kit.mat(name, new Color3(1, 1, 1), 0.15);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  mat.backFaceCulling = false;
  return mat;
}

// ---------------------------------------------------------------------------
// 2. The black cat: extremely annoying. Mismatched wall-eyes, one smug lid, a
//    lopsided grin with its tongue out, messy tufts, crooked whiskers, a bent
//    ear, crumbs and a mustard stain on its jersey.

function buildCat(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const fur = kit.mat('fur', new Color3(0.09, 0.09, 0.12), 0.45, 28);
  const muzzle = kit.mat('muzzle', new Color3(0.24, 0.24, 0.27), 0.2);
  const pink = kit.mat('pink', PINK, 0.3);
  const white = kit.mat('white', WHITE, 0.3);

  shorts(kit, rig, [1, 0.75, 0.95]);
  jersey(kit, rig, team, number, 0.5, 0.44, [1, 0.97, 0.88]);
  // Crumbs and a mustard stain: nobody sits next to this cat at lunch.
  kit.sphere(rig.bounce, 0.08, kit.mat('mustard', new Color3(0.86, 0.68, 0.12), 0.3), [0.07, 0.47, 0.19], [1.3, 0.9, 0.3]);
  const crumb = kit.mat('crumb', new Color3(0.78, 0.6, 0.35));
  for (const p of [[-0.08, 0.58, 0.19], [0.12, 0.55, 0.18], [-0.02, 0.43, 0.21]] as V3[]) kit.sphere(rig.bounce, 0.025, crumb, p, undefined, undefined, 6);

  const h = rig.head;
  kit.sphere(h, 0.5, fur, [0, 0, 0], [1.15, 0.95, 1], undefined, 32);
  // Messy tufts sticking up every which way.
  for (const [x, rz, len] of [[-0.06, 0.4, 0.14], [0.03, -0.3, 0.17], [0.1, -0.7, 0.12]]) {
    kit.cylinder(h, len, 0, 0.07, fur, [x, 0.25, 0.02], [0.2, 0, rz]);
  }
  // Ears: the left upright, the right bent over at the tip.
  kit.cylinder(h, 0.2, 0, 0.15, fur, [-0.17, 0.22, -0.01], [0, 0, 0.35]);
  kit.cylinder(h, 0.12, 0, 0.08, pink, [-0.165, 0.21, 0.02], [0, 0, 0.35]);
  kit.cylinder(h, 0.11, 0.07, 0.15, fur, [0.17, 0.19, -0.01], [0, 0, -0.35]);
  kit.cylinder(h, 0.1, 0, 0.07, fur, [0.25, 0.2, 0.01], [0, 0, -2.0]);

  kit.sphere(h, 0.24, muzzle, [0, -0.1, 0.18], [1.25, 0.72, 0.8], undefined, 24);
  kit.sphere(h, 0.085, pink, [0, -0.05, 0.275], [1.3, 0.8, 0.85]);
  // Wall-eyed: a big yellow eye looking out left, a smaller green one looking out right under a smug lid.
  eye(kit, h, [-0.1, 0.05, 0.2], { size: 0.13, iris: kit.mat('irisY', new Color3(0.95, 0.82, 0.15), 0.4), look: [-0.9, 0.3] });
  eye(kit, h, [0.11, 0.04, 0.2], { size: 0.1, iris: kit.mat('irisG', new Color3(0.4, 0.82, 0.3), 0.4), look: [0.9, -0.4], lid: fur, lidDrop: 0.45, tilt: -0.25 });
  // Lopsided grin full of teeth, tongue hanging out the side.
  kit.box(h, [0.17, 0.035, 0.03], white, [0.02, -0.15, 0.245], [0, 0, -0.18]);
  kit.sphere(h, 0.08, pink, [0.07, -0.18, 0.25], [0.8, 0.35, 1.1], [0.3, 0, -0.3]);
  // Crooked whiskers.
  const whisker = kit.mat('whisker', new Color3(0.85, 0.85, 0.85));
  for (const side of [-1, 1]) {
    for (const [dy, rz] of [[0, 0.1], [-0.03, -0.15], [-0.06, side > 0 ? -0.6 : -0.3]]) {
      kit.cylinder(h, 0.2, 0.006, 0.01, whisker, [side * 0.18, -0.08 + dy, 0.2], [0, 0, Math.PI / 2 + side * rz]);
    }
  }

  // White paws on a black cat, and loud lime sneakers.
  setShoulders(rig, 0.2);
  for (const pivot of rig.arms) arm(kit, pivot, fur, kit.mat('paws', WHITE, 0.2), 0.052, 0.16);
  for (const pivot of rig.legs) sneakerLeg(kit, pivot, fur, new Color3(0.55, 0.95, 0.1), 0.06);
  // A long tail curling out to the side (clear of the number), kinked near the tip.
  kit.tube(rig.tail, [[0, 0, 0], [0.1, 0.03, -0.12], [0.26, 0.12, -0.16], [0.36, 0.3, -0.12], [0.33, 0.44, -0.06], [0.26, 0.42, -0.02]], 0.04, 0.025, fur);
}

// ---------------------------------------------------------------------------
// 3. TrufflesUpaGus: a chihuahua matador. Huge bat ears, bulging eyes, gold
//    epaulettes and a cape, a rose in his teeth, and a sombrero that is a
//    red spotted mushroom cap.

function buildTruffles(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const fur = kit.mat('fur', new Color3(0.85, 0.66, 0.42), 0.06);
  const cream = kit.mat('cream', new Color3(0.97, 0.88, 0.72), 0.05);
  const dark = kit.mat('nose', INK, 0.6, 64);
  const pink = kit.mat('pink', PINK, 0.2);
  const gold = kit.mat('gold', GOLD, 0.7, 64);
  const capRed = kit.mat('capRed', new Color3(0.86, 0.14, 0.12), 0.35, 40);
  const spots = kit.mat('spots', new Color3(0.98, 0.96, 0.9), 0.2);
  const gills = kit.mat('gills', new Color3(0.9, 0.8, 0.62), 0.05);

  shorts(kit, rig, [0.9, 0.72, 0.85], new Color3(0.08, 0.08, 0.1));
  jersey(kit, rig, team, number, 0.5, 0.4, [0.95, 1, 0.85]);

  const h = rig.head;
  // Apple-domed head, short pointy muzzle.
  kit.sphere(h, 0.5, fur, [0, 0.02, 0], [1.05, 0.95, 0.95], undefined, 32);
  kit.sphere(h, 0.2, cream, [0, -0.1, 0.18], [1, 0.75, 1.1], undefined, 20);
  kit.sphere(h, 0.1, dark, [0, -0.065, 0.295], [1.2, 0.9, 0.9]);
  // Big bulging eyes.
  eye(kit, h, [-0.11, 0.03, 0.2], { size: 0.13, iris: kit.mat('iris', new Color3(0.25, 0.14, 0.06), 0.6, 64), look: [-0.1, 0.1] });
  eye(kit, h, [0.11, 0.03, 0.2], { size: 0.13, iris: kit.mat('iris2', new Color3(0.25, 0.14, 0.06), 0.6, 64), look: [0.1, 0.1] });
  // Giant bat ears sticking out sideways below the hat brim.
  for (const side of [-1, 1]) {
    const ear = kit.cylinder(h, 0.38, 0, 0.24, fur, [side * 0.33, 0.07, -0.02], [0, 0, -side * 1.3], [1, 1, 0.35]);
    kit.cylinder(ear, 0.28, 0, 0.16, pink, [0, -0.02, 0.035]);
  }
  // A red rose clenched in his teeth.
  kit.sphere(h, 0.06, kit.mat('rose', new Color3(0.8, 0.05, 0.12), 0.3), [0.1, -0.16, 0.24]);
  kit.cylinder(h, 0.18, 0.012, 0.012, kit.mat('stem', new Color3(0.2, 0.5, 0.2)), [0.02, -0.17, 0.25], [0, 0, Math.PI / 2 - 0.2]);

  // The sombrero: a mushroom cap with a wide brim, white spots and gills underneath.
  const hat = kit.node(h, [0, 0.2, -0.01], [-0.12, 0, 0.12]);
  // Profile [radius, height]: a wide upturned brim rising into a tall, round mushroom dome.
  kit.lathe(hat, [[0.0, 0.0], [0.42, 0.0], [0.45, 0.05], [0.4, 0.04], [0.24, 0.05], [0.2, 0.1], [0.21, 0.2], [0.17, 0.29], [0.09, 0.34], [0.0, 0.35]], capRed, [0, 0, 0]);
  kit.cylinder(hat, 0.012, 0.84, 0.84, gills, [0, -0.006, 0]);
  // Big white mushroom spots on the dome and brim.
  const spotAt: [number, number, number, number][] = [
    [0.4, 0.2, 0.17, 0.1], [2.3, 0.2, 0.15, 0.09], [4.2, 0.19, 0.18, 0.1], [1.4, 0.13, 0.29, 0.08], [3.4, 0.12, 0.29, 0.07], [5.3, 0.13, 0.28, 0.08],
    [0.9, 0.33, 0.04, 0.08], [2.6, 0.32, 0.04, 0.09], [3.9, 0.34, 0.045, 0.07], [5.6, 0.33, 0.04, 0.08], [0.0, 0.0, 0.35, 0.08],
  ];
  for (const [a, r, y, d] of spotAt) {
    const spot = kit.sphere(hat, d, spots, [Math.cos(a) * r, y, Math.sin(a) * r], [1, 0.35, 1]);
    // Lay each spot on the hat's surface.
    if (r > 0) spot.rotation.set(Math.sin(a) * (y > 0.1 ? 0.6 : 0.15), 0, -Math.cos(a) * (y > 0.1 ? 0.6 : 0.15));
  }

  // Matador: gold fringed epaulettes on the shoulders, and a short cape.
  setShoulders(rig, 0.19);
  for (const pivot of rig.arms) {
    arm(kit, pivot, fur, cream, 0.048, 0.15);
    kit.sphere(pivot, 0.16, gold, [0, 0.035, 0], [1.15, 0.45, 1.1]);
    for (let i = 0; i < 5; i++) kit.cylinder(pivot, 0.06, 0.014, 0.014, gold, [-0.05 + i * 0.025, -0.01, 0.05]);
  }
  // A short matador capelet across the shoulders (it stops above the jersey number).
  const cape = kit.mat('cape', new Color3(0.62, 0.04, 0.08), 0.15);
  kit.card(rig.bounce, 0.44, 0.15, cape, [0, 0.66, -0.19], [0.5, Math.PI, 0]);
  kit.box(rig.bounce, [0.44, 0.025, 0.012], gold, [0, 0.59, -0.225], [0.5, 0, 0]);

  // Skinny legs and black matador slippers.
  const slipper = kit.mat('slipper', new Color3(0.07, 0.07, 0.08), 0.5, 48);
  for (const pivot of rig.legs) {
    kit.capsule(pivot, 0.2, 0.04, fur, [0, -0.09, 0]);
    kit.sphere(pivot, 0.13, slipper, [0, -0.2, 0.03], [0.9, 0.5, 1.4], undefined, 16);
    kit.sphere(pivot, 0.04, kit.mat('bow', PINK), [0, -0.17, 0.11], [1.4, 0.7, 0.6]);
  }
  // A little curled tail, off to the side so the number shows.
  kit.tube(rig.tail, [[0, 0, 0], [0.08, 0.04, -0.1], [0.18, 0.14, -0.1], [0.2, 0.22, -0.04]], 0.03, 0.015, fur);
}

// ---------------------------------------------------------------------------
// 4. The pinball machine: a goofy cabinet in team colors with its number on
//    the front and sides, googly eyes on the backbox, flippers for arms, a
//    plunger nose, chrome legs and its power cord for a tail.

function buildPinball(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const teamMat = kit.mat('cabinet', team, 0.35, 40);
  const trim = kit.mat('trim', WHITE, 0.3);
  const chrome = kit.mat('chrome', CHROME, 0.9, 96);
  const black = kit.mat('black', new Color3(0.08, 0.08, 0.1), 0.4);
  const numberMat = kit.mat('number', new Color3(1, 1, 1), 0.2);
  numberMat.diffuseTexture = numberTexture(kit.scene, team, number);
  const b = rig.bounce;

  // The cabinet body, with white edge trim and the number on the front and both sides.
  kit.box(b, [0.5, 0.36, 0.6], teamMat, [0, 0.42, 0]);
  for (const x of [-0.255, 0.255]) {
    kit.box(b, [0.012, 0.37, 0.61], trim, [x, 0.42, 0]);
    kit.card(b, 0.26, 0.26, numberMat, [x * 1.04, 0.43, 0.05], [0, x > 0 ? -Math.PI / 2 : Math.PI / 2, 0]);
  }
  kit.card(b, 0.22, 0.22, numberMat, [0, 0.45, 0.302], [0, Math.PI, 0]);
  kit.card(b, 0.26, 0.26, numberMat, [0, 0.43, -0.302]);
  // Coin door under the number, with two glowing coin slots.
  kit.box(b, [0.2, 0.08, 0.02], black, [0, 0.3, 0.305]);
  for (const x of [-0.05, 0.05]) kit.box(b, [0.04, 0.03, 0.01], kit.glow('slot', new Color3(1, 0.55, 0.1)), [x, 0.3, 0.318]);
  // The playfield on top: glass, three bumpers and a steel ball.
  kit.box(b, [0.46, 0.012, 0.56], kit.mat('field', new Color3(0.12, 0.1, 0.25), 0.2), [0, 0.605, 0]);
  [new Color3(0.95, 0.2, 0.2), new Color3(1, 0.85, 0.1), new Color3(0.2, 0.6, 1)].forEach((c, i) => {
    const x = (i - 1) * 0.12;
    kit.cylinder(b, 0.05, 0.08, 0.08, kit.glow(`bumper${i}`, c), [x, 0.635, -0.08 + (i % 2) * 0.1]);
    kit.cylinder(b, 0.012, 0.09, 0.09, trim, [x, 0.665, -0.08 + (i % 2) * 0.1]);
  });
  kit.sphere(b, 0.06, chrome, [0.12, 0.645, 0.14]);
  const glass = kit.mat('glass', new Color3(0.7, 0.85, 1), 0.9, 96);
  glass.alpha = 0.25;
  kit.box(b, [0.47, 0.01, 0.57], glass, [0, 0.69, 0]);

  // Plunger nose sticking out the front right.
  kit.cylinder(b, 0.14, 0.025, 0.025, chrome, [0.18, 0.5, 0.36], [Math.PI / 2, 0, 0]);
  kit.sphere(b, 0.06, kit.mat('knob', new Color3(0.9, 0.1, 0.1), 0.5), [0.18, 0.5, 0.44]);

  // The backbox (its head): a lit display with goofy googly eyes and a dot-matrix grin.
  const h = rig.head;
  kit.box(h, [0.5, 0.36, 0.14], teamMat, [0, 0.02, -0.18]);
  kit.box(h, [0.52, 0.03, 0.16], trim, [0, 0.215, -0.18]);
  const screen = kit.mat('screen', new Color3(1, 1, 1));
  screen.diffuseTexture = displayTexture(kit.scene);
  screen.emissiveColor = new Color3(0.6, 0.6, 0.6);
  kit.card(h, 0.44, 0.3, screen, [0, 0.02, -0.105], [0, Math.PI, 0]);
  kit.card(h, 0.28, 0.28, numberMat, [0, 0.02, -0.252]);
  eye(kit, h, [-0.1, 0.07, -0.09], { size: 0.13, iris: kit.mat('irisB', new Color3(0.2, 0.5, 0.95), 0.4), look: [0.6, 0.7] });
  eye(kit, h, [0.1, 0.06, -0.09], { size: 0.16, iris: kit.mat('irisB2', new Color3(0.2, 0.5, 0.95), 0.4), look: [-0.7, -0.6] });
  // Antenna lamp on top, because it's goofy.
  kit.cylinder(h, 0.12, 0.012, 0.012, chrome, [0.15, 0.28, -0.18]);
  kit.sphere(h, 0.06, kit.glow('lamp', new Color3(1, 0.3, 0.2)), [0.15, 0.35, -0.18]);

  // Flipper arms, mounted on the outside of the cabinet: a chrome rod with a
  // white flipper bat on the end and a red rubber ring.
  for (const pivot of rig.arms) {
    pivot.position.x = Math.sign(pivot.position.x) * 0.28;
    kit.sphere(pivot, 0.11, kit.mat('button', new Color3(1, 0.12, 0.12), 0.5), [0, 0, 0]);
    kit.cylinder(pivot, 0.16, 0.025, 0.025, chrome, [0, -0.08, 0]);
    kit.capsule(pivot, 0.17, 0.045, kit.mat('flipper', WHITE, 0.4), [0, -0.23, 0.03], [0.3, 0, 0], [1, 1, 0.6]);
    kit.torus(pivot, 0.1, 0.02, kit.mat('rubber', new Color3(0.85, 0.1, 0.12), 0.2), [0, -0.17, 0.02], [Math.PI / 2, 0, 0]);
  }
  // Chrome legs (the front two walk; the back two are fixed) with leveler feet.
  for (const pivot of rig.legs) {
    kit.cylinder(pivot, 0.22, 0.05, 0.04, chrome, [0, -0.1, 0.12]);
    kit.cylinder(pivot, 0.03, 0.08, 0.08, black, [0, -0.225, 0.12]);
  }
  for (const x of [-0.2, 0.2]) {
    kit.cylinder(b, 0.24, 0.05, 0.04, chrome, [x, 0.12, -0.24]);
    kit.cylinder(b, 0.03, 0.08, 0.08, black, [x, 0.015, -0.24]);
  }
  // Power cord tail, ending in a plug.
  kit.tube(rig.tail, [[0, 0.15, 0.1], [0, 0.05, -0.08], [0.05, -0.15, -0.25], [0.1, -0.24, -0.45]], 0.018, 0.018, black);
  kit.box(rig.tail, [0.06, 0.04, 0.08], black, [0.1, -0.24, -0.47]);
  for (const x of [0.085, 0.115]) kit.box(rig.tail, [0.008, 0.01, 0.04], chrome, [x, -0.24, -0.52]);
}

/** The backbox display: dark glass with an orange dot-matrix grin and "TILT!" */
function displayTexture(scene: Scene): DynamicTexture {
  const w = 256;
  const h = 176;
  const tex = new DynamicTexture('display', { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#140c1e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff8a1a';
  // A dot-matrix grin.
  for (let i = 0; i < 15; i++) {
    const x = 40 + i * 12.5;
    const y = 128 + Math.sin((i / 14) * Math.PI) * 22;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TILT!', w / 2, 34);
  tex.update();
  return tex;
}

// ---------------------------------------------------------------------------
// 5. The tattoo guy: a chubby, goofy grinning dude in a black 5-panel cap and
//    round clear glasses, shoulder-length wavy dirty-blond hair, a curled
//    mustache and stubble, rosy cheeks, khaki shorts, a white smartwatch and
//    keys on a carabiner. Tattoos: a running cheetah on his right forearm, a
//    bird on a branch with ivy and pumpkins on his left upper arm, and a
//    floral piece above his knee.

function buildGuy(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const skinColor = new Color3(0.96, 0.75, 0.64);
  const skin = kit.mat('skin', skinColor, 0.12, 24);
  const blush = kit.mat('blush', new Color3(0.96, 0.56, 0.55), 0.1);
  const hair = kit.mat('hair', new Color3(0.6, 0.45, 0.27), 0.15, 24);
  const stache = kit.mat('stache', new Color3(0.7, 0.54, 0.33), 0.1);
  const stubble = kit.mat('stubble', new Color3(0.83, 0.64, 0.5), 0.08);
  const capBlack = kit.mat('cap', new Color3(0.1, 0.1, 0.11), 0.2, 24);
  const frame = kit.mat('frames', new Color3(0.86, 0.8, 0.7), 0.6, 64);
  frame.alpha = 0.75;
  const lens = kit.mat('lens', new Color3(0.85, 0.92, 1), 0.9, 96);
  lens.alpha = 0.18;

  // Chubby: khaki shorts and a round jersey belly.
  shorts(kit, rig, [1.32, 0.92, 1.22], new Color3(0.76, 0.64, 0.45));
  jersey(kit, rig, team, number, 0.52, 0.53, [1.22, 1.02, 1.14]);
  // Keys on a carabiner at his left hip, with a red strap.
  const silver = kit.mat('silver', CHROME, 0.8, 80);
  kit.torus(rig.bounce, 0.06, 0.012, silver, [-0.25, 0.3, 0.06], [0.3, 0, Math.PI / 2]);
  kit.box(rig.bounce, [0.02, 0.07, 0.01], kit.mat('brass', GOLD, 0.6), [-0.26, 0.24, 0.07], [0, 0, 0.2]);
  kit.box(rig.bounce, [0.02, 0.06, 0.01], silver, [-0.25, 0.235, 0.05], [0, 0, -0.25]);
  kit.box(rig.bounce, [0.025, 0.16, 0.006], kit.mat('strap', new Color3(0.8, 0.2, 0.3)), [-0.27, 0.2, 0.03], [0, 0, 0.08]);

  const h = rig.head;
  kit.sphere(h, 0.5, skin, [0, 0, 0], [1.06, 1, 0.98], undefined, 32);
  // Chubby cheeks, rosy, and a stubbly jaw.
  for (const side of [-1, 1]) {
    kit.sphere(h, 0.17, skin, [side * 0.13, -0.1, 0.12]);
    kit.sphere(h, 0.08, blush, [side * 0.15, -0.06, 0.2], [1.2, 0.8, 0.5]);
    kit.sphere(h, 0.1, skin, [side * 0.255, 0.0, 0.0], [0.45, 1, 0.75]);
  }
  kit.sphere(h, 0.3, stubble, [0, -0.15, 0.1], [1.25, 0.65, 0.95], undefined, 24);
  // Round nose.
  kit.sphere(h, 0.14, kit.mat('noseSkin', new Color3(0.98, 0.66, 0.58), 0.2), [0, -0.01, 0.26], [1, 0.9, 0.85]);
  // Big goofy grin under a curled mustache.
  kit.sphere(h, 0.13, kit.mat('mouth', new Color3(0.45, 0.13, 0.14), 0.2), [0, -0.135, 0.225], [1.6, 0.55, 0.5]);
  kit.box(h, [0.11, 0.022, 0.012], kit.mat('teeth', WHITE, 0.3), [0, -0.118, 0.26]);
  // The mustache: thin, drooping out from the middle, then curling up at the tips.
  for (const side of [-1, 1]) {
    kit.tube(h, [[side * 0.01, -0.07, 0.272], [side * 0.065, -0.09, 0.262], [side * 0.12, -0.09, 0.24], [side * 0.155, -0.06, 0.215], [side * 0.14, -0.03, 0.21]], 0.034, 0.01, stache);
  }
  // Smiling, squinty eyes behind round clear glasses.
  for (const side of [-1, 1]) {
    eye(kit, h, [side * 0.085, 0.045, 0.22], { size: 0.065, iris: kit.mat('iris', new Color3(0.35, 0.5, 0.62), 0.4), lid: skin, lidDrop: 0.45 });
    kit.torus(h, 0.12, 0.012, frame, [side * 0.085, 0.045, 0.262], [Math.PI / 2, 0, 0]);
    kit.cylinder(h, 0.004, 0.11, 0.11, lens, [side * 0.085, 0.045, 0.262], [Math.PI / 2, 0, 0]);
    // Temple arms running back to the ears, flaring out a little.
    kit.cylinder(h, 0.16, 0.008, 0.008, frame, [side * 0.165, 0.05, 0.185], [Math.PI / 2, -side * 0.3, 0]);
  }
  kit.cylinder(h, 0.05, 0.008, 0.008, frame, [0, 0.055, 0.262], [0, 0, Math.PI / 2]);

  // Shoulder-length wavy hair: one soft mass down the back and sides, with a
  // few waves in it and the ends flipping out above the shoulders.
  kit.sphere(h, 0.52, hair, [0, -0.01, -0.05], [1.06, 0.82, 1.0], undefined, 28);
  kit.sphere(h, 0.5, hair, [0, -0.15, -0.09], [1.1, 0.95, 0.75], undefined, 28);
  for (const side of [-1, 1]) {
    kit.sphere(h, 0.22, hair, [side * 0.22, -0.13, -0.01], [0.6, 1.3, 0.9], [0, 0, side * 0.08]);
    kit.sphere(h, 0.16, hair, [side * 0.26, -0.27, -0.04], [0.8, 0.6, 1], [0, 0, side * -0.4]);
  }
  for (let k = 0; k < 5; k++) {
    const x = -0.2 + k * 0.1;
    kit.sphere(h, 0.15, hair, [x, -0.3 - (k % 2) * 0.02, -0.2 + Math.abs(x) * 0.3], [1, 0.6, 0.9], [0.5, 0, x * 1.5]);
  }

  // Black 5-panel cap: a low crown, mesh side panels, a short flat brim, tipped back a little.
  const cap = kit.node(h, [0, 0.12, -0.01], [-0.12, 0, 0]);
  kit.sphere(cap, 0.5, capBlack, [0, 0, 0], [1.13, 0.6, 1.1], undefined, 32);
  const meshMat = kit.mat('capMesh', new Color3(0.25, 0.25, 0.27), 0.1);
  meshMat.diffuseTexture = meshTexture(kit.scene);
  for (const side of [-1, 1]) kit.sphere(cap, 0.2, meshMat, [side * 0.24, 0.04, -0.02], [0.25, 0.6, 1]);
  kit.cylinder(cap, 0.018, 0.36, 0.36, capBlack, [0, -0.02, 0.22], [0.08, 0, 0], [1, 1, 0.62]);
  kit.box(cap, [0.07, 0.025, 0.01], kit.mat('capLogo', new Color3(0.55, 0.55, 0.58)), [0.16, 0.06, 0.2], [0, 0.65, 0]);

  // Arms with tattoo sleeves: the left upper arm has the bird, ivy and pumpkins
  // (and a white smartwatch on the wrist); the right forearm has the cheetah.
  const leftSkin = kit.mat('leftArm', new Color3(1, 1, 1), 0.12, 24);
  leftSkin.diffuseTexture = tattooTexture(kit.scene, skinColor, 'bird');
  const rightSkin = kit.mat('rightArm', new Color3(1, 1, 1), 0.12, 24);
  rightSkin.diffuseTexture = tattooTexture(kit.scene, skinColor, 'cheetah');
  setShoulders(rig, 0.3);
  rig.arms.forEach((pivot, i) => arm(kit, pivot, i === 0 ? leftSkin : rightSkin, skin, 0.07, 0.18));
  kit.torus(rig.arms[0], 0.135, 0.03, kit.mat('watchBand', WHITE, 0.4), [0, -0.21, 0]);
  kit.box(rig.arms[0], [0.05, 0.06, 0.02], kit.mat('watchFace', new Color3(0.05, 0.05, 0.08), 0.9, 96), [0, -0.21, 0.066]);
  kit.torus(rig.arms[1], 0.04, 0.01, kit.mat('ring', GOLD, 0.8, 80), [0.02, -0.27, 0.03], [0, 0, Math.PI / 2]);

  // Legs: the floral tattoo above the knee, in gray sneakers.
  const legSkin = kit.mat('legSkin', new Color3(1, 1, 1), 0.12, 24);
  legSkin.diffuseTexture = tattooTexture(kit.scene, skinColor, 'floral');
  rig.legs.forEach((pivot, i) => sneakerLeg(kit, pivot, i === 0 ? legSkin : skin, new Color3(0.42, 0.42, 0.45), 0.07));
}

/** A dark mesh (the cap's breathable side panels). */
function meshTexture(scene: Scene): DynamicTexture {
  const s = 64;
  const tex = new DynamicTexture('capMesh', { width: s, height: s }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#3a3a3e';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#121214';
  for (let y = 2; y < s; y += 6) for (let x = (y / 6) % 2 ? 5 : 2; x < s; x += 6) ctx.fillRect(x, y, 3, 3);
  tex.update();
  return tex;
}

/**
 * Skin with a tattoo, for an arm or leg capsule (the texture wraps around the
 * limb: x goes around it, y runs along it). Each design is drawn four times
 * around, like a sleeve, so it faces the camera from any side.
 */
function tattooTexture(scene: Scene, skin: Color3, design: 'bird' | 'cheetah' | 'floral'): DynamicTexture {
  const w = 256;
  const h = 512;
  const tex = new DynamicTexture(`tattoo-${design}`, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = skin.toHexString();
  ctx.fillRect(0, 0, w, h);
  const ink = '#3b3f48';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const cx of [w * 0.125, w * 0.375, w * 0.625, w * 0.875]) {
    ctx.save();
    // Narrow enough for four around the limb, and stretched along it.
    ctx.translate(cx, 0);
    ctx.scale(0.72, 1.25);
    ctx.translate(-cx, 0);
    if (design === 'bird') {
      // Upper arm (the shoulder end, top of the texture): a gray-blue bird on a
      // branch, ivy leaves, and two orange pumpkins below.
      ctx.translate(cx, 150);
      ctx.strokeStyle = '#6b4a2f';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(-40, 40);
      ctx.lineTo(30, 10);
      ctx.stroke();
      ctx.fillStyle = '#7d8aa0';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -10, 20, 34, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-14, -44, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e8a33a';
      ctx.beginPath();
      ctx.moveTo(-27, -46);
      ctx.lineTo(-36, -42);
      ctx.lineTo(-26, -40);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(14, 10);
      ctx.lineTo(34, 40);
      ctx.lineTo(22, 12);
      ctx.fill();
      for (const [lx, ly, r] of [[-30, 60, 0.4], [10, 70, -0.6], [-10, 90, 0.2], [30, 50, 1]]) {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(r);
        ctx.fillStyle = '#5d8f3a';
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(10, 0);
        ctx.lineTo(4, 2);
        ctx.lineTo(8, 12);
        ctx.lineTo(0, 8);
        ctx.lineTo(-8, 12);
        ctx.lineTo(-4, 2);
        ctx.lineTo(-10, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      for (const [px, py, pr] of [[-16, 130, 26], [22, 120, 22]]) {
        ctx.fillStyle = '#e57f2a';
        ctx.beginPath();
        ctx.ellipse(px, py, pr, pr * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(px, py, pr * 0.45, pr * 0.78, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#5d8f3a';
        ctx.fillRect(px - 3, py - pr * 0.78 - 8, 6, 10);
      }
    } else if (design === 'cheetah') {
      // Forearm (the wrist end, bottom of the texture): a running cheetah
      // stretched out along the arm, line work with spots.
      ctx.translate(cx, 340);
      ctx.rotate(Math.PI / 2);
      ctx.strokeStyle = ink;
      ctx.fillStyle = skin.toHexString();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 62, 17, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(70, -12, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      // Legs mid-stride, and a long curled tail.
      ctx.moveTo(40, 10);
      ctx.lineTo(80, 34);
      ctx.moveTo(30, 12);
      ctx.lineTo(56, 38);
      ctx.moveTo(-40, 10);
      ctx.lineTo(-80, 30);
      ctx.moveTo(-50, 6);
      ctx.lineTo(-70, 40);
      ctx.moveTo(-60, -4);
      ctx.bezierCurveTo(-100, -10, -110, 20, -128, 10);
      ctx.stroke();
      ctx.fillStyle = ink;
      for (let k = 0; k < 26; k++) {
        const sx = -54 + ((k * 37) % 108);
        const sy = -10 + ((k * 13) % 20);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Above the knee (top of the leg texture): gray flowers and ferns.
      ctx.translate(cx, 120);
      ctx.strokeStyle = ink;
      ctx.fillStyle = '#9aa0a8';
      ctx.lineWidth = 3;
      for (let k = 0; k < 6; k++) {
        ctx.save();
        ctx.rotate((k / 6) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(0, -22, 9, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 30);
      ctx.lineTo(0, 120);
      for (let y = 45; y < 120; y += 14) {
        ctx.moveTo(0, y);
        ctx.lineTo(-18, y + 10);
        ctx.moveTo(0, y);
        ctx.lineTo(18, y + 10);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  tex.update();
  return tex;
}

const BUILDERS: Record<CharacterKind, (kit: Kit, rig: Rig, team: Color3, number: number) => void> = {
  bear: buildBear,
  cat: buildCat,
  truffles: buildTruffles,
  pinball: buildPinball,
  guy: buildGuy,
};

/** Build a character's look onto the rig, in its team color with its jersey number. */
export function buildCharacter(rig: Rig, kind: CharacterKind, team: Color3, number: number): void {
  BUILDERS[kind](new Kit(rig.scene, rig.outlined), rig, team, number);
}
