/**
 * generate-sample-workspace.ts
 *
 * Source of truth: the hand-curated `sample-workspace-small.md` (human-editable
 * master; it carries the full budget detail incl. blended discipline allocations).
 * This script parses it, enriches it with a demo change-log + RAID→stakeholder
 * links, and emits the two COMPLETE, faithfully-round-tripping formats:
 *   sample-workspace-small.json    — complete workspace (all entities + enrichment)
 *   sample-workspace-small.sqlite3 — Turso-importable; schema v12 (multi-tenant; one
 *                              `projects` row + project_id on every table);
 *                              built via node:sqlite.
 *                              MUST be WAL journal mode — `turso db create
 *                              --from-file` requires it. We set PRAGMA
 *                              journal_mode=WAL, checkpoint(TRUNCATE) all frames
 *                              back into the single file, and delete the
 *                              transient -wal/-shm sidecars so the committed
 *                              artifact is one self-contained WAL-mode file.
 *
 * It deliberately does NOT overwrite sample-workspace-small.md / .csv:
 * workspaceToMarkdown does not `\|`-escape the pipe-delimited blended-budget cell,
 * so re-emitting the MD would corrupt the blended bucket on re-parse. Those two
 * stay hand-curated; JSON + sqlite3 are the generated complete exports (and the
 * place the demo change-log lives).
 *
 * It additionally emits SCALED demo datasets from the enriched small workspace via
 * the pure `scaleWorkspace(ws, factor)` helper (replicates content entities with a
 * per-replica id offset + full FK remap; reference data/singletons kept once):
 *   sample-workspace-big.json  / .sqlite3 — 3× the small content entities
 *   sample-workspace-huge.json / .sqlite3 — 10× the small content entities
 * (only json + sqlite3 for the scaled variants — no curated md/csv.)
 *
 * Run with:
 *   npx vite-node scripts/generate-sample-workspace.ts
 * Verify round-trips + sqlite integrity:
 *   VERIFY=1 npx vite-node scripts/generate-sample-workspace.ts
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  markdownToWorkspace,
  workspaceToJson,
  jsonToWorkspace,
} from "../src/app/storage";
import { TABLE_NAMES } from "../src/app/turso-schema";
import { tenantWorkspaceToStatements, upsertProjectStatement, PROJECTS_TABLE } from "../src/app/turso-tenant-schema";
import { scaleWorkspace } from "../src/app/scale-workspace";
import { materializeRoleRates } from "../src/app/role-rates";
import { nextNoteId } from "../src/app/note-log";
import type { Workspace } from "../src/app/workspace";
import type { ChangeItem, RaidItem, ProjectMeta, ProjectStatus, SteeringCommittee, Task, NoteLogEntry } from "../src/app/types";

/** Sample workday hours (matches defaultSettings.resources.workdayHours). */
const SAMPLE_WORKDAY_HOURS = 8;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Step 1: Parse the canonical source
// ---------------------------------------------------------------------------
const mdSource = readFileSync(join(ROOT, "sample-workspace-small.md"), "utf8");
const ws = markdownToWorkspace(mdSource);

// Verify we got a sensible parse before enriching
if (!ws.tasks.length || !ws.raid.length) {
  throw new Error("markdownToWorkspace returned empty workspace — check source file.");
}

