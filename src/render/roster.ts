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

export type CharacterKind = 'fox' | 'tubeman' | 'pig' | 'redpanda';

/** Every character, in picker order, with display names. */
export const CHARACTERS: { kind: CharacterKind; name: string }[] = [
  { kind: 'fox', name: 'Tilt' },
  { kind: 'tubeman', name: 'Tube Man' },
  { kind: 'pig', name: 'Chris P. Bacon' },
  { kind: 'redpanda', name: 'Scout' },
];

/** Who plays each seat by default: Blue 1, Blue 2, Red 1, Red 2 (1v1 uses the "1" seats). */
export const SEAT_CHARACTERS: CharacterKind[] = ['fox', 'pig', 'tubeman', 'redpanda'];

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
 * scurry: two legs, quick tiny steps.
 */
export type Gait = 'walk' | 'waddle' | 'hop' | 'four' | 'glide' | 'strut' | 'fly' | 'scurry';

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
const GOLD = new Color3(0.95, 0.75, 0.22);
const CHROME = new Color3(0.78, 0.8, 0.84);
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

// ---------------------------------------------------------------------------
// Tilt, the trickster fox, now a pop-punk rapper: sly half-lidded eyes, one
//    eyebrow up, a smirk, a water-drip tattoo under his eye, tall
//    black-tipped ears, a chunky gold chain (with a little
//    pinball pendant, his old love), a hoop earring, painted claws, and
//    full tattoos on both arms, both bare legs (no shorts) and his huge
//    bushy tail.

