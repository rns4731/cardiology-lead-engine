---
name: adversarial-review
description: Adversarial code review for this repo — four red-team agents attack a change from different angles (correctness, data integrity, frontend, methodology), a judge agent independently reproduces every finding and rejects what it can't, then confirmed findings are fixed test-first. Use before merging any non-trivial change, before a demo, or when the user asks for a review, red team, audit, or "try to break it".
argument-hint: "[paths or 'all' — default: files changed since the last review]"
---

# Adversarial review

A single reviewer finds plausible-sounding problems; many are wrong. This process
separates **attack** (red teams, optimized for recall) from **judgment** (a judge,
optimized for precision) and refuses to fix anything without a failing test first.

Read `rubric.md` (severity, invariants, finding format) before starting. Write the final
report with `report-template.md`.

## Phase 0 — Scope (you, ~2 min)

1. Determine the change set:
   - git repo: `git diff --name-only <base>...HEAD` plus `git status --porcelain`.
   - not a git repo (true today): use `$ARGUMENTS` paths, or files newer than the last
     report: `find engine web/src tests -newer .claude/reviews/LAST -type f` (create the
     marker after each review: `mkdir -p .claude/reviews && touch .claude/reviews/LAST`).
   - `all` = the full engine + web/src.
2. Run the baseline so reviewers attack a green build: `scripts/smoke.sh --fast`.
   If it is red, stop — fix the build first; a review on a red build is noise.
3. Write a 5-line **change brief**: what changed, why, which invariants it touches
   (rubric §2), which pages/bundle fields it affects.

## Phase 1 — Attack (parallel red teams)

Launch the four red-team agents **in one message** (they are independent), each with the
change brief + file list + "attack only your lens; cite file:line; every finding needs a
reproduction":

| Agent | Lens |
|---|---|
| `red-team-correctness` | engine math, edge cases, determinism, numeric stability |
| `red-team-data-integrity` | label leakage, bundle contract drift, provenance, PHI, real-mode honesty |
| `red-team-frontend` | dead ends, wrong-source data, state bugs, a11y, dataviz rules, responsive |
| `red-team-methodology` | claims vs. evidence, misleading numbers or copy, overclaiming |

Scale down for small changes: a pure-CSS change needs only `red-team-frontend`; an engine
change always gets correctness + data-integrity + methodology.

## Phase 2 — Judge

Send **all** findings (verbatim, with their repros) to `review-judge`. It must, for each:
reproduce it (run the repro / write a throwaway check in the scratchpad), mark
`CONFIRMED` / `PLAUSIBLE` / `REJECTED` with evidence, merge duplicates, assign severity per
the rubric. The judge never edits project files.

Show the user the judged table before fixing anything S1/S2 that changes behavior they
may care about (e.g. a locked headline metric moving).

## Phase 3 — Fix, test-first

For each `CONFIRMED` S1/S2 (and S3s that are cheap):
1. `test-engineer` writes a regression test that **fails on the current code** for the
   reason stated — pytest in `tests/` for engine, vitest in `web/src/test/` for UI. Run it;
   paste the failure. A test that passes before the fix proves nothing.
2. Implement the smallest fix that makes it pass. Respect every invariant.
3. If the fix changes bundle shape: bump `SCHEMA_VERSION`, update `types.ts` and
   `bundle_check.py`, re-export (`/export-data`).

`PLAUSIBLE` items: write the test anyway if cheap; otherwise list under residual risk.

## Phase 4 — Verify and re-attack

1. `scripts/smoke.sh` (full, including screenshots if the dev server is up) — all green.
2. Re-run **only the lens that found each S1/S2** against the fix diff, asking it to break
   the fix. New findings loop back to Phase 2 (cap: 2 loops, then report as residual risk).
3. Write the report (`report-template.md`) to `.claude/reviews/<date>-<slug>.md`, touch
   `.claude/reviews/LAST`, and summarize for the user: counts by verdict/severity, what was
   fixed, tests added, residual risk.

## Rules

- No repro, no finding. "Could be a problem" without a concrete input → output is rejected.
- Red teams and the judge are read-only on project files (scratchpad only).
- Never weaken a test or an invariant to make a finding go away; if an invariant itself is
  wrong, say so to the user and stop.
- Don't fix style nits in the same pass as correctness fixes.
