import { useCallback, useEffect, useRef, useState } from 'react';
import { TopTab } from '@/components/TopTabs';
import { socket } from '@/lib/net';
import { importWithReload, reloadOnceForChunkError } from '@/lib/chunkReload';
import { ix, usePriceIndex } from '@/lib/priceIndex';
import type { Hockey3D, HkFrame } from '@/lib/hockey3d';
import { HK_DAILY_PAID_WINS, HK_TEAM_COLORS, HK_TEAM_NAMES, HK_WIN_CHIPS, PERIODS, TEAM_SIZE, hkClock, periodLabel, type HkInput, type HkResult, type HkSnapshot, type HkTeam } from '../../../shared/hockey';

/** PvP Hockey: a shared 4 v 4 rink. Humans each run one skater (or the net), bots fill the rest. Server-authoritative. */
export function HockeyPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="hk-wrap">
      <TopTab id="hockey"><button type="button" className="sol-tab hk-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="hockey-tab">
        {open ? '▴ Hockey' : '🏒 Hockey'}
      </button></TopTab>
      {open && <HockeyGameView onClose={() => setOpen(false)} />}
    </div>
  );
}

const SHORT = ['CHUDS', 'ROUGHNECKS'];
interface Joined { id: string; team: HkTeam; role: 'G' | 'S'; paid: boolean }

