import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '@/components/Board';
import { LeaderboardTable } from '@/components/Leaderboard';
import { RulesDialog } from '@/components/RulesDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { request } from '@/lib/net';
import { previewFen } from '@/lib/preview';
import { playBoom, playDouble, playFork, playHuh, playMateInOne, playNice, playQueenCapture, playStreak, playTimeAlarm, playYourTurn, unlockSounds } from '@/lib/sounds';
import { becameYourTurn, shouldTimeAlarm } from '../../../shared/alerts';
import { queenMoveSound } from '../../../shared/capture';
import { BLUNDER_FLASH_MS, DOUBLE_FLASH_MS, FORK_SOUND_DELAY_MS, FORK_SOUND_WAIT_MS, MATE_IN_ONE_SOUND_DELAY_MS, OPENING_FLASH_MS, POOF_HOLD_MS, QUEEN_CAPTURE_SOUND_DELAY_MS, STREAK_FLASH_MS, STREAK_SOUND_DELAY_MS, flashIsFresh } from '../../../shared/flash';
import { isFork } from '../../../shared/fork';
import { loadSession, prettyCode } from '@/lib/session';
import { formatClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  CLOCK_PRESETS,
  modeLabel,
  seatLabel,
  seatsFor,
  seatSide,
  type ClockView,
  type PublicState,
  type Seat,
  type Side,
  type TableSetup,
} from '../../../shared/types';

interface Pending {
  fen: string;
  ply: number;
  from: string;
  to: string;
}

const PIECE_WORD: Record<string, string> = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen' };

