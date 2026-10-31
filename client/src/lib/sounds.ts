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
  if (boomMaster && context) boomMaster.gain.setValueAtTime(effectiveVolume(), context.currentTime);
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
    // Brick-wall-ish limiter on the master bus so stacked explosions and gunfire can't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    masterGain.connect(limiter);
    limiter.connect(ctx.destination);
  }
  return masterGain;
}

/**
 * Rocket launch + every explosion (rocket, airstrike, nuke, impacts) go through their own bus with a hard ceiling at
 * EXPLOSION_CEILING (-21 dBFS) and then only the master volume. It deliberately skips the master DynamicsCompressor,
 * whose automatic makeup gain (~+6 dB) was lifting booms. So the whole rocket chain can never peak above ~-21 dBFS,
 * whatever the gains, slider or how many booms stack.
 */
export const EXPLOSION_CEILING = Math.pow(10, -21 / 20);
let boomBus: AudioNode | null = null;
let boomMaster: GainNode | null = null;
/** Soft clip: ~linear for small signals, never above EXPLOSION_CEILING. */
export function explosionCurve(n = 2049, ceiling = EXPLOSION_CEILING): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ceiling * Math.tanh(x / ceiling); }
  return c;
}
function explosionOut(ctx: AudioContext): AudioNode {
  if (!boomBus) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = explosionCurve() as Float32Array<ArrayBuffer>;
    shaper.oversample = '2x';
    boomMaster = ctx.createGain();
    boomMaster.gain.value = effectiveVolume();
    shaper.connect(boomMaster); boomMaster.connect(ctx.destination);
    boomBus = shaper;
  }
  return boomBus;
}

interface Clip {
  buffer: AudioBuffer | null;
  pending: Promise<AudioBuffer | null> | null;
}

const huhClip: Clip = { buffer: null, pending: null };
const forkClip: Clip = { buffer: null, pending: null };
const queenDeathClip: Clip = { buffer: null, pending: null };
const arenaBoomClip: Clip = { buffer: null, pending: null };
/** Dayne's multi-kill callouts. They peak near 0 dBFS, so they play at ~0.35 through the master gain + limiter. */
export const MULTI_KILL_GAIN = 0.35;
export const MULTI_KILL_URL = (tier: string) => `/sounds/arena-ks-${tier}.mp3`;
const multiClips = new Map<string, Clip>();
let multiVoice: { src: AudioBufferSourceNode; g: GainNode } | null = null;
/** Plays a multi-kill callout; a new one cuts off the one still playing. Silent when muted (master gain is 0). */
export function playMultiKill(tier: string): void {
  const ctx = audio();
  if (!ctx) return;
  let clip = multiClips.get(tier);
  if (!clip) { clip = { buffer: null, pending: null }; multiClips.set(tier, clip); }
  void loadClip(ctx, MULTI_KILL_URL(tier), clip).then((buffer) => {
    if (!buffer) return;
    if (ctx.state === 'suspended') void ctx.resume();
    if (multiVoice) { try { multiVoice.src.stop(); multiVoice.g.disconnect(); } catch { /* already ended */ } multiVoice = null; }
    const g = ctx.createGain(); g.gain.value = MULTI_KILL_GAIN; g.connect(output(ctx));
    const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(g);
    const voice = { src, g };
    src.onended = () => { if (multiVoice === voice) multiVoice = null; try { g.disconnect(); } catch { /* gone */ } };
    multiVoice = voice; src.start();
  });
}
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
  void loadClip(ctx, SNIPER_SHOT_URL, sniperClip);
  void loadClip(ctx, ARENA_BOOM_URL, arenaBoomClip);
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

/** Arena: dry hit-marker tick when a shot lands, or a dull body thud when you take damage. */
export function playHit(self = false): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const n = arenaNoise(ctx, self ? 0.12 : 0.03);
  const f = ctx.createBiquadFilter();
  f.type = self ? 'lowpass' : 'highpass';
  f.frequency.value = self ? 400 : 3500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(self ? 0.5 : 0.35, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (self ? 0.12 : 0.035));
  n.connect(f); f.connect(g); g.connect(output(ctx));
  n.start(now);
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

/** Short filtered noise burst helper. */
function burst(ctx: AudioContext, at: number, len: number, type: BiquadFilterType, freq: number, gain: number, q = 0.7, dest?: AudioNode): void {
  const n = arenaNoise(ctx, len);
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  n.connect(f); f.connect(g); g.connect(dest ?? output(ctx));
  n.start(at);
}

/** Low sine thump that gives gunshots their body. */
function thump(ctx: AudioContext, at: number, f0: number, len: number, gain: number, dest?: AudioNode): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(28, f0 * 0.3), at + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g); g.connect(dest ?? output(ctx));
  o.start(at); o.stop(at + len + 0.02);
}

