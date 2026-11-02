import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useRealData } from "../../lib/data";
import { pct } from "../../lib/format";
import { paths } from "../../lib/paths";
import type { RealLead } from "../../types";
import { PageHeader } from "../../components/layout/AppShell";
import { Card, CardHeader, ProvenancePill } from "../../components/ui";
import { Blank, BlankOutputs, filled, fmtValue, linkCls, OfficeShareNote, RealLeadTable, RealMissing, RealSubTag, StatusPill, useRealSubspecialties } from "./shared";

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
        subtitle="Everyone on record: real CMS identities, hospital-based by billing setting (inferred). Signals are filled from real records where they exist, but no one is scored or ranked: no weights have a real basis."
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
        subtitle={`NPI ${l.npi}. ${filled(l)} of the ten signals have a value from real records, each labeled by how directly it measures the signal. No score: no weights have a real basis.`}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="On record" subtitle={`CMS Medicare (${year}) and CMS Doctors & Clinicians (${bundle.source.directorySnapshots.at(-1) ?? "—"})`} />
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
            <Fact label="Medical-school graduation" value={l.gradYear ?? <Blank />} provenance={l.gradYear ? "real" : "none"} />
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
            <Fact
              label="Billing group (closest record of employer)"
              value={
                l.groups.length ? (
                  <ul className="space-y-0.5">
                    {l.groups.map((g) => (
                      <li key={g.pac}>
                        {g.name} <span className="text-xs text-slate-500">· {g.size} cardiologist{g.size === 1 ? "" : "s"} · {g.style}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Blank />
                )
              }
              provenance={l.groups.length ? "real" : "none"}
              note="The group CMS lists this physician as billing through (reassignment). Independent- or hospital-style is inferred from how the group's cardiologists bill."
            />
            <Fact
              label="Affiliated hospitals"
              value={l.hospitals.length ? l.hospitals.map((h) => h.name).join("; ") : <Blank />}
              provenance={l.hospitals.length ? "real" : "none"}
              note="Affiliation usually means privileges, not employment."
            />
          </dl>
        </Card>
        <div className="lg:col-span-2">
          <BlankOutputs compact />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="The ten signals" subtitle="Same definitions as Synthetic, on the same 0–1 scale. Each value shows the real record behind it." />
        <div className="mt-2 overflow-x-auto scroll-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2.5 pl-5 pr-4 font-semibold">Signal</th>
                <th className="py-2.5 pr-4 font-semibold">Value</th>
                <th className="py-2.5 pr-4 font-semibold">Real data</th>
                <th className="py-2.5 pr-5 font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {bundle.signals.map((s) => {
                const v = l.values[s.key];
                return (
                  <tr key={s.key} className="border-b border-slate-100 align-top last:border-0">
                    <td className="whitespace-nowrap py-3 pl-5 pr-4">
                      <Link className={linkCls} to={paths.signal(S, s.key)}>
                        {s.label}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 font-semibold tabular-nums text-ink">{v == null ? <Blank /> : fmtValue(v)}</td>
                    <td className="py-3 pr-4">
                      <StatusPill status={v == null ? "none" : s.status} />
                    </td>
                    <td className="min-w-[18rem] py-3 pr-5 text-slate-600">
                      {v == null ? (s.status === "none" ? s.missing : "No record for this physician in the source.") : l.facts[s.key]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Employer disruption: the evidence"
          subtitle="Events in the last 36 months about this physician's billing group or affiliated hospitals. News events are kept only when Claude's quote appears word for word in the article."
        />
        {l.evidence.length ? (
          <ul className="mt-3 space-y-3 px-5 pb-5">
            {l.evidence.map((e, i) => (
              <li key={i} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{e.entity}</span>
                  <span className="text-slate-500">({e.via})</span>
                  <span className="text-slate-700">
                    · {e.type.replace(/_/g, " ")} · {e.date} ({e.monthsAgo.toFixed(0)} months ago)
                  </span>
                  <span className="ml-auto">
                    <ProvenancePill provenance="real" />
                  </span>
                </div>
                <p className="mt-1.5 text-slate-600">“{e.quote}”</p>
                <p className="mt-1 text-xs text-slate-500">
                  {e.kind === "news" ? (
                    <>
                      {e.publisher}
                      {e.title ? `: ${e.title}` : ""}
                      {e.url && (
                        <>
                          {" · "}
                          <a className="text-teal-700 underline" href={e.url} target="_blank" rel="noreferrer">
                            source article
                          </a>
                        </>
                      )}
                      {e.reports > 1 ? ` · ${e.reports} reports` : ""}
                    </>
                  ) : (
                    "CMS Hospital Change of Ownership record"
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-5 pt-3 text-sm text-slate-500">{l.facts.disruption ??
              (l.groups.length || l.hospitals.length
                ? "The news pipeline hasn't been run for this export, so nothing was searched."
                : "No billing group or hospital on record to search.")}</p>
        )}
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
