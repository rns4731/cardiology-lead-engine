import { useState } from "react";
import { CHROME, SEQ } from "../../lib/palette";
import { pct } from "../../lib/format";
import type { SweepRow } from "../../types";

const W = 320;
const H = 150;
const PAD = { l: 34, r: 10, t: 14, b: 26 };
const INSET = 14; // keep the first/last columns off the axis labels

/**
 * Threshold sensitivity as two small multiples sharing an x-axis (never one chart
 * with two y-scales): how many leads qualify, and how precise they are. A shared
 * crosshair snaps to the nearest floor and reads out every measure at once.
 */
export function Sensitivity({ sweep, floor, minN }: { sweep: SweepRow[]; floor: number; minN: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const xs = sweep.map((r) => r.floor);
  const x = (f: number) =>
    PAD.l + INSET + ((f - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - PAD.l - PAD.r - 2 * INSET);
  const active = sweep.find((r) => r.floor === (hover ?? floor)) ?? sweep[0];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = xs[0];
    xs.forEach((f) => {
      if (Math.abs(x(f) - px) < Math.abs(x(best) - px)) best = f;
    });
    setHover(best);
  }

  const panel = (
    title: string,
    get: (r: SweepRow) => number,
    fmt: (v: number) => string,
    kind: "col" | "line",
    rows: SweepRow[] = sweep
  ) => {
    const max = Math.max(...rows.map(get), 1e-9);
    const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
    const pts = rows.map((r) => `${x(r.floor)},${y(get(r))}`).join(" ");
    return (
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-600">{title}</div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${title} by propensity floor`}
        >
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} stroke={CHROME.grid} />
              <text x={PAD.l - 6} y={y(max * t) + 3} textAnchor="end" fontSize="10" fill={CHROME.textMuted}>
                {fmt(max * t)}
              </text>
            </g>
          ))}
          {kind === "col"
            ? sweep.map((r) => {
                const h = H - PAD.b - y(get(r));
                const bx = x(r.floor) - 9;
                const base = H - PAD.b;
                // 4px rounded data-end, square at the baseline; too short to round -> plain
                const d =
                  h >= 4
                    ? `M${bx},${base} v${-h + 4} q0,-4 4,-4 h10 q4,0 4,4 v${h - 4} z`
                    : `M${bx},${base} v${-h} h18 v${h} z`;
                return (
                  <path
                    key={r.floor}
                    d={d}
                    fill={SEQ}
                    opacity={r.floor === active.floor ? 1 : 0.55}
                  />
                );
              })
            : (
              <>
                <polyline points={pts} fill="none" stroke={SEQ} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {rows.map((r) => (
                  <circle
                    key={r.floor}
                    cx={x(r.floor)}
                    cy={y(get(r))}
                    r={r.floor === active.floor ? 5 : 4}
                    fill={SEQ}
                    stroke={CHROME.surface}
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
          <line x1={x(floor)} x2={x(floor)} y1={PAD.t - 6} y2={H - PAD.b} stroke={CHROME.textPrimary} strokeOpacity={0.5} />
          {hover != null && hover !== floor && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t - 6} y2={H - PAD.b} stroke={CHROME.axis} />
          )}
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke={CHROME.axis} />
          {xs.map((f) => (
            <text key={f} x={x(f)} y={H - 8} textAnchor="middle" fontSize="10" fill={CHROME.textMuted}>
              {f}
            </text>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {panel("Qualified leads", (r) => r.qualified, (v) => Math.round(v).toLocaleString(), "col")}
        {panel(
          "Hit rate (share who move)",
          (r) => r.precision ?? 0,
          (v) => pct(v),
          "line",
          // the engine withholds small or overlapping cells (disclosure control)
          sweep.filter((r) => r.precision != null)
        )}
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-600">
        Hit rate is withheld under {minN} leads, or where it would overlap another published figure.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-5" aria-live="polite">
        <Readout k="Floor" v={`${active.floor}${active.floor === floor ? " (operating)" : ""}`} />
        <Readout k="Qualified" v={active.qualified.toLocaleString()} />
        <Readout k="Hit rate" v={active.precision != null ? pct(active.precision, 1) : "withheld"} />
        <Readout k="Movers caught" v={active.recall != null ? pct(active.recall, 1) : "withheld"} />
        <Readout k="Cohorts" v={`${active.groups} in ${active.viableMetros} metros`} />
      </div>
    </div>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-slate-500">{k}</div>
      <div className="font-semibold text-ink">{v}</div>
    </div>
  );
}
