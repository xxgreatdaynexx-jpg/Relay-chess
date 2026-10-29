import { useState, type FormEvent } from 'react';
import { RulesDialog } from '@/components/RulesDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { request, socket } from '@/lib/net';
import { loadSession, prettyCode, saveSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CLOCK_PRESETS, type ClockId } from '../../../shared/types';

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
  const [busy, setBusy] = useState<'create' | 'join' | 'return' | null>(null);
  const [localError, setLocalError] = useState('');

  async function create(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    setBusy('create');
    socket.connect();
    const res = await request('create_room', { name, clockId }, (ack) => {
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
    setLocalError('');
    setBusy('join');
    socket.connect();
    const res = await request('join_room', { name, code }, (ack) => {
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
        <p className="text-xs tracking-[0.2em] text-brass uppercase">Two teams · four seats</p>
        <h1 className="mt-2 max-w-xl font-serif text-5xl leading-[0.95] text-cream sm:text-6xl">
          Take turns on the same side.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-cream-dim">
          White 1, Black 1, White 2, Black 2. Partners share a color, and every ordinary chess rule still applies.
        </p>
        <ol className="mt-5 flex flex-wrap items-center gap-2 text-sm text-cream">
          {['White 1', 'Black 1', 'White 2', 'Black 2'].map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className="rounded-full border border-white/15 px-3 py-1">{label}</span>
              {index < 3 && <span className="text-cream/40">→</span>}
            </li>
          ))}
        </ol>
        {saved && (
          <div className="mt-6">
            <Button variant="outline" onClick={returnToTable} disabled={busy !== null}>
              {busy === 'return' ? 'Reconnecting…' : `Return to ${prettyCode(saved.code)}`}
            </Button>
          </div>
        )}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <form onSubmit={create} className="rounded-2xl border border-white/10 bg-panel/80 p-5">
            <h2 className="font-serif text-2xl">Create a table</h2>
            <p className="mt-1 text-sm text-cream-dim">You'll get a short code and a link to send.</p>
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
            <p className="mt-1 text-sm text-cream-dim">Sit in an open seat. The game starts when all four are filled.</p>
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
          </form>
        </div>
        {message && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
