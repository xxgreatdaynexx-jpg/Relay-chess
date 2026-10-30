/** QA test accounts: names starting with "QA-" (any case). Their stats are recorded but hidden from public boards. */
export const isQaName = (name: unknown): boolean => typeof name === 'string' && /^qa-/i.test(name.trim());

/**
 * Leaderboard rows as a given viewer should see them. Non-QA viewers never see QA rows (so ranks/top-N are
 * computed without them); a signed-in QA viewer sees everything, with QA rows tagged `qa: true`.
 * Apply BEFORE any top-N slice.
 */
export function boardFor<T extends { name: string }>(rows: readonly T[], viewerIsQa: boolean, limit = Infinity): (T & { qa?: true })[] {
  const out = viewerIsQa
    ? rows.map((r) => (isQaName(r.name) ? { ...r, qa: true as const } : r))
    : rows.filter((r) => !isQaName(r.name));
  return out.slice(0, limit);
}