function useSnapshots() {
  const buf = useRef<Array<{ t: number; s: HkSnapshot }>>([]);
  const [snap, setSnap] = useState<HkSnapshot | null>(null);
  useEffect(() => {
    let last = 0;
    const on = (s: HkSnapshot) => {
      buf.current.push({ t: performance.now(), s }); if (buf.current.length > 20) buf.current.shift();
      const now = performance.now(); if (now - last > 120 || s.ph !== snap?.ph) { last = now; setSnap(s); }
    };
    socket.on('hk_state', on);
    socket.emit('hk_peek', null, (s: HkSnapshot) => { if (s) { buf.current.push({ t: performance.now(), s }); setSnap(s); } });
    return () => { socket.off('hk_state', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { buf, snap };
}

/** Interpolate the two snapshots around (now - 90 ms). */
function frameAt(buf: Array<{ t: number; s: HkSnapshot }>, me: string | null): HkFrame | null {
  if (!buf.length) return null;
  const rt = performance.now() - 90;
  let a = buf[0], b = buf[buf.length - 1];
  for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].t <= rt) { a = buf[i - 1]; b = buf[i]; break; }
  const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
  const L = (x: number, y: number) => x + (y - x) * k;
  const A = (x: number, y: number) => { let d = y - x; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return x + d * k; };
  const pa = new Map(a.s.p.map((p) => [p.id, p]));
  const players = b.s.p.map((q) => { const p = pa.get(q.id) ?? q; return { id: q.id, n: q.n, t: q.t, r: q.r, x: L(p.x, q.x), y: L(p.y, q.y), vx: q.vx, vy: q.vy, a: A(p.a, q.a), me: q.id === me, carry: b.s.pk.c === q.id }; });
  const jump = Math.hypot(b.s.pk.x - a.s.pk.x, b.s.pk.y - a.s.pk.y) > 6; // faceoff reset: don't smear
  const puck = { x: jump ? b.s.pk.x : L(a.s.pk.x, b.s.pk.x), y: jump ? b.s.pk.y : L(a.s.pk.y, b.s.pk.y), vx: b.s.pk.vx, vy: b.s.pk.vy, c: b.s.pk.c };
  return { players, puck };
}

function HockeyGameView({ onClose }: { onClose: () => void }) {
  const pidx = usePriceIndex();
  const prize = ix(HK_WIN_CHIPS, pidx);
  const { buf, snap } = useSnapshots();
  const [joined, setJoined] = useState<Joined | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<{ team?: HkTeam; goalie: boolean }>({ goalie: false });
  const [banner, setBanner] = useState<{ text: string; sub?: string; color?: string } | null>(null);
  const [result, setResult] = useState<HkResult | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const r3d = useRef<Hockey3D | null>(null);
  const input = useRef<HkInput>({ x: 0, y: 0, aim: 0 });
  const keys = useRef(new Set<string>());
  const mouseAim = useRef<{ x: number; y: number; t: number } | null>(null);
  const charge = useRef<number | null>(null);
  const [charging, setCharging] = useState(0);
  const joinedRef = useRef<Joined | null>(null); joinedRef.current = joined;
  const touch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const join = () => {
    setErr('');
    socket.emit('hk_join', { team: pick.team, goalie: pick.goalie }, (r: { ok: boolean; error?: string } & Joined) => {
      if (!r?.ok) { setErr(r?.error ?? 'Could not join.'); return; }
      setJoined({ id: r.id, team: r.team, role: r.role, paid: r.paid }); setResult(null);
    });
  };
  const leave = useCallback(() => { socket.emit('hk_leave'); setJoined(null); }, []);
  useEffect(() => () => { socket.emit('hk_leave'); }, []);

  // events -> banners / fx
  useEffect(() => {
    let to: ReturnType<typeof setTimeout> | undefined;
    const show = (b: typeof banner, ms: number) => { setBanner(b); clearTimeout(to); to = setTimeout(() => setBanner(null), ms); };
    const goal = (d: { team: HkTeam; by: string; assist?: string | null; x?: number; y?: number }) => {
      const s = buf.current[buf.current.length - 1]?.s;
      show({ text: 'GOAL!', sub: `${d.by}${d.assist ? ` (assist ${d.assist})` : ''}`, color: HK_TEAM_COLORS[d.team] }, 3000);
      r3d.current?.goal(d.team, d.x ?? s?.pk.x ?? 0, d.y ?? s?.pk.y ?? 0);
      horn();
    };
    const fo = () => show({ text: 'FACEOFF' }, 1400);
    const per = (d: { period: number }) => show({ text: d.period > PERIODS ? 'OVERTIME' : `${periodLabel(d.period)} PERIOD`, sub: d.period > PERIODS ? 'Next goal wins' : undefined }, 2600);
    const save = () => show({ text: 'SAVE!' }, 900);
    socket.on('hk_goal', goal); socket.on('hk_faceoff', fo); socket.on('hk_period', per); socket.on('hk_save', save);
    return () => { socket.off('hk_goal', goal); socket.off('hk_faceoff', fo); socket.off('hk_period', per); socket.off('hk_save', save); clearTimeout(to); };
  }, [buf]);

  // renderer (lazy chunk)
  useEffect(() => {
    let raf = 0, alive = true, last = performance.now();
    const c = canvasRef.current; if (!c) return;
    importWithReload(() => import('@/lib/hockey3d')).then(({ Hockey3D: H }) => {
      if (!alive) return;
      const low = new URLSearchParams(location.search).has('lowgfx') || (touch && window.innerWidth < 700);
      const r = new H(c, { low }); r3d.current = r;
      const size = () => { const b = c.parentElement!.getBoundingClientRect(); r.resize(b.width, b.height); };
      size(); const ro = new ResizeObserver(size); ro.observe(c.parentElement!);
      const loop = () => {
        if (!alive) { ro.disconnect(); return; }
        const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
        const f = frameAt(buf.current, joinedRef.current?.id ?? null);
        if (f) { const me = f.players.find((p) => p.me); if (me) f.focus = { x: (me.x * 2 + f.puck.x) / 3, y: (me.y + f.puck.y) / 2 }; r.render(f, dt); }
        raf = requestAnimationFrame(loop);
      };
      loop();
    }).catch((e) => { if (!reloadOnceForChunkError(e)) setErr('3D failed to load.'); });
    return () => { alive = false; cancelAnimationFrame(raf); r3d.current?.dispose(); r3d.current = null; };
  }, [buf, touch]);

  // input: keyboard + mouse aim, sent at 20 Hz
  useEffect(() => {
    if (!joined) return;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'e', 'q', 'f', 'shift'].includes(k)) e.preventDefault();
      if (k === ' ' && charge.current == null) charge.current = performance.now();
      if ((k === 'e' || k === 'shift') && !e.repeat) send({ pass: true });
      if ((k === 'q' || k === 'f') && !e.repeat) send({ poke: true });
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); keys.current.delete(k); if (k === ' ') releaseShot(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    const iv = setInterval(() => {
      const K = keys.current; let x = 0, y = 0;
      if (K.has('a') || K.has('arrowleft')) x -= 1; if (K.has('d') || K.has('arrowright')) x += 1;
      if (K.has('w') || K.has('arrowup')) y -= 1; if (K.has('s') || K.has('arrowdown')) y += 1; // screen up = -z = rink -y
      if (x || y) { const d = Math.hypot(x, y); input.current.x = x / d; input.current.y = y / d; }
      else if (!stickActive.current) { input.current.x = 0; input.current.y = 0; }
      send({});
      if (charge.current != null) setCharging(Math.min(1, (performance.now() - charge.current) / 900));
    }, 50);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  const stickActive = useRef(false);
  const send = (extra: Partial<HkInput>) => {
    const s = buf.current[buf.current.length - 1]?.s; const me = s?.p.find((p) => p.id === joinedRef.current?.id);
    const i = input.current;
    if (me) {
      const m = mouseAim.current;
      if (m && performance.now() - m.t < 1500) i.aim = Math.atan2(m.y - me.y, m.x - me.x);
      else if (i.x || i.y) i.aim = Math.atan2(i.y, i.x);
    }
    socket.emit('hk_input', { ...i, ...extra });
  };
  const releaseShot = () => {
    if (charge.current == null) return;
    const p = Math.min(1, (performance.now() - charge.current) / 900); charge.current = null; setCharging(0);
    send({ shoot: Math.max(0.15, p) });
  };
  const onMouse = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !r3d.current) return;
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const g = r3d.current.groundPoint(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    if (g) mouseAim.current = { ...g, t: performance.now() };
  };
  const onMouseDown = (e: React.PointerEvent) => { if (e.pointerType === 'mouse' && joined && e.button === 0) charge.current = performance.now(); if (e.button === 2) send({ pass: true }); };
  const onMouseUp = (e: React.PointerEvent) => { if (e.pointerType === 'mouse' && e.button === 0) releaseShot(); };

  const seenRes = useRef('');
  useEffect(() => { const r = snap?.res; if (r && joined && r.matchId !== seenRes.current) { seenRes.current = r.matchId; setResult(r); setBanner(null); } }, [snap?.res, joined]);
  const me = snap?.p.find((p) => p.id === joined?.id);
  const humans = (t: HkTeam) => snap?.p.filter((p) => p.t === t && !p.b) ?? [];
  const goalieOpen = (t: HkTeam) => !snap?.p.some((p) => p.t === t && p.r === 'G' && !p.b);
  const inGame = !!joined && !!me;
  const phaseNote = snap ? ({ lobby: 'Next match starting…', faceoff: 'Faceoff', play: '', goal: 'Goal!', intermission: 'Intermission', ended: 'Final' } as const)[snap.ph] : '';

  return (
    <div className="hk-panel" role="application" aria-label="PvP Hockey" data-testid="hockey-panel" onContextMenu={(e) => e.preventDefault()}>
      <div className="hk-stage" onPointerMove={onMouse} onPointerDown={onMouseDown} onPointerUp={onMouseUp}>
        <canvas ref={canvasRef} className="hk-canvas" data-testid="hockey-canvas" />
        {snap && <div className="hk-score" data-testid="hockey-score">
          <span className="hk-team" style={{ background: HK_TEAM_COLORS[0] }}>{SHORT[0]}</span><b>{snap.sc[0]}</b>
          <span className="hk-clock"><b>{hkClock(snap.clk)}</b><small>{periodLabel(snap.per)}{phaseNote ? ` · ${phaseNote}` : ''}</small></span>
          <b>{snap.sc[1]}</b><span className="hk-team" style={{ background: HK_TEAM_COLORS[1] }}>{SHORT[1]}</span>
          <small className="hk-sog">SOG {snap.so[0]} – {snap.so[1]}</small>
        </div>}
        <button type="button" className="hk-close" onClick={() => { leave(); onClose(); }} aria-label="Close hockey" data-testid="hockey-close">✕</button>
        {banner && <div className="hk-banner" style={{ color: banner.color ?? '#fff' }} data-testid="hockey-banner"><b>{banner.text}</b>{banner.sub && <small>{banner.sub}</small>}</div>}
        {inGame && me && <div className="hk-me">{me.r === 'G' ? '🥅 You are in net' : '⛸️ You'} · {HK_TEAM_NAMES[me.t]} · G {me.g} A {me.as} SOG {me.sh}{me.r === 'G' ? ` SV ${me.sv}` : ''}
          {me.r === 'S' && goalieOpen(me.t) && <button type="button" onClick={() => socket.emit('hk_goalie', null, () => {})} data-testid="hockey-take-goalie">Take goalie</button>}
          <button type="button" onClick={leave} data-testid="hockey-leave">Leave</button></div>}
        {inGame && charging > 0 && <div className="hk-charge"><i style={{ width: `${charging * 100}%` }} /></div>}
        {inGame && !touch && <div className="hk-keys">WASD move · mouse aims · hold Space / click to shoot · E / right-click pass · Q check</div>}
        {inGame && touch && <TouchControls stick={(x, y, on) => { stickActive.current = on; input.current.x = x; input.current.y = y; }} onShootStart={() => { charge.current = performance.now(); }} onShootEnd={releaseShot} onPass={() => send({ pass: true })} onPoke={() => send({ poke: true })} goalie={me?.r === 'G'} />}
        {!joined && <div className="hk-lobby" data-testid="hockey-lobby">
          <h2>🏒 PvP Hockey</h2>
          <p className="hk-sub">4 v 4 on the Chud Arena ice. You run one player, bots fill the rest. Three 2½-minute periods, sudden-death OT.</p>
          <div className="hk-teams">
            {([0, 1] as HkTeam[]).map((t) => <button key={t} type="button" className={`hk-pick${pick.team === t ? ' on' : ''}`} style={{ borderColor: HK_TEAM_COLORS[t] }} onClick={() => setPick((p) => ({ ...p, team: p.team === t ? undefined : t }))} data-testid={`hockey-team-${t}`}>
              <b style={{ color: HK_TEAM_COLORS[t] }}>{HK_TEAM_NAMES[t]}</b>
              <small>{humans(t).length} / {TEAM_SIZE} players{goalieOpen(t) ? ' · net open' : ' · goalie taken'}</small>
              <ul>{(snap?.p.filter((p) => p.t === t) ?? []).map((p) => <li key={p.id}>{p.r === 'G' ? '🥅' : '⛸️'} {p.b ? <i>{p.n}</i> : p.n}</li>)}</ul>
            </button>)}
          </div>
          <label className="hk-goalie"><input type="checkbox" checked={pick.goalie} onChange={(e) => setPick((p) => ({ ...p, goalie: e.target.checked }))} data-testid="hockey-goalie" /> Play goalie if the net is open</label>
          <button type="button" className="hk-join" onClick={join} data-testid="hockey-join">Join the rink{pick.team !== undefined ? ` · ${SHORT[pick.team]}` : ' · auto team'}</button>
          {err && <p className="hk-err">{err}</p>}
          <p className="hk-prize">Free to play. Win a match with at least one other real player on each team and earn <b>{prize} 🪙</b> (up to {HK_DAILY_PAID_WINS} paid wins a day; play most of the match to qualify).</p>
          {snap && <p className="hk-live">Live now: {snap.ph === 'lobby' ? 'waiting for faceoff' : `${periodLabel(snap.per)} ${hkClock(snap.clk)} · ${snap.sc[0]}–${snap.sc[1]}`}</p>}
        </div>}
        {result && <ResultCard r={result} me={joined?.id ?? null} onClose={() => setResult(null)} />}
      </div>
    </div>
  );
}

function ResultCard({ r, me, onClose }: { r: HkResult; me: string | null; onClose: () => void }) {
  const mine = r.players.find((p) => p.id === me);
  const won = mine && r.winner === mine.team;
  const name = (id: string) => r.players.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="hk-result" data-testid="hockey-result">
      <h2>{r.winner == null ? 'Tie game' : `${HK_TEAM_NAMES[r.winner]} win!`}</h2>
      <div className="hk-final"><span style={{ color: HK_TEAM_COLORS[0] }}>{r.score[0]}</span> – <span style={{ color: HK_TEAM_COLORS[1] }}>{r.score[1]}</span></div>
      {mine && <p className={won ? 'hk-won' : 'hk-lost'}>{won ? 'You won!' : r.winner == null ? 'Draw.' : 'You lost. Next match starts shortly.'}</p>}
      {r.prize && <p className="hk-won">💰 {r.prize.names.join(', ')} earned {r.prize.amount} 🪙</p>}
      <div className="hk-stars">{r.stars.map((id, i) => <span key={id}>{'⭐'.repeat(3 - i)} {name(id)}</span>)}</div>
      <table className="hk-table"><thead><tr><th>Player</th><th>G</th><th>A</th><th>SOG</th><th>SV</th></tr></thead>
        <tbody>{[...r.players].sort((a, b) => a.team - b.team || b.goals * 2 + b.assists - (a.goals * 2 + a.assists)).map((p) => <tr key={p.id} className={p.id === me ? 'me' : ''}><td><i style={{ background: HK_TEAM_COLORS[p.team] }} />{p.role === 'G' ? '🥅 ' : ''}{p.name}{p.bot ? ' 🤖' : ''}</td><td>{p.goals}</td><td>{p.assists}</td><td>{p.shots}</td><td>{p.role === 'G' ? p.saves : ''}</td></tr>)}</tbody></table>
      <button type="button" onClick={onClose} data-testid="hockey-result-close">Continue</button>
    </div>
  );
}

