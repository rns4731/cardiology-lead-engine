// Every entity name in the app renders through one of these, so everything is a
// drill-down link to its own page.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { paths } from "../lib/paths";
import { scoreInt } from "../lib/format";
import { SUBSPECIALTY_COLORS, TIMING_COLORS } from "../lib/palette";
import type { TimingBucket } from "../types";

const linkCls = "font-medium text-ink decoration-teal-500/60 underline-offset-2 hover:underline";

export function LeadLink({ npi, children }: { npi: number; children?: ReactNode }) {
  const { source, index } = useData();
  const l = index.leads.get(npi);
  return (
    <Link to={paths.cardiologist(source, npi)} className={linkCls}>
      {children ?? l?.name ?? `NPI ${npi}`}
    </Link>
  );
}

export function MetroLink({ slug, children }: { slug: string; children?: ReactNode }) {
  const { source, index } = useData();
  return (
    <Link to={paths.location(source, slug)} className={linkCls}>
      {children ?? index.metros.get(slug)?.metro ?? slug}
    </Link>
  );
}

export function SystemLink({ slug, children }: { slug: string; children?: ReactNode }) {
  const { source, index } = useData();
  return (
    <Link to={paths.system(source, slug)} className={linkCls}>
      {children ?? index.systems.get(slug)?.name ?? slug}
    </Link>
  );
}

export function GroupLink({ id, children }: { id: string; children?: ReactNode }) {
  const { source, index } = useData();
  return (
    <Link to={paths.group(source, id)} className={linkCls}>
      {children ?? index.groups.get(id)?.name ?? id}
    </Link>
  );
}

export function SignalLink({ k, children }: { k: string; children?: ReactNode }) {
  const { source, index } = useData();
  return (
    <Link to={paths.signal(source, k)} className={linkCls}>
      {children ?? index.signals.get(k)?.label ?? k}
    </Link>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Timing chip: colored dot carries identity, the label stays in ink. */
export function TimingTag({ bucket, link = false }: { bucket: TimingBucket; link?: boolean }) {
  const { source } = useData();
  const body = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      <Dot color={TIMING_COLORS[bucket]} />
      {bucket}
    </span>
  );
  return link ? (
    <Link to={paths.cardiologists(source, { timing: bucket })} className="hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SubTag({ name, link = false }: { name: string; link?: boolean }) {
  const { source } = useData();
  const body = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
      <Dot color={SUBSPECIALTY_COLORS[name] ?? "#94a3b8"} />
      {name}
    </span>
  );
  return link ? (
    <Link to={paths.cardiologists(source, { sub: name })} className="hover:underline">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Propensity number with a mini meter (the number is the value; the bar is context). */
export function ScoreCell({ value, floor }: { value: number; floor?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-7 text-right font-semibold tabular-nums text-ink">{scoreInt(value)}</span>
      <span className="relative hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 sm:block">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.min(100, value)}%`,
            background: floor != null && value < floor ? "#94a3b8" : "#0d9488",
          }}
        />
      </span>
    </span>
  );
}
