import type { Asset, Base, CountryCode, Meta, Stage } from '../../schemas';

export type IncomeBand = 'low' | 'mid' | 'high';
/** Taxable income stacked on other income, per tax system (stack_group). */
export type StackByGroup = Record<string, number>;
/** A ledger is one asset, or the combined portfolio of both. */
export type LedgerAsset = Asset | 'portfolio';
export const INCOME_BAND_INDEX: Record<IncomeBand, 0 | 1 | 2> = { low: 0, mid: 1, high: 2 };

export interface SimInputs {
  horizonYears: number;
  principalUsd: number;
  equities: { growth: number; yield: number };
  property: { growth: number; yield: number; costRate: number; lvr?: number; interestRate?: number };
  otherIncomeBand: IncomeBand;
  /** Purchase date (YYYY-MM-DD). Dated rules and bracket changes are resolved against it. Defaults to DEFAULT_START_DATE. */
  startDate?: string;
  /** Annual CPI used for cost-base indexation. Defaults to 0.025. */
  inflation?: number;
  /**
   * Taxable income (local currency) already stacked on the taxpayer's other income by another holding in the
   * same year, e.g. the equities half of a portfolio. growth is indexed by year; egress applies in the sale year.
   */
  incomeStackOffset?: { growth?: StackByGroup[]; egress?: StackByGroup };
}

/** One application of one rule in one year. Amounts: `amount` local currency, `amountUsd` converted. */
export interface TaxEvent {
  ruleId: string;
  label: string;
  stage: Stage;
  category: 'tax' | 'cost';
  year: number;
  baseKind: Base;
  base: number;
  taxable: number;
  /** Effective rate on the base (amount / base), undefined when base is 0. */
  rate?: number;
  amount: number;
  amountUsd: number;
  explanation: string;
  meta: Meta;
}

export interface StageTotals {
  ingress: number;
  growth: number;
  egress: number;
}

/** All money fields in USD. */
export interface YearRow {
  year: number;
  openingValueUsd: number;
  incomeUsd: number;
  growthUsd: number;
  taxesUsd: StageTotals;
  costsUsd: StageTotals;
  events: TaxEvent[];
  /** Counterfactual with cost rules only, no tax rules. */
  grossValueUsd: number;
  netValueUsd: number;
  /** Taxable amounts this holding stacked on other income (local currency), for portfolio stacking. */
  stackedLocal: { growth: StackByGroup; egress: StackByGroup };
}

export interface Ledger {
  country: CountryCode;
  asset: LedgerAsset;
  currency: string;
  /** Local currency units per USD. */
  fx: number;
  principalUsd: number;
  horizonYears: number;
  /** Purchase price and interest-only loan (USD); equal to the deployed cash and 0 without leverage. */
  purchasePriceUsd: number;
  loanUsd: number;
  rows: YearRow[];
  totalsUsd: { taxes: StageTotals & { all: number }; costs: StageTotals & { all: number } };
  finalGrossUsd: number;
  finalNetUsd: number;
  /** Total tax as a share of the gross gain (finalGross − principal). */
  effectiveTaxRate: number;
  /** 1 − finalNet / finalGross. */
  dragPct: number;
}