function TouchControls({ stick, onShootStart, onShootEnd, onPass, onPoke, goalie }: { stick: (x: number, y: number, on: boolean) => void; onShootStart: () => void; onShootEnd: () => void; onPass: () => void; onPoke: () => void; goalie: boolean }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pid = useRef<number | null>(null);
  const move = (e: React.PointerEvent) => {
    if (pid.current !== e.pointerId || !base.current) return;
    const b = base.current.getBoundingClientRect(), R = b.width / 2;
    let x = (e.clientX - b.left - R) / R, y = (e.clientY - b.top - R) / R; const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
    setKnob({ x, y }); stick(Math.abs(x) < 0.12 ? 0 : x, Math.abs(y) < 0.12 ? 0 : y, true);
  };
  const end = (e: React.PointerEvent) => { if (pid.current !== e.pointerId) return; pid.current = null; setKnob({ x: 0, y: 0 }); stick(0, 0, false); };
  const btn = (label: string, cls: string, down: () => void, up?: () => void, id?: string) => <button type="button" className={`hk-btn ${cls}`} data-testid={id} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); down(); }} onPointerUp={(e) => { e.stopPropagation(); up?.(); }} onPointerCancel={() => up?.()}>{label}</button>;
  return (
    <div className="hk-touch" onPointerDown={(e) => e.stopPropagation()}>
      <div ref={base} className="hk-stick" data-testid="hockey-stick" onPointerDown={(e) => { pid.current = e.pointerId; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <i style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
      </div>
      <div className="hk-btns">
        {btn(goalie ? 'Clear' : 'Shoot', 'shoot', onShootStart, onShootEnd, 'hockey-shoot')}
        {btn('Pass', 'pass', onPass, undefined, 'hockey-pass')}
        {!goalie && btn('Check', 'poke', onPoke, undefined, 'hockey-poke')}
      </div>
    </div>
  );
}

let ac: AudioContext | null = null;
function horn(): void {
  try {
    ac ??= new AudioContext();
    const t = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    for (const f of [110, 138.6, 164.8]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 1.7); }
  } catch { /* no audio */ }
}
