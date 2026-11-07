import { Children, Fragment, cloneElement, forwardRef, isValidElement, useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';

const MOBILE = '(max-width: 640px), (max-height: 500px)';
// Flatten conditional fragments (Fort/airport branches), never arbitrary child components.
function nodes(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((n, i) => {
    const key = `${prefix}${i}.`;
    if (isValidElement<{ children?: ReactNode }>(n) && n.type === Fragment) return nodes(n.props.children, key);
    return [isValidElement(n) ? cloneElement(n, { key }) : n];
  });
}
/** Same div/children on desktop. Mobile: header and scroll body are SIBLINGS.
 * Close uses its original callback in normal header flow, never viewport-fixed inside a scroller. */
export const MapSheet = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { heading?: ReactNode }>(function MapSheet({ children, heading, className, ...props }, ref) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE).matches);
  useEffect(() => {
    const q = window.matchMedia(MOBILE); const change = () => setMobile(q.matches);
    change(); q.addEventListener('change', change); return () => q.removeEventListener('change', change);
  }, []);
  if (!mobile) return <div {...props} className={className} ref={ref}>{children}</div>;
  const all = nodes(children);
  const existing = all.find((n) => isValidElement(n) && n.type === 'header');
  const close = all.find((n) => isValidElement<{ className?: string }>(n) && /(?:world-deed-x|world-casino-x)/.test(n.props.className ?? ''));
  const title = all.find((n) => isValidElement<{ className?: string }>(n) && (n.type === 'h3' || /(?:grocery-front|cityhall-front)/.test(n.props.className ?? '')));
  const body = all.filter((n) => n !== existing && n !== close && n !== title);
  const headerProps = { className: 'map-sheet-header', onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
  return <div {...props} className={`${className ?? ''} map-sheet`} ref={ref}>
    {isValidElement<{ className?: string }>(existing)
      ? cloneElement(existing, { ...headerProps, className: `${existing.props.className ?? ''} map-sheet-header` })
      : <header {...headerProps}>{heading ? <h3>{heading}</h3> : title}{close}</header>}
    <div className="map-sheet-body">{body}</div>
  </div>;
});
