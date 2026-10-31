import { Link, useSearchParams } from "react-router-dom";
import { Zap } from "lucide-react";
import { useData } from "../lib/data";
import { SUBSPECIALTY_COLORS, SUBSPECIALTY_ORDER, TIMING_COLORS, TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import type { Group } from "../types";
import { PageHeader } from "../components/layout/AppShell";
import { Card, Empty, Meter, Pill } from "../components/ui";

const ABBR: Record<string, string> = {
  Interventional: "Int",
  Electrophysiology: "EP",
  "General cardiology": "Gen",
  Imaging: "Img",
  "Advanced Heart Failure": "AHF",
};

/** Compact cohort summary used on the dashboard, location and group index pages. */
export function GroupCard({ g }: { g: Group }) {
  const { source } = useData();
  // bar + a value legend, so identity never rests on color alone
  const tile = (counts: Record<string, number>, order: readonly string[], colors: Record<string, string>) => {
    const present = order.filter((k) => (counts[k] ?? 0) > 0);
    return (
      <div>
        <div className="flex h-2 w-full gap-[2px]">
          {present.map((k) => (
            <span key={k} className="h-full first:rounded-l-[3px] last:rounded-r-[3px]" style={{ flexGrow: counts[k], background: colors[k] }} />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
          {present.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors[k] }} />
              {ABBR[k] ?? k} {counts[k]}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Link
      to={paths.group(source, g.id)}
      className="group block rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(8,16,32,0.04)] transition hover:border-teal-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">#{g.overallRank} overall · {g.metro}</div>
          <div className="mt-0.5 font-display text-lg text-ink group-hover:underline decoration-teal-500/60 underline-offset-2">{g.name}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold leading-none text-ink">{g.viability.toFixed(0)}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">viability</div>
        </div>
      </div>
      <div className="mt-3">
        <Meter value={g.viability} max={100} color="#0d9488" track="#ccfbf1" height={6} />
      </div>
      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500">{g.members.length} members · avg score</dt>
          <dd className="font-semibold text-ink">{g.avgPropensity.toFixed(0)}</dd>
        </div>
        <div>
          <dt className="mb-1 text-slate-500">Subspecialty mix</dt>
          <dd>{tile(g.mix, SUBSPECIALTY_ORDER, SUBSPECIALTY_COLORS)}</dd>
        </div>
        <div>
          <dt className="mb-1 text-slate-500">Readiness</dt>
          <dd>{tile(g.timing, TIMING_ORDER, TIMING_COLORS)}</dd>
        </div>
      </dl>
      {g.sharedTrigger && (
        <div className="mt-4 flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
          <Zap size={13} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            {`${g.sharedTrigger.members} of ${g.members.length} share a trigger: ${g.sharedTrigger.event} at ${g.sharedTrigger.employer}`}
          </span>
        </div>
      )}
    </Link>
  );
}

export default function GroupsPage() {
  const { source, bundle } = useData();
  const [params, setParams] = useSearchParams();
  const metro = params.get("metro");
  const list = metro ? bundle.groups.filter((g) => g.metroSlug === metro) : bundle.groups;
  const metrosWithGroups = bundle.metros.filter((m) => m.groups.length);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "Cohorts" }]}
        kicker="Group assembly"
        title="Candidate founding cohorts"
        subtitle={
          <>
            Each metro's qualified pool (score ≥ {bundle.meta.operatingFloor}) is partitioned into
            disjoint cohorts of {bundle.meta.viability.minGroup}–{bundle.meta.viability.maxSize}. The
            strongest cohort is built first by repeatedly adding whoever raises its viability most; then
            the next is built from who remains. They're outreach slates: in simulation only part of each would actually move.
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        <button
          onClick={() => setParams({})}
          className={`rounded-full px-3 py-1 text-sm font-medium ${!metro ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
        >
          All metros
        </button>
        {metrosWithGroups.map((m) => (
          <button
            key={m.slug}
            onClick={() => setParams({ metro: m.slug })}
            className={`rounded-full px-3 py-1 text-sm font-medium ${metro === m.slug ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {m.city} <span className="opacity-60">{m.groups.length}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </div>
      ) : (
        <Empty title="No cohorts here">
          {metro ? "This metro doesn't have five qualified cardiologists yet." : "No metro has five qualified cardiologists yet."}
        </Empty>
      )}
      {!metro && (
        <Card className="mt-8 p-5 text-sm text-slate-600">
          <span className="font-semibold text-ink">Emerging metros</span> (no cohort yet):{" "}
          {bundle.metros
            .filter((m) => !m.groups.length)
            .map((m, i, a) => (
              <span key={m.slug}>
                <Link className="text-teal-700 hover:underline" to={paths.location(source, m.slug)}>
                  {m.metro}
                </Link>{" "}
                <Pill>needs {m.gapToViable} more</Pill>
                {i < a.length - 1 ? " · " : ""}
              </span>
            ))}
          {bundle.metros.every((m) => m.groups.length) && "none — every metro can seed a cohort."}
        </Card>
      )}
    </>
  );
}
