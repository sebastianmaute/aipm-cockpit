# Release 1 — Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five small, independent UX polish improvements: persistent chat prompt chips, a bug-fixed timelog project memory, a card-style timelog apply bar, a Standalone default in Knowledge, and a theme-driven landing-page logo.

**Architecture:** Each slice is isolated to 1–2 files with no cross-dependencies, so tasks can be executed and committed in any order. Grounding revealed the code is ahead of the original spec — logo is already per-scheme, the timelog picker already re-seeds from persisted links, and the composer is already below the output — so several slices are narrower than the spec's headline suggested. Scopes below reflect the code as it actually is (verified 2026-07-24).

**Tech Stack:** Next.js 16 / React 19, TypeScript, Vitest + Testing Library, Tailwind v4 (AIPM `ui-*` palette tokens only), i18n EN/DE parity.

**Commands used throughout:**
- Single test file: `npx vitest run src/app/<file>.test.tsx`
- Full unit suite: `npm run test:run`
- Typecheck (also enforces i18n key parity): `npx tsc --noEmit`
- Lint (CI is `--max-warnings=0`; an unused import is FATAL): `npm run lint`

**No new i18n keys** are introduced by any slice — all reuse existing keys, so no `i18n.de.ts` umlaut editing is required.

---

## Task 1: Persist chat prompt chips below the output (req 1.1)

**Context:** In `chat-panel.tsx` the suggested-prompt chip strip (`PROMPT_CHIPS`) renders ONLY inside the `display.length === 0` empty-state branch (lines ~689–707), so it vanishes as soon as the conversation has any messages. The composer is already pinned below the output scroller. Goal: extract the chips into a presentational component and render it in a persistent strip directly below the output scroller, visible for the whole session (whenever the key is present and not locked). Remove the chips from the empty-state branch to avoid duplication.

**Files:**
- Create: `src/app/chat-prompt-chips.tsx`
- Create: `src/app/chat-prompt-chips.test.tsx`
- Modify: `src/app/chat-panel.tsx` (move `PROMPT_CHIPS` const out; delete the empty-state chip `<ul>` at ~689–707; render the new component below the scroller)

- [ ] **Step 1: Write the failing test for the extracted component**

Create `src/app/chat-prompt-chips.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatPromptChips } from "./chat-prompt-chips";

describe("ChatPromptChips", () => {
  it("renders a labelled suggested-prompts list with at least one chip", () => {
    render(<ChatPromptChips lang="en-US" onPick={vi.fn()} />);
    const list = screen.getByRole("list", { name: /suggested prompts/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("calls onPick with the chip body and autoSend flag when a chip is clicked", () => {
    const onPick = vi.fn();
    render(<ChatPromptChips lang="en-US" onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0][0]).toBe("string"); // body
    expect(typeof onPick.mock.calls[0][1]).toBe("boolean"); // autoSend
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/chat-prompt-chips.test.tsx`
Expected: FAIL — `Cannot find module './chat-prompt-chips'`.

- [ ] **Step 3: Locate and cut the `PROMPT_CHIPS` const from `chat-panel.tsx`**

Run: `npx vitest run` is not needed here. First find the const:
Search `chat-panel.tsx` for `PROMPT_CHIPS =` (a module-level `const PROMPT_CHIPS = [...]`, each entry `{ labelKey, bodyKey, autoSend? }`). Cut the entire const declaration (and any local `PromptChip` type if present) out of `chat-panel.tsx`. It will move verbatim into the new file in the next step. Also remove the now-unused `TRANSITION`/`PRESS` imports from `chat-panel.tsx` ONLY if nothing else there uses them (grep first — the composer may still use them; if so, leave the import).

- [ ] **Step 4: Create the component with the moved const**

Create `src/app/chat-prompt-chips.tsx` (paste the `PROMPT_CHIPS` const you cut in Step 3 where indicated; the chip markup below is the exact markup lifted from the old empty-state block):

