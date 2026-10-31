import { Link, useParams } from "react-router-dom";
import { Building2, Sprout } from "lucide-react";
import { useData, useSubspecialties } from "../lib/data";
import { pct } from "../lib/format";
import { SUBSPECIALTY_COLORS, TIMING_COLORS, TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { MissingEntity } from "../components/layout/SourceLayout";
import { Card, CardHeader, Pill, SectionTitle, StatTile, TextLink } from "../components/ui";
import { ChartFrame } from "../components/charts/ChartFrame";
import { StackedBar } from "../components/charts/StackedBar";
import { BarList } from "../components/charts/BarList";
import { Histogram, trimBins } from "../components/charts/Histogram";
import { USMap } from "../components/charts/USMap";
import { LeadTable } from "../components/LeadTable";
import { GroupCard } from "./GroupsPage";

export default function LocationPage() {
  const { slug = "" } = useParams();
  const { source, bundle, index } = useData();
  const subs = useSubspecialties();
  const m = index.metros.get(slug);
  if (!m) return <MissingEntity kind="location" id={slug} back={{ label: "See all locations", to: paths.locations(source) }} />;

  const floor = bundle.meta.operatingFloor;
  const leads = index.leadsByMetro.get(slug) ?? [];
  const groups = m.groups.map((g) => index.groups.get(g)!).filter(Boolean);
  const systems = m.systems.map((s) => index.systems.get(s)!).filter(Boolean).sort((a, b) => b.qualified - a.qualified);
  const q = (extra: Record<string, string | number>) => paths.cardiologists(source, { metro: slug, ...extra });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Dashboard", to: paths.dashboard(source) },
          { label: "Locations", to: paths.locations(source) },
          { label: m.metro },
        ]}
        kicker="Location"
        title={m.metro}
        subtitle={
          <>
            {m.total.toLocaleString()} hospital-employed cardiologists, {m.qualified} qualify (score ≥ {floor}),{" "}
            {groups.length ? `forming ${groups.length} cohort${groups.length > 1 ? "s" : ""}` : "not yet enough for a cohort"}.{" "}
            {m.independentGroups} independent cardiology groups already operate here.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Cardiologists" value={m.total.toLocaleString()} to={q({})} />
        <StatTile label="Qualified" value={m.qualified} sub={pct(m.qualified / m.total)} to={q({ min: floor })} />
        <StatTile label="Cohorts" value={groups.length} to={paths.groups(source, { metro: slug })} />
        <StatTile label="In a cohort" value={m.grouped} to={q({ group: "in" })} />
        <StatTile label="Bench" value={m.bench} sub="qualified, not yet placed" to={q({ min: floor, group: "none" })} />
        <StatTile label="Best viability" value={m.bestViability?.toFixed(0) ?? "—"} sub={`top score ${m.topScore.toFixed(0)}`} />
      </div>

      {!groups.length && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <Sprout size={16} className="mt-0.5 shrink-0 text-teal-600" />
          <span>
            <span className="font-semibold">Emerging market.</span> {m.gapToViable} more qualified cardiologist
            {m.gapToViable === 1 ? "" : "s"} needed before a cohort of {bundle.meta.viability.minGroup} can form. Watch the{" "}
            <Link className="text-teal-700 underline" to={q({ timing: "Now,Near" })}>
              open-window list
            </Link>{" "}
            for movers.
          </span>
        </div>
      )}

      {groups.length > 0 && (
        <>
          <SectionTitle>Cohorts in {m.city}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
          </div>
        </>
      )}

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Hospital systems"
            subtitle="Employer events are simulated; system names are fictional."
          />
          <div className="overflow-x-auto scroll-slim p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-4 font-semibold">System</th>
                  <th className="py-2.5 pr-4 font-semibold">Cardiologists</th>
                  <th className="py-2.5 pr-4 font-semibold">Qualified</th>
                  <th className="py-2.5 pr-4 font-semibold">Employer event</th>
                  <th className="py-2.5 pr-4 font-semibold">Anchors</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {systems.map((s) => (
                  <tr key={s.slug} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-4">
                      <Link to={paths.system(source, s.slug)} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                        <Building2 size={14} className="text-slate-400" />
                        {s.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">{s.total}</td>
                    <td className="py-2.5 pr-4">{s.qualified}</td>
                    <td className="py-2.5 pr-4">
                      {s.event !== "none" ? (
                        <Pill tone="amber">
                          {s.event} · {s.eventMonthsAgo} mo ago
                        </Pill>
                      ) : (
                        <span className="text-slate-400">none</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{s.anchors.length || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <ChartFrame
          title="All locations"
          subtitle="This one is outlined. Click another to switch."
          table={{
            columns: ["Location", "Qualified", "Cohorts"],
            rows: bundle.metros.map((x) => [x.metro, x.qualified, x.groups.length]),
          }}
        >
          <USMap metros={bundle.metros} selected={slug} hrefFor={(x) => paths.location(source, x.slug)} />
        </ChartFrame>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartFrame
          title="When windows open"
          subtitle="Click a segment to list them."
          table={{ columns: ["Window", "All", "Qualified"], rows: TIMING_ORDER.map((t) => [t, m.timing[t], m.timingQualified[t]]) }}
        >
          <StackedBar
            segments={TIMING_ORDER.map((t) => ({ key: t, label: t, value: m.timing[t] ?? 0, color: TIMING_COLORS[t], to: q({ timing: t }) }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Subspecialties"
          subtitle="Qualified cardiologists. Click to list."
          table={{ columns: ["Subspecialty", "All", "Qualified"], rows: subs.map((s) => [s, m.mix[s] ?? 0, m.mixQualified[s] ?? 0]) }}
        >
          <BarList
            labelWidth="9.5rem"
            rows={subs.filter((s) => (m.mix[s] ?? 0) > 0).map((s) => ({
              key: s,
              label: s,
              value: m.mixQualified[s] ?? 0,
              color: SUBSPECIALTY_COLORS[s],
              to: q({ sub: s, min: floor }),
              note: `${m.mix[s]} total`,
            }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Propensity distribution"
          subtitle="Teal bins clear the operating floor. Click a bin to list."
          table={{ columns: ["Score", "Cardiologists"], rows: m.hist.filter((b) => b.count).map((b) => [`${b.x0}–${b.x1}`, b.count]) }}
        >
          <Histogram bins={trimBins(m.hist, floor)} floor={floor} xLabel="Propensity score" binTo={(b) => q({ min: b.x0, max: b.x1 })} />
        </ChartFrame>
      </div>

      <SectionTitle action={<TextLink to={q({})}>Open in directory</TextLink>}>Cardiologists in {m.city}</SectionTitle>
      <Card className="p-3">
        <LeadTable leads={leads} pageSize={12} cols={["rank", "name", "subspecialty", "employer", "propensity", "timing", "group"]} />
      </Card>
    </>
  );
}
