import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Zap } from "lucide-react";
import { useData, useSubspecialties } from "../lib/data";
import { pct, signed } from "../lib/format";
import { SUBSPECIALTY_COLORS, TIMING_COLORS, TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { MissingEntity } from "../components/layout/SourceLayout";
import { Card, CardHeader, Meter, SectionTitle, StatTile, TextLink } from "../components/ui";
import { MetroLink, SystemLink } from "../components/links";
import { ChartFrame } from "../components/charts/ChartFrame";
import { StackedBar } from "../components/charts/StackedBar";
import { LeadTable } from "../components/LeadTable";
import { GroupCard } from "./GroupsPage";

const COMPONENT_LABEL: Record<string, { label: string; explain: string; fmt: (v: number) => string }> = {
  avg_propensity: { label: "Mean propensity score", explain: "Mean 0–100 score — a rank, not a probability of moving", fmt: (v) => v.toFixed(1) },
  size: { label: "Cohort size", explain: "Members ÷ target size, capped at 1", fmt: (v) => `${Math.round(v * 100)}%` },
  diversity: { label: "Subspecialty diversity", explain: "Normalized Shannon entropy over 5 subspecialties", fmt: (v) => v.toFixed(2) },
  timing: { label: "Timing readiness", explain: "Share of members whose window opens within 9 months", fmt: (v) => `${Math.round(v * 100)}%` },
};

export default function GroupPage() {
  const { id = "" } = useParams();
  const { source, bundle, index } = useData();
  const subs = useSubspecialties();
  const g = index.groups.get(id);
  const members = useMemo(() => (g ? g.members.map((n) => index.leads.get(n)!).filter(Boolean) : []), [g, index]);
  const bench = useMemo(() => {
    if (!g) return [];
    return (index.leadsByMetro.get(g.metroSlug) ?? [])
      .map((l) => ({ l, c: l.candidateGroups.find((c) => c.group === g.id) }))
      .filter((x) => x.c?.status === "eligible")
      .sort((a, b) => b.c!.delta - a.c!.delta || b.l.propensity - a.l.propensity);
  }, [g, index]);

  if (!g) return <MissingEntity kind="cohort" id={id} back={{ label: "See all cohorts", to: paths.groups(source) }} />;

  const w = bundle.meta.viability.weights;
  const siblings = bundle.groups.filter((x) => x.metro === g.metro && x.id !== g.id);
  const fitById = new Map(bench.map((x) => [x.l.npi, x.c!]));
  const qualRate = bundle.sweep.find((r) => r.floor === bundle.meta.operatingFloor)?.precision ?? null;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Dashboard", to: paths.dashboard(source) },
          { label: "Cohorts", to: paths.groups(source) },
          { label: g.name },
        ]}
        kicker={`Cohort #${g.overallRank} overall · #${g.metroRank} in ${g.metro}`}
        title={g.name}
        subtitle={
          <>
            A proposed founding group of {g.members.length} in <MetroLink slug={g.metroSlug} />, anchored at{" "}
            <SystemLink slug={g.anchorSlug} /> ({Math.round(g.anchorShare * 100)}% of members).
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Viability" value={g.viability.toFixed(1)} sub="out of 100" />
        <StatTile label="Members" value={g.members.length} sub={`target ${bundle.meta.viability.minGroup}–${bundle.meta.viability.maxSize}`} />
        <StatTile label="Mean propensity score" value={g.avgPropensity.toFixed(0)} sub="0–100 rank, not a probability" />
        <StatTile
          label="Could strengthen it"
          value={bench.filter((x) => x.c!.delta > 0).length}
          sub="eligible non-members who'd raise viability"
        />
      </div>

      {qualRate != null && (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span className="font-semibold text-ink">A slate, not a group.</span>{" "}
          In simulation{source === "real" ? " (simulated outcome)" : ""}, qualified cardiologists go independent at{" "}
          {pct(qualRate)}, so these{" "}
          {g.members.length} would yield about {(g.members.length * qualRate).toFixed(1)} founders. Landing five usually means
          approaching ~{Math.ceil(5 / qualRate)} qualified candidates — start with who would strengthen it, below.
        </p>
      )}

      {g.sharedTrigger && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Zap size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <span className="font-semibold">Shared trigger:</span>{" "}
            {g.sharedTrigger.members} of {g.members.length} members work at {g.sharedTrigger.employer}, which had a{" "}
            {g.sharedTrigger.event}
            {source === "real" ? " (simulated)" : ""}. Colleagues who leave together are the natural seed of a group.
          </span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Why this viability score" subtitle="Each component × its weight = points. Points sum to the score." />
          <div className="space-y-4 p-5">
            {Object.entries(w).map(([k, weight]) => {
              const raw = g.components[k];
              const norm = k === "avg_propensity" ? raw / 100 : raw;
              const pts = weight * norm * 100;
              const c = COMPONENT_LABEL[k];
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink">{c.label}</span>
                    <span className="tabular-nums text-slate-500">
                      {c.fmt(raw)} × {Math.round(weight * 100)}% = <span className="font-semibold text-ink">{pts.toFixed(1)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={pts} max={weight * 100} color="#0d9488" track="#ccfbf1" />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{c.explain}</div>
                </div>
              );
            })}
          </div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <ChartFrame
            title="Subspecialty mix"
            table={{ columns: ["Subspecialty", "Members"], rows: subs.map((s) => [s, g.mix[s] ?? 0]) }}
          >
            <StackedBar
              segments={subs.map((s) => ({ key: s, label: s, value: g.mix[s] ?? 0, color: SUBSPECIALTY_COLORS[s] }))}
            />
          </ChartFrame>
          <ChartFrame
            title="Readiness of members"
            table={{ columns: ["Window", "Members"], rows: TIMING_ORDER.map((t) => [t, g.timing[t] ?? 0]) }}
          >
            <StackedBar segments={TIMING_ORDER.map((t) => ({ key: t, label: t, value: g.timing[t] ?? 0, color: TIMING_COLORS[t] }))} />
          </ChartFrame>
        </div>
      </div>

      <SectionTitle>Members</SectionTitle>
      <Card className="p-3">
        <LeadTable leads={members} pageSize={10} cols={["rank", "name", "subspecialty", "employer", "propensity", "timing"]} />
      </Card>

      <SectionTitle action={<TextLink to={paths.cardiologists(source, { metro: g.metroSlug, min: bundle.meta.operatingFloor })}>All qualified in {g.metro.split(",")[0]}</TextLink>}>
        Who would strengthen it
      </SectionTitle>
      <Card className="p-3">
        <LeadTable
          leads={bench.map((x) => x.l)}
          initialSort={null}
          pageSize={8}
          cols={["name", "subspecialty", "employer", "propensity", "timing", "group"]}
          extra={{
            header: "Δ viability",
            cell: (l) => {
              const c = fitById.get(l.npi);
              const d = c?.delta ?? 0;
              return (
                <span className={`font-semibold tabular-nums ${d > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                  {signed(d)}
                  {c?.mode === "swap" && <span className="ml-1 text-xs font-normal text-slate-500">swap</span>}
                </span>
              );
            },
          }}
          empty="No other qualified cardiologists in this metro."
        />
        <p className="px-2 pt-2 text-xs text-slate-500">
          Δ viability is the engine's recomputed score if that person joined — or, when the cohort is full, swapped in for the
          member whose replacement helps most. Only unplaced qualified cardiologists are listed; members of other cohorts aren't.
        </p>
      </Card>

      {siblings.length > 0 && (
        <>
          <SectionTitle>Other cohorts in {g.metro}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {siblings.map((s) => (
              <GroupCard key={s.id} g={s} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
