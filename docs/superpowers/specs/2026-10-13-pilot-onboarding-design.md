# Pilot onboarding fixes — design

**Date:** 2026-10-13 · **Register:** §704–§713 and §476 (`docs/open-followups.md`) · **Source:** the owner's
onboarding session with a UK pilot user, 2026-10-13, and a design brainstorm the same day.

## Goal

A non-technical user installs the desktop app, connects storage and Timelog, chooses the functions a project
needs, and gets a budget showing — without the owner on a call. The session showed where that breaks; each
item below closes one break. The pilot user reviews the app on 2026-10-22 and receives fixes through the
in-app update prompt (§714).

## Scope and sequencing

Three phases, each its own implementation plan:

| Phase | Items | Target |
|---|---|---|
| 1 — in-app fixes | §704 (+§709), §705, §706, §707, §708, §710, §711, §712 | before 2026-10-22 |
| 2 — guide and screenshots | §713, README gallery | after phase 1 (the shots show phase-1 UI) |
| 3 — project baseline currency | §476 | its own slice, NOT in the 22 Oct window (size L) |

Phase 1 items are independent of each other except where noted (§707 lives inside §706's Functions part;
§710 and §712 both link the demo). §714 is a process item with no code.

## Global rules

- Every new string has EN and DE keys (`i18n.ts` / `i18n.de.ts`, real umlauts).
- Every new control has an accessible name and keyboard operation; toggles use `ToggleButton`.
- No real personal or client names anywhere (the repo is public); examples use "Acme" / `acme`.
- Nothing new is persisted to the workspace except where an item says so; per-device UI state (a dismissed
  banner) lives in settings or localStorage with try/catch.

---

## Phase 1

### §705 — First start looks hung

**Today:** `desktop/splash.html` is artwork only (an SVG inlined from `public/splash-aipm-cockpit.svg`,
generated). `start()` in `desktop/src/main.ts` shows it, then `waitForReady` with `timeoutMs: 60000`, then
loads the app.

**Design:**
- The splash gets a status line under the artwork. Main sets its text as start-up proceeds:
  "Starting the background service…" → "Opening…".
- After 10 s without the app loading, a second line appears: "Still starting. The first start after
  installing or updating can take up to a minute — please wait."
- No first-run marker: the line appears whenever start-up passes 10 s.
- Windows' "Not responding" is not named in the app (the guide may mention it, §713).
- The artwork stays generated; the status lines are hand-written markup outside the generated block, so a
  regeneration does not drop them. Main updates the text through the splash window's `webContents` (no new
  IPC channel or preload).
- DE strings: the splash is a static file loaded before the app's i18n exists, so it carries both languages
  and picks one from the OS locale main passes in.

**Tests:** a desktop unit test that the status updates are sent in order and the 10 s line is scheduled and
cleared when the app loads. Eye-verify on a packaged build.

### §711 — Turso setup as numbered steps

**Today:** the Turso block in `settings-sections/integrations-section.tsx` (hint `integrationsTursoHint`,
URL and token fields, Test connection). Reached from the empty state's "Configure database / M365"
(`BackendConfigModal`), Settings → Integrations, and step 1 of the backend-setup wizard.

**Design:** the block becomes a numbered checklist around the EXISTING fields, same fields in the same order:

1. **Create a free database at turso.tech ↗** — "Pick a location near you (EU for European projects). Keep
   the tab open."
2. **Database URL** — "Copy it from the database's page."
3. **Auth token** — "Create one **without an expiry**, then paste it here." (Owner decision 2026-10-13.)
4. **Test connection**, then Apply.

- Each step shows ✓ once done: 2 when the URL parses, 3 when a token is present, 4 when the test passes.
- A link "Step-by-step guide with pictures ↗" opens the install guide (§713).
- The technical URL tooltip (`turso db show`, local server) stays.
- One component, so all three entry points get it.

**Tests:** component tests for the ✓ states (each step independently), the no-expiry text, and the guide link;
an accessibility check that the list is an ordered list with named fields.

