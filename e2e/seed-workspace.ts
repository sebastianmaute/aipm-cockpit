// The workspace the e2e fixture writes into IndexedDB before every test: the
// sample master plus the rows authored below. In its own module, with no
// Playwright import, so src/app/idb-layout.test.ts can check that every slice
// BrowserBackend persists actually reaches the seed (§99).
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Real sample workspace (27 tasks, RAID, budgets, milestones, …) — gives the
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
export const SEED_WORKSPACE: Record<string, unknown> = {
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
        // FIXED by the survival predicate `sanitizeBlock` now tests —
        // `ASSET_IMG_TEST_RE` (`document-asset-patterns.ts`), named `ASSET_IMG_RE`
        // and module-private in `document-model.ts` when this comment was written
        // — so an image-only paragraph now
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
        // added the survival predicate (`ASSET_IMG_RE` then, `ASSET_IMG_TEST_RE`
        // in `document-asset-patterns.ts` now); before that it was deleted on
        // every load.
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
  // fixture refresh indistinguishable in review.
  // ★★ BOTH SLICES NOW EXIST IN THE MASTER, AND THESE KEYS REPLACE THEM WHOLESALE.
  // This comment used to say neither existed there, so nothing here overrode
  // curated data; the demo refresh (DEMO_AS_OF 2026-09-18) seeded both in the
  // master. The object spread above means the keys below WIN, deliberately:
  // seed-content.spec.ts pins THESE four insight rows (counts and the same-type
  // pair), not the master's. Verify what the master carries:
  //   node -e 'const m=JSON.parse(require("fs").readFileSync("sample-workspace-small.json","utf8"));
  //   for (const k of ["insights","timelogLinks"]) console.log(k, m[k]==null?"ABSENT":"present")'
  // ★★★ FOUR insights, and TWO OF THEM SHARE A TYPE ON PURPOSE. Every per-row
  // control in insights-panel.tsx is named by the insight's rendered TITLE
  // ("Acknowledge – <title>"), and `insightTitle` (insights/insight-text.ts) is
  // `t(lang, INSIGHT_TYPE_LABEL_KEY[insight.type])` — TYPE-DRIVEN AND NOTHING ELSE. So rows of
  // DIFFERENT types can never produce a duplicate accessible name no matter how
  // many are seeded; only same-type rows can. 9101 and 9104 are both
  // `milestoneSlip` and both `active`, so they render four pairs of
  // identically-named buttons — Open / Acknowledge / Act / Dismiss, plus a fifth
  // pair (the recommendation CTA) when AI is configured, which it is NOT in the
  // e2e run, so expect four here. This is the real shape the detectors emit:
  // `detect.ts:53` mints one `milestoneSlip:<id>` per overdue milestone.
  // ★★★ THIS DOES NOT MAKE THE AXE GATE ABLE TO SEE IT, and an earlier revision
  // of this comment claimed it did. axe-core 4.12.1 has NO rule that flags two
  // BUTTONS sharing an accessible name. ★★ "BUTTONS" is the load-bearing word,
  // not "the only near-miss" — the reproduce command below returns TEN rules and
  // TWO of them DO carry a requested tag (`duplicate-id-aria`, and
  // `frame-title-unique`, which is literally two iframes sharing an accessible
  // name). Neither examines two CONTROLS, which is what keeps this true. The
  // nearest by WORDING is `identical-links-same-purpose`, links-only and tagged
  // `wcag2aaa`, which e2e/a11y.spec.ts does not request (`wcag2a wcag2aa wcag21a
  // wcag21aa`). Read the output, not this sentence.
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
      data: { name: "Design Sign-off", date: "2026-05-29", daysOverdue: 5 }, status: "active",
      firstSeenAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 2,
    },
    {
      // The second SAME-TYPE row. Distinct `id` and distinct `key` — sanitizeInsights
      // requires both (`key` non-empty, `id` a finite number, `firstSeenAt` an ISO
      // string, and type/severity/status all real union members) or the row is
      // dropped silently and the seed goes inert.
      id: 9104, key: "milestoneSlip:3", type: "milestoneSlip", severity: "medium",
      entityRef: { view: "milestones", id: 3 },
      data: { name: "Rollout", date: "2026-12-11", daysOverdue: 2 }, status: "active",
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
  // ★★ e2e-only recorded budget history (docs/open-followups.md §557). Without it
  // no Playwright run renders the stepped budget line, its change markers, the
  // Reports "Budget changes" table or the variance split rows under it, so the
  // axe gate and the visual baselines said nothing about any of them. Kept out
  // of the sample master for the same golden-fixture reason as `insights`.
  // ★ Shape: one `baseline`, then a create, an increase and a delete, all dated
  // inside the master's plan window (2026-03-02 … 2027-02-26 since the
  // 12-month re-authoring; read `plan` in the master) and before FROZEN_NOW, one
  // per month so each change gets its own chart marker (the chart groups markers
  // by plan period, and `bacFields` CLAMPS a date before the plan start into
  // the first period — so a history left on the old 2026-04…06 dates would
  // collapse all three changes into ONE marker). Each running BAC is the
  // previous one plus its delta, which is the invariant `recordBudgetChange`
  // writes. The final 1400 h / €262,000 deliberately differs from today's
  // own-basis BAC (4208 h / €606,836.03 at the time of writing), so the split
  // rows show a non-zero "unexplained" part
  // (seed-content.spec.ts asserts that figure is not zero). The probe below
  // passes `[]` for tasks exactly as `BudgetReportPanel` does, the default 8 h
  // workday, and an EMPTY holiday set, where the app passes its configured one.
  // ★ Buckets 3 and 4 are real buckets of the master; 9201 names a bucket that
  // no longer exists, which is what a `deleted` entry means. Every row must pass
  // `sanitizeBudgetHistory` (budget-history.ts) or it is dropped on load.
  // Re-measure today's BAC (vite-node takes files only):
  //   printf '%s' 'import {readFileSync} from "node:fs"; import {computeBudgetReport} from "./src/app/budget-report";
  //   const m=JSON.parse(readFileSync("sample-workspace-small.json","utf8"));
  //   const r=computeBudgetReport(m.budgets,m.plan,m.roles,m.resources,8,new Set(),m.absences,[],m.fxRates);
  //   console.log(r.project.budgetHours, r.project.budgetValue);' > probe.tmp.ts
  //   npx vite-node probe.tmp.ts && rm probe.tmp.ts
  budgetHistory: [
    {
      id: "e2e-bh-1", at: "2026-06-01T09:00:00.000Z", date: "2026-06-01", kind: "baseline",
      bucketId: null, bucketName: "",
      projectBacHours: 1200, projectBacValue: 220000, deltaHours: 0, deltaValue: 0,
    },
    {
      id: "e2e-bh-2", at: "2026-07-06T09:00:00.000Z", date: "2026-07-06", kind: "created",
      bucketId: 3, bucketName: "Capped SOW (rate override)",
      projectBacHours: 1360, projectBacValue: 244000, deltaHours: 160, deltaValue: 24000,
    },
    {
      id: "e2e-bh-3", at: "2026-08-03T09:00:00.000Z", date: "2026-08-03", kind: "updated",
      bucketId: 4, bucketName: "Data Migration (fixed price)",
      projectBacHours: 1480, projectBacValue: 274000, deltaHours: 120, deltaValue: 30000,
    },
    {
      id: "e2e-bh-4", at: "2026-09-07T09:00:00.000Z", date: "2026-09-07", kind: "deleted",
      bucketId: 9201, bucketName: "Pilot Workshop",
      projectBacHours: 1400, projectBacValue: 262000, deltaHours: -80, deltaValue: -12000,
    },
  ],
  // ★★ These rows reach the axe scan only because the Time bookings test
  // switches the integration on first (`seedTimelogSettings` in e2e/seed.ts,
  // §171): timelog-panel.tsx returns `TimelogNotConfigured` while `cfg.enabled`
  // is false, and the default is false. Only the PROJECT links render without a
  // fetch; the People table needs `sync.users`, which is network-only.
  // ★ The round-trip through sanitizeTimelogLinks is also what proves the kv key.
  // ★ `bucketId: 1` is a real budget id in the master, so the row's <select>
  // resolves to a named option rather than falling back to "none".
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

/** Optional kv slices deliberately NOT seeded, each with its reason. They are
 *  CONFIGURATION, not rows: there is no empty state to scan, and seeding a
 *  non-default value would change what every spec renders. Every other slice
 *  in idb-layout.ts must carry data here, which idb-layout.test.ts enforces in
 *  both directions (a listed slice must also be absent). */
export const SEED_UNSEEDED_BY_DESIGN: Readonly<Record<string, string>> = {
  fieldVisibility: "per-project field hiding; absent means every field shows, the state the specs assert on",
  features: "per-project module switches; absent means the defaults, which the navigation specs rely on",
  settingsOverrides: "per-project settings overrides; absent means the device settings the specs set up",
};
