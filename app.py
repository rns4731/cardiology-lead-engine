"""Interactive dashboard for the Independent-Cardiology Lead Engine.

    streamlit run app.py

Drill-down flow:
  1. pick a LOCATION (metro) on the map / leaderboard
  2. see that metro's GROUP candidate (viability + subspecialty mix)
  3. click a CANDIDATE to open a full profile with the score breakdown

Synthetic data; no PHI. The value is in engine/, this is the demo surface.
"""
from __future__ import annotations

import altair as alt
import pandas as pd
import streamlit as st

from engine.clustering import MIN_GROUP_SIZE, build_groups
from engine.evaluate import evaluate
from engine.generate_data import generate
from engine.scoring import FACTOR_LABELS, contributions, score_frame

st.set_page_config(page_title="Cardiology Lead Engine", layout="wide", page_icon="🫀")

# approximate metro centroids for the map
METRO_COORDS = {
    "Austin, TX": (30.27, -97.74), "Columbus, OH": (39.96, -82.99),
    "Nashville, TN": (36.16, -86.78), "Charlotte, NC": (35.23, -80.84),
    "Phoenix, AZ": (33.45, -112.07), "Tampa, FL": (27.95, -82.46),
    "Denver, CO": (39.74, -104.99), "Raleigh, NC": (35.78, -78.64),
}
TIMING_ORDER = ["Now (0-3 mo)", "Near (3-9 mo)", "Later (9-18 mo)", "Watch (18 mo+)"]
TIMING_COLOR = {
    "Now (0-3 mo)": "#1a9850", "Near (3-9 mo)": "#91cf60",
    "Later (9-18 mo)": "#fee08b", "Watch (18 mo+)": "#d9d9d9",
}


@st.cache_data(show_spinner=False)
def load(n: int, seed: int):
    scored = score_frame(generate(n=n, seed=seed))
    return scored, evaluate(scored)


# ----------------------------------------------------------------------------- sidebar
with st.sidebar:
    st.header("⚙️ Controls")
    n = st.slider("Universe size", 400, 3000, 1200, step=200)
    seed = st.number_input("Random seed", value=42, step=1,
                           help="Change to prove the result isn't cherry-picked.")
    floor = st.slider("Propensity floor", 40, 80, 55,
                      help="Minimum score to count as a qualified lead / group member.")
    st.caption("Synthetic data · no PHI · explainable scoring")

scored, metrics = load(n, int(seed))
qualified = scored[scored["propensity_score"] >= floor]
summary, members = build_groups(scored, min_score=floor)

# ----------------------------------------------------------------------------- header
st.title("🫀 Independent-Cardiology Lead Engine")
st.caption("Which hospital-employed cardiologists may go independent, *when*, and how "
           "they cluster into viable groups of 5+. Click a location, then a candidate.")

k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("Universe", f"{metrics['n']:,}")
k2.metric("Qualified leads", f"{len(qualified):,}", help=f"score ≥ {floor}")
k3.metric("Viable metros", int((summary['starter_size'] >= MIN_GROUP_SIZE).sum())
          if not summary.empty else 0, help="metros that can seed a 5+ group")
k4.metric("Precision@50", f"{metrics.get('precision@50', float('nan')):.0%}",
          help=f"{metrics.get('lift@50','?')}× better than random outreach")
k5.metric("AUC", metrics["auc"])

st.divider()

# --------------------------------------------------------------- 1. choose a location
st.subheader("① Where to focus")

# per-metro rollup
rows = []
for metro, pool in scored.groupby("metro"):
    q = pool[pool["propensity_score"] >= floor]
    top = q.nlargest(8, "propensity_score")
    viab = summary.loc[summary["metro"] == metro, "viability_score"]
    rows.append({
        "metro": metro,
        "qualified": len(q),
        "avg_top_score": round(top["propensity_score"].mean(), 1) if len(top) else 0.0,
        "ready_now_near": round((top["timing_bucket"].isin(TIMING_ORDER[:2]).mean() * 100), 0)
        if len(top) else 0.0,
        "viability": float(viab.iloc[0]) if len(viab) else 0.0,
        "can_seed_group": "✅" if len(q) >= MIN_GROUP_SIZE else "—",
        "lat": METRO_COORDS[metro][0], "lon": METRO_COORDS[metro][1],
    })
metro_tbl = pd.DataFrame(rows).sort_values("viability", ascending=False).reset_index(drop=True)

left, right = st.columns([3, 2])
with left:
    st.markdown("**Metro leaderboard** — click a row to drill in")
    ev = st.dataframe(
        metro_tbl[["metro", "qualified", "avg_top_score", "ready_now_near",
                   "viability", "can_seed_group"]],
        hide_index=True, use_container_width=True, height=330,
        on_select="rerun", selection_mode="single-row",
        column_config={
            "qualified": st.column_config.NumberColumn("Qualified leads"),
            "avg_top_score": st.column_config.NumberColumn("Avg top-8 score"),
            "ready_now_near": st.column_config.ProgressColumn(
                "% ready now/near", min_value=0, max_value=100, format="%d%%"),
            "viability": st.column_config.ProgressColumn(
                "Group viability", min_value=0, max_value=100, format="%.0f"),
            "can_seed_group": st.column_config.TextColumn("5+?"),
        },
    )