function buildFox(kit: Kit, rig: Rig, team: Color3, number: number): void {
  const fur = kit.mat('fur', new Color3(0.95, 0.45, 0.1), 0.1);
  const white = kit.mat('white', new Color3(0.98, 0.95, 0.9), 0.05);
  const black = kit.mat('black', new Color3(0.13, 0.1, 0.1), 0.1);
  const chrome = kit.mat('chrome', CHROME, 0.9, 64);
  const gold = kit.mat('gold', GOLD, 0.9, 64);
  // Fur covered in tattoos, for his arms and legs.
  const inked = kit.mat('inkedFur', new Color3(1, 1, 1), 0.1);
  inked.diffuseTexture = sleeveTexture(kit.scene, new Color3(0.95, 0.45, 0.1));

  // No shorts: furry hips under the jersey.
  kit.sphere(rig.bounce, 0.36, fur, [0, 0.3, 0], [1, 0.75, 0.95]);
  jersey(kit, rig, team, number, 0.5, 0.44, [1, 0.97, 0.9]);
  // A chunky gold chain of links, with a little chrome pinball pendant.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const at: V3 = [Math.sin(a) * 0.15, 0.66 - Math.max(0, Math.cos(a)) * 0.1, Math.cos(a) * 0.14 + 0.03];
    kit.torus(rig.bounce, 0.06, 0.018, gold, at, [Math.PI / 2, a, k % 2 ? Math.PI / 2 : 0]);
  }
  kit.sphere(rig.bounce, 0.07, chrome, [0, 0.53, 0.2]);


  const h = rig.head;
  kit.sphere(h, 0.48, fur, [0, 0.02, 0], [1.1, 0.95, 1]);
  // An all-orange face: a pointed snout and a black nose.
  kit.cylinder(h, 0.26, 0.05, 0.2, fur, [0, -0.05, 0.27], [Math.PI / 2, 0, 0], [1, 1, 0.8]);
  kit.sphere(h, 0.08, black, [0, -0.04, 0.41]);
  // A little smirk on one side.
  kit.capsule(h, 0.09, 0.012, black, [0.06, -0.13, 0.28], [0, 0.3, Math.PI / 2 - 0.4]);
  // Simple friendly eyes: dark ovals with a shine, no lids or brows.
  const shine = kit.glow('eyeShine', new Color3(1, 1, 1));
  for (const side of [-1, 1]) {
    kit.sphere(h, 0.075, black, [side * 0.1, 0.06, 0.205], [0.85, 1.2, 0.5]);
    kit.sphere(h, 0.022, shine, [side * 0.1 + 0.015, 0.085, 0.228]);
  }
  // Tall ears with black tips.
  for (const side of [-1, 1]) {
    const ear = kit.node(h, [side * 0.15, 0.2, -0.02], [0, 0, -side * 0.3]);
    kit.cylinder(ear, 0.24, 0, 0.17, fur, [0, 0.1, 0], undefined, [1, 1, 0.45]);
    kit.cylinder(ear, 0.08, 0, 0.065, black, [0, 0.19, 0], undefined, [1, 1, 0.5]);
    kit.cylinder(ear, 0.15, 0, 0.1, white, [0, 0.07, 0.03], undefined, [1, 1, 0.3]);
  }
  // A water-drip tattoo under his left eye: a little teardrop of ink.
  const ink = kit.mat('ink', new Color3(0.08, 0.12, 0.3), 0.3);
  kit.sphere(h, 0.04, ink, [-0.13, -0.035, 0.225], [0.8, 1, 0.4]);
  kit.cylinder(h, 0.035, 0, 0.032, ink, [-0.13, -0.004, 0.225], undefined, [1, 1, 0.4]);
  // A paisley bandana in his team color, tied over his head with the knot
  // and its tails at the back; his ears poke out.
  const bandana = kit.mat('bandana', new Color3(1, 1, 1), 0.15);
  bandana.diffuseTexture = paisleyTexture(kit.scene, team);
  kit.sphere(h, 0.5, bandana, [0, 0.12, -0.03], [1.13, 0.68, 1.04]);
  kit.torus(h, 0.47, 0.04, bandana, [0, 0.13, -0.01], [-0.15, 0, 0], [1.1, 1, 1.02]);
  kit.sphere(h, 0.1, bandana, [0, 0.12, -0.27]);
  for (const side of [-1, 1]) kit.sphere(h, 0.16, bandana, [side * 0.05, 0.03, -0.3], [0.5, 1.1, 0.2], [0.3, 0, side * 0.5]);
  // A hoop earring in his left ear.
  kit.torus(h, 0.06, 0.012, gold, [-0.2, 0.18, 0.0], [0, 0, 0.3]);

  // Tattooed arms down to black paws, with painted black claws.
  setShoulders(rig, 0.2);
  for (const pivot of rig.arms) {
    arm(kit, pivot, inked, black, 0.05, 0.15);
    for (let k = -1; k <= 1; k++) kit.sphere(pivot, 0.035, kit.mat('nails', new Color3(0.05, 0.05, 0.06), 0.9, 80), [k * 0.035, -0.335, 0.06]);
  }
  // Bare tattooed legs down to black feet.
  for (const pivot of rig.legs) {
    kit.capsule(pivot, 0.22, 0.068, inked, [0, -0.08, 0]);
    kit.sphere(pivot, 0.18, black, [0, -0.19, 0.05], [0.95, 0.6, 1.4]);
  }
  // The huge bushy tail, curling up behind him, with a white tip.
  kit.tube(rig.tail, [[0, 0, 0], [0.05, 0.05, -0.18], [0.12, 0.2, -0.3], [0.16, 0.4, -0.28]], 0.09, 0.06, inked);
  kit.sphere(rig.tail, 0.16, white, [0.17, 0.46, -0.27], [1, 1.3, 1]);
}