/** Arena: synthesized gunshot per weapon: sharp crack, low-end thump and a tail. All through the master volume. */
/** Launch whoosh peaks at -3.6 dBFS at gain 1; 0.12 caps it near -21 dBFS. */
/** sniper-shot.wav: Dayne's recording, cut at the crack (onset <10 ms, no MP3 encoder padding), 2.5 s with a 1.1 s fade, peak ~0 dBFS. 0.58 puts its loudest 50 ms ~2 dB above a pistol shot. */
export const SNIPER_SHOT_URL = '/sounds/sniper-shot.wav';
export const SNIPER_SHOT_GAIN = 0.58;
const sniperClip: Clip = { buffer: null, pending: null };
/** Remote gunshots fade with distance (never fully silent). */
export const shotFalloff = (dist: number): number => Math.max(0.15, 1 / (1 + Math.max(0, dist) / 10));
export const ROCKET_LAUNCH_GAIN = 0.12;
export function playWeaponShot(weapon: string, volume = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const v = volume;
  if (weapon === 'rocket') {
    // Launch measured ~1 dB hotter than the pistol and three times longer; x0.6 puts it ~3 dB under a pistol shot.
    // Part of the rocket chain: explosion bus (ceiling) and the Explosions slider (default 50% = this gain).
    const r = ROCKET_LAUNCH_GAIN * v * 2 * getExplosionVolume();
    if (r <= 0.0005) return;
    const out = explosionOut(ctx);
    thump(ctx, now, 70, 0.3, 0.6 * r, out);
    burst(ctx, now, 0.9, 'bandpass', 900, 0.5 * r, 0.6, out);
    burst(ctx, now + 0.05, 0.6, 'lowpass', 500, 0.35 * r, 0.7, out);
    return;
  }
  const cfg: Record<string, { crack: number; body: number; len: number; tail: number }> = {
    pistol: { crack: 0.55, body: 120, len: 0.12, tail: 0.25 },
    smg: { crack: 0.4, body: 140, len: 0.07, tail: 0.15 },
    shotgun: { crack: 0.8, body: 75, len: 0.25, tail: 0.5 },
    sniper: { crack: 0.9, body: 65, len: 0.3, tail: 0.7 },
  };
  if (weapon === 'sniper' && sniperClip.buffer) {
    const src = ctx.createBufferSource(); src.buffer = sniperClip.buffer;
    const g = ctx.createGain(); g.gain.value = SNIPER_SHOT_GAIN * v;
    src.connect(g); g.connect(output(ctx)); src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
    src.start(now);
    return;
  }
  if (weapon === 'sniper') void loadClip(ctx, SNIPER_SHOT_URL, sniperClip);
  const c = cfg[weapon] ?? cfg.pistol!;
  burst(ctx, now, 0.03, 'highpass', 1800, c.crack * v);
  burst(ctx, now, c.len, 'lowpass', 1400, c.crack * 0.8 * v);
  thump(ctx, now, c.body, c.len * 1.4, 0.7 * v);
  burst(ctx, now + 0.02, c.tail, 'bandpass', 600, 0.12 * v, 0.5);
  if (weapon === 'sniper') playBoltCycle(volume, 0.45);
  if (weapon === 'shotgun') { burst(ctx, now + 0.38, 0.05, 'bandpass', 2400, 0.25 * v, 3); burst(ctx, now + 0.5, 0.05, 'bandpass', 1900, 0.25 * v, 3); }
}

/** Knife: 'swing' whoosh, 'hit' wet thud + scrape, 'miss' a lighter air cut. Synthesised, through the master bus. */
export function playKnife(kind: 'swing' | 'hit' | 'miss', volume = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const v = volume;
  if (kind === 'swing') { burst(ctx, now, 0.16, 'bandpass', 1500, 0.22 * v, 1.2); burst(ctx, now + 0.04, 0.1, 'bandpass', 2600, 0.1 * v, 2); return; }
  if (kind === 'miss') { burst(ctx, now, 0.08, 'highpass', 3200, 0.06 * v); return; }
  thump(ctx, now, 95, 0.12, 0.5 * v);
  burst(ctx, now, 0.06, 'lowpass', 700, 0.35 * v);
  burst(ctx, now + 0.03, 0.09, 'bandpass', 3800, 0.12 * v, 4);
}

/** Sniper bolt: two metallic clacks. */
export function playBoltCycle(volume = 1, delay = 0): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  burst(ctx, t, 0.04, 'bandpass', 3200, 0.3 * volume, 4);
  burst(ctx, t + 0.18, 0.05, 'bandpass', 2600, 0.35 * volume, 4);
}

/** Radio call: band-limited static, a squelch beep, then static again. */
export function playRadio(volume = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  burst(ctx, now, 0.25, 'bandpass', 1800, 0.18 * volume, 1.2);
  const o = ctx.createOscillator();
  o.type = 'square'; o.frequency.value = 1250;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now + 0.22);
  g.gain.exponentialRampToValueAtTime(0.06 * volume, now + 0.23);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  o.connect(g); g.connect(output(ctx));
  o.start(now + 0.22); o.stop(now + 0.34);
  burst(ctx, now + 0.34, 0.7, 'bandpass', 2200, 0.08 * volume, 1.5);
}

