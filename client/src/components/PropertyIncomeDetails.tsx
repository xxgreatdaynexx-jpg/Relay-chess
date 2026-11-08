import { incomeEligible } from '../../../shared/propertyIncome';
/** Shared disclosure for an offered quote or an owner's recorded deed cost. No claim/action controls. */
export function PropertyIncomeDetails({ id, cost }: { id: string; cost: number }) {
  return incomeEligible(id) ? <><dt>Automatic income</dt><dd data-testid="deed-passive-income">🪙 {(cost / 7).toLocaleString('en-US', { maximumFractionDigits: 2 })}/day · recorded deed price ÷ 7 days.<small className="block">Earns while offline, credited automatically every 10 minutes with fractional chips carried forward. Repays the deed price in seven days before ordinary property tax, then continues at the same rate forever. No income fees or operating deductions. Separate property and purchase taxes still apply; no income before feature activation or ownership.</small></dd></> : null;
}