```tsx
"use client";

// Suggested-prompt chip strip for the AI Assistant. Extracted from chat-panel's
// empty-state so the chips can render in a PERSISTENT strip below the output for
// the whole session, not only when the transcript is empty.

import { t, type Lang } from "./i18n";
import { TRANSITION, PRESS } from "./interaction-styles";

// <<< PASTE the PROMPT_CHIPS const (and its PromptChip type, if any) cut from
//     chat-panel.tsx here, adding `export` to the const. Its entries are
//     { labelKey, bodyKey, autoSend? }. >>>

export function ChatPromptChips({
  lang,
  onPick,
}: {
  lang: Lang;
  /** body = translated prompt text; autoSend = send immediately vs prefill. */
  onPick: (body: string, autoSend: boolean) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Suggested prompts">
      {PROMPT_CHIPS.map((chip) => (
        <li key={chip.labelKey}>
          <button
            type="button"
            onClick={() => onPick(t(lang, chip.bodyKey), !!chip.autoSend)}
            className={`rounded-full border border-ui-dark-blue/40 bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue hover:bg-ui-dark-blue/10 focus:outline-none focus:ring-2 focus:ring-ui-dark-blue/50 dark:border-ui-dark-blue/60 dark:text-ui-dark-blue dark:hover:bg-ui-dark-blue/20 ${TRANSITION} ${PRESS}`}
          >
            {t(lang, chip.labelKey)}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `npx vitest run src/app/chat-prompt-chips.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Wire the component into `chat-panel.tsx` and delete the empty-state chips**

In `chat-panel.tsx`:
1. Add import: `import { ChatPromptChips } from "./chat-prompt-chips";`
2. DELETE the empty-state chip block (the `{!apiKeyMissing && ( <ul ...aria-label="Suggested prompts"> ... </ul> )}` at ~689–707). Keep the greeting text above it.
3. Immediately AFTER the output scroller's closing `</div>` (the `<div ref={scrollerRef} …>` that ends at ~775), insert the persistent strip:

```tsx
      {!apiKeyMissing && !apiKeyLocked && (
        <div className="mt-2 shrink-0">
          <ChatPromptChips
            lang={lang}
            onPick={(body, autoSend) => (autoSend ? submitPrompt(body) : setInput(body))}
          />
        </div>
      )}
```

Note: `apiKeyLocked`, `apiKeyMissing`, `submitPrompt`, and `setInput` are already in scope in `chat-panel.tsx`.

- [ ] **Step 7: Typecheck, lint, and run the chat-panel test**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: no errors (watch for a now-unused `TRANSITION`/`PRESS` import if you removed the wrong one).
Run: `npx vitest run src/app/chat-panel.test.tsx`
Expected: PASS. (The existing empty-state test at ~line 101 that finds the composer placeholder still passes; if any test asserted the chips are ABSENT once messages exist, update it to expect them present.)

- [ ] **Step 8: Commit**

```bash
git add src/app/chat-prompt-chips.tsx src/app/chat-prompt-chips.test.tsx src/app/chat-panel.tsx
git commit -m "feat(chat): keep suggested-prompt chips available all session"
```

---

## Task 2: Timelog apply bar — outline card + Button primitive (req 1.3)

**Context:** `timelog-apply-confirm.tsx` already uses `rounded-md border border-line` but fills with `bg-surface-muted` and uses two raw `<button>`s. Goal: make it a pure outline card (`bg-surface`, no muted fill) and swap the two raw buttons for the `Button` primitive (Apply = primary, Cancel = secondary).

**Files:**
- Modify: `src/app/timelog-apply-confirm.tsx`
- Create: `src/app/timelog-apply-confirm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/timelog-apply-confirm.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimelogApplyConfirm } from "./timelog-apply-confirm";
import { t } from "./i18n";
import type { ApplyDiffLabel } from "./timelog-apply";

const ROW: ApplyDiffLabel = {
  bucketId: 1,
  allocIndex: 0,
  period: "2026-W30",
  bucketName: "Bucket A",
  lineName: "Design",
  current: 10,
  next: 14,
};

describe("TimelogApplyConfirm", () => {
  it("renders an outline card without the muted background fill", () => {
    const { container } = render(
      <TimelogApplyConfirm lang="en-US" rows={[ROW]} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border border-line");
    expect(card.className).not.toContain("bg-surface-muted");
  });

  it("fires onApply and onCancel from the primitive buttons", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <TimelogApplyConfirm lang="en-US" rows={[ROW]} onApply={onApply} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: FAIL — the first test fails because the current className still contains `bg-surface-muted`.

- [ ] **Step 3: Apply the outline + Button changes**

In `src/app/timelog-apply-confirm.tsx`:
1. Add import: `import { Button } from "./button";`
2. Change the wrapper `<div>` className (line ~31) from:
   `"flex items-center gap-3 rounded-md border border-line bg-surface-muted px-3 py-2 print:hidden"`
   to:
   `"flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 print:hidden"`
3. Replace the Apply raw `<button>` (lines ~46–52) with:

```tsx
      <Button variant="primary" size="sm" onClick={onApply}>
        {t(lang, "timelogApply")}
      </Button>
