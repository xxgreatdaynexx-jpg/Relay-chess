const HUH_URL = '/sounds/huh.mp3';
const FORK_URL = '/sounds/fork.mp3';
const QUEEN_DEATH_URL = '/sounds/queen-death.mp3';
const QUEEN_CAPTURE_URL = '/sounds/queen-capture.mp3';
const DOUBLE_URL = '/sounds/double.mp3';
const STREAK_URL = '/sounds/streak.mp3';
const MATE_IN_ONE_URL = '/sounds/mate-in-one.mp3';

let context: AudioContext | null = null;
let masterGain: GainNode | null = null;

const VOLUME_KEY = 'relay-chess-volume';
const MUTED_KEY = 'relay-chess-muted';
const DEFAULT_VOLUME = 0.4;
let volume = readVolume();
let muted = readMuted();
const listeners = new Set<() => void>();

function readVolume(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(VOLUME_KEY) : null;
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function effectiveVolume(): number {
  return muted ? 0 : volume;
}

function applyVolume(): void {
  if (masterGain && context) masterGain.gain.setValueAtTime(effectiveVolume(), context.currentTime);
  listeners.forEach((fn) => fn());
}

export function getVolume(): number {
  return volume;
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (volume > 0 && muted) muted = false;
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  applyVolume();
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  applyVolume();
}

export function subscribeVolume(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every sound goes through this one master gain so the volume slider covers all of them. */
function output(ctx: AudioContext): AudioNode {
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = effectiveVolume();
    masterGain.connect(ctx.destination);
  }
  return masterGain;
}

interface Clip {
  buffer: AudioBuffer | null;
  pending: Promise<AudioBuffer | null> | null;
}

const huhClip: Clip = { buffer: null, pending: null };
const forkClip: Clip = { buffer: null, pending: null };
const queenDeathClip: Clip = { buffer: null, pending: null };
const queenCaptureClip: Clip = { buffer: null, pending: null };
const doubleClip: Clip = { buffer: null, pending: null };
const streakClip: Clip = { buffer: null, pending: null };
const mateInOneClip: Clip = { buffer: null, pending: null };

export function unlockSounds(): void {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume();
  if (!ctx) return;
  void loadClip(ctx, HUH_URL, huhClip);
  void loadClip(ctx, FORK_URL, forkClip);
  void loadClip(ctx, QUEEN_DEATH_URL, queenDeathClip);
  void loadClip(ctx, QUEEN_CAPTURE_URL, queenCaptureClip);
  void loadClip(ctx, DOUBLE_URL, doubleClip);
  void loadClip(ctx, STREAK_URL, streakClip);
  void loadClip(ctx, MATE_IN_ONE_URL, mateInOneClip);
}

/** Dayne's recording for when a queen is captured. The synth boom plays only if that file cannot be loaded. */
export function playBoom(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, QUEEN_DEATH_URL, queenDeathClip).then((buffer) => {
    if (!buffer || !playBuffer(buffer)) playBoomSynth();
  });
}

function playBoomSynth(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBurst(ctx, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1600, now);
  filter.frequency.exponentialRampToValueAtTime(140, now + 0.42);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.65, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(output(ctx));
  noise.start(now);
  noise.stop(now + 0.48);

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, now);
  thud.frequency.exponentialRampToValueAtTime(38, now + 0.3);
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.45, now + 0.012);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  thud.connect(thudGain);
  thudGain.connect(output(ctx));
  thud.start(now);
  thud.stop(now + 0.36);
}

/** Owner's recorded huh. The synthesized sweep plays only if that file cannot be loaded. */
export function playHuh(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, HUH_URL, huhClip).then((buffer) => {
    if (!buffer || !playBuffer(buffer)) playHuhSynth();
  });
}

export function playFork(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, FORK_URL, forkClip).then((buffer) => {
    if (buffer) playBuffer(buffer);
  });
}

