# Help Window Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two Help surfaces (floating panel + in-pane view) on one shared, refined two-pane content component with consistent hierarchy, a wider TOC, and a smaller floating-panel default.

**Architecture:** Extract the in-pane view's grouped TOC+content render into a new presentational `HelpContentPane` component. Both `help-view.tsx` (in-pane) and `help-menu.tsx` (floating) consume it, keeping their own surface chrome. Both unify on the scroll+TOC-jump model; the floating panel drops its tablist/tabpanel + keyboard-tab nav.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (container queries), Vitest + Testing Library. Forked Next.js 16.

**Spec:** `docs/superpowers/specs/2026-06-29-help-window-layout-design.md`

---

## File Structure

- **Create** `src/app/help-content-pane.tsx` — `HelpContentPane` (shared two-pane TOC+content) + exported `helpSectionId`.
- **Create** `src/app/help-content-pane.test.tsx` — unit tests for the new component.
- **Modify** `src/app/help-view.tsx` — replace inline two-pane block with `<HelpContentPane>`; reuse `helpSectionId` for relations-map + deep-link scroll.
- **Modify** `src/app/help-menu.tsx` — replace tablist/tabpanel + keyboard nav with search input + `<HelpContentPane>`; shrink default size + bump resize storage key.
- **Modify** `src/app/help-menu.test.tsx` — rewrite the two `role="tab"` tests for the new scroll model.

Verify against AGENTS.md: Help is NOT in `A11Y_VIEWS` (eye-verify only); `useResizable` inline-size beats class width (bump storage key); palette = AIPM tokens only; new file is `.tsx` (no `help-content-pane.ts` collision — only `help-content.ts` exists).

---

## Task 1: Create the shared `HelpContentPane` component

**Files:**
- Create: `src/app/help-content-pane.tsx`
- Test: `src/app/help-content-pane.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/help-content-pane.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import { HelpContentPane } from "./help-content-pane";
import { HELP_ENTRIES } from "./help-content";
import { loadI18n, t } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
});

test("renders grouped content headings for an empty query", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  // All four group dividers render as headings, plus an entry heading per entry.
  const headings = screen.getAllByRole("heading");
  expect(headings.length).toBeGreaterThan(HELP_ENTRIES.length);
});

test("query filters both the TOC and the content (fewer headings)", async () => {
  const { rerender } = render(<HelpContentPane lang="en-US" query="" />);
  const before = screen.getAllByRole("heading").length;
  rerender(<HelpContentPane lang="en-US" query="milestone" />);
  const after = screen.getAllByRole("heading").length;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test("shows the no-results message when nothing matches", () => {
  render(<HelpContentPane lang="en-US" query="zzzznotfound" />);
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
  expect(screen.queryAllByRole("heading")).toHaveLength(0);
});

test("a Related view link fires onNavigateView", async () => {
  const onNavigateView = vi.fn();
  // Related view links carry the helpRelationsGoToView "Go to {label}" aria-label.
  render(<HelpContentPane lang="en-US" query="" onNavigateView={onNavigateView} />);
  const links = screen.getAllByRole("button", { name: /go to/i });
  expect(links.length).toBeGreaterThan(0);
  await userEvent.click(links[0]);
  expect(onNavigateView).toHaveBeenCalled();
});
```

Note: `HELP_ENTRIES` and `t` are imported in the test header above but only `HELP_ENTRIES` is used (first test). If `t` is unused after this revision, drop it from the test imports to keep `tsc`/lint clean.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/help-content-pane.test.tsx`
Expected: FAIL — `Failed to resolve import "./help-content-pane"` (module does not exist yet).

- [ ] **Step 3: Write the component**

Create `src/app/help-content-pane.tsx`:

```tsx
"use client";

// Shared two-pane Help content: a grouped TOC (left) that jumps to grouped
// content sections (right), both filtered by the parent-owned `query`. Used by
// BOTH the in-pane Help view (help-view.tsx) and the floating Help panel
// (help-menu.tsx) so the two surfaces render identically. Presentational: the
// parent owns the search input, tours, relations map, and footer.
import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { matchesQuery, highlightSegments } from "./help-search";
import { navLabelKey, type AppView } from "./nav-config";
import { INTERACTIVE } from "./interaction-styles";

/** DOM id for an entry's content section — shared so the in-pane view's
 *  relations map + deep-link scroll can target sections this component renders. */
