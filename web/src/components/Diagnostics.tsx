import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useData } from "../lib/data";

/** Technical metrics, collapsed by default. The main surfaces speak in hit rates and lift
 *  (what the growth team acts on); AUC lives here, always with its plain definition. */
export const AUC_PLAIN =
  "Pick one cardiologist who moved and one who didn't: AUC is how often the model ranks the one who moved higher. 0.5 is a coin flip; 1.0 is perfect.";

export function Diagnostics({
  title = "Model diagnostics",
  hint = "AUC and the best achievable score, for technical readers",
  dark = false,
  className = "",
  children,
}: {
  title?: string;
  hint?: string;
  dark?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const box = dark
    ? "border-white/10 bg-white/[0.04] text-slate-300"
    : "border-slate-200/80 bg-white text-slate-700 shadow-[0_1px_2px_rgba(8,16,32,0.04)]";
  return (
    <details className={`group rounded-2xl border ${box} ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} className="shrink-0 text-slate-400 transition group-open:rotate-90" />
        <span className={`font-semibold ${dark ? "text-white" : "text-ink"}`}>{title}</span>
        <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{hint}</span>
      </summary>
      <div className="space-y-3 px-5 pb-5 text-sm leading-relaxed">{children}</div>
    </details>
  );
}

/** Whole-model AUC, with the best achievable score where the outcome is simulated. */
export function ModelDiagnostics({ dark = false, className = "", children }: { dark?: boolean; className?: string; children?: ReactNode }) {
  const { bundle } = useData();
  const m = bundle.meta.metrics;
  const strong = dark ? "text-white" : "text-ink";
  const outcome = "measured against the simulated outcome";
  return (
    <Diagnostics dark={dark} className={className}>
      <p>
        <span className={`font-semibold tabular-nums ${strong}`}>AUC {m.auc.toFixed(3)}</span>, {outcome}. {AUC_PLAIN}
      </p>
      {m.oracleAuc != null ? (
        <p>
          <span className={`font-semibold tabular-nums ${strong}`}>Best achievable here: {m.oracleAuc.toFixed(3)}.</span> That's
          the AUC of a ranker that knows each cardiologist's exact simulated odds, scored on this same draw. No ranker can beat
          it on average, because the rest of the outcome is the coin toss built into the simulation; on any one draw a ranker
          can land slightly above it by luck. The scorer sits close to it because the outcome was simulated from the scorer's
          own assumptions, so this tests the pipeline, not the assumptions.
        </p>
      ) : (
        <p>
          There is no best-achievable benchmark here: the outcome is real, so nobody knows each cardiologist's true odds.
        </p>
      )}
      {children}
    </Diagnostics>
  );
}
