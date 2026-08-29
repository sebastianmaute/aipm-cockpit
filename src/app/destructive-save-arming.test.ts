import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import { evaluateSaveGuard } from "./save-guard";

/**
 * The SECOND save-guard invariant (docs/open-followups.md §285).
 *
 * `workspace-slice-policy.test.ts` gates WHICH slices count toward the
 * save-time data-loss guards. This file gates the dependent invariant it does
 * not touch: every removal route for a counted slice must arm the one-shot
 * `allowDestructiveSave` bypass, so a user's own deliberate deletion is not
 * refused by the guard the counting armed.
 *
 * ★★★ SCOPE, AND ITS BOUND — read this before trusting a green run.
 * The completeness check below is COMPLETE for the AI surface and NOT
 * complete for the UI surface, because completeness needs a declaration to
 * enumerate from and only the AI surface has one (`TOOL_DEFS`). There is no
 * declaration of "routes that remove records"; a source scan for a setter
 * called with a `filter` cannot tell a delete from an edit. So an eighteenth
 * UI delete handler added tomorrow fails NOTHING here. That asymmetry is
 * filed, not fixed — see the register entry this file's commit names.
 *
 * ★★ The behavioural proof for each route lives in that route's own test
 * file, next to the harness that can render it. This file holds the
 * enumeration and the guard-level tie only.
 *
 * Mutation record, 2026-08-29 — which mutant backs which assertion. A row is
 * the ONLY thing entitling that assertion to be called mutation-proved.
 *   M1 arming absent from deleteAllTasks        → "deleteAllTasks arms once…"        [red step]
 *   M2 hoist the arming above the !doomed guard → "deleteTask does NOT arm…"         [mutated]
 *   M3 empty removalToolNames()                 → "enumerates a non-empty tool set"  [mutated]
 *   M4 filter out delete_document                → "reaches delete_document…"         [mutated]
 *   M5 arming removed, use-stakeholders          → "arms once for a stakeholder…"     [red step]
 *   M6 arming removed, use-change-log            → "arms once for a change…"          [red step]
 *   M7 arming removed, use-calendar-events       → "arms once for an event…"          [red step]
 * [mutated] = a mutant applied to the committed tree and reverted here.
 * [red step] = the assertion was observed failing against a tree that genuinely
 * lacked the arming, which is the same observable as deleting it.
 *
 * ★★ EVERY OTHER ASSERTION IN THIS SLICE IS UNPROVED BY MUTATION and is stated
 * as such. In particular the nine UI single-delete routes' leak blocks are
 * pinned only by their own positive controls, not by a hoist mutant.
 */

/** Every AI tool that removes records, and where its arming is proved. */
const ARMED_AI_ROUTES: Record<string, string> = {
  delete_task: "use-chat-dispatcher.test.tsx",
  delete_all_tasks: "use-chat-dispatcher.test.tsx",
  delete_resource: "use-chat-dispatcher.test.tsx",
  delete_raid_item: "use-chat-dispatcher.test.tsx",
  delete_change: "use-chat-dispatcher.test.tsx",
  delete_milestone: "use-chat-dispatcher.test.tsx",
  delete_stakeholder: "use-chat-dispatcher.test.tsx",
  delete_document: "use-chat-dispatcher.test.tsx",
};

function removalToolNames(): string[] {
  return TOOL_DEFS
    .map((d) => (d as { name?: unknown }).name)
    .filter((n): n is string => typeof n === "string")
    .filter((n) => n.startsWith("delete_") || n.startsWith("clear_"));
}

describe("destructive-save arming — the counted-slice removal invariant", () => {
  it("enumerates a non-empty tool set (anti-vacuity)", () => {
    // A check that reads zero tools passes everything. `TOOL_DEFS` is
    // COMPOSED — it spreads DOCUMENT_TOOL_DEFS — so a future refactor that
    // breaks the spread would empty this list silently.
    const names = removalToolNames();
    expect(names.length, "no delete_/clear_ tools found — the enumeration is broken, not clean").toBeGreaterThan(0);
    expect(names.length).toBeGreaterThanOrEqual(Object.keys(ARMED_AI_ROUTES).length);
  });

  it("reaches delete_document, which is declared in a SPREAD module", () => {
    // The regression guard for the composition trap: a source scan of
    // chat-tool-defs.ts finds 7 and misses this one.
    expect(removalToolNames()).toContain("delete_document");
  });

  it("has a recorded arming decision for every AI removal tool", () => {
    const undecided = removalToolNames().filter((n) => !(n in ARMED_AI_ROUTES));
    expect(
      undecided,
      `New AI removal tool(s) with no arming decision: ${undecided.join(", ")}. ` +
        "Arm the handler where it already reports it changed something, add a behavioural " +
        "suite in that route's test file, and record it in ARMED_AI_ROUTES.",
    ).toEqual([]);
  });

  it("arming is what the guard actually consults", () => {
    // Ties every `allowDestructiveSave` spy assertion elsewhere to an outcome.
    // Without this block they prove only that a callback fired.
    const wipe = { prevCollections: 3, prevRecords: 40, curCollections: 0, curRecords: 0 };
    expect(evaluateSaveGuard({ ...wipe, allowDestructive: false }).refuse).toBe(true);
    expect(evaluateSaveGuard({ ...wipe, allowDestructive: true }).refuse).toBe(false);
  });
});
