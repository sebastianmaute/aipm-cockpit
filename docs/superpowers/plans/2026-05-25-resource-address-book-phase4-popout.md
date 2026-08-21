# Resource Address Book — Phase 4 (Address-book Pop-out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A dedicated **address-book pop-out** window (`?popout=address-book`) that renders the Directory table and supports add/edit, plus an **"Open address book"** button in the Directory header that opens it. Edits in the pop-out broadcast `resources` to the main window (the sole persister), reusing the existing popout + BroadcastChannel infrastructure.

**Architecture:** Mirror the existing `resource-report` popout-only tab. Add `address-book` to `POPOUT_TABS` and `TopTab`; `workspace-section.tsx` renders `<ResourceDirectory/>` for that tab; the Directory header gains an optional "Open address book" button wired (via the pane) to `openPopoutWindow("address-book", reuseWindow)`. No new persistence — `resources` already syncs via `useBroadcastSync`, and the popout never saves (single-writer rule from the earlier fix).

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-24-resource-address-book-design.md`](../specs/2026-05-24-resource-address-book-design.md) — Phase 4 of 5.

---

### Task 1: Address-book pop-out tab + Directory "Open address book" button

**Files:**
- Modify: `src/app/broadcast-sync.ts`, `src/app/workspace-tab-context.tsx`, `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/resources-panel.tsx`, `src/app/resource-directory.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/resource-directory.test.tsx`

- [ ] **Step 1: Register the tab.**
  - `src/app/broadcast-sync.ts`: add `"address-book"` to the `POPOUT_TABS` array (alongside `"resource-report"`).
  - `src/app/workspace-tab-context.tsx`: add `"address-book"` to the `TopTab` union.
  - `src/app/task-manager.tsx`: add `"address-book": "resourcesAddressBookTitle",` to `TAB_LABEL_KEYS` (Record<TopTab, TranslationKey>).

- [ ] **Step 2: i18n keys.** Add to `i18n.ts` (en-US + en-GB if separate) and `i18n.de.ts`:
```
resourcesAddressBookTitle: "Address Book"     // de: "Adressbuch"
resourcesOpenAddressBook: "Open address book" // de: "Adressbuch öffnen"
```

- [ ] **Step 3: Directory "Open address book" button.** In `src/app/resource-directory.tsx`:
  - Add optional prop `onOpenAddressBook?: () => void;` to `Props`.
  - In the header row (next to the existing **+ Add resource** button), render — only when `onOpenAddressBook` is provided — a secondary button:
```tsx
{onOpenAddressBook && (
  <button
    type="button"
    onClick={onOpenAddressBook}
    className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
  >
    {t(lang, "resourcesOpenAddressBook")}
  </button>
)}
```
  (Match the existing secondary-button styling used elsewhere in the pane, e.g. the "Manage roles" button.)

- [ ] **Step 4: Thread the prop through the pane.** In `src/app/resources-panel.tsx`: add `onOpenAddressBook?: () => void;` to the panel `Props`, destructure it, and pass `onOpenAddressBook={onOpenAddressBook}` to `<ResourceDirectory/>`.

- [ ] **Step 5: Wire workspace-section.** In `src/app/workspace-section.tsx`:
  - Add a direct import: `import { ResourceDirectory } from "./resource-directory";`.
  - In the main Resources tab's `<ResourcesPanel … />`, add `onOpenAddressBook={() => openPopoutWindow("address-book", settings.popout.reuseWindow)}`.
  - Add a new popout-only render block AFTER the `resource-report` block, mirroring its shape:
```tsx
{activeTab === "address-book" && (
  <div id="panel-address-book" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
    <ResourceDirectory
      lang={lang}
      resources={resources}
      roles={roles}
      disciplines={disciplines}
      grades={grades}
      onAssignRole={onAssignRole}
      onEditResource={onEditResource}
      onAddResource={onAddResource}
    />
  </div>
)}
```
  (No `onOpenAddressBook` here — the button is hidden inside the pop-out itself. Editing works because `AppModals` renders `ResourceEditModal` ungated by `isPopout`, and `resources` changes broadcast to the main writer.)

- [ ] **Step 6: Test.** In `src/app/resource-directory.test.tsx` add:
```tsx
it("renders Open address book button only when the handler is provided", () => {
  const onOpen = vi.fn();
  const { rerender } = render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /open address book/i })).toBeNull();
  rerender(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onOpenAddressBook={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: /open address book/i }));
  expect(onOpen).toHaveBeenCalled();
});
```
(`rs`, `render`, `screen`, `fireEvent`, `vi` already imported in that file.)

- [ ] **Step 7: Verify.** `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable).

- [ ] **Step 8: Commit.**
```bash
git add src/app/broadcast-sync.ts src/app/workspace-tab-context.tsx src/app/task-manager.tsx src/app/workspace-section.tsx src/app/resources-panel.tsx src/app/resource-directory.tsx src/app/resource-directory.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): address-book pop-out window + Open address book button"
```

---

## Self-Review

**Spec coverage (Phase 4):** `?popout=address-book` renders the Directory (Step 5) ✓; "Open address book" button opens it (Steps 3–5) ✓; edits in popout broadcast to the main writer (reuses existing `useBroadcastSync("resources")` + `AppModals` ungated modal — no new code needed) ✓; reuses popout infra (`POPOUT_TABS`/`openPopoutWindow`) ✓.

**Placeholder scan:** all code shown.

**Type consistency:** `TopTab` (workspace-tab-context) and `POPOUT_TABS` (broadcast-sync) both gain `"address-book"`; `TAB_LABEL_KEYS` Record stays exhaustive; `onOpenAddressBook?: () => void` optional so the popout's direct `<ResourceDirectory/>` render (without it) and existing tests stay valid.

**Out of scope:** birthday banner/toast/settings (Phase 5).
