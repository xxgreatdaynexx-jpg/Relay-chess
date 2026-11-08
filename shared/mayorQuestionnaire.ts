/**
 * pt2050u (Nov 8 2026): one mayor-only multiple-choice questionnaire about the zoning/property-cap bill draft (t2045u).
 * Advisory answers only: saving or submitting changes NO economy, ownership, tax, treasury or law state.
 * BILL_REVIEW_MESSAGE is the owner's exact text and must never be edited (tests compare it byte for byte).
 */
export const BILL_REVIEW_ID = 'bill-zoning-caps-2026-11-08';
export const BILL_REVIEW_MESSAGE = `Mayor, the proposal needs these clarifications before it can move forward:

- Existing owners keep all their properties, even if already above a cap. Limits block additional purchases, not force sales or confiscation.
- Define the zoning for every property type, including barns, factories, plantations, resort plots and public landmarks.
- Residential and commercial ownership are capped separately at five each. Farmland is capped at 1,500 total owned tiles, counting each plot’s full dimensions. Purchases exceeding a cap are refused.
- Address property surcharges already paid. My recommendation is to refund the surcharge actually paid on properties still owned—not the base price or wealth tax—and reduce the recorded purchase basis by the refund to prevent a double payout on resale.
- Any refunds must come entirely from the city treasury. No new chips may be created. Specify how refunds will be handled if treasury funds are insufficient.

Please revise the bill to cover these points. No changes have been approved or implemented.`;

export interface BillQuestion { id: string; text: string; options: ReadonlyArray<{ id: string; label: string }> }
const DISCUSS = { id: 'needs_discussion', label: 'Needs discussion' } as const;
const ZONES = [{ id: 'residential', label: 'Residential' }, { id: 'commercial', label: 'Commercial' }, { id: 'farmland', label: 'Farmland' }, { id: 'exempt', label: 'Exempt (not capped)' }, DISCUSS] as const;
const zone = (id: string, what: string): BillQuestion => ({ id: `zone_${id}`, text: `Zone for ${what}`, options: ZONES });
export const BILL_REVIEW_QUESTIONS: ReadonlyArray<BillQuestion> = [
  { id: 'grandfather', text: 'Existing owners keep every property they own now, even above a cap; caps only refuse additional purchases.', options: [{ id: 'confirm', label: 'Confirm' }, DISCUSS] },
  zone('houses', 'houses and homes'),
  zone('employee_housing', 'employee housing'),
  zone('shops', 'shops and businesses'),
  zone('factories', 'factories'),
  zone('barns', 'barns'),
  zone('farm_plots', 'farm and field plots'),
  zone('plantations', 'plantations'),
  zone('resort', 'resort plots and lots'),
  zone('patches', 'land patches'),
  zone('landmarks', 'public landmarks (e.g. Jail, Harbour)'),
  { id: 'caps_5_5', text: 'Residential and commercial are capped separately at 5 each (not 10 combined).', options: [{ id: 'confirm', label: 'Confirm' }, DISCUSS] },
  { id: 'farm_1500', text: 'Farmland is capped at 1,500 total owned tiles, counting each plot’s full dimensions; purchases over the cap are refused.', options: [{ id: 'confirm', label: 'Confirm' }, DISCUSS] },
  { id: 'surcharge_refund', text: 'Surcharges already paid', options: [{ id: 'recommended', label: 'Accept the recommendation (refund surcharge actually paid on properties still owned; reduce purchase basis by the refund)' }, { id: 'no_refund', label: 'No refund' }, DISCUSS] },
  { id: 'treasury_short', text: 'If the treasury cannot cover refunds (treasury only — no new chips)', options: [{ id: 'wait_full', label: 'Wait until the treasury can fund them in full' }, { id: 'staged', label: 'Staged payments as treasury funds come in' }, DISCUSS] },
];
export type BillAnswers = Record<string, string>;
/** Keeps only known question ids with a valid option; throws on anything else. Partial sets are allowed (drafts). */
export function cleanBillAnswers(x: unknown): BillAnswers {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Pick your answers.');
  const out: BillAnswers = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const q = BILL_REVIEW_QUESTIONS.find((y) => y.id === k);
    if (!q || typeof v !== 'string' || !q.options.some((o) => o.id === v)) throw new Error('That answer is not one of the choices.');
    out[k] = v;
  }
  return out;
}
export const billAnswersComplete = (a: BillAnswers) => BILL_REVIEW_QUESTIONS.every((q) => typeof a[q.id] === 'string');
export interface BillReviewView { id: string; message: string; questions: ReadonlyArray<BillQuestion>; answers: BillAnswers; submittedAt: number | null; autoOpen: boolean }
