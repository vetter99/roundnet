// The playable characters. Each one is built from simple shapes onto the
// shared rig in character.ts (body, head, two arm pivots, two leg pivots and
// a tail pivot), which does all the animation. Everyone wears a sleeveless
// jersey in their team color with a big white number, so the team reads
// from any angle.
//
// House style: smooth, rounded vinyl-toy shapes with a soft sheen and a
// gentle rim light (Kit and style.ts do this for every shape). Big heads (the rig scales
// the head up), big round hands on shoulders that sit in the torso, stubby
// bodies, bold colors, and one iconic silhouette anchor each (a hat, tufts, a
// mustache, a backbox) instead of lots of small details.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { addRim, SEGMENTS } from './style';

export type CharacterKind = 'fox' | 'tubeman' | 'pig' | 'raccoon';

/** Every character, in picker order, with display names. */
export const CHARACTERS: { kind: CharacterKind; name: string }[] = [
  { kind: 'fox', name: 'Tilt' },
  { kind: 'tubeman', name: 'Tube Man' },
  { kind: 'pig', name: 'Chris P. Bacon' },
  { kind: 'raccoon', name: 'Trash Panda' },
];

/** Who plays each seat by default: Blue 1, Blue 2, Red 1, Red 2 (1v1 uses the "1" seats). */
export const SEAT_CHARACTERS: CharacterKind[] = ['fox', 'pig', 'tubeman', 'raccoon'];

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
  // Pivots the rig keeps spinning (a propeller, wheels): `idle` rad/s
  // standing, plus `run` rad/s at a full run.
  spinners: Spinner[];
  // How the character moves (see Character.update); a builder can change it.
  // Extra leg pivots pushed onto `legs` (back left, back right) walk too.
  gait: Gait;
  // Parts that sway on their own, like a flailing inflatable (see Wobbler).
  wobblers: Wobbler[];
}

/**
 * walk: two legs. waddle: short steps, rocking. hop: no legs, bouncing.
 * four: four legs, body level. glide: no legs, slides along on a base.
 * strut: two legs, big high steps. fly: hovers, flapping, legs dangling.
 */
export type Gait = 'walk' | 'waddle' | 'hop' | 'four' | 'glide' | 'strut' | 'fly';

/** A part that sways about an axis: amplitude `amp` rad (plus `run` at a full run), `freq` rad/s, offset `phase`. */
export interface Wobbler {
  node: TransformNode;
  axis: 'x' | 'y' | 'z';
  amp: number;
  run: number;
  freq: number;
  phase: number;
}

export interface Spinner {
  node: TransformNode;
  axis: 'x' | 'y';
  idle: number;
  run: number;
}

type V3 = [number, number, number];

const WHITE = new Color3(0.97, 0.97, 0.95);
const INK = new Color3(0.06, 0.05, 0.06);
const PINK = new Color3(0.95, 0.55, 0.62);
const GOLD = new Color3(0.95, 0.75, 0.22);
const CHROME = new Color3(0.78, 0.8, 0.84);
const SHORTS = new Color3(0.14, 0.14, 0.18);
// Materials keep this much of their requested shine (a soft sheen).
const SHINE_KEPT = 0.8;

/** Shape-making helpers for one character, in the smooth, rounded style. */
class Kit {
  constructor(readonly scene: Scene) {}

  mat(name: string, color: Color3, shine = 0.08, power = 32): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    // A soft sheen, and a gentle rim light at the edges.
    const kept = shine * SHINE_KEPT;
    m.specularColor = new Color3(kept, kept, kept);
    m.specularPower = power;
    addRim(m);
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

  sphere(parent: TransformNode, d: number, mat: StandardMaterial, pos: V3, scale?: V3, rot?: V3): Mesh {
    const mesh = MeshBuilder.CreateSphere('part', { diameter: d, segments: SEGMENTS }, this.scene);
    return this.place(mesh, parent, mat, pos, rot, scale);
  }

  capsule(parent: TransformNode, height: number, radius: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = MeshBuilder.CreateCapsule('part', { height, radius, tessellation: SEGMENTS, capSubdivisions: 8 }, this.scene);
    return this.place(mesh, parent, mat, pos, rot, scale);
  }

