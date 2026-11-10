/**
 * City patronage (Billionaire Update): naming-rights sinks for civic spots. Chips are burned, not paid to the mayor or treasury.
 * Prices are BASE chips; the server charges px(price). Each grant lasts termDays and can be renewed by the current patron.
 * A new patron can only take over after the current term ends. No refunds.
 */
export interface PatronSlot { id: string; name: string; price: number; termDays: number; icon: string; blurb: string }

export const PATRON_SLOTS: PatronSlot[] = [
  { id: 'plaza', name: 'City Plaza', price: 500_000, termDays: 7, icon: '⛲', blurb: 'Your name on the plaza plaque for a week.' },
  { id: 'fireworks_dock', name: 'Fireworks Dock', price: 250_000, termDays: 7, icon: '🎇', blurb: 'Sponsor the waterfront fireworks dock for a week.' },
  { id: 'festival', name: 'City Festival', price: 150_000, termDays: 7, icon: '🎉', blurb: 'Underwrite this week\'s city festival. Renew each week to keep the banner.' },
  { id: 'monument', name: 'Patron Monument', price: 1_000_000, termDays: 7, icon: '🗿', blurb: 'Your name on a city monument for a week.' },
];

export const patronSlot = (id: unknown) => PATRON_SLOTS.find((s) => s.id === id);
export const patronTermMs = (s: PatronSlot) => s.termDays * 86_400_000;
