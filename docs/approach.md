# Approach — Independent-Cardiology Lead Engine

## 1. The problem, reframed as a funnel
The growth team needs to convert the large, hard-to-reach pool of **hospital-employed
cardiologists** into founding members of new independent groups. That is a four-stage
funnel:

```
IDENTIFY who (and when)  →  FIND/VERIFY contact  →  GAUGE real interest  →  ASSEMBLE groups of 5+
```

Each stage filters the previous one, and the **first stage gates everything** — you
cannot verify, qualify, or cluster people you never identified. Today the Company only
sees the tiny self-selected slice who raise their hand (inbound). The leverage is in
systematically surfacing the rest *before* a competitor or inertia does.

## 2. What I chose to build, and why
**Built:** the **identify-and-time** engine + **group assembly**.
- *Identify/time* is the widest, hardest, most defensible stage and the one with no
  off-the-shelf substitute. It is also where AI engineering actually shows: turning
  messy public signals into a ranked, explainable, time-aware target list.
- *Group assembly* is a cheap, high-impact extension of the same scored data and maps
  directly to the Company's stated goal (5+ cardiologists per group). It makes the
  output a *business plan for a new group*, not just a list of names.

**Not built (deliberate):**
- **Contact find/verify** — real value, but largely an enrichment/plumbing problem with
  mature vendors (Apollo, Clearbit, ZoomInfo). I'd integrate, not reinvent. Designed in
  §6, not coded.
- **Interest-gauging / outreach** — depends on data we don't have yet (actual
  conversations) and risks feeling like spam. Right to defer until there's a scored list
  worth acting on.
- **Auth, multi-user, productionization** — out of scope for a prototype. The UI *is*
  built to an executive standard (see §5b), because a growth team only adopts what it
  can read and trust at a glance.

Picking the narrow, defensible slice and finishing it end-to-end was the point.

## 3. The scoring model
A **transparent additive model**, not a black box — chosen on purpose:
- The growth team must *trust and act on* each lead. A score they can't explain to a
  skeptical cardiologist is unusable.
- With no outcome data yet, domain-reasoned weights are the honest starting point; you
  earn the right to a learned model once outreach outcomes accumulate.

Each cardiologist gets a **propensity score (0–100)** = Σ weight × factor, and every
material factor emits a human-readable reason. Weighted drivers (see `scoring.py`):

| Signal | Why it predicts a move | Weight |
|---|---|---|
| Employer M&A / distress | Biggest real-world trigger to leave | 18 |
| Career stage | Established but not near-retirement (~10–22 yrs) | 14 |
| Prior independent experience | Has done it before | 12 |
| Subspecialty economics | Procedure-heavy (interventional, EP) → viable solo economics | 12 |
| Productivity (wRVU percentile) | Can sustain a book of business | 10 |
| Peer recently left | Social proof / window is open | 8 |
| Local independent density | Referral & operational scaffolding exists | 8 |
| Recent employer change | Already in motion / unsettled | 8 |
| Contract renewal window | Natural decision point approaching | 5 |
| Industry engagement (Open Payments) | Entrepreneurial proxy | 5 |

**Timing is a separate, first-class output.** "Who" is table stakes; "when" is what makes
outreach land. A readiness bucket — **Now / Near / Later / Watch** — is computed from
trigger-event recency, contract renewal, non-compete expiry and a peer having just left.
Two caveats, stated plainly:
- **Timing at its sharpest needs relationship data.** Contract and non-compete dates aren't
  public; on public inputs alone readiness tops out at 57, below "Now" (65).
- **The month ranges are rule-based, not validated.** The simulated outcome has no time
  dimension, so the prototype can't test whether "Now" really means 0–3 months. A pilot
  should track time-to-first-meeting by window.

## 4. What the validation proves — and what it can't
The generator embeds a hidden `will_move_24mo` outcome and the scorer sees only observable
features. But that outcome is a function of **the same ten hypotheses the scorer encodes**
(plus noise). So the evaluation proves the pipeline and the harness — it cannot prove the
hypotheses. Only real outcomes can, ideally against a **random holdout** of leads the team
does not prioritize. The metrics:

- **Precision@K** — of the top K leads, how many actually move. This is what a rep's day
  feels like.
- **Lift@K** — precision@K ÷ base rate. How much better than untargeted outreach.
- **AUC** — overall rank quality: pick one cardiologist who moved and one who didn't; AUC
  is how often the model ranks the mover higher (0.5 = coin flip, 1.0 = perfect). Kept in
  the app's collapsed *Model diagnostics*; the main surfaces show hit rate, lift and baseline.