```

4. Replace the Cancel raw `<button>` (lines ~53–59) with:

```tsx
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t(lang, "cancel")}
      </Button>
```

5. Remove the `import { INTERACTIVE } from "./interaction-styles";` line — it is no longer used (the `Button` primitive composes `INTERACTIVE` itself). Lint will fail if this import is left unused.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: no errors (confirm the `INTERACTIVE` import was removed).

- [ ] **Step 6: Commit**

```bash
git add src/app/timelog-apply-confirm.tsx src/app/timelog-apply-confirm.test.tsx
git commit -m "style(timelog): apply bar as outline card with Button primitives"
```

---

## Task 3: Knowledge — default to Standalone/project (req 1.4)

**Context:** In `knowledge-panel.tsx` the add-link target `<select>` defaults to `""` (the `—` placeholder), so the user must pick a target before the manual-add input row appears. Goal: default the target to `STANDALONE_KEY` (the project's Knowledge library) so a new entry attaches to the project by default; task-linking stays optional.

**Files:**
- Modify: `src/app/knowledge-panel.tsx`
- Modify: `src/app/knowledge-panel.test.tsx`

- [ ] **Step 1: Update the failing existing test to encode the new default**

In `src/app/knowledge-panel.test.tsx`, the test at ~204 ("Cancel is reachable and closes the add panel before any target is chosen") asserts the manual row is hidden until a target is picked — the opposite of the new behavior. REPLACE that test with:

```tsx
  it("defaults the target to Standalone so the manual-add row is immediately available", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    const target = screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }) as HTMLSelectElement;
    // Defaults to the Standalone (project-library) option, not the "—" placeholder.
    expect(target.value).toBe("__standalone__");
    // Because a target is pre-selected, the manual name/url inputs render at once.
    expect(screen.getByLabelText(t("en-US", "documentsManualName"))).toBeInTheDocument();
    // Cancel still closes the panel.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("combobox", { name: t("en-US", "documentsTarget") })).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/knowledge-panel.test.tsx -t "defaults the target to Standalone"`
Expected: FAIL — `target.value` is `""`, not `"__standalone__"`.

- [ ] **Step 3: Change the default in `knowledge-panel.tsx`**

In `src/app/knowledge-panel.tsx`:
1. The constant `STANDALONE_KEY = "__standalone__"` is currently declared at ~line 123, AFTER the `targetKey` state at ~116. Hoist it to module scope (place `const STANDALONE_KEY = "__standalone__";` near the top of the file, above the component function), and DELETE the in-component redeclaration at ~123 (keep the `const isStandalone = targetKey === STANDALONE_KEY;` line).
2. Change the state initializer at ~line 116 from:
   `const [targetKey, setTargetKey] = useState("");`
   to:
   `const [targetKey, setTargetKey] = useState(STANDALONE_KEY);`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/knowledge-panel.test.tsx`
Expected: PASS. (Check the other add-flow tests at ~159 and ~177 that explicitly `fireEvent.change` the target to `task:7` — they still pass because they override the default; if any test relied on the `—` placeholder being selected initially, update it to first select `""`.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/knowledge-panel.tsx src/app/knowledge-panel.test.tsx
git commit -m "feat(knowledge): default new links to the project library (standalone)"
```

---

## Task 4: Landing-page logo from active theme branding (req 1.5)

