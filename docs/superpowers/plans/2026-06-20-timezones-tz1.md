# Timezone Foundation + Logic + Settings (TZ-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project + per-device timezone model with pure `Intl`-based utilities, and shift the app's day-boundary logic (`today`/overdue/reminders/due-dates) to the resolved effective timezone.

**Architecture:** A pure i18n-free `timezone.ts` (todayInZone/formatInZone/isValidTimeZone/browserTimeZone/resolveTimezone). The operating timezone is a `ProjectMeta` scalar (rides the existing project-meta serialization, mirroring `jiraUrl`); the per-device override + additional-zone list are `Settings` fields. The single central `today` anchor (`task-manager` `todayISO()`) plus two secondary derivations switch to the effective zone.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript, vitest, Playwright axe gate. `Intl.DateTimeFormat` + `Intl.supportedValuesOf` (NO new dependency). AIPM palette tokens only. EN/DE i18n parity enforced by tsc.

---

## Conventions (read once)
- Lint is fatal (`--max-warnings=0`): no unused imports/vars. Run `npm run lint` after every task.
- tsc enforces EN/DE i18n key parity + typechecks tests. Run `npx tsc --noEmit` after editing tests.
- DE edits: the Edit tool corrupts umlauts + curls quotes in `i18n.de.ts` (CRLF file). Edit DE via a node UTF-8 write matching `\r\n` anchors; verify with a node read (no `fuer`/`ae` subs — `i18n-encoding` test bans them).
- No `new Date()`/`Date.now()` in a render body (purity rule). Use a module function (like the existing `todayISO()`) or pass `now` in. `timezone.ts` is pure (takes `now`).
- No `set-state-in-effect`. Settings writes go through `setSettings`/`writeSettings`, never raw setItem.
- AIPM tokens only. `Lang` = `"en-US" | "en-GB" | "de"`; DE dict lazy (`loadI18n("de")` in `beforeAll` for DE assertions).

## File Structure
- `timezone.ts` (NEW pure) — all tz math + resolution.
- `types.ts` — `ProjectMeta.operatingTimezone?: string`.
- `sanitize.ts` — `sanitizeTimezone` + wire into `sanitizeProjectMeta`.
- `csv-codecs.ts` — add to `PROJECT_CSV_COLUMNS` + the project decoder.
- `markdown-codecs.ts` — rides `projectFieldToString` (verify generic).
- Turso single+tenant — columns derive from `PROJECT_CSV_COLUMNS` (verify) + `turso-migrate` self-heals.
- `__fixtures__/golden-*` + `sample-workspace-small.*` — regenerate.
- `settings-types.ts` — `timezone?`, `additionalTimezones?`.
- `settings-view.tsx` — default picker + additional-tz editor.
- `project-form.tsx` + `project-form-fields.tsx` — operating-tz field.
- `task-manager.tsx`, `use-resource-planner.ts`, `use-bulk-operations.ts` — effective-`today` wiring.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.

---

## Task 1: Pure `timezone.ts`

**Files:** Create `src/app/timezone.ts`, Test `src/app/timezone.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { todayInZone, isValidTimeZone, resolveTimezone, formatInZone } from "./timezone";

describe("timezone", () => {
  it("todayInZone returns the local calendar date in the zone", () => {
    const now = new Date("2026-06-20T22:00:00Z");
    expect(todayInZone(now, "Pacific/Kiritimati")).toBe("2026-06-21"); // UTC+14 → next day
    expect(todayInZone(now, "Pacific/Pago_Pago")).toBe("2026-06-20");  // UTC-11 → same day
    expect(todayInZone(now, "UTC")).toBe("2026-06-20");
  });
  it("todayInZone is DST-correct", () => {
    // 2026-03-08 06:30Z is 01:30 EST (before the 2am spring-forward) → still Mar 8 in NY
    expect(todayInZone(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });
  it("isValidTimeZone accepts IANA, rejects junk", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
  it("resolveTimezone: override > project > browser; skips invalid", () => {
    expect(resolveTimezone("Asia/Kolkata", "Europe/Berlin")).toBe("Asia/Kolkata");
    expect(resolveTimezone(undefined, "Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveTimezone("Bad/Zone", "Europe/Berlin")).toBe("Europe/Berlin"); // invalid override skipped
    // both unset/invalid → a valid IANA string (the browser zone; in jsdom usually "UTC")
    expect(isValidTimeZone(resolveTimezone(undefined, undefined))).toBe(true);
  });
  it("formatInZone renders an ISO instant in a zone", () => {
    const out = formatInZone("2026-06-20T22:00:00Z", "Asia/Kolkata", { hour: "2-digit", minute: "2-digit", hour12: false }, "en-GB");
    expect(out).toContain("03:30"); // 22:00Z + 5:30 = 03:30 next day
  });
});
```

