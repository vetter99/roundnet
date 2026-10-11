// The look of characters and props: smooth, rounded shapes with a soft sheen
// and a gentle rim light.

import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

// How finely curved shapes are tessellated, and the rim light's strength and
// sharpness (higher power = thinner rim).
export const SEGMENTS = 28;
const RIM_STRENGTH = 0.28;
const RIM_POWER = 2.6;

/** Give a material the soft rim light (a glow at grazing angles). */
export function addRim(m: StandardMaterial): void {
  m.emissiveFresnelParameters = new FresnelParameters({
    leftColor: new Color3(RIM_STRENGTH, RIM_STRENGTH, RIM_STRENGTH),
    rightColor: new Color3(0, 0, 0),
    power: RIM_POWER,
    bias: 0.05,
  });
}
