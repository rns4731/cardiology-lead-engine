// Building blocks for the Real data pages (/public/*). Every value here comes from a real
// public record and carries its label (real, stand-in, inferred, assumption), or is
// explicitly blank: a blank renders as "—" with "No real data" beside it, never as 0.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRealData } from "../../lib/data";
import { pct } from "../../lib/format";
import { SUBSPECIALTY_COLORS, SUBSPECIALTY_ORDER } from "../../lib/palette";
import { paths } from "../../lib/paths";
import type { RealLead, SignalStatus } from "../../types";
import { Card, CardHeader, ErrorState, Pill, ProvenancePill } from "../../components/ui";

const S = "public" as const;
export const linkCls = "font-medium text-ink decoration-teal-500/60 underline-offset-2 hover:underline";

export const LEVEL: Record<string, string> = { individual: "Individual", employer: "Employer", metro: "Metro" };

/** An unknown value: a dash, never a zero. */
export function Blank({ label = "No real data" }: { label?: string }) {
  return (
    <span className="text-slate-400" title={label} aria-label={label}>
      —
    </span>
  );
}

export function RealSubTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SUBSPECIALTY_COLORS[name] ?? "#94a3b8" }} />
      {name}
    </span>
  );
}

/** Subspecialties in the palette's fixed order, limited to those present. */
export function useRealSubspecialties(): string[] {
  const present = useRealData().bundle.universe.subspecialties;
  return SUBSPECIALTY_ORDER.filter((s) => present.includes(s));
}

export function RealMissing({ kind, id, back }: { kind: string; id: string; back: { label: string; to: string } }) {
  return (
    <ErrorState title={`No ${kind} “${id}” in the real data`}>
      It may belong to another dataset.{" "}
      <Link className="text-teal-700 underline" to={back.to}>
        {back.label}
      </Link>
    </ErrorState>
  );
}

