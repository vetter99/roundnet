// Sound effects synthesized with the Web Audio API, so there are no audio
// files to load. Each sound is a few oscillators / filtered noise bursts
// shaped by quick gain envelopes, tuned by the hit's power and quality.
//
// Browsers only allow audio after a click or key press on the page, so the
// context starts suspended and `unlock()` resumes it on the first one.

import type { HitKind } from '../sim/player';

export class Sfx {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly noise: AudioBuffer | null;
  muted = false;

  constructor() {
    const Ctx = typeof window !== 'undefined' ? window.AudioContext : undefined;
    this.ctx = Ctx ? new Ctx() : null;
    if (!this.ctx) {
      this.master = null;
      this.noise = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // One second of white noise, reused for every noisy sound.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const unlock = () => void this.ctx?.resume();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  /** True until the player has clicked or pressed a key (browser autoplay rule). */
  get locked(): boolean {
    return this.ctx?.state === 'suspended';
  }

  setVolume(volume: number): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : volume;
  }

  /** The ball is struck: a punchy smack for spikes, a softer bump for passes. */
  hit(kind: HitKind, power: number, quality: number): void {
    const loud = 0.5 + 0.5 * power;
    if (kind === 'spike') {
      this.noiseBurst({ freq: 1600 + power * 1800, q: 1.2, gain: 0.55 * loud, attack: 0.002, decay: 0.07 });
      this.tone({ type: 'sine', from: 220 + power * 80, to: 90, gain: 0.5 * loud, decay: 0.12 });
    } else {
      this.tone({ type: 'triangle', from: 480 + power * 160, to: 380, gain: 0.35 * loud, decay: 0.1 });
      this.noiseBurst({ freq: 900, q: 0.8, gain: 0.2 * loud, attack: 0.002, decay: 0.05 });
    }
    // Mistimed hits sound duller: a low clunk on top.
    if (quality < 0.6) this.tone({ type: 'square', from: 140, to: 110, gain: 0.08, decay: 0.08 });
  }

  /** A perfectly timed hit: a quick bright two-note chime. */
  perfect(): void {
    this.tone({ type: 'sine', from: 1320, to: 1320, gain: 0.18, decay: 0.12, delay: 0.02 });
    this.tone({ type: 'sine', from: 1760, to: 1760, gain: 0.16, decay: 0.16, delay: 0.08 });
  }

  /** The ball hits the net: a springy trampoline "boing", louder for harder hits. */
  net(impactSpeed: number): void {
    const loud = Math.min(1, 0.35 + impactSpeed / 12);
    this.tone({ type: 'sine', from: 150, to: 70, gain: 0.55 * loud, decay: 0.22, vibrato: 18 });
    this.noiseBurst({ freq: 350, q: 0.7, gain: 0.25 * loud, attack: 0.003, decay: 0.09 });
  }

  /** The ball lands on the grass: a dull thud. */
  ground(): void {
    this.tone({ type: 'sine', from: 95, to: 45, gain: 0.45, decay: 0.16 });
    this.noiseBurst({ freq: 300, q: 0.5, gain: 0.25, attack: 0.002, decay: 0.08 });
  }

  /** A swing through the air (plays whether or not it connects). */
  swing(power: number): void {
    this.noiseBurst({ freq: 700, freqTo: 2400, q: 1.5, gain: 0.07 + 0.08 * power, attack: 0.03, decay: 0.12 });
  }

  /** A charge has reached full power. */
  chargeFull(): void {
    this.tone({ type: 'triangle', from: 990, to: 990, gain: 0.12, decay: 0.15 });
  }

  private tone(o: {
    type: OscillatorType;
    from: number;
    to: number;
    gain: number;
    decay: number;
    delay?: number;
    vibrato?: number;
  }): void {
    if (!this.ctx || !this.master || this.locked) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(o.to, 1), t0 + o.decay);
    if (o.vibrato) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = o.vibrato;
      depth.gain.value = o.from * 0.08;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.decay + 0.05);
    }
    const env = this.envelope(t0, o.gain, 0.003, o.decay);
    osc.connect(env);
    osc.start(t0);
    osc.stop(t0 + o.decay + 0.05);
  }

  private noiseBurst(o: { freq: number; freqTo?: number; q: number; gain: number; attack: number; decay: number }): void {
    if (!this.ctx || !this.master || !this.noise || this.locked) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = o.q;
    filter.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo) filter.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + o.attack + o.decay);
    const env = this.envelope(t0, o.gain, o.attack, o.decay);
    src.connect(filter).connect(env);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.attack + o.decay + 0.05);
  }

  /** A gain node that rises over `attack` then decays exponentially, wired to master. */
  private envelope(t0: number, peak: number, attack: number, decay: number): GainNode {
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    env.connect(this.master!);
    return env;
  }
}
