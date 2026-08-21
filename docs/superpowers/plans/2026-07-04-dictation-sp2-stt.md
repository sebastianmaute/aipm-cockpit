# Push-to-Talk Dictation SP2 (OpenAI-compatible STT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second dictation engine — record audio, transcribe via an OpenAI-compatible endpoint — behind the SP1 `DictationEngine` seam, selectable in Settings, with a device-sealed key and an SSRF-guarded same-origin proxy.

**Architecture:** `stt-engine.ts` (MediaRecorder → `/api/stt`) implements `DictationEngine`; `dictation-config.ts` selects the engine from settings; the `/api/stt` route reuses `proxy-ssrf` and forwards multipart to the user's `{baseUrl}/audio/transcriptions`; `sttApiKey` is the 5th device-sealed `SecretId`; Settings gains the engine-picker + base-URL/model/key inputs.

**Tech Stack:** TypeScript, React 19, forked Next.js route handlers, MediaRecorder/getUserMedia, vitest. No new deps, **no new CSP host** (same-origin `/api/stt`).

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` · lint `npm run lint` · size `npm run size:check`. Security gate: `semgrep` runs in CI — the route must not log/echo the key.

★★ i18n.de.ts LANDMINE: node utf8 write (\uXXXX umlauts, CRLF); never Edit it.

---

## File Structure
- Modify `src/app/dictation-engine.ts` — add optional `onStatus` to `DictationHandlers`.
- Create `src/app/stt-engine.ts` — `createSttEngine(cfg)`.
- Create `src/app/dictation-config.ts` — `resolveDictationEngine(...)`.
- Modify `src/app/use-push-to-talk.ts` — engine selection + `transcribing` state.
- Create `src/app/api/stt/route.ts` + `src/app/api/stt/_helpers.ts` — the proxy.
- Modify `src/app/secrets.ts`, `src/app/secrets-store.ts`, `src/app/use-settings.ts` — `sttApiKey` lockstep.
- Modify `src/app/settings-types.ts` — `settings.dictation` gains `sttBaseUrl?`/`sttModel?`.
- Create/Modify a dictation settings section — engine picker + STT inputs; wire into `settings-view`/an existing section.
- Modify `src/app/chat-panel.tsx` — spinner while `transcribing`.
- Modify `src/app/i18n.ts` + `i18n.de.ts`.

---

## Task 1: onStatus handler (non-breaking)

**Files:** Modify `src/app/dictation-engine.ts`; Test `src/app/dictation-engine.test.ts`

- [ ] **Step 1:** Add the optional handler to `DictationHandlers`:
```ts
  onStatus?: (status: "transcribing" | "idle") => void; // STT-only; web-speech ignores it
```
- [ ] **Step 2:** No behavior change to assert beyond types — add a compile-level test: a `DictationHandlers` object without `onStatus` still satisfies the type (the existing web-speech-engine tests already prove this). Run `npx tsc --noEmit` → 0 (the existing `web-speech-engine.ts` compiles unchanged since `onStatus` is optional).
- [ ] **Step 3: Commit** `git add src/app/dictation-engine.ts && git commit -m "feat(dictation): optional onStatus handler for STT transcribing phase"`

---

## Task 2: stt-engine

**Files:** Create `src/app/stt-engine.ts` + `src/app/stt-engine.test.ts`

- [ ] **Step 1:** Implement `src/app/stt-engine.ts`:
```ts
import type { Lang } from "./i18n";
import type { DictationEngine, DictationHandlers } from "./dictation-engine";

export interface SttConfig { lang: Lang; baseUrl: string; model: string; apiKey: string; }

/** OpenAI-compatible STT engine: record with MediaRecorder, transcribe the clip
 *  via the same-origin /api/stt proxy on stop. No live interim. */
