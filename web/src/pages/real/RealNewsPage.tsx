import { useMemo } from "react";
import { useRealData } from "../../lib/data";
import { capitalize } from "../../lib/format";
import { paths } from "../../lib/paths";
import type { NewsEvent } from "../../types";
import { PageHeader } from "../../components/layout/AppShell";
import { Card, CardHeader, Empty, Pill, ProvenancePill, StatTile } from "../../components/ui";
import { EventRow, inWindow } from "../NewsPage";

const S = "public" as const;

export default function RealNewsPage() {
  const { bundle } = useRealData();
  const news = bundle.news;
  const articles = useMemo(() => new Map((news?.articles ?? []).map((a) => [a.id, a])), [news]);
  const entities = useMemo(() => new Map((news?.entities ?? []).map((e) => [e.id, e])), [news]);
  if (!news)
    return (
      <>
        <PageHeader crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "News" }]} title="News" />
        <Empty title="The real news pipeline hasn't been run">
          Run <code>.venv/bin/python -m engine.news.real_news</code> (network and the Claude API), then re-export.
        </Empty>
      </>
    );
  const counted = news.events.filter((e) => e.counted && inWindow(e, news.asof)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const notCounted = news.events.filter((e) => !(e.counted && inWindow(e, news.asof)));
  const reasons = new Map<string, number>();
  notCounted.forEach((e) => {
    const rs = e.counted ? ["older than 36 months"] : e.rejected.map((r) => r.replace(/status is \w+/, "rumored or denied"));
    rs.forEach((r) => reasons.set(r, (reasons.get(r) ?? 0) + 1));
  });
  const st = news.stats;

  const eventCard = (e: NewsEvent, i: number) => {
    const a = articles.get(e.article);
    const ent = entities.get(e.entityId);
    return (
      <li key={i} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{ent?.name ?? e.organization}</span>
          <span className="text-slate-600">
            · {capitalize(e.type.replace(/_/g, " "))} · {e.status} · {e.date}
          </span>
          {ent && (
            <span className="text-xs text-slate-500">
              {ent.kinds.join(" / ")} of {ent.cardiologists} listed cardiologist{ent.cardiologists === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto">
            <ProvenancePill provenance="real" />
          </span>
        </div>
        <p className="mt-1.5 text-slate-600">“{e.quote}”</p>
        {a && (
          <p className="mt-1 text-xs text-slate-500">
            {a.publisher}, {a.published}: {a.title} ·{" "}
            <a className="text-teal-700 underline" href={a.finalUrl} target="_blank" rel="noreferrer">
              source article
            </a>
            {!a.fullText && " · headline only (full text unavailable)"}
          </p>
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: paths.dashboard(S) }, { label: "News" }]}
        kicker="News pipeline · real articles"
        title="Employer disruption from the news"
        subtitle={
          <>
            For each listed cardiologist's billing group and affiliated hospitals, the pipeline searched Google News for the last
            36 months (as of {news.asof}), opened each article, and had Claude ({news.model}) extract employer events. An event
            counts only if its quote appears word for word in the article, it's about one of those organizations, it's reported
            as fact (not rumored or denied), and it's an acquisition, merger, financial distress, layoffs, bankruptcy or closure.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Organizations searched" value={st.entities} sub="billing groups + hospitals" />
        <StatTile label="Headlines found" value={st.headlines} sub="distinct, last 36 months" />
        <StatTile label="Read in full" value={st.fullText} sub={`${st.headlineOnly} headline only (paywall/blocked)`} />
        <StatTile label="Events extracted" value={st.eventsExtracted} sub="by Claude" />
        <StatTile label="Quote verified" value={st.verified} sub="word for word in the article" />
        <StatTile label="Used" value={counted.length} sub="passed every check, last 36 months" />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Article text is read but never stored in the app: only the headline, link and Claude's short quote. Nobody has
        hand-checked these events; read the source before acting on any of them.
      </p>

      <Card className="mt-6">
        <CardHeader title={`Events used (${counted.length})`} subtitle="Newest first. These set the employer-disruption values." />
        {counted.length ? (
          <ul className="mt-3 space-y-3 px-5 pb-5">{counted.map(eventCard)}</ul>
        ) : (
          <p className="px-5 pb-5 pt-3 text-sm text-slate-500">No event passed every check.</p>
        )}
      </Card>

      <details className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-[15px] font-semibold text-ink">
          Not used ({notCounted.length}){" "}
          <span className="text-sm font-normal text-slate-500">
            {[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, n]) => `${n} ${r}`).join(" · ")}
          </span>
        </summary>
        <ul className="space-y-2 px-5 pb-5">
          {notCounted.map((e, i) => (
            <EventRow key={i} e={e} asof={news.asof} />
          ))}
        </ul>
      </details>

      <details className="mt-4 rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-[15px] font-semibold text-ink">
          Every article read ({news.articles.length})
        </summary>
        <ul className="divide-y divide-slate-100 px-5 pb-4">
          {[...news.articles]
            .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
            .map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <a className="font-medium text-ink hover:underline" href={a.finalUrl} target="_blank" rel="noreferrer">
                  {a.title}
                </a>
                <span className="text-xs text-slate-500">
                  {a.publisher} · {a.published}
                </span>
                {!a.fullText && <Pill>headline only</Pill>}
              </li>
            ))}
        </ul>
      </details>
    </>
  );
}
