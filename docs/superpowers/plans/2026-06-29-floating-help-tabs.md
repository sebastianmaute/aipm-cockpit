# Floating Help Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the floating top-bar Help panel into a tabbed surface — remove the intro slogan; put Help · Guided tours · How it connects · Information flows tabs in the header beside the search box; swap the body per tab; let the relations map + info-flows diagram fill the larger body.

**Architecture:** All work is in `help-menu.tsx` (new tab state + tablist + body switch, reusing the existing presentational components `HelpContentPane` / `TourCatalog` / `RelationsMap` / `InformationFlowsSection`). The tour catalog data (`catalogTours` / `completedTours` / `onStartTour`) is threaded `task-manager → ActionMenus → HelpMenu`, replacing the now-removed footer `onTakeTour` button. `InformationFlowsSection` gains an optional `maxWidth` to scale up in the roomier floating body. The in-pane Help view and its accordion are untouched.

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest + Testing Library. Lint is CI-fatal at `--max-warnings=0` (no unused props/imports; exhaustive-deps rejects `obj.member` deps; `react-hooks/set-state-in-effect` is banned). Floating Help is NOT in the axe gate — verify by eye + unit tests.

---

## Reference: current `help-menu.tsx` body (to be replaced)

Lines ~212–250 currently render, inside the panel `<div>`:
- `helpIntro` paragraph (the "slogan") — **remove**.
- a search `<input>` block — **moves into the tab header, Help-tab only**.
- `<HelpContentPane lang={lang} query={query} />` — **becomes the Help tab body**.
- a footer with an `onTakeTour` button + license link — **drop the tour button, keep the license link**.

The toggle button (lines 153–173), the draggable title bar (188–210), drag/pos/resize logic, and the `useResizable` size key (`lop-app:help-size-v3`) are **unchanged**.

---

## Task 1: InformationFlowsSection — optional `maxWidth`

**Files:**
- Modify: `src/app/settings-sections/information-flows-section.tsx:5-7,212-224`
- Test: `src/app/information-flows-section.test.tsx` (existing)

- [ ] **Step 1: Write the failing test**

Add to `src/app/information-flows-section.test.tsx`:

```tsx
it("uses the maxWidth prop on the diagram svg when provided", () => {
  const { container } = render(<InformationFlowsSection lang="en-US" maxWidth={640} />);
  const svg = container.querySelector("svg[role='img']") as SVGElement;
  expect(svg).not.toBeNull();
  expect(svg.style.maxWidth).toBe("640px");
});

it("defaults the diagram svg maxWidth to 480", () => {
  const { container } = render(<InformationFlowsSection lang="en-US" />);
  const svg = container.querySelector("svg[role='img']") as SVGElement;
  expect(svg.style.maxWidth).toBe("480px");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- information-flows-section`
Expected: FAIL — `maxWidth` not a valid prop / svg maxWidth is hardcoded 480 (the 640 assertion fails).

- [ ] **Step 3: Implement**

In `information-flows-section.tsx`, change the props interface and signature:

```tsx
interface InformationFlowsSectionProps {
  lang: Lang;
  /** Cap (px) for the diagram svg width. Default 480 keeps Settings + the
   *  in-pane Help accordion byte-identical; the floating Help tab passes a
   *  larger value to use the roomier panel body. */
  maxWidth?: number;
}
```

```tsx
export function InformationFlowsSection({ lang, maxWidth = 480 }: InformationFlowsSectionProps) {
```

And the `<svg>` style (currently `style={{ maxWidth: 480 }}`):

```tsx
        width="100%"
        style={{ maxWidth }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- information-flows-section`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/settings-sections/information-flows-section.tsx src/app/information-flows-section.test.tsx