/** Arena: explosion (rockets, airstrikes, the nuke). */
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
  g.gain.exponentialRampToValueAtTime(0.7 * volume * getExplosionVolume(), now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + len);
  n.connect(lp);
  lp.connect(g);
  g.connect(explosionOut(ctx));
  n.start(now);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + len);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5 * volume * getExplosionVolume(), now);
  og.gain.exponentialRampToValueAtTime(0.0001, now + len);
  osc.connect(og);
  og.connect(explosionOut(ctx));
  osc.start(now);
  osc.stop(now + len);
}

/** Arena: killstreak call-in: radio static and squelch; the nuke adds a low warning siren. */
export function playStreakCall(kind: 'reward' | 'alarm' = 'reward'): void {
  const ctx = audio();
  if (!ctx) return;
  playRadio(1);
  if (kind !== 'alarm') return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  for (let i = 0; i < 6; i++) {
    o.frequency.setValueAtTime(300, now + 0.4 + i * 0.8);
    o.frequency.linearRampToValueAtTime(520, now + 0.8 + i * 0.8);
    o.frequency.linearRampToValueAtTime(300, now + 1.2 + i * 0.8);
  }
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now + 0.4);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.6);
  g.gain.setValueAtTime(0.08, now + 5.0);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 5.4);
  o.connect(f); f.connect(g); g.connect(output(ctx));
  o.start(now + 0.4); o.stop(now + 5.5);
}

/**
 * Arena explosions use arena-boom.mp3: queen-death trimmed to 0.9 s, 60 Hz-2.5 kHz band, faded and normalized
 * (peak -7.4 dBFS, mean -21.5 dB). At the max Explosions slider a point-blank boom peaks near -21 dBFS; the default
 * 50% puts it near -27 dBFS, well under a shotgun blast (~0 dBFS peak).
 */
export const ARENA_BOOM_URL = '/sounds/arena-boom.mp3';
export const ARENA_BOOM_GAIN = 0.2;
/** The synth boom (airstrike/nuke) peaks ~5 dB hotter per unit gain than the clip. */
export const SYNTH_BOOM_SCALE = 0.5;
export const ARENA_BOOM_VOICES = 2;
const EXPLOSION_VOL_KEY = 'arena-explosion-volume';
let explosionVol = 0.5;
try { const v = parseFloat(localStorage.getItem(EXPLOSION_VOL_KEY) ?? ''); if (Number.isFinite(v)) explosionVol = Math.min(1, Math.max(0, v)); } catch { /* no storage */ }
/** Explosions slider (0..1, default 0.5), on top of the master volume. */
export function getExplosionVolume(): number { return explosionVol; }
export function setExplosionVolume(v: number): void {
  explosionVol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(EXPLOSION_VOL_KEY, String(explosionVol)); } catch { /* ignore */ }
}
export function explosionMix(dist: number): { gain: number; cutoff: number } {
  const d = Math.max(0, dist);
  return { gain: ARENA_BOOM_GAIN * explosionVol * Math.max(0.08, 1 / (1 + d / 8)), cutoff: Math.max(300, 9000 / (1 + d / 4)) };
}
let boomVoices = 0;
/** Arena explosion (rocket uses Dayne's recording; airstrike/other the synth), capped to 2 voices, through the master volume. */
export function playArenaExplosion(dist: number, kind: 'rocket' | 'synth' = 'synth', long = false): void {
  const ctx = audio();
  if (!ctx || boomVoices >= ARENA_BOOM_VOICES) return;
  const mix = explosionMix(dist);
  const gain = kind === 'rocket' ? mix.gain : mix.gain * SYNTH_BOOM_SCALE, cutoff = mix.cutoff;
  if (gain <= 0.0005) return;
  const now = ctx.currentTime;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
  const g = ctx.createGain(); g.gain.value = gain;
  lp.connect(g); g.connect(explosionOut(ctx));
  boomVoices++;
  const done = () => { boomVoices = Math.max(0, boomVoices - 1); try { g.disconnect(); } catch { /* gone */ } };
  if (kind === 'rocket') {
    void loadClip(ctx, ARENA_BOOM_URL, arenaBoomClip).then((buffer) => {
      if (!buffer) return done();
      const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(lp); src.onended = done; src.start();
    });
    return;
  }
  const len = long ? 2.2 : 0.7;
  const n = arenaNoise(ctx, len);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now); env.gain.exponentialRampToValueAtTime(0.7, now + 0.01); env.gain.exponentialRampToValueAtTime(0.0001, now + len);
  n.connect(env); env.connect(lp); n.start(now);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, now); osc.frequency.exponentialRampToValueAtTime(30, now + len);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.5, now); og.gain.exponentialRampToValueAtTime(0.0001, now + len);
  osc.connect(og); og.connect(lp); osc.start(now); osc.stop(now + len);
  osc.onended = done;
}

/** Faint "missile lock" double beep (someone's heat-seeker is on you). */
export function playLockBeep(): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 1760, t, 0.06, 0.05);
  tone(ctx, 1760, t + 0.09, 0.06, 0.05);
}
