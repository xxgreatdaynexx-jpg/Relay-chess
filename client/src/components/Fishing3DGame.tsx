import { importWithReload } from '@/lib/chunkReload';
import { useEffect, useRef, useState } from 'react';
import { request } from '@/lib/net';
import { reloadOnceForChunkError } from '@/lib/chunkReload';
import type { Fishing3D } from '@/lib/fishing3d';
import { fishById, fmtKg, RARITY_COLOR, Reel, REEL_DT, type FishCatch, type FishView } from '../../../shared/fishing';

const chips = (n: number) => n.toLocaleString('en-US');
type Phase = 'idle' | 'charge' | 'flying' | 'wait' | 'bite' | 'hooking' | 'reel' | 'landing' | 'show';
type Card = { fish: string; grams: number; value: number; xp: number } | null;

/** Tiny WebAudio kit: plop, splash, reel clicks. Created on the first user gesture. */
function makeSfx() {
  let ac: AudioContext | null = null; const ctx = () => (ac ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
  const noise = (dur: number, vol: number, f0: number) => { const c = ctx(); const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = f0; const g = c.createGain(); g.gain.value = vol; s.connect(f).connect(g).connect(c.destination); s.start(); };
  const tone = (f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine') => { const c = ctx(); const o = c.createOscillator(); o.type = type; const g = c.createGain(); o.frequency.setValueAtTime(f0, c.currentTime); o.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur); };
  return { splash: (big: boolean) => { try { noise(big ? 0.6 : 0.3, big ? 0.35 : 0.2, big ? 1800 : 2600); } catch { /* no audio */ } },
    plop: () => { try { tone(500, 140, 0.18, 0.3); } catch { /* */ } }, click: () => { try { tone(1800, 1200, 0.03, 0.05, 'square'); } catch { /* */ } },
    win: () => { try { tone(523, 1046, 0.35, 0.18, 'triangle'); } catch { /* */ } }, whoosh: () => { try { noise(0.35, 0.12, 900); } catch { /* */ } } };
}

/** Real 3D fishing at the dock (pt1220u). Same server flow as the panel: fish_cast → (bite) → fish_hook → reel sim → fish_land
 *  with the input timeline, which the server replays. Cast power/aim only place the bobber (cosmetic, no effect on the roll). */
export function Fishing3DGame({ me, onClose, onChange }: { me: string | null; onClose: () => void; onChange?: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null); const three = useRef<Fishing3D | null>(null);
  const [phase, setPhaseS] = useState<Phase>('idle'); const ph = useRef<Phase>('idle');
  const [msg, setMsg] = useState<string | null>('Aim with the mouse (or drag), hold to charge your cast, let go to cast.');
  const [power, setPower] = useState(0); const [reelUi, setReelUi] = useState<{ x: number; c: number; h: number; prog: number; ten: number } | null>(null);
  const [card, setCard] = useState<Card>(null); const [view, setView] = useState<FishView | null>(null); const [glError, setGlError] = useState<string | null>(null);
  const hold = useRef(false); const g = useRef({ power: 0, pdir: 1, biteAt: 0, biteEnd: 0, reel: null as Reel | null, inputs: '', t0: 0, rare: false, lastClick: 0 });
  const sfx = useRef<ReturnType<typeof makeSfx> | null>(null);
  const setPhase = (p: Phase) => { ph.current = p; setPhaseS(p); };
  const load = () => { if (me) void request('fish_state').then((r) => { if (r.ok) setView((r as unknown as { state: FishView }).state); }); };

  useEffect(() => {
    load(); let dead = false;
    importWithReload(() => import('@/lib/fishing3d')).then(({ Fishing3D }) => {
      if (dead || !cv.current) return;
      try { three.current = new Fishing3D(cv.current); three.current.onSplash = (big) => sfx.current?.splash(big); } catch { setGlError('3D is not available on this device.'); }
    }).catch((e) => { if (!reloadOnceForChunkError(e)) setGlError('Could not load the 3D engine. Refresh to try again.'); });
    const onResize = () => three.current?.resize(); window.addEventListener('resize', onResize);
    // other anglers at the dock
    const here = () => { if (me) void request('fish_here').then((r) => { if (r.ok) three.current?.setOthers(((r as unknown as { anglers: string[] }).anglers ?? []).map((name, slot) => ({ name, slot }))); }); };
    here(); const hi = window.setInterval(here, 5000);
    let raf = 0, last = performance.now();
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (t - last) / 1000); last = t; const s = g.current; const p = ph.current; const now = Date.now();
      if (p === 'charge') { s.power += s.pdir * dt * 0.9; if (s.power >= 1) { s.power = 1; s.pdir = -1; } if (s.power <= 0) { s.power = 0; s.pdir = 1; } setPower(s.power); if (three.current) three.current.power = s.power; }
      if (p === 'flying' && three.current && three.current.phase === 'wait') setPhase('wait');
      if ((p === 'wait' || p === 'flying') && s.biteAt && now >= s.biteAt) { setPhase('bite'); s.biteEnd = now + 1400; three.current?.setPhase('bite'); sfx.current?.plop(); }
      if (p === 'bite' && now > s.biteEnd) { void request('fish_reel_in'); setMsg('Too slow, it stole your bait. Cast again.'); s.biteAt = 0; reset(); }
      if (p === 'reel' && s.reel) {
        const due = Math.floor((performance.now() - s.t0) / (REEL_DT * 1000)); const r = s.reel;
        while (s.inputs.length < due && !r.s.done) { const h = hold.current; s.inputs += h ? '1' : '0'; r.tick(h); }
        three.current?.setReel(r.s.x, r.s.c, r.s.h, r.s.prog, hold.current, s.rare);
        setReelUi({ x: r.s.x, c: r.s.c, h: r.s.h, prog: r.s.prog, ten: three.current?.tension ?? 0 });
        if (hold.current && t - s.lastClick > 70) { s.lastClick = t; sfx.current?.click(); }
        if (r.s.done) void finish(s.inputs);
      }
      three.current?.step(dt);
    };
    raf = requestAnimationFrame(frame);
    return () => { dead = true; cancelAnimationFrame(raf); window.clearInterval(hi); window.removeEventListener('resize', onResize); three.current?.dispose(); three.current = null;
      if (!['idle', 'show', 'charge'].includes(ph.current)) void request('fish_reel_in'); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { hold.current = false; g.current.reel = null; setReelUi(null); three.current?.setPhase('idle'); setPhase('idle'); };
  const castNow = async () => {
    const s = g.current; const pw = s.power; setPhase('flying'); three.current?.cast(pw); sfx.current?.whoosh(); setMsg(null); setCard(null);
    const r = await request('fish_cast') as { ok: boolean; error?: string; biteIn?: number };
    if (!r.ok) { setMsg(r.error ?? 'Could not cast.'); reset(); return; }
    s.biteAt = Date.now() + (r.biteIn ?? 3000);
  };
  const strike = async () => {
    const s = g.current;
    if (ph.current === 'wait' || ph.current === 'flying') { s.biteAt = 0; void request('fish_reel_in'); setMsg('Too early, you spooked it. Cast again.'); reset(); return; }
    if (ph.current !== 'bite') return;
    setPhase('hooking'); const r = await request('fish_hook') as { ok: boolean; error?: string; seed?: number; diff?: number };
    if (!r.ok) { setMsg(r.error ?? 'Missed.'); reset(); return; }
    s.biteAt = 0; s.reel = new Reel(r.seed!, r.diff!); s.inputs = ''; s.t0 = performance.now(); s.rare = r.diff! >= 0.55;
    three.current?.setPhase('reel'); setPhase('reel'); setMsg('Fish on! Hold to reel, let go to give line. Keep the marker in the green.');
  };
  const finish = async (inputs: string) => {
    if (ph.current !== 'reel') return; setPhase('landing'); hold.current = false;
    const r = await request('fish_land', { inputs }) as { ok: boolean; error?: string; caught?: boolean; fish?: FishCatch; xp?: number };
    g.current.reel = null; setReelUi(null);
    if (r.ok && r.caught && r.fish) {
      three.current?.showCatch(r.fish.fish, r.fish.grams); sfx.current?.win();
      setCard({ fish: r.fish.fish, grams: r.fish.grams, value: Math.floor(r.fish.value * (view?.index ?? 1)), xp: r.xp ?? 0 }); setMsg(null); setPhase('show');
    } else { setMsg(r.ok ? 'It got away… cast again!' : r.error ?? 'The line snapped.'); reset(); }
    load(); onChange?.();
  };
  const sell = async () => { const r = await request('fish_sell', {}) as { ok: boolean; error?: string; sold?: number; paid?: number }; setMsg(r.ok ? `Sold ${r.sold} for 🪙 ${chips(r.paid ?? 0)}.` : r.error ?? 'Could not sell.'); load(); onChange?.(); };

  // input: pointer (mouse + touch) and keyboard
  const press = () => {
    sfx.current ??= makeSfx(); const p = ph.current;
    if (p === 'show') { three.current?.hideCatch(); setCard(null); reset(); return; }
    if (p === 'idle') { if (!me) { setMsg('Sign in to fish.'); return; } g.current.power = 0; g.current.pdir = 1; setPhase('charge'); three.current?.setPhase('charge'); return; }
    if (p === 'wait' || p === 'bite' || p === 'flying') { void strike(); return; }
    if (p === 'reel') hold.current = true;
  };
  const release = () => { hold.current = false; if (ph.current === 'charge') void castNow(); };
  const aim = (clientX: number) => { const p = ph.current; if ((p !== 'idle' && p !== 'charge') || !cv.current || !three.current) return; const r = cv.current.getBoundingClientRect(); three.current.yaw = Math.max(-0.75, Math.min(0.75, ((clientX - r.left) / r.width - 0.5) * 1.6)); };
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Escape') { onClose(); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (three.current && (ph.current === 'idle' || ph.current === 'charge')) three.current.yaw = Math.max(-0.75, three.current.yaw - 0.06); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (three.current && (ph.current === 'idle' || ph.current === 'charge')) three.current.yaw = Math.min(0.75, three.current.yaw + 0.06); return; }
      if (e.code !== 'Space') return; e.preventDefault(); if (!e.repeat) press(); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') release(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    (window as unknown as { __fish3d?: unknown }).__fish3d = { phase: () => ph.current, reel: () => g.current.reel?.s ?? null, hold: (v: boolean) => { hold.current = v; }, press, release };
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  });

  const cooler = view?.cooler ?? []; const f = card ? fishById(card.fish) : null;
  return (
    <div className="fish3d" data-testid="fish3d">
      <canvas ref={cv} className="fish3d-canvas" onPointerDown={(e) => { e.preventDefault(); aim(e.clientX); press(); }} onPointerMove={(e) => aim(e.clientX)} />
      <div className="fish3d-top">
        <b>🎣 Fishing Dock</b>
        <span data-testid="fish3d-cooler">🧊 {cooler.length}/40</span>
        {cooler.length > 0 && <button type="button" data-testid="fish3d-sell" disabled={phase !== 'idle' && phase !== 'show'} onClick={() => void sell()}>💰 Sell catch</button>}
        <button type="button" className="fish3d-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {glError && <div className="fish3d-msg">{glError}</div>}
      {msg && <div className="fish3d-msg" data-testid="fish3d-msg">{msg}</div>}
      {phase === 'charge' && <div className="fish3d-power" data-testid="fish3d-power"><div style={{ width: `${power * 100}%` }} /><span>Power</span></div>}
      {phase === 'idle' && !card && <div className="fish3d-hint">🖱️ Aim · hold <kbd>Space</kbd> / click / touch to charge · release to cast</div>}
      {(phase === 'wait' || phase === 'flying') && <div className="fish3d-hint">The bobber twitches… wait for it to go under</div>}
      {phase === 'bite' && <div className="fish3d-bite" data-testid="fish3d-bite">❗ BITE! Strike now</div>}
      {phase === 'reel' && reelUi && <div className="fish3d-reel" data-testid="fish3d-reel">
        <div className="fish3d-meter" title="Tension"><div className="fish3d-zone" style={{ bottom: `${(reelUi.c - reelUi.h) * 100}%`, height: `${reelUi.h * 200}%` }} />
          <div className={`fish3d-mark${Math.abs(reelUi.x - reelUi.c) <= reelUi.h ? ' in' : ''}`} style={{ bottom: `calc(${reelUi.x * 100}% - 4px)` }} /></div>
        <div className="fish3d-prog" title="Catch"><div style={{ height: `${reelUi.prog * 100}%` }} /></div>
        <div className="fish3d-strain"><small>Line strain</small><div><div style={{ width: `${reelUi.ten * 100}%`, background: reelUi.ten > 0.8 ? '#ff4d4d' : reelUi.ten > 0.55 ? '#ffc04d' : '#5fe08a' }} /></div><small>Hold to reel · let go to give line</small></div>
      </div>}
      {card && f && <div className="fish3d-card" data-testid="fish3d-catch" style={{ borderColor: RARITY_COLOR[f.rarity] }}>
        <div className="fish3d-rar" style={{ color: RARITY_COLOR[f.rarity] }}>{f.rarity.toUpperCase()}</div>
        <h3>{f.emoji} {f.label}</h3><div>{fmtKg(card.grams)} · worth ~🪙 {chips(card.value)} · +{card.xp} Fishing XP</div>
        <small>Kept in your cooler. Click or press Space to cast again.</small>
      </div>}
    </div>
  );
}
