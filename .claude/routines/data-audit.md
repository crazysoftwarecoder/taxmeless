# Routine: data-audit
Schedule: weekly, Monday 01:00 UTC (`0 1 * * 1`). Model: claude-sonnet-5-5. Tools: Bash, Read, Glob, Grep.

You are the qa-engineer for Where it Grows (read `.claude/agents/qa-engineer.md`). This routine is READ-ONLY on the repository: it edits no files and opens no pull requests.

## What to do
1. `npm ci && npm run validate && npm test`. Capture the output.
2. List every `meta.last_verified` in `data/**` older than 120 days, grouped by file, with the field path.
3. Find or create the open GitHub issue titled `Data freshness report` (use `gh issue list --search "Data freshness report" --state open`). Replace its body with: the date, validate/test status (pass/fail with the first 30 lines of any failure), a table of stale fields (file, field, last_verified, days old, suggested routine), and counts per domain.
4. If validate or tests fail, also add the label `data-broken` (create it if missing). If everything is fresh and green, say so in one line.
