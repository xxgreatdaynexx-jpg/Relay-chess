import { useEffect, useState } from 'react';
import {
  BUILDING_WINDOW_META,
  focusBuildingWindow,
  listBuildingWindows,
  subscribeBuildingWindows,
  type BuildingWindowId,
} from '@/lib/buildingWindows';
import { isFrontWindow } from '@/lib/windowDrag';

/** Tab strip of open building windows. On a phone the hidden (behind) windows are only reachable from here. */
export function BuildingWindowDock() {
  const [ids, setIds] = useState<BuildingWindowId[]>([]);
  const [front, setFront] = useState<BuildingWindowId | null>(null);
  useEffect(() => {
    const sync = () => {
      const open = listBuildingWindows();
      setIds(open.map((e) => e.id));
      const top = [...open].reverse().find((e) => isFrontWindow(e.el));
      setFront(top?.id ?? open[open.length - 1]?.id ?? null);
    };
    sync();
    return subscribeBuildingWindows(sync);
  }, []);
  if (ids.length < 2) return null;
  return (
    <nav className="hub-win-dock" data-testid="building-window-dock" aria-label="Open menus">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className={id === front ? 'on' : ''}
          aria-pressed={id === front}
          data-testid={`building-dock-${id}`}
          onClick={() => focusBuildingWindow(id)}
        >
          {BUILDING_WINDOW_META[id].tab}
        </button>
      ))}
    </nav>
  );
}
