/**
 * generate-sample-workspace.ts
 *
 * Source of truth: the hand-curated `sample-workspace.md` (human-editable master;
 * it carries the full budget detail incl. blended discipline allocations). This
 * script parses it, enriches it with a demo change-log + RAID→stakeholder links,
 * and emits the two COMPLETE, faithfully-round-tripping formats:
 *   sample-workspace.json    — complete workspace (all entities + enrichment)
 *   sample-workspace.sqlite3 — Turso-importable; schema v9; built via node:sqlite
 *
 * It deliberately does NOT overwrite sample-workspace.md / .csv: workspaceToMarkdown
 * does not `\|`-escape the pipe-delimited blended-budget cell, so re-emitting the MD
 * would corrupt the blended bucket on re-parse. Those two stay hand-curated; JSON +
 * sqlite3 are the generated complete exports (and the place the demo change-log lives).
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
import { workspaceToStatements, TABLE_NAMES } from "../src/app/turso-schema";
import type { ChangeItem, RaidItem } from "../src/app/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Step 1: Parse the canonical source
// ---------------------------------------------------------------------------
const mdSource = readFileSync(join(ROOT, "sample-workspace.md"), "utf8");
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

// Assemble the enriched workspace (immutable spread)
const enrichedWs = {
  ...ws,
  raid: enrichedRaid,
  changes,
};

// ---------------------------------------------------------------------------
// Step 3: Emit all formats
// ---------------------------------------------------------------------------

const jsonPath    = join(ROOT, "sample-workspace.json");
const sqlitePath  = join(ROOT, "sample-workspace.sqlite3");

// JSON — complete workspace (the canonical generated export, incl. enrichment)
writeFileSync(jsonPath, workspaceToJson(enrichedWs), "utf8");

// SQLite — build fresh, replay workspaceToStatements
if (existsSync(sqlitePath)) unlinkSync(sqlitePath);
const db = new DatabaseSync(sqlitePath);

const stmts = workspaceToStatements(enrichedWs);
for (const stmt of stmts) {
  if (!stmt.args || stmt.args.length === 0) {
    // DDL, BEGIN, COMMIT, DELETE — no params
    db.exec(stmt.sql);
  } else {
    // INSERT with positional ? placeholders
    const params = stmt.args.map((arg) => {
      if (arg.type === "null" || arg.value == null) return null;
      if (arg.type === "integer") return Number(arg.value);
      return arg.value; // text
    });
    db.prepare(stmt.sql).run(...params);
  }
}

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
console.log("  (sample-workspace.md / .csv are hand-curated — not overwritten)");

console.log("\nSQLite row counts per table:");
for (const [table, count] of Object.entries(tableCounts)) {
  console.log(`  ${table.padEnd(18)}: ${count}`);
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
  const jsonRaid2 = jsonBack.raid.find((r) => r.id === 2);
  if (!jsonRaid2 || !jsonRaid2.stakeholderIds.includes(1) || !jsonRaid2.stakeholderIds.includes(6)) {
    throw new Error(`JSON round-trip: RAID item 2 stakeholderIds wrong: ${JSON.stringify(jsonRaid2?.stakeholderIds)}`);
  }
  console.log(`  RAID #2 stakeholderIds: [${jsonRaid2.stakeholderIds.join(", ")}]  ✓`);

  // SQLite verification
  const dbVerify = new DatabaseSync(sqlitePath);

  const schemaVersion = (dbVerify.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value;
  console.log(`\nSQLite schema_version: ${schemaVersion}`);
  if (schemaVersion !== "9") throw new Error(`Expected schema_version=9, got ${schemaVersion}`);

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
