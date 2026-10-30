import { useState, type ReactNode } from 'react';

/** Left-wall stack holding every gambling tab. On phones it collapses into one "Casino" tab. */
export function CasinoDock({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`casino-dock ${expanded ? 'dock-expanded' : ''}`} data-testid="casino-dock">
      <button type="button" className="sol-tab dock-toggle" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>🎲 Casino</button>
      {children}
    </div>
  );
}
