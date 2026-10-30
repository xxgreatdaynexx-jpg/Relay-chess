export interface Session {
  token: string;
  code: string;
  name: string;
}

const KEY = 'relay-chess-session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.token || !parsed.code || !parsed.name) return null;
    return { token: parsed.token, code: parsed.code, name: parsed.name };
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  clearSpectate();
  localStorage.setItem(KEY, JSON.stringify(session));
}

const SPECTATE_KEY = 'relay-chess-spectate';

/** Table code this tab is watching read-only, if any. Per tab, so other tabs keep their seats. */
export function loadSpectate(): string | null {
  try {
    return sessionStorage.getItem(SPECTATE_KEY);
  } catch {
    return null;
  }
}

export function saveSpectate(code: string) {
  try {
    sessionStorage.setItem(SPECTATE_KEY, code);
  } catch {
    /* ignore */
  }
}

export function clearSpectate() {
  try {
    sessionStorage.removeItem(SPECTATE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function codeFromLocation(loc: Location = window.location): string {
  const match = loc.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  if (match) return match[1].toUpperCase();
  const query = new URLSearchParams(loc.search).get('room');
  if (query && /^[A-Za-z0-9]{4,8}$/.test(query)) return query.toUpperCase();
  return '';
}

export function prettyCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
