import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useRealData } from "../../lib/data";
import { pct } from "../../lib/format";
import { paths } from "../../lib/paths";
import type { RealLead } from "../../types";
import { PageHeader } from "../../components/layout/AppShell";
import { Card, CardHeader, ProvenancePill } from "../../components/ui";
import { Blank, BlankOutputs, linkCls, OfficeShareNote, RealLeadTable, RealMissing, RealSubTag, useRealSubspecialties } from "./shared";

const S = "public" as const;

function filterReal(leads: RealLead[], p: URLSearchParams): RealLead[] {
  const q = (p.get("q") ?? "").trim().toLowerCase();
  const metro = p.get("metro");
  const sub = p.get("sub");
  return leads.filter(
    (l) =>
      (!q || l.name.toLowerCase().includes(q) || String(l.npi).includes(q)) &&
      (!metro || l.metroSlug === metro) &&
      (!sub || l.subspecialty === sub)
  );
}

// filters that only exist for scored data; links from other modes may carry them
const SCORED_ONLY = ["min", "max", "timing", "group", "system"];

export function RealCardiologistsPage() {
  const { bundle, metros } = useRealData();
  const subs = useRealSubspecialties();
  const [p, setP] = useSearchParams();
  const leads = useMemo(() => filterReal(bundle.leads, p), [bundle.leads, p]);
  const ignored = SCORED_ONLY.filter((k) => p.get(k));
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(p);
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
    setP(next, { replace: true });
  };
  const chips: { k: string; label: string }[] = [];
  if (p.get("metro")) chips.push({ k: "metro", label: metros.get(p.get("metro")!)?.metro ?? p.get("metro")! });
  if (p.get("sub")) chips.push({ k: "sub", label: p.get("sub")! });

  const select = "rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-ink focus:border-teal-500 focus:outline-none";
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Cardiologists" }]}
        kicker="Directory · real data only"
        title="Cardiologists"
        subtitle="Everyone on record: real CMS identities, hospital-based by billing setting (inferred). No one is scored or ranked, because no signal has real data."
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
          <option value="">All cities</option>
          {bundle.metros.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.metro}
            </option>
          ))}
        </select>
        <select aria-label="Subspecialty" className={select} value={p.get("sub") ?? ""} onChange={(e) => set("sub", e.target.value)}>
          <option value="">All subspecialties</option>
          {subs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
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
        {ignored.length > 0 && (
          <span className="text-xs text-amber-700">
            Score, window and cohort filters don't apply: real data has no score.{" "}
            <button
              className="font-medium underline"
              onClick={() => {
                const next = new URLSearchParams(p);
                ignored.forEach((k) => next.delete(k));
                setP(next, { replace: true });
              }}
            >
              Remove
            </button>
          </span>
        )}
      </div>

      <Card className="p-3">
        <RealLeadTable key={p.toString()} leads={leads} empty="No cardiologists match these filters." />
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        <OfficeShareNote />
      </p>
    </>
  );
}

function Fact({ label, value, provenance, note }: { label: string; value: ReactNode; provenance: string; note?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[13rem_1fr_auto] sm:items-start sm:gap-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm text-ink">
        {value}
        {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
      </dd>
      <dd>
        <ProvenancePill provenance={provenance} />
      </dd>
    </div>
  );
}

export function RealCardiologistPage() {
  const { npi = "" } = useParams();
  const { bundle, leads } = useRealData();
  const l = leads.get(Number(npi));
  if (!l) return <RealMissing kind="cardiologist" id={npi} back={{ label: "All cardiologists", to: paths.cardiologists(S) }} />;
  const year = bundle.universe.year;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Cardiologists", to: paths.cardiologists(S) }, { label: l.name }]}
        kicker={`${l.subspecialty} · ${l.metro}`}
        title={l.name}
        subtitle={`NPI ${l.npi}. Real CMS records only: no score, ranking or timing, because none of the ten signals has real data.`}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="On record" subtitle={`CMS Medicare Physician & Other Practitioners (${year})`} />
          <dl className="mt-2 divide-y divide-slate-100 px-5 pb-3">
            <Fact label="NPI" value={l.npi} provenance="real" />
            <Fact label="Name" value={l.name} provenance="real" />
            <Fact label="Medicare provider type" value={l.providerType} provenance="real" />
            <Fact
              label="Subspecialty (shown as)"
              value={<RealSubTag name={l.subspecialty} />}
              provenance="real"
              note={l.providerType === "Cardiology" ? "CMS provider type “Cardiology” is shown as General cardiology." : undefined}
            />
            <Fact label="Billing address" value={l.address} provenance="real" />
            <Fact
              label="City"
              value={
                <Link className={linkCls} to={paths.location(S, l.metroSlug)}>
                  {l.metro}
                </Link>
              }
              provenance="real"
            />
            <Fact
              label={`Office-setting share (${year})`}
              value={pct(l.officeShare)}
              provenance="real"
              note="Share of published Medicare services billed in an office setting."
            />
            <Fact
              label="Hospital-based"
              value="Yes, by billing setting"
              provenance="inferred"
              note={`Inferred: ${pct(l.officeShare)} is at or under the ${pct(bundle.universe.threshold)} rule. Billing setting isn't employment.`}
            />
            <Fact label="Employer" value={<Blank />} provenance="none" note="No real source: CMS hospital-affiliation data refused this client." />
          </dl>
        </Card>
        <div className="lg:col-span-2">
          <BlankOutputs compact />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="The ten signals"
          subtitle="Same signals as Synthetic. Each stays empty until a real source that measures it is connected."
          action={<ProvenancePill provenance="none" />}
        />
        <div className="mt-2 overflow-x-auto scroll-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2.5 pl-5 pr-4 font-semibold">Signal</th>
                <th className="py-2.5 pr-4 font-semibold">Value</th>
                <th className="py-2.5 pr-5 font-semibold">What it needs</th>
              </tr>
            </thead>
            <tbody>
              {bundle.signals.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap py-3 pl-5 pr-4">
                    <Link className={linkCls} to={paths.signal(S, s.key)}>
                      {s.label}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{l.values[s.key] == null ? <Blank /> : l.values[s.key]}</td>
                  <td className="min-w-[18rem] py-3 pr-5 text-slate-600">{s.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Same billing address"
          subtitle="Others on this list who bill from the same address. Sharing an address doesn't mean sharing an employer or a group."
          action={<ProvenancePill provenance="real" />}
        />
        {l.sameAddress.length ? (
          <ul className="mt-3 divide-y divide-slate-100 px-5 pb-3">
            {l.sameAddress.map((n) => {
              const o = leads.get(n)!;
              return (
                <li key={n} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link className={linkCls} to={paths.cardiologist(S, n)}>
                    {o.name}
                  </Link>
                  <RealSubTag name={o.subspecialty} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 pb-5 pt-3 text-sm text-slate-500">Nobody else on this list bills from this address.</p>
        )}
      </Card>
    </>
  );
}