export function createSttEngine(cfg: SttConfig): DictationEngine {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let handlers: DictationHandlers | null = null;

  const cleanupStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  const transcribe = async (blob: Blob) => {
    handlers?.onStatus?.("transcribing");
    try {
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      form.append("model", cfg.model);
      form.append("baseUrl", cfg.baseUrl);
      const res = await fetch("/api/stt", { method: "POST", headers: { "x-stt-key": cfg.apiKey }, body: form });
      if (!res.ok) { handlers?.onError(`stt-${res.status}`); return; }
      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) handlers?.onFinal(data.text.trim());
    } catch {
      handlers?.onError("stt-network");
    } finally {
      handlers?.onStatus?.("idle");
    }
  };

  return {
    start(h) {
      handlers = h;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        h.onError("not-supported"); return false;
      }
      chunks = [];
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanupStream();
          const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
          if (blob.size === 0) { h.onStatus?.("idle"); return; }
          void transcribe(blob);
        };
        recorder.start();
      }).catch(() => { h.onError("not-allowed"); });
      return true; // async; mic-denied arrives via onError → hook resets
    },
    stop() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else cleanupStream();
      recorder = null;
    },
  };
}
```

- [ ] **Step 2:** Test `src/app/stt-engine.test.ts` (mock getUserMedia / MediaRecorder / fetch):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSttEngine } from "./stt-engine";

class FakeRecorder {
  state = "inactive"; mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); }
  stop() { this.state = "inactive"; this.onstop?.(); }
}
const track = { stop: vi.fn() };
const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));

beforeEach(() => {
  track.stop.mockClear();
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "hello" }) })));
});

const cfg = { lang: "en-US" as const, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: "sk-test" };

describe("stt-engine", () => {
  it("records, transcribes on stop, emits final + status", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    expect(eng.start(h)).toBe(true);
    await Promise.resolve(); await Promise.resolve(); // flush getUserMedia
    eng.stop();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // flush transcribe
    expect(h.onStatus).toHaveBeenCalledWith("transcribing");
    expect(h.onFinal).toHaveBeenCalledWith("hello");
    expect(h.onStatus).toHaveBeenLastCalledWith("idle");
    expect(track.stop).toHaveBeenCalled(); // mic released
  });
  it("reports not-allowed on getUserMedia reject", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    createSttEngine(cfg).start(h);
    await Promise.resolve(); await Promise.resolve();
    expect(h.onError).toHaveBeenCalledWith("not-allowed");
  });
  it("reports not-supported when MediaRecorder is absent", () => {
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    expect(createSttEngine(cfg).start(h)).toBe(false);
    expect(h.onError).toHaveBeenCalledWith("not-supported");
  });
  it("emits onError on a non-ok transcription response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg); eng.start(h);
    await Promise.resolve(); await Promise.resolve();
    eng.stop();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.onError).toHaveBeenCalledWith("stt-401");
  });
});
```

- [ ] **Step 3:** `npm run test:run -- stt-engine` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/stt-engine.ts src/app/stt-engine.test.ts && git commit -m "feat(dictation): OpenAI-compatible STT engine (record + transcribe)"`

---

## Task 3: /api/stt SSRF proxy

**Files:** Create `src/app/api/stt/route.ts` + `src/app/api/stt/_helpers.ts` + `src/app/api/stt/route.test.ts`

- [ ] **Step 1:** READ `src/app/api/timelog/route.ts` + `_helpers.ts` + `src/app/api/_shared/proxy-ssrf.ts` (exports `isPrivateHost(host)`). Mirror the timelog structure.

- [ ] **Step 2:** `src/app/api/stt/_helpers.ts`:
```ts
import { isPrivateHost } from "../_shared/proxy-ssrf";

const TIMEOUT_MS = 30_000;

export interface SttForward { url: string; key: string; form: FormData; }

