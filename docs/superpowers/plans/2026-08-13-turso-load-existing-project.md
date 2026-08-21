# Load an Existing Turso Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user with an existing project already stored in a Turso database reach it from the pre-project empty state, instead of being limited to creating a brand-new empty project there.

**Architecture:** Reuse the existing "Portfolio storage mode" switch (`IntegrationsSection`, `confirmPortfolioModeSwitch`) — it already saves the mode, points `storageConfig.kind` at `"turso"`, and reloads, which is what triggers `listProjects(cfg)` and surfaces real Turso projects. The switch is unconditionally hidden (`hidePortfolioSwitch`) on the two pre-project entry points that need it (`ProjectEmptyState`'s "Configure database" modal, and `BackendSetupWizard`'s storage step, which hardcodes the hide for every caller including Settings). Make the hide caller-controlled and flip the two pre-project call sites to show it, while Settings' own guided-wizard call keeps it hidden (a real open project there would be abandoned, not migrated, by a blind switch). Add one hint string, shown only when Turso is configured, naming the load action explicitly.

**Tech Stack:** React/TSX, vitest + @testing-library/react, the existing i18n system (`i18n.ts`/`i18n.de.ts`, EN/DE key parity enforced by `tsc`).

---

### Task 1: Make `hidePortfolioSwitch` caller-controlled, unhide it on the empty-state entry points

**Files:**
- Modify: `src/app/backend-setup-wizard.tsx`
- Modify: `src/app/settings-view.tsx`
- Modify: `src/app/project-empty-state.tsx`
- Test: `src/app/backend-setup-wizard.test.tsx`
- Test: `src/app/settings-view.test.tsx`
- Test: `src/app/project-empty-state.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/app/backend-setup-wizard.test.tsx`, replace the existing `IntegrationsSection` mock (it currently ignores all props) with one that reports whether `hidePortfolioSwitch` was passed, then add two new tests. Replace:

```typescript
vi.mock("./settings-sections/integrations-section", () => ({
  IntegrationsSection: () => <div data-testid="integrations-section">Integrations</div>,
}));
```

with:

```typescript
vi.mock("./settings-sections/integrations-section", () => ({
  IntegrationsSection: ({ hidePortfolioSwitch }: { hidePortfolioSwitch?: boolean }) => (
    <div data-testid="integrations-section">
      Integrations
      <span data-testid="portfolio-switch-hidden">{String(!!hidePortfolioSwitch)}</span>
    </div>
  ),
}));
```

Then add these two tests inside the existing `describe("BackendSetupWizard", ...)` block, right after the `"shows step 1 (Storage) on open"` test:

```typescript
  it("shows the portfolio-mode switch by default (hidePortfolioSwitch not passed)", () => {
    setup();
    expect(screen.getByTestId("portfolio-switch-hidden")).toHaveTextContent("false");
  });

  it("hides the portfolio-mode switch when hidePortfolioSwitch is passed", () => {
    setup({ hidePortfolioSwitch: true });
    expect(screen.getByTestId("portfolio-switch-hidden")).toHaveTextContent("true");
  });
```

In `src/app/settings-view.test.tsx`, add this test inside `describe("SettingsView", ...)`:

```typescript
  it("Run setup wizard from Settings keeps the portfolio-mode switch hidden (an open project would be abandoned, not migrated, by a blind switch)", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionIntegrations") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "setupWizardRun") }));
    expect(
      screen.queryByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
    ).toBeNull();
  });
```

In `src/app/project-empty-state.test.tsx`, add these two tests inside `describe("ProjectEmptyState", ...)`, after the `"opens the guided setup wizard..."` test:

```typescript
  it("shows the portfolio-mode switch inside the Configure-database modal (so an existing Turso project can be loaded, not just a new one created)", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: /configure database \/ m365/i }),
    );
    expect(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
    ).toBeInTheDocument();
  });

  it("shows the portfolio-mode switch inside the guided setup wizard", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/backend-setup-wizard.test.tsx src/app/settings-view.test.tsx src/app/project-empty-state.test.tsx --reporter=dot`
