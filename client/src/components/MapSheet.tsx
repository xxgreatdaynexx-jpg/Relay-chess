import { Children, Fragment, cloneElement, forwardRef, isValidElement, type HTMLAttributes, type PointerEvent as RE, type ReactNode } from 'react';

// Flatten conditional fragments (Fort/airport branches), never arbitrary child components.
function nodes(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((n, i) => {
    const key = `${prefix}${i}.`;
    if (isValidElement<{ children?: ReactNode }>(n) && n.type === Fragment) return nodes(n.props.children, key);
    return [isValidElement(n) ? cloneElement(n, { key }) : n];
  });
}

/** Header (title + ✕) and scroll body are SIBLINGS on every viewport, so the close button stays visible
 *  when the content is taller than the panel. Close uses its original callback, never viewport-fixed
 *  inside a scroller. Visual full-screen sheet treatment remains a mobile CSS concern. */
export const MapSheet = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { heading?: ReactNode }>(function MapSheet({ children, heading, className, ...props }, ref) {
  const all = nodes(children);
  const existing = all.find((n) => isValidElement(n) && n.type === 'header');
  const close = all.find((n) => isValidElement<{ className?: string }>(n) && /(?:world-deed-x|world-casino-x)/.test(n.props.className ?? ''));
  const title = all.find((n) => isValidElement<{ className?: string }>(n) && (n.type === 'h3' || /(?:grocery-front|cityhall-front|employ-front)/.test(n.props.className ?? '')));
  const handle = all.find((n) => isValidElement<{ className?: string }>(n) && (n.props.className ?? '').includes('panel-drag-handle'));
  const body = all.filter((n) => n !== existing && n !== close && n !== title && n !== handle);
  const headerProps = { className: 'map-sheet-header', onPointerDown: (e: RE<HTMLElement>) => e.stopPropagation() };
  return <div {...props} className={`${className ?? ''} map-sheet`} ref={ref}>
    {isValidElement<{ className?: string }>(existing)
      ? cloneElement(existing, { ...headerProps, className: `${existing.props.className ?? ''} map-sheet-header` })
      : <header {...headerProps}>{handle}{heading ? <h3>{heading}</h3> : title}{close}</header>}
    <div className="map-sheet-body">{existing ? (handle ? [handle, ...body] : body) : body}</div>
  </div>;
});
