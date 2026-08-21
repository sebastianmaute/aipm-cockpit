# UI batch slice 2 — settings, primitives, tooltips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Assistant settings a sub-rail with its own Guides and Views sections, replace 30 hand-rolled buttons with shared primitives, and produce an app-wide tooltip inventory with the mechanical half already fixed.

**Architecture:** `settings-view.tsx`'s flat `RAIL` gains an optional `parent` field so three entries nest under `ai`; the guides UI moves out of the 782-line `ai-section.tsx` into its own section file to buy ratchet headroom; button conversions go through `Button` / `IconButton`; the tooltip work splits into a mechanical class that needs no approval and a copy-writing class that does.

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind v4 · vitest + Testing Library · Playwright/axe · GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-07-ui-batch-slice-2-settings-tooltips-design.md`

---

## Read before starting

- `AGENTS.md` — always loaded. The i18n, palette, a11y and six-write-path constraints gate merges.
- `docs/AGENTS/ui-shell.md` — owns the Escape/Tab dismissal protocol. Read before touching any modal or popover (Tasks 9–10 touch several).
- `docs/AGENTS/theming.md` — `--ui-*` tokens and the dark-mode hover trap. Read before Task 7–10.
- `docs/handrolled-ui-inventory.md` — the source for Tasks 8–10's site list.

### Environment traps that have cost real time here

- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail — that is `tail`'s status, and the diagnostic is discarded. Always: `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
- ★★ **Never run vitest with `run_in_background`.** It gets killed mid-run and leaves a surviving child process; the resulting `emitUnexpectedExit` spew reads like a red suite and is not one. Foreground only.
- ★★ `npm run lint` is bare `eslint` with no `--max-warnings`, so it exits 0 on warnings. The real CI gate is `npx eslint --max-warnings=0 src/app`.
- ★★ `git checkout --` and `git restore` are deny-listed in this environment. To revert a file: `git show <sha>:<path> > /tmp/f` then `cp /tmp/f <path>`.
- ★ Only one vitest process at a time. A sibling worktree running the suite is the documented machine-saturation condition behind phantom timeouts.

### Test-run policy (explicit user constraint: run fewer full suites)

| When | What |
|---|---|
| After each multi-file edit | `npx tsc --noEmit` — fast, and it is the gate that catches i18n EN/DE key parity |
| During a task | targeted vitest on the touched files only |
| End of Phase 1 (Task 13) | one full `test:run` + `test:shuffle` + `size:check` + `dup:check` + `docs:symbols:check` + targeted axe |
| End of Phase 2 (Task 17) | the same set, once |

Do **not** run the full suite per task.

---

## Two decisions this plan makes that the spec did not

Both were found by reading `ai-section.tsx:601–782` rather than trusting the spec's line reference. Veto either at review and the affected tasks change.

### DECISION A — the `settings.ai.enabled` gate

`ai-section.tsx:427` opens `{settings.ai.enabled === true && (<>` and that fragment does not close until `:779`. **Both** the guides block and `AiViewScopeDisclosure` are inside it, so today they are invisible whenever the AI master switch is off.

Promoting them to their own rail sections would render them unconditionally — a silent behaviour change.

**This plan keeps the gate.** Each new section renders its content when `settings.ai.enabled === true`, and a `FieldHint` carrying the existing `aiEnableHelp` string when it is off. No new i18n key.

★ This also preserves the spec's §1.6 claim that no new stale-active coercion is needed. The alternative — hiding the child *rail entries* when AI is off — would make a child able to vanish while active, which **would** require coercion and would falsify that section of the spec.

### DECISION B — what actually moves with the guides

The spec says "Operating guides block (from ~line 601)". Reading it, that block contains three controls that have nothing to do with guides:

| Lines | Control | Guides-related? |
|---|---|---|
| 601–604 | heading + `aiGuidesDesc` | yes |
| 607–619 | `aiGroundInGuides` toggle | **yes** — it is what makes guides take effect |
| 622–642 | `settingsAiActionSuggestions` toggle | no |
| 645–665 | `aiInsightRecommendations` toggle | no |
| 672–691 | `CapInput` for the recommendation interval | no |
| 693–774 | guide list, forms, budget banner | yes |

**This plan moves only the guides-related rows.** The three unrelated controls stay in `ai-section.tsx`, re-parented into their own bordered block. They were mis-grouped under the guides heading; the move surfaces that rather than propagating it.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/settings-view.tsx` | modify | Rail data + grouping + section mounting. Gains `parent` support. |
| `src/app/settings-rail.ts` | **create** | Pure `isBranchActive`. Extracted so the branch logic is testable without rendering. |
| `src/app/settings-rail.test.ts` | **create** | Unit tests for the above. |
| `src/app/settings-sections/ai-guides-section.tsx` | **create** | Operating-guides CRUD: draft helpers, `GuideForm`, list, budget banner. |
| `src/app/settings-sections/ai-guides-section.test.tsx` | **create** | Guide CRUD cases moved out of `ai-section.test.tsx`. |
| `src/app/settings-sections/ai-views-section.tsx` | **create** (rename of `ai-view-scope-disclosure.tsx`) | Read-only per-view AI scope, as a plain list. |
| `src/app/settings-sections/ai-views-section.test.tsx` | **create** (rename) | Adapted from `ai-view-scope-disclosure.test.tsx`. |
| `src/app/settings-sections/ai-view-scope-disclosure.tsx` | **delete** | Renamed. |
| `src/app/settings-sections/ai-view-scope-disclosure.test.tsx` | **delete** | Renamed. |
| `src/app/settings-sections/ai-section.tsx` | modify | Shrinks ~290 lines; keeps API key, model, caps, usage, and the three non-guide toggles. |
| `src/app/i18n.ts` · `src/app/i18n.de.ts` | modify | `+aiViewsTitle`, `-aiViewScopeTitle`, `settingsProjectOverrides` retext, Class B strings in Phase 2. |
| `src/app/app-header.tsx` · `top-bar.tsx` · 3 window closes · 12 glyph closes · `roles-editor.tsx` | modify | `IconButton` conversions. |
| `docs/tooltip-inventory.md` | **create** | The audit deliverable. |
| `docs/open-followups.md` | modify | Numbered entry pointing at the inventory. |

---

# PHASE 1

## Task 0: Branch off current main

**Files:** none — git only.

- [ ] **Step 1: Fetch and verify the baseline**

★ Local `main` is stale at `4dd13660`; slice 1 merged as `f6e85d55` on `origin/main`.

```bash
git fetch origin
git log --oneline -1 origin/main
```

Expected: `f6e85d55 Merge branch 'feat/ui-batch-slice-1' into 'main'`

- [ ] **Step 2: Create the branch**

```bash
git checkout -b feat/ui-batch-slice-2 origin/main
git log --oneline -1
```

Expected: the same `f6e85d55` commit.

---

## Task 1: Pure `isBranchActive` helper

**Files:**
- Create: `src/app/settings-rail.ts`
- Test: `src/app/settings-rail.test.ts`

Extracted as a pure module so the branch rule is testable without rendering `SettingsView` (which needs five mocked modules — see `settings-view.test.tsx:9–18`).

- [ ] **Step 1: Write the failing test**

Create `src/app/settings-rail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBranchActive, type RailEntry } from "./settings-rail";

const RAIL: RailEntry<string>[] = [
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "ai", labelKey: "settingsSectionAi" },
  { id: "aiGuides", labelKey: "aiGuidesHeading", parent: "ai" },
  { id: "aiViews", labelKey: "aiViewsTitle", parent: "ai" },
  { id: "scheduledJobs", labelKey: "scheduledJobsTitle", parent: "ai" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
];

