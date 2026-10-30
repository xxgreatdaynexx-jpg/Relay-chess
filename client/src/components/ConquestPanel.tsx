import { useEffect, useMemo, useRef, useState } from 'react';
import { socket, request } from '@/lib/net';
import { loadAuth } from '@/lib/auth';
import { TopTab } from '@/components/TopTabs';
import { ConquestMap, CQ_COLORS } from '@/components/ConquestMap';
import { ADJ, CONTINENTS, TERRITORIES, type CqView } from '../../../shared/conquest';

interface TableView { code: string; host: string; seats: Array<{ name: string; bot: boolean }>; you: number; deadline: number; game: CqView | null }
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
      <TopTab id="conquest"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="conquest-tab">🗺 Conquest</button></TopTab>
      {open && <ConquestWindow intent={intent} onClose={() => { setOpen(false); setIntent({}); }} />}
    </>
  );
}

function ConquestWindow({ intent, onClose }: { intent: { code?: string; create?: boolean }; onClose: () => void }) {
  const [table, setTable] = useState<TableView | null>(null);
  const [list, setList] = useState<Listing[]>([]);
  const [err, setErr] = useState('');
  const [code, setCode] = useState(intent.code ?? '');
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
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  return (
    <div className="cq-overlay" role="dialog" aria-label="Chud Conquest" data-testid="conquest">
      <header className="cq-head">
        <h2>Chud <em>Conquest</em>{table && <span className="cq-code" data-testid="cq-code">Table {table.code}</span>}</h2>
        <div className="cq-head-btns">
          {table && <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/?conquest=${table.code}`); setErr('Invite link copied.'); }}>Copy invite</button>}
          {table && <button type="button" data-testid="cq-leave" onClick={async () => { await call('cq_leave', { code: table.code }); setTable(null); void call('cq_lobby').then((r) => r.ok && setList(r.tables as unknown as Listing[])); }}>{table.you >= 0 && table.game && table.game.phase !== 'over' ? 'Surrender' : 'Leave'}</button>}
          <button type="button" onClick={onClose} aria-label="Close" data-testid="cq-close">✕</button>
        </div>
      </header>
      {err && <p className="cq-err" role="status">{err}</p>}
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
        <p className="cq-note">Share code <b>{table.code}</b>. 2–6 commanders. Bots are simple and quick.</p>
        <ol className="cq-seats">{table.seats.map((s, i) => (
          <li key={s.name}><i style={{ background: CQ_COLORS[i] }} />{s.name}{s.bot ? ' 🤖' : ''}{s.name === table.host ? ' (host)' : ''}
            {host && s.bot && <button type="button" onClick={() => call('cq_unseat', { code: table.code, index: i })} aria-label={`Remove ${s.name}`}>✕</button>}</li>
        ))}</ol>
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
  const mine = table.you >= 0 && g.turn === table.you && g.phase !== 'over';
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
    if (g.phase === 'reinforce') TERRITORIES.forEach((t) => own(t.id) && s.add(t.id));
    else if (sel === null) TERRITORIES.forEach((t) => own(t.id) && g.armies[t.id]! > 1 && (g.phase === 'fortify' || ADJ[t.id]!.some((n) => !own(n))) && s.add(t.id));
    else if (g.phase === 'attack') ADJ[sel]!.forEach((n) => !own(n) && s.add(n));
    else { const seen = new Set([sel]); const q = [sel]; while (q.length) for (const n of ADJ[q.pop()!]!) if (!seen.has(n) && own(n)) { seen.add(n); q.push(n); s.add(n); } }
    return s;
  }, [g, sel, mine, table.you]);

  const pick = (t: number) => {
    if (!mine || g.pending) return;
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
    setFlight({ from: roll.from, to: roll.to, key: rollKey, color: CQ_COLORS[g.owner[roll.from]!]! });
  }, [rollKey, roll, g.owner]);

  const left = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const turnName = g.players[g.turn]!.name;
  const pend = g.pending;
  return (
    <div className="cq-game" data-testid="cq-game">
      <div className="cq-board">
        <ConquestMap owner={g.owner} armies={g.armies} selected={sel} targets={mine ? targets : undefined} onPick={mine ? pick : undefined} flight={flight} />
        {roll && (
          <div className="cq-dice" key={rollKey} data-testid="cq-dice" aria-live="polite">
            <span className="cq-dice-row att">{roll.att.map((d, i) => <b key={i} style={{ animationDelay: `${i * 60}ms` }}>{PIPS[d - 1]}</b>)}</span>
            <small>{TERRITORIES[roll.from]!.name} → {TERRITORIES[roll.to]!.name}: −{roll.attLost} / −{roll.defLost}{roll.conquered ? ' · taken!' : ''}</small>
            <span className="cq-dice-row def">{roll.def.map((d, i) => <b key={i} style={{ animationDelay: `${120 + i * 60}ms` }}>{PIPS[d - 1]}</b>)}</span>
          </div>
        )}
      </div>
      <aside className="cq-side">
        <div className="cq-turn" data-testid="cq-turn">
          {g.phase === 'over' ? <strong>🏆 {g.players[g.winner!]!.name} conquered the Chudlands</strong> : <>
            <strong style={{ color: CQ_COLORS[g.turn] }}>{mine ? 'Your turn' : `${turnName}'s turn`}</strong> · {g.phase} · <span data-testid="cq-timer">{left}s</span> · round {g.round}
          </>}
        </div>
        {mine && (
          <div className="cq-actions" data-testid="cq-actions">
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
        <ol className="cq-players">{g.players.map((p, i) => (
          <li key={p.name} className={`${i === g.turn ? 'now' : ''}${p.alive ? '' : ' dead'}`}><i style={{ background: CQ_COLORS[i] }} />{p.name}{p.bot ? ' 🤖' : ''}<span>{p.territories} land · {p.armies} armies · {p.cardCount}🂠</span></li>
        ))}</ol>
        <details className="cq-bonus"><summary>Continent bonuses</summary><ul>{CONTINENTS.map((c) => <li key={c.id}>{c.name} +{c.bonus}</li>)}</ul></details>
        <ul className="cq-log" aria-label="War log">{[...g.log].reverse().map((l, i) => <li key={i}>{l}</li>)}</ul>
        {table.you < 0 && <p className="cq-note">Spectating.</p>}
      </aside>
    </div>
  );
}
