const HUH_URL = '/sounds/huh.mp3';

let context: AudioContext | null = null;
let huhBuffer: AudioBuffer | null = null;
let huhLoad: Promise<AudioBuffer | null> | null = null;

export function unlockSounds(): void {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume();
  if (ctx) void loadHuh(ctx);
}

export function playBoom(): void {
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
  void loadHuh(ctx).then((buffer) => {
    if (!buffer) {
      playHuhSynth();
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    try {
      source.start();
    } catch {
      playHuhSynth();
    }
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

function loadHuh(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (huhBuffer) return Promise.resolve(huhBuffer);
  if (!huhLoad) {
    huhLoad = fetch(HUH_URL)
      .then((response) => {
        if (!response.ok) throw new Error('huh missing');
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
      .then((buffer) => {
        huhBuffer = buffer;
        return buffer;
      })
      .catch(() => null);
  }
  return huhLoad;
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
