// Smart framing for the broadcast camera: given the points that must stay on
// screen (players, ball, landing spot, net), find the closest camera that
// shows them all. The camera's angle never changes (it looks along +z, tilted
// down by `pitch`); only its position moves, so "up" on the stick always
// means the same direction on screen.
//
// Plain math with no Babylon imports, so it can be unit-tested.

import type { Vec3 } from '../sim/vec';

export interface FramingParams {
  // Downward tilt in radians.
  pitch: number;
  // Vertical field of view in radians, and screen width / height.
  fovY: number;
  aspect: number;
  // Fraction of the half-screen points may use (1 = right up to the edge).
  margin: number;
  minDistance: number;
  maxDistance: number;
}

export interface Framing {
  // The ground point the camera looks at, and how far back along its view it sits.
  center: Vec3;
  distance: number;
}

// The height the camera aims at above the center point.
const AIM_HEIGHT = 0.5;

/** Camera axes for a camera looking along +z, tilted down by `pitch`. */
function axes(pitch: number) {
  const s = Math.sin(pitch);
  const c = Math.cos(pitch);
  return {
    forward: { x: 0, y: -s, z: c },
    up: { x: 0, y: c, z: s },
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** The closest framing (within min/max distance) that keeps every point on screen. */
export function frame(points: readonly Vec3[], p: FramingParams): Framing {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z);
    maxZ = Math.max(maxZ, pt.z);
  }
  const center = points.length
    ? { x: (minX + maxX) / 2, y: AIM_HEIGHT, z: (minZ + maxZ) / 2 }
    : { x: 0, y: AIM_HEIGHT, z: 0 };

  const { forward, up } = axes(p.pitch);
  const tanV = Math.tan(p.fovY / 2) * p.margin;
  const tanH = tanV * p.aspect;
  let distance = p.minDistance;
  for (const pt of points) {
    const d = { x: pt.x - center.x, y: pt.y - center.y, z: pt.z - center.z };
    // A point at sideways offset r and vertical offset u (in camera space),
    // `ahead` meters in front of the center, fits once the camera is far
    // enough back that it lies inside the view cone.
    const ahead = dot(d, forward);
    const needed = Math.max(Math.abs(d.x) / tanH, Math.abs(dot(d, up)) / tanV) - ahead;
    distance = Math.max(distance, needed);
  }
  return { center, distance: Math.min(distance, p.maxDistance) };
}

/** Where the camera sits for a framing: back along its view direction from the center. */
export function cameraPosition(f: Framing, pitch: number): Vec3 {
  const { forward } = axes(pitch);
  return {
    x: f.center.x - forward.x * f.distance,
    y: f.center.y - forward.y * f.distance,
    z: f.center.z - forward.z * f.distance,
  };
}

/** Whether `pt` is inside the camera's view (with the margin) for a framing. Used by tests. */
export function isInView(pt: Vec3, f: Framing, p: FramingParams): boolean {
  const { forward, up } = axes(p.pitch);
  const cam = cameraPosition(f, p.pitch);
  const d = { x: pt.x - cam.x, y: pt.y - cam.y, z: pt.z - cam.z };
  const depth = dot(d, forward);
  if (depth <= 0) return false;
  const tanV = Math.tan(p.fovY / 2) * p.margin;
  const eps = 1e-9;
  return Math.abs(dot(d, up)) <= depth * tanV + eps && Math.abs(d.x) <= depth * tanV * p.aspect + eps;
}
