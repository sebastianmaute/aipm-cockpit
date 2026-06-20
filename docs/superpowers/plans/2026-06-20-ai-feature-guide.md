# AI App-Feature Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in, view-scoped "feature guides" to the operating-guide library so the in-app assistant can explain/navigate app features it currently has to guess about.

**Architecture:** A curated `lib/app-feature-guide.md` (overview + per-view sections with scope markers) is parsed by an extended `scripts/gen-operating-guide.mjs` into `BUILTIN_FEATURE_GUIDES` (an array of scoped guide seeds) in the generated module; `use-operating-guides` seeds them as built-in (undeletable, toggleable); `selectActiveGuides` already loads the overview + the current view's guide into the cached system-prompt prefix.

**Tech Stack:** Next.js 16 / React 19 / TS, vitest, node ESM build scripts. NO new dep. Guides are English-only (no i18n). EN/DE only for the release highlight string.

---

## Conventions (read once)
- Lint fatal (`--max-warnings=0`). Guide CONTENT is English-only (the existing leadership guide is too) — no EN/DE parity for guide text. Only `versionHighlight*` is i18n'd (EN+DE, em-dash separators, DE via node write).
- The generated file `src/app/operating-guide-builtin.generated.ts` is AUTO-GENERATED (header says do-not-edit) — only change it by running the generator; a sync-guard test enforces it.
- Prebuild already runs `node scripts/gen-operating-guide.mjs` (package.json `prebuild`). Extending that script needs no package.json change.
- Real `AppView` ids (nav-config.ts): `projects, open-points, dashboard, actions, trends, history, chat, gantt, milestones, resources, directory, workload, calendar, planning, manage-roles, budget, budget-report, raid, raid-report, changes, change-report, stakeholders, raci, stakeholder-map, documents, reports, activity, settings, learning-insights, steering-committee`.

## File Structure
- `lib/app-feature-guide.md` (NEW) — source.
- `scripts/gen-operating-guide.mjs` (MODIFY) — add an exported `parseFeatureGuide(md, validViews)` + read the md + emit `BUILTIN_FEATURE_GUIDES`.
- `src/app/operating-guide-builtin.generated.ts` (regenerated) — + the feature-guide array.
- `src/app/use-operating-guides.ts` (MODIFY) — seed the feature guides; generalise the undeletable guard.
- `src/app/operating-guide-builtin.test.ts` + a new `scripts`-parser test (MODIFY/CREATE).
- `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md`.

---

## Task 1: Author `lib/app-feature-guide.md`

**Files:** Create `lib/app-feature-guide.md`

- [ ] **Step 1: Write the source**
Create `lib/app-feature-guide.md`. Format: a leading `## Overview` section (NO scope marker → always-on), then one `## <Title>` section per view, each followed IMMEDIATELY by a scope-marker line `<!-- views: <comma,sep,AppView,ids> -->`. Each section: 3-6 terse bullets ending with an `AI:` bullet stating what the assistant can/can't do via tools. English. Example (write the real thing for ALL listed views):
```markdown
# App Feature Guide

This guide describes the List of Open Points Tracker's features so the assistant can explain them and guide the user. It does NOT grant new abilities — the `AI:` line in each section states what the assistant can actually do via its tools.

## Overview
- Open Points (tasks), Action Center, AI assistant (this chat), Dashboard, Trends, Reports, RAID, Changes, Milestones/Gantt, Stakeholders, Steering committee, Calendar, Settings — ask for detail on any view.
- Recent additions: task status + Kanban board, steering committee, guided tour + demo, timezones (per-project/per-device + a calendar world-clock), AI weight suggestions / Action-Center analysis / scheduled jobs, create-project from a description / file / SharePoint / Confluence.

## Open Points (tasks)
<!-- views: open-points -->
- The task list of open points. Toggle Table or Board (Kanban) per device; drag cards or use the status dropdown.
- Each task has a status (To Do / In Progress / On Hold / In Review / Cancelled / Done); "Done" auto-stamps completion. Tasks can link RAID items and sync with Jira (Jira-synced tasks are read-only for status/assignee).
- AI: I can create and update tasks — including setting status — and link/seed from documents. I cannot toggle the Table/Board view or change a Jira-synced task's status (do that in Jira).

## Steering committee
<!-- views: steering-committee -->
- Record the committee name, members (from your resources), the meeting schedule, and information-pack reminder rules (N working days before each meeting). Pack reminders surface in the Action Center; meetings + reminders can be pushed to your Outlook calendar.
- AI: I can summarise meetings/reminders and help draft agendas in chat. The committee is user-edited — I don't have a write tool for it.
```
Write a section for EACH of these views (pick the right AppView id; group siblings in one marker where natural): open-points; actions; chat; dashboard; trends; reports (+ budget-report/raid-report/change-report); raid; changes; milestones (`<!-- views: milestones,gantt -->`); stakeholders (+ raci/stakeholder-map); calendar (mention the multi-timezone world-clock strip); settings (mention timezone config, AI config, scheduled jobs, guided tour replay). Each ends with a truthful `AI:` line (RAID/changes/milestones/stakeholders HAVE create/update/delete tools; timezones/tour/Kanban-toggle/Outlook-push/scheduled-jobs are NOT AI-actionable — say so). Keep total tight (aim < ~150 lines).

