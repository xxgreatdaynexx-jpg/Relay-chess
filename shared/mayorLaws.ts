/** Text-only public mayor bills. No economy/admin effects are interpreted from text. */
export const LAW_TEXT_MAX = 2000;
export type MayorLawStatus = 'pending' | 'vetoed' | 'denied' | 'pending_approval' | 'rejected' | 'expired';
export const MAX_PENDING_LAW_DRAFTS = 3;
export const LAW_REJECT_REASON_MAX = 200;
export const LAW_DENY_REASON_MAX = 2000;
export const LAW_RULE_NOTE_MAX = 2000;
export const LAW_RULE_NOTE_HEADING = 'Rules review: this bill would not be allowed because:';
export interface BillImplementation { status: 'enacted'; revision: 1; implementedAt: number; release: string; text: string }
export interface MayorLaw { number: string; title: string; text: string; by: string; at: number; day: string; status: MayorLawStatus; vetoedBy: string | null; vetoedAt: number | null; vetoedRole: 'mayor' | 'vice' | null; /** Public admin denial reason; official bills only. */ denyReason?: string | null; deniedAt?: number | null; /** Public note on a vetoed or denied official bill; does not change status. */ ruleNote?: string | null; ruleNotedAt?: number | null; /** Separate release-backed implementation; original fields remain archival. */ implementation?: BillImplementation; /** Set when this official bill was a vice-mayor draft the mayor approved. */ draftedBy?: string | null; approvedBy?: string | null; draftId?: string; rejectReason?: string | null }
export interface MayorLawView { history: MayorLaw[]; nextBefore: string | null; submittedToday: boolean; pendingDrafts?: MayorLaw[]; pendingDraftCount?: number }
export const lawTitle = (number: string) => `Bill Chud ${number}`;
export function lawText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > LAW_TEXT_MAX) throw new Error('Enter 1–2,000 characters of plain text.');
  return value.trim();
}
export function lawRejectReason(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Rejection reason must be plain text.');
  const s = value.trim();
  if (s.length > LAW_REJECT_REASON_MAX) throw new Error(`Rejection reason must be at most ${LAW_REJECT_REASON_MAX} characters.`);
  return s || null;
}
export function lawDenyReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A public denial reason is required.');
  const s = value.trim();
  if (s.length > LAW_DENY_REASON_MAX) throw new Error(`Denial reason must be at most ${LAW_DENY_REASON_MAX} characters.`);
  return s;
}
export function lawRuleNote(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A public note is required.');
  const s = value.trim();
  if (s.length > LAW_RULE_NOTE_MAX) throw new Error(`Public note must be at most ${LAW_RULE_NOTE_MAX} characters.`);
  return s;
}
export const parseDraftId = (v: unknown): string => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER) return String(v);
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) throw new Error('Invalid draft id.');
  return v;
};
export const draftApprovedNote = (draftedBy: string, approvedBy: string) => `Drafted by vice mayor ${draftedBy}, approved by mayor ${approvedBy}`;

/** Exact public rules copy (Dayne via Nora, Nov 6 6:20 PM). Explanatory only; nothing here executes laws. */
export const LAW_RULE_LINES = [
  'Only the sitting mayor can pass a bill—one per day, resetting at midnight UTC-6.',
  'The sitting vice mayor can draft a bill with the same form. A draft is marked Pending mayor approval: it is not the day’s bill, does not open a veto, and has no effect until the sitting mayor approves it (or rejects it, with an optional reason). At most three drafts can wait at once. Drafts expire at the end of the term. The record shows who drafted it and who approved or rejected it.',
  'Bills are publicly recorded and numbered forever, even when the mayor changes.',
  'Laws must be clear, possible to enforce, and limited to Chud Hub.',
  'No taking someone’s chips, property or items, banning players, or granting yourself rewards.',
  'The vice mayor (election runner-up) can veto a bill submitted today. The sitting mayor can veto bills from earlier days. Days reset at midnight UTC-6. Vetoed bills stay in the record marked ‘Vetoed.’ If the mayor is removed, the vice mayor becomes mayor.',
] as const;
export const LAW_CORE_RULES = 'Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.';
export const LAW_RULES = [...LAW_RULE_LINES, LAW_CORE_RULES].join('\n\n');
export const parseBillNumber = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) throw new Error('Invalid bill number.');
  return v;
};