/** The outputs that need a score, all blank, with the one reason they're blank. */
export function BlankOutputs({ title, compact: _compact = false }: { title?: string; compact?: boolean }) {
  const { bundle } = useRealData();
  const scored = bundle.prediction.available;
  const rows: [string, string][] = [
    ...(scored
      ? []
      : ([
          ["Propensity score", "Needs weights that beat chance in the back-test."],
          ["Rank", "Needs a score."],
        ] as [string, string][])),
    ["Readiness window", "Needs contract dates, which aren't public, and weights for the timing parts."],
    ["Candidate cohort", scored ? "Needs a qualifying floor with a real basis; none has been set." : "Needs scores to decide who qualifies."],
  ];
  return (
    <Card>
      <CardHeader
        title={title ?? (bundle.prediction.available ? "Timing and cohorts" : "Score, timing and cohorts")}
        subtitle="Blank, not estimated"
        action={<ProvenancePill provenance="none" />}
      />
      <dl className="mt-3 divide-y divide-slate-100 px-5 pb-2">
        {rows.map(([k, why]) => (
          <div key={k} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-2.5">
            <dt className="text-sm font-medium text-ink">{k}</dt>
            <dd className="row-span-2 self-center text-lg font-semibold">
              <Blank />
            </dd>
            <dd className="text-xs text-slate-500">{why}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{bundle.prediction.why}</p>
    </Card>
  );
}

export const STATUS_LABEL: Record<SignalStatus, string> = {
  real: "Real, exact",
  "stand-in": "Real, stand-in",
  inferred: "Inferred from real data",
  assumption: "Real input, assumed lookup",
  none: "No real data",
};

export function StatusPill({ status }: { status: SignalStatus }) {
  return <ProvenancePill provenance={status} />;
}

export const fmtValue = (v: number | null | undefined) => (v == null ? null : v.toFixed(2));

/** The ten signals with their real-data status, linking to each signal's page. */
export function SignalCoverage() {
  const { bundle } = useRealData();
  return (
    <div className="overflow-x-auto scroll-slim">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2.5 pl-5 pr-4 font-semibold">Signal</th>
            <th className="py-2.5 pr-4 font-semibold">Varies by</th>
            <th className="py-2.5 pr-4 font-semibold">Real data</th>
            <th className="py-2.5 pr-4 font-semibold">Has a value</th>
            <th className="py-2.5 pr-5 font-semibold">How it's computed here</th>
          </tr>
        </thead>
        <tbody>
          {bundle.signals.map((s) => (
            <tr key={s.key} className="border-b border-slate-100 align-top last:border-0">
              <td className="whitespace-nowrap py-3 pl-5 pr-4">
                <Link to={paths.signal(S, s.key)} className={linkCls}>
                  {s.label}
                </Link>
              </td>
              <td className="py-3 pr-4 text-slate-600">{LEVEL[s.level]}</td>
              <td className="py-3 pr-4">
                <StatusPill status={s.status} />
              </td>
              <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-slate-700">
                {s.status === "none" ? <Blank /> : `${s.coverage} of ${s.total}`}
              </td>
              <td className="min-w-[20rem] py-3 pr-5 text-slate-600">{s.method ?? s.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type RealSortKey = "name" | "metro" | "subspecialty" | "office" | "filled" | "score";

export const filled = (l: RealLead) => Object.values(l.values).filter((v) => v != null).length;

/** Directory table for real records; sorted by the back-test score when one exists. */
export function RealLeadTable({
  leads,
  pageSize = 25,
  showMetro = true,
  empty = "No cardiologists match.",
}: {
  leads: RealLead[];
  pageSize?: number;
  showMetro?: boolean;
  empty?: ReactNode;
}) {
  const anyScore = leads.some((l) => l.score != null);
  const [sort, setSort] = useState<{ key: RealSortKey; dir: "asc" | "desc" }>(
    anyScore ? { key: "score", dir: "desc" } : { key: "name", dir: "asc" }
  );
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const val = (l: RealLead): string | number =>
      sort.key === "score"
        ? l.score ?? -1
        : sort.key === "office"
        ? l.officeShare
        : sort.key === "filled"
          ? filled(l)
          : sort.key === "metro"
            ? l.metro
            : sort.key === "subspecialty"
              ? l.subspecialty
              : l.name;
    const out = [...leads].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y));
      return c !== 0 ? c : a.npi - b.npi;
    });
    return sort.dir === "asc" ? out : out.reverse();
  }, [leads, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const rows = sorted.slice(cur * pageSize, (cur + 1) * pageSize);

  const head = (label: string, key?: RealSortKey) => (
    <th className="py-2.5 pr-4 text-left font-semibold uppercase tracking-wide">
      {key ? (
        <button
          className="inline-flex items-center gap-1 uppercase hover:text-ink"
          onClick={() => {
            setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "score" ? "desc" : "asc" }));
            setPage(0);
          }}
          aria-label={`Sort by ${label}`}
        >
          {label}
          {sort.key === key && <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        label
      )}
    </th>
  );

  if (leads.length === 0) return <div className="px-5 py-10 text-center text-sm text-slate-500">{empty}</div>;
  return (
    <div>
      <div className="overflow-x-auto scroll-slim">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              {head("Cardiologist", "name")}
              {showMetro && head("City", "metro")}
              {head("Subspecialty", "subspecialty")}
              {head("Office-setting share", "office")}
              {head("Signals with a value", "filled")}
              {anyScore ? head("Score (back-test fit)", "score") : head("Score")}
              {head("Window")}
              {head("Cohort")}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.npi} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/70">
                <td className="py-2.5 pr-4">
                  <Link to={paths.cardiologist(S, l.npi)} className={linkCls}>
                    {l.name}
                  </Link>
                </td>
                {showMetro && (
                  <td className="whitespace-nowrap py-2.5 pr-4">
                    <Link to={paths.location(S, l.metroSlug)} className={linkCls}>
                      {l.metro}
                    </Link>
                  </td>
                )}
                <td className="py-2.5 pr-4">
                  <RealSubTag name={l.subspecialty} />
                </td>
                <td className="py-2.5 pr-4 tabular-nums text-slate-700">{pct(l.officeShare)}</td>
                <td className="py-2.5 pr-4 tabular-nums text-slate-700">{filled(l)} of 10</td>
                <td className="py-2.5 pr-4 tabular-nums">
                  {l.score != null ? (
                    <span className="font-semibold text-ink">
                      {Math.floor(l.score)} <span className="text-xs font-normal text-slate-400">#{l.scoreRank}</span>
                    </span>
                  ) : (
                    <Blank label={anyScore ? "No score: a signal is missing (nothing is filled in)" : "No score: the back-test didn't support one"} />
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  <Blank label="No timing: no real data" />
                </td>
                <td className="py-2.5 pr-4">
                  <Blank label="No cohorts: needs a score" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-1 pt-3 text-xs text-slate-500">
          <span>
            {cur * pageSize + 1}–{Math.min((cur + 1) * pageSize, sorted.length)} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={cur === 0}
              onClick={() => setPage(cur - 1)}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="tabular-nums">
              {cur + 1} / {pages}
            </span>
            <button
              disabled={cur >= pages - 1}
              onClick={() => setPage(cur + 1)}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function OfficeShareNote() {
  const { bundle } = useRealData();
  return (
    <>
      Office-setting share = share of the physician's published {bundle.universe.year} Medicare services billed in an office
      setting (CMS). Everyone listed is at or under {pct(bundle.universe.threshold)}, the rule behind the inferred
      "hospital-based" label.
    </>
  );
}

/** The back-test behind the real-data score: what was tested, the verdict, and its warnings.
 *  Plain-language hit rates up front; AUC only inside the collapsed diagnostics. */
export function BacktestCard() {
  const { bundle, signals } = useRealData();
  const m = bundle.model;
  if (!m) return null;
  const top = m.metrics.topK["50"] ?? Object.values(m.metrics.topK)[0];
  const k = m.metrics.topK["50"] ? 50 : Number(Object.keys(m.metrics.topK)[0]);
  const cc = m.crossCheck;
  const ccPass = cc.aucCi != null && cc.aucCi[0] > 0.5;
  const sorted = [...m.signals].sort((a, b) => b.weight - a.weight);
  return (
    <Card>
      <CardHeader
        title="Back-test and fit"
        subtitle={`Signals as they stood on ${m.t0}, checked against who moved by ${m.t1}`}
        action={<Pill tone={m.verdict.passed ? "emerald" : "rose"}>{m.verdict.passed ? "Beat chance" : "Failed"}</Pill>}
      />
      <div className="grid gap-5 px-5 pb-5 pt-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <span className="font-medium text-ink">Tested on: </span>
            {m.population.used.toLocaleString()} hospital-based cardiologists in seven states; {m.population.positives} (
            {pct(m.population.baseRate, 1)}) moved. Outcome: {m.outcome.charAt(0).toLowerCase() + m.outcome.slice(1)}.
          </p>
          {top && (
            <p>
              <span className="font-medium text-ink">Result on held-out doctors: </span>
              of the top {k}, {top.hits} moved ({pct(top.precision)}) vs {pct(m.population.baseRate, 1)} overall: about{" "}
              {top.lift.toFixed(1)}× better than random (likely {top.liftCi[0].toFixed(1)}–{top.liftCi[1].toFixed(1)}×).
            </p>
          )}
          <p className={ccPass ? "" : "text-rose-800"}>
            <span className="font-medium">Cross-check: </span>
            on the other outcome ({cc.outcome.charAt(0).toLowerCase() + cc.outcome.slice(1)}, {cc.positives} doctors) the same score{" "}
            {ccPass ? "also beat chance." : "was no better than chance."}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {m.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">Diagnostics</summary>
            <p className="mt-1">
              Out-of-fold AUC {m.metrics.auc.toFixed(2)} (95% CI {m.metrics.aucCi[0].toFixed(2)}–{m.metrics.aucCi[1].toFixed(2)};
              20 reshuffles {m.metrics.aucRepeats[0].toFixed(2)}–{m.metrics.aucRepeats[1].toFixed(2)}). AUC is the chance a
              random mover is ranked above a random non-mover: 0.5 is a coin flip, 1.0 is perfect. {m.verdict.rule}{" "}
              Cross-check AUC {cc.auc?.toFixed(2) ?? "—"}
              {cc.aucCi ? ` (95% CI ${cc.aucCi[0].toFixed(2)}–${cc.aucCi[1].toFixed(2)})` : ""}. {m.model}.
            </p>
          </details>
        </div>
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-semibold">Signal</th>
                <th className="py-2 pr-3 font-semibold">Fitted weight</th>
                <th className="py-2 pr-3 font-semibold">Direction</th>
                <th className="py-2 font-semibold">Direction holds in</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3">
                    <Link className={linkCls} to={paths.signal(S, s.key)}>
                      {signals.get(s.key)?.label ?? s.key}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums text-ink">{s.weight}</td>
                  <td className="py-2 pr-3 text-slate-600">{s.direction}</td>
                  <td className="py-2 tabular-nums text-slate-600">{Math.round(s.sameSignShare * 100)}% of resamples</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Weights sum to 100. "Lower → more likely" means the fit found the opposite of the original hypothesis for that
            signal. Below ~95%, the direction itself is uncertain. Contract window has no data and isn't in the score.
          </p>
        </div>
      </div>
    </Card>
  );
}
