/**
 * Fishing dock sound kit (pt242u cleanup). One AudioContext behind one master gain; every one-shot voice is
 * disconnected when it ends (no leaked nodes), at most MAX_VOICES play at once, the same sound can't stack within
 * its cooldown (reel clicks are a gentle tick, not a buzz), stopAll() silences everything on cancel, and dispose()
 * closes the context when the dock closes. Sounds caused by OTHER anglers play at OTHER_VOL and are throttled harder.
 */
export const MASTER_VOL = 0.5;
export const OTHER_VOL = 0.2;
export const MAX_VOICES = 6;
export const COOLDOWN_MS: Record<string, number> = { splash: 150, plop: 200, click: 110, win: 600, whoosh: 300, other: 450 };
type Ctor = new () => AudioContext;
export interface FishingSfx {
  splash(big: boolean, other?: boolean): void; plop(): void; click(): void; win(): void; whoosh(): void;
  stopAll(): void; dispose(): void; readonly voices: number;
}

export function makeFishingSfx(Ctx?: Ctor, now: () => number = () => performance.now()): FishingSfx {
  let ac: AudioContext | null = null; let master: GainNode | null = null; let dead = false;
  const live = new Set<AudioScheduledSourceNode>(); const last = new Map<string, number>();
  const ctx = () => {
    if (dead) return null;
    if (!ac) {
      const C = Ctx ?? ((globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);
      if (!C) return null; ac = new C(); master = ac.createGain(); master.gain.value = MASTER_VOL; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') void ac.resume?.().catch(() => {});
    return ac;
  };
  const gate = (key: string) => { const t = now(); const p = last.get(key); if (p !== undefined && t - p < (COOLDOWN_MS[key] ?? 100)) return false; if (live.size >= MAX_VOICES) return false; last.set(key, t); return true; };
  const track = (src: AudioScheduledSourceNode, nodes: AudioNode[]) => {
    live.add(src);
    src.onended = () => { live.delete(src); for (const n of [src, ...nodes]) { try { n.disconnect(); } catch { /* already */ } } };
  };
  const noise = (dur: number, vol: number, f0: number) => {
    const c = ctx(); if (!c || !master) return;
    const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = f0;
    const g = c.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); track(s, [f, g]); s.start(); s.stop(c.currentTime + dur);
  };
  const tone = (f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine') => {
    const c = ctx(); if (!c || !master) return;
    const o = c.createOscillator(); o.type = type; const g = c.createGain(); const t = c.currentTime;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); track(o, [g]); o.start(t); o.stop(t + dur);
  };
  const safe = (key: string, fn: () => void) => { if (dead || !gate(key)) return; try { fn(); } catch { /* no audio */ } };
  const stopAll = () => { for (const s of [...live]) { try { s.stop(); } catch { /* */ } s.onended?.(new Event('ended')); } live.clear(); };
  return {
    splash: (big, other = false) => other
      ? safe('other', () => noise(big ? 0.45 : 0.25, (big ? 0.35 : 0.2) * OTHER_VOL, big ? 1500 : 2200))
      : safe('splash', () => noise(big ? 0.6 : 0.3, big ? 0.35 : 0.2, big ? 1800 : 2600)),
    plop: () => safe('plop', () => tone(500, 140, 0.18, 0.3)),
    click: () => safe('click', () => tone(1600, 1200, 0.025, 0.03, 'square')),
    win: () => safe('win', () => tone(523, 1046, 0.35, 0.18, 'triangle')),
    whoosh: () => safe('whoosh', () => noise(0.35, 0.12, 900)),
    stopAll,
    dispose: () => { stopAll(); dead = true; try { master?.disconnect(); } catch { /* */ } void ac?.close?.().catch(() => {}); ac = null; master = null; },
    get voices() { return live.size; },
  };
}