### §706 — Functions belong to the project

**Today:** functions (feature modules) are chosen in the create wizard's step 3 and in Settings → Mode
(`mode-section.tsx`), which is in `EXPERT_IDS` and so hidden unless expert mode is on. Saving writes the
project's own set (`onCommitFeatures`). The section also holds the version-history retention field.

**Design (option D, owner's choice after a second look):**
- Extract the wizard's step-3 body (mode badge, Simple/Advanced presets, module checkboxes) into one
  `FunctionsPicker` component taking `features` and `onChange`. The wizard uses it unchanged in behaviour.
- **"Edit project"** (`ProjectEditModal`, mounted from the Projects panel and Settings → General) gains a
  **Functions** part using `FunctionsPicker`. Submitting the modal writes the project meta and, when they
  changed, the features through the existing `onCommitFeatures` path. Cancel discards both.
- **Settings → Mode** is renamed **Functions**, leaves `EXPERT_IDS`, and becomes a short pointer: "Functions
  are chosen per project." + **[Open this project's functions]**, which opens Edit project scrolled to
  Functions.
- **Version-history retention** stays in that Settings section, still expert-only.
- The rail stays alphabetical.

**Tests:** wizard behaviour unchanged (existing tests stay green); Edit project saves meta and features
together and Cancel saves neither; Settings pointer visible without expert mode and opens the modal;
retention hidden without expert mode.

### §707 — Time bookings needs Resources and Budget

**Design:**
- `FEATURE_MODULES` entries gain an optional `uses: FeatureModuleId[]`. Only Time bookings declares one:
  Resources and Budget.
- While a module that declares `uses` is on and any used module is off, `FunctionsPicker` shows a notice under
  it: "Time bookings uses Resources (to match bookings to people) and Budget (to cost them). Budget is off."
  (names the missing ones) + **[Turn on]**. Nothing changes automatically.
- Because `FunctionsPicker` is shared, the notice appears in the wizard and in Edit project.
- **The Time bookings view itself** shows the same notice with the same one-click fix while Resources or
  Budget is off (owner addition). The one-click fix there writes features through `onCommitFeatures`.

**Tests:** notice text per combination (one off, both off, none off); [Turn on] enables exactly the missing
ones; view notice shown/hidden; a pure test that every `uses` id is a real module id.

### §704 (+§709) — Timelog address instead of host and tenant

**Today:** a free-text Host pre-filled with `app2.timelog.com` (`defaultTimelogConfig.host`), then Tenant.
A tenant on another regional host fails with "Connection failed (HTTP 404)".

**Design:**
- A new first field, **Your Timelog address**: "Open Timelog in your browser, copy the address bar, paste it
  here." Placeholder: `https://app.timelog.com/acme/…`.
- On paste or change, host and tenant are parsed from `https://<host>/<tenant>/…` and shown underneath as
  filled fields, with **Edit host and tenant separately** for corrections. Parsing accepts only `https` and
  hosts the SSRF guard already accepts (`*.timelog.com`); anything else shows "This is not a Timelog address".
- Host and tenant remain the STORED values, so existing configs keep working; the address field is input
  only and is not persisted.
- The `app2.timelog.com` pre-fill is removed; the host starts empty.
- A 404 on Test connection gets its own message: "Timelog has no tenant "<tenant>" on <host>. Timelog serves
  regions from different addresses — check the address bar while logged in."
- §709: the tenant field's hint becomes "the part after the host in your Timelog address".
- No automatic retry against another host.

**Tests:** parser table (with/without trailing path, query, uppercase host, `http`, foreign host, missing
tenant); fields fill from a paste; stored config unchanged when only the address is edited then reverted;
404 message names host and tenant; existing config renders with its stored host.

### §708 — Resource form: what matters for Timelog

**Today:** 12 fields; only first or last name enforced. `autoMatchUsers` (`timelog-match.ts`) tries the
primary email, then initials, then "first last". Manual links win.

**Design:**
- **Needed** group on top: first name, last name, email. Email hint: "Matches Timelog bookings, calendar and
  contacts — use the address the person signs into Timelog with."
- Everything else under **More details** (collapsed), opened automatically when any detail field is filled.
- **Email is required in the resource form only** (owner: "Form only"). Save is refused with a field error.
  Other create paths (picker quick create, AI `create_resource`, Outlook/CSV import) still accept none.
  Existing people are untouched until edited.
- A person with no email is marked in the resource directory: "No email — cannot match Timelog".
- **Matching fix:** `autoMatchUsers` matches a Timelog user's email against ALL of a resource's emails
  (primary and extra), case-insensitively. The order of rules and "manual links win" are unchanged.

**Tests:** form refuses Save without email and accepts with; quick create still accepts none; More details
auto-opens; directory marker; `autoMatchUsers` matches on an extra email, keeps primary-first precedence
when two resources could match, and still lets a manual link win.

### §710 — Budget setup checklist

**Today:** with no buckets, `budget-panel.tsx` renders only the add-first-bucket button.

**Design:** a live checklist replaces the empty state:

1. Roles have rates — ✓ when at least one role has a rate · link **Manage roles**
2. People on the project — ✓ when at least one resource exists · link **Resources**
3. Add a bucket per phase (dates, type, people) — the existing **+ Add bucket…** button
4. Import time bookings — **optional**, always shown · link **Time bookings** (✓ once any booking exists)

- The first unticked step is highlighted.
- Under the list: **Take the Resources & budget tour** · **Explore the demo project**.
- After the first bucket the checklist collapses to one line ("Budget setup: 3 of 4 · show") until bookings are
  imported. The collapsed line has a ✕ that hides it for this project (per device). ★ The ✕ is a default
  proposed in the brainstorm — **owner to confirm in review**.
- Ticks derive from workspace state on render; nothing new is stored except the ✕.

**Tests:** each tick from state; highlight moves; collapsed after first bucket; gone after a booking; ✕ hides
it; links navigate.

### §712 — The demo is easy to miss

**Design (A + C):**
- **Banner** on the dashboard: "New here? See every function on a fully populated sample project first. It
  opens as a separate project — your own stays as it is, and you can switch back any time from Projects.
  **[Explore the demo]** ✕". Shown on any project (not only a "new" one, which has no reliable definition)
  until dismissed or until the demo has been opened once, per device. Never shown on the demo itself.
- **Help menu** entry "Explore the demo project", always there.
- Both reuse the existing demo-load action the tour and the Projects panel use.

**Tests:** banner shows by default, hides on ✕ and after the demo opens, survives a reload in that state;
Help entry opens the demo.

---

## Phase 2 — §713 guide and screenshots

### Content split (option B)

- **`docs/desktop-rollout.md`** keeps what is needed before and while installing, and adds:
  - the browser's own "uncommon download" prompt and **Keep** (before Windows' box);
  - the first start being slow (the §705 sentence; may mention "Not responding");
  - Claude: a subscription does not include API use; buy credit at Anthropic's billing page (linked). **No
    amounts** (owner: skip for now). Expense claimability is NOT mentioned (internal only);
  - ~~Turso: the two steps that advise an expiry change to "no expiry" (§711);~~ — dropped 2026-10-14: §711
    already made that change (`grep -n "no expiry" docs/desktop-rollout.md` → step 4);
  - Timelog: paste the address (§704);
  - a link to the in-app Help entry below instead of restating the setup order.
