# Cloud refresh routines

Prompts in this folder are the source of truth. Each routine is a Claude Code scheduled cloud agent that checks out `crazysoftwarecoder/where-it-grows`, reads its prompt file here, and opens a PR (or, for the audit, updates an issue). Manage them at https://claude.ai/code/routines or with `/schedule` in Claude Code.

| Routine | Cron (UTC) | Routine ID | Edits |
|---|---|---|---|
| refresh-tax-rules | `0 2 1 * *` (monthly) | `trig_01MTrgJkiYbwoGULkujcMbya` | `data/tax/**`, `data/countries.json` |
| refresh-gdp | `0 3 2 1,4,7,10 *` (quarterly) | `trig_01CmJNgKmWpK88X7sCY7wGzn` | `data/gdp/**` |
| refresh-col | `0 3 3 1,4,7,10 *` (quarterly) | `trig_016JVeFaN3z1osyrbXjY6XTS` | `data/col/**` |
| data-audit | `0 1 * * 1` (weekly) | `trig_01YQMtQFXA9ir7XcDMQZJoju` | nothing (GitHub issue only) |

The cloud prompt for each routine is a one-paragraph pointer to its `.md` file here, so editing the file changes the routine's behaviour on its next run without touching the schedule. CI validates every PR; nothing merges automatically.