**Context:** Logo is already per-scheme (`ColorScheme.branding`, applied to `settings.branding` via `mergeAppliedBranding`). The only place that ignores it is `project-empty-state.tsx:138–142`, which hardcodes `<img src="/AIPM-logo.svg">` on the no-project landing. Goal: source that logo from `settings.branding?.logo` (falling back to `/AIPM-logo.svg`), mirroring `app-header.tsx:97–101`, so the landing logo follows the active theme and any configured custom logo.

**Files:**
- Modify: `src/app/project-empty-state.tsx`
- Modify: `src/app/project-empty-state.test.tsx`

- [ ] **Step 1: Confirm the settings hook name used elsewhere**

Run: search the repo for how `app-header.tsx` reads settings (it reads `settings.branding?.logo`). Confirm the hook import (`useSettings` from `./use-settings`, or the settings context module app-header uses). Use that SAME import in the following steps. (Do not invent a new provider.)

- [ ] **Step 2: Write the failing test**

In `src/app/project-empty-state.test.tsx`, add a test that the choices-screen logo follows branding. Mirror how the file's existing tests provide settings — if they render under a settings provider, set `branding.logo` there; if they mock `useSettings`, extend that mock. Use this assertion body:

```tsx
  it("uses the active branding logo on the no-project landing when set", () => {
    // Provide settings with a custom raster branding logo (match the file's
    // existing settings-provision pattern — provider wrapper OR useSettings mock).
    const LOGO = "data:image/png;base64,QUJD";
    renderEmptyStateWithBrandingLogo(LOGO); // helper: see note below
    const img = screen.getByRole("img", { name: /consult|logo/i });
    expect(img).toHaveAttribute("src", LOGO);
  });
```

Note: implement `renderEmptyStateWithBrandingLogo` using the SAME settings mechanism the sibling tests already use in this file (e.g. wrap in the existing `SettingsProvider` with `branding: { logo: LOGO }`, or `vi.mock("./use-settings", …)` returning `{ settings: { branding: { logo: LOGO } } }`). Do not add a new provider that the component does not consume.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app/project-empty-state.test.tsx -t "active branding logo"`
Expected: FAIL — `src` is `/AIPM-logo.svg`, not the data URL.

- [ ] **Step 4: Read branding in `project-empty-state.tsx`**

In `src/app/project-empty-state.tsx`:
1. Add the settings import confirmed in Step 1, e.g. `import { useSettings } from "./use-settings";`
2. Inside the component, read: `const { settings } = useSettings();` and `const brandLogo = settings.branding?.logo;` (place near the other hook calls at the top of the component body).
3. Replace the hardcoded logo block (lines ~138–142) with:

```tsx
          logo={
            view === "choices" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogo || "/AIPM-logo.svg"}
                alt="Acme"
                className={brandLogo ? "max-h-10 w-auto object-contain" : "h-7 w-auto"}
              />
            ) : undefined
          }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/project-empty-state.test.tsx`
Expected: PASS (new test + all existing empty-state tests — the fallback branch keeps `/AIPM-logo.svg` when no branding logo is set).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx
git commit -m "feat(branding): landing-page logo follows active theme branding"
```

---

## Task 5: Fix timelog picker not remembering the last project (req 1.2 — diagnosis + fix)

**Context:** The source already re-seeds the picker from persisted workspace `links` via render-time reconciles (`timelog-panel.tsx:414–422`: sets `projectCustomerId` from `links.customerId` and `selectedProjectIds` from `links.projectIds`, gated on `!linksSeeded && !userPicked`), and Refresh re-fetches that scope. The user still observes the picker forgetting, so there is a real defect the static read does not reveal — this task is a diagnosis, not a blind edit.

**REQUIRED SUB-SKILL:** Use superpowers:systematic-debugging. Do NOT write a fix before you have reproduced the failure and identified the root cause.

