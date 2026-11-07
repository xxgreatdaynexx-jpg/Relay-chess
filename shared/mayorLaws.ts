/** Text-only public mayor bills. No economy/admin effects are interpreted from text. */
export const LAW_TEXT_MAX = 2000;
export interface MayorLaw { number: string; title: string; text: string; by: string; at: number; day: string; status: 'pending' }
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
] as const;
export const LAW_CORE_RULES = 'Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.';
export const LAW_RULES = [...LAW_RULE_LINES, LAW_CORE_RULES].join('\n\n');
