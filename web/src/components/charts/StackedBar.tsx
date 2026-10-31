import { pct } from "../../lib/format";
import { Legend, Tip, useDrill, useTooltip } from "./ChartFrame";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  to?: string;
}

/**
 * Part-to-whole bar with 2px surface gaps between segments. Each segment carries
 * its own hover/focus tooltip and drills through when clicked. The legend (with
 * counts) is always present, so identity never rests on color alone.
 */
export function StackedBar({ segments, height = 18 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const tip = useTooltip();
  const drill = useDrill();
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div ref={tip.ref} className="relative">
        <div className="flex w-full gap-[2px]" style={{ height }}>
          {shown.map((s, i) => (
            <div
              key={s.key}
              aria-label={`${s.label}: ${s.value} (${pct(s.value / total)})`}
              {...tip.bind(<Tip value={`${s.value.toLocaleString()} · ${pct(s.value / total)}`} label={s.label} />)}
              {...drill(s.to)}
              className={`h-full transition-opacity hover:opacity-80 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600 ${
                i === 0 ? "rounded-l-[4px]" : ""
              } ${i === shown.length - 1 ? "rounded-r-[4px]" : ""}`}
              style={{ flexGrow: s.value, flexBasis: 0, background: s.color, cursor: s.to ? "pointer" : undefined }}
            />
          ))}
          {total === 0 && <div className="h-full w-full rounded-[4px] bg-slate-100" />}
        </div>
        {tip.node}
      </div>
      <div className="mt-3">
        <Legend items={segments.map((s) => ({ label: s.label, color: s.color, value: s.value.toLocaleString() }))} />
      </div>
    </div>
  );
}
