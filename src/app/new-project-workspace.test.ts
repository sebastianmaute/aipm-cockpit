import { describe, expect, it } from "vitest";
import { sanitizeAiRichText } from "./ai-rich-text";
import { buildNewProjectWorkspace } from "./new-project-workspace";
import { appendSeed } from "./template-apply";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { ProjectMeta } from "./types";
import type { Workspace } from "./workspace";

const tpl: ProjectTemplate = {
  id: "t",
  name: "T",
  features: ["raid"],
  fieldVisibility: { task: { fields: ["taskName"] } },
  seed: {
    tasks: [
      {
        id: 1,
        taskName: "S",
        assignee: "",
        assigneeEmail: "",
        dueDate: "",
        lastUpdateDate: "",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        description: "",
        dependencies: [],
      },
    ],
  },
};

const meta: ProjectMeta = {
  name: "P",
  code: "P-1",
  projectManager: "PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "C",
  naceSection: "C",
  identityTypes: [],
  products: "",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "PC",
  contactPersons: [],
  regulatory: [],
};

describe("buildNewProjectWorkspace", () => {
  it("applies template field-visibility + seed + configured features", () => {
    const ws = buildNewProjectWorkspace(meta, {
      template: tpl,
      features: ["raid", "budget"],
      includeSeed: true,
    });
    expect(ws.project).toEqual(meta);
    expect(ws.fieldVisibility?.task.fields).toEqual(["taskName"]); // from template
    expect(ws.tasks).toHaveLength(1); // seed appended
    expect(ws.features).toEqual(["raid", "budget"]); // configured (overrides template's)
  });

  it("blank: no template → default field-visibility, configured features, no seed", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: false });
    expect(ws.fieldVisibility).toBeUndefined();
    expect(ws.features).toEqual([]);
    expect(ws.tasks).toHaveLength(0);
  });

  it("no opts → today's behavior (no features override)", () => {
    const ws = buildNewProjectWorkspace(meta, {});
    expect(ws.features).toBeUndefined();
    expect(ws.fieldVisibility).toBeUndefined();
  });
});

const aiSeed: TemplateSeed = {
  milestones: [{ id: 1, name: "Go-live", date: "2026-12-01", linkedTaskIds: [] }],
};

describe("buildNewProjectWorkspace aiSeed", () => {
  it("appends aiSeed when Blank + includeSeed", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(true);
  });

  it("ignores aiSeed when includeSeed is false", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: false, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });

  it("ignores aiSeed when a template is chosen (template seed wins)", () => {
    const ws = buildNewProjectWorkspace(meta, {
      template: { id: "t", name: "T", features: [], fieldVisibility: {} } as never,
      features: [],
      includeSeed: true,
      aiSeed,
    });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });
});

const HOSTILE = "<p>ok</p><script>alert(1)</script>";

/** A seed shaped like one `proposalToSeed` returns, carrying a hostile rich
 *  field on each of the three entities that reach the workspace without an
 *  allow-list pass today (§288) — the AI-seed branch of
 *  `buildNewProjectWorkspace` runs `appendSeed(ws, remapSeed(ws, opts.aiSeed))`
 *  directly, never through `applyTemplate`, which is the only place the four
 *  allow-list passes (`allowListRich`/`allowListRaid`/`allowListChange`/the
 *  milestone one) live. */
function hostileSeed() {
  return {
    // ★★ A TASK ROW IS PRESENT ON PURPOSE. A cold review found the first cut of
    // this fixture carried raid/changes/milestones only — while the
    // double-application hazard the idempotency block below defends occurs on
    // the TASK path and NOWHERE ELSE: `proposalToSeed` builds RAID, changes and
    // milestones through `sanitizeRaidItem`/`sanitizeChangeItem`/
    // `sanitizeMilestone` (upgrade-only), and only `buildSeedTask` reaches
    // `sanitizeAiRichText`. Without this row the suite pinned
    // `sanitizeRichHtml ∘ sanitizeRichHtml` on a raw string and claimed cover
    // of a composition it never ran.
    tasks: [{ id: 1, name: "T", description: HOSTILE }],
    raid: [{ id: 1, title: "R", description: HOSTILE, mitigation: HOSTILE }],
    changes: [{ id: 1, title: "C", description: HOSTILE, impactDescription: HOSTILE, resolutionNotes: HOSTILE }],
    milestones: [{ id: 1, name: "M", description: HOSTILE }],
  } as never;
}