- [ ] **Step 2: Commit**
```bash
git add lib/app-feature-guide.md
git commit -m "docs(ai-guide): app-feature guide source markdown"
```

---

## Task 2: Parser + generator emit `BUILTIN_FEATURE_GUIDES`

**Files:** Modify `scripts/gen-operating-guide.mjs`; Test `src/app/app-feature-guide-parse.test.ts`

- [ ] **Step 1: Failing parser test** (`src/app/app-feature-guide-parse.test.ts`)
```ts
import { describe, it, expect } from "vitest";
import { parseFeatureGuide } from "../../scripts/gen-operating-guide.mjs";

const MD = `# App Feature Guide
intro line
## Overview
- a
- b
## Open Points
<!-- views: open-points -->
- tasks
- AI: I can create tasks.
## Calendar
<!-- views: calendar -->
- clock
`;
const valid = ["open-points", "calendar", "settings"];

describe("parseFeatureGuide", () => {
  it("emits an always-on overview + per-view guides with scopes", () => {
    const out = parseFeatureGuide(MD, valid);
    expect(out[0]).toMatchObject({ id: "builtin-app-overview", scope: {} });
    expect(out[0].content).toContain("- a");
    const op = out.find((g) => g.id === "builtin-feature-open-points");
    expect(op.scope).toEqual({ views: ["open-points"] });
    expect(op.content).toContain("AI: I can create tasks.");
    const cal = out.find((g) => g.id === "builtin-feature-calendar");
    expect(cal.scope).toEqual({ views: ["calendar"] });
  });
  it("throws on an unknown view id in a marker", () => {
    const bad = `## Overview\n- x\n## Bad\n<!-- views: not-a-view -->\n- y\n`;
    expect(() => parseFeatureGuide(bad, valid)).toThrow(/not-a-view/);
  });
});
```
Run `npm run test:run -- app-feature-guide-parse` → FAIL.

- [ ] **Step 2: Implement the parser + emit in `scripts/gen-operating-guide.mjs`**
Add (keep the existing leadership emit intact). Export the parser so the test can import it:
```js
import { existsSync } from "node:fs";
// ... existing SRC/OUT/content for leadership ...

const FEATURE_SRC = join(process.cwd(), "lib", "app-feature-guide.md");

/** Parse the feature guide md into ordered guide seeds: an always-on overview
 *  (id builtin-app-overview, scope {}) + one per "## Title\n<!-- views: a,b -->"
 *  section (id builtin-feature-<firstView>, scope {views:[...]}). Throws on an
 *  unknown view id. Pure. */
export function parseFeatureGuide(md, validViews) {
  const lines = md.split(/\r?\n/);
  const guides = [];
  let cur = null; // { title, scopeViews, body[] }
  const flush = () => {
    if (!cur) return;
    const content = [`## ${cur.title}`, ...cur.body].join("\n").trim();
    if (cur.title === "Overview") {
      guides.push({ id: "builtin-app-overview", name: "App overview", content, scope: {} });
    } else if (cur.scopeViews) {
      guides.push({ id: `builtin-feature-${cur.scopeViews[0]}`, name: `Feature: ${cur.title}`, content, scope: { views: cur.scopeViews } });
    }
    cur = null;
  };
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) { flush(); cur = { title: h[1].trim(), scopeViews: null, body: [] }; continue; }
    const sm = /^<!--\s*views:\s*([^>]+?)\s*-->$/.exec(line.trim());
    if (sm && cur) {
      const views = sm[1].split(",").map((v) => v.trim()).filter(Boolean);
      for (const v of views) if (!validViews.includes(v)) throw new Error(`app-feature-guide: unknown view id "${v}" in section "${cur.title}"`);
      cur.scopeViews = views;
      continue;
    }
    if (cur) cur.body.push(line);
  }
  flush();
  return guides;
}