  cylinder(parent: TransformNode, height: number, top: number, bottom: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = MeshBuilder.CreateCylinder('part', { height, diameterTop: top, diameterBottom: bottom, tessellation: SEGMENTS }, this.scene);
    return this.place(mesh, parent, mat, pos, rot, scale);
  }

  box(parent: TransformNode, size: V3, mat: StandardMaterial, pos: V3, rot?: V3): Mesh {
    const mesh = MeshBuilder.CreateBox('part', { width: size[0], height: size[1], depth: size[2] }, this.scene);
    return this.place(mesh, parent, mat, pos, rot);
  }

  torus(parent: TransformNode, diameter: number, thickness: number, mat: StandardMaterial, pos: V3, rot?: V3, scale?: V3): Mesh {
    const mesh = MeshBuilder.CreateTorus('part', { diameter, thickness, tessellation: SEGMENTS * 2 }, this.scene);
    return this.place(mesh, parent, mat, pos, rot, scale);
  }

  /** A smooth bent tube through `points`, tapering from `r0` to `r1`. */
  tube(parent: TransformNode, points: V3[], r0: number, r1: number, mat: StandardMaterial): Mesh {
    const path = points.map((p) => new Vector3(...p));
    const length = pathLength(path);
    const mesh = MeshBuilder.CreateTube(
      'part',
      { path: smooth(path, 8), radiusFunction: (_, d) => r0 + (r1 - r0) * Math.min(1, d / length), tessellation: 18, cap: 3 },
      this.scene,
    );
    return this.place(mesh, parent, mat, [0, 0, 0]);
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
    const mesh = MeshBuilder.CreateLathe('part', { shape, tessellation: 48, sideOrientation: 2 }, this.scene);
    return this.place(mesh, parent, mat, pos, rot);
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
  const torso = kit.sphere(rig.bounce, d, mat, [0, y, 0], scale);
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
  kit.sphere(parent, s, white, pos, [1, 1.15, 0.6]);
  const [lx, ly] = o.look ?? [0, 0];
  const front: V3 = [pos[0] + lx * s * 0.18, pos[1] + ly * s * 0.18, pos[2] + s * 0.24];
  kit.sphere(parent, s * 0.62, o.iris, front, [1, 1.1, 0.35]);
  kit.sphere(parent, s * 0.34, pupil, [front[0], front[1], front[2] + s * 0.05], [1, 1.1, 0.4]);
  kit.sphere(parent, s * 0.16, shine, [front[0] + s * 0.12, front[1] + s * 0.15, front[2] + s * 0.09]);
  if (o.lid) {
    // A lid: a slightly bigger cap over the eye, dropped down over the top part.
    const drop = o.lidDrop ?? 0.35;
    kit.sphere(parent, s * 1.12, o.lid, [pos[0], pos[1] + s * (0.62 - drop), pos[2] + 0.004], [1.04, 0.62, 0.66], [0, 0, o.tilt ?? 0]);
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
  kit.sphere(pivot, thickness * 2.7, skin, [0, -0.005, 0]);
  kit.tube(pivot, [[0, 0, 0], [0, -0.1, 0.008], [0, -0.2, 0.012]], thickness, thickness * 0.68, skin);
  const side = Math.sign(pivot.position.x) || 1;
  // The hand: a big round mitten, the thumb on the inside, three finger bumps along the front.
  kit.sphere(pivot, handSize, hand, [0, -0.255, 0.012], [1, 0.95, 0.85]);
  kit.sphere(pivot, handSize * 0.42, hand, [-side * handSize * 0.42, -0.235, 0.04], [0.8, 1.1, 0.9]);
  for (let k = -1; k <= 1; k++) {
    kit.sphere(pivot, handSize * 0.34, hand, [k * handSize * 0.24, -0.255 - handSize * 0.4, 0.035], [1, 1.2, 1]);
  }
}

/** Shorts over the hips. */
function shorts(kit: Kit, rig: Rig, scale: V3, color = SHORTS): void {
  kit.sphere(rig.bounce, 0.38, kit.mat('shorts', color, 0.1), [0, 0.3, 0], scale);
}

// ---------------------------------------------------------------------------
// Tilt, the trickster fox, now a pop-punk rapper: sly half-lidded eyes
//    behind pink-tinted round shades, one eyebrow up, a smirk, bleached
//    spiky hair between tall black-tipped ears, a chunky gold chain (with a
//    little pinball pendant, his old love), a hoop earring, painted claws,
//    a pink electric guitar slung on his back, and a huge bushy tail.

function buildFox(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const fur = kit.mat('fur', new Color3(0.95, 0.45, 0.1), 0.1);
  const white = kit.mat('white', new Color3(0.98, 0.95, 0.9), 0.05);
  const black = kit.mat('black', new Color3(0.13, 0.1, 0.1), 0.1);
  const chrome = kit.mat('chrome', CHROME, 0.9, 64);
  const gold = kit.mat('gold', GOLD, 0.9, 64);
  const pinkMat = kit.mat('pink', PINK, 0.5, 48);

  shorts(kit, rig, [1, 0.78, 0.95]);
  jersey(kit, rig, team, number, 0.5, 0.44, [1, 0.97, 0.9]);
  // A chunky gold chain of links, with a little chrome pinball pendant.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const at: V3 = [Math.sin(a) * 0.15, 0.66 - Math.max(0, Math.cos(a)) * 0.1, Math.cos(a) * 0.14 + 0.03];
    kit.torus(rig.bounce, 0.06, 0.018, gold, at, [Math.PI / 2, a, k % 2 ? Math.PI / 2 : 0]);
  }
  kit.sphere(rig.bounce, 0.07, chrome, [0, 0.53, 0.2]);

  // A pink electric guitar slung across his back, neck up over his shoulder.
  const guitar = kit.node(rig.bounce, [0.02, 0.5, -0.24], [0, 0, 0.7]);
  kit.sphere(guitar, 0.3, pinkMat, [0, -0.06, 0], [1, 1.2, 0.3]);
  kit.sphere(guitar, 0.22, pinkMat, [0, 0.13, 0], [1, 1, 0.3]);
  kit.cylinder(guitar, 0.04, 0.07, 0.07, kit.mat('pickup', new Color3(0.1, 0.1, 0.1), 0.4), [0, 0, -0.05], [Math.PI / 2, 0, 0]);
  kit.box(guitar, [0.05, 0.42, 0.03], kit.mat('neck', new Color3(0.3, 0.2, 0.12), 0.3), [0, 0.42, 0]);
  kit.box(guitar, [0.08, 0.1, 0.04], pinkMat, [0, 0.66, 0]);
  // The strap across his chest.
  kit.torus(rig.bounce, 0.5, 0.02, kit.mat('strap', new Color3(0.08, 0.08, 0.09), 0.2), [0, 0.52, 0], [0, 0, -0.75], [1, 1, 0.95]);

  const h = rig.head;
  kit.sphere(h, 0.48, fur, [0, 0.02, 0], [1.1, 0.95, 1]);
  // White cheek ruffs and a long pointed snout with a white underside and a black nose.
  for (const side of [-1, 1]) kit.sphere(h, 0.2, white, [side * 0.15, -0.1, 0.1], [1, 0.8, 1]);
  kit.cylinder(h, 0.26, 0.05, 0.2, fur, [0, -0.05, 0.27], [Math.PI / 2, 0, 0], [1, 1, 0.8]);
  kit.sphere(h, 0.16, white, [0, -0.13, 0.2], [1, 0.6, 1.1]);
  kit.sphere(h, 0.08, black, [0, -0.04, 0.41]);
  // A sly smirk on one side.
  kit.capsule(h, 0.09, 0.012, black, [0.06, -0.13, 0.28], [0, 0.3, Math.PI / 2 - 0.4]);
  // Sly half-lidded eyes, slanted; the right eyebrow cocked up.
  const amber = kit.mat('iris', new Color3(0.95, 0.7, 0.1), 0.3);
  eye(kit, h, [-0.1, 0.05, 0.2], { size: 0.1, iris: amber, look: [0.4, 0], lid: fur, lidDrop: 0.45, tilt: -0.35 });
  eye(kit, h, [0.1, 0.05, 0.2], { size: 0.1, iris: amber, look: [0.4, 0], lid: fur, lidDrop: 0.3, tilt: 0.2 });
  kit.capsule(h, 0.1, 0.018, black, [-0.1, 0.12, 0.22], [0, 0, Math.PI / 2 + 0.3]);
  kit.capsule(h, 0.1, 0.018, black, [0.11, 0.17, 0.21], [0, 0, Math.PI / 2 - 0.5]);
  // Tall ears with black tips.
  for (const side of [-1, 1]) {
    const ear = kit.node(h, [side * 0.15, 0.2, -0.02], [0, 0, -side * 0.3]);
    kit.cylinder(ear, 0.24, 0, 0.17, fur, [0, 0.1, 0], undefined, [1, 1, 0.45]);
    kit.cylinder(ear, 0.08, 0, 0.065, black, [0, 0.19, 0], undefined, [1, 1, 0.5]);
    kit.cylinder(ear, 0.15, 0, 0.1, white, [0, 0.07, 0.03], undefined, [1, 1, 0.3]);
  }
  // Bleached, spiky hair between the ears.
  const bleach = kit.mat('bleach', new Color3(0.98, 0.93, 0.72), 0.2);
  for (const [x, z, rx, rz, len] of [[0, 0.06, 0.5, 0, 0.18], [-0.07, 0.0, 0.2, 0.4, 0.16], [0.07, 0.0, 0.2, -0.4, 0.16], [0, -0.06, -0.2, 0, 0.17], [-0.04, 0.1, 0.8, 0.3, 0.13], [0.05, 0.1, 0.8, -0.3, 0.13]]) {
    kit.cylinder(h, len, 0, 0.09, bleach, [x, 0.25, z], [rx, 0, rz]);
  }
  // Pink-tinted round sunglasses with thin gold frames.
  const lens = kit.mat('shades', new Color3(1, 0.35, 0.6), 0.9, 96);
  lens.alpha = 0.7;
  for (const side of [-1, 1]) {
    kit.torus(h, 0.13, 0.014, gold, [side * 0.1, 0.05, 0.255], [Math.PI / 2, 0, 0]);
    kit.cylinder(h, 0.01, 0.12, 0.12, lens, [side * 0.1, 0.05, 0.255], [Math.PI / 2, 0, 0]);
    kit.cylinder(h, 0.2, 0.01, 0.01, gold, [side * 0.21, 0.06, 0.15], [Math.PI / 2, side * 0.6, 0]);
  }
  kit.cylinder(h, 0.06, 0.01, 0.01, gold, [0, 0.06, 0.258], [0, 0, Math.PI / 2]);
  // A hoop earring in his left ear.
  kit.torus(h, 0.06, 0.012, gold, [-0.2, 0.18, 0.0], [0, 0, 0.3]);

  // Black-socked arms and legs, like a real fox, with painted black claws.
  setShoulders(rig, 0.2);
  for (const pivot of rig.arms) {
    arm(kit, pivot, fur, black, 0.05, 0.15);
    for (let k = -1; k <= 1; k++) kit.sphere(pivot, 0.035, kit.mat('nails', new Color3(0.05, 0.05, 0.06), 0.9, 80), [k * 0.035, -0.335, 0.06]);
  }
  for (const pivot of rig.legs) {
    kit.capsule(pivot, 0.2, 0.065, black, [0, -0.09, 0]);
    kit.sphere(pivot, 0.18, black, [0, -0.18, 0.05], [0.95, 0.6, 1.4]);
  }
  // The huge bushy tail, curling up behind him, with a white tip.
  kit.tube(rig.tail, [[0, 0, 0], [0.05, 0.05, -0.18], [0.12, 0.2, -0.3], [0.16, 0.4, -0.28]], 0.09, 0.06, fur);
  kit.sphere(rig.tail, 0.16, white, [0.17, 0.46, -0.27], [1, 1.3, 1]);
}

// ---------------------------------------------------------------------------
// Chris P. Bacon: a pink piglet on all fours like the real one, his body
//    level with the ground, walking on his front legs while his back end,
//    wrapped in blue cloth, rides in a two-wheeled cart on a yellow frame (the
//    wheels roll as he moves). Big snout, perky ears, a curly tail, a black
//    harness, and his jersey around his middle with the number on his back.
//    No arms: his hits are a lunge of the whole body, and he serves off his snout.

function buildPig(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const pink = kit.mat('pink', new Color3(1, 0.72, 0.74), 0.1);
  const deep = kit.mat('deepPink', new Color3(0.93, 0.5, 0.55), 0.1);
  const black = kit.mat('harness', new Color3(0.1, 0.1, 0.11), 0.2);
  const yellow = kit.mat('frame', new Color3(1, 0.82, 0.1), 0.4);
  const tire = kit.mat('tire', new Color3(0.12, 0.12, 0.13), 0.1);
  const rim = kit.mat('rim', CHROME, 0.7, 48);
  const b = rig.bounce;

  // The body, level and long (front is +z). The jersey wraps his middle with
  // its "front" turned up, so the number is on his back.
  kit.sphere(b, 0.4, pink, [0, 0.36, 0.12], [1, 0.95, 1.25]);
  const torso = jersey(kit, rig, team, number, 0.37, 0.42, [1, 1.35, 0.92]);
  torso.position.z = 0.02;
  // Turned up, then around, so the number reads upright from behind him.
  torso.rotation.set(-Math.PI / 2, Math.PI, 0);
  // His back end, wrapped in blue cloth.
  kit.sphere(b, 0.38, kit.mat('cloth', new Color3(0.15, 0.4, 0.95), 0.1), [0, 0.33, -0.2], [1.05, 0.95, 1]);
  // The harness: a strap around the chest and one just in front of the cloth
  // (clear of the number), with a silver ring on top.
  for (const z of [0.2, -0.13]) kit.torus(b, 0.44, 0.03, black, [0, 0.37, z], [Math.PI / 2, 0, 0], [1.02, 1, 1.05]);
  kit.torus(b, 0.07, 0.016, rim, [0, 0.6, 0.2], [Math.PI / 2, 0, 0]);

  // The cart: a yellow frame from the harness back to an axle, with a wheel each side.
  for (const side of [-1, 1]) {
    kit.cylinder(b, 0.36, 0.035, 0.035, yellow, [side * 0.22, 0.28, -0.12], [1.0, 0, 0]);
    // The mount turns the wheel's axis sideways; the wheel spins about it.
    const mount = kit.node(b, [side * 0.27, 0.13, -0.28], [0, 0, Math.PI / 2]);
    const wheel = kit.node(mount, [0, 0, 0]);
    rig.spinners.push({ node: wheel, axis: 'y', idle: 0, run: side * 18 });
    kit.cylinder(wheel, 0.05, 0.26, 0.26, tire, [0, 0, 0]);
    kit.cylinder(wheel, 0.06, 0.16, 0.16, rim, [0, 0, 0]);
    for (let k = 0; k < 3; k++) kit.box(wheel, [0.22, 0.065, 0.02], rim, [0, 0, 0], [0, (k * Math.PI) / 3, 0]);
  }
  kit.cylinder(b, 0.54, 0.03, 0.03, yellow, [0, 0.13, -0.28], [0, 0, Math.PI / 2]);

  // The head, low and out front.
  const h = rig.head;
  h.position.set(0, 0.44, 0.34);
  kit.sphere(h, 0.44, pink, [0, 0, 0], [1.05, 0.95, 1]);
  // The big flat snout with two nostrils.
  kit.cylinder(h, 0.1, 0.16, 0.18, deep, [0, -0.04, 0.22], [Math.PI / 2, 0, 0], [1.15, 1, 0.85]);
  for (const side of [-1, 1]) kit.sphere(h, 0.035, kit.mat('nostril', new Color3(0.45, 0.15, 0.2)), [side * 0.035, -0.04, 0.27], [1, 1.3, 0.5]);
  // Happy little eyes and a smile.
  for (const side of [-1, 1]) eye(kit, h, [side * 0.1, 0.07, 0.17], { size: 0.07, iris: kit.mat('iris', new Color3(0.3, 0.18, 0.1), 0.3), look: [0, 0.2] });
  kit.capsule(h, 0.11, 0.012, kit.mat('mouth', new Color3(0.5, 0.2, 0.25)), [0, -0.14, 0.19], [0, 0, Math.PI / 2]);
  // Perky ears, tipping forward.
  for (const side of [-1, 1]) {
    const ear = kit.node(h, [side * 0.14, 0.17, 0.0], [0.45, 0, -side * 0.35]);
    kit.cylinder(ear, 0.17, 0, 0.15, pink, [0, 0.07, 0], undefined, [1, 1, 0.4]);
    kit.cylinder(ear, 0.11, 0, 0.09, deep, [0, 0.05, 0.02], undefined, [1, 1, 0.3]);
  }

  // He walks on his front legs (the rig's legs, moved up under his chest), on little hooves.
  for (const pivot of rig.legs) {
    pivot.position.set(Math.sign(pivot.position.x) * 0.11, 0.28, 0.22);
    kit.capsule(pivot, 0.24, 0.05, pink, [0, -0.12, 0]);
    kit.cylinder(pivot, 0.06, 0.09, 0.1, deep, [0, -0.25, 0.01]);
  }
  // A curly tail out the back of the cloth.
  rig.tail.position.set(0, 0.42, -0.36);
  kit.tube(rig.tail, [[0, 0, 0], [0, 0.06, -0.06], [0.05, 0.11, -0.04], [0.03, 0.06, 0.0], [-0.02, 0.1, -0.06]], 0.025, 0.018, pink);
}

// ---------------------------------------------------------------------------
// The wacky waving inflatable tube man: no legs, he glides around on his
//     blower box while his whole tube body and long floppy arms flail nonstop
//     (wilder when he's moving). His tube is his team color with his number
//     on it; on top, a goofy wide-open face and a spiky hair flap.

function buildTubeMan(kit: Kit, rig: Rig, team: Color3, number: number): void {
  rig.gait = 'glide';
  const tube = kit.mat('tube', team, 0.3, 24);
  const stripe = kit.mat('stripe', WHITE, 0.2);
  const blower = kit.mat('blower', new Color3(0.2, 0.2, 0.23), 0.3);
  const grille = kit.mat('grille', new Color3(0.08, 0.08, 0.09), 0.2);
  const numberMat = kit.mat('number', new Color3(1, 1, 1), 0.2);
  numberMat.diffuseTexture = numberTexture(kit.scene, team, number);

  // The blower box he stands on, with a fan grille and little casters.
  kit.box(rig.bounce, [0.44, 0.24, 0.44], blower, [0, 0.14, 0]);
  kit.cylinder(rig.bounce, 0.02, 0.3, 0.3, grille, [0, 0.14, 0.225], [Math.PI / 2, 0, 0]);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) kit.sphere(rig.bounce, 0.06, grille, [x, 0.03, z]);

