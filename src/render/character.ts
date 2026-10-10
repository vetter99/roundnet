import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { HitKind, Player } from '../sim/player';
import { clamp, lerp } from '../sim/vec';

// Cartoon squirrel, about 1.2m tall at size 1 (plus tail). Heights are from
// the feet; the face points +z and the tail -z.
const HIP_Y = 0.24;
const SHOULDER_Y = 0.6;
const SHOULDER_X = 0.21;
const HEAD_Y = 0.93;
const HEAD_DIAMETER = 0.48;
const LAND_SQUASH_TIME = 0.18;

const CREAM = new Color3(0.99, 0.9, 0.74);
const DARK = new Color3(0.08, 0.06, 0.06);

/** Fur colors, so the two players are easy to tell apart. */
export const FUR = {
  red: new Color3(0.78, 0.43, 0.17),
  gray: new Color3(0.56, 0.53, 0.5),
};

// Swing animations as keyframes over normalized time 0..1.
// Arm keys are [t, swing, spread]: swing rotates the arm forward/up from
// hanging (negative = forward, -PI = straight up), spread tilts it toward
// the body's center line. Lean tilts the body forward; dip bends the knees.
type ArmKey = [t: number, swing: number, spread: number];
type ValueKey = [t: number, v: number];

interface SwingAnim {
  duration: number;
  right: ArmKey[];
  left: ArmKey[];
  lean: ValueKey[];
  dip: ValueKey[];
}

const SWING_ANIMS: Record<HitKind, SwingAnim> = {
  // Volleyball-style bump: both arms come forward together and lift.
  pass: {
    duration: 0.36,
    right: [[0, 0, 0], [0.25, -1.1, 0.35], [0.6, -1.6, 0.35], [1, 0, 0]],
    left: [[0, 0, 0], [0.25, -1.1, 0.35], [0.6, -1.6, 0.35], [1, 0, 0]],
    lean: [[0, 0], [0.25, 0.2], [0.6, 0.05], [1, 0]],
    dip: [[0, 0], [0.25, -0.08], [0.6, 0.04], [1, 0]],
  },
  // Wind the hitting arm up and back overhead, then slam it down.
  spike: {
    duration: 0.32,
    right: [[0, 0, 0], [0.3, -3.4, 0.1], [0.55, -0.9, 0.15], [1, 0, 0]],
    left: [[0, 0, 0], [0.3, -1.6, 0], [0.55, -0.5, 0], [1, 0, 0]],
    lean: [[0, 0], [0.3, -0.15], [0.55, 0.3], [1, 0]],
    dip: [[0, 0], [0.3, 0.05], [0.55, -0.04], [1, 0]],
  },
};

// While charging, the pose winds up to this point in the swing animation and
// holds there; releasing plays the rest of the swing from that point.
const WINDUP_PHASE: Record<HitKind, number> = { pass: 0.25, spike: 0.3 };

// The tail's shape: control points curling up behind the back, base to tip,
// as [y, z, diameter] relative to the tail's base pivot. Many overlapping
// spheres are blended between them so it reads as one bushy tail.
const TAIL_SHAPE: [number, number, number][] = [
  [0, 0, 0.17],
  [0.13, -0.15, 0.25],
  [0.34, -0.25, 0.31],
  [0.58, -0.25, 0.33],
  [0.78, -0.14, 0.29],
  [0.86, 0.01, 0.21],
];
const TAIL_STEPS_PER_SEGMENT = 8;

export interface ChargeView {
  kind: HitKind;
  power: number;
}

/**
 * A rounded cartoon squirrel in a team-color shirt, with arm/leg/tail swings
 * and bouncy squash-and-stretch driven by the player's sim state. Purely
 * visual: reach and hit timing are set by tuning, not by this model.
 */
export class Character {
  readonly root: TransformNode;
  private readonly bounce: TransformNode;
  private readonly tail: TransformNode;
  // Index 0 is the left side (-x), 1 the right (+x).
  private readonly arms: TransformNode[];
  private readonly legs: TransformNode[];
  private facing = 0;
  private walkPhase = 0;
  private swing: { anim: SwingAnim; time: number } | null = null;
  // The wind-up pose phase held while charging, so the release continues from it.
  private heldPhase: { kind: HitKind; phase: number } | null = null;
  private landTimer = 0;
  private wasGrounded = true;

