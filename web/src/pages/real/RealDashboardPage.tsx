import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useRealData } from "../../lib/data";
import { pct, relativeDate } from "../../lib/format";
import { SEQ, SUBSPECIALTY_COLORS } from "../../lib/palette";
import { paths } from "../../lib/paths";
import { PageHeader } from "../../components/layout/AppShell";
import { SourceToggleView } from "../../components/layout/SourceLayout";
import { Card, CardHeader, ProvenancePill, SectionTitle, StatTile, TextLink } from "../../components/ui";
import { ChartFrame, Tip } from "../../components/charts/ChartFrame";
import { BubbleMap } from "../../components/charts/USMap";
import { BarList } from "../../components/charts/BarList";
import { StackedBar } from "../../components/charts/StackedBar";
import { Blank, BlankOutputs, OfficeShareNote, RealLeadTable, SignalCoverage, useRealSubspecialties } from "./shared";

const S = "public" as const;

export function RealCityMap({ selected }: { selected?: string }) {
  const { bundle } = useRealData();
  return (
    <BubbleMap
      selected={selected}
      bubbles={bundle.metros.map((m) => ({
        slug: m.slug,
        city: m.city,
        lat: m.lat,
        lon: m.lon,
        size: m.total,
        fill: SEQ,
        href: paths.location(S, m.slug),
        ariaLabel: `${m.metro}: ${m.total} hospital-based (inferred) of ${m.billing} billing Medicare`,
        tip: (
          <Tip
            value={m.metro}
            label="Real CMS counts"
            rows={[
              ["Hospital-based (inferred)", m.total.toLocaleString()],
              ["Billing Medicare", m.billing.toLocaleString()],
            ]}
          />
        ),
      }))}
      legend={<span>Bubble area = cardiologists listed (hospital-based by billing, inferred). No scores, so no color scale.</span>}
    />
  );
}

