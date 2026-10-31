/** Change requests: shared types + validation used by server and client. */
export const REQUEST_CATEGORIES = ['Arena', 'Mines', 'Factory', 'Market', 'Casino', 'Chess', 'Other'] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];
export const REQUEST_STATUSES = ['open', 'approved', 'declined', 'in_progress', 'shipped'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABEL: Record<RequestStatus, string> = { open: 'Open', approved: 'Approved', declined: 'Declined', in_progress: 'In progress', shipped: 'Shipped' };
/** Allowed admin moves. Open → Approved/Declined → In progress → Shipped (Declined can be reopened). */
export const NEXT_STATUS: Record<RequestStatus, RequestStatus[]> = {
  open: ['approved', 'declined'], approved: ['in_progress', 'declined', 'shipped'], declined: ['open'], in_progress: ['shipped', 'approved'], shipped: [],
};
export const TITLE_MAX = 80, DETAILS_MAX = 500, PER_DAY = 3;

export interface PublicRequest {
  id: number; title: string; details: string; category: RequestCategory; author: string; status: RequestStatus;
  votes: number; voted?: boolean; createdAt: number; updatedAt: number; note?: string; changelog?: string; qa?: boolean;
}

const BAD = /\b(f+u+c+k+\w*|sh[i1]t+\w*|c+u+n+t+s?|n+[i1]+gg+(a|ah|er|uh)s?|f+a+g+(s|got+s?)?|b+[i1]+t+c+h+\w*|r+e+t+a+r+d+\w*|wh[o0]re|sl+u+t+s?|d[i1]ck(head)?s?|puss(y|ies)|cock(s|sucker)?)\b/i;
export function validateRequest(b: { title?: unknown; details?: unknown; category?: unknown }): { ok: true; title: string; details: string; category: RequestCategory } | { ok: false; error: string } {
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : '';
  const details = typeof b.details === 'string' ? b.details.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
  const category = REQUEST_CATEGORIES.find((c) => c === b.category);
  if (title.length < 6) return { ok: false, error: 'Give it a title (at least 6 characters).' };
  if (title.length > TITLE_MAX) return { ok: false, error: `Title is limited to ${TITLE_MAX} characters.` };
  if (details.length > DETAILS_MAX) return { ok: false, error: `Details are limited to ${DETAILS_MAX} characters.` };
  if (!category) return { ok: false, error: 'Pick a category.' };
  const all = `${title} ${details}`;
  if (BAD.test(all)) return { ok: false, error: 'Please keep it clean.' };
  if (/https?:\/\/|www\.|\.(com|net|gg|xyz|ru)\b/i.test(all)) return { ok: false, error: 'No links, please.' };
  if (/(.)\1{6,}/.test(all) || (title.length > 12 && title === title.toUpperCase() && /[A-Z]/.test(title))) return { ok: false, error: 'That looks like spam.' };
  return { ok: true, title, details, category };
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(['the', 'and', 'for', 'add', 'please', 'with', 'more', 'can', 'you', 'should', 'make', 'new', 'get', 'have']);
/** Titles that share most of their meaningful words with `q` (for the "similar requests" hint). */
export function similarTitles<T extends { title: string }>(q: string, list: T[], max = 3): T[] {
  const a = words(q); if (a.size === 0) return [];
  return list.map((r) => { const b = words(r.title); let n = 0; for (const w of a) if (b.has(w) || [...b].some((x) => x.startsWith(w) || w.startsWith(x))) n++; return { r, s: n / Math.max(1, Math.min(a.size, b.size)) }; })
    .filter((x) => x.s >= 0.5).sort((x, y) => y.s - x.s).slice(0, max).map((x) => x.r);
}
