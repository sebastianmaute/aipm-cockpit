import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  isWorkspaceEmpty,
  jsonToWorkspace,
  workspaceToJson,
  WorkspaceParseError,
  type Workspace,
} from "./workspace";
import { ACTIVITY_MAX_ENTRIES } from "./activity-log";

/** Render a STORED value the way a sink would and assert nothing live survives.
 *  Deliberately does NOT re-sanitize: the subject is the LOAD boundary, and the
 *  sink's own sanitize would strip a live element regardless of what was
 *  stored, which makes such an assertion vacuous (mutation-verified). */
function expectInert(stored: string, visibleText: string): void {
  const host = document.createElement("div");
  host.innerHTML = stored;
  expect(host.querySelector("script, img, iframe, object, embed")).toBeNull();
  expect(
    [...host.querySelectorAll("*")].some((el) => [...el.attributes].some((a) => a.name.startsWith("on"))),
  ).toBe(false);
  expect(host.textContent).toContain(visibleText); // neutralized, never deleted
}

describe("jsonToWorkspace sanitizes noteLog + description on load (stored XSS)", () => {
  it("neutralizes malicious task/raid noteLog html and task description", () => {
    const malicious = {
      tasks: [
        {
          id: 1,
          taskName: "T",
          status: "To Do",
          description: "<img src=x onerror=alert(1)><script>alert(2)</script><p>ok</p>",
          noteLog: [
            {
              id: 1,
              timestamp: "2026-01-01T00:00:00Z",
              html: "<img src=x onerror=alert(1)><script>alert(2)</script><p>note</p>",
              text: "note",
            },
          ],
        },
      ],
      raid: [
        {
          id: 1,
          noteLog: [
            {
              id: 1,
              timestamp: "2026-01-01T00:00:00Z",
              html: "<a href=\"javascript:alert(1)\">x</a><img src=x onerror=alert(1)>",
              text: "raidnote",
            },
          ],
        },
      ],
    };
    const ws = jsonToWorkspace(JSON.stringify(malicious));

    const taskNoteHtml = ws.tasks[0].noteLog?.[0].html ?? "";
    expect(taskNoteHtml).not.toContain("onerror");
    expect(taskNoteHtml).not.toContain("<script");
    expect(taskNoteHtml).toContain("note");

    // `description` is UPGRADED before it is sanitized (slice B), so a stored
    // value that is not already rich HTML gets ESCAPED to visible text instead
    // of stripped. The literal substring "onerror" therefore SURVIVES while the
    // ELEMENT does not — and it is the live element, not the substring, that
    // constitutes the vulnerability, so a `not.toContain("onerror")` check can
    // no longer tell an attack from inert escaped text. Assert INERTNESS
    // instead: render the stored value exactly as the app does (sink
    // re-sanitize, then innerHTML) and require no live node and no handler.
    const desc = ws.tasks[0].description ?? "";
    expectInert(desc, "ok");
    expect(desc).toContain("&lt;img"); // escaped, so the text is preserved verbatim

    const raidNoteHtml = ws.raid[0].noteLog?.[0].html ?? "";
    expect(raidNoteHtml).not.toContain("onerror");
    expect(raidNoteHtml).not.toContain("javascript:");
  });

  // The OTHER branch of the upgrade: a description that ALREADY starts with an
  // allow-listed tag is passed through by descriptionHtml untouched, so
  // sanitizeRichHtml is the ONLY thing standing between the payload and the
  // sink. Escaping cannot save this case — drop the sanitize and a live <img>
  // reaches the DOM (mutation-verified).
  it("strips live markup from an ALREADY-RICH malicious description", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [{ id: 1, taskName: "T", status: "To Do", description: "<p>ok</p><img src=x onerror=alert(1)>" }],
        raid: [],
      }),
    );
    expectInert(ws.tasks[0].description ?? "", "ok");
  });

  it("leaves already-clean noteLog/description byte-identical (idempotent round-trip)", () => {
    const clean = {
      tasks: [
        {
          id: 1,
          taskName: "T",
          status: "To Do",
          description: "<p>All <strong>good</strong></p>",
          noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00Z", html: "<p>clean</p>", text: "clean" }],
        },
      ],
      raid: [],
    };
    const ws = jsonToWorkspace(JSON.stringify(clean));
    expect(ws.tasks[0].description).toBe("<p>All <strong>good</strong></p>");
    expect(ws.tasks[0].noteLog?.[0].html).toBe("<p>clean</p>");
  });
});

