// Mirrors the bundle written by engine/export_web.py (schemaVersion 3).
// Field names are camelCase; identifier keys (signal ids, timing/viability
// component ids) keep their engine spelling, e.g. contributions.career_stage.

export type SourceId = "synthetic" | "real" | "public";
export type TimingBucket = "Now" | "Near" | "Later" | "Watch";
export type Counts = Record<string, number>;

export interface ManifestSource {
  id: SourceId;
  label: string;
  description: string;
  available: boolean;
  count?: number;
  generatedAt?: string;
  fetchedAt?: string;
  stale?: boolean;
  error?: string;
  failedQueries?: number;
}

export interface Manifest {
  schemaVersion: number;
  default: SourceId;
  sources: ManifestSource[];
}

export interface RelatedRef {
  npi: number;
  why: string;
}

export interface CandidateGroup {
  group: string;
  /** eligible = qualified and on the bench; member_elsewhere = already in another cohort */
  status: "member" | "eligible" | "member_elsewhere" | "below_floor";
  /** join when the cohort has room; swap (best one-for-one) when it is full */
  mode?: "join" | "swap";
  delta: number;
  gap?: number;
}

export interface Lead {
  npi: number;
  name: string;
  metro: string;
  metroSlug: string;
  employer: string;
  systemSlug: string;
  subspecialty: string;
  propensity: number;
  timingScore: number;
  timingBucket: TimingBucket;
  rank: number;
  percentile: number;
  rankInMetro: number;
  age: number;
  yearsInPractice: number;
  tenureYears: number;
  priorIndependent: boolean;
  peerLeft: boolean;
  wrvuPercentile: number;
  openPayments: number;
  contractMonths: number;
  noncompeteMonths: number;
  disruptionEvent: string | null;
  disruptionMonthsAgo: number | null;
  independentGroupsMetro: number;
  contributions: Record<string, number>;
  timingParts: Record<string, number>;
  reasons: string[];
  group: string | null;
  candidateGroups: CandidateGroup[];
  related: { colleagues: RelatedRef[]; similar: RelatedRef[]; complements: RelatedRef[] };
  /** source-specific attribute list (Real identities mode); overrides the default fields */
  attributes?: { label: string; value: string; provenance?: "real" | "derived" | "simulated" }[];
}

export interface HistBin {
  x0: number;
  x1: number;
  count: number;
}

export interface Signal {
  key: string;
  label: string;
  weight: number;
  rationale: string;
  formula: string;
  /** what ACTUALLY produced this signal's values in this mode */
  source: string;
  /** real = computed from fetched data; derived = fixed lookup on real data; simulated = random */
  provenance: "real" | "derived" | "simulated";
  /** where it would come from in production, with connection status (null when already real) */
  productionSource: string | null;
  /** a public source exists in principle (not that one is connected) */
  public: boolean;
  activeShare: number;
  activeCount: number;
  meanContribution: number;
  moveRateActive: number | null;
  moveRateInactive: number | null;
  lift: number | null;
  auc: number;
  aucCi: [number, number];
  units: { level: "individual" | "employer" | "metro"; total: number; varying: number };
  hist: HistBin[];
  byMetro: { metro: string; slug: string; mean: number; activeShare: number }[];
  top: number[];
}

export interface Metro {
  slug: string;
  metro: string;
  city: string;
  state: string;
  lat: number | null;
  lon: number | null;
  total: number;
  qualified: number;
  grouped: number;
  bench: number;
  gapToViable: number;
  avgPropensity: number;
  topScore: number;
  readyShare: number | null;
  bestViability: number | null;
  independentGroups: number;
  groups: string[];
  systems: string[];
  timing: Counts;
  timingQualified: Counts;
  mix: Counts;
  mixQualified: Counts;
  hist: HistBin[];
}

export interface HealthSystem {
  slug: string;
  name: string;
  metro: string;
  metroSlug: string;
  total: number;
  qualified: number;
  avgPropensity: number;
  event: string;
  eventMonthsAgo: number | null;
  groups: string[];
  anchors: string[];
  timing: Counts;
  mix: Counts;
}

