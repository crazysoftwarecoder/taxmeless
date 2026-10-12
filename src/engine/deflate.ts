import type { Ledger, StageTotals } from './types';

const STAGES = ['ingress', 'growth', 'egress'] as const;

/** Express every USD amount in today's dollars by discounting year y at (1 + rate)^y. Local amounts stay nominal. */
export function deflateLedger(l: Ledger, rate: number): Ledger {
  if (!rate) return l;
  const scale = (t: StageTotals, k: number): StageTotals => ({ ingress: t.ingress * k, growth: t.growth * k, egress: t.egress * k });
  const rows = l.rows.map((r) => {
    const k = 1 / Math.pow(1 + rate, r.year);
    return {
      ...r,
      openingValueUsd: r.openingValueUsd * k,
      incomeUsd: r.incomeUsd * k,
      growthUsd: r.growthUsd * k,
      taxesUsd: scale(r.taxesUsd, k),
      costsUsd: scale(r.costsUsd, k),
      grossValueUsd: r.grossValueUsd * k,
      netValueUsd: r.netValueUsd * k,
      events: r.events.map((e) => ({ ...e, amountUsd: e.amountUsd * k })),
    };
  });
  const totals = { taxes: { ingress: 0, growth: 0, egress: 0, all: 0 }, costs: { ingress: 0, growth: 0, egress: 0, all: 0 } };
  for (const r of rows) for (const s of STAGES) { totals.taxes[s] += r.taxesUsd[s]; totals.costs[s] += r.costsUsd[s]; }
  totals.taxes.all = STAGES.reduce((a, s) => a + totals.taxes[s], 0);
  totals.costs.all = STAGES.reduce((a, s) => a + totals.costs[s], 0);
  const last = rows[rows.length - 1]!;
  const realGain = last.grossValueUsd - l.principalUsd;
  return {
    ...l,
    rows,
    totalsUsd: totals,
    finalGrossUsd: last.grossValueUsd,
    finalNetUsd: last.netValueUsd,
    effectiveTaxRate: realGain > 0 ? totals.taxes.all / realGain : 0,
    dragPct: last.grossValueUsd > 0 ? 1 - last.netValueUsd / last.grossValueUsd : 0,
  };
}