**Files (likely, confirm during diagnosis):**
- Modify: `src/app/timelog-panel.tsx`
- Modify/Create: `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Reproduce against a running app**

Run: `npm run dev` (stop later with `npm run stop`). In the browser: enable Timelog, pick a customer + one project, Fetch bookings, then reload the page and reopen the Timelog view. Observe whether the customer `<select>` and the project checkboxes come back pre-selected. Record the exact failing symptom (customer blank? customer set but projects unchecked? both blank?).

- [ ] **Step 2: Form and test hypotheses (write findings inline, do not fix yet)**

Investigate each until one is confirmed by evidence (console/log/DevTools):
- **H1 — links not persisted for this backend.** Confirm `ws.setTimelogLinks` actually reaches disk on the active backend (file vs IndexedDB vs Turso). `timelogLinks` is a JSON meta-blob across 6 write paths — verify the active one round-trips it (reload → is `links.projectIds` populated in memory?).
- **H2 — seed blocked by `userPicked`.** Check whether `userPicked` is `true` at seed time (e.g. an unintended `setUserPicked(true)` firing on mount, or the customer auto-resolve path setting it).
- **H3 — customer set but checkboxes look empty.** `selectedProjectIds` is seeded from `links.projectIds`, but the checkbox rows come from `sync.customerProjects` (loaded async by the `[projectCustomerId]` effect at :364). If that load fails/returns late, the ids are selected but no row renders as checked — a VISUAL-only miss. Confirm whether ids are in state while rows are absent.
- **H4 — `projectId` key churn.** `seenProjectId !== projectId` resets the one-shots (:403–413). If `projectId` (`ws.project?.code ?? "default"`) changes identity on reload/hydration, the reset wipes the just-seeded scope. Check `projectId` stability across the hydration renders.

- [ ] **Step 3: Write a failing regression test capturing the confirmed root cause**

Add a test to `src/app/timelog-panel.test.tsx` that reproduces the specific failure found (mirror the existing `describe("Refresh bookings", …)` setup at ~237 and the persisted-scope test at ~720). For example, if H3/H4: render with persisted `links` (customer + projectIds) and assert the customer `<select>` shows the persisted customer AND, once `customerProjects` are provided, the persisted projects render checked. Use the file's existing `SeedWorkspace`/`wrapper`/`defaultSyncReturn` helpers.

Run: `npx vitest run src/app/timelog-panel.test.tsx -t "<your test name>"`
Expected: FAIL, reproducing the reported symptom.

- [ ] **Step 4: Implement the minimal fix for the confirmed cause**

Apply the smallest change that fixes the confirmed hypothesis. Preserve the existing render-reconcile pattern (state-guarded one-shots — NOT `set-state-in-effect`, which is banned) and the `userPicked` precedence (a manual pick must still win over the persisted seed). Do NOT broaden the reconcile into an effect.

- [ ] **Step 5: Run the regression test + full timelog suite**

Run: `npx vitest run src/app/timelog-panel.test.tsx`
Expected: PASS (new test + all existing timelog-panel tests, including the Refresh and persisted-scope suites).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/timelog-panel.test.tsx
git commit -m "fix(timelog): picker remembers the last fetched customer and projects"
```

---

## Final verification (after all tasks)

- [ ] Run the full unit suite: `npm run test:run` — expected all pass.
- [ ] Run `npx tsc --noEmit` — expected exit 0 (also confirms i18n EN/DE key parity; no new keys were added).
- [ ] Run `npm run lint` — expected clean under `--max-warnings=0`.
- [ ] Manual eye-check (not axe-gated surfaces): chat prompt chips visible below output after sending a message; timelog apply bar reads as an outline card with primary/secondary buttons; Knowledge Add defaults to Standalone; landing logo swaps with a configured branding logo.

## Self-review notes (spec coverage)

- Req 1.1 → Task 1. Req 1.3 → Task 2. Req 1.4 → Task 3. Req 1.5 → Task 4. Req 1.2 → Task 5.
- Scope corrections vs the design spec (code was ahead of the AGENTS.md-based assumptions): 1.2 is a bug-fix not a new per-device store (workspace `links` already persists scope); 1.5 is only the empty-state render wiring (logo is already per-scheme); 1.1 is the chip strip not the composer. These corrections are recorded here rather than silently implemented differently.
- No new persisted fields, no golden-fixture regen, no new i18n keys, no axe-scanned-surface changes → no golden/axe/i18n gates triggered by this release.