export interface Group {
  id: string;
  name: string;
  metro: string;
  metroSlug: string;
  metroRank: number;
  overallRank: number;
  members: number[];
  viability: number;
  components: Record<string, number>;
  anchorEmployer: string;
  anchorSlug: string;
  anchorShare: number;
  sharedTrigger: { employer: string; event: string; members: number } | null;
  avgPropensity: number;
  timing: Counts;
  mix: Counts;
  systems: Counts;
}

export interface SweepRow {
  floor: number;
  qualified: number;
  precision: number | null;
  recall: number | null;
  groups: number;
  viableMetros: number;
  grouped: number;
  withheld?: string;
}

export interface Meta {
  weights: Record<string, number>;
  reasonFloor: number;
  operatingFloor: number;
  /** smallest group an outcome aggregate may describe (disclosure control) */
  minN: number;
  timing: {
    weights: Record<string, number>;
    labels: Record<string, string>;
    sources: Record<string, { public: boolean; source: string; provenance: "real" | "simulated" }>;
    buckets: { name: TimingBucket; range: string; min: number }[];
  };
  viability: { weights: Record<string, number>; minGroup: number; maxSize: number };
  /** only subspecialties this source can tell apart */
  subspecialties: { name: string; econ: number }[];
  subspecialtiesAbsent: string[];
  metrics: {
    n: number;
    coverage: number;
    baseRate: number;
    auc: number;
    /** noise-free ceiling: the best any ranker could do on this simulated outcome */
    oracleAuc: number | null;
    /** null = withheld by disclosure control (see `withheld` for why) */
    precision: Record<string, number | null>;
    lift: Record<string, number | null>;
    liftCi: Record<string, [number, number] | null>;
    withheld: Record<string, string>;
  };
}

export interface Bundle {
  schemaVersion: number;
  source: {
    id: SourceId;
    label: string;
    description: string;
    provenance: Record<string, string>;
    count: number;
    generatedAt: string;
    seed?: number;
    api?: string;
    failedQueries?: string[];
    fetchedAt?: string;
    fromCache?: boolean;
    liveFailedQueries?: string[];
  };
  meta: Meta;
  signals: Signal[];
  metros: Metro[];
  systems: HealthSystem[];
  groups: Group[];
  sweep: SweepRow[];
  leads: Lead[];
}

// ---------------------------------------------------------------------------------
// Real data source (`public`): written by engine/real_data.py. Real CMS records only;
// the same ten signals, every value null (no real source connected), nothing scored.

export interface RealLead {
  npi: number;
  name: string;
  metro: string;
  metroSlug: string;
  subspecialty: string;
  /** Medicare provider type exactly as CMS publishes it */
  providerType: string;
  address: string;
  /** share of published Medicare services billed in office settings (basis of the inferred label) */
  officeShare: number;
  /** others in this list billing from the same address */
  sameAddress: number[];
  /** the ten signals: always null here (no real source connected) */
  values: Record<string, number | null>;
}

export interface RealMetro {
  slug: string;
  metro: string;
  city: string;
  state: string;
  lat: number | null;
  lon: number | null;
  /** all cardiologists with published Medicare services billed from this city */
  billing: number;
  /** of those, inferred hospital-based */
  total: number;
  mix: Counts;
}

export interface RealSignal {
  key: string;
  label: string;
  level: "individual" | "employer" | "metro";
  rationale: string;
  /** how the signal is defined (and simulated in Synthetic mode) */
  definition: string;
  status: "none";
  /** why it is empty here */
  missing: string;
  productionSource: string;
}

export interface RealDataBundle {
  schemaVersion: number;
  kind: "real-data";
  source: {
    id: "public";
    label: string;
    description: string;
    provenance: Record<string, string>;
    count: number;
    generatedAt: string;
    fetchedAt?: string;
  };
  universe: { year: number; threshold: number; rule: string; caveats: string[]; sources: string[]; subspecialties: string[] };
  prediction: { available: false; why: string };
  signals: RealSignal[];
  metros: RealMetro[];
  leads: RealLead[];
}
