import { describe, expect, it } from 'vitest';
import { frame, isInView, type FramingParams } from './cameraFraming';

const params: FramingParams = {
  pitch: (36 * Math.PI) / 180,
  fovY: 0.75,
  aspect: 16 / 9,
  margin: 0.85,
  minDistance: 12,
  maxDistance: 26,
};

describe('camera framing', () => {
  it('keeps every point on screen, including a ball flying toward the camera', () => {
    const points = [
      { x: -1.8, y: 0, z: -1.8 },
      { x: -1.8, y: 1.3, z: -1.8 },
      { x: 1.8, y: 0, z: 1.8 },
      { x: 0, y: 0.3, z: 0 },
      // A spike's landing spot well behind the near player.
      { x: -0.5, y: 0, z: -6.5 },
      { x: -0.4, y: 2.2, z: -4 },
    ];
    const f = frame(points, params);
    for (const pt of points) expect(isInView(pt, f, params)).toBe(true);
  });

  it('sits close when the action is tight and pulls back when it spreads out', () => {
    const tight = frame([{ x: 0, y: 0.3, z: 0 }, { x: -1, y: 0, z: -1.5 }], params);
    const spread = frame([{ x: 0, y: 0.3, z: 0 }, { x: -6, y: 0, z: -7 }, { x: 5, y: 0, z: 6 }], params);
    expect(tight.distance).toBe(params.minDistance);
    expect(spread.distance).toBeGreaterThan(tight.distance);
  });

  it('never goes past the maximum distance', () => {
    const f = frame([{ x: -40, y: 0, z: -40 }, { x: 40, y: 0, z: 40 }], params);
    expect(f.distance).toBe(params.maxDistance);
  });
});
