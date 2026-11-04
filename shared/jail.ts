/** Admin jail (pt1478u): shared rules for the server, the jail screen and the map. */
export const JAIL_PHRASE = "I'm sorry grok.";
export const JAIL_LINES_NEEDED = 10_000;
export const JAIL_MIN_GAP_MS = 450; // ~1 submit per 0.5 s
/** Jail compound (pt1495u): bottom-right (south-east) corner of the map, south of the far-shore road and west of the
 * east road. w/d are the cell block in model units; the map draws it at JAIL_SCALE and turned (rot) so the bars face the road. */
export const JAIL_SITE = { x: 174, z: 172, w: 22, d: 16, rot: Math.PI };
export const JAIL_SCALE = 1.4;
/** World footprint of the whole compound (yard slab included): half extents on x and z. */
export const JAIL_HALF = { x: ((JAIL_SITE.w + 4) * JAIL_SCALE) / 2, z: ((JAIL_SITE.d + 4) * JAIL_SCALE) / 2 };


export interface JailInfo { name: string; reason: string; until: number | null; typed: number; needed: number; at: number }

/** Exact phrase check. One line only; curly apostrophes from phone keyboards count as the plain one. */
export function isApology(text: unknown): boolean {
  if (typeof text !== 'string' || /[\r\n]/.test(text)) return false;
  return text.replace(/[\u2018\u2019\u02bc]/g, "'") === JAIL_PHRASE;
}

/** Events a jailed player may still send: sign-in, settings, chat, popups, the jail screen and read-only views. */
const ALLOWED = /^(auth_\w+|settings_get|settings_save|chat_history|chat_send|presence|online_get|popup_pending|popup_ack|jail_\w+|wallet_sub|disconnect|daily_report_get|skills_get|skills_hiscores|casino_board|casino_me|open_tables|watch_tables|unwatch_tables|stk_list|stk_company|stk_portfolio|re_mine|farm_view|fish_state|fac_state)$/;
export const jailAllows = (event: string): boolean => ALLOWED.test(event);

export function jailMessage(j: Pick<JailInfo, 'until' | 'reason' | 'typed' | 'needed'>): string {
  const when = j.until == null ? 'you finish your lines' : new Date(j.until).toLocaleString('en-CA', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CST';
  return `You're in jail until ${when} (${j.typed.toLocaleString('en-US')} / ${j.needed.toLocaleString('en-US')} lines). Reason: ${j.reason}`;
}
