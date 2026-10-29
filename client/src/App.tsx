import { useEffect, useRef, useState } from 'react';
import { HomeScreen } from '@/components/HomeScreen';
import { RoomScreen } from '@/components/RoomScreen';
import { socket } from '@/lib/net';
import { clearSession, codeFromLocation, loadSession } from '@/lib/session';
import type { PublicState } from '../../shared/types';

export function App() {
  const saved = loadSession();
  const initialCode = codeFromLocation();
  const shouldRejoin = Boolean(saved && initialCode && initialCode === saved.code);
  const [state, setState] = useState<PublicState | null>(null);
  const [booting, setBooting] = useState(shouldRejoin);
  const [homeError, setHomeError] = useState('');
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(true);
  const [homeKey, setHomeKey] = useState(0);
  const inflight = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3400);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    function onState(next: PublicState) {
      const session = loadSession();
      if (!session || session.code !== next.code) return;
      if (codeFromLocation() && codeFromLocation() !== next.code) return;
      setState(next);
      setBooting(false);
    }
    function onConnect() {
      setOnline(true);
      if (inflight.current) return;
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
        clearSession();
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
      const session = loadSession();
      if (session && state && codeFromLocation() !== session.code) {
        window.history.pushState({}, '', `/r/${session.code}`);
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [state]);

  return (
    <>
      {booting && !state ? (
        <div className="grid min-h-dvh place-items-center px-6 text-center">
          <div>
            <p className="font-serif text-3xl italic">Returning to your seat…</p>
            <p className="mt-2 text-sm text-cream-dim">The table is still here if the server is.</p>
          </div>
        </div>
      ) : state ? (
        <RoomScreen
          state={state}
          online={online}
          onToast={setToast}
          onLeave={() => {
            inflight.current = true;
            socket.emit('leave_table', {}, () => {
              inflight.current = false;
            });
            clearSession();
            setState(null);
            setHomeKey((value) => value + 1);
            window.history.pushState({}, '', '/');
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
        />
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