describe("buildNewProjectWorkspace — the AI-seed branch is allow-listed (§288)", () => {
  it("strips a script element from a seeded RAID description", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.raid[0].description).not.toContain("<script");
  });

  it("strips a script element from a seeded RAID mitigation", () => {
    // ★ SEPARATE it() ON PURPOSE. vitest aborts at the first failing hard
    // assertion, so a second expect in the block above would be UNPROVED on a
    // tree where the first one fails — which is exactly the tree this suite is
    // written against.
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.raid[0].mitigation).not.toContain("<script");
  });

  it("strips a script element from a seeded change's three rich fields", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    const c = ws.changes![0];
    expect([c.description, c.impactDescription, c.resolutionNotes].join("")).not.toContain("<script");
  });

  it("strips a script element from a seeded milestone description", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.milestones![0].description).not.toContain("<script");
  });

  it("strips a script element from a seeded task description", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.tasks[0].description).not.toContain("<script");
  });

  it("seeds the rows at all (anti-vacuity)", () => {
    // ★★ WITHOUT THIS, every assertion above would fail OPAQUELY on an empty
    // workspace rather than legibly: `ws.raid[0]` is `undefined`, so
    // `.description` throws a TypeError before `expect` is ever reached, and
    // even a present-row/absent-field case throws inside `toContain`, which
    // has no null guard. So this does NOT rescue the block from a silently
    // green vacuous pass — that shape cannot occur here. What it buys is a
    // legible failure and an exact row count.
    // ★ An earlier revision of this comment claimed the assertions above
    // "pass on an empty workspace". They do not; they throw. A false
    // justification reads as protection and stops the next audit, which is
    // why the wording is corrected rather than the test deleted.
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.tasks).toHaveLength(1);
    expect(ws.raid).toHaveLength(1);
    expect(ws.changes).toHaveLength(1);
    expect(ws.milestones).toHaveLength(1);
  });
});

/** Minimal Workspace carrying just the seven arrays `appendSeed` reads
 *  (tasks/milestones/raid/changes/stakeholders/budgets/resources) — kept
 *  narrow on purpose so this idempotency check does not depend on
 *  `emptyWorkspace()`'s full shape. */
function emptyLike(): Workspace {
  return {
    tasks: [],
    raid: [],
    milestones: [],
    changes: [],
    stakeholders: [],
    budgets: [],
    resources: [],
  } as never;
}

