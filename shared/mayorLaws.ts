/** Text-only public mayor bills. No economy/admin effects are interpreted from text. */
export const LAW_TEXT_MAX = 2000;
export interface MayorLaw { number: string; title: string; text: string; by: string; at: number; day: string; status: 'pending' }
export interface MayorLawView { history: MayorLaw[]; nextBefore: string | null; submittedToday: boolean }
export const lawTitle = (number: string) => `Bill Chud ${number}`;
export function lawText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > LAW_TEXT_MAX) throw new Error('Enter 1–2,000 characters of plain text.');
  return value.trim();
}

/** Exact Dayne-approved explanatory copy; not an execution or veto mechanism. */
export const LAW_RULES = 'Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.';
