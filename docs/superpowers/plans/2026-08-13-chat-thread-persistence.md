# Chat Thread Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the AI chat panel's conversation per-project in Turso, as multiple named, switchable threads (sidebar list), while file-mode keeps today's ephemeral single-conversation behavior byte-for-byte unchanged.

**Architecture:** A new global Turso table `chat_threads` (one row per thread, project-scoped, kept OUT of `TABLE_NAMES` — mirrors the `committee_report_versions` precedent exactly, no `Workspace` field / no CSV/MD/JSON codec needed). `chat-panel.tsx` gains Turso-mode-only state: a fetched thread list, an active thread id, and a `busy`-transition effect that persists the just-settled turn's (attachment-stripped) history/display to Turso. A new `ChatThreadList` sidebar component (built only from `Button`/`IconButton`/`EmptyState`/`Input`) renders beside the existing transcript when `tursoMode` is true.

**Tech Stack:** Next.js/React/TypeScript, existing Turso HTTP-pipeline layer (`turso-pipeline.ts`), Vitest.

**Reference:** Design spec at `docs/superpowers/specs/2026-08-13-chat-thread-persistence-design.md` — read it once before starting; this plan implements it exactly, section by section.

**Efficiency note for whoever executes this:** per standing instruction, run only the test file(s) each task actually touches after that task's steps — do NOT run the full suite/shuffle/docs-gates until Task 9 (the final verification task). No hand-rolled UI chrome anywhere — every new visual piece is built from `Button`/`IconButton`/`EmptyState`/`Input`/`Banner`, matching the rest of this codebase.

---

### Task 1: Pure engine — `chat-threads.ts`

**Files:**
- Create: `src/app/chat-threads.ts`
- Test: `src/app/chat-threads.test.ts`

This is the DOM-free, i18n-free pure module: the `ChatThread` type, id minting, auto-naming from the first user message, and attachment stripping before persistence.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/chat-threads.test.ts
import { describe, it, expect } from "vitest";
import { deriveThreadName, stripAttachmentsForPersistence, newThreadId, THREAD_NAME_MAX } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";

describe("deriveThreadName", () => {
  it("returns the first user message, trimmed", () => {
    const display: DisplayItem[] = [{ kind: "user", text: "  Plan Q1 budget review  " }];
    expect(deriveThreadName(display)).toBe("Plan Q1 budget review");
  });

  it("returns '' when there is no user message yet", () => {
    expect(deriveThreadName([])).toBe("");
    expect(deriveThreadName([{ kind: "notice", text: "x" }])).toBe("");
  });

  it("ignores a later user message and only takes the first one", () => {
    const display: DisplayItem[] = [
      { kind: "user", text: "first" },
      { kind: "assistant", text: "reply" },
      { kind: "user", text: "second" },
    ];
    expect(deriveThreadName(display)).toBe("first");
  });

  it("truncates by code point, not UTF-16 unit, past THREAD_NAME_MAX", () => {
    // Each 🎯 is 2 UTF-16 code units but 1 code point — a naive .slice(0, N)
    // on the raw string would split one in half and corrupt it.
    const long = "🎯".repeat(THREAD_NAME_MAX + 5);
    const name = deriveThreadName([{ kind: "user", text: long }]);
    expect(Array.from(name.replace(/…$/, "")).length).toBe(THREAD_NAME_MAX);
    expect(name.endsWith("…")).toBe(true);
  });

  it("does not truncate a message at or under the cap", () => {
    const exact = "x".repeat(THREAD_NAME_MAX);
    expect(deriveThreadName([{ kind: "user", text: exact }])).toBe(exact);
  });
});

describe("stripAttachmentsForPersistence", () => {
  it("replaces image/document blocks with text placeholders", () => {
    const history: ApiMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "see attached" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
        ],
      },
    ];
    expect(stripAttachmentsForPersistence(history)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see attached" },
          { type: "text", text: "[attachment: image]" },
          { type: "text", text: "[attachment: document]" },
        ],
      },
    ]);
  });

  it("leaves string content and non-attachment blocks untouched", () => {
    const history: ApiMessage[] = [
      { role: "user", content: "plain text" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
    ];
    expect(stripAttachmentsForPersistence(history)).toEqual(history);
  });
});

