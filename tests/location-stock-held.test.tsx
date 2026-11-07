// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
const view = { now: 1, locations: [], shipments: [], trucks: [], quarantined: [], held: [
  { kind: 'fish', what: 'bass', n: 2, value: 50, why: 'caught before map tracking: no recorded map' },
  { kind: 'prepared', what: 'bass (fillet)', n: 1, value: 90, why: 'prepared before map tracking: no recorded map' },
  { kind: 'fillet', what: 'fillet_cod', n: 4, why: 'shared cutting board: no map' },
] };
vi.mock('@/lib/net', () => ({ request: vi.fn(async () => ({ ok: true, view })), socket: { on: () => {}, off: () => {} } }));
import { LocationStock } from '../client/src/components/LocationStock';
afterEach(cleanup);
it('renders held legacy items read-only with identity, count, value and reason', async () => {
  render(createElement(LocationStock, { me: 'A' }));
  const items = await screen.findAllByTestId('loc-held-item');
  expect(items.map((i) => i.textContent)).toEqual([
    'Fish: bass × 2 (value 50) caught before map tracking: no recorded map',
    'Prepared fish: bass (fillet) × 1 (value 90) prepared before map tracking: no recorded map',
    'Fillets: fillet_cod × 4 shared cutting board: no map',
  ]);
  expect(screen.getByTestId('loc-held-legacy').querySelectorAll('button,input,select').length).toBe(0);
});
