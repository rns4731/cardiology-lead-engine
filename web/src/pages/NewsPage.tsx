import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Newspaper } from "lucide-react";
import { useData } from "../lib/data";
import { capitalize } from "../lib/format";
import { paths } from "../lib/paths";
import type { NewsEvent } from "../types";
import { PageHeader } from "../components/layout/AppShell";
import { Card, CardHeader, Empty, Pill, ProvenancePill, StatTile } from "../components/ui";
import { SystemLink } from "../components/links";

const KIND_LABEL: Record<string, string> = {
  report: "Event report",
  followup: "Follow-up",
  old: "Decoy: too old",
  denial: "Decoy: denial",
  routine: "Decoy: routine news",
  other_org: "Decoy: another organization",
};
const FILTERS: { key: string; label: string; kinds: string[] }[] = [
  { key: "all", label: "All", kinds: [] },
  { key: "events", label: "Event reports", kinds: ["report", "followup"] },
  { key: "decoys", label: "Decoys", kinds: ["old", "denial", "routine", "other_org"] },
];

/** Article text with each extracted quote highlighted where it appears verbatim. */
export function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const hits = quotes
    .map((q) => ({ q, i: lower.indexOf(q.toLowerCase()) }))
    .filter((h) => h.q.length >= 12 && h.i >= 0)
    .sort((a, b) => a.i - b.i);
  let at = 0;
  hits.forEach((h, k) => {
    if (h.i < at) return;
    parts.push(text.slice(at, h.i));
    parts.push(
      <mark key={k} className="rounded bg-amber-100 px-0.5 text-ink">
        {text.slice(h.i, h.i + h.q.length)}
      </mark>
    );
    at = h.i + h.q.length;
  });
  parts.push(text.slice(at));
  return <div className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{parts}</div>;
}

/** Counted events older than the 36-month window pass every check but aren't used. */
export const WINDOW_MONTHS = 36;
export function inWindow(e: NewsEvent, asof: string): boolean {
  if (!e.date) return false;
  const months = (new Date(asof).getTime() - new Date(e.date).getTime()) / (30.44 * 86400000);
  return months >= 0 && months <= WINDOW_MONTHS;
}

export function EventRow({ e, asof }: { e: NewsEvent; asof: string }) {
  const used = e.counted && inWindow(e, asof);
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{e.organization}</span>
        <Pill tone={used ? "emerald" : "slate"}>{used ? "Used" : e.counted ? "Too old to use" : "Not counted"}</Pill>
        <span className="text-slate-600">
          {capitalize(e.type.replace(/_/g, " "))} · {e.status}
          {e.date ? ` · ${e.date}` : ""}
        </span>
      </div>
      <p className="mt-1 text-slate-600">“{e.quote}”</p>
      {!e.counted && e.rejected.length > 0 && <p className="mt-1 text-xs text-slate-500">Why not: {e.rejected.join("; ")}.</p>}
      {e.counted && !used && <p className="mt-1 text-xs text-slate-500">Passed every check, but it's more than {WINDOW_MONTHS} months old.</p>}
    </li>
  );
}

