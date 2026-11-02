import { useParams } from "react-router-dom";
import { Zap } from "lucide-react";
import { useData, useSubspecialties } from "../lib/data";
import { capitalize, pct } from "../lib/format";
import { SUBSPECIALTY_COLORS, TIMING_COLORS, TIMING_ORDER } from "../lib/palette";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { MissingEntity } from "../components/layout/SourceLayout";
import { Card, SectionTitle, StatTile, TextLink } from "../components/ui";
import { MetroLink } from "../components/links";
import { ChartFrame } from "../components/charts/ChartFrame";
import { StackedBar } from "../components/charts/StackedBar";
import { LeadTable } from "../components/LeadTable";
import { GroupCard } from "./GroupsPage";

export default function SystemPage() {
  const { slug = "" } = useParams();
  const { source, bundle, index } = useData();
  const subs = useSubspecialties();
  const s = index.systems.get(slug);
  if (!s) return <MissingEntity kind="hospital system" id={slug} back={{ label: "See all locations", to: paths.locations(source) }} />;

  const leads = index.leadsBySystem.get(slug) ?? [];
  const groups = s.groups.map((g) => index.groups.get(g)!).filter(Boolean);
  const floor = bundle.meta.operatingFloor;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Dashboard", to: paths.dashboard(source) },
          { label: s.metro, to: paths.location(source, s.metroSlug) },
          { label: s.name },
        ]}
        kicker="Hospital system (fictional)"
        title={s.name}
        subtitle={
          <>
            Employs {s.total} cardiologists in{" "}
            <MetroLink slug={s.metroSlug} />; {s.qualified} qualify. Colleagues at the same{" "}
            system share triggers and working relationships, so they often move together.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Cardiologists" value={s.total} to={paths.cardiologists(source, { system: slug })} />
        <StatTile label="Qualified" value={s.qualified} sub={pct(s.qualified / s.total)} to={paths.cardiologists(source, { system: slug, min: floor })} />
        <StatTile label="Average propensity" value={s.avgPropensity.toFixed(0)} />
        <StatTile label="Cohorts with members here" value={groups.length} sub={`anchors ${s.anchors.length}`} />
      </div>
      {s.event !== "none" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Zap size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <span className="font-semibold">{capitalize(s.event)} {s.eventMonthsAgo} months ago</span> (simulated event, read by the
            news pipeline from a{" "}
            <TextLink to={paths.news(source, bundle.news?.comparison.find((r) => r.system === s.name)?.extracted?.article)}>
              fictional article
            </TextLink>
            ). This is the strongest trigger in the model: it lifts every cardiologist here through the{" "}
            <TextLink to={paths.signal(source, "disruption")}>employer disruption</TextLink> signal and opens their timing window.
          </span>
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame title="When windows open" table={{ columns: ["Window", "Cardiologists"], rows: TIMING_ORDER.map((t) => [t, s.timing[t] ?? 0]) }}>
          <StackedBar
            segments={TIMING_ORDER.map((t) => ({
              key: t,
              label: t,
              value: s.timing[t] ?? 0,
              color: TIMING_COLORS[t],
              to: paths.cardiologists(source, { system: slug, timing: t }),
            }))}
          />
        </ChartFrame>
        <ChartFrame title="Subspecialties" table={{ columns: ["Subspecialty", "Cardiologists"], rows: subs.map((x) => [x, s.mix[x] ?? 0]) }}>
          <StackedBar
            segments={subs.map((x) => ({
              key: x,
              label: x,
              value: s.mix[x] ?? 0,
              color: SUBSPECIALTY_COLORS[x],
              to: paths.cardiologists(source, { system: slug, sub: x }),
            }))}
          />
        </ChartFrame>
      </div>
      {groups.length > 0 && (
        <>
          <SectionTitle>Cohorts with members from {s.name}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
          </div>
        </>
      )}
      <SectionTitle>Cardiologists at {s.name}</SectionTitle>
      <Card className="p-3">
        <LeadTable leads={leads} pageSize={12} cols={["rank", "name", "subspecialty", "propensity", "timing", "group"]} />
      </Card>
    </>
  );
}
