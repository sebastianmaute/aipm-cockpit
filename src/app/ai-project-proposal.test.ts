import { describe, expect, it } from "vitest";
import {
  parseProposal,
  PROPOSAL_TOOL,
  proposalToDraftPatch,
  proposalToSeed,
  seedHasContent,
  SEED_CAP_PER_ENTITY,
} from "./ai-project-proposal";
import { ALL_MODULE_IDS } from "./feature-modules";
import { remapSeed } from "./template-apply";
import { emptyWorkspace } from "./workspace";

describe("parseProposal", () => {
  it("returns null for a non-object or missing name", () => {
    expect(parseProposal(null)).toBeNull();
    expect(parseProposal({ meta: {}, features: [] })).toBeNull();
    expect(parseProposal({ meta: { name: "   " }, features: [] })).toBeNull();
  });

  it("keeps a valid proposal and drops unknown feature ids", () => {
    const p = parseProposal({
      meta: { name: "CRM Migration", products: "Salesforce" },
      features: [ALL_MODULE_IDS[0], "not-a-module", ALL_MODULE_IDS[1]],
      seed: { milestones: [{ name: "Go-live", date: "2026-12-01" }] },
    });
    expect(p).not.toBeNull();
    expect(p!.meta.name).toBe("CRM Migration");
    expect(p!.features).toEqual([ALL_MODULE_IDS[0], ALL_MODULE_IDS[1]]);
    expect(p!.seed?.milestones?.length).toBe(1);
  });

  it("passes the model's seed resources through (so the directory gets seeded)", () => {
    const p = parseProposal({
      meta: { name: "CRM Migration" },
      features: [],
      seed: {
        resources: [{ firstName: "Ada", lastName: "Lovelace", email: "ada@x.io" }],
        tasks: [{ taskName: "Kickoff", assignee: "Ada Lovelace" }],
      },
    });
    expect(p).not.toBeNull();
    expect(p!.seed?.resources).toHaveLength(1);
    expect(p!.seed?.resources?.[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
  });
});

describe("PROPOSAL_TOOL", () => {
  it("forces a single structured tool named propose_project", () => {
    expect(PROPOSAL_TOOL.name).toBe("propose_project");
    expect(PROPOSAL_TOOL.input_schema.type).toBe("object");
    expect(PROPOSAL_TOOL.input_schema.properties.meta).toBeDefined();
    expect(PROPOSAL_TOOL.input_schema.properties.features).toBeDefined();
  });
});

const TODAY = "2026-06-19";

describe("proposalToDraftPatch", () => {
  it("maps known meta fields to draft string fields", () => {
    const patch = proposalToDraftPatch({
      meta: { name: "Alpha", products: "Widget", customer: "ACME", startDate: "2026-07-01" },
      features: [],
    });
    expect(patch.name).toBe("Alpha");
    expect(patch.products).toBe("Widget");
    expect(patch.customer).toBe("ACME");
    expect(patch.startDate).toBe("2026-07-01");
    // Unsupplied fields are absent (not "")
    expect("jiraUrl" in patch).toBe(false);
  });

  it("keeps a safe http(s) jiraUrl but drops a javascript: URL from model output", () => {
    expect(
      proposalToDraftPatch({ meta: { name: "X", jiraUrl: "https://acme.atlassian.net" }, features: [] }).jiraUrl,
    ).toBe("https://acme.atlassian.net");
    const unsafe = proposalToDraftPatch({ meta: { name: "X", jiraUrl: "javascript:alert(1)" }, features: [] });
    expect("jiraUrl" in unsafe).toBe(false);
  });
});

describe("proposalToSeed", () => {
  it("validates, assigns ids, and caps each list", () => {
    const many = Array.from({ length: SEED_CAP_PER_ENTITY + 4 }, (_, i) => ({ title: `Risk ${i}`, category: "R" }));
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { raid: many } }, TODAY);
    expect(seed?.raid?.length).toBe(SEED_CAP_PER_ENTITY);
    expect(seed?.raid?.every((r) => r.id > 0)).toBe(true);
  });

  it("drops records that fail sanitization (e.g. milestone without a date)", () => {
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { milestones: [{ name: "No date" }, { name: "Good", date: "2026-08-01" }] } },
      TODAY,
    );
    expect(seed?.milestones?.length).toBe(1);
    expect(seed?.milestones?.[0]?.name).toBe("Good");
  });

  it("stores a model-supplied HTML note as HTML, not escaped into visible tags", () => {
    // ★★★ This is the most attacker-influenceable input in the app: the model's
    // propose_project output, fed from a user-uploaded PDF / SharePoint file /
    // Confluence page. The boundary used plainToHtml, which escapes & < >, so any
    // HTML the model emitted was stored as literal tags — visible in the editor,
    // every export and the search index, on a project the user has just created.
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { tasks: [{ taskName: "Kickoff", notes: "<p>Agree <strong>goals</strong></p>" }] } },
      TODAY,
    );
    expect(seed?.tasks?.[0]?.description).toBe("<p>Agree <strong>goals</strong></p>");
    expect(seed?.tasks?.[0]?.description).not.toContain("&lt;");
  });

  it("still upgrades a PLAIN model note, escaping its angle brackets", () => {
    // The common case, and the half the fix must not break: prose stays prose.
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { tasks: [{ taskName: "K", notes: "cost < 5k\nline two" }] } },
      TODAY,
    );
    expect(seed?.tasks?.[0]?.description).toBe("<p>cost &lt; 5k<br>line two</p>");
  });

  it("builds seed tasks with today's lastUpdateDate", () => {
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { tasks: [{ taskName: "Kickoff" }] } }, TODAY);
    expect(seed?.tasks?.[0]?.taskName).toBe("Kickoff");
    expect(seed?.tasks?.[0]?.lastUpdateDate).toBe(TODAY);
  });

  it("builds sanitized seed resources (directory entries), keeping the external flag", () => {
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { resources: [
        { firstName: "Ada", lastName: "Lovelace", email: "ada@x.io", isExternal: true, title: "Engineer" },
        { email: "noname@x.io" }, // no first/last name → dropped by the sanitizer
      ] } },
      TODAY,
    );
    expect(seed?.resources).toHaveLength(1);
    expect(seed?.resources?.[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace", isExternal: true });
  });

  it("returns undefined when there is no usable seed content", () => {
    expect(proposalToSeed({ meta: { name: "x" }, features: [] }, TODAY)).toBeUndefined();
    expect(seedHasContent(undefined)).toBe(false);
  });
});

