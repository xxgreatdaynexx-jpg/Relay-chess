/** Chat message timestamps in Alberta time (fixed UTC-6, no DST — same clock as ALBERTA_OFFSET). */
import { ALBERTA_OFFSET } from './daynight.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ab = (ms: number) => new Date(ms + ALBERTA_OFFSET * 60000);
const dayKey = (d: Date) => Math.floor(d.getTime() / 86400000);

function clock(d: Date): string {
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Short label: "11:52 PM AB" today, "Yesterday 11:52 PM AB", "Oct 30 11:52 PM AB" this year, else "Oct 30, 2025 11:52 PM AB". */
export function chatTimeLabel(at: number, now: number = Date.now()): string {
  const d = ab(at), n = ab(now);
  const diff = dayKey(n) - dayKey(d);
  const t = `${clock(d)} AB`;
  if (diff <= 0) return t;
  if (diff === 1) return `Yesterday ${t}`;
  const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? `${md} ${t}` : `${md}, ${d.getUTCFullYear()} ${t}`;
}

/** Full hover text: "Sun, Nov 1, 2026, 11:52 PM AB (UTC-6)". */
export function chatTimeFull(at: number): string {
  const d = ab(at);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${clock(d)} AB (UTC-6)`;
}
