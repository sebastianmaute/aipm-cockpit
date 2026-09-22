# AI prompt-cache layout + honest usage meter — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Make the chat transcript sit inside the Anthropic prompt-cache prefix, and make the usage meter
count every token Anthropic bills.

**Architecture:** The volatile prompt block moves off the `system` array and onto the current user turn,
so `system` becomes fully stable and the message history falls inside a cacheable prefix; two rolling
`cache_control` breakpoints on the message array mark the turn boundaries. In parallel, `ApiUsage` gains
Anthropic's two cache-token fields and they are carried through the meter that drives the session and
weekly caps.

**Spec:** `docs/superpowers/specs/2026-09-08-ai-prompt-cache-layout-design.md`
**Roadmap:** `docs/superpowers/specs/2026-09-08-ai-cost-roadmap-design.md` (this is slice B)
**Baseline:** 0.293.1 "Vandermeer", branch `feat/ai-prompt-cache-layout` off `main` @ `c9ba250c`

**Tech stack:** TypeScript, React 19, Next 16, vitest, Anthropic Messages API (`2023-06-01`).

---

## Before you start — repo landmines that apply to this plan

Read these; each has already cost a build here.

- **Every `src/app/*.ts(x)` file is CRLF.** The `Write` tool re-lines CRLF→LF invisibly to `git diff`;
  the `Edit` tool preserves. **Use `Edit`, never `Write`, on any existing `src/app` file.** New files may
  be written either way.
- **Never `sed -i` on a source file** — it re-lines the whole file to LF and `core.autocrlf=true` hides
  it from the diff.
- **`src/app/i18n.de.ts` must never be touched with `Edit` or `Write`.** It corrupts umlauts and curls
  double quotes. Patch it with a `.mjs` script written via the `Write` tool, matching on `\r\n` anchors,
  writing real umlauts (never `\uXXXX` — the `i18n-encoding` test bans those).
- **Never read a gate's exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"` unpiped, then
  grep the file.
- **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
- **`npm run lint` exits 1 from gitignored leftovers** — use `npx eslint --max-warnings=0 src`.
- **Never run two vitest processes at once.** `Failed to start forks worker` is contention, not evidence.
- **Never `git add -A` / `git add .`** — `not-in-use.env.local.bak` is untracked, not gitignored, and
  holds a live token. Stage explicit paths only, and commit with `git commit --only <paths>`.
- **Never `git commit --amend`** in this worktree.
- Use the session scratchpad for temp files, never `/tmp`. Every command below writes logs to
  `$SCRATCH`; export it once per shell first, from the scratchpad path in your environment banner:

  ```bash
  export SCRATCH="<your session scratchpad dir>"   # NOT /tmp — that is shared across sessions
  ```

---

## Task 1: Carry Anthropic's cache-token fields off the wire

**Files:**
- Modify: `src/app/chat-api.ts` (`ApiUsage`, the `callClaude` response parse)
- Test: `src/app/chat-api.test.ts`

The API returns `cache_creation_input_tokens` and `cache_read_input_tokens` alongside `input_tokens`,
and omits them entirely when caching is inactive. `input_tokens` **excludes** cache reads, so these are
not a subset of anything already counted.

- [ ] **Step 1: Write the failing test**

In `src/app/chat-api.test.ts`, inside the existing `callClaude` describe block:

```ts
it("carries the cache token fields off the response", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 700,
        cache_read_input_tokens: 6000,
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const res = await callClaude("k", "claude-sonnet-5", [], [], {});
  expect(res.usage.cache_creation_input_tokens).toBe(700);
  expect(res.usage.cache_read_input_tokens).toBe(6000);
});

it("defaults the cache token fields to 0 when the API omits them", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const res = await callClaude("k", "claude-sonnet-5", [], [], {});
  expect(res.usage.cache_creation_input_tokens).toBe(0);
  expect(res.usage.cache_read_input_tokens).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-api.test.ts -t "cache token" > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t1.log"
```

Expected: FAIL — the properties are `undefined`.

- [ ] **Step 3: Widen the type and normalise at the parse**

In `src/app/chat-api.ts`, replace the `ApiUsage` declaration:

```ts
/** ★★★ FOUR FIELDS, NOT TWO, AND `input_tokens` IS NOT THE TOTAL.
 *  Anthropic bills cached input separately and EXCLUDES it from `input_tokens`:
 *  `cache_creation_input_tokens` is a cache WRITE (billed at 1.25x base) and
 *  `cache_read_input_tokens` is a cache READ (0.1x). Counting only the first two
 *  fields — which this type did until 0.294.0 — makes every cached token
 *  invisible to the session and weekly caps in `ai-usage-context.tsx`, so the
 *  under-count grows with exactly how well the cache is working.
 *  ★ Both cache fields are ABSENT from the response when no breakpoint was sent,
 *  so they are optional on the wire and defaulted to 0 at the parse. Downstream
 *  code must never see `undefined` here: `undefined + n` is NaN, and NaN defeats
 *  every threshold comparison silently. */
export type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

/** The same shape as it arrives on the wire — both cache fields optional. */
type WireUsage = Partial<ApiUsage>;

export function normalizeApiUsage(raw: WireUsage | undefined): ApiUsage {
  const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input_tokens: n(raw?.input_tokens),
    output_tokens: n(raw?.output_tokens),
    cache_creation_input_tokens: n(raw?.cache_creation_input_tokens),
    cache_read_input_tokens: n(raw?.cache_read_input_tokens),
  };
}
```

