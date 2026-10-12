import type { CountryCode, Stage } from '../../../schemas';
import type { Ledger, LedgerAsset, TaxEvent } from '../../engine/types';
import { clear, h } from '../dom';
import { ASSET_LABEL, local, pct, STAGE_LABEL, usd } from '../format';

export interface DrillTarget { country: CountryCode; asset: LedgerAsset; year?: number; stage?: Stage }

export interface DrilldownCtx {
  names: Record<CountryCode, string>;
  jurisdictionNote: (c: CountryCode) => string | undefined;
  taxYear: (c: CountryCode) => string | undefined;
  realNote?: string;
}

function eventCard(e: TaxEvent, currency: string): HTMLElement {
  const neg = e.amount < 0;
  return h('article', { class: `event event-${e.category}` },
    h('header', null,
      h('span', { class: `tag tag-${e.category}` }, e.category === 'tax' ? 'tax' : 'cost'),
      h('h4', null, e.label),
      h('span', { class: `amount${neg ? ' is-refund' : ''}` }, `${neg ? '−' : ''}${usd(Math.abs(e.amountUsd))}`),
    ),
    h('p', { class: 'explain' }, e.explanation),
    h('dl', { class: 'facts' },
      h('dt', null, 'Base'), h('dd', null, `${e.baseKind.replace('_', ' ')} · ${local(e.base, currency)}`),
      e.taxable !== e.base ? h('dt', null, 'Taxable') : null, e.taxable !== e.base ? h('dd', null, local(e.taxable, currency)) : null,
      h('dt', null, 'Effective rate'), h('dd', null, e.rate === undefined ? 'fixed' : pct(e.rate, 2)),
      h('dt', null, 'Local amount'), h('dd', null, `${neg ? '−' : ''}${local(Math.abs(e.amount), currency)}`),
    ),
    h('footer', null,
      h('a', { href: e.meta.source, target: '_blank', rel: 'noopener' }, e.meta.source_title ?? 'Source'),
      h('span', { class: 'verified' }, `verified ${e.meta.last_verified}`),
      e.meta.note ? h('p', { class: 'note' }, e.meta.note) : null,
    ),
  );
}

export function renderDrilldown(root: HTMLElement, ledger: Ledger, target: DrillTarget, ctx: DrilldownCtx): void {
  clear(root);
  const rows = target.year !== undefined ? ledger.rows.filter((r) => r.year === target.year) : ledger.rows;
  const events = rows.flatMap((r) => r.events).filter((e) => !target.stage || e.stage === target.stage);
  const yearRow = target.year !== undefined ? ledger.rows[target.year] : undefined;

  const title = target.stage
    ? `${STAGE_LABEL[target.stage]} · ${ctx.names[target.country]} · ${ASSET_LABEL[target.asset]}`
    : `Year ${target.year} · ${ctx.names[target.country]} · ${ASSET_LABEL[target.asset]}`;

  const grouped = new Map<string, { label: string; events: TaxEvent[]; total: number }>();
  for (const e of events) {
    const g = grouped.get(e.ruleId) ?? { label: e.label, events: [], total: 0 };
    g.events.push(e);
    g.total += e.amountUsd;
    grouped.set(e.ruleId, g);
  }

  root.append(
    h('header', { class: 'sheet-head' },
      h('h3', null, title),
      h('p', { class: 'muted' }, ctx.jurisdictionNote(target.country) ?? '', ctx.taxYear(target.country) ? ` Tax year ${ctx.taxYear(target.country)}.` : ''),
      ctx.realNote ? h('p', { class: 'muted' }, ctx.realNote) : null,
    ),
    yearRow ? h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', null, 'Net value'), h('strong', null, usd(yearRow.netValueUsd))),
      h('div', { class: 'kpi' }, h('span', null, 'Untaxed'), h('strong', null, usd(yearRow.grossValueUsd))),
      h('div', { class: 'kpi' }, h('span', null, 'Tax this year'), h('strong', null, usd(yearRow.taxesUsd.ingress + yearRow.taxesUsd.growth + yearRow.taxesUsd.egress))),
      h('div', { class: 'kpi' }, h('span', null, ledger.loanUsd > 0 ? 'Net rent after interest' : 'Income'), h('strong', null, usd(yearRow.incomeUsd))),
    ) : h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', null, 'Total at this stage'), h('strong', null, usd(events.filter((e) => e.category === 'tax').reduce((a, e) => a + e.amountUsd, 0)))),
      h('div', { class: 'kpi' }, h('span', null, 'Costs at this stage'), h('strong', null, usd(events.filter((e) => e.category === 'cost').reduce((a, e) => a + e.amountUsd, 0)))),
      h('div', { class: 'kpi' }, h('span', null, 'Over'), h('strong', null, `${ledger.horizonYears} years`)),
    ),
  );

  if (events.length === 0) {
    root.append(h('p', { class: 'empty' }, target.stage
      ? `No ${target.stage} taxes or costs apply in ${ctx.names[target.country]} for ${ASSET_LABEL[target.asset].toLowerCase()}.`
      : `Nothing is charged in year ${target.year}.`));
    return;
  }

  if (target.year !== undefined) {
    root.append(...events.map((e) => eventCard(e, ledger.currency)));
  } else {
    // Stage view across all years: one card per rule with the total, plus the first-year example.
    for (const [, g] of grouped) {
      const first = g.events[0]!;
      const yrs = g.events.length;
      root.append(h('section', { class: 'rule-group' },
        yrs > 1 ? h('div', { class: 'rule-total' },
          h('span', null, `${g.label} · ${yrs} years in total`),
          h('strong', null, usd(g.total)),
        ) : null,
        eventCard({ ...first, label: yrs > 1 ? `${first.label} (year ${first.year} shown)` : first.label }, ledger.currency),
      ));
    }
  }
}
