import { useEffect, useMemo, useRef, useState } from 'react';
import { socket, request } from '@/lib/net';
import { loadAuth } from '@/lib/auth';
import { ConquestMap } from '@/components/ConquestMap';
import { ADJ, CONTINENTS, CQ_PALETTE, CQ_PALETTE_NAMES, START_ARMIES, TERRITORIES, tradeValue, type CqView } from '../../../shared/conquest';

interface TableView { code: string; host: string; seats: Array<{ name: string; bot: boolean; color?: number }>; settings: { turnMs: number; manualSetup: boolean }; you: number; deadline: number; game: CqView | null }
const TURN_CHOICES = [30_000, 60_000, 90_000, 180_000, 300_000];
const fmtTurn = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000} min`);
export type DiceSpeed = 'slow' | 'normal' | 'fast' | 'off';
const DICE_MS: Record<DiceSpeed, number> = { slow: 1100, normal: 550, fast: 220, off: 0 };
function useDiceSpeed(): [DiceSpeed, (d: DiceSpeed) => void] {
  const [v, setV] = useState<DiceSpeed>(() => { try { const x = localStorage.getItem('cq-dice-speed'); return x === 'slow' || x === 'fast' || x === 'off' ? x : 'normal'; } catch { return 'normal'; } });
  return [v, (d) => { setV(d); try { localStorage.setItem('cq-dice-speed', d); } catch { /* private mode */ } }];
}
interface Listing { code: string; host: string; players: number; started: boolean }
const SYMBOL = ['⚔', '🐎', '💣', '★'];
const PIPS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** Opens the Chud Conquest window from anywhere (home section, links). */
export function openConquest(detail: { code?: string; create?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent('cq-open', { detail }));
}

export function ConquestPanel() {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<{ code?: string; create?: boolean }>({});
  useEffect(() => {
    const on = (e: Event) => { setIntent((e as CustomEvent).detail ?? {}); setOpen(true); };
    window.addEventListener('cq-open', on);
    const code = new URLSearchParams(window.location.search).get('conquest');
    if (code) { setIntent({ code }); setOpen(true); }
    return () => window.removeEventListener('cq-open', on);
  }, []);
  return (
    <>
      {open && <ConquestWindow intent={intent} onClose={() => { setOpen(false); setIntent({}); }} />}
    </>
  );
}

function ConquestWindow({ intent, onClose }: { intent: { code?: string; create?: boolean }; onClose: () => void }) {
  const [table, setTable] = useState<TableView | null>(null);
  const [list, setList] = useState<Listing[]>([]);
  const [err, setErr] = useState('');
  const [code, setCode] = useState(intent.code ?? '');
  const [help, setHelp] = useState(false);
  const signed = Boolean(loadAuth()?.token);
  useEffect(() => {
    const onState = (v: TableView | null) => setTable(v);
    const onList = (l: Listing[]) => setList(l);
    socket.on('cq_state', onState); socket.on('cq_list', onList);
    const boot = async () => {
      const r = await request('cq_lobby');
      if (r.ok) setList(r.tables as unknown as Listing[]);
      const mine = (r as unknown as { mine?: string | null }).mine ?? null;
      if (intent.code) { const j = await request('cq_join', { code: intent.code }); if (!j.ok) { const w = await request('cq_watch', { code: intent.code }); if (!w.ok) setErr(w.error ?? ''); } }
      else if (mine) await request('cq_join', { code: mine });
      else if (intent.create) { const c = await request('cq_create'); if (!c.ok) setErr(c.error ?? ''); }
    };
    if (socket.connected) void boot(); else { socket.once('connect', () => void boot()); socket.connect(); }
    return () => { socket.off('cq_state', onState); socket.off('cq_list', onList); };
  }, [intent]);
  const call = async (ev: string, body?: unknown) => { const r = await request(ev, body); setErr(r.ok ? '' : r.error ?? 'Failed.'); return r; };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (help) setHelp(false); else onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, help]);

  return (
    <div className="cq-overlay" role="dialog" aria-label="Chud Conquest" data-testid="conquest">
      <header className="cq-head">
        <h2>Chud <em>Conquest</em>{table && <span className="cq-code" data-testid="cq-code">Table {table.code}</span>}</h2>
        <div className="cq-head-btns">
          <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} data-testid="cq-help-btn" title="How to play">? Rules</button>
          {table && <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/?conquest=${table.code}`); setErr('Invite link copied.'); }}>Copy invite</button>}
          {table && <button type="button" data-testid="cq-leave" onClick={async () => { await call('cq_leave', { code: table.code }); setTable(null); void call('cq_lobby').then((r) => r.ok && setList(r.tables as unknown as Listing[])); }}>{table.you >= 0 && table.game && table.game.phase !== 'over' ? 'Surrender' : 'Leave'}</button>}
          <button type="button" onClick={onClose} aria-label="Close" data-testid="cq-close">✕</button>
        </div>
      </header>
      {err && <p className="cq-err" role="status">{err}</p>}
      {help && <Rules onClose={() => setHelp(false)} />}
      {!table ? (
        <div className="cq-lobby" data-testid="cq-lobby">
          <div className="cq-lobby-map"><ConquestMap compact /></div>
          <div className="cq-lobby-side">
            {!signed && <p className="cq-note">Sign in (Account, top right) to command an army. You can still watch.</p>}
            <button type="button" className="si-cta" disabled={!signed} onClick={() => call('cq_create')} data-testid="cq-create">New war table</button>
            <form className="cq-join" onSubmit={(e) => { e.preventDefault(); void call('cq_join', { code }); }}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Table code" maxLength={6} aria-label="Table code" data-testid="cq-code-input" />
              <button type="submit" disabled={!signed || !code}>Join</button>
              <button type="button" disabled={!code} onClick={() => call('cq_watch', { code })}>Watch</button>
            </form>
            <h3>Open tables</h3>
            {list.length === 0 && <p className="cq-note">No wars right now. Start one.</p>}
            <ul className="cq-list">{list.map((l) => (
              <li key={l.code}><b>{l.code}</b> {l.host} · {l.players}/6 {l.started ? '· at war' : ''}
                {!l.started && signed && <button type="button" onClick={() => call('cq_join', { code: l.code })}>Join</button>}
                <button type="button" onClick={() => call('cq_watch', { code: l.code })}>Watch</button></li>
            ))}</ul>
          </div>
        </div>
      ) : !table.game ? (
        <Waiting table={table} call={call} />
      ) : (
        <Game table={table} call={call} />
      )}
    </div>
  );
}