In `callClaude`, change the response cast and the return:

```ts
  const json = await res.json() as { content: ContentBlock[]; stop_reason: string; usage?: WireUsage };
  return {
    content: json.content,
    stop_reason: json.stop_reason,
    usage: normalizeApiUsage(json.usage),
  };
```

- [ ] **Step 4: Run the whole file green**

```bash
npx vitest run src/app/chat-api.test.ts > "$SCRATCH/t1b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t1b.log"
npx tsc --noEmit; echo "EXIT=$?"    # 0 expected; 2 means diagnostics
```

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-api.ts src/app/chat-api.test.ts
git commit --only src/app/chat-api.ts src/app/chat-api.test.ts -m "feat(ai): carry Anthropic's cache token fields off the wire"
```

---

## Task 2: Widen the domain `Usage` type and its arithmetic

**Files:**
- Modify: `src/app/ai-usage.ts`
- Test: `src/app/ai-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("accumulates all four fields into a bucket", () => {
  const b = addToBuckets({}, new Date(2026, 8, 8),
    { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
  const b2 = addToBuckets(b, new Date(2026, 8, 8),
    { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 });
  expect(b2["2026-09-08"]).toEqual({ input: 11, output: 22, cacheWrite: 33, cacheRead: 44 });
});

it("counts every billed field in the week total", () => {
  const now = new Date(2026, 8, 8); // Tuesday
  const b = addToBuckets({}, now, { input: 1, output: 2, cacheWrite: 4, cacheRead: 8 });
  expect(weekToDate(b, now)).toBe(15);
});

// ★ THE UPGRADE CASE. A bucket persisted before 0.294.0 has only input/output.
// Adding to it must not produce NaN — NaN defeats every cap comparison silently.
it("treats a pre-0.294 bucket's missing cache fields as zero", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  const b = addToBuckets(legacy, new Date(2026, 8, 8),
    { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
  expect(b["2026-09-08"]).toEqual({ input: 6, output: 6, cacheWrite: 1, cacheRead: 1 });
  expect(weekToDate(b, new Date(2026, 8, 8))).toBe(14);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/ai-usage.test.ts > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2.log"
```

Expected: FAIL — type error on the four-field literal, and NaN in the legacy case.

- [ ] **Step 3: Implement**

In `src/app/ai-usage.ts`, replace the type and both functions:

```ts
/** ★★ FOUR FIELDS. `cacheWrite` and `cacheRead` mirror Anthropic's
 *  `cache_creation_input_tokens` / `cache_read_input_tokens`; see `ApiUsage`.
 *  ★★★ EVERY READER MUST DEFAULT A MISSING FIELD TO 0 rather than trusting the
 *  shape. Buckets persisted before 0.294.0 carry only `input`/`output`, and
 *  `undefined + n` is NaN — which does NOT throw, does NOT show up anywhere, and
 *  makes both `crossed80` and `crossed100` permanently false because every
 *  comparison against NaN is false. A silently disabled cap is the worst
 *  outcome available here, so the defaulting lives in ONE helper used by both
 *  functions below rather than being repeated at each call site. */
export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
export type UsageBuckets = Record<string, Usage>; // key: YYYY-MM-DD (local)

const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

/** Coerce anything read from storage (or an older build) into a complete Usage.
 *  A non-finite value becomes 0 for the same reason a missing one does. */
export function normalizeUsage(u: Partial<Usage> | undefined): Usage {
  const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input: n(u?.input),
    output: n(u?.output),
    cacheWrite: n(u?.cacheWrite),
    cacheRead: n(u?.cacheRead),
  };
}

/** Every billed token in one number — what the caps compare against. */
export function usageTotal(u: Usage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

export function addToBuckets(b: UsageBuckets, when: Date, u: Usage): UsageBuckets {
  const k = isoDate(when);
  const prev = normalizeUsage(b[k] ?? EMPTY_USAGE);
  const add = normalizeUsage(u);
  return {
    ...b,
    [k]: {
      input: prev.input + add.input,
      output: prev.output + add.output,
      cacheWrite: prev.cacheWrite + add.cacheWrite,
      cacheRead: prev.cacheRead + add.cacheRead,
    },
  };
}

export function weekToDate(b: UsageBuckets, now: Date): number {
  const start = mondayOf(now);
  let total = 0;
  for (const [k, u] of Object.entries(b)) {
    const d = new Date(`${k}T00:00:00`);
    if (d >= start && d <= now) total += usageTotal(normalizeUsage(u));
  }
  return total;
}
```

- [ ] **Step 4: Run green + typecheck**

```bash
npx vitest run src/app/ai-usage.test.ts > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2b.log"
npx tsc --noEmit; echo "EXIT=$?"
```

`tsc` will now report errors at every `Usage` construction site — that is expected and Task 3/4 fix them.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-usage.ts src/app/ai-usage.test.ts
git commit --only src/app/ai-usage.ts src/app/ai-usage.test.ts -m "feat(ai): widen Usage to the four billed token classes"
```

---

## Task 3: Normalise on read, and scale all four fields identically

**Files:**
- Modify: `src/app/ai-usage-context.tsx` (`loadBuckets`, `record`, the exposed context value)
- Test: `src/app/ai-usage-context.test.tsx`

`loadBuckets` currently does `return parsed as UsageBuckets` — an unchecked cast over data written by an
older build. `record` multiplies by `ai.tokenMultiplier` (default **5**), and the two new fields must be
scaled **identically**, because that setting's unit is "counted tokens" and re-basing it silently would
change a threshold the user chose under the old meaning.

- [ ] **Step 1: Write the failing test**

```ts
it("normalises a pre-0.294 stored blob instead of casting it", () => {
  window.localStorage.setItem(AI_USAGE_KEY,
    JSON.stringify({ "2026-09-08": { input: 100, output: 50 } }));
  const { result } = renderHook(() => useAiUsageContext(), { wrapper });
  // Reading must not yield undefined fields downstream: record then read back.
  act(() => result.current.record({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }));
  expect(Number.isNaN(result.current.weekTotal)).toBe(false);
});

it("applies tokenMultiplier to the cache fields exactly as to input and output", () => {
  // ai.tokenMultiplier = 2 via the wrapper's config
  const { result } = renderHook(() => useAiUsageContext(), { wrapper });
  act(() => result.current.record({ input: 1, output: 1, cacheWrite: 1, cacheRead: 1 }));
  expect(result.current.sessionTotal).toBe(8); // 4 fields x 1 token x 2
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/ai-usage-context.test.tsx > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3.log"
```

- [ ] **Step 3: Implement**

In `loadBuckets`, replace the cast:

```ts
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // ★★★ NORMALISE, NEVER CAST. A blob written before 0.294.0 has no
    //     cacheWrite/cacheRead, and `undefined + n` is NaN — which propagates
    //     into weekToDate and makes crossed80/crossed100 permanently false,
    //     silently disabling the cap the user configured. Rebuild every bucket
    //     field by field.
    const out: UsageBuckets = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = normalizeUsage(v as Partial<Usage> | undefined);
    }
    return out;
```

In `record`, scale all four and total honestly:

```ts
      const scaled: Usage = {
        input: u.input * multiplier,
        output: u.output * multiplier,
        cacheWrite: u.cacheWrite * multiplier,
        cacheRead: u.cacheRead * multiplier,
      };
      const tokens = usageTotal(scaled);
```

Add the session breakdown to the context value so the panel in Task 8 can render it — a running
`sessionUsage: Usage` beside the existing `sessionTotal`, accumulated with the same `addToBuckets`-style
field-wise addition and exposed on the provider's memoized value.

Update imports: `normalizeUsage`, `usageTotal`, `type Usage` from `./ai-usage`.

- [ ] **Step 4: Run green + typecheck**

```bash
npx vitest run src/app/ai-usage-context.test.tsx > "$SCRATCH/t3b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3b.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-prove the normalising read**

Revert `loadBuckets` to `return parsed as UsageBuckets;` by an anchored edit, re-run the file, confirm
the pre-0.294 test goes RED, then restore. Assert the anchor is unique in both directions and finish on
`git diff --stat` being empty. **`git checkout -- <file>` is deny-blocked here** — revert by writing the
inverse edit, not by checkout.

- [ ] **Step 6: Commit**

```bash
git add src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx
git commit --only src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx -m "fix(ai): normalise stored usage buckets instead of casting them"
```

---

## Task 4: Feed all four fields from every call site

**Files:**
- Modify: `src/app/chat-panel.tsx`, `src/app/use-inline-entity-edit.ts`,
  `src/app/use-entity-inline-ai-edit.tsx`, `src/app/use-tasks-inline-ai-edit.tsx`
- Test: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

In `chat-panel.test.tsx`, assert the recorded usage carries cache tokens from a mocked two-turn send:

Reuse the file's existing harness — `renderChatPanel()` and the `jsonResponse()` fetch helper — rather
than building a new one. Stub `fetch` to return two turns (a `tool_use` turn, then an `end_turn` turn),
each carrying `cache_read_input_tokens: 1000`, and spy on the provider's `record`:

```ts
it("records cache tokens from every turn of a send", async () => {
  const recordSpy = vi.fn();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5,
               cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 },
    }))
    .mockResolvedValueOnce(jsonResponse({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5,
               cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 },
    }));
  vi.stubGlobal("fetch", fetchMock);

  renderChatPanel({ recordUsage: recordSpy });
  await sendOneMessage("hi");   // the file's existing type-and-submit sequence

  expect(recordSpy).toHaveBeenCalledWith(
    expect.objectContaining({ cacheRead: 2000 }),
  );
});
```

★ `cacheRead: 2000` is the point: a per-turn accumulator that only kept the LAST turn's usage would
report 1000 and look plausible. Two turns with equal values is the fixture that separates "summed" from
"overwritten"; do not simplify it to one turn.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-panel.test.tsx -t "cache tokens" > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4.log"
```

