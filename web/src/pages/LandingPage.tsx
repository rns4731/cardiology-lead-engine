import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Eye,
  FlaskConical,
  Layers,
  MapPinned,
  Minus,
  Radar,
  Sparkles,
  Target,
  Users,
  UsersRound,
} from "lucide-react";
import { DataProvider, useData } from "../lib/data";
import { aucVerdict, pct } from "../lib/format";
import { ModelDiagnostics } from "../components/Diagnostics";
import { SEQ, SEQ_TRACK, TIMING_COLORS } from "../lib/palette";
import { paths } from "../lib/paths";
import { Card, ErrorState, LoadingState, Meter, Pill } from "../components/ui";

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  dark = false,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-16 px-6 py-20 md:py-24 ${dark ? "bg-ink text-white" : ""}`}>
      <div className="mx-auto max-w-6xl">
        <div className={`mb-3 text-xs font-semibold uppercase tracking-[0.18em] ${dark ? "text-brand-light" : "text-teal-700"}`}>{eyebrow}</div>
        <h2 className={`font-display text-3xl leading-[1.1] tracking-tight md:text-[2.6rem] ${dark ? "text-white" : "text-ink"}`}>{title}</h2>
        {lead && <p className={`mt-4 max-w-3xl text-base leading-relaxed md:text-lg ${dark ? "text-slate-300" : "text-slate-600"}`}>{lead}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <DataProvider
      source="synthetic"
      loading={<LoadingState />}
      failed={(m) => <ErrorState title="Couldn't load data">{m}</ErrorState>}
    >
      <Hero />
      <Problem />
      <Model />
      <Validation />
      <Explore />
    </DataProvider>
  );
}

function Hero() {
  const { bundle } = useData();
  const m = bundle.meta.metrics;
  const stats = [
    { v: m.n.toLocaleString(), l: "Cardiologists scored" },
    { v: `${m.lift["25"]}×`, l: "Better than random outreach" },
    { v: String(bundle.signals.length), l: "Explainable signals" },
    { v: String(bundle.groups.length), l: "Candidate founding cohorts" },
  ];
  return (
    <div className="relative overflow-hidden bg-ink text-white">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/30 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 top-20 h-[28rem] w-[28rem] rounded-full bg-accent/20 blur-[120px]" />
      <div className="dotgrid absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
          <Sparkles size={13} className="text-brand-light" /> Growth intelligence for a physician platform
        </div>
        <h1 className="fade-up max-w-4xl font-display text-[2.6rem] leading-[1.05] tracking-tight md:text-6xl">
          Find the cardiologists ready to go <span className="gradient-text">independent</span> — and the groups they could form.
        </h1>
        <p className="fade-up mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
          Hospital-employed cardiologists are the largest, hardest-to-reach market for an independent-practice platform. This engine
          identifies who is likely to move, <em>when</em> their window opens, and how they cluster into candidate founding groups of
          five or more — with every score explained.
        </p>
        <div className="fade-up mt-10 flex flex-wrap gap-3">
          <Link to={paths.dashboard("synthetic")} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-slate-100">
            Open the dashboard <ArrowRight size={16} />
          </Link>
          <a href="#problem" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
            How it works <ArrowDown size={16} />
          </a>
        </div>
        <div className="mt-16 grid max-w-3xl grid-cols-2 gap-8 border-t border-white/10 pt-10 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.l}>
              <div className="text-3xl font-semibold tracking-tight md:text-4xl">{s.v}</div>
              <div className="mt-1 text-sm text-slate-400">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const STAGES = [
  { n: "01", title: "Identify", sub: "who & when", body: "Surface hospital-employed cardiologists likely to move, and time the window.", focus: true },
  { n: "02", title: "Verify", sub: "contact", body: "Find and confirm reliable contact information." },
  { n: "03", title: "Qualify", sub: "real interest", body: "Gauge genuine intent before investing in a relationship." },
  { n: "04", title: "Assemble", sub: "groups of 5+", body: "Cluster interested physicians into a viable new group.", focus: true },
];
const BUILT = [
  "Propensity + timing scoring for every hospital-employed cardiologist",
  "A plain-language rationale behind every lead",
  "Candidate cohorts: disjoint founding slates of 5–8 per metro, with who would strengthen each",
  "An evaluation harness: hit rates with uncertainty ranges, a best-achievable benchmark, and small-number suppression",
  "A real-identity mode on public NPI-registry data",
];
const DEFERRED = [
  ["Contact find & verify", "A mature enrichment-vendor problem — integrate, don't rebuild."],
  ["Outreach & interest-gauging", "Needs conversation data that doesn't exist yet; risks feeling like spam."],
  ["Learned weights", "Wait for real outcomes; fitting to a simulated label would be circular."],
];

function Problem() {
  return (
    <Section
      id="problem"
      eyebrow="The problem"
      title="A growth funnel that starts with the hardest stage"
      lead="Leads arrive almost entirely inbound today. Each stage of the funnel filters the last, and the first gates everything: you can't verify, qualify, or assemble people you never identified. So the build focuses on identifying (and timing) and on assembling — the two ends that turn a list into a group."
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-stretch md:gap-2">
        {STAGES.map((s, i) => (
          <div key={s.n} className="flex flex-col gap-4 md:flex-1 md:flex-row md:items-center md:gap-2">
            <Card className={`relative h-full flex-1 p-5 ${s.focus ? "ring-2 ring-teal-600" : ""}`}>
              {s.focus && (
                <div className="absolute -top-3 left-5">
                  <Pill tone="teal">
                    <Target size={12} /> Built
                  </Pill>
                </div>
              )}
              <div className="text-sm text-slate-400">{s.n}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold text-ink">{s.title}</span>
                <span className="text-sm text-slate-400">{s.sub}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </Card>
            {i < STAGES.length - 1 && <ChevronRight className="hidden shrink-0 text-slate-300 md:block" />}
          </div>
        ))}
      </div>
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Check size={14} strokeWidth={3} />
            </span>
            What we built
          </h3>
          <ul className="mt-4 space-y-3">
            {BUILT.map((b) => (
              <li key={b} className="flex gap-3 text-sm text-slate-700">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                {b}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-slate-600">
              <Minus size={14} strokeWidth={3} />
            </span>
            Deliberately deferred
          </h3>
          <ul className="mt-4 space-y-3.5">
            {DEFERRED.map(([t, d]) => (
              <li key={t} className="text-sm">
                <div className="font-medium text-ink">{t}</div>
                <div className="text-slate-500">{d}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

function Model() {
  const { bundle } = useData();
  const max = Math.max(...bundle.signals.map((s) => s.weight));
  const t = bundle.meta.timing;
  return (
    <Section
      id="model"
      eyebrow="The model"
      title="Explainable by design, not a black box"
      lead="The growth team has to trust every lead before they spend a relationship on it. So propensity is a transparent weighted sum of ten signals; each score decomposes into exactly the points that produced it. Weights are domain-reasoned — a learned model is a deliberate 'later', once real outreach outcomes exist."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <div className="mb-5 flex items-center gap-2">
            <Eye size={18} className="text-teal-600" />
            <h3 className="font-semibold text-ink">Ten signals, weights sum to 100</h3>
            <span className="ml-auto text-xs text-slate-400">click any signal</span>
          </div>
          <div className="space-y-4">
            {bundle.signals.map((s) => (
              <Link key={s.key} to={paths.signal("synthetic", s.key)} className="group block">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium text-ink group-hover:underline decoration-teal-500/60 underline-offset-2">{s.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-500">{s.weight}</span>
                </div>
                <div className="mt-1.5">
                  <Meter value={s.weight} max={max} color={SEQ} track={SEQ_TRACK} height={7} />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{s.rationale}</p>
              </Link>
            ))}
          </div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="mb-2 flex items-center gap-2">
              <Clock size={18} className="text-rose-700" />
              <h3 className="font-semibold text-ink">Timing is a first-class output</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              <em>Who</em> is table stakes; <em>when</em> is what makes outreach land. A separate readiness score places each
              cardiologist in a window.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {t.buckets.map((b) => (
                <Link key={b.name} to={paths.cardiologists("synthetic", { timing: b.name })} className="rounded-xl border border-slate-200 p-3 transition hover:border-teal-300">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIMING_COLORS[b.name] }} />
                    <span className="text-sm font-semibold text-ink">{b.name}</span>
                  </div>
                  <div className="mt-0.5 pl-[18px] text-xs text-slate-500">
                    {b.range} · score ≥ {b.min}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-5 space-y-1 rounded-xl bg-slate-50 p-4 text-xs text-slate-600">
              <div className="mb-1 font-semibold text-slate-700">Readiness score (0–100) — inputs and where they'd come from in production</div>
              {Object.entries(t.weights).map(([k, w]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>
                    {t.labels[k]}
                    {!t.sources[k]?.public && <span className="ml-1 text-amber-700">· relationship data</span>}
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{w}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              In this synthetic universe all four inputs are simulated. Contract and non-compete dates only come from
              relationships: on public data alone readiness tops out at{" "}
              {Object.entries(t.weights).reduce((acc, [k, w]) => acc + (t.sources[k]?.public ? w : 0), 0)}, below "Now". The month
              ranges are rule-based estimates of when to call — the simulated outcome has no timing, so a pilot should measure
              time-to-first-meeting.
            </p>
          </Card>
          <Card className="p-6">
            <div className="mb-2 flex items-center gap-2">
              <Layers size={18} className="text-teal-600" />
              <h3 className="font-semibold text-ink">Cohort viability</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              Geography is a hard constraint, but five people in a city isn't a group. Cohorts are built greedily to maximize:
            </p>
            <div className="mt-4 space-y-2">
              {Object.entries(bundle.meta.viability.weights).map(([k, w]) => (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-slate-700">
                    {{ avg_propensity: "Average propensity", size: "Cohort size", diversity: "Subspecialty diversity", timing: "Timing readiness" }[k] ?? k}
                  </span>
                  <Meter value={w} max={0.4} color={SEQ} track={SEQ_TRACK} height={6} />
                  <span className="w-9 text-right font-semibold tabular-nums text-ink">{Math.round(w * 100)}%</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

function Validation() {
  const { bundle } = useData();
  const m = bundle.meta.metrics;
  const lift25 = m.liftCi["25"];
  const hits25 = Math.round((m.precision["25"] ?? 0) * 25);
  const qualRate = bundle.sweep.find((r) => r.floor === bundle.meta.operatingFloor)?.precision ?? null;
  const size = bundle.meta.viability.maxSize;
  const verdicts = bundle.signals.map((s) => ({ s, v: aucVerdict(s.auc, s.aucCi) }));
  const clear = verdicts.filter((x) => x.v.tone === "good");
  const unclear = verdicts.filter((x) => x.v.tone !== "good");
  const disruption = bundle.signals.find((s) => s.key === "disruption");
  const tiles = [
    { v: pct(m.precision["25"]), l: "Top-25 hit rate", s: `${hits25} of the 25 highest-scored moved` },
    { v: `${m.lift["25"]}×`, l: "Lift vs. baseline", s: lift25 ? `likely ${lift25[0].toFixed(1)}–${lift25[1].toFixed(1)}× · one simulated draw` : "vs. untargeted outreach" },
    { v: pct(m.baseRate), l: "Baseline rate", s: "share of everyone who moved: what random outreach would hit" },
    { v: pct(m.precision["100"]), l: "Top-100 hit rate", s: `${m.lift["100"]}× the baseline` },
  ];
  return (
    <Section
      id="validation"
      dark
      eyebrow="Validation"
      title="What the validation proves — and what it can't"
      lead="The synthetic universe hides an outcome the scorer never sees: who goes independent within 24 months. But that outcome is generated from the same ten hypotheses the scorer encodes. So these numbers test the pipeline and the evaluation harness — not whether the hypotheses are true. Only real outcomes, measured against a random holdout, can do that."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.l} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="text-4xl font-semibold tracking-tight">{t.v}</div>
            <div className="mt-1 text-sm font-medium text-slate-200">{t.l}</div>
            <div className="mt-0.5 text-xs text-slate-400">{t.s}</div>
          </div>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical size={18} className="text-brand-light" />
            <h3 className="font-semibold">A sound pipeline, untested hypotheses</h3>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            Because the scorer and the simulated outcome share their assumptions, agreement can't prove the assumptions. It does
            prove the machinery: the scorer ranks nearly as well as a ranker that knows every cardiologist's true simulated
            odds (numbers under Model diagnostics). In a pilot, hold out a random slice of
            leads the team doesn't prioritize and compare meeting rates — that's the first real test of the weights.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-3 flex items-center gap-2">
            <Radar size={18} className="text-accent-light" />
            <h3 className="font-semibold">Single signals: mostly too close to call at this size</h3>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            {clear.length} of {bundle.signals.length} signals predict better than chance on their own; {unclear.length} are too
            close to call with {m.n.toLocaleString()} cardiologists. Too close to call isn't "no effect"
            {disruption && disruption.units.level === "employer" && (
              <> — employer disruption, for one, rests on {disruption.units.varying} of {disruption.units.total} employers</>
            )}
            . Measure these in the pilot; don't reweight on one draw.
          </p>
          <ul className="mt-3 space-y-1.5">
            {unclear.slice(0, 4).map(({ s }) => (
              <li key={s.key}>
                <Link to={paths.signal("synthetic", s.key)} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm hover:bg-white/10">
                  <span>{s.label}</span>
                  <span className="tabular-nums text-xs text-slate-300">
                    {s.moveRateActive != null && s.moveRateInactive != null
                      ? `${pct(s.moveRateActive)} vs ${pct(s.moveRateInactive)} moved`
                      : "too few to compare"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-3 flex items-center gap-2">
            <UsersRound size={18} className="text-brand-light" />
            <h3 className="font-semibold">Cohorts are slates, not groups</h3>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            {qualRate != null ? (
              <>
                In simulation, qualified cardiologists go independent at {pct(qualRate)}. A {size}-person cohort therefore yields
                about {(size * qualRate).toFixed(1)} founders — landing five means approaching roughly {Math.ceil(5 / qualRate)}{" "}
                qualified candidates. That's why every cohort page ranks who could strengthen it.
              </>
            ) : (
              "Only part of any cohort would actually move, so every cohort page ranks who could strengthen it."
            )}
          </p>
        </div>
      </div>
      <ModelDiagnostics dark className="mt-6" />
    </Section>
  );
}

function Explore() {
  const { bundle } = useData();
  const cards = [
    { icon: MapPinned, t: "Locations", d: `${bundle.metros.length} metros on a map, ranked by readiness`, to: paths.locations("synthetic") },
    { icon: UsersRound, t: "Cohorts", d: `${bundle.groups.length} candidate founding cohorts with their viability breakdown`, to: paths.groups("synthetic") },
    { icon: Users, t: "Cardiologists", d: `${bundle.leads.length.toLocaleString()} profiles, each with related peers and candidate groups`, to: paths.cardiologists("synthetic") },
    { icon: Radar, t: "Signals", d: "How each of the ten is computed, sourced, and validated", to: paths.signals("synthetic") },
  ];
  return (
    <Section id="explore" eyebrow="Explore" title="Everything drills down" lead="Start anywhere. Every location, cohort, cardiologist, hospital system and signal has its own page, and every number links to the people behind it. Switch between synthetic data and real public NPI identities from the dashboard.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ icon: Icon, t, d, to }) => (
          <Link key={t} to={to} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-teal-300 hover:shadow-md">
            <Icon size={20} className="text-teal-600" />
            <div className="mt-3 font-semibold text-ink group-hover:underline decoration-teal-500/60 underline-offset-2">{t}</div>
            <p className="mt-1 text-sm text-slate-500">{d}</p>
          </Link>
        ))}
      </div>
      <div className="mt-10 text-center">
        <Link to={paths.dashboard("synthetic")} className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-ink-700">
          Open the dashboard <ArrowRight size={16} />
        </Link>
      </div>
    </Section>
  );
}
