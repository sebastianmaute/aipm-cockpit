# Turso Unreachable Message + turso.tech Link + Settings Tooltips — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.28.0-turso-unreachable-and-tooltips`
**Release:** 0.28.0

## Context

Follow-up to 0.27.0 (convert-and-write on storage-format switch). Three user-requested improvements:

1. When switching to the Turso backend with **no server running** or **no database reachable**, the failure must behave like any other switch failure — **error toast, no switch, no data loss** — and the network-level error message must be clear instead of a raw `"Failed to fetch"`.
2. Add a link to `https://turso.tech/` in the Turso configuration section.
3. Add mouseover tooltips across the **whole Settings menu**, using a styled help-icon component.

## Confirmed decisions

- **Empty-but-reachable DB still auto-creates the schema and succeeds** (current behavior, unchanged). `save()` runs `CREATE TABLE IF NOT EXISTS …` inside its transaction (`turso-schema.ts` `workspaceToStatements`), so bootstrapping a fresh Turso DB through the app keeps working. Only genuinely *unreachable* targets (server down, connection refused, DNS failure, non-existent/unreachable cloud DB) error.
- **Tooltip mechanism:** a reusable styled `InfoTooltip` component (a small `ⓘ` affordance next to each field label, CSS hover bubble matching the design system, `aria-label` for accessibility), NOT bare native `title`. No reusable tooltip component exists today — prior control tooltips use the native `title` attribute. `InfoTooltip` is the first reusable tooltip component and keeps `title` as a native fallback, consistent with that convention.
- **Scope:** tooltips on every field across all Settings sections.

## Non-goals

- No change to the convert-and-write switch flow itself (0.27.0) beyond the error-message mapping.
- No change to the reachable/empty-DB auto-create behavior.
- No change to the 401-token-rejected or HTTP-non-2xx error paths (they keep their existing distinct messages).
- No retrofitting of existing native-`title` control tooltips to `InfoTooltip` (out of scope; Settings only).
- No new storage backends or new dependencies.

## Architecture

Three independent parts; Part 1 touches storage logic, Parts 2–3 are UI + i18n.

### Part 1 — Clear "unreachable" error

**`turso-backend.ts` (`runPipeline`):** wrap ONLY the `fetch()` call in a try/catch. The libSQL pipeline `fetch` rejects with a `TypeError` (`"Failed to fetch"` / `"fetch failed"`) when the server is down, the connection is refused, DNS fails, or a cloud host is unreachable. Map that rejection to:

```ts
let res: Response;
try {
  res = await fetch(`${this.config.httpUrl}/v2/pipeline`, { method: "POST", headers, body });
} catch {
  throw new StorageNotReadyError("storage-unreachable");
}
```

`StorageNotReadyError(hint: string)` already carries a hint token (existing tokens: `"local-file-permission-needed"`). `"storage-unreachable"` is a new token. The existing post-fetch paths are unchanged: `res.status === 401` → `StorageNotReadyError("…token rejected…")`; `!res.ok` → generic `Error("Turso returned <status>…")`; bad-shape / per-result `error` → generic `Error`.

**`use-storage-backend.ts` — two consumers map the hint:**

- `onRequestStorageSwitch` catch block: currently `if (err instanceof StorageNotReadyError) { const hint = err.hint; const key = hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" : "storageNotReady"; … }`. Extend to: `hint === "storage-unreachable"` → `"storageUnreachable"`. (Order: permission → unreachable → default `storageNotReady`.)
- Startup **load effect** catch block: same `StorageNotReadyError` hint→key mapping (currently maps `local-file-permission-needed` → `storagePermissionGestureNeeded`, else `storageNotReady`). Add the `storage-unreachable` → `storageUnreachable` branch so a down server on startup load shows the same clear message.

**Guarantee (already structurally true, reaffirmed):** in `onRequestStorageSwitch`, `args.setStorageConfig(newConfig)` is only reached after `target.save()` resolves. A `StorageNotReadyError` (or any throw) lands in the catch → toast only → config unchanged → controlled dropdown auto-reverts → in-memory workspace untouched. So "no server / no database" = error toast, no switch, no data loss.

**New i18n key:** `storageUnreachable`
| Key | EN | DE |
|---|---|---|
| `storageUnreachable` | "Storage unreachable — is the server running?" | "Speicher nicht erreichbar — läuft der Server?" |

### Part 2 — turso.tech link

In `settings-menu.tsx`, in the Turso integrations block next to `integrationsTursoHint` (~line 723), add an external link:

