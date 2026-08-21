# Push-to-Talk Dictation — SP2 (OpenAI-compatible STT) Design

**Goal:** Add a second dictation engine — an OpenAI-compatible speech-to-text endpoint (record → transcribe) — behind the SP1 `DictationEngine` seam, selectable in Settings, with a device-sealed API key and an SSRF-guarded proxy. No new CSP host.

**Context:** SP2 of sub-project C. SP1 (merged) shipped the push-to-talk UX, the `DictationEngine` interface, `web-speech-engine`, `use-push-to-talk`, and a `settings.dictation.engine` field (default `"web-speech"`; `"stt"` reserved for here). SP2 makes `"stt"` real.

**Approved decisions:** OpenAI-compatible endpoint (configurable **base URL** + **model**, default model `whisper-1`); device-sealed API key; same-origin `/api/stt` proxy reusing `proxy-ssrf`; **record-then-transcribe** (no live interim — a "transcribing…" state after release); engine-picker (deferred from SP1) lands here.

---

## Architecture

```
hold → getUserMedia + MediaRecorder(record) → release → audio Blob
  → POST multipart /api/stt { file, model, baseUrl, key(Bearer) }   (same-origin)
  → route: proxy-ssrf isPrivateHost() guard on baseUrl host
  → forward multipart → {baseUrl}/audio/transcriptions  (Authorization: Bearer key)
  → { text } → onFinal(text) → appendDictation → chat input
```

Uniform with SP1: the STT engine implements `DictationEngine`; the only interface change is an **optional** `onStatus` handler for the post-release transcribing phase (web-speech never calls it → back-compat).

## Components

### `dictation-engine.ts` (extend, non-breaking)
Add an OPTIONAL handler:
```ts
export interface DictationHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: string) => void;
  onStatus?: (status: "transcribing" | "idle") => void; // STT-only; web-speech ignores
}
```