// When run as the prebuild script (not imported), regenerate the output file.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  const VALID_VIEWS = /* paste the AppView id list (string[]) — keep in sync with nav-config */ [
    "projects","open-points","dashboard","actions","trends","history","chat","gantt","milestones","resources","directory","workload","calendar","planning","manage-roles","budget","budget-report","raid","raid-report","changes","change-report","stakeholders","raci","stakeholder-map","documents","reports","activity","settings","learning-insights","steering-committee",
  ];
  const featureGuides = existsSync(FEATURE_SRC) ? parseFeatureGuide(readFileSync(FEATURE_SRC, "utf8"), VALID_VIEWS) : [];
  const body = `// AUTO-GENERATED by scripts/gen-operating-guide.mjs — do not edit by hand.
// Sources: lib/project-leadership-operating-guide.md, lib/app-feature-guide.md
export const BUILTIN_GUIDE_ID = "builtin-leadership";
export const BUILTIN_GUIDE_NAME = "Project Leadership Operating Guide";
export const BUILTIN_GUIDE_CONTENT = ${JSON.stringify(content)};
export const BUILTIN_FEATURE_GUIDES: { id: string; name: string; content: string; scope: { views?: string[] } }[] = ${JSON.stringify(featureGuides, null, 2)};
`;
  writeFileSync(OUT, body, "utf8");
  console.log(`gen-operating-guide: wrote ${OUT} (leadership ${content.length} chars, ${featureGuides.length} feature guides)`);
}
```
★ NOTE: the existing script ran its write at top level — wrap that existing write logic inside the `if (isMain)` block too (so importing the module for the test does NOT write files). Confirm the `isMain` check works on Windows (the `.replace(/\\/g,"/")` handles backslashes); if flaky, use `process.argv[1]?.endsWith("gen-operating-guide.mjs")` instead.
Run `npm run test:run -- app-feature-guide-parse` → PASS.

- [ ] **Step 3: Regenerate + verify**
Run `node scripts/gen-operating-guide.mjs`. Confirm `operating-guide-builtin.generated.ts` now exports `BUILTIN_FEATURE_GUIDES` (overview + one per section). `npx tsc --noEmit` → 0 (the generated TS is valid). `npm run lint` → clean.

- [ ] **Step 4: Commit**
```bash
git add scripts/gen-operating-guide.mjs src/app/operating-guide-builtin.generated.ts src/app/app-feature-guide-parse.test.ts
git commit -m "feat(ai-guide): generate view-scoped BUILTIN_FEATURE_GUIDES from the feature md"
```

---

## Task 3: Seed the feature guides (`use-operating-guides.ts`)

**Files:** Modify `src/app/use-operating-guides.ts`; Test (extend) `src/app/use-operating-guides.test.tsx` (or the existing guides test)

- [ ] **Step 1: Failing test**
Add a test (mirror the existing guides-hook test harness — find it) asserting: after `refresh`, the store contains the leadership guide + every `BUILTIN_FEATURE_GUIDES` id; each feature guide is `builtIn:true` and carries its `scope`; a previously-DISABLED built-in keeps `enabled:false` across a re-refresh (toggle preserved); `remove(featureGuideId)` is a no-op (undeletable). If the hook is heavy to test, test a small extracted `ensureBuiltins(existing): OperatingGuide[]` pure helper instead (preferred — extract the merge logic).

- [ ] **Step 2: Implement**
- Import `BUILTIN_FEATURE_GUIDES` from `./operating-guide-builtin.generated`.
- Replace the single-`builtinGuide()` seed with a list. Add a pure helper:
```ts
function builtinSeeds(): OperatingGuide[] {
  return [
    { id: BUILTIN_GUIDE_ID, name: BUILTIN_GUIDE_NAME, content: BUILTIN_GUIDE_CONTENT, enabled: true, priority: 1, scope: {}, builtIn: true },
    ...BUILTIN_FEATURE_GUIDES.map((g, i) => ({
      id: g.id, name: g.name, content: g.content, enabled: true,
      priority: 2 + i, scope: g.scope as GuideScope, builtIn: true,
    })),
  ];
}
const BUILTIN_IDS = new Set(builtinSeeds().map((g) => g.id));
```
- In `refresh` (~line 47): instead of "seed only when the store is empty", ensure EACH built-in is present + content-current while PRESERVING the user's enabled/priority:
```ts
let list = await loadGuides(cfgRef.current);
const byId = new Map(list.map((g) => [g.id, g]));
for (const seed of builtinSeeds()) {
  const existing = byId.get(seed.id);
  // absent → seed as-is; present → refresh content/name/scope, keep user enabled/priority
  const merged = existing ? { ...seed, enabled: existing.enabled, priority: existing.priority } : seed;
  if (!existing || existing.content !== seed.content || existing.name !== seed.name) {
    await saveGuide(cfgRef.current, merged);
  }
}
list = await loadGuides(cfgRef.current);
```
- Generalise the undeletable guard (`remove`, ~line 95): `if (BUILTIN_IDS.has(id)) return;` (was `id === BUILTIN_GUIDE_ID`).
Run the test → PASS.

- [ ] **Step 3: Verify + commit**
`npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run -- operating-guide use-operating-guides` → green.
```bash
git add src/app/use-operating-guides.ts src/app/use-operating-guides.test.tsx
git commit -m "feat(ai-guide): seed view-scoped feature guides (built-in, undeletable, toggle-preserving)"
```

---

## Task 4: Sync-guard + selectActiveGuides coverage

**Files:** Modify `src/app/operating-guide-builtin.test.ts`

- [ ] **Step 1: Extend the sync-guard test**
Add a case that imports `parseFeatureGuide` from the generator + reads `lib/app-feature-guide.md` + asserts the committed `BUILTIN_FEATURE_GUIDES` equals `parseFeatureGuide(src, VALID_VIEWS)` (so a stale generated file fails CI). Reuse the same VALID_VIEWS list (export it from the generator to DRY, or inline). Also assert `BUILTIN_FEATURE_GUIDES` is non-empty + every entry has a stable `builtin-feature-*` / `builtin-app-overview` id.

- [ ] **Step 2: selectActiveGuides coverage test**
Add (in the operating-guide test or a select test): build guides from `[...builtinSeeds()]`, call `selectActiveGuides(guides, { mode, modules, view: "steering-committee" })` → result includes `builtin-app-overview` + `builtin-feature-steering-committee` and EXCLUDES `builtin-feature-open-points`. (Confirm `selectActiveGuides` + `dimensionMatches` semantics: scope `{}` always matches; `{views:[X]}` matches only view X.)

- [ ] **Step 3: Verify + commit**
`npm run test:run -- operating-guide` → green. `npm run build` → succeeds (prebuild runs the gen + the sync-guard now covers the feature guides). `npx tsc --noEmit` → 0; `npm run lint` → clean.
```bash
git add src/app/operating-guide-builtin.test.ts
git commit -m "test(ai-guide): sync-guard + view-scoped selection for feature guides"
```

---

## Task 5: Release v0.116.0

**Files:** Modify `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version + highlight key** — `version.ts`: `APP_VERSION="0.116.0"`; update the build-date comment; `APP_MILESTONE` = an unused author codename (grep CHANGELOG to confirm unused — e.g. `"Lem"` if not taken by the dedup, else `"Aldiss"`/`"Wyndham"`/`"Verne"` etc.; pick one NOT present). Append `"versionHighlightAiFeatureGuide"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2: Highlight i18n** — EN: `versionHighlightAiFeatureGuide: "The AI assistant now knows the app: a built-in, per-view feature guide lets it explain what each area does and point you to capabilities — ask it 'how do I ...?'."` DE (node UTF-8 write, real umlauts, em-dash): `"Der KI-Assistent kennt jetzt die App: Ein integrierter, ansichtsbezogener Funktionsleitfaden lässt ihn erklären, was jeder Bereich kann, und Sie zu Funktionen führen — fragen Sie 'Wie mache ich ...?'."` Verify parity + umlauts (`lässt`, `führen`).
- [ ] **Step 3: CHANGELOG** — prepend:
```markdown
## [0.116.0] - <date> "<codename>"

