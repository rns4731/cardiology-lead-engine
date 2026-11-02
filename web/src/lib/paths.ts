import type { SourceId } from "../types";

// display order of the data-source toggles
export const SOURCES: SourceId[] = ["public", "synthetic", "real"];

export const isSourceId = (s: string | undefined): s is SourceId =>
  s === "synthetic" || s === "real" || s === "public";

export const SOURCE_LABEL: Record<SourceId, string> = {
  public: "Real data",
  synthetic: "Synthetic",
  real: "Real identities + synthetic signals",
};

/** compact labels for the header toggle on small screens */
export const SOURCE_SHORT: Record<SourceId, string> = {
  public: "Real",
  synthetic: "Synthetic",
  real: "Real IDs",
};

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const paths = {
  home: () => "/",
  dashboard: (s: SourceId) => `/${s}/dashboard`,
  locations: (s: SourceId) => `/${s}/locations`,
  location: (s: SourceId, slug: string) => `/${s}/locations/${slug}`,
  system: (s: SourceId, slug: string) => `/${s}/systems/${slug}`,
  cardiologists: (s: SourceId, q?: Query) => `/${s}/cardiologists${qs(q)}`,
  cardiologist: (s: SourceId, npi: number) => `/${s}/cardiologists/${npi}`,
  groups: (s: SourceId, q?: Query) => `/${s}/groups${qs(q)}`,
  group: (s: SourceId, id: string) => `/${s}/groups/${id}`,
  signals: (s: SourceId) => `/${s}/signals`,
  signal: (s: SourceId, key: string) => `/${s}/signals/${key}`,
  news: (s: SourceId, article?: string) => `/${s}/news${article ? `#${article}` : ""}`,
};

/**
 * Where to land when the viewer switches data source from `pathname`.
 * Locations, hospital systems, signals and every index page exist in both sources,
 * so the path is kept. Cardiologists and cohorts are source-specific (different
 * NPIs / cohort ids), so those fall back to their index page.
 */
export function switchSourcePath(pathname: string, search: string, to: SourceId): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || !isSourceId(parts[0])) return paths.dashboard(to);
  const [, section, id] = parts;
  if (!section) return paths.dashboard(to);
  if (id && (section === "cardiologists" || section === "groups")) return `/${to}/${section}`;
  // Real data has no hospital systems (employer unknown)
  if (id && section === "systems" && (parts[0] === "public" || to === "public")) return `/${to}/locations`;
  return `/${to}/${parts.slice(1).join("/")}${id ? "" : search}`;
}
