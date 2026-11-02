import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bundle, Group, HealthSystem, Lead, Manifest, Metro, RealDataBundle, RealLead, RealMetro, RealSignal, Signal, SourceId } from "../types";

const BASE = import.meta.env.BASE_URL ?? "/";
/** bundle schema this app understands (engine/export_web.py SCHEMA_VERSION) */
export const EXPECTED_SCHEMA = 3;
const cache = new Map<string, Promise<unknown>>();

function getJSON<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(`${BASE}${path}`).then((r) => {
      if (!r.ok) throw new Error(`${r.status} loading ${path}`);
      return r.json();
    });
    p.catch(() => cache.delete(path)); // allow a retry after a failure
    cache.set(path, p);
  }
  return p as Promise<T>;
}

type Async<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

function useAsync<T>(path: string, check?: (data: T) => string | null): Async<T> & { retry: () => void } {
  // results are tagged with the path (and attempt) they came from, so a source switch
  // can never serve the previous source's data under the new source's URLs
  const [attempt, setAttempt] = useState(0);
  const key = `${path}#${attempt}`;
  const [state, setState] = useState<{ key: string; value: Async<T> }>({ key, value: { status: "loading" } });
  useEffect(() => {
    let live = true;
    getJSON<T>(path)
      .then((data) => {
        const problem = check?.(data);
        if (live) setState({ key, value: problem ? { status: "error", error: problem } : { status: "ready", data } });
      })
      .catch((e: Error) => live && setState({ key, value: { status: "error", error: e.message } }));
    return () => {
      live = false;
    };
  }, [key]); // `check` is a stable module-level function
  const value: Async<T> = state.key === key ? state.value : { status: "loading" };
  return { ...value, retry: () => setAttempt((a) => a + 1) };
}

const schemaCheck = (b: Bundle) =>
  b.schemaVersion === EXPECTED_SCHEMA
    ? null
    : `This data was exported for schema ${b.schemaVersion}; the app expects ${EXPECTED_SCHEMA}. Re-run: .venv/bin/python -m engine.export_web --offline`;

export const useManifest = () => useAsync<Manifest>("data/manifest.json");
export const useBundle = (source: SourceId) => useAsync<Bundle>(`data/${source}/bundle.json`, schemaCheck);

export interface Index {
  leads: Map<number, Lead>;
  groups: Map<string, Group>;
  metros: Map<string, Metro>;
  systems: Map<string, HealthSystem>;
  signals: Map<string, Signal>;
  leadsByMetro: Map<string, Lead[]>;
  leadsBySystem: Map<string, Lead[]>;
}

export function buildIndex(b: Bundle): Index {
  const leadsByMetro = new Map<string, Lead[]>();
  const leadsBySystem = new Map<string, Lead[]>();
  for (const l of b.leads) {
    // bundle leads are already sorted by propensity, so these lists are too
    (leadsByMetro.get(l.metroSlug) ?? leadsByMetro.set(l.metroSlug, []).get(l.metroSlug)!).push(l);
    (leadsBySystem.get(l.systemSlug) ?? leadsBySystem.set(l.systemSlug, []).get(l.systemSlug)!).push(l);
  }
  return {
    leads: new Map(b.leads.map((l) => [l.npi, l])),
    groups: new Map(b.groups.map((g) => [g.id, g])),
    metros: new Map(b.metros.map((m) => [m.slug, m])),
    systems: new Map(b.systems.map((s) => [s.slug, s])),
    signals: new Map(b.signals.map((s) => [s.key, s])),
    leadsByMetro,
    leadsBySystem,
  };
}

interface DataValue {
  source: SourceId;
  bundle: Bundle;
  index: Index;
  manifest: Manifest;
}

const DataCtx = createContext<DataValue | null>(null);

/** Subspecialties present in this source (absent ones are omitted, not zero). */
export function useSubspecialties(): string[] {
  return useData().bundle.meta.subspecialties.map((s) => s.name);
}

export function useData(): DataValue {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useData must be used inside <DataProvider>");
  return v;
}

