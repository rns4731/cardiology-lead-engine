import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { BadgeCheck, FlaskConical } from "lucide-react";
import { DataProvider, useData, useManifest } from "../../lib/data";
import { isSourceId, paths, SOURCE_LABEL, SOURCES, switchSourcePath } from "../../lib/paths";
import type { Manifest, SourceId } from "../../types";
import { ErrorState, LoadingState } from "../ui";
import { ErrorBoundary } from "./AppShell";

/** Route element for /:source/* (Synthetic) -- validates the source and provides its
 *  data. Real data (/public/*) has its own layout: RealDataLayout. */
export function SourceLayout() {
  const { source } = useParams();
  const { pathname } = useLocation();
  const manifest = useManifest();
  if (!isSourceId(source)) return <NotFoundBody />;
  if (manifest.status === "ready") {
    const entry = manifest.data.sources.find((s) => s.id === source);
    if (!entry?.available)
      return (
        <ErrorState title={`${entry?.label ?? source} data isn't available`}>
          {entry?.error ? `${entry.error}. ` : "It hasn't been exported yet. "}Run{" "}
          <code className="rounded bg-slate-100 px-1">.venv/bin/python -m engine.export_web</code> with
          network access, or{" "}
          <Link className="text-teal-700 underline" to={paths.dashboard("synthetic")}>
            use the synthetic data
          </Link>
          .
        </ErrorState>
      );
  }
  return (
    <DataProvider
      source={source}
      retryKey={pathname}
      loading={<LoadingState label={`Loading ${source} data…`} />}
      failed={(msg, retry) => (
        <ErrorState title="Couldn't load data">
          <p>{msg}</p>
          <div className="mt-4 flex justify-center gap-4">
            <button onClick={retry} className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white hover:bg-ink-700">
              Try again
            </button>
            <Link className="self-center text-teal-700 underline" to={paths.dashboard(source === "synthetic" ? "public" : "synthetic")}>
              Use the {source === "synthetic" ? "real" : "synthetic"} data
            </Link>
            <Link className="self-center text-teal-700 underline" to="/">
              Home
            </Link>
          </div>
        </ErrorState>
      )}
    >
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    </DataProvider>
  );
}

/** Segmented data-source toggle (dashboard). */
export function SourceToggle() {
  const { source, manifest } = useData();
  return <SourceToggleView source={source} manifest={manifest} />;
}

export function SourceToggleView({ source, manifest }: { source: SourceId; manifest: Manifest }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const icons = { synthetic: FlaskConical, public: BadgeCheck } as const;
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Data source">
      {[...manifest.sources].sort((a, b) => SOURCES.indexOf(a.id) - SOURCES.indexOf(b.id)).map((s) => {
        const Icon = icons[s.id as SourceId];
        const on = s.id === source;
        return (
          <button
            key={s.id}
            role="radio"
            aria-checked={on}
            disabled={!s.available}
            title={s.available ? s.description : "Not exported yet"}
            onClick={() => !on && navigate(switchSourcePath(pathname, search, s.id))}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? "bg-ink text-white shadow" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Icon size={15} className={on ? "text-brand-light" : "text-slate-400"} />
            <span>
              <span className="block font-semibold leading-tight">{SOURCE_LABEL[s.id]}</span>
              <span className={`block text-[11px] leading-tight ${on ? "text-slate-300" : "text-slate-400"}`}>
                {s.count != null ? `${s.count.toLocaleString()} cardiologists` : "unavailable"}
                {s.stale ? " · cached" : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NotFoundBody() {
  return (
    <ErrorState title="Page not found">
      That page doesn't exist.{" "}
      <Link className="text-teal-700 underline" to={paths.dashboard("synthetic")}>
        Go to the dashboard
      </Link>
      .
    </ErrorState>
  );
}

/** Not-found for an entity inside a valid source (e.g. an NPI from the other dataset). */
export function MissingEntity({ kind, id, back }: { kind: string; id: string; back: { label: string; to: string } }) {
  const { source } = useData();
  return (
    <ErrorState title={`No ${kind} “${id}” in the ${source} data`}>
      It may belong to the other dataset.{" "}
      <Link className="text-teal-700 underline" to={back.to}>
        {back.label}
      </Link>
    </ErrorState>
  );
}
