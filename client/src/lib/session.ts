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
  localStorage.setItem(KEY, JSON.stringify(session));
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