Expected: FAIL — the two `backend-setup-wizard` tests fail because the mock always reported nothing before (add the mock change first, they'll fail on missing/wrong text); the `settings-view` test currently passes by accident (switch is already hidden by the old hardcoded literal) — that one is a **characterization test**, not a red one, so don't expect it to fail; the two `project-empty-state` tests FAIL because `hidePortfolioSwitch` is currently hardcoded `true` on that modal and the combobox is absent.

- [ ] **Step 3: Implement the caller-controlled prop**

In `src/app/backend-setup-wizard.tsx`, add the prop to the interface (right after `onMigrateToTurso?: () => void;` inside `BackendSetupWizardProps`, around line 98):

```typescript
  onMigrateToTurso?: () => void;
  /** Hide the "Portfolio storage mode" switch inside the Storage step. Set this
   *  when a real project is already open elsewhere in the app (Settings) — a
   *  blind mode switch does not migrate that project, it just points the app at
   *  a different (possibly empty) portfolio and reloads, abandoning the open
   *  one. Leave it unset on a pre-project surface (nothing to abandon), so the
   *  switch is reachable to load a project that already exists in a configured
   *  Turso database. */
  hidePortfolioSwitch?: boolean;
```

Add it to the destructured props (in the `BackendSetupWizard({ ... })` signature, alongside `onMigrateToTurso`):

```typescript
export function BackendSetupWizard({
  lang,
  open,
  settings,
  onChangeSettings,
  onClose,
  onMigrateToTurso,
  hidePortfolioSwitch,
}: BackendSetupWizardProps) {
```

Change the storage-step `IntegrationsSection` call from the hardcoded literal to forwarding the prop:

```typescript
          {currentStep.key === "storage" && (
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              onMigrateToTurso={onMigrateToTurso}
              hidePortfolioSwitch={hidePortfolioSwitch}
              hideJira
            />
          )}
```

In `src/app/settings-view.tsx`, add `hidePortfolioSwitch` to the `<BackendSetupWizard>` call (around line 492-501) so Settings keeps today's protected behavior:

```typescript
    {wizardOpen && (
      <BackendSetupWizard
        lang={lang}
        open
        settings={settings}
        onChangeSettings={onChange}
        onClose={() => setWizardOpen(false)}
        onMigrateToTurso={props.onMigrateToTurso}
        hidePortfolioSwitch
      />
    )}
```

In `src/app/project-empty-state.tsx`, drop `hidePortfolioSwitch` from the `<BackendConfigModal>` call (around line 279-288) — this is the "Configure database / M365" button's modal, which has no current project to abandon:

```typescript
      {configOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "emptyStateConfigDbM365")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setConfigOpen(false)}
        />
      )}
```

Leave the `<BackendSetupWizard>` call in this same file (around line 302-310, the "Run setup wizard" button's modal) untouched — it already passes no `hidePortfolioSwitch`, so once the prop defaults to "shown" (Step 3 above), that call site shows the switch with no edit needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/backend-setup-wizard.test.tsx src/app/settings-view.test.tsx src/app/project-empty-state.test.tsx --reporter=dot`
Expected: PASS — all tests in the three files green, including the pre-existing ones (the mock change in `backend-setup-wizard.test.tsx` must not break the other tests in that file, since it still renders the same `data-testid="integrations-section"` div they query).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (the new `hidePortfolioSwitch` prop is optional everywhere it's added, and every existing call site either passes it explicitly or is unaffected by the new optional field).

- [ ] **Step 6: Commit**

```bash
git add src/app/backend-setup-wizard.tsx src/app/settings-view.tsx src/app/project-empty-state.tsx src/app/backend-setup-wizard.test.tsx src/app/settings-view.test.tsx src/app/project-empty-state.test.tsx
git commit -m "fix: surface the portfolio-mode switch on the pre-project empty state

An existing Turso-stored project was unreachable after a local-storage
wipe: the only two entry points for entering Turso credentials before a
project exists (the empty state's Configure-database modal and its Run
setup wizard) both hid the one control that fetches the real project
list. Make BackendSetupWizard's hidePortfolioSwitch caller-controlled and
show it on both empty-state surfaces; Settings keeps it hidden since a
real open project would be abandoned, not migrated, by a blind switch."
```

---

### Task 2: Name the load action explicitly with a hint string

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this to `src/app/settings-sections/integrations-section.test.tsx`, in a new `describe` block:

```typescript
describe("IntegrationsSection portfolio-mode load hint", () => {
  it("shows a hint naming the load action when Turso is configured", () => {
    render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("test-token")} onChange={() => {}} />,
    );
    expect(
      screen.getByText(/already have a project stored in this database/i),
    ).toBeInTheDocument();
  });

  it("hides that hint when Turso is not configured", () => {
    render(<IntegrationsSection lang="en-US" settings={defaultSettings} onChange={() => {}} />);
    expect(
      screen.queryByText(/already have a project stored in this database/i),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx --reporter=dot`
Expected: FAIL — `getByText(/already have a project stored in this database/i)` finds nothing (the key and the JSX do not exist yet).

- [ ] **Step 3: Add the i18n keys**

In `src/app/i18n.ts`, add a new key right after `portfolioModeSwitchNote` (around line 3713):

```typescript
  portfolioModeSwitchNote: "This reloads the app to show the selected portfolio. Your current project stays in its own storage and is NOT moved — switch only after you've created or migrated the project where you want it.",
  portfolioModeTursoLoadHint: "Already have a project stored in this database? Switch to Turso above, then load it from the project list.",
```

In `src/app/i18n.de.ts`, the matching German key must go at the equivalent position (around line 3679, right after the German `portfolioModeSwitchNote`). Per this repo's own convention (`AGENTS.md`, i18n section): the Edit tool corrupts umlauts and curly quotes in this CRLF file even for umlaut-free strings, so patch it with a node script that writes real UTF-8 bytes and anchors on `\r\n`, not the Edit tool. Run:

```bash
node -e "
const fs = require('fs');
const path = 'src/app/i18n.de.ts';
let content = fs.readFileSync(path, 'utf8');
const anchor = 'portfolioModeSwitchNote: \"Dies lädt die App neu, um das ausgewählte Portfolio anzuzeigen. Ihr aktuelles Projekt bleibt in seinem eigenen Speicher und wird NICHT verschoben — wechseln Sie erst, wenn Sie das Projekt dort angelegt oder migriert haben.\",\r\n';
if (!content.includes(anchor)) { throw new Error('anchor not found'); }
const insert = '  portfolioModeTursoLoadHint: \"Bereits ein Projekt in dieser Datenbank gespeichert? Oben zu Turso wechseln und es dann aus der Projektliste laden.\",\r\n';
content = content.replace(anchor, anchor + insert);
fs.writeFileSync(path, content, 'utf8');
console.log('inserted');
"
```

Verify the insertion landed correctly and no byte corruption occurred:

```bash
grep -n "portfolioModeTursoLoadHint" src/app/i18n.de.ts
node -e "console.log(Buffer.from(require('fs').readFileSync('src/app/i18n.de.ts','utf8').match(/portfolioModeTursoLoadHint.*/)[0]).toString('utf8'))"
```

Expected: the printed line reads `portfolioModeTursoLoadHint: "Bereits ein Projekt in dieser Datenbank gespeichert? Oben zu Turso wechseln und es dann aus der Projektliste laden.",` with real `ä`/`ü` characters, no `\uXXXX` escapes, no corrupted quotes.

- [ ] **Step 4: Wire the hint into the JSX**

In `src/app/settings-sections/integrations-section.tsx`, add the conditional hint right after the existing `portfolioModeHelp` `FieldHint` (around line 645), before the `!tursoConfigured` banner:

```typescript
            <FieldHint className="mt-1">{t(lang, "portfolioModeHelp")}</FieldHint>
            {tursoConfigured && (
              <FieldHint className="mt-1">{t(lang, "portfolioModeTursoLoadHint")}</FieldHint>
            )}
            {!tursoConfigured && (
              <Banner severity="error" className="mt-1">{t(lang, "portfolioModeTursoNeedsConfig")}</Banner>
            )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx --reporter=dot`
Expected: PASS — both new tests green, along with the rest of the file's existing tests.

- [ ] **Step 6: Typecheck (enforces EN/DE key parity)**

Run: `npx tsc --noEmit`
Expected: no errors. If DE is missing the key or EN/DE drift, `tsc` fails on the `Lang`-keyed translation map — re-check Step 3.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx
git commit -m "feat: name the Turso load action explicitly in the portfolio-mode hint

The switch that surfaces an existing Turso-stored project (added in the
previous commit) is a generic File/Turso mode dropdown — nothing on it
says 'this is how you load your existing project'. Add a hint, shown
only once Turso is configured, that names the action directly."
```

---

### Final check

- [ ] Run the full unit suite once, not per-task, to catch any cross-file interaction the per-task runs above missed:

Run: `npx vitest run --reporter=dot > /tmp/turso-fix-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/turso-fix-suite.log`
Expected: `EXIT=0`, all test files passing.

- [ ] Run `npx tsc --noEmit` once more at the end (final i18n parity + type check across the whole tree).

- [ ] This branch (`fix/turso-load-existing-project`) does not touch `feat/attribute-boundary-140` or its pending Task 12 — no cross-branch action needed.