export function RoomScreen({
  state,
  online,
  onToast,
  onLeave,
  onLeaderboard,
  onAnalyze,
}: {
  state: PublicState;
  online: boolean;
  onToast: (message: string) => void;
  onLeave: () => void;
  onLeaderboard: () => void;
  onAnalyze: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [resignOpen, setResignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [boom, setBoom] = useState<{ token: string; square: string } | null>(null);
  const [fork, setFork] = useState<{ token: string; square: string } | null>(null);
  const [payPhase, setPayPhase] = useState<'idle' | 'processing' | 'received' | 'declined'>('idle');
  const [frozenFen, setFrozenFen] = useState<string | null>(null);
  const previousFen = useRef<string | null>(null);
  const previousMoves = useRef(0);
  const escapeToast = useRef<string | null>(null);
  const missedToast = useRef<string | null>(null);
  const forkSoundTimer = useRef<number | null>(null);
  const forkSoundPlayed = useRef<string | null>(null);
  const lastForkPly = useRef<number | null>(null);
  const streakSoundTimer = useRef<number | null>(null);
  const streakSoundPlayed = useRef<string | null>(null);
  const queenCaptureTimer = useRef<number | null>(null);
  const queenCapturePlayed = useRef<string | null>(null);
  const queenCaptureToken = useRef<string | null>(null);
  const mateSoundTimer = useRef<number | null>(null);
  const mateSoundPlayed = useRef<string | null>(null);
  const session = loadSession();
  const you = state.yourSeat;
  const bailoutOpen = state.bailout !== null;
  const onMatedTeam = Boolean(bailoutOpen && you && seatSide(you) === state.bailout?.side);
  const yourTurn = state.status === 'playing' && you !== null && you === state.seatToMove && !bailoutOpen;
  const mover = state.seatToMove ? state.seats[state.seatToMove] : null;
  const auto = you?.startsWith('black') ? 'black' : 'white';
  const orientation = flipped ? (auto === 'white' ? 'black' : 'white') : auto;
  const clock = useLiveClock(state.clock);
  const preset = CLOCK_PRESETS.find((item) => item.id === state.clockPreset);
  const teamsToast = useRef<number | null>(null);

  useEffect(() => {
    const teams = state.teams;
    if (!teams || !teams.scrambled || teamsToast.current === teams.at) return;
    teamsToast.current = teams.at;
    onToast(`Teams scrambled! White: ${teams.white.join(' & ')} · Black: ${teams.black.join(' & ')}`);
  }, [state.teams, onToast]);

  useEffect(() => {
    if (pending && state.ply >= pending.ply) setPending(null);
  }, [state.ply, pending]);

  useEffect(() => {
    const unlock = () => unlockSounds();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    const before = previousFen.current;
    const movesBefore = previousMoves.current;
    previousFen.current = state.fen;
    previousMoves.current = state.moves.length;
    if (!before || before === state.fen || state.moves.length === 0 || state.moves.length === movesBefore) return;
    const move = state.moves[state.moves.length - 1];
    const queenSound = queenMoveSound(before, move.from, move.to);
    if (queenSound === 'death') setBoom({ token: `${state.ply}:${move.to}`, square: move.to });
    const forkNow = isFork(state.fen, move.to);
    if (forkNow) {
      lastForkPly.current = state.ply;
      const token = `${state.ply}:${move.to}`;
      setFork({ token, square: move.to });
      armForkSound(token, FORK_SOUND_WAIT_MS);
    }
    if (queenSound === 'capture') {
      const token = `${state.ply}:${move.from}${move.to}`;
      queenCaptureToken.current = token;
      armQueenCapture(token, forkNow ? FORK_SOUND_WAIT_MS + QUEEN_CAPTURE_SOUND_DELAY_MS : FORK_SOUND_WAIT_MS);
    }
  }, [state.fen, state.moves, state.ply]);

  function armQueenCapture(token: string, delay: number) {
    if (queenCapturePlayed.current === token) return;
    if (queenCaptureTimer.current !== null) window.clearTimeout(queenCaptureTimer.current);
    queenCaptureTimer.current = window.setTimeout(() => {
      queenCaptureTimer.current = null;
      if (queenCapturePlayed.current === token) return;
      queenCapturePlayed.current = token;
      playQueenCapture();
    }, delay);
  }

  function armForkSound(token: string, delay: number) {
    if (forkSoundPlayed.current === token) return;
    if (forkSoundTimer.current !== null) window.clearTimeout(forkSoundTimer.current);
    forkSoundTimer.current = window.setTimeout(() => {
      forkSoundTimer.current = null;
      if (forkSoundPlayed.current === token) return;
      forkSoundPlayed.current = token;
      playFork();
    }, delay);
  }

  const prevTurn = useRef<string | null>(null);
  useEffect(() => {
    const key = yourTurn ? 'you' : (state.seatToMove ?? state.status);
    if (prevTurn.current && prevTurn.current !== 'you' && key === 'you') navigator.vibrate?.(40);
    prevTurn.current = key;
    document.title = yourTurn ? 'Your move · Relay Chess' : `Table ${prettyCode(state.code)} · Relay Chess`;
  }, [yourTurn, state.seatToMove, state.status, state.code]);

  const wasYourTurn = useRef<boolean | null>(null);
  useEffect(() => {
    const previous = wasYourTurn.current;
    wasYourTurn.current = yourTurn;
    if (!becameYourTurn(previous, yourTurn)) return;
    playYourTurn();
    if (!document.hidden) return;
    const normal = document.title;
    let flip = false;
    const id = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? '♟ Your move!' : normal;
    }, 1000);
    document.title = '♟ Your move!';
    const stop = () => {
      window.clearInterval(id);
      document.title = normal;
      window.removeEventListener('focus', stop);
      document.removeEventListener('visibilitychange', onVisible);
    };
    const onVisible = () => {
      if (!document.hidden) stop();
    };
    window.addEventListener('focus', stop);
    document.addEventListener('visibilitychange', onVisible);
    return stop;
  }, [yourTurn]);

  const alarmedPly = useRef<number | null>(null);
  const mySide = you ? seatSide(you) : null;
  const myClockMs = clock && mySide ? (mySide === 'white' ? clock.white : clock.black) : null;
  useEffect(() => {
    if (!clock || myClockMs === null || state.status !== 'playing') return;
    const ring = shouldTimeAlarm({
      mySide,
      active: clock.active,
      running: clock.running,
      remainingMs: myClockMs,
      ply: state.ply,
      alarmedPly: alarmedPly.current,
    });
    if (!ring) return;
    alarmedPly.current = state.ply;
    playTimeAlarm();
  }, [clock, myClockMs, mySide, state.ply, state.status]);

  const inCheck = useMemo(() => {
    const fen = frozenFen ?? pending?.fen;
    if (!fen) return state.inCheck;
    try {
      return new Chess(fen).isCheck();
    } catch {
      return false;
    }
  }, [frozenFen, pending, state.inCheck]);

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

  const openingFlash =
    state.opening && flashIsFresh(state.opening, state.ply, state.serverNow, OPENING_FLASH_MS)
      ? {
          token: `${state.opening.at}:${state.opening.ply}:${state.opening.name}`,
          label: state.opening.name,
        }
      : null;
  const markFlash =
    state.mark && flashIsFresh(state.mark, state.ply, state.serverNow, BLUNDER_FLASH_MS)
      ? {
          token: `${state.mark.at}:${state.mark.ply}:${state.mark.grade}:${state.mark.square}`,
          square: state.mark.square,
          grade: state.mark.grade,
        }
      : null;

  const streakFlash =
    state.streak &&
    flashIsFresh(state.streak, state.ply, state.serverNow, state.streak.kind === 'double' ? DOUBLE_FLASH_MS : STREAK_FLASH_MS)
      ? {
          token: `${state.streak.at}:${state.streak.ply}:${state.streak.seat}:${state.streak.kind}`,
          name: state.streak.name,
          kind: state.streak.kind,
        }
      : null;

  useEffect(() => {
    if (markFlash?.grade === 'blunder') playHuh();
    if (markFlash?.grade === 'brilliant') playNice();
    if ((markFlash?.grade === 'blunder' || markFlash?.grade === 'brilliant') && fork?.token.startsWith(`${state.ply}:`)) {
      armForkSound(fork.token, FORK_SOUND_DELAY_MS);
    }
    if (streakFlash) armStreakSound(streakFlash.token, streakFlash.kind);
    const captureToken = queenCaptureToken.current;
    const gradedSound = markFlash?.grade === 'blunder' || markFlash?.grade === 'brilliant';
    if (captureToken?.startsWith(`${state.ply}:`) && (gradedSound || streakFlash)) {
      const forkToo = Boolean(fork?.token.startsWith(`${state.ply}:`) && gradedSound);
      const delay = streakFlash
        ? STREAK_SOUND_DELAY_MS + QUEEN_CAPTURE_SOUND_DELAY_MS
        : forkToo
          ? FORK_SOUND_DELAY_MS + QUEEN_CAPTURE_SOUND_DELAY_MS
          : QUEEN_CAPTURE_SOUND_DELAY_MS;
      armQueenCapture(captureToken, delay);
    }
  }, [markFlash?.token, markFlash?.grade, streakFlash?.token, streakFlash?.kind, fork?.token, state.ply]);

  function armStreakSound(token: string, kind: 'double' | 'streak') {
    if (streakSoundPlayed.current === token) return;
    if (streakSoundTimer.current !== null) window.clearTimeout(streakSoundTimer.current);
    streakSoundTimer.current = window.setTimeout(() => {
      streakSoundTimer.current = null;
      if (streakSoundPlayed.current === token) return;
      streakSoundPlayed.current = token;
      // Fork clip wins over streak audio on the same move; the banner still shows.
      if (lastForkPly.current !== null && token.split(':')[1] === String(lastForkPly.current)) return;
      if (kind === 'double') playDouble();
      else playStreak();
    }, STREAK_SOUND_DELAY_MS);
  }

  function armMateInOne(token: string, delay: number) {
    if (mateSoundPlayed.current === token) return;
    if (mateSoundTimer.current !== null) window.clearTimeout(mateSoundTimer.current);
    mateSoundTimer.current = window.setTimeout(() => {
      mateSoundTimer.current = null;
      if (mateSoundPlayed.current === token) return;
      mateSoundPlayed.current = token;
      playMateInOne();
    }, delay);
  }

  function mateInOneDelay(): number {
    const gap = MATE_IN_ONE_SOUND_DELAY_MS;
    const graded = markFlash?.grade === 'blunder' || markFlash?.grade === 'brilliant';
    const forkNow = Boolean(fork?.token.startsWith(`${state.ply}:`));
    const captureNow = Boolean(queenCaptureToken.current?.startsWith(`${state.ply}:`));
    const boomNow = Boolean(boom?.token.startsWith(`${state.ply}:`));
    let last = 0;
    if (boomNow) last = Math.max(last, gap);
    if (graded) last = Math.max(last, gap);
    if (forkNow) last = Math.max(last, (graded ? FORK_SOUND_DELAY_MS : FORK_SOUND_WAIT_MS) + gap);
    if (streakFlash) last = Math.max(last, STREAK_SOUND_DELAY_MS + gap);
    if (captureNow) {
      let captureAt = FORK_SOUND_WAIT_MS;
      if (streakFlash) captureAt = STREAK_SOUND_DELAY_MS + QUEEN_CAPTURE_SOUND_DELAY_MS;
      else if (graded && forkNow) captureAt = FORK_SOUND_DELAY_MS + QUEEN_CAPTURE_SOUND_DELAY_MS;
      else if (graded) captureAt = QUEEN_CAPTURE_SOUND_DELAY_MS;
      else if (forkNow) captureAt = FORK_SOUND_WAIT_MS + QUEEN_CAPTURE_SOUND_DELAY_MS;
      last = Math.max(last, captureAt + gap);
    }
    if (!markFlash && !streakFlash) last = Math.max(last, FORK_SOUND_WAIT_MS);
    return last;
  }

  useEffect(() => {
    const live =
      state.status === 'playing' && !state.result && !state.bailout && state.mateInOne?.ply === state.ply;
    if (!live) {
      if (mateSoundTimer.current !== null) {
        window.clearTimeout(mateSoundTimer.current);
        mateSoundTimer.current = null;
      }
      return;
    }
    armMateInOne(String(state.ply), mateInOneDelay());
  }, [
    state.status,
    state.result,
    state.bailout,
    state.mateInOne?.ply,
    state.ply,
    boom?.token,
    fork?.token,
    markFlash?.token,
    markFlash?.grade,
    streakFlash?.token,
  ]);

  useEffect(() => {
    if (boom) playBoom();
  }, [boom?.token]);

  useEffect(() => {
    const escape = state.escape;
    if (frozenFen) return;
    if (!escape || !flashIsFresh(escape, state.ply, state.serverNow, POOF_HOLD_MS)) return;
    const key = `${escape.at}:${escape.ply}:${escape.square}`;
    if (escapeToast.current === key) return;
    escapeToast.current = key;
    onToast(`${escape.name} paid Dayne $1 and teleported out!`);
  }, [state.escape, state.ply, state.serverNow, onToast, frozenFen]);

  useEffect(() => {
    const missed = state.missedMate;
    if (!missed || !flashIsFresh(missed, state.ply, state.serverNow, POOF_HOLD_MS)) return;
    const key = `${missed.at}:${missed.ply}`;
    if (missedToast.current === key) return;
    missedToast.current = key;
    const pieces = missed.removed.map((r) => `${PIECE_WORD[r.piece] ?? r.piece} (${r.square})`).join(' and ');
    onToast(`💀 Missed mate! ${missed.name} skipped ${missed.missed[0]} — ${pieces} lost`);
    playBoom();
  }, [state.missedMate, state.ply, state.serverNow, onToast]);

  async function payDayne() {
    if (payPhase !== 'idle' || !state.bailout) return;
    setFrozenFen(state.fen);
    setPayPhase('processing');
    const res = await request('pay_bailout');
    await wait(700);
    if (res.declined) {
      setPayPhase('declined');
      await wait(1200);
    } else if (res.ok) {
      setPayPhase('received');
      await wait(800);
    } else if (res.error) {
      onToast(res.error);
    }
    setPayPhase('idle');
    setFrozenFen(null);
  }
  const setup: TableSetup = { mode: state.mode, pairSide: state.pairSide };
  const active = seatsFor(setup);
  const displayFen = frozenFen ?? pending?.fen ?? state.fen;
  const poof =
    !frozenFen && state.escape && flashIsFresh(state.escape, state.ply, state.serverNow, POOF_HOLD_MS)
      ? {
          token: `${state.escape.at}:${state.escape.ply}:${state.escape.square}`,
          squares: [state.escape.from, state.escape.square],
        }
      : state.missedMate && flashIsFresh(state.missedMate, state.ply, state.serverNow, POOF_HOLD_MS)
        ? {
            token: `missed:${state.missedMate.at}:${state.missedMate.ply}`,
            squares: state.missedMate.removed.map((r) => r.square),
          }
        : null;
  const lastMove = pending
    ? { from: pending.from, to: pending.to }
    : state.moves.length
      ? { from: state.moves[state.moves.length - 1].from, to: state.moves[state.moves.length - 1].to }
      : undefined;
  const interactive = online && yourTurn && !pending;
  const paused = state.status === 'playing' && Boolean(mover && !mover.connected);
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="leading-none">
          <div className="font-serif text-2xl italic">Relay</div>
          <div className="text-[10px] tracking-[0.18em] text-cream/50 uppercase">Chess</div>
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left"
          data-testid="copy-code"
        >
          <div className="font-mono text-lg tracking-[0.22em]">{prettyCode(state.code)}</div>
          <div className="flex items-center gap-1 text-[11px] text-cream/60">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Link copied' : 'Copy invite link'}
          </div>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {state.spectating && (
          <span
            data-testid="spectating-badge"
            className="rounded-full border border-sky-300/60 bg-sky-300/15 px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-sky-100 uppercase"
          >
            👁 Spectating
          </span>
        )}
        {state.watching > 0 && (
          <span data-testid="watching-count" className="px-1 text-xs text-cream/60">
            {state.watching} watching
          </span>
        )}
        {state.status !== 'lobby' && (
          <Button variant="ghost" size="sm" onClick={() => setFlipped((value) => !value)} data-testid="flip-board">
            Flip
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          data-testid="main-menu"
          onClick={() => {
            if (state.spectating) {
              onLeave();
              return;
            }
            const msg =
              state.status === 'playing'
                ? 'Leave the game and return to the main menu?\n\nThe game keeps going without you (your clock keeps running) and this tab drops its seat, so you can\'t rejoin from here.'
                : 'Leave this table and return to the main menu?';
            if (window.confirm(msg)) onLeave();
          }}
        >
          Main Menu
        </Button>
        <Button variant="ghost" size="sm" onClick={onLeaderboard} data-testid="open-leaderboard">
          Leaderboard
        </Button>
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
          active={active}
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
              active={active}
              clock={clock}
              paused={paused && state.seatToMove !== null && seatSide(state.seatToMove) === side}
            />
          ))}
        </div>
      </section>

      <section className="area-board">
          <TurnBanner state={state} yourTurn={yourTurn} moverName={mover?.name ?? 'Waiting'} paused={paused} active={active} />
          <div className="mx-auto mt-3 w-full max-w-[min(100%,calc(100dvh-150px))] lg:max-w-[720px]">
            <Board
              fen={displayFen}
              orientation={orientation}
              legalMoves={interactive ? state.legalMoves : []}
              lastMove={lastMove}
              inCheck={inCheck}
              interactive={interactive}
              hints={pending ? [] : state.hints}
              opening={openingFlash}
              streak={streakFlash}
              mark={markFlash}
              fork={fork}
              boom={boom}
              poof={poof}
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
          {state.teams?.scrambled && state.status === 'playing' && (
            <div className="mb-3 rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm" data-testid="teams-banner">
              <p className="font-semibold text-amber-100">🔀 New teams</p>
              <p className="text-cream">♔ White: {state.teams.white.join(' & ')}</p>
              <p className="text-cream">♚ Black: {state.teams.black.join(' & ')}</p>
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
                {state.rematchVotes.includes(you)
                  ? `Waiting · ${state.rematchVotes.length}/${active.length}`
                  : `Rematch${state.scrambleRematch ? ' (scramble)' : ''} · ${state.rematchVotes.length}/${active.length}`}
              </Button>
            )}
            {state.status === 'ended' && state.moves.length > 0 && (
              <Button variant="outline" onClick={onAnalyze} data-testid="analyze">
                Analyze game
              </Button>
            )}
          </div>
          {state.status === 'ended' && (
            <label className="mt-3 flex items-center gap-2 text-sm text-cream" data-testid="scramble-toggle">
              <input
                type="checkbox"
                className="size-4 accent-amber-300"
                checked={state.scrambleRematch}
                disabled={!you || busy}
                onChange={(event) => void act('set_scramble', { on: event.target.checked })}
              />
              <span>
                Scramble teams on rematch
                <span className="block text-xs text-cream/55">
                  {active.length === 2 ? 'Randomly swaps colors.' : 'Reshuffles everyone across both colors and seats.'}
                  {!you ? ' Players decide.' : ''}
                </span>
              </span>
            </label>
          )}
          <div className="hidden">
          </div>
          {state.status === 'ended' && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs tracking-[0.16em] text-cream/55 uppercase">Standings</h3>
              <LeaderboardTable
                highlight={active.map((seat) => state.seats[seat]?.name ?? '').filter(Boolean)}
              />
            </div>
          )}
          {state.status === 'ended' && (
            <p className="mt-2 text-xs text-cream/55">
              {active
                .filter((seat) => !state.rematchVotes.includes(seat))
                .map((seat) => state.seats[seat]?.name ?? seatLabel(seat, active))
                .join(', ') || 'Everyone agreed.'}{' '}
              {state.rematchVotes.length < active.length ? 'still to agree.' : ''}
            </p>
          )}
          {!you && state.spectating && (
            <p className="mt-2 text-sm text-cream-dim">You’re spectating. The board is read-only; Main Menu takes you back.</p>
          )}
          {!you && !state.spectating && (
            <p className="mt-2 text-sm text-cream-dim">
              You’re watching{session ? ` as ${session.name}` : ''}. Every seat is taken.
            </p>
          )}
        </section>

        <section className="area-moves rounded-2xl border border-white/10 bg-black/20 p-3">
          <h2 className="text-xs tracking-[0.16em] text-cream/55 uppercase">Moves</h2>
          <MoveList state={state} />
        </section>

      {((onMatedTeam && payPhase === 'idle') || payPhase !== 'idle') && (
        <BailoutCheckout
          phase={payPhase}
          deadline={state.bailout?.deadline ?? null}
          serverNow={state.serverNow}
          busy={payPhase !== 'idle'}
          onPay={() => void payDayne()}
          onAccept={() => void act('accept_mate')}
        />
      )}
      {bailoutOpen && !onMatedTeam && payPhase === 'idle' && (
        <div className="bailout-backdrop" data-testid="bailout-wait">
          <div className="w-[min(92vw,420px)] rounded-2xl bg-white px-6 py-8 text-center text-[#001c64] shadow-2xl">
            <p className="font-serif text-2xl leading-snug">Waiting... opponent is considering paying Dayne $1 💸</p>
            {state.bailout && <BailoutCountdown deadline={state.bailout.deadline} serverNow={state.serverNow} />}
          </div>
        </div>
      )}

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
  active,
}: {
  state: PublicState;
  yourTurn: boolean;
  moverName: string;
  paused: boolean;
  active: Seat[];
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
        <div>{state.seatToMove ? seatLabel(state.seatToMove, active) : ''}</div>
        <div className="text-[11px] tracking-wide uppercase opacity-70">{modeLabel({ mode: state.mode, pairSide: state.pairSide })}</div>
        {state.inCheck && state.status === 'playing' && <div className="font-medium">Check</div>}
        {paused && <div>Clock paused</div>}
      </div>
    </div>
  );
}

