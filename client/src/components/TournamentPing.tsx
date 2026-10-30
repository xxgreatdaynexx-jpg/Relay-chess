import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { request, socket } from '@/lib/net';
import { loadName } from '@/lib/playerName';
import { saveSession } from '@/lib/session';
import { playYourTurn } from '@/lib/sounds';
import { loadTournament, tournamentFromLocation } from '@/lib/tournament';
import type { TournamentView } from '../../../shared/types';

/** Floating "your next match is ready" ping, anywhere in the app while you are in a tournament. */
export function TournamentPing({
  currentRoom,
  onBracket,
  onEnterRoom,
}: {
  currentRoom: string | null;
  onBracket: (code: string) => void;
  onEnterRoom: () => void;
}) {
  const [view, setView] = useState<TournamentView | null>(null);
  const pinged = useRef<string | null>(null);
  const session = loadTournament();
  const code = session?.code ?? '';

  useEffect(() => {
    if (!code) return;
    const name = loadName();
    const sub = () => void request('tournament_join', { code, name: name || undefined }).then((res) => res.tournament && setView(res.tournament));
    const onView = (next: TournamentView) => next.code === code && setView(next);
    socket.on('tournament', onView);
    socket.on('connect', sub);
    if (socket.connected) sub();
    return () => {
      socket.off('tournament', onView);
      socket.off('connect', sub);
    };
  }, [code, currentRoom]);

  const match = view?.yourMatch ?? null;
  const show = Boolean(match && match.room !== currentRoom && tournamentFromLocation() !== code);
  useEffect(() => {
    if (show && match && pinged.current !== match.room) {
      pinged.current = match.room;
      playYourTurn();
    }
  }, [show, match]);
  if (!view || !show || !match) return null;

  async function go() {
    const name = loadName();
    const res = await request('tournament_play', { code, name }, (ack) => {
      if (!ack.token || !ack.code) return;
      saveSession({ token: ack.token, code: ack.code, name });
      window.history.pushState({}, '', `/r/${ack.code}`);
    });
    if (res.ok) onEnterRoom();
  }

  return (
    <div className="fixed top-16 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-2xl border border-brass/70 bg-panel/95 px-4 py-2 text-sm shadow-xl" data-testid="tournament-ping">
      <span>🏆 Your next tournament match is ready ({match.side}).</span>
      <Button size="sm" onClick={() => void go()}>Go to match</Button>
      <Button size="sm" variant="ghost" onClick={() => onBracket(code)}>Bracket</Button>
    </div>
  );
}