  // The tube: a chain of segments, each swaying a bit more than the one
  // below, so waves run up his body.
  const SEGMENTS = 6;
  const SEG = 0.2;
  let parent: TransformNode = kit.node(rig.bounce, [0, 0.26, 0]);
  const segments: TransformNode[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const seg = kit.node(parent, [0, k === 0 ? 0 : SEG, 0]);
    const up = (k + 1) / SEGMENTS;
    rig.wobblers.push({ node: seg, axis: 'z', amp: 0.05 + up * 0.12, run: 0.08, freq: 5.5, phase: k * 0.9 });
    rig.wobblers.push({ node: seg, axis: 'x', amp: 0.03 + up * 0.08, run: 0.06, freq: 4.1, phase: k * 0.7 + 1 });
    kit.cylinder(seg, SEG + 0.02, 0.22, 0.24, k % 3 === 2 ? stripe : tube, [0, SEG / 2, 0]);
    segments.push(seg);
    parent = seg;
  }
  // His number, front and back, on the middle of the tube.
  kit.card(segments[2], 0.17, 0.17, numberMat, [0, 0.1, 0.122], [0, Math.PI, 0]);
  kit.card(segments[2], 0.17, 0.17, numberMat, [0, 0.1, -0.122]);

  // The head sits on top of the tube and flails with it: a rounded top, big
  // eyes, a wide-open mouth, raised brows, and a spiky hair flap.
  const top = segments[SEGMENTS - 1];
  const h = rig.head;
  h.parent = top;
  h.position.set(0, SEG + 0.12, 0);
  kit.sphere(h, 0.26, tube, [0, 0, 0], [1, 1.25, 1]);
  for (const side of [-1, 1]) {
    eye(kit, h, [side * 0.055, 0.05, 0.1], { size: 0.08, iris: kit.mat('iris', new Color3(0.1, 0.1, 0.12)), look: [side * -0.3, 0.4] });
    // Brows raised high at the outside: gleefully surprised.
    kit.capsule(h, 0.07, 0.012, grille, [side * 0.055, 0.125, 0.11], [0, 0, Math.PI / 2 - side * 0.35]);
  }
  kit.sphere(h, 0.09, kit.mat('mouth', new Color3(0.15, 0.03, 0.05)), [0, -0.07, 0.11], [1, 1.3, 0.5]);
  const hair = kit.mat('hair', new Color3(1, 0.85, 0.1), 0.2);
  for (let k = -2; k <= 2; k++) kit.cylinder(h, 0.14, 0, 0.06, hair, [k * 0.035, 0.18, -0.01], [0.2 * Math.abs(k), 0, -k * 0.3]);