// The whole-object JSON load boundary must normalise EVERY rich field, not just
// `description`. RAID `mitigation` and the three change fields reached storage
// through sanitizers that upgrade but are DOM-free by contract, so DOMPurify only
// ever ran on `description` — two fields of the same modal with different shapes.
describe("jsonToWorkspace normalises every rich field, not only description", () => {
  it("upgrades a legacy plain RAID mitigation and keeps its tag-shaped text", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [],
        raid: [{ id: 1, category: "Risk", title: "R", status: "Open", mitigation: "escalate <b>now</b>" }],
      }),
    );
    expect(ws.raid[0].mitigation).toBe("<p>escalate &lt;b&gt;now&lt;/b&gt;</p>");
  });

  it("neutralizes an already-rich malicious RAID mitigation", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [],
        raid: [{ id: 1, category: "Risk", title: "R", status: "Open", mitigation: "<p>ok</p><img src=x onerror=alert(1)>" }],
      }),
    );
    expectInert(ws.raid[0].mitigation ?? "", "ok");
  });

  it("neutralizes already-rich malicious change impact/resolution fields", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [],
        raid: [],
        changes: [{
          id: 1,
          title: "C",
          status: "Proposed",
          raisedDate: "2026-01-01",
          impactDescription: "<p>impact</p><img src=x onerror=alert(1)>",
          resolutionNotes: "<p>notes</p><script>alert(1)</script>",
        }],
      }),
    );
    expectInert(ws.changes?.[0].impactDescription ?? "", "impact");
    expectInert(ws.changes?.[0].resolutionNotes ?? "", "notes");
  });

  it("neutralizes an already-rich malicious milestone description", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [],
        raid: [],
        milestones: [{ id: 1, name: "M", date: "2026-01-01", description: "<p>gate</p><img src=x onerror=alert(1)>" }],
      }),
    );
    expectInert(ws.milestones?.[0].description ?? "", "gate");
  });

  it("leaves already-clean register rich fields byte-identical", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        tasks: [],
        raid: [{ id: 1, category: "Risk", title: "R", status: "Open", mitigation: "<p>Escalate <strong>now</strong></p>" }],
        milestones: [{ id: 1, name: "M", date: "2026-01-01", description: "<p>Gate <em>two</em></p>" }],
      }),
    );
    expect(ws.raid[0].mitigation).toBe("<p>Escalate <strong>now</strong></p>");
    expect(ws.milestones?.[0].description).toBe("<p>Gate <em>two</em></p>");
  });

  // ★★★ `sanitizeChangeItem` builds from an explicit field list and is DOM-free,
  //   so it DROPS `noteLog`. RAID's JSON branch never calls its sanitizer and so
  //   needs nothing; the changes branch does, and without `withStoredNoteLog`
  //   every note on every change is destroyed by an ordinary file load.
  it("preserves a change noteLog through jsonToWorkspace", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [], raid: [],
      changes: [{ id: 1, title: "Scope cut", status: "Proposed", type: "Scope",
        raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
        noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>kept</p>", text: "kept" }] }],
    }));
    expect(ws.changes?.[0].noteLog).toHaveLength(1);
    expect(ws.changes?.[0].noteLog?.[0].text).toBe("kept");
  });

  // ★★★ The ORDER half of the fix: the raw array is re-attached BEFORE the rich
  //   pass, so `sanitizeChangeRichFields` still runs `sanitizeNoteLog` over it.
  //   Attaching after that pass would store an untrusted file's HTML verbatim.
  it("sanitizes a change noteLog arriving through jsonToWorkspace", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [], raid: [],
      changes: [{ id: 1, title: "x", status: "Proposed", type: "Scope",
        raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
        noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<script>alert(1)</script><p>ok</p>", text: "ok" }] }],
    }));
    expect(ws.changes?.[0].noteLog?.[0].html).not.toContain("script");
    expectInert(ws.changes?.[0].noteLog?.[0].html ?? "", "ok");
  });
});

