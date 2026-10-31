import { BuildTag, ChangelogButton } from './Changelog';
import { RequestsButton } from './Requests';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { loadAuth, useAccount } from '@/lib/auth';
import { openAccount } from '@/lib/settings';
import { TopTab } from '@/components/TopTabs';
import type { Activity, ChatMessage, OnlineSnapshot, OnlineUser } from '../../../shared/chat';
import { CHAT_MAX_LEN } from '../../../shared/chat';

const SEEN_KEY = 'relay-chat-seen';
const OPEN_KEY = 'relay-chat-open';
const PANELS: Array<[Activity, string]> = [
  ['blackjack', '.bj-wrap.bj-open'], ['roulette', '.rl-wrap.rl-open'], ['poker', '[data-testid="poker"].cx-open'],
  ['slots', '[data-testid="slots"].cx-open'], ['solitaire', '.sol-wrap.sol-open'], ['arena', '.fps-wrap.fps-open'],
];
const openActivities = (): Activity[] => PANELS.filter(([, sel]) => document.querySelector(sel)).map(([a]) => a);
const readSeen = (): number | null => { try { const v = localStorage.getItem(SEEN_KEY); return v ? Number(v) : null; } catch { return null; } };
const writeSeen = (id: number) => { try { localStorage.setItem(SEEN_KEY, String(id)); } catch { /* blocked */ } };
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

interface Profile { chess?: { wins: number; losses: number; draws: number }; arena?: { kills: number; deaths: number; kd: number } }

