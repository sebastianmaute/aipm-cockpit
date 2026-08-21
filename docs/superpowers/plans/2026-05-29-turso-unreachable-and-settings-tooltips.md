# Turso Unreachable Message + turso.tech Link + Settings Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Turso network failures show a clear "storage unreachable" message (error toast, no switch, no data loss), add a turso.tech link to the Turso config section, and add styled mouseover tooltips to every Settings field.

**Architecture:** Part 1 maps `fetch` rejections in `turso-backend.ts` to a `StorageNotReadyError("storage-unreachable")` hint that both `use-storage-backend.ts` consumers translate to a new `storageUnreachable` toast. Parts 2–3 are UI + i18n: a turso.tech link and a new reusable `InfoTooltip` component wired across the Settings menu, Storage config, and Jira settings.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest. Client-only app.

**Conventions:**
- TDD: failing test first, then minimal code.
- i18n: add EN keys to `src/app/i18n.ts`, DE keys to `src/app/i18n.de.ts`. **i18n.de.ts gotcha:** the Edit tool can corrupt ASCII `"` string delimiters into curly quotes — after editing `i18n.de.ts`, grep each new line and confirm it starts and ends with ASCII `"` (U+0022). Em-dashes/special characters *inside* the string values are content and are fine.
- Windows/PowerShell. No `rm -rf`. Do not edit `eslint.config.mjs`.
- Each task ends green: `npx vitest run` full suite, `npx tsc --noEmit` → 0, `npm run lint` → 0 errors (pre-existing warnings OK).

---

## Task 1: Turso "unreachable" error mapping

**Files:**
- Modify: `src/app/turso-backend.ts` (`runPipeline`, ~lines 55–90)
- Modify: `src/app/use-storage-backend.ts` (load effect catch ~134–146; `onRequestStorageSwitch` catch ~289–300)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/turso-backend.test.ts`, `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Add the i18n key to both dictionaries**

In `src/app/i18n.ts` (near the other `storage*` keys):
```ts
storageUnreachable: "Storage unreachable — is the server running?",
```
In `src/app/i18n.de.ts` (same location):
```ts
storageUnreachable: "Speicher nicht erreichbar — läuft der Server?",
```
Then grep both new lines; confirm ASCII `"` delimiters in `i18n.de.ts`.

- [ ] **Step 2: Write the failing backend test**

