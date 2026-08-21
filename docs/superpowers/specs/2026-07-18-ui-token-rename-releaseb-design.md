# Release B — `AIPM-*` → `ui-*` Palette Token Rename (Design)

**Date:** 2026-07-18
**Program:** DS sprawl audit, task 38 (Release B). Release A (0.190.22 "Pinsker", MR!281) already
de-privileged AIPM/Mockup into pluggable importable themes. Release B strips the brand word from the
load-bearing palette **token names** now that AIPM is just one theme among many.

## Goal

Rename the 12 base palette tokens from the `AIPM-*` prefix to a neutral `ui-*` prefix, everywhere they
appear (Tailwind utility classes, CSS variable names, `@theme` map, scheme registries, shipped theme
JSON, palette guards, tests, and docs). **Pure rename — zero visual or behavioral change.**

## Decisions (brainstorm, 2026-07-18)

- **Naming scheme:** neutral-prefix swap — `AIPM-` → `ui-`, keep the color-word suffix. Near-1:1 codemod,
  no per-site judgment, fully reversible. (Rejected: semantic role names — multi-role color collisions
  make it non-mechanical and risky; neutral color-slot — churn without payoff.)
- **Prefix word:** `ui-`.
- **Docs scope:** EXHAUSTIVE — every `AIPM-<color>` token string in AGENTS.md, code comments, and repo
  docs (CHANGELOG/README) becomes `ui-*`, historical prose included, plus a short supersede note.
- **Migration:** NONE (consistent with Release A "no active users"). Stored/exported `--AIPM-*` scheme
  keys drop to the Harbor fallback on read. Our shipped `public/themes/*.json` are rewritten to `--ui-*`
  so the gallery still resolves them.

## The 12 tokens

```
AIPM-dark-blue      AIPM-green         AIPM-green-strong
AIPM-pink           AIPM-pink-strong   AIPM-purple
AIPM-purple-strong  AIPM-blue          AIPM-white
AIPM-dark-grey      AIPM-light-grey    AIPM-medium-grey
```

Each appears in three coupled forms:

1. **Tailwind utility class** — `bg-AIPM-green`, `text-AIPM-dark-blue`, `ring-AIPM-green`, arbitrary
   `[var(--AIPM-green)]`, etc.
2. **CSS variable name** — `--AIPM-green` (in `globals.css :root`, scheme resolve output, boot keys,
   `public/themes/*.json` keys, scheme token registries).
3. **`@theme` map entry** — `--color-AIPM-green` (the Tailwind v4 declaration that generates the utility).

## Scope

**Rename (AIPM-<color> → ui-<color>):**

- All source `.tsx`/`.ts` className strings and `var(--AIPM-*)` references (~1637 refs / ~235 files).
- `src/app/globals.css`: `:root` var definitions, the `@theme` `--color-AIPM-*` map, and every internal
  `var(--AIPM-*)` reference.
- Scheme system: `scheme-tokens.ts` (`CORE_TOKENS`/`ADVANCED_TOKENS` token ids), `color-schemes.ts`
  (`DERIVED_TOKENS`, `VALID_TOKENS`), `scheme-apply.ts` (`STRUCTURAL_TOKENS` — none are AIPM-color, verify),
  boot key payloads in `boot-theme-script.ts`, and the resolved-map var names.
