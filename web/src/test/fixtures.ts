import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Bundle, Manifest, SourceId } from "../types";

const DATA = resolve(process.cwd(), "public", "data") + "/";

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(DATA + "manifest.json", "utf8"));
}

/** Scored sources that were actually exported (real needs network at export time). The
 *  Real data bundle (kind "real-data") has no scores and its own pages, so it's excluded. */
export function availableSources(): SourceId[] {
  return loadManifest()
    .sources.filter((s) => s.available && existsSync(`${DATA}${s.id}/bundle.json`))
    .filter((s) => JSON.parse(readFileSync(`${DATA}${s.id}/bundle.json`, "utf8")).kind !== "real-data")
    .map((s) => s.id);
}

const cache = new Map<SourceId, Bundle>();
export function loadBundle(s: SourceId): Bundle {
  if (!cache.has(s)) cache.set(s, JSON.parse(readFileSync(`${DATA}${s}/bundle.json`, "utf8")));
  return cache.get(s)!;
}
