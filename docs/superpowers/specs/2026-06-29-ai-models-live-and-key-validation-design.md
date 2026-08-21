# AI Models (live `/v1/models`) + API-Key Validation — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Branch:** `fix-ai-model-registry` (already holds the `CHAT_MODELS` registry refactor, commit 7114ef8e)

## Problem

1. The AI-assistant model dropdown was hard-coded and drifted (showed Opus 4.7 while current is 4.8). The registry refactor (commit 7114ef8e) made it a single source of truth, but it still requires a manual edit per model release.
2. The Anthropic API-key field accepts any string, including obvious garbage, and silently persists it.

## Goals

- **A — Live models:** populate the dropdown from the Anthropic `GET /v1/models` endpoint when a key is configured, auto-showing every current `claude-*` model with its real `display_name`. Registry remains the offline/no-key fallback.
- **B — Key validation:** reject malformed Anthropic keys on entry, discard them, and surface a toast.

## Non-Goals

- No server-side proxy for `/v1/models` (browser-direct, mirrors `chat-api.ts`).
- No live auth ("does this key actually work?") gate on the key field. A `/v1/models` 401 stays silent — a transient/quota 401 must not auto-discard a format-valid key. (Distinct from format invalidity, which IS discarded.)
- No model "tier" grouping (the API returns no tier).

## Part A — Live model dropdown (augment mode)

### Type change
`ChatModel` becomes `string` (the registry ids stay as named constants + the default). Rationale: augment mode lets the user select any live `claude-*` id, so the type can no longer be a closed union.

### Sanitize change
`sanitizeAiConfig` validates `model` with a **pattern**, not the registry allowlist:
- Accept `obj.model` when it is a string matching `/^claude-[\w.-]+$/` and ≤ 64 chars; else fall back to `defaultAiConfig.model` (`"claude-sonnet-4-6"`).
- Reason: sanitize runs at load, before the async live fetch — a pattern lets a previously-selected live model persist across reloads instead of resetting every time. Worst case an invalid id reaches the API, which already errors gracefully.

### Pure builder — `buildModelOptions`
New pure i18n-free function (in `chat-models.ts`):
```ts
export interface ModelOption { id: string; label: string; }
export interface LiveModel { id: string; display_name?: string; created_at?: string; }

export function buildModelOptions(
  registry: ReadonlyArray<{ id: string; label: string }>,
  liveModels: readonly LiveModel[],
  currentId: string,
): ModelOption[];
```
Behavior:
- Filter `liveModels` to `id.startsWith("claude-")`.
- If the filtered live list is non-empty: map to `{ id, label: display_name || id }`, sorted by `created_at` desc (missing/invalid `created_at` sort last, stable by id).
- Else (empty/no fetch): use the registry as-is (its order).
- **Always include `currentId`**: if `currentId` is non-empty and not already in the result, prepend an option `{ id: currentId, label: <registry label if known, else currentId> }` so the `<select>` is never blank/desynced.
- De-dupe by id (first wins).

### Hook — `useChatModels`
New hook (in `use-chat-models.ts`):
```ts
export function useChatModels(apiKey: string, enabled: boolean, currentId: string): ModelOption[];
```
- When `enabled && apiKey.trim()` matches the key format: `fetch("https://api.anthropic.com/v1/models?limit=1000", { headers: { "x-api-key": apiKey.trim(), "anthropic-version": ANTHROPIC_VERSION, "anthropic-dangerous-direct-browser-access": "true" } })`. `ANTHROPIC_VERSION` is exported from `chat-api.ts` (currently module-private — export it).
- Parse `{ data: LiveModel[] }`; ignore pagination (`limit=1000` covers all current models; `has_more` is not followed).
- Memoize the live list in state; refetch when `apiKey` changes (effect dep on the trimmed key + enabled). AbortController to cancel a stale in-flight fetch on key change/unmount.
- On any failure (network, non-2xx, parse): keep live list empty → builder returns the registry. **Silent** — no toast, no console of key/body. Errors carry only an HTTP status digit if surfaced at all (mirrors `chat-api.ts` discipline).
- Returns `buildModelOptions(CHAT_MODELS, liveList, currentId)` (memoized on `[liveList, currentId]`).
- Guard `react-hooks` rules: no `set-state-in-effect` violation — the fetch effect sets the live list via the async resolution (allowed: it is an async side-effect, not a synchronous render-phase setState). Dep array holds hoisted scalar locals (trimmed key, enabled), not `obj.member`.

