import { useMemo, type ReactNode } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import us from "us-atlas/states-albers-10m.json";
import { CHROME, MUTED_MARK, seqColor } from "../../lib/palette";
import type { Metro } from "../../types";
import { Tip, useDrill, useTooltip } from "./ChartFrame";

// states-albers-10m is pre-projected for this exact Albers USA setup (975x610)
const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const topo = us as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
const path = geoPath();

// labels for metros that sit close together are pushed apart (NC/TN cluster)
const LABEL_POS: Record<string, "left" | "right" | "above" | "below"> = {
  "nashville-tn": "left",
  "charlotte-nc": "below",
  "raleigh-nc": "right",
  "phoenix-az": "left",
};

export interface Bubble {
  slug: string;
  city: string;
  lat: number | null;
  lon: number | null;
  /** drives bubble area */
  size: number;
  fill: string;
  tip: ReactNode;
  ariaLabel: string;
  href: string;
}

/** Shared bubble map: one bubble per location, area ~ size, each drills into its page. */
export function BubbleMap({ bubbles, selected, legend }: { bubbles: Bubble[]; selected?: string; legend: ReactNode }) {
  const tip = useTooltip();
  const drill = useDrill();
  const { nation, borders } = useMemo(
    () => ({
      nation: path(feature(topo, topo.objects.nation)) ?? "",
      borders: path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? "",
    }),
    []
  );
  const maxS = Math.max(...bubbles.map((b) => b.size), 1);
  const placed = bubbles
    .map((b) => ({ b, p: b.lat != null && b.lon != null ? projection([b.lon, b.lat]) : null }))
    .filter((d): d is { b: Bubble; p: [number, number] } => d.p != null)
    .sort((x, y) => y.b.size - x.b.size); // small bubbles drawn on top

  return (
    <div ref={tip.ref} className="relative">
      <svg viewBox="0 0 975 610" className="w-full" role="img" aria-label="Map of locations">
        <path d={nation} fill="#f1f5f9" />
        <path d={borders} fill="none" stroke="#ffffff" strokeWidth={1.5} />
        {placed.map(({ b, p }) => {
          const r = 7 + 20 * Math.sqrt(b.size / maxS);
          const isSel = selected === b.slug;
          const pos = LABEL_POS[b.slug] ?? "right";
          const label =
            pos === "left"
              ? { x: p[0] - r - 6, y: p[1] + 6, anchor: "end" as const }
              : pos === "below"
                ? { x: p[0], y: p[1] + r + 20, anchor: "middle" as const }
                : pos === "above"
                  ? { x: p[0], y: p[1] - r - 8, anchor: "middle" as const }
                  : { x: p[0] + r + 6, y: p[1] + 6, anchor: "start" as const };
          return (
            <g
              key={b.slug}
              {...tip.bind(b.tip)}
              {...drill(b.href)}
              aria-label={b.ariaLabel}
              className="outline-none [&:focus>circle]:stroke-ink"
            >
              <circle cx={p[0]} cy={p[1]} r={Math.max(r, 14)} fill="transparent" />
              <circle
                cx={p[0]}
                cy={p[1]}
                r={r}
                fill={b.fill}
                fillOpacity={0.9}
                stroke={isSel ? CHROME.textPrimary : CHROME.surface}
                strokeWidth={isSel ? 3 : 2}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fontSize={17}
                fontWeight={600}
                fill={CHROME.textPrimary}
                stroke="#ffffff"
                strokeWidth={4}
                paintOrder="stroke"
              >
                {b.city}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.node}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">{legend}</div>
    </div>
  );
}

/**
 * Bubble map: area ~ qualified leads, fill = best cohort viability on a one-hue
 * teal ramp (gray = no viable cohort yet). Each bubble drills into its location.
 */
export function USMap({
  metros,
  hrefFor,
  selected,
}: {
  metros: Metro[];
  hrefFor: (m: Metro) => string;
  selected?: string;
}) {
  return (
    <BubbleMap
      selected={selected}
      bubbles={metros.map((m) => ({
        slug: m.slug,
        city: m.city,
        lat: m.lat,
        lon: m.lon,
        size: m.qualified,
        fill: m.bestViability != null ? seqColor((m.bestViability - 40) / 50) : MUTED_MARK,
        href: hrefFor(m),
        ariaLabel: `${m.metro}: ${m.qualified} qualified, ${m.groups.length} cohorts`,
        tip: (
          <Tip
            value={m.metro}
            label={m.bestViability != null ? `Best cohort viability ${m.bestViability.toFixed(0)}` : "No viable cohort yet"}
            rows={[
              ["Qualified", m.qualified.toLocaleString()],
              ["Cohorts", String(m.groups.length)],
              ["Physicians", m.total.toLocaleString()],
            ]}
          />
        ),
      }))}
      legend={
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-16 rounded-sm" style={{ background: `linear-gradient(90deg, ${seqColor(0)}, ${seqColor(1)})` }} />
            Best cohort viability (low → high)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: MUTED_MARK }} />
            No viable cohort yet
          </span>
          <span>Bubble area = qualified leads</span>
        </>
      }
    />
  );
}