```tsx
<a
  href="https://turso.tech/"
  target="_blank"
  rel="noopener noreferrer"
  className="text-AIPM-dark-blue underline hover:opacity-80"
>
  {t(lang, "integrationsTursoLearnMore")}
</a>
```

Placed inline/after the hint paragraph. New i18n key:
| Key | EN | DE |
|---|---|---|
| `integrationsTursoLearnMore` | "Learn more about Turso ↗" | "Mehr über Turso erfahren ↗" |

### Part 3 — Settings tooltips (whole menu)

**New component `src/app/info-tooltip.tsx`** — `InfoTooltip`:

```tsx
interface InfoTooltipProps {
  text: string;        // already-translated tooltip text
  label?: string;      // accessible label; defaults to text
}
```

Renders a small `ⓘ` trigger (a `<button type="button">` with `aria-label`, focusable for keyboard) wrapping a CSS hover/focus bubble (Tailwind `group` + `group-hover`/`focus-within` pattern, design-system colors: `bg-surface`, `border-line`, `text-foreground`, small shadow, `text-xs`, `max-w-[…]`, positioned above/below, `role="tooltip"` on the bubble). `title={text}` as a native fallback. No JS state needed — pure CSS visibility on hover/focus-within. If `text` is empty, render nothing. Self-contained, independently testable.

**Wiring:** beside each field's label `<span>` across Settings sections, render `<InfoTooltip text={t(lang, "<field>Tooltip")} />`. Fields covered (each gets a `*Tooltip` i18n key, EN + DE):
- Language, Theme
- Storage format (storage-config section)
- M365: enable toggle, client ID, tenant ID, SharePoint toggle, Outlook contacts toggle, Outlook calendar toggle
- Turso: enable toggle, database URL, auth token
- Jira: each Jira settings field present in the menu
- Any other top-level Settings field (plan/budget/etc.) rendered directly in `settings-menu.tsx`

The exact field list is enumerated during planning by reading `settings-menu.tsx` + `storage-config.tsx`; the plan lists every key. `InfoTooltip` is placed next to the existing label `<span>`, not replacing it.

Note: `storage-config.tsx` receives the storage tooltip via its existing `lang` prop (it can call `t(lang, "storageTooltip")` directly); no new prop needed.

## Error handling

- Part 1: only the `fetch` rejection maps to `storage-unreachable`; post-response errors keep their semantics. No double-toast (switch handler shows exactly one toast per failure).
- Part 3: `InfoTooltip` is presentation-only; empty `text` renders nothing (no empty bubble).

## Testing

- **Part 1:** `turso-backend.test.ts` — mock `fetch` to reject (network error) → `save()`/`load()` throws `StorageNotReadyError` with hint `"storage-unreachable"`. `use-storage-backend.test.tsx` — `onRequestStorageSwitch` to turso with a rejecting `save` (StorageNotReadyError unreachable) → `showToast("error", …)` called with the `storageUnreachable` string, `setStorageConfig` NOT called (no switch, no data loss). Verify the load-effect mapping too if feasible.
- **Part 2:** `settings-menu.test.tsx` — Turso block renders a link with `href="https://turso.tech/"`, `target="_blank"`, `rel` containing `noopener`.
- **Part 3:** `info-tooltip.test.tsx` — renders the icon, exposes `aria-label`/text, renders the bubble text; empty text → nothing. A settings-menu smoke test asserting at least one `InfoTooltip` is present (light touch — don't assert every key).
- Gates: tsc 0, lint 0, full suite green. i18n.de.ts new keys verified ASCII `"` delimiters.

## Release

Minor → **0.28.0**. `version.ts` bump + top changelog comment + append `"versionHighlightStorageUnreachable"` to `APP_HIGHLIGHT_KEYS`. i18n EN/DE for all new keys (`storageUnreachable`, `integrationsTursoLearnMore`, the `*Tooltip` set, `versionHighlight*`). `CHANGELOG.md` `[0.28.0] "Jemisin"` — Added (turso.tech link, Settings field tooltips), Changed (clearer "storage unreachable" message on Turso network failure). No new deps.

## Plan shape (preview — writing-plans expands)

1. Part 1: `turso-backend.ts` fetch-reject → `StorageNotReadyError("storage-unreachable")`; map hint in both `use-storage-backend.ts` consumers; `storageUnreachable` i18n EN/DE. Tests.
2. Part 2: turso.tech link in `settings-menu.tsx` + `integrationsTursoLearnMore` i18n. Test.
3. Part 3a: `InfoTooltip` component + tests.
4. Part 3b: wire `InfoTooltip` + `*Tooltip` i18n keys (EN/DE) across all Settings fields.
5. Release 0.28.0 (version.ts, highlight key, CHANGELOG).
