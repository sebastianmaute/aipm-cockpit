# Portfolio UX Polish — Design

**Status:** approved for implementation
**Scope:** three independent, root-caused UI bugs. No architecture, no new
concepts — each fix reuses a pattern that already exists elsewhere in the
codebase. Bundled because each is too small to warrant its own spec, not
because they are related to one another.

This is the first of three specs split out of a single larger feature
request (see conversation). The other two — a "Load from Turso" project
picker, and per-project Claude chat memory/action history (Turso-only) — are
each their own follow-up spec.

## Fix 1: "Save & switch portfolio" label when there is nothing to save

**CORRECTED after implementation review** — the original diagnosis below was
wrong and would have broken two pinned tests. Kept struck through for the
record; see "Corrected root cause" for what actually ships.

~~**File:** `src/app/project-empty-state.tsx`... **Fix:** pass
`hidePortfolioSwitch` on that `BackendConfigModal` call.~~ Wrong:
`hidePortfolioSwitch` is real, but its own doc comment (`backend-setup-wizard.tsx`)
says the OPPOSITE of what was assumed — *"Leave it unset on a pre-project
surface (nothing to abandon), so the switch is reachable to load a project
that already exists in a configured Turso database."* `project-empty-state.test.tsx`
pins exactly that: two existing tests (*"shows the portfolio-mode switch
inside the Configure-database modal (so an existing Turso project can be
loaded, not just a new one created)"* and the setup-wizard equivalent)
require the switch to stay **visible** at the empty state. Hiding it there
would break both and remove the only path the empty state has to reach an
existing Turso project.

**Corrected root cause:** the switch's own confirm button
(`portfolioModeSwitchConfirm`, "Save & switch portfolio") is unconditional —
`src/app/settings-sections/integrations-section.tsx` renders the same label
regardless of whether a current project exists to be the subject of "Save".
Per that file's own comment on `confirmPortfolioModeSwitch`, "Save" refers to
persisting the *pending mode selection* to `localStorage` (`portfolio-mode.ts`),
not to any project data — technically accurate, but reads as "save my
project" when there is no project, which is the confusion the original bug
report is about. The fix is a label swap, not hiding the control.

Three real call sites currently show this label with no current project in
scope (confirmed by grep — every other call site either hides the switch
entirely via `hidePortfolioSwitch`, when reached from a loaded project's
Settings, or renders `IntegrationsSection` directly from the loaded-project
Settings view itself):
- `src/app/project-empty-state.tsx` — `configOpen` → `BackendConfigModal` (~line 279-287)
- `src/app/project-empty-state.tsx` — `wizardOpen` → `BackendSetupWizard` (~line 301-309)
- `src/app/create-project-form.tsx` — `configOpen` → `BackendConfigModal` (~line 147-155)

**Fix:** add a `noCurrentProject?: boolean` prop, threaded through
`IntegrationsSection` → `BackendConfigModal` → `BackendSetupWizard` mirroring
`hidePortfolioSwitch`'s existing plumbing exactly (same three files already
carry that prop end-to-end). `IntegrationsSection` picks a different i18n key
for the confirm button when set:

```tsx
{t(lang, noCurrentProject ? "portfolioModeSwitchConfirmNoProject" : "portfolioModeSwitchConfirm")}
```

New i18n keys (both languages, next to the existing `portfolioModeSwitchConfirm`):
- en: `portfolioModeSwitchConfirmNoProject: "Switch portfolio"`
- de: `portfolioModeSwitchConfirmNoProject: "Portfolio wechseln"`

Set `noCurrentProject` (shorthand `true`) on the three call sites listed
above. Every other call site (loaded-project Settings, and the
`hidePortfolioSwitch`-gated wizard call in `settings-view.tsx`) is left
untouched — the switch either doesn't render there at all, or a real
project exists and the original label is correct.

**Test:** in `integrations-section.test.tsx`, render `IntegrationsSection`
with a Turso-configured settings fixture (existing `tursoSettings(authToken)`
helper), change the portfolio-mode `<select>` to `"turso"` to reveal the
confirm button, and assert the label text differs with vs. without
`noCurrentProject`. This is the precise unit for the new prop; the three
call-site wirings are mechanical and covered indirectly by keeping the two
existing pinned empty-state tests green (they only check the switch is
present, not its label, so they are unaffected either way).

