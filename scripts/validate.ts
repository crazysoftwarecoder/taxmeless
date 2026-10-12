/**
 * Data gate: parse every data/** file with zod, check provenance freshness, cross-file consistency,
 * and dry-run the simulation for every country × asset. Exit code 1 on any failure.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  AssumptionsSchema, ColFileSchema, CountriesFileSchema, GdpFileSchema, TaxFileSchema, MetaSchema,
  type CountryCode,
} from '../schemas';
import { simulate } from '../src/engine/simulate';
import { cagr, projectCol, projectSeries } from '../src/engine/projections';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const today = process.env.VALIDATE_TODAY ?? new Date().toISOString().slice(0, 10);
const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${path}: invalid JSON (${(e as Error).message})`);
    return undefined;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Walk any object and check every { source, last_verified } meta block. */
function checkMetas(path: string, node: unknown, trail = ''): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => checkMetas(path, n, `${trail}[${i}]`));
    return;
  }
  const obj = node as Record<string, unknown>;
  if ('last_verified' in obj && 'source' in obj) {
    const r = MetaSchema.safeParse(obj);
    if (!r.success) fail(`${path}${trail}: bad meta — ${r.error.issues.map((i) => i.message).join('; ')}`);
    else {
      const age = daysBetween(r.data.last_verified, today);
      if (age < 0) fail(`${path}${trail}: last_verified ${r.data.last_verified} is in the future (today ${today})`);
      else if (age > 400) warn(`${path}${trail}: last_verified ${r.data.last_verified} is ${age} days old`);
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) checkMetas(path, v, `${trail}.${k}`);
}

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
}

// ---- countries + assumptions
const countriesRaw = readJson(join(DATA, 'countries.json'));
const countriesRes = CountriesFileSchema.safeParse(countriesRaw);
if (!countriesRes.success) fail(`data/countries.json: ${countriesRes.error.message}`);
checkMetas('data/countries.json', countriesRaw);

const assumptionsRaw = readJson(join(DATA, 'assumptions.json'));
const assumptionsRes = AssumptionsSchema.safeParse(assumptionsRaw);
if (!assumptionsRes.success) fail(`data/assumptions.json: ${assumptionsRes.error.message}`);
checkMetas('data/assumptions.json', assumptionsRaw);

// ---- per-domain files
const tax = new Map<CountryCode, ReturnType<typeof TaxFileSchema.parse>>();
for (const p of listJson(join(DATA, 'tax'))) {
  const raw = readJson(p);
  const r = TaxFileSchema.safeParse(raw);
  const rel = `data/tax/${basename(p)}`;
  if (!r.success) {
    fail(`${rel}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  if (`${r.data.country}.json` !== basename(p)) fail(`${rel}: country "${r.data.country}" does not match file name`);
  checkMetas(rel, raw);
  // stage consistency: a rule listed under assets.X.<stage> must declare that stage
  for (const asset of ['equities', 'property'] as const) {
    for (const stage of ['ingress', 'growth', 'egress'] as const) {
      for (const rule of r.data.assets[asset][stage]) {
        if (rule.stage !== stage) fail(`${rel}: assets.${asset}.${stage} rule "${rule.id}" declares stage "${rule.stage}"`);
      }
    }
  }
  tax.set(r.data.country, r.data);
}

const gdp = new Map<CountryCode, ReturnType<typeof GdpFileSchema.parse>>();
for (const p of listJson(join(DATA, 'gdp'))) {
  const raw = readJson(p);
  const r = GdpFileSchema.safeParse(raw);
  const rel = `data/gdp/${basename(p)}`;
  if (!r.success) {
    fail(`${rel}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  if (`${r.data.country}.json` !== basename(p)) fail(`${rel}: country "${r.data.country}" does not match file name`);
  checkMetas(rel, raw);
  const years = r.data.series.map((s) => s.year);
  if (new Set(years).size !== years.length) fail(`${rel}: duplicate years in series`);
  const rate = r.data.projection.method === 'manual' ? (r.data.projection.cagr ?? 0) : cagr(r.data.series);
  const proj = projectSeries(r.data.series, 25, rate);
  if (proj.some((x) => !Number.isFinite(x.value) || x.value < 0)) fail(`${rel}: projection produced non-finite or negative values`);
  gdp.set(r.data.country, r.data);
}

const col = new Map<CountryCode, ReturnType<typeof ColFileSchema.parse>>();
for (const p of listJson(join(DATA, 'col'))) {
  const raw = readJson(p);
  const r = ColFileSchema.safeParse(raw);
  const rel = `data/col/${basename(p)}`;
  if (!r.success) {
    fail(`${rel}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  if (`${r.data.country}.json` !== basename(p)) fail(`${rel}: country "${r.data.country}" does not match file name`);
  checkMetas(rel, raw);
  const proj = projectCol(r.data, 25);
  if (proj.some((y) => !Number.isFinite(y.total) || y.total <= 0)) fail(`${rel}: cost-of-living projection invalid`);
  col.set(r.data.country, r.data);
}

// ---- cross-file consistency + dry-run simulate
if (countriesRes.success && assumptionsRes.success) {
  for (const c of countriesRes.data.countries) {
    if (!tax.has(c.code)) warn(`data/countries.json: ${c.code} has no data/tax/${c.code}.json yet`);
    if (!gdp.has(c.code)) warn(`data/countries.json: ${c.code} has no data/gdp/${c.code}.json yet`);
    if (!col.has(c.code)) warn(`data/countries.json: ${c.code} has no data/col/${c.code}.json yet`);
    const t = tax.get(c.code);
    if (t && t.currency !== c.currency) fail(`data/tax/${c.code}.json: currency ${t.currency} ≠ countries.json ${c.currency}`);
    const cl = col.get(c.code);
    if (cl && cl.currency !== c.currency) fail(`data/col/${c.code}.json: currency ${cl.currency} ≠ countries.json ${c.currency}`);
  }
  for (const [code, t] of tax) {
    const c = countriesRes.data.countries.find((x) => x.code === code);
    if (!c) {
      fail(`data/tax/${code}.json: ${code} missing from data/countries.json`);
      continue;
    }
    for (const asset of ['equities', 'property'] as const) {
      for (const band of ['low', 'mid', 'high'] as const) {
        for (const H of [1, 10, 25]) {
          const a = assumptionsRes.data;
          const ledger = simulate(
            {
              horizonYears: H,
              principalUsd: a.principal_usd,
              equities: { growth: a.equities.growth, yield: a.equities.yield },
              property: { growth: a.property.growth, yield: a.property.yield, costRate: a.property.cost_rate },
              otherIncomeBand: band,
            },
            t, asset, a, c.fx_to_usd.value,
          );
          const bad = ledger.rows.some((r) => !Number.isFinite(r.netValueUsd) || !Number.isFinite(r.grossValueUsd));
          if (bad) fail(`data/tax/${code}.json: ${asset}/${band}/${H}y produced NaN/Infinity`);
          if (ledger.finalNetUsd > ledger.finalGrossUsd + 1e-6) fail(`data/tax/${code}.json: ${asset}/${band}/${H}y net (${ledger.finalNetUsd.toFixed(0)}) exceeds gross (${ledger.finalGrossUsd.toFixed(0)})`);
          if (ledger.finalNetUsd <= 0) fail(`data/tax/${code}.json: ${asset}/${band}/${H}y net value is not positive`);
        }
      }
    }
  }
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`validate: ${tax.size} tax, ${gdp.size} gdp, ${col.size} col files; ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