function Waiting({ table, call }: { table: TableView; call: (ev: string, b?: unknown) => Promise<unknown> }) {
  const me = loadAuth()?.name?.toLowerCase();
  const host = table.host.toLowerCase() === me;
  return (
    <div className="cq-lobby" data-testid="cq-waiting">
      <div className="cq-lobby-map"><ConquestMap compact /></div>
      <div className="cq-lobby-side">
        <p className="cq-note">Share code <b>{table.code}</b>. 2–6 commanders. Tap a colour swatch to pick your army colour.</p>
        <ol className="cq-seats">{table.seats.map((s, i) => {
          const canColor = s.bot ? host : s.name.toLowerCase() === me;
          return (
          <li key={s.name}>
            <i style={{ background: CQ_PALETTE[s.color ?? i] }} />{s.name}{s.bot ? ' 🤖' : ''}{s.name === table.host ? ' (host)' : ''}
            {host && s.bot && <button type="button" onClick={() => call('cq_unseat', { code: table.code, index: i })} aria-label={`Remove ${s.name}`}>✕</button>}
            {canColor && <span className="cq-swatches" role="radiogroup" aria-label={`Colour for ${s.name}`}>{CQ_PALETTE.map((c, k) => {
              const taken = table.seats.some((o, j) => j !== i && o.color === k);
              return <button key={c} type="button" role="radio" aria-checked={s.color === k} aria-label={CQ_PALETTE_NAMES[k]} title={taken ? `${CQ_PALETTE_NAMES[k]} (taken)` : CQ_PALETTE_NAMES[k]} disabled={taken} className={s.color === k ? 'on' : ''} style={{ background: c }}
                data-testid={`cq-color-${i}-${k}`} onClick={() => call('cq_color', { code: table.code, color: k, index: i })} />;
            })}</span>}
          </li>);
        })}</ol>
        <div className="cq-settings" data-testid="cq-settings">
          <label>Turn timer {host ? (
            <select value={table.settings.turnMs} onChange={(e) => call('cq_settings', { code: table.code, turnMs: Number(e.target.value) })} data-testid="cq-turn-ms">
              {TURN_CHOICES.map((ms) => <option key={ms} value={ms}>{fmtTurn(ms)}</option>)}
            </select>) : <b>{fmtTurn(table.settings.turnMs)}</b>}</label>
          <label>{host ? <input type="checkbox" checked={table.settings.manualSetup} onChange={(e) => call('cq_settings', { code: table.code, manualSetup: e.target.checked })} data-testid="cq-manual" /> : null}
            {host ? ' Players place their own starting armies' : table.settings.manualSetup ? 'Players place their own starting armies' : 'Starting armies are placed automatically'}</label>
        </div>
        {host && <div className="cq-row">
          <button type="button" disabled={table.seats.length >= 6} onClick={() => call('cq_bot', { code: table.code })} data-testid="cq-add-bot">+ Add bot</button>
          <button type="button" className="si-cta" disabled={table.seats.length < 2} onClick={() => call('cq_start', { code: table.code })} data-testid="cq-start">Start the war</button>
        </div>}
        {!host && <p className="cq-note">Waiting for {table.host} to start…</p>}
      </div>
    </div>
  );
}