- **In-app Help**, Workflows group: **Getting started: set up a budget** (EN + DE) — turn on the functions
  (Edit project → Functions) → give roles rates → add people with an email → add a bucket per phase → import
  bookings; and where the demo is.
- **Links into the guide:** Help menu "Installation & setup guide ↗", the §711 checklist, and About — all
  `APP_REPO_URL` + `/blob/main/docs/desktop-rollout.md` (owner: link `main`).

### Screenshots

- **`e2e/guide-shots.spec.ts`** in its own Playwright project, excluded from `chromium`, CI and `npm run e2e`;
  run by `npm run docs:guide-shots` (new `scriptsDescriptions` entry + CONTRIBUTING.md table).
- Deterministic: fixed seed, frozen clock, light theme, 1280×800, en-US.
- **Guide shots** use a fictional fixture and are cropped to the relevant region (`locator.screenshot`):
  splash (§705; the spec opens `desktop/splash.html` over `file://` and injects the status text with the same
  `splashScript` the desktop shell sends, so no Electron runs), Configure database → Turso checklist (§711), Settings → AI key field, Timelog address
  (§704), Edit project → Functions with the §707 notice, Manage roles, resource form (§708), budget
  checklist (§710), demo banner and Help entry (§712). Output `docs/assets/guide/<nn>-<step>.png`.