export function ChatDrawer() {
  const me = useAccount();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  const [online, setOnline] = useState<OnlineSnapshot>({ users: [], guests: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<OnlineUser | { name: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* blocked */ } }, [open]);

  useEffect(() => {
    let lastActs = '';
    const report = (force = false) => {
      const acts = openActivities();
      const key = acts.join(',');
      if (!socket.connected || (!force && key === lastActs)) return;
      lastActs = key;
      socket.emit('presence', { activities: acts });
    };
    const onConnect = () => {
      report(true);
      socket.emit('online_get', {}, (r?: { ok: boolean } & OnlineSnapshot) => { if (r?.ok) setOnline({ users: r.users, guests: r.guests }); });
      socket.emit('chat_history', {}, (r?: { ok: boolean; messages: ChatMessage[] }) => {
        if (!r?.ok) return;
        setMessages(r.messages);
        const last = r.messages[r.messages.length - 1]?.id ?? 0;
        const seen = readSeen();
        if (seen === null || openRef.current) { writeSeen(last); setUnread(0); }
        else setUnread(Math.min(99, r.messages.filter((m) => m.id > seen).length));
      });
    };
    const onOnline = (s: OnlineSnapshot) => setOnline(s);
    const onMsg = (m: ChatMessage) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-200)));
      if (openRef.current) writeSeen(m.id);
      else if (m.name !== loadAuth()?.name) setUnread((n) => Math.min(99, n + 1));
    };
    socket.on('connect', onConnect);
    socket.on('online', onOnline);
    socket.on('chat_msg', onMsg);
    if (socket.connected) onConnect(); else socket.connect();
    const t = window.setInterval(() => report(), 2500);
    return () => { socket.off('connect', onConnect); socket.off('online', onOnline); socket.off('chat_msg', onMsg); window.clearInterval(t); };
  }, []);

  // Re-fetch (QA visibility depends on who is signed in) after sign-in/out; the server reconnect picks up the new identity.
  useEffect(() => {
    if (!socket.connected) return;
    socket.emit('chat_history', {}, (r?: { ok: boolean; messages: ChatMessage[] }) => { if (r?.ok) setMessages(r.messages); });
    socket.emit('online_get', {}, (r?: { ok: boolean } & OnlineSnapshot) => { if (r?.ok) setOnline({ users: r.users, guests: r.guests }); });
  }, [me]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const last = messages[messages.length - 1];
    if (last) writeSeen(last.id);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (picked) setPicked(null); else setOpen(false); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, picked]);

  async function pick(u: OnlineUser | { name: string }) {
    setPicked(u);
    setProfile(null);
    const headers: Record<string, string> = {};
    const tok = loadAuth()?.token;
    if (tok) headers['X-Relay-Session'] = tok;
    const get = async (url: string) => { try { return ((await (await fetch(url, { headers })).json()) as { rows: Array<Record<string, unknown> & { name: string }> }).rows; } catch { return []; } };
    const [chess, arena] = await Promise.all([get('/api/leaderboard'), get('/api/arena-leaderboard')]);
    const same = (r: { name: string }) => r.name.toLowerCase() === u.name.toLowerCase();
    const c = chess.find(same) as Profile['chess'] | undefined;
    const a = arena.find(same) as Profile['arena'] | undefined;
    setProfile({ chess: c, arena: a });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    socket.timeout(8000).emit('chat_send', { text }, (err: Error | null, r?: { ok: boolean; error?: string }) => {
      if (err || !r) return setError('No response from the server.');
      if (!r.ok) return setError(r.error || 'Could not send.');
      setError('');
      setDraft('');
    });
  }

  const pickedUser = picked && 'where' in picked ? picked : online.users.find((u) => picked && u.name.toLowerCase() === picked.name.toLowerCase());

  return (
    <>
      <TopTab id="chat">
        <button type="button" className="chat-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="chat-tab" aria-label={`Chat and online players${unread ? `, ${unread} unread` : ''}`}>
          <span aria-hidden="true">💬</span><span className="chat-tab-label">Chat</span>
          <span className="chat-tab-count" data-testid="chat-online-count">{online.users.length + online.guests}</span>
          {unread > 0 && !open && <span className="chat-badge" data-testid="chat-unread">{unread}</span>}
        </button>
      </TopTab>
      {open && (
        <aside className="chat-drawer" data-testid="chat-drawer" aria-label="Online players and chat">
          <div className="chat-head">
            <b>Online <span className="chat-dim">({online.users.length}{online.guests ? ` + ${online.guests} guest${online.guests === 1 ? '' : 's'}` : ''})</span></b>
            <RequestsButton />
            <ChangelogButton />
            <button type="button" className="acct-close" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
          </div>
          <BuildTag />
          <ul className="chat-online" data-testid="chat-online">
            {online.users.length === 0 && <li className="chat-dim">No one signed in right now.</li>}
            {online.users.map((u) => (
              <li key={u.name}>
                <button type="button" className="chat-user" onClick={() => void pick(u)} data-testid="chat-user">
                  <span className="chat-dot" aria-hidden="true" />
                  <span className="chat-uname">{u.name}{u.name === me && <span className="chat-dim"> (you)</span>}{u.qa && <span className="chat-qa">QA</span>}</span>
                  <span className="chat-where">{u.where}</span>
                </button>
              </li>
            ))}
          </ul>
          {picked && (
            <div className="chat-profile" data-testid="chat-profile">
              <div className="chat-head"><b>{picked.name}</b><button type="button" className="acct-close" aria-label="Close profile" onClick={() => setPicked(null)}>✕</button></div>
              <div className="chat-dim">{pickedUser ? pickedUser.where : 'Offline'}</div>
              {!profile ? <div className="chat-dim">Loading stats…</div> : (
                <div className="chat-stats">
                  <span>Chess: {profile.chess ? `${profile.chess.wins}W ${profile.chess.losses}L ${profile.chess.draws}D` : 'no rated games'}</span>
                  <span>Arena: {profile.arena ? `${profile.arena.kills} kills · K/D ${profile.arena.kd}` : 'no matches'}</span>
                </div>
              )}
              {pickedUser?.table && pickedUser.name !== me && (
                <a className="chat-join" href={`/r/${pickedUser.table.code}`} data-testid="chat-join">
                  {pickedUser.table.watching ? 'Watch with them' : 'Join / watch their table'} ({pickedUser.table.code})
                </a>
              )}
            </div>
          )}
          <div className="chat-head chat-head-2"><b>Chat</b></div>
          <div className="chat-log" ref={listRef} data-testid="chat-log" aria-live="polite">
            {messages.length === 0 && <div className="chat-dim">No messages yet. Say hi!</div>}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg${m.name === me ? ' mine' : ''}`}>
                <button type="button" className="chat-from" onClick={() => void pick({ name: m.name })}>{m.name}</button>
                {m.qa && <span className="chat-qa">QA</span>}
                <time className="chat-time" dateTime={new Date(m.at).toISOString()}>{time(m.at)}</time>
                <div className="chat-text">{m.text}</div>
              </div>
            ))}
          </div>
          {me ? (
            <form className="chat-form" onSubmit={send}>
              <input value={draft} maxLength={CHAT_MAX_LEN} onChange={(e) => setDraft(e.target.value)} placeholder="Message everyone…" aria-label="Chat message" data-testid="chat-input" />
              <button type="submit" disabled={!draft.trim()} data-testid="chat-send">Send</button>
            </form>
          ) : (
            <div className="chat-form chat-dim">
              <button type="button" className="account-link" onClick={() => openAccount()}>Sign in or claim a name</button>&nbsp;to chat.
            </div>
          )}
          {error && <div className="chat-error" role="alert">{error}</div>}
          {draft.length > CHAT_MAX_LEN - 50 && <div className="chat-dim chat-count">{draft.length}/{CHAT_MAX_LEN}</div>}
        </aside>
      )}
    </>
  );
}
