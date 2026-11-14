// Renders the two generated blocks the AI briefs embed: the measured-figures table and the
// team-month cost estimate. The figures come from docs/briefs/figures.json (a measured run against
// the demo project); the estimate multiplies those measured $/call by ASSUMED usage, and says so.
// Output is deterministic: LF only, no trailing whitespace. Plain strings per language, like the
// compliance pack's other generated text, so no i18n key is needed for a generated document.

import { AI_DATA_PATHS } from "../ai-disclosure";
import { t } from "../i18n";
import type { PackLang } from "./pack-blocks";

export type FigureProtection = "off" | "on" | "relay";

export interface FigurePath {
  id: string;
  protection: FigureProtection;
  protectionUnverifiedCalls: number;
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  usdPerCall: number;
  medianLatencyMs: number;
}

export interface Figures {
  schema: number;
  commit: string;
  runDate: string;
  model: string;
  data: string;
  /** Path ids absent from the "on" rows because the app hides them under people protection. */
  hiddenWhenProtected: string[];
  paths: FigurePath[];
  behaviour: {
    protectedNameHitsOn: number;
    emailHitsOn: number;
    documentedExceptionHitsOn: Record<string, number>;
    positiveControlHitsOff: number;
    inferenceGeo: Record<string, number>;
    requests: Record<string, number>;
  };
  relayKeyCheck: { runs: { path: string; coldExtraMs: number }[]; warmExtraMs: number | null };
  rates: Record<string, unknown>;
}

/** Working days per month used by the team-month estimate. */
export const WORKING_DAYS_PER_MONTH = 21;
/** Team size the estimate is quoted for. */
export const TEAM_SIZE = 5;

export type UsageBand = "light" | "typical" | "heavy";
const BANDS: readonly UsageBand[] = ["light", "typical", "heavy"];

interface UsageGroup {
  label: Readonly<Record<PackLang, string>>;
  /** Figure path ids whose mean $/call prices one call of this group. */
  paths: readonly string[];
  /** Calls per user per working day. */
  callsPerUserPerDay: Readonly<Record<UsageBand, number>>;
}

/** ASSUMPTIONS, not measurements: how often one user triggers each feature group on a working day.
 *  Chosen to be modest for a project manager; change them here and the estimate follows. */
export const USAGE_GROUPS: readonly UsageGroup[] = [
  {
    label: { en: "Chat", de: "Chat" },
    paths: ["chat"],
    callsPerUserPerDay: { light: 3, typical: 8, heavy: 20 },
  },
  {
    label: { en: "Inline edit", de: "Inline-Bearbeitung" },
    paths: ["inline-edit"],
    callsPerUserPerDay: { light: 2, typical: 5, heavy: 12 },
  },
  {
    label: { en: "Analyses and background jobs", de: "Analysen und Hintergrundjobs" },
    paths: ["action-analysis", "insight-recommend", "insight-recommend-auto", "scheduled-job", "digest-narrative", "task-dedup"],
    callsPerUserPerDay: { light: 1, typical: 3, heavy: 6 },
  },
  {
    label: { en: "Planning and documents", de: "Planung und Dokumente" },
    paths: ["committee-report", "forecast-import", "alloc-plan", "raci-suggest", "wbs-plan", "project-proposal", "weight-suggestion"],
    callsPerUserPerDay: { light: 0.2, typical: 0.5, heavy: 1 },
  },
];

/** Figure ids that differ from the AI_DATA_PATHS id of the same feature. */
const FEATURE_ALIAS: Readonly<Record<string, string>> = {
  "insight-recommend": "insight-recommendation",
  "insight-recommend-auto": "insight-recommendation-auto",
};

