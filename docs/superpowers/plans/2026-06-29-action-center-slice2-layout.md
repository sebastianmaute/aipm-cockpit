# Action Center Slice 2 — Layout & Scannability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Action Center rows scannable — RAG left stripe (replacing the dot), a single `[⋮]` overflow popover for simple actions, and an expandable "+N more reasons".

**Architecture:** Layout-only change to `action-row.tsx` + a one-line prop change in `actions-panel.tsx`. No engine/ranking change. The `[⋮]` reuses the existing snooze-popover pattern (plain buttons + `usePopoverDismiss`); the contextual popovers (Escalate/Assign/Re-baseline) stay as their own inline buttons (≤1 per row, mutually exclusive). Branch `feat-action-center-slice2` off `feat-action-center-slice1`.

**Tech Stack:** Forked Next.js 16 / React 19 / TS / Vitest + Testing Library. `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:run`. The `actions` view is NOT axe-gated → a11y unit-tested + eye-verified.

**Spec:** `docs/superpowers/specs/2026-06-29-action-center-slice2-layout-design.md`

---

## File Structure

- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new key `actionMoreActions`.
- **Modify** `src/app/action-row.tsx` — RAG stripe, `[⋮]` menu, expandable reasons, density; prop `extraReasonsCount` → `extraReasons`.
- **Modify** `src/app/action-row.test.tsx` — update the slice-1 reasons test; add menu + stripe + expand tests.
- **Modify** `src/app/actions-panel.tsx` — pass `extraReasons={g.extra}`.
- **Modify** `src/app/actions-panel.test.tsx` — assert expanded reasons reachable.

---

## Task 1: i18n `actionMoreActions` (EN + DE)

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: EN key**

In `src/app/i18n.ts`, find the line `actionMoreReasons: "+{0} more reasons",` and add immediately after it:
```ts
  actionMoreActions: "More actions",
```

- [ ] **Step 2: DE key via node utf8 write (NOT the Edit tool)**

The DE anchor is the `actionMoreReasons` line added in slice 1. Run from repo root:
```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionMoreReasons: \"+{0} weitere Gründe\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add = "  actionMoreActions: \"Weitere Aktionen\",\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE key added");
'
```
Expected: `DE key added`. If `ANCHOR NOT FOUND`, STOP and report (grep the exact `actionMoreReasons` DE line; do not guess).

- [ ] **Step 3: Verify + commit**

