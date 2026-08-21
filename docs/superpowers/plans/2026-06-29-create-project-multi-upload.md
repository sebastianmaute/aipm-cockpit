# Create-Project Multi-File Upload + Loading Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Step-0 import accepts multiple files (one proposal call), with a blocking loading modal (spinner + phase label + Cancel that aborts the AI call), mirroring the Timelog modal.

**Architecture:** Multi-read in `step0-import-panel.tsx` builds one `ContentBlock[]` ProposalContent; an inlined loading modal (mirrors `timelog-panel.tsx`); abort threaded `step0 → onIngest/runIngest → generate → fetch`. Branch `feat-create-project-multi-upload` off `main`.

**Tech Stack:** Next.js 16 / React 19 / TS / Vitest. `npx tsc --noEmit`, `npm run lint`, `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-29-create-project-multi-upload-design.md`

---

## File Structure
- **Modify** `src/app/i18n.ts` + `i18n.de.ts` — 3 keys.
- **Modify** `src/app/use-project-proposal.ts` (+ test) — `generate(input, signal?)`.
- **Modify** `src/app/create-project-wizard.tsx` (+ test) — `runIngest` forwards signal.
- **Modify** `src/app/step0-import-panel.tsx` (+ test) — multi-read, skipped notice, loading modal, abort.

---

## Task 1: i18n — 3 keys (EN + DE)

- [ ] **Step 1: EN** — in `src/app/i18n.ts`, find an existing `wizardImport…` key (e.g. `wizardImportErrorUnsupported`) and add nearby:
```ts
  wizardImportReadingFiles: "Reading files…",
  wizardImportAnalyzing: "Analyzing documents…",
  wizardImportSkippedFiles: "{0} file(s) skipped: {1}",
```
- [ ] **Step 2: DE via node utf8 write (NOT Edit)** — first `grep -n 'wizardImportErrorUnsupported:' src/app/i18n.de.ts` to get the exact anchor line (copy it verbatim incl. trailing comma). Then run a node script (like prior tasks) anchored on that `…\r\n` line, inserting:
```
  wizardImportReadingFiles: "Dateien werden gelesen…",
  wizardImportAnalyzing: "Dokumente werden analysiert…",
  wizardImportSkippedFiles: "{0} Datei(en) übersprungen: {1}",
```
(`übersprungen` has a real ü — node utf8 write, not Edit.) If the anchor isn't found, STOP and report.
- [ ] **Step 3:** `npm run test:run -- src/app/i18n-encoding` PASS; `npx tsc --noEmit` clean. Commit:
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add multi-upload loading/skip keys (EN/DE)"
```
No push, no attribution trailers.

---

## Task 2: use-project-proposal — abortable generate

**Files:** `src/app/use-project-proposal.ts` (+ `use-project-proposal.test.tsx`)

- [ ] **Step 1: Test first** — add to `use-project-proposal.test.tsx` (mirror its existing fetch-mock setup):
```ts
it("passes the abort signal to fetch", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, json: async () => ({ content: [] }),
  } as Response);
  const { result } = renderHook(() => useProjectProposal(<existing settings/ai arg the other tests use>));
  const ctrl = new AbortController();
  await act(async () => { await result.current.generate("hi", ctrl.signal); });
  expect((spy.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal);
});

it("does not set an error when aborted", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    Object.assign(new DOMException("aborted", "AbortError")),
  );
  const { result } = renderHook(() => useProjectProposal(<same arg>));
  const ctrl = new AbortController(); ctrl.abort();
  await act(async () => { await result.current.generate("hi", ctrl.signal); });
  expect(result.current.error).toBeNull();
});
```
Match the existing tests' hook-arg + import style (renderHook/act). If the existing tests construct the hook differently, mirror that exactly.

- [ ] **Step 2: Run → FAIL** (generate takes 1 arg; signal not forwarded).

- [ ] **Step 3: Implement** — in `src/app/use-project-proposal.ts`:
  - Widen the callback: `async (input: ProposalContent, signal?: AbortSignal): Promise<ProjectProposal | null> => {`
  - Add `signal,` to the `fetch(..., { method, headers, body, signal })` init object.
  - In the `catch (e)`, before `setError`, add an abort guard:
    ```ts
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return null;
        setError(e instanceof Error ? e.message : "error");
        return null;
      }
    ```
  (Keep `finally { setBusy(false); }`.)

- [ ] **Step 4: Run → PASS. Step 5: tsc + lint. Step 6: commit:**
```bash
git add src/app/use-project-proposal.ts src/app/use-project-proposal.test.tsx
git commit -m "feat(create-project): abortable proposal generate(signal)"
```

---

## Task 3: create-project-wizard — forward the signal

**Files:** `src/app/create-project-wizard.tsx` (+ test only if a focused assertion is cheap)

- [ ] **Step 1:** Find `runIngest` (the function passed as `onIngest` to `Step0ImportPanel`, which calls `proposal.generate(content)`). Widen it to `async (content: ProposalContent, signal?: AbortSignal) => { … await generate(content, signal); … }`. Forward the signal to the `generate` call. No other behavior change.
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` clean. If there's an existing wizard test that drives runIngest, add a light assertion that the signal reaches `generate` (via the proposal-hook mock); otherwise skip (covered by Task 2 + Task 4). 
- [ ] **Step 3: commit:**
```bash
git add src/app/create-project-wizard.tsx
git commit -m "feat(create-project): runIngest forwards abort signal to generate"
```

