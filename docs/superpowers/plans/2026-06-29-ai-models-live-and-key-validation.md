# AI Models (live) + API-Key Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the AI model dropdown live from Anthropic `GET /v1/models` (registry as fallback), and validate/discard malformed API keys with a toast.

**Architecture:** A pure module (`chat-models.ts`) holds the option builder + key validator; a hook (`use-chat-models.ts`) does the browser-direct fetch and returns built options; `ai-section.tsx` consumes both. `ChatModel` widens to `string`; sanitize switches to a pattern. Branch: `fix-ai-model-registry` (already has the `CHAT_MODELS` registry).

**Tech Stack:** Forked Next.js 16 / React 19 / TS / Vitest + Testing Library. `npx tsc --noEmit` (typecheck + i18n EN/DE parity), `npm run lint` (`--max-warnings=0`), `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-29-ai-models-live-and-key-validation-design.md`

---

## File Structure

- **Create** `src/app/chat-models.ts` — pure `buildModelOptions`, `isValidAnthropicApiKey`, `ModelOption`/`LiveModel` types.
- **Create** `src/app/chat-models.test.ts`.
- **Create** `src/app/use-chat-models.ts` — the fetch hook.
- **Create** `src/app/use-chat-models.test.tsx`.
- **Modify** `src/app/settings-types.ts` — `ChatModel` → `string`; pattern sanitize.
- **Modify** `src/app/chat-api.ts` — export `ANTHROPIC_VERSION`.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — `aiKeyInvalid`.
- **Modify** `src/app/settings-sections/ai-section.tsx` — dropdown from hook; key blur/discard/toast; seal-gate; lock-confirm guard.
- **Modify** `src/app/settings-sections/ai-section.test.tsx` (create if absent) — blur-discard-toast tests.

---

## Task 1: Pure model-options builder + key validator

**Files:**
- Create: `src/app/chat-models.ts`
- Test: `src/app/chat-models.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/chat-models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildModelOptions, isValidAnthropicApiKey, type LiveModel } from "./chat-models";

const REG = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
] as const;

describe("buildModelOptions", () => {
  it("maps live models, newest first, using display_name", () => {
    const live: LiveModel[] = [
      { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" },
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-06-01T00:00:00Z" },
    ];
    const opts = buildModelOptions(REG, live, "claude-sonnet-4-6");
    expect(opts.map((o) => o.id)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
    expect(opts[0].label).toBe("Claude Opus 4.8");
  });

  it("falls back to label=id when display_name missing", () => {
    const opts = buildModelOptions(REG, [{ id: "claude-x", created_at: "2026-01-01T00:00:00Z" }], "claude-x");
    expect(opts[0]).toEqual({ id: "claude-x", label: "claude-x" });
  });

  it("filters out non-claude ids", () => {
    const live: LiveModel[] = [
      { id: "gpt-4", display_name: "GPT 4", created_at: "2026-01-01T00:00:00Z" },
      { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2025-01-01T00:00:00Z" },
    ];
    const opts = buildModelOptions(REG, live, "claude-opus-4-8");
    expect(opts.map((o) => o.id)).toEqual(["claude-opus-4-8"]);
  });

  it("uses the registry when the live list is empty", () => {
    const opts = buildModelOptions(REG, [], "claude-sonnet-4-6");
    expect(opts.map((o) => o.id)).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
  });

  it("always includes currentId, prepended when absent from live", () => {
    const live: LiveModel[] = [{ id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" }];
    const opts = buildModelOptions(REG, live, "claude-legacy-9");
    expect(opts[0]).toEqual({ id: "claude-legacy-9", label: "claude-legacy-9" });
    expect(opts.some((o) => o.id === "claude-opus-4-8")).toBe(true);
  });

  it("does not duplicate currentId when already present", () => {
    const live: LiveModel[] = [{ id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" }];
    const opts = buildModelOptions(REG, live, "claude-opus-4-8");
    expect(opts.filter((o) => o.id === "claude-opus-4-8")).toHaveLength(1);
  });

  it("ignores an empty currentId", () => {
    const opts = buildModelOptions(REG, [], "");
    expect(opts.every((o) => o.id !== "")).toBe(true);
  });
});

describe("isValidAnthropicApiKey", () => {
  it("accepts a well-formed sk-ant key", () => {
    expect(isValidAnthropicApiKey("sk-ant-api03-AbC123_def-456GHI789jkl")).toBe(true);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(isValidAnthropicApiKey("  sk-ant-api03-AbC123_def-456GHI789jkl  ")).toBe(true);
  });
  it("rejects empty / whitespace", () => {
    expect(isValidAnthropicApiKey("")).toBe(false);
    expect(isValidAnthropicApiKey("   ")).toBe(false);
  });
  it("rejects the wrong prefix", () => {
    expect(isValidAnthropicApiKey("sk-1234567890123456")).toBe(false);
  });
  it("rejects too-short keys", () => {
    expect(isValidAnthropicApiKey("sk-ant-short")).toBe(false);
  });
  it("rejects illegal characters", () => {
    expect(isValidAnthropicApiKey("sk-ant-aaaaaaaaaaaaaaaa!@#$")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/app/chat-models.test.ts`
