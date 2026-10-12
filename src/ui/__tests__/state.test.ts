import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, decodeState, encodeState } from '../state';

describe('url state codec', () => {
  it('round-trips', () => {
    const s = { ...DEFAULT_STATE, horizon: 25, countries: ['de', 'ch'] as const, asset: 'property' as const, eqGrowth: 6.5, income: 'high' as const };
    const q = encodeState({ ...s, countries: [...s.countries] });
    expect(q).toBe('?h=25&c=de%2Cch&a=property&eg=6.5&inc=high');
    expect(decodeState(q)).toEqual({ ...s, countries: [...s.countries] });
  });
  it('defaults are omitted and garbage falls back', () => {
    expect(encodeState(DEFAULT_STATE)).toBe('');
    const d = decodeState('?h=999&c=xx,au,au&a=nope&eg=abc');
    expect(d.horizon).toBe(DEFAULT_STATE.horizon);
    expect(d.countries).toEqual(['au']);
    expect(d.asset).toBe('both');
    expect(d.eqGrowth).toBe(DEFAULT_STATE.eqGrowth);
  });
  it('round-trips leverage', () => {
    const q = encodeState({ ...DEFAULT_STATE, lvr: 60, rate: 5.5 });
    expect(q).toBe('?lv=60&mr=5.5');
    expect(decodeState(q).lvr).toBe(60);
    expect(decodeState('?lv=150').lvr).toBe(0);
  });
  it('round-trips the allocation', () => {
    expect(encodeState({ ...DEFAULT_STATE, alloc: 70 })).toBe('?al=70');
    expect(decodeState('?al=70').alloc).toBe(70);
    expect(decodeState('?al=140').alloc).toBe(50);
  });
  it('caps the number of countries', () => {
    const d = decodeState('?c=au,us,uk,ca,nz,sg,ae,de,ch,in');
    expect(d.countries).toHaveLength(8);
  });
});
