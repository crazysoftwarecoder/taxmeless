import type { CountryCode } from '../../../schemas';
import { countryColor } from '../charts/palette';
import { h } from '../dom';
import { MAX_COUNTRIES, type AppState } from '../state';

interface CountryOpt { code: CountryCode; name: string }

export interface InputsPanel {
  el: HTMLElement;
  /** Bring every control in line with the state without rebuilding (keeps focus and lets transitions run). */
  sync(state: AppState): void;
}

type NumKey = 'principal' | 'eqGrowth' | 'eqYield' | 'prGrowth' | 'prYield' | 'prCost' | 'lvr' | 'rate' | 'infl';

const compactUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);

/** Paint the filled part of a range track (used by the CSS gradient). */
function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

export function createInputsPanel(countries: CountryOpt[], onChange: (patch: Partial<AppState>) => void): InputsPanel {
  let current: AppState | undefined;

  // ---- horizon
  const horizonLabel = h('output', { class: 'horizon-value' }, '');
  const horizon = h('input', {
    type: 'range', min: 1, max: 40, step: 1, class: 'range', 'aria-label': 'Horizon in years',
    oninput: (e: Event) => {
      const t = e.target as HTMLInputElement;
      horizonLabel.textContent = `${t.value} yrs`;
      paintRange(t);
    },
    onchange: (e: Event) => onChange({ horizon: Number((e.target as HTMLInputElement).value) }),
  });
  const presets = [10, 15, 25].map((y) => h('button', { type: 'button', class: 'chip', dataset: { years: String(y) }, onclick: () => onChange({ horizon: y }) }, `${y} yrs`));

  // ---- number fields
  const numInputs = new Map<NumKey, HTMLInputElement>();
  const numField = (label: string, key: NumKey, opts: { min: number; max: number; step: number; suffix?: string; prefix?: string }) => {
    const input = h('input', {
      type: 'number', min: opts.min, max: opts.max, step: opts.step, inputmode: 'decimal',
      onwheel: (e: Event) => (e.target as HTMLElement).blur(),
      onchange: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onChange({ [key]: Math.min(opts.max, Math.max(opts.min, v)) } as Partial<AppState>);
      },
    });
    numInputs.set(key, input);
    return h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      h('span', { class: 'field-input' },
        opts.prefix ? h('span', { class: 'affix' }, opts.prefix) : null,
        input,
        opts.suffix ? h('span', { class: 'affix' }, opts.suffix) : null,
      ),
    );
  };

  // ---- segmented controls with a sliding indicator
  const segs: { key: keyof AppState; root: HTMLElement; indicator: HTMLElement; buttons: { value: unknown; el: HTMLButtonElement }[] }[] = [];
  const seg = <T extends string | boolean>(name: string, key: keyof AppState, options: { value: T; label: string }[]) => {
    const indicator = h('span', { class: 'seg-indicator', 'aria-hidden': 'true' });
    const buttons = options.map((o) => ({
      value: o.value,
      el: h('button', { type: 'button', role: 'radio', class: 'seg', onclick: () => onChange({ [key]: o.value } as Partial<AppState>) }, o.label),
    }));
    const root = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name }, indicator, ...buttons.map((b) => b.el));
    segs.push({ key, root, indicator, buttons });
    return root;
  };

  // ---- capital split
  const allocText = h('output', { class: 'alloc-value' }, '');
  const allocLabel = (eq: number, principal: number) =>
    `Equities ${eq}% · ${compactUsd((principal * eq) / 100)} | Property ${100 - eq}% · ${compactUsd((principal * (100 - eq)) / 100)}`;
  const alloc = h('input', {
    id: 'alloc-range', type: 'range', min: 0, max: 100, step: 5, class: 'range', 'aria-label': 'Percent of capital in equities',
    oninput: (e: Event) => {
      const t = e.target as HTMLInputElement;
      allocText.textContent = allocLabel(Number(t.value), current?.principal ?? 0);
      t.setAttribute('aria-valuetext', allocText.textContent);
      paintRange(t);
    },
    onchange: (e: Event) => onChange({ alloc: Number((e.target as HTMLInputElement).value) }),
  });
  const allocBlock = h('div', { class: 'alloc reveal' }, h('label', { class: 'field-label', for: 'alloc-range' }, 'Split of your capital'), alloc, allocText);

  // ---- conditional rows
  const eqRow = h('div', { class: 'row reveal' },
    numField('Equity growth', 'eqGrowth', { min: -20, max: 30, step: 0.5, suffix: '%' }),
    numField('Dividend yield', 'eqYield', { min: 0, max: 20, step: 0.25, suffix: '%' }),
  );
  const prRow = h('div', { class: 'row reveal' },
    numField('Property growth', 'prGrowth', { min: -20, max: 30, step: 0.5, suffix: '%' }),
    numField('Gross rental yield', 'prYield', { min: 0, max: 20, step: 0.25, suffix: '%' }),
    numField('Running costs (of rent)', 'prCost', { min: 0, max: 90, step: 5, suffix: '%' }),
  );
  const levRow = h('div', { class: 'row reveal' },
    numField('Loan-to-value (LVR)', 'lvr', { min: 0, max: 90, step: 5, suffix: '%' }),
    numField('Mortgage rate', 'rate', { min: 0, max: 25, step: 0.25, suffix: '%' }),
  );
  const levHint = h('p', { class: 'hint reveal' }, '');

  // ---- countries
  const countryCount = h('span', { class: 'count' }, '');
  const countryRows = countries.map((c) => {
    const input = h('input', {
      type: 'checkbox',
      onchange: (e: Event) => {
        const st = current;
        if (!st) return;
        const on = (e.target as HTMLInputElement).checked;
        const next = on ? [...st.countries, c.code] : st.countries.filter((x) => x !== c.code);
        if (next.length === 0) { (e.target as HTMLInputElement).checked = true; return; }
        onChange({ countries: countries.map((x) => x.code).filter((x) => next.includes(x)) });
      },
    });
    const swatch = h('span', { class: 'swatch' });
    const label = h('label', { class: 'check' }, input, swatch, h('span', null, c.name));
    return { code: c.code, input, swatch, label };
  });

  const el = h('form', { class: 'inputs', onsubmit: (e: Event) => e.preventDefault() },
    h('section', { class: 'group' },
      h('h2', null, 'Horizon'),
      h('div', { class: 'chips' }, ...presets, horizonLabel),
      horizon,
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Starting amount'),
      numField('Invested (USD)', 'principal', { min: 1000, max: 1e9, step: 10000, prefix: '$' }),
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Asset'),
      seg('Asset', 'asset', [{ value: 'both', label: 'Both' }, { value: 'equities', label: 'Equities' }, { value: 'property', label: 'Property' }]),
      allocBlock, eqRow, prRow, levRow, levHint,
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Inflation & values'),
      seg('Value basis', 'real', [{ value: false, label: 'Future dollars' }, { value: true, label: "Today's dollars" }]),
      numField('Inflation (CPI)', 'infl', { min: 0, max: 20, step: 0.25, suffix: '%' }),
      h('p', { class: 'hint' }, "Used for today's dollars and for inflation-indexed capital gains (Australia from July 2027)."),
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Your other income'),
      seg('Other income band', 'income', [{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }]),
      h('p', { class: 'hint' }, 'Sets the marginal rate your investment income stacks on. Bands are set per country in local currency.'),
    ),
    h('section', { class: 'group' },
      h('h2', null, 'Countries ', countryCount),
      h('div', { class: 'country-grid' }, ...countryRows.map((r) => r.label)),
    ),
  );

  const show = (node: HTMLElement, on: boolean) => { node.classList.toggle('is-hidden', !on); node.toggleAttribute('inert', !on); };

  const placeIndicators = () => {
    for (const s of segs) {
      const active = s.buttons.find((b) => b.el.classList.contains('is-active'));
      if (!active || !active.el.offsetWidth) continue;
      s.indicator.style.width = `${active.el.offsetWidth}px`;
      s.indicator.style.transform = `translateX(${active.el.offsetLeft}px)`;
    }
  };
  const ro = new ResizeObserver(placeIndicators);
  ro.observe(el);
  for (const sg of segs) ro.observe(sg.root);
  void document.fonts?.ready.then(placeIndicators);

  function sync(state: AppState): void {
    current = state;
    // horizon
    horizon.value = String(state.horizon);
    horizonLabel.textContent = `${state.horizon} yrs`;
    paintRange(horizon);
    for (const p of presets) {
      const on = Number(p.dataset.years) === state.horizon;
      p.classList.toggle('is-active', on);
      p.setAttribute('aria-pressed', String(on));
    }
    // numbers (never overwrite a field the user is typing in)
    for (const [key, input] of numInputs) {
      if (document.activeElement !== input) input.value = String(state[key]);
    }
    // segmented
    for (const s of segs) {
      for (const b of s.buttons) {
        const on = b.value === state[s.key];
        b.el.classList.toggle('is-active', on);
        b.el.setAttribute('aria-checked', String(on));
      }
    }
    requestAnimationFrame(placeIndicators);
    // asset-dependent sections
    show(allocBlock, state.asset === 'both');
    show(eqRow, state.asset !== 'property');
    show(prRow, state.asset !== 'equities');
    show(levRow, state.asset !== 'equities');
    show(levHint, state.asset !== 'equities');
    alloc.value = String(state.alloc);
    allocText.textContent = allocLabel(state.alloc, state.principal);
    alloc.setAttribute('aria-valuetext', allocText.textContent);
    paintRange(alloc);
    levHint.textContent = state.lvr > 0
      ? `Interest-only loan. Your cash pays the ${100 - state.lvr}% deposit plus purchase costs, so you buy a property worth about ${(100 / (100 - state.lvr)).toFixed(1)}× your cash.`
      : 'Set an LVR to buy with a mortgage; each country taxes the interest and any rental loss differently.';
    // countries
    const full = state.countries.length >= MAX_COUNTRIES;
    countryCount.textContent = `${state.countries.length}/${MAX_COUNTRIES}`;
    for (const r of countryRows) {
      const checked = state.countries.includes(r.code);
      r.input.checked = checked;
      r.input.disabled = !checked && full;
      r.label.classList.toggle('is-checked', checked);
      r.label.classList.toggle('is-disabled', !checked && full);
      r.swatch.style.background = checked ? countryColor(r.code) : 'transparent';
      r.swatch.classList.toggle('is-empty', !checked);
    }
  }

  return { el, sync };
}
