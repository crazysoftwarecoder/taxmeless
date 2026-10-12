import type { Ledger, StageTotals, YearRow } from './types';

const add = (a: StageTotals, b: StageTotals): StageTotals => ({ ingress: a.ingress + b.ingress, growth: a.growth + b.growth, egress: a.egress + b.egress });
const LABEL = { equities: 'Equities', property: 'Property', portfolio: 'Portfolio' } as const;

/** Sum two ledgers of the same country and horizon into one portfolio ledger. Events keep an asset prefix. */
export function combineLedgers(a: Ledger, b: Ledger): Ledger {
  if (a.country !== b.country || a.rows.length !== b.rows.length) throw new Error('combineLedgers: mismatched ledgers');
  const tag = (l: Ledger) => (e: YearRow['events'][number]) => ({ ...e, ruleId: `${l.asset}:${e.ruleId}`, label: `${LABEL[l.asset]} · ${e.label}` });
  const rows: YearRow[] = a.rows.map((ra, i) => {
    const rb = b.rows[i]!;
    return {
      year: ra.year,
      openingValueUsd: ra.openingValueUsd + rb.openingValueUsd,
      incomeUsd: ra.incomeUsd + rb.incomeUsd,
      growthUsd: ra.growthUsd + rb.growthUsd,
      taxesUsd: add(ra.taxesUsd, rb.taxesUsd),
      costsUsd: add(ra.costsUsd, rb.costsUsd),
      events: [...ra.events.map(tag(a)), ...rb.events.map(tag(b))],
      grossValueUsd: ra.grossValueUsd + rb.grossValueUsd,
      netValueUsd: ra.netValueUsd + rb.netValueUsd,
      stackedLocal: { growth: ra.stackedLocal.growth + rb.stackedLocal.growth, egress: ra.stackedLocal.egress + rb.stackedLocal.egress },
    };
  });
  const taxes = { ...add(a.totalsUsd.taxes, b.totalsUsd.taxes), all: a.totalsUsd.taxes.all + b.totalsUsd.taxes.all };
  const costs = { ...add(a.totalsUsd.costs, b.totalsUsd.costs), all: a.totalsUsd.costs.all + b.totalsUsd.costs.all };
  const principalUsd = a.principalUsd + b.principalUsd;
  const finalGrossUsd = a.finalGrossUsd + b.finalGrossUsd;
  const finalNetUsd = a.finalNetUsd + b.finalNetUsd;
  const gain = finalGrossUsd - principalUsd;
  return {
    country: a.country, asset: 'portfolio', currency: a.currency, fx: a.fx, principalUsd, horizonYears: a.horizonYears,
    purchasePriceUsd: a.purchasePriceUsd + b.purchasePriceUsd, loanUsd: a.loanUsd + b.loanUsd,
    rows, totalsUsd: { taxes, costs }, finalGrossUsd, finalNetUsd,
    effectiveTaxRate: gain > 0 ? taxes.all / gain : 0,
    dragPct: finalGrossUsd > 0 ? 1 - finalNetUsd / finalGrossUsd : 0,
  };
}