// ---------------------------------------------------------------------------
// Step 2: Enrich with changes + stakeholderIds
//
// Stakeholders in the workspace (from the md):
//   1 = Elena Fischer   (Sponsor,   High influence / High interest)
//   2 = Sam Placeholder    (Internal,  High influence / Medium interest)
//   3 = Taylor Specimen      (Internal,  Medium influence / High interest)
//   4 = David Okoro     (Customer,  Medium influence / Medium interest)
//   5 = Morgan Standin  (Regulator, High influence / Low interest)
//   6 = Lena Vogt       (Vendor,    Low influence / Low interest)
//   7 = Sam Rivera      (Other,     Low influence / High interest)
//
// RAID items chosen for stakeholderIds:
//   RAID #2 (R, Open)  — "SSO provider outage during peak hours"
//     → sponsor (1) + vendor (6) — the sponsor cares about SLA risk;
//       the vendor (SSO provider) is directly implicated.
//   RAID #11 (D, Open) — "Compliance team sign-off for production"
//     → regulator (5) + sponsor (1) — compliance gate blocks go-live; both need visibility.
//   RAID #13 (D, Open) — "DBA schema approval for migration tables"
//     → regulator (5) — DBA approval is a compliance/governance step.
//
// Changes:
//   #1 — "Add MFA to SSO scope" (Scope, Under Review)
//     Linked to task 2 (POC OIDC integration) + RAID 4 (CVE dependency).
//     Stakeholders: sponsor (1) + regulator (5) — scope change needs sign-off from both.
//   #2 — "Extend go-live by two weeks" (Schedule, Proposed)
//     No linked task (proposal stage). Linked to RAID 2 (SSO provider outage risk).
//     Stakeholders: sponsor (1) + customer (4) — they own the go-live commitment.
// ---------------------------------------------------------------------------

// Enrich RAID items with stakeholderIds (immutable: map returns new objects)
const enrichedRaid: RaidItem[] = ws.raid.map((item) => {
  if (item.id === 2)  return { ...item, stakeholderIds: [1, 6] };
  if (item.id === 11) return { ...item, stakeholderIds: [1, 5] };
  if (item.id === 13) return { ...item, stakeholderIds: [5] };
  return item;
});

// ---------------------------------------------------------------------------
// Step 2a: Rich-text migration + demo note logs.
//
// The curated .md carries each task's free text in the (renamed) Description
// column. The persisted model now stores rich HTML: the running dated log lives
// in `noteLog`, and `description` is reserved for a rich free-text body. Fold
// every task's plain Description into a single sanitized noteLog entry and clear
// description — this exercises the rich-text storage path in every emitted
// format. Deterministic (no clock): the entry timestamp derives from the task's
// own lastUpdateDate; the entry id is minted with the shared nextNoteId helper.
//
// A handful of DEMO authored notes are then appended to a couple of tasks and a
// couple of RAID items so the note-log surface renders attributed, multi-entry
// content. Authors reference real resource ids (1 Alex Example, 2 Sam Placeholder,
// 4 Morgan Standin); timestamps are fixed literal ISO strings.
// ---------------------------------------------------------------------------

/** Minimal &/</> escape for wrapping folded plain text in a synthetic <p>. */
const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A single escaped `<p>…</p>` is already within the note allow-list, so it is
// byte-identical to sanitizeNoteHtml(...) — and this build script runs under
// node (no DOM), where DOMPurify has no window. Build the html inline; the app's
// load path re-sanitizes on read.
const noteHtml = (text: string): string => `<p>${escHtml(text)}</p>`;

type DemoNote = { authorResourceId: number; authorName: string; timestamp: string; text: string };

/** Append a demo authored note to a log, minting a unique id + sanitizing html. */
function appendDemoNotes(log: NoteLogEntry[] | undefined, notes: readonly DemoNote[]): NoteLogEntry[] {
  let out: NoteLogEntry[] = [...(log ?? [])];
  for (const n of notes) {
    // Key order MUST mirror sanitizeNoteLog's output ({id, timestamp, html,
    // text, authorResourceId, authorName}) so the JSON pass-through and the
    // MD/CSV decode paths produce byte-identical cells (golden fixed point).
    out = [
      ...out,
      {
        id: nextNoteId(out),
        timestamp: n.timestamp,
        html: noteHtml(n.text),
        text: n.text,
        authorResourceId: n.authorResourceId,
        authorName: n.authorName,
      },
    ];
  }
  return out;
}