- `public/themes/AIPM.json` + `mockup.json`: rewrite every color-map KEY `--AIPM-*` → `--ui-*` (values
  unchanged; the theme's *display name* "AIPM"/"Dashboard" and file path stay).
- Palette guards: `shell-palette-guard` + `palette-chrome-sweep` allowed-palette literals.
- Every test asserting `AIPM-<color>` classes/tokens.
- Docs: AGENTS.md token/palette/landmine lines + all code comments + CHANGELOG/README historical prose;
  add a supersede note where the Phase-2 scheme mechanism is described.

**PROTECTED (must NOT be renamed):**

- `AIPM` (company/brand name in UI text, help content, the AIPM theme display name).
- `Acme` / `AIPM-consult.net` (GitLab host, emails, CI provenance).
- `public/themes/AIPM.json` filename and gallery entry `{ id: "AIPM", name: "AIPM" }` — this is the AIPM
  *theme* identity, still called AIPM.
- `AIPM-logo` / `AIPM-icon` (asset class/id names in `app-header.tsx`, `project-empty-state.tsx`,
  `manifest.webmanifest`) — not color tokens; auto-excluded because the codemod anchors to the 12 color
  suffixes.

## Codemod strategy

Anchor every replacement to the exact 12 color suffixes with a word boundary so non-color `AIPM-*`
strings (`AIPM-logo`, `AIPM-icon`) and unrelated tokens (`AIPM`, `Acme`) can never match.

**One anchored regex**, applied repo-wide over the tracked file set (excluding `.git`, `node_modules`,
`dist`/`.next`, `docs/baselines/*.json`, and generated fixtures unless they carry token names):

replace `AIPM-(dark-blue|green-strong|green|pink-strong|pink|purple-strong|purple|blue|white|dark-grey|
light-grey|medium-grey)` → `ui-\1`. This single pattern covers `bg-AIPM-green`, `--AIPM-green`,
`--color-AIPM-green` (the `color-` prefix survives untouched), and `[var(--AIPM-green)]` alike, because
the match starts at `AIPM-`.

Order the alternation longest-first (`green-strong` before `green`) so the `-strong` variants aren't
half-matched.

**Excluded from the sweep:** the protected set above. Confirm via a post-run grep that the only
remaining `AIPM-` strings are `AIPM-logo`, `AIPM-icon`, `AIPM.json`, `AIPM-consult`/`Acme`, and the
capital-`AIPM` display strings.

## Verification (the rename touches every color class → a miss is invisible to tsc)

- `npx tsc --noEmit` (0 errors)
- `npm run lint` (0)
- `npx vitest run` (all green; heavy color-assertion suites: color-schemes, scheme-tokens, scheme-apply,
  form-controls, absence-style, color-scheme-editor)
- `npm run size:check`, `npm run dup:check`
- `npx vitest run palette` (guards now enforce `ui-*`)
- `npm run build` (globals.css must compile — a stray `--AIPM-*` in a `var()` with no definition yields a
  broken value, not a build error, so also:)
- `npx playwright test e2e/a11y.spec.ts --project=chromium` — **full axe 80/80** across all 5
  scheme/theme combos; this is the real safety net for a missed class pair (wrong/blank color).
- Byte-check `count(b'\x00')==0` before every commit; NUL-scan the multi-file edits.
- Post-run residual grep: no unexpected `AIPM-<color>` remains.

## i18n

No new i18n keys (avoids the `i18n.de.ts` umlaut/CRLF hazard). Only the version-highlight key for the
release, added EN+DE via node utf8 write.

## Release

- Bump `src/app/version.ts` → 0.190.23, milestone "Pinsker".
- CHANGELOG entry; append `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` + EN/DE strings.
- Superpowers code review before the MR (standing rule).
- Push → MR (`glab api projects/<PROJECT_ID>`) → merge on green.

## Risks / landmines

- **Tailwind scans AGENTS.md.** The replace introduces no brackets or invalid chars, so it cannot break
  `globals.css` compilation. Still byte-verify the build after the AGENTS.md edit.
- **Longest-first alternation** is mandatory or `green-strong` → `ui-green-strong` breaks into
  `ui-green`-`strong`.
- **`--color-` prefix** in the `@theme` map must survive — the pattern starts at `AIPM-`, so `--color-AIPM-`
  correctly becomes `--color-ui-`.
- **Missed pair = invisible.** tsc/lint/vitest can all pass while a color renders wrong; the axe full run
  + a manual eye-check of one screen per scheme is the backstop.
- **Protected collisions.** The suffix anchor protects `AIPM`/`Acme`/`AIPM-logo`; the post-run grep
  confirms it.