- **Coverage** — share of the universe we can score (actionability at scale).

**Results (synthetic, seed 42):** base move rate 19.7%; 11 of the top 25 move (44%) —
**≈2× lift** (2.24×, 95% CI 1.4–3.2×; one simulated draw). AUC **0.621 against a
best achievable 0.627** — the AUC of a ranker that knows each cardiologist's exact simulated
odds, on the same draw. Because the label is a coin toss on those odds, no ranker beats it on
average (one draw can land slightly above by luck). Measured above chance, the scorer gets
~95% of the way there (0.121 of 0.127) — close because it shares the outcome's assumptions.
Across 50 simulated universes lift@25 ranged 1.7–4.0× (seed 42 sits at the 24th
percentile), so read the headline as "about 2×", not as a precise figure.

**Every signal is also tested on its own**, with a 95% interval on its standalone AUC.
At n=1,200 only **3 of 10 are distinguishable from chance alone** (career stage, prior
independent experience, productivity). The other 7 are **inconclusive, not null** — every
signal has a real effect in the simulation, but small effects don't separate from noise at
this size, and employer disruption varies across just 4 of 23 employers. The conclusion is
"measure these in the pilot", not "reweight now". (An earlier version of the app labeled
three of them "no signal — candidates to down-weight"; the adversarial review showed those
verdicts flipped from seed to seed.)

**Disclosure control.** Outcome aggregates are only published over ≥20 leads, and nested
top-n figures must be ≥20 leads apart — otherwise subtracting one from another reveals
individual outcomes (the review recovered five that way). Precision@50 is withheld for that
reason; the validator enforces the rule on every export.

**A back-test on real data** (`engine/backtest.py`). There is no record of who left hospital
employment, so the Real data mode uses an *inferred* outcome: rebuild the signals as they stood
at the Oct 2022 CMS Doctors & Clinicians snapshot, then check who appeared in an
independent-style group by Oct 2024. 935 hospital-based cardiologists in seven states; 44 moved
(4.7%). L2 logistic regression, scored out-of-fold on held-out doctors. The pass rule was fixed
before running: the out-of-fold AUC's 95% interval must sit above 0.5. It passed — the top 50
held-out doctors included 10 movers (20% vs 4.7%, ~4.3×, likely 2.4–7.0×) — but:
- it failed the cross-check: the same score didn't predict the other inferred outcome (switching
  to office-dominant billing, 2022 → 2024; AUC 0.55, CI 0.47–0.63);
