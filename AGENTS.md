# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

```bash
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

Other commands that may prompt: `scp`/`ssh` use `-o BatchMode=yes`; `apt-get -y`; `HOMEBREW_NO_AUTO_UPDATE=1 brew`.

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Quick Start

```bash
bd ready --json                                                   # ready work
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="..." -p 1 --deps discovered-from:bd-123 --json
bd update <id> --claim --json                                      # claim
bd close bd-42 --reason "Completed" --json                         # complete
```

### Issue Types
- `bug` — defect; `feature` — new capability; `task` — work item; `epic` — container; `chore` — maintenance.

### Priorities
- `0` critical, `1` high, `2` medium (default), `3` low, `4` backlog.

### Workflow for every agent
1. `bd ready --json` → pick an issue in your scope.
2. `bd update <id> --claim --json`.
3. Do the work inside your owned paths only (see roster below).
4. Discovered work → `bd create "…" -t task -p 2 --deps discovered-from:<id> --json`, naming the owning agent in the description.
5. `npm run validate && npm test` must be green.
6. `bd close <id> --reason "…" --json`.

### Landing the Plane
Before ending a session: commit with a conventional message (`feat:`, `fix:`, `data(tax):`, `chore:`), run `bd dolt push` if a remote is configured, and `git push`. Never leave work uncommitted.
<!-- END BEADS INTEGRATION -->

## Agent Roster and Ownership

| Agent | Owns | Must not touch |
|---|---|---|
| `tax-engineer` | `data/tax/**`, `data/countries.json`, `data/assumptions.json`, `schemas/tax.ts`, `src/engine/**` | `src/ui/**` |
| `income-tracker` | `data/gdp/**`, `schemas/gdp.ts`, `src/engine/projections.ts` (shared) | tax data, UI |
| `cost-of-living-tracker` | `data/col/**`, `schemas/col.ts` | tax data, UI |
| `ux-engineer` | `src/ui/**`, `src/styles/**`, `index.html` | `data/**`, `src/engine/**` (consumes `Ledger`/`TaxEvent` types only) |
| `qa-engineer` | `scripts/validate.ts`, `src/engine/__tests__/**`, `vitest.config.ts`, `.github/workflows/**`, `.claude/routines/*.md` | data values, UI |

## Contract Between Agents

- `schemas/*.ts` are the interface. A schema change updates the schema, **all** affected data files and `scripts/validate.ts` in the same PR, and files a `bd` task for `ux-engineer` if `Ledger`, `YearRow` or `TaxEvent` shapes change.
- The UI never reads raw `data/**` JSON; it consumes `Ledger`, `TaxEvent`, projected series and `Meta` only.
- Every researched number carries `meta.source` (https URL of a primary source) and `meta.last_verified` (ISO date). Every tax rule carries `plain_english` (2–3 sentences a non-expert understands).
- Rules are data: `applyRule()` in `src/engine/rules.ts` is the only interpreter; no country names in code.
- Simplifications go in `meta.note`, never silently.

## Cloud Routine Guardrails

Prompts in `.claude/routines/*.md` are the source of truth for the scheduled cloud routines. Every routine:
- edits only `data/**`;
- runs `npm ci && npm run validate && npm test` and aborts if red;
- works on branch `routine/<name>/<YYYY-MM-DD>` and opens exactly one PR titled `data(<domain>): refresh YYYY-MM` whose body is a per-file table of changed fields (old → new) with source URLs;
- never merges.

## Definition of Done

`npm run validate`, `npm test` and `npm run build` green; data meta present; bd issue closed with a one-line summary of sources consulted.
