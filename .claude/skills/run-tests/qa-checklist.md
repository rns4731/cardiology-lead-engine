# Manual QA checklist (rung 8)

Open `outputs/screens/*.png` (and the live app for interactions). Tick each; anything that
fails becomes a finding.

## Every page
- [ ] One clear `h1`; breadcrumbs lead back up; nothing overlaps or clips.
- [ ] Numbers are in sans with proportional figures; table columns use tabular figures.
- [ ] Every entity name (person, location, system, cohort, signal) is a link.
- [ ] Charts: legend present for ≥2 series; Chart/Table toggle works; hover **and** keyboard
      focus show a tooltip; clicking a mark drills to a list whose count matches the mark.
- [ ] No value is shown for something missing (no 0% for "no data"; small n is caveated).

## Data source toggle
- [ ] Dashboard toggle switches Synthetic ⇄ Real data; KPIs, map and lists all change together.
- [ ] Toggling on a location / signal / system page keeps you on that entity; on a
      cardiologist or cohort page it lands on the index (ids differ across sources).
- [ ] Real data pages show no score, rank, window or cohort, and every signal value carries
      its provenance label (exact, stand-in, inferred, assumption, none).
- [ ] `/real/dashboard` (the retired real-identities mode) is a not-found.

## Drill paths (click, don't type URLs)
- [ ] Dashboard → map bubble → location → cohort card → member → signal → top cardiologist.
- [ ] Dashboard → "Window open now" tile → directory filtered to Now → a person → "Colleagues".
- [ ] Location → histogram bin → directory shows exactly that bin's count.
- [ ] Cohort → "Who would strengthen it" row with positive Δ → that person's "Cohorts they could join" shows the same Δ.
- [ ] Cardiologist → prev/next walks the ranking; cohort tile → cohort page.

## Edge cases
- [ ] An emerging metro (no cohort) shows the "needs N more" callout, not empty sections.
- [ ] `/synthetic/cardiologists/1`, `/public/groups/nope`, `/synthetic/signals/x`, `/nope` all
      render a friendly not-found with a way back.
- [ ] Directory: filters compose; chips remove one filter; "Clear all" resets; sort and page
      survive in the URL (reload keeps them).

## Narrow width (`WIDTH=400`)
- [ ] No horizontal page scroll; tables scroll inside their card; nav scrolls horizontally.
- [ ] Map labels don't collide; KPI tiles wrap to 2 columns.

## Honesty & copy
- [ ] Hero, KPI tiles, validation section and docs quote the same numbers as the bundle.
- [ ] Nothing says "predicts"/"will" where it means "is likely"/"scores"; weights are called
      domain-set, never "validated" or "learned".
