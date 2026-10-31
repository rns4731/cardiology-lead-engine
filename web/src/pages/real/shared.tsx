// Building blocks for the Real data pages (/public/*). Every value here is a real CMS
// record or explicitly blank: a blank renders as "—" with "No real data" beside it,
// never as 0 and never as an estimate.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRealData } from "../../lib/data";
import { pct } from "../../lib/format";
import { SUBSPECIALTY_COLORS, SUBSPECIALTY_ORDER } from "../../lib/palette";
import { paths } from "../../lib/paths";
import type { RealLead } from "../../types";
import { Card, CardHeader, ErrorState, ProvenancePill } from "../../components/ui";

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
export function BlankOutputs({ title = "Score, timing and cohorts", compact = false }: { title?: string; compact?: boolean }) {
  const { bundle } = useRealData();
  const rows: [string, string][] = [
    ["Propensity score", "Needs weighted signals; none has real data."],
    ["Rank", "Needs a score."],
    ["Readiness window", "Needs trigger, peer and contract dates; none has real data."],
    ["Candidate cohort", "Needs scores to decide who qualifies."],
    ...(compact ? [] : ([["Validation (hit rate, lift)", "Needs a score and a real outcome (who actually left)."]] as [string, string][])),
  ];
  return (
    <Card>
      <CardHeader title={title} subtitle="Blank, not estimated" action={<ProvenancePill provenance="none" />} />
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

/** The ten signals with their real-data status, linking to each signal's page. */
export function SignalCoverage({ limit }: { limit?: number }) {
  const { bundle } = useRealData();
  const rows = limit ? bundle.signals.slice(0, limit) : bundle.signals;
  return (
    <div className="overflow-x-auto scroll-slim">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2.5 pl-5 pr-4 font-semibold">Signal</th>
            <th className="py-2.5 pr-4 font-semibold">Varies by</th>
            <th className="py-2.5 pr-4 font-semibold">Value</th>
            <th className="py-2.5 pr-4 font-semibold">Real data</th>
            <th className="py-2.5 pr-5 font-semibold">Why it's empty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key} className="border-b border-slate-100 align-top last:border-0">
              <td className="whitespace-nowrap py-3 pl-5 pr-4">
                <Link to={paths.signal(S, s.key)} className={linkCls}>
                  {s.label}
                </Link>
              </td>
              <td className="py-3 pr-4 text-slate-600">{LEVEL[s.level]}</td>
              <td className="py-3 pr-4">
                <Blank />
              </td>
              <td className="py-3 pr-4">
                <ProvenancePill provenance="none" />
              </td>
              <td className="min-w-[18rem] py-3 pr-5 text-slate-600">{s.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type RealSortKey = "name" | "metro" | "subspecialty" | "office";

/** Directory table for real records. No score column to sort by -- there is no score. */
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
  const [sort, setSort] = useState<{ key: RealSortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const val = (l: RealLead): string | number =>
      sort.key === "office" ? l.officeShare : sort.key === "metro" ? l.metro : sort.key === "subspecialty" ? l.subspecialty : l.name;
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
            setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
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
              {head("Score")}
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
                <td className="py-2.5 pr-4">
                  <Blank label="No score: no signal has real data" />
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
