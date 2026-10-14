# Pilot onboarding phase 2 (§713) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical user can install and set up the app from the install guide alone: the guide covers what the pilot session needed, shows a cropped screenshot per step, the app links to the guide and carries a "Getting started" Help entry, and the README gallery is regenerated from one opt-in Playwright spec.

**Architecture:** Two small in-app changes (one Help entry, two guide links through the existing `INSTALL_GUIDE_URL`). One opt-in Playwright project, `guide-shots`, writes every guide and gallery image deterministically and is never part of CI. A pure Node helper plus a vitest test checks that every image the guide and README reference exists. Then the guide's text changes and the §713 closure.

**Tech Stack:** Next.js / React / TypeScript, vitest + Testing Library, Playwright 1.x, Node ESM scripts.

**Spec:** `docs/superpowers/specs/2026-10-13-pilot-onboarding-design.md`, section "Phase 2" with its "Amendments at design approval (owner, 2026-10-14)".

## Global Constraints

- Every new string has EN and DE keys (`src/app/i18n.ts` / `src/app/i18n.de.ts`) with real umlauts. Patch `i18n.de.ts` with a node utf8 script anchored on `\r\n`, never the Edit tool.
- Every new control has an accessible name and keyboard operation.
- No real personal or client names; examples use "Acme" / `acme`. Fake keys look fake: `sk-ant-api03-EXAMPLE-EXAMPLE-EXAMPLE`.
- The screenshot spec never reads `.env*` and never writes `*.manual.png`.
- Guide links all use `INSTALL_GUIDE_URL` (`src/app/version.ts`), which is `APP_REPO_URL` + `/blob/main/docs/desktop-rollout.md`.
- Line endings: `src/**`, `e2e/**`, `scripts/*.mjs`, `package.json`, `playwright.config.ts` are CRLF in the working tree; `docs/**/*.md`, `CHANGELOG.md`, `CONTRIBUTING.md` are LF. Check each touched file with `git ls-files --eol <file>`.
- Commits: conventional prefix, cite `§713` only, no trailer, no URL; `git commit --only <paths>`. Never `--amend`, `sed -i`, `git checkout --`, bare `git stash`.
- Vitest only under the shared lock, targeted files, `--maxWorkers=2`. No full vitest, e2e or build.
- Not a pixel gate: no `toHaveScreenshot` anywhere in this phase.

## Rulings (made while planning; each costs little if wrong)

- **R1 — gallery count is 17, not 16.** `grep -oE "docs/assets/[a-z0-9-]+\.png" README.md | sort -u | wc -l` → 17. The spec's "16" was a miscount.
- **R2 — `version-history.png` stays hand-captured.** It shows the `history` view, which is in `TURSO_ONLY_VIEWS` (`src/app/nav-config.ts`); the file-mode seed cannot render it. The spec regenerates the other 16; the existence test still covers all 17.
- **R3 — "Help menu" means the in-app Help panel** (`src/app/help-menu.tsx`, its footer beside License), not the Electron native menu (`desktop/src/lib/menu-model.ts`, English-only, no URL actions).
- **R4 — the §711 checklist link already exists** (`turso-setup-steps.tsx` renders `INSTALL_GUIDE_URL`). No task.
- **R5 — the guide's Timelog step already says "paste the address"** (§704 updated it: `grep -n "Your Timelog address" docs/desktop-rollout.md`). Task 5 only adds its screenshot.
- **R6 — gallery size stays as it is.** Existing PNGs are 2544×1376 (`file docs/assets/dashboard.png`): viewport 1272×688 at `deviceScaleFactor: 2`. Guide shots use the spec's 1280×800 at `deviceScaleFactor: 2`.
- **R7 — the gallery is shot from the e2e seed, not by clicking "Explore the demo project".** The demo is `sample-workspace-small.json` shifted so its as-of date lands on today (`src/app/demo-workspace.ts`); at `FROZEN_NOW` = `DEMO_AS_OF` = 2026-09-18 the shift is zero, so the seed IS the demo data. The demo banner is suppressed the way `e2e/visual.spec.ts` does it (`DEMO_BANNER_DONE_KEY`), except in the banner shot.
- **R8 — the two hand-captured shots are not referenced until the owner adds them.** The guide describes those steps in text; an `![…](….manual.png)` line would fail the existence test until the files exist.