Expected: FAIL — `Failed to resolve import "./chat-models"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/chat-models.ts`:

```ts
// src/app/chat-models.ts
//
// Pure, i18n-free helpers for the AI model picker + API-key validation.
// `buildModelOptions` merges the live Anthropic /v1/models result onto the
// curated CHAT_MODELS registry (augment mode: show every live claude-* model,
// newest first, registry as the offline fallback). `isValidAnthropicApiKey` is
// a pure FORMAT check — empty-is-allowed policy lives in the caller.

export interface ModelOption {
  id: string;
  label: string;
}

/** Subset of an Anthropic /v1/models entry we consume. */
export interface LiveModel {
  id: string;
  display_name?: string;
  created_at?: string;
}

function createdAtMs(m: LiveModel): number {
  const t = m.created_at ? Date.parse(m.created_at) : NaN;
  return Number.isNaN(t) ? -Infinity : t; // missing/invalid sort last
}

/** Build the dropdown option list. Live claude-* models (newest first) when
 *  present, else the registry; the current selection is always included. */
export function buildModelOptions(
  registry: ReadonlyArray<{ id: string; label: string }>,
  liveModels: readonly LiveModel[],
  currentId: string,
): ModelOption[] {
  const claude = liveModels.filter((m) => m.id.startsWith("claude-"));
  const base: ModelOption[] =
    claude.length > 0
      ? [...claude]
          .sort((a, b) => createdAtMs(b) - createdAtMs(a) || a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: m.display_name || m.id }))
      : registry.map((r) => ({ id: r.id, label: r.label }));

  const seen = new Set<string>();
  const out: ModelOption[] = [];
  // Ensure the current selection is present (prepended if the live list lacks it).
  if (currentId && !base.some((o) => o.id === currentId)) {
    const known = registry.find((r) => r.id === currentId);
    out.push({ id: currentId, label: known ? known.label : currentId });
    seen.add(currentId);
  }
  for (const o of base) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/** FORMAT-only validity of an Anthropic API key (sk-ant-… + >=16 id chars). */
export function isValidAnthropicApiKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key.trim());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/chat-models.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (ignore unrelated pre-existing errors).
```bash
git add src/app/chat-models.ts src/app/chat-models.test.ts
git commit -m "feat(ai): pure model-options builder + Anthropic key validator"
```
Do NOT push. No attribution trailers.

---

## Task 2: Widen `ChatModel` to string + pattern sanitize

**Files:**
- Modify: `src/app/settings-types.ts`

- [ ] **Step 1: Widen the type**

In `src/app/settings-types.ts`, replace:
```ts
export type ChatModel = (typeof CHAT_MODELS)[number]["id"];
```
with:
```ts
// Open string: augment mode (use-chat-models) lets the user pick any live
// claude-* id, not just the curated CHAT_MODELS. The registry ids remain the
// known-good defaults + offline fallback.
export type ChatModel = string;
```
(Leave the `CHAT_MODELS` array and `defaultAiConfig.model` unchanged.)

- [ ] **Step 2: Switch sanitize to a pattern check**

In `sanitizeAiConfig`, replace the current model-resolution block:
```ts
  const model: ChatModel = CHAT_MODELS.some((m) => m.id === obj.model)
    ? (obj.model as ChatModel)
    : defaultAiConfig.model;
