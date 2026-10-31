// Chart colors. Every palette here was run through the dataviz validator
// (scripts/validate_palette.js) against the white card surface:
//  - SUBSPECIALTY: categorical, reference slots 1-5 in fixed order. PASS; three
//    slots sit under 3:1 contrast, so charts using them always ship visible
//    labels and a table view (the "relief rule").
//  - TIMING: ordinal one-hue rose ramp, Now (darkest) -> Watch. PASS --ordinal.
// Color follows the entity, never its rank: these maps are keyed by name.
import type { TimingBucket } from "../types";

export const SUBSPECIALTY_ORDER = [
  "Interventional",
  "Electrophysiology",
  "General cardiology",
  "Imaging",
  "Advanced Heart Failure",
] as const;

export const SUBSPECIALTY_COLORS: Record<string, string> = {
  Interventional: "#2a78d6",
  Electrophysiology: "#eb6834",
  "General cardiology": "#1baf7a",
  Imaging: "#eda100",
  "Advanced Heart Failure": "#e87ba4",
};

export const TIMING_ORDER: TimingBucket[] = ["Now", "Near", "Later", "Watch"];

export const TIMING_COLORS: Record<TimingBucket, string> = {
  Now: "#881337",
  Near: "#be123c",
  Later: "#e11d48",
  Watch: "#fb7185",
};

// single-series magnitude (one hue) + its lighter track step for meters
export const SEQ = "#0d9488";
export const SEQ_TRACK = "#ccfbf1";
// emphasis form: the one series the story is about vs de-emphasized context
export const MUTED_MARK = "#cbd5e1";

// chart chrome -- text never wears a series color
export const CHROME = {
  grid: "#e7e5e4",
  axis: "#cbd5e1",
  textPrimary: "#081020",
  textSecondary: "#475569",
  textMuted: "#475569", // slate-600: axis/tick values clear 4.5:1 on white
  surface: "#ffffff",
};

/** Teal sequential ramp for continuous magnitude (map bubbles). t in [0,1]. */
export function seqColor(t: number): string {
  const stops = ["#99f6e4", "#2dd4bf", "#0d9488", "#0f766e", "#134e4a"];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return mix(stops[i], stops[i + 1], x - i);
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return (
    "#" +
    pa
      .map((v, k) => Math.round(v + (pb[k] - v) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}