### Added
- The AI assistant understands the app's features: a built-in, view-scoped feature guide (in the operating-guide library, on by default, individually toggleable) tells the assistant what each view does and whether it can act on it — so it can answer "how do I ...?" and guide you to capabilities. Knowledge only; it adds no new automated actions.
```
- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run` → green; `npm run build` → succeeds; `npx playwright test e2e/a11y.spec.ts --project=chromium` → 12/12 (no UI change, but confirm no regression).
- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(ai-guide): release v0.116.0 (AI app-feature guide)"
```

---

## Final steps
1. Final whole-branch review (focus: generator parse correctness + `isMain` guard not writing on import; seed preserves user toggles + refreshes content + built-ins undeletable; selectActiveGuides view scoping; sync-guard catches drift; guide content truthful about AI-actionability; no token blow-up — guides terse + view-scoped).
2. Use superpowers:finishing-a-development-branch.
3. Branch `ai-feature-guide` off clean main — MR diffs to just this.

## Self-review notes (resolved)
- **Spec coverage:** source md (T1), generator+parser+BUILTIN_FEATURE_GUIDES (T2), seeding+undeletable+toggle-preserve (T3), sync-guard+select coverage (T4), release (T5). All spec sections covered.
- **Type consistency:** `parseFeatureGuide(md, validViews)`, guide-seed shape `{id,name,content,scope:{views?}}`, `builtinSeeds()`, `BUILTIN_IDS` consistent across tasks. Seed `scope` cast to `GuideScope` (the runtime type).
- **Key risk pinned:** the generator's top-level write must move inside `if (isMain)` so the vitest import of `parseFeatureGuide` doesn't rewrite files (T2 NOTE).
- **Upgrade path:** seed-if-absent + content-refresh-preserving-toggle (T3) gives existing users the new guides without resetting their enable/disable choices.
