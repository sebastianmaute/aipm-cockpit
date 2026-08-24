import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

// Real sample workspace (14 tasks, RAID, budgets, milestones, …) — gives the
// a11y/nav specs realistic data so colour-coded states (RAG amber/red, budget
// over/under, completed-task greens, etc.) actually render and get scanned.
const SAMPLE_WORKSPACE = JSON.parse(
  readFileSync(join(process.cwd(), "sample-workspace-small.json"), "utf8"),
) as Record<string, unknown>;

// ★★ A SECOND document, added HERE and deliberately NOT in the sample master.
// The documents list gives every per-row control a row-qualified accessible
// name ("Delete – <title>"), and N identical names can only COLLIDE when N > 1
// — with a single seeded row the axe gate cannot see a duplicate-name failure
// at all, which is a blind spot this repo has already shipped once. The two
// titles differ on purpose: identical ones would assert the pathological case
// instead of proving that the qualification works.
// ★ Kept out of sample-workspace-small.json because that file is the
// hand-curated master and the CSV/Markdown goldens are generated FROM it, so a
// test-only row would force regenerating -big, -huge and every golden fixture.
// ★ The id is far above the master's range so a document added to the sample
// later cannot collide — sanitizeProjectDocuments dedupes by id and would
// silently drop whichever came second.
const SEED_WORKSPACE: Record<string, unknown> = {
  ...SAMPLE_WORKSPACE,
  documents: [
    ...((SAMPLE_WORKSPACE.documents as unknown[]) ?? []),
    {
      id: 9001,
      title: "Kickoff pack",
      // ★★ ALL SIX DocBlock KINDS, deliberately. The block editor renders a
      // per-kind editor plus a gutter per row, so a document carrying three
      // kinds leaves three of them unscanned — and a view being in A11Y_VIEWS is
      // NOT the same as that view being covered (this file's own note above).
      // ★★ BELT-AND-BRACES, and knowing which half is load-bearing matters:
      // documents-panel.tsx falls back to `selectionPool[0]` when nothing is
      // selected, and `selectionPool` is the UNSORTED `documents` array — so the
      // document the edit-mode scan actually opens is the SAMPLE MASTER's id 1,
      // spread ahead of this one, which ALREADY carries all six kinds. Seeding
      // them here keeps the scan honest if that ordering, or the master's own
      // document, ever changes. Re-measure both halves rather than trusting this:
      //   node -e "const m=JSON.parse(require('fs').readFileSync('sample-workspace-small.json','utf8'));console.log(m.documents.map(d=>d.id+': '+[...new Set(d.blocks.map(b=>b.type))].join('/')))"
      blocks: [
        { type: "heading", level: 1, text: "Kickoff" },
        { type: "paragraph", html: "<p>Agenda and owners for the kickoff session.</p>" },
        { type: "bullets", items: ["Scope walkthrough", "Risk review"] },
        { type: "table", caption: "Owners", columns: ["Area", "Owner"], rows: [["Scope", "Dana"], ["Risk", "Ravi"]] },
        // ★★ WHY THIS FIGURE IS CAPTIONED, and why the caption is now a CHOICE
        // rather than a requirement. `document-model.ts`'s sanitizeBlock used to do
        // a bare `if (htmlTextLength(html) === 0) return null` for a paragraph, and
        // `htmlTextLength` -> `htmlPlainProjection` (rich-text-plain.ts) strips EVERY
        // tag without counting `alt` — so a paragraph whose entire html was an
        // `<img>` projected to "" and the block was DROPPED on load, on all six
        // paths. Seeded image-only, this block would have silently not existed by
        // the time the page rendered and documents-images.spec.ts would have gone
        // vacuously green against a document containing no image.
        // FIXED by ASSET_IMG_RE in sanitizeBlock, so an image-only paragraph now
        // survives. The caption stays because a captioned figure is the realistic
        // shape and costs the spec nothing. Re-measure before trusting either way —
        // BOTH blocks should appear in the output; if the FIRST one vanishes, the
        // load-side guard has regressed and every user-inserted image is being
        // deleted on load again:
        //   printf '%s' 'import {sanitizeProjectDocuments} from "./src/app/document-model";
        //   const b=[{type:"paragraph",html:`<img data-asset-id="a" alt="x">`},
        //   {type:"paragraph",html:`<p><img data-asset-id="b" alt="x"> cap</p>`}];
        //   console.log(JSON.stringify(sanitizeProjectDocuments([{id:1,title:"T",
        //   blocks:b,createdAt:"",updatedAt:""}])[0].blocks));' > probe.tmp.ts
        //   npx vite-node probe.tmp.ts && rm probe.tmp.ts
        // (vite-node takes FILES ONLY — it has no -e flag; that form exits 1. This
        // command was run against the post-fix tree and printed both blocks.)
        { type: "paragraph", html: '<p><img data-asset-id="e2e-asset-1" alt="Burndown chart"> Figure 1 — burndown at kickoff.</p>' },
        // ★★★ THE IMAGE-ONLY SHAPE, AND IT IS THE MORE IMPORTANT OF THE TWO.
        // This is EXACTLY what the product inserts: documents-asset-section.tsx
        // builds `<img data-asset-id=… alt=…>` and nothing else, so this block —
        // not the captioned one above — is the faithful reproduction of a real
        // user-inserted image. It is only seedable at all because `d183be6d`
        // added ASSET_IMG_RE; before that it was deleted on every load.
        // ★★ That makes it a live REGRESSION DETECTOR for the load-side guard:
        // revert d183be6d and this block stops existing, so
        // documents-images.spec.ts never finds its second image and goes RED —
        // instead of the silent data loss going unnoticed a second time. Keep
        // BOTH blocks: the captioned one is valid under either behaviour and so
        // protects the CSP/render assertion from any future change to
        // block-dropping rules, while this one protects the drop rule itself.
        // ★ A SECOND asset, not a re-reference of e2e-asset-1: two ids let the
        // spec assert each image's own dimensions (8x8 vs 4x4), so a resolver
        // that pointed both `<img>`s at the same bytes could not pass. Distinct
        // bytes, and therefore a distinct `hash`, also keep the pair consistent
        // with upload dedup, which is hash-keyed and would never mint two rows
        // for identical content.
        { type: "paragraph", html: '<img data-asset-id="e2e-asset-2" alt="Velocity sparkline">' },
        { type: "dataSection", key: "milestones" },
        { type: "pageBreak" },
      ],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      // ★★ A view being in A11Y_VIEWS is NOT the same as that view being
      // covered: the scan only sees what this seed put in IndexedDB, so
      // without a link the Documents scan renders an unlinked document and the
      // chips never exist at scan time. Task #1 is the sample master's first
      // task, present in every seeded workspace.
      // ★ Deliberately on THIS e2e-only document rather than the sample's, so a
      // test-only row never forces a golden regeneration. The sample's own
      // document carries a LABELLED link, so both shapes are seeded.
      linkedEntities: [{ kind: "task", id: 1 }],
    },
  ],
  // The METADATA half of the seeded image (S3c-1). The BYTES are deliberately
  // NOT here and never can be: they live in the `document_asset_data` Turso
  // side table, which no file-mode backend has — see E2E_DOCUMENT_ASSET and
  // installAssetByteStore below for the other half, and for why a spec that
  // wants a REAL rendered image has to opt into it.
  // ★ Fields mirror `DocumentAsset` (document-asset.ts). `width`/`height` are
  // the real dimensions of the PNG in E2E_DOCUMENT_ASSET, so a spec may assert
  // naturalWidth/naturalHeight against them rather than against `> 0` alone.
  // ★★ `mime` is what `DocumentPreview` feeds attachAssetImages' `mimeFor`, so
  // a wrong value here would mint a type-less Blob and leave the render to
  // content sniffing — the seeded value must stay in step with the real bytes.
  documentAssets: [
    {
      id: "e2e-asset-1",
      name: "burndown.png",
      mime: "image/png",
      size: 84,
      width: 8,
      height: 8,
      hash: "ae6850aab39f9fe52b1d62bfeb98c3ccfafc346aeb04ee45e728ba39a10fa20f",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "e2e-asset-2",
      name: "velocity.png",
      mime: "image/png",
      size: 83,
      width: 4,
      height: 4,
      hash: "8742b458059c03e5240932d82d1dbbd1708c8b99ca7a93a5041286a8d83669bd",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  ],
  // ★ e2e-only, for the same reason as `documents` above: the master is the
  // hand-curated source the CSV/Markdown goldens are generated FROM, so a
  // test-only row there would force regenerating -big, -huge and every
  // __fixtures__/golden-* fixture — which makes a real format change and a
  // fixture refresh indistinguishable in review. Neither slice exists in the
  // master at all (verify:
  //   node -e 'const m=JSON.parse(require("fs").readFileSync("sample-workspace-small.json","utf8"));
  //   for (const k of ["insights","timelogLinks"]) console.log(k, m[k]==null?"ABSENT":"present")'
  // ), so nothing here overrides curated data.
  // ★★★ FOUR insights, and TWO OF THEM SHARE A TYPE ON PURPOSE. Every per-row
  // control in insights-panel.tsx is named by the insight's rendered TITLE
  // ("Acknowledge – <title>"), and `insightTitle` (insights/insight-text.ts) is
  // `t(lang, TITLE_KEY[insight.type])` — TYPE-DRIVEN AND NOTHING ELSE. So rows of
  // DIFFERENT types can never produce a duplicate accessible name no matter how
  // many are seeded; only same-type rows can. 9101 and 9104 are both
  // `milestoneSlip` and both `active`, so they render four pairs of
  // identically-named buttons — Open / Acknowledge / Act / Dismiss, plus a fifth
  // pair (the recommendation CTA) when AI is configured, which it is NOT in the
  // e2e run, so expect four here. This is the real shape the detectors emit:
  // `detect.ts:53` mints one `milestoneSlip:<id>` per overdue milestone.
  // ★★★ THIS DOES NOT MAKE THE AXE GATE ABLE TO SEE IT, and an earlier revision
  // of this comment claimed it did. axe-core 4.12.1 has NO rule that flags two
  // BUTTONS sharing an accessible name; the only near-miss,
  // `identical-links-same-purpose`, is links-only and tagged `wcag2aaa`, which
  // e2e/a11y.spec.ts does not request (`wcag2a wcag2aa wcag21a wcag21aa`).
  // Reproduce: node -e 'const a=require("axe-core"); console.log(a.getRules()
  //   .filter(r=>/identical|duplicate|unique/i.test(r.ruleId)).map(r=>r.ruleId+" "+r.tags))'
  // What the same-type pair buys is that the collision RENDERS at scan time and
  // can be pinned by a locator count — which is what seed-content.spec.ts does.
  // The detector here is that spec, not axe. (Filed as docs/open-followups.md
  // §126; the same shape is de-collided correctly in insights/insight-digest-card.tsx.)
  // ★ The four also differ in severity and status so the status/type filters have
  // something to discriminate and the acknowledged branch renders too.
  // ★ Ids are far above the master's range so a later sample addition cannot
  // collide — same reason the seeded document uses 9001.
  // ★★ EVERY ROW'S `data` CARRIES THE KEYS ITS OWN TYPE ACTUALLY READS, and the
  // reader is `insightDetail` (insights/insight-text.ts) — a per-type switch, so
  // a key that belongs to a DIFFERENT type is not a near-miss, it is nothing.
  // `str()` falls back to "—" and `num()` to 0, so a wrong shape does not throw
  // and does not fail any gate: the row renders a degraded detail line ("0 active
  // tasks are stale…", "— is off plan by 0%") in a fixture whose entire purpose
  // is that the scanned view shows REAL rows. Keys per type — read them off the
  // matching `case` arm of `insightDetail` (cited by SYMBOL, not line: a line
  // number here is broken by the next edit to that switch):
  //   milestoneSlip  → name · daysOverdue · date           (insightMilestoneSlipDetail)
  //   stalledWork    → count                               (insightStalledWorkDetail)
  //   budgetVariance → name · variancePct · buckets        (insightBudgetVarianceDetail)
  //   overdueTrend   → current · delta · prior             (insightOverdueTrendDetail)
  //   raidAging      → name · daysSinceUpdate · targetDate (insightRaidAgingDetail)
  // Each matches what the matching detector in detect.ts emits — the `data`
  // literals in milestoneSlipInsights / stalledWorkInsight / budgetVarianceInsight.
  // Verified by execution, not by reading: feeding these four rows through
  // sanitizeInsights + insightDetail renders "5 active tasks are stale, blocked,
  // or waiting on a dependency." and "Data Migration (fixed price) is off plan by
  // 18% (2 bucket(s) breaching the threshold)." — no "—" and no stray 0.
  // ★ Values are inside the detectors' own thresholds so the rows read as real
  // detections: stalledWork fires at `count >= STALLED_WORK_MIN` (3) and
  // budgetVariance at `variancePct >= BUDGET_VARIANCE_PCT` (10). `name` is a real
  // budget bucket from the master (id 4) so the line names something that exists.
  // ★ `stalledWork` and `budgetVariance` are SINGLETON detectors — detect.ts mints
  // the bare keys "stalledWork"/"budgetVariance" with NO entityRef, and these two
  // rows mirror that. Only milestoneSlip/raidAging are per-entity ("<type>:<id>"
  // + an entityRef), which is why just the two milestoneSlip rows render an
  // "Open – …" control.
  // ★ The two milestoneSlip rows name DIFFERENT milestones, so their DETAIL lines
  // differ and the digest card's own collision handling stays out of the picture;
  // the duplication under test is the row controls' names alone.
  insights: [
    {
      id: 9101, key: "milestoneSlip:1", type: "milestoneSlip", severity: "high",
      entityRef: { view: "milestones", id: 1 },
      data: { name: "Design Sign-off", date: "2026-04-20", daysOverdue: 5 }, status: "active",
      firstSeenAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 2,
    },
    {
      // The second SAME-TYPE row. Distinct `id` and distinct `key` — sanitizeInsights
      // requires both (`key` non-empty, `id` a finite number, `firstSeenAt` an ISO
      // string, and type/severity/status all real union members) or the row is
      // dropped silently and the seed goes inert.
      id: 9104, key: "milestoneSlip:3", type: "milestoneSlip", severity: "medium",
      entityRef: { view: "milestones", id: 3 },
      data: { name: "Hypercare Exit", date: "2026-12-15", daysOverdue: 2 }, status: "active",
      firstSeenAt: "2026-06-04T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 1,
    },
    {
      id: 9102, key: "stalledWork", type: "stalledWork", severity: "medium",
      data: { count: 5 }, status: "acknowledged",
      firstSeenAt: "2026-06-02T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 3,
      acknowledgedAt: "2026-06-05T00:00:00.000Z",
    },
    {
      id: 9103, key: "budgetVariance", type: "budgetVariance", severity: "low",
      data: { name: "Data Migration (fixed price)", variancePct: 18, buckets: 2 }, status: "active",
      firstSeenAt: "2026-06-03T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 1,
    },
  ],
  // ★★★ NEITHER TABLE REACHES THE axe SCAN ANY MORE, and this comment used to say
  // the Projects one did. 0.245.0 gated timelog-panel.tsx on `cfg.enabled`,
  // returning `TimelogNotConfigured` when the integration is off — and nothing
  // here seeds any timelog SETTINGS, so `defaultTimelogConfig.enabled` (false)
  // stands and "Time bookings" is scanned on the not-configured empty state.
  // The Projects table's per-row link <select>s and the People table alike are
  // now covered by NO gate. Recorded, with the two ways out (seed the settings,
  // or pin those controls with unit tests), in docs/open-followups.md §171.
  //   grep -n "TimelogNotConfigured" src/app/timelog-panel.tsx
  //   grep -n "enabled: false" src/app/timelog-types.ts
  // ★ These links are still seeded, and the reason never depended on the scan:
  // the round-trip through sanitizeTimelogLinks is what proves the kv key.
  // ★ `bucketId: 1` is a real budget id in the master, so once the table does
  // render again the row's <select> resolves to a named option rather than
  // falling back to "none".
  timelogLinks: {
    userLinks: [
      { timelogUserId: 501, resourceId: 1, manual: true },
      { timelogUserId: 502, resourceId: 2, manual: false },
    ],
    projectLinks: [
      { timelogProjectId: 701, bucketId: 1, manual: true },
      { timelogProjectId: 702, bucketId: null, manual: false },
    ],
    customerId: 42,
    projectIds: [701, 702],
  },
};

// Registry + File System Access stub. Runs in the browser before app code on
// every navigation. A `kind:"browser"` project loads from IndexedDB (no
// save-picker, which headless Chromium can't satisfy); the FSA pickers are
// stubbed in-memory for any flow that still reaches them.
function seedRegistryAndFsa(): void {
  localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "e2e-1", name: "E2E Project", code: "E2E-001", storageConfig: { kind: "browser" } }],
      currentProjectId: "e2e-1",
    }),
  );
  const ref = { content: "" };
  const handle = {
    name: "e2e-project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => new File([ref.content], "e2e-project.json", { type: "application/json" }),
    createWritable: async () => ({
      write: async (c: unknown) => {
        ref.content = typeof c === "string" ? c : ((c as { data?: string })?.data ?? "");
      },
      close: async () => {},
    }),
  };
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => handle;
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [handle];
}