```
with:
```ts
  // Pattern (not allowlist): sanitize runs at load, BEFORE the async live-model
  // fetch, so a previously-selected live model must survive the round-trip.
  const rawModel = typeof obj.model === "string" ? obj.model.trim() : "";
  const model: ChatModel =
    rawModel.length <= 64 && /^claude-[\w.-]+$/.test(rawModel)
      ? rawModel
      : defaultAiConfig.model;
```

- [ ] **Step 3: Typecheck — confirm all consumers still compile**

Run: `npx tsc --noEmit`
Expected: no errors. The widening is a superset, so existing `ChatModel` consumers (chat-api, next-actions-section, ai-usage) compile unchanged. If a consumer relied on the union being closed (e.g. an exhaustive switch), report it as DONE_WITH_CONCERNS — none is expected.

- [ ] **Step 4: Run the settings tests + commit**

Run: `npm run test:run -- settings-types ai-usage chat-panel`
Expected: PASS.
```bash
git add src/app/settings-types.ts
git commit -m "refactor(ai): widen ChatModel to string; pattern-validate model on load"
```

---

## Task 3: `useChatModels` fetch hook

**Files:**
- Modify: `src/app/chat-api.ts` (export `ANTHROPIC_VERSION`)
- Create: `src/app/use-chat-models.ts`
- Test: `src/app/use-chat-models.test.tsx`

- [ ] **Step 1: Export `ANTHROPIC_VERSION` from `chat-api.ts`**

In `src/app/chat-api.ts`, change:
```ts
const ANTHROPIC_VERSION = "2023-06-01";
```
to:
```ts
export const ANTHROPIC_VERSION = "2023-06-01";
```

- [ ] **Step 2: Write the failing test**

Create `src/app/use-chat-models.test.tsx`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChatModels } from "./use-chat-models";

afterEach(() => vi.restoreAllMocks());

const KEY = "sk-ant-api03-AbC123_def-456GHI789jkl";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe("useChatModels", () => {
  it("returns live claude models (newest first) when enabled with a valid key", async () => {
    mockFetchOnce({
      data: [
        { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-06-01T00:00:00Z" },
      ],
    });
    const { result } = renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    await waitFor(() => expect(result.current.map((o) => o.id)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]));
  });

  it("sends the three Anthropic headers", async () => {
    const spy = mockFetchOnce({ data: [] });
    renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("falls back to the registry on a non-2xx response (no throw)", async () => {
    mockFetchOnce({}, false, 401);
    const { result } = renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    // Registry contains sonnet + opus 4.8; assert the selected one is present and nothing threw.
    await waitFor(() => expect(result.current.some((o) => o.id === "claude-sonnet-4-6")).toBe(true));
  });

  it("does not fetch when disabled or key absent/malformed", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderHook(() => useChatModels(KEY, false, "claude-sonnet-4-6"));
    renderHook(() => useChatModels("", true, "claude-sonnet-4-6"));
    renderHook(() => useChatModels("not-a-key", true, "claude-sonnet-4-6"));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:run -- src/app/use-chat-models.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-chat-models"`.

- [ ] **Step 4: Write the hook**

Create `src/app/use-chat-models.ts`:

```ts
// src/app/use-chat-models.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { ANTHROPIC_VERSION } from "./chat-api";
import { CHAT_MODELS } from "./settings-types";
import {
  buildModelOptions,
  isValidAnthropicApiKey,
  type LiveModel,
  type ModelOption,
} from "./chat-models";

/** Live model list for the picker. Fetches Anthropic /v1/models browser-direct
 *  when AI is enabled and the key is well-formed; on any failure returns the
 *  registry options. Never logs the key or response body. */
export function useChatModels(apiKey: string, enabled: boolean, currentId: string): ModelOption[] {
  const [live, setLive] = useState<readonly LiveModel[]>([]);
  const key = apiKey.trim();
  const shouldFetch = enabled && isValidAnthropicApiKey(key);

  useEffect(() => {
    if (!shouldFetch) {
      setLive([]);
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setLive([]);
          return;
        }
        const body = (await res.json()) as { data?: LiveModel[] };
        setLive(Array.isArray(body.data) ? body.data : []);
      } catch {
        // Network/parse/abort — silent fallback to the registry.
        setLive([]);
      }
    })();
    return () => ctrl.abort();
  }, [shouldFetch, key]);

  return useMemo(() => buildModelOptions(CHAT_MODELS, live, currentId), [live, currentId]);
}
```

