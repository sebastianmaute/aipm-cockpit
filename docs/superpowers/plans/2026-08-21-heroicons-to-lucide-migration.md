# heroicons → `lucide-react` Icon Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `@heroicons/react` from the app, routing all 69 icons through one `src/app/icons.ts` barrel backed by `lucide-react`, with today's visual weight preserved.

**Architecture:** A side-effect-free barrel re-exports lucide icons under the heroicons names the 78 call sites already use, so the conversion is 78 one-line import changes and zero JSX churn. A CSS rule on lucide's `.lucide` class pins `stroke-width: 1.5` app-wide (heroicons' weight; lucide defaults to 2). A dev-only `/icon-gallery` route plus two Playwright specs make the glyphs reviewable and keep the stroke pin provable in a real browser.

**Tech Stack:** Next.js 16 (app router), React, TypeScript, Tailwind v4, Vitest 4, Playwright, ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-08-21-heroicons-to-lucide-migration-design.md`

---

## Ground rules for whoever executes this

Read these before Task 1. Each has cost this repo real work.

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status — a failing suite reads as green. Redirect, echo the code unpiped, then read the file:
   ```bash
   npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
   ```
2. **`npm run lint` is bare `eslint` with no `--max-warnings`, so it exits 0 on warnings.** It does not reproduce the CI gate. Use `npx eslint --max-warnings=0 src/app` and read the exit code with no pipe attached.
3. **Never run two vitest processes at once.** Machine saturation is this repo's load-sensitive flake condition.
4. **Never use bare `git stash` / `git stash pop`.** The stash stack is shared with other worktrees. Use a WIP commit instead.
5. **Never `git commit --amend`.** It rewrites whatever HEAD is, which in a shared worktree has swallowed another session's commit twice. Make a new commit, and scope it with `git commit --only <paths>`.
6. **`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts** (and curls double quotes, which bites umlaut-free strings too). Task 11 is the only task that touches it and carries its own procedure.
7. This branch is `refactor/heroicons-to-lucide`, already created off `origin/main` at `0ff948bb`. Do not push, open an MR, or merge unless the user explicitly says so.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/icons.ts` | **create** | The barrel. 69 re-exports, lucide name → app name, plus the `AppIcon` type. No runtime values. |
| `src/app/icons.test.ts` | **create** | Pins the export list **and** each icon's real lucide identity via `displayName`. |
| `src/app/globals.css` | modify | One rule pinning `stroke-width: 1.5` on `.lucide`. |
| `src/app/icon-gallery/page.tsx` | **create** | Dev-only route rendering every barrel icon. Permanent. |
| `src/app/icon-gallery/compare/page.tsx` | **create, then delete** | Side-by-side heroicons vs lucide contact sheet. Scaffolding — removed in Task 9. |
| `e2e/icon-gallery.spec.ts` | **create** | Runs in CI (`chromium` project): icon count, computed stroke width, `aria-hidden`. |
| `e2e/icon-gallery.visual.spec.ts` | **create** | Runs in the opt-in `visual` project: the gallery screenshot baseline. |
| `scripts/codemod-icons.mjs` | **create, then delete** | Batch rewriter for the 78 import statements. Scaffolding — removed in Task 9. |
| 78 files under `src/app/` | modify | Import line only. Listed per batch in Task 8. |
| `eslint.config.mjs` | modify | `no-restricted-imports` banning `@heroicons/react`. |
| `package.json` | modify | Drop the dependency; bump `version`. |
| `docs/` ×4, `README.md`, `docs/CODEMAPS/*.md` ×5, `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md` | modify | Tasks 10 and 11. |

★ **Why the barrel keeps the heroicons names.** It makes the conversion 78 one-line changes with no JSX churn, which is what keeps a 78-file diff reviewable. The cost is that the app's icon vocabulary stays heroicons-flavoured (`Cog6ToothIcon` for what lucide calls `Settings`). That is a deliberate, spec-approved trade; the barrel is precisely the single place a later rename slice would edit. Do not "improve" it mid-migration.

---

### Task 1: The barrel and its mapping test

**Files:**
- Create: `src/app/icons.ts`
- Create: `src/app/icons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/icons.test.ts`. It asserts two things: that the barrel exports exactly 69 icons, and that each one resolves to the *intended lucide glyph*. The second is possible because `createLucideIcon` sets `displayName` to the canonical lucide name (verified: `ZapIcon.displayName === "Zap"`), so this pins the mapping itself rather than merely the names.

```ts
import { describe, it, expect } from "vitest";
import type { ComponentType } from "react";
import * as icons from "./icons";

/** app name -> the canonical lucide name it MUST resolve to.
 *
 *  ★★★ This is the mapping's only automated guard. A name-only test would pass
 *  while a row was repointed at the wrong glyph — which is the exact defect
 *  class this migration found twice by hand (BoltIcon, ChartBarIcon below). */
const EXPECTED: Record<string, string> = {
  AcademicCapIcon: "GraduationCap",
  AdjustmentsHorizontalIcon: "SlidersHorizontal",
  ArrowDownTrayIcon: "Download",
  ArrowLongRightIcon: "MoveRight",
  ArrowPathIcon: "RefreshCw",
  ArrowPathRoundedSquareIcon: "Repeat",
  ArrowRightIcon: "ArrowRight",
  ArrowTopRightOnSquareIcon: "ExternalLink",
  ArrowTrendingUpIcon: "TrendingUp",
  ArrowUpTrayIcon: "Upload",
  ArrowUturnLeftIcon: "Undo2",
  ArrowUturnRightIcon: "Redo2",
  ArrowsPointingInIcon: "Minimize",
  ArrowsRightLeftIcon: "ArrowLeftRight",
  BackspaceIcon: "Delete",
  Bars2Icon: "Equal",
  Bars3BottomLeftIcon: "TextAlignStart",
  Bars3Icon: "Menu",
  BellIcon: "Bell",
  BoltIcon: "Zap",
  BookOpenIcon: "BookOpen",
  BookmarkIcon: "Bookmark",
  BriefcaseIcon: "Briefcase",
  BuildingLibraryIcon: "Landmark",
  CalendarDaysIcon: "CalendarDays",
  CalendarIcon: "Calendar",
  ChartBarIcon: "ChartColumn",
  ChartBarSquareIcon: "SquareChartGantt",
  ChatBubbleLeftRightIcon: "MessagesSquare",
  CheckCircleIcon: "CircleCheck",
  CheckIcon: "Check",
  ChevronDownIcon: "ChevronDown",
  ClockIcon: "Clock",
  Cog6ToothIcon: "Settings",
  CurrencyDollarIcon: "CircleDollarSign",
  DocumentChartBarIcon: "FileChartColumn",
  DocumentTextIcon: "FileText",
  EllipsisHorizontalIcon: "Ellipsis",
  EllipsisVerticalIcon: "EllipsisVertical",
  EnvelopeIcon: "Mail",
  ExclamationTriangleIcon: "TriangleAlert",
  EyeSlashIcon: "EyeOff",
  FlagIcon: "Flag",
  IdentificationIcon: "IdCard",
  InformationCircleIcon: "Info",
  LightBulbIcon: "Lightbulb",
  ListBulletIcon: "List",
  LockClosedIcon: "Lock",
  MapPinIcon: "MapPin",
  MicrophoneIcon: "Mic",
  PaperClipIcon: "Paperclip",
  PencilIcon: "Pencil",
  PlusIcon: "Plus",
  PresentationChartLineIcon: "Presentation",
  PrinterIcon: "Printer",
  QuestionMarkCircleIcon: "CircleQuestionMark",
  RectangleStackIcon: "Layers",
  ShieldCheckIcon: "ShieldCheck",
  SparklesIcon: "Sparkles",
  Squares2X2Icon: "LayoutGrid",
  StopIcon: "Square",
  SunIcon: "Sun",
  TableCellsIcon: "Table",
  TrashIcon: "Trash",
  UserGroupIcon: "UsersRound",
  UserMinusIcon: "UserMinus",
  UsersIcon: "Users",
  ViewColumnsIcon: "Columns3",
  XMarkIcon: "X",
};