`npm run test:run -- src/app/i18n-encoding` → PASS. `npx tsc --noEmit` → clean (EN/DE parity).
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add actionMoreActions key (EN/DE)"
```
No push, no attribution trailers.

---

## Task 2: action-row layout + actions-panel prop (atomic)

**Files:** `src/app/action-row.tsx`, `src/app/actions-panel.tsx`, `src/app/action-row.test.tsx`, `src/app/actions-panel.test.tsx`

This is one atomic task: renaming the `extraReasonsCount` prop to `extraReasons` changes the `ActionRow`↔`ActionsPanel` contract, so both files (and both tests) move together to keep `tsc` green.

- [ ] **Step 1: Update the failing tests first**

In `src/app/action-row.test.tsx`, REPLACE the slice-1 test block `it("renders a +N more reasons line when extraReasonsCount > 0", ...)` with the following (and add the menu + stripe tests). The `extraReasons` prop takes `SuggestedAction[]`:

```tsx
it("expands and collapses the extra reasons list", () => {
  const action = {
    id: "x", source: "raid",
    title: { key: "actionRaidTitle", params: [1, "x"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 70, tier: "now",
    cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  const extra = [
    { id: "x2", source: "raid", title: { key: "actionRaidTitle", params: [1, "x2"] },
      why: { key: "actionRaidWhyNoOwner" }, score: 40, tier: "now", cta: { kind: "open", view: "raid", id: 1 } },
  ] as never;
  render(<ActionRow lang="en-US" action={action} onOpen={() => {}} extraReasons={extra} />);
  const toggle = screen.getByRole("button", { name: /1 more reasons/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The extra signal's translated "why" (no-owner) is now visible.
  expect(screen.getByText(/owner/i)).toBeTruthy();
});

it("renders the RAG left stripe for the tier and no dot", () => {
  const action = {
    id: "x", source: "raid", title: { key: "actionRaidTitle", params: [1, "x"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] }, score: 70, tier: "now",
    cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  const { container } = render(<ActionRow lang="en-US" action={action} onOpen={() => {}} />);
  expect(container.querySelector(".border-l-\\[var\\(--rag-red\\)\\]")).toBeTruthy();
});

it("folds simple actions into the more-actions menu, keeps contextual popover inline", () => {
  const onSnooze = vi.fn();
  const onCreateTask = vi.fn();
  const action = {
    id: "x", source: "raid", title: { key: "actionRaidTitle", params: [1, "x"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] }, score: 70, tier: "now",
    cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  render(
    <ActionRow lang="en-US" action={action} onOpen={() => {}} onSnooze={onSnooze}
      onCreateTask={onCreateTask}
      escalate={{ /* minimal bundle so canEscalate true */ } as never} />,
  );
  // Escalate (contextual) stays inline; the simple actions hide in the menu.
  const menuTrigger = screen.getByRole("button", { name: /more actions/i });
  fireEvent.click(menuTrigger);
  fireEvent.click(screen.getByRole("button", { name: /snooze 1 hour/i }));
  expect(onSnooze).toHaveBeenCalled();
});
```

NOTES for the implementer on the menu test:
- The Escalate button is rendered by `EscalatePopover` only when `canEscalate` (raid + `actionRaidWhySeverity` + open cta) AND a truthy `escalate` bundle is passed. If constructing a minimal `escalate` bundle is awkward, drop the `escalate` prop from THIS test and instead assert only the menu fold (snooze + create-task inside `[⋮]`); add a separate tiny test that passes a real escalate bundle (mirror the existing escalate-popover test fixtures in the repo) to confirm the contextual button stays inline. Make the snooze item's accessible name match the real `actionSnooze1h` EN string — look it up in `i18n.ts` (e.g. "Snooze 1 hour") and match that in the `getByRole` name regex. Do NOT invent the label.
- Confirm `vi`, `fireEvent`, `screen`, `render` are imported in this test file (add any missing; no duplicate imports — fatal lint).

In `src/app/actions-panel.test.tsx`, update the slice-1 collapse test ("collapses multiple signals on one entity into a single row"): it currently asserts `getByText("+1 more reasons")`. Change it to assert the toggle exists and, after clicking it, the second signal's reason text is visible:
```ts
  // was: expect(screen.getByText("+1 more reasons")).toBeTruthy();
  const toggle = screen.getByRole("button", { name: /1 more reasons/i });
  fireEvent.click(toggle);
  // the r2 signal used why actionRaidWhyNoOwner → "no owner" style text now visible
  expect(screen.getByText(/owner/i)).toBeTruthy();
```
(Keep the `getAllByText("Open")` single-row assertion as-is.)

- [ ] **Step 2: Run tests to verify they fail**

`npm run test:run -- src/app/action-row.test.tsx src/app/actions-panel.test.tsx`
Expected: FAIL (prop `extraReasons` not yet supported; no menu / toggle).

- [ ] **Step 3: Edit `action-row.tsx`**

(a) Add the stripe map next to `TIER_RAG` (keep `healthDot`/`Health` imports — `TIER_RAG` may become unused once the dot is removed; if so, remove `TIER_RAG` AND the now-unused `healthDot`/`Health` imports to satisfy `--max-warnings=0`):
```ts
const TIER_STRIPE: Record<ActionTier, string> = {
  now: "border-l-[var(--rag-red)]",
  soon: "border-l-[var(--rag-amber)]",
  monitor: "border-l-[var(--rag-green)]",
};
```

(b) Change the prop in `ActionRowProps`:
```ts
  // replace:  extraReasonsCount?: number;
  extraReasons?: readonly SuggestedAction[];
```
and the destructure: `extraReasonsCount` → `extraReasons`.

(c) Add state near the other `useState`s:
```ts
  const [reasonsOpen, setReasonsOpen] = useState(false);
```

(d) Add derived consts before the `return` (after the `canRebaselineSnapshot` block):
```ts
  const createTaskApplicable = onCreateTask != null && action.source !== "task-due";
  const hasMenu = canDraft || createTaskApplicable || onSnooze != null;
```

(e) Row root: change className from
```
"flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-muted"
```
to (density tighten + stripe; the template literal adds the tier stripe):
```tsx
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-line border-l-4 ${TIER_STRIPE[action.tier]} bg-surface px-3 py-1.5 hover:bg-surface-muted`}
```

(f) DELETE the dot span:
```tsx
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${healthDot[TIER_RAG[action.tier]]}`} />
```

(g) Replace the static reasons block:
```tsx
        {extraReasonsCount != null && extraReasonsCount > 0 && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {t(lang, "actionMoreReasons", extraReasonsCount)}
          </span>
        )}
```
with the expandable toggle + list:
```tsx
        {extraReasons && extraReasons.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={reasonsOpen}
              aria-controls={`action-reasons-${action.id}`}
              onClick={(e) => { e.stopPropagation(); setReasonsOpen((o) => !o); }}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden>{reasonsOpen ? "▾" : "▸"}</span>
              {t(lang, "actionMoreReasons", extraReasons.length)}
            </button>
            {reasonsOpen && (
              <span id={`action-reasons-${action.id}`} className="mt-0.5 block">
                {extraReasons.map((ex) => (
                  <span key={ex.id} className="block truncate text-xs text-muted-foreground">
                    {t(lang, ex.why.key, ...(ex.why.params ?? []))}
                  </span>
                ))}
              </span>
            )}
          </>
        )}
```

(h) Replace the ENTIRE tail `<div className="flex shrink-0 items-center gap-1">…</div>` (from `<div className="flex shrink-0 items-center gap-1">` through its closing `</div>` just before the row's closing `</div>`) with:
```tsx
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(action); }}
          className={`${ACTION_BTN_CLASS} px-3`}
        >
          {t(lang, "actionOpen")}
        </button>
        {canEscalate && escalate && (
          <EscalatePopover lang={lang} action={action} bundle={escalate} />
        )}
        {(canRebaselineMilestone || canRebaselineSnapshot) && rebaseline && (
          <RebaselinePopover lang={lang} action={action} bundle={rebaseline} />
        )}
        {canAssign && assignOwner && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={assignOpen}
              onClick={(e) => { e.stopPropagation(); setAssignOpen((o) => !o); }}
              className={ACTION_BTN_CLASS}
            >
              {t(lang, "actionAssignOwner")}
            </button>
            {assignOpen && (
              <span
                ref={assignPopRef}
                role="dialog"
                aria-label={t(lang, "actionAssignOwner")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Escape") setAssignOpen(false); }}
                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2"
              >
                <ResourcePicker
                  lang={lang}
                  value={{ name: "", email: "", resourceId: null }}
                  resources={assignOwner.resources}
                  contacts={[]}
                  onCreateResource={assignOwner.onCreateResource}
                  onChange={(next) => { assignOwner.onAssign(action, next); setAssignOpen(false); }}
                />
              </span>
            )}
          </span>
        )}
        {hasMenu && (
          <span ref={menuWrapRef} className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label={`${t(lang, "actionMoreActions")} – ${title}`}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10"
            >
              ⋮
            </button>
            {menuOpen && (
              <span className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1">
                {canDraft && onDraftMessage && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDraftMessage(action); }}
                    className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                    {t(lang, "actionDraftMessage")}
                  </button>
                )}
                {createTaskApplicable && onCreateTask && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCreateTask(action); }}
                    className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                    {t(lang, "actionCreateTask")}
                  </button>
                )}
                {onSnooze && (
                  <>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1H); }}
                      className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                      {t(lang, "actionSnooze1h")}
                    </button>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1D); }}
                      className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                      {t(lang, "actionSnooze1d")}
                    </button>
                  </>
                )}
              </span>
            )}
          </span>
        )}
      </div>
