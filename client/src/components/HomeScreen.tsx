import { useEffect, useState, type FormEvent } from 'react';
import { RulesDialog } from '@/components/RulesDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { request, socket } from '@/lib/net';
import { loadSession, prettyCode, saveSession, saveSpectate } from '@/lib/session';
import { formatClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  CLOCK_PRESETS,
  modeLabel,
  seatForSetup,
  seatLabel,
  seatsFor,
  type ClockId,
  type GameMode,
  type Side,
  type TableSetup,
  type TableSummary,
} from '../../../shared/types';

export function HomeScreen({
  initialCode,
  error,
  onEnter,
  onLeaderboard,
}: {
  initialCode: string;
  error: string;
  onEnter: () => void;
  onLeaderboard: () => void;
}) {
  const saved = loadSession();
  const [name, setName] = useState(saved?.name ?? '');
  const [code, setCode] = useState(initialCode);
  const [clockId, setClockId] = useState<ClockId>('10+0');
  const [mode, setMode] = useState<GameMode>('2v2');
  const [pairSide, setPairSide] = useState<Side>('white');
  const [busy, setBusy] = useState<'create' | 'join' | 'return' | 'quick' | 'watch' | null>(null);
  const [localError, setLocalError] = useState('');

  async function create(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    setBusy('create');
    socket.connect();
    const setup: TableSetup = { mode, pairSide: uneven(mode) ? pairSide : null };
    const res = await request('create_room', { name, clockId, mode: setup.mode, pairSide: setup.pairSide }, (ack) => {
      if (!ack.token || !ack.code) return;
      saveSession({ token: ack.token, code: ack.code, name: name.trim() });
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    setBusy(null);
    if (!res.ok) {
      setLocalError(res.error ?? 'Could not create a table.');
      return;
    }
    onEnter();
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    await joinCode(code);
  }

  async function joinCode(target: string) {
    setLocalError('');
    if (!name.trim()) {
      setLocalError('Enter your name first, then join.');
      return;
    }
    setBusy('join');
    socket.connect();
    const res = await request('join_room', { name, code: target }, (ack) => {
      if (!ack.token || !ack.code) return;
      saveSession({ token: ack.token, code: ack.code, name: name.trim() });
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    setBusy(null);
    if (!res.ok) {
      setLocalError(res.error ?? 'Could not join that table.');
      return;
    }
    onEnter();
  }

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [listedAt, setListedAt] = useState(() => Date.now());
  const openTables = tables.filter((row) => row.status === 'lobby' && row.openSeats > 0).length;
  useEffect(() => {
    let live = true;
    socket.connect();
    const watch = async () => {
      const res = await request('watch_tables');
      if (live && res.ok) {
        setTables(res.tables ?? []);
        setListedAt(Date.now());
      }
    };
    const onTables = (rows: TableSummary[]) => {
      if (!live) return;
      setTables(rows);
      setListedAt(Date.now());
    };
    socket.on('tables', onTables);
    socket.on('connect', watch);
    void watch();
    return () => {
      live = false;
      socket.off('tables', onTables);
      socket.off('connect', watch);
      socket.emit('unwatch_tables', {});
    };
  }, []);

  async function spectate(target: string) {
    setLocalError('');
    const clean = target.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4) {
      setLocalError('Enter a table code to spectate.');
      return;
    }
    setBusy('watch');
    socket.connect();
    const res = await request('spectate', { code: clean }, (ack) => {
      if (!ack.code) return;
      saveSpectate(ack.code);
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    setBusy(null);
    if (!res.ok) {
      setLocalError(res.error ?? 'Could not spectate that table.');
      return;
    }
    onEnter();
  }

  const invited = initialCode ? tables.find((row) => row.code === initialCode) : undefined;
  const invitedFull = Boolean(invited && invited.openSeats === 0);

  async function quickJoin() {
    setLocalError('');
    if (!name.trim()) {
      setLocalError('Enter your name first, then hit Quick Join.');
      return;
    }
    setBusy('quick');
    socket.connect();
    const res = await request('quick_join', { name }, (ack) => {
      if (!ack.token || !ack.code) return;
      saveSession({ token: ack.token, code: ack.code, name: name.trim() });
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    setBusy(null);
    if (!res.ok) {
      setLocalError(res.error ?? 'Could not find an open table.');
      const again = await request('open_tables');
      return;
    }
    onEnter();
  }

  async function returnToTable() {
    if (!saved) return;
    setBusy('return');
    window.history.pushState({}, '', `/r/${saved.code}`);
    const res = await request('rejoin', { code: saved.code, token: saved.token });
    setBusy(null);
    if (!res.ok) {
      setLocalError(res.error ?? 'That table is no longer available.');
      return;
    }
    onEnter();
  }

  const message = localError || error;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-5 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl italic">Relay</span>
          <span className="text-xs tracking-[0.22em] text-cream/60 uppercase">Chess</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onLeaderboard} data-testid="open-leaderboard">
            Leaderboard
          </Button>
          <RulesDialog />
        </div>
      </header>
      <main className="flex flex-1 flex-col justify-center py-8">
        <p className="text-xs tracking-[0.2em] text-brass uppercase">2v2 · 1v1 · 2v1 · 3v3 · 3v2</p>
        <h1 className="mt-2 max-w-xl font-serif text-5xl leading-[0.95] text-cream sm:text-6xl">
          Share a side, or play it straight.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-cream-dim">
          Partners relay one color (2v2 or 3v3), one player takes each side, or a bigger team alternates against a smaller one (2v1, 3v2).
        </p>
        {saved && (
          <div className="mt-6">
            <Button variant="outline" onClick={returnToTable} disabled={busy !== null}>
              {busy === 'return' ? 'Reconnecting…' : `Return to ${prettyCode(saved.code)}`}
            </Button>
          </div>
        )}
        {invitedFull && invited && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-sky-300/60 bg-sky-300/10 p-4" data-testid="invite-full">
            <Button size="lg" variant="secondary" onClick={() => void spectate(invited.code)} disabled={busy !== null}>
              👁 Spectate {prettyCode(invited.code)}
            </Button>
            <span className="text-sm text-cream-dim">
              {invited.status === 'lobby' ? 'That table is full.' : 'That game is already under way.'} You can still watch it live.
            </span>
          </div>
        )}
        {openTables > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-brass/60 bg-brass/10 p-4">
            <Button size="lg" onClick={quickJoin} disabled={busy !== null} data-testid="quick-join">
              {busy === 'quick' ? 'Grabbing a seat…' : '⚡ Quick Join'}
            </Button>
            <span className="text-sm text-cream-dim">
              {openTables === 1 ? '1 table is' : `${openTables} tables are`} waiting for players. Enter your name below, then jump in.
            </span>
          </div>
        )}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <form onSubmit={create} className="rounded-2xl border border-white/10 bg-panel/80 p-5">
            <h2 className="font-serif text-2xl">Create a table</h2>
            <p className="mt-1 text-sm text-cream-dim">You'll get a short code and a link to send.</p>
            <p className="mt-4 text-xs tracking-wide text-cream/70 uppercase">Game</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['2v2', '2v2'],
                  ['1v1', '1v1'],
                  ['2v1', '2v1'],
                  ['3v3', '3v3'],
                  ['3v2', '3v2'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`mode-${id}`}
                  aria-pressed={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm',
                    mode === id ? 'border-brass bg-brass text-ink' : 'border-white/15 text-cream hover:bg-white/5',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {uneven(mode) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ['white', `${mode === '3v2' ? 'Three' : 'Two'} on White`],
                    ['black', `${mode === '3v2' ? 'Three' : 'Two'} on Black`],
                  ] as const
                ).map(([side, label]) => (
                  <button
                    key={side}
                    type="button"
                    data-testid={`pair-${side}`}
                    aria-pressed={pairSide === side}
                    onClick={() => setPairSide(side)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm',
                      pairSide === side ? 'border-brass bg-brass text-ink' : 'border-white/15 text-cream hover:bg-white/5',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm text-cream">
              {turnOrder(mode, pairSide).map((label, index, labels) => (
                <li key={`${label}-${index}`} className="flex items-center gap-2">
                  <span className="rounded-full border border-white/15 px-3 py-1">{label}</span>
                  {index < labels.length - 1 && <span className="text-cream/40">→</span>}
                </li>
              ))}
            </ol>
            <label className="mt-4 block text-xs tracking-wide text-cream/70 uppercase" htmlFor="create-name">
              Your name
            </label>
            <Input
              id="create-name"
              data-testid="create-name"
              className="mt-1.5"
              value={name}
              maxLength={18}
              autoComplete="nickname"
              placeholder="Ada"
              onChange={(event) => setName(event.target.value)}
              required
            />
            <p className="mt-4 text-xs tracking-wide text-cream/70 uppercase">Shared team clock</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CLOCK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={clockId === preset.id}
                  onClick={() => setClockId(preset.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm',
                    clockId === preset.id ? 'border-brass bg-brass text-ink' : 'border-white/15 text-cream hover:bg-white/5',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <Button className="mt-5 w-full" type="submit" data-testid="create-submit" disabled={busy !== null}>
              {busy === 'create' ? 'Setting the table…' : 'Create table'}
            </Button>
          </form>
          <form onSubmit={join} className="rounded-2xl border border-white/10 bg-black/20 p-5">
            <h2 className="font-serif text-2xl">Join with a code</h2>
            <p className="mt-1 text-sm text-cream-dim">Sit in an open seat. The game starts when the mode's seats are filled.</p>
            <label className="mt-4 block text-xs tracking-wide text-cream/70 uppercase" htmlFor="join-code">
              Table code
            </label>
            <Input
              id="join-code"
              data-testid="join-code"
              className="mt-1.5 font-mono tracking-[0.2em] uppercase"
              value={code}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="ABC 234"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
            />
            <label className="mt-4 block text-xs tracking-wide text-cream/70 uppercase" htmlFor="join-name">
              Your name
            </label>
            <Input
              id="join-name"
              data-testid="join-name"
              className="mt-1.5"
              value={name}
              maxLength={18}
              autoComplete="nickname"
              placeholder="Jules"
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Button className="mt-5 w-full" type="submit" variant="secondary" data-testid="join-submit" disabled={busy !== null}>
              {busy === 'join' ? 'Joining…' : 'Join table'}
            </Button>
            <Button
              className="mt-2 w-full"
              type="button"
              variant="ghost"
              data-testid="spectate-code"
              disabled={busy !== null}
              onClick={() => void spectate(code)}
            >
              {busy === 'watch' ? 'Opening…' : '👁 Spectate this code'}
            </Button>
          </form>
        </div>
        {message && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {message}
          </p>
        )}
        <TableList
          tables={tables}
          listedAt={listedAt}
          busy={busy !== null}
          onJoin={(target) => void joinCode(target)}
          onSpectate={(target) => void spectate(target)}
        />
      </main>
    </div>
  );
}

function uneven(mode: GameMode): boolean {
  return mode === '2v1' || mode === '3v2';
}

function TableList({
  tables,
  listedAt,
  busy,
  onJoin,
  onSpectate,
}: {
  tables: TableSummary[];
  listedAt: number;
  busy: boolean;
  onJoin: (code: string) => void;
  onSpectate: (code: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - listedAt);
  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5" data-testid="table-list">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl">Live tables</h2>
        <span className="text-xs text-cream/50">{tables.length === 0 ? 'Nobody’s playing right now' : `${tables.length} live · updates automatically`}</span>
      </div>
      {tables.length > 0 && (
        <ul className="mt-3 divide-y divide-white/10">
          {tables.map((row) => {
            const tick = (side: 'white' | 'black') => {
              if (!row.clock) return null;
              const base = side === 'white' ? row.clock.whiteMs : row.clock.blackMs;
              return row.clock.running && row.clock.active === side ? base - elapsed : base;
            };
            const white = tick('white');
            const black = tick('black');
            const waiting = row.status === 'lobby';
            return (
              <li key={row.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-testid={`table-${row.code}`}>
                <div className="min-w-[7rem]">
                  <div className="font-mono text-base tracking-[0.18em]">{prettyCode(row.code)}</div>
                  <div className="text-[11px] tracking-wide text-brass uppercase">{modeLabel({ mode: row.mode, pairSide: row.pairSide })}</div>
                </div>
                <div className="min-w-[8rem] text-sm">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      waiting ? 'bg-emerald-400/15 text-emerald-200' : row.status === 'playing' ? 'bg-brass/20 text-brass' : 'bg-white/10 text-cream/70',
                    )}
                  >
                    {waiting ? `Waiting · ${row.filled}/${row.total} seats` : row.status === 'playing' ? 'In progress' : 'Finished'}
                  </span>
                  {row.watching > 0 && <span className="ml-2 text-xs text-cream/50">👁 {row.watching}</span>}
                </div>
                <div className="min-w-0 flex-1 truncate text-sm text-cream-dim">
                  {row.players.length ? row.players.map((p) => p.name).join(', ') : 'No one seated yet'}
                </div>
                <div className="tabular text-sm text-cream/80">
                  {white !== null && black !== null ? (
                    <>
                      <span className={cn(row.clock?.active === 'white' && row.clock.running && 'text-brass')}>♔ {formatClock(white)}</span>
                      <span className="mx-1 text-cream/40">·</span>
                      <span className={cn(row.clock?.active === 'black' && row.clock.running && 'text-brass')}>♚ {formatClock(black)}</span>
                    </>
                  ) : (
                    <span className="text-cream/50">No clock</span>
                  )}
                </div>
                <div className="ml-auto flex gap-2">
                  {waiting && row.openSeats > 0 && (
                    <Button size="sm" disabled={busy} onClick={() => onJoin(row.code)} data-testid={`join-${row.code}`}>
                      Join
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onSpectate(row.code)} data-testid={`spectate-${row.code}`}>
                    Spectate
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function turnOrder(mode: GameMode, pairSide: Side): string[] {
  const setup: TableSetup = { mode, pairSide: uneven(mode) ? pairSide : null };
  const active = seatsFor(setup);
  const sizes = { white: active.filter((s) => s.startsWith('white')).length, black: active.filter((s) => s.startsWith('black')).length };
  const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const cycle = 2 * lcm(sizes.white, sizes.black);
  return Array.from({ length: cycle }, (_, ply) => seatLabel(seatForSetup(ply, setup), active));
}
