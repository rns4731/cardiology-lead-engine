import { Link, useParams } from "react-router-dom";
import { useRealData } from "../../lib/data";
import { pct } from "../../lib/format";
import { SUBSPECIALTY_COLORS } from "../../lib/palette";
import { paths } from "../../lib/paths";
import { PageHeader } from "../../components/layout/AppShell";
import { Card, StatTile } from "../../components/ui";
import { ChartFrame } from "../../components/charts/ChartFrame";
import { StackedBar } from "../../components/charts/StackedBar";
import { RealCityMap } from "./RealDashboardPage";
import { Blank, linkCls, OfficeShareNote, RealLeadTable, RealMissing, useRealSubspecialties } from "./shared";

const S = "public" as const;

export function RealLocationsPage() {
  const { bundle } = useRealData();
  const subs = useRealSubspecialties();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Locations" }]}
        kicker="Real data only"
        title="Locations"
        subtitle="The eight cities, with real CMS counts. There's no score, so cities aren't ranked by opportunity and no cohorts are formed."
      />
      <ChartFrame
        title="Cardiologists listed by city"
        subtitle="Click a bubble to open the city."
        table={{
          columns: ["City", "Billing Medicare", "Hospital-based (inferred)"],
          rows: bundle.metros.map((m) => [m.metro, m.billing, m.total]),
        }}
      >
        <div className="mx-auto max-w-4xl">
          <RealCityMap />
        </div>
      </ChartFrame>

      <Card className="mt-6 overflow-x-auto scroll-slim">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-semibold">City</th>
              <th className="py-3 pr-4 font-semibold">Billing Medicare ({bundle.universe.year})</th>
              <th className="py-3 pr-4 font-semibold">Hospital-based (inferred)</th>
              <th className="py-3 pr-4 font-semibold">Share</th>
              <th className="py-3 pr-4 font-semibold">Subspecialty mix</th>
              <th className="py-3 pr-4 font-semibold">Qualified</th>
              <th className="py-3 pr-5 font-semibold">Cohorts</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {bundle.metros.map((m) => (
              <tr key={m.slug} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link to={paths.location(S, m.slug)} className="font-semibold text-ink decoration-teal-500/60 underline-offset-2 hover:underline">
                    {m.metro}
                  </Link>
                </td>
                <td className="py-3 pr-4">{m.billing.toLocaleString()}</td>
                <td className="py-3 pr-4">
                  <Link className="hover:underline" to={paths.cardiologists(S, { metro: m.slug })}>
                    {m.total.toLocaleString()}
                  </Link>
                </td>
                <td className="py-3 pr-4">{pct(m.billing ? m.total / m.billing : null)}</td>
                <td className="py-3 pr-4 text-xs text-slate-600">
                  {subs.filter((s) => m.mix[s]).map((s) => `${s} ${m.mix[s]}`).join(" · ") || "—"}
                </td>
                <td className="py-3 pr-4">
                  <Blank label="No score, so nobody qualifies" />
                </td>
                <td className="py-3 pr-5">
                  <Blank label="No cohorts: needs a score" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Billing Medicare = cardiologists (four CMS cardiology provider types) with published {bundle.universe.year} Medicare
        services billed from an address in that city. Hospital-based (inferred) = of those, at most{" "}
        {pct(bundle.universe.threshold)} of services billed in an office setting.
      </p>
    </>
  );
}

export function RealLocationPage() {
  const { slug = "" } = useParams();
  const { metros, leadsByMetro } = useRealData();
  const subs = useRealSubspecialties();
  const m = metros.get(slug);
  if (!m) return <RealMissing kind="location" id={slug} back={{ label: "All locations", to: paths.locations(S) }} />;
  const leads = leadsByMetro.get(slug) ?? [];
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "Locations", to: paths.locations(S) }, { label: m.metro }]}
        kicker="Location · real data only"
        title={m.metro}
        subtitle={`${m.total} of the ${m.billing} cardiologists billing Medicare from ${m.city} in the latest year bill mostly in hospital settings (inferred hospital-based). Nothing here is scored.`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Billing Medicare" value={m.billing.toLocaleString()} sub="real CMS count" />
        <StatTile label="Hospital-based (inferred)" value={m.total.toLocaleString()} sub={pct(m.billing ? m.total / m.billing : null) + " of them"} />
        <StatTile label="Qualified" value={<Blank />} sub="no score to qualify anyone" />
        <StatTile label="Candidate cohorts" value={<Blank />} sub="need a score" />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <ChartFrame
          title="Subspecialty mix"
          subtitle="Medicare provider type"
          table={{ columns: ["Subspecialty", "Cardiologists"], rows: subs.map((s) => [s, m.mix[s] ?? 0]) }}
        >
          {m.total ? (
            <StackedBar
              segments={subs.map((s) => ({
                key: s,
                label: s,
                value: m.mix[s] ?? 0,
                color: SUBSPECIALTY_COLORS[s],
                to: paths.cardiologists(S, { metro: m.slug, sub: s }),
              }))}
            />
          ) : (
            <p className="text-sm text-slate-500">Nobody listed in this city.</p>
          )}
        </ChartFrame>
        <Card className="p-5 text-sm text-slate-600 lg:col-span-2">
          <h3 className="text-[15px] font-semibold text-ink">No cohorts here, by design</h3>
          <p className="mt-1.5">
            A founding cohort needs five or more cardiologists who qualify on score. With no signal backed by real data there's
            no score, so nobody qualifies and no cohort is formed. The list below is everyone on record, not a shortlist.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Employers are unknown (CMS hospital-affiliation data refused this client), so there's no hospital-system breakdown
            either. <Link className={linkCls} to={paths.location("synthetic", m.slug)}>See how {m.city} looks in Synthetic</Link>.
          </p>
        </Card>
      </div>

      <Card className="mt-6 p-3">
        <RealLeadTable leads={leads} showMetro={false} empty="Nobody listed in this city." />
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        <OfficeShareNote />
      </p>
    </>
  );
}