with right:
    st.markdown("**Map** — bubble size = qualified leads")
    st.map(metro_tbl, latitude="lat", longitude="lon", size="qualified", color="#d6336c")

sel = ev.selection.rows
selected_metro = metro_tbl.iloc[sel[0]]["metro"] if sel else metro_tbl.iloc[0]["metro"]
st.info(f"Selected location: **{selected_metro}**"
        + ("" if sel else "  _(showing top metro by default — click another row to change)_"))

st.divider()

# --------------------------------------------------------- 2. the group for that metro
st.subheader(f"② Group candidate — {selected_metro}")
g1, g2 = st.columns([2, 3])
with g1:
    if selected_metro in members:
        srow = summary[summary["metro"] == selected_metro].iloc[0]
        st.metric("Viability score", f"{srow['viability_score']:.0f}/100")
        st.metric("Founding cohort size", int(srow["starter_size"]))
        st.metric("Ready now/near", srow["ready_now_or_near"])
        st.caption(f"Qualified pool in metro: {int(srow['qualified_pool'])}")
    else:
        st.warning(f"Fewer than {MIN_GROUP_SIZE} qualified leads here at the current floor. "
                   "Lower the propensity floor in the sidebar to widen the pool.")
with g2:
    metro_pool = qualified[qualified["metro"] == selected_metro]
    if len(metro_pool):
        mix = (metro_pool["subspecialty"].value_counts().rename_axis("subspecialty")
               .reset_index(name="count"))
        chart = alt.Chart(mix).mark_bar().encode(
            x=alt.X("count:Q", title="Qualified leads"),
            y=alt.Y("subspecialty:N", sort="-x", title=None),
            color=alt.Color("subspecialty:N", legend=None),
            tooltip=["subspecialty", "count"],
        ).properties(height=220, title="Subspecialty mix (a viable group needs a spread)")
        st.altair_chart(chart, use_container_width=True)

st.divider()

# ------------------------------------------------------ 3. candidates + profile detail
st.subheader(f"③ Candidates in {selected_metro}")
c_left, c_right = st.columns([3, 2])

pool = (scored[scored["metro"] == selected_metro]
        .sort_values("propensity_score", ascending=False).reset_index(drop=True))

with c_left:
    tfilter = st.multiselect("Filter by timing", TIMING_ORDER, default=TIMING_ORDER)
    view = pool[pool["timing_bucket"].isin(tfilter)].reset_index(drop=True)
    st.markdown("**Click a candidate to open their profile →**")
    cev = st.dataframe(
        view[["name", "subspecialty", "employer", "propensity_score", "timing_bucket"]],
        hide_index=True, use_container_width=True, height=360,
        on_select="rerun", selection_mode="single-row",
        column_config={
            "propensity_score": st.column_config.ProgressColumn(
                "Propensity", min_value=0, max_value=100, format="%.0f"),
        },
    )

with c_right:
    crows = cev.selection.rows
    if not crows:
        st.info("Select a candidate on the left to see their full profile and the "
                "exact reasons behind their score.")
    else:
        r = view.iloc[crows[0]]
        st.markdown(f"### {r['name']}")
        st.markdown(f"**{r['subspecialty']}** · {r['employer']} · {r['metro']}")
        a, b, c = st.columns(3)
        a.metric("Propensity", f"{r['propensity_score']:.0f}")
        b.metric("Timing", r["timing_bucket"].split(" (")[0])
        c.metric("wRVU pct", f"p{r['wrvu_percentile']}")

        # score breakdown
        contrib = contributions(r)
        cdf = (pd.DataFrame({"factor": [FACTOR_LABELS[k] for k in contrib],
                             "points": list(contrib.values())})
               .query("points > 0").sort_values("points"))
        bar = alt.Chart(cdf).mark_bar(color="#d6336c").encode(
            x=alt.X("points:Q", title="Points added to score"),
            y=alt.Y("factor:N", sort="-x", title=None),
            tooltip=["factor", "points"],
        ).properties(height=max(120, 24 * len(cdf)), title="Why this score")
        st.altair_chart(bar, use_container_width=True)

        with st.expander("All attributes"):
            st.write({
                "NPI": int(r["npi"]),
                "Age": int(r["age"]),
                "Years in practice": int(r["years_in_practice"]),
                "Tenure w/ employer (yrs)": int(r["tenure_years_current_employer"]),
                "Prior independent": bool(r["prior_independent"]),
                "Peer recently left": bool(r["peer_recently_left"]),
                "Employer event": f"{r['disruption_event']} "
                                  f"({r['disruption_recency_months']} mo ago)"
                                  if r["disruption_event"] != "none" else "none",
                "Contract renewal (mo)": int(r["contract_renewal_months"]),
                "Non-compete expiry (mo)": int(r["noncompete_months"]),
                "Open Payments ($)": f"${r['open_payments_usd']:,.0f}",
                "Independent groups in metro": int(r["independent_groups_metro"]),
            })
