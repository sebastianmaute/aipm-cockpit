import { describe, expect, it } from "vitest";
import { sanitizeTemplate, sanitizeTemplates, templateFromWorkspace } from "./templates";
import { sanitizeRichHtml } from "./sanitize-html";
import { emptyWorkspace } from "./workspace";

describe("sanitizeTemplates", () => {
  it("returns [] for junk / legacy", () => {
    expect(sanitizeTemplates(undefined)).toEqual([]);
    expect(sanitizeTemplates(null)).toEqual([]);
    expect(sanitizeTemplates("x")).toEqual([]);
    expect(sanitizeTemplates({})).toEqual([]);
  });
  it("keeps a valid template and coerces features/fieldVisibility", () => {
    const out = sanitizeTemplates([
      { id: "t1", name: "T1", features: ["raid", "nope"], fieldVisibility: { milestone: { fields: ["name"] } } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
    expect(out[0].features).toEqual(["raid"]);
    expect(out[0].fieldVisibility.milestone.fields).toContain("name");
  });
  it("drops entries without id or name", () => {
    expect(sanitizeTemplates([{ name: "no id" }, { id: "x" }])).toEqual([]);
  });
  it("forces builtIn off on stored user templates", () => {
    const out = sanitizeTemplates([{ id: "t", name: "T", builtIn: true, features: [], fieldVisibility: {} }]);
    expect(out[0].builtIn).toBeFalsy();
  });
  it("sanitizeTemplate returns null for junk, object for valid", () => {
    expect(sanitizeTemplate(5)).toBeNull();
    expect(sanitizeTemplate({ id: "a", name: "A", features: [], fieldVisibility: {} })?.id).toBe("a");
  });
  it("preserves seed task dependencies through the round-trip", () => {
    const out = sanitizeTemplates([{
      id: "t", name: "T", features: [], fieldVisibility: {},
      seed: { tasks: [
        { id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Low", blockers: "", description: "" },
        { id: 2, taskName: "B", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Low", blockers: "", description: "",
          dependencies: [{ taskId: 1, type: "FS" }] },
      ]}
    }]);
    expect(out[0].seed?.tasks?.[1].dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });
});

describe("a captured task description survives the template round trip", () => {
  it("keeps the description of a task captured from a live workspace", () => {
    // ★★★ DATA LOSS, pre-existing since 0.196.0 and found by auditing 0.210.0's
    // write-boundary fix. `templateFromWorkspace` captures REAL Task objects
    // (`seed.tasks = ws.tasks`), and a Task has carried `description` since the
    // 0.196.0 rename — but `sanitizeSeedTask` read `raw.notes`, which no longer
    // exists on a captured task. So every task description was silently dropped
    // on import: `sanitizeNotes(undefined)` → "" → `plainToHtml("")` → "".
    //
    // ★ It must also stay UPGRADE-AWARE: the captured value is HTML, and running
    // it through plainToHtml escaped it into visible tags — the same defect the
    // chat write boundary had.
    const ws = {
      ...emptyWorkspace(),
      tasks: [
        {
          id: 1,
          taskName: "Kickoff",
          assignee: "Ada",
          assigneeEmail: "",
          dueDate: "2026-09-01",
          lastUpdateDate: "2026-08-01",
          priority: "Medium",
          status: "To Do",
          blockers: "",
          description: "<p>Agree on <strong>goals</strong></p>",
          inquiriesSent: 0,
        },
      ],
    } as unknown as Parameters<typeof templateFromWorkspace>[0];
    const captured = templateFromWorkspace(ws, [], { name: "T", includeContent: true }, "id1");
    // Round-trip the way an export/import does: through the sanitizer.
    const reloaded = sanitizeTemplate(JSON.parse(JSON.stringify(captured)));
    const task = reloaded?.seed?.tasks?.[0];
    expect(task).toBeDefined();
    expect(task!.description).toBe("<p>Agree on <strong>goals</strong></p>");
  });

  it("still upgrades a LEGACY template that carries the pre-0.196.0 `notes` key", () => {
    // Hand-authored and pre-rename templates use `notes` with plain text; that
    // must keep working, and must be upgraded rather than escaped.
    const reloaded = sanitizeTemplate({
      id: "t1",
      name: "T1",
      features: [],
      fieldVisibility: {},
      seed: { tasks: [{ id: 1, taskName: "Kickoff", notes: "plain < text" }] },
    });
    expect(reloaded?.seed?.tasks?.[0]?.description).toBe("<p>plain &lt; text</p>");
  });

  // ★★★ The classifier must follow the DESTINATION field, not the file the value
  // travels through. `sanitizeSeedTask` writes `Task.description`, whose human
  // save runs the same `sanitizeRichHtml` the "rich" classifier derives from — so
  // classifier and sink agree by construction and an AI-authored <h2> reaches
  // storage, and survives the save, as a real heading.
  // ★★ THIS TEST USED TO PROVE THE OPPOSITE MECHANISM AND THE SAME PROPERTY. The
  // save ran `sanitizeNoteHtml` — 8 tags at KEEP_CONTENT: false, which deleted an
  // unlisted element TOGETHER WITH its text — so the words were saved only by
  // classifying NARROWLY enough that the value stored ESCAPED and the sanitizer
  // had no live element to delete. Mutation-proved 2026-08-10: restoring
  // "template" at the `sanitizeSeedTask` call site failed the "Plan" assertion
  // with `expected '<p>steps</p>' to contain 'Plan'`. That defect is closed at
  // the SINK now rather than at the classifier, which is why the "Measured"
  // comment below reads as live markup instead of escaped text.
  // ★ Anti-vacuity is unchanged and is the whole point: this asserts the WORD
  // survives the sanitizer, not merely that some string comes back. Both
  // assertions below are byte-identical to the version that pinned the old
  // mechanism — the property outlived it.
  // ★ Mirrors the RAID test of the same name in use-resource-planner.test.tsx —
  // the identical decision, one file away.
  it("survives the human save path: the rich sanitizer does not eat a heading's words", () => {
    const reloaded = sanitizeTemplate({
      id: "t1",
      name: "T1",
      features: [],
      fieldVisibility: {},
      seed: { tasks: [{ id: 1, taskName: "Kickoff", description: "<h2>Plan</h2><p>steps</p>" }] },
    });
    const imported = reloaded?.seed?.tasks?.[0]?.description ?? "";
    const afterHumanSave = sanitizeRichHtml(imported);
    // Measured 2026-08-11: imported === afterHumanSave ===
    // "<h2>Plan</h2><p>steps</p>" — live markup, unchanged by the save, because
    // `h2` is on RICH_ALLOWED_TAGS and the sanitizer unwraps rather than deletes.
    // (2026-08-10, under sanitizeNoteHtml, both were
    // "<p>&lt;h2&gt;Plan&lt;/h2&gt;&lt;p&gt;steps&lt;/p&gt;</p>" — the words
    // survived as ESCAPED TEXT instead. Same assertions, better outcome.)
    expect(afterHumanSave).toContain("Plan");
    expect(afterHumanSave).toContain("steps"); // control: the allow-listed half
  });
});

describe("templateFromWorkspace", () => {
  it("captures features + fieldVisibility, no seed when includeContent is false", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    const t = templateFromWorkspace(ws, ["raid"], { name: "My T", includeContent: false }, "id1");
    expect(t.id).toBe("id1");
    expect(t.name).toBe("My T");
    expect(t.features).toEqual(["raid"]);
    expect(t.fieldVisibility.task.fields).toEqual(["taskName"]);
    expect(t.seed).toBeUndefined();
    expect(t.builtIn).toBeFalsy();
  });
  it("captures seedable content when includeContent is true", () => {
    const task = { id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", status: "To Do" as const, priority: "Medium" as const, blockers: "", description: "" };
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const t = templateFromWorkspace(ws, [], { name: "T", includeContent: true }, "id2");
    expect(t.seed?.tasks).toHaveLength(1);
  });
  it("trims the name and description", () => {
    const t = templateFromWorkspace(emptyWorkspace(), [], { name: "  Trimmed  ", description: "  d  ", includeContent: false }, "id3");
    expect(t.name).toBe("Trimmed");
    expect(t.description).toBe("d");
  });
});

describe("template description fallback precedence", () => {
  it("falls back to legacy `notes` when `description` is present but EMPTY", () => {
    // ★★ `??` would return the empty string and never consult `notes`. A hybrid or
    // hand-edited template can carry both keys, and the empty one must not win.
    const reloaded = sanitizeTemplate({
      id: "t1",
      name: "T1",
      features: [],
      fieldVisibility: {},
      seed: { tasks: [{ id: 1, taskName: "K", description: "", notes: "legacy body" }] },
    });
    expect(reloaded?.seed?.tasks?.[0]?.description).toBe("<p>legacy body</p>");
  });

  it("prefers `description` when both are present and non-empty", () => {
    const reloaded = sanitizeTemplate({
      id: "t1",
      name: "T1",
      features: [],
      fieldVisibility: {},
      seed: { tasks: [{ id: 1, taskName: "K", description: "<p>current</p>", notes: "stale" }] },
    });
    expect(reloaded?.seed?.tasks?.[0]?.description).toBe("<p>current</p>");
  });
});
