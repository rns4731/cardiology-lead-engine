import { Link, useParams } from "react-router-dom";
import { useRealData } from "../../lib/data";
import { paths } from "../../lib/paths";
import { PageHeader } from "../../components/layout/AppShell";
import type { SignalStatus } from "../../types";
import { Card, CardHeader, Empty, ErrorState } from "../../components/ui";
import { ChartFrame } from "../../components/charts/ChartFrame";
import { Histogram } from "../../components/charts/Histogram";
import { BarList } from "../../components/charts/BarList";
import { Blank, BlankOutputs, fmtValue, LEVEL, linkCls, RealMissing, STATUS_LABEL, StatusPill } from "./shared";

const S = "public" as const;

export function RealSignalsPage() {
  const { bundle } = useRealData();
  const filledCount = bundle.signals.filter((s) => s.status !== "none" && s.coverage > 0).length;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Signals" }]}
        kicker="Real data only"
        title="The ten signals"
        subtitle={`The same ten signals as Synthetic, on the same 0–1 scale. ${filledCount} of the ten are filled from real public records. Each is labeled by how directly its record measures the signal; contract window has no public source and stays empty. There are no weights here, so nothing is scored or validated.`}
      />
      <div className="mb-6 flex flex-wrap gap-2 text-xs text-slate-600">
        {(["real", "stand-in", "inferred", "assumption", "none"] as SignalStatus[]).map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5">
            <StatusPill status={st} />
            {
              {
                real: "the record is exactly what the signal asks for",
                "stand-in": "a real record of a closely related thing",
                inferred: "a real record through a stated rule",
                assumption: "a real input through an assumed lookup",
                none: "no real source",
              }[st]
            }
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {bundle.signals.map((s) => (
          <Card key={s.key} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link className={`text-[15px] font-semibold ${linkCls}`} to={paths.signal(S, s.key)}>
                  {s.label}
                </Link>
                <div className="mt-0.5 text-xs text-slate-500">
                  Varies by: {LEVEL[s.level]} · Has a value: {s.status === "none" ? "none" : `${s.coverage} of ${s.total}`}
                  {s.mean != null ? ` · average ${s.mean.toFixed(2)}` : ""} · Weight: <Blank label="No weight: no real basis" />
                </div>
              </div>
              <StatusPill status={s.status} />
            </div>
            <p className="mt-3 text-sm text-slate-600">{s.method ?? s.missing}</p>
            {s.status === "none" && (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Would come from: </span>
                {s.productionSource}
              </p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

export function RealSignalPage() {
  const { key = "" } = useParams();
  const { bundle, signals } = useRealData();
  const s = signals.get(key);
  if (!s) return <RealMissing kind="signal" id={key} back={{ label: "All signals", to: paths.signals(S) }} />;
  const withValue = bundle.leads.filter((l) => l.values[s.key] != null);
  const top = [...withValue].sort((a, b) => b.values[s.key]! - a.values[s.key]! || a.name.localeCompare(b.name)).slice(0, 12);
  const byCity = bundle.metros.filter((m) => m.means[s.key] != null).sort((a, b) => b.means[s.key]! - a.means[s.key]!);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Signals", to: paths.signals(S) }, { label: s.label }]}
        kicker={`Signal · varies by ${LEVEL[s.level].toLowerCase()} · ${STATUS_LABEL[s.status].toLowerCase()}`}
        title={s.label}
        subtitle={s.rationale}
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="In real data" action={<StatusPill status={s.status} />} />
            <div className="space-y-3 px-5 pb-5 pt-3 text-sm text-slate-600">
              <p>
                <span className="font-medium text-ink">{s.status === "none" ? "Why it's empty: " : "How it's computed: "}</span>
                {s.method ?? s.missing}
              </p>
              <p>
                <span className="font-medium text-ink">Has a value: </span>
                {s.status === "none" ? "nobody" : `${s.coverage} of ${s.total} cardiologists`}
                {s.status !== "none" && s.coverage < s.total ? " (the rest have no record in the source, and stay empty)" : ""}.
              </p>
              <p>
                <span className="font-medium text-ink">Weight and predictive check: </span>
                none. No weights have a real basis and there's no real outcome to test against.
              </p>
            </div>
          </Card>
          {s.status !== "none" && withValue.length > 0 && (
            <ChartFrame
              title="Distribution"
              subtitle={`Signal value (0–1) for the ${withValue.length} cardiologists with one`}
              table={{ columns: ["Value", "Cardiologists"], rows: s.hist.map((b) => [`${b.x0.toFixed(1)}–${b.x1.toFixed(1)}`, b.count]) }}
            >
              <Histogram bins={s.hist} xLabel="Signal value" format={(b) => `${b.x0.toFixed(1)}–${b.x1.toFixed(1)}`} />
            </ChartFrame>
          )}
          <Card>
            <CardHeader title="Definition" subtitle="The synthetic formula, applied to the real input" />
            <div className="px-5 pb-5 pt-3">
              <code className="block rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">{s.definition}</code>
              <p className="mt-3 text-sm">
                <Link className={linkCls} to={paths.signal("synthetic", s.key)}>
                  See this signal in Synthetic mode (simulated values)
                </Link>
              </p>
            </div>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          {byCity.length > 0 && (
            <ChartFrame
              title="Average by city"
              subtitle="Among listed cardiologists with a value"
              table={{ columns: ["City", "Average"], rows: byCity.map((m) => [m.metro, m.means[s.key]!.toFixed(2)]) }}
            >
              <BarList
                labelWidth="8.5rem"
                max={1}
                rows={byCity.map((m) => ({
                  key: m.slug,
                  label: m.metro,
                  value: m.means[s.key]!,
                  display: m.means[s.key]!.toFixed(2),
                  to: paths.location(S, m.slug),
                }))}
              />
            </ChartFrame>
          )}
          {top.length > 0 && (
            <Card>
              <CardHeader title="Highest values" subtitle="On this one signal. Not a ranking of who will leave." />
              <ul className="mt-2 divide-y divide-slate-100 px-5 pb-3">
                {top.map((l) => (
                  <li key={l.npi} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link className={linkCls} to={paths.cardiologist(S, l.npi)}>
                        {l.name}
                      </Link>
                      <span className="font-semibold tabular-nums text-ink">{fmtValue(l.values[s.key])}</span>
                    </div>
                    <div className="text-xs text-slate-500">{l.facts[s.key]}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s.status === "none" && <BlankOutputs compact title="What depends on it" />}
        </div>
      </div>
    </>
  );
}

export function RealGroupsPage() {
  const { id } = useParams();
  const { bundle } = useRealData();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Cohorts" }]}
        kicker="Real data only"
        title="Candidate founding cohorts"
        subtitle="Cohorts are formed from cardiologists who qualify on score. Real data has signal values but no score, so there are no candidates yet."
      />
      <Empty title={id ? `No cohort “${id}” in the real data` : "No candidate cohorts in real data"}>
        Most signals now have real values, but no weights have a real basis and there's no real outcome to check them
        against, so no one is scored or qualified, and no cohort can be formed. Nothing is filled in to make one appear. The {bundle.leads.length.toLocaleString()} cardiologists on record are listed
        under <Link className={linkCls} to={paths.cardiologists(S)}>Cardiologists</Link>, and{" "}
        <Link className={linkCls} to={paths.groups("synthetic")}>Synthetic</Link> shows how cohorts work with simulated signals.
      </Empty>
      <div className="mx-auto mt-6 max-w-xl">
        <BlankOutputs compact />
      </div>
    </>
  );
}

export function RealNoSystems() {
  return (
    <ErrorState title="No hospital systems in the real data">
      Employers are unknown: CMS hospital-affiliation data refused this client, and nothing is filled in.{" "}
      <Link className="text-teal-700 underline" to={paths.locations(S)}>
        Browse by city instead
      </Link>
      .
    </ErrorState>
  );
}
