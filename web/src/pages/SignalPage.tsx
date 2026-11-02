import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Database, Sigma } from "lucide-react";
import { useData } from "../lib/data";
import { aucVerdict, ci, pct } from "../lib/format";
import type { HistBin } from "../types";
import { MUTED_MARK, SEQ } from "../lib/palette";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { MissingEntity } from "../components/layout/SourceLayout";
import { Card, CardHeader, ProvenancePill, SectionTitle, StatTile } from "../components/ui";
import { ChartFrame } from "../components/charts/ChartFrame";
import { Histogram } from "../components/charts/Histogram";
import { BarList } from "../components/charts/BarList";
import { LeadTable } from "../components/LeadTable";
import { AUC_PLAIN, Diagnostics } from "../components/Diagnostics";

/** On/off only when every occupied bin is an end bin (0 or 1). A two-value signal like
 *  0.6 / 1.0 is not "off vs on". */
export function isBinary(hist: HistBin[]): boolean {
  const occupied = hist.flatMap((b, i) => (b.count > 0 ? [i] : []));
  return occupied.length > 0 && occupied.every((i) => i === 0 || i === hist.length - 1);
}

export default function SignalPage() {
  const { key = "" } = useParams();
  const { source, bundle, index } = useData();
  const s = index.signals.get(key);
  const top = useMemo(() => (s ? s.top.map((n) => index.leads.get(n)!).filter(Boolean) : []), [s, index]);
  if (!s) return <MissingEntity kind="signal" id={key} back={{ label: "See all signals", to: paths.signals(source) }} />;

  const i = bundle.signals.findIndex((x) => x.key === key);
  const prev = bundle.signals[i - 1];
  const next = bundle.signals[i + 1];
  const floorPct = Math.round(bundle.meta.reasonFloor * 100);
  const binary = isBinary(s.hist);
  const verdict = aucVerdict(s.auc, s.aucCi);
  const n = bundle.meta.metrics.n;
  const moved = [
    { key: "a", label: "Signal active", value: s.moveRateActive, color: SEQ },
    { key: "i", label: "Not active", value: s.moveRateInactive, color: MUTED_MARK },
    { key: "b", label: "Base rate", value: bundle.meta.metrics.baseRate, color: MUTED_MARK },
  ].filter((r): r is { key: string; label: string; value: number; color: string } => r.value != null);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Dashboard", to: paths.dashboard(source) },
          { label: "Signals", to: paths.signals(source) },
          { label: s.label },
        ]}
        kicker={`Signal ${i + 1} of ${bundle.signals.length} · weight ${s.weight}`}
        title={s.label}
        subtitle={s.rationale}
        actions={
          <div className="flex items-center gap-1 text-sm">
            {prev && (
              <Link to={paths.signal(source, prev.key)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-ink">
                <ChevronLeft size={15} /> {prev.label}
              </Link>
            )}
            {next && (
              <Link to={paths.signal(source, next.key)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-ink">
                {next.label} <ChevronRight size={15} />
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Sigma size={16} className="text-teal-600" />How it's computed</span>} />
          <div className="p-5 pt-3 text-sm text-slate-700">
            <code className="block rounded-lg bg-ink px-4 py-3 font-mono text-[13px] leading-relaxed text-teal-200">
              factor = {s.formula}
              <br />
              points = {s.weight} × factor
            </code>
            <p className="mt-3">
              The factor is scaled to 0–1, so this signal adds at most <span className="font-semibold">{s.weight}</span> of the
              100 points. It's reported as a plain-language reason when it reaches {floorPct}% of its weight.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Database size={16} className="text-teal-600" />Where the data comes from</span>}
            action={<ProvenancePill provenance={s.provenance} />}
          />
          <div className="space-y-3 p-5 pt-3 text-sm text-slate-700">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">In this mode</div>
              <p className="mt-0.5 font-medium text-ink">{s.source}</p>
            </div>
            {s.productionSource && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">In production</div>
                <p className="mt-0.5">{s.productionSource}</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <SectionTitle>Does it predict who moves?</SectionTitle>
      {s.units.level !== "individual" && (
        <p className="-mt-1 mb-3 text-sm text-slate-600">
          This signal is set per {s.units.level}: it varies across {s.units.varying} of {s.units.total}{" "}
          {s.units.level === "metro" ? "metros" : "employers"}, so this sample holds about {s.units.total} independent data
          points for it — not {n.toLocaleString()}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Fires for" value={pct(s.activeShare)} sub={`${s.activeCount.toLocaleString()} cardiologists`} />
        <StatTile label="Average points added" value={s.meanContribution.toFixed(1)} sub={`of ${s.weight} possible`} />
        <StatTile label="Predicts on its own?" value={verdict.label} sub="compared with a coin flip" />
        <StatTile label="Move-rate lift when active" value={s.lift != null ? `${s.lift}×` : "—"} sub={`${pct(s.moveRateActive)} vs ${pct(s.moveRateInactive)}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Who moved, with vs. without this signal"
          subtitle="Share who went independent within 24 months (hidden, simulated outcome)."
          table={{
            columns: ["Group", "Move rate"],
            rows: [
              ["Signal active", s.moveRateActive != null ? pct(s.moveRateActive, 1) : "withheld / no group"],
              ["Signal not active", s.moveRateInactive != null ? pct(s.moveRateInactive, 1) : "withheld / no group"],
              ["Everyone (base rate)", pct(bundle.meta.metrics.baseRate, 1)],
            ],
          }}
        >
          <BarList
            labelWidth="9rem"
            max={Math.max(...moved.map((r) => r.value)) * 1.15}
            rows={moved.map((r) => ({ ...r, display: pct(r.value, 1) }))}
          />
          <p className="mt-4 text-xs text-slate-500">
            {s.moveRateInactive == null &&
              `It fires for ${s.activeShare >= 0.99 ? "everyone" : "nearly everyone"}, so there's no comparison group large enough to report. `}
            {s.moveRateActive == null && `Too few have it active (under ${bundle.meta.minN}) to report a rate. `}
            {verdict.tone === "none"
              ? "Too close to call: this sample can't tell it apart from chance, so measure it with real outcomes before changing its weight."
              : "Groups are split at the reporting bar."}
          </p>
        </ChartFrame>
        <ChartFrame
          title={binary ? "Off vs. on" : "Distribution of the factor"}
          subtitle={binary ? "This signal is either off (0) or on (1)." : "Factor value (0–1) across every scored cardiologist."}
          table={{ columns: ["Factor", "Cardiologists"], rows: s.hist.map((b) => [`${b.x0.toFixed(1)}–${b.x1.toFixed(1)}`, b.count]) }}
        >
          <Histogram bins={s.hist} xLabel="Factor value" format={(b) => `${b.x0.toFixed(1)}–${b.x1.toFixed(1)}`} />
        </ChartFrame>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <ChartFrame
          className="lg:col-span-2"
          title="By location"
          subtitle="Average points this signal adds. Click to open a location."
          table={{ columns: ["Location", "Avg points", "Fires for"], rows: s.byMetro.map((b) => [b.metro, b.mean.toFixed(2), pct(b.activeShare)]) }}
        >
          <BarList
            labelWidth="8.5rem"
            max={s.weight}
            rows={s.byMetro.map((b) => ({
              key: b.slug,
              label: b.metro,
              value: b.mean,
              display: b.mean.toFixed(1),
              to: paths.location(source, b.slug),
              note: `fires for ${pct(b.activeShare)}`,
            }))}
          />
        </ChartFrame>
        <Card className="p-3 lg:col-span-3">
          <div className="px-2 pb-1 pt-2">
            <h3 className="text-[15px] font-semibold text-ink">Where it drives the score most</h3>
            <p className="text-sm text-slate-500">Top cardiologists by points from this signal.</p>
          </div>
          <LeadTable
            leads={top}
            initialSort={null}
            pageSize={12}
            cols={["name", "metro", "subspecialty", "propensity"]}
            extra={{ header: "Points", cell: (l) => <span className="font-semibold tabular-nums text-ink">{(l.contributions[s.key] ?? 0).toFixed(1)}</span> }}
          />
        </Card>
      </div>

      <Diagnostics className="mt-6" title="Signal diagnostics" hint="This signal's AUC, for technical readers">
        <p>
          <span className="font-semibold tabular-nums text-ink">AUC on its own {s.auc.toFixed(3)}</span>, 95% range{" "}
          <span className="tabular-nums">{ci(s.aucCi, 3)}</span>. {AUC_PLAIN}
        </p>
        <p>
          The verdict above comes from that range: entirely above 0.5 is better than chance, entirely below is worse, and a
          range that straddles 0.5 is too close to call. AUC needs no cut-off, so it's a fairer test than the with/without move
          rates for signals that vary continuously.
        </p>
      </Diagnostics>
    </>
  );
}