export default function RealDashboardPage() {
  const { bundle, manifest } = useRealData();
  const { metros, leads, universe } = bundle;
  const subs = useRealSubspecialties();
  const billing = metros.reduce((s, m) => s + m.billing, 0);
  const mix = useMemo(() => {
    const c: Record<string, number> = {};
    metros.forEach((m) => Object.entries(m.mix).forEach(([k, v]) => (c[k] = (c[k] ?? 0) + v)));
    return c;
  }, [metros]);
  const byCity = [...metros].sort((a, b) => b.total - a.total || a.metro.localeCompare(b.metro));
  const filledSignals = bundle.signals.filter((s) => s.status !== "none" && s.coverage > 0);
  const breakdown = (["real", "stand-in", "inferred", "assumption"] as const)
    .map((st) => [st, filledSignals.filter((s) => s.status === st).length] as const)
    .filter(([, n]) => n > 0)
    .map(([st, n]) => `${n} ${st === "real" ? "exact" : st}`)
    .join(" · ");
  const news = bundle.news;

  return (
    <>
      <PageHeader
        kicker="Growth pipeline · real data only"
        title="Who's there, and what real data says about them"
        subtitle={
          <>
            {bundle.source.description} Every number below comes from a real record, and every blank is an unknown, not a
            zero.
          </>
        }
        actions={<SourceToggleView source={S} manifest={manifest} />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Cardiologists listed"
          value={leads.length.toLocaleString()}
          sub={`hospital-based by billing (inferred) · ${metros.length} cities`}
          to={paths.cardiologists(S)}
        />
        <StatTile
          label={`Billing Medicare (${universe.year})`}
          value={billing.toLocaleString()}
          sub={`${pct(leads.length / billing)} of them mostly in hospital settings`}
          to={paths.locations(S)}
        />
        <StatTile
          label="Signals with real data"
          value={`${filledSignals.length} of 10`}
          sub={breakdown}
          to={paths.signals(S)}
        />
        <StatTile label="Propensity score" value={<Blank />} sub="no weights with a real basis" />
        <StatTile label="Candidate cohorts" value={<Blank />} sub="need a score to qualify anyone" to={paths.groups(S)} />
        <StatTile label="Window open now" value={<Blank />} sub="no timing data" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartFrame
          className="lg:col-span-2"
          title="Where they are"
          subtitle="Click a city to open it."
          table={{
            columns: ["City", "Billing Medicare", "Hospital-based (inferred)", "Share"],
            rows: metros.map((m) => [
              <Link className="text-teal-700 hover:underline" to={paths.location(S, m.slug)}>
                {m.metro}
              </Link>,
              m.billing,
              m.total,
              pct(m.billing ? m.total / m.billing : null),
            ]),
          }}
        >
          <RealCityMap />
        </ChartFrame>

        <Card>
          <CardHeader
            title="By city"
            subtitle="Listed cardiologists. Not ranked by opportunity: there's no score."
            action={<TextLink to={paths.locations(S)}>All</TextLink>}
          />
          <div className="px-5 pb-5 pt-4">
            <BarList
              labelWidth="9rem"
              rows={byCity.map((m) => ({
                key: m.slug,
                label: m.metro,
                value: m.total,
                to: paths.location(S, m.slug),
                note: `of ${m.billing} billing Medicare`,
              }))}
            />
          </div>
        </Card>
      </div>

      <SectionTitle action={<TextLink to={paths.signals(S)}>All signals <ArrowRight size={14} /></TextLink>}>
        The ten signals from real records
      </SectionTitle>
      <p className="-mt-1 mb-3 max-w-3xl text-sm text-slate-500">
        Same ten signals and 0–1 formulas as Synthetic. Each is labeled by how directly its real record measures the signal:
        exact, a stand-in for a closely related thing, inferred through a stated rule, or a real input through an assumed lookup.
        Contract window has no public source and stays empty.
      </p>
      <Card className="py-2">
        <SignalCoverage />
      </Card>

      {news && (
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Employer disruption from the news</h3>
              <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
                Google News searched for {news.stats.entities} billing groups and hospitals; {news.stats.headlines} articles read by
                Claude ({news.model}); {news.stats.counted} events counted after the verbatim-quote and status checks. CMS
                change-of-ownership records for affiliated hospitals count too.
              </p>
            </div>
            <TextLink to={paths.news(S)}>
              See every event <ArrowRight size={14} />
            </TextLink>
          </div>
        </Card>
      )}

      <div className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <BlankOutputs title="What needs a score: all blank" />
        </div>
        <div className="space-y-6 lg:col-span-3">
          <ChartFrame
            title="Listed cardiologists by subspecialty"
            subtitle="Medicare provider type. Click a segment to list them."
            table={{ columns: ["Subspecialty", "Cardiologists"], rows: subs.map((s) => [s, mix[s] ?? 0]) }}
          >
            <StackedBar
              segments={subs.map((s) => ({
                key: s,
                label: s,
                value: mix[s] ?? 0,
                color: SUBSPECIALTY_COLORS[s],
                to: paths.cardiologists(S, { sub: s }),
              }))}
            />
            <p className="mt-3 text-xs text-slate-500">
              "General cardiology" is CMS provider type "Cardiology". The CMS pull covers four cardiology provider types and
              none of them is imaging, so imaging cardiologists can't be told apart here.
            </p>
          </ChartFrame>
          <Card>
            <CardHeader title="How this list was made" action={<ProvenancePill provenance="inferred" />} />
            <div className="space-y-2 px-5 pb-5 pt-3 text-sm text-slate-600">
              <p>
                <span className="font-medium text-ink">Rule:</span> {universe.rule}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {universe.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">Sources: {universe.sources.join("; ")}.</p>
            </div>
          </Card>
        </div>
      </div>

      <SectionTitle action={<TextLink to={paths.cardiologists(S)}>All {leads.length} <ArrowRight size={14} /></TextLink>}>
        Cardiologists
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-slate-500">
        Alphabetical, not ranked. <OfficeShareNote />
      </p>
      <Card className="p-3">
        <RealLeadTable leads={leads} pageSize={8} />
      </Card>

      <p className="mt-8 text-center text-xs text-slate-400">
        {leads.length.toLocaleString()} cardiologists · CMS data fetched {relativeDate(bundle.source.fetchedAt ?? bundle.source.generatedAt)} ·
        bundle built {new Date(bundle.source.generatedAt).toLocaleString()}
      </p>
    </>
  );
}
