import { describe, it, expect } from "vitest";
import { assertJiraManagedUnchanged, buildTaskCleanPatch } from "./chat-task-patch";
import { type Task } from "./types";

// ★★★ WHY THIS FILE EXISTS AT ALL, given the dispatcher suite already drove
// this module to 60% statements: the coverage FLOORS are aggregate, so no gate
// will ever surface a thin spot here — now or later. Whatever coverage this
// module has is whatever somebody decided was enough.
//
// ★★ And of everything under that aggregate, this is the wrong place to be
// thin. `assertJiraManagedUnchanged` is the guard that stops the assistant
// overwriting Jira-owned fields on a synced task; it was extracted out of
// `updateTask` under file-size pressure, which moves code without moving the
// tests that happened to reach it. The dispatcher tests cover the three THROW
// arms through the hook. What they cannot reach cheaply — and what a guard is
// most likely to get wrong — are the arms that must NOT fire, and the whole of
// `buildTaskCleanPatch`.
//
// ★ Every negative here carries a positive observable. A guard that rejects
// everything satisfies "did not update"; only a `toThrow()` beside a
// `not.toThrow()` on the same fixture separates a working guard from a stuck
// one.

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    taskName: "Fix login bug",
    assignee: "Ada Lovelace",
    assigneeEmail: "ada@example.com",
    dueDate: "2026-09-01",
    lastUpdateDate: "2026-08-01",
    priority: "High",
    status: "To Do",
    blockers: "",
    description: "",
    inquiriesSent: 0,
    group: "Platform",
    labels: ["backend"],
    ...over,
  }) as Task;

const linked = (over: Partial<Task> = {}) => task({ jiraKey: "LOP-1", ...over });

describe("assertJiraManagedUnchanged", () => {
  // ★★ THE `!existing.jiraKey` EARLY RETURN — the arm every ordinary AI edit
  // takes. Asserted with a patch that would throw on all THREE guarded fields
  // at once, so this cannot pass because the fixture happened to be harmless:
  // the same patch is used below to prove each arm really does fire.
  it("is a no-op for an unlinked task, whatever the patch touches", () => {
    expect(() =>
      assertJiraManagedUnchanged(task(), {
        assignee: "Someone Else",
        status: "In Progress",
        completedDate: undefined,
      }),
    ).not.toThrow();
  });

  it("CONTROL: the same patch throws once the task is Jira-linked", () => {
    expect(() =>
      assertJiraManagedUnchanged(linked(), {
        assignee: "Someone Else",
        status: "In Progress",
        completedDate: undefined,
      }),
    ).toThrow(/managed in Jira/);
  });

  describe("the assignee arm", () => {
    it("throws, naming the issue key so the model can say where to change it", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { assignee: "Grace Hopper" }),
      ).toThrow(/Assignee for LOP-1 is managed in Jira/);
    });

    it("permits a patch that does not mention the assignee", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { taskName: "Renamed" }),
      ).not.toThrow();
    });

    // ★★★ THE COMPARISON IS OVER *SANITIZED* VALUES, and that is the only
    // reason this arm is not a nuisance. `sanitizeAssignee` trims, so a model
    // that echoes the stored assignee back with stray whitespace — which is
    // exactly what a round-trip through a text field produces — is proposing
    // NO CHANGE and must be allowed through. Comparing raw strings would
    // reject it and make every "update the due date" call fail on a task the
    // model had merely re-read. A fixture using two genuinely different names
    // cannot tell the two implementations apart.
    it("permits a re-stated assignee that differs only by whitespace", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { assignee: "  Ada Lovelace  " }),
      ).not.toThrow();
    });

    it("still throws when the trimmed values genuinely differ", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { assignee: "  Grace Hopper  " }),
      ).toThrow(/managed in Jira/);
    });
  });

  describe("the reopen arm", () => {
    const done = () => linked({ status: "Done", completedDate: "2026-05-18" });

    // ★★★ `undefined` VALUE with the key PRESENT is the reopen request, and it
    // is indistinguishable from an ABSENT key through `patch.completedDate ===
    // undefined` alone — hence the `"completedDate" in patch` half. These two
    // tests are a matched pair: drop the `in` check and the second goes red,
    // drop the `=== undefined` check and the first does.
    it("throws when the key is present with an undefined value", () => {
      expect(() =>
        assertJiraManagedUnchanged(done(), { completedDate: undefined }),
      ).toThrow(/Reopening LOP-1 must be done in Jira/);
    });

    it("permits a patch that omits the key entirely", () => {
      expect(() => assertJiraManagedUnchanged(done(), { priority: "Low" })).not.toThrow();
    });

    // ★ Nothing is being reopened if it was never closed. Without this, a guard
    //   written without the `existing.completedDate` half passes every other
    //   test in this block.
    it("permits the same reopen shape on a task that was never completed", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { completedDate: undefined }),
      ).not.toThrow();
    });

    // ★ Only CLEARING the date is a reopen — writing a different one is not
    //   this arm's business, and falls to the status arm if it matters.
    it("permits setting a completedDate to a real value", () => {
      expect(() =>
        assertJiraManagedUnchanged(done(), { completedDate: "2026-05-19" }),
      ).not.toThrow();
    });
  });

  describe("the status arm", () => {
    it("throws when the status would change", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked(), { status: "In Progress" }),
      ).toThrow(/Status for LOP-1 is managed in Jira/);
    });

    // ★★ A model re-stating the CURRENT status is proposing nothing, and the
    //    guard must let it through — the `!== existing.status` half. A test
    //    using only a different status cannot see that half at all.
    it("permits a status patch that restates the current value", () => {
      expect(() =>
        assertJiraManagedUnchanged(linked({ status: "In Review" }), { status: "In Review" }),
      ).not.toThrow();
    });
  });
});

