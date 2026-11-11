import { createPortal } from 'react-dom';
import { useRef, type ReactNode } from 'react';
import { useDoing } from '@/lib/doing';
import type { DoingKind } from '../../../shared/doing';
import { useBuildingWindow } from '@/lib/useBuildingWindow';
import { BUILDING_WINDOW_META, portalTarget, type BuildingWindowId } from '@/lib/buildingWindows';

/** Portaled, stackable, draggable building menu with a title bar and close button. */
export function HubWindow({
  id, title, testId, onClose, children, className, doing, doingDetail,
}: {
  id: BuildingWindowId;
  title?: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  doing?: DoingKind;
  doingDetail?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const win = useBuildingWindow(id, ref, onClose);
  useDoing(doing ?? 'idle', doingDetail, !!doing && win.isFront);
  const label = title ?? BUILDING_WINDOW_META[id].tab;
  return createPortal(
    <div
      ref={ref}
      className={`sol-panel hub-win hub-win-${id}${className ? ` ${className}` : ''}${win.className}`}
      style={win.style}
      onPointerDownCapture={win.front}
      onPointerMove={win.onPanelMove}
      role="dialog"
      aria-label={BUILDING_WINDOW_META[id].label}
      data-testid={testId}
      data-drag-panel={id}
      data-front={win.isFront ? '1' : undefined}
    >
      {win.grips}
      <div {...win.bar} className="sol-bar hub-win-bar">
        <span className="font-semibold">{label}</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
        <button type="button" className="ml-auto" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="hub-win-body">{children}</div>
    </div>,
    portalTarget(),
  );
}
