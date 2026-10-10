import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { HitKind, Player } from '../sim/player';
import { clamp, lerp } from '../sim/vec';

// Blocky athlete, about 1.25m tall at size 1. All heights are from the feet.
const HIP_Y = 0.46;
const SHOULDER_Y = 0.88;
const SHOULDER_X = 0.235;
const HEAD_SIZE = 0.26;
const HEAD_Y = 1.06;
const LAND_SQUASH_TIME = 0.15;

const SKIN = new Color3(0.96, 0.78, 0.62);
const HAIR = new Color3(0.3, 0.19, 0.11);
const SHOE = new Color3(0.15, 0.15, 0.17);

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
    right: [[0, 0, 0], [0.25, -1.0, 0.3], [0.6, -1.45, 0.3], [1, 0, 0]],
    left: [[0, 0, 0], [0.25, -1.0, 0.3], [0.6, -1.45, 0.3], [1, 0, 0]],
    lean: [[0, 0], [0.25, 0.2], [0.6, 0.05], [1, 0]],
    dip: [[0, 0], [0.25, -0.06], [0.6, 0.03], [1, 0]],
  },
  // Wind the hitting arm up and back overhead, then slam it down.
  spike: {
    duration: 0.32,
    right: [[0, 0, 0], [0.3, -3.4, 0.1], [0.55, -0.9, 0.15], [1, 0, 0]],
    left: [[0, 0, 0], [0.3, -1.6, 0], [0.55, -0.5, 0], [1, 0, 0]],
    lean: [[0, 0], [0.3, -0.15], [0.55, 0.3], [1, 0]],
    dip: [[0, 0], [0.3, 0.04], [0.55, -0.03], [1, 0]],
  },
};

/**
 * A blocky athlete made from boxes, with arm/leg swings and squash-and-stretch
 * driven by the player's sim state. Purely visual: reach and hit timing are
 * set by tuning, not by this model. Faces +z.
 */
export class Character {
  readonly root: TransformNode;
  private readonly bounce: TransformNode;
  // Index 0 is the left side (-x), 1 the right (+x).
  private readonly arms: TransformNode[];
  private readonly legs: TransformNode[];
  private facing = 0;
  private walkPhase = 0;
  private swing: { anim: SwingAnim; time: number } | null = null;
  private landTimer = 0;
  private wasGrounded = true;

  constructor(scene: Scene, teamColor: Color3) {
    this.root = new TransformNode('player', scene);
    // Everything that squashes, leans and dips hangs off `bounce`.
    this.bounce = new TransformNode('bounce', scene);
    this.bounce.parent = this.root;

    const jersey = material(scene, 'jersey', teamColor);
    const shorts = material(scene, 'shorts', teamColor.scale(0.45));
    const skin = material(scene, 'skin', SKIN);
    const hair = material(scene, 'hair', HAIR);
    const shoe = material(scene, 'shoe', SHOE);

    const box = (name: string, w: number, h: number, d: number, mat: StandardMaterial, parent: TransformNode) => {
      const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      mesh.material = mat;
      mesh.parent = parent;
      return mesh;
    };

    box('torso', 0.36, 0.4, 0.2, jersey, this.bounce).position.y = 0.72;
    box('shorts', 0.35, 0.16, 0.21, shorts, this.bounce).position.y = 0.48;

    box('head', HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, skin, this.bounce).position.y = HEAD_Y;
    // Hair on top and down the back, so you can tell which way they face.
    box('hairTop', HEAD_SIZE + 0.02, 0.07, HEAD_SIZE + 0.02, hair, this.bounce).position.y = HEAD_Y + HEAD_SIZE / 2;
    box('hairBack', HEAD_SIZE + 0.02, HEAD_SIZE * 0.75, 0.05, hair, this.bounce).position.set(
      0,
      HEAD_Y + HEAD_SIZE * 0.1,
      -HEAD_SIZE / 2,
    );

    // Limbs pivot at the shoulder / hip, so rotating the pivot swings the limb.
    this.arms = [-1, 1].map((side) => {
      const pivot = new TransformNode('shoulder', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      box('sleeve', 0.12, 0.12, 0.14, jersey, pivot).position.y = -0.04;
      box('arm', 0.1, 0.36, 0.11, skin, pivot).position.y = -0.2;
      return pivot;
    });

    this.legs = [-1, 1].map((side) => {
      const pivot = new TransformNode('hip', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * 0.09, HIP_Y, 0);
      box('leg', 0.13, 0.38, 0.14, skin, pivot).position.y = -0.21;
      box('shoe', 0.14, 0.08, 0.2, shoe, pivot).position.set(0, -HIP_Y + 0.04, 0.03);
      return pivot;
    });
  }

  /** Play the pass or spike animation; call whenever this player swings. */
  playSwing(kind: HitKind): void {
    this.swing = { anim: SWING_ANIMS[kind], time: 0 };
  }

  update(p: Player, x: number, y: number, z: number, size: number, dt: number): void {
    this.root.position.set(x, y, z);
    this.root.scaling.setAll(size);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0.5) this.facing = Math.atan2(p.vel.x, p.vel.z);
    this.root.rotation.y = this.facing;

    if (p.grounded && !this.wasGrounded) this.landTimer = LAND_SQUASH_TIME;
    this.wasGrounded = p.grounded;
    this.landTimer = Math.max(0, this.landTimer - dt);

    let phase = 0;
    if (this.swing) {
      this.swing.time += dt;
      phase = this.swing.time / this.swing.anim.duration;
      if (phase >= 1) this.swing = null;
    }
    const anim = this.swing?.anim;

    // Stretch going up, squash on landing.
    let stretch = 0;
    if (!p.grounded) stretch = clamp(p.vel.y * 0.03, -0.08, 0.12);
    if (this.landTimer > 0) stretch = -0.15 * (this.landTimer / LAND_SQUASH_TIME);

    const run = p.grounded ? clamp(speed / 6, 0, 1) : 0;
    this.walkPhase += dt * (4 + speed * 2.2);
    const stride = Math.sin(this.walkPhase);
    const hop = Math.abs(Math.cos(this.walkPhase)) * run * 0.04;

    this.bounce.position.y = hop + (anim ? sampleValue(anim.dip, phase) : 0);
    this.bounce.rotation.x = (anim ? sampleValue(anim.lean, phase) : 0) + run * 0.12;
    this.bounce.scaling.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);

    // Running: legs swing opposite each other and arms opposite the legs.
    // Airborne: one knee tucks and the arms lift out for balance.
    this.legs.forEach((leg, i) => {
      const opposite = i === 0 ? 1 : -1;
      leg.rotation.x = p.grounded ? opposite * stride * run * 0.7 : i === 0 ? -0.5 : -0.15;
    });
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      if (anim) {
        const [swing, spread] = sampleArm(i === 0 ? anim.left : anim.right, phase);
        arm.rotation.x = swing;
        // Positive spread brings the hand toward the center line.
        arm.rotation.z = side * spread;
        return;
      }
      arm.rotation.x = -(i === 0 ? 1 : -1) * stride * run * 0.8;
      arm.rotation.z = p.grounded ? 0 : -side * 0.5;
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
  mat.specularColor = new Color3(0.06, 0.06, 0.06);
  return mat;
}