describe("isBranchActive", () => {
  it("is true when the parent itself is active", () => {
    expect(isBranchActive("ai", "ai", RAIL)).toBe(true);
  });

  it("is true when any child of the parent is active", () => {
    expect(isBranchActive("aiGuides", "ai", RAIL)).toBe(true);
    expect(isBranchActive("aiViews", "ai", RAIL)).toBe(true);
    expect(isBranchActive("scheduledJobs", "ai", RAIL)).toBe(true);
  });

  it("is false for an unrelated top-level section", () => {
    expect(isBranchActive("integrations", "ai", RAIL)).toBe(false);
    expect(isBranchActive("general", "ai", RAIL)).toBe(false);
  });

  it("is false for an id that is not in the rail at all", () => {
    // `jira` is a real SectionId with no rail entry — it must not open a branch.
    expect(isBranchActive("jira", "ai", RAIL)).toBe(false);
  });

  it("does not open a branch whose parent is a different section", () => {
    const nested: RailEntry<string>[] = [
      ...RAIL,
      { id: "otherChild", labelKey: "x", parent: "integrations" },
    ];
    expect(isBranchActive("otherChild", "ai", nested)).toBe(false);
    expect(isBranchActive("otherChild", "integrations", nested)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-rail.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: non-zero exit, "Failed to resolve import ./settings-rail".

- [ ] **Step 3: Write the implementation**

Create `src/app/settings-rail.ts`:

```ts
// Pure rail-shape helpers for the Settings navigation. i18n-free and
// React-free so the branch rule is testable without rendering SettingsView
// (which needs five mocked modules just to mount).

/** One navigation entry. `parent` marks it as a child of another entry, which
 *  renders indented and only while its parent's branch is active. Generic over
 *  the id union so the settings rail can pass its own `SectionId`. */
export interface RailEntry<Id extends string> {
  id: Id;
  labelKey: string;
  parent?: Id;
}

/** True when `parentId`'s branch should render its children: either the parent
 *  itself is the active section, or the active section is one of its children.
 *  An id absent from the rail (e.g. the legacy `jira` SectionId, which has no
 *  entry) opens nothing. */
export function isBranchActive<Id extends string>(
  active: Id,
  parentId: Id,
  rail: readonly RailEntry<Id>[],
): boolean {
  if (active === parentId) return true;
  return rail.find((r) => r.id === active)?.parent === parentId;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/app/settings-rail.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, 5 tests passed.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-rail.ts src/app/settings-rail.test.ts
git commit -m "feat: add pure isBranchActive helper for the settings rail"
```

---

## Task 2: Add the `aiViewsTitle` string

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

Done as its own task because `i18n.de.ts` needs a special write method and mixing it into a larger edit is how umlauts get corrupted.

- [ ] **Step 1: Add the EN key**

Edit `src/app/i18n.ts`. Find `aiViewScopeTitle` (line ~2033) and add directly beneath it:

```ts
  aiViewsTitle: "Views",
```

- [ ] **Step 2: Add the DE key via a node utf8 write**

★★ Do **not** use the Edit tool on `i18n.de.ts` — it corrupts umlauts and curls double quotes. The file is CRLF, so a `\n`-anchored replace silently no-ops; the anchor must contain `\r\n`.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  aiViewScopeTitle: \"Was Claude über die einzelnen Ansichten weiß\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
s = s.replace(anchor, anchor + "  aiViewsTitle: \"Ansichten\",\r\n");
fs.writeFileSync(p, s, "utf8");
console.log("OK");
'
```

Expected output: `OK`. If it prints `ANCHOR NOT FOUND`, re-read the line and fix the anchor — do not fall back to the Edit tool.

- [ ] **Step 3: Verify key parity and encoding**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: both `EXIT=0`. tsc enforces EN/DE key parity, so a missing side fails here.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add the aiViewsTitle rail label in EN and DE"
```

---

## Task 3: Rail restructure in `settings-view.tsx`

**Files:**
- Modify: `src/app/settings-view.tsx`
- Test: `src/app/settings-view.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("SettingsView", …)` block in `src/app/settings-view.test.tsx`:

```tsx
  it("hides the AI children until the AI branch is active", () => {
    render(<SettingsView {...makeProps()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toBeNull();
  });

  it("reveals the three AI children when AI Assistant is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    expect(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toBeInTheDocument();
  });

  it("keeps the branch open while a child is the active section", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") }));
    // Siblings stay visible, and the child is the one marked current.
    expect(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders each AI child exactly once", () => {
    // The main rail group is defined by EXCLUSION, so a child missing its
    // `!r.parent` filter renders BOTH in the alphabetical main group and under
    // its parent. That is a duplicate, not an absence — an existence assertion
    // cannot catch it, so this counts.
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    for (const key of ["aiGuidesHeading", "aiViewsTitle", "scheduledJobsTitle"] as const) {
      expect(screen.getAllByRole("button", { name: t("en-US", key) })).toHaveLength(1);
    }
  });

  it("marks the AI parent expanded only while its branch is active", () => {
    render(<SettingsView {...makeProps()} />);
    const ai = () => screen.getByRole("button", { name: t("en-US", "settingsSectionAi") });
    expect(ai()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ai());
    expect(ai()).toHaveAttribute("aria-expanded", "true");
  });

  it("honours a deep-link straight to a child section", () => {
    render(
      <SettingsView {...makeProps({ requestSection: { id: "scheduledJobs", nonce: 1 } })} />,
    );
    expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsTitle") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The branch opened around it, so the siblings are reachable.
    expect(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/app/settings-view.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: non-zero exit, the six new tests failing (the children do not exist yet).

- [ ] **Step 3: Extend `SectionId` and `RAIL`**

In `src/app/settings-view.tsx`, replace the `SectionId` union (line 84) with:

```ts
type SectionId =
  | "mode" | "templates" | "appearance" | "localization" | "general" | "notifications"
  | "nextActions" | "ai" | "aiGuides" | "aiViews" | "jira" | "storage" | "integrations"
  | "export" | "informationFlows" | "commTemplates" | "scheduledJobs" | "diagnostics"
  | "dictation" | "projectOverrides";
```

Replace the `RAIL` declaration (lines 89–107) with:

```ts
const RAIL: RailEntry<SectionId>[] = [
  { id: "mode", labelKey: "settingsSectionMode" },
  { id: "templates", labelKey: "settingsSectionTemplates" },
  { id: "appearance", labelKey: "settingsSectionAppearance" },
  { id: "localization", labelKey: "settingsSectionLocalization" },
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "notifications", labelKey: "settingsSectionNotifications" },
  { id: "ai", labelKey: "settingsSectionAi" },
  // Children of `ai` — rendered indented, and only while the AI branch is
  // active. Declaration order, NOT alphabetical: alpha would order these
  // differently in EN and DE for no gain.
  { id: "aiGuides", labelKey: "aiGuidesHeading", parent: "ai" },
  { id: "aiViews", labelKey: "aiViewsTitle", parent: "ai" },
  { id: "scheduledJobs", labelKey: "scheduledJobsTitle", parent: "ai" },
  { id: "storage", labelKey: "settingsSectionStorage" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
  { id: "export", labelKey: "settingsSectionExport" },
  { id: "nextActions", labelKey: "settingsSectionNextActions" },
  { id: "projectOverrides", labelKey: "settingsProjectOverrides" },
  { id: "informationFlows", labelKey: "settingsSectionInformationFlows" },
  { id: "commTemplates", labelKey: "settingsSectionCommTemplates" },
  { id: "diagnostics", labelKey: "diagnosticsTitle" },
  { id: "dictation", labelKey: "dictationEngine" },
];
```

Add the import near the other local imports:

```ts
import { isBranchActive, type RailEntry } from "./settings-rail";
```

★ `RailEntry.labelKey` is typed `string` while the old inline type used `TranslationKey`. Keep the call sites' `t(lang, labelKey as TranslationKey)` narrow, or — preferred — widen the generic at the single call site by declaring `const RAIL: (RailEntry<SectionId> & { labelKey: TranslationKey })[]`. Use the second form; it keeps `TranslationKey` enforcement, which is what stops a typo'd key compiling.

- [ ] **Step 4: Fix the three grouping filters**

`scheduledJobs` leaves `INTEGRATION_IDS` (line 112):

```ts
// Connectivity sections grouped together above Information flows (own divider).
// `scheduledJobs` is NOT here any more — it is a child of `ai` and renders
// inside that branch, not as a peer.
const INTEGRATION_IDS: readonly SectionId[] = ["ai", "integrations"];
```

★★ Add `!r.parent` to `mainEntriesSorted` (line 182). The main group is defined by exclusion, so without this every child renders twice:

```ts
  const mainEntriesSorted = RAIL.filter(
    (r) =>
      // Children never appear in a group filter — the parent's render path
      // owns them. The main group is defined by EXCLUSION, so omitting this
      // renders each child twice: once here, once under its parent.
      !r.parent &&
      r.id !== FLOWS_ID &&
      r.id !== STORAGE_ID &&
      r.id !== DIAGNOSTICS_ID &&
      r.id !== "commTemplates" &&
      !INTEGRATION_IDS.includes(r.id) &&
      !(r.id === "projectOverrides" && props.isPopout) &&
      (expert || !EXPERT_IDS.includes(r.id)),
  ).sort(byLabel);
```

Same guard on `integrationEntries` (line 202):

```ts
  const integrationEntries = RAIL.filter(
    (r) => !r.parent && INTEGRATION_IDS.includes(r.id),
  ).sort(byLabel);
```

- [ ] **Step 5: Render children from `renderRailButton`**

Replace `renderRailButton` (lines 213–230) with:

```tsx
  const renderRailButton = (
    { id, labelKey }: { id: SectionId; labelKey: TranslationKey },
    isChild = false,
  ) => {
    const isActive = active === id;
    const children = RAIL.filter((r) => r.parent === id);
    const branchOpen = children.length > 0 && isBranchActive(active, id, RAIL);
    return (
      <Fragment key={id}>
        <button
          type="button"
          aria-current={isActive ? "page" : undefined}
          // A parent both navigates AND expands. `aria-expanded` describes the
          // second behaviour; `aria-current` stays on whichever entry is
          // genuinely active, parent or child.
          aria-expanded={children.length > 0 ? branchOpen : undefined}
          onClick={() => setActive(id)}
          className={`${
            isActive
              ? "rounded-md bg-ui-dark-blue px-3 py-2 text-left text-sm font-medium text-white"
              : "rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
          } ${isChild ? "pl-6" : ""} ${INTERACTIVE}`}
        >
          {t(lang, labelKey)}
        </button>
        {branchOpen && children.map((c) => renderRailButton(c, true))}
      </Fragment>
    );
  };
```

Add `Fragment` to the React import at the top of the file:

```ts
import { Fragment, useEffect, useRef, useState } from "react";
```

★ The `key` moved from the `<button>` to the `Fragment`. Leaving it on the button while wrapping in a keyless Fragment is a React key warning, and `npx eslint --max-warnings=0` treats warnings as fatal.

★★★ **Adding the second parameter BREAKS both existing call sites and this step used to omit that.** They are `mainEntries.map(renderRailButton)` and `integrationEntries.map(renderRailButton)`. `Array.prototype.map` passes the **index** as its second argument, so the bare function reference is a hard tsc error, not a silent styling bug:

```
error TS2345: Types of parameters 'isChild' and 'index' are incompatible.
    Type 'number' is not assignable to type 'boolean | undefined'.
```

Wrap both: `.map((r) => renderRailButton(r))`, and leave a comment so the next editor does not "simplify" it back. ★★ **No test in this plan can catch it** — nothing asserts `pl-6`. Only a typecheck does, which is why it must not be deferred past this step.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/app/settings-view.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: `EXIT=0`, all tests passing including the six new ones.

- [ ] **Step 7: Prove the duplicate test is not vacuous**

★ Mutate and watch it fail — a claimed killer is not proof.

Temporarily remove `!r.parent &&` from `mainEntriesSorted`, re-run, and confirm **"renders each AI child exactly once"** fails. Then restore it and confirm green again.

```bash
npx vitest run src/app/settings-view.test.tsx -t "exactly once" > /tmp/t3m.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t3m.log
```

Expected while mutated: `EXIT=1`, "expected length 2 to be 1". After restoring: `EXIT=0`.

- [ ] **Step 8: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add src/app/settings-view.tsx src/app/settings-view.test.tsx
git commit -m "feat: nest Guides, Views and Scheduled jobs under AI Assistant in the settings rail"
```

---

## Task 4: Rename "This project" to "Overrides"

**Files:**
- Modify: `src/app/i18n.ts:3327`
- Modify: `src/app/i18n.de.ts:3298`

- [ ] **Step 1: Change the EN string**

In `src/app/i18n.ts`, change line 3327:

```ts
  settingsProjectOverrides: "Overrides",
```

- [ ] **Step 2: Change the DE string via a node utf8 write**

★★ "Überschreibungen" carries an umlaut. The Edit tool corrupts these in this file. `i18n-encoding` bans the ASCII substitution "Ueberschreibungen", so that is a failing gate, not a workaround.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const from = "  settingsProjectOverrides: \"Dieses Projekt\",\r\n";
const to   = "  settingsProjectOverrides: \"Überschreibungen\",\r\n";
if (!s.includes(from)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
fs.writeFileSync(p, s.replace(from, to), "utf8");
console.log("OK");
'
```

Expected: `OK`.

- [ ] **Step 3: Byte-verify the umlaut survived**

```bash
node -e '
const s = require("fs").readFileSync("src/app/i18n.de.ts","utf8");
const m = s.match(/settingsProjectOverrides: "(.*)"/);
console.log(JSON.stringify(m && m[1]));
'
```

Expected exactly: `"Überschreibungen"` — with the `Ü` as one character, not `UÌˆ` or `Ue`.

- [ ] **Step 4: Run the encoding gate and typecheck**

```bash
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Check for tests that read the old label**

★★ **Scope this at `src scripts e2e docs`, not `src/app` tests.** An earlier revision greped only `src/app --include=*.test.tsx`, which structurally cannot see `e2e/*.spec.ts` — the exact miss AGENTS.md warns about for every string rename.

```bash
grep -rn "This project\|Dieses Projekt" src scripts e2e docs; echo "EXIT=$?"
```

If any hit appears, update it to the new string. `EXIT=1` (no matches) means nothing to do.

★ Verified 2026-08-07: no test or spec anywhere reads the old label. But the rename **does** orphan prose in five places, none of which any gate can see:

| Where | Call |
|---|---|
| `i18n.ts` / `i18n.de.ts` `versionHighlightProjectOverrides` + `versionHighlightProjectViewMode` | **leave** — shipped release-note history, rewriting it is a different decision |
| `settings-sections/project-overrides-section.tsx` header comment | fix when that file is next touched |
| `docs/AGENTS/ai-assistant.md` (2 mentions) | fix |
| `settings-view.tsx` prop doc-comment | done in this task |

★ The rail sorts by *translated* label, so both renames move the entry's position in the alphabetical main group. Expected, not a regression — but if a test asserts rail order, it needs updating.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: rename the This project settings section to Overrides"
```

---

## Task 5: Extract `ai-guides-section.tsx` (pure move, no behaviour change)

**Files:**
- Create: `src/app/settings-sections/ai-guides-section.tsx`
- Modify: `src/app/settings-sections/ai-section.tsx`

★ This task changes **no** rendered output. Do it as a pure move so that if the suite goes red, the cause is the move and not a conversion. Task 8 converts the buttons afterwards.

- [ ] **Step 1: Create the new section file**

Create `src/app/settings-sections/ai-guides-section.tsx`:

```tsx
"use client";

// Operating-guides CRUD, extracted from ai-section.tsx. It moved because that
// file sat at 782 lines against the 800-line ratchet (`size:check` counts
// `wc -l` + 1), leaving no room for the button-primitive conversions.
//
// The `aiGroundInGuides` toggle moved WITH the guides — it is what makes them
// take effect. The action-suggestion and insight-recommendation toggles that
// sat under the same heading did NOT: they are unrelated AI settings that were
// mis-grouped, and they stay in ai-section.tsx.

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { Banner } from "../banner";
import { FieldHint } from "../field-hint";
import { Checkbox, Input, Select, Textarea } from "../form-controls";
import { INTERACTIVE } from "../interaction-styles";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import type { OperatingGuide, GuideScope } from "../operating-guide";
import { guidesCharCount, GUIDE_CHAR_BUDGET } from "../operating-guide";
import { FEATURE_MODULES } from "../feature-modules";
import type { AppMode, FeatureModuleId } from "../feature-modules";
import { allNavViews, navLabelKey, type AppView } from "../nav-config";

interface AiGuidesSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  operatingGuides?: UseOperatingGuidesResult;
}
```

Then move, **verbatim and in this order**, from `ai-section.tsx`:

1. `interface GuideDraft` (lines 100–108)
2. `emptyDraft` (109–112)
3. `draftFromGuide` (113–123)
4. `draftToScope` (124–140)
5. `interface GuideFormProps` (lines ~132–140 of the props block) and `GuideForm` (141–270)

Then write the section component, assembling the moved JSX:

```tsx
export function AiGuidesSection({ lang, settings, onChange, operatingGuides }: AiGuidesSectionProps) {
  // Guide form state: null = closed, "add" = new guide, string id = editing existing
  const [formMode, setFormMode] = useState<null | "add" | string>(null);
  const [draft, setDraft] = useState<GuideDraft>(emptyDraft);
  const og = operatingGuides;

  const overBudget =
    og != null &&
    guidesCharCount(og.guides.filter((g) => g.enabled)) > GUIDE_CHAR_BUDGET;

  function openAdd() {
    setDraft(emptyDraft());
    setFormMode("add");
  }

  function openEdit(g: OperatingGuide) {
    setDraft(draftFromGuide(g));
    setFormMode(g.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  async function handleSave() {
    if (!og) return;
    if (formMode === "add") {
      await og.create(draft.name.trim(), draft.content, {
        priority: draft.priority,
        scope: draftToScope(draft),
      });
    } else if (formMode !== null) {
      const existing = og.guides.find((g) => g.id === formMode);
      if (existing) {
        await og.update({
          ...existing,
          name: draft.name.trim(),
          content: draft.content,
          priority: draft.priority,
          scope: draftToScope(draft),
        });
      }
    }
    setFormMode(null);
  }

  // DECISION A: the guides UI lived inside ai-section's
  // `settings.ai.enabled === true &&` fragment, so it was invisible whenever
  // the AI master switch was off. Promoting it to its own rail section would
  // have rendered it unconditionally — a silent behaviour change. The gate
  // moves with it, and the rail entry stays visible either way (a child that
  // could vanish while active would need stale-active coercion).
  if (settings.ai.enabled !== true) {
    return <FieldHint>{t(lang, "aiEnableHelp")}</FieldHint>;
  }

  return (
    <div>
      <FieldHint>{t(lang, "aiGuidesDesc")}</FieldHint>

      {/* Master toggle */}
      <label className="mt-3 flex items-center gap-2">
        <Checkbox
          aria-label={t(lang, "aiGroundInGuides")}
          checked={settings.ai.groundInGuides}
          onChange={() =>
            onChange({
              ...settings,
              ai: { ...settings.ai, groundInGuides: !settings.ai.groundInGuides },
            })
          }
        />
        <span className="text-xs text-foreground">{t(lang, "aiGroundInGuides")}</span>
      </label>

      {og != null && (
        <>
          {overBudget && (
            <Banner severity="error" className="mt-2">
              {t(lang, "aiGuideBudgetWarning")}
            </Banner>
          )}

          {/* Guide list */}
          <ul className="mt-3 flex flex-col gap-2">
            {og.guides.map((g) => (
              <li key={g.id} className="rounded-md border border-line bg-surface p-2">
                {formMode === g.id ? (
                  <GuideForm
                    lang={lang}
                    draft={draft}
                    onChange={setDraft}
                    onSave={() => { void handleSave(); }}
                    onCancel={closeForm}
                    busy={og.busy}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-xs font-medium text-foreground">{g.name}</span>
                    {g.builtIn && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-line">
                        {t(lang, "aiGuideBuiltInBadge")}
                      </span>
                    )}
                    <label className="flex items-center gap-1 text-xs text-foreground">
                      <Checkbox
                        aria-label={`${t(lang, "aiGuideEnabled")} – ${g.name}`}
                        checked={g.enabled}
                        onChange={() => { void og.update({ ...g, enabled: !g.enabled }); }}
                      />
                      {t(lang, "aiGuideEnabled")}
                    </label>
                    <button
                      type="button"
                      aria-label={`${t(lang, "aiGuideEdit")} – ${g.name}`}
                      onClick={() => openEdit(g)}
                      className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-foreground ${INTERACTIVE}`}
                    >
                      {t(lang, "aiGuideEdit")}
                    </button>
                    {!g.builtIn && (
                      <button
                        type="button"
                        aria-label={`${t(lang, "aiGuideDelete")} – ${g.name}`}
                        onClick={() => { void og.remove(g.id); }}
                        className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ui-pink-strong ${INTERACTIVE}`}
                      >
                        {t(lang, "aiGuideDelete")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Add guide */}
          {formMode === "add" ? (
            <GuideForm
              lang={lang}
              draft={draft}
              onChange={setDraft}
              onSave={() => { void handleSave(); }}
              onCancel={closeForm}
              busy={og.busy}
            />
          ) : (
            <button
              type="button"
              onClick={openAdd}
              className={`mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground ${INTERACTIVE}`}
            >
              {t(lang, "aiGuideAdd")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

★ The `<p>{aiGuidesHeading}</p>` and the `border-t border-line pt-4` wrapper are **dropped**. `settings-view.tsx:282` already renders `<h2>{rail label}</h2>` for every section, so keeping the `<p>` would double the heading, and the top border belonged to an in-page divider that no longer exists.

- [ ] **Step 2: Strip the moved code out of `ai-section.tsx`**

Delete from `ai-section.tsx`:

- lines 100–270 (`GuideDraft` through the end of `GuideForm`)
- the `formMode` / `draft` state declarations
- `openAdd`, `openEdit`, `closeForm`, `handleSave`, `overBudget`, `const og = operatingGuides;`
- lines 601–619 (heading, desc, `aiGroundInGuides` toggle)
- lines 693–775 (the `og != null` block and its closing `</div>`)

Remove the now-unused imports: `Banner`, `UseOperatingGuidesResult`, `OperatingGuide`, `GuideScope`, `guidesCharCount`, `GUIDE_CHAR_BUDGET`, `FEATURE_MODULES`, `AppMode`, `FeatureModuleId`, `allNavViews`, `navLabelKey`, `AppView`, and `Textarea` if `GuideForm` was its only consumer.

★★ `npx eslint --max-warnings=0` treats an unused import as **fatal**, with no `argsIgnorePattern` escape. Re-run it after this step, not at the end.

Keep `operatingGuides` off `AiSectionProps` — it is no longer used here.

- [ ] **Step 3: Re-home the three non-guide toggles (DECISION B)**

The `settingsAiActionSuggestions` toggle (622–642), the `aiInsightRecommendations` toggle (645–665) and its `CapInput` (672–691) stay. Wrap them in their own block where the guides block used to start:

```tsx
      {/* Assistant behaviour. These sat under the "Operating guides" heading
          but have nothing to do with guides — the guides extraction surfaced
          the mis-grouping rather than carrying it along. */}
      <div className="mt-4 border-t border-line pt-4">
        {/* ...the three controls, moved verbatim... */}
      </div>
```

- [ ] **Step 4: Verify the file shrank below the ratchet**

```bash
wc -l src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-guides-section.tsx
npm run size:check > /tmp/t5size.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5size.log
```

Expected: `ai-section.tsx` near 490; `ai-guides-section.tsx` near 300; `size:check` `EXIT=0`.

★ `size:check` fails on a **new** file over 800 lines or a baselined file that **grew**. Shrinking is always safe; the new file must come in under 800.

- [ ] **Step 5: Typecheck, lint, and run the touched tests**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx vitest run src/app/settings-sections/ai-section.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```

`ai-section.test.tsx` **will** fail on the guide cases — they now render nothing here. That is expected and Task 6 fixes it. Record which tests failed before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-guides-section.tsx src/app/settings-sections/ai-section.tsx
git commit -m "refactor: extract the operating-guides UI into its own settings section"
```

---

## Task 6: Move the guide tests into `ai-guides-section.test.tsx`

**Files:**
- Create: `src/app/settings-sections/ai-guides-section.test.tsx`
- Modify: `src/app/settings-sections/ai-section.test.tsx`

- [ ] **Step 1: Identify the guide cases**

```bash
grep -n "^\s*it(\|^\s*describe(" src/app/settings-sections/ai-section.test.tsx
```

Every case naming a guide (`aiGuideAdd`, `aiGuideEdit`, `aiGuideDelete`, `aiGuideEnabled`, `aiGroundInGuides`, the budget banner) moves.

- [ ] **Step 2: Create the new test file with the moved cases**

Create `src/app/settings-sections/ai-guides-section.test.tsx` with the same imports and mock setup the source file used, retargeted:

```tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiGuidesSection } from "./ai-guides-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

function makeOperatingGuides(overrides = {}) {
  return {
    guides: [],
    busy: false,
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProps(overrides = {}) {
  return {
    lang: "en-US" as const,
    // DECISION A: the section is gated on the AI master switch, so every test
    // that expects guide UI must enable it.
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } },
    onChange: vi.fn(),
    operatingGuides: makeOperatingGuides(),
    ...overrides,
  };
}

describe("AiGuidesSection", () => {
  it("renders only the enable hint while the AI master switch is off", () => {
    render(<AiGuidesSection {...makeProps({ settings: defaultSettings })} />);
    expect(screen.getByText(t("en-US", "aiEnableHelp"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "aiGuideAdd") })).toBeNull();
  });

  it("opens the add form when Add guide is pressed", () => {
    render(<AiGuidesSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuideAdd") }));
    expect(screen.getByRole("button", { name: t("en-US", "aiGuideSave") })).toBeInTheDocument();
  });

  // ...plus every guide case moved verbatim from ai-section.test.tsx, with
  // <AiSection …> swapped for <AiGuidesSection {...makeProps()} />.
});
```

★ Adapt each moved case's props rather than copying `AiSection`'s prop bag — `AiGuidesSection` takes four props, not seven.

- [ ] **Step 3: Delete the moved cases from `ai-section.test.tsx`**

Remove them outright. Do not leave them skipped — a skipped test is a claim nobody checks.

- [ ] **Step 4: Run both files**

```bash
npx vitest run src/app/settings-sections/ai-section.test.tsx src/app/settings-sections/ai-guides-section.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Confirm no guide coverage was lost**

Compare the case count you removed against the case count you added. They should match, plus the one new gate test.

```bash
grep -c "  it(" src/app/settings-sections/ai-guides-section.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-guides-section.test.tsx src/app/settings-sections/ai-section.test.tsx
git commit -m "test: move the operating-guides cases to the extracted section"
```

---

## Task 7: Rename the views disclosure and flatten it to a list

**Files:**
- Create: `src/app/settings-sections/ai-views-section.tsx`
- Delete: `src/app/settings-sections/ai-view-scope-disclosure.tsx`
- Create: `src/app/settings-sections/ai-views-section.test.tsx`
- Delete: `src/app/settings-sections/ai-view-scope-disclosure.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Write the new test file**

Create `src/app/settings-sections/ai-views-section.test.tsx`:

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiViewsSection } from "./ai-views-section";
import { defaultSettings } from "../settings-types";
import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { t } from "../i18n";
import { navLabelKey, type AppView } from "../nav-config";

const enabled = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } };

describe("AiViewsSection", () => {
  it("shows every view's purpose without any interaction", () => {
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    const views = Object.keys(VIEW_AI_SCOPE) as AppView[];
    for (const view of views) {
      expect(screen.getByText(t("en-US", navLabelKey(view)))).toBeInTheDocument();
      expect(screen.getByText(VIEW_AI_SCOPE[view].purpose)).toBeInTheDocument();
    }
  });

  it("renders no disclosure toggles at all", () => {
    // The whole point of the change: the content is always visible, so there
    // is nothing to expand. A leftover ToggleButton would still pass a
    // "purpose is visible" assertion, so assert the ABSENCE of the control.
    render(<AiViewsSection lang="en-US" settings={enabled} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders only the enable hint while the AI master switch is off", () => {
    render(<AiViewsSection lang="en-US" settings={defaultSettings} />);
    expect(screen.getByText(t("en-US", "aiEnableHelp"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-sections/ai-views-section.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t7.log
```

Expected: non-zero exit, "Failed to resolve import ./ai-views-section".

- [ ] **Step 3: Create the flattened section**

Create `src/app/settings-sections/ai-views-section.tsx`:

```tsx
"use client";

// Read-only disclosure of what the app tells the AI about each view. Renamed
// from ai-view-scope-disclosure.tsx when it became its own rail section: the
// per-view ToggleButton went away (all content is now always visible) and the
// heading now comes from settings-view.tsx's shared <h2>, leaving too little
// here to justify a wrapper file.
//
// The prompt text shown here is ENGLISH even in a German UI, and that is
// correct: the whole system prompt is English (see stableInstructions in
// chat-api.ts). Only the chrome around it is translated.

import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { VIEW_AI_DIGEST } from "../view-ai-digest";
import { FieldHint } from "../field-hint";
import { navLabelKey, type AppView } from "../nav-config";
import { type Settings } from "../settings-types";
import { t, type Lang } from "../i18n";

export function AiViewsSection({ lang, settings }: { lang: Lang; settings: Settings }) {
  const views = Object.keys(VIEW_AI_SCOPE) as AppView[];

  // DECISION A: this lived inside ai-section's `settings.ai.enabled === true`
  // fragment. Promoting it to a rail section must not make it appear while the
  // AI master switch is off.
  if (settings.ai.enabled !== true) {
    return <FieldHint>{t(lang, "aiEnableHelp")}</FieldHint>;
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">{t(lang, "aiViewScopeIntro")}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {views.map((view) => {
          const scope = VIEW_AI_SCOPE[view];
          return (
            <li key={view} className="rounded-md border border-line bg-surface p-2">
              <p className="text-sm font-medium text-foreground">{t(lang, navLabelKey(view))}</p>
              <div className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                <p>{scope.purpose}</p>
                {scope.reading && <p className="text-muted-foreground">{scope.reading}</p>}
                {scope.toolHints && scope.toolHints.length > 0 && (
                  <p className="text-muted-foreground">
                    <code>{scope.toolHints.join(", ")}</code>
                  </p>
                )}
                {VIEW_AI_DIGEST[view] && (
                  <p className="text-muted-foreground">{t(lang, "aiViewScopeDigest")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Delete the old files**

```bash
git rm src/app/settings-sections/ai-view-scope-disclosure.tsx src/app/settings-sections/ai-view-scope-disclosure.test.tsx
```

- [ ] **Step 5: Retire the unreferenced string**

Confirm nothing else reads it:

```bash
grep -rn "aiViewScopeTitle" src scripts e2e docs; echo "EXIT=$?"
```

Expected: only the two i18n definitions. Remove `aiViewScopeTitle` from `i18n.ts` and — via the node write pattern from Task 2 — from `i18n.de.ts`.

★ Do this in the same commit as the change that orphaned it. A retired string left behind is exactly the kind of claim `docs:symbols:check` cannot see.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run src/app/settings-sections/ai-views-section.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/settings-sections src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: render the AI view scope as a plain always-visible list"
```

---

## Task 8: Mount the two new sections from `settings-view.tsx`

**Files:**
- Modify: `src/app/settings-view.tsx`
- Test: `src/app/settings-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `settings-view.test.tsx`:

```tsx
  it("renders the guides section when its rail entry is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuidesHeading") }));
    // The shared <h2> supplies the heading, so it appears as a heading, not
    // just as the rail button label.
    expect(
      screen.getByRole("heading", { name: t("en-US", "aiGuidesHeading") }),
    ).toBeInTheDocument();
  });

  it("renders the views section when its rail entry is selected", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionAi") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiViewsTitle") }));
    expect(screen.getByRole("heading", { name: t("en-US", "aiViewsTitle") })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-view.test.tsx -t "section when its rail entry" > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t8.log
```

Expected: `EXIT=1` — the sections render nothing yet.

- [ ] **Step 3: Import and mount**

Add to the imports in `settings-view.tsx`:

```ts
import { AiGuidesSection } from "./settings-sections/ai-guides-section";
import { AiViewsSection } from "./settings-sections/ai-views-section";
```

Beside the existing `{active === "ai" && <AiSection … />}` mount (line 359), add:

```tsx
        {active === "aiGuides" && (
          <AiGuidesSection
            lang={lang}
            settings={settings}
            onChange={onChange}
            operatingGuides={props.operatingGuides}
          />
        )}
        {active === "aiViews" && <AiViewsSection lang={lang} settings={settings} />}
```

- [ ] **Step 4: Remove the old in-page mounts from `ai-section.tsx`**

Delete `<AiViewScopeDisclosure lang={lang} />` (line 777) and its import (line 19). The guides block is already gone from Task 5.

- [ ] **Step 5: Run the tests, typecheck, lint**

```bash
npx vitest run src/app/settings-view.test.tsx src/app/settings-sections > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-view.tsx src/app/settings-view.test.tsx src/app/settings-sections/ai-section.tsx
git commit -m "feat: mount the AI guides and views sections from the settings rail"
```

---

## Task 9: Convert the seven AI-section buttons to the Button primitive

**Files:**
- Modify: `src/app/settings-sections/ai-guides-section.tsx` (buttons 1, 2, 5, 6, 7)
- Modify: `src/app/settings-sections/ai-section.tsx` (buttons 3, 4)
- Test: `src/app/settings-sections/ai-guides-section.test.tsx`

★ Done **after** the move (Tasks 5–8), not before — converting first means resolving the same diff twice.

The seven, with the reason each was reported as having no mouseover:

| # | Control | Current | Hover today | → |
|---|---|---|---|---|
| 1 | `aiGuideSave` | `border-line bg-ui-green` | none | `primary` |
| 2 | `aiGuideCancel` | `border-line bg-surface` | `hover:bg-surface` — **no-op** | `secondary` |
| 3 | `secretPassphraseSave` | `border-line bg-ui-green` | none | `primary` |
| 4 | `secretPassphraseRemove` | pink text | `hover:bg-surface-muted` ✓ | `destructive` |
| 5 | `aiGuideEdit` | `border-line bg-surface` | none | `secondary` |
| 6 | `aiGuideDelete` | `border-line bg-surface`, pink text | none | `destructive` |
| 7 | `aiGuideAdd` | `border-line bg-surface` | none | `secondary` |

★ **Buttons 1 and 3 change colour**, green → dark blue. That is deliberate and user-approved: `edit-modal-chrome.tsx:267` — the canonical modal footer — renders Save as `<Button type="submit">` at default `primary`, so green-save is the outlier here. jsdom cannot see it; it goes on the eye-verify list.

- [ ] **Step 1: Write the failing test**

Append to `ai-guides-section.test.tsx`:

```tsx
  it("gives the guide row actions a real hover affordance", () => {
    // Five of these seven buttons shipped with NO hover class at all and one
    // with `hover:bg-surface` (its own background — a no-op). The primitive
    // supplies `hover:bg-surface-muted`.
    const guides = [
      { id: "g1", name: "Guide one", content: "x", priority: 10, scope: {}, enabled: true, builtIn: false },
    ];
    render(<AiGuidesSection {...makeProps({ operatingGuides: makeOperatingGuides({ guides }) })} />);
    const edit = screen.getByRole("button", { name: `${t("en-US", "aiGuideEdit")} – Guide one` });
    // Word-bounded: a bare toContain("bg-surface") passes against every Button
    // variant, since they all carry `hover:bg-surface-muted`.
    expect(edit.className).toMatch(/(^|\s)hover:bg-surface-muted(\s|$)/);
    expect(edit.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
  });

  it("styles the destructive guide action as destructive", () => {
    const guides = [
      { id: "g1", name: "Guide one", content: "x", priority: 10, scope: {}, enabled: true, builtIn: false },
    ];
    render(<AiGuidesSection {...makeProps({ operatingGuides: makeOperatingGuides({ guides }) })} />);
    const del = screen.getByRole("button", { name: `${t("en-US", "aiGuideDelete")} – Guide one` });
    expect(del.className).toMatch(/ui-pink/);
  });
```

★★ `cursor-pointer` is the discriminator that proves this is `Button` and not `ToggleButton` — `border-line` + `bg-surface` do **not** identify `Button`, because `ToggleButton`'s unpressed state carries both. `src/test/button-variant.ts` holds the shared helper if a richer assertion is wanted.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-sections/ai-guides-section.test.tsx -t "hover affordance" > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t9.log
```

Expected: `EXIT=1` — no `hover:bg-surface-muted` on the hand-rolled button.

- [ ] **Step 3: Convert buttons 1, 2, 5, 6, 7 in `ai-guides-section.tsx`**

Add the import:

```ts
import { Button } from "../button";
```

`GuideForm`'s footer becomes:

```tsx
      <div className="mt-1 flex gap-2">
        <Button size="xs" disabled={busy || !draft.name.trim()} onClick={onSave}>
          {t(lang, "aiGuideSave")}
        </Button>
        <Button size="xs" variant="secondary" onClick={onCancel}>
          {t(lang, "aiGuideCancel")}
        </Button>
      </div>
```

The row actions become:

```tsx
                    <Button
                      size="xs"
                      variant="secondary"
                      aria-label={`${t(lang, "aiGuideEdit")} – ${g.name}`}
                      onClick={() => openEdit(g)}
                    >
                      {t(lang, "aiGuideEdit")}
                    </Button>
                    {!g.builtIn && (
                      <Button
                        size="xs"
                        variant="destructive"
                        aria-label={`${t(lang, "aiGuideDelete")} – ${g.name}`}
                        onClick={() => { void og.remove(g.id); }}
                      >
                        {t(lang, "aiGuideDelete")}
                      </Button>
                    )}
```

And the add button:

```tsx
            <Button size="xs" variant="secondary" className="mt-3" onClick={openAdd}>
              {t(lang, "aiGuideAdd")}
            </Button>
```

★ The row-unique `aria-label`s (`… – ${g.name}`) must survive every conversion. N identical "Edit" names is a WCAG 2.4.6 failure that the axe gate passes whenever the seed renders one row.

★ Drop `INTERACTIVE` from these call sites — `Button` composes it internally, and a duplicate class is dead weight. Remove the import if nothing else in the file uses it.

- [ ] **Step 4: Convert buttons 3 and 4 in `ai-section.tsx`**

```tsx
            <Button
              className="self-start whitespace-nowrap"
              disabled={!settings.ai.apiKey.trim() || !keyPassphrase || keyPassphrase !== keyConfirm}
              onClick={handleLockConfirm}
            >
              {t(lang, "secretPassphraseSave")}
            </Button>
```

```tsx
          <Button
            size="xs"
            variant="destructive"
            className="mt-2"
            onClick={handleRemoveSecret}
            title={t(lang, "secretPassphraseRemoveHint")}
          >
            {t(lang, "secretPassphraseRemove")}
          </Button>
```

★ Button 3 was `px-3 py-2 text-xs`; the primitive's `sm` is `px-3 py-1.5 text-sm`. Use the default `sm` — matching the canonical footer is the point of the conversion. Eye-verify.

- [ ] **Step 5: Run the tests, typecheck, lint**

```bash
npx vitest run src/app/settings-sections > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all `EXIT=0`.

- [ ] **Step 6: Confirm no hand-rolled button survives in either file**

```bash
grep -n "<button" src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-guides-section.tsx; echo "EXIT=$?"
```

Expected: `EXIT=1` (no matches).

- [ ] **Step 7: Commit**

```bash
git add src/app/settings-sections
git commit -m "fix: give the AI settings buttons a hover affordance via the Button primitive"
```

---

## Task 10: IconButton — the header clusters

**Files:**
- Modify: `src/app/app-header.tsx` (3 sites)
- Modify: `src/app/top-bar.tsx` (3 sites)

★★ The same three-icon cluster exists in **both** files. `top-bar.tsx` is the modern shell's copy and modern is the default layout, so `app-header.tsx` is the easy miss — a change in only one is invisible in whichever layout you forgot.

★ The hand-rolled focus ring (`focus:outline-none focus:ring-2 focus:ring-ui-green`) is **byte-identical** to `FOCUS_RING`, which `IconButton` composes via `INTERACTIVE`. So the focus ring does **not** change. What changes: the hover glyph colour goes from `hover:text-ui-dark-blue dark:hover:text-ui-light-grey` to `IconButton`'s `ghost` `hover:text-foreground`, and the buttons gain `PRESS` + `TRANSITION`. That is a deliberate convergence on the primitive; it goes on the eye-verify list.

- [ ] **Step 1: Write the failing test**

Create or extend `src/app/top-bar.test.tsx`:

```tsx
  it("renders the header icon actions through the IconButton primitive", () => {
    render(<TopBar {...makeProps()} />);
    const alerts = screen.getByRole("button", { name: t("en-US", "showDueAlerts") });
    // IconButton's BASE class. A hand-rolled p-2 button has none of these.
    expect(alerts.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(alerts.className).toMatch(/(^|\s)active:translate-y-px(\s|$)/);
    // The accessible name and the hover title both survive the conversion.
    expect(alerts).toHaveAttribute("title", t("en-US", "showDueAlerts"));
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/top-bar.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t10.log
```

Expected: `EXIT=1`.

- [ ] **Step 3: Convert `top-bar.tsx`**

★★★ **The two files do NOT hold the same three controls** — an earlier revision of this task said they did, and Steps 3 and 4 below described two different clusters as if they were one. Measured 2026-08-07:

| File | Sites |
|---|---|
| `app-header.tsx` | `openAiAssistant` · `addTaskButton` · `showDueAlerts` |
| `top-bar.tsx` | `sidebarMenuButton` · `openAiAssistant` · `showDueAlerts` |

`top-bar.tsx` has **no** `addTaskButton`: the modern shell takes its primary action as a `primaryAction?: React.ReactNode` prop and renders it verbatim, so the New-task button is built elsewhere and is out of scope here. Anyone converting `top-bar.tsx` by grepping for `addTaskButton` finds nothing and could conclude the file was already done.

★★★ **There is no `toggleNav` i18n key** — this snippet named one and would have failed tsc. The real key is `sidebarMenuButton` (`src/app/i18n.ts`, "Open navigation menu").

Add `import { IconButton } from "./icon-button";` and replace each of the three buttons. The nav toggle becomes:

```tsx
          <IconButton
            size="md"
            label={t(lang, "sidebarMenuButton")}
            title={t(lang, "sidebarMenuButton")}
            onClick={onToggleNav}
          >
            <Bars3Icon aria-hidden="true" className="h-5 w-5" />
          </IconButton>
```

★ `IconButton` takes `label` (required — it becomes `aria-label`) and passes `title` through as a rest prop, so both survive. Use `size="md"` — that is `p-1.5` against the hand-rolled `p-2`, the closest match.

★ The alerts button carries a `relative` positioned `CountBadge` child. Pass `className="relative"` so the badge still positions against it.

- [ ] **Step 4: Convert `app-header.tsx`**

Its three are `openAiAssistant`, `addTaskButton`, `showDueAlerts` — two shared with `top-bar.tsx`, one its own (see the table in Step 3). Same `size="md"`, same `label` + `title`, same `relative` on the alerts button.

★★ The `relative` / `CountBadge` warning applies to the alerts button in **both** files, not just one.

★★ **The focus ring is a VACUOUS discriminator here** — verified 2026-08-07: all six hand-rolled buttons carried exactly `focus:outline-none focus:ring-2 focus:ring-ui-green`, which is byte-identical to `FOCUS_RING`. Asserting on it would pass before and after the conversion. Assert word-bounded `cursor-pointer` and `active:translate-y-px` instead. Also unchanged by the conversion: `rounded-md`, `text-muted-foreground`, `hover:bg-surface-muted`.

- [ ] **Step 5: Run the tests and lint**

```bash
npx vitest run src/app/top-bar.test.tsx src/app/app-header.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/top-bar.tsx src/app/app-header.tsx src/app/top-bar.test.tsx
git commit -m "refactor: convert the header icon clusters to the IconButton primitive"
```

---

## Task 11: IconButton — the three floating-window closes

**Files:**
- Modify: `src/app/help-menu.tsx` · `src/app/notes-window.tsx` · `src/app/version-info.tsx`

All three are the same `rounded p-1` + `XMarkIcon` close, already carrying an `aria-label`.

- [ ] **Step 1: Locate the current line for each**

★ Cite the symbol, not the line — the inventory's numbers predate this branch.

```bash
grep -n "XMarkIcon" src/app/help-menu.tsx src/app/notes-window.tsx src/app/version-info.tsx
```

- [ ] **Step 2: Convert each**

```tsx
<IconButton label={t(lang, "close")} onClick={onClose}>
  <XMarkIcon aria-hidden="true" className="h-4 w-4" />
</IconButton>
```

Keep whatever key each file already used for its accessible name — do not standardise the label text in this task, only the element. (They differ: `help-menu` and `notes-window` use `close`, `version-info` uses `alertModalClose`.)

★★★ **Dropping the className orphans an import, and that is a FATAL lint error.** All three files import `INTERACTIVE` from `./interaction-styles` for this button **and for nothing else**. `--max-warnings=0` has no ignore-pattern escape. Replace the `INTERACTIVE` import with the `IconButton` import in each file — and for any other file in this family, grep that file for the import's other uses first, since removing one that is still used fails just as hard the other way.

★★ **This conversion changes the rest-state glyph colour in light mode** and the plan used to be silent on it. Old: `rounded p-1 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:text-muted-foreground dark:hover:text-ui-light-grey`. New (`ghost`/`sm`): `rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground`. So light rest goes `text-foreground` → `text-muted-foreground` (visibly lighter), dark rest is unchanged, hover goes `ui-dark-blue`/`ui-light-grey` → `foreground`, radius `rounded` → `rounded-md`, padding unchanged. **Eye-verify item; put it in the commit message.**

★★ **`active:translate-y-px` and `focus:ring-ui-green` are VACUOUS discriminators in these three files** — the hand-rolled buttons already composed `INTERACTIVE`, so both match before and after. That is the opposite of the header cluster in Task 10, where `active:translate-y-px` *was* valid. Never copy an assertion pair between files without re-checking it against that file's real pre-conversion className. The discriminators that work here are word-bounded `cursor-pointer` and `rounded-md` (the old markup used bare `rounded`).

★★★ **Never `sed -i` a `src/app/*.tsx` in this tree.** These files are CRLF in the working copy (`core.autocrlf=true`, LF in the blob); `sed -i` rewrites the whole file to LF, and `git diff` **cannot show you** — autocrlf normalizes on diff, so the diff still displays only your intended hunks. The only signal is git's "LF will be replaced by CRLF" warning. Use Edit or a node utf8 write.

★★ `notes-window.tsx` and `help-menu.tsx` are draggable windows sharing `use-draggable-window.ts`. Read `docs/AGENTS/ui-shell.md`'s dismissal section before touching them: the Escape/Tab protocol is owned there and a close button is part of it.

- [ ] **Step 3: Run the touched tests**

```bash
npx vitest run src/app/help-menu.test.tsx src/app/notes-window.test.tsx > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11.log
```

Expected: `EXIT=0`. If a test asserts a class string on the old button, update it to the primitive's.

★★ **`version-info.tsx` is unpinned, and the gap is bigger than "no test file."** Verified 2026-08-07: `src/app/version-info.test.tsx` does not exist **and** `grep -rln "VersionInfoModal" src/app e2e` returns only `modern-shell.tsx`, `settings-view.tsx` and the file itself — **no test anywhere renders the modal**, so nothing reaches this button even indirectly. Say so in the commit message rather than letting a green run imply coverage. Do not add a whole test file for it in this task; it is out of scope, and a one-assertion file written to satisfy a checklist is worse than an acknowledged gap.

★ The component is `VersionInfoModal`, not `VersionInfo`.

★★ **`modal-header.tsx` holds two more hand-rolled buttons of exactly this family** (`:77` and `:88`, the close using `alertModalClose` and carrying no `INTERACTIVE`) and is in **neither** Task 11's nor Task 12's list. Found 2026-08-07 by an agent working Task 11, i.e. the inventory missed it. Out of scope here — record it in Task 13's inventory rather than silently widening this task.

- [ ] **Step 4: Commit**

```bash
git add src/app/help-menu.tsx src/app/notes-window.tsx src/app/version-info.tsx
git commit -m "refactor: convert the floating-window close buttons to IconButton"
```

---

## Task 12: IconButton — the twelve glyph closes plus `roles-editor`

**Files:** `actions-panel.tsx` · `change-edit-modal.tsx` · `dashboard-tip-card.tsx` · `entity-link-picker.tsx` · `inline-ai-edit-popover.tsx` · `knowledge-links-field.tsx` · `raci-panel.tsx` · `raci-chip-picker.tsx` · `resource-edit-modal.tsx` · `resource-workload.tsx` · `timelog-people-table.tsx` · `saved-views-menu.tsx` · `roles-editor.tsx`

Element conversion and glyph→`XMarkIcon` are one edit, not two. All twelve already carry an `aria-label`, so the glyph is decorative and safe to drop.

★ `inline-ai-edit-popover.tsx` is also a slice-3 target. User-approved to take now; note the touch in the slice-3 plan so the rebase is expected rather than discovered.

★ `roles-editor.tsx` (2 sites) is an **addition beyond the 21** approved: those buttons are already `IconButton` but still pass a literal `×` child, so they are glyph-only work in the same family. Vetoable.

- [ ] **Step 1: Locate every site by symbol**

```bash
grep -rn 'aria-label' src/app/actions-panel.tsx src/app/change-edit-modal.tsx src/app/dashboard-tip-card.tsx src/app/entity-link-picker.tsx src/app/inline-ai-edit-popover.tsx src/app/knowledge-links-field.tsx src/app/raci-panel.tsx src/app/raci-chip-picker.tsx src/app/resource-edit-modal.tsx src/app/resource-workload.tsx src/app/timelog-people-table.tsx src/app/saved-views-menu.tsx | grep -iE "close|dismiss|remove|clear"
```

- [ ] **Step 2: Check no test reads the glyph**

★★ A glyph is only safe to replace if no test reads it. This is the check, and it is not optional:

```bash
grep -rn '"×"\|"✕"\|&times;' src/app --include="*.test.tsx"; echo "EXIT=$?"
```

`EXIT=1` means clear. Any hit must be updated in the same commit as its source change.

- [ ] **Step 3: Convert, choosing the variant per site**

The default conversion:

```tsx
<IconButton label={t(lang, "<existing key>")} onClick={handler}>
  <XMarkIcon aria-hidden="true" className="h-4 w-4" />
</IconButton>
```

★ **`dashboard-tip-card.tsx` is not the default.** Its close is a bordered `px-2 py-0.5` pill sitting beside a text "Next" button, not a bare glyph. Use `variant="bordered"` there so the pair still reads as a pair:

```tsx
<IconButton
  variant="bordered"
  label={t(lang, "dashboardTipDismiss")}
  title={t(lang, "dashboardTipDismiss")}
  onClick={dismiss}
>
  <XMarkIcon aria-hidden="true" className="h-4 w-4" />
</IconButton>
```

★ Any site whose close is a **remove** rather than a dismiss (`raci-chip-picker`, `knowledge-links-field`) takes `variant="danger"` — muted at rest, pink on hover.

★★ A control inside a `<tr>` needs its `onClick` to `stopPropagation` if the row itself is clickable. Check before converting `timelog-people-table.tsx` and `resource-workload.tsx`; the wrapper swap does not carry that over by itself.

- [ ] **Step 4: Fix the two `roles-editor.tsx` glyphs**

Already `IconButton`; just replace the `×` child with `<XMarkIcon aria-hidden="true" className="h-4 w-4" />` and add the heroicon import.

- [ ] **Step 5: Run every touched test file**

Ten of the thirteen have a test file. Verified 2026-08-07 with:

```bash
for f in actions-panel change-edit-modal dashboard-tip-card entity-link-picker \
         inline-ai-edit-popover knowledge-links-field raci-panel raci-chip-picker \
         resource-edit-modal resource-workload timelog-people-table saved-views-menu roles-editor; do
  [ -f "src/app/$f.test.tsx" ] && echo "HAS  $f" || echo "NONE $f"
done
```

```bash
npx vitest run src/app/actions-panel.test.tsx src/app/change-edit-modal.test.tsx \
  src/app/dashboard-tip-card.test.tsx src/app/entity-link-picker.test.tsx \
  src/app/inline-ai-edit-popover.test.tsx src/app/knowledge-links-field.test.tsx \
  src/app/raci-panel.test.tsx src/app/raci-chip-picker.test.tsx \
  src/app/resource-edit-modal.test.tsx src/app/resource-workload.test.tsx \
  src/app/roles-editor.test.tsx > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12.log
```

Expected: `EXIT=0`.

★ **`saved-views-menu.tsx` and `timelog-people-table.tsx` have no test file.** Those two conversions are unpinned — state that in the commit message. Combined with `version-info.tsx` from Task 11, **three of the 23 conversions ship without a test**. That is an accepted gap, not an oversight; do not let a green suite imply otherwise.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 7: Commit**

```bash
git add -A src/app
git commit -m "refactor: convert the glyph close buttons to IconButton with XMarkIcon"
```

---

## Task 13: The tooltip audit document

**Files:**
- Create: `docs/tooltip-inventory.md`
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Measure the baseline, with commands that go in the doc**

```bash
grep -rho 'title=' src/app --include=*.tsx --exclude="*.test.tsx" | wc -l
grep -rho "<InfoTooltip" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l
grep -rl "aria-label" src/app --include=*.tsx | grep -v "\.test\.tsx" | wc -l
```

★ Every count in the doc carries the command that produced it. An unattached count is the single most-rotted kind of claim in this repo's docs.

- [ ] **Step 2: Find the Class A candidates**

Icon-only controls with an `aria-label` and no `title`. Start from the icon-bearing buttons:

```bash
node -e '
const fs = require("fs"), path = require("path");
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}
for (const f of walk("src/app")) {
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/aria-label=|label=\{/.test(l)) {
      const window = lines.slice(Math.max(0, i - 6), i + 8).join("\n");
      if (!/title=/.test(window) && /Icon\b|IconButton/.test(window)) {
        console.log(`${f}:${i + 1}\t${l.trim()}`);
      }
    }
  });
}
' > /tmp/classA-candidates.txt
wc -l /tmp/classA-candidates.txt
```

★ This is a **candidate generator**, not the answer. Every row is read by hand before it lands in the doc — the window heuristic will produce both false positives and misses.

- [ ] **Step 3: Classify every candidate by hand**

★★ **The judgement that matters:** a row is Class A only if the existing `aria-label` genuinely names the *consequence*. Where the label is a bare noun ("Notifications", "Filters"), copying it into a `title` produces the appearance of coverage and delivers nothing — that row is **Class B**. Getting this wrong is how the deliverable becomes a checkbox.

★ A control missing an accessible **name** is neither class. `title` is hover-only — no keyboard focus, unreachable on touch — so it is never the fix for a missing name. File those separately as `aria-label` defects.

- [ ] **Step 4: Write `docs/tooltip-inventory.md`**

Structure it after `docs/handrolled-ui-inventory.md`:

```markdown
# Tooltip inventory

**Measured:** 2026-08-07 against `<sha>`.

## Baseline

| Metric | Count | Reproduce |
|---|---|---|
| `title=` attributes | NNN | `grep -rho 'title=' src/app --include=*.tsx --exclude="*.test.tsx" \| wc -l` |
| `<InfoTooltip>` mounts | NNN | `grep -rho "<InfoTooltip" src/app --include=*.tsx --exclude="*.test.tsx" \| wc -l` |

## Classes

| Class | Meaning | Approval |
|---|---|---|
| **A** | Icon-only control with an `aria-label` that names the consequence, and no `title`. Fix: `title={<existing key>}`. No new strings. | none — mechanical |
| **B** | Visible label does not name the consequence. Needs new EN+DE text via `InfoTooltip`. | required |
| **keep** | Neither applies. | — |
| **name defect** | No accessible name at all. `title` is not the fix. | filed separately |

## Rows

| Control | File | Surface | Class | Existing name | Proposed EN | Reason |
|---|---|---|---|---|---|---|
| … | … | … | … | … | … | … |
```

★ **Keep** rows carry a reason too. That is what stops the next contributor rediscovering them, and it is the part slice 1's inventory got right.

- [ ] **Step 5: Add the open-followups entry**

Append a new numbered entry to `docs/open-followups.md` pointing at the inventory, so the un-actioned remainder is a ratchet rather than a rediscovery.

★★ Numbering collides across parallel branches — whoever merges second renumbers; git flags the conflict.

- [ ] **Step 6: Verify the docs gate**

```bash
npm run docs:symbols:check > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
```

Expected: `EXIT=0`.

★★ That gate proves a backticked **name** exists somewhere in the repo. It proves nothing about whether a **claim** is true, and it skips every `SCREAMING_CASE` name outright. A green run is not a fact-check of this document.

- [ ] **Step 7: Commit**

```bash
git add docs/tooltip-inventory.md docs/open-followups.md
git commit -m "docs: add the app-wide tooltip inventory"
```

---

## Task 14: Apply the Class A fixes

**Files:** every file carrying a Class A row from Task 13.

- [ ] **Step 1: Apply the mechanical change**

For each Class A row:

```tsx
// before
<IconButton label={t(lang, "someKey")} onClick={…}>

// after
<IconButton label={t(lang, "someKey")} title={t(lang, "someKey")} onClick={…}>
```

★ Zero new i18n strings. If a row seems to need new text, it was misclassified — move it to Class B.

- [ ] **Step 2: Write a guard test for a representative sample**

Pick three converted controls on three different surfaces and pin them:

```tsx
  it("gives the icon-only action a hover title matching its accessible name", () => {
    render(<SomePanel {...makeProps()} />);
    const btn = screen.getByRole("button", { name: t("en-US", "someKey") });
    expect(btn).toHaveAttribute("title", t("en-US", "someKey"));
  });
```

★ Three is a sample, not coverage. Say so in the commit message rather than implying the batch is pinned.

- [ ] **Step 3: Typecheck, lint, run the touched tests**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 4: Commit**

```bash
git add -A src/app
git commit -m "fix: add hover titles to the icon-only controls that already had accessible names"
```

---

## Task 15: Phase 1 gates

**Files:** none — verification only.

★ This is the **first** full-suite run of the slice. Everything before this was targeted.

- [ ] **Step 1: Confirm no competing vitest process**

```bash
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | Format-List"
```

★ A sibling worktree running the suite is the documented machine-saturation condition behind phantom timeouts. Kill or wait before running.

- [ ] **Step 2: Full unit suite**

```bash
npm run test:run > /tmp/p1-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/p1-suite.log
```

Expected: `EXIT=0`. Baseline from slice 1 was 9631 tests / 823 files; this slice adds files, so expect more.

- [ ] **Step 3: Shuffled suite**

```bash
npm run test:shuffle > /tmp/p1-shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/p1-shuffle.log
```

★ This is the **only** local reproduction of CI's blocking `unit-tests-shuffled` job, and it shuffles within files as well as across them.

- [ ] **Step 4: The ratchets**

```bash
npm run size:check > /tmp/p1-size.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/p1-size.log
npm run dup:check > /tmp/p1-dup.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/p1-dup.log
npm run docs:symbols:check > /tmp/p1-docs.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/p1-docs.log
```

★ `dup:check` is the one most likely to bite: Task 12 created thirteen near-identical `IconButton` + `XMarkIcon` blocks. If it fails, that is a real signal — consider a tiny shared `CloseButton` wrapper rather than raising the threshold. **Never widen a gate to make a pipeline pass.**

- [ ] **Step 5: Coverage**

```bash
npm run test:coverage > /tmp/p1-cov.log 2>&1; echo "EXIT=$?"; grep -E "All files|Lines|Branch" /tmp/p1-cov.log
```

★ `settings-rail.ts` is a new coverage-gated `.ts` file. `test:run` does **not** enforce the floors, so a new engine can be green locally and fail the CI unit job.

- [ ] **Step 6: Targeted axe on a fresh isolated server**

```bash
PORT=3100 npm run dev > /tmp/p1-dev.log 2>&1 &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" > /tmp/p1-axe.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/p1-axe.log
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" > /tmp/p1-axe2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/p1-axe2.log
PORT=3100 npm run stop
```

★★ Never the reused long-running dev server — Playwright's `reuseExistingServer` attaches to a stale `:3000` whose Tailwind has not regenerated, producing phantom transparent-fill failures a fresh port passes.

★ The Dashboard run covers the converted top-bar cluster, which renders in every view.

- [ ] **Step 7: Record the results**

Write the actual numbers into the phase-1 summary. If any gate is red, fix it before the approval gate — do not carry a red gate across the phase boundary.

---

# ► APPROVAL GATE

Present the **Class B rows only** from `docs/tooltip-inventory.md` as a table: *control · file · surface · existing visible label · proposed EN text*. Wait for row-level approval. Unapproved rows stay in the inventory tagged as such.

Do not start Phase 2 before this returns.

---

# PHASE 2

## Task 16: Implement the approved Class B tooltips

**Files:** `src/app/i18n.ts` · `src/app/i18n.de.ts` · the approved rows' component files.

- [ ] **Step 1: Add every approved EN string**

One key per approved row, added to `i18n.ts` near its topic neighbours.

- [ ] **Step 2: Add every DE string in one node write**

★★ One batched write, not N Edit-tool calls. The file is CRLF and the Edit tool corrupts umlauts.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const additions = [
  // ["anchorKeyLine", "  newKey: \"Deutscher Text\",\r\n"],
];
for (const [anchor, add] of additions) {
  if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND: " + anchor); process.exit(1); }
  s = s.replace(anchor, anchor + add);
}
fs.writeFileSync(p, s, "utf8");
console.log("OK " + additions.length);
'
```

- [ ] **Step 3: Byte-verify every umlaut**

```bash
node -e '
const s = require("fs").readFileSync("src/app/i18n.de.ts","utf8");
for (const k of [/* the new key names */]) {
  const m = s.match(new RegExp(k + ": \"(.*)\""));
  console.log(k, JSON.stringify(m && m[1]));
}
'
```

Expected: every umlaut one character. No `Ue`, `ae`, `oe`, and no combining sequences.

- [ ] **Step 4: Mount the tooltips**

For a control that already has a visible label, put an `InfoTooltip` beside it:

```tsx
<span className="inline-flex items-center gap-1">
  {t(lang, "someLabel")}
  <InfoTooltip text={t(lang, "someLabelHint")} />
</span>
```

★ Not a `title` on the labelled control — `title` is hover-only. `InfoTooltip` is the keyboard-reachable form and is what the rest of the app uses (147 existing mounts).

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t16.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t16.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all `EXIT=0`. tsc enforces EN/DE key parity, so a one-sided addition fails here.

- [ ] **Step 6: Update the inventory**

Retag the implemented rows in `docs/tooltip-inventory.md` as *done*, and leave the unapproved ones tagged as such with the date.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app docs/tooltip-inventory.md
git commit -m "feat: add explanatory tooltips to the approved controls"
```

---

## Task 17: Release

**Files:** `src/app/version.ts` · `CHANGELOG.md` · `package.json` · `package-lock.json` · `README.md` · `docs/CODEMAPS/*.md`

- [ ] **Step 1: Fetch the current version and pick the next**

★ Releases have been renumbered mid-flight before. Fetch before bumping.

```bash
git fetch origin
grep -n "APP_VERSION\|APP_BUILD_DATE\|milestone" src/app/version.ts
```

- [ ] **Step 2: Bump `version.ts`**

APP_VERSION, APP_BUILD_DATE, and the milestone codename.

- [ ] **Step 3: Add the CHANGELOG entry**

Cover both phases: the sub-rail, the two extracted sections, the views list, the Overrides rename, the button conversions, and the tooltip work.

- [ ] **Step 4: Add the highlight key**

Append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN + DE strings (DE via the node write).

- [ ] **Step 5: Update the five ungated version sites**

★★ **No gate checks any of these.** They have drifted for eleven releases at a time.

```bash
grep -n '"version"' package.json
grep -n '"version"' package-lock.json | head -5    # TWO occurrences: root and packages[""]
grep -n "shields.io" README.md                      # version AND codename
grep -rn "Generated:" docs/CODEMAPS/*.md            # all five headers
```

Update every one in this commit.

- [ ] **Step 6: Verify**

```bash
grep -rn "$(node -p "require('./package.json').version")" package.json package-lock.json README.md docs/CODEMAPS/*.md | wc -l
```

Expected: at least 9 hits (package.json 1, lock 2, README 1, codemaps 5).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "release: <version> \"<codename>\""
```

---

## Task 18: Final gates

**Files:** none — verification only.

- [ ] **Step 1: Confirm no competing vitest process**

Same check as Task 15 Step 1.

- [ ] **Step 2: Run the full gate set, serially**

★ Serially. Two vitest processes on one machine is the documented flake condition.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/f-suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/f-suite.log
npm run test:shuffle > /tmp/f-shuf.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests " /tmp/f-shuf.log
npm run test:coverage > /tmp/f-cov.log 2>&1; echo "COV=$?"; grep -E "All files" /tmp/f-cov.log
npm run size:check > /tmp/f-size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/f-dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/f-docs.log 2>&1; echo "DOCS=$?"
```

Expected: every variable `=0`.

- [ ] **Step 3: Targeted axe on a fresh port**

```bash
PORT=3100 npm run dev > /tmp/f-dev.log 2>&1 &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" > /tmp/f-axe.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/f-axe.log
PORT=3100 npm run stop
```

- [ ] **Step 4: Hand over the eye-verify list**

jsdom and axe are structurally blind to all of these. Present them to the user with the completion report:

1. The two save buttons, green → dark blue (`aiGuideSave`, `secretPassphraseSave`).
2. The sub-rail indent, and how the expanded branch reads against the `<hr>` group dividers around it.
3. Views as a 17-item always-expanded list — scroll length, and whether the `toolHints` `<code>` runs wrap badly.
4. The header icon clusters in **both** layouts (modern `top-bar` is the default; classic `app-header` needs switching to).
5. `dashboard-tip-card`'s close beside its "Next" button — the pair should still read as a pair.

★ Slice 1's eye-verify is still owed and is a separate list.

- [ ] **Step 5: Stop**

Push, MR and merge happen **only** on an explicit instruction. Do not push at the end of this plan.

---

## Out of scope

- The remaining ~15 `IconButton candidate` rows and every `convertible` row in `docs/handrolled-ui-inventory.md`.
- Glyph→heroicon replacement beyond the 12 closes and `roles-editor`'s 2.
- Sortable-header `↑`/`↓` glyphs — tests read them from `textContent` and they carry a real cue.
- Class B tooltip rows the user does not approve.
- All of slice 3: undo dropdown, AI cancel, budget people rows, dependency direction.
- Persisting sub-rail expansion state — the branch opens because a section in it is active, so there is no separate state to persist.
