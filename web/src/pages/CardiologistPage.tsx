import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Sparkles, Users, UserPlus, UsersRound } from "lucide-react";
import { useData } from "../lib/data";
import { capitalize, ordinal, scoreInt, signed, usd } from "../lib/format";
import { SEQ, SEQ_TRACK, TIMING_COLORS } from "../lib/palette";
import { paths } from "../lib/paths";
import type { CandidateGroup, Lead, RelatedRef } from "../types";
import { PageHeader } from "../components/layout/AppShell";
import { MissingEntity } from "../components/layout/SourceLayout";
import { Card, CardHeader, Meter, Pill, ProvenancePill, SectionTitle, StatTile } from "../components/ui";
import { LeadLink, MetroLink, SignalLink, SubTag, SystemLink, TimingTag } from "../components/links";

export default function CardiologistPage() {
  const { npi: raw = "" } = useParams();
  const { source, bundle, index } = useData();
  const npi = Number(raw);
  const l = index.leads.get(npi);
  const pos = useMemo(() => bundle.leads.findIndex((x) => x.npi === npi), [bundle.leads, npi]);
  if (!l) return <MissingEntity kind="cardiologist" id={raw} back={{ label: "Search the directory", to: paths.cardiologists(source) }} />;

  const prev = pos > 0 ? bundle.leads[pos - 1] : null;
  const next = pos < bundle.leads.length - 1 ? bundle.leads[pos + 1] : null;
  const metro = index.metros.get(l.metroSlug)!;
  const floor = bundle.meta.operatingFloor;
  const real = source === "real";

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Dashboard", to: paths.dashboard(source) },
          { label: l.metro, to: paths.location(source, l.metroSlug) },
          { label: "Cardiologists", to: paths.cardiologists(source, { metro: l.metroSlug }) },
          { label: l.name },
        ]}
        kicker={`Cardiologist · NPI ${l.npi}`}
        title={l.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SubTag name={l.subspecialty} link />
            <span className="text-slate-300">·</span>
            <SystemLink slug={l.systemSlug} />
            <span className="text-slate-300">·</span>
            <MetroLink slug={l.metroSlug} />
          </span>
        }
        actions={
          <div className="flex items-center gap-1 text-sm">
            {prev && (
              <Link to={paths.cardiologist(source, prev.npi)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-ink" title={prev.name}>
                <ChevronLeft size={15} /> #{prev.rank}
              </Link>
            )}
            {next && (
              <Link to={paths.cardiologist(source, next.npi)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-ink" title={next.name}>
                #{next.rank} <ChevronRight size={15} />
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Propensity score"
          value={scoreInt(l.propensity)}
          sub={`#${l.rank} of ${bundle.leads.length.toLocaleString()} · ${ordinal(Math.round(l.percentile))} percentile`}
          to={paths.cardiologists(source, { min: Math.floor(l.propensity) })}
        />
        <StatTile
          label={`Rank in ${metro.city}`}
          value={`#${l.rankInMetro}`}
          sub={`of ${metro.total} · ${l.propensity >= floor ? "qualified" : `${(floor - l.propensity).toFixed(1)} pts below floor`}`}
          to={paths.cardiologists(source, { metro: l.metroSlug })}
        />
        <StatTile
          label="Window"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: TIMING_COLORS[l.timingBucket] }} />
              {l.timingBucket}
            </span>
          }
          sub={`readiness ${l.timingScore.toFixed(1)}/100 · ${bundle.meta.timing.buckets.find((b) => b.name === l.timingBucket)?.range}`}
          to={paths.cardiologists(source, { timing: l.timingBucket, metro: l.metroSlug })}
        />
        <StatTile
          label="Cohort"
          value={l.group ? `Cohort ${l.group.split("-").pop()!.toUpperCase()}` : "Not placed"}
          sub={l.group ? index.groups.get(l.group)?.name : l.propensity >= floor ? "qualified — on the bench" : "below the floor"}
          to={l.group ? paths.group(source, l.group) : undefined}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Why this score"
            subtitle={`Each signal adds up to its weight. The bars sum to ${l.propensity.toFixed(1)}. Click a signal to see how it's computed.`}
          />
          <div className="space-y-3 p-5">
            {bundle.signals.map((s) => {
              const pts = l.contributions[s.key] ?? 0;
              return (
                <div key={s.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <SignalLink k={s.key} />
                    <span className="tabular-nums text-slate-500">
                      <span className={`font-semibold ${pts > 0 ? "text-ink" : "text-slate-400"}`}>{pts.toFixed(1)}</span> / {s.weight}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Meter value={pts} max={s.weight} color={SEQ} track={SEQ_TRACK} height={7} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Why this window" subtitle={`Readiness ${l.timingScore.toFixed(1)} → ${l.timingBucket}`} />
            <div className="space-y-3 p-5">
              {Object.entries(bundle.meta.timing.weights).map(([k, w]) => (
                <div key={k}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">
                      {bundle.meta.timing.labels[k]}
                      {bundle.meta.timing.sources[k]?.provenance === "simulated" ? (
                        <span className="ml-1.5 text-[11px] text-amber-700">simulated</span>
                      ) : (
                        <span className="ml-1.5 text-[11px] text-emerald-700">real data</span>
                      )}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      <span className="font-semibold text-ink">{(l.timingParts[k] ?? 0).toFixed(1)}</span> / {w}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Meter value={l.timingParts[k] ?? 0} max={w} color={TIMING_COLORS.Near} track="#ffe4e6" height={7} />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-slate-500">
                {bundle.meta.timing.buckets.map((b) => (
                  <span key={b.name}>
                    {b.name} ≥ {b.min}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Top reasons"
              subtitle={real ? "Simulated score drivers only — no facts about this physician are shown" : "Largest contributions first"}
              action={<ProvenancePill provenance="simulated" />}
            />
            <ul className="space-y-2 p-5 pt-3">
              {l.reasons.length ? (
                l.reasons.map((r) => (
                  <li key={r} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <Sparkles size={14} className="mt-0.5 shrink-0 text-teal-600" />
                    {r}
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-500">No signal clears its reporting bar.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>

      <SectionTitle>Cohorts they could join in {metro.city}</SectionTitle>
      <CandidateGroups lead={l} />

      <SectionTitle>Related cardiologists</SectionTitle>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RelatedList
          icon={<UsersRound size={16} className="text-teal-600" />}
          title={`Colleagues at ${l.employer}`}
          subtitle={`Same employer, ranked by score${l.disruptionEvent ? ` — they share its ${l.disruptionEvent}` : ""}`}
          items={l.related.colleagues}
        />
        <RelatedList
          icon={<Users size={16} className="text-teal-600" />}
          title="Similar signal profile"
          subtitle="Closest score breakdowns in this metro"
          items={l.related.similar}
        />
        <RelatedList
          icon={<UserPlus size={16} className="text-teal-600" />}
          title="Would complete a group"
          subtitle="Strongest candidate from each other subspecialty"
          items={l.related.complements}
        />
      </div>

      <SectionTitle>Attributes</SectionTitle>
      <Card className="p-5">
        <dl className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
          {l.attributes ? (
            l.attributes.map((a) => <Attr key={a.label} label={a.label} value={a.value} provenance={a.provenance} />)
          ) : (
          <>
          <Attr label="NPI" value={l.npi} real={real} />
          <Attr label="Name" value={l.name} real={real} />
          <Attr label="Location" value={<MetroLink slug={l.metroSlug} />} real={real} />
          <Attr label="Subspecialty" value={l.subspecialty} real={real} />
          <Attr label="Employer" value={<SystemLink slug={l.systemSlug} />} />
          <Attr label="Employer event" value={l.disruptionEvent ? `${capitalize(l.disruptionEvent)}, ${l.disruptionMonthsAgo} mo ago` : "None"} />
          <Attr label="Age" value={l.age} />
          <Attr label="Years in practice" value={l.yearsInPractice} />
          <Attr label="Tenure with employer" value={`${l.tenureYears} yrs`} />
          <Attr label="Prior independent practice" value={l.priorIndependent ? "Yes" : "No"} />
          <Attr label="Peer recently went independent" value={l.peerLeft ? "Yes" : "No"} />
          <Attr label="Work RVU percentile" value={`p${l.wrvuPercentile}`} />
          <Attr label="Open Payments (industry)" value={usd(l.openPayments)} />
          <Attr label="Contract renewal in" value={`${l.contractMonths} mo`} />
          <Attr label="Non-compete expires in" value={l.noncompeteMonths ? `${l.noncompeteMonths} mo` : "Expired / none"} />
          <Attr label="Independent groups in metro" value={l.independentGroupsMetro} />
          </>
          )}
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          {real
            ? "Only real registry fields are shown for real physicians. Their scores are simulated; invented attributes (payments, events, history) are deliberately not displayed."
            : "Every field in the synthetic dataset is simulated."}
        </p>
      </Card>
    </>
  );
}

function Attr({ label, value, provenance }: { label: string; value: ReactNode; real?: boolean; provenance?: string }) {
  const { source } = useData();
  // every attribute states where it came from; Synthetic-mode fields are all simulated
  const prov = provenance ?? (source === "synthetic" ? "simulated" : undefined);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-medium text-ink">
        {value}
        {prov && <ProvenancePill provenance={prov} />}
      </dd>
    </div>
  );
}

function CandidateGroups({ lead }: { lead: Lead }) {
  const { source, bundle, index } = useData();
  const metro = index.metros.get(lead.metroSlug)!;
  if (!lead.candidateGroups.length)
    return (
      <Card className="p-5 text-sm text-slate-600">
        No cohort has formed in {metro.metro} yet — {metro.gapToViable} more qualified cardiologist
        {metro.gapToViable === 1 ? "" : "s"} needed.{" "}
        <MetroLink slug={metro.slug}>See the location</MetroLink>.
      </Card>
    );
  const home = lead.group ? index.groups.get(lead.group)?.name : undefined;
  const badge = (c: CandidateGroup) =>
    c.status === "member" ? (
      <Pill tone="ink">Member</Pill>
    ) : c.status === "eligible" ? (
      <Pill tone={c.delta > 0 ? "emerald" : "slate"}>
        Eligible · {signed(c.delta)}
        {c.mode === "swap" ? " via swap" : ""}
      </Pill>
    ) : c.status === "member_elsewhere" ? (
      <Pill tone="slate">In {home}</Pill>
    ) : (
      <Pill tone="amber">Needs +{c.gap?.toFixed(1)} pts to qualify</Pill>
    );
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {lead.candidateGroups.map((c) => {
        const g = index.groups.get(c.group)!;
        return (
          <Link
            key={c.group}
            to={paths.group(source, c.group)}
            className={`block rounded-2xl border bg-white p-4 transition hover:shadow-md ${c.status === "member" ? "border-ink ring-1 ring-ink" : "border-slate-200 hover:border-teal-300"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-ink">{g.name}</div>
                <div className="text-xs text-slate-500">
                  {g.members.length} members · viability {g.viability.toFixed(0)}
                </div>
              </div>
              {badge(c)}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {c.status === "member"
                ? "Placed here by the cohort builder."
                : c.status === "member_elsewhere"
                  ? `Already placed in ${home}; moving here would change this cohort's viability by ${signed(c.delta)}.`
                  : c.status === "eligible"
                    ? c.delta > 0
                      ? c.mode === "swap"
                        ? "The cohort is full: swapping them in for the right member would raise its viability."
                        : "Joining would raise this cohort's viability."
                      : "Qualifies, but wouldn't improve this cohort's mix or timing."
                    : `Score ${lead.propensity.toFixed(1)} is under the ${bundle.meta.operatingFloor} floor.`}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

function RelatedList({ icon, title, subtitle, items }: { icon: ReactNode; title: string; subtitle: string; items: RelatedRef[] }) {
  const { index } = useData();
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon}{title}</span>} subtitle={subtitle} />
      <ul className="divide-y divide-slate-100 p-2">
        {items.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">None in this metro.</li>}
        {items.map((r) => {
          const o = index.leads.get(r.npi);
          if (!o) return null;
          return (
            <li key={r.npi} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold tabular-nums text-ink">
                {scoreInt(o.propensity)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  <LeadLink npi={o.npi} />
                </div>
                <div className="truncate text-xs text-slate-500">
                  {o.subspecialty} · {r.why}
                </div>
              </div>
              <TimingTag bucket={o.timingBucket} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