- [ ] **Step 3: Implement**

In `chat-panel.tsx`, replace the two accumulators with four, and the single `recordUsage` call:

```ts
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheWrite = 0;
      let totalCacheRead = 0;
```

```ts
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;
        totalCacheWrite += response.usage.cache_creation_input_tokens;
        totalCacheRead += response.usage.cache_read_input_tokens;
```

```ts
        recordUsage({
          input: totalInput,
          output: totalOutput,
          cacheWrite: totalCacheWrite,
          cacheRead: totalCacheRead,
        });
```

In `use-inline-entity-edit.ts`, widen the callback type:

```ts
  recordUsage?: (u: ApiUsage) => void;
```

and in both `use-*-inline-ai-edit.tsx` call sites:

```ts
    recordUsage: (u) => record({
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      cacheRead: u.cache_read_input_tokens,
    }),
```

- [ ] **Step 4: Run green + full typecheck**

```bash
npx vitest run src/app/chat-panel.test.tsx > "$SCRATCH/t4b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4b.log"
npx tsc --noEmit; echo "EXIT=$?"    # must be 0 now — no Usage sites left unwidened
```

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-panel.tsx src/app/use-inline-entity-edit.ts src/app/use-entity-inline-ai-edit.tsx src/app/use-tasks-inline-ai-edit.tsx src/app/chat-panel.test.tsx
git commit --only src/app/chat-panel.tsx src/app/use-inline-entity-edit.ts src/app/use-entity-inline-ai-edit.tsx src/app/use-tasks-inline-ai-edit.tsx src/app/chat-panel.test.tsx -m "feat(ai): record cache tokens from every AI call site"
```

**The meter is now honest and shippable on its own. Everything above is independently valuable if the
layout work below is abandoned.**

---

## Task 5: Split the prompt builder without changing a byte

**Files:**
- Modify: `src/app/chat-api.ts` (`buildSystemPrompt`), `src/app/inline-ai-edit-call.ts`
- Test: `src/app/chat-api.system-prompt.test.ts`

`buildSystemPrompt` returns `[{stableText, cache_control}, {volatileText}]`. It splits into
`buildStableSystemBlocks` (the first block) and `buildTurnContext` (the second block's *string*).
**`buildSystemPrompt` is kept as a thin composition of the two**, so this task changes no output at all
and every existing test stays green — the relocation happens in Task 7.

- [ ] **Step 1: Write the failing test (the equivalence pin)**

```ts
it("composes byte-identically from the two new builders", () => {
  const args = [lang, snapshot, guides, true, flags] as const;
  const legacy = buildSystemPrompt(...args);
  const composed = [
    ...buildStableSystemBlocks(...args),
    { type: "text" as const, text: buildTurnContext(...args) },
  ];
  expect(composed).toEqual(legacy);
});
```

- [ ] **Step 2: Run it and watch it fail** (`buildStableSystemBlocks is not a function`)

- [ ] **Step 3: Implement the split**

Extract the body of `buildSystemPrompt` into the two exported functions, each taking the identical
parameter list. `buildStableSystemBlocks` returns `[{ type: "text", text: stableText, cache_control:
{ type: "ephemeral" } }]`; `buildTurnContext` returns the `volatileText` string unchanged. Then:

```ts
/** ★★ KEPT AS A COMPOSITION, not deleted. `inline-ai-edit-call.ts` genuinely
 *  wants both halves in the system array (it has no transcript to cache, so
 *  relocating its volatile block would change a tuned one-shot prompt for zero
 *  gain — see the spec's per-consumer split). The chat panel calls the two
 *  builders separately instead. */
