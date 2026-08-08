import { describe, it, expect } from "vitest";
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { TURSO_ONLY_VIEWS } from "./nav-config";
import { TOOL_DEFS } from "./chat-tool-defs";

const TOOL_NAMES = new Set(TOOL_DEFS.map((d) => d.name));

describe("VIEW_AI_SCOPE", () => {
  it("gives every view a non-empty purpose", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      expect(scope.purpose, `${view} has no purpose`).toBeTruthy();
    }
  });

  // The dead-hint guard. A hint naming a tool that does not exist tells the
  // model to call something that will throw — and the deferred timelog and
  // activity tools are exactly the names a future editor would reach for.
  it("only names tools that actually exist in TOOL_DEFS", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      for (const hint of scope.toolHints ?? []) {
        expect(TOOL_NAMES.has(hint), `${view} hints at unknown tool "${hint}"`).toBe(true);
      }
    }
  });

  it("does not hint at the deferred timelog or activity tools", () => {
    const all = Object.values(VIEW_AI_SCOPE).flatMap((s) => s.toolHints ?? []);
    expect(all).not.toContain("list_timelog_entries");
    expect(all).not.toContain("list_activity");
  });

  // ★ Imported from nav-config.ts, NOT hand-copied. A local copy only ever
  // asserts against itself: a FOURTH Turso-gated view added to nav-config
  // would silently skip this check, which is the one case the test exists for.
  it("mentions Turso-only for every view gated on a Turso backend", () => {
    for (const view of TURSO_ONLY_VIEWS) {
      expect(
        VIEW_AI_SCOPE[view].purpose.toLowerCase(),
        `${view} is in TURSO_ONLY_VIEWS but its purpose does not mention Turso`,
      ).toContain("turso");
    }
  });

  // Neither StakeholderSummary nor MilestoneSummary (chat-tools.ts) exposes
  // Stakeholder.raci, so no tool can tell the model who is Accountable. The
  // raci view's reading must disclose that gap instead of inviting the model
  // to present an assignment count it cannot actually read.
  it("discloses that RACI assignments are not tool-readable", () => {
    expect(VIEW_AI_SCOPE.raci.reading?.toLowerCase()).toContain("not");
    expect(VIEW_AI_SCOPE.raci.reading?.toLowerCase()).toContain("readable");
  });

  // Documents shipped with a "there is no tool for this yet" disclosure, which
  // stopped being true when DOCUMENT_TOOL_DEFS landed. Retiring that line is the
  // point of this test.
  it("no longer tells the model it cannot touch documents", () => {
    const reading = VIEW_AI_SCOPE.documents.reading ?? "";
    expect(reading).not.toMatch(/no tool/i);
    // ★ The line above is WEAK ON ITS OWN — a `reading` reworded to "there are
    // zero tools here", or deleted outright (`?? ""`), passes it. These pin the
    // POSITIVE content only the replacement text can satisfy: that the model is
    // pointed at the real read tool AND told the read-before-edit precondition
    // that makes update_document's block indices meaningful.
    expect(reading).toContain("get_document");
    expect(reading).toContain("update_document");
    const hints = VIEW_AI_SCOPE.documents.toolHints ?? [];
    expect(hints).toContain("list_documents");
    expect(hints).toContain("create_document");
  });

  // ★ Documents is the only entry that hints at write tools at all (the
  // assistant authors there; every other register the user maintains by hand).
  // `delete_document` was left out on purpose — see the comment on that entry.
  // This guards the whole file, so a destructive hint added to ANY view fails.
  it("never hints at a destructive tool on any view", () => {
    const destructive = Object.entries(VIEW_AI_SCOPE).flatMap(([view, scope]) =>
      (scope.toolHints ?? []).filter((h) => h.startsWith("delete_")).map((h) => `${view}:${h}`),
    );
    expect(destructive).toEqual([]);
  });
});