---

## Task 4: step0-import-panel — multi-read + loading modal + abort

**Files:** `src/app/step0-import-panel.tsx` (+ `step0-import-panel.test.tsx`)

- [ ] **Step 1: Tests first** — create/extend `src/app/step0-import-panel.test.tsx`. INSPECT how `chat-attachments.test.ts` / any existing test constructs a `File` + stubs `FileReader` in jsdom, and mirror it (jsdom's `FileReader` works for `readAsText`; for `readAsDataURL` you may need the existing stub pattern). Render `<Step0ImportPanel>` with the required props (lang, settings, aiBusy=false, aiError=null, onIngest=vi.fn().mockResolvedValue(undefined), onResetAi, onSkip). Switch to the file method (click the "file" method button), then fire a change on the file input with multiple files:
```tsx
it("reads multiple valid files into one ingest call", async () => {
  const onIngest = vi.fn().mockResolvedValue(undefined);
  render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
  fireEvent.click(screen.getByRole("button", { name: /file/i })); // method picker
  const input = screen.getByLabelText(/upload|file/i); // the file input (match wizardImportFileLabel)
  const f1 = new File(["hello"], "a.txt", { type: "text/plain" });
  const f2 = new File(["world"], "b.txt", { type: "text/plain" });
  fireEvent.change(input, { target: { files: [f1, f2] } });
  await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
  const content = onIngest.mock.calls[0][0];
  // content = [textPrompt, block1, block2]
  expect(Array.isArray(content)).toBe(true);
  expect(content.length).toBe(3);
});

it("skips invalid files with a notice and imports the valid ones", async () => {
  const onIngest = vi.fn().mockResolvedValue(undefined);
  render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
  fireEvent.click(screen.getByRole("button", { name: /file/i }));
  const input = screen.getByLabelText(/upload|file/i);
  const good = new File(["hi"], "good.txt", { type: "text/plain" });
  const bad = new File(["x"], "bad.exe", { type: "application/x-msdownload" });
  fireEvent.change(input, { target: { files: [good, bad] } });
  await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
  expect(onIngest.mock.calls[0][0].length).toBe(2); // prompt + 1 block
  expect(screen.getByText(/skipped/i)).toBeTruthy();
});

it("shows an error and does not ingest when all files are invalid", async () => {
  const onIngest = vi.fn();
  render(<Step0ImportPanel {...baseProps} onIngest={onIngest} />);
  fireEvent.click(screen.getByRole("button", { name: /file/i }));
  const input = screen.getByLabelText(/upload|file/i);
  fireEvent.change(input, { target: { files: [new File(["x"], "bad.exe", { type: "application/x-msdownload" })] } });
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(onIngest).not.toHaveBeenCalled();
});
```
(Adjust the file-input selector to the real accessible name from `wizardImportFileLabel`. If `readFileData` for text uses `readAsText`, jsdom resolves it; if a test file needs binary, stub `FileReader` per the existing pattern. Keep fixtures text-only to avoid the data-URL path unless you stub it.)

- [ ] **Step 2: Run → FAIL** (single-file `files?.[0]` ignores file 2; no notice; no modal).

- [ ] **Step 3: Implement** — in `src/app/step0-import-panel.tsx`:

(a) Imports — add `useRef` (from react), `Modal` from `./modal`, `INTERACTIVE` from `./interaction-styles`, and `ContentBlock` type if needed (the blocks array). Add a module const:
```ts
const MAX_IMPORT_FILES = 10;
```

(b) State — add:
```ts
  const [skipped, setSkipped] = useState<{ name: string; reason: "too-large" | "unsupported" | "too-many" }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
```

(c) The file `<input>` — add `multiple`.

(d) Replace `onFile` with a multi-read version:
```ts
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setImportError(null);
    setSkipped([]);
    onResetAi();
    const dropped: { name: string; reason: "too-large" | "unsupported" | "too-many" }[] = [];
    const blocks: ReturnType<typeof buildAttachmentBlock>[] = [];
    setReading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (i >= MAX_IMPORT_FILES) { dropped.push({ name: file.name, reason: "too-many" }); continue; }
        if (checkAttachmentSize(file.size)) { dropped.push({ name: file.name, reason: "too-large" }); continue; }
        const kind = classifyAttachment(file.type, file.name);
        if (!kind) { dropped.push({ name: file.name, reason: "unsupported" }); continue; }
        const data = await readFileData(file, kind);
        blocks.push(buildAttachmentBlock(kind, file.type || mimeForKind(kind), data));
      }
    } catch {
      setImportError(t(lang, "wizardImportErrorSource"));
      setReading(false);
      return;
    }
    setReading(false);
    if (dropped.length > 0) setSkipped(dropped);
    if (blocks.length === 0) {
      setImportError(t(lang, "wizardImportErrorUnsupported"));
      return;
    }
    const content: ProposalContent = [{ type: "text", text: t(lang, "wizardImportFilePrompt") }, ...blocks];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await onIngest(content, ctrl.signal);
    } finally {
      abortRef.current = null;
    }
  };
```
(Type `content` as `ProposalContent`; `blocks` typed via the buildAttachmentBlock return.)

(e) `Step0ImportPanelProps.onIngest` — widen to:
```ts
  onIngest: (content: ProposalContent, signal?: AbortSignal) => Promise<void>;
```

(f) Skipped notice — render below the existing error block (non-blocking, muted; not role=alert):
```tsx
        {skipped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t(lang, "wizardImportSkippedFiles", skipped.length, skipped.map((s) => s.name).join(", "))}
          </p>
        )}
```

(g) Loading modal — add before the closing `</>` (mirrors timelog-panel.tsx):
```tsx
      {(reading || aiBusy) && (
        <Modal open onClose={() => abortRef.current?.abort()} ariaLabel={t(lang, reading ? "wizardImportReadingFiles" : "wizardImportAnalyzing")} align="center" zIndex={70}>
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-8 py-6 text-foreground">
            <span aria-hidden="true" className="h-7 w-7 animate-spin rounded-full border-2 border-AIPM-dark-blue border-t-transparent" />
            <span className="text-sm font-medium">{t(lang, reading ? "wizardImportReadingFiles" : "wizardImportAnalyzing")}</span>
            <button type="button" onClick={() => abortRef.current?.abort()} className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}>
              {t(lang, "cancel")}
            </button>
          </div>
        </Modal>
      )}
```
(Cancel during the read phase: `abortRef.current` may be null since the controller is created only for the ingest call. That's fine — reads are fast; the Cancel meaningfully aborts the AI call. Optionally also `setReading(false)` on cancel, but the read loop will finish on its own. Keep the onClose/Cancel = `abortRef.current?.abort()`.)

(h) Clear `skipped` on method change — in the method-picker button onClick (where `setImportError(null)` is), add `setSkipped([])`.

- [ ] **Step 4: Run → PASS.** **Step 5: `npx tsc --noEmit && npm run lint` clean.** **Step 6: commit:**
```bash
git add src/app/step0-import-panel.tsx src/app/step0-import-panel.test.tsx
git commit -m "feat(create-project): multi-file upload + loading modal with abort"
```

---

## Task 5: Full-suite verification
- [ ] `npm run test:run` → all green (fix any create-project-wizard/step0 test broken by the widened `onIngest` signature — it's optional-arg compatible, so unlikely).
- [ ] `npx tsc --noEmit && npm run lint` → clean.
- [ ] `git diff --stat main..HEAD` → only: i18n.ts, i18n.de.ts, use-project-proposal.ts(+test), create-project-wizard.tsx, step0-import-panel.tsx(+test). No console.log, no file bytes logged.

---

## Out of scope / notes
- SharePoint/Confluence stay single-source. No shared LoadingModal extraction (Timelog unchanged).
- Read loop is sequential (files are local). Cancel primarily aborts the AI call.
- No release/push/MR — only on the explicit "release" trigger.