describe("buildTaskCleanPatch", () => {
  // ★★★ THE SPREAD INVARIANT, and the single most important property here:
  // only keys the model SUPPLIED may appear, because the caller spreads the
  // result over the stored task. A builder that emitted every key with a
  // sanitized-undefined value would blank ten fields on every single-field
  // edit, and every per-field test below would still pass.
  it("carries only the keys the model actually supplied", () => {
    expect(Object.keys(buildTaskCleanPatch({ taskName: "New name" }, task()))).toEqual([
      "taskName",
    ]);
    expect(buildTaskCleanPatch({}, task())).toEqual({});
  });

  // ★★ `status` is deliberately NOT handled here — it must route through
  //    `applyStatusChange`, the writer of status + completedDate for every
  //    in-app status change, which the caller applies after merging. Carrying
  //    it here would let a status land without its paired completedDate.
  it("drops status, leaving it to applyStatusChange", () => {
    expect(buildTaskCleanPatch({ status: "Done" } as Partial<Task>, task())).toEqual({});
  });

  it("trims the single-line text fields", () => {
    expect(
      buildTaskCleanPatch(
        { taskName: "  Renamed  ", assignee: "  Grace  ", group: "  Core  " },
        task(),
      ),
    ).toEqual({ taskName: "Renamed", assignee: "Grace", group: "Core" });
  });

  // ★★★ BLOCKERS IS NOT TRIMMED, and the difference is structural rather than
  // an oversight: `sanitizeBlockers` is `sanitizeMultiline` (clip only) while
  // the three above are `sanitizeText` (trim then clip). Leading indentation is
  // content in a multi-line field, so trimming it would silently reflow a
  // pasted list on every AI edit. Measured, not assumed — a first cut of this
  // file asserted the trimmed form and went red here.
  // ★ It matters for the guard above too: the assignee whitespace case is
  //   permitted BECAUSE `sanitizeAssignee` trims. Were blockers ever routed
  //   through a Jira-managed comparison, the same fixture would behave the
  //   opposite way.
  it("preserves whitespace in the multi-line blockers field", () => {
    expect(buildTaskCleanPatch({ blockers: "  waiting  " }, task())).toEqual({
      blockers: "  waiting  ",
    });
  });

  it("coerces a non-string blockers value to an empty string", () => {
    expect(buildTaskCleanPatch({ blockers: 42 } as unknown as Partial<Task>, task())).toEqual({
      blockers: "",
    });
  });

  describe("assigneeEmail", () => {
    it("accepts and normalises a valid address", () => {
      expect(buildTaskCleanPatch({ assigneeEmail: " grace@example.com " }, task())).toEqual({
        assigneeEmail: "grace@example.com",
      });
    });

    it("throws on a non-empty value that is not an address", () => {
      expect(() => buildTaskCleanPatch({ assigneeEmail: "not-an-email" }, task())).toThrow(
        /assigneeEmail is invalid/,
      );
    });

    // ★★ THE `e &&` HALF. Blank is how the model UNASSIGNS an email, so it must
    //    pass the validity check rather than fail it — a guard written as
    //    `if (!isValidEmail(e)) throw` rejects every clear and passes both
    //    tests above.
    it("accepts a blank value as an explicit clear", () => {
      expect(buildTaskCleanPatch({ assigneeEmail: "   " }, task())).toEqual({
        assigneeEmail: "",
      });
    });
  });

  // ★★★ THE TWO DATES ARE DELIBERATELY ASYMMETRIC and a reader will try to
  // "fix" it. `dueDate` is user intent — a garbage one must surface as an error
  // the model can act on. `lastUpdateDate` is bookkeeping the model has no
  // business failing an edit over, so an unparseable one is dropped and the
  // stored value survives the spread. Both directions are pinned so neither can
  // be aligned to the other silently.
  describe("the date fields", () => {
    it("accepts a valid dueDate", () => {
      expect(buildTaskCleanPatch({ dueDate: "2026-12-24" }, task())).toEqual({
        dueDate: "2026-12-24",
      });
    });

    it("throws on an unparseable dueDate", () => {
      expect(() => buildTaskCleanPatch({ dueDate: "next Tuesday" }, task())).toThrow(
        /dueDate must be YYYY-MM-DD/,
      );
    });

    // ★ Well-formed but out of `sanitizeIsoDate`'s 1900-2100 range, so it
    //   sanitizes to "" and takes the throw branch — a shape a shape-only
    //   regex check would wave through.
    it("throws on a well-formed dueDate outside the supported year range", () => {
      expect(() => buildTaskCleanPatch({ dueDate: "1687-07-05" }, task())).toThrow(
        /dueDate must be YYYY-MM-DD/,
      );
    });

    it("accepts a valid lastUpdateDate", () => {
      expect(buildTaskCleanPatch({ lastUpdateDate: "2026-08-14" }, task())).toEqual({
        lastUpdateDate: "2026-08-14",
      });
    });

    it("drops an unparseable lastUpdateDate instead of throwing", () => {
      expect(buildTaskCleanPatch({ lastUpdateDate: "yesterday" }, task())).toEqual({});
    });
  });

  // ★★ THE FALLBACK IS THE *EXISTING* PRIORITY, not the module default. An
  //    invalid value must leave the task where it was; `sanitizePriority`'s own
  //    default is "Medium", so a call that forgot to pass `existing.priority`
  //    would silently demote every High task the model touched with a typo.
  //    The fixture's priority is deliberately NOT "Medium" — with "Medium" this
  //    test cannot fail.
  describe("priority", () => {
    it("accepts a valid priority", () => {
      expect(buildTaskCleanPatch({ priority: "Low" }, task())).toEqual({ priority: "Low" });
    });

    it("falls back to the task's own priority, never to the module default", () => {
      const out = buildTaskCleanPatch(
        { priority: "URGENT!!" } as unknown as Partial<Task>,
        task(),
      );
      expect(out).toEqual({ priority: "High" });
      expect(out.priority).not.toBe("Medium");
    });
  });

  describe("inquiriesSent", () => {
    it("floors a fractional count", () => {
      expect(buildTaskCleanPatch({ inquiriesSent: 3.7 }, task())).toEqual({ inquiriesSent: 3 });
    });

    it("clamps a negative count to zero", () => {
      expect(buildTaskCleanPatch({ inquiriesSent: -5 }, task())).toEqual({ inquiriesSent: 0 });
    });

    // ★ `0` is a real value the model may send. `!== undefined` is what keeps
    //   it — a truthiness guard would drop every "reset the counter" edit.
    it("keeps an explicit zero rather than treating it as absent", () => {
      expect(buildTaskCleanPatch({ inquiriesSent: 0 }, task())).toEqual({ inquiriesSent: 0 });
    });
  });

  describe("labels", () => {
    it("de-duplicates case-insensitively and drops blanks", () => {
      expect(
        buildTaskCleanPatch({ labels: ["api", "API", "  ", " ui "] }, task()),
      ).toEqual({ labels: ["api", "ui"] });
    });

    // ★ `[]` is how the model clears every label — same `!== undefined` point
    //   as the zero above, and the same failure mode if it is ever loosened.
    it("keeps an empty array as an explicit clear", () => {
      expect(buildTaskCleanPatch({ labels: [] }, task())).toEqual({ labels: [] });
    });
  });

  // ★★★ THE RICH-TEXT BOUNDARY, and the one arm here with a security
  // consequence. `description` is model-writable HTML rendered through
  // `dangerouslySetInnerHTML`, so it must route through `sanitizeAiRichText`
  // (upgrade-aware plain-or-HTML handling PLUS the DOMPurify allow-list) and
  // never through `plainToHtml`, which escapes and would store literal tags
  // forever. See AGENTS.md, "Rich-text register descriptions".
  describe("description", () => {
    it("strips a script tag while keeping the surrounding words", () => {
      const out = buildTaskCleanPatch(
        { description: "<p>Ship it<script>alert(1)</script></p>" },
        task(),
      );
      expect(out.description).not.toContain("<script");
      expect(out.description).not.toContain("alert(1)");
      // The allow-list UNWRAPS rather than deletes, so the words must survive.
      expect(out.description).toContain("Ship it");
    });

    it("keeps allow-listed markup intact", () => {
      expect(buildTaskCleanPatch({ description: "<p><strong>Urgent</strong></p>" }, task())
        .description).toContain("<strong>");
    });

    // ★★ PLAIN TEXT IS UPGRADED, NOT ESCAPED. A boundary wired to
    //    `plainToHtml` would store `&lt;p&gt;` for HTML input; one that stored
    //    plain text verbatim would put a bare string into an HTML sink. The
    //    two assertions here rule out both.
    it("upgrades a plain-text description to markup without escaping it", () => {
      const out = buildTaskCleanPatch({ description: "just words" }, task());
      expect(out.description).toContain("just words");
      expect(out.description).not.toContain("&lt;");
    });
  });
});