/** Dayne's recording for when a queen captures another piece. Same output path as the other clips. */
export function playQueenCapture(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, QUEEN_CAPTURE_URL, queenCaptureClip).then((buffer) => {
    if (buffer) playBuffer(buffer);
  });
}

/** Dayne's double recording. Same output path as the other clips, with no synth stand-in. */
export function playDouble(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, DOUBLE_URL, doubleClip).then((buffer) => {
    if (buffer) playBuffer(buffer);
  });
}

/** Dayne's mate-in-one recording. Same output path as the other clips, with no synth stand-in. */
export function playMateInOne(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, MATE_IN_ONE_URL, mateInOneClip).then((buffer) => {
    if (buffer) playBuffer(buffer);
  });
}

/** Dayne's streak recording. Same output path as the other clips, with no synth stand-in. */
export function playStreak(): void {
  const ctx = audio();
  if (!ctx) return;
  void loadClip(ctx, STREAK_URL, streakClip).then((buffer) => {
    if (buffer) playBuffer(buffer);
  });
}

function playHuhSynth(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(145, now);
  osc.frequency.linearRampToValueAtTime(200, now + 0.07);
  osc.frequency.exponentialRampToValueAtTime(560, now + 0.5);
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(640, now);
  filter.frequency.exponentialRampToValueAtTime(1900, now + 0.5);
  filter.Q.value = 5;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.03);
  gain.gain.setValueAtTime(0.16, now + 0.26);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(output(ctx));
  osc.start(now);
  osc.stop(now + 0.64);
}

