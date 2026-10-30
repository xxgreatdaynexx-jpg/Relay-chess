import { useEffect, useRef, useState } from 'react';
import { HomeScreen } from '@/components/HomeScreen';
import { LeaderboardScreen } from '@/components/Leaderboard';
import { RoomScreen } from '@/components/RoomScreen';
import { AnalysisScreen } from '@/components/AnalysisScreen';
import { CheckersAnalysisScreen } from '@/components/CheckersAnalysisScreen';
import { loadLastGame, saveLastGame, snapshotGame, type FinishedGame } from '@/lib/lastGame';
import { VolumeControl } from '@/components/VolumeControl';
import { SolitairePanel } from '@/components/SolitairePanel';
import { BlackjackPanel } from '@/components/BlackjackPanel';
import { RoulettePanel } from '@/components/RoulettePanel';
import { TopTab, TopTabs } from '@/components/TopTabs';
import { PokerPanel } from '@/components/PokerPanel';
import { SlotsPanel } from '@/components/SlotsPanel';
import { ArenaPanel } from '@/components/ArenaPanel';
import { AccountButton, AccountPanel } from '@/components/AccountPanel';
import { socket } from '@/lib/net';
import { TournamentScreen } from '@/components/TournamentScreen';
import { TournamentPing } from '@/components/TournamentPing';
import { tournamentFromLocation } from '@/lib/tournament';
import { clearSession, clearSpectate, codeFromLocation, loadSession, loadSpectate } from '@/lib/session';
import type { PublicState } from '../../shared/types';

