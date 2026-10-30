const KEY = 'relay:tournament';

export interface TournamentSession {
  code: string;
  hostKey?: string;
}

export function loadTournament(): TournamentSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TournamentSession) : null;
  } catch {
    return null;
  }
}
export function saveTournament(t: TournamentSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}
export function clearTournament(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function tournamentFromLocation(loc: Location = window.location): string {
  const m = /^\/t\/([A-Za-z0-9]{4,10})/.exec(loc.pathname);
  return m ? m[1]!.toUpperCase() : '';
}

const HOW: Record<string, string> = { win: '', 'draw-time': 'draw · less time', forfeit: 'forfeit', bye: 'bye' };
export const howLabel = (how: string | null) => (how ? HOW[how] ?? how : '');