```

This keeps the existing `menuOpen`/`menuWrapRef`/`usePopoverDismiss` (now driving the `[⋮]` instead of the old snooze-only popover) and the `assignOpen`/`assignPopRef` dialog logic unchanged.

- [ ] **Step 4: Edit `actions-panel.tsx`**

In the `renderRow` helper, change:
```tsx
                extraReasonsCount={g.extra.length}
```
to:
```tsx
                extraReasons={g.extra}
```

- [ ] **Step 5: Run tests to verify they pass**

`npm run test:run -- src/app/action-row.test.tsx src/app/actions-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

`npx tsc --noEmit && npm run lint`
Expected: clean. Watch for now-unused imports/consts after removing the dot: if `TIER_RAG` / `healthDot` / `Health` are no longer referenced, remove them (fatal under `--max-warnings=0`).

- [ ] **Step 7: Commit**
```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/action-row.test.tsx src/app/actions-panel.test.tsx
git commit -m "feat(action-center): RAG stripe, overflow menu, expandable reasons"
```

---

## Task 3: Full-suite verification

- [ ] **Step 1: Full unit suite**

`npm run test:run`
Expected: all green. If a downstream test rendered `ActionRow`/`ActionsPanel` with `extraReasonsCount`, migrate it to `extraReasons` (an array) — do not reintroduce the old prop.

- [ ] **Step 2: Typecheck + lint (final)**

`npx tsc --noEmit && npm run lint` → clean.

- [ ] **Step 3: Footprint**

`git diff --stat feat-action-center-slice1..HEAD`
Expected only: `i18n.ts`, `i18n.de.ts`, `action-row.tsx`, `action-row.test.tsx`, `actions-panel.tsx`, `actions-panel.test.tsx`. No other files, no `console.log`.

---

## Out of scope / notes
- Contextual popovers (Escalate/Assign/Re-baseline) NOT folded — left inline (≤1 per row).
- No per-reason CTA (slice 4). No density toggle. No engine change.
- Eye-verify the `[⋮]` keyboard path + RAG stripe contrast (AIPM light/dark + Mockup) — `actions` view is not axe-gated.
- No release/push/MR — only on the explicit "release" trigger.
