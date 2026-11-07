/** Test helper: give named players a built factory (freight now requires sender + recipient factories). */
import type { MinesWorld } from '../../server/mines';
export function withFactories(m: MinesWorld, ...names: string[]): MinesWorld {
  for (const n of names) m.factories.set(n.toLowerCase(), { level: 1, builtAt: 0, jobs: [] } as never);
  return m;
}
export const QA_SHIPPERS = ['QA-A', 'QA-B', 'QA-Big', 'QA-Cg', 'QA-Friend', 'QA-Hauler', 'QA-JetCg', 'QA-Map', 'QA-Old', 'QA-Pilot', 'QA-Poor', 'QA-Pub', 'QA-Ship', 'QA-Small', 'QA-X'];
