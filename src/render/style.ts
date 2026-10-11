// Look switches read from the URL (visual only).
//
// `?smooth`: smooth-shaded characters and props (rounded, soft sheen, a
// gentle rim light) instead of the default low-poly faceted look.

import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

export const SMOOTH = typeof location !== 'undefined' && new URLSearchParams(location.search).has('smooth');

// Smooth look: how finely curved shapes are tessellated, and the rim light's
// strength and sharpness (higher power = thinner rim).
export const SMOOTH_SEGMENTS = 28;
const RIM_STRENGTH = 0.28;
const RIM_POWER = 2.6;

/** Give a material the smooth look's soft rim light (a glow at grazing angles). */
export function addRim(m: StandardMaterial): void {
  m.emissiveFresnelParameters = new FresnelParameters({
    leftColor: new Color3(RIM_STRENGTH, RIM_STRENGTH, RIM_STRENGTH),
    rightColor: new Color3(0, 0, 0),
    power: RIM_POWER,
    bias: 0.05,
  });
}