### `stt-engine.ts`
`createSttEngine(cfg: { lang: Lang; baseUrl: string; model: string; apiKey: string }): DictationEngine`.
- `start(handlers)`: `navigator.mediaDevices.getUserMedia({ audio: true })` → on success create a `MediaRecorder`, collect chunks, `.start()`; return `true` optimistically. On `getUserMedia` reject → `handlers.onError("not-allowed")` and return `true` (so the hold UI clears via the hook's terminal-error reset) — actually return `false` when the recorder can't be created synchronously; since getUserMedia is async, return `true` and rely on `onError` (the hook resets listening on `"not-allowed"`). If `MediaRecorder`/`getUserMedia` is undefined → `onError("not-supported")`, return `false`.
- `stop()`: `recorder.stop()`; in `onstop`, `onStatus?.("transcribing")`, assemble the `Blob` (mime from the recorder, e.g. `audio/webm`), `POST` it to `/api/stt` as `multipart/form-data` (`file`, `model`, `baseUrl`, and the key in a header the route reads), then `onStatus?.("idle")` + `onFinal(text)` on success or `onError(code)` on failure. Stop all media tracks (`stream.getTracks().forEach(t => t.stop())`) so the mic light turns off. Idempotent.
- Guards against an empty/zero-length recording (no audio → skip the request, `onStatus?.("idle")`).

### `dictation-config.ts` (pure helper)
`resolveDictationEngine(settings, secrets, lang): DictationEngine` — returns `createSttEngine(...)` when `settings.dictation.engine === "stt"` AND `sttBaseUrl` + hydrated `sttApiKey` are present; else `createWebSpeechEngine(lang)`. Keeps `use-push-to-talk` thin and unit-testable. Model defaults to `"whisper-1"` when `sttModel` blank.

### `use-push-to-talk.ts` (modify — engine selection)
Replace the hardcoded `createWebSpeechEngine(lang)` with `resolveDictationEngine(...)` (via new args: `engine`/`sttConfig` or a passed factory). Add a `transcribing` state fed by `onStatus`, exposed in the return (`{ listening, transcribing, supported, buttonHandlers, toggle }`). The mic button shows a spinner while `transcribing`. The unmount-cleanup + terminal-error reset from SP1 already cover the STT engine (it maps mic-denied → `"not-allowed"`).

### `src/app/api/stt/route.ts` (+ `_helpers.ts`)
- `runtime = "nodejs"`. Accepts `POST` `multipart/form-data`: `file`, `model`, `baseUrl`; the API key in a header (e.g. `x-stt-key`, mirroring how timelog passes creds — NOT logged).
- **SSRF:** parse `baseUrl`, extract host; reject if `isPrivateHost(host)` (reuse `api/_shared/proxy-ssrf.ts`), reject non-`https:` (except allow `http://localhost`/loopback? NO — block per isPrivateHost), reject `:`/`@`/CRLF in host + `..`/CRLF in path (mirror timelog `_helpers`). No fixed-host allowlist (user-configured), so `isAllowedHostSuffix` is NOT used — `isPrivateHost` block is the guard. Own `"stt"` rate-limit scope.
- Forward the multipart (`file` + `model`) to `{baseUrl}/audio/transcriptions` with `Authorization: Bearer <key>`, a timeout (e.g. 30s — audio transcription is slower). Return the upstream JSON (`{ text }`) via a `forwardJsonResponse`-style helper. Never log/echo the key or audio.
- Same-origin from the browser → **no CSP change** needed (verify `src/proxy.ts` already permits same-origin `/api/*`; it does for jira/timelog).

### `sttApiKey` secret (5th `SecretId`) — the 6-edit lockstep
Follow the documented lockstep EXACTLY (see AGENTS.md "Adding a SecretId means SIX edits"):
1. `secrets.ts`: add `"sttApiKey"` to the `SecretId` union.
2. `secrets-store.ts`: ensure `readStore`'s allowlist loop + any hardcoded id list includes it.
3. `use-settings.ts`: `migratePlaintextSecrets` (seal + return), `writeSettings` BLANK (never persist the plaintext), `hydrateSecretsInto` restore, and the load-effect migrate/hydrate/re-merge block.
4. The settings UI field calls `saveSecretValue("sttApiKey", value, "device")` on edit.
`sttBaseUrl` + `sttModel` stay PLAINTEXT on `settings.dictation` (identifying, not secret) via the `writeSettings` spread. `sttApiKey` ciphertext stays OUT of exports/Turso/recovery `CONFIG_KEYS`.

### Settings — engine picker + STT config
In the dictation settings section (Appearance or a new "Voice/Dictation" area): a `SegmentedControl<"web-speech"|"stt">` (the SP1-deferred picker). When `stt`: text inputs for base URL + model (default `whisper-1`) + a sealed password-style key input (`saveSecretValue` on blur, mirrors the AI-key handling incl. discard-on-blur-if-invalid). Show a one-line note that audio is sent to the configured endpoint. Settings section is axe-scanned → labeled inputs.

## Data flow / boundary
- Audio Blob is transient (in-memory, POSTed, discarded — never persisted).
- New secret (`sttApiKey`, device-sealed) + new proxy route, but **no new CSP host**, no workspace-data change, no export/Turso surface for the audio or key.

## Error handling
- Mic denied → `onError("not-allowed")` → hook resets + toast (SP1 path).
- Unsupported (`MediaRecorder`/`getUserMedia` absent) → `onError("not-supported")` → button hidden/no-op.
- Proxy/transcription failure (bad key, unreachable endpoint, SSRF-blocked, non-2xx) → `onError` with a code → an error toast via the chat `onError` (reuse SP1's `reportCapabilityGap`/a new `dictationTranscribeFailed` message). Route returns a sanitized error (no key/audio).
- SSRF-blocked base URL → 400 from the route, surfaced as a transcription-failed toast.

## Testing
- **`stt-engine.test.ts`:** mock `navigator.mediaDevices.getUserMedia` + `MediaRecorder` + `fetch`. Assert: start records; mic-denied → `onError("not-allowed")`; stop → `onStatus("transcribing")` → fetch `/api/stt` multipart → `onFinal(text)`; fetch failure → `onError`; empty recording skipped; tracks stopped on stop.
- **`api/stt/route.test.ts` + `proxy-ssrf` reuse:** private-IP baseUrl → 400 (blocked); valid host → forwards multipart with Bearer; missing file/baseUrl → 400; key never in the response/logs.
- **`dictation-config.test.ts`:** stt selected + configured → stt engine; unconfigured/`"web-speech"` → web-speech.
- **secret round-trip:** `sttApiKey` seals/hydrates/blanks like the other 4 (extend `use-settings.secrets.test.ts` / `secrets-store.test.ts`).
- **settings coercion:** `sttBaseUrl`/`sttModel` sanitized; engine `"stt"` preserved.
- i18n EN/DE for the new keys (picker labels, base URL/model/key labels, `dictationTranscribeFailed`, transcribing status). Settings axe-scanned → labeled.

## Out of scope
- Streaming STT (chunked live transcription) — record-then-transcribe only.
- Non-OpenAI-shaped STT APIs (Deepgram/Azure custom protocols) — the endpoint must accept the OpenAI `/audio/transcriptions` multipart shape.
- Dictation into inputs other than the chat textarea (unchanged from SP1).
