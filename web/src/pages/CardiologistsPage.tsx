import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useData, useSubspecialties } from "../lib/data";
import { TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import type { Lead } from "../types";
import { PageHeader } from "../components/layout/AppShell";
import { Card } from "../components/ui";
import { LeadTable, type SortKey, type SortState } from "../components/LeadTable";

const SORT_KEYS: SortKey[] = ["propensity", "name", "timing", "rank"];

/** URL ?page= (1-based) -> 0-based index; anything malformed means the first page. */
export function parsePage(v: string | null): number {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
}

/** Pure filter over leads from URL params -- exported for tests. */
export function filterLeads(leads: Lead[], p: URLSearchParams): Lead[] {
  const q = (p.get("q") ?? "").trim().toLowerCase();
  const metro = p.get("metro");
  const system = p.get("system");
  const sub = p.get("sub");
  const timing = p.get("timing")?.split(",").filter(Boolean);
  const min = p.get("min") != null ? Number(p.get("min")) : null;
  const max = p.get("max") != null ? Number(p.get("max")) : null;
  const group = p.get("group");
  return leads.filter(
    (l) =>
      (!q || l.name.toLowerCase().includes(q) || String(l.npi).includes(q)) &&
      (!metro || l.metroSlug === metro) &&
      (!system || l.systemSlug === system) &&
      (!sub || l.subspecialty === sub) &&
      (!timing?.length || timing.includes(l.timingBucket)) &&
      (min == null || l.propensity >= min) &&
      // histogram bins are [x0, x1); the top bin includes 100
      (max == null || l.propensity < max || (max >= 100 && l.propensity <= 100)) &&
      (!group || (group === "in" ? !!l.group : group === "none" ? !l.group : l.group === group))
  );
}

export default function CardiologistsPage() {
  const { source, bundle, index } = useData();
  const subs = useSubspecialties();
  const [p, setP] = useSearchParams();
  const leads = useMemo(() => filterLeads(bundle.leads, p), [bundle.leads, p]);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(p);
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
    next.delete("page");
    setP(next, { replace: true });
  };
  const sortKey = (SORT_KEYS as string[]).includes(p.get("sort") ?? "") ? (p.get("sort") as SortKey) : "propensity";
  const sort: SortState = { key: sortKey, dir: p.get("dir") === "asc" ? "asc" : "desc" };
  const page = parsePage(p.get("page"));

  const chips: { k: string; label: string }[] = [];
  if (p.get("metro")) chips.push({ k: "metro", label: index.metros.get(p.get("metro")!)?.metro ?? p.get("metro")! });
  if (p.get("system")) chips.push({ k: "system", label: index.systems.get(p.get("system")!)?.name ?? p.get("system")! });
  if (p.get("sub")) chips.push({ k: "sub", label: p.get("sub")! });
  if (p.get("timing")) chips.push({ k: "timing", label: `Window: ${p.get("timing")!.replace(",", " or ")}` });
  if (p.get("min")) chips.push({ k: "min", label: `Score ≥ ${p.get("min")}` });
  if (p.get("max")) chips.push({ k: "max", label: `Score < ${p.get("max")}` });
  if (p.get("group"))
    chips.push({
      k: "group",
      label: p.get("group") === "in" ? "In a cohort" : p.get("group") === "none" ? "Not in a cohort" : index.groups.get(p.get("group")!)?.name ?? p.get("group")!,
    });

  const select = "rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-ink focus:border-teal-500 focus:outline-none";
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "Cardiologists" }]}
        kicker="Directory"
        title="Cardiologists"
        subtitle="Every scored hospital-employed cardiologist. Filter, sort, and open anyone to see exactly why they scored as they did."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={p.get("q") ?? ""}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search name or NPI"
            aria-label="Search name or NPI"
            className={`${select} w-full pl-9`}
          />
        </label>
        <select aria-label="Location" className={select} value={p.get("metro") ?? ""} onChange={(e) => set("metro", e.target.value)}>
          <option value="">All locations</option>
          {bundle.metros.map((m) => (
            <option key={m.slug} value={m.slug}>{m.metro}</option>
          ))}
        </select>
        <select aria-label="Subspecialty" className={select} value={p.get("sub") ?? ""} onChange={(e) => set("sub", e.target.value)}>
          <option value="">All subspecialties</option>
          {subs.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select aria-label="Window" className={select} value={p.get("timing") ?? ""} onChange={(e) => set("timing", e.target.value)}>
          <option value="">Any window</option>
          {TIMING_ORDER.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value="Now,Near">Now or Near</option>
        </select>
        <select aria-label="Minimum score" className={select} value={p.get("min") ?? ""} onChange={(e) => set("min", e.target.value)}>
          <option value="">Any score</option>
          {[45, 50, bundle.meta.operatingFloor, 60, 65].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map((v) => (
            <option key={v} value={v}>Score ≥ {v}{v === bundle.meta.operatingFloor ? " (qualified)" : ""}</option>
          ))}
        </select>
        <select aria-label="Cohort" className={select} value={["in", "none"].includes(p.get("group") ?? "") ? p.get("group")! : ""} onChange={(e) => set("group", e.target.value)}>
          <option value="">Any cohort status</option>
          <option value="in">In a cohort</option>
          <option value="none">Not in a cohort</option>
        </select>
      </div>

      <div className="mb-4 flex min-h-7 flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink">{leads.length.toLocaleString()}</span>
        <span className="text-slate-500">of {bundle.leads.length.toLocaleString()} cardiologists</span>
        {chips.map((c) => (
          <button
            key={c.k}
            onClick={() => set(c.k, null)}
            className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
            aria-label={`Remove filter ${c.label}`}
          >
            {c.label} <X size={12} />
          </button>
        ))}
        {chips.length > 1 && (
          <button onClick={() => setP({}, { replace: true })} className="text-xs font-medium text-slate-500 hover:text-ink hover:underline">
            Clear all
          </button>
        )}
      </div>

      <Card className="p-3">
        <LeadTable
          leads={leads}
          pageSize={25}
          sort={sort}
          onSort={(s) => {
            const next = new URLSearchParams(p);
            next.set("sort", s.key);
            next.set("dir", s.dir);
            next.delete("page");
            setP(next, { replace: true });
          }}
          page={page}
          onPage={(n) => {
            const next = new URLSearchParams(p);
            next.set("page", String(n + 1));
            setP(next);
          }}
          empty="No cardiologists match these filters."
        />
      </Card>
    </>
  );
}
