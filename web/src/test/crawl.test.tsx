// Drill-down integrity: follow every internal link outward from the dashboard and
// assert each target renders a real page -- no not-found, no error boundary, no
// dead end. Bounded so it stays fast; one page per (route pattern) is enough to
// prove the route works, since referential integrity of ids is enforced by
// engine/bundle_check.py.
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "../App";
import { availableSources } from "./fixtures";

const pattern = (href: string) =>
  href
    .split("?")[0]
    .replace(/\/cardiologists\/\d+/, "/cardiologists/:npi")
    .replace(/\/(locations|systems|groups|signals)\/[^/]+/, "/$1/:id");

for (const source of availableSources()) {
  it(`every link reachable from /${source}/dashboard resolves`, async () => {
    const queue = [`/${source}/dashboard`];
    const seen = new Set<string>();
    const visited: string[] = [];
    const MAX_PER_PATTERN = 3;
    const perPattern = new Map<string, number>();

    while (queue.length) {
      const path = queue.shift()!;
      render(
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          <AppRoutes />
        </MemoryRouter>
      );
      const h1 = await screen.findByRole("heading", { level: 1 }, { timeout: 10000 });
      expect(h1.textContent, `dead end at ${path}`).not.toMatch(/not found|No (cardiologist|cohort|location|signal|hospital system)|Couldn't load/i);
      expect(screen.queryByText(/Something went wrong/i), `render error at ${path}`).toBeNull();
      visited.push(path);

      const hrefs = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href")!)
        .filter((h) => h.startsWith(`/${source}/`));
      cleanup();
      for (const h of hrefs) {
        if (seen.has(h)) continue;
        seen.add(h);
        const p = pattern(h);
        const n = perPattern.get(p) ?? 0;
        if (n >= MAX_PER_PATTERN) continue;
        perPattern.set(p, n + 1);
        queue.push(h);
      }
    }
    // every page type must have been reached by following links alone
    const reached = new Set(visited.map(pattern));
    for (const p of ["dashboard", "locations", "locations/:id", "systems/:id", "cardiologists", "cardiologists/:npi", "groups", "groups/:id", "signals", "signals/:id"]) {
      expect(reached.has(`/${source}/${p}`), `never reached /${source}/${p} by following links`).toBe(true);
    }
  }, 180000);
}