describe("proposalToSeed — only the properties PROPOSAL_TOOL offered", () => {
  // ★★★ The four buildList lists spread the raw model item into their entity's
  //  LOAD sanitizer, which preserves far more than the seed schema declares. A
  //  forced propose_project call could therefore set any persisted column —
  //  `outlookEventId`, `localModifiedAt`, `inquiriesSent`, `decisionDate` — none
  //  of which the model was ever offered. `tasks`/`resources` are immune by
  //  construction (their builders assemble a literal from named fields).
  //
  // ★ The smuggled key names below are written out BY HAND on purpose. Deriving
  //  them from PROPOSAL_TOOL, as the fix does, would make this test tautological:
  //  it must fail if the derivation is widened, so it cannot share it.
  const SMUGGLED: Readonly<Record<string, readonly string[]>> = {
    // ★ `owner` and `ownerEmail` are NOT here: the seed schema declares BOTH,
    //  because the system prompt asks for them and `remapSeed` links on the pair
    //  (email leg first). They are asserted in the anti-vacuity case below
    //  instead. `targetDate` and `inquiriesSent` are genuinely undeclared.
    raid: ["outlookEventId", "localModifiedAt", "inquiriesSent", "targetDate"],
    changes: ["outlookEventId", "localModifiedAt", "decisionDate", "requestedBy"],
    milestones: ["outlookEventId", "localModifiedAt", "achievedDate", "knowledgeLinks"],
    // ★ `knowledgeLinks` here is reached from a `documentLinks` INPUT key — the
    //  sanitizer reads `knowledgeLinks ?? documentLinks`. The allowlist filters
    //  on the key the model SENDS, which is the case a denylist of stored column
    //  names would miss, so both spellings are exercised.
    // ★ `email` is NOT here either, and for the raid reason exactly: the schema
    //  declares it so `linkResource(s.name, s.email)` can pick between two
    //  same-named directory rows. Asserted in the anti-vacuity case below.
    stakeholders: ["localModifiedAt", "notes", "resourceId", "knowledgeLinks"],
  };

  function seedWithSmuggledFields() {
    return proposalToSeed(
      {
        meta: { name: "x" },
        features: [],
        seed: {
          raid: [{
            // Declared by the schema:
            title: "Vendor slip", category: "R", description: "<p>late</p>", severity: "High",
            owner: "Ada Lovelace", ownerEmail: "ada@x.io",
            // Never offered:
            id: 999, outlookEventId: "AAMk-forged", localModifiedAt: "2026-01-02T03:04:05Z",
            inquiriesSent: 7, targetDate: "2026-10-10",
          }],
          changes: [{
            title: "Scope cut", description: "<p>trim</p>",
            id: 999, status: "Proposed", type: "Scope", decisionDate: "2026-01-01",
            outlookEventId: "AAMk-forged", localModifiedAt: "2026-01-02T03:04:05Z",
            requestedBy: "Mallory",
          }],
          milestones: [{
            name: "Go-live", date: "2026-12-01",
            id: 999, outlookEventId: "AAMk-forged", localModifiedAt: "2026-01-02T03:04:05Z",
            achievedDate: "2026-11-01", knowledgeLinks: [{ name: "forged", url: "https://x.io" }],
          }],
          stakeholders: [{
            name: "Ada Lovelace", organization: "ACME", title: "CTO", email: "ada@x.io",
            id: 999, localModifiedAt: "2026-01-02T03:04:05Z",
            notes: "smuggled", resourceId: 42,
            documentLinks: [{ name: "forged", url: "https://x.io" }],
          }],
        },
      },
      TODAY,
    );
  }

  it("drops every property the seed schema never offered", () => {
    const seed = seedWithSmuggledFields();
    const rows: Readonly<Record<string, unknown>> = {
      raid: seed?.raid?.[0],
      changes: seed?.changes?.[0],
      milestones: seed?.milestones?.[0],
      stakeholders: seed?.stakeholders?.[0],
    };
    // ★ ONE assertion over all four lists, deliberately. A per-list expect in a
    //  loop aborts at the first failure, so three of the four would go
    //  unexecuted on a red run and could not be said to be covered.
    expect(Object.keys(rows).filter((k) => rows[k] === undefined), "rows missing").toEqual([]);
    const landed = Object.fromEntries(
      Object.entries(SMUGGLED).map(([list, forbidden]) => [
        list,
        forbidden.filter((k) => k in ((rows[list] ?? {}) as Record<string, unknown>)),
      ]),
    );
    expect(landed).toEqual({ raid: [], changes: [], milestones: [], stakeholders: [] });
  });

  it("keeps a seeded change's status/decisionDate pair consistent", () => {
    // `applyChangeStatus` — the sole holder of the status ⟺ decisionDate pair —
    // never runs on this path, so a model-supplied date on a PENDING status
    // produced exactly the inconsistency it exists to prevent.
    const change = seedWithSmuggledFields()?.changes?.[0];
    expect(change?.status).toBe("Proposed");
    expect(change?.decisionDate).toBeUndefined();
    // `type` is not offered either, so it falls back rather than taking "Scope".
    expect(change?.type).toBe("Other");
  });

  it("still stores every property the schema DOES offer", () => {
    // Anti-vacuity: a filter that dropped everything would satisfy the two
    // absence tests above. Each declared field must survive with its value.
    const seed = seedWithSmuggledFields();
    expect(seed?.raid?.[0]).toMatchObject({
      title: "Vendor slip", category: "R", description: "<p>late</p>", severity: "High",
      // ★★ `owner` is the field this block exists to protect. The prompt asks
      //  for it and `remapSeed`'s `linkResource(r.owner, r.ownerEmail)` is the
      //  only thing that turns a seeded name into a directory FK; while it was
      //  undeclared the filter stripped it and `ownerResourceId` was null on
      //  every AI seed.
      owner: "Ada Lovelace",
      // ★★ `ownerEmail` must survive WITH ITS VALUE for the same reason and one
      //  more: `linkResource` tries the EMAIL leg FIRST, so it is the only thing
      //  that can tell apart two seeded people sharing a display name. It used
      //  to be asserted ABSENT here, on the false ground that the name leg links
      //  everything — a stripped address left the FK WRONG, not missing. The
      //  disambiguation itself is pinned below, on `remapSeed`.
      ownerEmail: "ada@x.io",
    });
    expect(seed?.changes?.[0]).toMatchObject({ title: "Scope cut", description: "<p>trim</p>" });
    expect(seed?.milestones?.[0]).toMatchObject({ name: "Go-live", date: "2026-12-01" });
    expect(seed?.stakeholders?.[0]).toMatchObject({
      name: "Ada Lovelace", organization: "ACME", title: "CTO",
      // ★★ Same story as `raid.ownerEmail` one list up, through the same
      //  `linkResource`: it used to be asserted ABSENT here on the false ground
      //  that the name leg links everything. A stripped address left the
      //  stakeholder's `resourceId` WRONG, not missing.
      email: "ada@x.io",
    });
  });

  /** ★★★ THE MIRROR OF `inline-ai-edit/plan.create-path-guards.test.ts`'s "names
   *  every create tool that exists, so a new one cannot slip past", and the seed
   *  side had no such case. Every assertion above is driven off `SMUGGLED`, so
   *  `SMUGGLED` is the vacuity surface: a SEVENTH seed list added to
   *  `PROPOSAL_TOOL` gets a `buildList` call with no offered set — or a
   *  hand-rolled `buildSeedX` literal that filters nothing — and every case
   *  above stays green while saying nothing about it.
   *
   *  ★★ IT ENUMERATES, IT DOES NOT FILTER, and the difference is the whole
   *  point. A predicate that quietly skipped anything unrecognised would let a
   *  new list through by default; an EQUALITY against (filtered ∪ named
   *  non-participants) makes a new list RED until someone decides which side it
   *  belongs on. That decision is the deliverable, not the green run.
   *
   *  ★ The axis is `PROPOSAL_TOOL`'s own seed schema — the same object
   *  `SEED_OFFERED_KEYS` is `Object.keys`'d from, so the two key sets cannot
   *  disagree and a list added to the schema is visible here the same day. */
  const NOT_FILTERED = [
    // `buildSeedResource` reads eleven NAMED fields off `raw` into an object
    // literal and never spreads it, so no undeclared key can reach
    // `sanitizeResource` and a filter would be unreachable code that READS as a
    // guard — structurally the same argument `create_task` makes on the create
    // path (`chat-tools-updates.ts`).
    "resources",
    // `buildSeedTask` does the same over its own named fields. That is also why
    // `assignee` survives here while `raid.owner` did not: same prompt sentence,
    // opposite outcomes, because only the raid list runs through the filter.
    "tasks",
  ];

  it("names every seed list that exists, so a new one cannot slip past", () => {
    const declared = Object.keys(PROPOSAL_TOOL.input_schema.properties.seed.properties);
    const covered = Object.keys(SMUGGLED).concat(NOT_FILTERED).sort();
    expect(declared.slice().sort()).toEqual(covered);
  });

  it("links a seeded RAID owner to the seeded directory row", () => {
    // ★★★ THE REGRESSION THIS DECLARATION FIXES, pinned where it MANIFESTS.
    //  Asserting `owner` survives `proposalToSeed` (above) proves the filter
    //  permits it; only `remapSeed` proves the field is USED. While `owner` was
    //  undeclared, `linkResource(r.owner, r.ownerEmail)` saw two blanks and
    //  `ownerResourceId` was `null` for every AI-proposed project.
    const seed = proposalToSeed(
      {
        meta: { name: "x" },
        features: [],
        seed: {
          resources: [{ firstName: "Ada", lastName: "Lovelace", email: "ada@x.io" }],
          raid: [{ title: "Vendor slip", category: "R", owner: "Ada Lovelace" }],
        },
      },
      TODAY,
    );
    expect(seed?.resources, "no directory row to link to").toHaveLength(1);
    const out = remapSeed(emptyWorkspace(), seed!);
    expect(out.raid?.[0]?.ownerResourceId).toBe(out.resources?.[0]?.id);
    // …and the FK is a real id, not two undefineds comparing equal.
    expect(out.raid?.[0]?.ownerResourceId).toEqual(expect.any(Number));
    // The plain string is kept too — the register renders it when nothing links.
    expect(out.raid?.[0]?.owner).toBe("Ada Lovelace");
  });

  it("links a seeded RAID owner by EMAIL when two directory rows share a name", () => {
    // ★★★ WHY `ownerEmail` IS DECLARED, and the case the NAME leg cannot cover.
    //  `remapSeed` indexes `resByName` FIRST-WINS, so two seeded people sharing a
    //  display name collapse to whichever the model listed first. `linkResource`
    //  tries the EMAIL leg BEFORE the name, so an address is the only thing that
    //  can select the second one. While the filter stripped `ownerEmail`, the
    //  item bound to the WRONG resource — not to none — and
    //  `resolveRaidOwnerEmail` prefers the LINKED row's address over the cached
    //  one, so "Send inquiry" mailed risk detail to a person the source never
    //  named for this item. A wrong link is worse than an absent one.
    const seed = proposalToSeed(
      {
        meta: { name: "x" },
        features: [],
        seed: {
          resources: [
            { firstName: "Ada", lastName: "Lovelace", email: "ada.first@x.io" },
            { firstName: "Ada", lastName: "Lovelace", email: "ada.second@x.io" },
          ],
          raid: [
            {
              title: "Vendor slip",
              category: "R",
              owner: "Ada Lovelace",
              ownerEmail: "ada.second@x.io",
            },
          ],
        },
      },
      TODAY,
    );
    expect(seed?.resources, "both directory rows must survive").toHaveLength(2);
    const out = remapSeed(emptyWorkspace(), seed!);
    const firstId = out.resources?.[0]?.id;
    const secondId = out.resources?.[1]?.id;
    // ★ Anti-vacuity: the two rows must be TELLABLE APART and the FK must be a
    //  real id, or `toBe` below could pass on two `undefined`s or one shared id.
    expect(firstId).toEqual(expect.any(Number));
    expect(secondId).toEqual(expect.any(Number));
    expect(firstId).not.toBe(secondId);
    expect(out.raid?.[0]?.ownerResourceId).toEqual(expect.any(Number));
    // ★ Stated as BOTH halves on purpose: `not.toBe(firstId)` names the defect
    //  (bound to the first-wins name row) in the failure message, so a red here
    //  cannot be read as some unrelated id drift; `toBe(secondId)` is the pin.
    expect(out.raid?.[0]?.ownerResourceId, "bound to the first-wins NAME row").not.toBe(firstId);
    // The email leg beat first-wins-by-name: the SECOND row, not the first.
    expect(out.raid?.[0]?.ownerResourceId).toBe(secondId);
  });

  it("links a seeded stakeholder by EMAIL when two directory rows share a name", () => {
    // ★★★ THE STAKEHOLDER LEG OF THE SAME DEFECT, and the same argument end to
    //  end: `remapSeed` resolves a stakeholder through the very same
    //  `linkResource(s.name, s.email)` over the same FIRST-WINS `resByName`, so
    //  while `email` was undeclared two seeded people sharing a display name
    //  bound the stakeholder to whichever the model listed first — a WRONG
    //  `resourceId`, not an absent one.
    // ★ Its NAME-leg sibling lives in `template-apply.test.ts` ("re-links seeded
    //  person FKs…"), which drives `remapSeed` on a hand-built seed and so is
    //  blind to this schema. THIS case is the only one that proves the FILTER
    //  lets the address through.
    const seed = proposalToSeed(
      {
        meta: { name: "x" },
        features: [],
        seed: {
          resources: [
            { firstName: "Ada", lastName: "Lovelace", email: "ada.first@x.io" },
            { firstName: "Ada", lastName: "Lovelace", email: "ada.second@x.io" },
          ],
          stakeholders: [
            { name: "Ada Lovelace", organization: "ACME", email: "ada.second@x.io" },
          ],
        },
      },
      TODAY,
    );
    expect(seed?.resources, "both directory rows must survive").toHaveLength(2);
    const out = remapSeed(emptyWorkspace(), seed!);
    const firstId = out.resources?.[0]?.id;
    const secondId = out.resources?.[1]?.id;
    expect(firstId).toEqual(expect.any(Number));
    expect(secondId).toEqual(expect.any(Number));
    expect(firstId).not.toBe(secondId);
    expect(out.stakeholders?.[0]?.resourceId).toEqual(expect.any(Number));
    expect(out.stakeholders?.[0]?.resourceId, "bound to the first-wins NAME row").not.toBe(firstId);
    expect(out.stakeholders?.[0]?.resourceId).toBe(secondId);
  });

  it("assigns the builder's 1-based id after filtering, not the model's", () => {
    // Ordering pin: filter the raw item FIRST, then stamp `id`. Filtering after
    // the stamp would strip `id` and every sanitizer would refuse the row.
    const seed = seedWithSmuggledFields();
    expect(seed?.raid?.[0]?.id).toBe(1);
    expect(seed?.changes?.[0]?.id).toBe(1);
    expect(seed?.milestones?.[0]?.id).toBe(1);
    expect(seed?.stakeholders?.[0]?.id).toBe(1);
  });
});
