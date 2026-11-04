import { useDoing } from '@/lib/doing';
import { cookSellValue } from '../../../shared/cooking';
import { fishSellValue } from '../../../shared/fishing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '@/lib/net';
import { fishById, fmtKg, RARITY_COLOR } from '../../../shared/fishing';
import { COOK_DT, COOK_LEVEL, COOK_MAX_STEPS, cookable, doneWindow, BURN_OVER, judge, OUTCOME_MULT, Pan, type Outcome } from '../../../shared/fishPan';

const chips = (n: number) => n.toLocaleString('en-US');
type Item = { id: string; fish: string; grams: number; value: number; dish: string | null; raw: number | null };
type State = { items: Item[]; level: number; index: number };
type Live = { pan: Pan; inputs: string; t0: number; raf: number; fish: string; level: number; pending: string[] };
type Done = { outcome: Outcome; dish: string; value: number; raw: number; xp: number; fish: string };

/** Sizzle + steam: filtered white noise whose loudness follows the pan heat. One AudioContext per kitchen. */
function useSizzle() {
  const a = useRef<{ ctx: AudioContext; g: GainNode } | null>(null);
  const start = () => {
    if (a.current) return; try {
      const ctx = new AudioContext(); const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.02 ? 1 : 0.35); // crackle pops
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400; const g = ctx.createGain(); g.gain.value = 0;
      src.connect(hp).connect(g).connect(ctx.destination); src.start(); a.current = { ctx, g };
    } catch { /* no audio */ }
  };
  const set = (heat: number) => { const x = a.current; if (x) x.g.gain.setTargetAtTime(Math.min(0.22, heat * 0.07), x.ctx.currentTime, 0.15); };
  const ding = () => { const x = a.current; if (!x) return; const o = x.ctx.createOscillator(); const g = x.ctx.createGain(); o.frequency.value = 1320; g.gain.setValueAtTime(0.2, x.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, x.ctx.currentTime + 0.8); o.connect(g).connect(x.ctx.destination); o.start(); o.stop(x.ctx.currentTime + 0.8); };
  useEffect(() => () => { void a.current?.ctx.close(); a.current = null; }, []);
  return { start, set, ding };
}

/** Doneness colour: raw pink → golden → brown → black. */
function tone(d: number) {
  const stops: Array<[number, [number, number, number]]> = [[0, [240, 170, 165]], [0.6, [236, 200, 150]], [1, [214, 150, 60]], [1.25, [130, 75, 30]], [1.5, [35, 25, 20]]];
  let i = 0; while (i < stops.length - 2 && d > stops[i + 1]![0]) i++;
  const [a, ca] = stops[i]!, [b, cb] = stops[i + 1]!; const t = Math.max(0, Math.min(1, (d - a) / (b - a)));
  return `rgb(${ca.map((v, k) => Math.round(v + (cb[k]! - v) * t)).join(',')})`;
}

