---
name: add-page
description: Add a new page or drill-down entity to the React app following its conventions — engine-side data in the bundle, typed contract, route under /:source, path builder, entity link component, breadcrumbs, not-found handling, charts with table twins, and route/crawl tests. Use when adding a page, a new entity type, or a new drill-down from an existing page.
argument-hint: "<entity or page name>"
---

# Add a page / entity

Everything in this app is drill-downable because of four conventions. Follow all four.

1. **Data comes from the engine.** If the page needs a number that isn't in the bundle,
   compute it in `engine/insights.py` (pure function over the scored frame), add it in
   `engine/export_web.build_bundle`, add a validation rule in `engine/bundle_check.py`, bump
   `SCHEMA_VERSION`, mirror it in `web/src/types.ts`, then `/export-data`. Simple counting
   and filtering in the browser is fine; formulas are not.
2. **URLs only via `web/src/lib/paths.ts`.** Add a builder; keep the source in the path.
   If the entity exists in both sources (same id), make sure `switchSourcePath` keeps it;
   if ids are source-specific, it must fall back to the index.
3. **Names only via `web/src/components/links.tsx`.** Add a `<XLink>` so every mention of
   the entity anywhere becomes a link. Add an index lookup in `lib/data.tsx::buildIndex`.
4. **Filters live in the URL** (`CardiologistsPage` pattern) so any chart mark can deep-link
   into a filtered list via `paths.cardiologists(source, {...})`.

## Page skeleton
```tsx
export default function XPage() {
  const { id = "" } = useParams();
  const { source, bundle, index } = useData();
  const x = index.xs.get(id);
  // hooks above this line; early returns below
  if (!x) return <MissingEntity kind="x" id={id} back={{ label: "See all", to: paths.xs(source) }} />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: x.name }]}
                  kicker="X" title={x.name} subtitle="one sentence: what this is and why it matters" />
      {/* KPI tiles that link deeper, then ChartFrame(s) with table twins, then a LeadTable */}
    </>
  );
}
```
Register the route in `web/src/App.tsx` under `:source`. Use `/design-system` for layout
and chart rules.

## Tests (required)
- `web/src/test/routes.test.tsx`: add the page with a real id from each available source
  and a not-found case.
- `web/src/test/crawl.test.tsx`: add the route pattern to the "must be reached by following
  links" list — if the crawler can't reach it from the dashboard, it isn't drill-downable.
- Run `/run-tests`, then screenshot it (`node web/scripts/screenshots.mjs` — add it to the
  page list) and look at it.