  // Long floppy arms, also chains of segments, flung up and out and flailing.
  rig.arms.forEach((pivot, i) => {
    const side = i === 0 ? -1 : 1;
    pivot.parent = segments[SEGMENTS - 2];
    pivot.position.set(side * 0.12, SEG * 0.8, 0);
    let armParent: TransformNode = kit.node(pivot, [0, 0, 0], [0, 0, side * 1.9]);
    for (let k = 0; k < 3; k++) {
      const seg = kit.node(armParent, [0, k === 0 ? 0 : -0.15, 0]);
      rig.wobblers.push({ node: seg, axis: 'z', amp: 0.35 + k * 0.15, run: 0.25, freq: 6.5 + i, phase: k * 1.1 + i * 2 });
      kit.cylinder(seg, 0.17, 0.08, 0.08, tube, [0, -0.075, 0]);
      armParent = seg;
    }
    // The flared end of the arm.
    kit.cylinder(armParent, 0.08, 0.13, 0.08, tube, [0, -0.18, 0]);
  });
}

// ---------------------------------------------------------------------------
// Trash Panda: a raccoon living in a beat-up metal trash can on little
// wheels. The can rolls (glides) around, wobbling as it goes; the raccoon
// pops out the top with its bandit mask and a sly grin, arms on the rim,
// the lid knocked askew, a banana peel over the edge, and its ringed tail
// poking out of a hole in the back. Its number is painted on the can.

