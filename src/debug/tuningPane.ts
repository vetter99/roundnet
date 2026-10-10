import { Pane } from 'tweakpane';
import { DEFAULT_TUNING, type Tuning } from '../config/tuning';

type Ranges = Record<string, [min: number, max: number, step?: number]>;

// Slider ranges for each tuning group (a dotted name like 'player.dive' is a
// nested group). Anything not listed gets no slider.
const RANGES: Record<string, Ranges> = {
  root: { gravity: [5, 30] },
  ball: { radius: [0.05, 0.3], airDrag: [0, 0.5] },
  net: {
    radius: [0.3, 1.2], frameWidth: [0.02, 0.15], height: [0.1, 0.5], bounce: [0.3, 1.2],
    horizontalKeep: [0.3, 1.2], minUpSpeed: [0, 8],
  },
  player: {
    size: [0.5, 1.6], maxSpeed: [2, 12], accel: [5, 100], decel: [5, 100], airControl: [0, 1], jumpSpeed: [2, 10],
    contactHeight: [0.5, 2.5], reach: [0.3, 2], lowReach: [0, 2.5], highReach: [0, 1.5],
  },
  hit: {
    spikeSpeedMin: [4, 25], spikeSpeedMax: [4, 30], chargeTime: [0.1, 2], chargeMoveFactor: [0, 1], minQualityPower: [0, 1], mishitDrift: [0, 3],
    perfectWindow: [0, 0.6], qualityFalloff: [0.1, 2], passUpSpeedMin: [2, 15], passUpSpeedMax: [2, 18], passHorizontalSpeed: [0, 6],
    inputBufferTicks: [0, 20, 1], cooldownTicks: [0, 40, 1],
  },
  'player.dive': { speed: [2, 15], duration: [0.1, 0.8], recovery: [0, 1.5], reachOffset: [0, 1.5], reachBonus: [0, 1.5], highReach: [0, 2], contactHeight: [0.2, 1.5], powerScale: [0, 1] },
  court: { serveLineDistance: [1, 5] },
  marker: { maxRadius: [0.2, 2.5], targetRadius: [0.05, 1], approachTime: [0.2, 3] },
  practice: { resetDelayTicks: [0, 180, 1], feedDistance: [0.8, 4], feedHeight: [0.5, 4], feedSpeed: [2, 15] },
  audio: { volume: [0, 1], music: [0, 1] },
  camera: {
    pitchDeg: [10, 85], fov: [0.4, 1.3], minDistance: [4, 30], maxDistance: [8, 45], margin: [0.4, 1],
    zoomOutSpeed: [0.2, 15], zoomInSpeed: [0.2, 15], panSpeed: [0.2, 15],
  },
};

/** Live sliders for every tuning value. Toggle with the backtick (`) key. */
export function createTuningPane(t: Tuning): Pane {
  const pane = new Pane({ title: 'Tuning  ( ` to hide )' });
  pane.hidden = true;

  for (const [key, [min, max, step]] of Object.entries(RANGES.root)) {
    pane.addBinding(t, key as keyof Tuning, { min, max, step });
  }
  for (const [group, ranges] of Object.entries(RANGES)) {
    if (group === 'root') continue;
    const folder = pane.addFolder({ title: group, expanded: false });
    const target = group.split('.').reduce<Record<string, unknown>>(
      (obj, key) => obj[key] as Record<string, unknown>,
      t as unknown as Record<string, unknown>,
    );
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      folder.addBinding(target, key, { min, max, step });
    }
  }

  const misc = pane.addFolder({ title: 'display', expanded: true });
  misc.addBinding(t.marker, 'mode', { options: { 'Always show': 'always', 'Hide until off the net': 'hideUntilNet' } });
  misc.addBinding(t.debug, 'showReach', { label: 'reach ring' });

  pane.addButton({ title: 'Copy JSON (paste into tuning.ts)' }).on('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(t, null, 2));
  });
  pane.addButton({ title: 'Reset to defaults' }).on('click', () => {
    assignDeep(t as unknown as Record<string, unknown>, structuredClone(DEFAULT_TUNING) as Record<string, unknown>);
    pane.refresh();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') pane.hidden = !pane.hidden;
  });
  return pane;
}

/** Copy values into the existing (nested) objects so the sliders stay bound to them. */
function assignDeep(live: Record<string, unknown>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'object' && value !== null) assignDeep(live[key] as Record<string, unknown>, value as Record<string, unknown>);
    else live[key] = value;
  }
}