describe("jsonToWorkspace strict mode", () => {
  it("throws WorkspaceParseError on truncated JSON in strict mode", () => {
    expect(() => jsonToWorkspace('{"tasks":[', { strict: true })).toThrow(WorkspaceParseError);
  });
  it("throws on wrong shape (missing tasks/raid) in strict mode", () => {
    expect(() => jsonToWorkspace('{"foo":1}', { strict: true })).toThrow(WorkspaceParseError);
    expect(() => jsonToWorkspace("[]", { strict: true })).toThrow(WorkspaceParseError);
  });
  it("forgiving default still returns empty on garbage (back-compat)", () => {
    expect(jsonToWorkspace('{"tasks":[').tasks).toEqual([]);
    expect(jsonToWorkspace('{"foo":1}').tasks).toEqual([]);
  });
  it("valid workspace round-trips identically in strict mode", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(jsonToWorkspace(json, { strict: true }).tasks).toEqual([]);
    expect(jsonToWorkspace(json, { strict: true }).raid).toEqual([]);
  });
});

describe("workspace fieldVisibility envelope", () => {
  it("omits fieldVisibility from JSON when undefined (byte-stability)", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(JSON.parse(json)).not.toHaveProperty("fieldVisibility");
  });
  it("round-trips a fieldVisibility config", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { milestone: { fields: ["name", "targetDate"] } } };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.fieldVisibility?.milestone.fields).toEqual(["name", "targetDate"]);
  });
  it("sanitizes junk fieldVisibility on read to undefined", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), fieldVisibility: "bad" });
    expect(jsonToWorkspace(raw).fieldVisibility).toBeUndefined();
  });
});

describe("workspace features (per-project)", () => {
  it("omits features from JSON when undefined (byte-stability)", () => {
    expect(JSON.parse(workspaceToJson(emptyWorkspace()))).not.toHaveProperty("features");
  });
  it("round-trips a features array including explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "budget"] as const };
    // sanitizeFeatures returns ids in registry order (budget precedes raid).
    expect(jsonToWorkspace(workspaceToJson(ws)).features).toEqual(["budget", "raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(jsonToWorkspace(workspaceToJson(simple)).features).toEqual([]); // empty preserved, NOT all
  });
  it("legacy JSON with no features key stays undefined (not all-modules)", () => {
    const json = JSON.stringify(JSON.parse(workspaceToJson(emptyWorkspace()))); // no features key
    expect(jsonToWorkspace(json).features).toBeUndefined();
  });
  it("sanitizes junk feature ids on read", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), features: ["raid", "nope"] });
    expect(jsonToWorkspace(raw).features).toEqual(["raid"]);
  });
});

describe("isWorkspaceEmpty excludes activityLog (inverse of the documents rule)", () => {
  it("a workspace holding ONLY activity entries is still EMPTY (inverse of documents)", () => {
    // ★ documents deliberately COUNT toward non-empty; activityLog must NOT.
    //   The log is auto-appended by ordinary use, so counting it would let a
    //   transient empty backend read replace a populated project — turning a
    //   data-loss GUARD into a data-loss VECTOR. See the comment at the
    //   isWorkspaceEmpty call site.
    const ws = {
      tasks: [],
      activityLog: [
        { id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] },
      ],
    } as unknown as Workspace;
    expect(isWorkspaceEmpty(ws)).toBe(true);
  });
});

describe("activityLog JSON write path", () => {
  it("round-trips activityLog through JSON", () => {
    const log = [
      { id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] },
    ];
    const ws = { ...emptyWorkspace(), activityLog: log };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.activityLog).toEqual(log);
  });

  it("omits the activityLog key entirely when the log is empty", () => {
    const ws = { ...emptyWorkspace(), activityLog: [] };
    expect(JSON.parse(workspaceToJson(ws))).not.toHaveProperty("activityLog");
  });
});

/** Envelope with the minimum jsonToWorkspace requires (`tasks`/`raid` arrays)
 *  plus an arbitrary `activityLog` value under test. */
function wsWithActivityLog(activityLog: unknown): string {
  return JSON.stringify({ tasks: [], raid: [], activityLog });
}

