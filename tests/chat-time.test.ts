import { describe, it, expect } from 'vitest';
import { chatTimeLabel, chatTimeFull } from '../shared/chatTime';

const NOW = Date.parse('2026-11-02T05:55:00Z'); // Sun Nov 1, 11:55 PM Alberta
describe('chat timestamps (Alberta, fixed UTC-6)', () => {
  it('shows just the time for today', () => {
    expect(chatTimeLabel(Date.parse('2026-11-02T05:52:00Z'), NOW)).toBe('11:52 PM AB');
    expect(chatTimeLabel(Date.parse('2026-11-01T06:05:00Z'), NOW)).toBe('12:05 AM AB');
  });
  it('says Yesterday across Alberta midnight, not UTC midnight', () => {
    expect(chatTimeLabel(Date.parse('2026-11-01T05:59:00Z'), NOW)).toBe('Yesterday 11:59 PM AB');
    expect(chatTimeLabel(Date.parse('2026-11-02T06:01:00Z'), Date.parse('2026-11-02T06:30:00Z'))).toBe('12:01 AM AB');
  });
  it('shows a date for older messages', () => {
    expect(chatTimeLabel(Date.parse('2026-10-30T18:00:00Z'), NOW)).toBe('Oct 30 12:00 PM AB');
    expect(chatTimeLabel(Date.parse('2025-12-31T18:00:00Z'), NOW)).toBe('Dec 31, 2025 12:00 PM AB');
  });
  it('ignores DST (summer is still UTC-6)', () => {
    expect(chatTimeLabel(Date.parse('2026-07-01T18:00:00Z'), Date.parse('2026-07-01T20:00:00Z'))).toBe('12:00 PM AB');
  });
  it('full hover date', () => {
    expect(chatTimeFull(Date.parse('2026-11-02T05:52:00Z'))).toBe('Sun, Nov 1, 2026, 11:52 PM AB (UTC-6)');
  });
});
