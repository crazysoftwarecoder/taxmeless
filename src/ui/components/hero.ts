import type { CountryCode } from '../../../schemas';
import type { Ledger } from '../../engine/types';
import { countryColor } from '../charts/palette';
import { clear, h } from '../dom';
import { pct, usd, usdCompact } from '../format';
import type { AppState } from '../state';

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate a number from its previous value to the next (stored on the element). */
function countTo(el: HTMLElement, to: number, fmt: (v: number) => string): void {
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = String(to);
  if (reduceMotion() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const dur = 700;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1 && el.dataset.value === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let built: { host: HTMLElement; parts: Record<string, HTMLElement> } | undefined;

/** The headline: where the money ends up biggest, and how far apart the countries are. */
export function renderHero(host: HTMLElement, ledgers: Ledger[], state: AppState, names: Record<CountryCode, string>): void {
  const kind = ledgers.some((l) => l.asset === 'portfolio') ? 'portfolio' : ledgers[0]?.asset;
  const rows = ledgers.filter((l) => l.asset === kind).sort((a, b) => b.finalNetUsd - a.finalNetUsd);
  if (!rows.length) { clear(host); built = undefined; return; }
  const best = rows[0]!;
  const worst = rows[rows.length - 1]!;
  const heaviest = [...rows].sort((a, b) => b.totalsUsd.taxes.all - a.totalsUsd.taxes.all)[0]!;
  const what = kind === 'portfolio' ? `${state.alloc}/${100 - state.alloc} portfolio` : kind === 'equities' ? 'equity index portfolio' : 'investment property';

  if (!built || built.host !== host) {
    const p = {
      eyebrow: h('p', { class: 'hero-eyebrow' }),
      principal: h('span', { class: 'hero-principal' }),
      big: h('span', { class: 'hero-big' }),
      country: h('span', { class: 'hero-country' }),
      sub: h('p', { class: 'hero-sub' }),
      kept: h('strong', null), keptNote: h('span', null),
      taxBest: h('strong', null), taxBestNote: h('span', null),
      heavy: h('strong', null), heavyNote: h('span', null),
    };
    clear(host);
    host.append(
      p.eyebrow,
      h('h2', { class: 'hero-title' }, 'Your ', p.principal, ' grows to ', p.big, h('br', null), 'in ', p.country, '.'),
      p.sub,
      h('div', { class: 'hero-stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Kept after every tax'), p.kept, p.keptNote),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Tax paid there'), p.taxBest, p.taxBestNote),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Heaviest tax bill'), p.heavy, p.heavyNote),
      ),
    );
    built = { host, parts: p };
  }
  const p = built.parts;
  p.eyebrow!.textContent = `${state.horizon} years · ${what}${state.real ? " · today's dollars" : ''}`;
  p.principal!.textContent = usdCompact(state.principal);
  countTo(p.big!, best.finalNetUsd, (v) => usdCompact(v));
  p.country!.textContent = names[best.country];
  p.country!.style.setProperty('--dot', countryColor(best.country));
  p.sub!.textContent = rows.length > 1
    ? `That is ${usd(best.finalNetUsd - worst.finalNetUsd)} more than in ${names[worst.country]}, the lowest of the ${rows.length} countries you picked, after every tax and cost from buying in to selling out.`
    : 'Add more countries to compare where the same money grows furthest.';
  countTo(p.kept!, best.finalGrossUsd > 0 ? best.finalNetUsd / best.finalGrossUsd : 0, (v) => pct(v, 1));
  p.keptNote!.textContent = `of the untaxed result in ${names[best.country]}`;
  countTo(p.taxBest!, best.totalsUsd.taxes.all, (v) => usdCompact(v));
  p.taxBestNote!.textContent = `${pct(best.effectiveTaxRate)} of the gain`;
  countTo(p.heavy!, heaviest.totalsUsd.taxes.all, (v) => usdCompact(v));
  p.heavyNote!.textContent = `${names[heaviest.country]} · ${pct(heaviest.effectiveTaxRate)} of the gain`;
}