// Writes the sample workspace into IndexedDB in the exact shape BrowserBackend
// reads (see browser-backend.ts / idb.ts). Runs in the browser via evaluate so
// it completes BEFORE the app loads (addInitScript can't block on async IDB).
function seedIndexedDb(ws: Record<string, unknown>): Promise<void> {
  const ENTITY = ["tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades", "budgets"];
  // ★★ THIS MAP IS THE SEED'S BLIND SPOT. BrowserBackend persists TEN optional
  // slices as kv entries — fieldVisibility, features, steeringCommittee,
  // timelogLinks, knowledgeItems, insights, settingsOverrides, calendarEvents,
  // documents, documentVersions — and anything absent from this map is silently
  // dropped, so the matching view is scanned against its EMPTY STATE and a green
  // axe run proves nothing about its rows or controls.
  // ★★ A MISSING SLICE IS TWO DIFFERENT BUGS depending on whether the MASTER
  // carries it, and only one of them is about axe:
  //   (a) master carries it + absent here ⇒ the seed silently DISCARDS data it
  //       claims to seed, so the e2e app is not a faithful load of
  //       sample-workspace-small.json. That is a harness-fidelity bug on its own,
  //       independent of what any scan happens to look at.
  //   (b) master does not carry it ⇒ nothing is dropped; the view simply renders
  //       empty, which is a seeding gap but not an infidelity.
  // Measured 2026-08-08 — reproduce by diffing this map against the master:
  //   node -e 'const m=JSON.parse(require("fs").readFileSync("sample-workspace-small.json","utf8"));
  //   for (const k of ["fieldVisibility","features","steeringCommittee","timelogLinks",
  //   "knowledgeItems","insights","settingsOverrides","calendarEvents","documents",
  //   "documentVersions"]) console.log(k, m[k] != null)'
  // — the map below carries FOUR of the ten (`documents`, `documentVersions`,
  // `insights`, `timelogLinks`), so SIX are absentees: `steeringCommittee` and
  // `calendarEvents` are case (a) and STILL DROPPED; `fieldVisibility`,
  // `features`, `knowledgeItems` and `settingsOverrides` are case (b).
  // `insights` and `timelogLinks` were case (b) — absent from the master AND
  // unmapped here, so Insights (which IS in A11Y_VIEWS) was scanned against its
  // empty state. Both are now AUTHORED in SEED_WORKSPACE above and mapped here,
  // so those panes are scanned with rows. `documents` and `documentVersions`
  // were seeded earlier for exactly the same reason.
  // ★ The VALUE is the IndexedDB kv key, not the workspace field name, and the
  // two coincide for most slices — a wrong string seeds nothing and fails
  // nothing. Every value here is checked against browser-backend.ts's KV_*_KEY
  // constants (KV_INSIGHTS_KEY = "insights", KV_TIMELOG_LINKS_KEY =
  // "timelogLinks"); re-check there before adding a row.
  const KV: Record<string, string> = {
    plan: "resource-plan", fxRates: "fx-rates", status: "project-status",
    milestones: "milestones", changes: "changes", stakeholders: "stakeholders", project: "project",
    documents: "documents", documentVersions: "documentVersions",
    insights: "insights", timelogLinks: "timelogLinks",
    // ★ Checked against browser-backend.ts's KV_DOCUMENT_ASSETS_KEY, per the
    // rule above — the value is the IDB kv key, not the workspace field name,
    // and here the two coincide. Without this row the `documentAssets` slice
    // authored above is silently dropped and every seeded image renders its
    // missing-asset marker no matter what the byte store says.
    documentAssets: "documentAssets",
  };
  return new Promise((resolve, reject) => {
    // ★ The version is hardcoded here but derived from IDB_VERSION in idb.ts.
    // They agree today (both 6). If a later slice adds an object store and
    // bumps IDB_VERSION, this open runs at the OLDER version and seeds the
    // wrong shape — silently, since the app's own open would then upgrade over
    // it. Bump both together.
    const open = indexedDB.open("aipm-cockpit", 6);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      for (const s of ENTITY) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(db.objectStoreNames, "readwrite");
      for (const field of ENTITY)
        for (const rec of (ws[field] as unknown[]) ?? []) tx.objectStore(field).put(rec);
      const kv = tx.objectStore("kv");
      for (const [field, key] of Object.entries(KV)) if (ws[field] != null) kv.put(ws[field], key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Test fixture: every test's context is pre-seeded with the registry + FSA stub,
// and its page has the sample workspace written to IndexedDB before first use.
export const test = base.extend({
  context: async ({ context }, run) => {
    await context.addInitScript(seedRegistryAndFsa);
    await run(context);
  },
  page: async ({ page }, run) => {
    // Same-origin lightweight document so IndexedDB (per-origin) is reachable
    // and seeded before any app navigation.
    await page.goto("/favicon.ico");
    await page.evaluate(seedIndexedDb, SEED_WORKSPACE);
    await run(page);
  },
});

export { expect };

/** The seeded document image: metadata mirrored from SEED_WORKSPACE's
 *  `documentAssets` row, plus the BYTES that slice can never carry.
 *
 *  A real 8x8 RGB PNG, 84 bytes, built by hand (zlib IDAT + correct CRCs) so it
 *  actually DECODES — a placeholder that merely looks like base64 would still
 *  produce an `<img>` with a blob: src and `naturalWidth === 0`, which is the
 *  exact failure signature a CSP regression produces. The bytes and `hash` were
 *  generated together; regenerate both or neither. */
export const E2E_DOCUMENT_ASSET = {
  id: "e2e-asset-1",
  name: "burndown.png",
  mime: "image/png",
  width: 8,
  height: 8,
  byteLength: 84,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAG0lEQVR4nGOQt5r8//9/TJIBq6i81WSGQakDANWYfSG99zMiAAAAAElFTkSuQmCC",
} as const;

/** The image behind the IMAGE-ONLY paragraph block — the shape
 *  documents-asset-section.tsx actually inserts. See that block's comment in
 *  SEED_WORKSPACE for why the pair exists.
 *
 *  ★ DELIBERATELY 4x4, not another 8x8: the spec asserts each image's own
 *  dimensions, so a resolver that pointed both `<img>` elements at the same
 *  bytes would fail rather than pass. Distinct bytes also mean a distinct
 *  `hash`, which keeps the pair consistent with the hash-keyed upload dedup. */
export const E2E_DOCUMENT_ASSET_IMAGE_ONLY = {
  id: "e2e-asset-2",
  name: "velocity.png",
  mime: "image/png",
  width: 4,
  height: 4,
  byteLength: 83,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGklEQVR4nGM4IaD3//9/CMkAZ50Q0GPAKQMAR6EgGSlBvb8AAAAASUVORK5CYII=",
} as const;

/** Both seeded assets, for the byte-store stub's id lookup. */
const E2E_DOCUMENT_ASSETS = [E2E_DOCUMENT_ASSET, E2E_DOCUMENT_ASSET_IMAGE_ONLY] as const;

/**
 * Make the seeded document image RENDER — opt-in, per spec.
 *
 * ★★★ WHY THIS IS NEEDED AT ALL, and why the seed cannot just carry the bytes:
 * a `DocumentAsset` row is workspace data and rides IndexedDB like any other
 * slice, but its BYTES live in `document_asset_data`, a Turso side table
 * (document-assets-schema.ts) deliberately kept out of TABLE_NAMES. There is no
 * file-mode equivalent, so a plain file-mode seed can never resolve an image:
 * the img never gets a blob: src, and a spec built on it could not observe a
 * CSP `img-src` regression, because no image load is ever attempted.
 * ★★ CORRECTED: this used to say `loadAssetData(null, ...)` throws
 * StorageNotReadyError and `attachAssetImages` "stamps `data-asset-missing`", so
 * a file-mode seed "can only ever produce the DANGLING state". Both previews now
 * BAIL on a null Turso config before calling the loader at all — a null config
 * means asset storage is off, not that the bytes are missing — so no marker is
 * stamped and the image renders its alt text. The conclusion above is unchanged;
 * only the mechanism, and the claim about which state you can observe, were.
 *
 * ★★ THE GATE IS `tursoConfig !== null`, NOT THE STORAGE BACKEND, and that is
 * what makes this possible without distorting anything. task-manager.tsx builds
 * it as `getTursoConfig(settings.integrations?.turso?.databaseUrl, ...authToken)`
 * — read off the INTEGRATIONS settings and completely independent of
 * `settings.storageConfig.kind`. The workspace therefore keeps loading from
 * IndexedDB exactly as every other spec sees it, while the asset byte store
 * comes alive. (It also means the sidebar is unaffected: nav pruning is
 * `filterNavGroups(settings.features, settings.storageConfig.kind)`, which this
 * does not touch.)
 *
 * ★★ EVERYTHING CLIENT-SIDE STAYS REAL. Only the remote database is stubbed —
 * there is no Turso server in CI and there never will be. The spec still
 * exercises getTursoConfig, loadAssetData, runTursoPipeline's real fetch, the
 * real base64 decode, the real Blob + URL.createObjectURL, the real
 * `img.src = blob:` assignment, Chromium's real CSP enforcement and a real PNG
 * decode. Stubbing the transport is the only part that is not the product.
 *
 * ★★★ `location.origin` IS THE DATABASE URL ON PURPOSE — three constraints
 * intersect and only this satisfies all three:
 *   - CSP: `connect-src` (src/proxy.ts) admits 'self', so a same-origin POST is
 *     allowed. Route interception happens in the network layer, but CSP is
 *     enforced in the RENDERER first — a connect-src-blocked request never
 *     reaches the handler at all, so an arbitrary host would silently degrade
 *     to the dangling case and look like a product failure.
 *   - CORS: same-origin means no preflight. A cross-origin pipeline POST sends
 *     `Content-Type: application/json`, which is not a simple request, and the
 *     OPTIONS preflight is not reliably interceptable.
 *   - getTursoConfig: plaintext http is accepted ONLY for loopback hosts, and
 *     token-less ONLY for those — so `http://localhost:<port>` needs no
 *     authToken and never engages the sealed-secret machinery (`writeSettings`
 *     blanks `integrations.turso.authToken`; an empty one has nothing to blank).
 *     A local self-hosted tursodb is a genuinely supported configuration, so
 *     this is a real product shape, not a test-only one.
 * ★ Consequence: pointing PLAYWRIGHT_BASE_URL at a NON-loopback host makes
 * getTursoConfig return null and every image dangle. That fails loudly on the
 * naturalWidth assertion rather than passing quietly, which is the right way
 * round.
 *
 * ★ The service worker cannot swallow the request: public/sw.js registers no
 * `fetch` handler at all, so nothing competes with the route.
 *
 * Call BEFORE gotoApp — the init script has to land before the app boots.
 */
export async function installAssetByteStore(page: Page): Promise<void> {
  // Settings are a SHALLOW merge over defaults in use-settings.ts
  // (`{...defaultSettings, ...parsed}`), so writing this one key leaves
  // storageConfig and everything else at its default. `integrations` is not
  // deep-merged, which is fine: m365 is optional and nothing here needs it.
  await page.addInitScript(() => {
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ integrations: { turso: { enabled: true, databaseUrl: location.origin } } }),
    );
  });

  await page.route("**/v2/pipeline", async (route) => {
    const body = route.request().postDataJSON() as
      | { requests?: { type?: string; stmt?: { sql?: string; args?: { value?: string }[] } }[] }
      | null;
    const requests = body?.requests ?? [];

    // ★★ ONE RESULT PER REQUEST, IN ORDER — non-negotiable. Callers index the
    // array positionally (`results[DOCUMENT_ASSET_DATA_DDL.length]`), so a
    // short array silently yields `undefined`, `rowObjects` returns [] and the
    // asset reads as dangling. Every non-asset statement therefore still gets
    // an empty ok: enabling tursoConfig also wakes comm-templates, operating
    // guides and the action-learning store, and each must get a well-formed
    // reply rather than an error that could surface a banner mid-scan.
    const results = requests.map((r) => {
      const sql = r?.stmt?.sql ?? "";
      const args = r?.stmt?.args ?? [];
      if (!/FROM\s+document_asset_data/i.test(sql)) return ok([], []);

      // ★ The ids-only select bills itself as `'' AS data` — the library diffs
      // ids to mark rows dangling and must never pull bytes.
      const idsOnly = /''\s+AS\s+data/i.test(sql);
      // ★★ MATCHED ON ID ALONE, project_id DELIBERATELY IGNORED. The partition
      // key is `assetPane.projectId`, which is being reworked
      // (ASSET_PARTITION_FALLBACK) and differs between the single-tenant and
      // tenant layouts. This spec's subject is whether an image RENDERS, not
      // how bytes are partitioned; keying on it here would make the spec fail
      // for a reason it does not test. Pin partitioning separately if wanted.
      // ★ The ids select must return EVERY seeded id, not just the first: the
      // hook diffs this set against the metadata slice, so a short list would
      // mark the missing rows dangling in the library even though their bytes
      // resolve fine in the preview.
      const cols = ["id", "project_id", "data"];
      if (idsOnly) return ok(cols, E2E_DOCUMENT_ASSETS.map((a) => [a.id, "", ""]));
      const wanted = E2E_DOCUMENT_ASSETS.find((a) => args.some((arg) => arg?.value === a.id));
      if (!wanted) return ok(cols, []);
      return ok(cols, [[wanted.id, "", wanted.base64]]);
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ baton: null, base_url: null, results }),
    });
  });
}