## Fix 2: Export dropdown doesn't close on outside click

**File:** `src/app/projects-panel.tsx`.

**Root cause:** the per-project Export menu (`exportMenuId` state, ~line 139;
menu JSX ~line 276-308) is hand-rolled open/close state with no dismiss
wiring at all — no outside-click listener, no Escape handling. `ProjectSwitcher`
(`src/app/project-switcher.tsx`), which sits right next to this panel in the
UI and solves the identical "trigger + floating menu" shape, already uses
`usePopoverDismiss` for this. `projects-panel.tsx` just never adopted it.

**Fix:** add a `wrapperRef` around the trigger+menu container
(`<div className="relative">` at line 276) and call `usePopoverDismiss` once
at the component's top level (hooks cannot be called inside the `.map`
callback that renders each project row; since the Export button/menu only
renders for the current project — see the file's own header comment — there
is at most one live instance, so a single ref is correct).

```tsx
import { usePopoverDismiss } from "./use-popover-dismiss";

// inside ProjectsPanel, alongside the existing exportMenuId state:
const exportMenuRef = useRef<HTMLDivElement>(null);
usePopoverDismiss(exportMenuId !== null, exportMenuRef, () => setExportMenuId(null));
```

```tsx
<div className="relative" ref={exportMenuRef}>
  <Button
    variant="secondary"
    size="sm"
    onClick={() => setExportMenuId((cur) => (cur === p.id ? null : p.id))}
    aria-haspopup="menu"
    aria-expanded={exportMenuId === p.id}
  >
    {t(lang, "projectsExport")}
  </Button>
  {exportMenuId === p.id && (
    /* existing <ul role="menu"> ... unchanged */
  )}
</div>
```

Escape-to-close comes free from `usePopoverDismiss` (it registers a
dismissal-stack `layer`), matching every other popover in the app — no
separate keydown handler needed.

**Test:** render `ProjectsPanel` with a current project, open the Export
menu, fire a `mousedown` outside the menu, assert the menu (`role="menu"`)
is gone. A second test: open the menu, press Escape, assert it closes.

## Fix 3: WCAG not named in the README feature list

**File:** `README.md`, the "Accessibility & keyboard" row of the Features
table (currently line 95).

**Root cause:** the WCAG/axe-gate fact already exists in the document — the
"Built to be trusted" intro paragraph (line 44) says *"a WCAG accessibility
gate (axe across 16 views × 5 theme/scheme combinations)"* — but the
Features table's own "Accessibility & keyboard" row never repeats or links
to it, so a reader scanning only the feature list (the ask's own framing)
never sees WCAG named at all.

**Fix:** add one clause to the row's one-line summary naming the WCAG
conformance level actually enforced by the axe gate (per AGENTS.md's a11y
hard-constraint section, the gate runs axe-core with `wcag2a wcag2aa wcag21a
wcag21aa` tags — i.e. **WCAG 2.1 AA**). Per AGENTS.md's "a fact belongs in
ONE place, the second copy links" rule, the row states the level and links
back to the existing "Built to be trusted" detail rather than re-deriving
the 16-views/5-schemes count a second time.

```md
| Accessibility & keyboard | Keyboard-navigable throughout, targets WCAG 2.1 AA (see [Built to be trusted](#built-to-be-trusted)), with screen-reader-friendly navigation and documented shortcuts.<br><details>...unchanged...</details> |
```

Exact anchor text to confirm against the rendered heading slug at
implementation time (GitHub slugs "Built to be trusted" to
`#built-to-be-trusted`; verify no duplicate heading shifts it).

**Test:** none — README prose change. `README.md` IS one of the `ROOT_DOCS`
`docs:claims:check` scans (`scripts/doc-claims-lib.mjs:116-121`), but the
gate only ratchets `path:LINE` citations — this change adds a prose clause
and a heading anchor, no new `path:LINE` citation, so it does not trip it.

## Out of scope

- The "Load from Turso" project picker (new-project window + Projects view)
  and the per-project chat memory/action-history feature are separate specs,
  not touched here.
- No i18n changes — none of the three fixes add or change user-visible
  strings other than the one clause added to the README (not an i18n
  surface).
