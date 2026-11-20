import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@/lib/auth';
import { usePanelDrag } from '@/lib/panelDrag';
import { ISLAND_DOCK, ISLAND_LOTS } from '../../../shared/island';
import { IslandFlatMap, useIslandOwners } from './IslandFlatMap';

const fmt = (n: number) => n.toLocaleString('en-US');

/** Look at the Private Island from Chud Hub: the same 2D map, read-only. Buying and visiting happen on the island. */
export function IslandPreview({ onClose, onTravel, travelLabel, canTravel }: { onClose: () => void; onTravel: () => void; travelLabel: string; canTravel: boolean }) {
  const me = useAccount();
  const [owners] = useIslandOwners();
  const [sel, setSel] = useState<string | null>(null);
  const drag = usePanelDrag<HTMLDivElement>('islandMap');
  const lot = sel ? ISLAND_LOTS.find((l) => l.id === sel) : null; const owner = sel ? owners.get(sel) : undefined;
  const mine = !!owner && !!me && owner.toLowerCase() === me.toLowerCase();
  return createPortal(
    <div className="island-preview" data-testid="island-preview">
      <div className="island-preview-box" role="dialog" aria-label="Private Island map" data-drag-panel="islandMap" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <header><h3>🗺️ Private Island map</h3><button type="button" onClick={onClose} aria-label="Close" data-testid="island-preview-x">✕</button></header>
        <IslandFlatMap owners={owners} me={me} selected={sel} onPick={setSel} />
        <footer data-testid="island-preview-info">
          {lot ? <span><b>{lot.label}</b> · {owner ? (mine ? 'yours' : `owned by ${owner}`) : `for sale · 🪙 ${fmt(lot.price)}`}. Travel to the island to {owner ? 'visit' : 'buy'} it.</span>
            : sel === ISLAND_DOCK.id ? <span><b>{ISLAND_DOCK.icon} {ISLAND_DOCK.label}</b> · where you land. The island is reached by Sovereign Megayacht or your own jet.</span>
            : <span>Tap an estate or the dock.</span>}
          <button type="button" disabled={!canTravel} onClick={onTravel} data-testid="island-preview-travel">{travelLabel}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
