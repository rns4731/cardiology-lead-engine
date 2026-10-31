import { CHROME, MUTED_MARK, SEQ } from "../../lib/palette";
import { Tip, useDrill, useTooltip } from "./ChartFrame";
import type { HistBin } from "../../types";

/** Drop empty bins at both ends (never dropping a non-empty one), keeping `keep` in view. */
export function trimBins(bins: HistBin[], keep?: number): HistBin[] {
  let lo = bins.findIndex((b) => b.count > 0);
  let hi = bins.length - 1 - [...bins].reverse().findIndex((b) => b.count > 0);
  if (lo < 0) return bins;
  if (keep != null) {
    const k = bins.findIndex((b) => b.x0 <= keep && keep < b.x1);
    if (k >= 0) {
      lo = Math.min(lo, k);
      hi = Math.max(hi, k);
    }
  }
  return bins.slice(lo, hi + 1);
}

/**
 * Columns over equal-width bins, emphasis form: bins at/above `floor` in the
 * accent, the rest de-emphasized. The container includes the x-axis band so labels
 * never clip. Columns cap at 24px and grow from one baseline.
 */
export function Histogram({
  bins,
  floor,
  xLabel,
  format = (b) => `${b.x0}–${b.x1}`,
  binTo,
  height = 150,
}: {
  bins: HistBin[];
  floor?: number;
  xLabel: string;
  format?: (b: HistBin) => string;
  binTo?: (b: HistBin) => string | undefined;
  height?: number;
}) {
  const tip = useTooltip();
  const drill = useDrill();
  const max = Math.max(...bins.map((b) => b.count), 1);
  const total = bins.reduce((s, b) => s + b.count, 0);
  const lo = bins[0]?.x0 ?? 0;
  const hi = bins[bins.length - 1]?.x1 ?? 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * t);
  const floorPos = floor != null ? ((floor - lo) / (hi - lo)) * 100 : null;

  return (
    <div ref={tip.ref} className="relative">
      <div className="flex">
        <div className="flex w-9 shrink-0 flex-col justify-between pr-2 text-right text-[11px] tabular-nums text-slate-600" style={{ height }}>
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1">
          <div
            className="relative flex items-end gap-[2px] border-b"
            style={{ height, borderColor: CHROME.axis }}
          >
            {bins.map((b) => {
              const on = floor == null || b.x0 >= floor;
              return (
                <div key={b.x0} className="flex h-full flex-1 items-end justify-center">
                  <div
                    {...tip.bind(
                      <Tip
                        value={`${b.count.toLocaleString()} physicians`}
                        label={`${xLabel} ${format(b)}`}
                        rows={[["Share", `${((b.count / Math.max(total, 1)) * 100).toFixed(1)}%`]]}
                      />
                    )}
                    {...drill(binTo?.(b))}
                    aria-label={`${format(b)}: ${b.count}`}
                    className="w-full max-w-6 rounded-t-[4px] transition-opacity hover:opacity-75"
                    style={{
                      height: `${(b.count / max) * 100}%`,
                      minHeight: b.count > 0 ? 2 : 0,
                      background: on ? SEQ : MUTED_MARK,
                    }}
                  />
                </div>
              );
            })}
            {floorPos != null && (
              <div className="pointer-events-none absolute inset-y-0" style={{ left: `${floorPos}%` }}>
                <div className="h-full w-px bg-ink/60" />
                <div className="absolute -top-1 left-1.5 whitespace-nowrap text-[11px] font-semibold text-ink">
                  Floor {floor}
                </div>
              </div>
            )}
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-slate-600">
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${i * 25}%` }}
              >
                {Number.isInteger(t) ? t : t.toFixed(2)}
              </span>
            ))}
          </div>
          <div className="mt-1 text-center text-[11px] text-slate-500">{xLabel}</div>
        </div>
      </div>
      {tip.node}
    </div>
  );
}
