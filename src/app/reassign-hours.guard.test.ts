// §774 — every place that WRITES a task owner either moves the planned hours (through the shared step,
// `use-reassign-hours.ts`) or says here why it does not. The scan uses the TypeScript parser, not a regex:
// it flags each non-test source file holding an object literal that sets `assignee` AND `resourceId`, the
// shape every owner write takes. A new file with that shape fails this test until it is routed or exempted.
// ★ What the scan cannot see: an owner written through a patch object built elsewhere (the table's inline cell
// sends `{ assignee, assigneeEmail, resourceId }` from `task-row.tsx` to `tasks-section.tsx`'s `onInlinePatch`,
// so the literal sits in `task-row.tsx`). The lists name the file that holds the literal.
// ★★ The check is per FILE, not per write: once a file is listed, a second, unrouted owner write added to
// the same file passes. `use-chat-dispatcher.ts` is listed because of its `create_task` literal; its routed
// `update_task` builds the owner through `withReassignFields`, which this scan cannot see at all.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "app");

/** Files whose owner write goes through `prepare` / `reassignTasks` (Tasks 4–5). */
const ROUTED: Readonly<Record<string, string>> = {
  "use-reassign-hours.ts": "the shared step itself",
  "workload-triage-handlers.ts": "Workload triage Owner select → reassignTasks",
  "use-action-center-handlers.ts": "Next actions Assign owner → reassignTasks",
  "use-task-submit.ts": "the task editor's save → prepare + record",
  "use-task-row-handlers.ts": "Kanban drop and card pick → prepare + record",
  "task-row.tsx": "the table's inline assignee patch, applied by tasks-section.tsx onInlinePatch → prepare + record",
  "bulk-operations-helpers.ts": "bulk edit's owner resolution (resolveBulkOwner), applied by use-bulk-operations.ts → prepare",
  "use-chat-dispatcher.ts": "Claude's update_task (chat, inline AI edit, staged plans) → prepare; its create_task is a create",
};

/** Files that hold the shape but are not a reassignment, each with why. */
const EXEMPT: Readonly<Record<string, string>> = {
  "csv-codecs-decode.ts": "decoder: loading a workspace never moves hours",
  "markdown-codecs-decode.ts": "decoder: loading a workspace never moves hours",
  "sanitize-entities.ts": "sanitizer: load-time shape, not a write by a person or Claude",
  "sanitize-allowlist-guards.ts": "sanitizer allow-list, not a write",
  "use-outlook-imports.ts": "Outlook import: an import never moves hours",
  "task-linked-task-modal.tsx": "creates a new linked task; a create has no old owner",
  "wbs-plan/wbs-plan.ts": "creates split pieces and new tasks; the original task keeps its owner",
  "task-form-context.tsx": "the editor's empty form state; the save is routed in use-task-submit.ts",
  "task-form-fields.tsx": "the editor's field state; the save is routed in use-task-submit.ts",
  "task-kanban.ts": "builds Kanban lane descriptors for display, writes no task",
  "export-column-labels.ts": "export column labels, not a write",
  "chat-tool-defs.ts": "the tool schema Claude reads, not a write",
  "absence-edit-modal.tsx": "an absence's person, not a task owner",
  "shift-edit-modal.tsx": "a shift's person, not a task owner",
  "calendar-drag.ts": "moves an absence or shift between people, not a task owner",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  return p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
}

/** Files (relative to src/app, `/`-separated) holding an object literal with both `assignee` and `resourceId`. */
function ownerWriterFiles(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(ROOT)) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isObjectLiteralExpression(n)) {
        const names = new Set(n.properties.map(propName));
        if (names.has("assignee") && names.has("resourceId")) { hit = true; return; }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (hit) found.add(relative(ROOT, file).split(sep).join("/"));
  }
  return found;
}

describe("every task-owner writer moves hours or says why not (§774)", () => {
  const found = ownerWriterFiles();

  it("finds owner writers at all (the scan is not vacuous)", () => {
    expect(found.size).toBeGreaterThan(5);
    expect(found.has("use-reassign-hours.ts")).toBe(true);
  });

  it("every file with an owner write is routed or exempt", () => {
    const unlisted = [...found].filter((f) => !(f in ROUTED) && !(f in EXEMPT)).sort();
    expect(unlisted, "route these through use-reassign-hours.ts, or add them to EXEMPT with a reason").toEqual([]);
  });

  it("every listed file exists, still holds an owner write, and is listed once", () => {
    const listed = [...Object.keys(ROUTED), ...Object.keys(EXEMPT)];
    expect(Object.keys(ROUTED).length).toBeGreaterThan(0);
    expect(Object.keys(EXEMPT).length).toBeGreaterThan(0);
    expect(new Set(listed).size).toBe(listed.length);
    for (const f of listed) {
      expect(existsSync(join(ROOT, f)), `${f} does not exist`).toBe(true);
      expect(found.has(f), `${f} no longer holds an owner write; drop it from the list`).toBe(true);
    }
  });
});
