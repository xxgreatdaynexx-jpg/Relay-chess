/**
 * Minimal, classified client crash report (t2051). Only static/enumerated values are ever sent or logged:
 * where (fixed list), error class name, the bundled asset file + line:col of the top frame, browser family + major version.
 * Never the error message, stack text, URL, page path, storage, names or anything typed.
 */
export const CLIENT_ERROR_WHERE = ['app', 'account-panel', 'player-profile', 'window'] as const;
export type ClientErrorWhere = typeof CLIENT_ERROR_WHERE[number];
export interface ClientErrorReport { where: ClientErrorWhere; kind: string; frame: string; browser: string }
const KIND = /^[A-Z][A-Za-z]{0,39}$/;            // TypeError, RangeError, ...
const FRAME = /^[A-Za-z0-9_-]{1,60}\.js:\d{1,7}:\d{1,7}$/; // index-AbC123.js:12:345
const BROWSER = /^(Chrome|Safari|Firefox|Edge|Samsung|Other)\/\d{1,4}$/;
export function errorKind(e: unknown): string { const n = e instanceof Error ? e.name : ''; return KIND.test(n) ? n : 'Error'; }
/** Top frame that points at one of OUR bundled assets (/assets/<file>.js:line:col); anything else -> ''. */
export function errorFrame(stack: unknown): string {
  const m = /\/assets\/([A-Za-z0-9_-]{1,60}\.js):(\d{1,7}):(\d{1,7})/.exec(String(stack ?? '')); return m ? `${m[1]}:${m[2]}:${m[3]}` : '';
}
export function browserOf(ua: string): string {
  const m = /SamsungBrowser\/(\d+)/.exec(ua) ?? null; if (m) return `Samsung/${m[1]}`;
  const e = /Edg(?:A|iOS)?\/(\d+)/.exec(ua); if (e) return `Edge/${e[1]}`;
  const f = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua); if (f) return `Firefox/${f[1]}`;
  const c = /(?:Chrome|CriOS)\/(\d+)/.exec(ua); if (c) return `Chrome/${c[1]}`;
  const s = /Version\/(\d+)[\d.]* .*Safari\//.exec(ua); if (s) return `Safari/${s[1]}`;
  return 'Other/0';
}
/** Server-side validation: returns a clean report or null (dropped). */
export function cleanClientError(x: unknown): ClientErrorReport | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const b = x as Record<string, unknown>;
  if (typeof b.where !== 'string' || !(CLIENT_ERROR_WHERE as readonly string[]).includes(b.where)) return null;
  if (typeof b.kind !== 'string' || !KIND.test(b.kind)) return null;
  if (typeof b.frame !== 'string' || (b.frame !== '' && !FRAME.test(b.frame))) return null;
  if (typeof b.browser !== 'string' || !BROWSER.test(b.browser)) return null;
  if (Object.keys(b).length !== 4) return null;
  return { where: b.where as ClientErrorWhere, kind: b.kind, frame: b.frame, browser: b.browser };
}