function Lobby({
  state,
  active,
  presetLabel,
  busy,
  onSit,
  onStand,
  onLeave,
}: {
  state: PublicState;
  active: Seat[];
  presetLabel: string;
  busy: boolean;
  onSit: (seat: Seat) => void;
  onStand: () => void;
  onLeave: () => void;
}) {
  const filled = active.filter((seat) => state.seats[seat]).length;
  return (
    <div className="rounded-2xl border border-white/10 bg-panel/80 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl">Choose a seat</h2>
          <p className="mt-1 text-sm text-cream-dim">
            {filled}/{active.length} seated · {modeLabel({ mode: state.mode, pairSide: state.pairSide })} ·{' '}
            {presetLabel === 'No clock' ? 'No clock' : `${presetLabel} shared clock`}. The game starts when every seat is filled.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onLeave} disabled={busy}>
          Leave
        </Button>
      </div>
      {state.spectating && (
        <p className="mt-3 rounded-lg bg-sky-300/10 px-3 py-2 text-sm text-sky-100">
          You’re spectating this table. To play, go back to the main menu and hit Join.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {lobbyOrder(active).map((seat, index) => {
          if (!seat) return <div key={`gap-${index}`} />;
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
              <div className="text-[11px] tracking-[0.14em] text-cream/55 uppercase">{seatLabel(seat, active)}</div>
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
              ) : state.spectating ? (
                <div className="mt-2 font-serif text-xl text-cream/60">Empty</div>
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

/** White seats in the left column, Black in the right, padded so rows line up. */
function lobbyOrder(active: Seat[]): (Seat | null)[] {
  const white = active.filter((seat) => seatSide(seat) === 'white');
  const black = active.filter((seat) => seatSide(seat) === 'black');
  const out: (Seat | null)[] = [];
  for (let i = 0; i < Math.max(white.length, black.length); i += 1) out.push(white[i] ?? null, black[i] ?? null);
  return out;
}

function TeamCard({
  side,
  state,
  active,
  clock,
  paused,
}: {
  side: Side;
  state: PublicState;
  active: Seat[];
  clock: { white: number; black: number; running: boolean; active: Side | null; incrementMs: number } | null;
  paused: boolean;
}) {
  const seats = active.filter((seat) => seatSide(seat) === side);
  const sideToPlay = state.seatToMove ? seatSide(state.seatToMove) === side && state.status === 'playing' : false;
  const ms = clock ? (side === 'white' ? clock.white : clock.black) : null;
  const low = ms !== null && ms < 30_000 && clock?.running && clock.active === side;
  return (
    <div className={cn('rounded-xl border px-3 py-2', sideToPlay ? 'border-brass/80 bg-brass/10' : 'border-white/10 bg-white/5')}>
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
                  {seatLabel(seat, active)}
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
        {state.seats[move.seat]?.name ?? seatLabel(move.seat, seatsFor({ mode: state.mode, pairSide: state.pairSide }))}
      </span>
    </span>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function BailoutCheckout({
  phase,
  deadline,
  serverNow,
  busy,
  onPay,
  onAccept,
}: {
  phase: 'idle' | 'processing' | 'received' | 'declined';
  deadline: number | null;
  serverNow: number;
  busy: boolean;
  onPay: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="bailout-backdrop" data-testid="bailout-popup" role="dialog" aria-modal="true" aria-labelledby="bailout-title">
      <div className="w-[min(92vw,420px)] overflow-hidden rounded-2xl bg-white text-center text-[#001c64] shadow-2xl">
        <div className="bg-[#003087] px-4 py-3 text-3xl font-extrabold italic tracking-tight text-white">PayPal</div>
        <div className="px-6 py-6">
          <h2 id="bailout-title" className="font-serif text-2xl leading-snug">
            💸 Checkmated? PayPal Dayne $1 to escape!
          </h2>
          {phase === 'processing' && (
            <p className="mt-5 text-lg font-semibold" data-testid="bailout-processing">
              Processing payment...
            </p>
          )}
          {phase === 'received' && (
            <p className="mt-5 text-lg font-semibold" data-testid="bailout-received">
              ✅ Payment received (not really)
            </p>
          )}
          {phase === 'declined' && (
            <p className="mt-5 text-lg font-semibold" data-testid="bailout-declined">
              Payment declined 😭
            </p>
          )}
          {phase === 'idle' && (
            <div className="mt-5 flex flex-col items-center gap-3">
              <button
                type="button"
                className="w-full rounded-full bg-[#ffc439] px-4 py-3 text-lg font-extrabold text-[#003087]"
                data-testid="bailout-pay"
                disabled={busy}
                onClick={onPay}
              >
                Pay $1.00 with PayPal
              </button>
              <button
                type="button"
                className="text-sm font-semibold text-[#003087] underline"
                data-testid="bailout-accept"
                disabled={busy}
                onClick={onAccept}
              >
                Accept defeat
              </button>
              {deadline !== null && <BailoutCountdown deadline={deadline} serverNow={serverNow} />}
            </div>
          )}
          <p className="mt-4 text-xs text-[#5b6b8a]">just kidding, no real money</p>
        </div>
      </div>
    </div>
  );
}

function BailoutCountdown({ deadline, serverNow }: { deadline: number; serverNow: number }) {
  const offset = useRef(serverNow - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.ceil((deadline - (now + offset.current)) / 1000));
  return <p className="text-xs text-[#5b6b8a]">{seconds}s left</p>;
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
