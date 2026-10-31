import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import { useData, useSubspecialties } from "../lib/data";
import { aucVerdict, ci, pct } from "../lib/format";
import { SUBSPECIALTY_COLORS, TIMING_COLORS, TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { SourceToggle } from "../components/layout/SourceLayout";
import { Card, CardHeader, Meter, Pill, SectionTitle, StatTile, TextLink } from "../components/ui";
import { ChartFrame } from "../components/charts/ChartFrame";
import { StackedBar } from "../components/charts/StackedBar";
import { Sensitivity } from "../components/charts/Sensitivity";
import { USMap } from "../components/charts/USMap";
import { BarList } from "../components/charts/BarList";
import { LeadTable } from "../components/LeadTable";
import { ModelDiagnostics } from "../components/Diagnostics";
import { GroupCard } from "./GroupsPage";

export default function DashboardPage() {
  const { source, bundle, index } = useData();
  const { meta, metros, groups, leads, sweep, signals } = bundle;
  const floor = meta.operatingFloor;
  const m = meta.metrics;
  const subs = useSubspecialties();

  const qualified = metros.reduce((s, x) => s + x.qualified, 0);
  const grouped = groups.reduce((s, g) => s + g.members.length, 0);
  const viableMetros = new Set(groups.map((g) => g.metro)).size;
  const timing = useMemo(() => {
    const c: Record<string, number> = { Now: 0, Near: 0, Later: 0, Watch: 0 };
    leads.forEach((l) => c[l.timingBucket]++);
    return c;
  }, [leads]);
  const mixQ = useMemo(() => {
    const c: Record<string, number> = {};
    metros.forEach((x) => Object.entries(x.mixQualified).forEach(([k, v]) => (c[k] = (c[k] ?? 0) + v)));
    return c;
  }, [metros]);
  const actNow = useMemo(
    () => leads.filter((l) => l.propensity >= floor && (l.timingBucket === "Now" || l.timingBucket === "Near")),
    [leads, floor]
  );

  return (
    <>
      <PageHeader
        kicker="Growth pipeline"
        title="Where to build the next independent group"
        subtitle={
          <>
            {bundle.source.description} Every number below is clickable — drill from a location
            to its cohorts, to the cardiologists inside them, to the signals behind each score.
          </>
        }
        actions={<SourceToggle />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Cardiologists scored" value={leads.length.toLocaleString()} sub={`${metros.length} metros`} to={paths.cardiologists(source)} />
        <StatTile
          label={`Qualified (score ≥ ${floor})`}
          value={qualified.toLocaleString()}
          sub={`${pct(qualified / leads.length)} of universe`}
          to={paths.cardiologists(source, { min: floor })}
        />
        <StatTile label="Candidate cohorts" value={groups.length} sub={`in ${viableMetros} metros`} to={paths.groups(source)} />
        <StatTile
          label="Placed in a cohort"
          value={grouped.toLocaleString()}
          sub={`${(qualified - grouped).toLocaleString()} on the bench`}
          to={paths.cardiologists(source, { group: "in" })}
        />
        <StatTile
          label="Window open now"
          value={timing.Now.toLocaleString()}
          sub={`${timing.Near.toLocaleString()} more in 3–9 mo`}
          to={paths.cardiologists(source, { timing: "Now" })}
        />
        <StatTile
          label={source === "real" ? "Top 25 vs. random (simulated)" : "Top 25 vs. random"}
          value={`${m.lift["25"]}×`}
          sub={`${pct(m.precision["25"])} moved vs ${pct(m.baseRate)} overall · likely ${ci(m.liftCi["25"], 1)}×`}
          to={paths.signals(source)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartFrame
          className="lg:col-span-2"
          title="Where qualified cardiologists are"
          subtitle="Click a location to open it."
          table={{
            columns: ["Location", "Qualified", "Cohorts", "Best viability"],
            rows: metros.map((x) => [
              <Link className="text-teal-700 hover:underline" to={paths.location(source, x.slug)}>{x.metro}</Link>,
              x.qualified,
              x.groups.length,
              x.bestViability?.toFixed(0) ?? "—",
            ]),
          }}
        >
          <USMap metros={metros} hrefFor={(x) => paths.location(source, x.slug)} />
        </ChartFrame>

        <Card>
          <CardHeader title="Locations by readiness" subtitle="Ranked by best cohort viability" action={<TextLink to={paths.locations(source)}>All</TextLink>} />
          <ul className="mt-3 divide-y divide-slate-100 px-2 pb-2">
            {metros.map((x) => (
              <li key={x.slug}>
                <Link to={paths.location(source, x.slug)} className="block rounded-xl px-3 py-2 transition hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{x.metro}</span>
                    {x.groups.length ? (
                      <Pill tone="emerald">{x.groups.length} cohort{x.groups.length > 1 ? "s" : ""}</Pill>
                    ) : (
                      <Pill>needs {x.gapToViable} more qualified</Pill>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <Meter value={x.bestViability ?? 0} max={100} color="#0d9488" track="#ccfbf1" height={6} />
                    <span className="w-24 shrink-0 text-right text-xs text-slate-500">
                      <span className="font-semibold tabular-nums text-ink">{x.bestViability?.toFixed(0) ?? "—"}</span> ·{" "}
                      {x.qualified} qualified
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <SectionTitle action={<TextLink to={paths.groups(source)}>All cohorts <ArrowRight size={14} /></TextLink>}>
        Strongest founding cohorts
      </SectionTitle>
      {groups.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {groups.slice(0, 4).map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-sm text-slate-500">No metro has five qualified cardiologists yet.</Card>
      )}

      <SectionTitle
        action={
          <TextLink to={paths.cardiologists(source, { min: floor, timing: "Now,Near" })}>
            All {actNow.length} <ArrowRight size={14} />
          </TextLink>
        }
      >
        Act now: qualified, window open within 9 months
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-slate-500">
        Windows are rule-based estimates of when to call. The simulated outcome has no timing, so the month ranges aren't
        validated — a pilot should measure time-to-first-meeting.
      </p>
      <Card className="p-3">
        <LeadTable leads={actNow} pageSize={8} cols={["rank", "name", "metro", "subspecialty", "propensity", "timing", "group"]} />
      </Card>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame
          title="When windows open"
          subtitle="All scored cardiologists by readiness window. Click a segment to list them."
          table={{ columns: ["Window", "Cardiologists"], rows: TIMING_ORDER.map((t) => [t, timing[t]]) }}
        >
          <StackedBar
            segments={TIMING_ORDER.map((t) => ({
              key: t,
              label: `${t} (${meta.timing.buckets.find((b) => b.name === t)?.range})`,
              value: timing[t],
              color: TIMING_COLORS[t],
              to: paths.cardiologists(source, { timing: t }),
            }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Qualified pool by subspecialty"
          subtitle="A viable group needs a spread. Click a segment to list them."
          table={{ columns: ["Subspecialty", "Qualified"], rows: subs.map((s) => [s, mixQ[s] ?? 0]) }}
        >
          <StackedBar
            segments={subs.filter((s) => (mixQ[s] ?? 0) > 0).map((s) => ({
              key: s,
              label: s,
              value: mixQ[s] ?? 0,
              color: SUBSPECIALTY_COLORS[s],
              to: paths.cardiologists(source, { sub: s, min: floor }),
            }))}
          />
        </ChartFrame>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <ChartFrame
          className="lg:col-span-3"
          title="Threshold sensitivity"
          subtitle={`A higher score floor means fewer leads, but more of them move. Operating floor: ${floor}. Hover to compare.`}
          table={{
            columns: ["Floor", "Qualified", "Hit rate", "Movers caught", "Cohorts"],
            rows: sweep.map((r) => [
              r.floor,
              r.qualified,
              r.precision != null ? pct(r.precision, 1) : "withheld",
              r.recall != null ? pct(r.recall, 1) : "withheld",
              r.groups,
            ]),
          }}
          footer={
            source === "real"
              ? "Hit rate = share of qualified leads who moved; movers caught = share of all movers who qualified. Both use the simulated outcome: they demonstrate the method, not real-world accuracy. Small or overlapping cells are withheld so no individual outcome can be inferred."
              : "Hit rate = share of qualified leads who moved; movers caught = share of all movers who qualified. Both use a simulated outcome built from the model's own hypotheses — they test the pipeline, not the hypotheses. Small or overlapping cells are withheld so no individual outcome can be inferred."
          }
        >
          <Sensitivity sweep={sweep} floor={floor} minN={meta.minN} />
        </ChartFrame>
        <ChartFrame
          className="lg:col-span-2"
          title="The ten signals"
          subtitle={`Weight in the score, and whether each one predicts on its own${source === "real" ? " (simulated outcome)" : ""}. Click one to see how it's computed.`}
          table={{
            columns: ["Signal", "Weight", "On its own"],
            rows: signals.map((s) => [s.label, s.weight, aucVerdict(s.auc, s.aucCi).label]),
          }}
        >
          <BarList
            labelWidth="12.5rem"
            rows={signals.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.weight,
              to: paths.signal(source, s.key),
              muted: aucVerdict(s.auc, s.aucCi).tone === "none",
              note: aucVerdict(s.auc, s.aucCi).short,
            }))}
          />
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Users size={13} /> Gray: too close to call. This sample can't tell the signal apart from chance, so measure it
            with real outcomes before reweighting.
          </p>
        </ChartFrame>
      </div>

      <ModelDiagnostics className="mt-6" />

      <p className="mt-8 text-center text-xs text-slate-400">
        {index.leads.size.toLocaleString()} cardiologists · data generated {new Date(bundle.source.generatedAt).toLocaleString()}
      </p>
    </>
  );
}