git commit -m "feat(help): InformationFlowsSection accepts optional maxWidth"
```

---

## Task 2: HelpMenu — tabbed layout

**Files:**
- Modify: `src/app/help-menu.tsx` (imports at top; props in signature line 57; panel body lines ~212-250)
- Test: `src/app/help-menu.test.tsx`

This is the core change. Implement the whole tab scaffold in one task (the pieces — tablist, body switch, search gating, connects→Help scroll, footer — are interdependent and share the same JSX block).

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/app/help-menu.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpMenu } from "./help-menu";
import type { TourCatalogEntry } from "./app-tour";

const TOURS: TourCatalogEntry[] = [
  { id: "getting-started", titleKey: "helpGuidedToursTitle", descKey: "helpIntro", iconView: "dashboard", stepCount: 3 },
];

function openPanel() {
  // The toggle button's accessible name is the translated "help" key ("Help").
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
}

describe("HelpMenu floating panel", () => {
  it("renders without crashing when closed", () => {
    render(<HelpMenu lang="en-US" />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("shows 3 tabs and a search box on the Help tab when no tours are provided", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows a Guided tours tab when onStartTour is provided", () => {
    render(<HelpMenu lang="en-US" onStartTour={vi.fn()} catalogTours={TOURS} completedTours={[]} />);
    openPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("hides search and shows the relations map on the How-it-connects tab", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /how/i }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    // RelationsMap renders a labelled group.
    expect(screen.getByRole("group", { name: /relation/i })).toBeInTheDocument();
  });

  it("shows the information-flows diagram on the Information flows tab", () => {
    const { container } = render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /flow/i }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
  });

  it("returns to the Help tab with search visible", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /flow/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Help" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("starting a tour calls onStartTour and closes the panel", () => {
    const onStartTour = vi.fn();
    render(<HelpMenu lang="en-US" onStartTour={onStartTour} catalogTours={TOURS} completedTours={[]} />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /guided/i }));
    // TourCatalog cards expose an accessible name beginning with the Start CTA.
    fireEvent.click(screen.getByRole("button", { name: /start tour/i }));
    expect(onStartTour).toHaveBeenCalledWith("getting-started");
    // Panel closed → its tablist is gone.
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("clicking a concept in the relations map switches to the Help tab", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /how/i }));
    // RelationsMap concept buttons carry the "open concept" title.
    const nodes = screen.getAllByRole("button").filter((b) => b.getAttribute("title"));
    fireEvent.click(nodes[0]);
    // Back on the Help tab → search box is present again.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });
});
```

> If `npm run test:run` reports the Start-CTA name doesn't match `/start tour/i`, read the `tourStartCta` value in `src/app/i18n.ts` and adjust the regex. Likewise confirm `helpRelationsMapLabel` matches `/relation/i` and the connects/flows tab labels match `/how/i` and `/flow/i` (from `helpRelationsTitle` / `infoFlowsTitle`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- help-menu`
Expected: FAIL — no `tab` roles, `onStartTour`/`catalogTours`/`completedTours` not props, etc.

- [ ] **Step 3: Implement — update imports**

At the top of `src/app/help-menu.tsx`, replace the React import and add the new component/util imports:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { INTERACTIVE, FOCUS_RING } from "./interaction-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { RelationsMap } from "./relations-map";
import { TourCatalog } from "./tour-catalog";
import { InformationFlowsSection } from "./settings-sections/information-flows-section";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";
import type { TourCatalogEntry } from "./app-tour";
import { useResizable } from "./use-resizable";
import { APP_LICENSE_URL } from "./version";
```

(Keep the existing `STORAGE_KEY_POS` / `STORAGE_KEY_SIZE` / `VIEWPORT_PADDING` / `Pos` / `clampPos` / `loadPos` / `savePos` exactly as-is.)

- [ ] **Step 4: Implement — props + tab state**

Replace the signature (line 57):

```tsx
type HelpTab = "help" | "tours" | "connects" | "flows";

