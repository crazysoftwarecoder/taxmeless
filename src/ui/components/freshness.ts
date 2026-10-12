import { h } from '../dom';
import type { Dataset } from '../../engine/compare';

function collectDates(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectDates(n, out)); return; }
  const o = node as Record<string, unknown>;
  if (typeof o.last_verified === 'string') out.push(o.last_verified);
  for (const v of Object.values(o)) collectDates(v, out);
}

function range(node: unknown): string {
  const d: string[] = [];
  collectDates(node, d);
  if (!d.length) return 'no data';
  d.sort();
  return d[0] === d[d.length - 1] ? d[0]! : `${d[0]} → ${d[d.length - 1]}`;
}

export function freshnessFooter(dataset: Dataset, repoUrl: string): HTMLElement {
  const n = (x: object) => Object.keys(x).length;
  return h('footer', { class: 'freshness' },
    h('p', null,
      h('strong', null, 'Data freshness. '),
      `Tax rules (${n(dataset.tax)} countries) verified ${range(dataset.tax)}. `,
      `GDP (${n(dataset.gdp)}) verified ${range(dataset.gdp)}. `,
      `Cost of living (${n(dataset.col)}) verified ${range(dataset.col)}. `,
      `FX verified ${range(dataset.countries)}. `,
      h('a', { href: `${repoUrl}/tree/main/data`, target: '_blank', rel: 'noopener' }, 'Browse the data files'),
      '. Every number links to its source in the drill-down.',
    ),
    h('p', { class: 'disclaimer' },
      h('strong', null, 'Not tax advice. '),
      'This is a simplified model of a resident individual in one representative state or canton per country, with fixed exchange rates, identical nominal returns everywhere, no leverage and whole-position sales. It compares tax drag, not markets. Rules change; check the source links and the verified dates.',
    ),
  );
}
