/** Casino turn-timer bar (request #7): pure maths, server-clocked (now = client now + server skew). */
export const timerFraction = (deadline: number, total: number, now: number) => (total <= 0 ? 0 : Math.max(0, Math.min(1, (deadline - now) / total)));
/** Green → amber → red as the time drains. Red in the last 25%. */
export const timerColor = (frac: number) => (frac > 0.5 ? '#3fbf6a' : frac > 0.25 ? '#e0b030' : '#e04040');