- **Callouts** (highlight box or numbered marker) are drawn by the spec through an injected overlay, so a
  retake redraws them.
- **README gallery** moves onto the same spec: full-window shots of the demo project, written to the
  existing `docs/assets/*.png` names.
- **Secrets:** key fields get obvious fakes (`sk-ant-…EXAMPLE`); the spec never reads `.env*`.
- **Hand-captured:** the browser download prompt and Windows' SmartScreen box are taken by the owner by hand
  (`docs/assets/guide/<nn>-<step>.manual.png`); the spec never writes `*.manual.png`.
- **Not a pixel gate.** One unit test checks that every image the guide and README reference exists.

### Amendments at design approval (owner, 2026-10-14)

- **Base:** phase 1 ships first (PR #706); phase 2 builds on main once it merges.
- **README gallery stays in phase 2**: the same spec regenerates all 16 existing `docs/assets/*.png` names,
  full-window from the demo project. Every gallery image changes and gets an eye-check before merge.
- **Splash shot** comes from `desktop/splash.html` over `file://` (above).
- **Out of scope, filed as §715:** a recorded first-run demo video (download → install → setup), made with
  the `ecc:ui-demo` skill after this phase ships. This phase's guide order and fixtures are what it follows.

---

## Phase 3 — §476 project baseline currency

Owner choice: option D — the full configurable baseline, not a role-rate picker. EUR stays the default at
creation. The register entry §476 holds the analysis; this section fixes the design decisions it left open.

- **Field:** reuse `plan.currency` as the baseline (the register leans this way since §473 settled it as the
  role-rate currency). Its meaning widens from "currency rates are typed in" to "unit the engine computes and
  displays in"; a stored value other than EUR is already valid.
- **Where it is set:** project creation (wizard details step) and Edit project.
- **Changing it on an in-flight project** uses semantics C, re-confirmed by the owner on 2026-10-13: going
  forward, history pinned.
  - The change is **blocked until ECB rates are fetched** in this session (no rate-1 fallback can become a
    write).
  - The rate used is **pinned** into the workspace as a baseline-history record
    `{ from: ISO date, currency, perEur: number }`; past figures are valued with the baseline and pinned rate
    in force on their date, so a past month's reported cost never moves on a later settings edit.
  - A real confirmation names the old and new currency, the rate, and that past figures keep their values.
- **Engine:** the rate table stays EUR-based; a cross rate is derived (`ecb[bucket] / ecb[base]`).
  `resolveRate`'s short-circuit becomes `bucket.currency === base`.
- **Display:** the EUR money formatters move to the baseline (the register's witness lists them).
- **Persistence:** the baseline-history record is a new workspace field → all six write paths.

Before planning phase 3: re-run the register's witnesses, and decide whether the history record is a
meta-blob slice or part of the plan.

---

## Open for the owner at spec review

1. §710 — the ✕ on the collapsed checklist line (proposed default).
2. §712 — the banner shows on every project until dismissed or the demo has been opened (simpler than
   detecting a "new" project).
3. §705 — the splash picks EN or DE from the OS locale.
4. §476 — reuse `plan.currency`, and the baseline-history record shape.
