import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '@/components/Board';
import { RulesDialog } from '@/components/RulesDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { request } from '@/lib/net';
import { previewFen } from '@/lib/preview';
import { loadSession, prettyCode } from '@/lib/session';
import { formatClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  CLOCK_PRESETS,
  seatLabel,
  seatSide,
  SEATS,
  type ClockView,
  type PublicState,
  type Seat,
  type Side,
} from '../../../shared/types';

interface Pending {
  fen: string;
  ply: number;
  from: string;
  to: string;
}

export function RoomScreen({
  state,
  online,
  onToast,
  onLeave,
}: {
  state: PublicState;
  online: boolean;
  onToast: (message: string) => void;
  onLeave: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [resignOpen, setResignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const session = loadSession();
  const you = state.yourSeat;
  const yourTurn = state.status === 'playing' && you !== null && you === state.seatToMove;
  const mover = state.seatToMove ? state.seats[state.seatToMove] : null;
  const auto = you?.startsWith('black') ? 'black' : 'white';
  const orientation = flipped ? (auto === 'white' ? 'black' : 'white') : auto;
  const clock = useLiveClock(state.clock);
  const preset = CLOCK_PRESETS.find((item) => item.id === state.clockPreset);

  useEffect(() => {
    if (pending && state.ply >= pending.ply) setPending(null);
  }, [state.ply, pending]);

  const prevTurn = useRef<string | null>(null);
  useEffect(() => {
    const key = yourTurn ? 'you' : (state.seatToMove ?? state.status);
    if (prevTurn.current && prevTurn.current !== 'you' && key === 'you') navigator.vibrate?.(40);
    prevTurn.current = key;
    document.title = yourTurn ? 'Your move · Relay Chess' : `Table ${prettyCode(state.code)} · Relay Chess`;
  }, [yourTurn, state.seatToMove, state.status, state.code]);

  const inCheck = useMemo(() => {
    if (!pending) return state.inCheck;
    try {
      return new Chess(pending.fen).isCheck();
    } catch {
      return false;
    }
  }, [pending, state.inCheck]);

  async function act(event: string, data?: unknown) {
    setBusy(true);
    const res = await request(event, data);
    setBusy(false);
    if (!res.ok && res.error) onToast(res.error);
    return res.ok;
  }

  async function sendMove(move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }) {
    const next = previewFen(state.fen, move);
    if (next) setPending({ fen: next, ply: state.ply + 1, from: move.from, to: move.to });
    const res = await request('move', move);
    if (!res.ok) {
      setPending(null);
      onToast(res.error ?? 'Illegal move');
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/r/${state.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast(url);
    }
  }

  const displayFen = pending?.fen ?? state.fen;
  const lastMove = pending
    ? { from: pending.from, to: pending.to }
    : state.moves.length
      ? { from: state.moves[state.moves.length - 1].from, to: state.moves[state.moves.length - 1].to }
      : undefined;
  const interactive = online && yourTurn && !pending;
  const paused = state.status === 'playing' && Boolean(mover && !mover.connected);
  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="leading-none">
          <div className="font-serif text-2xl italic">Relay</div>
          <div className="text-[10px] tracking-[0.18em] text-cream/50 uppercase">Chess</div>
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left"
          data-testid="copy-code"
        >
          <div className="font-mono text-lg tracking-[0.22em]">{prettyCode(state.code)}</div>
          <div className="flex items-center gap-1 text-[11px] text-cream/60">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Link copied' : 'Copy invite link'}
          </div>
        </button>
      </div>
      <div className="flex items-center gap-1">
        {state.status !== 'lobby' && (
          <Button variant="ghost" size="sm" onClick={() => setFlipped((value) => !value)} data-testid="flip-board">
            Flip
          </Button>
        )}
        <RulesDialog />
      </div>
    </div>
  );
  const offline = !online && (
    <div className="rounded-lg bg-amber-200/15 px-3 py-2 text-sm text-amber-100">Reconnecting… your seat is saved.</div>
  );

  if (state.status === 'lobby') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-6">
        {header}
        {offline}
        <Lobby
          state={state}
          presetLabel={preset?.label ?? 'No clock'}
          busy={busy}
          onSit={(seat) => act('sit', { seat })}
          onStand={() => void act('stand')}
          onLeave={onLeave}
        />
      </div>
    );
  }

  return (
    <div className="play">
      <header className="area-hdr flex flex-col gap-2">{header}{offline}</header>

      <section className="area-teams">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {(['white', 'black'] as const).map((side) => (
            <TeamCard
              key={side}
              side={side}
              state={state}
              clock={clock}
              paused={paused && state.seatToMove !== null && seatSide(state.seatToMove) === side}
            />
          ))}
        </div>
      </section>

      <section className="area-board">
          <TurnBanner state={state} yourTurn={yourTurn} moverName={mover?.name ?? 'Waiting'} paused={paused} />
          <div className="mx-auto mt-3 w-full max-w-[min(100%,calc(100dvh-150px))] lg:max-w-[720px]">
            <Board
              fen={displayFen}
              orientation={orientation}
              legalMoves={interactive ? state.legalMoves : []}
              lastMove={lastMove}
              inCheck={inCheck}
              interactive={interactive}
              onMove={sendMove}
            />
          </div>
        </section>

        <section className="area-actions rounded-2xl border border-white/10 bg-panel/70 p-3">
          {state.result && (
            <div className="mb-3">
              <h2 className="font-serif text-3xl">{state.result.headline}</h2>
              <p className="mt-1 text-sm text-cream-dim">{state.result.detail}</p>
            </div>
          )}
          {state.drawOffer && !state.result && (
            <p className="mb-3 text-sm text-cream">
              {state.seats[state.drawOffer.seat]?.name ?? seatLabel(state.drawOffer.seat)} offered a draw.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {yourTurn && !state.drawOffer && (
              <Button variant="outline" disabled={busy} onClick={() => act('offer_draw')} data-testid="offer-draw">
                Offer draw
              </Button>
            )}
            {yourTurn && state.drawOffer?.seat === you && (
              <Button variant="outline" disabled={busy} onClick={() => act('offer_draw')}>
                Withdraw offer
              </Button>
            )}
            {state.drawOffer && you && seatSide(you) !== state.drawOffer.side && state.status === 'playing' && (
              <>
                <Button disabled={busy} onClick={() => act('answer_draw', { accept: true })} data-testid="accept-draw">
                  Accept draw
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act('answer_draw', { accept: false })}>
                  Decline
                </Button>
              </>
            )}
            {state.status === 'playing' && you && (
              <Button variant="destructive" disabled={busy} onClick={() => setResignOpen(true)} data-testid="resign">
                Resign
              </Button>
            )}
            {state.status === 'ended' && you && (
              <Button disabled={busy} onClick={() => act('vote_rematch')} data-testid="rematch">
                {state.rematchVotes.includes(you) ? `Waiting · ${state.rematchVotes.length}/4` : `Rematch · ${state.rematchVotes.length}/4`}
              </Button>
            )}
          </div>
          {state.status === 'ended' && (
            <p className="mt-2 text-xs text-cream/55">
              {SEATS.filter((seat) => !state.rematchVotes.includes(seat))
                .map((seat) => state.seats[seat]?.name ?? seatLabel(seat))
                .join(', ') || 'Everyone agreed.'}{' '}
              {state.rematchVotes.length < 4 ? 'still to agree.' : ''}
            </p>
          )}
          {!you && <p className="mt-2 text-sm text-cream-dim">You’re watching{session ? ` as ${session.name}` : ''}. All four seats are taken.</p>}
        </section>

        <section className="area-moves rounded-2xl border border-white/10 bg-black/20 p-3">
          <h2 className="text-xs tracking-[0.16em] text-cream/55 uppercase">Moves</h2>
          <MoveList state={state} />
        </section>

      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent>
          <DialogTitle>Resign for {you ? (seatSide(you) === 'white' ? 'White' : 'Black') : 'your team'}?</DialogTitle>
          <DialogDescription>The game ends. The other team wins.</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResignOpen(false)}>
              Keep playing
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setResignOpen(false);
                await act('resign');
              }}
            >
              Resign
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TurnBanner({
  state,
  yourTurn,
  moverName,
  paused,
}: {
  state: PublicState;
  yourTurn: boolean;
  moverName: string;
  paused: boolean;
}) {
  return (
    <div
      data-testid="turn-banner"
      aria-live="polite"
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl px-4 py-3',
        yourTurn ? 'bg-brass text-ink' : 'bg-white/5 text-cream',
      )}
    >
      <div>
        <p className="text-[11px] tracking-[0.16em] uppercase opacity-70">
          {yourTurn ? 'Your move' : paused ? 'Reconnecting' : 'Waiting'}
        </p>
        <p className="font-serif text-2xl leading-none">{yourTurn ? 'Make a move' : moverName}</p>
      </div>
      <div className="text-right text-sm">
        <div>{state.seatToMove ? seatLabel(state.seatToMove) : ''}</div>
        {state.inCheck && state.status === 'playing' && <div className="font-medium">Check</div>}
        {paused && <div>Clock paused</div>}
      </div>
    </div>
  );
}

