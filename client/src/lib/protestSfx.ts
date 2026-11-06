/**
 * Town Hall protest crowd noise bursts — built-in WebAudio synthesis only (no recorded clips, no external paid audio).
 * Pattern mirrors fishingSfx: one AudioContext + master gain, voice cap, cooldown, dispose on scene unmount.
 * Loudness multiplies shared getVolume()/isMuted(); callers also pass distance attenuation + reduced-motion gate.
 */
import { getVolume, isMuted } from './sounds';

export const PROTEST_MASTER = 0.28;
export const PROTEST_MAX_VOICES = 3;
export const PROTEST_CHANT_COOLDOWN_MS = 2800;
export const PROTEST_SHOUT_COOLDOWN_MS = 900;
/** Beyond this world-unit distance from City Hall, chants are silent. */
export const PROTEST_AUDIO_MAX_DIST = 48;

type Ctor = new () => AudioContext;

export interface ProtestSfx {
  /** Short synthesized crowd noise burst (not speech / not recorded chant). `dist` = camera distance to City Hall. */
  chant(dist: number, big?: boolean): void;
  shout(dist: number): void;
  stopAll(): void;
  dispose(): void;
  readonly voices: number;
  /** Test seam: last computed linear gain (0 if gated). */
  readonly lastGain: number;
}

function falloff(dist: number): number {
  if (!(dist >= 0) || dist >= PROTEST_AUDIO_MAX_DIST) return 0;
  const t = 1 - dist / PROTEST_AUDIO_MAX_DIST;
  return t * t;
}

export function makeProtestSfx(Ctx?: Ctor, now: () => number = () => performance.now()): ProtestSfx {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let dead = false;
  let lastGain = 0;
  const live = new Set<AudioScheduledSourceNode>();
  const last = new Map<string, number>();

  const ctx = () => {
    if (dead) return null;
    if (!ac) {
      const C = Ctx ?? ((globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }).AudioContext
        ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);
      if (!C) return null;
      ac = new C();
      master = ac.createGain();
      master.gain.value = PROTEST_MASTER;
      master.connect(ac.destination);
    }
    // Browser gesture gate: resume when suspended (same pattern as fishingSfx / unlockSounds).
    if (ac.state === 'suspended') void ac.resume?.().catch(() => {});
    return ac;
  };

  const gate = (key: string, ms: number) => {
    const t = now();
    const p = last.get(key);
    if (p !== undefined && t - p < ms) return false;
    if (live.size >= PROTEST_MAX_VOICES) return false;
    last.set(key, t);
    return true;
  };

  const track = (src: AudioScheduledSourceNode, nodes: AudioNode[]) => {
    live.add(src);
    src.onended = () => {
      live.delete(src);
      for (const n of [src, ...nodes]) {
        try { n.disconnect(); } catch { /* already */ }
      }
    };
  };

  const effective = (dist: number) => {
    if (dead || isMuted()) { lastGain = 0; return 0; }
    const g = getVolume() * falloff(dist);
    lastGain = g;
    return g;
  };

  /** Filtered noise puff — reads as a distant crowd blurt. */
  const noiseShout = (dur: number, vol: number, cutoff: number) => {
    const c = ctx(); if (!c || !master || vol <= 0.0001) return;
    const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 1.6;
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = cutoff; f.Q.value = 0.9;
    const g = c.createGain();
    const t0 = c.currentTime;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    track(s, [f, g]); s.start(t0); s.stop(t0 + dur);
  };

  /** A few stacked short tones ≈ a shouty vowel under the noise. */
  const toneStack = (vol: number, big: boolean) => {
    const c = ctx(); if (!c || !master || vol <= 0.0001) return;
    const t0 = c.currentTime;
    const freqs = big ? [220, 277, 330] : [260, 310];
    for (const freq of freqs) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      const g = c.createGain();
      o.frequency.setValueAtTime(freq, t0);
      o.frequency.exponentialRampToValueAtTime(freq * 0.92, t0 + 0.22);
      g.gain.setValueAtTime(vol * 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(g); g.connect(master);
      track(o, [g]); o.start(t0); o.stop(t0 + 0.3);
    }
  };

  const stopAll = () => {
    for (const s of [...live]) {
      try { s.stop(); } catch { /* */ }
      s.onended?.(new Event('ended'));
    }
    live.clear();
  };

  const play = (key: string, ms: number, dist: number, fn: (g: number) => void) => {
    if (dead) return;
    const g = effective(dist);
    if (g <= 0) return; // mute / zero volume / out of range — do not burn cooldown
    if (!gate(key, ms)) return;
    try { fn(g); } catch { /* no audio */ }
  };

  return {
    chant: (dist, big = false) => play('chant', PROTEST_CHANT_COOLDOWN_MS, dist, (g) => {
      noiseShout(big ? 0.45 : 0.32, 0.55 * g, big ? 900 : 1200);
      toneStack(g, big);
    }),
    shout: (dist) => play('shout', PROTEST_SHOUT_COOLDOWN_MS, dist, (g) => {
      noiseShout(0.18, 0.35 * g, 1600);
    }),
    stopAll,
    dispose: () => {
      stopAll();
      dead = true;
      try { master?.disconnect(); } catch { /* */ }
      void ac?.close?.().catch(() => {});
      ac = null; master = null;
    },
    get voices() { return live.size; },
    get lastGain() { return lastGain; },
  };
}
