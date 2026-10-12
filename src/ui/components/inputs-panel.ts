import type { CountryCode } from '../../../schemas';
import { h } from '../dom';
import { MAX_COUNTRIES, type AppState } from '../state';
import { countryColor } from '../charts/theme';

interface CountryOpt { code: CountryCode; name: string }

export function inputsPanel(
  state: AppState,
  countries: CountryOpt[],
  onChange: (patch: Partial<AppState>) => void,
): HTMLElement {
  const horizonLabel = h('output', { class: 'horizon-value' }, `${state.horizon} yrs`);
  const slider = h('input', {
    type: 'range', min: 1, max: 40, step: 1, value: state.horizon, 'aria-label': 'Horizon in years',
    oninput: (e: Event) => { horizonLabel.textContent = `${(e.target as HTMLInputElement).value} yrs`; },
    onchange: (e: Event) => onChange({ horizon: Number((e.target as HTMLInputElement).value) }),
  });
  const preset = (y: number) => h('button', {
    type: 'button', class: `chip${state.horizon === y ? ' is-active' : ''}`, 'aria-pressed': state.horizon === y,
    onclick: () => onChange({ horizon: y }),
  }, `${y} yrs`);

  const numField = (label: string, key: keyof AppState, opts: { min: number; max: number; step: number; suffix?: string; prefix?: string }) =>
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      h('span', { class: 'field-input' },
        opts.prefix ? h('span', { class: 'affix' }, opts.prefix) : null,
        h('input', {
          type: 'number', min: opts.min, max: opts.max, step: opts.step, value: state[key] as number, inputmode: 'decimal',
          onwheel: (e: Event) => (e.target as HTMLElement).blur(),
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) onChange({ [key]: Math.min(opts.max, Math.max(opts.min, v)) } as Partial<AppState>);
          },
        }),
        opts.suffix ? h('span', { class: 'affix' }, opts.suffix) : null,
      ),
    );

  const seg = <T extends string>(name: string, value: T, options: { value: T; label: string }[], key: keyof AppState) =>
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
      ...options.map((o) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': o.value === value, class: `seg${o.value === value ? ' is-active' : ''}`,
        onclick: () => onChange({ [key]: o.value } as Partial<AppState>),
      }, o.label)),
    );

  const full = state.countries.length >= MAX_COUNTRIES;
  const countryList = h('div', { class: 'country-grid' },
    ...countries.map((c) => {
      const checked = state.countries.includes(c.code);
      return h('label', { class: `check${checked ? ' is-checked' : ''}${!checked && full ? ' is-disabled' : ''}` },
        h('input', {
          type: 'checkbox', checked, disabled: !checked && full,
          onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            const next = on ? [...state.countries, c.code] : state.countries.filter((x) => x !== c.code);
            if (next.length === 0) { (e.target as HTMLInputElement).checked = true; return; }
            onChange({ countries: countries.map((x) => x.code).filter((x) => next.includes(x)) });
          },
        }),
        h('span', { class: 'swatch', style: checked ? `background:${countryColor(c.code)}` : 'background:transparent;box-shadow:inset 0 0 0 1.5px var(--axis)' }),
        h('span', null, c.name),
      );
    }),
  );

  return h('form', { class: 'inputs', onsubmit: (e: Event) => e.preventDefault() },
    h('section', { class: 'group' },
      h('h2', null, 'Horizon'),
      h('div', { class: 'chips' }, preset(10), preset(15), preset(25), horizonLabel),
      slider,
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Starting amount'),
      numField('Invested (USD)', 'principal', { min: 1000, max: 1e9, step: 10000, prefix: '$' }),
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Asset'),
      seg('Asset', state.asset, [{ value: 'both', label: 'Both' }, { value: 'equities', label: 'Equities' }, { value: 'property', label: 'Property' }], 'asset'),
      state.asset !== 'property' ? h('div', { class: 'row' },
        numField('Equity growth', 'eqGrowth', { min: -20, max: 30, step: 0.5, suffix: '%' }),
        numField('Dividend yield', 'eqYield', { min: 0, max: 20, step: 0.25, suffix: '%' }),
      ) : null,
      state.asset !== 'equities' ? h('div', { class: 'row' },
        numField('Property growth', 'prGrowth', { min: -20, max: 30, step: 0.5, suffix: '%' }),
        numField('Gross rental yield', 'prYield', { min: 0, max: 20, step: 0.25, suffix: '%' }),
        numField('Running costs (of rent)', 'prCost', { min: 0, max: 90, step: 5, suffix: '%' }),
      ) : null,
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Inflation & values'),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Value basis' },
        ...[{ v: false, l: 'Future dollars' }, { v: true, l: "Today's dollars" }].map((o) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': state.real === o.v, class: `seg${state.real === o.v ? ' is-active' : ''}`,
          onclick: () => onChange({ real: o.v }),
        }, o.l)),
      ),
      numField('Inflation (CPI)', 'infl', { min: 0, max: 20, step: 0.25, suffix: '%' }),
      h('p', { class: 'hint' }, "Used for today's dollars and for inflation-indexed capital gains (Australia from July 2027)."),
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Your other income'),
      seg('Other income band', state.income, [{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }], 'income'),
      h('p', { class: 'hint' }, 'Sets the marginal rate your investment income stacks on. Bands are set per country in local currency.'),
    ),
    h('section', { class: 'group' },
      h('h2', null, `Countries `, h('span', { class: 'count' }, `${state.countries.length}/${MAX_COUNTRIES}`)),
      countryList,
    ),
  );
}
