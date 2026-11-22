// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BetAmountInput } from '../client/src/components/CasinoCommon';
import { CASINO_MAX_BET } from '../shared/casino-bet';

afterEach(() => cleanup());

function Harness({ min = 20, max = CASINO_MAX_BET, balance = 50_000_000, start = 20 }: { min?: number; max?: number; balance?: number; start?: number }) {
  const [bet, setBet] = useState(start);
  return createElement('div', null,
    createElement(BetAmountInput, { value: bet, min, max, balance, onChange: setBet, testId: 'custom-bet' }),
    createElement('div', { 'data-testid': 'val' }, String(bet)),
  );
}

describe('custom bet input', () => {
  it('accepts a comma-grouped amount and clamps over-max, under-min and over-balance on blur, with a clear error', () => {
    render(createElement(Harness));
    const input = screen.getByTestId('custom-bet') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '10,000,000' } });
    expect(screen.getByTestId('val').textContent).toBe('10000000');
    expect(screen.queryByTestId('custom-bet-error')).toBeNull();

    fireEvent.change(input, { target: { value: '20,000,000' } });
    expect(screen.getByTestId('custom-bet-error').textContent).toMatch(/10,000,000/);
    fireEvent.blur(input);
    expect(screen.getByTestId('val').textContent).toBe('10000000');
    expect(input.value).toBe('10,000,000');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('val').textContent).toBe('20');
    expect(screen.getByTestId('custom-bet-error').textContent).toMatch(/Minimum bet is 20/);
  });

  it('clamps to the player balance and rejects junk', () => {
    render(createElement(Harness, { balance: 1_500 }));
    const input = screen.getByTestId('custom-bet') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5,000' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('val').textContent).toBe('1500');
    expect(screen.getByTestId('custom-bet-error').textContent).toMatch(/Not enough chips/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('custom-bet-error').textContent).toMatch(/whole number/);
    expect(screen.getByTestId('val').textContent).toBe('1500');
  });
});