/** Validate + build the upstream request from the incoming multipart form. */
export async function parseSttRequest(request: Request): Promise<{ fwd: SttForward } | { error: Response }> {
  const key = request.headers.get("x-stt-key") ?? "";
  if (!key) return { error: new Response("missing key", { status: 400 }) };
  let form: FormData;
  try { form = await request.formData(); } catch { return { error: new Response("bad form", { status: 400 }) }; }
  const file = form.get("file");
  const model = form.get("model");
  const baseUrl = String(form.get("baseUrl") ?? "");
  if (!(file instanceof Blob) || typeof model !== "string" || !baseUrl) {
    return { error: new Response("missing fields", { status: 400 }) };
  }
  let u: URL;
  try { u = new URL(baseUrl); } catch { return { error: new Response("bad baseUrl", { status: 400 }) }; }
  if (u.protocol !== "https:") return { error: new Response("https required", { status: 400 }) };
  if (isPrivateHost(u.hostname)) return { error: new Response("blocked host", { status: 400 }) };
  const upstream = new FormData();
  upstream.append("file", file, "audio.webm");
  upstream.append("model", model);
  const url = `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  return { fwd: { url, key, form: upstream } };
}

export async function callStt(fwd: SttForward): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(fwd.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${fwd.key}` },
      body: fwd.form,
      signal: controller.signal,
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "stt upstream failed" }), { status: 502, headers: { "content-type": "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}
```
NOTE: `new URL()` already rejects userinfo mixing; `isPrivateHost` is the core guard. Do NOT log `key` or the audio anywhere.

- [ ] **Step 3:** `src/app/api/stt/route.ts`:
```ts
import { parseSttRequest, callStt } from "./_helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseSttRequest(request);
  if ("error" in parsed) return parsed.error;
  return callStt(parsed.fwd);
}
```

- [ ] **Step 4:** Test `src/app/api/stt/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

function req(fields: Record<string, string>, key = "sk-test", withFile = true) {
  const form = new FormData();
  if (withFile) form.append("file", new Blob(["x"], { type: "audio/webm" }), "a.webm");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/stt", { method: "POST", headers: key ? { "x-stt-key": key } : {}, body: form });
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "hi" }), { status: 200, headers: { "content-type": "application/json" } }))));

describe("POST /api/stt", () => {
  it("blocks a private-IP baseUrl (SSRF)", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://192.168.0.1/v1" }));
    expect(res.status).toBe(400);
  });
  it("blocks a non-https baseUrl", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "http://api.openai.com/v1" }));
    expect(res.status).toBe(400);
  });
  it("400 when the key header is missing", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, ""));
    expect(res.status).toBe(400);
  });
  it("forwards to {baseUrl}/audio/transcriptions with Bearer key", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
    expect(res.status).toBe(200);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });
});
```

- [ ] **Step 5:** `npm run test:run -- api/stt` (or `stt`) → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0. (`new URL()` already rejects malformed URLs + splits userinfo, so `isPrivateHost` + the https check are the guards.)
- [ ] **Step 6: Commit** `git add src/app/api/stt/ && git commit -m "feat(dictation): SSRF-guarded /api/stt transcription proxy"`

---

## Task 4: sttApiKey secret (6-edit lockstep)

**Files:** Modify `src/app/secrets.ts`, `src/app/secrets-store.ts`, `src/app/use-settings.ts`; extend `src/app/use-settings.secrets.test.ts`

- [ ] **Step 1:** This follows the DOCUMENTED lockstep for adding a `SecretId` (see AGENTS.md "Adding a SecretId means SIX edits"). Use `timelogApiToken` as the exact template — grep every occurrence and add a sibling `sttApiKey` at each:
```bash
grep -rn "timelogApiToken" src/app/secrets.ts src/app/secrets-store.ts src/app/use-settings.ts
```
For EACH site, add the parallel `sttApiKey` handling:
  1. `secrets.ts`: add `| "sttApiKey"` to the `SecretId` union. If there's a hardcoded id array/allowlist used by `isSealedSecret`/id iteration, add `"sttApiKey"`.
  2. `secrets-store.ts`: if `readStore`/any loop iterates a hardcoded id list, add `"sttApiKey"`.
  3. `use-settings.ts`: mirror `timelogApiToken` in `migratePlaintextSecrets` (seal + return), `writeSettings` (BLANK the plaintext before persist), `hydrateSecretsInto` (restore into memory), and the load-effect migrate/hydrate/re-merge block. `sttApiKey` lives under `settings.dictation` (add a `sttApiKey?` plaintext-in-memory field there that `writeSettings` blanks — mirror where `timelog.apiToken` sits).

- [ ] **Step 2:** TEST — extend `src/app/use-settings.secrets.test.ts` (or `secrets-store.test.ts`): assert `sttApiKey` seals, hydrates into memory, and is BLANKED by `writeSettings` (never written plaintext to `localStorage["lop-app:settings"]`) — mirror the existing `timelogApiToken` assertions exactly.

- [ ] **Step 3:** `npx tsc --noEmit` → 0; `npm run test:run -- use-settings secrets` → PASS; `npm run lint` → 0. Grep to CONFIRM no site still lists only the old 4 ids where 5 are needed.
- [ ] **Step 4: Commit** `git add src/app/secrets.ts src/app/secrets-store.ts src/app/use-settings.ts src/app/use-settings.secrets.test.ts && git commit -m "feat(dictation): sttApiKey device-sealed secret (6-edit lockstep)"`

---

## Task 5: settings.dictation config + engine resolver

**Files:** Modify `src/app/settings-types.ts` + `use-settings.ts` sanitizer; Create `src/app/dictation-config.ts` + `src/app/dictation-config.test.ts`

- [ ] **Step 1:** Extend the `dictation` shape in `settings-types.ts`:
```ts
  dictation?: { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string };
