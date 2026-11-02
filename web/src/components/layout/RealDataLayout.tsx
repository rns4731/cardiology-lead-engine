import { Link, Outlet, useLocation } from "react-router-dom";
import { BadgeCheck } from "lucide-react";
import { RealDataProvider, useManifest, useRealData } from "../../lib/data";
import { pct, relativeDate } from "../../lib/format";
import { paths } from "../../lib/paths";
import { ErrorState, LoadingState } from "../ui";
import { ErrorBoundary } from "./AppShell";

/** Route element for /public/* (Real data): real CMS records only, nothing scored. */
export function RealDataLayout() {
  const { pathname } = useLocation();
  const manifest = useManifest();
  if (manifest.status === "ready") {
    const entry = manifest.data.sources.find((s) => s.id === "public");
    if (!entry?.available)
      return (
        <ErrorState title="Real data isn't available">
          {entry?.error ? `${entry.error}. ` : "It hasn't been exported yet. "}Run{" "}
          <code className="rounded bg-slate-100 px-1">.venv/bin/python -m engine.export_web --source public --offline</code>, or{" "}
          <Link className="text-teal-700 underline" to={paths.dashboard("synthetic")}>
            use the synthetic data
          </Link>
          .
        </ErrorState>
      );
  }
  return (
    <RealDataProvider
      retryKey={pathname}
      loading={<LoadingState label="Loading real data…" />}
      failed={(msg, retry) => (
        <ErrorState title="Couldn't load real data">
          <p>{msg}</p>
          <div className="mt-4 flex justify-center gap-4">
            <button onClick={retry} className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white hover:bg-ink-700">
              Try again
            </button>
            <Link className="self-center text-teal-700 underline" to={paths.dashboard("synthetic")}>
              Use the synthetic data
            </Link>
          </div>
        </ErrorState>
      )}
    >
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6">
        <RealOnlyBanner />
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    </RealDataProvider>
  );
}

/** Persistent banner on every real-data page: what's real, what's inferred, what's empty. */
function RealOnlyBanner() {
  const { bundle } = useRealData();
  const u = bundle.universe;
  const filledCount = bundle.signals.filter((s) => s.status !== "none" && s.coverage > 0).length;
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      <BadgeCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
      <div>
        <span className="font-semibold">Real data only. Nothing is simulated.</span> Names, NPIs, addresses and
        subspecialties are public CMS Medicare records ({u.year}; fetched{" "}
        {relativeDate(bundle.source.fetchedAt ?? bundle.source.generatedAt)}). "Hospital-based" is{" "}
        <span className="font-semibold">inferred</span> from billing setting (at most {pct(u.threshold)} of services in an
        office). {filledCount} of the ten signals are filled from real records, each labeled by how directly it measures the
        signal; contract window stays empty.{" "}
        {bundle.prediction.available ? (
          <>
            Scores use weights fitted in a <span className="font-semibold">back-test</span> on an inferred outcome; they beat
            chance there but failed the cross-check, so treat the ranking as leads to check. No timing or cohorts.
          </>
        ) : (
          <>
            There is <span className="font-semibold">no score, ranking, timing or cohort</span>.
          </>
        )}{" "}
        A dash means unknown, not zero.
      </div>
    </div>
  );
}