  constructor(scene: Scene, teamColor: Color3, furColor: Color3) {
    this.root = new TransformNode('player', scene);
    // Everything that squashes, leans and dips hangs off `bounce`.
    this.bounce = new TransformNode('bounce', scene);
    this.bounce.parent = this.root;

    const shirt = material(scene, 'shirt', teamColor);
    const fur = material(scene, 'fur', furColor);
    const darkFur = material(scene, 'darkFur', furColor.scale(0.7));
    const cream = material(scene, 'cream', CREAM);
    const dark = material(scene, 'dark', DARK);
    dark.specularColor = new Color3(0.6, 0.6, 0.6);
    dark.specularPower = 40;
    const shine = material(scene, 'shine', new Color3(1, 1, 1));
    shine.disableLighting = true;
    shine.emissiveColor = new Color3(1, 1, 1);

    const ball = (name: string, d: number, mat: StandardMaterial, parent: TransformNode, segments = 20): Mesh => {
      const mesh = MeshBuilder.CreateSphere(name, { diameter: d, segments }, scene);
      mesh.material = mat;
      mesh.parent = parent;
      return mesh;
    };

    // Body: furry hips with a round team shirt on top.
    const hips = ball('hips', 0.36, fur, this.bounce);
    hips.position.y = 0.3;
    hips.scaling.set(1, 0.75, 0.95);
    const torso = ball('torso', 0.44, shirt, this.bounce);
    torso.position.y = 0.5;
    torso.scaling.set(1, 0.95, 0.85);

    // Head with muzzle, nose, eyes and ears.
    const head = ball('head', HEAD_DIAMETER, fur, this.bounce, 28);
    head.position.y = HEAD_Y;
    const muzzle = ball('muzzle', 0.24, cream, this.bounce);
    muzzle.position.set(0, HEAD_Y - 0.08, 0.16);
    muzzle.scaling.set(1.1, 0.75, 0.75);
    const nose = ball('nose', 0.075, dark, this.bounce, 12);
    nose.position.set(0, HEAD_Y - 0.04, 0.25);
    nose.scaling.set(1.2, 0.85, 0.9);

    for (const side of [-1, 1]) {
      // Tall glossy oval eyes with a white shine, cartoon style.
      const eye = ball('eye', 0.075, dark, this.bounce, 14);
      eye.position.set(side * 0.085, HEAD_Y + 0.05, 0.205);
      eye.scaling.set(0.85, 1.45, 0.6);
      const glint = ball('glint', 0.025, shine, this.bounce, 8);
      glint.position.set(side * 0.085 + 0.012, HEAD_Y + 0.08, 0.23);

      const ear = MeshBuilder.CreateCylinder('ear', { height: 0.17, diameterTop: 0, diameterBottom: 0.12, tessellation: 16 }, scene);
      ear.material = fur;
      ear.parent = this.bounce;
      ear.position.set(side * 0.14, HEAD_Y + 0.23, -0.02);
      ear.rotation.z = -side * 0.35;
      const innerEar = MeshBuilder.CreateCylinder('innerEar', { height: 0.11, diameterTop: 0, diameterBottom: 0.07, tessellation: 12 }, scene);
      innerEar.material = cream;
      innerEar.parent = ear;
      innerEar.position.set(0, -0.02, 0.025);
    }

    // Big bushy tail curling up behind; its pivot sways while running.
    this.tail = new TransformNode('tail', scene);
    this.tail.parent = this.bounce;
    this.tail.position.set(0, 0.26, -0.2);
    for (let i = 0; i < TAIL_SHAPE.length - 1; i++) {
      const [y0, z0, d0] = TAIL_SHAPE[i];
      const [y1, z1, d1] = TAIL_SHAPE[i + 1];
      const last = i === TAIL_SHAPE.length - 2;
      for (let s = 0; s <= (last ? TAIL_STEPS_PER_SEGMENT : TAIL_STEPS_PER_SEGMENT - 1); s++) {
        const u = s / TAIL_STEPS_PER_SEGMENT;
        // The last few puffs at the tip are cream.
        const tip = last && u > 0.5;
        const puff = ball('tail', lerp(d0, d1, u), tip ? cream : fur, this.tail, 14);
        puff.position.set(0, lerp(y0, y1, u), lerp(z0, z1, u));
      }
    }

    // Limbs pivot at the shoulder / hip, so rotating the pivot swings the limb.
    this.arms = [-1, 1].map((side) => {
      const pivot = new TransformNode('shoulder', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      ball('sleeve', 0.13, shirt, pivot);
      const arm = MeshBuilder.CreateCapsule('arm', { height: 0.26, radius: 0.05 }, scene);
      arm.material = fur;
      arm.parent = pivot;
      arm.position.y = -0.12;
      const paw = ball('paw', 0.1, cream, pivot, 12);
      paw.position.y = -0.25;
      return pivot;
    });

    this.legs = [-1, 1].map((side) => {
      const pivot = new TransformNode('hip', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * 0.1, HIP_Y, 0);
      const leg = MeshBuilder.CreateCapsule('leg', { height: 0.2, radius: 0.065 }, scene);
      leg.material = fur;
      leg.parent = pivot;
      leg.position.y = -0.1;
      // Oversized cartoon feet.
      const foot = ball('foot', 0.15, darkFur, pivot, 14);
      foot.scaling.set(0.95, 0.55, 1.45);
      foot.position.set(0, -HIP_Y + 0.04, 0.05);
      return pivot;
    });
  }

  /** Play the pass or spike animation; call whenever this player swings. */
  playSwing(kind: HitKind): void {
    const anim = SWING_ANIMS[kind];
    const startPhase = this.heldPhase?.kind === kind ? this.heldPhase.phase : 0;
    this.swing = { anim, time: startPhase * anim.duration };
    this.heldPhase = null;
  }

  update(p: Player, x: number, y: number, z: number, size: number, dt: number, charge: ChargeView | null): void {
    this.root.position.set(x, y, z);
    this.root.scaling.setAll(size);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0.5) this.facing = Math.atan2(p.vel.x, p.vel.z);
    this.root.rotation.y = this.facing;

    if (p.grounded && !this.wasGrounded) this.landTimer = LAND_SQUASH_TIME;
    this.wasGrounded = p.grounded;
    this.landTimer = Math.max(0, this.landTimer - dt);

    let phase = 0;
    let anim: SwingAnim | undefined;
    if (this.swing) {
      this.swing.time += dt;
      phase = this.swing.time / this.swing.anim.duration;
      anim = this.swing.anim;
      if (phase >= 1) this.swing = null;
    } else if (charge) {
      // Wind up quickly at first, then hold the pose as power builds.
      phase = WINDUP_PHASE[charge.kind] * Math.min(1, 0.4 + charge.power);
      anim = SWING_ANIMS[charge.kind];
      this.heldPhase = { kind: charge.kind, phase };
    } else {
      this.heldPhase = null;
    }

    // Bouncy squash and stretch: stretch going up, squash on landing.
    let stretch = 0;
    if (!p.grounded) stretch = clamp(p.vel.y * 0.045, -0.12, 0.2);
    if (this.landTimer > 0) stretch = -0.28 * Math.sin((this.landTimer / LAND_SQUASH_TIME) * Math.PI);

    const run = p.grounded ? clamp(speed / 6, 0, 1) : 0;
    this.walkPhase += dt * (5 + speed * 2.4);
    const stride = Math.sin(this.walkPhase);
    // A springy hop on every step.
    const hop = Math.abs(Math.cos(this.walkPhase)) * run * 0.08;
    const breathe = Math.sin(this.walkPhase * 0.4) * 0.015;

    this.bounce.position.y = hop + (anim ? sampleValue(anim.dip, phase) : 0);
    this.bounce.rotation.x = (anim ? sampleValue(anim.lean, phase) : 0) + run * 0.15;
    this.bounce.scaling.set(1 - stretch * 0.5, 1 + stretch + breathe, 1 - stretch * 0.5);

    // Tail swishes side to side while running, lifts when airborne.
    this.tail.rotation.y = Math.sin(this.walkPhase * 0.5) * (0.15 + run * 0.35);
    this.tail.rotation.x = p.grounded ? -run * 0.25 : clamp(-p.vel.y * 0.06, -0.3, 0.35);

    // Running: legs swing opposite each other and arms opposite the legs.
    // Airborne: one knee tucks and the arms lift out for balance.
    this.legs.forEach((leg, i) => {
      const opposite = i === 0 ? 1 : -1;
      leg.rotation.x = p.grounded ? opposite * stride * run * 0.9 : i === 0 ? -0.6 : -0.2;
    });
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      if (anim) {
        const [swing, spread] = sampleArm(i === 0 ? anim.left : anim.right, phase);
        arm.rotation.x = swing;
        // Positive spread brings the paw toward the center line.
        arm.rotation.z = side * spread;
        return;
      }
      arm.rotation.x = -(i === 0 ? 1 : -1) * stride * run * 0.9;
      arm.rotation.z = p.grounded ? side * 0.15 : -side * 0.7;
    });
  }
}

// Smoothstep between the two keys around `phase`.
function between<K extends { 0: number }>(keys: K[], phase: number): [K, K, number] {
  for (let i = 1; i < keys.length; i++) {
    if (phase <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const u = clamp((phase - a[0]) / Math.max(b[0] - a[0], 1e-6), 0, 1);
      return [a, b, u * u * (3 - 2 * u)];
    }
  }
  const lastKey = keys[keys.length - 1];
  return [lastKey, lastKey, 0];
}

function sampleArm(keys: ArmKey[], phase: number): [number, number] {
  const [a, b, u] = between(keys, phase);
  return [lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

function sampleValue(keys: ValueKey[], phase: number): number {
  const [a, b, u] = between(keys, phase);
  return lerp(a[1], b[1], u);
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.08, 0.08, 0.08);
  return mat;
}
