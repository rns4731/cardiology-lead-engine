import { Link, useParams } from "react-router-dom";
import { useRealData } from "../../lib/data";
import { paths } from "../../lib/paths";
import { PageHeader } from "../../components/layout/AppShell";
import { Card, CardHeader, Empty, ErrorState, ProvenancePill } from "../../components/ui";
import { Blank, BlankOutputs, LEVEL, linkCls, RealMissing } from "./shared";

const S = "public" as const;

export function RealSignalsPage() {
  const { bundle } = useRealData();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Signals" }]}
        kicker="Real data only"
        title="The ten signals"
        subtitle="The same ten signals as Synthetic. In real data, a signal is filled only from a real source that measures that exact thing. None is connected yet, so all ten are empty, there are no weights, and nothing is scored or validated."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {bundle.signals.map((s) => (
          <Card key={s.key} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link className={`text-[15px] font-semibold ${linkCls}`} to={paths.signal(S, s.key)}>
                  {s.label}
                </Link>
                <div className="mt-0.5 text-xs text-slate-500">Varies by: {LEVEL[s.level]} · Weight: <Blank label="No weight: no real data" /></div>
              </div>
              <ProvenancePill provenance="none" />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium text-ink">Why it's empty: </span>
              {s.missing}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-medium text-slate-600">Would come from: </span>
              {s.productionSource}
            </p>
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
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Signals", to: paths.signals(S) }, { label: s.label }]}
        kicker={`Signal · varies by ${LEVEL[s.level].toLowerCase()} · no real data`}
        title={s.label}
        subtitle={s.rationale}
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="In real data" action={<ProvenancePill provenance="none" />} />
            <div className="space-y-3 px-5 pb-5 pt-3 text-sm text-slate-600">
              <p>
                <span className="font-medium text-ink">Why it's empty: </span>
                {s.missing}
              </p>
              <p>
                <span className="font-medium text-ink">Would come from: </span>
                {s.productionSource}
              </p>
              <p>
                <span className="font-medium text-ink">Values: </span>
                empty for all {bundle.leads.length.toLocaleString()} cardiologists. No weight, no distribution, and no test of
                whether it predicts: there's nothing real to measure yet.
              </p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Definition" subtitle="How it's computed once real data exists (Synthetic mode simulates it this way)" />
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
        <div className="lg:col-span-2">
          <BlankOutputs compact title="What depends on it" />
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
        subtitle="Cohorts are formed from cardiologists who qualify on score. Real data has no score, so there are no candidates yet."
      />
      <Empty title={id ? `No cohort “${id}” in the real data` : "No candidate cohorts in real data"}>
        None of the ten signals has a real source connected, so no one can be scored or qualified, and no cohort can be formed.
        Nothing is filled in to make one appear. The {bundle.leads.length.toLocaleString()} cardiologists on record are listed
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