- most fitted directions are the opposite of the hypotheses above (lower productivity and fewer
  independent groups nearby point toward moving); three of nine point the expected way, and only
  industry payments and prior independent practice do so reliably (same sign in 100% and 93% of
  bootstrap refits; career stage's 2 points flip in over a third of them);
- the mover count swings from 12 to 56 depending on the window, so some "moves" may be quirks of
  how CMS lists groups.

So the Real data mode shows these scores as *leads to check, not a forecast*, with the warnings
beside them. The weak link is the outcome definition, not the model.

On real outreach these become: contact-verification hit rate, outreach→meeting rate, and
ultimately **# of viable 5+ groups formed** — the only metric the Company truly cares
about.

## 5. Group assembly
Geography is a hard constraint (a group is physical and local), so we cluster by metro.
A *candidate* founding cohort also needs size, collective propensity, subspecialty mix
(interventional + EP + general + imaging covers a service line), and timing alignment.
Any set of cardiologists gets a **viability score**:

```
viability = 0.40·avg_propensity + 0.25·size + 0.20·subspecialty_diversity + 0.15·timing_readiness
```

**Cohort formation** partitions each metro's qualified pool (score ≥ 55) into disjoint
founding cohorts of 5–8 by greedy viability maximization: build the strongest cohort first
by repeatedly adding whoever raises its viability most, then build the next from who
remains. It scores higher on viability than taking the top 8 by score (Phoenix: 81.1 vs
78.3) by trading a little average propensity for a fuller subspecialty mix and open
windows. Seed 42 yields 7 candidate cohorts in 4 metros; leftovers form a "bench".

**Cohorts are outreach slates, not groups.** Viability is a score, not a forecast: in
simulation qualified cardiologists move at 41%, so an 8-person cohort yields about 3
founders, and only 1 of the 7 seed-42 cohorts would actually produce five. Landing five
founders means approaching roughly 13 qualified candidates — which is why, for every
unplaced cardiologist, the engine computes the **Δ viability if they joined** each cohort
(or swapped in, when it's full), turning "who else should we call?" into a ranked list.

## 5b. The application
A React app (`web/`) renders the engine's output; it never re-implements the math. Every
location, hospital system, cohort, cardiologist and signal has its own page, and every
number links to the people behind it: dashboard → map → location → cohort → member → the
signal that drove their score. Each cardiologist page shows why the score, why the timing
window, the cohorts they could join (with Δ viability), and three kinds of related
cardiologists — colleagues at the same employer (likely to move together), similar signal
profiles, and the strongest candidate from each other subspecialty.

A dashboard toggle switches between the **synthetic** universe (with a hidden outcome, used
to test the pipeline) and **Real data**: real cardiologists from public CMS records, with
signals filled from real records where they exist, each labeled by provenance, and scores from
the back-test (§4) shown with its warnings; no timing windows or cohorts. A **News** page in each
mode shows every article the news pipeline read and what Claude extracted. An earlier mode put
real NPI-registry names on simulated signals; it was removed, because a simulated score
next to a real physician reads as a fact about them and adds nothing the synthetic universe
doesn't already show.

## 6. What I'd do next (in priority order)
1. **Wire the remaining public sources** — *now done in the Real data mode*: CMS Doctors &
   Clinicians snapshots 2019–2026 (billing groups, graduation year, hospital affiliations),
   Medicare work RVUs, Open Payments, hospital ownership changes, and a news pipeline (Claude
   reads articles; an event counts only when its quote is verbatim in the article). Nine of the
   ten signals have real inputs (one exact; the rest stand-ins, inferences or an assumed lookup);
   contract window has no public source. A back-test on an inferred outcome exists (§4) but failed
   its cross-check; what's still missing is a *confirmed* outcome to fit and check weights against.
2. **Contact verification layer** — vendor enrichment with a confidence score; only
   promote verified leads into cohorts.
3. **Learn the weights** — once outreach outcomes exist, fit a calibrated model and
   keep the rationale via SHAP-style attributions (preserving explainability).
4. **Timing triggers as a stream** — re-score on new events (a merger, a departure) and
   alert the team when a dormant lead goes hot.
5. **Cohort optimizer** — the greedy former is a good heuristic; an exact optimizer
   (e.g. an ILP over a whole metro) and drive-time geography instead of city limits.

## 7. Assumptions (stated, per the brief)
- ~24-month horizon for "will move"; tune with the Company's sales cycle.
- Metro is the right geographic unit for a group; refine to drive-time if needed.
- 5+ is the minimum viable group (from the brief); starter cohort sized at up to 8.
- Subspecialty mix matters for group viability; validate the exact mix with operators.

## 8. Data & AI tools
- **Data:** no PHI. Real data mode uses public CMS records only and simulates nothing.
  **Hospital systems use placeholder names** ("Denver System A") — the generator attaches
  simulated mergers and distress to employers, and an evocative invented name ("Rocky
  Mountain Regional") turned out to match a real VA medical center. In Synthetic mode no
  signal is connected to data — every value is simulated and labeled so; the app names
  where each would come from in production. Real data mode fills nine of the ten signals
  from public records (CMS Medicare billing, Doctors & Clinicians snapshots, Open Payments,
  ownership changes, and news), each labeled exact, stand-in, inferred or assumption; only one
  is exact. Its scores come from the back-test in §4, on an inferred outcome, and are shown as
  leads to check. Timing also needs contract and non-compete dates, which only relationships
  provide. In Synthetic mode employer disruption is read by the news pipeline from fictional
  articles Claude wrote about the simulator's own events (no real organization is named).
- **Engineering practice:** 84 engine tests (including "flipping the hidden label changes no
  score"), a bundle-contract validator the exporter runs before writing, 62 web tests
  including a crawler that follows every link from the Synthetic dashboard and fails on any dead
  end (the Real data pages are checked in a real browser, not in the vitest suite), and visual QA
  in a real browser at desktop and phone width. The repo ships a `.claude/`
  folder with skills, an adversarial review process and the testing ladder. **The review was
  run on this build:** four red teams raised 39 findings; all reproduced (37 unique), and
  every one was fixed with a regression test that failed first — see
  `.claude/reviews/2026-10-29-full-review.md`.
- **AI tools:** built with Claude Code — code generation, data modeling, the web app, the
  test suites and this write-up — with the decisions, scoping and verification reviewed at
  each step. Inside the product, Claude (`claude-opus-5-5`) reads news articles and extracts
  employer events; an event is kept only if its quote appears word for word in the article.
  It also wrote the fictional articles the Synthetic mode reads. Nothing proprietary used.