## Review Focus

1. **German UI.** A DE user opening Help sees the new entry fully translated with umlauts, and its `[[labels]]` resolve against the DE dictionary too → Task 1 runs `help-content-gate.test.ts` and `i18n-encoding.test.ts`.
2. **The screenshot spec leaking into CI.** `npm run e2e` (the `chromium` project) must not run `guide-shots.spec.ts` → Task 3 pins it with `npx playwright test --list --project=chromium`.
3. **A renamed or deleted image.** A later rename of a `docs/assets` PNG must fail a test, not show a broken image on GitHub → Task 2's existence test, with an anti-vacuity floor.
4. **A real secret in a picture.** The AI key, Turso token and Timelog token fields must show fakes → Task 3 asserts the spec file reads no environment variable (grep), and Task 4's shots type only the fake constants.
5. **A retake that moves.** Two runs must frame the same region with the same data → frozen clock, UTC, en-US, light scheme, reduced motion, fixed viewport (Task 3 harness); checked by running the spec twice and `git status` showing no PNG change (Task 4, Task 6).

---

### Task 1: Help entry "Getting started: set up a budget"

**Files:**
- Modify: `src/app/help-content.ts` (the `workflows` block, around `workflow-budget`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/help-content.test.ts`

**Interfaces:**
- Produces: help entry id `"workflow-getting-started"`, group `"workflows"`, keys `helpWorkflowGettingStartedTitle` / `helpWorkflowGettingStartedBody`. Task 4's Help shot opens it by its title.

- [ ] **Step 1: Write the failing test** in `help-content.test.ts`:

```ts
it("lists Getting started first among the workflows, before the budget workflow", () => {
  const workflows = HELP_ENTRIES.filter((e) => e.group === "workflows").map((e) => e.id);
  expect(workflows[0]).toBe("workflow-getting-started");
  const entry = HELP_ENTRIES.find((e) => e.id === "workflow-getting-started")!;
  expect(entry.titleKey).toBe("helpWorkflowGettingStartedTitle");
  expect(entry.relatedViews).toEqual(["budget", "resources", "timelog"]);
});
```

- [ ] **Step 2: Run it under the lock** — `npx vitest run src/app/help-content.test.ts --maxWorkers=2`. Expected: FAIL, `expected 'workflow-end-to-end' to be 'workflow-getting-started'`.

- [ ] **Step 3: Add the entry and strings.** Insert as the FIRST `workflows` row:
  `{ id: "workflow-getting-started", group: "workflows", titleKey: "helpWorkflowGettingStartedTitle", bodyKey: "helpWorkflowGettingStartedBody", relatedViews: ["budget", "resources", "timelog"], relatedConcepts: ["concept-budget", "concept-resource"] }`.
  EN copy (the `[[ ]]` labels are verified to exist: `projectsEdit`, `settingsSectionMode`, `budgetSetupGoRoles`, `budgetAddBucket`, `navTimelog`, `helpExploreDemo`):

```
helpWorkflowGettingStartedTitle: "Getting started: set up a budget",
helpWorkflowGettingStartedBody: "1. Turn on the functions you need: open Projects, choose [[Edit project]] and go to [[Functions]]. Budget needs Resources; importing time bookings needs both.\n2. Give each role an hourly rate: in Budget, choose [[Manage roles]].\n3. Add the people who work on the project, each with the email they use in Timelog, so their bookings can be matched.\n4. In Budget, choose [[Add bucket]] once per phase and plan its hours by role and month.\n5. Import actual hours from [[Time bookings]], or type them in.\n\nTo see a finished project first, open Help and choose [[Explore the demo project]]. The install guide (Help, at the bottom) covers keys and storage.",
```

  DE copy (node utf8 script, `\r\n` anchor): title `"Erste Schritte: ein Budget einrichten"`; body is the same five steps in German with each `[[label]]` replaced by that key's DE value read from `i18n.de.ts` (`grep -n "^  projectsEdit:\|^  settingsSectionMode:\|^  budgetSetupGoRoles:\|^  budgetAddBucket:\|^  navTimelog:\|^  helpExploreDemo:" src/app/i18n.de.ts`).

- [ ] **Step 4: Run the tests** — `npx vitest run src/app/help-content.test.ts src/app/help-content-gate.test.ts src/app/i18n-encoding.test.ts --maxWorkers=2`. Expected: 3 files pass. Then `npx tsc --noEmit` → exit 0, 0 errors (EN/DE parity).

- [ ] **Step 5: Commit** — `git commit --only src/app/help-content.ts src/app/help-content.test.ts src/app/i18n.ts src/app/i18n.de.ts -m "feat: a Getting started Help entry for setting up a budget (§713)"`.

---

### Task 2: Install-guide links in Help and About, and the image-reference test

**Files:**
- Modify: `src/app/help-menu.tsx` (footer, beside the License link), `src/app/version-info.tsx` (the GitHub / LinkedIn / Sponsor row)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Create: `scripts/doc-image-refs.mjs`, `scripts/doc-image-refs.test.mjs`
- Test: `src/app/help-menu.test.tsx`, `src/app/version-info.test.tsx`

**Interfaces:**
- Consumes: `INSTALL_GUIDE_URL` from `src/app/version.ts`.
- Produces: i18n key `installGuideLink` (EN `"Installation & setup guide"`, DE `"Installations- und Einrichtungsanleitung"`); `export function imageRefs(markdown: string, fromFile: string): string[]` in `scripts/doc-image-refs.mjs` — repo-relative POSIX paths of every local image in `![alt](path)` and `<img src="path">`, fenced code ignored, `http(s):` skipped, `#…`/`?…` stripped, resolved against `dirname(fromFile)`. No shebang (vitest imports it).

- [ ] **Step 1: Write the failing tests.**
  `help-menu.test.tsx`: open the panel; `getByRole("link", { name: "Installation & setup guide ↗" })` has `href` `INSTALL_GUIDE_URL`, `target="_blank"`, `rel="noopener noreferrer"`, and comes BEFORE the License link in DOM order.
  `version-info.test.tsx`: `getByRole("link", { name: "Installation & setup guide" })` has `href` `INSTALL_GUIDE_URL`.
  `scripts/doc-image-refs.test.mjs`:
  - unit: `imageRefs('![a](docs/assets/x.png) <img src="docs/assets/y.png">', "README.md")` → `["docs/assets/x.png", "docs/assets/y.png"]`; `imageRefs("![a](assets/z.png)", "docs/guide.md")` → `["docs/assets/z.png"]`; a ref inside a ``` fence, an `https://…png` and `![a](x.png#frag)` → only `x.png`.
  - repo: for `README.md` and `docs/desktop-rollout.md`, every ref exists on disk (`existsSync`); README yields at least 17 refs (anti-vacuity: a regex that matched nothing would otherwise pass).
- [ ] **Step 2: Run them** — the two component tests FAIL (no link); the script test FAILS with "Cannot find module".
- [ ] **Step 3: Implement.** Help footer: an `<a>` with the License link's exact classes, text `` `${t(lang, "installGuideLink")} ↗` ``, placed before License. About: `<ExternalLink href={INSTALL_GUIDE_URL}>{t(lang, "installGuideLink")}</ExternalLink>` first in the GitHub row. DE via node script. The helper as specified in Interfaces.
- [ ] **Step 4: Run** `npx vitest run src/app/help-menu.test.tsx src/app/version-info.test.tsx scripts/doc-image-refs.test.mjs src/app/i18n-encoding.test.ts --maxWorkers=2` → all pass, and assert the output's `Test Files` count equals the number of files named. `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5: Commit** — `git commit --only <the files above> -m "feat: link the install guide from Help and About, and check every guide and README image exists (§713)"`.

---

### Task 3: The `guide-shots` Playwright project and its harness

**Files:**
- Create: `e2e/guide-shots.spec.ts` (harness + the Task 4 / Task 6 describes land here), `e2e/guide-callouts.ts`
- Modify: `playwright.config.ts`, `package.json` (`scripts` + `scriptsDescriptions`), `CONTRIBUTING.md` (regenerated table)

**Interfaces:**
- Produces, in `e2e/guide-callouts.ts`:
  - `export async function markCallout(page: Page, target: Locator, n?: number): Promise<void>` — appends one absolutely positioned `div[data-guide-callout]` over `target.boundingBox()` (3px solid `var(--ui-pink)` border, 6px radius, `pointer-events: none`, z-index above modals); with `n`, a numbered round marker at its top-left using the same token. Throws if the target has no box.
  - `export async function clearCallouts(page: Page): Promise<void>`.
- Produces, in `guide-shots.spec.ts`: `const GUIDE_DIR = "docs/assets/guide"`, `const GALLERY_DIR = "docs/assets"`, and `async function shot(locator: Locator, file: string): Promise<void>` → `locator.screenshot({ path, animations: "disabled", caret: "hide" })`.

- [ ] **Step 1: Add the project** in `playwright.config.ts`: `{ name: "guide-shots", testMatch: /guide-shots\.spec\.ts/, workers: 1, fullyParallel: false, retries: 0, use: { ...devices["Desktop Chrome"], timezoneId: "UTC", locale: "en-US", colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } }`, with a comment saying it is opt-in and why it never runs in CI. Add `/guide-shots\.spec\.ts/` to the `chromium` project's `testIgnore`.
- [ ] **Step 2: Add the script** `"docs:guide-shots": "playwright test --project=guide-shots"` and its `scriptsDescriptions` entry: `"Regenerate the install-guide screenshots (docs/assets/guide/) and the README gallery (docs/assets/*.png) from e2e/guide-shots.spec.ts. Opt-in, never in CI; not a pixel gate — review the PNG diff by eye. version-history.png and *.manual.png are hand-captured and never written."`. Regenerate CONTRIBUTING.md with the repo's sync script (`grep -n "docs:scripts" package.json` names it), then `npm run docs:scripts:check` → exit 0.
- [ ] **Step 3: Write the harness** — the `test` fixture from `./seed`, `skipTour`, `gotoApp(page, FROZEN_NOW)`, the `DEMO_BANNER_DONE_KEY` init script as `e2e/visual.spec.ts` sets it, `mkdirSync(GUIDE_DIR, { recursive: true })`, and one smoke test: "harness: the Dashboard renders under the frozen clock" which writes nothing.
- [ ] **Step 4: Verify isolation and secrets.**
  - `npx playwright test --list --project=chromium > <scratch>/list.txt 2>&1; grep -c guide-shots <scratch>/list.txt` → `0`.
  - `npx playwright test --list --project=guide-shots` lists the harness test.
  - `grep -nE "process\.env|\.env" e2e/guide-shots.spec.ts e2e/guide-callouts.ts; echo EXIT=$?` → no match, `EXIT=1`.
  - `npx tsc --noEmit` → 0 errors; `npx eslint --max-warnings=0 e2e/guide-shots.spec.ts e2e/guide-callouts.ts playwright.config.ts` → exit 0.
- [ ] **Step 5: Commit** — `git commit --only playwright.config.ts package.json CONTRIBUTING.md e2e/guide-shots.spec.ts e2e/guide-callouts.ts -m "test: an opt-in guide-shots Playwright project for the guide and README images (§713)"`.

---

### Task 4: The guide shots

**Files:**
- Modify: `e2e/guide-shots.spec.ts` (a `describe("guide")` block)
- Create: `docs/assets/guide/01-splash.png` … `10-help-entry.png` (written by the run)

**Interfaces:**
- Consumes: `markCallout`, `clearCallouts`, `shot`, `GUIDE_DIR` (Task 3); `splashScript`, `splashMessages` from `desktop/src/lib/splash-status.ts`; help title `helpWorkflowGettingStartedTitle` (Task 1).
- Produces: exactly these files, which Task 5 embeds:

| File | State | Crop target |
|---|---|---|
| `01-splash.png` | `page.goto(pathToFileURL("desktop/splash.html").href)`, then `page.evaluate(splashScript("status", splashMessages("en-US").starting))` and `page.evaluate(splashScript("slow", splashMessages("en-US").slow))` — what a user sees after 10 s | the whole page |
| `02-turso-steps.png` | Settings → storage, Turso chosen, the numbered setup steps visible; callout on the "Step-by-step guide ↗" link | the steps block |
| `03-ai-key.png` | Settings → AI Assistant, enabled, key field filled with `sk-ant-api03-EXAMPLE-EXAMPLE-EXAMPLE` | the AI section |
| `04-timelog-address.png` | Settings → Integrations, Timelog enabled, `https://app.timelog.com/acme/registration/week` pasted (`locator.fill` then blur), host/tenant shown | the Timelog section |
| `05-functions.png` | Projects → Edit project → Functions, Time bookings ticked with Resources off so the §707 notice shows; callout on the notice | the Functions part |
| `06-roles.png` | Budget → Manage roles, rates visible | the roles dialog |
| `07-resource-form.png` | Resources → add a person, name `Alex Example`, email `alex@acme.example`; callout on the email field | the form |
| `08-budget-checklist.png` | a workspace with no buckets (`reseedWorkspace` with `buckets: []`, before `gotoApp`), Budget view | the checklist card |
| `09-demo-banner.png` | fresh device (do NOT set `DEMO_BANNER_DONE_KEY` in this test), Dashboard | the banner |
| `10-help-entry.png` | Help panel open, "Getting started: set up a budget" expanded | the Help panel |

- [ ] **Step 1: Discover before scripting.** For each row, open the view in a headed run (`npx playwright test --project=guide-shots --headed -g harness` plus `page.pause()` locally, removed before commit) and find each target by role and accessible name (`getByRole(..., { exact: true })` — Playwright names are substring matches by default). Record any label that differs from the table in the commit message body.
- [ ] **Step 2: Write one test per row**, each ending in `clearCallouts` + `shot(...)`. Each test also asserts its target is visible before the shot (`await expect(target).toBeVisible()`), so a missing control fails loudly rather than producing a blank crop.
- [ ] **Step 3: Run** `npm run docs:guide-shots > <scratch>/shots.log 2>&1; echo EXIT=$?` → `EXIT=0`, then `ls docs/assets/guide` lists the 10 files.
- [ ] **Step 4: Prove determinism.** Run the command again; `git status --porcelain docs/assets/guide` shows the 10 files as untracked only (no second-run diff after `git add -N` on the first run: run 1, `git add docs/assets/guide`, run 2, `git diff --stat docs/assets/guide` → empty). If a file differs, find the moving part (a time string, a caret, an animation) and pin it; do not retry until it passes.
- [ ] **Step 5: Eye-check** every PNG (open each with the Read tool): crop shows the named control, callout lands on it, no real data, no secret. Then commit — `git commit --only e2e/guide-shots.spec.ts docs/assets/guide -m "docs: the install guide's screenshots, taken by the guide-shots spec (§713)"`.

---

### Task 5: The guide text

**Files:**
- Modify: `docs/desktop-rollout.md`

**Interfaces:**
- Consumes: the 10 files from Task 4; the Help entry title from Task 1; `installGuideLink` text from Task 2.

- [ ] **Step 1: Edit the guide** (LF file; keep its voice — short numbered steps, bold UI labels):
  - **Installing**, before step 3: the browser's own warning that the file "isn't commonly downloaded" — open the download list and choose **Keep** (some browsers ask twice). Then Windows' box (existing step).
  - **The first time you open it**, first paragraph: the first start can take a minute while the app prepares itself; a splash says so, and Windows may briefly label the window "Not responding" — wait, do not close it. Embed `01-splash.png`.
  - **Claude API key**, after step 2: a Claude.ai subscription (Pro, Max, Team) does not include API use; API credit is bought separately on the console's [Billing page](https://console.anthropic.com/settings/billing). No amounts, no expense wording. Embed `03-ai-key.png` at step 6.
  - **Turso database**: embed `02-turso-steps.png` where the in-app steps are mentioned.
  - **Timelog**: embed `04-timelog-address.png` at step 4.
  - A new section **Setting up your first budget**, after "Getting your keys and tokens": one paragraph pointing to the in-app Help entry **Getting started: set up a budget** (don't restate the five steps), the shots `05`–`08` each with a one-line caption, and where the demo is (`09`, `10`).
  - Image syntax: `![<what the picture shows>](assets/guide/NN-name.png)` — alt text describes the content, as the README's do.
- [ ] **Step 2: Run** `npx vitest run scripts/doc-image-refs.test.mjs --maxWorkers=2` (under the lock) → pass; `npm run docs:claims:check` → exit 0; `npm run docs:symbols:check` → exit 0.
- [ ] **Step 3: Commit** — `git commit --only docs/desktop-rollout.md -m "docs: the install guide covers the download prompt, the first start, API credit and budget setup, with pictures (§713)"`.

---

### Task 6: The README gallery

**Files:**
- Modify: `e2e/guide-shots.spec.ts` (a `describe("gallery")` with `test.use({ viewport: { width: 1272, height: 688 } })`)
- Modify: the 16 PNGs in `docs/assets/` named in R2 (all README images except `version-history.png`)

**Interfaces:**
- Consumes: harness from Task 3 (seed at `FROZEN_NOW`, demo banner suppressed).
- Produces: full-window `page.screenshot({ path, animations: "disabled", caret: "hide" })` per image, in the state its README alt text names:

| File | State (from the README alt text) |
|---|---|
| `dashboard.png` | Dashboard |
| `open-points.png` | Open Points, table |
| `swimlanes.png` | Open Points, board / swimlanes |
| `gantt.png` | Gantt with the View menu open |
| `raid.png` | RAID, a risk's edit dialog open |
| `budget.png` | Budget |
| `budget-report-efficiency.png` | Budget report, at-current-efficiency forecast |
| `budget-report-pace.png` | Budget report, at-current-pace forecast selected |
| `changes.png` | Changes, a change request open with its notes log |
| `stakeholders.png` | Stakeholders, edit dialog open on the grid |
| `raci.png` | RACI |
| `knowledge.png` | Knowledge |
| `operating-guides.png` | Settings → Operating guides |
| `information-flows.png` | Settings → Information flows |
| `new-project.png` | New project wizard, step 1 |
| `help.png` | Help |

- [ ] **Step 1: Write one test per row**, each asserting a view-specific landmark is visible before the shot.
- [ ] **Step 2: Run** `npm run docs:guide-shots` → `EXIT=0`; a second run leaves `git diff --stat docs/assets` unchanged from the first (same determinism proof as Task 4).
- [ ] **Step 3: Eye-check all 16 against the old ones** (`git show HEAD:docs/assets/<name> > <scratch>/old-<name>` and open both): same view, same state, no regression in what the caption claims. Any README caption that no longer matches its picture is corrected in `README.md` in this commit.
- [ ] **Step 4: Run** `npx vitest run scripts/doc-image-refs.test.mjs src/app/no-nul-bytes.test.ts --maxWorkers=2` → pass.
- [ ] **Step 5: Commit** — `git commit --only e2e/guide-shots.spec.ts docs/assets README.md -m "docs: regenerate the README gallery from the guide-shots spec (§713)"`.

---

### Task 7: Close §713, CHANGELOG, gates

**Files:**
- Modify: `docs/open-followups.md` (§713 → CLOSED; remove its Work item line; index rebuilt), `CHANGELOG.md`

- [ ] **Step 1: Close §713** — heading `— CLOSED 2026-10-DD`, a Status line opening `CLOSED` with the date and an executed command in backticks (e.g. `grep -c "assets/guide/" docs/desktop-rollout.md` → its real count), and a closure paragraph written from the diff: what the guide now covers, the Help entry, the two links, the spec, and what stays manual (the two hand-captured shots, `version-history.png`). Remove `**Work item:** #702`. `node scripts/rebuild-followup-index.mjs`.
- [ ] **Step 2: CHANGELOG** — under the unreleased section: a Getting started Help entry, install-guide links in Help and About, and a guide with pictures for downloading, first start, API credit and budget setup.
- [ ] **Step 3: Gates** — `npx tsc --noEmit` (0 errors); `npx eslint --max-warnings=0 <every changed .ts/.tsx/.mjs>`; `npm run size:check`, `npm run dup:check`, `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run docs:scripts:check`, `npm run followups:index:check`, `npm run followups:status:check`, `npm run followups:workitems:check` — each read unpiped, each exit 0.
- [ ] **Step 4: Commit** — `git commit --only docs/open-followups.md CHANGELOG.md -m "docs: close §713"`. The PR description carries `Closes #702`.