// Moved from activity-log.test.ts's retired loadActivityLog/saveActivityLog
// suite (Task 12, activity-log-workspace-data): the log is validated on load
// by `sanitizeActivityLog` now (called from `jsonToWorkspace`), not by the
// localStorage-only `isActivityEntry`/`normalizeEntryChanges` that used to
// gate `loadActivityLog`. Every property carried over EXCEPT the unknown-kind
// rule, which was deliberately inverted for shared workspace data — see the
// forward-compat test below.
describe("activityLog sanitize-and-cap on load", () => {
  it.each([
    ["non-array (string)", "x"],
    ["non-array (number)", 5],
    ["non-array (object)", {}],
  ])("drops a non-array activityLog value: %s", (_label, value) => {
    const ws = jsonToWorkspace(wsWithActivityLog(value));
    expect(ws.activityLog).toBeUndefined();
  });

  it("drops entries missing id/timestamp/args-shape or with an empty id, keeps the rest", () => {
    const mixed = [
      { id: "1", timestamp: "2026-06-02T00:00:00.000Z", kind: "task.created", args: [] }, // valid
      { id: "3", kind: "task.created", args: [] }, // missing timestamp
      { id: "4", timestamp: "t", kind: "task.created", args: "nope" }, // args not array
      { timestamp: "t", kind: "task.created", args: [] }, // missing id
      { id: "", timestamp: "t", kind: "task.created", args: [] }, // empty-string id
      { id: "9", timestamp: "2026-06-02T00:00:00.000Z", kind: "jira.sync", args: [] }, // valid
    ];
    const ws = jsonToWorkspace(wsWithActivityLog(mixed));
    expect((ws.activityLog ?? []).map((e) => e.id)).toEqual(["1", "9"]);
  });

  // ★★★ DELIBERATE divergence from the retired loadActivityLog, whose
  // `isActivityEntry` dropped an entry whose `kind` was not a known
  // ActivityKind. That was right for a device-local localStorage blob and is
  // WRONG for shared workspace data: the loaded log becomes app state and the
  // autosave writes it straight back, so an older client dropping a kind a
  // newer release added would DELETE those entries from the shared project.
  // An unknown but well-formed (string) kind is therefore KEPT verbatim and
  // rendered generically by the panel — see `activityMessageKey`.
  it("keeps an entry whose `kind` is not a known ActivityKind (forward-compat)", () => {
    const ws = jsonToWorkspace(
      wsWithActivityLog([{ id: "2", timestamp: "2026-06-02T00:00:00.000Z", kind: "not.a.kind", args: [] }]),
    );
    expect((ws.activityLog ?? []).map((e) => e.id)).toEqual(["2"]);
    expect(ws.activityLog?.[0].kind).toBe("not.a.kind");
  });

  // The other half of forward-compat: a field a NEWER release added to
  // ActivityEntry must survive an older client's load+save round trip, so the
  // sanitizer passes an untouched entry through by REFERENCE rather than
  // rebuilding it from a known-field list.
  it("preserves an unknown extra key on an otherwise-valid entry", () => {
    const ws = jsonToWorkspace(
      wsWithActivityLog([
        { id: "2", timestamp: "2026-06-02T00:00:00.000Z", kind: "task.created", args: [], futureField: 7 },
      ]),
    );
    expect((ws.activityLog?.[0] as unknown as { futureField?: number }).futureField).toBe(7);
  });

  // Malformed — not forward-compat. A non-string `kind` has no honest
  // rendering (`activityGroupOf` calls `kind.startsWith`), so it is dropped.
  it.each([
    ["missing kind", { id: "b", timestamp: "2026-06-02T00:00:00.000Z", args: ["Y"] }],
    ["numeric kind", { id: "c", timestamp: "2026-06-02T00:00:00.000Z", kind: 42, args: ["Z"] }],
    ["null kind", { id: "d", timestamp: "2026-06-02T00:00:00.000Z", kind: null, args: ["Z"] }],
  ])("drops an entry with a malformed kind: %s", (_label, bad) => {
    const good = { id: "ok", timestamp: "2026-06-02T00:00:00.000Z", kind: "task.created", args: [] };
    const ws = jsonToWorkspace(wsWithActivityLog([bad, good]));
    expect((ws.activityLog ?? []).map((e) => e.id)).toEqual(["ok"]);
  });

  it("caps a too-large activityLog to the newest ACTIVITY_MAX_ENTRIES", () => {
    const big = Array.from({ length: ACTIVITY_MAX_ENTRIES + 100 }, (_, i) => ({
      id: String(i + 1),
      timestamp: "2026-06-02T00:00:00.000Z",
      kind: "task.created" as const,
      args: [],
    }));
    const ws = jsonToWorkspace(wsWithActivityLog(big));
    expect(ws.activityLog).toHaveLength(ACTIVITY_MAX_ENTRIES);
    expect(ws.activityLog?.[0].id).toBe("101"); // "1".."100" dropped
  });

  it("rejects a legacy numeric-id entry (globally-unique STRING ids only)", () => {
    const ws = jsonToWorkspace(
      wsWithActivityLog([{ id: 1, timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["T-1"] }]),
    );
    expect(ws.activityLog).toBeUndefined();
  });

  it("round-trips a changes-bearing entry", () => {
    const changes = [{ field: "owner", from: "Ada", to: "Grace" }];
    const log = [
      { id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "raid.updated" as const, args: [5], changes },
    ];
    const ws = jsonToWorkspace(workspaceToJson({ ...emptyWorkspace(), activityLog: log }));
    expect(ws.activityLog?.[0].changes).toEqual(changes);
  });

  // A malformed `changes` payload is CORRUPTION, not forward-compat: the
  // panel renders `entry.changes.map(...)` and `c.field`/`c.from`/`c.to` as
  // React children, so a non-array — or an array of non-FieldChange objects —
  // throws. The rest of the entry is still a real audit record, so the payload
  // is stripped and the entry KEPT (the retired `normalizeEntryChanges` did
  // the same).
  it.each([
    ["non-array (string)", "nope"],
    ["non-array (object)", { field: "a", from: "b", to: "c" }],
    ["array of non-objects", ["nope"]],
    ["array of wrong-shaped objects", [{ field: 1, from: null }]],
    ["array with one bad element", [{ field: "a", from: "b", to: "c" }, { field: 1 }]],
  ])("strips a malformed `changes` payload but keeps the entry: %s", (_label, changes) => {
    const ws = jsonToWorkspace(
      wsWithActivityLog([
        { id: "1", timestamp: "2026-01-01T00:00:00.000Z", kind: "task.updated", args: ["T"], changes },
      ]),
    );
    expect((ws.activityLog ?? []).map((e) => e.id)).toEqual(["1"]);
    expect((ws.activityLog ?? [])[0]?.changes).toBeUndefined();
    // The rest of the record survives the strip.
    expect((ws.activityLog ?? [])[0]?.args).toEqual(["T"]);
  });

  it("keeps a well-formed `changes` payload untouched", () => {
    const changes = [{ field: "owner", from: "Ada", to: "Grace" }];
    const ws = jsonToWorkspace(
      wsWithActivityLog([
        { id: "1", timestamp: "2026-01-01T00:00:00.000Z", kind: "task.updated", args: [], changes },
      ]),
    );
    expect((ws.activityLog ?? [])[0]?.changes).toEqual(changes);
  });
});

