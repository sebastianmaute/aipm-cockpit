// Renders the tables the compliance pack embeds between its `<!-- PACK:<name>:BEGIN -->` and
// `END` markers. Every table is derived from a registry the code already keeps honest (the AI data
// table, the CSP host lists, the deployment variables, the outbound destinations, the open-gap
// register), so the pack cannot claim more or less than the code does. Output is deterministic:
// LF only, a header row, a separator and one row per item, no trailing whitespace. Production code
// here never imports from `scripts/`; the register parse below is a small copy of its heading rule.

import { AI_DATA_PATHS, aiProtectedTextKey, type AiDataPath } from "../ai-disclosure";
import { DEPLOYMENT_VARIABLES } from "../deployment-variables";
import { t, type Lang, type TranslationKey } from "../i18n";
import { OUTBOUND_DESTINATIONS, type DestinationOperator } from "../outbound-destinations";
import { CSP_CONNECT_HOSTS, CSP_FRAME_HOSTS, type CspHostCondition } from "../../proxy";

export type PackLang = "en" | "de";

/** The `AI_DATA_PATHS` ids whose data concerns people, for the works-council annex. A hand-kept list,
 *  pinned by the tests against the table: every row people protection hides or switches off is here,
 *  plus every row whose data text names people (assignees, stakeholders, resource-directory people,
 *  e-mail senders, Timelog persons, the voice itself). Left out: committee-report, digest-narrative and
 *  digest-narrative-scheduled, whose requests carry names only where the user typed them into titles,
 *  the agenda or milestone names. */
export const PEOPLE_PATH_IDS: readonly string[] = [
  "chat", // names, e-mails with sender and recipients, resource-directory people, Timelog insights
  "inline-edit", // row with assignee and blocker-log authors, resource-directory person details
  "forecast-import", // sheet content: usually people's names, hours, rates
  "insight-recommendation", // names of up to 30 people, Timelog working time of one person
  "action-analysis", // assignees, RAID owners, stakeholder names
  "alloc-plan", // each person's name, role and hours; hidden under protection
  "raci-suggest", // stakeholder names, titles, organisations; hidden under protection
  "task-dedup", // assignee of each task
  "wbs-plan", // assignee of each task
  "weight-suggestion", // stakeholder names
  "project-proposal", // names in the brief and files; names cannot be redacted
  "dictation", // the recorded voice; switched off under protection
  "scheduled-job", // assignees, RAID owners, stakeholder names
  "insight-recommendation-auto", // as insight-recommendation, run in the background
];

const LANG: Readonly<Record<PackLang, Lang>> = { en: "en-US", de: "de" };

const OPERATOR_KEY: Readonly<Record<DestinationOperator, TranslationKey>> = {
  customer: "compliancePackOpCustomer",
  anthropic: "compliancePackOpAnthropic",
  atlassian: "compliancePackOpAtlassian",
  timelog: "compliancePackOpTimelog",
  turso: "compliancePackOpTurso",
  ecb: "compliancePackOpEcb",
  github: "compliancePackOpGithub",
  "user-chosen": "compliancePackOpUserChosen",
};

const CONDITION_KEY: Readonly<Record<CspHostCondition, TranslationKey>> = {
  always: "compliancePackCondAlways",
  "ai-direct": "compliancePackCondAiDirect",
};

/** One cell: newlines flattened, every `|` escaped, trimmed. */
function cell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...body.map(line)].join("\n");
}

/** The register's own closed test (`isClosed` in scripts/followup-claims-lib.mjs): the bare word CLOSED or a strike in the heading. */
function headingIsClosed(title: string): boolean {
  return /\bCLOSED\b/.test(title) || title.includes("~~");
}

/** `{ number -> title }` for every `## N. title` heading of the register. */
function registerTitles(src: string): Map<number, string> {
  const titles = new Map<number, string>();
  for (const line of src.split(/\r?\n/)) {
    const m = /^## (\d+)\. (.+?)\s*$/.exec(line);
    if (m) titles.set(Number(m[1]), m[2]);
  }
  return titles;
}

export function renderPackBlocks(lang: PackLang, registerSrc: string, citedGaps: readonly number[]): Record<string, string> {
  const l = LANG[lang];
  const tr = (key: TranslationKey) => t(l, key);

  const aiHeader = [tr("compliancePackColFeature"), tr("compliancePackColConsent"), tr("compliancePackColDataSent"), tr("compliancePackColProtection")];
  const aiRow = (r: AiDataPath) => [
    tr(r.labelKey),
    tr(r.level === "interactive" ? "compliancePackConsentInteractive" : "compliancePackConsentBackground"),
    tr(r.dataKey),
    tr(aiProtectedTextKey(r)),
  ];

  const titles = registerTitles(registerSrc);
  const gapRows = citedGaps.map((n) => {
    const title = titles.get(n);
    if (title === undefined) throw new Error(`open-gaps: the register has no entry ${n}`);
    if (headingIsClosed(title)) throw new Error(`open-gaps: register entry ${n} is closed`);
    return [`§${n}`, title];
  });

  const hostRows = [
    ...CSP_CONNECT_HOSTS.map((h) => [h.source, tr("compliancePackDirConnect"), tr(CONDITION_KEY[h.when])]),
    ...CSP_FRAME_HOSTS.map((h) => [h.source, tr("compliancePackDirFrame"), tr(CONDITION_KEY[h.when])]),
  ];

  return {
    "ai-paths": table(aiHeader, AI_DATA_PATHS.map(aiRow)),
    "ai-paths-people": table(aiHeader, AI_DATA_PATHS.filter((r) => PEOPLE_PATH_IDS.includes(r.id)).map(aiRow)),
    "browser-hosts": table(
      [tr("compliancePackColHost"), tr("compliancePackColDirective"), tr("compliancePackColCondition")],
      hostRows,
    ),
    "server-destinations": table(
      [tr("compliancePackColOperator"), tr("compliancePackColCaller"), tr("compliancePackColDataSent"), tr("compliancePackColWhen")],
      OUTBOUND_DESTINATIONS.map((d) => [tr(OPERATOR_KEY[d.operator]), d.caller, tr(d.sentKey), tr(d.whenKey)]),
    ),
    "deployment-switches": table(
      [
        tr("compliancePackColVariable"),
        tr("compliancePackColAlias"),
        tr("compliancePackColApplies"),
        tr("compliancePackColValues"),
        tr("compliancePackColEffect"),
      ],
      DEPLOYMENT_VARIABLES.map((v) => [
        v.name,
        v.aliases.length ? v.aliases.join(", ") : tr("compliancePackEmpty"),
        tr(v.subsystem === "server" ? "compliancePackSubServer" : "compliancePackSubDesktop"),
        v.values?.length ? v.values.join(", ") : tr("compliancePackEmpty"),
        tr(v.effectKey),
      ]),
    ),
    "open-gaps": table([tr("compliancePackColEntry"), tr("compliancePackColTitle")], gapRows),
  };
}