export function buildSystemPrompt(...): SystemBlock[] {
  return [
    ...buildStableSystemBlocks(lang, snapshot, guides, groundInGuides, toolFlags),
    { type: "text", text: buildTurnContext(lang, snapshot, guides, groundInGuides, toolFlags) },
  ];
}
```

`inline-ai-edit-call.ts` needs **no change** — it keeps calling `buildSystemPrompt` and appending its
`scopeBlock`, so its array order is preserved exactly.

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/chat-api.system-prompt.test.ts src/app/inline-ai-edit-call.test.ts > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts
git commit --only src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts -m "refactor(ai): split the prompt builder into stable and per-turn halves"
```

---

## Task 6: The wire-message layout engine

**Files:**
- Create: `src/app/chat-cache-layout.ts`, `src/app/chat-cache-layout.test.ts`

Pure, i18n-free, React-free, clock-free. This is the module the cache property is proved on.

- [ ] **Step 1: Write the failing tests**

```ts
describe("buildWireMessages", () => {
  const hist = (n: number): ApiMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text" as const, text: `m${i}` }],
    })) as ApiMessage[];

  it("appends the turn context to the final user message", () => {
    const out = buildWireMessages(hist(1), "CTX").messages;
    const last = out[out.length - 1];
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("CTX");
  });

  it("appends a new user message when the history ends on an assistant turn", () => {
    const h = hist(2); // user, assistant
    const out = buildWireMessages(h, "CTX").messages;
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("user");
    expect(JSON.stringify(out[2].content)).toContain("CTX");
  });

  // ★★★ THE PROPERTY THE WHOLE SLICE EXISTS FOR, and it is asserted against the
  //     RETURNED prefix length rather than a hand-computed slice bound. An
  //     earlier draft of this test sliced at `history.length - 1`, which is only
  //     the right boundary when the final history message is a user turn — with
  //     an assistant turn last the context rides a NEWLY APPENDED message and
  //     every index shifts by one, so the assertion silently compared the wrong
  //     things. Let the engine report the boundary it actually cached.
  it("keeps everything it cached byte-identical as history grows", () => {
    const h = hist(4);
    const before = buildWireMessages(h, "CTX-A");
    const h2 = [
      ...h,
      { role: "assistant", content: [{ type: "text", text: "a" }] },
      { role: "user", content: [{ type: "text", text: "u" }] },
    ] as ApiMessage[];
    const after = buildWireMessages(h2, "CTX-B");
    expect(after.cachedPrefixLength).toBeGreaterThanOrEqual(before.cachedPrefixLength);
    expect(after.messages.slice(0, before.cachedPrefixLength))
      .toEqual(before.messages.slice(0, before.cachedPrefixLength));
  });

  it("marks no breakpoint at or after the context-bearing message", () => {
    const out = buildWireMessages(hist(4), "CTX");
    expect(out.cachedPrefixLength).toBeLessThan(out.messages.length);
    const tail = out.messages.slice(out.cachedPrefixLength);
    expect(JSON.stringify(tail)).not.toContain("cache_control");
  });

  it("never places more than two breakpoints on the messages", () => {
    const out = buildWireMessages(hist(20), "CTX");
    const marks = JSON.stringify(out.messages).match(/cache_control/g) ?? [];
    expect(marks.length).toBeLessThanOrEqual(2);
  });

  it("keeps tool_result blocks leading their user message", () => {
    const withResults: ApiMessage[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ];
    const out = buildWireMessages(withResults, "CTX").messages;
    const last = out[out.length - 1];
    const kinds = (last.content as ContentBlock[]).map((b) => b.type);
    expect(kinds[0]).toBe("tool_result");
    expect(kinds[kinds.length - 1]).toBe("text");
  });

  it("returns history untouched when the turn context is empty", () => {
    const h = hist(3);
    const out = buildWireMessages(h, "");
    expect(out.messages).toEqual(h);
    expect(out.cachedPrefixLength).toBe(h.length);
  });

  // ★ A string `content` is widened to a block pair rather than concatenated,
  //   matching `appendUserNote`'s existing rule in chat-api.ts.
  it("widens a string content instead of concatenating into it", () => {
    const h: ApiMessage[] = [{ role: "user", content: "hello" }];
    const last = buildWireMessages(h, "CTX").messages[0];
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as ContentBlock[]).map((b) => b.type)).toEqual(["text", "text"]);
  });
});
```

