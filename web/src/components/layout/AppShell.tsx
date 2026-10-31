import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigationType } from "react-router-dom";
import { BadgeCheck, ChevronRight, Database, FlaskConical, HeartPulse } from "lucide-react";
import { isSourceId, paths, SOURCE_LABEL, SOURCE_SHORT, SOURCES, switchSourcePath } from "../../lib/paths";
import type { SourceId } from "../../types";

const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "locations", label: "Locations" },
  { key: "groups", label: "Cohorts" },
  { key: "cardiologists", label: "Cardiologists" },
  { key: "signals", label: "Signals" },
];

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 text-white">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-light to-accent">
        <HeartPulse size={17} strokeWidth={2.4} />
      </span>
      <span className="hidden text-sm font-semibold tracking-tight sm:inline">Cardiology Lead Engine</span>
    </Link>
  );
}

const SOURCE_ICON = { public: BadgeCheck, synthetic: FlaskConical, real: Database } as const;
const SOURCE_TINT = { public: "text-emerald-300", synthetic: "text-brand-light", real: "text-amber-300" } as const;

/** Header data-source toggle: all three options, current one highlighted. */
function SourceSwitch({ source }: { source: SourceId }) {
  const { pathname, search } = useLocation();
  return (
    <div role="radiogroup" aria-label="Data source" className="flex rounded-full border border-white/15 bg-white/5 p-0.5">
      {SOURCES.map((s) => {
        const Icon = SOURCE_ICON[s];
        const on = s === source;
        return (
          <Link
            key={s}
            role="radio"
            aria-checked={on}
            to={switchSourcePath(pathname, search, s)}
            title={SOURCE_LABEL[s]}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              on ? "bg-white text-ink" : "text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={13} className={on ? "text-ink" : SOURCE_TINT[s]} />
            <span className="lg:hidden">{SOURCE_SHORT[s]}</span>
            <span className="hidden lg:inline">{SOURCE_LABEL[s]}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppNav() {
  // the nav renders in the parent layout route, where useParams() can't see the
  // child :source param -- read it from the path instead
  const first = useLocation().pathname.split("/")[1];
  const s = isSourceId(first) ? first : null;
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/95 backdrop-blur-md">
      {/* below md the sections get their own full-width row, so all five stay visible */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 px-4 sm:px-6">
        <div className="flex h-14 items-center">
          <Brand />
        </div>
        {s && (
          <nav
            className="order-3 -mx-1 flex w-full flex-wrap items-center gap-0.5 pb-2 md:order-none md:w-auto md:flex-1 md:flex-nowrap md:overflow-x-auto md:pb-0 md:scroll-slim"
            aria-label="Sections"
          >
            {SECTIONS.map((x) => (
              <NavLink
                key={x.key}
                to={`/${s}/${x.key}`}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition sm:px-3 sm:text-sm ${
                    isActive ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                {x.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex h-14 items-center gap-3">
          {s ? (
            <SourceSwitch source={s} />
          ) : (
            <Link
              to={paths.dashboard("synthetic")}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-slate-100"
            >
              Open dashboard →
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 text-xs text-slate-500 md:flex-row">
        <div>
          <span className="font-semibold text-ink">Independent-Cardiology Lead Engine</span> ·
          Principal AI Engineer case prototype
        </div>
        <div>
          No PHI · hospital systems are fictional · scores, cohorts and rollups are computed by
          the Python engine and rendered here
        </div>
      </div>
    </footer>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
          {it.to ? (
            <Link to={it.to} className="hover:text-ink hover:underline">
              {it.label}
            </Link>
          ) : (
            <span className="font-medium text-slate-700" aria-current="page">
              {it.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  crumbs,
  kicker,
  title,
  subtitle,
  actions,
  children,
}: {
  crumbs?: { label: string; to?: string }[];
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && (
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">{kicker}</div>
          )}
          <h1 className="font-display text-3xl leading-tight tracking-tight text-ink md:text-4xl">{title}</h1>
          {subtitle && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-600">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// scroll position per history entry. The browser's own restoration runs before React
// re-renders the (taller) previous page, so it clamps to ~0; we restore after paint.
const scrollByKey = new Map<string, number>();

export function ScrollToTop() {
  const { key } = useLocation();
  const nav = useNavigationType();
  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);
  useEffect(() => {
    const save = () => scrollByKey.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key]);
  useEffect(() => {
    const y = nav === "POP" ? scrollByKey.get(key) ?? 0 : 0; // Back/Forward restore; new pages start at top
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo?.(0, y)));
    return () => cancelAnimationFrame(id);
  }, [key, nav]);
  return null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page render failed", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="mx-auto max-w-xl px-6 py-24 text-center" role="alert">
          <h1 className="font-display text-2xl text-ink">Something went wrong on this page</h1>
          <p className="mt-2 text-sm text-slate-600">{this.state.error.message}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">
            Back to start
          </Link>
        </div>
      );
    return this.props.children;
  }
}
