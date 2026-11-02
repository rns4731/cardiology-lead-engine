import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2, TriangleAlert } from "lucide-react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(8,16,32,0.04),0_8px_24px_-12px_rgba(8,16,32,0.10)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "slate" | "teal" | "rose" | "amber" | "emerald" | "ink";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700",
  teal: "bg-teal-50 text-teal-800",
  rose: "bg-rose-50 text-rose-800",
  amber: "bg-amber-50 text-amber-800",
  emerald: "bg-emerald-50 text-emerald-800",
  ink: "bg-ink text-white",
};

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const PROVENANCE: Record<string, { label: string; tone: Tone }> = {
  real: { label: "Real data", tone: "emerald" },
  derived: { label: "Derived from real data", tone: "teal" },
  "stand-in": { label: "Real, stand-in", tone: "teal" },
  inferred: { label: "Inferred from real data", tone: "teal" },
  assumption: { label: "Real input, assumed lookup", tone: "amber" },
  none: { label: "No real data", tone: "slate" },
  fictional: { label: "Fictional article", tone: "amber" },
  simulated: { label: "Simulated", tone: "amber" },
};

/** Where a value actually came from -- shown at the same weight as the value. */
export function ProvenancePill({ provenance }: { provenance: string }) {
  const p = PROVENANCE[provenance] ?? PROVENANCE.simulated;
  return <Pill tone={p.tone}>{p.label}</Pill>;
}

/** Stat tile: label, value (sans, proportional figures), optional sub + drill link. */
export function StatTile({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between text-[13px] font-medium text-slate-500">
        {label}
        {to && (
          <ArrowUpRight
            size={14}
            className="text-slate-300 transition group-hover:text-teal-600"
          />
        )}
      </div>
      <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight text-ink">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </>
  );
  const cls =
    "group block rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(8,16,32,0.04)]";
  return to ? (
    <Link to={to} className={`${cls} transition hover:border-teal-300 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Meter({
  value,
  max,
  color,
  track,
  height = 8,
}: {
  value: number;
  max: number;
  color: string;
  track: string;
  height?: number;
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-[4px]" style={{ height, background: track }}>
      <div className="h-full rounded-r-[4px]" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="font-display text-xl text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline"
    >
      {children}
    </Link>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading data…" }: { label?: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500" role="status">
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> {label}
      </div>
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <TriangleAlert className="mx-auto text-amber-500" />
      <h1 className="mt-3 font-display text-2xl text-ink">{title}</h1>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}
