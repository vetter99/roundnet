// Sound effects synthesized with the Web Audio API, so there are no audio
// files to load. Each sound is a few oscillators / filtered noise bursts
// shaped by quick gain envelopes, tuned by the hit's power and quality.
//
// Browsers only allow audio after a click or key press on the page, so the
// context starts suspended and `unlock()` resumes it on the first one.

import type { ShotKind } from '../sim/player';

export class Sfx {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly noise: AudioBuffer | null;
  // Background music, on its own volume under the master volume.
  private readonly musicBus: GainNode | null;
  private musicStarted = false;
  muted = false;

  constructor() {
    const Ctx = typeof window !== 'undefined' ? window.AudioContext : undefined;
    this.ctx = Ctx ? new Ctx() : null;
    if (!this.ctx) {
      this.master = null;
      this.noise = null;
      this.musicBus = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    // One second of white noise, reused for every noisy sound.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    window.addEventListener('keydown', () => this.unlock());
    window.addEventListener('pointerdown', () => this.unlock());
  }

  /** Try to start audio. Works after a click or key press (controller buttons may not count). */
  unlock(): void {
    if (this.locked) void this.ctx?.resume();
  }

  /** True until the player has clicked or pressed a key (browser autoplay rule). */
  get locked(): boolean {
    return this.ctx?.state === 'suspended';
  }

  setVolume(volume: number, music: number): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : volume;
    if (this.musicBus) this.musicBus.gain.value = music;
  }

  /** Load a music file and loop it forever on the music bus (starts once). */
  async playMusic(url: string): Promise<void> {
    if (!this.ctx || !this.musicBus || this.musicStarted) return;
    this.musicStarted = true;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.musicBus);
      src.start();
    } catch (err) {
      // The game works fine without music.
      console.warn('Music failed to load', err);
    }
  }

  /**
   * The ball is struck, cartoon style: a big thwack for spikes, a bouncy pop
   * for passes. Every hit is clearly audible; power adds weight and
   * brightness rather than deciding whether you hear it. The CPU's hits play
   * quieter (`mine` = false) so your own stand out.
   */
  hit(kind: ShotKind, power: number, quality: number, mine: boolean): void {
    const loud = (0.8 + 0.2 * power) * (mine ? 1 : 0.6);
    if (kind === 'drop') {
      // A light, soft "tup": a gentle touch, not a smack.
      this.tone({ type: 'sine', from: 520, to: 360, gain: 0.35 * loud, decay: 0.06 });
      this.noiseBurst({ freq: 1200, q: 1.2, gain: 0.12 * loud, attack: 0.001, decay: 0.025 });
    } else if (kind === 'spike') {
      // Sharp click, a slap of noise, and a falling "thwack" body.
      this.noiseBurst({ freq: 2600 + power * 1400, q: 0.9, gain: 0.5 * loud, attack: 0.001, decay: 0.035 });
      this.noiseBurst({ freq: 900, freqTo: 400, q: 0.7, gain: 0.45 * loud, attack: 0.002, decay: 0.09 });
      this.tone({ type: 'triangle', from: 330 + power * 120, to: 85, gain: 0.55 * loud, decay: 0.14 });
    } else {
      // A rubbery "pop": a quick upward blip and a soft body.
      this.tone({ type: 'sine', from: 420, to: 780 + power * 200, gain: 0.45 * loud, decay: 0.07 });
      this.tone({ type: 'triangle', from: 260, to: 200, gain: 0.3 * loud, decay: 0.09 });
      this.noiseBurst({ freq: 1500, q: 1, gain: 0.18 * loud, attack: 0.001, decay: 0.03 });
    }
    // Mistimed hits get a dull clunk on top.
    if (quality < 0.6) this.tone({ type: 'square', from: 140, to: 110, gain: 0.1 * loud, decay: 0.08 });
  }

  /**
   * A perfectly timed hit: a coin-style two-note "ding" (a fourth apart).
   * For your own hits it's bright and full, and rises a semitone with each
   * consecutive perfect (`streak` 0, 1, 2...); the CPU gets a softer version.
   */
  perfect(mine: boolean, streak = 0): void {
    const base = 988 * Math.pow(2, Math.min(streak, 7) / 12);
    const gain = mine ? 0.2 : 0.07;
    this.tone({ type: 'square', from: base, to: base, gain, decay: 0.07, delay: 0.015 });
    this.tone({ type: 'square', from: base * 4 / 3, to: base * 4 / 3, gain, decay: 0.32, delay: 0.085 });
    if (mine) this.tone({ type: 'sine', from: base * 2, to: base * 2, gain: 0.08, decay: 0.3, delay: 0.085 });
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
    this.noiseBurst({ freq: 700, freqTo: 2400, q: 1.2, gain: 0.25 + 0.2 * power, attack: 0.03, decay: 0.12 });
  }

  /** Landing on the grass at the end of a dive: a soft body thud and a scuff. */
  diveLand(): void {
    this.tone({ type: 'sine', from: 120, to: 55, gain: 0.4, decay: 0.14 });
    this.noiseBurst({ freq: 600, freqTo: 250, q: 0.6, gain: 0.25, attack: 0.005, decay: 0.18 });
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
