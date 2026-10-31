import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui";

export interface TableSpec {
  columns: string[];
  rows: ReactNode[][];
}

/**
 * Every chart ships a table twin (the accessible equivalent) behind a toggle, and
 * a legend slot. Tooltips enhance; they never gate a value.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  children,
  footer,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  table: TableSpec;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card className={`p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="tablist">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${
                view === v ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? (
        <>
          {legend && <div className="mt-3">{legend}</div>}
          <div className="mt-4">{children}</div>
        </>
      ) : (
        <div className="mt-4 max-h-80 overflow-auto scroll-slim">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                {table.columns.map((c) => (
                  <th key={c} className="py-2 pr-4 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {r.map((cell, j) => (
                    <td key={j} className="py-1.5 pr-4 text-slate-700">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer && <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">{footer}</div>}
    </Card>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
          {it.value != null && <span className="font-semibold text-ink">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}

/** Tooltip state for a chart container. `bind(content)` goes on each mark. */
export function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const place = (clientX: number, clientY: number, content: ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ x: clientX - r.left, y: clientY - r.top, content });
  };
  const bind = (content: ReactNode) => ({
    onPointerMove: (e: { clientX: number; clientY: number }) => place(e.clientX, e.clientY, content),
    onPointerLeave: () => setTip(null),
    onFocus: (e: { currentTarget: Element }) => {
      const t = e.currentTarget.getBoundingClientRect();
      place(t.left + t.width / 2, t.top, content);
    },
    onBlur: () => setTip(null),
  });
  const node = tip ? (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, bind, node, setTip };
}

/** Value leads, label follows (tooltip hierarchy). */
export function Tip({ value, label, rows }: { value: ReactNode; label: ReactNode; rows?: [string, ReactNode][] }) {
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-slate-500">{label}</div>
      {rows?.map(([k, v]) => (
        <div key={k} className="mt-0.5 flex justify-between gap-4 text-slate-600">
          <span>{k}</span>
          <span className="font-semibold text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Make a non-anchor mark (svg/div) behave like a link: click + Enter, focusable. */
export function useDrill() {
  const navigate = useNavigate();
  return (to?: string) =>
    to
      ? {
          role: "link" as const,
          tabIndex: 0,
          onClick: () => navigate(to),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter") navigate(to);
          },
          style: { cursor: "pointer" },
        }
      : {};
}