In `src/app/turso-backend.test.ts`, match the existing harness (how it constructs `new TursoBackend(config)` and mocks `fetch` — inspect the file first). Add:
```ts
it("maps a fetch network rejection to StorageNotReadyError('storage-unreachable')", async () => {
  const backend = new TursoBackend({ httpUrl: "http://127.0.0.1:8080", authToken: "" });
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(backend.save(emptyWorkspace())).rejects.toMatchObject({ hint: "storage-unreachable" });
});
```
Import `emptyWorkspace` from `./storage` (and `StorageNotReadyError` if the harness asserts `instanceof`). If the harness already mocks `fetch` globally, reuse its mechanism instead of `vi.spyOn`.

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run src/app/turso-backend.test.ts`
Expected: FAIL — currently the rejection propagates as a raw `TypeError`, not a `StorageNotReadyError` with that hint.

- [ ] **Step 4: Wrap the fetch in `runPipeline`**

In `src/app/turso-backend.ts`, replace the single `const res = await fetch(...)` call with a guarded version. Current:
```ts
    const res = await fetch(`${this.config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: stmts.map(execute) }),
    });
```
New:
```ts
    let res: Response;
    try {
      res = await fetch(`${this.config.httpUrl}/v2/pipeline`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: stmts.map(execute) }),
      });
    } catch {
      // Network-level failure: server down, connection refused, DNS failure, or
      // an unreachable/non-existent host. Surface a clear "unreachable" hint.
      throw new StorageNotReadyError("storage-unreachable");
    }
```
Leave the existing `res.status === 401`, `!res.ok`, bad-shape, and per-result error checks unchanged.

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run src/app/turso-backend.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing hook test**

In `src/app/use-storage-backend.test.tsx`, in the `onRequestStorageSwitch` describe block, add (adapt names to the harness — `createBackendMock`, `showToast`, `setStorageConfig` spy, `result`, etc.):
```ts
it("onRequestStorageSwitch: unreachable Turso → storageUnreachable toast, no switch", async () => {
  const { StorageNotReadyError } = await import("./storage");
  createBackendMock.mockReturnValue({
    kind: "turso",
    load: vi.fn(),
    save: vi.fn().mockRejectedValue(new StorageNotReadyError("storage-unreachable")),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await result.current.onRequestStorageSwitch("turso");
  expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("unreachable"));
  expect(setStorageConfig).not.toHaveBeenCalled();
});
```
(The EN string contains "unreachable"; if the harness renders DE, assert with the DE substring or `expect.any(String)` plus the no-switch assertion.)

- [ ] **Step 7: Run it — expect FAIL**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: FAIL — the catch currently maps any non-permission `StorageNotReadyError` to `storageNotReady`, so the toast text won't contain "unreachable".

- [ ] **Step 8: Map the hint in both consumers**

In `src/app/use-storage-backend.ts`, `onRequestStorageSwitch` catch block, replace:
```ts
      if (err instanceof StorageNotReadyError) {
        const hint = (err as StorageNotReadyError).hint;
        const key = hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" : "storageNotReady";
        args.showToast("error", t(langRef.current, key));
      } else {
```
with:
```ts
      if (err instanceof StorageNotReadyError) {
        const hint = (err as StorageNotReadyError).hint;
        const key =
          hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : hint === "storage-unreachable"
              ? "storageUnreachable"
              : "storageNotReady";
        args.showToast("error", t(langRef.current, key));
      } else {
```
In the same file, the **load effect** catch block, replace:
```ts
            const key = (err as StorageNotReadyError).hint === "local-file-permission-needed"
              ? "storagePermissionGestureNeeded"
              : "storageNotReady";
            args.showToast("error", t(langRef.current, key));
```
with:
```ts
            const hint = (err as StorageNotReadyError).hint;
            const key =
              hint === "local-file-permission-needed"
                ? "storagePermissionGestureNeeded"
                : hint === "storage-unreachable"
                  ? "storageUnreachable"
                  : "storageNotReady";
            args.showToast("error", t(langRef.current, key));
```

- [ ] **Step 9: Run tests — expect PASS**

Run: `npx vitest run src/app/use-storage-backend.test.tsx src/app/turso-backend.test.ts`
Expected: PASS.

- [ ] **Step 10: Gates + commit**

Run: `npx vitest run` (green), `npx tsc --noEmit` (0), `npm run lint` (0 errors).
```bash
git add src/app/turso-backend.ts src/app/use-storage-backend.ts src/app/turso-backend.test.ts src/app/use-storage-backend.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(storage): clear 'storage unreachable' message on Turso network failure"
```

---

## Task 2: turso.tech link in the Turso config section

**Files:**
- Modify: `src/app/settings-menu.tsx` (Turso block, after the `integrationsTursoHint` paragraph ~line 723–725)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Add the i18n key to both dictionaries**

`src/app/i18n.ts`:
```ts
integrationsTursoLearnMore: "Learn more about Turso ↗",
```
`src/app/i18n.de.ts`:
```ts
integrationsTursoLearnMore: "Mehr über Turso erfahren ↗",
```
Grep both; confirm ASCII `"` delimiters in `i18n.de.ts`.

- [ ] **Step 2: Write the failing test**

In `src/app/settings-menu.test.tsx` (match its render harness / `makeProps`), add:
```ts
it("renders a turso.tech link in the Turso integrations section", () => {
  render(<SettingsMenu {...makeProps({ /* open menu + turso visible per harness */ })} />);
  const link = screen.getByRole("link", { name: /turso/i });
  expect(link).toHaveAttribute("href", "https://turso.tech/");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel") ?? "").toContain("noopener");
});
```
Inspect the test file first: the Settings menu likely needs an "open" interaction and the Turso section may be gated behind the integrations being visible. Reuse whatever existing tests do to reach the integrations block. If multiple links match `/turso/i`, scope the query (e.g. by the exact `integrationsTursoLearnMore` text).

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run src/app/settings-menu.test.tsx`
Expected: FAIL — no such link yet.

- [ ] **Step 4: Add the link**

In `src/app/settings-menu.tsx`, immediately after the existing hint paragraph:
```tsx
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "integrationsTursoHint")}
            </p>
