import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isFrontWindow, useWindowDrag } from './windowDrag';
import { registerBuildingWindow, subscribeBuildingWindows, type BuildingWindowId } from './buildingWindows';

/**
 * Window chrome + stack registration for a building menu. Click brings it to the front;
 * Escape (handled globally) closes only the front window.
 */
export function useBuildingWindow(id: BuildingWindowId, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const win = useWindowDrag(id, ref);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [isFront, setFront] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerBuildingWindow(id, el, () => closeRef.current());
  }, [id, ref]);
  useEffect(() => {
    const sync = () => setFront(isFrontWindow(ref.current));
    sync();
    return subscribeBuildingWindows(sync);
  }, [ref]);
  return { ...win, isFront };
}
