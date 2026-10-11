import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Player, ShotKind } from '../sim/player';
import { clamp, lerp } from '../sim/vec';
import { buildCharacter, type CharacterKind, type Gait, type Spinner, type Wobbler } from './roster';

// The shared rig, about 1.2m tall at size 1. Heights are from the feet; the
// face points +z and the tail -z. Each character's look is built onto it in
// roster.ts.
const HIP_Y = 0.24;
const SHOULDER_Y = 0.6;
const SHOULDER_X = 0.23;
const HEAD_Y = 0.93;
// Heads are drawn this much bigger than built, for the big-headed toy look.
const HEAD_SCALE = 1.15;
const LAND_SQUASH_TIME = 0.18;

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

const SWING_ANIMS: Record<ShotKind, SwingAnim> = {
  // Drop shot: a short, gentle push of the hitting paw, barely any wind-up.
  drop: {
    duration: 0.26,
    right: [[0, 0, 0], [0.3, -1.9, 0.1], [0.6, -1.4, 0.15], [1, 0, 0]],
    left: [[0, 0, 0], [0.3, -0.6, 0], [0.6, -0.4, 0], [1, 0, 0]],
    lean: [[0, 0], [0.3, 0.05], [0.6, 0.12], [1, 0]],
    dip: [[0, 0], [0.3, 0.02], [0.6, -0.02], [1, 0]],
  },
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
const WINDUP_PHASE: Record<ShotKind, number> = { pass: 0.25, spike: 0.3, drop: 0.3 };

/** Where a player is in a dive: lunging forward, or down and getting back up. */
export interface DiveView {
  lunging: boolean;
  // 0..1 through the current part (lunge or recovery).
  progress: number;
}

// Serving: the server turns this many times further than their real aim
// angle (so a small aim change is visible) and leans sideways into it.
const SERVE_AIM_EXAGGERATION = 1.5;
const SERVE_AIM_LEAN = 0.25;
// Shoulder to the center of a ball held in the paw (m, at size 1); the arm
// stretches a little, cartoon style, when the ball is further than this.
const HOLD_REACH = 0.33;
// Arms hang straight down from the shoulder at rest.
const HANG = new Vector3(0, -1, 0);
// Spin (serves and spikes): while charging, the hitting arm cocks out to one
// side (radians at full spin) and the body twists with it; on release the arm
// sweeps hard across to the other side, the direction the ball will curve.
const SPIN_ARM = 1.5;
const SPIN_TWIST = 0.55;

// Dive pose: how far the body pitches forward (radians) at full stretch.
const DIVE_PITCH = 1.3;

export interface ChargeView {
  kind: ShotKind;
  power: number;
}

/**
 * A cartoon character (see roster.ts) in a team jersey, with arm/leg/tail
 * swings and bouncy squash-and-stretch driven by the player's sim state.
 * Purely visual: reach and hit timing are set by tuning, not by this model.
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
  private heldPhase: { kind: ShotKind; phase: number } | null = null;
  private landTimer = 0;
  private wasGrounded = true;
  private readonly spinners: Spinner[];
  private gait: Gait = 'walk';
  private readonly wobblers: Wobbler[];
  // Seconds since creation, for parts that sway on their own.
  private time = 0;

  constructor(scene: Scene, teamColor: Color3, kind: CharacterKind, jerseyNumber: number) {
    this.root = new TransformNode('player', scene);
    // Everything that squashes, leans and dips hangs off `bounce`.
    this.bounce = new TransformNode('bounce', scene);
    this.bounce.parent = this.root;
    const head = new TransformNode('head', scene);
    head.parent = this.bounce;
    head.position.y = HEAD_Y;
    head.scaling.setAll(HEAD_SCALE);
    // The tail's pivot sways while running.
    this.tail = new TransformNode('tail', scene);
    this.tail.parent = this.bounce;
    this.tail.position.set(0, 0.26, -0.17);
    // Limbs pivot at the shoulder / hip, so rotating the pivot swings the limb.
    this.arms = [-1, 1].map((side) => {
      const pivot = new TransformNode('shoulder', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      return pivot;
    });
    this.legs = [-1, 1].map((side) => {
      const pivot = new TransformNode('hip', scene);
      pivot.parent = this.bounce;
      pivot.position.set(side * 0.1, HIP_Y, 0);
      return pivot;
    });
    const rig = { scene, bounce: this.bounce, head, tail: this.tail, arms: this.arms, legs: this.legs, spinners: [] as Spinner[], gait: 'walk' as Gait, wobblers: [] as Wobbler[] };
    buildCharacter(rig, kind, teamColor, jerseyNumber);
    this.spinners = rig.spinners;
    this.wobblers = rig.wobblers;
    this.gait = rig.gait;
  }

  private opacity = 1;

  /** Fade the whole critter (1 = solid), e.g. when the camera is right behind it. */
  setOpacity(alpha: number): void {
    if (Math.abs(alpha - this.opacity) < 0.005) return;
    this.opacity = alpha;
    for (const mesh of this.root.getChildMeshes()) mesh.visibility = alpha;
  }

  // The spin of a hit being swung right now (the arm sweeps across).
  private spinSweep: number | null = null;

  /**
   * Play the pass or spike animation; call whenever this player swings. With
   * spin, the hitting arm also sweeps across in the spin direction.
   */
  playSwing(kind: ShotKind, spin = 0): void {
    this.spinSweep = spin !== 0 ? spin : null;
    const anim = SWING_ANIMS[kind];
    const startPhase = this.heldPhase?.kind === kind ? this.heldPhase.phase : 0;
    this.swing = { anim, time: startPhase * anim.duration };
    this.heldPhase = null;
  }

  update(
    p: Player,
    x: number,
    y: number,
    z: number,
    size: number,
    dt: number,
    charge: ChargeView | null,
    dive: DiveView | null,
    faceNet = false,
    serveAim?: { x: number; z: number },
    spin = 0,
    holdBall?: { x: number; y: number; z: number },
  ): void {
    this.root.position.set(x, y, z);
    this.root.scaling.setAll(size);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0.5) this.facing = Math.atan2(p.vel.x, p.vel.z);
    // Standing still while getting ready to serve: face the net.
    else if (faceNet) this.facing = Math.atan2(-x, -z);
    // Serving: turn toward the aim, exaggerated so it's readable, and lean into it.
    let aimTurn = 0;
    if (serveAim) {
      const toNet = Math.atan2(-x, -z);
      const toAim = Math.atan2(serveAim.x - x, serveAim.z - z);
      let delta = toAim - toNet;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      aimTurn = clamp(delta * SERVE_AIM_EXAGGERATION, -0.7, 0.7);
      this.facing = toNet + aimTurn;
    }
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
      if (phase >= 1) {
        this.swing = null;
        this.spinSweep = null;
      }
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
    const breathe = Math.sin(this.walkPhase * 0.4) * 0.015;
    // How the body moves with each step, by gait:
    // walk: a springy hop every step. waddle: short steps, rocking side to
    // side. hop: no legs, big bounces (one per two steps) with squash on
    // landing. four: a steady four-legged walk, the body level.
    let hop = Math.abs(Math.cos(this.walkPhase)) * run * 0.08;
    let rock = 0;
    let lean = run * 0.15;
    if (this.gait === 'waddle') {
      hop *= 0.5;
      rock = Math.sin(this.walkPhase) * (0.04 + run * 0.22);
    } else if (this.gait === 'hop') {
      const bounce = Math.sin(this.walkPhase * 0.5);
      hop = Math.abs(bounce) * run * 0.22;
      stretch += run * (Math.abs(bounce) < 0.25 ? -0.12 : 0.06);
      lean = run * 0.25;
    } else if (this.gait === 'four') {
      hop *= 0.3;
      lean = 0;
    } else if (this.gait === 'glide') {
      hop = 0;
      lean = run * 0.1;
    }

    this.bounce.position.y = hop + (anim ? sampleValue(anim.dip, phase) : 0);
    this.bounce.rotation.x = (anim ? sampleValue(anim.lean, phase) : 0) + lean;
    this.bounce.rotation.z = -aimTurn * SERVE_AIM_LEAN + rock;
    this.bounce.scaling.set(1 - stretch * 0.5, 1 + stretch + breathe, 1 - stretch * 0.5);

    // Tail swishes side to side while running (hard, for a hopping shark), lifts when airborne.
    const wag = this.gait === 'hop' ? 0.35 + run * 0.6 : 0.15 + run * 0.35;
    this.tail.rotation.y = Math.sin(this.walkPhase * (this.gait === 'hop' ? 1.2 : 0.5)) * wag;
    for (const s of this.spinners) s.node.rotation[s.axis] += (s.idle + run * s.run) * dt;
    this.time += dt;
    for (const w of this.wobblers) w.node.rotation[w.axis] = Math.sin(this.time * w.freq + w.phase) * (w.amp + run * w.run);
    this.tail.rotation.x = p.grounded ? -run * 0.25 : clamp(-p.vel.y * 0.06, -0.3, 0.35);

    // Running: legs swing opposite each other and arms opposite the legs.
    // Airborne: one knee tucks and the arms lift out for balance.
    // Four legs (front left, front right, back left, back right) move in
    // diagonal pairs. Waddlers take short steps.
    const reach = this.gait === 'waddle' ? 0.4 : 0.9;
    this.legs.forEach((leg, i) => {
      const opposite = i === 0 || i === 3 ? 1 : -1;
      leg.rotation.x = p.grounded ? opposite * stride * run * reach : i === 0 ? -0.6 : -0.2;
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

    // Spin, read from the arm: cocked away from the spin while charging, then
    // swept across through the hit. Positive = cocked to the hitter's left.
    let cock = 0;
    if (this.spinSweep !== null) {
      const u = clamp((phase - 0.3) / 0.35, 0, 1);
      cock = this.spinSweep * (1 - 2 * u * u * (3 - 2 * u));
    } else if (charge) {
      cock = spin;
    }
    if (cock !== 0) {
      this.arms[1].rotation.z += cock * SPIN_ARM;
      this.root.rotation.y -= cock * SPIN_TWIST;
    }

    this.holdBall(holdBall);

    if (dive) this.applyDivePose(dive, anim !== undefined);
  }

  /** Reach the off (left) paw to a ball held out before serving (world position), or let go. */
  private holdBall(at?: { x: number; y: number; z: number }): void {
    const arm = this.arms[0];
    if (!at) {
      arm.rotationQuaternion = null;
      arm.scaling.y = 1;
      return;
    }
    // The arm's parent is usually the body, but may hang off a moving part
    // (e.g. a flailing tube), so update the whole chain above it first.
    const chain: TransformNode[] = [];
    for (let n = arm.parent as TransformNode | null; n; n = n.parent as TransformNode | null) chain.unshift(n);
    for (const n of chain) n.computeWorldMatrix(true);
    const parent = arm.parent as TransformNode;
    const toParent = Matrix.Invert(parent.getWorldMatrix());
    const reach = Vector3.TransformCoordinates(new Vector3(at.x, at.y, at.z), toParent).subtractInPlace(arm.position);
    const length = reach.length();
    if (length < 1e-4) return;
    arm.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
      HANG,
      reach.scaleInPlace(1 / length),
      arm.rotationQuaternion ?? new Quaternion(),
    );
    arm.scaling.y = clamp(length / HOLD_REACH, 0.7, 1.5);
  }

  /** Stretch out flat in the lunge, lie there, then push back up. Overrides the normal pose. */
  private applyDivePose(dive: DiveView, swinging: boolean): void {
    let stretch: number;
    let lift = 0;
    if (dive.lunging) {
      stretch = clamp(dive.progress / 0.4, 0, 1);
      // A small hop off the ground at the start of the lunge.
      lift = Math.sin(dive.progress * Math.PI) * 0.15;
    } else {
      // Lie flat for the first 60% of recovery, then get up.
      stretch = 1 - clamp((dive.progress - 0.6) / 0.4, 0, 1);
    }
    const eased = stretch * stretch * (3 - 2 * stretch);
    this.bounce.rotation.x = eased * DIVE_PITCH;
    this.bounce.position.y = lift;
    this.bounce.scaling.setAll(1);
    this.tail.rotation.x = -0.7 * eased;
    // Legs trail behind; arms reach out ahead (unless mid-swing).
    this.legs.forEach((leg) => (leg.rotation.x = 0.35 * eased));
    if (!swinging) {
      this.arms.forEach((arm, i) => {
        arm.rotation.x = -2.9 * eased;
        arm.rotation.z = (i === 0 ? -1 : 1) * 0.15 * eased;
      });
    }
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