describe("appendSeed — the allow-list is idempotent (§288)", () => {
  // Mutation record (§288 reorder verification): reverting `allowListSeed`'s
  // `raid` line to a pass-through (`if (out.raid) out = { ...out, raid:
  // out.raid };`) turned red FOUR tests IN THIS FILE — "strips a script element
  // from a seeded RAID description"/"...mitigation" (module-level describe
  // above), "actually changed something on the FIRST application
  // (anti-vacuity)" below, AND "leaves the template branch's output
  // unchanged" (the describe below this one) — one mutant, four assertions,
  // none of them individually proved by it alone.
  // ★★ THAT COUNT IS FILE-SCOPED, and saying "four" without saying so reads
  // as a whole-suite result. Suite-wide the same mutant also reddens the
  // three RAID cases in `template-apply.allowlist.test.ts` (description,
  // mitigation, note-log entry), which route through `applyTemplate` into the
  // same `allowListSeed` raid line — so at least SEVEN, not four. The
  // calibration this record exists to give is the ratio, so the scope has to
  // travel with the number.
  // "produces identical bytes
  // on a second application" stayed GREEN under that mutant (a no-op
  // pass-through is trivially idempotent), which is exactly why the
  // anti-vacuity test exists beside it.
  // ★★ STATED PLAINLY: that leaves "produces identical bytes on a second
  // application" backed by NO mutant — it is UNPROVED, not mutation-proved.
  // Killing it needs a NON-IDEMPOTENT allow-list, which no single-token edit
  // to `allowListSeed` produces; the mutation would have to go into
  // `sanitizeRichHtml` itself. Recorded rather than left to be inferred from
  // the green run, because an assertion nobody has tried to break reads
  // exactly like one that survived an attempt.

  // ★★★ THIS IS A PRECONDITION OF THE FIX, NOT A NICE-TO-HAVE. An AI-seeded
  // task already met `sanitizeAiRichText` in `buildSeedTask` and now meets
  // `allowListRich` as well. If a second pass altered the bytes, seeding would
  // corrupt exactly the content it is meant to protect.
  const seeded = () =>
    ({ raid: [{ id: 1, title: "R", description: HOSTILE }] }) as never;

  it("produces identical bytes on a second application", () => {
    const base = emptyLike();
    const once = appendSeed(base, seeded());
    const twice = appendSeed(base, { raid: once.raid } as never);
    expect(twice.raid[0].description).toBe(once.raid[0].description);
  });

  it("actually changed something on the FIRST application (anti-vacuity)", () => {
    // ★★ Without this, a no-op allow-list would satisfy the idempotency test
    // perfectly — two identical no-ops agree.
    const base = emptyLike();
    const once = appendSeed(base, seeded());
    expect(once.raid[0].description).not.toContain("<script");
  });

  it("leaves an already-AI-sanitised TASK description byte-identical", () => {
    // ★★★ THIS IS THE PRODUCTION COMPOSITION, and the two tests above are not.
    // A cold review found they pin `sanitizeRichHtml ∘ sanitizeRichHtml` on a
    // RAW string, while the hazard being defended is the TASK path: only
    // `buildSeedTask` reaches `sanitizeAiRichText`, so only a task description
    // arrives at `allowListRich` having ALREADY been sanitised. RAID, changes
    // and milestones come from the upgrade-only `sanitize*Item` helpers and
    // meet the allow-list for the first time inside `appendSeed`.
    const aiClean = sanitizeAiRichText(HOSTILE);
    const ws = appendSeed(emptyLike(), {
      tasks: [{ id: 1, name: "T", description: aiClean }],
    } as never);
    expect(ws.tasks[0].description).toBe(aiClean);
  });

  it("and that task fixture was genuinely altered by the AI pass (anti-vacuity)", () => {
    // ★★ Separate it() — vitest aborts at the first failing hard assertion.
    // Without this, a `sanitizeAiRichText` that returned its input unchanged
    // would make the byte-identity assertion above trivially true.
    expect(sanitizeAiRichText(HOSTILE)).not.toBe(HOSTILE);
    expect(sanitizeAiRichText(HOSTILE)).not.toContain("<script");
  });
});

describe("buildNewProjectWorkspace — the template branch's allow-list survived the reorder (§288)", () => {
  it("leaves the template branch's output unchanged", () => {
    // The passes MOVED (from `applyTemplate` into `appendSeed`); template
    // behaviour must not. `raidTpl` is shadowed distinctly from the
    // module-level `tpl` above so the two fixtures don't get confused.
    // ★★ READ THE SCOPE, which an earlier revision of this comment overstated
    // as "the pin a template-path regression would trip": these two assertions
    // pin only that the allow-list STILL RUNS on the template path and that
    // the row survives. A template regression in anything else the reorder
    // could touch — note-log `text` re-derivation, ordering — passes this
    // untouched. The broader template contract is `template-apply.test.ts`'s
    // job, not this pin's.
    const raidTpl: ProjectTemplate = {
      id: "t-raid",
      name: "T",
      features: [],
      fieldVisibility: {},
      seed: { raid: [{ id: 1, title: "R", description: HOSTILE }] } as never,
    };
    const ws = buildNewProjectWorkspace(meta, { template: raidTpl, includeSeed: true });
    expect(ws.raid[0].description).not.toContain("<script");
    expect(ws.raid).toHaveLength(1);
  });
});