export function HelpMenu({
  lang,
  catalogTours,
  completedTours,
  onStartTour,
}: {
  lang: Lang;
  catalogTours?: readonly TourCatalogEntry[];
  completedTours?: readonly string[];
  onStartTour?: (id: string) => void;
}) {
```

Immediately after the existing `useState`/`useResizable`/`dragRef` declarations (after line ~67), add:

```tsx
  const [tab, setTab] = useState<HelpTab>("help");
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [scrollSeq, setScrollSeq] = useState(0);
  const graph = useMemo(() => buildRelationsGraph(HELP_ENTRIES), []);

  const tabs: { key: HelpTab; labelKey: TranslationKey }[] = [
    { key: "help", labelKey: "help" },
    ...(onStartTour ? ([{ key: "tours", labelKey: "helpGuidedToursTitle" }] as { key: HelpTab; labelKey: TranslationKey }[]) : []),
    { key: "connects", labelKey: "helpRelationsTitle" },
    { key: "flows", labelKey: "infoFlowsTitle" },
  ];
  // Drift guard: if the active key is no longer in the list (tours tab gated
  // away), fall back to the first tab.
  const activeTab: HelpTab = tabs.some((tb) => tb.key === tab) ? tab : "help";

  // Connects → Help deep scroll: only the active tab body is mounted, so a
  // concept click switches to the Help tab and bumps a nonce; an effect keyed
  // on the nonce scrolls once the Help content has committed. We never clear
  // `pendingScroll` (re-selecting the same concept bumps the nonce) so there is
  // no set-state-in-effect (banned).
  const selectConcept = (id: string) => {
    setTab("help");
    setPendingScroll(id);
    setScrollSeq((s) => s + 1);
  };
  useEffect(() => {
    if (!pendingScroll) return;
    document.getElementById(helpSectionId(pendingScroll))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollSeq, pendingScroll]);

  const startAndClose = (id: string) => {
    setOpen(false);
    onStartTour?.(id);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    setTab(tabs[(idx + dir + tabs.length) % tabs.length].key);
  };
```

- [ ] **Step 5: Implement — replace the panel body**

Replace everything from the `helpIntro` paragraph through the old footer (the block that today is the `<p>…helpIntro…</p>`, the search `<div>`, `<HelpContentPane …/>`, and the footer `<div>` with the tour button + license) with:

```tsx
          <div
            role="tablist"
            aria-label={t(lang, "navHelp")}
            className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line p-2"
          >
            {tabs.map((tb, idx) => {
              const isActive = tb.key === activeTab;
              return (
                <button
                  key={tb.key}
                  type="button"
                  role="tab"
                  id={`help-fp-tab-${tb.key}`}
                  aria-selected={isActive}
                  aria-controls="help-fp-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setTab(tb.key)}
                  onKeyDown={(e) => onTabKeyDown(e, idx)}
                  className={
                    isActive
                      ? `rounded-md bg-AIPM-dark-blue px-2.5 py-1 text-xs font-semibold text-white ${FOCUS_RING}`
                      : `rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`
                  }
                >
                  {t(lang, tb.labelKey)}
                </button>
              );
            })}
            {activeTab === "help" && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "helpSearchPlaceholder")}
                aria-label={t(lang, "helpSearchPlaceholder")}
                className={`ml-auto min-w-[8rem] flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground ${FOCUS_RING}`}
              />
            )}
          </div>

          <div
            id="help-fp-panel"
            role="tabpanel"
            aria-labelledby={`help-fp-tab-${activeTab}`}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {activeTab === "help" && <HelpContentPane lang={lang} query={query} />}
            {activeTab === "tours" && (
              <div className="min-h-0 flex-1 overflow-auto p-3 pr-2">
                <TourCatalog
                  lang={lang}
                  tours={catalogTours ?? []}
                  completedTours={completedTours ?? []}
                  onStartTour={startAndClose}
                />
              </div>
            )}
            {activeTab === "connects" && (
              <div className="min-h-0 flex-1 overflow-auto p-3 pr-2">
                <RelationsMap graph={graph} lang={lang} onSelectConcept={selectConcept} />
              </div>
            )}
            {activeTab === "flows" && (
              <div className="min-h-0 flex-1 overflow-auto p-3 pr-2">
                <InformationFlowsSection lang={lang} maxWidth={640} />
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-4 border-t border-line px-4 py-2">
            <a
              href={APP_LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
            >
              {t(lang, "versionLicense")} ↗
            </a>
          </div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- help-menu`
Expected: PASS (adjust the CTA/label regexes per the note in Step 1 if any name assertion misses).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `onTakeTour` is reported unused anywhere, it is handled in Task 3 — but `help-menu.tsx` itself must not reference `onTakeTour` any more.)

- [ ] **Step 8: Commit**

```bash
git add src/app/help-menu.tsx src/app/help-menu.test.tsx
git commit -m "feat(help): tabbed floating Help panel (tours/connects/flows)"
```

---

## Task 3: Thread tour props through ActionMenus; drop the dead `onTakeTour`

**Files:**
- Modify: `src/app/action-menus.tsx:20-39,50-60,72`
- Modify: `src/app/task-manager.tsx:2130-2140`
- Test: `src/app/action-menus.test.tsx` (verify still green)

`onTakeTour` in `ActionMenus`/`HelpMenu` was used ONLY by the (now-removed) floating footer button. The in-pane `HelpView` gets its own `onTakeTour` via `workspace-section` and is unaffected. Replace it with the tour-catalog props.

- [ ] **Step 1: Update `ActionMenusProps`**

In `action-menus.tsx`, add the import:

```tsx
import type { TourCatalogEntry } from "./app-tour";
```

Replace the `onTakeTour` prop in `ActionMenusProps` (lines ~36-38) with:

```tsx
  /** Themed tour catalog for the Help panel's Guided-tours tab. Passed only in
   *  the modern, non-popout shell (tours are modern-only); omitted elsewhere so
   *  the tab is hidden. */
  catalogTours?: readonly TourCatalogEntry[];
  completedTours?: readonly string[];
  onStartTour?: (id: string) => void;
```

- [ ] **Step 2: Update the destructure + the HelpMenu render**

In the `ActionMenus({ … })` destructure (lines ~50-60), replace `onTakeTour,` with:

```tsx
  catalogTours,
  completedTours,
  onStartTour,
```

Replace the HelpMenu render (line ~72):

```tsx
      <HelpMenu lang={lang} catalogTours={catalogTours} completedTours={completedTours} onStartTour={onStartTour} />
```

- [ ] **Step 3: Update the modern top bar in task-manager**

In `task-manager.tsx`, the `topBarMenus` `<ActionMenus …>` (lines ~2130-2140): remove the `onTakeTour={…}` line and add:

```tsx
        onStartTour={settings.layout === "modern" && !isPopout ? startTour : undefined}
        catalogTours={tour.catalogTours}
        completedTours={tour.completedTours}
```

Leave the classic `AppHeader` `<ActionMenus>` (in `app-header.tsx`, ~line 162) unchanged — it passes no tour props, so the classic floating Help shows 3 tabs (tours modern-only).

- [ ] **Step 4: Run the related tests**

Run: `npm run test:run -- action-menus help-menu`
Expected: PASS. (`action-menus.test.tsx` does not reference `onTakeTour`, so it stays green.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no warnings (confirms no dangling unused `onTakeTour`).

- [ ] **Step 6: Commit**

```bash
git add src/app/action-menus.tsx src/app/task-manager.tsx
git commit -m "feat(help): thread tour catalog to floating Help; drop dead onTakeTour"
```

---

## Task 4: Full verification + docs + release bookkeeping

**Files:**
- Modify: `AGENTS.md` (UI shell → Help view bullet)
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Full unit suite + typecheck + lint**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: all green, 0 warnings.

- [ ] **Step 2: Update AGENTS.md**

In the `• **Help view:**` bullet, update the floating-panel sentence. It currently says the floating panel is content-pane-only. Replace with: the floating Help panel is now a TABBED surface (Help · Guided tours · How it connects · Information flows) — tabs in the header beside the search box, search shown on the Help tab only, only the active tab body mounted, tours tab gated on `onStartTour` (modern-only, threaded `task-manager → ActionMenus → HelpMenu`), connects-concept click switches to the Help tab + scrolls (nonce pattern), no intro slogan, footer keeps only the license link. Note `InformationFlowsSection` takes an optional `maxWidth` (default 480; floating tab passes 640).

- [ ] **Step 3: Release bookkeeping**

Pick the next version + an unused sci-fi/fantasy author codename (verify against `CHANGELOG.md` it's unused; current head is 0.148.0 "Kuang" → use 0.149.0). Then:
- `src/app/version.ts`: bump `APP_VERSION`, `APP_BUILD_DATE` (with a one-line comment), `APP_MILESTONE`; append `"versionHighlightFloatingHelpTabs"` to `APP_HIGHLIGHT_KEYS`.
- `package.json`: bump `"version"`.
- `CHANGELOG.md`: add a new dated section for the release.
- `src/app/i18n.ts`: add `versionHighlightFloatingHelpTabs: "Tabbed floating Help — tours, relations, and information flows"` (or similar).
- `src/app/i18n.de.ts`: add the DE counterpart via a node utf8 write (real umlauts; the Edit tool corrupts this CRLF file — match `\r\n`, never raw-`setItem`). Verify with grep.

- [ ] **Step 4: i18n parity + final typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (enforces EN/DE key parity).

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md src/app/version.ts package.json CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "docs(help): document tabbed floating Help; release bookkeeping"
```

---

## Self-Review

**Spec coverage:**
- Remove slogan → Task 2 Step 5 (helpIntro paragraph dropped). ✓
- Tabs beside search → Task 2 Steps 4–5 (tablist + search in Help tab). ✓
- Click tab changes view → Task 2 Step 5 (body switch). ✓
- Adapt visualization → Task 1 (`maxWidth`) + Task 2 (`flex-1 overflow-auto` body wrappers). ✓
- Full tour catalog → Task 2 (`TourCatalog`) + Task 3 (prop threading). ✓
- Search Help-tab-only → Task 2 Step 5 (`activeTab === "help"` gate). ✓
- Connects → Help scroll → Task 2 Step 4 (`selectConcept` + nonce effect). ✓
- Tours gated on `onStartTour`, modern-only → Task 2 (tab list) + Task 3 Step 3 (gating). ✓
- Footer tour button removed → Task 2 Step 5. ✓
- In-pane view untouched → no task modifies `help-view.tsx`/`help-collapsible-region.tsx`. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `HelpTab` union, `TourCatalogEntry` (id/titleKey/descKey/iconView/stepCount), `TranslationKey`, `catalogTours?`/`completedTours?`/`onStartTour?` signatures, and `maxWidth?: number` are consistent across Tasks 1–3. `helpSectionId` reused from `help-content-pane`. Tour fixture in the test matches the real `TourCatalogEntry` shape.