- [ ] **Step 2: Run and watch every case fail** (module does not exist)

- [ ] **Step 3: Implement**

Create `src/app/chat-cache-layout.ts`:

```ts
// src/app/chat-cache-layout.ts — where the Anthropic prompt-cache breakpoints go
// on the MESSAGE array. Pure: no React, no i18n, no clock, no I/O.
//
// ★★★ THE ORDERING RULE THIS FILE EXISTS FOR. Anthropic checks the cache prefix
// in order `tools` → `system` → `messages`, and a cache entry is reusable only
// when the prefix is byte-identical from the very start. So ANY per-turn content
// placed before the messages makes the ENTIRE transcript uncacheable, no matter
// how many breakpoints the messages carry. Until 0.294.0 the volatile prompt
// block sat in the `system` array and did exactly that: every message in every
// conversation was billed as fresh input on every turn.
//
// ★★★ THE TURN CONTEXT MUST NEVER BE PERSISTED. It is injected here, into the
// OUTGOING copy only. Persisting it breaks this module's whole purpose twice
// over: stale "Today is …" lines accumulate down the transcript, AND history's
// tail is rewritten on every send, so the byte-identical prefix the next send
// depends on no longer exists. `chat-panel.tsx` therefore keeps `messages` (the
// persisted array) and passes `buildWireMessages(messages, ctx).messages` to the
// API. If that ever gets collapsed into one array, nothing fails visibly — the
// only symptom is a larger bill.
//
// ★★ A HEAD-TRIM OF HISTORY DESTROYS THE PROPERTY. Dropping the oldest turns
// changes the first message, so a per-turn rolling trim invalidates the whole
// prefix on EVERY send and pays a cache write (1.25x) each time — worse than not
// caching at all. Any history budget must be coarse and hysteretic; see slice C1
// in `docs/superpowers/specs/2026-09-08-ai-cost-roadmap-design.md`.
import type { ApiMessage, ContentBlock, TextBlock } from "./chat-api";

/** At most two message breakpoints: Anthropic allows four in total and `tools`
 *  and `system` already claim one each. Two rolling marks keep the previous
 *  entry warm while the newest is written. */
const MAX_MESSAGE_BREAKPOINTS = 2;

export type WireMessages = {
  messages: ApiMessage[];
  /** How many leading messages are inside a marked (cacheable) prefix. The
   *  caller's next send must reproduce these byte-for-byte to get a hit; the
   *  prefix-stability test asserts exactly that, rather than recomputing a slice
   *  bound that is only correct when history ends on a user turn. */
  cachedPrefixLength: number;
};

function withCacheControl(msg: ApiMessage): ApiMessage {
  const blocks: ContentBlock[] =
    typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [...msg.content];
  if (blocks.length === 0) return msg;
  const last = blocks[blocks.length - 1];
  // Only `text` and `tool_result` accept a breakpoint; never mark a `tool_use`.
  if (last.type !== "text" && last.type !== "tool_result") return msg;
  blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
  return { ...msg, content: blocks } as ApiMessage;
}

export function buildWireMessages(history: ApiMessage[], turnContext: string): WireMessages {
  if (turnContext === "") return { messages: history, cachedPrefixLength: history.length };

  const ctxBlock: TextBlock = { type: "text", text: turnContext };
  const tail = history[history.length - 1];
  let messages: ApiMessage[];

  if (tail && tail.role === "user") {
    // ★ The context goes AFTER any tool_result blocks: the API requires a user
    //   message's tool_result blocks to LEAD its content.
    const blocks: ContentBlock[] =
      typeof tail.content === "string"
        ? [{ type: "text", text: tail.content }]
        : [...tail.content];
    messages = [...history.slice(0, -1), { role: "user", content: [...blocks, ctxBlock] }];
  } else {
    messages = [...history, { role: "user", content: [ctxBlock] }];
  }

  // Everything before the context-bearing message is stable across sends and is
  // what we ask the cache to hold.
  const cachedPrefixLength = messages.length - 1;
  const marks: number[] = [];
  for (let i = cachedPrefixLength - 1; i >= 0 && marks.length < MAX_MESSAGE_BREAKPOINTS; i--) {
    marks.push(i);
  }
  const out = messages.slice();
  for (const i of marks) out[i] = withCacheControl(out[i]);
  return { messages: out, cachedPrefixLength };
}
```

