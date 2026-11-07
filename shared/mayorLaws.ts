/** Text-only public mayor bills. No economy/admin effects are interpreted from text. */
export const LAW_TEXT_MAX = 2000;
export type MayorLawStatus = 'pending' | 'vetoed';
export interface MayorLaw { number: string; title: string; text: string; by: string; at: number; day: string; status: MayorLawStatus; vetoedBy: string | null; vetoedAt: number | null; vetoedRole: 'mayor' | 'vice' | null }
export interface MayorLawView { history: MayorLaw[]; nextBefore: string | null; submittedToday: boolean }
export const lawTitle = (number: string) => `Bill Chud ${number}`;
export function lawText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > LAW_TEXT_MAX) throw new Error('Enter 1–2,000 characters of plain text.');
  return value.trim();
}

/** Exact public rules copy (Dayne via Nora, Nov 6 6:20 PM). Explanatory only; nothing here executes laws. */
export const LAW_RULE_LINES = [
  'Only the sitting mayor can pass a bill—one per day, resetting at midnight UTC-6.',
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