export const helpSectionId = (id: string) => `help-sec-${id}`;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((seg, k) =>
        seg.match ? (
          <mark key={k} className="bg-AIPM-green/20 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function HelpContentPane({
  lang,
  query,
  onNavigateView,
}: {
  lang: Lang;
  query: string;
  onNavigateView?: (view: AppView) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const matched = HELP_ENTRIES.filter((e) =>
      matchesQuery(t(lang, e.titleKey), t(lang, e.bodyKey), query),
    );
    return HELP_GROUP_ORDER.map((group) => ({
      group,
      entries: matched.filter((e) => e.group === group),
    })).filter((g) => g.entries.length > 0);
  }, [lang, query]);

  const scrollToSection = (id: string) => {
    setActiveId(id);
    document.getElementById(helpSectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (groups.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t(lang, "helpNoResults")}</p>;
  }

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden @[560px]:flex-row">
      {/* Grouped TOC: horizontal scroll strip when narrow, sticky sidebar when wide */}
      <nav
        aria-label={t(lang, "helpContents")}
        className="flex shrink-0 flex-row gap-2 overflow-x-auto border-b border-line p-2 @[560px]:w-52 @[560px]:flex-col @[560px]:gap-0 @[560px]:overflow-x-visible @[560px]:overflow-y-auto @[560px]:border-b-0 @[560px]:border-r @[560px]:p-3"
      >
        {groups.map(({ group, entries }) => (
          <div key={group} className="shrink-0 @[560px]:mb-3 @[560px]:shrink">
            <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(lang, HELP_GROUP_LABEL[group])}
            </p>
            <ul className="flex flex-row gap-0.5 @[560px]:flex-col">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(e.id)}
                    className={
                      activeId === e.id
                        ? `block w-full whitespace-nowrap rounded border-l-2 border-AIPM-dark-blue bg-surface-muted px-2 py-1 text-left text-xs font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey ${INTERACTIVE}`
                        : `block w-full whitespace-nowrap rounded border-l-2 border-transparent px-2 py-1 text-left text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`
                    }
                  >
                    {t(lang, e.titleKey)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Grouped content */}
      <div className="min-h-0 flex-1 overflow-auto p-3 pr-2 print:max-h-none print:overflow-visible">
        {groups.map(({ group, entries }) => (
          <div key={group} className="mb-6">
            <h2 className="mb-2 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, HELP_GROUP_LABEL[group])}
            </h2>
            <div className="flex flex-col gap-4">
              {entries.map((e) => (
                <section key={e.id} id={helpSectionId(e.id)} className="scroll-mt-2">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    <Highlighted text={t(lang, e.titleKey)} query={query} />
                  </h3>
                  <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    <Highlighted text={t(lang, e.bodyKey)} query={query} />
                  </p>
                  {(e.relatedConcepts?.length ?? 0) > 0 || (e.relatedViews?.length ?? 0) > 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium">{t(lang, "helpRelated")}:</span>{" "}
                      {e.relatedConcepts?.map((rid, idx) => {
                        const target = HELP_ENTRIES.find((x) => x.id === rid);
                        if (!target) return null;
                        return (
                          <span key={rid}>
                            {idx > 0 ? ", " : ""}
                            <button
                              type="button"
                              onClick={() => scrollToSection(rid)}
                              className={`text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                            >
                              {t(lang, target.titleKey)}
                            </button>
                          </span>
                        );
                      })}
                      {e.relatedViews?.map((v) =>
                        onNavigateView ? (
                          <button
                            key={v}
                            type="button"
                            onClick={() => onNavigateView(v)}
                            aria-label={t(lang, "helpRelationsGoToView", t(lang, navLabelKey(v)))}
                            className={`ml-2 italic text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                          >
                            {t(lang, navLabelKey(v))}
                          </button>
                        ) : (
                          <span key={v} className="ml-2 italic">
                            {t(lang, navLabelKey(v))}
                          </span>
                        ),
                      )}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/help-content-pane.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/help-content-pane.tsx src/app/help-content-pane.test.tsx
git commit -m "feat(help): shared HelpContentPane two-pane component"
```

---

## Task 2: Consume `HelpContentPane` in the in-pane Help view

**Files:**
- Modify: `src/app/help-view.tsx`

- [ ] **Step 1: Verify the existing view test still describes current behavior**

Run: `npx vitest run src/app/help-view.test.tsx`
Expected: PASS (baseline before the change).

- [ ] **Step 2: Update imports**

In `src/app/help-view.tsx`, replace these import lines:

```tsx
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { matchesQuery, highlightSegments } from "./help-search";
import { navLabelKey, type AppView } from "./nav-config";
import { buildRelationsGraph } from "./relations-graph";
```

with:

```tsx
import { HELP_ENTRIES } from "./help-content";
import { type AppView } from "./nav-config";
import { buildRelationsGraph } from "./relations-graph";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
```

(`HELP_GROUP_ORDER`, `HELP_GROUP_LABEL`, `matchesQuery`, `highlightSegments`, `navLabelKey` are no longer used directly here — they live in `HelpContentPane`. `HELP_ENTRIES` is still used by `buildRelationsGraph`.)

- [ ] **Step 3: Remove the local `sectionId`, `Highlighted`, and `groups`**

Delete the local `const sectionId = (id: string) => ...` line and the entire `function Highlighted({ text, query }) { ... }` definition near the top of the file (both now provided by / internal to `help-content-pane.tsx`).

Delete the `groups` memo:

```tsx
const groups = useMemo(() => {
  const matched = HELP_ENTRIES.filter((e) => matchesQuery(t(lang, e.titleKey), t(lang, e.bodyKey), query));
  return HELP_GROUP_ORDER.map((group) => ({ group, entries: matched.filter((e) => e.group === group) })).filter(
    (g) => g.entries.length > 0,
  );
}, [lang, query]);
```

- [ ] **Step 4: Repoint `scrollToSection` and the deep-link effect to `helpSectionId`**

Replace:

```tsx
const scrollToSection = (id: string) => {
  document.getElementById(sectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
};
```

with:

```tsx
const scrollToSection = (id: string) => {
  document.getElementById(helpSectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
};
```

And in the deep-link effect, replace `document.getElementById(sectionId(handledConcept))` with `document.getElementById(helpSectionId(handledConcept))`.

- [ ] **Step 5: Replace the inline two-pane block with the shared component**

Replace the entire bordered two-pane block — from:

```tsx
<div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line print:block print:overflow-visible">
  {groups.length === 0 ? (
    ...
  ) : (
    <>
      {/* Grouped table of contents (left) ... */}
      ...
      {/* Grouped content (right) */}
      ...
    </>
  )}
</div>
```

with:

```tsx
<div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line print:block print:overflow-visible">
  <HelpContentPane lang={lang} query={query} onNavigateView={onNavigateView} />
</div>
```

- [ ] **Step 6: Run the view test + typecheck + lint**

Run: `npx vitest run src/app/help-view.test.tsx`
Expected: PASS. If a selector assumed the old inline markup (e.g. a TOC `nav` class), update it to the equivalent rendered by `HelpContentPane` — the section `<h3>` titles, group `<h2>` headers, and Related links all still render with the same text.

Run: `npx tsc --noEmit` → no errors.
Run: `npx eslint src/app/help-view.tsx --max-warnings=0` → clean (catches any now-unused import/var, which is FATAL in CI).

- [ ] **Step 7: Commit**

```bash
git add src/app/help-view.tsx src/app/help-view.test.tsx
git commit -m "refactor(help): in-pane Help view uses HelpContentPane"
```

---

## Task 3: Consume `HelpContentPane` in the floating Help panel

**Files:**
- Modify: `src/app/help-menu.tsx`

- [ ] **Step 1: Update imports**

In `src/app/help-menu.tsx`, replace:

```tsx
import { matchesQuery, highlightSegments } from "./help-search";
import { type Lang, t } from "./i18n";
import { HELP_ENTRIES as SECTIONS, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
```

with:

```tsx
import { type Lang, t } from "./i18n";
import { HelpContentPane } from "./help-content-pane";
```

(The panel no longer iterates entries itself; `matchesQuery`/`highlightSegments`/the `HELP_*` constants now live in `HelpContentPane`. `INTERACTIVE` and `useResizable` / `APP_LICENSE_URL` imports stay.)

- [ ] **Step 2: Shrink default size + bump the resize storage key**

Replace:

```tsx
const STORAGE_KEY_SIZE = "lop-app:help-size";
```

with:

```tsx
const STORAGE_KEY_SIZE = "lop-app:help-size-v2";
```

(Bump is required: `useResizable` writes the saved size as an inline style that overrides the class width, so without a new key existing users keep the old 1120×960. — AGENTS.md.)

In the panel element's `className`, change `h-[960px] ... w-[1120px]` to `h-[620px] ... w-[760px]` (keep `min-h-72 min-w-[420px]`):

```tsx
className="fixed z-50 flex h-[620px] min-h-72 w-[760px] min-w-[420px] flex-col overflow-auto resize rounded-lg border border-line bg-surface"
```

In the first-render default-pos effect, change the fallback dimensions `?? 1120` → `?? 760` and `?? 960` → `?? 620`:

```tsx
const panelW = el?.offsetWidth ?? 760;
const panelH = el?.offsetHeight ?? 620;
```

- [ ] **Step 3: Remove the tab state, refs, and keyboard handler**

Delete these (now unused with the scroll model):
- `const [activeIdx, setActiveIdx] = useState(0);`
- `const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);`
- the entire `const onTabKeyDown = useCallback(...)` block
- the `const filtered = SECTIONS.map(...)`, `const activeInFiltered = ...`, and `const effectiveIdx = ...` lines

Keep: `open`, `pos`, `query` state, `panelRef` (useResizable), `dragRef`, the position effect, the Escape effect, and `onTitleBarMouseDown`. Remove `useCallback`/`useRef` from the React import only if no longer referenced (the drag handler still uses `useCallback` and `dragRef` uses `useRef`, so keep both).

- [ ] **Step 4: Replace the body (search sidebar + tablist + tabpanel) with search input + pane**

Replace the whole `<div className="flex min-h-0 flex-1">...</div>` block (the left search+tablist column and the right tabpanel) with a search input row followed by the shared pane:

```tsx
<div className="shrink-0 border-b border-line p-2">
  <input
    type="search"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder={t(lang, "helpSearchPlaceholder")}
    aria-label={t(lang, "helpSearchPlaceholder")}
    className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
  />
</div>

<HelpContentPane lang={lang} query={query} />
```

(The intro `<p>` above and the footer below are unchanged. The policy link was already removed in a prior change.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` → no errors.
Run: `npx eslint src/app/help-menu.tsx --max-warnings=0` → clean. If `useRef` or `useCallback` is reported unused, remove it from the import; if `highlightSegments`/`matchesQuery`/`SECTIONS` linger anywhere, remove the reference.

- [ ] **Step 6: Rewrite the floating-panel test**

Replace the body of `src/app/help-menu.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { HelpMenu } from "./help-menu";

async function openHelp() {
  const user = userEvent.setup();
  render(<HelpMenu lang="en-US" />);
  await user.click(screen.getByRole("button", { name: /help/i }));
  return user;
}

test("typing in the search box narrows the rendered topics", async () => {
  const user = await openHelp();
  const search = await screen.findByPlaceholderText("Search help");
  const before = screen.getAllByRole("heading").length;
  await user.type(search, "milestone");
  const after = screen.getAllByRole("heading").length;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test("no-results state when nothing matches", async () => {
  const user = await openHelp();
  await user.type(await screen.findByPlaceholderText("Search help"), "zzzznotfound");
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
});

test("does not render the AI usage policy link", async () => {
  await openHelp();
  expect(screen.queryByText(/usage policy/i)).toBeNull();
});
```

- [ ] **Step 7: Run tests + final typecheck**

Run: `npx vitest run src/app/help-menu.test.tsx`
Expected: PASS (3 tests).

Run: `npx tsc --noEmit` → no errors (test-only type errors pass build+vitest but fail CI).

- [ ] **Step 8: Commit**

```bash
git add src/app/help-menu.tsx src/app/help-menu.test.tsx
git commit -m "refactor(help): floating panel uses HelpContentPane + smaller default"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint the whole change set**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/help-content-pane.tsx src/app/help-view.tsx src/app/help-menu.tsx --max-warnings=0`
Expected: clean.

- [ ] **Step 2: Run all help tests**

Run: `npx vitest run src/app/help-content-pane.test.tsx src/app/help-view.test.tsx src/app/help-menu.test.tsx`
Expected: all PASS.

- [ ] **Step 3: Eye-verify (Help is NOT in the axe gate)**

Start `npm run dev`. Verify in the browser:
1. Top-bar **[?]** → floating panel opens at ~760×620, grouped TOC (left) + scrollable grouped content (right); clicking a TOC item scrolls to its section; search filters; footer shows Take-tour + License, NO usage-policy link.
2. Drag the panel narrower than ~560px → TOC collapses to a horizontal strip above the content (no crushed two-column).
3. Sidebar **Help** view → same two-pane content inside the bordered pane; tours + relations map still above it; Related view links navigate; Print still works.
4. Check dark mode AND Mockup style (`data-style="mockup"`) for both surfaces — palette tokens only, readable contrast.

If the container-query stack (step 2) does not trigger, confirm Tailwind v4 container queries are active (no plugin needed in v4); as a fallback the panel still renders a usable (if tight) two-pane at small widths.

- [ ] **Step 4: Commit any eye-verify fixes**

```bash
git add -A
git commit -m "fix(help): layout polish from eye-verify"
```

(Skip if no fixes needed.)
