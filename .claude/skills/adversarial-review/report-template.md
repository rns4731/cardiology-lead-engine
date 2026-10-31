# Adversarial review — <date> — <change slug>

## Scope
- Files: <list or "all">
- Change brief: <5 lines>
- Baseline: `scripts/smoke.sh --fast` → <green / red (stopped)>

## Summary
| | S1 | S2 | S3 |
|---|---|---|---|
| Confirmed | | | |
| Plausible | | | |
| Rejected | | | |

## Confirmed findings
| # | Title | Sev | Lens | Location | Fixed | Regression test |
|---|---|---|---|---|---|---|
| 1 | | | | | yes/no | tests/…::test_… (failed before, passes after) |

### 1. <title>
- Evidence (judge): <command + output excerpt>
- Fix: <what changed, file:line>
- Re-attack: <lens re-run on the fix — result>

## Plausible (not fixed) — residual risk
- <title> — why not triggered; what would trigger it; suggested test.

## Rejected (for the record)
- <title> — reason (misread / duplicate of #n / deliberate decision, see rubric §5).

## Verification
- `scripts/smoke.sh` → <pytest n passed · bundle_check OK · vitest n passed · build OK · screenshots OK>
- Locked metrics unchanged: <yes / re-baselined because …, docs updated>