describe("newThreadId", () => {
  it("returns a non-empty, unique string each call", () => {
    const a = newThreadId();
    const b = newThreadId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-threads.test.ts --reporter=dot`
Expected: FAIL with "Cannot find module './chat-threads'"

- [ ] **Step 3: Write the implementation**

```ts
// src/app/chat-threads.ts — pure, i18n-free, DOM-free engine for per-project AI
// chat threads. No React, no Turso IO — see chat-threads-schema.ts/
// chat-threads-store.ts for persistence. chat-panel.tsx is the sole consumer.
import type { ApiMessage, ContentBlock, DisplayItem, TextBlock } from "./chat-api";

export interface ChatThread {
  id: string;
  /** "default" in non-portfolio Turso mode, matching ChatPanel's own projectId default. */
  projectId: string;
  /** Auto-derived from the first user message on first save; empty until then —
   *  callers show a translated "Untitled chat" fallback (this module is i18n-free). */
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Attachment-stripped — see stripAttachmentsForPersistence. */
  history: ApiMessage[];
  display: DisplayItem[];
}

/** Auto-derived thread name is capped at this many Unicode code points. */
export const THREAD_NAME_MAX = 60;

/** Derive a thread's display name from its first user message. Returns "" when
 *  no user message exists yet. Truncates by code point (Array.from), not by
 *  UTF-16 slice — a multi-unit character (e.g. an emoji) at the boundary is
 *  never split into an orphan surrogate. */
export function deriveThreadName(display: readonly DisplayItem[]): string {
  const first = display.find((item) => item.kind === "user");
  if (!first) return "";
  const text = first.text.trim();
  const chars = Array.from(text);
  return chars.length > THREAD_NAME_MAX ? `${chars.slice(0, THREAD_NAME_MAX).join("")}…` : text;
}

/** Placeholder substituted for a stripped attachment block, or null if `block`
 *  isn't an attachment. */
function attachmentPlaceholder(block: ContentBlock): TextBlock | null {
  if (block.type === "image") return { type: "text", text: "[attachment: image]" };
  if (block.type === "document") return { type: "text", text: "[attachment: document]" };
  return null;
}

/** Strip attachment bytes from history before persisting to Turso. Rewriting
 *  every prior attachment on every turn's save (write-amplification) is why
 *  attachments are session-only — see the design doc's "Attachment handling"
 *  section. The live in-session transcript is untouched; only the persisted
 *  copy loses the original bytes. */
export function stripAttachmentsForPersistence(history: readonly ApiMessage[]): ApiMessage[] {
  return history.map((msg): ApiMessage => {
    if (typeof msg.content === "string") return msg;
    return { ...msg, content: msg.content.map((block) => attachmentPlaceholder(block) ?? block) };
  });
}

/** Mint a new thread id, preferring crypto.randomUUID (mirrors newTemplateId in
 *  settings-sections/templates-section.tsx). */
export function newThreadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-threads.test.ts --reporter=dot`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-threads.ts src/app/chat-threads.test.ts
git commit -m "feat: add chat-threads pure engine (id mint, auto-name, attachment stripping)"
```

---

### Task 2: Turso schema + store — `chat-threads-schema.ts` / `chat-threads-store.ts`

**Files:**
- Create: `src/app/chat-threads-schema.ts`
- Create: `src/app/chat-threads-store.ts`
- Test: `src/app/chat-threads-store.test.ts`

Mirrors `committee-report-versions-schema.ts` / `committee-report-versions-store.ts` / `committee-report-versions-store.test.ts` exactly — same split (schema = pure SQL builders, store = async IO), same "one combined test file covering both" shape (this repo has no separate schema-only test for that precedent either).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/chat-threads-store.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { loadThreads, saveThread, deleteThread } from "./chat-threads-store";
import { TABLE_NAMES } from "./turso-schema";
import type { ChatThread } from "./chat-threads";

const cfg = {} as never;
const th: ChatThread = {
  id: "t1",
  projectId: "p",
  name: "Q1 budget",
  createdAt: "c",
  updatedAt: "u",
  history: [{ role: "user", content: "hi" }],
  display: [{ kind: "user", text: "hi" }],
};

describe("chat-threads-store", () => {
  it("chat_threads is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("chat_threads");
  });

  it("saveThread prepends DDL, deletes then inserts the row, and prunes beyond the cap", async () => {
    await saveThread(cfg, th);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);

    const del = stmts.find((s: { sql: string }) => /^DELETE FROM chat_threads WHERE id = \?$/i.test(s.sql));
    expect(del).toBeTruthy();
    expect(del.args[0].value).toBe("t1");

    const insert = stmts.find((s: { sql: string }) => /INSERT INTO chat_threads/i.test(s.sql));
    expect(insert).toBeTruthy();
    expect(insert.args.map((a: { value: string }) => a.value)).toEqual([
      "t1", "p", "Q1 budget", "c", "u",
      JSON.stringify(th.history), JSON.stringify(th.display),
    ]);

    const prune = stmts.find((s: { sql: string }) => /DELETE FROM chat_threads WHERE project_id = \? AND id NOT IN/i.test(s.sql));
    expect(prune).toBeTruthy();
    expect(prune.args.map((a: { value: string }) => a.value)).toEqual(["p", "p", "50"]);
  });

  it("deleteThread prepends DDL and deletes by id", async () => {
    await deleteThread(cfg, "t1");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);
    const del = stmts.find((s: { sql: string }) => /DELETE FROM chat_threads WHERE id = \?/i.test(s.sql));
    expect(del).toBeTruthy();
    expect(del.args[0].value).toBe("t1");
  });

  it("loadThreads selects by project, newest-first, and decodes rows incl. JSON columns", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [
              { name: "id" }, { name: "project_id" }, { name: "name" },
              { name: "created_at" }, { name: "updated_at" },
              { name: "history_json" }, { name: "display_json" },
            ],
            rows: [
              [{ value: "t2" }, { value: "p" }, { value: "Later" }, { value: "c2" }, { value: "u2" }, { value: "[]" }, { value: "[]" }],
              [
                { value: "t1" }, { value: "p" }, { value: "Earlier" }, { value: "c1" }, { value: "u1" },
                { value: JSON.stringify(th.history) }, { value: JSON.stringify(th.display) },
              ],
            ],
          },
        },
      },
    ]);
    const out = await loadThreads(cfg, "p");
    const select = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
      .find((s: { sql: string }) => /SELECT \* FROM chat_threads/i.test(s.sql));
    expect(select.sql).toMatch(/WHERE project_id = \? ORDER BY updated_at DESC/i);
    expect(select.args[0].value).toBe("p");
    expect(out).toEqual([
      { id: "t2", projectId: "p", name: "Later", createdAt: "c2", updatedAt: "u2", history: [], display: [] },
      { id: "t1", projectId: "p", name: "Earlier", createdAt: "c1", updatedAt: "u1", history: th.history, display: th.display },
    ]);
  });

  it("rowsToThreads falls back to [] for a malformed JSON column", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [
              { name: "id" }, { name: "project_id" }, { name: "name" },
              { name: "created_at" }, { name: "updated_at" },
              { name: "history_json" }, { name: "display_json" },
            ],
            rows: [[{ value: "t1" }, { value: "p" }, { value: "N" }, { value: "c" }, { value: "u" }, { value: "not json" }, { value: "[]" }]],
          },
        },
      },
    ]);
    const out = await loadThreads(cfg, "p");
    expect(out[0].history).toEqual([]);
    expect(out[0].display).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-threads-store.test.ts --reporter=dot`
Expected: FAIL with "Cannot find module './chat-threads-schema'" (or `./chat-threads-store`)

- [ ] **Step 3: Write `chat-threads-schema.ts`**

```ts
// src/app/chat-threads-schema.ts — pure SQL builders + row decoder for the
// GLOBAL chat_threads table (per-project, multi-thread AI chat persistence).
// MUST stay OUT of turso-schema's TABLE_NAMES (guard test in
// chat-threads-store.test.ts) so the workspace save's per-table DELETE never
// touches it — chat threads are Turso-only, not a Workspace field, and need no
// CSV/MD/JSON codec. Mirrors committee-report-versions-schema.ts.
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import type { ChatThread } from "./chat-threads";

