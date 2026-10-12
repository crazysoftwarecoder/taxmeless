export const usd = (v: number, digits = 0): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(v);

export const usdCompact = (v: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);

export const local = (v: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

export const pct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`;

export const STAGE_LABEL = { ingress: 'Ingress (buying in)', growth: 'Growth (each year)', egress: 'Egress (selling out)' } as const;
export const ASSET_LABEL = { equities: 'Equities', property: 'Property' } as const;