```
(`sttApiKey` is the in-memory plaintext field blanked by `writeSettings` per Task 4.) In the load sanitizer, coerce `sttBaseUrl`/`sttModel` to trimmed strings (cap length ~500) and keep the engine coercion from SP1.

- [ ] **Step 2:** Create `src/app/dictation-config.ts`:
```ts
import type { Lang } from "./i18n";
import type { DictationEngine } from "./dictation-engine";
import { createWebSpeechEngine } from "./web-speech-engine";
import { createSttEngine } from "./stt-engine";

interface DictationSettings { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string }

/** Pick the engine from settings. STT only when fully configured; else web-speech. */
export function resolveDictationEngine(d: DictationSettings | undefined, lang: Lang): DictationEngine {
  if (d?.engine === "stt" && d.sttBaseUrl?.trim() && d.sttApiKey?.trim()) {
    return createSttEngine({ lang, baseUrl: d.sttBaseUrl.trim(), model: d.sttModel?.trim() || "whisper-1", apiKey: d.sttApiKey.trim() });
  }
  return createWebSpeechEngine(lang);
}
```

- [ ] **Step 3:** Test `src/app/dictation-config.test.ts` (mock both engines):
```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "ws" })) }));
vi.mock("./stt-engine", () => ({ createSttEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "stt" })) }));
import { resolveDictationEngine } from "./dictation-config";