- [ ] **Step 2: Run → FAIL**
Run: `npm run test:run -- timezone` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/timezone.ts`**
```ts
// src/app/timezone.ts — pure timezone utilities (Intl-based; no deps, no React/Date-in-module).
// `now`/`iso` are always passed in so the date-math functions stay pure + testable.

/** True if `tz` is a valid IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The host's detected IANA zone (client env read; "UTC" fallback). Not a module
 *  const so it stays SSR/test-safe and is re-read per call. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** YYYY-MM-DD of `now` as seen in `tz`. Falls back to UTC if `tz` is rejected. */
export function todayInZone(now: Date, tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  // en-CA renders ISO-ish YYYY-MM-DD; use formatToParts to be locale-proof.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Format an ISO instant in `tz` for display. Falls back to UTC on a bad zone. */
export function formatInZone(
  iso: string, tz: string, opts: Intl.DateTimeFormatOptions, locale: string,
): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(d);
}

/** Effective zone: per-device override → per-project operating tz → browser. Each
 *  candidate must be a valid IANA zone to be chosen. Always returns a valid zone. */
export function resolveTimezone(overrideTz: string | undefined, projectTz: string | undefined): string {
  if (overrideTz && isValidTimeZone(overrideTz)) return overrideTz;
  if (projectTz && isValidTimeZone(projectTz)) return projectTz;
  return browserTimeZone();
}
```

- [ ] **Step 4: Run → PASS**
Run: `npm run test:run -- timezone` → Expected: PASS (5 tests). (jsdom's browser zone is usually UTC; the resolveTimezone fallback test only asserts validity, so it's environment-robust.)

- [ ] **Step 5: Lint + commit**
Run: `npm run lint` → clean.
```bash
git add src/app/timezone.ts src/app/timezone.test.ts
git commit -m "feat(tz-1): pure timezone utilities (todayInZone, formatInZone, resolveTimezone)"
```

---

## Task 2: `ProjectMeta.operatingTimezone` + sanitizer

**Files:** Modify `src/app/types.ts`, `src/app/sanitize.ts`; Test `src/app/sanitize.test.ts`

- [ ] **Step 1: Write the failing test** (append to `sanitize.test.ts`)
```ts
import { sanitizeTimezone } from "./sanitize";
describe("sanitizeTimezone", () => {
  it("keeps a valid IANA zone, drops junk/empty/non-string", () => {
    expect(sanitizeTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(sanitizeTimezone("Not/AZone")).toBeUndefined();
    expect(sanitizeTimezone("")).toBeUndefined();
    expect(sanitizeTimezone(42)).toBeUndefined();
  });
  it("sanitizeProjectMeta keeps a valid operatingTimezone, drops a bad one", () => {
    expect(sanitizeProjectMeta({ name: "P", code: "P", operatingTimezone: "Europe/Berlin" } as never).operatingTimezone).toBe("Europe/Berlin");
    expect(sanitizeProjectMeta({ name: "P", code: "P", operatingTimezone: "X/Y" } as never).operatingTimezone).toBeUndefined();
  });
});
```
(Ensure `sanitizeProjectMeta` is imported in this test file — it is used elsewhere in the suite; reuse the existing import.)

- [ ] **Step 2: Run → FAIL**
Run: `npm run test:run -- sanitize` → FAIL (`sanitizeTimezone` not exported / field missing).

- [ ] **Step 3: Implement**
In `src/app/types.ts`, add to `interface ProjectMeta` (beside `jiraUrl?: string;`, ~line 627):
```ts
  /** IANA operating timezone for this project (e.g. "Asia/Kolkata"). Drives the
   *  effective zone for day-boundary logic when no per-device override is set. */
  operatingTimezone?: string;
```
In `src/app/sanitize.ts`: import `isValidTimeZone` from `./timezone`, add the validator, and wire it into `sanitizeProjectMeta` (next to the `jiraUrl` line ~1270):
```ts
export function sanitizeTimezone(raw: unknown): string | undefined {
  return typeof raw === "string" && isValidTimeZone(raw) ? raw : undefined;
}
```
```ts
  const operatingTimezone = sanitizeTimezone(o.operatingTimezone); if (operatingTimezone) meta.operatingTimezone = operatingTimezone;
```

- [ ] **Step 4: Run → PASS**
Run: `npm run test:run -- sanitize` → PASS. Run `npx tsc --noEmit` → 0.

- [ ] **Step 5: Lint + commit**
```bash
git add src/app/types.ts src/app/sanitize.ts src/app/sanitize.test.ts
git commit -m "feat(tz-1): ProjectMeta.operatingTimezone + sanitizeTimezone"
```

---

## Task 3: Persist `operatingTimezone` (mirror `jiraUrl`) + fixtures

`operatingTimezone` is a ProjectMeta scalar, so it rides the EXISTING project-meta serialization driven by `PROJECT_CSV_COLUMNS`. This mirrors exactly how `jiraUrl` is persisted.

**Files:** Modify `src/app/csv-codecs.ts`; Test `src/app/golden-workspace.test.*` (regenerate fixtures); sample data.

- [ ] **Step 1: Add the column + decoder**
- `src/app/csv-codecs.ts` line ~749-754: add `"operatingTimezone"` to the `PROJECT_CSV_COLUMNS` array (this single list drives CSV columns, the Markdown `## Project Meta` bullets via `projectFieldToString`, AND the Turso project DDL/insert — per AGENTS.md's new-column recipe).
- `src/app/csv-codecs.ts` project decoder (~line 941, beside `jiraUrl: scalar("jiraUrl")`): add `operatingTimezone: scalar("operatingTimezone"),`.
- Verify `projectFieldToString` (markdown-codecs) renders a plain string scalar generically (it does for `jiraUrl`, which is not in `PROJECT_ARRAY_COLUMNS`) — `operatingTimezone` needs NO special case. Confirm by reading it; if it has an explicit per-field switch, add an `operatingTimezone` arm that returns the string.

- [ ] **Step 2: Verify Turso column coverage**
Read `turso-schema.ts` + `turso-tenant-schema.ts`: confirm the project table DDL + insert derive their columns from `PROJECT_CSV_COLUMNS` (so adding the column is automatic) and that `turso-migrate.ts` ALTER-adds a missing column on an existing DB. If the project columns are instead a hardcoded list, add `operatingTimezone` there too. (`SqlArg.value` is string-only — a string tz needs no conversion.)

- [ ] **Step 3: Failing round-trip test** — `src/app/timezone-persistence.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { jsonToWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./storage";

const ws = jsonToWorkspace(JSON.stringify({
  tasks: [], raid: [], project: { name: "P", code: "P", operatingTimezone: "Asia/Kolkata" },
}));
describe("operatingTimezone persistence", () => {
  it("round-trips through CSV", () => {
    expect(csvToWorkspace(workspaceToCsv(ws)).project?.operatingTimezone).toBe("Asia/Kolkata");
  });
  it("round-trips through Markdown", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).project?.operatingTimezone).toBe("Asia/Kolkata");
  });
  it("a project without operatingTimezone stays undefined", () => {
    const bare = jsonToWorkspace(JSON.stringify({ tasks: [], raid: [], project: { name: "P", code: "P" } }));
    expect(csvToWorkspace(workspaceToCsv(bare)).project?.operatingTimezone).toBeUndefined();
  });
});
```
Run → FAIL, then make Steps 1-2 changes → PASS.

- [ ] **Step 4: Regenerate golden fixtures + sample**
Adding a column to `PROJECT_CSV_COLUMNS` is a LEGIT format change → `golden-workspace.test` will fail on byte diff. Add an `operatingTimezone` to the curated `sample-workspace-small.md` project meta (a sensible zone, e.g. `Europe/Berlin`), then regenerate: `npx vite-node scripts/generate-sample-workspace.ts` (emits `.json`/`.sqlite3` + big/huge), then regenerate `__fixtures__/golden-workspace.{csv,md}` via the serializers (mirror prior fixture-regen). Verify CSV pure CRLF / MD pure LF.

- [ ] **Step 5: Verify**
Run: `npm run test:run -- timezone-persistence golden-workspace` → PASS. Run `npm run test:run` (full) → green (fix any sample-data test asserting exact project bytes/counts — legit new-column change). `npx tsc --noEmit` → 0. `npm run lint` → clean.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(tz-1): persist ProjectMeta.operatingTimezone (six paths) + regenerate fixtures"
```

---

## Task 4: `Settings.timezone` + `additionalTimezones`

**Files:** Modify `src/app/settings-types.ts`; Test `src/app/timezone-settings.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { writeSettings, readSettings, defaultSettings } from "./use-settings"; // adjust to actual read/write API (grep how tourSeen/tasksViewMode persist)
describe("timezone settings", () => {
  it("persist timezone + additionalTimezones through write/read", () => {
    writeSettings({ ...defaultSettings, timezone: "Asia/Kolkata", additionalTimezones: ["America/New_York"] });
    const s = readSettings();
    expect(s.timezone).toBe("Asia/Kolkata");
    expect(s.additionalTimezones).toEqual(["America/New_York"]);
  });
  it("default to undefined (follow project/browser)", () => {
    expect(defaultSettings.timezone).toBeUndefined();
    expect(defaultSettings.additionalTimezones).toBeUndefined();
  });
});
```
★ Adjust imports to the REAL settings read/write API (mirror how `tourSeen` was tested in `tour-seen-settings.test.ts` / `use-settings`). `writeSettings` spreads the whole object, so no allowlist edit is needed.

- [ ] **Step 2: Run → FAIL** (`npm run test:run -- timezone-settings`).

- [ ] **Step 3: Implement** — in `src/app/settings-types.ts`, add to `interface Settings` (near `tourSeen?`):
```ts
  /** Per-device override of the app timezone (IANA). Undefined = follow project/browser. */
  timezone?: string;
  /** Per-device extra zones to surface (calendar + per-window switcher), IANA strings. */
  additionalTimezones?: string[];
```
Do NOT add to `defaultSettings`.

- [ ] **Step 4: Run → PASS.** `npx tsc --noEmit` → 0. `npm run lint` → clean.
- [ ] **Step 5: Commit**
```bash
git add src/app/settings-types.ts src/app/timezone-settings.test.ts
git commit -m "feat(tz-1): Settings.timezone override + additionalTimezones list"
```

---

## Task 5: Wire the effective `today` into logic

**Files:** Modify `src/app/task-manager.tsx`, `src/app/use-resource-planner.ts`, `src/app/use-bulk-operations.ts`; Test `src/app/timezone-logic.test.ts` (or extend an existing engine test)

- [ ] **Step 1: Failing test** — prove `today` follows the resolved zone.
```ts
import { describe, it, expect } from "vitest";
import { todayInZone, resolveTimezone } from "./timezone";
// The wiring contract: task-manager computes `today = todayInZone(now, resolveTimezone(settings.timezone, project?.operatingTimezone))`.
// This test pins the contract at the unit level (the integration is exercised by the full suite).
describe("effective today contract", () => {
  it("uses the override zone for the date boundary", () => {
    const now = new Date("2026-06-20T22:00:00Z");
    const tz = resolveTimezone("Pacific/Kiritimati", undefined);
    expect(todayInZone(now, tz)).toBe("2026-06-21"); // overdue/today logic now keys off this
  });
});
```
Run → PASS already (Task 1 code) — this documents the contract; the real change is the wiring below.

- [ ] **Step 2: Wire `task-manager.tsx`**
- Import: `import { todayInZone, resolveTimezone } from "./timezone";`.
- Replace the `todayISO` helper usage. Keep a module fn to avoid the render-body `new Date()` lint:
```ts
function effectiveToday(tz: string): string {
  return todayInZone(new Date(), tz);
}
```
- At the `const today = todayISO();` site (~line 310), compute the zone from settings + the live project meta:
```ts
const effectiveTz = resolveTimezone(settings.timezone, project?.operatingTimezone);
const today = effectiveToday(effectiveTz);
```
(`settings` and `project` are both already in scope in the component. If `project` is named differently for the active workspace meta, use that.)
- Remove the now-unused `todayISO` if nothing else references it (grep first — if other call sites exist, keep it).

- [ ] **Step 3: Wire the secondary derivations**
- `src/app/use-bulk-operations.ts:124` (`const today = new Date().toISOString().slice(0, 10);`): accept an effective `today` from the caller (add a `today: string` param/arg to the hook or the operation), passed from task-manager's `today`. If threading is heavy, at minimum import + use `todayInZone(new Date(), resolveTimezone(settings.timezone, projectTz))` where settings/projectTz are available. Keep the `new Date().toISOString()` STAMP at line 151 (that's an audit timestamp — UTC is correct).
- `src/app/use-resource-planner.ts` `isoToday` (line ~14): same — derive from the effective zone (thread the resolved tz in from the consumer, or accept a `today` arg). If the planner has no access to settings/project, accept `today` as an argument and pass it from the calling surface.
- Do NOT touch storage/export/codec `new Date().toISOString()` stamps (`browser-backend`, codecs, `export*`) — those are durable UTC records.

- [ ] **Step 4: Verify**
Run: `npm run test:run` (full) → green. `npx tsc --noEmit` → 0. `npm run lint` → clean (exhaustive-deps: if `effectiveTz`/`today` enter a memo/callback dep array, list them; hoist any `obj.member`).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(tz-1): derive today/overdue logic in the resolved effective timezone"
```

---

## Task 6: Settings UI — default picker + additional-tz editor

**Files:** Modify `src/app/settings-view.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Test `src/app/settings-view.*` (extend if a test exists; else a focused component test)

- [ ] **Step 1: i18n keys** — add EN (`i18n.ts`) + DE (`i18n.de.ts`, node UTF-8 write, real umlauts):
EN: `tzSettingsTitle: "Timezone"`, `tzDefaultLabel: "Default timezone"`, `tzSystemDefault: "System default"`, `tzAdditionalLabel: "Additional timezones"`, `tzAddLabel: "Add timezone"`, `tzRemoveLabel: "Remove"`, `tzOperatingLabel: "Operating timezone"`.
DE (real umlauts): `tzSettingsTitle: "Zeitzone"`, `tzDefaultLabel: "Standard-Zeitzone"`, `tzSystemDefault: "Systemstandard"`, `tzAdditionalLabel: "Weitere Zeitzonen"`, `tzAddLabel: "Zeitzone hinzufügen"`, `tzRemoveLabel: "Entfernen"`, `tzOperatingLabel: "Betriebszeitzone"`.

- [ ] **Step 2: Failing test** — render the General section, assert the default-tz select is present + labeled, selecting "System default" clears the override, add/remove an additional zone. (Mirror an existing `settings-view` test's harness; if none, a minimal render test asserting `getByLabelText(t("en-US","tzDefaultLabel"))` exists and `onChange` to "" calls the setter with `timezone: undefined`.)

- [ ] **Step 3: Implement** in `settings-view.tsx` General section:
- A labeled `<select>` (`aria-label`/`<label>` = `tzDefaultLabel`): option value `""` → label `tzSystemDefault` + ` (${browserTimeZone()})`; then `Intl.supportedValuesOf("timeZone").map(z => <option>)`. `value = settings.timezone ?? ""`; onChange → `setSettings(s => ({ ...s, timezone: e.target.value || undefined }))`.
- Additional-tz editor: a labeled add `<select>` (zones) + an Add button → append to `settings.additionalTimezones` (dedupe, validate via `isValidTimeZone`); a list of current zones each with a row-UNIQUE remove button (`${t(lang,"tzRemoveLabel")} – ${zone}`). Write via the setter.
- AIPM tokens only; reuse the section's existing control classes. `Intl.supportedValuesOf` is ~hundreds of options — a plain `<select>` is acceptable (native search). If `Intl.supportedValuesOf` is undefined at runtime, fall back to `[browserTimeZone(), "UTC"]` + the already-added zones (defensive; don't crash).

- [ ] **Step 4: Verify** — test PASS; `npx tsc --noEmit` → 0; `npm run lint` → clean.
- [ ] **Step 5: axe** — `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → PASS (the new selects/buttons are labeled; row-unique remove labels).
- [ ] **Step 6: Commit**
```bash
git add src/app/settings-view.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-view.test.tsx
git commit -m "feat(tz-1): Settings timezone picker + additional-zones editor"
```

---

## Task 7: Project form — operating timezone field

**Files:** Modify `src/app/project-form-fields.tsx`, `src/app/project-form.tsx`; Test `src/app/project-form*.test.tsx`

- [ ] **Step 1: Failing test** — extend the project-form test: set an operating timezone in the form, submit, assert `onSubmit` meta carries `operatingTimezone`; `draftFromMeta` round-trips it. (Mirror the existing `jiraUrl` form test if present.)

- [ ] **Step 2: Implement** (mirror `jiraUrl` exactly):
- `project-form-fields.tsx`: add `operatingTimezone: string` to `ProjectFormDraft` (type ~line 44) + `emptyProjectDraft()` (`operatingTimezone: ""`, ~line 81). Add a labeled `<select>` control (zones + a blank "none" option) bound to `draft.operatingTimezone` (mirror the `jiraUrl` field block ~529-537 but a select; label `tzOperatingLabel`).
- `project-form.tsx`: `draftFromMeta` (~line 79) add `operatingTimezone: meta.operatingTimezone ?? ""`; the submit meta-build (~line 150) add `operatingTimezone: draft.operatingTimezone || undefined` (empty string → undefined so a blank field doesn't persist `""`).

- [ ] **Step 3: Verify** — test PASS; `npx tsc --noEmit` → 0; `npm run lint` → clean. (Create wizard is not in axe `A11Y_VIEWS` — eye-verify the field label.)
- [ ] **Step 4: Commit**
```bash
git add src/app/project-form-fields.tsx src/app/project-form.tsx src/app/project-form.test.tsx
git commit -m "feat(tz-1): project form operating-timezone field"
```

---

## Task 8: Release v0.113.0

**Files:** Modify `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version + highlight key** — `version.ts`: `APP_VERSION = "0.113.0"`; update `APP_BUILD_DATE` comment; pick `APP_MILESTONE` (next author codename, e.g. `"Le Guin"` is taken — use `"Hamilton"` is taken too; choose an unused sci-fi author, e.g. `"Kress"` (Nancy Kress)). Append `"versionHighlightTimezones"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Highlight i18n** — EN (`i18n.ts`): `versionHighlightTimezones: "Timezones: set a per-project operating timezone and a per-device default; the app's date logic (overdue, reminders, due dates) now follows your timezone."`. DE (node UTF-8 write, real umlauts): `versionHighlightTimezones: "Zeitzonen: Legen Sie eine Betriebszeitzone pro Projekt und einen geräteweiten Standard fest; die Datumslogik der App (überfällig, Erinnerungen, Fälligkeiten) richtet sich jetzt nach Ihrer Zeitzone."`. Verify parity + umlauts.

- [ ] **Step 3: CHANGELOG** — prepend above the current top entry:
```markdown
## [0.113.0] - <date> "Kress"

### Added
- Timezones (foundation): set a per-project operating timezone and a per-device default (plus a list of additional zones). The app's day-boundary logic - what counts as overdue, due today, or due soon - now follows the resolved timezone instead of UTC. (Display of timestamps and the calendar's multi-timezone view follow in later updates.)
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run` → green; `npm run build` → succeeds (prebuild highlight sync); `npx playwright test e2e/a11y.spec.ts --project=chromium` → 12/12.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(tz-1): release v0.113.0 \"Kress\" (timezone foundation)"
```

---

## Final steps (after all tasks)
1. Final whole-branch review (focus: `todayInZone` DST/edge correctness, resolution precedence, no engine regressions from the `today` change, six-path persistence byte-stability, a11y of the pickers, EN/DE parity).
2. Use superpowers:finishing-a-development-branch.
3. This branch (`timezones-tz1`) is off clean `main` — the MR diffs cleanly to just TZ-1.

## Self-review notes (resolved)
- **Spec coverage:** pure utils (T1), model+sanitizer (T2), six-path persistence (T3), settings fields (T4), logic wiring (T5), settings UI (T6), project field (T7), release (T8). Resolution precedence override→project→browser is in `resolveTimezone` (T1) + consumed in T5/T6/T7.
- **Decision locked:** `operatingTimezone` lives on `ProjectMeta` (not a separate Workspace field) — rides existing project-meta serialization (mirrors `jiraUrl`), far less plumbing; `resolveTimezone` reads `project?.operatingTimezone`. (Spec flagged this as a planning decision.)
- **Type consistency:** `resolveTimezone(overrideTz, projectTz)` signature used identically in T1/T5/T6/T7. `sanitizeTimezone`/`isValidTimeZone`/`todayInZone`/`formatInZone`/`browserTimeZone` names consistent throughout.
- **Interim state:** logic uses effective tz (T5) but timestamp DISPLAY stays browser-local until TZ-2 — documented in the spec; acceptable.
