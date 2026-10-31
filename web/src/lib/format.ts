export const num = (n: number) => n.toLocaleString("en-US");

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export const score = (n: number) => n.toFixed(0);

/** Integer display that never rounds UP: 54.8 reads "54", so a lead shown as "55"
 *  is never one the engine considers below the 55 floor. */
export const scoreInt = (n: number) => String(Math.floor(n + 1e-9));

export const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : `$${Math.round(n)}`;

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(digits)}`;

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function relativeDate(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** AUC 0.5 = chance. A verdict needs the 95% interval to exclude 0.5; otherwise this
 *  sample simply can't tell -- which is not the same as "no signal". Labels are plain
 *  language; the AUC itself is shown only in the diagnostics. */
export function aucVerdict(
  _auc: number, // kept so call sites read aucVerdict(s.auc, s.aucCi); the interval decides
  ci: [number, number]
): { label: string; short: string; tone: "good" | "none" } {
  if (ci[0] > 0.5) return { label: "Better than chance", short: "better than chance", tone: "good" };
  if (ci[1] < 0.5) return { label: "Worse than chance", short: "worse than chance", tone: "none" };
  return { label: "Too close to call", short: "too close to call", tone: "none" };
}

export const ci = (c: [number, number] | null | undefined, digits = 2) =>
  c ? `${c[0].toFixed(digits)}–${c[1].toFixed(digits)}` : "—";
