import { lazy, type ComponentType } from 'react';
import { importWithReload } from './chunkReload';

/** React.lazy that reloads the tab once if the chunk is gone after a deploy (instead of a blank screen). Use for every lazy(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  return lazy(() => importWithReload(load));
}