- [ ] **Step 4: Run green + lint + typecheck**

```bash
npx vitest run src/app/chat-cache-layout.test.ts > "$SCRATCH/t6.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t6.log"
npx eslint --max-warnings=0 src/app/chat-cache-layout.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-prove the prefix property**

Change the implementation to mark `cache_control` on the **last** message instead of the boundary before
it, re-run, and confirm the prefix-stability case goes RED. Restore by inverse anchored edit; assert
anchor uniqueness both directions; end on an empty `git diff --stat`. Record the result as
`N failed / M passed`, and check the sum equals the file's runtime test count.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-cache-layout.ts src/app/chat-cache-layout.test.ts
git commit --only src/app/chat-cache-layout.ts src/app/chat-cache-layout.test.ts -m "feat(ai): add the wire-message cache layout engine"
```

---

## Task 7: Wire the chat panel to the new layout

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Test: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Write the failing test — the persistence invariant**

```ts
// ★★★ If this ever goes green while the turn context IS persisted, the only
//     symptom in production is a larger bill. Nothing else changes.
it("never writes the turn context into persisted history", async () => {
  // drive a full send, then read the history handed to the thread store
  const persisted = JSON.stringify(savedHistoryArg);
  expect(persisted).not.toContain("APP CONTEXT");
  expect(persisted).not.toContain("Today is");
});

// ★★ ASSERTED ON THE REQUEST BODY, NOT A `callClaude` SPY — this file's
//    established convention, and its comment above the tool-advertisement tests
//    gives the reason: the body is what the API actually receives, so the
//    assertion cannot pass while the wrong thing still ships, and it survives a
//    refactor of how the panel reaches the network. A module spy would not.
it("sends a system array of exactly one block, with the context on the turn", async () => {
  renderChatPanel();
  await sendOneMessage("hi");
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.system).toHaveLength(1);
  expect(JSON.stringify(body.system)).not.toContain("APP CONTEXT");
  // …and it did not simply vanish: it must be on the final user message.
  expect(JSON.stringify(body.messages[body.messages.length - 1])).toContain("APP CONTEXT");
});
```

★★ The third assertion is what stops this passing vacuously. Dropping the turn context entirely would
satisfy a one-block `system` and the `not.toContain` — and would be a far worse bug than the one being
fixed, since the model would lose today's date, the current view and the insight list on every turn.

- [ ] **Step 2: Run and watch both fail**

- [ ] **Step 3: Implement**

At the send site, replace the single `buildSystemPrompt` call:

```ts
    const snapshot = dispatcher.getSnapshot();
    const system = buildStableSystemBlocks(lang, snapshot, guides, ai.groundInGuides, ai);
    const turnContext = buildTurnContext(lang, snapshot, guides, ai.groundInGuides, ai);
    // ★★★ WIRE-ONLY. `messages` stays the PERSISTED history; the turn context is
    //     injected into the outgoing copy alone. Persisting it would leave stale
    //     "Today is ..." down the transcript AND rewrite history's tail on every
    //     send, which destroys the byte-identical prefix the cache depends on.
    const messages = newHistory.slice();
```

and inside the round-trip loop, build the wire copy per turn while continuing to push assistant turns and
tool results onto `messages` itself:

```ts
        const response = await callClaude(
          effectiveApiKey,
          ai.model,
          system,
          buildWireMessages(messages, turnContext).messages,
          ai, controller.signal,
        );
```

`messages` is what gets persisted; the wire copy is discarded after each turn.

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/chat-panel.test.tsx > "$SCRATCH/t7.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t7.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-prove the persistence invariant**

