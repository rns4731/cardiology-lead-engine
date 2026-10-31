// Regression tests from the 2026-10-29 adversarial review (.claude/reviews/). Each one
// reproduces a confirmed finding and failed before its fix.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "../App";
import { availableSources, loadBundle } from "./fixtures";

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>
  );

describe("helpers", () => {
  it("F1: a score never displays above its value (54.8 must not read as 55)", async () => {
    const { scoreInt } = await import("../lib/format");
    expect(scoreInt(54.8)).toBe("54");
    expect(scoreInt(55)).toBe("55");
    expect(scoreInt(70)).toBe("70");
  });

  it("F5: first click uses the column's natural direction; third restores caller order", async () => {
    const { nextSort } = await import("../components/LeadTable");
    expect(nextSort(null, "rank", null)).toEqual({ key: "rank", dir: "asc" });
    expect(nextSort(null, "name", null)).toEqual({ key: "name", dir: "asc" });
    expect(nextSort(null, "timing", null)).toEqual({ key: "timing", dir: "asc" });
    expect(nextSort(null, "propensity", null)).toEqual({ key: "propensity", dir: "desc" });
    const twice = nextSort(nextSort(null, "rank", null), "rank", null);
    expect(twice).toEqual({ key: "rank", dir: "desc" });
    expect(nextSort(twice, "rank", null)).toBeNull();
  });

  it("F10: a malformed page param falls back to the first page", async () => {
    const { parsePage } = await import("../pages/CardiologistsPage");
    expect(parsePage("abc")).toBe(0);
    expect(parsePage("-4")).toBe(0);
    expect(parsePage(null)).toBe(0);
    expect(parsePage("3")).toBe(2);
  });

  it("F2: 'binary' means only the two end bins are occupied", async () => {
    const { isBinary } = await import("../pages/SignalPage");
    const bins = (c: number[]) => c.map((count, i) => ({ x0: i / 10, x1: (i + 1) / 10, count }));
    expect(isBinary(bins([5, 0, 0, 0, 0, 0, 0, 0, 0, 7]))).toBe(true);
    expect(isBinary(bins([0, 0, 0, 0, 0, 700, 0, 0, 0, 387]))).toBe(false);
  });

  it("M5: a signal verdict needs an interval that excludes chance", async () => {
    const { aucVerdict } = await import("../lib/format");
    expect(aucVerdict(0.559, [0.517, 0.601]).tone).toBe("good");
    expect(aucVerdict(0.531, [0.49, 0.573]).tone).toBe("none");
  });
});

for (const source of availableSources()) {
  const b = loadBundle(source);

  describe(`${source}: page regressions`, () => {
    it("F9: only subspecialties this source can measure are offered", async () => {
      mount(`/${source}/cardiologists`);
      await screen.findByRole("heading", { level: 1 });
      const opts = Array.from(screen.getByLabelText("Subspecialty").querySelectorAll("option")).map((o) => o.textContent);
      for (const a of b.meta.subspecialtiesAbsent) expect(opts).not.toContain(a);
    });

    it("M8/D1: the sensitivity table never prints a withheld cell", async () => {
      mount(`/${source}/dashboard`);
      const title = await screen.findByText("Threshold sensitivity", {}, { timeout: 10000 });
      const card = title.closest("div.rounded-2xl") as HTMLElement;
      fireEvent.click(within(card).getByRole("tab", { name: "table" }));
      for (const r of b.sweep.filter((x) => x.precision == null && x.qualified > 0)) {
        const row = within(card).getAllByRole("row").find((tr) => tr.firstElementChild?.textContent === String(r.floor))!;
        expect(row.textContent).toMatch(/withheld/i);
      }
    });

    it("AUC appears only inside the collapsed diagnostics, with its plain definition", async () => {
      const signal = b.signals[0].key;
      for (const [path, heading] of [
        [`/${source}/dashboard`, "Threshold sensitivity"],
        [`/${source}/signals`, "Reading this honestly:"],
        [`/${source}/signals/${signal}`, "Who moved, with vs. without this signal"],
      ]) {
        const { unmount } = mount(path);
        await screen.findByText(heading, {}, { timeout: 10000 });
        const main = document.querySelector("main")!.cloneNode(true) as HTMLElement;
        const details = Array.from(main.querySelectorAll("details"));
        expect(details.length, path).toBeGreaterThan(0);
        expect(details.some((d) => /coin flip/.test(d.textContent ?? "")), path).toBe(true);
        expect(details.every((d) => !d.open), path).toBe(true);
        details.forEach((d) => d.remove());
        expect(main.textContent, path).not.toMatch(/\bAUC\b/);
        unmount();
      }
    });

    it("M2: cohorts are presented as candidates, not formed groups", async () => {
      mount(`/${source}/groups`);
      expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/candidate/i);
    });
  });
}

if (availableSources().includes("real")) {
  const b = loadBundle("real");
  describe("real: honesty regressions", () => {
    it("D5: outcome figures on the signals page are labeled simulated", async () => {
      mount("/real/signals");
      await screen.findByRole("heading", { level: 1 });
      expect(document.querySelector("main")!.textContent).toMatch(/of the top 25 moved \(simulated outcome\)/);
    });

    it("D6: plain-language reasons about a real physician are labeled simulated", async () => {
      const lead = b.leads.find((l) => l.reasons.length > 0)!;
      mount(`/real/cardiologists/${lead.npi}`);
      const h = await screen.findByText("Top reasons", {}, { timeout: 10000 });
      expect(h.closest("div.rounded-2xl")!.textContent).toMatch(/Simulated/);
    });
  });
}

describe("landing: plain-language metrics", () => {
  it("leads with hit rate and baseline; AUC only inside the collapsed diagnostics", async () => {
    mount("/");
    await screen.findByText("Top-25 hit rate", {}, { timeout: 10000 });
    expect(screen.getByText("Baseline rate")).toBeTruthy();
    const main = document.querySelector("main")!.cloneNode(true) as HTMLElement;
    const details = Array.from(main.querySelectorAll("details"));
    expect(details.some((d) => /Best achievable here/.test(d.textContent ?? ""))).toBe(true);
    details.forEach((d) => d.remove());
    expect(main.textContent).not.toMatch(/\bAUC\b/);
  });
});