export function DataProvider({
  source,
  children,
  loading,
  failed,
  retryKey,
}: {
  source: SourceId;
  children: ReactNode;
  loading: ReactNode;
  failed: (msg: string, retry: () => void) => ReactNode;
  /** when this changes (e.g. the route) while loading failed, try again automatically */
  retryKey?: string;
}) {
  const manifest = useManifest();
  const bundle = useBundle(source);
  const failedNow = manifest.status === "error" || bundle.status === "error";
  useEffect(() => {
    if (!failedNow) return;
    if (manifest.status === "error") manifest.retry();
    if (bundle.status === "error") bundle.retry();
  }, [retryKey]); // only on navigation -- not in a loop while the error persists
  // key the index on the loaded data itself -- the async wrapper is a new object each
  // render, and rebuilding a 1,200-lead index per render would defeat every memo below
  const data = bundle.status === "ready" ? bundle.data : null;
  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  if (manifest.status === "error") return <>{failed(manifest.error, manifest.retry)}</>;
  if (bundle.status === "error") return <>{failed(bundle.error, bundle.retry)}</>;
  if (manifest.status !== "ready" || bundle.status !== "ready" || !index) return <>{loading}</>;
  return (
    <DataCtx.Provider value={{ source, bundle: bundle.data, index, manifest: manifest.data }}>
      {children}
    </DataCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------
// Real data source: its own bundle shape (real records, labeled signals, back-test scores), so it
// gets its own provider instead of nullable fields threaded through every scored page.

const realCheck = (b: RealDataBundle) =>
  b.schemaVersion !== EXPECTED_SCHEMA
    ? `This data was exported for schema ${b.schemaVersion}; the app expects ${EXPECTED_SCHEMA}. Re-run: .venv/bin/python -m engine.export_web --offline`
    : b.kind !== "real-data"
      ? "The real-data bundle is an old export. Re-run: .venv/bin/python -m engine.export_web --source public --offline"
      : null;

interface RealDataValue {
  bundle: RealDataBundle;
  manifest: Manifest;
  leads: Map<number, RealLead>;
  metros: Map<string, RealMetro>;
  signals: Map<string, RealSignal>;
  leadsByMetro: Map<string, RealLead[]>;
}

const RealCtx = createContext<RealDataValue | null>(null);

export function useRealData(): RealDataValue {
  const v = useContext(RealCtx);
  if (!v) throw new Error("useRealData must be used inside <RealDataProvider>");
  return v;
}

export function RealDataProvider({
  children,
  loading,
  failed,
  retryKey,
}: {
  children: ReactNode;
  loading: ReactNode;
  failed: (msg: string, retry: () => void) => ReactNode;
  retryKey?: string;
}) {
  const manifest = useManifest();
  const bundle = useAsync<RealDataBundle>("data/public/bundle.json", realCheck);
  const failedNow = manifest.status === "error" || bundle.status === "error";
  useEffect(() => {
    if (!failedNow) return;
    if (manifest.status === "error") manifest.retry();
    if (bundle.status === "error") bundle.retry();
  }, [retryKey]);
  const data = bundle.status === "ready" ? bundle.data : null;
  const index = useMemo(() => {
    if (!data) return null;
    const leadsByMetro = new Map<string, RealLead[]>();
    for (const l of data.leads) (leadsByMetro.get(l.metroSlug) ?? leadsByMetro.set(l.metroSlug, []).get(l.metroSlug)!).push(l);
    return {
      leads: new Map(data.leads.map((l) => [l.npi, l])),
      metros: new Map(data.metros.map((m) => [m.slug, m])),
      signals: new Map(data.signals.map((s) => [s.key, s])),
      leadsByMetro,
    };
  }, [data]);
  if (manifest.status === "error") return <>{failed(manifest.error, manifest.retry)}</>;
  if (bundle.status === "error") return <>{failed(bundle.error, bundle.retry)}</>;
  if (manifest.status !== "ready" || bundle.status !== "ready" || !index) return <>{loading}</>;
  return <RealCtx.Provider value={{ bundle: bundle.data, manifest: manifest.data, ...index }}>{children}</RealCtx.Provider>;
}