Change the send to persist the wire messages instead of `messages`; confirm the invariant test goes RED;
restore by inverse anchored edit and prove `git diff --stat` empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit --only src/app/chat-panel.tsx src/app/chat-panel.test.tsx -m "feat(ai): move the per-turn context onto the user turn so the transcript caches"
```

---

## Task 8: Surface the cache breakdown

**Files:**
- Modify: `src/app/settings-sections/ai-usage-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-sections/ai-usage-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("shows the session cache breakdown and hit rate", () => {
  // sessionUsage: { input: 1000, output: 100, cacheWrite: 500, cacheRead: 9000 }
  render(<AiUsagePanel lang="en-US" sessionCap={100000} weeklyCap={500000} />);
  expect(screen.getByText(/9,000/)).toBeInTheDocument();
  expect(screen.getByText(/86%/)).toBeInTheDocument();   // 9000 / (9000+1000+500)
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Add the EN strings**

In `src/app/i18n.ts` (CRLF — use `Edit`), beside `aiUsageResetAt`:

```ts
  aiUsageCacheRead: "Cached input",
  aiUsageCacheWrite: "Cache writes",
  aiUsageUncachedInput: "Uncached input",
  aiUsageCacheHitRate: "Cache hit rate: {0}%",
```

- [ ] **Step 4: Add the DE strings via a script, never the editor**

Write `$SCRATCH/patch-de.mjs` with the `Write` tool, matching a `\r\n` anchor, writing real umlauts:

```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
const s = readFileSync(p, "utf8");
const anchor = '  aiUsageResetAt:';
if ((s.split(anchor).length - 1) !== 1) throw new Error("anchor not unique");
const add = [
  '  aiUsageCacheRead: "Zwischengespeicherte Eingabe",',
  '  aiUsageCacheWrite: "Cache-Schreibvorgänge",',
  '  aiUsageUncachedInput: "Nicht zwischengespeicherte Eingabe",',
  '  aiUsageCacheHitRate: "Cache-Trefferquote: {0} %",',
].join("\r\n");
writeFileSync(p, s.replace(anchor, add + "\r\n" + anchor), "utf8");
```

Then verify the file is still CRLF and umlaut-clean:

```bash
node "$SCRATCH/patch-de.mjs"
git ls-files --eol src/app/i18n.de.ts          # expect i/lf w/crlf
npx vitest run src/app/i18n-encoding.test.ts > "$SCRATCH/t8de.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 5: Render the block**

In `ai-usage-panel.tsx`, add below the `aiUsageResetAt` paragraph:

```tsx
      <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageUncachedInput")}</dt>
          <dd className="tabular-nums">{sessionUsage.input.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageCacheRead")}</dt>
          <dd className="tabular-nums">{sessionUsage.cacheRead.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageCacheWrite")}</dt>
          <dd className="tabular-nums">{sessionUsage.cacheWrite.toLocaleString()}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(lang, "aiUsageCacheHitRate", String(hitRatePct))}
      </p>
```

with, above the `return`:

```tsx
  const { sessionTotal, weekTotal, nextReset, sessionUsage } = useAiUsageContext();
  // ★ Denominator is every INPUT-side class, not the grand total: output tokens
  //   are never cacheable, so including them would report a hit rate that can
  //   never reach 100% even on a perfectly cached conversation.
  const inputSide = sessionUsage.input + sessionUsage.cacheRead + sessionUsage.cacheWrite;
  const hitRatePct = inputSide === 0 ? 0 : Math.round((sessionUsage.cacheRead / inputSide) * 100);
```

Existing palette tokens only — no new colours, no shadows, no gradients (`brand-color-palette`).
`<dl>`/`<dt>`/`<dd>` carry their own semantics, so no ARIA is added; the figures are static text, not
controls, so the row-unique-name rule does not apply here.

- [ ] **Step 6: Run green + tsc + eslint, then commit**

```bash
npx vitest run src/app/settings-sections/ai-usage-panel.test.tsx > "$SCRATCH/t8.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t8.log"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/settings-sections/ai-usage-panel.tsx src/app/settings-sections/ai-usage-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/settings-sections/ai-usage-panel.tsx src/app/settings-sections/ai-usage-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts -m "feat(ai): show the session cache breakdown and hit rate"
```

---

## Task 9: Explain the earlier cap warnings once

**Files:**
- Modify: `src/app/ai-usage-context.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/ai-usage-context.test.tsx`

The caps now count cache tokens, so a user's 80% warning arrives sooner than it did on 0.293.x with no
setting changed. Fire a one-time explanatory toast the first time a cap warning fires after upgrade,
keyed by a `localStorage` flag, so the change reads as intentional rather than as a regression.

- [ ] **Step 1: Write the failing test**

```ts
it("explains the changed cap basis once, then never again", () => {
  const { result, rerender } = renderHook(() => useAiUsageContext(), { wrapper });
  // sessionCap 100, multiplier 1 → 81 tokens crosses 80%
  act(() => result.current.record({ input: 40, output: 1, cacheWrite: 0, cacheRead: 40 }));
  const notices = showToast.mock.calls.filter(([, text]) => text === EXPECTED_NOTICE_TEXT);
  expect(notices).toHaveLength(1);
  expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");

  // A second crossing in a fresh provider must not repeat it.
  rerender();
  act(() => result.current.record({ input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }));
  expect(showToast.mock.calls.filter(([, t2]) => t2 === EXPECTED_NOTICE_TEXT)).toHaveLength(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/ai-usage-context.test.tsx -t "changed cap basis" > "$SCRATCH/t9.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t9.log"
```

- [ ] **Step 3: Implement**

In `ai-usage-context.tsx`:

```ts
/** ★ One-time, and keyed in localStorage rather than a ref: the point is to
 *  explain the change ACROSS the upgrade, so a per-session flag would re-fire
 *  it on every reload and a ref would lose it on remount. */
export const AI_CAP_BASIS_NOTICE_KEY = "aipm-cockpit:ai-cap-basis-notice";

function noteCapBasisOnce(showToast: (k: "info" | "error", text: string) => void, lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY) === "1") return;
    window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
  } catch {
    return; // storage unavailable: skip the notice rather than repeating it
  }
  showToast("info", t(lang, "aiUsageCapBasisChanged"));
}
```

called immediately before the first `crossed80` toast in each scope.

EN string (`i18n.ts`, via `Edit`):

```ts
  aiUsageCapBasisChanged:
    "Token counts now include cached input, which Anthropic bills separately. Your caps are unchanged, so warnings arrive earlier than before.",
```

DE string via a `.mjs` patch exactly as Task 8 (real umlauts, `\r\n` anchor, unique-anchor assertion).

- [ ] **Step 4: Run green + tsc**

```bash
npx vitest run src/app/ai-usage-context.test.tsx > "$SCRATCH/t9b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t9b.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx src/app/i18n.ts src/app/i18n.de.ts -m "feat(ai): explain the changed cap basis once after upgrade"
```

---

## Task 10: Correct the stale count and the docs

**Files:**
- Modify: `src/app/chat-api.ts` (the `withCacheBreakpoint` docstring), `docs/AGENTS/ai-assistant.md`

- [ ] **Step 1: Fix the count in the docstring**

It says "20 of the 21 `BUILTIN_FEATURE_GUIDES` are view-scoped". Measured 2026-09-08 it is **22 of 23**.
Replace the number with the reproduce command rather than a fresh number — an ungated count in a comment
is exactly what rotted here:

```bash
node -e "const s=require('fs').readFileSync('src/app/operating-guide-builtin.generated.ts','utf8');const b=s.slice(s.indexOf('BUILTIN_FEATURE_GUIDES'));console.log((b.match(/\"name\":/g)||[]).length, (b.match(/\"views\":/g)||[]).length)"
```

Run it and paste the output into the commit message. A bare `grep -c scope` answers 27 and is worthless —
the guide prose discusses project scope.

- [ ] **Step 2: Rewrite the cache section of `docs/AGENTS/ai-assistant.md`** (LF-only file)

Every "MUST stay in the uncached suffix, or it would invalidate the cached prefix" argument is now about
the **turn tail**, not the system suffix. State the ordering rule (tools → system → messages) explicitly,
say that volatile content in the system array made the whole transcript uncacheable, and record that the
guide stays in `system` deliberately with the open question from the spec's §3.

- [ ] **Step 3: Gates**

```bash
npm run docs:symbols:check > "$SCRATCH/sym.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Commit.**

---

## Task 11: Release

- [ ] **Step 1: Full local gate chain, one process at a time**

```bash
npx tsc --noEmit; echo "EXIT=$?"                                    # 0 (2 = diagnostics)
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/suite.log"
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
```

Assert `Test Files N` against the expected file count derived from the config **on this tree immediately
before the run** — never a pinned number.

- [ ] **Step 2: Bump and propagate**

Edit `src/app/version.ts` to `0.294.0` with today's build date. **0.294 is a new minor line, so it needs
a NEW codename** — unique per minor line, not across all history. Add the `CHANGELOG.md` entry, stating
explicitly that the caps now count cached tokens and will warn earlier. Then:

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"    # 1 = drift, 2 = the gate could not scan
```

- [ ] **Step 3: Commit the release** with `git commit --only` over the explicit path list.

- [ ] **Step 4: Owed manual verification — this is a gate, not a footnote**

Against a real Anthropic key and a real project: send two consecutive messages in one conversation and
read `cache_read_input_tokens` off the second response. It must be non-zero and roughly the transcript
size. **No unit test can prove this**; until it is done, the slice's central claim is unverified.

- [ ] **Step 5: Owed prompt-quality eval** (spec §6)

Run the five-prompt set against both layouts and record the answers. If it regresses, the fallback is
keeping `buildViewScopeBlock`'s output in `system`.

- [ ] **Step 6: Stop.** Do not push, open an MR, or merge without the user saying so explicitly.

---

## Verification checklist for the reviewer

- [ ] `system` is a one-element array on the chat path; `inline-ai-edit-call.ts` is byte-unchanged.
- [ ] The turn context appears in no persisted history, in any backend.
- [ ] At most four `cache_control` marks across tools + system + messages, in every tool variant.
- [ ] A pre-0.294 usage blob does not produce `NaN` anywhere.
- [ ] `tokenMultiplier` is applied to all four fields identically.
- [ ] Every mutation proof names which mutant backs which assertion, with `N failed / M passed` summing
      to the file's runtime test count.