const DEMO_TASK_NOTES: Record<number, readonly DemoNote[]> = {
  1: [
    {
      authorResourceId: 1,
      authorName: "Alex Example",
      timestamp: "2026-04-23T09:15:00.000Z",
      text: "Partner confirmed the OIDC discovery endpoint is stable; no SAML fallback needed.",
    },
  ],
  4: [
    {
      authorResourceId: 2,
      authorName: "Sam Placeholder",
      timestamp: "2026-05-14T11:00:00.000Z",
      text: "Redis sliding-window middleware drafted; awaiting DBA schema review before wiring rate limits.",
    },
  ],
};

const DEMO_RAID_NOTES: Record<number, readonly DemoNote[]> = {
  2: [
    {
      authorResourceId: 4,
      authorName: "Morgan Standin",
      timestamp: "2026-05-22T08:30:00.000Z",
      text: "Vendor SLA call scheduled; requesting a 99.95% uptime commitment for peak windows.",
    },
  ],
  11: [
    {
      authorResourceId: 4,
      authorName: "Morgan Standin",
      timestamp: "2026-05-25T16:45:00.000Z",
      text: "Compliance pre-review complete; formal sign-off pending the final pen-test report.",
    },
  ],
};

// Fold Description → noteLog + clear description (tasks only; RAID keeps its own
// description field), then append the demo task notes.
const foldedTasks: Task[] = ws.tasks.map((task) => {
  const desc = (task.description ?? "").trim();
  let noteLog: NoteLogEntry[] | undefined = task.noteLog;
  let description = task.description;
  if (desc) {
    const ts = task.lastUpdateDate
      ? `${task.lastUpdateDate}T00:00:00.000Z`
      : "2026-01-01T00:00:00.000Z";
    const base: NoteLogEntry[] = [...(task.noteLog ?? [])];
    noteLog = [
      ...base,
      { id: nextNoteId(base), timestamp: ts, html: noteHtml(desc), text: desc },
    ];
    description = "";
  }
  const demo = DEMO_TASK_NOTES[task.id];
  if (demo) noteLog = appendDemoNotes(noteLog, demo);
  return noteLog === task.noteLog && description === task.description
    ? task
    : { ...task, description, noteLog };
});

// Append demo authored notes to the enriched RAID items (RAID description stays).
const raidWithNotes: RaidItem[] = enrichedRaid.map((item) => {
  const demo = DEMO_RAID_NOTES[item.id];
  return demo ? { ...item, noteLog: appendDemoNotes(item.noteLog, demo) } : item;
});

