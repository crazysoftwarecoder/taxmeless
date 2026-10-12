import type { Asset, CountryCode } from '../../../schemas';
import type { Ledger } from '../../engine/types';
import { countryColor } from '../charts/palette';
import { clear, h } from '../dom';
import { ASSET_LABEL, pct, usd, usdCompact } from '../format';
import type { AppState } from '../state';

/** "Where you end up" tables. Rows open the exit-stage drill-down via onRow. */
export function renderSummary(
  host: HTMLElement, ledgers: Ledger[], state: AppState, names: Record<CountryCode, string>,
  onRow: (country: CountryCode, asset: Asset) => void,
): void {
  clear(host);
  const assets: Asset[] = state.asset === 'both' ? ['equities', 'property'] : [state.asset];
  for (const asset of assets) {
    const rows = ledgers.filter((l) => l.asset === asset).sort((a, b) => b.finalNetUsd - a.finalNetUsd);
    host.append(h('table', { class: 'summary' },
      h('caption', null, `${ASSET_LABEL[asset]} · ${usdCompact(state.principal)} after ${state.horizon} years${state.real ? " · in today's dollars" : ''}`),
      h('thead', null, h('tr', null,
        h('th', null, 'Country'), h('th', { class: 'num' }, 'Net value'), h('th', { class: 'num' }, 'Total tax'),
        h('th', { class: 'num' }, 'Tax / gain'), h('th', { class: 'num' }, 'Ingress'), h('th', { class: 'num' }, 'Growth'), h('th', { class: 'num' }, 'Egress'),
      )),
      h('tbody', null, ...rows.map((l) => h('tr', { tabindex: 0, role: 'button', 'aria-label': `Show taxes for ${names[l.country]} ${asset}`,
        onclick: () => onRow(l.country, asset),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(l.country, asset); } },
      },
        h('td', null, h('span', { class: 'swatch', style: `background:${countryColor(l.country)}` }), names[l.country]),
        h('td', { class: 'num' }, usd(l.finalNetUsd)),
        h('td', { class: 'num' }, usd(l.totalsUsd.taxes.all)),
        h('td', { class: 'num' }, pct(l.effectiveTaxRate)),
        h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.ingress)),
        h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.growth)),
        h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.egress)),
      ))),
    ));
  }
}