function Lobby({
  state,
  presetLabel,
  busy,
  onSit,
  onStand,
  onLeave,
}: {
  state: PublicState;
  presetLabel: string;
  busy: boolean;
  onSit: (seat: Seat) => void;
  onStand: () => void;
  onLeave: () => void;
}) {
  const filled = SEATS.filter((seat) => state.seats[seat]).length;
  return (
    <div className="rounded-2xl border border-white/10 bg-panel/80 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl">Choose a seat</h2>
          <p className="mt-1 text-sm text-cream-dim">
            {filled}/4 seated · {presetLabel === 'No clock' ? 'No clock' : `${presetLabel} shared clock`}. The game starts when every seat is filled.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onLeave} disabled={busy}>
          Leave
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {SEATS.map((seat) => {
          const player = state.seats[seat];
          const mine = state.yourSeat === seat;
          return (
            <div
              key={seat}
              data-testid={`seat-${seat}`}
              className={cn(
                'rounded-xl border p-3',
                mine ? 'border-brass bg-brass/10' : 'border-white/10 bg-black/20',
              )}
            >
              <div className="text-[11px] tracking-[0.14em] text-cream/55 uppercase">{seatLabel(seat)}</div>
              {player ? (
                <>
                  <div className="mt-1 truncate font-serif text-xl">{player.name}</div>
                  <div className="text-xs text-cream/60">
                    {mine ? 'You' : player.connected ? 'Seated' : 'Reconnecting'}
                  </div>
                  {mine && (
                    <button type="button" className="mt-2 text-xs text-brass underline-offset-2 hover:underline" onClick={onStand} disabled={busy}>
                      Stand up
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="mt-2 text-left" onClick={() => onSit(seat)} disabled={busy || state.yourSeat === seat}>
                  <div className="font-serif text-xl text-cream/80">Empty</div>
                  <div className="text-xs text-brass">Sit here</div>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamCard({
  side,
  state,
  clock,
  paused,
}: {
  side: Side;
  state: PublicState;
  clock: { white: number; black: number; running: boolean; active: Side | null; incrementMs: number } | null;
  paused: boolean;
}) {
  const seats = SEATS.filter((seat) => seatSide(seat) === side);
  const active = state.seatToMove ? seatSide(state.seatToMove) === side && state.status === 'playing' : false;
  const ms = clock ? (side === 'white' ? clock.white : clock.black) : null;
  const low = ms !== null && ms < 30_000 && clock?.running && clock.active === side;
  return (
    <div className={cn('rounded-xl border px-3 py-2', active ? 'border-brass/80 bg-brass/10' : 'border-white/10 bg-white/5')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] tracking-[0.16em] text-cream/60 uppercase">{side}</span>
        {ms !== null && (
          <span className={cn('tabular font-serif text-2xl leading-none', low && 'text-danger')}>
            {formatClock(ms)}
            {clock && clock.incrementMs > 0 && <span className="ml-1 text-xs text-cream/50">+{clock.incrementMs / 1000}</span>}
          </span>
        )}
      </div>
      {paused && <div className="text-[11px] text-amber-200">Paused</div>}
      <div className="mt-1 space-y-1">
        {seats.map((seat) => {
          const player = state.seats[seat];
          const moving = state.seatToMove === seat && state.status === 'playing';
          return (
            <div key={seat} className={cn('flex items-center gap-2 rounded-lg px-1.5 py-1', moving && 'bg-white/10')}>
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', player?.connected ? 'bg-emerald-400' : 'bg-amber-300')} />
              <div className="min-w-0">
                <div className="truncate text-sm">{player?.name ?? 'Empty'}</div>
                <div className="text-[10px] tracking-wide text-cream/50 uppercase">
                  {seatLabel(seat)}
                  {state.yourSeat === seat ? ' · you' : ''}
                  {player && !player.connected ? ' · reconnecting' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MoveList({ state }: { state: PublicState }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.moves.length, state.result]);
  const rows: { n: number; white?: (typeof state.moves)[number]; black?: (typeof state.moves)[number] }[] = [];
  for (let index = 0; index < state.moves.length; index += 2) {
    rows.push({ n: index / 2 + 1, white: state.moves[index], black: state.moves[index + 1] });
  }
  const score = !state.result ? null : state.result.winner === 'white' ? '1-0' : state.result.winner === 'black' ? '0-1' : '½-½';
  return (
    <div ref={scroller} className="mt-2 max-h-72 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-540px)] lg:min-h-36">
      {rows.length === 0 && <p className="text-sm text-cream/50">Moves will show up here.</p>}
      <ol className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.n} className="grid grid-cols-[2rem_1fr_1fr] gap-2">
            <span className="text-cream/40">{row.n}.</span>
            <MoveCell move={row.white} state={state} />
            <MoveCell move={row.black} state={state} />
          </li>
        ))}
      </ol>
      {score && <p className="mt-3 font-serif text-lg">{score}</p>}
    </div>
  );
}

function MoveCell({
  move,
  state,
}: {
  move?: PublicState['moves'][number];
  state: PublicState;
}) {
  if (!move) return <span />;
  return (
    <span>
      <span className="font-medium">{move.san}</span>
      <span className="mt-0.5 block text-[10px] tracking-wide text-cream/45 uppercase">
        {state.seats[move.seat]?.name ?? seatLabel(move.seat)}
      </span>
    </span>
  );
}

function useLiveClock(clock: ClockView | null) {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (clock) offset.current = clock.serverNow - Date.now();
  }, [clock]);
  useEffect(() => {
    if (!clock?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [clock?.running]);
  if (!clock) return null;
  const elapsed = clock.running ? Math.max(0, now + offset.current - clock.asOf) : 0;
  return {
    white: clock.whiteMs - (clock.active === 'white' ? elapsed : 0),
    black: clock.blackMs - (clock.active === 'black' ? elapsed : 0),
    running: clock.running,
    active: clock.active,
    incrementMs: clock.incrementMs,
  };
}