/** A libSQL `/v2/pipeline` execute result, in the shape `rowObjects`
 *  (turso-schema.ts) destructures: `response.result.cols[].name` +
 *  `response.result.rows[][].value`. */
function ok(cols: string[], rows: string[][]) {
  return {
    type: "ok" as const,
    response: {
      type: "execute" as const,
      result: {
        cols: cols.map((name) => ({ name })),
        rows: rows.map((row) => row.map((value) => ({ type: "text", value }))),
      },
    },
  };
}

/** Primary sidebar views worth smoke-checking. Names match their accessible labels. */
export const PRIMARY_VIEWS = [
  "Dashboard",
  "Open Points",
  "Gantt",
  "Milestones",
  "Resources",
  "Budget",
  "RAID",
  "Changes",
  "Stakeholders",
  "Reports",
  "Activity",
  "Settings",
] as const;

const NAV_SELECTOR = 'aside a, aside button, nav a, nav button, [role="tab"]';

// Freeze "now" so anything the app derives from the current date (RAG status,
// due-soon highlighting, "as of …" captions, Gantt today-line / visible window)
// renders identically on every run — otherwise the a11y and visual specs drift
// with the calendar date.
export const FROZEN_NOW = new Date("2026-06-15T09:00:00.000Z");

/**
 * Navigate to the app and wait until the sidebar shell is interactive. The
 * timeout is generous because the FIRST navigation against the dev `webServer`
 * pays a one-time Turbopack compile (well over the default action timeout);
 * subsequent in-app navigations are fast.
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.clock.install({ time: FROZEN_NOW });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name: "Dashboard", sel: NAV_SELECTOR },
    { timeout: 90_000 },
  );
}

export async function openView(page: Page, name: string): Promise<void> {
  // The shell is already up (see gotoApp); a short poll covers per-view lazy bits.
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name, sel: NAV_SELECTOR },
    { timeout: 20_000 },
  );
  await page.evaluate(
    ({ name, sel }) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      );
      (el as HTMLElement | undefined)?.click();
    },
    { name, sel: NAV_SELECTOR },
  );
  await waitForViewSettled(page);
}

/**
 * Wait until the main view's DOM stops changing, so axe (and visual specs) scan
 * a FULLY-rendered view. A fixed `waitForTimeout` could scan mid-render of the
 * heavy data tables, so whether a given row is present — and thus whether its
 * a11y violations are caught — became non-deterministic (a real contrast bug
 * could pass one run and fail another depending on runner timing). Polling for
 * DOM stability makes the scan deterministic.
 *
 * The poll MUST be driver-side: `page.clock.install` (see gotoApp) fakes the
 * page's `setTimeout`, so an in-page timer-based settle would never fire.
 */
export async function waitForViewSettled(page: Page): Promise<void> {
  // Fonts affect text metrics (→ the large-vs-normal contrast threshold); let
  // them settle if the browser exposes the API. Tolerant — never blocks.
  await page
    .evaluate(() => (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready)
    .catch(() => {});
  let prev = -1;
  let stable = 0;
  // ~240ms of stability (3×80ms), capped at ~4s so a perpetually-animating
  // element can never hang the scan.
  for (let i = 0; i < 50 && stable < 3; i++) {
    const len = await page.evaluate(() => document.querySelector("main")?.innerHTML.length ?? 0);
    if (len === prev) stable += 1;
    else {
      stable = 0;
      prev = len;
    }
    await page.waitForTimeout(80);
  }
}