function loadClip(ctx: AudioContext, url: string, clip: Clip): Promise<AudioBuffer | null> {
  if (clip.buffer) return Promise.resolve(clip.buffer);
  if (!clip.pending) {
    clip.pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${url} missing`);
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
      .then((buffer) => {
        clip.buffer = buffer;
        return buffer;
      })
      .catch(() => null);
  }
  return clip.pending;
}

function playBuffer(buffer: AudioBuffer): boolean {
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state === 'suspended') void ctx.resume();
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(output(ctx));
    source.start();
    return true;
  } catch {
    return false;
  }
}

export function playNice(): void {
  if (effectiveVolume() <= 0) return;
  if (speak('nice', 0.4, 0.82)) return;
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, 196, now, 0.16, 0.2);
  tone(ctx, 247, now + 0.14, 0.22, 0.16);
}

function speak(text: string, pitch: number, rate: number): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return false;
  }
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.pitch = pitch;
    utter.rate = rate;
    utter.volume = effectiveVolume();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!context) context = new Ctx();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function noiseBurst(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function tone(ctx: AudioContext, frequency: number, when: number, duration: number, level: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(level, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(output(ctx));
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

/** Short square-wave beep-beep for 10 seconds left on your side's clock. Routed through the master volume. */
export function playTimeAlarm(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  for (const offset of [0, 0.18]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1320, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.01);
    gain.gain.setValueAtTime(0.18, now + offset + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
    osc.connect(gain);
    gain.connect(output(ctx));
    osc.start(now + offset);
    osc.stop(now + offset + 0.15);
  }
}

/** Soft two-note chime when it becomes your move. Routed through the master volume. */
export function playYourTurn(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  tone(ctx, 880, now, 0.18, 0.14);
  tone(ctx, 1318.5, now + 0.11, 0.32, 0.12);
}

/** Tiny soft click for solitaire card moves. Routed through the master volume. */
export function playCardFlick(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  tone(ctx, 2200, ctx.currentTime, 0.05, 0.05);
}

/** Little arpeggio for winning solitaire. Routed through the master volume. */
export function playSolitaireWin(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ctx, f, now + i * 0.12, 0.35, 0.12));
}

function arenaNoise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Arena: short cartoon "pew" plus a puff of noise. Routed through the shared master volume. */
export function playGunshot(volume = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18 * volume, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(g);
  g.connect(output(ctx));
  osc.start(now);
  osc.stop(now + 0.15);
  const n = arenaNoise(ctx, 0.08);
  const ng = ctx.createGain();
  ng.gain.value = 0.25 * volume;
  n.connect(ng);
  ng.connect(output(ctx));
  n.start(now);
}

/** Arena: a bonk when a shot lands (or you get tagged). */
export function playHit(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(260, now + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.3, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  osc.connect(g);
  g.connect(output(ctx));
  osc.start(now);
  osc.stop(now + 0.13);
}

/** Roulette: ball rattling around the wheel, slowing down. Routed through the master volume. */
export function playRouletteSpin(seconds = 5): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  let t = 0;
  let gap = 0.05;
  while (t < seconds - 0.3) {
    tone(ctx, 3000 + Math.random() * 600, now + t, 0.02, 0.03);
    t += gap;
    gap *= 1.045;
  }
}

/** Roulette: the ball drops into a pocket. */
export function playBallLand(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  tone(ctx, 1800, now, 0.04, 0.08);
  tone(ctx, 1500, now + 0.08, 0.04, 0.05);
  tone(ctx, 1300, now + 0.15, 0.05, 0.03);
}

/** Arena: per-weapon shot. Pitch and noise vary so each gun sounds different; all through the master volume. */
export function playWeaponShot(weapon: string, volume = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const cfg: Record<string, { f0: number; f1: number; len: number; noise: number; type: OscillatorType }> = {
    pistol: { f0: 880, f1: 110, len: 0.14, noise: 0.25, type: 'square' },
    smg: { f0: 1200, f1: 300, len: 0.07, noise: 0.18, type: 'square' },
    shotgun: { f0: 300, f1: 60, len: 0.22, noise: 0.5, type: 'sawtooth' },
    sniper: { f0: 1800, f1: 90, len: 0.3, noise: 0.35, type: 'sawtooth' },
    rocket: { f0: 160, f1: 520, len: 0.35, noise: 0.3, type: 'triangle' },
  };
  const c = cfg[weapon] ?? cfg.pistol;
  const osc = ctx.createOscillator();
  osc.type = c.type;
  osc.frequency.setValueAtTime(c.f0, now);
  osc.frequency.exponentialRampToValueAtTime(c.f1, now + c.len * 0.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.16 * volume, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + c.len);
  osc.connect(g);
  g.connect(output(ctx));
  osc.start(now);
  osc.stop(now + c.len + 0.01);
  const n = arenaNoise(ctx, Math.min(0.3, c.len));
  const ng = ctx.createGain();
  ng.gain.value = c.noise * volume;
  n.connect(ng);
  ng.connect(output(ctx));
  n.start(now);
}

/** Arena: cartoon explosion (rockets, pie strikes, the nuke). */
export function playExplosion(volume = 1, long = false): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const len = long ? 2.2 : 0.7;
  const n = arenaNoise(ctx, len);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1600, now);
  lp.frequency.exponentialRampToValueAtTime(120, now + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.7 * volume, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + len);
  n.connect(lp);
  lp.connect(g);
  g.connect(output(ctx));
  n.start(now);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + len);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5 * volume, now);
  og.gain.exponentialRampToValueAtTime(0.0001, now + len);
  osc.connect(og);
  og.connect(output(ctx));
  osc.start(now);
  osc.stop(now + len);
}

/** Arena: announcer sting for a killstreak (rising arpeggio). Alarm variant for the nuke. */
export function playStreakCall(kind: 'reward' | 'alarm' = 'reward'): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = kind === 'alarm' ? [880, 660, 880, 660, 880, 660] : [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    const t = now + i * (kind === 'alarm' ? 0.22 : 0.09);
    const osc = ctx.createOscillator();
    osc.type = kind === 'alarm' ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g);
    g.connect(output(ctx));
    osc.start(t);
    osc.stop(t + 0.2);
  });
}
