const HUH_URL = '/sounds/huh.mp3';
const FORK_URL = '/sounds/fork.mp3';
const QUEEN_DEATH_URL = '/sounds/queen-death.mp3';

let context: AudioContext | null = null;

interface Clip {
  buffer: AudioBuffer | null;
  pending: Promise<AudioBuffer | null> | null;
}

const huhClip: Clip = { buffer: null, pending: null };
const forkClip: Clip = { buffer: null, pending: null };
const queenDeathClip: Clip = { buffer: null, pending: null };

export function unlockSounds(): void {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume();
  if (!ctx) return;
  void loadClip(ctx, HUH_URL, huhClip);
  void loadClip(ctx, FORK_URL, forkClip);
  void loadClip(ctx, QUEEN_DEATH_URL, queenDeathClip);
}

/** Dayne's queen-capture recording. The synthesized boom plays only if that file cannot be loaded. */
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
  gain.connect(ctx.destination);
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
  thudGain.connect(ctx.destination);
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
  gain.connect(ctx.destination);
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
    source.connect(ctx.destination);
    source.start();
    return true;
  } catch {
    return false;
  }
}

export function playNice(): void {
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
    utter.volume = 1;
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
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}