export const CHAT_THREADS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, history_json TEXT, display_json TEXT)`,
];

/** Retention cap: keep at most this many threads per project (oldest by
 *  updated_at pruned on each save beyond the cap). Higher than the committee
 *  report cap (25) — chat threads are casual/frequent, not formal snapshots. */
export const CHAT_THREAD_CAP = 50;

export const threadsSelect = (projectId: string): SqlStmt[] => [
  { sql: `SELECT * FROM chat_threads WHERE project_id = ? ORDER BY updated_at DESC`, args: [txt(projectId)] },
];

/** Upsert via delete-then-insert (mirrors the workspace save's own
 *  delete-then-insert-all convention) rather than an SQL upsert clause. */
export function upsertThreadStatements(th: ChatThread): SqlStmt[] {
  return [
    { sql: `DELETE FROM chat_threads WHERE id = ?`, args: [txt(th.id)] },
    {
      sql: `INSERT INTO chat_threads (id,project_id,name,created_at,updated_at,history_json,display_json) VALUES (?,?,?,?,?,?,?)`,
      args: [
        txt(th.id), txt(th.projectId), txt(th.name), txt(th.createdAt), txt(th.updatedAt),
        txt(JSON.stringify(th.history)), txt(JSON.stringify(th.display)),
      ],
    },
  ];
}

export function deleteThreadStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM chat_threads WHERE id = ?`, args: [txt(id)] }];
}

/** Delete all but the newest `keep` threads for one project (by updated_at). */
export function pruneThreadsStatements(projectId: string, keep: number): SqlStmt[] {
  return [{
    sql: `DELETE FROM chat_threads WHERE project_id = ? AND id NOT IN (SELECT id FROM chat_threads WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?)`,
    args: [txt(projectId), txt(projectId), int(keep)],
  }];
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function rowsToThreads(res: PipelineResultLike | undefined): ChatThread[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): ChatThread => ({
      id: r.id,
      projectId: r.project_id ?? "",
      name: r.name ?? "",
      createdAt: r.created_at ?? "",
      updatedAt: r.updated_at ?? "",
      history: parseJsonArray(r.history_json),
      display: parseJsonArray(r.display_json),
    }));
}
```

- [ ] **Step 4: Write `chat-threads-store.ts`**

```ts
// src/app/chat-threads-store.ts — async CRUD for per-project AI chat threads
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT
// EXISTS). Mirrors committee-report-versions-store.ts.
import { runTursoPipeline } from "./turso-pipeline";
import {
  CHAT_THREADS_DDL, CHAT_THREAD_CAP, threadsSelect, upsertThreadStatements,
  deleteThreadStatements, pruneThreadsStatements, rowsToThreads,
} from "./chat-threads-schema";
import type { ChatThread } from "./chat-threads";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => CHAT_THREADS_DDL.map((sql) => ({ sql }));

export async function loadThreads(config: TursoConfig | null, projectId: string): Promise<ChatThread[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...threadsSelect(projectId)]);
  return rowsToThreads(results[CHAT_THREADS_DDL.length]);
}

export async function saveThread(config: TursoConfig | null, th: ChatThread): Promise<void> {
  await runTursoPipeline(config, [
    ...ddl(),
    ...upsertThreadStatements(th),
    ...pruneThreadsStatements(th.projectId, CHAT_THREAD_CAP),
  ]);
}

export async function deleteThread(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteThreadStatements(id)]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/chat-threads-store.test.ts --reporter=dot`
Expected: PASS (5 tests)

- [ ] **Step 6: Typecheck the new files**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-threads-schema.ts src/app/chat-threads-store.ts src/app/chat-threads-store.test.ts
git commit -m "feat: add chat_threads Turso schema + store"
```

---

### Task 3: i18n keys

**Files:**
- Modify: `src/app/i18n.ts:646` (insert after `chatClearConfirm`)
- Modify: `src/app/i18n.de.ts` (matching German keys — same insertion point)