### Surface
`ai-section.tsx`:
- `const modelOptions = useChatModels(settings.ai.apiKey, settings.ai.enabled === true, settings.ai.model);`
- Dropdown maps `modelOptions` instead of `CHAT_MODELS`.

## Part B — API-key validation + discard + toast

### Pure validator — `isValidAnthropicApiKey`
In `chat-models.ts` (or a small `anthropic-key.ts`; co-locate with the model code):
```ts
export function isValidAnthropicApiKey(key: string): boolean;
```
- `const k = key.trim();` → `/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(k)`.
- Empty string returns `false` from the regex, but the **caller treats empty as "allowed / not invalid"** (clearing the key is legitimate). The validator is purely the format test; the empty-is-OK policy lives in the caller.

### Surface wiring (`ai-section.tsx`)
- `const showToast = useToastContext();`
- `handleApiKeyChange(value)`: still updates in-memory (`onChange`), but only seals device-wrapped when `isValidAnthropicApiKey(value)` (no sealing partial/garbage per keystroke):
  ```ts
  function handleApiKeyChange(value: string) {
    onChange({ ...settings, ai: { ...settings.ai, apiKey: value } });
    if (keyWrap === "device" && isValidAnthropicApiKey(value)) {
      void saveSecretValue("anthropicApiKey", value, "device").then(() => setKeyStored(true));
    }
  }
  ```
- Key `<input>` gets `onBlur`: if the trimmed value is non-empty AND not valid → `showToast("error", t(lang, "aiKeyInvalid"))` and **discard**:
  ```ts
  onBlur={() => {
    const k = settings.ai.apiKey.trim();
    if (k && !isValidAnthropicApiKey(k)) {
      showToast("error", t(lang, "aiKeyInvalid"));
      onChange({ ...settings, ai: { ...settings.ai, apiKey: "" } });
      removeSealed("anthropicApiKey");
      setKeyStored(false);
    }
  }}
  ```
- `handleLockConfirm` (passphrase save): guard at the top — if `!isValidAnthropicApiKey(settings.ai.apiKey)` → `showToast("error", t(lang,"aiKeyInvalid"))` and `return` (don't seal).

### i18n
New key `aiKeyInvalid`, EN + DE:
| Key | EN | DE |
|---|---|---|
| `aiKeyInvalid` | `That doesn't look like a valid Anthropic API key (sk-ant-…). It was not saved.` | `Das sieht nicht wie ein gültiger Anthropic-API-Schlüssel aus (sk-ant-…). Er wurde nicht gespeichert.` |

DE via node utf8 write (the `i18n.de.ts` corruption landmine; `gültiger`/`Schlüssel` carry umlauts; the `…` ellipsis is a non-ASCII char — write via node, verify). Parity via `npx tsc --noEmit`.

## Testing

- **`chat-models.test.ts`** (pure): `buildModelOptions` — live list maps + sorts by created_at desc; empty live → registry; `currentId` always present (prepended when absent); claude- filter drops non-claude ids; de-dupe. `isValidAnthropicApiKey` — accepts `sk-ant-` + ≥16 charset; rejects empty, wrong prefix, too-short, illegal chars, whitespace-only.
- **`use-chat-models.test.tsx`**: mocked `fetch` — success returns mapped+sorted options incl. a model not in the registry; non-2xx / network error → registry-only options (no throw, no toast); no fetch when key absent or `enabled` false; the request carries the three headers and never appears in any thrown message.
- **`ai-section.test.tsx`** (or the relevant settings test): blur with an invalid non-empty key → `showToast("error", …)` called + apiKey blanked; blur with a valid key → no toast, value kept; blur with empty → no toast.
- `npx tsc --noEmit` (i18n parity + the `ChatModel` widening compiles across all consumers), `npm run lint`, `npm run test:run`.

## Acceptance

- With a valid key configured, the dropdown lists current `claude-*` models by `display_name`, newest first; offline/no-key shows the registry; the selected model is always visible.
- A malformed key typed into the field is discarded on blur with a toast; a well-formed key persists.
- No key/token/body is ever logged or thrown.
- All gates green.