function useNow(ms = 500) { const [n, setN] = useState(Date.now()); useEffect(() => { const h = setInterval(() => setN(Date.now()), ms); return () => clearInterval(h); }, [ms]); return n; }

function Game({ table, call }: { table: TableView; call: (ev: string, b?: unknown) => Promise<unknown> }) {
  const g = table.game!;
  const setupLeft = table.you >= 0 ? g.players[table.you]!.setupLeft : 0;
  const inSetup = g.phase === 'setup';
  const mine = table.you >= 0 && g.phase !== 'over' && (inSetup ? setupLeft > 0 : g.turn === table.you);
  const colors = g.players.map((p, i) => CQ_PALETTE[p.color ?? i]!);
  const [speed, setSpeed] = useDiceSpeed();
  const [sel, setSel] = useState<number | null>(null);
  const [amount, setAmount] = useState(1);
  const [dice, setDice] = useState(3);
  const [picked, setPicked] = useState<number[]>([]);
  const now = useNow();
  const act = (action: unknown) => call('cq_act', { code: table.code, action });
  useEffect(() => { setSel(null); setPicked([]); }, [g.turn, g.phase]);
  const me = table.you >= 0 ? g.players[table.you] : null;

  const targets = useMemo(() => {
    const s = new Set<number>();
    if (!mine) return s;
    const own = (t: number) => g.owner[t] === table.you;
    if (g.phase === 'reinforce' || g.phase === 'setup') TERRITORIES.forEach((t) => own(t.id) && s.add(t.id));
    else if (sel === null) TERRITORIES.forEach((t) => own(t.id) && g.armies[t.id]! > 1 && (g.phase === 'fortify' || ADJ[t.id]!.some((n) => !own(n))) && s.add(t.id));
    else if (g.phase === 'attack') ADJ[sel]!.forEach((n) => !own(n) && s.add(n));
    else { const seen = new Set([sel]); const q = [sel]; while (q.length) for (const n of ADJ[q.pop()!]!) if (!seen.has(n) && own(n)) { seen.add(n); q.push(n); s.add(n); } }
    return s;
  }, [g, sel, mine, table.you]);

  const pick = (t: number) => {
    if (!mine || g.pending) return;
    if (inSetup) { if (g.owner[t] === table.you) void act({ type: 'setupPlace', t, n: Math.min(amount, setupLeft) }); return; }
    if (g.phase === 'reinforce') { if (g.owner[t] === table.you) void act({ type: 'place', t, n: Math.min(amount, g.reserve) }); return; }
    if (sel === t) { setSel(null); return; }
    if (sel === null || !targets.has(t)) { if (g.owner[t] === table.you && g.armies[t]! > 1) { setSel(t); setAmount(g.armies[t]! - 1); } return; }
    if (g.phase === 'attack') void act({ type: 'attack', from: sel, to: t, dice });
    else void act({ type: 'fortify', from: sel, to: t, n: Math.min(amount, g.armies[sel]! - 1) });
  };
  // keep the attacker selected while it can still attack
  useEffect(() => { if (sel !== null && (g.owner[sel] !== table.you || g.armies[sel]! < 2) && g.phase === 'attack') setSel(null); }, [g, sel, table.you]);

  const roll = g.lastRoll;
  const rollKey = `${g.log.length}-${roll?.from}-${roll?.to}-${roll?.att.join('')}-${roll?.def.join('')}`;
  const lastKey = useRef('');
  const [flight, setFlight] = useState<{ from: number; to: number; key: string; color: string } | null>(null);
  useEffect(() => {
    if (!roll || rollKey === lastKey.current) return;
    lastKey.current = rollKey;
    setFlight({ from: roll.from, to: roll.to, key: rollKey, color: colors[g.owner[roll.from]!]! });
  }, [rollKey, roll, g.owner]);

  const left = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const turnName = g.players[g.turn]!.name;
  const pend = g.pending;
  return (
    <div className="cq-game" data-testid="cq-game" data-you={table.you} data-phase={g.phase} data-turn={g.turn}>
      <div className="cq-board">
        <ConquestMap colors={colors} owner={g.owner} armies={g.armies} selected={sel} targets={mine ? targets : undefined} onPick={mine ? pick : undefined} flight={flight} />
      </div>
      <div className="cq-dice-slot" style={{ ['--cq-dice-ms' as string]: `${DICE_MS[speed]}ms` }}>
        {roll && !inSetup && (
          <div className={`cq-dice${speed === 'off' ? ' still' : ''}`} key={rollKey} data-testid="cq-dice" aria-live="polite">
            <span className="cq-dice-row att">{roll.att.map((d, i) => <b key={i} style={{ animationDelay: `${i * DICE_MS[speed] / 9}ms` }}>{PIPS[d - 1]}</b>)}</span>
            <small>{TERRITORIES[roll.from]!.name} → {TERRITORIES[roll.to]!.name}: −{roll.attLost} / −{roll.defLost}{roll.conquered ? ' · taken!' : ''}</small>
            <span className="cq-dice-row def">{roll.def.map((d, i) => <b key={i} style={{ animationDelay: `${(2 + i) * DICE_MS[speed] / 9}ms` }}>{PIPS[d - 1]}</b>)}</span>
          </div>
        )}
      </div>
      <aside className="cq-side">
        <div className="cq-turn" data-testid="cq-turn">
          {g.phase === 'over' ? <strong>🏆 {g.players[g.winner!]!.name} conquered the Chudlands</strong> : <>
            {inSetup ? <strong>Deployment</strong> : <strong style={{ color: colors[g.turn] }}>{mine ? 'Your turn' : `${turnName}'s turn`}</strong>} · {inSetup ? 'everyone places at once' : g.phase} · <span data-testid="cq-timer">{left}s</span> · round {g.round}
          </>}
        </div>
        {mine && (
          <div className="cq-actions" data-testid="cq-actions">
            {inSetup && <>
              <p>Place <b data-testid="cq-setup-left">{setupLeft}</b> starting armies: tap your territories.</p>
              <label className="cq-amt">Per tap <input type="range" min={1} max={Math.max(1, setupLeft)} value={Math.min(amount, Math.max(1, setupLeft))} onChange={(e) => setAmount(Number(e.target.value))} /> {Math.min(amount, setupLeft)}</label>
              <div className="cq-row"><button type="button" onClick={() => setAmount(1)}>1</button><button type="button" onClick={() => setAmount(5)}>5</button>
                <button type="button" className="si-cta" onClick={() => act({ type: 'autoPlace' })} data-testid="cq-auto-place">Auto-place the rest</button></div>
            </>}
            {g.phase === 'reinforce' && <>
              <p>Place <b data-testid="cq-reserve">{g.reserve}</b> armies: tap your territories.</p>
              <label className="cq-amt">Per tap <input type="range" min={1} max={Math.max(1, g.reserve)} value={Math.min(amount, Math.max(1, g.reserve))} onChange={(e) => setAmount(Number(e.target.value))} /> {Math.min(amount, g.reserve)}</label>
              <div className="cq-row"><button type="button" onClick={() => setAmount(g.reserve)}>All</button><button type="button" onClick={() => setAmount(1)}>1</button></div>
            </>}
            {g.phase === 'attack' && !pend && <>
              <p>{sel === null ? 'Pick a territory to attack from.' : `Attack from ${TERRITORIES[sel]!.name}: tap an enemy neighbour.`}</p>
              <div className="cq-row">Dice {[1, 2, 3].map((d) => <button key={d} type="button" className={dice === d ? 'on' : ''} onClick={() => setDice(d)}>{d}</button>)}</div>
              <div className="cq-row"><button type="button" onClick={() => act({ type: 'endAttack' })} data-testid="cq-end-attack">Done attacking → fortify</button></div>
            </>}
            {pend && <>
              <p>Move armies into {TERRITORIES[pend.to]!.name}</p>
              <label className="cq-amt"><input type="range" min={pend.min} max={g.armies[pend.from]! - 1} value={Math.min(Math.max(amount, pend.min), g.armies[pend.from]! - 1)} onChange={(e) => setAmount(Number(e.target.value))} /> {Math.min(Math.max(amount, pend.min), g.armies[pend.from]! - 1)}</label>
              <div className="cq-row"><button type="button" onClick={() => act({ type: 'move', n: pend.min })}>Min</button><button type="button" className="si-cta" data-testid="cq-move" onClick={() => act({ type: 'move', n: Math.min(Math.max(amount, pend.min), g.armies[pend.from]! - 1) })}>Move</button><button type="button" onClick={() => act({ type: 'move', n: g.armies[pend.from]! - 1 })}>All</button></div>
            </>}
            {g.phase === 'fortify' && <>
              <p>{sel === null ? 'Fortify once: pick a territory to move from, or end the turn.' : `Move from ${TERRITORIES[sel]!.name} along your land.`}</p>
              {sel !== null && <label className="cq-amt"><input type="range" min={1} max={g.armies[sel]! - 1} value={Math.min(amount, g.armies[sel]! - 1)} onChange={(e) => setAmount(Number(e.target.value))} /> {Math.min(amount, g.armies[sel]! - 1)}</label>}
            </>}
            {(g.phase === 'attack' || g.phase === 'fortify') && !pend && <button type="button" className="si-cta" onClick={() => act({ type: 'endTurn' })} data-testid="cq-end-turn">End turn</button>}
          </div>
        )}
        {me?.cards && me.cards.length > 0 && (
          <div className="cq-cards" data-testid="cq-cards">
            <p>Cards · next set = {g.nextTrade}</p>
            <div className="cq-row">{me.cards.map((c, i) => (
              <button key={i} type="button" className={`cq-card${picked.includes(i) ? ' on' : ''}`} onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].slice(-3)))}>
                <span>{SYMBOL[c.s]}</span><small>{c.t >= 0 ? TERRITORIES[c.t]!.name : 'Wild'}</small></button>
            ))}</div>
            {mine && g.phase === 'reinforce' && <button type="button" disabled={picked.length !== 3} onClick={() => { void act({ type: 'trade', cards: picked }); setPicked([]); }} data-testid="cq-trade">Trade set</button>}
          </div>
        )}
        {inSetup && table.you >= 0 && setupLeft === 0 && <p className="cq-note" data-testid="cq-setup-wait">Your armies are down. Waiting for {g.players.filter((p) => p.setupLeft > 0).map((p) => p.name).join(', ')}…</p>}
        <ol className="cq-players">{g.players.map((p, i) => (
          <li key={p.name} className={`${i === g.turn ? 'now' : ''}${p.alive ? '' : ' dead'}`}><i style={{ background: colors[i] }} />{p.name}{p.bot ? ' 🤖' : ''}{inSetup && p.setupLeft > 0 ? ' · placing' : ''}<span>{p.territories} land · {p.armies} armies · {p.cardCount}🂠</span></li>
        ))}</ol>
        <div className="cq-row cq-speed" role="radiogroup" aria-label="Dice speed">Dice {(['slow', 'normal', 'fast', 'off'] as DiceSpeed[]).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={speed === d} className={speed === d ? 'on' : ''} onClick={() => setSpeed(d)} data-testid={`cq-speed-${d}`}>{d === 'off' ? 'Instant' : d[0]!.toUpperCase() + d.slice(1)}</button>))}</div>
        <details className="cq-bonus"><summary>Continent bonuses</summary><ul>{CONTINENTS.map((c) => <li key={c.id}>{c.name} +{c.bonus}</li>)}</ul></details>
        <ul className="cq-log" aria-label="War log">{[...g.log].reverse().map((l, i) => <li key={i}>{l}</li>)}</ul>
        {table.you < 0 && <p className="cq-note">Spectating.</p>}
      </aside>
    </div>
  );
}