/** Home kitchen: pick a raw fish from your cooler, cook it in a pan (heat + flips), plate it. The server replays it. */
export function FishPanPanel({ me, home, onClose }: { me: string | null; home: string; onClose: () => void }) {
  useDoing('cooking', 'Fish pan');
  const [st, setSt] = useState<State | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [ui, setUi] = useState<{ heat: number; dial: number; down: number; up: number; flips: number; t: number; flipAnim: number } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const live = useRef<Live | null>(null); const sfx = useSizzle();
  const load = useCallback(() => { if (me) void request('pan_state').then((r) => { if (r.ok) setSt(r as unknown as State); else setMsg(String(r.error ?? 'The kitchen is closed.')); }); }, [me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (live.current) { cancelAnimationFrame(live.current.raf); void request('pan_cancel'); } }, []);

  const begin = async (it: Item) => {
    if (busy) return; setBusy('start:' + it.id); setMsg(null); setDone(null); sfx.start();
    const r = await request('pan_start', { id: it.id }) as { ok: boolean; error?: string; seed?: number; thick?: number; level?: number; fish?: string };
    setBusy(null); if (!r.ok) { setMsg(r.error ?? 'Could not start.'); return; }
    const L: Live = { pan: new Pan(r.seed!, r.thick!), inputs: '', t0: performance.now(), raf: 0, fish: r.fish!, level: r.level!, pending: ['2'] };
    live.current = L; let flipAt = -1e9;
    const loop = () => {
      const due = Math.floor((performance.now() - L.t0) / (COOK_DT * 1000)); // never faster than real time
      while (L.inputs.length < due && L.inputs.length < COOK_MAX_STEPS) { const c = L.pending.shift() ?? String(L.pan.s.dial); if (c === 'f') flipAt = performance.now(); L.inputs += c; L.pan.tick(c); }
      const s = L.pan.s; sfx.set(s.heat);
      setUi({ heat: s.heat, dial: s.dial, down: s.down, up: s.up, flips: s.flips, t: L.inputs.length * COOK_DT, flipAnim: Math.max(0, 1 - (performance.now() - flipAt) / 450) });
      if (L.inputs.length >= COOK_MAX_STEPS) { void plate(); return; }
      L.raf = requestAnimationFrame(loop);
    };
    L.raf = requestAnimationFrame(loop);
  };
  const dial = (n: number) => { const L = live.current; if (L) L.pending.push(String(n)); };
  const flip = () => { const L = live.current; if (L && !L.pending.includes('f')) L.pending.push('f'); };
  const plate = async () => {
    const L = live.current; if (!L || busy) return; cancelAnimationFrame(L.raf); live.current = null; setBusy('plate'); sfx.set(0);
    const r = await request('pan_plate', { inputs: L.inputs }) as { ok: boolean; error?: string } & Partial<Done>;
    setBusy(null); setUi(null);
    if (!r.ok) setMsg(r.error ?? 'Something went wrong.'); else { setDone({ ...(r as Done), fish: L.fish }); sfx.ding(); }
    load();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (!live.current || (e.target as HTMLElement)?.closest?.('input,textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); flip(); } else if (e.code === 'Enter') { e.preventDefault(); void plate(); } else if (/^Digit[0-3]$/.test(e.code)) dial(Number(e.code.slice(5))); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const cooking = !!ui; const lvl = st?.level ?? 1; const w = doneWindow(lvl);
  const fish = cooking && live.current ? fishById(live.current.fish) : done ? fishById(done.fish) : null;
  const preview = cooking && live.current ? judge(live.current.pan.s, lvl) : null;
  const raw = (st?.items ?? []).filter((i) => !i.dish); const dishes = (st?.items ?? []).filter((i) => i.dish);
  const heat = ui?.heat ?? 0; const idx = st?.index ?? 1;
  const bar = (label: string, d: number) => (
    <div className="kit-bar" data-testid={`kit-bar-${label}`}><span>{label}</span><div><i className="kit-band" style={{ left: `${((1 - w) / 1.6) * 100}%`, width: `${((2 * w) / 1.6) * 100}%` }} /><i className="kit-burn" style={{ left: `${((1 + w + BURN_OVER) / 1.6) * 100}%` }} /><b style={{ width: `${Math.min(100, (d / 1.6) * 100)}%`, background: tone(d) }} /></div></div>
  );
  return (
    <div className="kit" data-testid="kitchen">
      <button type="button" className="kit-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="kit-scene" style={{ ['--heat' as string]: String(heat / 3) }}>
        <div className="kit-window"><div className="kit-curtain l" /><div className="kit-curtain r" /></div>
        <div className="kit-shelf"><span>🧂</span><span>🫙</span><span>🌿</span><span>🍋</span><span>🧄</span></div>
        <div className="kit-hood" />
        <div className="kit-stove">
          <div className="kit-burner"><div className="kit-flame" /></div>
          <div className={`kit-pan${ui && ui.flipAnim > 0 ? ' flip' : ''}`}>
            <div className="kit-oil" />
            {fish && (cooking || done) && <div className="kit-fish" style={{ background: cooking ? tone(ui!.down * 0.25 + ui!.up * 0.75) : done!.outcome === 'burnt' ? tone(1.6) : done!.outcome === 'undercooked' ? tone(0.6) : tone(1) }}><em /></div>}
            {cooking && heat > 0.6 && Array.from({ length: 6 }, (_, i) => <i key={i} className="kit-pop" style={{ left: `${15 + i * 13}%`, animationDelay: `${i * 0.17}s` }} />)}
          </div>
          {cooking && heat > 0.3 && Array.from({ length: 7 }, (_, i) => <i key={i} className="kit-steam" style={{ left: `${30 + i * 7}%`, animationDelay: `${i * 0.35}s`, opacity: Math.min(0.85, heat / 2.4) }} />)}
          <div className="kit-knobs">{[0, 1, 2, 3].map((n) => <button key={n} type="button" disabled={!cooking} className={ui?.dial === n ? 'on' : ''} onClick={() => dial(n)} data-testid={`kit-heat-${n}`} aria-label={`Heat ${['off', 'low', 'medium', 'high'][n]}`}>{['Off', 'Low', 'Med', 'High'][n]}</button>)}</div>
        </div>
        <div className="kit-counter" />
        <div className="kit-title"><b>🍳 Kitchen</b><span>{home}</span><span>Cooking level {lvl}</span></div>
      </div>
      <div className="kit-side">
        {!me && <p>Sign in to cook.</p>}
        {cooking && fish && <div className="kit-cook" data-testid="kit-cooking">
          <h4>{fish.emoji} {fish.label} in the pan · {ui!.t.toFixed(1)} s</h4>
          {bar('Bottom', ui!.down)}{bar('Top', ui!.up)}
          <small>Golden band = done (wider as you level). Past the red line = burnt. Flip at least once.</small>
          <div className="kit-actions">
            <button type="button" onClick={flip} data-testid="kit-flip">🔄 Flip <kbd>Space</kbd></button>
            <button type="button" onClick={() => void plate()} disabled={busy === 'plate'} aria-busy={busy === 'plate'} data-testid="kit-plate">{busy === 'plate' ? <><span className="world-spin" aria-hidden /> Plating…</> : <>🍽 Plate <kbd>Enter</kbd></>}</button>
          </div>
          <small data-testid="kit-preview">If you plate now: <b>{preview}</b></small>
        </div>}
        {done && !cooking && <div className={`kit-done ${done.outcome}`} data-testid="kit-done"><h4>{done.outcome === 'perfect' ? '⭐ Perfect!' : done.outcome === 'good' ? '✅ Nicely cooked' : done.outcome === 'burnt' ? '🔥 Burnt…' : '🥶 Undercooked'}</h4>
          <b>{done.dish}</b><span>Worth 🪙 {chips(Math.floor(cookSellValue(done.value) * idx))} at the fish market (was 🪙 {chips(Math.floor(fishSellValue(done.raw) * idx))}) · +{done.xp} Cooking XP</span></div>}
        {msg && <small role="status" className="kit-msg" data-testid="kit-msg">{msg}</small>}
        {!cooking && me && <>
          <h4>Your cooler · raw fish</h4>
          {!raw.length && <small>No raw fish. Catch some at the Fishing Dock.</small>}
          <div className="kit-list">{raw.map((it) => { const f = fishById(it.fish); const ok = f && cookable(f.rarity); const need = ok ? COOK_LEVEL[f.rarity as keyof typeof COOK_LEVEL] : 0; const locked = ok && lvl < need;
            return <button type="button" key={it.id} disabled={!ok || locked || !!busy} aria-busy={busy === 'start:' + it.id} onClick={() => void begin(it)} data-testid="kit-cook" title={!ok ? 'Junk can’t be cooked' : locked ? `Needs Cooking ${need}` : 'Cook it'}>
              <span style={{ color: f ? RARITY_COLOR[f.rarity] : undefined }}>{f?.emoji} {f?.label ?? it.fish}</span><small>{fmtKg(it.grams)} · 🪙 {chips(Math.floor(fishSellValue(it.value) * idx))} raw{ok && !locked ? ` → up to 🪙 ${chips(Math.floor(cookSellValue(Math.floor(it.value * OUTCOME_MULT.perfect)) * idx))}` : ''}</small>
              {busy === 'start:' + it.id ? <span className="world-spin" aria-hidden /> : locked ? <em>🔒 Lv {need}</em> : ok ? <em>Cook</em> : <em>—</em>}</button>; })}</div>
          {!!dishes.length && <><h4>Dishes ready to sell</h4><div className="kit-list">{dishes.map((it) => <div key={it.id} className="kit-dish">{it.dish}<small>🪙 {chips(Math.floor(cookSellValue(it.value) * idx))}</small></div>)}</div><small>Sell dishes at the Fishing Dock (fish market daily limits apply).</small></>}
          <small className="kit-help">Heat 0–3 (keys), Space flips, Enter plates. Higher Cooking level = fewer burns and unlocks rarer fish (uncommon 10, rare 25, epic 45, legendary 65).</small>
        </>}
      </div>
    </div>
  );
}