describe("documentAssets JSON round-trip", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips documentAssets through JSON", () => {
    const json = workspaceToJson({ ...emptyWorkspace(), documentAssets: [asset] });
    expect(jsonToWorkspace(json).documentAssets?.[0]).toEqual(asset);
  });

  it("omits the key entirely when there are no assets (byte-stable)", () => {
    expect(workspaceToJson(emptyWorkspace())).not.toContain("documentAssets");
  });

  it("drops garbage rows individually rather than failing the load", () => {
    // jsonToWorkspace requires the tasks/raid envelope (see wsWithActivityLog
    // above) or it treats the input as malformed and returns emptyWorkspace().
    const json = JSON.stringify({ tasks: [], raid: [], documentAssets: [asset, { name: "no id" }, null] });
    expect(jsonToWorkspace(json).documentAssets).toHaveLength(1);
  });

  // ★★ isWorkspaceEmpty feeds the LOAD guard that refuses an incoming empty
  //    workspace. Metadata alone must NOT make a workspace look non-empty —
  //    otherwise a workspace holding only orphaned metadata defeats the guard.
  it("does not count toward isWorkspaceEmpty", () => {
    expect(isWorkspaceEmpty({ ...emptyWorkspace(), documentAssets: [asset] })).toBe(true);
  });
});