const TEXT = {
  en: {
    path: "Feature",
    protection: "People protection",
    calls: "n (calls)",
    usd: "$/call",
    cache: "Cache-read share",
    latency: "Median latency",
    off: "off",
    on: "on",
    relay: "relay",
    hidden: "hidden while people protection is on",
    capFigures: (commit: string, date: string, model: string) =>
      `Measured with commit ${commit} on ${date}, model ${model}, on the demo project. n is the number of measured calls per row; cache-read share = cache-read tokens / (input + cache-write + cache-read tokens).`,
    group: "Feature group",
    perDay: "calls per user per day",
    perCall: "$ per call",
    totalRow: (n: number) => `Total, team of ${n}, $ per month`,
    capEstimate: (days: number, users: number) =>
      `*Estimated*, not measured. Monthly cost = calls per user per day x ${days} working days x ${users} users x $ per call, summed over the feature groups. $ per call is the mean measured value of the group's features with people protection on (off where a feature has no protected row). The calls per user per day are assumptions.`,
    bands: { light: "light", typical: "typical", heavy: "heavy" },
    num: (n: number, digits: number) => n.toFixed(digits),
  },
  de: {
    path: "Funktion",
    protection: "Personenschutz",
    calls: "n (Aufrufe)",
    usd: "$/Aufruf",
    cache: "Cache-Lese-Anteil",
    latency: "Median-Latenz",
    off: "aus",
    on: "an",
    relay: "Relay",
    hidden: "ausgeblendet, solange der Personenschutz an ist",
    capFigures: (commit: string, date: string, model: string) =>
      `Gemessen mit Commit ${commit} am ${date}, Modell ${model}, am Demoprojekt. n ist die Zahl der gemessenen Aufrufe je Zeile; Cache-Lese-Anteil = Cache-Lese-Token / (Eingabe- + Cache-Schreib- + Cache-Lese-Token).`,
    group: "Funktionsgruppe",
    perDay: "Aufrufe je Nutzer und Tag",
    perCall: "$ je Aufruf",
    totalRow: (n: number) => `Summe, Team mit ${n} Personen, $ je Monat`,
    capEstimate: (days: number, users: number) =>
      `*Geschätzt*, nicht gemessen. Monatskosten = Aufrufe je Nutzer und Tag x ${days} Arbeitstage x ${users} Nutzer x $ je Aufruf, summiert über die Funktionsgruppen. $ je Aufruf ist der Mittelwert der gemessenen Werte der Funktionen der Gruppe bei aktivem Personenschutz (bei aus, wo eine Funktion keine geschützte Zeile hat). Die Aufrufe je Nutzer und Tag sind Annahmen.`,
    bands: { light: "leicht", typical: "typisch", heavy: "intensiv" },
    num: (n: number, digits: number) => n.toFixed(digits).replace(".", ","),
  },
} as const;

function cell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim();
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...body.map(line)].join("\n");
}

/** cacheRead / (input + cacheWrite + cacheRead), 0 when the row sent nothing. */
export function cacheReadShare(p: Pick<FigurePath, "inputTokens" | "cacheWriteTokens" | "cacheReadTokens">): number {
  const total = p.inputTokens + p.cacheWriteTokens + p.cacheReadTokens;
  return total === 0 ? 0 : p.cacheReadTokens / total;
}

function featureName(lang: PackLang, id: string): string {
  const row = AI_DATA_PATHS.find((r) => r.id === (FEATURE_ALIAS[id] ?? id));
  return row ? t(lang === "de" ? "de" : "en-US", row.labelKey) : id;
}

function groupCost(figures: Figures, group: UsageGroup): number {
  const prices = group.paths.map((id) => {
    const row = figures.paths.find((p) => p.id === id && p.protection === "on") ?? figures.paths.find((p) => p.id === id && p.protection === "off");
    return row?.usdPerCall ?? 0;
  });
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function renderFiguresTable(lang: PackLang, f: Figures): string {
  const x = TEXT[lang];
  const order: FigureProtection[] = ["off", "on", "relay"];
  const rowFor = (p: FigurePath) => [
    featureName(lang, p.id),
    x[p.protection],
    String(p.calls),
    x.num(p.usdPerCall, 4),
    `${x.num(cacheReadShare(p) * 100, 0)} %`,
    `${x.num(p.medianLatencyMs / 1000, 1)} s`,
  ];
  const hiddenRow = (id: string) => [featureName(lang, id), x.on, "-", "-", "-", x.hidden];
  const body = order.flatMap((state) => [
    ...f.paths.filter((p) => p.protection === state).map(rowFor),
    ...(state === "on" ? f.hiddenWhenProtected.map(hiddenRow) : []),
  ]);
  const header = [x.path, x.protection, x.calls, x.usd, x.cache, x.latency];
  return `${table(header, body)}\n\n${x.capFigures(f.commit.slice(0, 9), f.runDate, f.model)}`;
}

function renderTeamMonth(lang: PackLang, f: Figures): string {
  const x = TEXT[lang];
  const monthly = (g: UsageGroup, band: UsageBand) => g.callsPerUserPerDay[band] * WORKING_DAYS_PER_MONTH * TEAM_SIZE * groupCost(f, g);
  const header = [x.group, x.perCall, ...BANDS.map((b) => `${x.bands[b]} (${x.perDay})`)];
  const body = USAGE_GROUPS.map((g) => [
    g.label[lang],
    x.num(groupCost(f, g), 4),
    ...BANDS.map((b) => x.num(g.callsPerUserPerDay[b], 1)),
  ]);
  const totals = BANDS.map((b) => USAGE_GROUPS.reduce((sum, g) => sum + monthly(g, b), 0));
  const totalRow = [x.totalRow(TEAM_SIZE), "", ...totals.map((v) => `$ ${x.num(v, 2)}`)];
  return `${table(header, [...body, totalRow])}\n\n${x.capEstimate(WORKING_DAYS_PER_MONTH, TEAM_SIZE)}`;
}

export function renderFigureBlocks(lang: PackLang, figures: Figures): { figures: string; "team-month": string } {
  return { figures: renderFiguresTable(lang, figures), "team-month": renderTeamMonth(lang, figures) };
}