describe("icons barrel", () => {
  it("exports exactly the expected icon set", () => {
    expect(Object.keys(icons).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("exports 69 icons", () => {
    expect(Object.keys(icons)).toHaveLength(69);
  });

  it.each(Object.entries(EXPECTED))(
    "%s resolves to the lucide %s glyph",
    (appName, lucideName) => {
      const icon = (icons as Record<string, ComponentType & { displayName?: string }>)[appName];
      expect(icon, `${appName} is not exported`).toBeDefined();
      expect(icon.displayName).toBe(lucideName);
    },
  );

  it("★★★ maps no two app names onto the same glyph", () => {
    const targets = Object.values(EXPECTED);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("★★ keeps UsersIcon and UserGroupIcon visually distinct", () => {
    // Resources uses one and Stakeholders the other; a shared target would
    // silently merge two nav views' glyphs.
    expect(icons.UsersIcon.displayName).not.toBe(icons.UserGroupIcon.displayName);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/icons.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL — `Failed to resolve import "./icons"`. `EXIT=1`.

- [ ] **Step 3: Create the barrel**

Create `src/app/icons.ts`:

```ts
// The app's icon vocabulary — the ONLY file that may import `lucide-react`
// directly (`rich-text-toolbar.tsx` is the one grandfathered exception; its
// icon set came from Tiptap's reference toolbar).
//
// ★★ Names on the LEFT are lucide's, names on the RIGHT are the app's. The app
// keeps the heroicons vocabulary on purpose: the migration is then 78 one-line
// import changes with zero JSX churn, and a later rename is one edit HERE plus
// a codemod. Do not "modernise" the right-hand names piecemeal.
//
// ★★★ A NAME MATCH IS NOT A GLYPH MATCH. Two icons carry the same name in both
// packages and DRAW DIFFERENT THINGS. Both are remapped below, and both drive a
// nav view, so a name-for-name codemod would have shipped the wrong glyph twice:
//   BoltIcon      heroicons: a lightning flash · lucide `Bolt`: a hardware nut
//                 (`bolt.mjs` opens with a circle at cx 12 cy 12 r 4) -> Zap
//   ChartBarIcon  heroicons: vertical columns · lucide `ChartBar`: HORIZONTAL
//                 bars (`M7 16h8`) -> ChartColumn (`M18 17V9`)
// Check a glyph at `/icon-gallery` in dev. Never conclude from the name.
//
// ★ Targets are lucide's CANONICAL names, never its back-compat aliases: there
// is no `check-circle.mjs`, only `circle-check.mjs`. `icons.test.ts` pins each
// row against the component's own `displayName`, so an alias fails the suite.
//
// ★ Stroke weight is NOT set here. heroicons draws at 1.5 and lucide defaults to
// 2; `globals.css` pins 1.5 on the `.lucide` class that lucide always emits. A
// `LucideProvider` was rejected — it would leave every unit test rendering a
// different weight than the app.
export type { LucideIcon as AppIcon } from "lucide-react";

export {
  GraduationCapIcon as AcademicCapIcon,
  SlidersHorizontalIcon as AdjustmentsHorizontalIcon,
  DownloadIcon as ArrowDownTrayIcon,
  MoveRightIcon as ArrowLongRightIcon,
  RefreshCwIcon as ArrowPathIcon,
  RepeatIcon as ArrowPathRoundedSquareIcon,
  ArrowRightIcon,
  ExternalLinkIcon as ArrowTopRightOnSquareIcon,
  TrendingUpIcon as ArrowTrendingUpIcon,
  UploadIcon as ArrowUpTrayIcon,
  Undo2Icon as ArrowUturnLeftIcon,
  Redo2Icon as ArrowUturnRightIcon,
  MinimizeIcon as ArrowsPointingInIcon,
  ArrowLeftRightIcon as ArrowsRightLeftIcon,
  DeleteIcon as BackspaceIcon,
  // A Gantt drag handle. `Equal` reproduces today's two bars exactly;
  // `GripHorizontal` is lucide's idiomatic grip but draws dots — fidelity wins.
  EqualIcon as Bars2Icon,
  TextAlignStartIcon as Bars3BottomLeftIcon,
  MenuIcon as Bars3Icon,
  BellIcon,
  ZapIcon as BoltIcon,
  BookOpenIcon,
  BookmarkIcon,
  BriefcaseIcon,
  LandmarkIcon as BuildingLibraryIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartColumnIcon as ChartBarIcon,
  SquareChartGanttIcon as ChartBarSquareIcon,
  MessagesSquareIcon as ChatBubbleLeftRightIcon,
  CircleCheckIcon as CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  SettingsIcon as Cog6ToothIcon,
  CircleDollarSignIcon as CurrencyDollarIcon,
  FileChartColumnIcon as DocumentChartBarIcon,
  FileTextIcon as DocumentTextIcon,
  EllipsisIcon as EllipsisHorizontalIcon,
  EllipsisVerticalIcon,
  MailIcon as EnvelopeIcon,
  TriangleAlertIcon as ExclamationTriangleIcon,
  EyeOffIcon as EyeSlashIcon,
  FlagIcon,
  IdCardIcon as IdentificationIcon,
  InfoIcon as InformationCircleIcon,
  LightbulbIcon as LightBulbIcon,
  ListIcon as ListBulletIcon,
  LockIcon as LockClosedIcon,
  MapPinIcon,
  MicIcon as MicrophoneIcon,
  PaperclipIcon as PaperClipIcon,
  PencilIcon,
  PlusIcon,
  PresentationIcon as PresentationChartLineIcon,
  PrinterIcon,
  CircleQuestionMarkIcon as QuestionMarkCircleIcon,
  LayersIcon as RectangleStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  LayoutGridIcon as Squares2X2Icon,
  SquareIcon as StopIcon,
  SunIcon,
  TableIcon as TableCellsIcon,
  TrashIcon,
  // Stakeholders. MUST differ from `UsersIcon` (Resources) — pinned by a test.
  UsersRoundIcon as UserGroupIcon,
  UserMinusIcon,
  UsersIcon,
  Columns3Icon as ViewColumnsIcon,
  XIcon as XMarkIcon,
} from "lucide-react";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/icons.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, `Tests  73 passed` (4 named tests + 69 from `it.each`).

- [ ] **Step 5: Prove the mapping test is not vacuous**

Mutate one row and confirm the suite goes red — a test that cannot fail is worse than none.

```bash
cp src/app/icons.ts /tmp/icons.bak
node -e "const f='src/app/icons.ts';const s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace('ZapIcon as BoltIcon,','BoltIcon,'))"
npx vitest run src/app/icons.test.ts > /tmp/t1m.log 2>&1; echo "MUTANT_EXIT=$?"
cp /tmp/icons.bak src/app/icons.ts; grep -c "ZapIcon as BoltIcon" src/app/icons.ts
npx vitest run src/app/icons.test.ts > /tmp/t1r.log 2>&1; echo "REVERTED_EXIT=$?"
```

Expected: `MUTANT_EXIT=1` (the `BoltIcon resolves to the lucide Zap glyph` case fails with `Bolt`), then `REVERTED_EXIT=0`. **If `MUTANT_EXIT=0`, stop and fix the test** — do not proceed.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/icons.ts src/app/icons.test.ts
git commit --only src/app/icons.ts src/app/icons.test.ts -m "feat: add the icons barrel over lucide-react

69 re-exports under the heroicons names the call sites already use, plus an
AppIcon type. Two glyph traps remapped: lucide's Bolt is a hardware nut and its
ChartBar is horizontal, so Activity and Workload take Zap and ChartColumn.

The test pins each row against the component's own displayName, so a row
repointed at a plausible-but-wrong glyph fails rather than passing a name check."
```

---

### Task 2: Pin the stroke weight

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the rule**

Insert immediately **before** the `/* Print: DIN A4 page, …` comment that precedes `@media print` (around line 182). ★★ It must be **outside** the print block — the file ends inside `@media print`, so appending at EOF puts the rule in the wrong scope and it will only apply when printing.

```css
/* Icon stroke weight. lucide defaults to strokeWidth 2; heroicons `24/outline`
   — which every icon in this app came from until the icons.ts migration — draws
   at 1.5. Pinning it here keeps the app's line weight unchanged.

   ★★ A CSS rule, NOT a `LucideProvider`, and the reason is testability: a
   provider is React context, so every existing unit test would render at 2
   while the app rendered 1.5. jsdom sees no CSS either way, so neither
   mechanism is unit-testable — but this one does not manufacture a divergence.
   The pin is asserted in a real browser by e2e/icon-gallery.spec.ts.

   ★ Beats lucide's `stroke-width` presentation attribute, because any CSS
   declaration outranks a presentation attribute. So no per-call-site prop is
   needed.

   ★★ OVERRIDING IT NEEDS `!`, NOT JUST AN ARBITRARY VALUE. This file is
   UNLAYERED while Tailwind v4 emits every utility inside `@layer utilities`,
   and an unlayered normal declaration beats a layered one regardless of
   specificity or source order. So `stroke-2` / `stroke-[2]` on an icon SILENTLY
   DOES NOTHING — the override is `stroke-[2]!`. Nothing needs it today; this is
   recorded so the first person who does need it is not debugging a no-op. */
.lucide {
  stroke-width: 1.5;
}
```

- [ ] **Step 2: Verify placement — the rule must not be inside `@media print`**

```bash
awk '/@media print/{p=NR} /^\.lucide \{/{r=NR} END{print "print_block_starts:", p, "rule_at:", r, (r<p ? "OK" : "WRONG - rule is inside the print block")}' src/app/globals.css
```

Expected: `OK`.

- [ ] **Step 3: Confirm the dev server compiles the stylesheet**

```bash
PORT=3100 npm run dev > /tmp/dev.log 2>&1 &
sleep 15
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/
PORT=3100 npm run stop
```

Expected: `200`. A Tailwind compile error in `globals.css` 500s the whole app, so this is the cheapest possible check that the rule parses.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit --only src/app/globals.css -m "style: pin lucide icon stroke weight to heroicons' 1.5

lucide defaults to 2. A CSS rule rather than a LucideProvider: a provider would
leave every unit test rendering a different weight than the app."
```

---

### Task 3: The permanent icon gallery route

**Files:**
- Create: `src/app/icon-gallery/page.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { notFound } from "next/navigation";
import * as icons from "../icons";
import type { AppIcon } from "../icons";

// Dev-only gallery of every icon in `icons.ts`, rendered at the size the app
// uses most. It exists so glyph choices are reviewable by eye and so the
// stroke-weight pin in globals.css has something a browser test can measure —
// jsdom has no CSS, so no unit test can ever see it.
//
// ★ Guarded out of production. The repo ships three page routes; this is a
// deliberate fourth that must never reach a build users see.
//
// ★ Deliberately NOT in A11Y_VIEWS: 69 decorative aria-hidden glyphs scan clean
// and would prove nothing.
export default function IconGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const entries = Object.entries(icons as Record<string, AppIcon>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <main className="p-8">
      <h1 className="mb-6 text-xl font-medium">Icon gallery</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {entries.length} icons from <code>src/app/icons.ts</code>. Names are the app&apos;s;
        the glyph is lucide&apos;s.
      </p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {entries.map(([name, Icon]) => (
          <li
            key={name}
            data-icon-cell={name}
            className="flex flex-col items-center gap-2 rounded border border-line p-3"
          >
            <Icon aria-hidden="true" className="h-6 w-6" />
            <span className="break-all text-center text-xs text-muted-foreground">{name}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders in dev**

```bash
PORT=3100 npm run dev > /tmp/dev.log 2>&1 &
sleep 15
curl -s http://localhost:3100/icon-gallery > /tmp/gallery.html; echo "EXIT=$?"
grep -o 'data-icon-cell="[^"]*"' /tmp/gallery.html | sort -u | wc -l
PORT=3100 npm run stop
```

Expected: `69`.

★★ **Count UNIQUE ATTRIBUTE VALUES, not lines and not raw occurrences.** An earlier
revision of this step used `grep -c`, which counts matching LINES — the SSR response is
ONE line, so it returns `1` and looks like catastrophic failure. And a bare `grep -o | wc -l`
returns **138**, because Next embeds the markup twice: once as DOM and once in the RSC flight
payload used for hydration. Only the dedup above answers the question. ★ This does not affect
Task 4: Playwright's `toHaveCount` counts real DOM elements, and the flight payload is script
content, not elements carrying the attribute.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app/icon-gallery; echo "LINT=$?"
```

Expected: both `0`.

- [ ] **Step 4: Commit**

```bash
git add src/app/icon-gallery/page.tsx
git commit --only src/app/icon-gallery/page.tsx -m "feat: add a dev-only icon gallery route

Renders every icons.ts export so glyph choices are reviewable by eye, and so
the globals.css stroke pin has something a browser test can measure. notFound()
under NODE_ENV=production."
```

---

### Task 4: The CI gallery spec

**Files:**
- Create: `e2e/icon-gallery.spec.ts`

★ This lands in the **`chromium`** Playwright project, which is what CI runs. It deliberately takes no screenshot — screenshots are per-platform and live in Task 5's opt-in project.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "@playwright/test";

// The gallery's CI-side assertions. No screenshot here on purpose: Playwright
// baselines are per-platform and the `visual` project is opt-in, so anything
// that must run on every pipeline has to be a plain assertion.
//
// ★★ The stroke-width check is the ONLY proof the globals.css pin works. jsdom
// has no CSS, so no unit test in this repo can observe it, in either the CSS or
// the LucideProvider design.
test.describe("icon gallery", () => {
  test("renders every barrel icon", async ({ page }) => {
    await page.goto("/icon-gallery");
    await expect(page.locator("[data-icon-cell]")).toHaveCount(69);
  });

  test("★★ pins every icon to the heroicons stroke weight of 1.5", async ({ page }) => {
    await page.goto("/icon-gallery");
    const svg = page.locator("[data-icon-cell] svg").first();
    await expect(svg).toBeVisible();

    const widths = await page.locator("[data-icon-cell] svg").evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).strokeWidth))),
    );
    expect(widths).toEqual(["1.5px"]);
  });

  test("keeps every gallery glyph out of the accessibility tree", async ({ page }) => {
    await page.goto("/icon-gallery");
    const exposed = await page.locator("[data-icon-cell] svg").evaluateAll((nodes) =>
      nodes.filter((n) => n.getAttribute("aria-hidden") !== "true").length,
    );
    expect(exposed).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx playwright test e2e/icon-gallery.spec.ts --project=chromium --workers=1 > /tmp/e2e1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e1.log
```

Expected: `EXIT=0`, 3 passed. The `webServer` starts automatically.

★★ `--workers=1` is not optional when running more than one Playwright test locally: CI runs `workers: 1` while local defaults to CPU count, and over-subscription produces `Test timeout of 60000ms exceeded` failures that look like real defects and name no rule.

- [ ] **Step 3: Prove the stroke assertion is not vacuous**

```bash
node -e "const f='src/app/globals.css';const s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace('  stroke-width: 1.5;','  stroke-width: 2;'))"
npx playwright test e2e/icon-gallery.spec.ts --project=chromium --workers=1 -g "stroke weight" > /tmp/e2e1m.log 2>&1; echo "MUTANT_EXIT=$?"
git checkout -- src/app/globals.css
```

Expected: `MUTANT_EXIT=1`, with the failure showing `["2px"]`. **If it passes, the pin is not reaching the icons — stop and diagnose before continuing.**

★ The dev server may need a moment to pick up the CSS change; if the mutant run passes suspiciously fast, restart the server and re-run before concluding anything.

- [ ] **Step 4: Commit**

```bash
git add e2e/icon-gallery.spec.ts
git commit --only e2e/icon-gallery.spec.ts -m "test: assert gallery icon count, stroke pin and aria-hidden in CI

The stroke-width case is the only place the globals.css pin can be proved --
jsdom has no CSS, so no unit test can observe it."
```

---

### Task 5: The gallery visual baseline

**Files:**
- Create: `e2e/icon-gallery.visual.spec.ts`

★★ The filename is load-bearing. `playwright.config.ts` gives the `visual` project `testMatch: /visual\.spec\.ts/` and the `chromium` project `testIgnore: /visual\.spec\.ts/`, both **unanchored** — so `icon-gallery.visual.spec.ts` is picked up by the visual project and skipped by CI automatically. Naming it anything else either double-runs it or puts a per-platform screenshot into the CI job.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

// The permanent contact sheet. Opt-in (`npm run e2e:visual`), because Playwright
// baselines are per-platform — see the note at the top of visual.spec.ts.
//
// ★ A gallery is the most stable screenshot in this repo: no seeded data, no
// dates, no layout that depends on content. That is why it is a reasonable
// permanent baseline where the app-screen baselines have rotted.
test.use({ viewport: { width: 1280, height: 1400 } });

test("visual: icon gallery", async ({ page }) => {
  await page.goto("/icon-gallery");
  await expect(page.locator("[data-icon-cell]")).toHaveCount(69);
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("icon-gallery.png", {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});
```

- [ ] **Step 2: Confirm project routing before generating anything**

```bash
npx playwright test --project=visual --list | grep -c "icon gallery"; echo "---"
npx playwright test --project=chromium --list | grep -c "icon gallery"
```

Expected: `1` then `0` — the visual project owns it and CI does not. **If the second number is not 0, the filename is wrong; fix it before generating a baseline.**

- [ ] **Step 3: Generate the baseline**

```bash
npx playwright test e2e/icon-gallery.visual.spec.ts --project=visual --update-snapshots --workers=1 > /tmp/vis.log 2>&1; echo "EXIT=$?"
ls e2e/icon-gallery.visual.spec.ts-snapshots/
```

Expected: `EXIT=0` and one `icon-gallery-*.png` file.

- [ ] **Step 4: Re-run to confirm the baseline is stable**

```bash
npx playwright test e2e/icon-gallery.visual.spec.ts --project=visual --workers=1 > /tmp/vis2.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add e2e/icon-gallery.visual.spec.ts e2e/icon-gallery.visual.spec.ts-snapshots
git commit --only e2e/icon-gallery.visual.spec.ts e2e/icon-gallery.visual.spec.ts-snapshots -m "test: keep an icon-gallery visual baseline

Opt-in visual project (baselines are per-platform). The filename lands it there
automatically via the config's unanchored visual.spec.ts match."
```

---

### Task 6: The contact sheet — heroicons vs lucide, side by side

**Files:**
- Create: `src/app/icon-gallery/compare/page.tsx` (deleted in Task 9)

★ This is the human review gate the whole approach rests on, and it works only while **both** packages are installed — which is why it comes before Task 8 and dies in Task 9. It is a direct A/B in one image rather than two screenshots compared across commits.

- [ ] **Step 1: Create the compare page**

```tsx
import { notFound } from "next/navigation";
import * as hero from "@heroicons/react/24/outline";
import * as lucide from "../../icons";
import type { AppIcon } from "../../icons";

// TEMPORARY migration scaffolding — deleted in the same commit that drops
// @heroicons/react. Renders each icon's OLD and NEW glyph side by side so the
// mapping can be reviewed by eye in one pass.
//
// Start at these six, where fidelity and lucide idiom disagree:
//   Bars2Icon · ChartBarSquareIcon · PresentationChartLineIcon
//   IdentificationIcon · UserGroupIcon · ArrowPathRoundedSquareIcon
// and at the two glyph traps a name-for-name codemod would have shipped:
//   BoltIcon (lucide's Bolt is a hardware nut) · ChartBarIcon (horizontal)
export default function IconComparePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const heroIcons = hero as unknown as Record<string, AppIcon>;
  const names = Object.keys(lucide as Record<string, AppIcon>).sort((a, b) => a.localeCompare(b));

  return (
    <main className="p-8">
      <h1 className="mb-6 text-xl font-medium">heroicons (left) vs lucide (right)</h1>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {names.map((name) => {
          const Old = heroIcons[name];
          const New = (lucide as unknown as Record<string, AppIcon>)[name];
          return (
            <li
              key={name}
              data-compare-cell={name}
              className="flex flex-col items-center gap-2 rounded border border-line p-3"
            >
              <div className="flex items-center gap-4">
                {Old ? <Old aria-hidden="true" className="h-6 w-6" /> : <span>—</span>}
                <span className="text-muted-foreground">→</span>
                <New aria-hidden="true" className="h-6 w-6" />
              </div>
              <span className="break-all text-center text-xs text-muted-foreground">{name}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Capture the contact sheet**

```bash
PORT=3100 npm run dev > /tmp/dev.log 2>&1 &
sleep 20
npx playwright screenshot --full-page --wait-for-timeout=3000 \
  http://localhost:3100/icon-gallery/compare /tmp/contact-sheet.png; echo "EXIT=$?"
PORT=3100 npm run stop
```

Expected: `EXIT=0` and a PNG at `/tmp/contact-sheet.png`.

- [ ] **Step 3: Review it and report**

Open the PNG. Check the eight names called out in the page comment first, then scan the rest. For each, answer only: *does the right-hand glyph mean the same thing as the left-hand one?*

**Show the sheet to the user and get their sign-off before Task 8.** If any mapping is rejected, change that one row in `src/app/icons.ts` **and** the matching row in `src/app/icons.test.ts`, re-run `npx vitest run src/app/icons.test.ts`, and commit that as its own fix before continuing.

- [ ] **Step 4: Commit the scaffolding**

```bash
git add src/app/icon-gallery/compare/page.tsx
git commit --only src/app/icon-gallery/compare/page.tsx -m "test: add a temporary heroicons-vs-lucide compare page

Migration scaffolding: works only while both packages are installed, deleted
with the dependency. One side-by-side image beats comparing screenshots across
commits."
```

---

### Task 7: The codemod

**Files:**
- Create: `scripts/codemod-icons.mjs` (deleted in Task 9)

★ 78 files × a multi-line import each is where hand-editing introduces a typo that typechecks (two icons swapped). The codemod rewrites only the module specifier, leaving the specifier list — including the one `PrinterIcon as PrinterHeroIcon` alias — untouched, because the barrel exports the same names.

- [ ] **Step 1: Write the codemod**

```js
// TEMPORARY migration scaffolding — deleted with the heroicons dependency.
//
// Rewrites `from "@heroicons/react/24/outline"` to the barrel, computing the
// relative path per file. The specifier LIST is never touched: the barrel
// exports the heroicons names, so `{ XMarkIcon, PrinterIcon as PrinterHeroIcon }`
// is already correct.
//
// Usage: node scripts/codemod-icons.mjs <file> [<file>...]
import fs from "node:fs";
import path from "node:path";

const IMPORT_RE = /(import\s*\{[^}]*\}\s*from\s*)"@heroicons\/react\/[^"]+"/g;

let changed = 0;
let skipped = 0;

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  if (!IMPORT_RE.test(src)) {
    console.log(`SKIP  ${file} (no heroicons import)`);
    skipped += 1;
    continue;
  }
  IMPORT_RE.lastIndex = 0;

  // Relative path from this file's directory to src/app/icons.ts, POSIX-style.
  let rel = path
    .relative(path.dirname(path.resolve(file)), path.resolve("src/app/icons"))
    .split(path.sep)
    .join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;

  const out = src.replace(IMPORT_RE, `$1"${rel}"`);
  if (out === src) throw new Error(`no-op rewrite for ${file} — investigate`);
  fs.writeFileSync(file, out);
  console.log(`OK    ${file} -> ${rel}`);
  changed += 1;
}

console.log(`\nchanged=${changed} skipped=${skipped}`);
```

- [ ] **Step 2: Prove it on ONE file before touching a batch**

```bash
node scripts/codemod-icons.mjs src/app/toggle-button.tsx
git diff --stat src/app/toggle-button.tsx
git diff src/app/toggle-button.tsx | head -20
```

Expected: exactly **one** line changed — the `from "…"` specifier — and the import's brace list byte-identical.

- [ ] **Step 3: Typecheck the single file's effect**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Revert the probe and commit the script only**

```bash
git checkout -- src/app/toggle-button.tsx
git add scripts/codemod-icons.mjs
git commit --only scripts/codemod-icons.mjs -m "chore: add the icon-import codemod

Rewrites only the module specifier; the brace list is already correct because
the barrel re-exports the heroicons names, alias included."
```

---

### Task 8: Convert the 78 files, in six batches

**Files:** the 78 listed below, all under `src/app/`.

Run the batches **in order**. Each defines its file list once as a shell variable, so the codemod and the commit cannot disagree about what the batch was.

★★ `git commit --only "$BATCHn"` commits **exactly** those paths. Do **not** substitute `git add -A` — this worktree is shared with other checkouts and other sessions, and a blanket add sweeps in whatever else happens to be dirty.

★ Typecheck runs per batch because it is fast and catches every import defect this codemod could produce. The **full** unit suite runs once, at Step 7 — two batches run a targeted subset first because a specific test is known to be sensitive to them.

- [ ] **Step 1: Batch 1 (13 files)**

```bash
BATCH1="src/app/actions-panel.tsx \n  src/app/ai-trigger-button.tsx \n  src/app/app-header.tsx \n  src/app/ask-claude-menu.tsx \n  src/app/budget-panel.tsx \n  src/app/budget-unapplied-notice.tsx \n  src/app/calendar-chip.tsx \n  src/app/calendar-sync-controls.tsx \n  src/app/change-edit-modal.tsx \n  src/app/chat-panel.tsx \n  src/app/chat-thread-list.tsx \n  src/app/chat-tool-block.tsx \n  src/app/clearable-search-input.tsx"

node scripts/codemod-icons.mjs $BATCH1
npx tsc --noEmit; echo "TSC=$?"
git commit --only $BATCH1 -m "refactor: point batch 1 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

- [ ] **Step 2: Batch 2 (13 files)**

```bash
BATCH2="src/app/column-config-popover.tsx \n  src/app/combobox-shared.tsx \n  src/app/dashboard-tip-card.tsx \n  src/app/dictation-mic.tsx \n  src/app/document-badge.tsx \n  src/app/document-block-gutter.tsx \n  src/app/drag-handle.tsx \n  src/app/entity-link-picker.tsx \n  src/app/export-menu.tsx \n  src/app/filter-multiselect.tsx \n  src/app/gantt-chart.tsx \n  src/app/gantt-chrome.tsx \n  src/app/gantt-rows.tsx"

node scripts/codemod-icons.mjs $BATCH2
npx tsc --noEmit; echo "TSC=$?"
npx vitest run src/app/gantt --reporter=dot > /tmp/b2t.log 2>&1; echo "GANTT=$?"; grep -E "Test Files|Tests " /tmp/b2t.log
git commit --only $BATCH2 -m "refactor: point batch 2 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

★ `gantt-chrome.tsx` is read by a brittle markup-ORDER source test, so this batch runs the Gantt tests rather than waiting for Step 7. If it goes red, the test asserts on literal source text — read the failure before changing anything.

- [ ] **Step 3: Batch 3 (13 files) — includes `nav-icons.tsx`, the `AppIcon` decision point**

```bash
BATCH3="src/app/gantt-view-menu.tsx \n  src/app/help-menu.tsx \n  src/app/influence-interest-matrix.tsx \n  src/app/inline-ai-edit-button.tsx \n  src/app/inline-ai-edit-popover.tsx \n  src/app/knowledge-links-field.tsx \n  src/app/labels-input.tsx \n  src/app/milestones-panel.tsx \n  src/app/modal-field-controls.tsx \n  src/app/modal-header.tsx \n  src/app/nav-icons.tsx \n  src/app/notes-badge-button.tsx \n  src/app/notes-window.tsx"

node scripts/codemod-icons.mjs $BATCH3
npx tsc --noEmit; echo "TSC=$?"
npx vitest run src/app/nav-icons src/app/sidebar --reporter=dot > /tmp/b3t.log 2>&1; echo "NAV=$?"; grep -E "Test Files|Tests " /tmp/b3t.log
npx eslint --max-warnings=0 src/app/nav-icons.tsx; echo "LINT=$?"
git commit --only $BATCH3 -m "refactor: point batch 3 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

★★ **`nav-icons.tsx` is the `AppIcon` question.** It types its map as `ComponentType<SVGProps<SVGSVGElement>>`, and a lucide icon is a `ForwardRefExoticComponent` whose props omit `ref`.

- **If `tsc` fails there**, change the annotation: replace `ComponentType<SVGProps<SVGSVGElement>>` in the `NAV_ICON` declaration with `AppIcon`, and add a type import beside the icon import:
  ```tsx
  import { /* …existing icon names… */ } from "./icons";
  import type { AppIcon } from "./icons";

  const NAV_ICON: Record<AppView, AppIcon> = {
  ```
  Then delete the now-unused `ComponentType` / `SVGProps` type import — CI lints at `--max-warnings=0`, so an unused import is **fatal**.
- **If `tsc` passes unmodified**, that is a finding, not a free pass: the spec's §4.1 assignability claim is wrong. Correct §4.1 and the §7 risk row in the spec, and still switch the annotation to `AppIcon` so one type governs both call sites.

- [ ] **Step 4: Batch 4 (13 files)**

```bash
BATCH4="src/app/pick-list-import-modal.tsx \n  src/app/project-switcher.tsx \n  src/app/raci-chip-picker.tsx \n  src/app/raci-panel.tsx \n  src/app/raid-panel-rows.tsx \n  src/app/resource-calendar-band.tsx \n  src/app/resource-directory.tsx \n  src/app/resource-edit-modal.tsx \n  src/app/resource-picker.tsx \n  src/app/resource-workload.tsx \n  src/app/resources-panel.tsx \n  src/app/roles-editor.tsx \n  src/app/saved-views-menu.tsx"

node scripts/codemod-icons.mjs $BATCH4
npx tsc --noEmit; echo "TSC=$?"
git commit --only $BATCH4 -m "refactor: point batch 4 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

- [ ] **Step 5: Batch 5 (13 files) — includes the one aliased import**

```bash
BATCH5="src/app/settings-menu.tsx \n  src/app/settings-sections/integrations-section.tsx \n  src/app/settings-sections/removable-chip-row.tsx \n  src/app/sidebar.tsx \n  src/app/stakeholder-recipient-input.tsx \n  src/app/task-jira-badge.tsx \n  src/app/task-kanban-card.tsx \n  src/app/task-kanban-swimlanes.tsx \n  src/app/task-manager-ui.tsx \n  src/app/task-row.tsx \n  src/app/tasks-section.tsx \n  src/app/template-menus.tsx \n  src/app/timelog-panel-toolbar.tsx"

node scripts/codemod-icons.mjs $BATCH5
npx tsc --noEmit; echo "TSC=$?"
grep -n "PrinterHeroIcon" src/app/task-manager-ui.tsx
git commit --only $BATCH5 -m "refactor: point batch 5 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

★ The `grep` must still show `PrinterIcon as PrinterHeroIcon` on the import and `<PrinterHeroIcon …/>` at its use. That alias dodges a local `PrinterIcon` wrapper in the same file and must survive — the codemod never touches specifier lists, so this is a check, not a step.

★ The two `settings-sections/` files sit one directory deeper; the codemod computes `../icons` for them. Confirm that in the diff.

- [ ] **Step 6: Batch 6 (13 files)**

```bash
BATCH6="src/app/timelog-panel.tsx \n  src/app/timelog-people-table.tsx \n  src/app/toggle-button.tsx \n  src/app/top-bar.tsx \n  src/app/undo/undo-control.tsx \n  src/app/use-alloc-plan.tsx \n  src/app/use-raci-suggest.tsx \n  src/app/use-tasks-dedup.tsx \n  src/app/version-info.tsx \n  src/app/version-menu.tsx \n  src/app/view-callout.tsx \n  src/app/voice-button.tsx \n  src/app/workspace-section-chrome.tsx"

node scripts/codemod-icons.mjs $BATCH6
npx tsc --noEmit; echo "TSC=$?"
git commit --only $BATCH6 -m "refactor: point batch 6 icons at the barrel"
```

Expected: `TSC=0`, 13 files changed in the commit.

- [ ] **Step 7: Run the full unit suite once, now that all 78 are converted**

```bash
npm run test:run > /tmp/b-all.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/b-all.log
```

Expected: `TEST=0`. ★ If this is red, `git log --oneline -6` names the six batch commits — bisect by checking out each and re-running, rather than guessing which file did it.

- [ ] **Step 8: Confirm nothing is left**

```bash
grep -rln "@heroicons/react" src/ | grep -v icon-gallery/compare; echo "EXIT=$?"
```

Expected: no output and `EXIT=1` (grep matched nothing). The compare page from Task 6 is the one intended remaining consumer until Task 9 deletes it.

---

### Task 8b: Retire the heroicons PROSE, not just the imports

**Files:** `src/app/nav-icons.tsx` · `src/app/rich-text-toolbar.tsx` · `src/app/toggle-button.tsx` · `src/app/toggle-button.test.tsx` · `src/app/i18n.ts` · `src/app/i18n.de.ts`

★★★ **Discovered mid-execution; neither the spec nor the original plan had it.** Converting the imports leaves **10** references to heroicons in `src` prose, and two of them become FALSE rather than merely dated. Re-derive the list before starting:

```bash
grep -rn "heroicons\|Heroicon" src --include=*.tsx --include=*.ts | grep -v 'from "@heroicons'
```

- [ ] **Step 1: Fix the inverted a11y reasoning in `toggle-button.tsx`**

Its comment justifies the explicit `aria-hidden` as redundant-but-deliberate: *"heroicons already DEFAULTS it on every icon… heroicons spreads `props` AFTER its own attributes, so this explicit value overrides rather than duplicates."*

**Under lucide that is backwards.** lucide's `Icon` adds `aria-hidden` only when the caller passed NO a11y prop, so an explicit `aria-hidden="true"` means lucide never adds its own — the explicit value is the SOLE source, not an override. Same rendered result, opposite mechanism. Replace those two sentences with prose to this effect, keeping the surrounding ★ markers and indentation intact:

> BELT-AND-BRACES ONLY IN EFFECT, NOT IN MECHANISM — and the mechanism changed with the lucide migration. heroicons set the attribute unconditionally and spread `props` after, so an explicit value OVERRODE it. lucide adds it only when the caller passes no a11y prop, so this explicit value is the SOLE source. Identical output, opposite reason. Keep it; "redundant" was never the right reading, and is now not even true.

Apply the same correction to the comment in `toggle-button.test.tsx` (search `heroicons defaults`), which restates the old mechanism.

- [ ] **Step 2: De-brand two dated comments**

`nav-icons.tsx` — "Single 24x24 line-icon glyph per nav view (heroicons outline)" becomes "(from `icons.ts`)".

`rich-text-toolbar.tsx` — the line pointing at "why the rest of the app still uses heroicons" is obsolete; the rest of the app no longer does. Reword it to say this file and `icons.ts` are the only `lucide-react` importers.

- [ ] **Step 3: Fix the SHIPPED, USER-VISIBLE highlight string**

`versionHighlightHeroicons` renders in the Version popover as *"Unified Heroicons icon set across the whole UI; no functional change."* — false the moment this slice lands, in EN **and** DE.

★★ Reword the VALUES to be package-neutral; do NOT rename the key. The key is internal, while renaming it means touching `APP_HIGHLIGHT_KEYS` in `version.ts` plus both dictionaries for zero user benefit.

EN (`i18n.ts`): `"Unified icon set across the whole UI; no functional change."`

DE (`i18n.de.ts`): `"Einheitlicher Symbolsatz in der gesamten Oberfläche; keine Funktionsänderung."`

★★★ `i18n.de.ts` is **CRLF** and the Edit tool corrupts its umlauts and curls its double quotes. Patch it with a Node utf8 write anchored on a CRLF newline; an LF anchor silently no-ops. The DE string above contains two umlauts — verify them after writing.

- [ ] **Step 4: Verify**

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");const m=s.match(/versionHighlightHeroicons: "[^"]*"/);console.log(m[0]);console.log("umlauts:",/[äöüß]/.test(m[0]),"curly:",/[“”]/.test(m[0]))'
npx tsc --noEmit; echo "TSC=$?"
grep -rn "heroicons\|Heroicon" src --include=*.tsx --include=*.ts | grep -v 'from "@heroicons' | grep -v icon-gallery/compare
```

Expected: the DE string shows real umlauts and no curly quotes, `TSC=0`, and the final grep returns only `icons.ts`'s own deliberate mentions (it documents the migration). The compare page is excluded because Task 9 deletes it.

★ The i18n encoding test bans ASCII substitutes (`fuer`, `druecken`), so "Oberflaeche" is not an escape route — the umlauts must be real.

- [ ] **Step 5: Commit**

```bash
git commit --only \
  src/app/nav-icons.tsx src/app/rich-text-toolbar.tsx \
  src/app/toggle-button.tsx src/app/toggle-button.test.tsx \
  src/app/i18n.ts src/app/i18n.de.ts \
  -m "docs: retire heroicons from prose, including one shipped string"
```

---

### Task 9: Drop the dependency and forbid its return

**Files:**
- Modify: `package.json`, `package-lock.json`, `eslint.config.mjs`
- Delete: `src/app/icon-gallery/compare/page.tsx`, `scripts/codemod-icons.mjs`

- [ ] **Step 1: Delete the scaffolding**

```bash
git rm src/app/icon-gallery/compare/page.tsx scripts/codemod-icons.mjs
```

- [ ] **Step 2: Remove the dependency**

```bash
npm uninstall @heroicons/react
grep -c "@heroicons/react" package.json package-lock.json
```

Expected: `0` in both.

- [ ] **Step 3: Add the lint ban**

Edit `eslint.config.mjs`, appending a config object to the `defineConfig([...])` array, after the `globalIgnores([...])` entry:

```js
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@heroicons/react",
              message:
                "Icons come from src/app/icons.ts. @heroicons/react was removed app-wide (tech-debt TD-8).",
            },
          ],
          patterns: [
            {
              group: ["@heroicons/react/*"],
              message:
                "Icons come from src/app/icons.ts. @heroicons/react was removed app-wide (tech-debt TD-8).",
            },
          ],
        },
      ],
    },
  },
```

★★ **Both `paths` and `patterns` are needed.** Every call site imported the subpath `@heroicons/react/24/outline`, and a `paths` entry matches the exact module name only — a `paths`-only rule bans a form nothing in this repo ever used and permits the form all 78 files did.

★ If a hook blocks writing `eslint.config.mjs`, do not work around it: stop and ask the user to apply this edit.

- [ ] **Step 4: Prove the rule actually fires**

```bash
printf 'import { XMarkIcon } from "@heroicons/react/24/outline";\nexport const x = XMarkIcon;\n' > src/app/__ban-probe.ts
npx eslint --max-warnings=0 src/app/__ban-probe.ts; echo "PROBE_EXIT=$?"
rm src/app/__ban-probe.ts
```

Expected: `PROBE_EXIT=1` with the `no-restricted-imports` message. **A rule that does not fire is worse than no rule** — if this exits 0, fix the config before continuing.

- [ ] **Step 5: Full verification**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/t9.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/t9.log
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `0`. The build is the completeness gate — a missed import cannot survive it.

- [ ] **Step 6: Commit**

```bash
git commit --only \
  package.json package-lock.json eslint.config.mjs \
  src/app/icon-gallery/compare/page.tsx scripts/codemod-icons.mjs \
  -m "refactor: drop @heroicons/react and ban its return

Both a paths and a patterns rule: every call site used the
@heroicons/react/24/outline SUBPATH, which a paths-only rule does not match.
Migration scaffolding (compare page, codemod) removed with the dependency."
```

---

### Task 10: Doc updates

**Files:**
- Modify: `docs/tech-debt-register.md`, `docs/CODEMAPS/dependencies.md`, `docs/work-inventory.md`, `docs/open-followups.md`, `AGENTS.md`

- [ ] **Step 1: Re-measure before writing anything**

```bash
grep -rln "@heroicons/react" src/app | wc -l
grep -rln "lucide-react" src/app --include="*.tsx" --include="*.ts" | wc -l
```

Expected: `0` and `2` (`icons.ts` and `rich-text-toolbar.tsx`). **Put the numbers you measure into the docs, not the numbers this plan predicts.**

- [ ] **Step 2: `docs/tech-debt-register.md`**

Move the `TD-8` row from the open table to the `## Resolved` section, rewriting its status cell to:

```
**Status: RESOLVED <date>.** The app-wide migration shipped: `@heroicons/react` is gone from `package.json` and from every file, all icons come from `src/app/icons.ts`, and an ESLint `no-restricted-imports` rule (both `paths` and `patterns`, since every call site used the `/24/outline` subpath) makes a reintroduction a fatal lint error. Re-derive rather than trusting this: `grep -rln "@heroicons/react" src/app | wc -l` returns 0. ★★ Two name-identical glyph traps were found and remapped during the migration — lucide's `Bolt` is a hardware nut, not a lightning flash, and its `ChartBar` is horizontal where heroicons' is vertical; they drove the Activity and Workload nav views. `src/app/icons.test.ts` pins every row against the component's own `displayName`, so a row repointed at the wrong glyph fails the suite rather than passing a name check.
```

- [ ] **Step 3: `docs/CODEMAPS/dependencies.md`**

Delete the `@heroicons/react` row entirely. Rewrite the `lucide-react` row's consumer note to say that `src/app/icons.ts` is the app-wide barrel and the only permitted importer besides `rich-text-toolbar.tsx`, and that a lint rule enforces it.

- [ ] **Step 4: `docs/work-inventory.md`**

Remove the icon-migration row from the §3 backlog table. In §5, replace the TD-8 paragraph with a one-line "resolved, see the register". In §7, delete item 6 (the icon-package decision) — it is no longer a call to make.

- [ ] **Step 5: `docs/open-followups.md` §145**

Append to the entry, under its existing resolution:

```
★ **The decided work shipped.** The app-wide migration ran as its own slice: `src/app/icons.ts` is the barrel, `@heroicons/react` is removed from `package.json`, and a lint rule blocks its return. The mixed state this entry recorded as *accepted* is over — there is now exactly one icon package.
```

- [ ] **Step 6: `AGENTS.md` — one line, not a section**

Add to the architecture pointers, near the other UI-primitive rules:

```
- **Icons come from `src/app/icons.ts`**, never from `lucide-react` directly (the sole exception is `rich-text-toolbar.tsx`, whose set came from Tiptap's reference toolbar) and never from `@heroicons/react`, which was REMOVED app-wide — a `no-restricted-imports` rule makes a reintroduction fatal. ★★ The barrel re-exports lucide under the OLD heroicons names on purpose, so a name there is not a claim about what lucide calls the glyph. ★★★ A NAME MATCH IS NOT A GLYPH MATCH: lucide's `Bolt` is a hardware nut and its `ChartBar` is horizontal, so both were remapped. Check `/icon-gallery` in dev; `icons.test.ts` pins every row by `displayName`.
```

★★ Keep it to that one bullet. `AGENTS.md` regrew 111% in fifteen days by accepting plausible additions; the mapping table lives in the spec.

- [ ] **Step 7: Verify the doc gates**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"; tail -5 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS=$?"; tail -8 /tmp/claims.log
```

Expected: both `0`. ★ `docs:symbols:check` scans `AGENTS.md` and `docs/AGENTS/*`, so the new bullet's backticked names must all exist — `icons.ts` symbols do. `docs:claims:check` is a **ratchet**: it fails on a NEW `path:LINE` citation, so do not add one. None of the text above contains a line number, deliberately.

- [ ] **Step 8: Commit**

```bash
git commit --only \
  docs/tech-debt-register.md docs/CODEMAPS/dependencies.md \
  docs/work-inventory.md docs/open-followups.md AGENTS.md \
  -m "docs: record the icon migration as shipped

TD-8 resolved, dependencies codemap rewritten, work-inventory backlog row and
decision item dropped, open-followups 145 closed out, one AGENTS.md bullet."
```

---

### Task 11: Release bump — `0.254.0 "Bisson"`

**Files:**
- Modify: `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (5 files)

★★★ The version lives in **eight** places and only the i18n key parity is gated. `package.json` sat six releases stale and `package-lock.json` eleven, both unnoticed.

- [ ] **Step 1: Confirm the codename is still free**

```bash
grep -c '"Bisson"' CHANGELOG.md src/app/version.ts; echo "EXIT=$?"
```

Expected: `0` for both files. If either is non-zero, pick from the spares verified in the spec (Clement · Hughart · Resnick · Gunn · Emezi) and re-run this check.

- [ ] **Step 2: `src/app/version.ts`**

Set `APP_VERSION = "0.254.0"`, `APP_MILESTONE = "Bisson"`, and `APP_BUILD_DATE` to today's date, whose trailing comment must name the milestone:

```ts
export const APP_VERSION = "0.254.0";
export const APP_BUILD_DATE = "<today>"; // 0.254.0: one icon package — heroicons retired app-wide (Bisson)
```

★★ The milestone belongs in that comment because a past release shipped `APP_VERSION "0.248.0"` beside the previous series' `APP_MILESTONE`, so `APP_VERSION_LABEL` rendered a mismatched pair in Settings and the top bar.

Append the new highlight key to `APP_HIGHLIGHT_KEYS`:

```ts
  "versionHighlightIcons",
```

- [ ] **Step 3: `src/app/i18n.ts` (EN)**

Add beside the other `versionHighlight*` entries:

```ts
  versionHighlightIcons: "Every icon in the app now comes from a single icon set. The app previously shipped two, side by side, which meant the same idea could be drawn two different ways depending on which screen you were looking at. Nothing about the interface should look different: the line weight of the old set was kept, and each icon was matched to its closest equivalent by eye rather than by name — two of them turned out to draw something else entirely under the same name, and were corrected.",
```

- [ ] **Step 4: `src/app/i18n.de.ts` (DE) — via Node, never the Edit tool**

★★★ This file is **CRLF** and the Edit tool corrupts its umlauts and curls its double quotes. Patch it with a Node utf8 write anchored on `\r\n`; a `\n` anchor silently no-ops and you will think it worked.

```bash
node -e '
const fs = require("fs");
const f = "src/app/i18n.de.ts";
const s = fs.readFileSync(f, "utf8");
const anchor = "  versionHighlightBlockStructure:";
if (!s.includes(anchor)) throw new Error("anchor not found");
const line =
  "  versionHighlightIcons: \"Alle Symbole der Anwendung stammen jetzt aus einem einzigen Symbolsatz. Bisher waren zwei Sätze parallel im Einsatz, sodass dieselbe Sache je nach Ansicht unterschiedlich dargestellt sein konnte. Am Erscheinungsbild ändert sich nichts: Die Strichstärke des bisherigen Satzes wurde beibehalten, und jedes Symbol wurde nach dem Aussehen und nicht nach dem Namen zugeordnet — bei zwei Symbolen stellte sich heraus, dass sie unter demselben Namen etwas völlig anderes zeigen; sie wurden korrigiert.\",\r\n";
fs.writeFileSync(f, s.replace(anchor, line + anchor), "utf8");
console.log("inserted");
'
```

- [ ] **Step 5: Verify the DE bytes survived**

```bash
node -e '
const s = require("fs").readFileSync("src/app/i18n.de.ts", "utf8");
const m = s.match(/versionHighlightIcons: "[^"]*"/);
console.log("umlauts:", /[äöüßÄÖÜ]/.test(m[0]));
console.log("curly quotes:", /[“”]/.test(m[0]));
console.log("ascii subs:", /(fuer|druecken|ae|oe|ue)\b/.test(m[0]));
'
npx tsc --noEmit; echo "TSC=$?"
npm run test:run > /tmp/i18n.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/i18n.log
```

Expected: `umlauts: true`, `curly quotes: false`, `ascii subs: false`, `TSC=0`, `TEST=0`. ★ `tsc` enforces EN/DE key parity and the `i18n-encoding` test bans ASCII substitutes, so both must pass before moving on.

- [ ] **Step 6: The five ungated places**

```bash
node -e '
const fs = require("fs");
const bump = (f, from, to) => {
  const s = fs.readFileSync(f, "utf8");
  const out = s.split(from).join(to);
  if (out === s) throw new Error("no change in " + f);
  fs.writeFileSync(f, out);
  console.log("bumped", f);
};
bump("package.json", "\"version\": \"0.253.0\"", "\"version\": \"0.254.0\"");
bump("package-lock.json", "\"version\": \"0.253.0\"", "\"version\": \"0.254.0\"");
bump("README.md", "version-v0.253.0_%22Schroeder%22", "version-v0.254.0_%22Bisson%22");
for (const f of fs.readdirSync("docs/CODEMAPS").filter((n) => n.endsWith(".md")))
  bump("docs/CODEMAPS/" + f, "0.253.0 \"Schroeder\"", "0.254.0 \"Bisson\"");
'
grep -c '0\.253\.0' package.json package-lock.json README.md docs/CODEMAPS/*.md
```

Expected: every count `0`. ★ `package-lock.json` carries **two** occurrences (root `version` and `packages[""]`), which the `split`/`join` above replaces together. ★ The README badge URL-encodes the quotes as `%22`; editing it as plain text breaks the badge silently.

- [ ] **Step 7: `CHANGELOG.md`**

Add above the `## [0.253.0]` entry. ★ No `[session link removed]...` URL may appear here.

```markdown
## [0.254.0] - <today> "Bisson"

### Changed
- **One icon set app-wide.** Every icon now comes from `src/app/icons.ts`, backed by `lucide-react`; `@heroicons/react` is removed from the project and an ESLint rule blocks its return. The interface is unchanged by design — the old set's 1.5 stroke weight is pinned in `globals.css`, and each of the 69 icons was matched to its nearest equivalent by glyph rather than by name.
- Two icons carried the **same name in both packages while drawing different things** and were remapped: lucide's `Bolt` is a hardware nut rather than a lightning flash (Activity), and its `ChartBar` is horizontal where the old one was vertical (Workload). `src/app/icons.test.ts` pins every mapping against the component's own `displayName`.

### Added
- A dev-only `/icon-gallery` route and its Playwright specs, so icon choices stay reviewable and the stroke-weight pin is asserted in a real browser.
```

- [ ] **Step 8: Verify the version is consistent everywhere**

```bash
grep -rn "0\.254\.0" package.json src/app/version.ts README.md | head
grep -c "Bisson" CHANGELOG.md src/app/version.ts README.md
grep -c '0\.253\.0' package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts
```

Expected: `0.254.0` present in the first three; `Bisson` non-zero in all three; every `0.253.0` count `0`.

- [ ] **Step 9: Commit**

```bash
git commit --only \
  src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md \
  package.json package-lock.json README.md docs/CODEMAPS/*.md \
  -m "chore: release 0.254.0 \"Bisson\"

Bumps all eight version sites: version.ts (+ milestone in the build-date
comment), CHANGELOG, the new versionHighlightIcons key in EN and DE,
package.json, both package-lock occurrences, the README badge, and the five
CODEMAP headers."
```

---

### Task 12: Full gate run

- [ ] **Step 1: Run every local gate, unpiped exit codes**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/final-unit.log 2>&1; echo "UNIT=$?"; grep -E "Test Files|Tests " /tmp/final-unit.log
npm run test:shuffle > /tmp/final-shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/final-shuffle.log
npm run test:coverage > /tmp/final-cov.log 2>&1; echo "COV=$?"; grep -E "ERROR|threshold" /tmp/final-cov.log | head
npm run size:check; echo "SIZE=$?"
npm run dup:check > /tmp/final-dup.log 2>&1; echo "DUP=$?"; tail -3 /tmp/final-dup.log
npm run docs:symbols:check > /tmp/final-sym.log 2>&1; echo "SYM=$?"
npm run docs:claims:check > /tmp/final-claims.log 2>&1; echo "CLAIMS=$?"
```

Expected: every code `0`.

★★ **Watch `COV` specifically.** `src/app/icons.ts` is a new `.ts` under `src/app`, so it is inside the coverage gate's `include`. Pure re-exports carry no executable statements, so it should not move the floors — but if the global function or line percentage drops below `vitest.config.ts`'s thresholds, add `"src/app/icons.ts"` to `coverage.exclude` with a comment saying it is a re-export manifest with no logic, and re-run. Do not lower a floor.

★★ `test:shuffle` is the only local reproduction of the `unit-tests-shuffled` CI job, and this branch adds a test file — run it.

- [ ] **Step 2: Run the a11y gate over the scanned views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/final-a11y.log 2>&1; echo "A11Y=$?"; grep -E "passed|failed" /tmp/final-a11y.log | tail -3
```

Expected: `A11Y=0`.

★★★ `--workers=1` is mandatory here. CI runs axe serially; locally it defaults to CPU count, and over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and no impact. A real violation names a rule id — read the failure body, never the summary line.

- [ ] **Step 3: Run the prod-CSP smoke**

```bash
npm run build > /tmp/final-build.log 2>&1; echo "BUILD=$?"
npm run e2e:smoke:prod > /tmp/final-smoke.log 2>&1; echo "SMOKE=$?"; tail -5 /tmp/final-smoke.log
```

Expected: both `0`. ★ This is the only local reproduction of the production CSP, and it is worth running here specifically because this slice adds a route and changes `globals.css`. It owns port 3200 and refuses to start if something else holds it.

- [ ] **Step 4: Confirm the production guard on the gallery route**

```bash
grep -rn "NODE_ENV" src/app/icon-gallery/page.tsx
ls src/app/icon-gallery/
```

Expected: the `notFound()` guard is present, and `compare/` no longer exists.

- [ ] **Step 5: Report to the user**

Summarise: gate results with their exit codes, the contact-sheet review outcome from Task 6, whether `nav-icons.tsx` needed the `AppIcon` change (and if it did **not**, that the spec was corrected), and anything added to `coverage.exclude`. **Do not push, open an MR, or merge** — those need an explicit instruction.

---

## Notes for the reviewer of this plan

- **The 78-file list is exhaustive and was measured**, not assembled by hand: `grep -rln "@heroicons/react" src/app`. Six batches × 13 = 78.
- **Task 6 gates Task 8.** The contact sheet only exists while both packages are installed, so a mapping rejected after Task 9 costs a dependency reinstall.
- **Two anti-vacuity checks are mandatory steps, not suggestions** (Task 1 Step 5, Task 4 Step 3). Both mutate, run, and revert in the same block. A guard that cannot fail is the failure mode this repo has paid for repeatedly.
- **The one thing no gate can catch** is a mapping that renders fine and means the wrong thing. Task 6 is the only detector. A green pipeline is not glyph correctness.
- **The spec's §5.4 validation script has no task, deliberately.** It was a spec-time probe that checked four properties of the mapping table, and `src/app/icons.test.ts` (Task 1) supersedes all four *and* strengthens them: it runs in CI on every commit, and it pins each row against the component's own `displayName` rather than against a filename this plan's author derived. Shipping the probe as well would be a second, weaker copy of the same check — the drift shape the spec itself warns about.
- **`APP_BUILD_DATE` and the `CHANGELOG` heading take the date the work actually finishes**, which is why Task 11 runs last and both are written as `<today>` rather than a guess made while planning.