// Two new ChangeItem entries
const changes: ChangeItem[] = [
  {
    id: 1,
    title: "Add MFA to SSO scope",
    description:
      "Extend the current SSO implementation to require multi-factor authentication (TOTP / push) " +
      "for all privileged accounts before production go-live. Driven by updated InfoSec policy issued 2026-05-20.",
    type: "Scope",
    status: "Under Review",
    impact: "High",
    impactDescription:
      "Adds ~3 weeks of backend + frontend work. Requires additional security review cycle and " +
      "re-scoping of load-test scenarios.",
    scheduleImpactDays: 21,
    costImpact: 18000,
    requestedBy: "Morgan Standin",
    raisedDate: "2026-05-21",
    decisionBy: "Elena Fischer",
    decisionDate: undefined,
    resolutionNotes: undefined,
    linkedTaskIds: [2],
    linkedRaidIds: [4],
    stakeholderIds: [1, 5],
    localModifiedAt: "2026-05-21T09:00:00.000Z",
  },
  {
    id: 2,
    title: "Extend go-live by two weeks",
    description:
      "Proposed two-week slip of the production cutover (from 2026-09-01 to 2026-09-15) to accommodate " +
      "the MFA scope addition and unresolved SSO provider SLA concerns. Allows a full regression cycle " +
      "and a second hypercare rehearsal.",
    type: "Schedule",
    status: "Proposed",
    impact: "Medium",
    impactDescription:
      "Delays hypercare exit to 2026-12-29. Minor cost impact (two additional sprint weeks). " +
      "Customer comms required; maintenance-window notice must be re-issued.",
    scheduleImpactDays: 14,
    costImpact: 6000,
    requestedBy: "Alex Example",
    raisedDate: "2026-05-28",
    decisionBy: "Elena Fischer",
    decisionDate: undefined,
    resolutionNotes: undefined,
    linkedTaskIds: [],
    linkedRaidIds: [2],
    stakeholderIds: [1, 4],
    localModifiedAt: "2026-05-28T14:30:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Step 2b: Synthesize a demo ProjectMeta + a STABLE (deterministic) project id.
// The multi-tenant sqlite needs a `projects` row and a project_id on every
// workspace row. Values are consistent with the sample (SSO / identity demo).
// ---------------------------------------------------------------------------
const SAMPLE_PROJECT_ID = "sample-project-0001";
const sampleProjectMeta: ProjectMeta = {
  name: "Customer Identity Platform",
  code: "CIP-2026",
  description: "Demo project: customer SSO / identity platform rollout with MFA and compliance gates.",
  sponsor: "Elena Fischer",
  projectManager: "Alex Example",
  keyStakeholdersInternal: ["Elena Fischer", "Sam Placeholder", "Taylor Specimen"],
  keyStakeholdersExternal: ["David Okoro", "Morgan Standin"],
  customer: "Northwind Retail Group",
  naceSection: "G",
  identityTypes: ["B2C", "B2B"],
  identityCount: 500000,
  stakeholderCount: 5,
  products: "SSO, MFA, Customer Directory",
  platform: "Azure AD B2C",
  deployment: "Cloud",
  startDate: "2026-01-15",
  endDate: "2026-09-15",
  profitCenter: "PC-4711",
  quotes: "Q-2026-0042",
  salesforceUrl: "https://example.salesforce.com/opportunity/cip-2026",
  sharepointUrl: "https://example.sharepoint.com/sites/cip-2026",
  confluenceUrl: "https://example.atlassian.net/wiki/spaces/CIP",
  jiraUrl: "https://example.atlassian.net/browse/CIP",
  operatingTimezone: "Europe/Berlin",
  contactPersons: [
    { name: "David Okoro", email: "david.okoro@northwind.example", synced: false },
    // Sample is resource #1 — use her real Acme address and mark synced.
    { name: "Alex Example", email: "Sample.Dummy@example.com", synced: true },
  ],
  docRepoLocation: "https://example.sharepoint.com/sites/cip-2026/Shared Documents",
  regulatory: ["GDPR / data protection regulation", "NIS2"],
  notes: "Generated sample project for the multi-tenant Turso demo database.",
};

// A demo project status (overall RAG + PM narrative) so the dashboard status
// summary renders real content instead of an empty card. Amber overall:
// schedule is the risk (legacy-user migration on the critical path), budget +
// scope steady.
const sampleStatus: ProjectStatus = {
  ragOverride: "A",
  scheduleOverride: "A",
  budgetOverride: "G",
  scopeOverride: "G",
  narrative:
    "Migration on track for the September go-live; design sign-off is complete and the OIDC PoC validated. " +
    "Schedule is amber — the legacy-user migration script is the critical-path item and load testing slips if it lands late. " +
    "Budget is tracking to plan and scope is stable.",
  narrativeUpdatedAt: "2026-05-28T09:00:00.000Z",
};

// A demo steering committee (board membership + a scheduled meeting + an
// info-pack cadence) so the steering-committee surface renders real content.
// Members reference real resource ids (1 = Alex Example / PM, 2 / 3 = senior team).
const sampleSteeringCommittee: SteeringCommittee = {
  name: "CIP Steering Committee",
  memberResourceIds: [1, 2, 3],
  meetings: [
    {
      id: 1,
      date: "2026-07-10",
      title: "Q3 steering review",
      agenda: "Migration readiness, load-test results, go-live gate decision.",
      location: "Teams",
    },
  ],
  infoSchedules: [
    { id: 1, label: "Board info pack", leadDays: 3 },
  ],
};

// Assemble the enriched workspace (immutable spread)
// Synthesize day rates on the rate card (basis "day", day = hourly * workday
// hours) so the sample exercises the day-authoritative path — mirrors how the
// project meta/status below are synthesized rather than carried in the .md.
const enrichedRoles = ws.roles.map((r) =>
  materializeRoleRates(
    { ...r, rateBasis: "day", internalRateDay: r.internalRate * SAMPLE_WORKDAY_HOURS, externalRateDay: r.externalRate * SAMPLE_WORKDAY_HOURS },
    SAMPLE_WORKDAY_HOURS,
  ),
);

const enrichedWs = {
  ...ws,
  tasks: foldedTasks,
  raid: raidWithNotes,
  roles: enrichedRoles,
  changes,
  project: sampleProjectMeta,
  status: sampleStatus,
  steeringCommittee: sampleSteeringCommittee,
};

// ---------------------------------------------------------------------------
// Step 3: Emit all formats
// ---------------------------------------------------------------------------

const jsonPath    = join(ROOT, "sample-workspace-small.json");
const sqlitePath  = join(ROOT, "sample-workspace-small.sqlite3");

/**
 * Build a self-contained, Turso-importable (WAL-mode) sqlite file at `path`
 * from `ws`, removing any prior file + transient -wal/-shm sidecars first.
 * Returns the OPEN DatabaseSync handle (caller reads counts / closes).
 */
function emitTenantSqlite(path: string, ws: Workspace): DatabaseSync {
  const sidecars = [`${path}-wal`, `${path}-shm`];
  for (const f of sidecars) if (existsSync(f)) unlinkSync(f);
  if (existsSync(path)) unlinkSync(path);
  for (const f of sidecars) if (existsSync(f)) unlinkSync(f);

  const handle = new DatabaseSync(path);
  // WAL journal mode is REQUIRED by `turso db create --from-file`. Set it before
  // the BEGIN/COMMIT batch below (PRAGMA journal_mode cannot run inside a txn).
  handle.exec("PRAGMA journal_mode = WAL");

  const statements = [
    ...tenantWorkspaceToStatements(ws, SAMPLE_PROJECT_ID),
    upsertProjectStatement(sampleProjectMeta, SAMPLE_PROJECT_ID, false),
  ];
  for (const stmt of statements) {
    if (!stmt.args || stmt.args.length === 0) {
      // DDL, BEGIN, COMMIT, DELETE — no params
      handle.exec(stmt.sql);
    } else {
      // INSERT with positional ? placeholders
      const params = stmt.args.map((arg) => {
        if (arg.type === "null" || arg.value == null) return null;
        if (arg.type === "integer") return Number(arg.value);
        return arg.value; // text
      });
      handle.prepare(stmt.sql).run(...params);
    }
  }

  // Flush all WAL frames back into the main database file so the single
  // committed artifact is self-contained (header stays WAL mode).
  handle.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return handle;
}

/** Drop the transient -wal/-shm sidecars for `path` (opening a WAL DB recreates them). */
function dropSqliteSidecars(path: string): void {
  for (const f of [`${path}-wal`, `${path}-shm`]) if (existsSync(f)) unlinkSync(f);
}

// JSON — complete workspace (the canonical generated export, incl. enrichment)
writeFileSync(jsonPath, workspaceToJson(enrichedWs), "utf8");

// SQLite — build fresh, replay the multi-tenant statements.
const db = emitTenantSqlite(sqlitePath, enrichedWs);

// ---------------------------------------------------------------------------
// Step 4: Print summary
// ---------------------------------------------------------------------------

// Read sqlite row counts per table
const tableCounts: Record<string, number> = {};
for (const table of TABLE_NAMES) {
  try {
    const row = db.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number };
    tableCounts[table] = row.n;
  } catch {
    tableCounts[table] = -1;
  }
}

db.close();

console.log("\n=== generate-sample-workspace summary ===\n");
console.log("Workspace entity counts:");
console.log(`  tasks:        ${enrichedWs.tasks.length}`);
console.log(`  raid:         ${enrichedWs.raid.length}`);
console.log(`  milestones:   ${(enrichedWs.milestones ?? []).length}`);
console.log(`  stakeholders: ${(enrichedWs.stakeholders ?? []).length}`);
console.log(`  changes:      ${(enrichedWs.changes ?? []).length}`);
console.log(`  budgets:      ${(enrichedWs.budgets ?? []).length}`);
console.log(`  resources:    ${enrichedWs.resources.length}`);
console.log(`  absences:     ${enrichedWs.absences.length}`);
console.log(`  shifts:       ${enrichedWs.shifts.length}`);
console.log(`  roles:        ${enrichedWs.roles.length}`);
console.log(`  disciplines:  ${enrichedWs.disciplines.length}`);
console.log(`  grades:       ${enrichedWs.grades.length}`);

console.log("\nFiles written:");
console.log(`  ${jsonPath}`);
console.log(`  ${sqlitePath}`);
console.log("  (sample-workspace-small.md / .csv are hand-curated — not overwritten)");

console.log("\nSQLite row counts per table:");
for (const [table, count] of Object.entries(tableCounts)) {
  console.log(`  ${table.padEnd(18)}: ${count}`);
}

// ---------------------------------------------------------------------------
// Step 3b: Emit SCALED variants (big = 3×, huge = 10×) from the enriched small
// workspace. scaleWorkspace replicates content entities with a per-replica id
// offset + full FK remap; reference data + singletons (incl. project) are kept
// once. json + sqlite3 only — no curated md/csv.
// ---------------------------------------------------------------------------
const SCALED_VARIANTS: ReadonlyArray<{ name: string; factor: number }> = [
  { name: "big", factor: 3 },
  { name: "huge", factor: 10 },
];

console.log("\nScaled variants:");
for (const { name, factor } of SCALED_VARIANTS) {
  const scaled = scaleWorkspace(enrichedWs, factor);
  const scaledJsonPath = join(ROOT, `sample-workspace-${name}.json`);
  const scaledSqlitePath = join(ROOT, `sample-workspace-${name}.sqlite3`);

  writeFileSync(scaledJsonPath, workspaceToJson(scaled), "utf8");
  const scaledDb = emitTenantSqlite(scaledSqlitePath, scaled);
  scaledDb.close();
  dropSqliteSidecars(scaledSqlitePath);

  console.log(
    `  ${name.padEnd(4)} (${factor}×): tasks=${scaled.tasks.length}, raid=${scaled.raid.length}, ` +
      `milestones=${(scaled.milestones ?? []).length}, changes=${(scaled.changes ?? []).length}, ` +
      `stakeholders=${(scaled.stakeholders ?? []).length}, budgets=${(scaled.budgets ?? []).length}`,
  );
  console.log(`       → ${scaledJsonPath}`);
  console.log(`       → ${scaledSqlitePath}`);
}

// ---------------------------------------------------------------------------
// Step 5 (optional): Round-trip + sqlite verification  (VERIFY=1)
// ---------------------------------------------------------------------------
if (process.env["VERIFY"] === "1") {
  console.log("\n=== Round-trip + SQLite verification ===\n");

  // JSON round-trip
  const jsonBack = jsonToWorkspace(readFileSync(jsonPath, "utf8"));
  console.log(`JSON re-parse:  tasks=${jsonBack.tasks.length}, raid=${jsonBack.raid.length}, changes=${(jsonBack.changes ?? []).length}, stakeholders=${(jsonBack.stakeholders ?? []).length}, budgets=${(jsonBack.budgets ?? []).length}`);
  if ((jsonBack.changes ?? []).length !== 2) throw new Error("JSON round-trip: expected 2 changes");
  if ((jsonBack.budgets ?? []).length !== 5) throw new Error("JSON round-trip: expected 5 budgets");
  if (jsonBack.project?.code !== "CIP-2026") throw new Error(`JSON round-trip: expected project.code=CIP-2026, got ${jsonBack.project?.code}`);
  console.log(`  JSON project: code=${jsonBack.project?.code}, name="${jsonBack.project?.name}"  ✓`);
  const jsonRaid2 = jsonBack.raid.find((r) => r.id === 2);
  if (!jsonRaid2 || !jsonRaid2.stakeholderIds.includes(1) || !jsonRaid2.stakeholderIds.includes(6)) {
    throw new Error(`JSON round-trip: RAID item 2 stakeholderIds wrong: ${JSON.stringify(jsonRaid2?.stakeholderIds)}`);
  }
  console.log(`  RAID #2 stakeholderIds: [${jsonRaid2.stakeholderIds.join(", ")}]  ✓`);

  // SQLite verification
  const dbVerify = new DatabaseSync(sqlitePath);

  // WAL mode is a hard requirement for `turso db create --from-file`.
  const journalMode = (dbVerify.prepare("PRAGMA journal_mode").get() as { journal_mode: string } | undefined)?.journal_mode;
  console.log(`SQLite journal_mode: ${journalMode}`);
  if (journalMode !== "wal") throw new Error(`Expected journal_mode=wal (Turso import requirement), got ${journalMode}`);

  const schemaVersion = (dbVerify.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value;
  console.log(`\nSQLite schema_version: ${schemaVersion}`);
  if (schemaVersion !== "12") throw new Error(`Expected schema_version=12, got ${schemaVersion}`);

  // Multi-tenant: exactly one projects row, with our stable id + name.
  const projectsCount = (dbVerify.prepare(`SELECT count(*) as n FROM ${PROJECTS_TABLE}`).get() as { n: number }).n;
  console.log(`SQLite ${PROJECTS_TABLE} count: ${projectsCount}`);
  if (projectsCount !== 1) throw new Error(`Expected ${PROJECTS_TABLE} count=1, got ${projectsCount}`);
  const projectRow = dbVerify.prepare(`SELECT id, name FROM ${PROJECTS_TABLE}`).get() as { id: string; name: string };
  if (projectRow.id !== SAMPLE_PROJECT_ID) throw new Error(`Expected project id=${SAMPLE_PROJECT_ID}, got ${projectRow.id}`);
  if (projectRow.name !== "Customer Identity Platform") throw new Error(`Expected project name="Customer Identity Platform", got "${projectRow.name}"`);
  console.log(`  project row: id=${projectRow.id}, name="${projectRow.name}"  ✓`);

  const expectedCounts: Record<string, number> = {
    changes: 2,
    stakeholders: 7,
    raid: 13,
    tasks: 14,
    milestones: 3,
    budget_buckets: 5,
  };
  for (const [table, expected] of Object.entries(expectedCounts)) {
    const row = dbVerify.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number };
    const actual = row.n;
    const ok = actual === expected ? "✓" : `✗ EXPECTED ${expected}`;
    console.log(`  ${table.padEnd(18)}: ${actual}  ${ok}`);
    if (actual !== expected) throw new Error(`SQLite count mismatch: ${table} expected ${expected}, got ${actual}`);
  }

  // BONUS: verify stakeholderIds round-trip through SQLite (via raid table)
  const raidRows = dbVerify.prepare("SELECT id, stakeholderIds FROM raid WHERE id IN (2, 11, 13)").all() as { id: number; stakeholderIds: string }[];
  console.log("\n  RAID stakeholderIds in SQLite:");
  for (const row of raidRows) {
    console.log(`    RAID #${row.id}: stakeholderIds="${row.stakeholderIds}"`);
  }
  const raid2Row = raidRows.find((r) => r.id === 2);
  if (!raid2Row || !raid2Row.stakeholderIds.includes("1") || !raid2Row.stakeholderIds.includes("6")) {
    throw new Error(`SQLite RAID #2 stakeholderIds wrong: ${raid2Row?.stakeholderIds}`);
  }

  dbVerify.close();
  console.log("\nAll round-trip + integrity checks passed. ✓");
}

// Final cleanup: opening a WAL-mode DB recreates -wal/-shm; drop them so the
// committed artifact is the single self-contained sample-workspace-small.sqlite3.
dropSqliteSidecars(sqlitePath);