function buildRaccoon(kit: Kit, rig: Rig, team: Color3, number: number): void {
  rig.gait = 'glide';
  const metal = kit.mat('canMetal', new Color3(0.62, 0.66, 0.68), 0.7, 48);
  const metalDark = kit.mat('canMetalDark', new Color3(0.45, 0.48, 0.5), 0.6, 48);
  const fur = kit.mat('fur', new Color3(0.55, 0.55, 0.58), 0.1);
  const furDark = kit.mat('furDark', new Color3(0.2, 0.2, 0.22), 0.1);
  const white = kit.mat('white', new Color3(0.96, 0.95, 0.92), 0.05);
  const black = kit.mat('black', new Color3(0.07, 0.07, 0.08), 0.4);
  const numberMat = kit.mat('number', new Color3(1, 1, 1), 0.2);
  numberMat.diffuseTexture = numberTexture(kit.scene, team, number);

  // Everything rides on the can, which wobbles as it rolls.
  const bin = kit.node(rig.bounce, [0, 0, 0]);
  rig.wobblers.push({ node: bin, axis: 'z', amp: 0.02, run: 0.07, freq: 8, phase: 0 });
  rig.wobblers.push({ node: bin, axis: 'x', amp: 0.01, run: 0.04, freq: 6, phase: 1 });

  // The can: a slightly tapered metal drum with ribs, a dent, and the number front and back.
  kit.cylinder(bin, 0.72, 0.62, 0.54, metal, [0, 0.43, 0]);
  for (const y of [0.2, 0.43, 0.66]) kit.torus(bin, 0.55 + y * 0.11, 0.025, metalDark, [0, y, 0]);
  kit.torus(bin, 0.64, 0.035, metalDark, [0, 0.79, 0]);
  kit.sphere(bin, 0.16, metalDark, [0.24, 0.35, 0.12], [0.4, 1, 1]);
  kit.card(bin, 0.22, 0.22, numberMat, [0, 0.47, 0.3], [0.08, Math.PI, 0]);
  kit.card(bin, 0.22, 0.22, numberMat, [0, 0.47, -0.3], [-0.08, 0, 0]);
  // Little wheels at the back, and the lid knocked askew on one side.
  for (const side of [-1, 1]) {
    const mount = kit.node(bin, [side * 0.22, 0.07, -0.2], [0, 0, Math.PI / 2]);
    const wheel = kit.node(mount, [0, 0, 0]);
    rig.spinners.push({ node: wheel, axis: 'y', idle: 0, run: side * 16 });
    kit.cylinder(wheel, 0.05, 0.14, 0.14, black, [0, 0, 0]);
  }
  const lid = kit.node(bin, [0.32, 0.85, -0.05], [0.2, 0, -0.9]);
  kit.cylinder(lid, 0.05, 0.62, 0.66, metal, [0, 0, 0]);
  kit.torus(lid, 0.14, 0.025, metalDark, [0, 0.06, 0], [Math.PI / 2, 0, 0]);
  // A banana peel draped over the rim.
  const peel = kit.mat('banana', new Color3(0.98, 0.85, 0.25), 0.2);
  for (const [rz, rx] of [[0.6, 0.3], [-0.5, 0.2], [0, -0.5]]) kit.capsule(bin, 0.16, 0.025, peel, [-0.24, 0.76, 0.18], [rx, 0, rz]);

  // The raccoon popping out the top, in its jersey.
  const torso = jersey(kit, rig, team, number, 0.88, 0.4, [1, 0.9, 0.9]);
  torso.parent = bin;
  const h = rig.head;
  h.parent = bin;
  h.position.set(0, 1.2, 0.02);
  kit.sphere(h, 0.46, fur, [0, 0, 0], [1.1, 0.95, 1]);
  // White cheeks and brows, the black bandit mask, a pointed muzzle and black nose.
  for (const side of [-1, 1]) {
    kit.sphere(h, 0.18, white, [side * 0.14, -0.08, 0.12], [1, 0.8, 0.9]);
    kit.sphere(h, 0.08, white, [side * 0.1, 0.16, 0.17], [1.3, 0.5, 0.6]);
  }
  kit.sphere(h, 0.34, black, [0, 0.03, 0.12], [1.15, 0.38, 0.75]);
  kit.cylinder(h, 0.16, 0.05, 0.16, white, [0, -0.07, 0.22], [Math.PI / 2, 0, 0], [1, 1, 0.75]);
  kit.sphere(h, 0.07, black, [0, -0.05, 0.31]);
  // Sly eyes, gleaming in the mask, and a crooked grin.
  const iris = kit.mat('iris', new Color3(0.95, 0.75, 0.2), 0.4);
  eye(kit, h, [-0.09, 0.04, 0.2], { size: 0.09, iris, look: [0.3, 0], lid: furDark, lidDrop: 0.35, tilt: -0.3 });
  eye(kit, h, [0.09, 0.04, 0.2], { size: 0.09, iris, look: [0.3, 0], lid: furDark, lidDrop: 0.2, tilt: 0.2 });
  kit.capsule(h, 0.09, 0.012, black, [0.04, -0.13, 0.25], [0, 0.2, Math.PI / 2 - 0.35]);
  // Round ears with dark insides.
  for (const side of [-1, 1]) {
    kit.sphere(h, 0.14, fur, [side * 0.17, 0.2, -0.03], [1, 1, 0.5]);
    kit.sphere(h, 0.08, furDark, [side * 0.17, 0.2, 0.0], [1, 1, 0.4]);
  }

  // Arms hooked over the rim, with little dark hands.
  setShoulders(rig, 0.2);
  for (const pivot of rig.arms) {
    pivot.parent = bin;
    pivot.position.y = 0.98;
    arm(kit, pivot, fur, furDark, 0.05, 0.14);
  }
  // No legs (they're in the can). The ringed tail pokes out of a hole in the back.
  rig.tail.parent = bin;
  rig.tail.position.set(0.1, 0.32, -0.28);
  kit.cylinder(bin, 0.02, 0.16, 0.16, black, [0.1, 0.32, -0.29], [Math.PI / 2, 0, 0]);
  const rings = [fur, furDark, fur, furDark, fur, furDark];
  rings.forEach((m, k) => kit.sphere(rig.tail, 0.16 - k * 0.012, m, [0.03 * k, 0.05 + k * 0.06, -0.06 - k * 0.07]));
}

const BUILDERS: Record<CharacterKind, (kit: Kit, rig: Rig, team: Color3, number: number) => void> = {
  fox: buildFox,
  tubeman: buildTubeMan,
  pig: buildPig,
  raccoon: buildRaccoon,
};

/** Build a character's look onto the rig, in its team color with its jersey number. */
export function buildCharacter(rig: Rig, kind: CharacterKind, team: Color3, number: number): void {
  BUILDERS[kind](new Kit(rig.scene), rig, team, number);
}
