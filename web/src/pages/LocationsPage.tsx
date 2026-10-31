import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { pct } from "../lib/format";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { Card, Meter, Pill } from "../components/ui";
import { ChartFrame } from "../components/charts/ChartFrame";
import { USMap } from "../components/charts/USMap";
import { GroupLink } from "../components/links";

export default function LocationsPage() {
  const { source, bundle } = useData();
  const { metros } = bundle;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "Locations" }]}
        kicker="Geography is a hard constraint"
        title="Locations"
        subtitle="A new group is physical and local, so cohorts form within a metro. Locations are ranked by the viability of their strongest cohort."
      />
      <ChartFrame
        title="Qualified cardiologists by location"
        subtitle="Click a bubble to open the location."
        table={{
          columns: ["Location", "Physicians", "Qualified", "Cohorts", "Best viability"],
          rows: metros.map((m) => [m.metro, m.total, m.qualified, m.groups.length, m.bestViability?.toFixed(0) ?? "—"]),
        }}
      >
        <div className="mx-auto max-w-4xl">
          <USMap metros={metros} hrefFor={(m) => paths.location(source, m.slug)} />
        </div>
      </ChartFrame>

      <Card className="mt-6 overflow-x-auto scroll-slim">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-semibold">Location</th>
              <th className="py-3 pr-4 font-semibold">Physicians</th>
              <th className="py-3 pr-4 font-semibold">Qualified</th>
              <th className="py-3 pr-4 font-semibold">Ready now/near</th>
              <th className="py-3 pr-4 font-semibold">Best cohort viability</th>
              <th className="py-3 pr-4 font-semibold">Cohorts</th>
              <th className="py-3 pr-5 font-semibold">Indep. groups</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {metros.map((m) => (
              <tr key={m.slug} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <Link to={paths.location(source, m.slug)} className="font-semibold text-ink hover:underline decoration-teal-500/60 underline-offset-2">
                    {m.metro}
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <Link className="hover:underline" to={paths.cardiologists(source, { metro: m.slug })}>{m.total.toLocaleString()}</Link>
                </td>
                <td className="py-3 pr-4">
                  <Link className="hover:underline" to={paths.cardiologists(source, { metro: m.slug, min: bundle.meta.operatingFloor })}>
                    {m.qualified}
                  </Link>
                </td>
                <td className="py-3 pr-4">{pct(m.readyShare)}</td>
                <td className="py-3 pr-4">
                  <div className="flex w-40 items-center gap-2">
                    <Meter value={m.bestViability ?? 0} max={100} color="#0d9488" track="#ccfbf1" height={6} />
                    <span className="w-6 text-right font-semibold text-ink">{m.bestViability?.toFixed(0) ?? "—"}</span>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  {m.groups.length ? (
                    <span className="flex flex-wrap gap-x-2">
                      {m.groups.map((g) => (
                        <GroupLink key={g} id={g}>
                          {g.split("-").pop()!.toUpperCase()}
                        </GroupLink>
                      ))}
                    </span>
                  ) : (
                    <Pill>needs {m.gapToViable} more</Pill>
                  )}
                </td>
                <td className="py-3 pr-5">{m.independentGroups}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
