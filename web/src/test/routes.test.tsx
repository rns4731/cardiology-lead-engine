// Route smoke test: every page type renders for every exported data source, with
// real entity ids from the bundle -- plus the not-found paths.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "../App";
import { availableSources, loadBundle } from "./fixtures";

async function expectPage(path: string, heading: string | RegExp) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>
  );
  const h1 = await screen.findByRole("heading", { level: 1 }, { timeout: 10000 });
  expect(h1.textContent).toMatch(heading);
  expect(screen.queryByText(/Something went wrong/i)).toBeNull();
}

describe("landing", () => {
  it("renders the methodology page", () => expectPage("/", /ready to go independent/i));
  it("unknown top-level path is a not-found", () => expectPage("/nope/at/all", /Page not found/));
});

for (const source of availableSources()) {
  const b = loadBundle(source);
  const lead = b.leads[0];
  const unplaced = b.leads.find((l) => !l.group)!;
  const emerging = b.metros.find((m) => m.groups.length === 0);

  describe(`${source} data`, () => {
    const cases: [string, string | RegExp][] = [
      [`/${source}`, /Where to build the next independent group/],
      [`/${source}/dashboard`, /Where to build the next independent group/],
      [`/${source}/locations`, /^Locations$/],
      [`/${source}/locations/${b.metros[0].slug}`, b.metros[0].metro],
      [`/${source}/systems/${b.systems[0].slug}`, b.systems[0].name],
      [`/${source}/cardiologists`, /^Cardiologists$/],
      [`/${source}/cardiologists?metro=${b.metros[0].slug}&timing=Now,Near&min=55&group=none`, /^Cardiologists$/],
      [`/${source}/cardiologists/${lead.npi}`, lead.name],
      [`/${source}/cardiologists/${unplaced.npi}`, unplaced.name],
      [`/${source}/groups`, /founding cohorts/i],
      [`/${source}/signals`, /The ten signals/],
      [`/${source}/news`, /Reading employer disruption from the news/],
      [`/${source}/cardiologists/1`, /No cardiologist/],
      [`/${source}/groups/no-such-cohort`, /No cohort/],
      [`/${source}/locations/atlantis`, /No location/],
      [`/${source}/signals/astrology`, /No signal/],
      [`/${source}/not-a-section`, /Page not found/],
    ];
    if (emerging) cases.push([`/${source}/locations/${emerging.slug}`, emerging.metro]);
    for (const g of b.groups) cases.push([`/${source}/groups/${g.id}`, g.name]);
    for (const s of b.signals) cases.push([`/${source}/signals/${s.key}`, s.label]);

    it.each(cases)("%s", (path, heading) => expectPage(path, heading));
  });
}