★ Landmine: the Edit tool corrupts umlauts and curly double-quotes in `i18n.de.ts` (it's CRLF). Patch it with a raw Node.js UTF-8 write script, never the Edit tool. Verify afterward with `grep` that no umlaut was mangled.

- [ ] **Step 1: Insert the EN keys**

In `src/app/i18n.ts`, find this exact block (currently lines 645-647):

```ts
  chatClear: "Clear chat",
  chatClearConfirm: "Clear this conversation? The messages will be removed.",
  chatStop: "Stop",
```

Replace with:

```ts
  chatClear: "Clear chat",
  chatClearConfirm: "Clear this conversation? The messages will be removed.",
  chatThreadNew: "New chat",
  chatThreadUntitled: "Untitled chat",
  chatThreadOpen: "Open \"{0}\"",
  chatThreadRename: "Rename \"{0}\"",
  chatThreadDelete: "Delete \"{0}\"",
  chatThreadDeleteConfirm: "Delete \"{0}\"? This chat's history will be removed.",
  chatThreadEmptyTitle: "No chats yet",
  chatThreadEmptyBody: "Start a new chat to begin.",
  chatThreadSaveFailed: "Couldn't save this chat.",
  chatThreadSaveRetry: "Retry",
  chatStop: "Stop",
```

- [ ] **Step 2: Run the DE patch script**

```bash
node -e "
const fs = require('fs');
const path = 'src/app/i18n.de.ts';
let text = fs.readFileSync(path, 'utf8');
const anchor = 'chatClearConfirm: \"Diesen Chatverlauf löschen? Die Nachrichten werden entfernt.\",\r\n';
if (!text.includes(anchor)) { throw new Error('anchor not found — check current i18n.de.ts wording near chatClearConfirm'); }
const insert = [
  '  chatThreadNew: \"Neuer Chat\",\r\n',
  '  chatThreadUntitled: \"Unbenannter Chat\",\r\n',
  '  chatThreadOpen: \"\\\"{0}\\\" öffnen\",\r\n',
  '  chatThreadRename: \"\\\"{0}\\\" umbenennen\",\r\n',
  '  chatThreadDelete: \"\\\"{0}\\\" löschen\",\r\n',
  '  chatThreadDeleteConfirm: \"\\\"{0}\\\" löschen? Der Verlauf dieses Chats wird entfernt.\",\r\n',
  '  chatThreadEmptyTitle: \"Noch keine Chats\",\r\n',
  '  chatThreadEmptyBody: \"Starten Sie einen neuen Chat, um zu beginnen.\",\r\n',
  '  chatThreadSaveFailed: \"Dieser Chat konnte nicht gespeichert werden.\",\r\n',
  '  chatThreadSaveRetry: \"Erneut versuchen\",\r\n',
].join('');
text = text.replace(anchor, anchor + insert);
fs.writeFileSync(path, text, 'utf8');
console.log('patched');
"
```

Expected output: `patched`. If it throws "anchor not found", read the actual current wording of `chatClearConfirm` in `i18n.de.ts` around the `chatClear`/`chatStop` keys first (it may differ slightly from the exact string quoted above) and adjust the `anchor` constant to match byte-for-byte before re-running — do not fall back to the Edit tool.

- [ ] **Step 3: Verify no corruption**

```bash
grep -n "chatThread" src/app/i18n.de.ts
```

Expected: 10 lines, German umlauts (ö, ü) rendered correctly (not `?` or mangled bytes), each line ending in a literal `\r` (CRLF preserved — check with `git diff` that no line-ending churn appears outside the inserted lines).

- [ ] **Step 4: Typecheck (enforces EN/DE key parity)**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add i18n strings for chat thread persistence"
```

---

### Task 4: `ChatThreadList` sidebar component

**Files:**
- Create: `src/app/chat-thread-list.tsx`
- Test: `src/app/chat-thread-list.test.tsx`

Presentational only — no data fetching, no Turso IO, no `useConfirm` (delete confirmation is the caller's job, exactly like `chatClear` already is in `chat-panel.tsx`). Built only from `Button`/`IconButton`/`EmptyState`/`Input`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/chat-thread-list.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatThreadList } from "./chat-thread-list";
import type { ChatThread } from "./chat-threads";

const threadA: ChatThread = { id: "a", projectId: "p", name: "Q1 budget", createdAt: "c", updatedAt: "u2", history: [], display: [] };
const threadB: ChatThread = { id: "b", projectId: "p", name: "", createdAt: "c", updatedAt: "u1", history: [], display: [] };

describe("ChatThreadList", () => {
  it("renders each thread with a row-unique accessible name and marks the active one", () => {
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: 'Open "Q1 budget"' })).toBeInTheDocument();
    // An empty name falls back to the translated "Untitled chat" placeholder.
    expect(screen.getByRole("button", { name: 'Open "Untitled chat"' })).toBeInTheDocument();
  });

  it("calls onSelect with the clicked thread's id", () => {
    const onSelect = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId="a"
        onSelect={onSelect}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Open "Untitled chat"' }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("calls onNew when the New chat button is clicked", () => {
    const onNew = vi.fn();
    render(
      <ChatThreadList lang="en-US" threads={[]} activeThreadId={null} onSelect={vi.fn()} onNew={onNew} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no threads", () => {
    render(
      <ChatThreadList lang="en-US" threads={[]} activeThreadId={null} onSelect={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
  });

  it("calls onDelete with the thread's id when its delete control is clicked (no confirm — caller's job)", () => {
    const onDelete = vi.fn();
    render(
      <ChatThreadList lang="en-US" threads={[threadA]} activeThreadId="a" onSelect={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Q1 budget"' }));
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("commits a rename on Enter and calls onRename with the trimmed draft", () => {
    const onRename = vi.fn();
    render(
      <ChatThreadList lang="en-US" threads={[threadA]} activeThreadId="a" onSelect={vi.fn()} onNew={vi.fn()} onRename={onRename} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Rename "Q1 budget"' }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("a", "Renamed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-thread-list.test.tsx --reporter=dot`
Expected: FAIL with "Cannot find module './chat-thread-list'"

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/chat-thread-list.tsx
"use client";

import { useState } from "react";
import { PencilIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { EmptyState } from "./empty-state";
import { Input } from "./form-controls";
import type { ChatThread } from "./chat-threads";

export interface ChatThreadListProps {
  lang: Lang;
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}

/** Turso-only chat thread sidebar. Built entirely from shared primitives — no
 *  hand-rolled list/row chrome. Rename is inline (its own local state); delete
 *  confirmation is the CALLER's responsibility (chat-panel already owns a
 *  `useConfirm` instance for "Clear chat") — this component only reports the
 *  intent via `onDelete`. */
export function ChatThreadList({
  lang,
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  className,
}: ChatThreadListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function startRename(th: ChatThread) {
    setRenamingId(th.id);
    setDraftName(th.name || t(lang, "chatThreadUntitled"));
  }
  function commitRename() {
    if (renamingId) onRename(renamingId, draftName.trim() || t(lang, "chatThreadUntitled"));
    setRenamingId(null);
  }

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className ?? ""}`}>
      <Button
        variant="secondary"
        size="sm"
        onClick={onNew}
        className="inline-flex items-center justify-center gap-1"
      >
        <PlusIcon aria-hidden="true" className="h-4 w-4" />
        {t(lang, "chatThreadNew")}
      </Button>
      {threads.length === 0 ? (
        <EmptyState compact title={t(lang, "chatThreadEmptyTitle")} description={t(lang, "chatThreadEmptyBody")} />
      ) : (
        <ul role="list" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {threads.map((th) => {
            const isActive = th.id === activeThreadId;
            const displayName = th.name || t(lang, "chatThreadUntitled");
            return (
              <li key={th.id}>
                {renamingId === th.id ? (
                  <Input
                    autoFocus
                    size="xs"
                    aria-label={t(lang, "chatThreadRename", displayName)}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <div className={`group flex items-center gap-1 rounded-md px-1 ${isActive ? "bg-surface-muted font-semibold" : ""}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(th.id)}
                      aria-label={t(lang, "chatThreadOpen", displayName)}
                      title={displayName}
                      className="min-w-0 flex-1 truncate rounded-md py-1.5 text-left text-sm hover:bg-surface-muted"
                    >
                      {/* Non-colour active marker (WCAG 1.4.1 — active state can't
                          ride the bg-surface-muted tint alone). aria-hidden: the
                          row's own accessible name already carries the state via
                          the button label; nothing here needs re-announcing. */}
                      <span aria-hidden className="mr-1">{isActive ? "●" : ""}</span>
                      {displayName}
                    </button>
                    <IconButton
                      label={t(lang, "chatThreadRename", displayName)}
                      title={t(lang, "chatThreadRename", displayName)}
                      onClick={() => startRename(th)}
                    >
                      <PencilIcon aria-hidden="true" className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      variant="danger"
                      label={t(lang, "chatThreadDelete", displayName)}
                      title={t(lang, "chatThreadDelete", displayName)}
                      onClick={() => onDelete(th.id)}
                    >
                      <TrashIcon aria-hidden="true" className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-thread-list.test.tsx --reporter=dot`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-thread-list.tsx src/app/chat-thread-list.test.tsx
git commit -m "feat: add ChatThreadList sidebar component"
```

---

### Task 5: `chat-panel.tsx` — Turso thread state + persistence effect (no JSX changes yet)

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/chat-panel.test.tsx`

This task wires up ALL the new state, effects, and handlers, but does not yet render `ChatThreadList` — the panel behaves exactly as before visually. Task 6 does the JSX/render wiring. Splitting this way keeps each commit reviewable and the diff in Task 6 small.

- [ ] **Step 1: Add new imports**

In `src/app/chat-panel.tsx`, find:

```ts
import { AiHttpError, classifyAiError } from "./ai-errors";
import { ToolBlock } from "./chat-tool-block";
```

Replace with:

```ts
import { AiHttpError, classifyAiError } from "./ai-errors";
import { ToolBlock } from "./chat-tool-block";
import type { TursoConfig } from "./turso-config";
import { loadThreads, saveThread, deleteThread as deleteThreadRow } from "./chat-threads-store";
import { type ChatThread, newThreadId, deriveThreadName, stripAttachmentsForPersistence } from "./chat-threads";
```

- [ ] **Step 2: Add the new props to both `ChatPanelImpl` and `ChatPanelInner`**

Find (in `ChatPanelImpl`'s destructured props, currently around line 60-89):

```ts
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
} & ChatConversationStoreProps) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner
      lang={lang}
      ai={ai}
      dictation={dictation}
      dispatcher={dispatcher}
      onChangeModel={onChangeModel}
      guides={guides}
      guidesReady={guidesReady}
      chatSeed={chatSeed}
      onChatSeedConsumed={onChatSeedConsumed}
      onConfigureAi={onConfigureAi}
      projectId={projectId}
      getChatConversation={getChatConversation}
      saveChatConversation={saveChatConversation}
    />
  );
}
```

Replace with:

```ts
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
  tursoMode = false,
  tursoConfig = null,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
  /** Turso-only multi-thread sidebar + persistence. False/null (the default)
   *  in file mode and in tests/popouts that don't pass them — chat behaves
   *  exactly as before: one ephemeral in-memory conversation, no sidebar. */
  tursoMode?: boolean;
  tursoConfig?: TursoConfig | null;
} & ChatConversationStoreProps) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner
      lang={lang}
      ai={ai}
      dictation={dictation}
      dispatcher={dispatcher}
      onChangeModel={onChangeModel}
      guides={guides}
      guidesReady={guidesReady}
      chatSeed={chatSeed}
      onChatSeedConsumed={onChatSeedConsumed}
      onConfigureAi={onConfigureAi}
      projectId={projectId}
      getChatConversation={getChatConversation}
      saveChatConversation={saveChatConversation}
      tursoMode={tursoMode}
      tursoConfig={tursoConfig}
    />
  );
}
```

- [ ] **Step 3: Mirror the same two props onto `ChatPanelInner`'s signature**

Find (currently around line 127-154):

```ts
function ChatPanelInner({
  lang,
  ai,
  dictation,
  dispatcher,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
} & ChatConversationStoreProps) {
```

Replace with:

```ts
function ChatPanelInner({
  lang,
  ai,
  dictation,
  dispatcher,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
  tursoMode = false,
  tursoConfig = null,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
  tursoMode?: boolean;
  tursoConfig?: TursoConfig | null;
} & ChatConversationStoreProps) {
```

- [ ] **Step 4: Guard the existing project-switch reconcile so it skips Turso mode**

Find (currently around line 168-174):

```ts
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  if (projectId !== seenProjectId) {
    setSeenProjectId(projectId);
    const next = getChatConversation?.(projectId);
    setHistory(next?.history ?? []);
    setDisplay(next?.display ?? []);
  }
```

Replace with:

```ts
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  if (projectId !== seenProjectId) {
    setSeenProjectId(projectId);
    // Turso mode resets history/display asynchronously via the thread-list
    // fetch effect below (it needs an await, so it can't be a synchronous
    // render-time reconcile) — skip the file-mode in-memory-cache path here.
    if (!tursoMode) {
      const next = getChatConversation?.(projectId);
      setHistory(next?.history ?? []);
      setDisplay(next?.display ?? []);
    }
  }
```

- [ ] **Step 5: Add Turso thread state + the fetch-on-mount/project-switch effect**

Find (currently around line 193-194, right after the existing `projectIdRef` declaration):

```ts
  const projectIdRef = useRef(projectId);
  const { ref: chatRef, reset: resetChatSize } = useResizable("aipm-cockpit:chat-size-v2");
```

Replace with:

```ts
  const projectIdRef = useRef(projectId);
  // Turso-only multi-thread state. `threads` holds each thread's FULL
  // ChatThread (incl. history/display) so switching between them is instant
  // with no second Turso round-trip — see the design's "already-fetched copy"
  // note. Always empty/unused in file mode.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadsError, setThreadsError] = useState(false);
  // Latest committed activeThreadId, read by the in-flight send to detect a
  // mid-send THREAD switch — same shape/purpose as projectIdRef above, which
  // only ever covered a project switch. Without this, switching to a different
  // thread while a send is in flight does nothing to stop that send: it isn't
  // cancelled, isn't aborted, and its replies keep writing into whatever
  // history/display the user has since switched to — silently corrupting the
  // NEWLY selected thread with the OLD thread's reply. Step 6 below extends
  // submitPrompt's own stale()/switchedAway checks to use this ref too; this
  // effect only keeps it current and aborts an in-flight send on a real change.
  const threadIdRef = useRef(activeThreadId);
  useEffect(() => {
    const prev = threadIdRef.current;
    threadIdRef.current = activeThreadId;
    if (prev !== activeThreadId) {
      cancelledRef.current = true;
      abortRef.current?.abort();
    }
  }, [activeThreadId]);
  // Turso mode: (re)fetch this project's thread list on mount and on project
  // switch, then adopt the most-recently-updated thread (or the empty state).
  // File mode never runs this — Step 4's render-time reconcile is its path.
  useEffect(() => {
    if (!tursoMode) return;
    let cancelled = false;
    setThreadsError(false);
    loadThreads(tursoConfig, projectId)
      .then((loaded) => {
        if (cancelled) return;
        setThreads(loaded);
        const next = loaded[0] ?? null;
        setActiveThreadId(next?.id ?? null);
        setHistory(next?.history ?? []);
        setDisplay(next?.display ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setThreadsError(true);
        setThreads([]);
        setActiveThreadId(null);
        setHistory([]);
        setDisplay([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tursoMode, projectId, tursoConfig]);
  const { ref: chatRef, reset: resetChatSize } = useResizable("aipm-cockpit:chat-size-v2");
```

- [ ] **Step 6: Extend `submitPrompt`'s mid-send guard to cover a thread switch, not just a project switch**

Without this, switching threads in the new sidebar while a send is in flight does nothing to stop that send — `stale()` and `switchedAway` only ever checked `projectIdRef`. The reply would keep writing into whatever history/display the user has since switched to, silently corrupting the NEWLY selected thread with the OLD thread's reply. Three edits inside `submitPrompt`:

Find (currently around line 283-287):

```ts
    // Bind this send to the project it started on. If the user switches project
    // mid-send, `stale()` becomes true and every subsequent state write is
    // skipped — the reply can't corrupt the new project's conversation.
    const sendProjectId = projectId;
    const stale = () => cancelledRef.current || projectIdRef.current !== sendProjectId;
```

Replace with:

```ts
    // Bind this send to the project AND thread it started on. If the user
    // switches project or thread mid-send, `stale()` becomes true and every
    // subsequent state write is skipped — the reply can't corrupt the new
    // project's or thread's conversation.
    const sendProjectId = projectId;
    const sendThreadId = activeThreadId;
    const stale = () =>
      cancelledRef.current || projectIdRef.current !== sendProjectId || threadIdRef.current !== sendThreadId;
```

Find (currently around line 439-442):

```ts
      // If the user switched project mid-send, this run belongs to another
      // project now showing a different conversation — don't write its notes or
      // history onto the current one (billing is still recorded).
      const switchedAway = projectIdRef.current !== sendProjectId;
```

Replace with:

```ts
      // If the user switched project or thread mid-send, this run belongs to
      // another conversation now showing on screen — don't write its notes or
      // history onto the current one (billing is still recorded).
      const switchedAway = projectIdRef.current !== sendProjectId || threadIdRef.current !== sendThreadId;
```

Find (currently around line 476-478):

```ts
      // Suppress when the user switched project mid-send (the abort/error belongs
      // to the old project's conversation, not the one now on screen).
      if (projectIdRef.current === sendProjectId) {
```

Replace with:

```ts
      // Suppress when the user switched project or thread mid-send (the abort/
      // error belongs to the old conversation, not the one now on screen).
      if (projectIdRef.current === sendProjectId && threadIdRef.current === sendThreadId) {
```

Run: `npx vitest run src/app/chat-panel.test.tsx --reporter=dot`
Expected: PASS (this is a pure guard extension — file mode's `activeThreadId` is always `null` at send-start and never changes mid-send, since `newThread`/`selectThread` are Turso-only-rendered controls, so `sendThreadId === threadIdRef.current` trivially holds throughout and file-mode behavior is unaffected)

- [ ] **Step 7: Add the busy-transition persistence effect + thread handlers**

Find (currently right after the `handleKeyDown` function, immediately before the `return (`):

```ts
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  }

  return (
```

Replace with:

```ts
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  }

  // Persist the just-settled turn (success, error, or cancel) to Turso. Fires
  // exactly once per submitPrompt() call, on the busy=true→false transition —
  // NOT on every history/display change (that would rewrite the whole thread
  // row, incl. every prior attachment placeholder, on each intermediate
  // setDisplay inside a turn). `history`/`display` are the FINAL, just-committed
  // state for the render this effect runs in: submitPrompt's `finally` block
  // (which calls setBusy(false)) always runs in the same async continuation as
  // the try/catch block's own last setHistory/setDisplay call, so React 18's
  // automatic batching commits them together in one render — this effect never
  // sees a stale mid-turn snapshot. Deliberately depends on [busy] ONLY (with
  // the lint escape hatch already used elsewhere in this file, e.g. the
  // chatSeed effect above) so it can't refire on the frequent history/display
  // churn WHILE busy stays true.
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!tursoMode || !wasBusy || busy) return;
    const id = activeThreadId ?? newThreadId();
    if (activeThreadId === null) setActiveThreadId(id);
    const existing = threads.find((th) => th.id === id);
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id,
      projectId,
      name: existing?.name ?? deriveThreadName(display),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      history: stripAttachmentsForPersistence(history),
      display,
    };
    setThreads((prev) => [thread, ...prev.filter((th) => th.id !== id)]);
    saveThread(tursoConfig, thread).catch(() => setThreadsError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  function selectThread(id: string) {
    if (id === activeThreadId) return;
    const target = threads.find((th) => th.id === id);
    setActiveThreadId(id);
    setHistory(target?.history ?? []);
    setDisplay(target?.display ?? []);
  }

  function newThread() {
    setActiveThreadId(newThreadId());
    setHistory([]);
    setDisplay([]);
    // No row inserted yet — the busy-transition effect above inserts it once
    // the first turn completes (mirrors "no row until first save" in the design).
  }

  async function renameThread(id: string, name: string) {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    const updated: ChatThread = { ...target, name, updatedAt: new Date().toISOString() };
    setThreads((prev) => prev.map((th) => (th.id === id ? updated : th)));
    try {
      await saveThread(tursoConfig, updated);
    } catch {
      setThreadsError(true);
    }
  }

  async function requestDeleteThread(id: string) {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    const displayName = target.name || t(lang, "chatThreadUntitled");
    if (!(await confirm({ message: t(lang, "chatThreadDeleteConfirm", displayName), tone: "danger" }))) return;
    const remaining = threads.filter((th) => th.id !== id);
    setThreads(remaining);
    if (activeThreadId === id) {
      const next = remaining[0] ?? null;
      setActiveThreadId(next?.id ?? null);
      setHistory(next?.history ?? []);
      setDisplay(next?.display ?? []);
    }
    try {
      await deleteThreadRow(tursoConfig, id);
    } catch {
      setThreadsError(true);
    }
  }

  return (
```

- [ ] **Step 8: Add regression tests for the new logic**

Append to `src/app/chat-panel.test.tsx` (check the existing top-of-file mocks first — it already mocks `./chat-api`'s `callClaude`; add a mock for the new store module alongside it):

```tsx
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));
```

```tsx
import { loadThreads, saveThread } from "./chat-threads-store";

describe("ChatPanel — Turso thread persistence", () => {
  it("does not fetch threads or show a sidebar-only prop set in file mode (tursoMode omitted)", () => {
    // Existing render helper from this file — reuse it; tursoMode defaults to false.
    renderChatPanel({});
    expect(loadThreads).not.toHaveBeenCalled();
  });

  it("fetches this project's threads on mount when tursoMode is true", async () => {
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "t1", projectId: "default", name: "Prior chat", createdAt: "c", updatedAt: "u", history: [], display: [{ kind: "user", text: "hi" }] },
    ]);
    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    await screen.findByText("hi");
    expect(loadThreads).toHaveBeenCalledWith({}, "default");
  });

  it("saves a new thread after the first turn completes, auto-named from the first message", async () => {
    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    await sendMessage("Plan the Q1 review");
    await waitFor(() => expect(saveThread).toHaveBeenCalled());
    const saved = (saveThread as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(saved.name).toBe("Plan the Q1 review");
    expect(saved.projectId).toBe("default");
  });
});
```

Note for whoever implements this step: adapt `renderChatPanel`/`sendMessage`/`screen`/`waitFor` to whatever this test file's existing helpers are actually named — read the top of `chat-panel.test.tsx` first (it already has a render helper and a "send a message" helper for the existing submit-flow tests; reuse them rather than inventing new ones). The three assertions above (no fetch in file mode; fetch-on-mount in Turso mode; auto-named save after first turn) are the behaviors that must be covered, however the existing helpers are named.

- [ ] **Step 9: Run the chat-panel tests**

Run: `npx vitest run src/app/chat-panel.test.tsx --reporter=dot`
Expected: PASS (all existing tests still green + the new ones)

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 11: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat: add Turso thread state, persistence effect, and handlers to ChatPanel"
```

---

### Task 6: `chat-panel.tsx` — render the sidebar

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/chat-panel.test.tsx`

Pure JSX wiring on top of Task 5's state/handlers. The existing return's outer `<div ref={chatRef} className={CHAT_PANE_CLASS}>` currently stacks its children in a column (via `VIEW_PANE_FILL_CLASS`'s `flex-col`); this task wraps those children in a new inner column and adds the sidebar as a sibling column, only in Turso mode.

- [ ] **Step 1: Add the import**

Find:

```ts
import { AiHttpError, classifyAiError } from "./ai-errors";
import { ToolBlock } from "./chat-tool-block";
import type { TursoConfig } from "./turso-config";
```

Replace with:

```ts
import { AiHttpError, classifyAiError } from "./ai-errors";
import { ToolBlock } from "./chat-tool-block";
import { ChatThreadList } from "./chat-thread-list";
import type { TursoConfig } from "./turso-config";
```

- [ ] **Step 2: Wrap the return in a sidebar + content row**

Find the opening of the return block:

```tsx
  return (
    // Centered half-size card, top-anchored. The corner drags to a custom size
    // (persisted via useResizable); ResetSizeButton restores the default.
    <div ref={chatRef} className={CHAT_PANE_CLASS}>
      <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
```

Replace with:

```tsx
  return (
    // Centered half-size card, top-anchored. The corner drags to a custom size
    // (persisted via useResizable); ResetSizeButton restores the default.
    <div ref={chatRef} className={CHAT_PANE_CLASS}>
      <div className="flex h-full min-h-0 flex-1 gap-3">
        {tursoMode && (
          <ChatThreadList
            lang={lang}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={selectThread}
            onNew={newThread}
            onRename={renameThread}
            onDelete={requestDeleteThread}
            className="w-56 shrink-0 border-r border-line pr-3"
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
```

- [ ] **Step 3: Close the two new wrapper divs at the end of the return**

Find the end of the return block:

```tsx
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "chatAttachmentHint")}</p>
    </div>
  );
}
```

Replace with:

```tsx
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "chatAttachmentHint")}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add a save-failure banner inside the sidebar column**

Find (the block just added in Step 2):

```tsx
        {tursoMode && (
          <ChatThreadList
            lang={lang}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={selectThread}
            onNew={newThread}
            onRename={renameThread}
            onDelete={requestDeleteThread}
            className="w-56 shrink-0 border-r border-line pr-3"
          />
        )}
```

Replace with:

```tsx
        {tursoMode && (
          <div className="flex w-56 shrink-0 flex-col gap-2 border-r border-line pr-3">
            {threadsError && (
              <Banner severity="error" role="alert" className="flex items-center justify-between gap-2 text-xs">
                <span>{t(lang, "chatThreadSaveFailed")}</span>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setThreadsError(false);
                    loadThreads(tursoConfig, projectId)
                      .then((loaded) => setThreads(loaded))
                      .catch(() => setThreadsError(true));
                  }}
                >
                  {t(lang, "chatThreadSaveRetry")}
                </Button>
              </Banner>
            )}
            <ChatThreadList
              lang={lang}
              threads={threads}
              activeThreadId={activeThreadId}
              onSelect={selectThread}
              onNew={newThread}
              onRename={renameThread}
              onDelete={requestDeleteThread}
              className="min-h-0 flex-1"
            />
          </div>
        )}
```

(This makes the `className` prop on `ChatThreadList` now only ever `"min-h-0 flex-1"` — the outer `w-56 shrink-0 border-r border-line pr-3` moved to the new wrapping div so the retry banner sits above the list, inside the same column.)

- [ ] **Step 5: Run the chat-panel tests**

Run: `npx vitest run src/app/chat-panel.test.tsx --reporter=dot`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Lint (this repo's real gate, not bare `npm run lint`)**

Run: `npx eslint --max-warnings=0 src/app/chat-panel.tsx src/app/chat-thread-list.tsx src/app/chat-threads.ts src/app/chat-threads-schema.ts src/app/chat-threads-store.ts`
Expected: 0 warnings/errors

- [ ] **Step 8: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat: render the Turso chat thread sidebar in ChatPanel"
```

---

### Task 7: Wire `tursoMode`/`tursoConfig` from `workspace-section.tsx`

**Files:**
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/workspace-section.test.tsx` (or `.characterization.test.tsx` — check which one asserts the `<ChatPanel>` prop list and add there)

- [ ] **Step 1: Add the import**

Find the existing import block that includes `ChatPanel` (near the top of the file) and add, near any other `turso-*` import if present, otherwise as a new line:

```ts
import { getTursoConfig } from "./turso-config";
```

- [ ] **Step 2: Compute the Turso config once, alongside the other derived values**

Find (currently around line 233):

```ts
  const effectiveSettings = useEffectiveSettings(currentProjectId ?? "default");
```

Replace with:

```ts
  const effectiveSettings = useEffectiveSettings(currentProjectId ?? "default");
  // Mirrors the per-component getTursoConfig(settings...) pattern already used
  // by portfolio-health-panel.tsx / project-empty-state.tsx / projects-panel.tsx
  // — each Turso-gated surface resolves its own config from settings rather
  // than threading a shared pre-computed object down. Gate on BOTH `mode` and
  // `tursoConfig !== null` (not just storageConfig.kind) per this repo's own
  // Turso-gating rule.
  const chatTursoConfig = getTursoConfig(settings.integrations?.turso?.databaseUrl, settings.integrations?.turso?.authToken);
  const chatTursoMode = mode === "turso" && chatTursoConfig !== null;
```

- [ ] **Step 3: Pass the two new props to `<ChatPanel>`**

Find (currently around line 348-367):

```tsx
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dictation={settings.dictation}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
            onConfigureAi={
              !isPopout && onOpenSettingsSection
                ? () => onOpenSettingsSection("ai")
                : undefined
            }
            onChangeModel={(model) => setSettings((s) => ({ ...s, ai: { ...s.ai, model } }))}
            guides={guides}
            guidesReady={guidesReady}
            chatSeed={pendingChatSeed}
            onChatSeedConsumed={clearChatSeed}
            projectId={currentProjectId ?? "default"}
            getChatConversation={getChatConversation}
            saveChatConversation={saveChatConversation}
          />
```

Replace with:

```tsx
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dictation={settings.dictation}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
            onConfigureAi={
              !isPopout && onOpenSettingsSection
                ? () => onOpenSettingsSection("ai")
                : undefined
            }
            onChangeModel={(model) => setSettings((s) => ({ ...s, ai: { ...s.ai, model } }))}
            guides={guides}
            guidesReady={guidesReady}
            chatSeed={pendingChatSeed}
            onChatSeedConsumed={clearChatSeed}
            projectId={currentProjectId ?? "default"}
            getChatConversation={getChatConversation}
            saveChatConversation={saveChatConversation}
            tursoMode={chatTursoMode}
            tursoConfig={chatTursoConfig}
          />
```

- [ ] **Step 4: Add/adjust a test asserting the new props are threaded**

Read `src/app/workspace-section.test.tsx` and `src/app/workspace-section.characterization.test.tsx` first to see which one already renders `WorkspaceSection` with a `mode`/`settings` prop and asserts on `ChatPanel`'s received props (this file mocks `ChatPanel` — check how). Add one assertion alongside whatever's already there for the chat panel, e.g.:

```ts
it("passes tursoMode=true and a resolved tursoConfig to ChatPanel when mode is turso and Turso is configured", () => {
  // Render with mode="turso" and settings.integrations.turso.{databaseUrl,authToken} set to a
  // valid pair (mirror whatever fixture this file already uses for a configured Turso settings
  // object — grep this file for "databaseUrl" first).
  // Assert the mocked ChatPanel was called with tursoMode: true and a non-null tursoConfig.
});

it("passes tursoMode=false when mode is 'file' even if Turso happens to be configured", () => {
  // Same settings fixture, mode="file" — assert tursoMode: false.
});
```

Write the concrete render calls and assertions using this file's own existing render helper and `ChatPanel` mock shape (do not invent a new mocking approach — match the file's established pattern).

- [ ] **Step 5: Run the workspace-section tests**

Run: `npx vitest run src/app/workspace-section.test.ts src/app/workspace-section.characterization.test.tsx --reporter=dot`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/app/workspace-section.tsx src/app/workspace-section.test.tsx src/app/workspace-section.characterization.test.tsx
git commit -m "feat: wire Turso config into ChatPanel from workspace-section"
```

---

### Task 8: Document the axe blind spot in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

Per the design doc: the sidebar only renders in Turso mode, the e2e a11y seed is file-mode, so the axe gate keeps scanning the unchanged file-mode chat panel and never sees the new sidebar. This must be stated explicitly, not left implicit — same convention as the existing Calendar/Snapshots Turso-gated-view bullets.

- [ ] **Step 1: Add a bullet to the "Architecture pointers" section**

Find the existing bullet block about the AI chat / rich-text note log area (search for `**Rich-text note log`), and insert a new bullet immediately before it (or after the nearest existing chat-related bullet — place it in the general vicinity of other AI-assistant bullets in this file):

```markdown
- **Chat thread persistence is Turso-only, and its sidebar is invisible to the axe gate.** `chat-panel.tsx`
  renders a `ChatThreadList` sidebar only when `tursoMode` is true; file mode is byte-identical to before
  this feature. "AI Assistant" IS in axe `A11Y_VIEWS`, but `e2e/seed.ts` seeds file mode — so the scan keeps
  covering the unchanged file-mode panel and never renders the sidebar at all. Same Turso-gated blind spot
  as Calendar/Snapshots. Unit tests (`chat-thread-list.test.tsx`, incl. row-unique accessible names with
  ≥2 threads seeded) are the ONLY coverage for this surface, plus a manual eye-verify against a real Turso
  project before shipping any change to it — don't read a green axe run as covering it.
```

- [ ] **Step 2: Verify the symbol-check gate still passes**

Run: `npm run docs:symbols:check`
Expected: exit 0 (every backticked name above — `chat-panel.tsx`, `ChatThreadList`, `tursoMode`, `A11Y_VIEWS`, `e2e/seed.ts`, `chat-thread-list.test.tsx` — already exists in `src`/`e2e` from the prior tasks)

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: note the Turso-gated chat-sidebar axe blind spot"
```

---

### Task 9: Final verification (the one time the full gates run)

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"`
Read the log. Expected: `EXIT=0`.

- [ ] **Step 2: Full lint (the real CI gate)**

Run: `npx eslint --max-warnings=0 src/app > /tmp/eslint.log 2>&1; echo "EXIT=$?"`
Read the log. Expected: `EXIT=0`.

- [ ] **Step 3: Full unit suite**

Run: `npm run test:run > /tmp/test.log 2>&1; echo "EXIT=$?"`
Read the log (never through a pipe/tail/grep for the exit code — this repo's own landmine). Expected: `EXIT=0`, all files passing.

- [ ] **Step 4: Shuffle-order gate**

Run: `npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Doc gates**

Run: `npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"` and `npm run docs:symbols:check > /tmp/symbols.log 2>&1; echo "EXIT=$?"`
Expected: both `EXIT=0`.

- [ ] **Step 6: File-size ratchet + duplication gate**

Run: `npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"` and `npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"`
Expected: both `EXIT=0`. If `chat-panel.tsx` is now close to or over the 800-line ratchet (check with `node -e "console.log(require('fs').readFileSync('src/app/chat-panel.tsx','utf8').split('\n').length)"`), this is a real signal — flag it rather than silently letting the gate fail; a Task 5/6-shape split (extract the new thread-state/handlers into a `use-chat-threads.ts` deps-object hook, mirroring this repo's own "Extraction conventions" for exactly this situation) is the fix, not shrinking comments.

- [ ] **Step 7: Manual eye-verify (owed, not skippable)**

Against a real Turso project (or a local self-hosted tursodb): open the AI Assistant view, confirm the sidebar renders, create 2+ threads, rename one, delete one, reload the page and confirm the threads and their history survive. This is the only check covering what axe cannot see (Task 8's note) — do it before calling the branch done, and say explicitly in the final report whether it was actually done or is still owed.

- [ ] **Step 8: Report**

Summarize: all gate results (pass/fail per gate), whether the eye-verify was performed, and total commit count on the branch.
