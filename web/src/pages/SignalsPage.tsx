import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { aucVerdict, ci, pct } from "../lib/format";
import { paths } from "../lib/paths";
import { PageHeader } from "../components/layout/AppShell";
import { Card, Meter, Pill, ProvenancePill } from "../components/ui";
import { ModelDiagnostics } from "../components/Diagnostics";

export function VerdictPill({ auc, ci: interval }: { auc: number; ci: [number, number] }) {
  const v = aucVerdict(auc, interval);
  return <Pill tone={v.tone === "good" ? "emerald" : "slate"}>{v.label}</Pill>;
}

export default function SignalsPage() {
  const { source, bundle } = useData();
  const m = bundle.meta.metrics;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "Signals" }]}
        kicker="Explainable by design"
        title="The ten signals"
        subtitle={
          <>
            Propensity is a transparent weighted sum: each signal contributes up to its weight, and weights
            sum to 100. Each signal is checked on its own below. Together, {pct(m.precision["25"])} of the top 25 moved
            against{" "}
            {pct(m.baseRate)} of everyone: {m.lift["25"]}× better than random, likely {ci(m.liftCi["25"], 1)}×.
          </>
        }
      />
      <Card className="overflow-x-auto scroll-slim">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-semibold">Signal</th>
              <th className="py-3 pr-4 font-semibold">Weight</th>
              <th className="py-3 pr-4 font-semibold">Fires for</th>
              <th className="py-3 pr-4 font-semibold">Move rate: active vs not</th>
              <th className="py-3 pr-4 font-semibold">Predicts on its own?</th>
              <th className="py-3 pr-5 font-semibold">Data in this mode</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {bundle.signals.map((s) => (
              <tr key={s.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                <td className="px-5 py-3.5">
                  <Link to={paths.signal(source, s.key)} className="font-semibold text-ink hover:underline decoration-teal-500/60 underline-offset-2">
                    {s.label}
                  </Link>
                  <div className="max-w-xs truncate text-xs text-slate-500">{s.rationale}</div>
                  {s.units.level !== "individual" && (
                    <div className="text-[11px] text-amber-700">
                      Set per {s.units.level}: {s.units.total} {s.units.level === "metro" ? "metros" : "employers"}
                    </div>
                  )}
                </td>
                <td className="py-3.5 pr-4">
                  <div className="flex w-28 items-center gap-2">
                    <Meter value={s.weight} max={20} color="#0d9488" track="#ccfbf1" height={6} />
                    <span className="w-5 text-right font-semibold text-ink">{s.weight}</span>
                  </div>
                </td>
                <td className="py-3.5 pr-4">{pct(s.activeShare)}</td>
                <td className="py-3.5 pr-4">
                  {pct(s.moveRateActive)} vs {pct(s.moveRateInactive)}
                  {s.lift != null && <span className="ml-1.5 text-xs text-slate-500">({s.lift}×)</span>}
                </td>
                <td className="py-3.5 pr-4">
                  <VerdictPill auc={s.auc} ci={s.aucCi} />
                </td>
                <td className="py-3.5 pr-5">
                  <ProvenancePill provenance={s.provenance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-4 max-w-3xl text-sm text-slate-600">
        <span className="font-semibold text-ink">Reading this honestly:</span> "Too close to call" means this sample can't
        tell the signal apart from chance. That is not the same as "no effect" — every signal here has a real effect in the
        simulation: small effects don't separate
        from noise with {m.n.toLocaleString()} cardiologists, and employer- or metro-level signals have far fewer independent
        data points than that. Measure them with real outcomes before changing any weight.
      </p>
      <ModelDiagnostics className="mt-6">
        <p>
          Each signal's verdict comes from its own AUC: if the 95% range sits entirely above 0.5 it predicts better than
          chance, entirely below is worse than chance, and a range that straddles 0.5 is too close to call.
        </p>
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-semibold">Signal</th>
                <th className="py-2 pr-4 font-semibold">AUC on its own</th>
                <th className="py-2 pr-4 font-semibold">95% range</th>
                <th className="py-2 font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {bundle.signals.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">{s.label}</td>
                  <td className="py-2 pr-4 font-semibold text-ink">{s.auc.toFixed(3)}</td>
                  <td className="whitespace-nowrap py-2 pr-4">{ci(s.aucCi, 3)}</td>
                  <td className="py-2">{aucVerdict(s.auc, s.aucCi).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModelDiagnostics>
    </>
  );
}
