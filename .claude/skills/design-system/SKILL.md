---
name: design-system
description: The visual language of the web app — tokens, typography, layout, components, validated chart palettes, and the data-visualization rules every chart must follow (forms, marks, legends, table twins, tooltips, honesty for missing data). Use for any UI, styling, or chart work in web/src.
---

# Design system

Audience: an executive. The bar is "calm, editorial, trustworthy" — the data is the only
loud thing on the page.

## Tokens (`web/src/index.css` `@theme`)
| Token | Value | Use |
|---|---|---|
| `ink` | `#081020` | text, dark sections, primary buttons |
| `paper` | `#f6f7f9` | page background |
| `brand` / `brand-light` | `#0d9488` / `#14b8a6` | teal: links, meters, single-series marks |
| `accent` / `accent-light` | `#e11d48` / `#fb7185` | rose: brand gradient, timing ramp |
| `font-display` | Inter, semibold, −0.022em tracking, Display optical size | page/section **titles** |
| `font-sans` | Inter | everything else, **including every number** |

One family (the Tailwind UI / Inter type system). No serif or decorative display face —
a serif headline read as "AI-generated" to the audience.

Cards: `components/ui.tsx` `Card` (rounded-2xl, hairline border, soft shadow). Page
structure: `PageHeader` (breadcrumbs → kicker → display title → one-sentence subtitle) →
KPI `StatTile` row (each links deeper) → charts → tables. Gutters: `px-4 sm:px-6`,
`max-w-7xl`.

## Chart palettes (validated with the dataviz validator against white)
| Job | Palette | Notes |
|---|---|---|
| Subspecialty (identity) | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4` in `SUBSPECIALTY_ORDER` | PASS; 3 slots < 3:1 → always ship visible labels/legend + table view |
| Timing (ordered) | Now `#881337` → Near `#be123c` → Later `#e11d48` → Watch `#fb7185` | one-hue ordinal ramp, PASS `--ordinal` |
| Magnitude, one series | `SEQ #0d9488`, track `SEQ_TRACK #ccfbf1` | meters, bars, columns |
| Emphasis | `SEQ` vs `MUTED_MARK #cbd5e1` | "the one that matters" vs context (e.g. above/below floor) |
| Continuous map fill | `seqColor(t)` teal ramp | gray = no value |

Re-run the validator for any new palette:
`node <dataviz skill>/scripts/validate_palette.js "<hexes>" --mode light --surface "#ffffff" [--ordinal]`.
Colors are keyed by **entity**, never rank — a filter must not repaint survivors.

## Chart rules (non-negotiable)
- Every chart sits in `ChartFrame` with a **table twin**; tooltips enhance, never gate.
- ≥2 series ⇒ a legend (with values); one series ⇒ no legend box, the title names it.
- Text never wears a series color; identity comes from a dot/swatch beside ink text.
- Bars ≤ 24px, 4px rounded data-end, square at baseline; 2px surface gap between stacked
  segments; lines 2px; markers ≥ 8px with a 2px white ring; hairline solid gridlines.
- **Never a dual y-axis** — use small multiples (see `Sensitivity`).
- **Missing or small-n values are omitted and labeled, never drawn as 0** (`MIN_N`).
- Marks that drill use `useDrill(to)` (role=link, focusable, Enter) and get a hover + focus
  tooltip via `useTooltip`; the container includes its axis band (no clipped labels).
- Big numbers: proportional figures; table/axis numbers: `tabular-nums`.

## Components to reuse (don't reinvent)
`BarList`, `StackedBar`, `Histogram` (+`trimBins`), `Sensitivity`, `USMap` (+`LABEL_POS`),
`ChartFrame`/`Legend`/`Tip`, `LeadTable`, `StatTile`, `Meter`, `Pill`, entity links
(`LeadLink`, `MetroLink`, `SystemLink`, `GroupLink`, `SignalLink`, `TimingTag`, `SubTag`).

## Before you call UI work done
`node web/scripts/screenshots.mjs` (and `WIDTH=400 …`), open the PNGs, walk
`.claude/skills/run-tests/qa-checklist.md`. Tests don't see overlap or a misleading line.
