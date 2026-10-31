import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useData } from "../lib/data";
import type { Lead } from "../types";
import { GroupLink, LeadLink, MetroLink, ScoreCell, SubTag, SystemLink, TimingTag } from "./links";

export type Col = "rank" | "name" | "metro" | "subspecialty" | "employer" | "propensity" | "timing" | "group" | "extra";
export type SortKey = "propensity" | "name" | "timing" | "rank";
export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const TIMING_RANK = { Now: 0, Near: 1, Later: 2, Watch: 3 } as const;
// the direction a first click should use: best/first item on top
const NATURAL: Record<SortKey, "asc" | "desc"> = { propensity: "desc", rank: "asc", name: "asc", timing: "asc" };

/** Header-click cycle: natural direction -> reversed -> back to the caller's order
 *  (null) when the table started unsorted, else back to natural. */
export function nextSort(cur: SortState | null, key: SortKey, initial: SortState | null): SortState | null {
  const nat = NATURAL[key];
  if (!cur || cur.key !== key) return { key, dir: nat };
  if (cur.dir === nat) return { key, dir: nat === "asc" ? "desc" : "asc" };
  return initial === null ? null : { key, dir: nat };
}

export function sortLeads(leads: Lead[], s: SortState): Lead[] {
  const m = s.dir === "asc" ? 1 : -1;
  const by: Record<SortKey, (a: Lead, b: Lead) => number> = {
    propensity: (a, b) => (a.propensity - b.propensity) * m || a.npi - b.npi,
    rank: (a, b) => (a.rank - b.rank) * m || a.npi - b.npi,
    name: (a, b) => a.name.localeCompare(b.name) * m,
    timing: (a, b) =>
      (TIMING_RANK[a.timingBucket] - TIMING_RANK[b.timingBucket]) * m || b.timingScore - a.timingScore,
  };
  return [...leads].sort(by[s.key]);
}

export function LeadTable({
  leads,
  cols = ["rank", "name", "metro", "subspecialty", "employer", "propensity", "timing", "group"],
  pageSize = 15,
  sort,
  onSort,
  page,
  onPage,
  extra,
  initialSort = { key: "propensity", dir: "desc" },
  empty = "No cardiologists match.",
}: {
  leads: Lead[];
  cols?: Col[];
  pageSize?: number;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  page?: number;
  onPage?: (p: number) => void;
  extra?: { header: string; cell: (l: Lead) => ReactNode };
  /** null keeps the caller's order until the viewer clicks a column */
  initialSort?: SortState | null;
  empty?: string;
}) {
  const { bundle } = useData();
  const floor = bundle.meta.operatingFloor;
  const [localSort, setLocalSort] = useState<SortState | null>(initialSort);
  const [localPage, setLocalPage] = useState(0);
  const s = sort ?? localSort;
  const setSort = (n: SortState | null) => (onSort ? n && onSort(n) : setLocalSort(n));
  const p = page ?? localPage;
  const setPage = onPage ?? setLocalPage;

  // reset to the first page when the *contents* change (not on every new array
  // identity -- parents often re-filter on render)
  const signature = `${leads.length}:${leads[0]?.npi}:${leads[leads.length - 1]?.npi}`;
  useEffect(() => {
    if (page === undefined) setLocalPage(0);
  }, [signature, page]);

  const sorted = useMemo(() => (s ? sortLeads(leads, s) : leads), [leads, s]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(p, pages - 1);
  const rows = sorted.slice(cur * pageSize, cur * pageSize + pageSize);

  const head = (label: string, key?: SortKey) => {
    const active = key && s?.key === key;
    return (
      <th className="whitespace-nowrap py-2.5 pr-4 text-left font-semibold" aria-sort={active ? (s?.dir === "asc" ? "ascending" : "descending") : undefined}>
        {key ? (
          <button
            onClick={() => setSort(nextSort(s, key, initialSort))}
            className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? "text-ink" : ""}`}
          >
            {label}
            {active && (s?.dir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </button>
        ) : (
          <span className="uppercase tracking-wide">{label}</span>
        )}
      </th>
    );
  };

  if (leads.length === 0) return <div className="px-5 py-10 text-center text-sm text-slate-500">{empty}</div>;

  return (
    <div>
      <div className="overflow-x-auto scroll-slim">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              {cols.includes("rank") && head("#", "rank")}
              {cols.includes("name") && head("Cardiologist", "name")}
              {cols.includes("metro") && head("Location")}
              {cols.includes("subspecialty") && head("Subspecialty")}
              {cols.includes("employer") && head("Employer")}
              {cols.includes("propensity") && head("Propensity", "propensity")}
              {cols.includes("timing") && head("Window", "timing")}
              {cols.includes("group") && head("Cohort")}
              {extra && head(extra.header)}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.npi} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/70">
                {cols.includes("rank") && <td className="py-2.5 pr-4 tabular-nums text-slate-600">{l.rank}</td>}
                {cols.includes("name") && (
                  <td className="py-2.5 pr-4">
                    <LeadLink npi={l.npi} />
                  </td>
                )}
                {cols.includes("metro") && (
                  <td className="whitespace-nowrap py-2.5 pr-4">
                    <MetroLink slug={l.metroSlug} />
                  </td>
                )}
                {cols.includes("subspecialty") && (
                  <td className="py-2.5 pr-4">
                    <SubTag name={l.subspecialty} />
                  </td>
                )}
                {cols.includes("employer") && (
                  <td className="whitespace-nowrap py-2.5 pr-4">
                    <SystemLink slug={l.systemSlug} />
                  </td>
                )}
                {cols.includes("propensity") && (
                  <td className="py-2.5 pr-4">
                    <ScoreCell value={l.propensity} floor={floor} />
                  </td>
                )}
                {cols.includes("timing") && (
                  <td className="py-2.5 pr-4">
                    <TimingTag bucket={l.timingBucket} />
                  </td>
                )}
                {cols.includes("group") && (
                  <td className="whitespace-nowrap py-2.5 pr-4">
                    {l.group ? <GroupLink id={l.group} /> : <span className="text-slate-300">—</span>}
                  </td>
                )}
                {extra && <td className="whitespace-nowrap py-2.5 pr-4">{extra.cell(l)}</td>}
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
