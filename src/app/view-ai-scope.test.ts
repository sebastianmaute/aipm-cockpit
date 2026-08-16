import { describe, it, expect } from "vitest";
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { TURSO_ONLY_VIEWS } from "./nav-config";
import { TOOL_DEFS } from "./chat-tool-defs";
import { renderActivityEntry } from "./activity-prompt";

const TOOL_NAMES = new Set(TOOL_DEFS.map((d) => d.name));

describe("VIEW_AI_SCOPE", () => {
  it("gives every view a non-empty purpose", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      expect(scope.purpose, `${view} has no purpose`).toBeTruthy();
    }
  });

  // The dead-hint guard. A hint naming a tool that does not exist tells the
  // model to call something that will throw — and a plausible-sounding
  // invention is exactly what a future editor reaches for.
  it("only names tools that actually exist in TOOL_DEFS", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      for (const hint of scope.toolHints ?? []) {
        expect(TOOL_NAMES.has(hint), `${view} hints at unknown tool "${hint}"`).toBe(true);
      }
    }
  });

  // ★ Neither name has ever existed. Timelog has no chat tool at all, and the
  //   activity log is read by `search_history` — NOT by a `list_activity`,
  //   which is the name the activity view would attract now that it hints at a
  //   real tool. This test was called "does not hint at the deferred timelog or
  //   activity tools" until search_history landed and made half of that name
  //   false; the assertions were right either way.
  it("does not hint at tool names that were never built", () => {
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

  // Activity shipped the SAME disclosure for the same reason — "You cannot read
  // this log — there is no tool for it" — which stopped being true when
  // search_history landed. Retiring that line is the point of this test.
  it("no longer tells the model it cannot read the activity log", () => {
    const reading = VIEW_AI_SCOPE.activity.reading ?? "";
    expect(reading).not.toMatch(/no tool/i);
    expect(reading).not.toMatch(/cannot read/i);
    // ★ The two lines above are WEAK ON THEIR OWN — a `reading` reworded to
    // "there are zero tools here", or deleted outright (`?? ""`), passes both.
    // These pin the POSITIVE content only the replacement text can satisfy:
    // that the model is pointed at the real read tool, and that the tool is
    // named where the model will actually look for it.
    expect(reading).toContain("search_history");
    expect(VIEW_AI_SCOPE.activity.toolHints ?? []).toContain("search_history");
  });

  // ★★ SECOND false claim in the SAME entry. After the "cannot read this log"
  // line was retired the replacement said the log records changes made in the
  // app and by its integrations — "not your own tool calls". True until the
  // chat dispatcher started logging its own entity writes; false now.
  it("tells the model the activity log includes its OWN writes", () => {
    const reading = VIEW_AI_SCOPE.activity.reading;
    // ★ Assert the field EXISTS before the negation below — `reading` is
    // optional on ViewScope, and `expect(undefined).not.toContain(...)` passes
    // vacuously, so a deleted entry would read as a fixed one.
    expect(typeof reading).toBe("string");
    expect(reading).toContain("and by you");
    // ★ The pre-B2b prose claimed the opposite and was true until the dispatcher
    //   started logging. Pin the negation so it cannot silently return.
    expect(reading).not.toContain("not your own tool calls");
  });

  // ★★★ THE THIRD CLAIM IN THIS ENTRY, PINNED AGAINST THE CODE RATHER THAN
  // AGAINST ITSELF. Saying the log now covers the model's own writes invites
  // the follow-on "each entry says which" — and that one is FALSE: the actor
  // lives on ActivityEntry but search_history hands the model
  // renderActivityEntry's output, which is {at, summary, detail?} and carries
  // no actor at all. Two claims in this entry have already outlived the
  // limitation they described because nothing tied the prose to the code, so
  // this test ties it: a slice that starts surfacing the actor goes red HERE
  // and forces the sentence to move with it.
  it("does not promise attribution that search_history cannot deliver", () => {
    const reading = VIEW_AI_SCOPE.activity.reading;
    expect(typeof reading).toBe("string");
    expect(reading).toContain("does not say which");
    const rendered = renderActivityEntry({
      id: "device-nonce-1",
      timestamp: "2026-08-16T10:00:00.000Z",
      kind: "task.updated",
      args: ["Draft the plan"],
      actor: "ai",
    });
    // ★ The truthy summary is ANTI-VACUITY, not decoration: a render that threw
    //   its way to `{}` would satisfy the key check for the wrong reason.
    expect(rendered.summary).toBeTruthy();
    expect(Object.keys(rendered)).not.toContain("actor");
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
