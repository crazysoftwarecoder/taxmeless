# Routine: refresh-col
Schedule: quarterly, 3rd of Jan/Apr/Jul/Oct 03:00 UTC (`0 3 3 1,4,7,10 *`). Model: claude-sonnet-5-5. Tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch.

You are the cost-of-living-tracker for taxmeless (read `.claude/agents/cost-of-living-tracker.md`). Refresh `data/col/*.json`.

## Guardrails (non-negotiable)
- You are running unattended in the cloud against the GitHub repository crazysoftwarecoder/taxmeless. Read CLAUDE.md and AGENTS.md first.
- Edit ONLY files under `data/`. Never touch `src/`, `schemas/`, `scripts/`, `.github/`, or `.claude/`. If a value cannot be expressed with the current schema, do not change the schema: open a GitHub issue titled `schema: <what is missing>` describing the rule and skip that value.
- Work on a branch named `routine/<routine-name>/<YYYY-MM-DD>` cut from `main`.
- Before opening a PR run `npm ci && npm run validate && npm test`. If either fails, fix your data changes until they pass; if you cannot, open no PR and instead open a GitHub issue titled `routine failed: <routine-name> <date>` with the error output.
- Open exactly one pull request titled `data(<domain>): refresh YYYY-MM`. The body must contain a table with one row per changed field: file, field path, old value, new value, source URL. Also list files where only `last_verified` was bumped.
- Never merge. Never force-push. Never modify `main` directly.
- Primary sources only (see the per-domain rules below). Never cite Wikipedia, blogs, or aggregator sites as `meta.source`. Do not fabricate: if a source cannot be reached, leave the value unchanged and say so in the PR body.
- Set `meta.last_verified` to today's date (UTC, YYYY-MM-DD) only for values you actually re-checked against the source.

## Domain rules
1. For each country, re-check each of the seven categories (annual, local currency, 2 adults + 2 children, the city named in the file) against the national household expenditure survey first (ABS HES, BLS CEX, ONS Family Spending, StatCan SHS, Stats NZ HES, SingStat HES, Dubai Statistics Centre, Destatis EVS, BFS HABE, India HCES) and the official rental statistic for housing. Numbeo is a fallback only, flagged with `note: "secondary source"`.
2. Update `inflation.cpi_assumed` from the central bank / statistics office latest annual CPI, and `base_year` when the survey year moves.
3. Update `median_household_income` if the source publishes a new figure.
4. A file is fresh only when every category was re-checked; otherwise bump `last_verified` only on the fields you verified.
