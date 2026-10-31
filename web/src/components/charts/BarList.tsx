import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MUTED_MARK, SEQ } from "../../lib/palette";

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  display?: ReactNode; // value label at the bar tip
  to?: string; // drill-down target for the row
  color?: string;
  muted?: boolean; // emphasis form: de-emphasized context row
  note?: ReactNode;
}

/**
 * Horizontal bars, one series: <=14px thick, 4px rounded data-end, square at the
 * baseline, value at the tip. Labels are links when a row has a target.
 */
export function BarList({
  rows,
  max,
  labelWidth = "11rem",
}: {
  rows: BarRow[];
  max?: number;
  labelWidth?: string;
}) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const w = Math.max(0, Math.min(100, (r.value / m) * 100));
        const label = r.to ? (
          <Link to={r.to} className="truncate font-medium text-ink hover:underline decoration-teal-500/60 underline-offset-2">
            {r.label}
          </Link>
        ) : (
          <span className="truncate text-slate-700">{r.label}</span>
        );
        return (
          <div key={r.key} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
            <div className="min-w-0 text-sm">
              <div className="truncate">{label}</div>
              {r.note && <div className="truncate text-xs text-slate-500">{r.note}</div>}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1">
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ width: `${w}%`, background: r.muted ? MUTED_MARK : r.color ?? SEQ, minWidth: r.value > 0 ? 2 : 0 }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                {r.display ?? r.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