export function App() {
  const saved = loadSession();
  const initialCode = codeFromLocation();
  const watchingCode = loadSpectate();
  const shouldRejoin = Boolean(
    initialCode && ((saved && initialCode === saved.code) || watchingCode === initialCode),
  );
  const [state, setState] = useState<PublicState | null>(null);
  const [booting, setBooting] = useState(shouldRejoin);
  const [homeError, setHomeError] = useState('');
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(true);
  const [homeKey, setHomeKey] = useState(0);
  const [path, setPath] = useState(() => window.location.pathname);
  const inflight = useRef(false);
  const [lastGame, setLastGame] = useState<FinishedGame | null>(() => loadLastGame());
  const [analysis, setAnalysis] = useState<FinishedGame | null>(null);

  // Keep the finished game client-side so analysis works after the room closes.
  useEffect(() => {
    if (!state || state.status !== 'ended') return;
    const snap = snapshotGame(state);
    if (!snap) return;
    setLastGame((prev) => {
      if (prev && prev.code === snap.code && prev.moves.length === snap.moves.length && prev.headline === snap.headline) return prev;
      saveLastGame(snap);
      return snap;
    });
  }, [state]);

  function leaveRoom() {
    if (!state) return;
    inflight.current = true;
    socket.emit('leave_table', {}, () => {
      inflight.current = false;
    });
    if (state.spectating) clearSpectate();
    else clearSession();
    setState(null);
    setHomeKey((value) => value + 1);
    window.history.pushState({}, '', '/');
    setPath('/');
  }

  function openLeaderboard() {
    window.history.pushState({}, '', '/leaderboard');
    setPath('/leaderboard');
  }

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3400);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    function onState(next: PublicState) {
      if (next.spectating) {
        if (loadSpectate() !== next.code) return;
      } else {
        const session = loadSession();
        if (!session || session.code !== next.code) return;
      }
      if (codeFromLocation() && codeFromLocation() !== next.code) return;
      setState(next);
      setBooting(false);
    }
    function onConnect() {
      setOnline(true);
      if (inflight.current) return;
      const spectating = loadSpectate();
      const urlNow = codeFromLocation();
      if (spectating && (!urlNow || urlNow === spectating)) {
        socket.timeout(8000).emit('spectate', { code: spectating }, (error: Error | null, ack?: { ok: boolean; error?: string }) => {
          if (error || !ack?.ok) {
            clearSpectate();
            setState(null);
            setBooting(false);
            setHomeError(ack?.error || 'That table is no longer available.');
            setHomeKey((value) => value + 1);
          }
        });
        return;
      }
      const session = loadSession();
      const urlCode = codeFromLocation();
      if (!session || (urlCode && urlCode !== session.code)) return;
      socket.timeout(8000).emit('rejoin', { code: session.code, token: session.token }, (error: Error | null, ack?: { ok: boolean; error?: string }) => {
        if (error || !ack?.ok) {
          clearSession();
          setState(null);
          setBooting(false);
          setHomeError(ack?.error || 'That table is no longer available.');
          setHomeKey((value) => value + 1);
        }
      });
    }
    function onDisconnect() {
      setOnline(false);
    }
    function onGameError(payload: { message?: string; fatal?: boolean }) {
      if (payload.fatal) {
        if (loadSpectate()) clearSpectate();
        else clearSession();
        setState(null);
        setBooting(false);
        setHomeError(payload.message || 'This table expired.');
        setHomeKey((value) => value + 1);
        window.history.pushState({}, '', '/');
        return;
      }
      if (payload.message) setToast(payload.message);
    }
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('game_error', onGameError);
    if (shouldRejoin) socket.connect();
    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('game_error', onGameError);
    };
  }, [shouldRejoin]);

  useEffect(() => {
    function onPop() {
      setPath(window.location.pathname);
      if (window.location.pathname === '/leaderboard') return;
      const session = loadSession();
      if (session && state && !state.spectating && codeFromLocation() !== session.code && window.location.pathname === '/') {
        window.history.pushState({}, '', `/r/${session.code}`);
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [state]);

  const leaderboard = path === '/leaderboard';
  const tournamentCode = path.startsWith('/t/') ? tournamentFromLocation() : '';
  const goHome = () => {
    window.history.pushState({}, '', '/');
    setPath('/');
    setHomeKey((value) => value + 1);
  };
  const enteredRoom = () => {
    setPath(window.location.pathname);
    socket.connect();
  };

  return (
    <>
      <TopTabs />
      <VolumeControl />
      <div className="app-panels">
        <BlackjackPanel />
        <RoulettePanel />
        <PokerPanel />
        <SlotsPanel />
        <SolitairePanel />
        <ArenaPanel />
      </div>
      <AccountPanel />
      <TopTab id="account"><AccountButton /></TopTab>
      {leaderboard ? (
        <LeaderboardScreen
          onBack={() => {
            window.history.back();
          }}
          onMainMenu={() => {
            window.history.pushState({}, '', '/');
            setPath('/');
          }}
        />
      ) : tournamentCode && !state ? (
        <TournamentScreen key={tournamentCode} code={tournamentCode} onHome={goHome} onEnterRoom={enteredRoom} />
      ) : booting && !state ? (
        <div className="grid min-h-dvh place-items-center px-6 text-center">
          <div>
            <p className="font-serif text-3xl italic">Returning to your seat…</p>
            <p className="mt-2 text-sm text-cream-dim">The table is still here if the server is.</p>
          </div>
        </div>
      ) : analysis && analysis.gameType === 'checkers' ? (
        <CheckersAnalysisScreen game={analysis} onBack={() => setAnalysis(null)} onMainMenu={() => { setAnalysis(null); if (state) leaveRoom(); }} />
      ) : analysis ? (
        <AnalysisScreen
          game={analysis}
          inRoom={Boolean(state)}
          onBack={() => setAnalysis(null)}
          onMainMenu={() => {
            setAnalysis(null);
            if (state) leaveRoom();
          }}
        />
      ) : state ? (
        <RoomScreen
          state={state}
          online={online}
          onToast={setToast}
          onLeave={leaveRoom}
          onLeaderboard={openLeaderboard}
          onAnalyze={() => {
            const snap = snapshotGame(state);
            if (snap) setAnalysis(snap);
          }}
        />
      ) : (
        <HomeScreen
          key={homeKey}
          initialCode={initialCode}
          error={homeError}
          onEnter={() => {
            socket.connect();
          }}
          onLeaderboard={openLeaderboard}
          onTournament={(code) => {
            window.history.pushState({}, '', `/t/${code}`);
            setPath(`/t/${code}`);
          }}
        />
      )}
      <TournamentPing
        currentRoom={state?.code ?? null}
        onBracket={(code) => {
          if (state) leaveRoom();
          window.history.pushState({}, '', `/t/${code}`);
          setPath(`/t/${code}`);
        }}
        onEnterRoom={() => {
          setState(null);
          enteredRoom();
        }}
      />
      {!state && !analysis && !leaderboard && !booting && lastGame && (
        <button
          className="fixed bottom-16 left-1/2 z-40 hidden -translate-x-1/2 rounded-full md:block border border-white/15 bg-panel/90 px-4 py-2 text-sm text-cream shadow-lg hover:bg-panel"
          onClick={() => setAnalysis(lastGame)}
          data-testid="analyze-last"
        >
          Analyze last game ({lastGame.mode} · {lastGame.headline})
        </button>
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-cream shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
