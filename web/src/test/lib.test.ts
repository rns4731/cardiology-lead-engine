import { describe, expect, it } from "vitest";
import { aucVerdict, ordinal, pct, signed, usd } from "../lib/format";
import { isSourceId, paths, switchSourcePath } from "../lib/paths";
import { trimBins } from "../components/charts/Histogram";
import { filterLeads } from "../pages/CardiologistsPage";
import { loadBundle } from "./fixtures";

describe("format", () => {
  it("formats", () => {
    expect(pct(0.4412)).toBe("44%");
    expect(pct(null)).toBe("—");
    expect(signed(5.53)).toBe("+5.5");
    expect(signed(-0.3)).toBe("−0.3");
    expect(usd(1500)).toBe("$1.5k");
    expect(usd(25000)).toBe("$25k");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(23)).toBe("23rd");
  });
  it("auc verdicts follow the 95% interval, not fixed cutoffs", () => {
    expect(aucVerdict(0.6, [0.56, 0.64]).tone).toBe("good");
    expect(aucVerdict(0.52, [0.48, 0.56]).tone).toBe("none");
    expect(aucVerdict(0.52, [0.48, 0.56]).label).toBe("Too close to call");
    expect(aucVerdict(0.45, [0.41, 0.49]).label).toBe("Worse than chance");
  });
});

describe("paths", () => {
  it("builds query strings and drops empty values", () => {
    expect(paths.cardiologists("synthetic", { metro: "austin-tx", min: 55, q: "", group: undefined })).toBe(
      "/synthetic/cardiologists?metro=austin-tx&min=55"
    );
  });
  it("validates sources", () => {
    expect(isSourceId("synthetic")).toBe(true);
    expect(isSourceId("public")).toBe(true);
    expect(isSourceId("real")).toBe(false); // retired: real names on simulated signals
    expect(isSourceId("fake")).toBe(false);
  });
  it("keeps shared entities when switching source, falls back for source-specific ones", () => {
    expect(switchSourcePath("/synthetic/locations/austin-tx", "", "public")).toBe("/public/locations/austin-tx");
    expect(switchSourcePath("/synthetic/signals/disruption", "", "public")).toBe("/public/signals/disruption");
    expect(switchSourcePath("/synthetic/cardiologists", "?metro=austin-tx", "public")).toBe("/public/cardiologists?metro=austin-tx");
    expect(switchSourcePath("/synthetic/cardiologists/1000000378", "", "public")).toBe("/public/cardiologists");
    expect(switchSourcePath("/synthetic/groups/columbus-oh-a", "", "public")).toBe("/public/groups");
    expect(switchSourcePath("/synthetic/systems/austin-system-a", "", "public")).toBe("/public/locations");
    expect(switchSourcePath("/", "", "public")).toBe("/public/dashboard");
  });
});

describe("histogram trimming", () => {
  const bins = [0, 0, 3, 0, 5, 0, 0].map((count, i) => ({ x0: i * 10, x1: i * 10 + 10, count }));
  it("drops only empty edges", () => {
    expect(trimBins(bins).map((b) => b.x0)).toEqual([20, 30, 40]);
  });
  it("keeps the floor bin in view", () => {
    expect(trimBins(bins, 55).map((b) => b.x0)).toEqual([20, 30, 40, 50]);
  });
  it("never drops a non-empty bin", () => {
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(trimBins(bins, 5).reduce((s, b) => s + b.count, 0)).toBe(total);
  });
});

describe("directory filters", () => {
  const b = loadBundle("synthetic");
  const f = (q: string) => filterLeads(b.leads, new URLSearchParams(q));
  it("no filter returns everyone", () => expect(f("").length).toBe(b.leads.length));
  it("filters compose", () => {
    const m = b.metros[0];
    const out = f(`metro=${m.slug}&min=55`);
    expect(out.length).toBe(m.qualified);
    expect(out.every((l) => l.metroSlug === m.slug && l.propensity >= 55)).toBe(true);
  });
  it("timing accepts a comma list", () => {
    const out = f("timing=Now,Near");
    expect(out.every((l) => l.timingBucket === "Now" || l.timingBucket === "Near")).toBe(true);
    expect(out.length).toBe(f("timing=Now").length + f("timing=Near").length);
  });
  it("group in/none partition the universe", () => {
    expect(f("group=in").length + f("group=none").length).toBe(b.leads.length);
    expect(f("group=in").length).toBe(b.groups.reduce((s, g) => s + g.members.length, 0));
  });
  it("histogram bin links reproduce the bin count", () => {
    const m = b.metros[0];
    for (const bin of m.hist.filter((x) => x.count)) {
      expect(f(`metro=${m.slug}&min=${bin.x0}&max=${bin.x1}`).length).toBe(bin.count);
    }
  });
});
