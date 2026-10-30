import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { request, socket } from '@/lib/net';
import { loadName } from '@/lib/playerName';
import { saveSession, saveSpectate } from '@/lib/session';
import { clearTournament, howLabel, loadTournament, saveTournament } from '@/lib/tournament';
import { cn } from '@/lib/utils';
import { clockPreset, type ClockId, type TournamentView } from '../../../shared/types';

const ROUND_NAMES = (count: number, r: number) => {
  const left = count - r;
  return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round ${r + 1}`;
};

export function TournamentScreen({ code, onHome, onEnterRoom }: { code: string; onHome: () => void; onEnterRoom: () => void }) {
  const name = loadName();
  const [view, setView] = useState<TournamentView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const session = loadTournament();
  const hostKey = session?.code === code ? session.hostKey : undefined;
  const isEntrant = Boolean(view && name && view.entrants.some((e) => e.toLowerCase() === name.toLowerCase()));

  useEffect(() => {
    socket.connect();
    const sub = async () => {
      const res = await request('tournament_join', { code, name: name || undefined });
      if (res.ok && res.tournament) setView(res.tournament);
      else setError(res.error ?? 'Could not open that tournament.');
    };
    const onView = (next: TournamentView) => {
      if (next.code === code) setView(next);
    };
    socket.on('tournament', onView);
    socket.on('connect', sub);
    void sub();
    return () => {
      socket.off('tournament', onView);
      socket.off('connect', sub);
    };
  }, [code, name]);

  async function enter() {
    if (!name) {
      setError('Set your name on the home screen first.');
      return;
    }
    setBusy(true);
    const res = await request('tournament_join', { code, name, enter: true });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Could not join.');
    else {
      if (res.tournament) setView(res.tournament);
      saveTournament({ code, ...(hostKey ? { hostKey } : {}) });
    }
  }

  async function act(event: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await request(event, { code, hostKey, ...extra });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'That did not work.');
  }

  async function play() {
    setBusy(true);
    const res = await request('tournament_play', { code, name }, (ack) => {
      if (!ack.token || !ack.code) return;
      saveSession({ token: ack.token, code: ack.code, name });
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Could not open your match.');
    else onEnterRoom();
  }

  async function spectate(room: string) {
    const res = await request('spectate', { code: room }, (ack) => {
      if (!ack.code) return;
      saveSpectate(ack.code);
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    if (!res.ok) setError(res.error ?? 'Could not spectate.');
    else onEnterRoom();
  }

  const link = `${window.location.origin}/t/${code}`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-6" data-testid="tournament">
      <header className="flex flex-wrap items-center justify-between gap-2 px-20 sm:px-28">
        <div>
          <p className="text-xs tracking-[0.16em] text-cream/55 uppercase">
            🏆 Tournament · 1v1 · {view ? clockPreset(view.clockId as ClockId)?.label ?? view.clockId : ''} · {view?.size ?? ''} players
          </p>
          <h1 className="font-serif text-3xl">Code {code}</h1>
          <p className="text-xs text-cream/50">Host: {view?.host ?? '…'} · share <span className="select-all text-cream/80">{link}</span></p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { clearTournament(); onHome(); }}>Main Menu</Button>
      </header>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {view?.champion && (
        <div className="rounded-2xl border border-amber-300/50 bg-amber-300/15 p-4 text-center" data-testid="champion">
          <p className="text-xs tracking-[0.2em] text-amber-100 uppercase">Champion</p>
          <p className="font-serif text-4xl">👑 {view.champion}</p>
        </div>
      )}

      {view?.yourMatch && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brass/70 bg-brass/15 p-4" data-testid="your-match">
          <div>
            <p className="font-semibold">Your match is ready — you play {view.yourMatch.side}.</p>
            <p className="text-xs text-cream/60">No-shows forfeit about 2 minutes after the match opens.</p>
          </div>
          <Button onClick={() => void play()} disabled={busy} data-testid="go-to-match">Go to match</Button>
        </div>
      )}

      {view?.status === 'signup' && (
        <section className="rounded-2xl border border-white/10 bg-panel/80 p-4">
          <h2 className="font-serif text-2xl">Signed up ({view.entrants.length}/{view.size})</h2>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
            {view.entrants.map((e) => <li key={e} className="truncate rounded bg-white/5 px-2 py-1">{e}{e === view.host ? ' · host' : ''}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {!isEntrant && view.entrants.length < view.size && (
              <Button onClick={() => void enter()} disabled={busy} data-testid="enter-tournament">Join as {name || '…'}</Button>
            )}
            {isEntrant && !hostKey && (
              <Button variant="outline" onClick={() => void act('tournament_leave', { withdraw: true })} disabled={busy}>Withdraw</Button>
            )}
            {hostKey && (
              <Button onClick={() => void act('tournament_start')} disabled={busy || view.entrants.length < 2} data-testid="start-tournament">
                Start bracket
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-cream/50">Empty spots become byes. Tournaments live in server memory and are lost if the server restarts.</p>
        </section>
      )}

      {view && view.rounds.length > 0 && (
        <section className="overflow-x-auto" data-testid="bracket">
          <div className="flex min-w-max gap-4">
            {view.rounds.map((round, r) => (
              <div key={r} className="flex w-56 flex-col justify-around gap-3">
                <h3 className="text-xs tracking-[0.16em] text-cream/55 uppercase">{ROUND_NAMES(view.rounds.length, r)}</h3>
                {round.map((m) => (
                  <div key={m.id} className={cn('rounded-xl border px-3 py-2 text-sm', m.live ? 'border-brass/70 bg-brass/10' : 'border-white/10 bg-white/5')}>
                    {([['♔', m.white], ['♚', m.black]] as const).map(([icon, who], i) => (
                      <div key={i} className={cn('flex justify-between gap-2', m.winner && who === m.winner && 'font-semibold text-amber-100', m.winner && who && who !== m.winner && 'text-cream/40 line-through')}>
                        <span className="truncate">{icon} {who ?? (m.how === 'bye' || r === 0 ? '— bye —' : 'TBD')}</span>
                        {m.winner && who === m.winner && <span>✓</span>}
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between text-[11px] text-cream/50">
                      <span>{m.live ? '● live' : howLabel(m.how)}</span>
                      {m.live && m.room && (
                        <button className="underline" onClick={() => void spectate(m.room!)} data-testid="spectate-match">Spectate</button>
                      )}
                      {m.live && hostKey && (
                        <span className="flex gap-1">
                          {[m.white, m.black].map((p) => p && (
                            <button key={p} className="text-danger underline" title={`Forfeit ${p}`} onClick={() => void act('tournament_forfeit', { loser: p })}>
                              ✕{p.slice(0, 6)}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="text-xs text-cream/45">Single elimination. Draws go to whoever used less thinking time; an exact tie goes to White.</p>
    </div>
  );
}