Note: the effect sets state only inside the async resolution (an async side-effect, not a synchronous render-phase setState), so the `react-hooks/set-state-in-effect` ban does not apply. Deps are scalar locals (`shouldFetch`, `key`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/app/use-chat-models.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npm run lint` (ignore unrelated pre-existing errors; an unused import is fatal).
```bash
git add src/app/chat-api.ts src/app/use-chat-models.ts src/app/use-chat-models.test.tsx
git commit -m "feat(ai): useChatModels hook (live /v1/models, registry fallback)"
```

---

## Task 4: i18n `aiKeyInvalid` (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN key**

In `src/app/i18n.ts`, find the existing `aiApiKeyTooltip` line (search for `aiApiKeyTooltip:`). Add immediately after it:
```ts
  aiKeyInvalid: "That doesn't look like a valid Anthropic API key (sk-ant-…). It was not saved.",
```

- [ ] **Step 2: Add the DE key via node utf8 write (NOT the Edit tool)**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts (`gültiger`/`Schlüssel`) and the `…` ellipsis. The DE anchor line is `  aiApiKeyTooltip: "Ihr Anthropic-API-Schlüssel. Wird nur lokal in diesem Browser gespeichert.",` (verified present). Run from the repo root:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  aiApiKeyTooltip: \"Ihr Anthropic-API-Schlüssel. Wird nur lokal in diesem Browser gespeichert.\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add = "  aiKeyInvalid: \"Das sieht nicht wie ein gültiger Anthropic-API-Schlüssel aus (sk-ant-…). Er wurde nicht gespeichert.\",\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE key added");
'
```
Expected: `DE key added`. If `ANCHOR NOT FOUND`, STOP and report — re-grep the exact line, do not guess.

- [ ] **Step 3: Verify encoding + parity**

Run: `npm run test:run -- src/app/i18n-encoding` (PASS — bans ASCII umlaut subs).
Grep the new DE line: confirm it reads `gültiger` + `Schlüssel` with real umlauts (not `gueltiger`/`Schluessel`) and the `…` char is intact.
Run: `npx tsc --noEmit` (PASS — EN/DE parity).

- [ ] **Step 4: Commit**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add aiKeyInvalid toast string (EN/DE)"
```

---

## Task 5: Wire ai-section (live dropdown + key validation/discard/toast)

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Test: `src/app/settings-sections/ai-section.test.tsx` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

Verified facts: `AiSection` props are `{ lang, settings, onChange, operatingGuides?, hideUsage? }` — `operatingGuides`/`hideUsage` are OPTIONAL, so the test may omit them. `useIntegrationDisclaimer()` has a no-op default (no provider needed). `defaultSettings` is exported from `../settings-types`. The api-key input's placeholder is the literal string `"sk-ant-..."` (EN + DE identical), and it is the only field with that placeholder → use it as the selector.

Create `src/app/settings-sections/ai-section.test.tsx` (or append the `describe` if the file already exists):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiSection } from "./ai-section";
import { ToastProvider } from "../toast-context";
import { defaultSettings } from "../settings-types";

function renderAi(showToast = vi.fn()) {
  const onChange = vi.fn();
  const settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true } };
  render(
    <ToastProvider value={showToast}>
      <AiSection lang="en-US" settings={settings} onChange={onChange} />
    </ToastProvider>,
  );
  return { showToast, onChange };
}

describe("AiSection API-key validation", () => {
  it("discards an invalid key on blur and toasts", () => {
    const { showToast, onChange } = renderAi();
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "garbage-key" } });
    fireEvent.blur(input);
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("Anthropic"));
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall.ai.apiKey).toBe("");
  });

  it("keeps a valid key on blur with no toast", () => {
    const { showToast } = renderAi();
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "sk-ant-api03-AbC123_def-456GHI789jkl" } });
    fireEvent.blur(input);
    expect(showToast).not.toHaveBeenCalled();
  });
});
```

NOTE: if the component's `useChatModels` hook causes a `fetch` in jsdom during this test, it won't matter — the valid-key test triggers a fetch but the hook swallows failures, and `vi`'s default leaves `fetch` undefined → the hook's try/catch returns the registry. If an unhandled-rejection warning appears, stub `globalThis.fetch` in this test file's setup with `vi.spyOn(globalThis,"fetch").mockResolvedValue({ ok:false, status:401, json: async()=>({}) } as Response)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/settings-sections/ai-section.test.tsx`
Expected: FAIL (no blur handler / no toast yet).

- [ ] **Step 3: Wire the component**

In `src/app/settings-sections/ai-section.tsx`:

(a) Imports — add (merge with existing import lines; no duplicates):
```ts
import { useToastContext } from "../toast-context";
import { useChatModels } from "../use-chat-models";
import { buildModelOptions, isValidAnthropicApiKey } from "../chat-models";
```
(`buildModelOptions` may be unused here — only import what you use. You need `isValidAnthropicApiKey`, `useToastContext`, `useChatModels`. Drop `buildModelOptions` from the import if unused — an unused import is a fatal lint error.)

(b) Near the top of the component body, add:
```ts
  const showToast = useToastContext();
  const modelOptions = useChatModels(settings.ai.apiKey, settings.ai.enabled === true, settings.ai.model);
```

(c) Update `handleApiKeyChange` to seal only when the format is valid:
```ts
  function handleApiKeyChange(value: string) {
    onChange({ ...settings, ai: { ...settings.ai, apiKey: value } });
    if (keyWrap === "device" && isValidAnthropicApiKey(value)) {
      void saveSecretValue("anthropicApiKey", value, "device").then(() => setKeyStored(true));
    }
  }
```

(d) Add an `onBlur` to the api-key `<input>` (the one at `value={settings.ai.apiKey}`):
```tsx
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
(Confirm `removeSealed` is already imported in this file — it is used by `handleRemoveSecret`. If not, add it to the `use-secrets` import.)

(e) Guard `handleLockConfirm` — at the very top of its body, before `setSecretPassphrase`:
```ts
    if (!isValidAnthropicApiKey(settings.ai.apiKey)) {
      showToast("error", t(lang, "aiKeyInvalid"));
      return;
    }
```

(f) Replace the model dropdown's option source. Find:
```tsx
          {CHAT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
```
Replace with:
```tsx
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
```
If `CHAT_MODELS` is now unused in this file after the swap, remove it from the `settings-types` import (unused import = fatal lint). Keep `ChatModel` if still referenced by the `onChange` cast.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/settings-sections/ai-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (no unused imports, no warnings).

- [ ] **Step 6: Commit**
```bash
git add src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx
git commit -m "feat(ai-section): live model dropdown + validate/discard malformed key with toast"
```

---

## Task 6: Full-suite verification

- [ ] **Step 1: Full unit suite**

Run: `npm run test:run`
Expected: all green. If a test that renders `AiSection` (e.g. `ai-usage-panel.test`, `backend-setup-wizard.test`) now needs a `ToastProvider` wrapper or breaks on the new hook's fetch (jsdom has no real `fetch`), fix by wrapping in `ToastProvider` and/or mocking `globalThis.fetch` in that test's setup — do NOT change production code to accommodate a test. The hook already no-ops fetch when AI is disabled, so tests that leave `ai.enabled` falsy won't fetch.

- [ ] **Step 2: Typecheck + lint (final)**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Confirm footprint**

Run: `git diff --stat 7114ef8e..HEAD`
Expected only: `chat-models.ts(+test)`, `use-chat-models.ts(+test)`, `settings-types.ts`, `chat-api.ts`, `i18n.ts`, `i18n.de.ts`, `ai-section.tsx(+test)`. No `console.log`, no unrelated files.

---

## Out of scope / notes

- No `/v1/models` proxy (browser-direct, mirrors chat-api).
- Live 401 stays silent (no auto-discard on a format-valid key) — only format invalidity discards.
- No release/push/MR — only on the explicit "release" trigger.
