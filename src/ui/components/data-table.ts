import { h } from '../dom';

/** Accessible tabular view of chart data. First column is a label, the rest are right-aligned numbers. */
export function dataTable(caption: string, head: string[], rows: (string | number)[][]): HTMLElement {
  return h('div', { class: 'summary-wrap' },
    h('table', { class: 'summary data-table' },
      h('caption', null, caption),
      h('thead', null, h('tr', null, ...head.map((c, i) => h('th', { class: i ? 'num' : '', scope: 'col' }, c)))),
      h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, String(c)) : h('td', { class: 'num' }, String(c))))))),
    ),
  );
}
