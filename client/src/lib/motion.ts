/** True when the site's Reduce motion setting or the OS preference asks for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Document-space top of an element, ignoring sticky offsets (scrollIntoView on a stuck panel is a no-op). */
export function docTop(el: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
  return y;
}