```
add:
```tsx
            <p className="mt-1 text-xs">
              <a
                href="https://turso.tech/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-AIPM-dark-blue underline hover:opacity-80"
              >
                {t(lang, "integrationsTursoLearnMore")}
              </a>
            </p>
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run src/app/settings-menu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gates + commit**

Run: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`.
```bash
git add src/app/settings-menu.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-menu.test.tsx
git commit -m "feat(settings): add turso.tech link to Turso config section"
```

---

## Task 3: InfoTooltip component

**Files:**
- Create: `src/app/info-tooltip.tsx`
- Test: `src/app/info-tooltip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/info-tooltip.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InfoTooltip } from "./info-tooltip";

describe("InfoTooltip", () => {
  it("renders an accessible trigger with the tooltip text", () => {
    render(<InfoTooltip text="Where your workspace is saved." />);
    const trigger = screen.getByRole("button", { name: "Where your workspace is saved." });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Where your workspace is saved.");
  });

  it("uses an explicit label when provided", () => {
    render(<InfoTooltip text="Long help text." label="Help: storage" />);
    expect(screen.getByRole("button", { name: "Help: storage" })).toBeInTheDocument();
  });

  it("renders nothing when text is empty", () => {
    const { container } = render(<InfoTooltip text="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run src/app/info-tooltip.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/app/info-tooltip.tsx`:
```tsx
"use client";

interface InfoTooltipProps {
  /** Already-translated tooltip text. Empty → renders nothing. */
  text: string;
  /** Accessible label for the trigger; defaults to `text`. */
  label?: string;
}

export function InfoTooltip({ text, label }: InfoTooltipProps) {
  if (!text) return null;
  return (
    <span className="group relative inline-flex items-center align-middle">
      <button
        type="button"
        aria-label={label ?? text}
        title={text}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal text-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
```
(The `role="tooltip"` element is always in the DOM but visually hidden via `opacity-0`; it becomes visible on hover/focus. This keeps the test simple and the tooltip accessible.)

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/app/info-tooltip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gates + commit**

Run: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`.
```bash
git add src/app/info-tooltip.tsx src/app/info-tooltip.test.tsx
git commit -m "feat(settings): add reusable InfoTooltip component"
```

---

## Task 4a: Wire tooltips across the Settings menu + Storage config

**Files:**
- Modify: `src/app/settings-menu.tsx` (import `InfoTooltip`; add to each labeled field)
- Modify: `src/app/storage-config.tsx` (storage format label)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Add all tooltip i18n keys (EN)** in `src/app/i18n.ts`:
```ts
themeTooltip: "Choose light, dark, or follow your system setting.",
languageTooltip: "Display language for the app interface.",
holidayCountriesTooltip: "Public holidays from these countries are marked as non-working days.",
notificationsTooltip: "Configure reminders, due-date alerts, and how you are notified.",
reminderLeadDaysTooltip: "How many days before a due date a reminder appears.",
notifBirthdayTooltip: "Show a notification on team members' birthdays.",
popoutReuseWindowTooltip: "Reuse a single pop-out window instead of opening a new one each time.",
resourcesWorkdayHoursTooltip: "Hours in a standard working day, used for workload and capacity calculations.",
aiAssistantTooltip: "Connect an Anthropic API key to enable the in-app AI assistant.",
aiApiKeyTooltip: "Your Anthropic API key. Stored locally in this browser only.",
aiModelTooltip: "Which Claude model the assistant uses.",
integrationsTooltip: "Connect external services like Microsoft 365 and Turso.",
integrationsM365Tooltip: "Sign in with Microsoft 365 to use SharePoint storage and Outlook import.",
integrationsM365ClientIdTooltip: "The Application (client) ID of your Azure app registration.",
integrationsM365TenantIdTooltip: "Your Azure directory (tenant) ID, or 'common' for multi-tenant.",
integrationsSharepointTooltip: "Store your workspace in a SharePoint document library.",
integrationsOutlookContactsTooltip: "Import contacts from Outlook into your resource directory.",
integrationsOutlookCalendarTooltip: "Import calendar time-away into your absences.",
integrationsTursoTooltip: "Store your workspace in a Turso (libSQL) database.",
integrationsTursoUrlTooltip: "Your Turso database URL (libsql://, https://, or http:// for a local server).",
integrationsTursoTokenTooltip: "Auth token for the Turso database. Leave empty for a local token-less server.",
storageTooltip: "Where your workspace is saved. Switching converts your current data and writes it to the new backend.",
```

- [ ] **Step 2: Add all tooltip i18n keys (DE)** in `src/app/i18n.de.ts`:
```ts
themeTooltip: "Hell, dunkel oder Systemeinstellung wählen.",
languageTooltip: "Anzeigesprache der App-Oberfläche.",
holidayCountriesTooltip: "Feiertage dieser Länder werden als arbeitsfreie Tage markiert.",
notificationsTooltip: "Erinnerungen, Fälligkeitswarnungen und Benachrichtigungsart konfigurieren.",
reminderLeadDaysTooltip: "Wie viele Tage vor dem Fälligkeitsdatum eine Erinnerung erscheint.",
notifBirthdayTooltip: "Benachrichtigung an Geburtstagen von Teammitgliedern anzeigen.",
popoutReuseWindowTooltip: "Ein einzelnes Pop-out-Fenster wiederverwenden, statt jedes Mal ein neues zu öffnen.",
resourcesWorkdayHoursTooltip: "Stunden eines Standardarbeitstags, für Auslastungs- und Kapazitätsberechnungen.",
aiAssistantTooltip: "Anthropic-API-Schlüssel verbinden, um den KI-Assistenten zu aktivieren.",
aiApiKeyTooltip: "Ihr Anthropic-API-Schlüssel. Wird nur lokal in diesem Browser gespeichert.",
aiModelTooltip: "Welches Claude-Modell der Assistent verwendet.",
integrationsTooltip: "Externe Dienste wie Microsoft 365 und Turso verbinden.",
integrationsM365Tooltip: "Mit Microsoft 365 anmelden, um SharePoint-Speicher und Outlook-Import zu nutzen.",
integrationsM365ClientIdTooltip: "Die Anwendungs-(Client-)ID Ihrer Azure-App-Registrierung.",
integrationsM365TenantIdTooltip: "Ihre Azure-Verzeichnis-(Mandanten-)ID oder 'common' für mehrere Mandanten.",
integrationsSharepointTooltip: "Workspace in einer SharePoint-Dokumentbibliothek speichern.",
integrationsOutlookContactsTooltip: "Kontakte aus Outlook in das Ressourcenverzeichnis importieren.",
integrationsOutlookCalendarTooltip: "Kalender-Abwesenheiten in Ihre Abwesenheiten importieren.",
integrationsTursoTooltip: "Workspace in einer Turso-(libSQL-)Datenbank speichern.",
integrationsTursoUrlTooltip: "Ihre Turso-Datenbank-URL (libsql://, https:// oder http:// für einen lokalen Server).",
integrationsTursoTokenTooltip: "Auth-Token für die Turso-Datenbank. Für einen lokalen Server ohne Token leer lassen.",
storageTooltip: "Wo Ihr Workspace gespeichert wird. Beim Wechsel werden Ihre aktuellen Daten konvertiert und in den neuen Speicher geschrieben.",
```
After saving, grep these new lines in `i18n.de.ts` and confirm each starts/ends with ASCII `"` (U+0022). Special characters inside (ä, ö, ü, ß, /) are content and fine.

- [ ] **Step 3: Write the failing smoke test**

In `src/app/settings-menu.test.tsx` add (a light-touch presence check, not per-key):
```ts
it("renders InfoTooltip help affordances in the Settings menu", () => {
  render(<SettingsMenu {...makeProps({ /* open per harness */ })} />);
  // tooltips render as accessible buttons whose name is the tooltip text
  expect(screen.getByRole("button", { name: /display language/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /where your workspace is saved/i })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it — expect FAIL**

Run: `npx vitest run src/app/settings-menu.test.tsx`
Expected: FAIL — no tooltip buttons yet.

- [ ] **Step 5: Import InfoTooltip and wire each field**

In `src/app/settings-menu.tsx` add `import { InfoTooltip } from "./info-tooltip";`. For each field below, place `<InfoTooltip text={t(lang, "<key>Tooltip")} />` immediately after the label text, wrapping the label container in a flex row if it is not already. Two label shapes occur:

**Shape A — block span label** (e.g. theme, line ~302):
```tsx
<span className="mb-1 block text-sm font-medium text-foreground">{t(lang, "theme")}</span>
```
becomes:
```tsx
<span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
  {t(lang, "theme")}
  <InfoTooltip text={t(lang, "themeTooltip")} />
</span>
```

**Shape B — checkbox/inline label** (e.g. Turso enable, line ~721):
```tsx
<span>{t(lang, "integrationsTurso")}</span>
```
becomes:
```tsx
<span className="inline-flex items-center gap-1">
  {t(lang, "integrationsTurso")}
  <InfoTooltip text={t(lang, "integrationsTursoTooltip")} />
</span>
```

Apply to every field (label key → tooltip key), at the listed approximate lines:
| Field label key | Tooltip key | ~line | Shape |
|---|---|---|---|
| `theme` | `themeTooltip` | 303 | A |
| `language` | `languageTooltip` | 321 | A |
| `holidayCountries` | `holidayCountriesTooltip` | 338 | A |
| `notifications` | `notificationsTooltip` | 406 | A |
| `reminderLeadDays` | `reminderLeadDaysTooltip` | 412 | B (inline label text) |
| `notifBirthday` | `notifBirthdayTooltip` | 455 | B |
| `popoutReuseWindow` | `popoutReuseWindowTooltip` | 476 | B |
| `resourcesWorkdayHours` | `resourcesWorkdayHoursTooltip` | 486 | A (span in justify-between label) |
| `aiAssistant` | `aiAssistantTooltip` | 504 | A |
| `aiApiKey` | `aiApiKeyTooltip` | 508 | A |
| `aiModel` | `aiModelTooltip` | 526 | A |
| `integrations` | `integrationsTooltip` | 605 | A (h3 — wrap text + tooltip in a flex span inside the h3) |
| `integrationsM365` | `integrationsM365Tooltip` | 615 | B |
| `integrationsM365ClientId` | `integrationsM365ClientIdTooltip` | 626 | A |
| `integrationsM365TenantId` | `integrationsM365TenantIdTooltip` | 640 | A |
| `integrationsSharepoint` | `integrationsSharepointTooltip` | 707 | B (inside the `.map`) |
| `integrationsOutlookContacts` | `integrationsOutlookContactsTooltip` | 707 | B (same map) |
| `integrationsOutlookCalendar` | `integrationsOutlookCalendarTooltip` | 707 | B (same map) |
| `integrationsTurso` | `integrationsTursoTooltip` | 721 | B |
| `integrationsTursoUrl` | `integrationsTursoUrlTooltip` | 731 | A |
| `integrationsTursoToken` | `integrationsTursoTokenTooltip` | 743 | A |

Note for the `.map` at line ~684–709: the array entries are `[labelKey, key, comingSoon]`; the label key string equals the i18n label key, so `t(lang, `${labelKey}Tooltip`)` resolves to the matching tooltip key. Add the `InfoTooltip` after `<span>{t(lang, labelKey)}</span>`.

- [ ] **Step 6: Wire the Storage format label in storage-config.tsx**

In `src/app/storage-config.tsx`, the storage label (~line 130):
```tsx
<span className="mb-1 block text-sm font-medium text-foreground">
  {t(lang, "storage")}
</span>
```
becomes:
```tsx
<span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
  {t(lang, "storage")}
  <InfoTooltip text={t(lang, "storageTooltip")} />
</span>
```
Add `import { InfoTooltip } from "./info-tooltip";` at the top.

- [ ] **Step 7: Run the smoke test — expect PASS**

Run: `npx vitest run src/app/settings-menu.test.tsx src/app/storage-config.test.tsx`
Expected: PASS. If any existing settings-menu/storage-config test queries by a label that is now inside a flex span, it should still match (text content unchanged). Fix any selector that broke due to added buttons (e.g. an over-broad `getByRole("button")` count) by scoping it.

- [ ] **Step 8: Gates + commit**

Run: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Re-grep the new `i18n.de.ts` lines for ASCII delimiters.
```bash
git add src/app/settings-menu.tsx src/app/storage-config.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-menu.test.tsx
git commit -m "feat(settings): wire InfoTooltip across Settings menu and Storage config"
```

---

## Task 4b: Wire tooltips across Jira settings

**Files:**
- Modify: `src/app/jira-settings.tsx` (import `InfoTooltip`; add to each labeled field)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: existing `src/app/jira-settings` test if present, else extend `settings-menu.test.tsx`

- [ ] **Step 1: Add Jira tooltip i18n keys (EN)** in `src/app/i18n.ts`:
```ts
jiraEnableTooltip: "Connect a Jira project to sync tasks.",
jiraSiteUrlTooltip: "Your Jira site URL, e.g. https://your-company.atlassian.net.",
jiraEmailTooltip: "The email address of your Atlassian account.",
jiraApiTokenTooltip: "An Atlassian API token. Stored locally in this browser only.",
jiraProjectTooltip: "Which Jira project to sync with.",
jiraIssueTypesTooltip: "Which Jira issue types to import as tasks.",
jiraAssigneeTooltip: "Default assignee mapping for synced issues.",
```

- [ ] **Step 2: Add Jira tooltip i18n keys (DE)** in `src/app/i18n.de.ts`:
```ts
jiraEnableTooltip: "Jira-Projekt verbinden, um Aufgaben zu synchronisieren.",
jiraSiteUrlTooltip: "Ihre Jira-Site-URL, z. B. https://ihre-firma.atlassian.net.",
jiraEmailTooltip: "Die E-Mail-Adresse Ihres Atlassian-Kontos.",
jiraApiTokenTooltip: "Ein Atlassian-API-Token. Wird nur lokal in diesem Browser gespeichert.",
jiraProjectTooltip: "Mit welchem Jira-Projekt synchronisiert wird.",
jiraIssueTypesTooltip: "Welche Jira-Vorgangstypen als Aufgaben importiert werden.",
jiraAssigneeTooltip: "Standard-Zuweisungszuordnung für synchronisierte Vorgänge.",
```
Grep new lines; confirm ASCII `"` delimiters.

- [ ] **Step 3: Write/extend the failing test**

Check for an existing `src/app/jira-settings.test.tsx`. If present, add a presence test; otherwise extend `settings-menu.test.tsx`:
```ts
it("renders InfoTooltip help in Jira settings", () => {
  render(<SettingsMenu {...makeProps({ /* open per harness */ })} />);
  expect(screen.getByRole("button", { name: /which jira project to sync/i })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it — expect FAIL**

Run: `npx vitest run src/app/settings-menu.test.tsx` (or the jira test file)
Expected: FAIL.

- [ ] **Step 5: Wire the Jira fields**

In `src/app/jira-settings.tsx` add `import { InfoTooltip } from "./info-tooltip";`. After each field label, add `<InfoTooltip text={t(lang, "<key>Tooltip")} />`, wrapping the label text in a flex span as in Task 4a (apply Shape A or B per the existing markup). Fields (label key → tooltip key), at approximate lines:
| Field label key | Tooltip key | ~line |
|---|---|---|
| `jiraEnable` | `jiraEnableTooltip` | 202 |
| `jiraSiteUrl` | `jiraSiteUrlTooltip` | 212 |
| `jiraEmail` | `jiraEmailTooltip` | 242 |
| `jiraApiToken` | `jiraApiTokenTooltip` | 253 |
| `jiraProject` | `jiraProjectTooltip` | 311 |
| `jiraIssueTypes` | `jiraIssueTypesTooltip` | 346 |
| `jiraAssignee` | `jiraAssigneeTooltip` | 370 |

Read the exact label markup in `jira-settings.tsx` first and match its label container.

- [ ] **Step 6: Run it — expect PASS**

Run: `npx vitest run src/app/settings-menu.test.tsx` (or jira test)
Expected: PASS.

- [ ] **Step 7: Gates + commit**

Run: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`.
```bash
git add src/app/jira-settings.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-menu.test.tsx
git commit -m "feat(settings): wire InfoTooltip across Jira settings"
```

---

## Task 5: Release 0.28.0

**Files:**
- Modify: `src/app/version.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the release pattern**

Read `src/app/version.ts` (current `APP_VERSION = "0.27.0"`, the top changelog comment convention, the cumulative `APP_HIGHLIGHT_KEYS` array). Read the top CHANGELOG entry `[0.27.0]` for format/codename ("Jemisin").

- [ ] **Step 2: Add the highlight i18n key (EN + DE)**

`src/app/i18n.ts`:
```ts
versionHighlightStorageUnreachable: "Switching to a Turso backend that's down now shows a clear 'storage unreachable' message and keeps your data; the Turso settings include a turso.tech link, and every Settings field now has a hover tooltip.",
```
`src/app/i18n.de.ts`:
```ts
versionHighlightStorageUnreachable: "Der Wechsel zu einem nicht laufenden Turso-Backend zeigt jetzt eine klare Meldung 'Speicher nicht erreichbar' und behält Ihre Daten; die Turso-Einstellungen enthalten einen turso.tech-Link, und jedes Einstellungsfeld hat jetzt einen Hover-Tooltip.",
```
Grep both; confirm ASCII `"` delimiters in `i18n.de.ts` (the inner `'…'` single quotes are content).

- [ ] **Step 3: Bump version.ts**

- Set `APP_VERSION` to `"0.28.0"`.
- Add a `0.28.0` changelog comment block at the top, matching the file's convention (above the `0.27.0` block).
- Append `"versionHighlightStorageUnreachable"` to the end of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 4: Update CHANGELOG.md**

Add above `[0.27.0]`, matching format and the "Jemisin" codename:
```markdown
## [0.28.0] — 2026-05-29 "Jemisin"

### Added
- Link to turso.tech in the Turso storage configuration section.
- Mouseover help tooltips on every field in the Settings menu (storage, integrations, Jira, AI, notifications, and more).

### Changed
- Switching to a Turso backend when the server is down or the database is unreachable now shows a clear "storage unreachable — is the server running?" message instead of a raw network error. The switch is aborted and your current data is preserved (no switch, no data loss). A reachable but empty database is still initialized automatically.
```

- [ ] **Step 5: Gates**

Run: `npx vitest run` (green — update any test asserting `APP_VERSION`/`APP_HIGHLIGHT_KEYS` if such a test exists), `npx tsc --noEmit` (0), `npm run lint` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "release: 0.28.0 — Turso unreachable message, turso.tech link, Settings tooltips"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 → Task 1; Part 2 → Task 2; Part 3 component → Task 3, wiring → Tasks 4a/4b; release → Task 5. All spec sections covered.
- **Type consistency:** `InfoTooltip` props `{ text, label? }` consistent across Tasks 3/4a/4b. Hint token `"storage-unreachable"` and key `storageUnreachable` consistent across Task 1. Tooltip keys follow the `<labelKey>Tooltip` convention used in the `.map` cases.
- **No placeholders:** all i18n strings and code blocks are concrete.