export default function NewsPage() {
  const { source, bundle } = useData();
  const news = bundle.news;
  const { hash } = useLocation();
  const [filter, setFilter] = useState("all");
  const open = hash.slice(1);
  useEffect(() => {
    if (open) requestAnimationFrame(() => document.getElementById(open)?.scrollIntoView?.({ block: "start" }));
  }, [open]);
  const eventsBy = useMemo(() => {
    const m = new Map<string, NewsEvent[]>();
    news?.events.forEach((e) => (m.get(e.article) ?? m.set(e.article, []).get(e.article)!).push(e));
    return m;
  }, [news]);
  const sysSlug = useMemo(() => new Map(bundle.systems.map((s) => [s.name, s.slug])), [bundle.systems]);

  if (!news)
    return (
      <>
        <PageHeader crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "News" }]} title="Reading employer disruption from the news" />
        <Empty title="No news run for this data">
          Run <code>.venv/bin/python -m engine.news.fake</code>, then re-export.
        </Empty>
      </>
    );
  const a = news.accuracy;
  const kinds = FILTERS.find((f) => f.key === filter)!.kinds;
  const shown = news.articles.filter((x) => !kinds.length || kinds.includes(x.kind));
  const rows = news.comparison.filter((r) => r.truth || r.extracted);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(source) }, { label: "News" }]}
        kicker="News pipeline · fictional articles"
        title="Reading employer disruption from the news"
        subtitle={
          <>
            Every employer event in this mode is simulated. Claude ({news.model}) wrote a fictional local-news article about
            each one, plus decoys that should produce nothing. The same pipeline used on real news then read them back:
            Claude extracts events, and an event counts only if its quote appears word for word in the article. Employer
            disruption in this mode comes from what the pipeline read, not from the simulator.
          </>
        }
      />
      <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Newspaper size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold">Every article here is fictional,</span> written for this simulation about placeholder
          hospital systems ("{news.comparison[0]?.system}"). No real organization or person is named. Dates are relative to a
          simulated today of {news.asof}.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Events found" value={`${a.found} of ${a.withEvent}`} sub="simulated employer events" />
        <StatTile label="False alarms" value={a.falseAlarms} sub={`of ${a.systems - a.withEvent} systems with no event`} />
        <StatTile label="Right event type" value={`${a.typeCorrect} of ${a.found}`} sub="acquisition, merger, distress, layoffs" />
        <StatTile label="Date error" value={a.meanMonthsError != null ? `${a.meanMonthsError} mo` : "—"} sub="average, found events" />
        <StatTile label="Quotes not verbatim" value={a.quoteFailures} sub={`of ${a.eventsExtracted} extracted events`} />
        <StatTile label="Articles read" value={a.articles} sub={`${news.articles.filter((x) => !["report", "followup"].includes(x.kind)).length} decoys`} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        A small test: {a.withEvent} simulated events and {a.articles} articles. Perfect scores here show the pipeline works on
        clean, short articles; real news is messier (see the Real data mode's News page).
      </p>

      <Card className="mt-6">
        <CardHeader title="What the pipeline read vs. what was simulated" subtitle="Systems with a simulated event or an extracted one" />
        <div className="mt-2 overflow-x-auto scroll-slim">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2.5 pl-5 pr-4 font-semibold">System</th>
                <th className="py-2.5 pr-4 font-semibold">Simulated (hidden)</th>
                <th className="py-2.5 pr-4 font-semibold">Read from articles (used)</th>
                <th className="py-2.5 pr-5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.system} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pl-5 pr-4">
                    {sysSlug.get(r.system) ? <SystemLink slug={sysSlug.get(r.system)!} /> : r.system}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-700">{r.truth ? `${capitalize(r.truth.event)}, ${r.truth.monthsAgo} mo ago` : "None"}</td>
                  <td className="py-2.5 pr-4 text-slate-700">
                    {r.extracted ? `${capitalize(r.extracted.event)}, ${r.extracted.monthsAgo.toFixed(1)} mo ago` : "None"}
                  </td>
                  <td className="py-2.5 pr-5">
                    {r.extracted ? (
                      <a className="text-teal-700 hover:underline" href={`#${r.extracted.article}`}>
                        Article
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-3 mt-10 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-xl text-ink">The articles</h2>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="tablist" aria-label="Article filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 transition ${filter === f.key ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {shown.map((x) => {
          const evs = eventsBy.get(x.id) ?? [];
          return (
            <details key={x.id} id={x.id} open={open === x.id} className="group scroll-mt-24 rounded-2xl border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3">
                <span className="font-semibold text-ink">{x.title}</span>
                <span className="text-xs text-slate-500">
                  {x.publisher} · {x.published}
                </span>
                <span className="ml-auto flex gap-2">
                  <Pill>{KIND_LABEL[x.kind]}</Pill>
                  <Pill tone={evs.some((e) => e.counted && inWindow(e, news.asof)) ? "emerald" : "slate"}>
                    {evs.filter((e) => e.counted && inWindow(e, news.asof)).length} used
                  </Pill>
                </span>
              </summary>
              <div className="grid gap-5 border-t border-slate-100 px-5 py-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <div className="mb-2">
                    <ProvenancePill provenance="fictional" />
                  </div>
                  <Highlighted text={x.text} quotes={evs.map((e) => e.quote)} />
                </div>
                <div className="lg:col-span-2">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">What Claude extracted</div>
                  {evs.length ? (
                    <ul className="space-y-2">
                      {evs.map((e, i) => (
                        <EventRow key={i} e={e} asof={news.asof} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">No events: nothing in this article counts as employer disruption.</p>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