describe("resolveDictationEngine", () => {
  it("uses web-speech by default", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US") as { _kind: string })._kind).toBe("ws");
  });
  it("uses stt when fully configured", () => {
    expect((resolveDictationEngine({ engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" }, "en-US") as { _kind: string })._kind).toBe("stt");
  });
  it("falls back to web-speech when stt is unconfigured", () => {
    expect((resolveDictationEngine({ engine: "stt" }, "en-US") as { _kind: string })._kind).toBe("ws");
  });
});
```

- [ ] **Step 4:** `npm run test:run -- dictation-config settings` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/settings-types.ts src/app/use-settings.ts src/app/dictation-config.ts src/app/dictation-config.test.ts && git commit -m "feat(dictation): settings STT config + engine resolver"`

---

## Task 6: use-push-to-talk engine selection + transcribing

**Files:** Modify `src/app/use-push-to-talk.ts` + `src/app/use-push-to-talk.test.ts`

- [ ] **Step 1:** Change the hook to build its engine via `resolveDictationEngine` and expose `transcribing`. Add to `Args`: `dictation?: { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string }`. Replace `engine()`'s `createWebSpeechEngine(lang)` with `resolveDictationEngine(dictation, lang)`; rebuild when `lang` OR the dictation config changes (compare a stable key, e.g. `JSON.stringify({engine, sttBaseUrl, sttModel, hasKey: !!sttApiKey})`). Add `const [transcribing, setTranscribing] = useState(false)` and pass `onStatus: (s) => setTranscribing(s === "transcribing")` into `engine().start({...})`. Return `transcribing` in the hook result. Keep the SP1 unmount cleanup + terminal-error reset.

- [ ] **Step 2:** TEST — extend `use-push-to-talk.test.ts`: with the web-speech-engine + stt-engine mocked via `resolveDictationEngine` (mock `./dictation-config`), assert `transcribing` flips true on `onStatus("transcribing")` and false on `"idle"`; existing hold/tap/terminal tests still pass. Mock `./dictation-config` `resolveDictationEngine` to return the existing `{ start, stop }` spy so the SP1 tests keep working.

- [ ] **Step 3:** `npm run test:run -- use-push-to-talk` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/use-push-to-talk.ts src/app/use-push-to-talk.test.ts && git commit -m "feat(dictation): select engine from settings + transcribing state"`

---

## Task 7: Settings UI (engine picker + STT config) + chat spinner + i18n

**Files:** Modify a dictation settings section (create `src/app/settings-sections/dictation-section.tsx` and mount it, mirroring how `AppearanceSection` is registered) + `settings-view.tsx`; Modify `src/app/chat-panel.tsx`; Modify `src/app/i18n.ts` + `i18n.de.ts`

- [ ] **Step 1:** i18n keys — EN (`i18n.ts`):
```ts
  dictationEngine: "Dictation engine",
  dictationEngineWebSpeech: "Browser (Web Speech)",
  dictationEngineStt: "Cloud (OpenAI-compatible)",
  dictationSttBaseUrl: "Transcription endpoint base URL",
  dictationSttModel: "Model",
  dictationSttKey: "API key",
  dictationSttNote: "Audio is sent to the endpoint you configure here.",
  dictationTranscribing: "Transcribing…",
  dictationTranscribeFailed: "Transcription failed — check the endpoint, model, and key.",
```
DE (`i18n.de.ts`, node utf8 write):
```
  dictationEngine: "Diktier-Engine",
  dictationEngineWebSpeech: "Browser (Web Speech)",
  dictationEngineStt: "Cloud (OpenAI-kompatibel)",
  dictationSttBaseUrl: "Basis-URL des Transkriptionsdienstes",
  dictationSttModel: "Modell",
  dictationSttKey: "API-Schlüssel",
  dictationSttNote: "Audio wird an den hier konfigurierten Dienst gesendet.",
  dictationTranscribing: "Transkribiere …",
  dictationTranscribeFailed: "Transkription fehlgeschlagen — prüfen Sie Endpunkt, Modell und Schlüssel.",
```

- [ ] **Step 2:** Create `src/app/settings-sections/dictation-section.tsx`: a `SegmentedControl<"web-speech"|"stt">` (mirror the `AppearanceSection` density control) bound to `settings.dictation.engine` (via `onChange`/`setSettings`→`writeSettings`); when `stt`, render labeled inputs for base URL (`sttBaseUrl`) + model (`sttModel`, placeholder `whisper-1`) + a password-type key input that calls `saveSecretValue("sttApiKey", value, "device")` on blur (mirror the AI-key field in `ai-section.tsx`, incl. discard-on-blur-if-blank) + the `dictationSttNote`. All inputs `aria-label`/labeled (Settings is axe-scanned). Register the section in `settings-view.tsx` (SectionId union + RAIL + render), mirroring how the diagnostics section was added.

- [ ] **Step 3:** In `chat-panel.tsx`: thread `settings.dictation` into `usePushToTalk({..., dictation: settings.dictation})`; show the transcribing spinner — when `ptt.transcribing`, render `{t(lang, "dictationTranscribing")}` in the preview line (reuse the interim preview slot), and on `onError` starting with `"stt-"` show `showToast("error", t(lang, "dictationTranscribeFailed"))`.

- [ ] **Step 4:** `npx tsc --noEmit` → 0 (i18n parity); `npm run test:run -- i18n-encoding settings-view dictation chat-panel` → PASS; `npm run lint` → 0; `npm run size:check` → ok; axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → pass (labeled inputs).
- [ ] **Step 5: Commit** `git add src/app/settings-sections/dictation-section.tsx src/app/settings-view.tsx src/app/chat-panel.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(dictation): settings engine picker + STT config + chat transcribing state"`

---

## Final verification (before finishing the branch)
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] **Security:** grep the route + engine for any `console.*`/log of the key or audio (none). Confirm `sttApiKey` ciphertext is OUT of exports/Turso/recovery `CONFIG_KEYS` (grep). Confirm no new host in `src/proxy.ts` (same-origin `/api/stt`).
- [ ] Manual smoke: Settings → pick Cloud engine, set a base URL + key → hold mic in chat → speak → release → "Transcribing…" → text inserted. Private-IP base URL → transcription-failed toast (SSRF 400).

Then follow **superpowers:finishing-a-development-branch**.