/** A bandana's paisley print: white teardrop motifs and dots on the team color. */
function paisleyTexture(scene: Scene, team: Color3): DynamicTexture {
  const s = 128;
  const tex = new DynamicTexture('paisley', { width: s, height: s }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = team.toHexString();
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#f4f1ea';
  ctx.fillStyle = '#f4f1ea';
  ctx.lineWidth = 2;
  for (const [x, y, r] of [[32, 32, 0.4], [96, 32, 2.6], [32, 96, 1.9], [96, 96, 5]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    // A paisley teardrop with a curled tip, and a dot inside.
    ctx.beginPath();
    ctx.arc(0, 4, 10, 0.2, Math.PI * 2 - 0.9);
    ctx.quadraticCurveTo(14, -18, 4, -16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const [x, y] of [[64, 64], [64, 8], [8, 64], [64, 120], [120, 64]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.update();
  tex.uScale = 3;
  tex.vScale = 3;
  return tex;
}

/**
 * A full tattoo sleeve on fur: dense flash-style ink (roses, stars, daggers,
 * swallows, waves, script lines) with a few red and teal fills, tiling so it
 * wraps around a limb with no seam.
 */
function sleeveTexture(scene: Scene, fur: Color3): DynamicTexture {
  const s = 256;
  const tex = new DynamicTexture('sleeve', { width: s, height: s }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = fur.toHexString();
  ctx.fillRect(0, 0, s, s);
  let seed = 21;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ink = '#1a1420';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Draw each design at (x, y), and again shifted by the texture size so it tiles.
  const stamp = (x: number, y: number, draw: () => void) => {
    for (const dx of [-s, 0, s]) {
      for (const dy of [-s, 0, s]) {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        draw();
        ctx.restore();
      }
    }
  };
  const rose = () => {
    ctx.fillStyle = '#c42838';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let a = 0; a < 9; a += 0.3) ctx.lineTo(Math.cos(a) * a * 1.6, Math.sin(a) * a * 1.6);
    ctx.stroke();
    ctx.fillStyle = '#2f8a6e';
    for (const r of [-0.6, 2.4]) {
      ctx.beginPath();
      ctx.ellipse(Math.cos(r) * 22, Math.sin(r) * 22, 10, 5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };
  const star = () => {
    ctx.fillStyle = ink;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 6 : 14;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };
  const dagger = () => {
    ctx.strokeStyle = ink;
    ctx.fillStyle = '#d9d4cc';
    ctx.lineWidth = 2.5;
    ctx.rotate(0.5);
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(5, 8);
    ctx.lineTo(-5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillRect(-12, 8, 24, 5);
    ctx.fillRect(-3, 13, 6, 14);
  };
  const swallow = () => {
    ctx.fillStyle = '#245a8f';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-22, -6);
    ctx.quadraticCurveTo(-4, -2, 0, 4);
    ctx.quadraticCurveTo(4, -2, 22, -6);
    ctx.quadraticCurveTo(8, 6, 4, 10);
    ctx.lineTo(8, 22);
    ctx.lineTo(0, 14);
    ctx.lineTo(-8, 22);
    ctx.lineTo(-4, 10);
    ctx.quadraticCurveTo(-8, 6, -22, -6);
    ctx.fill();
    ctx.stroke();
  };
  const waves = () => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let x = -30; x <= 30; x += 3) ctx.lineTo(x, k * 8 + Math.sin(x * 0.2) * 4);
      ctx.stroke();
    }
  };
  const script = () => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -26; x <= 26; x += 2) ctx.lineTo(x, Math.sin(x * 0.7) * 5 + (x % 9 === 0 ? -6 : 0));
    ctx.stroke();
  };
  const designs = [rose, star, dagger, swallow, waves, script, star, rose, script];
  // A packed grid of designs, jittered so it looks hand-placed, filled in
  // edge to edge like a full sleeve.
  const grid = 6;
  const cell = s / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = gx * cell + cell / 2 + (rand() - 0.5) * cell * 0.4;
      const y = gy * cell + cell / 2 + (rand() - 0.5) * cell * 0.4;
      const design = designs[Math.floor(rand() * designs.length)];
      const scale = 0.8 + rand() * 0.3;
      stamp(x, y, () => {
        ctx.scale(scale, scale);
        design();
      });
    }
  }
  // Little filler dots between designs.
  for (let k = 0; k < 90; k++) {
    stamp(rand() * s, rand() * s, () => {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, 1.5 + rand() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  tex.update();
  return tex;
}

// ---------------------------------------------------------------------------
// Chris P. Bacon: a pink piglet on all fours like the real one, his body
//    level with the ground, walking on his front legs while his back end,
//    wrapped in brown cloth, rides in a two-wheeled cart on a yellow frame (the
//    wheels roll as he moves). Big snout, perky ears, a curly tail, a black
//    harness, and his jersey around his middle with the number on his back.
//    Little trotter arms on the sides of his chest do the hitting, so his
//    serves and swings read like everyone else's.

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
  // His back end, wrapped in brown cloth (not blue, which reads as a team color).
  kit.sphere(b, 0.38, kit.mat('cloth', new Color3(0.32, 0.22, 0.15), 0.1), [0, 0.33, -0.2], [1.05, 0.95, 1]);
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
  // Little trotter arms on the sides of his chest, for hitting and serving:
  // they hang at his sides, swing up on every hit, and show his serve's spin.
  for (const pivot of rig.arms) {
    pivot.position.set(Math.sign(pivot.position.x) * 0.22, 0.48, 0.24);
    kit.sphere(pivot, 0.1, pink, [0, 0, 0]);
    kit.capsule(pivot, 0.2, 0.042, pink, [0, -0.09, 0]);
    kit.cylinder(pivot, 0.06, 0.08, 0.09, deep, [0, -0.2, 0.01]);
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

/** Points along a half-circle arc of radius `r` centered at `c`, bowed up (bow 1) or down (-1), facing +z. */
function arcPoints(c: V3, r: number, bow: 1 | -1): V3[] {
  const pts: V3[] = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    pts.push([c[0] - Math.cos(a) * r, c[1] + bow * Math.sin(a) * r * 0.7, c[2] + Math.sin(a) * 0.006]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Scout, a red panda cub scout: a big round fuzzy rust-red head with white
// eyebrow spots, white cheeks and muzzle, reddish tear marks, white-rimmed
// ears, a happy closed-eye grin and a little black nose; dark legs and arms;
// a fluffy ringed tail. In scout gear: a round olive helmet with amber
// goggles and a teal feather, a mustard scarf over his jersey, a belt with a
// pouch, olive shorts and big floppy boots. He scurries on quick little steps.

function buildRedPanda(kit: Kit, rig: Rig, team: Color3, number: number): void {
  rig.gait = 'scurry';
  const fur = kit.mat('fur', new Color3(0.78, 0.33, 0.12), 0.15);
  const furLight = kit.mat('furLight', new Color3(0.9, 0.55, 0.28), 0.12);
  const dark = kit.mat('darkFur', new Color3(0.2, 0.1, 0.07), 0.15);
  const white = kit.mat('white', new Color3(0.99, 0.96, 0.9), 0.1);
  const tear = kit.mat('tear', new Color3(0.6, 0.22, 0.1), 0.1);
  const black = kit.mat('black', new Color3(0.08, 0.06, 0.06), 0.4);
  const olive = kit.mat('olive', new Color3(0.42, 0.45, 0.25), 0.15);
  const oliveDark = kit.mat('oliveDark', new Color3(0.3, 0.33, 0.18), 0.15);
  const leather = kit.mat('leather', new Color3(0.45, 0.3, 0.17), 0.3);
  const boot = kit.mat('boot', new Color3(0.38, 0.4, 0.3), 0.2);
  const scarf = kit.mat('scarf', new Color3(0.95, 0.75, 0.2), 0.05);
  const b = rig.bounce;

  // Olive shorts, the jersey, a fluffy scarf, and a belt with a pouch.
  kit.sphere(b, 0.36, olive, [0, 0.3, 0], [1, 0.72, 0.95]);
  jersey(kit, rig, team, number, 0.5, 0.42, [0.97, 0.95, 0.9]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    kit.sphere(b, 0.11, scarf, [Math.sin(a) * 0.15, 0.67 + (k % 2) * 0.015, Math.cos(a) * 0.14 + 0.02]);
  }
  kit.sphere(b, 0.1, scarf, [0.1, 0.58, 0.2], [0.8, 1.2, 0.7]);
  kit.torus(b, 0.4, 0.035, leather, [0, 0.36, 0], undefined, [1, 1, 0.92]);
  kit.box(b, [0.1, 0.09, 0.06], leather, [-0.16, 0.33, 0.13], [0, -0.6, 0]);
  kit.sphere(b, 0.035, kit.mat('buckle', GOLD, 0.8, 64), [0, 0.36, 0.19]);

  // The head: big, round and fuzzy, with the red panda's white face markings.
  const h = rig.head;
  kit.sphere(h, 0.5, fur, [0, 0, 0], [1.12, 0.95, 1]);
  // Fluffy cheek tufts out to the sides.
  for (const side of [-1, 1]) kit.sphere(h, 0.2, white, [side * 0.21, -0.07, 0.07], [1, 0.85, 0.8]);
  // White muzzle, black nose, and a smile.
  kit.sphere(h, 0.2, white, [0, -0.08, 0.2], [1.1, 0.8, 0.8]);
  kit.sphere(h, 0.065, black, [0, -0.04, 0.29], [1.3, 0.85, 0.8]);
  kit.tube(h, arcPoints([0, -0.11, 0.27], 0.04, -1), 0.01, 0.01, black);
  for (const side of [-1, 1]) {
    // White eyebrow spots, happy closed eyes, and reddish tear marks under them.
    kit.sphere(h, 0.08, white, [side * 0.1, 0.12, 0.2], [1.2, 0.7, 0.5]);
    kit.tube(h, arcPoints([side * 0.1, 0.03, 0.235], 0.042, 1), 0.012, 0.012, black);
    kit.sphere(h, 0.06, tear, [side * 0.12, -0.03, 0.215], [0.6, 1.3, 0.4]);
    // Big rounded ears with white rims and dark insides.
    const ear = kit.node(h, [side * 0.22, 0.2, -0.03], [0, 0, -side * 0.35]);
    kit.sphere(ear, 0.2, white, [0, 0, 0], [1, 1.1, 0.4]);
    kit.sphere(ear, 0.15, dark, [0, -0.005, 0.02], [1, 1.1, 0.35]);
  }

  // The round olive scout helmet with a brim, amber goggles on top, and a teal feather tuft.
  const hat = kit.node(h, [0, 0.14, -0.01], [-0.12, 0, 0]);
  kit.sphere(hat, 0.47, olive, [0, 0.03, 0], [1.05, 0.6, 1.05]);
  kit.torus(hat, 0.47, 0.035, oliveDark, [0, 0, 0], undefined, [1.05, 1, 1.05]);
  kit.torus(hat, 0.46, 0.022, kit.mat('strap', new Color3(0.15, 0.13, 0.12), 0.2), [0, 0.07, 0], undefined, [1.04, 1, 1.04]);
  const frame = kit.mat('goggleFrame', new Color3(0.55, 0.35, 0.15), 0.5, 48);
  const lens = kit.mat('goggleLens', new Color3(1, 0.75, 0.3), 0.9, 96);
  lens.alpha = 0.85;
  for (const side of [-1, 1]) {
    kit.torus(hat, 0.13, 0.03, frame, [side * 0.08, 0.13, 0.19], [Math.PI / 2 - 0.4, 0, 0]);
    kit.cylinder(hat, 0.015, 0.11, 0.11, lens, [side * 0.08, 0.13, 0.19], [Math.PI / 2 - 0.4, 0, 0]);
  }
  const feather = kit.mat('feather', new Color3(0.15, 0.6, 0.65), 0.1);
  for (const [rz, rx] of [[0.3, -0.5], [-0.1, -0.7], [0.55, -0.35]]) {
    kit.sphere(hat, 0.16, feather, [0.05, 0.2, -0.1], [0.3, 1.2, 0.15], [rx, 0, rz]);
  }

  // Dark furry arms and legs (like a real red panda), legs in big floppy boots.
  setShoulders(rig, 0.2);
  for (const pivot of rig.arms) arm(kit, pivot, dark, dark, 0.048, 0.13);
  for (const pivot of rig.legs) {
    kit.capsule(pivot, 0.12, 0.055, dark, [0, -0.04, 0]);
    kit.cylinder(pivot, 0.15, 0.14, 0.11, boot, [0, -0.13, 0]);
    kit.torus(pivot, 0.15, 0.025, boot, [0, -0.06, 0], [0.2, 0, 0]);
    kit.sphere(pivot, 0.19, boot, [0, -0.2, 0.05], [0.95, 0.6, 1.4]);
  }
  // A fluffy tail with light rings, curling up behind him.
  // Many overlapping puffs read as one bushy tail; every few puffs switch
  // color, making wide rings.
  const puffs = 14;
  for (let k = 0; k < puffs; k++) {
    const u = k / (puffs - 1);
    const d = 0.15 - Math.abs(u - 0.4) * 0.07;
    const ring = Math.floor(k / 3) % 2 === 1;
    kit.sphere(rig.tail, d, ring ? furLight : fur, [0.02 + u * 0.06, 0.02 + u * u * 0.26, -0.06 - Math.sin(u * 2.4) * 0.17]);
  }
}

const BUILDERS: Record<CharacterKind, (kit: Kit, rig: Rig, team: Color3, number: number) => void> = {
  fox: buildFox,
  tubeman: buildTubeMan,
  pig: buildPig,
  redpanda: buildRedPanda,
};

/** Build a character's look onto the rig, in its team color with its jersey number. */
export function buildCharacter(rig: Rig, kind: CharacterKind, team: Color3, number: number): void {
  BUILDERS[kind](new Kit(rig.scene), rig, team, number);
}