function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="cq-rules" role="dialog" aria-label="How to play Chud Conquest" data-testid="cq-rules">
      <div className="cq-rules-card">
        <header><h3>How to play</h3><button type="button" onClick={onClose} aria-label="Close rules" data-testid="cq-rules-close">✕</button></header>
        <p><b>Goal:</b> hold every one of the 28 territories. 2–6 commanders; bots are welcome.</p>
        <h4>1 · Deployment</h4>
        <p>Territories are dealt out. Each commander gets {Object.entries(START_ARMIES).map(([n, a]) => `${a} (${n}p)`).join(', ')} starting armies and places them on their own land, all at once. Tap “Auto-place the rest” to finish quickly. If the host turned this off, armies are spread for you.</p>
        <h4>2 · Reinforce</h4>
        <p>At the start of your turn you get territories ÷ 3 (at least 3), plus a bonus for each whole continent you hold:</p>
        <ul className="cq-rules-bonus">{CONTINENTS.map((c) => <li key={c.id}>{c.name} <b>+{c.bonus}</b></li>)}</ul>
        <p>Trade a set of three cards (three alike, one of each, or any with a ★ wild) for extra armies: {[0, 1, 2, 3, 4, 5, 6].map(tradeValue).join(', ')}… Holding 5 or more cards, you must trade. A card showing land you own adds +2 there.</p>
        <h4>3 · Attack</h4>
        <p>From a territory with at least 2 armies, attack a neighbour (solid border or dashed sea lane). You roll up to 3 dice (one less than your armies), the defender up to 2. Highest dice are compared in pairs; the defender wins ties. Empty a territory and you take it: move in at least as many armies as dice you rolled.</p>
        <h4>4 · Fortify</h4>
        <p>Once per turn, move armies from one territory to another along a path of your own land. That ends your turn.</p>
        <h4>Cards and knockouts</h4>
        <p>Take at least one territory in a turn to draw a card. Knock a commander out and you take their cards.</p>
        <h4>Timer</h4>
        <p>Each turn has a timer set by the host. When it runs out your armies are placed and the turn ends for you. Leaving a war counts as surrendering.</p>
      </div>
    </div>
  );
}

