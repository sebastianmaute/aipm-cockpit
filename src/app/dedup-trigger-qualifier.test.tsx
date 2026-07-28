import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The "Deduplicate & unify tasks" trigger (useTasksDedup, ./use-tasks-dedup.tsx)
// is now mounted TWICE — tasks-section.tsx (Open Points) and gantt-view.tsx
// (Gantt). In the classic layout TasksSection and WorkspaceSection render
// SIMULTANEOUSLY (task-manager.tsx), so both triggers land in one DOM at once.
// Two controls sharing an accessible name is WCAG 2.4.6, and this project's
// axe gate can only flag a MISSING accessible name — it is BLIND to a
// duplicate one (the same defect class shipped once already in 0.204.0, see
// clear-label-uniqueness.test.tsx). Only every additional mount passing a
// non-empty `triggerQualifier` keeps the names apart. Delete this test and a
// future third mount (or a qualifier regression on an existing one) ships a
// silent a11y collision with nothing else to catch it.
//
// ★ A SOURCE scan, deliberately — mirrors clear-label-uniqueness.test.tsx.
// Rendering both views with enough providers/props to reach both triggers is
// a heavy fixture, and the failure mode (an unqualified call site) is fully
// visible in source.

const HOOK_CALL = "useTasksDedup(";
// The single pre-existing mount that deliberately keeps the unqualified
// original name (see the doc comment on TasksDedupDeps.triggerQualifier).
const ALLOWED_UNQUALIFIED = ["tasks-section.tsx"];

interface CallSite {
  file: string;
  /** Raw text of the `useTasksDedup({ ... })` argument, parens included. */
  block: string;
}

/** Extracts the full `(...)` argument block for one `useTasksDedup(` call, via paren counting. */
function extractCallBlock(source: string, callIndex: number): string {
  const openParenIndex = source.indexOf("(", callIndex);
  let depth = 0;
  let i = openParenIndex;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(openParenIndex, i + 1);
}

function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  const files = readdirSync(__dirname)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    // The hook DEFINES useTasksDedup(deps); it does not call itself.
    .filter((f) => f !== "use-tasks-dedup.tsx");
  for (const file of files) {
    const source = readFileSync(join(__dirname, file), "utf8");
    let searchFrom = 0;
    for (;;) {
      const idx = source.indexOf(HOOK_CALL, searchFrom);
      if (idx === -1) break;
      sites.push({ file, block: extractCallBlock(source, idx) });
      searchFrom = idx + HOOK_CALL.length;
    }
  }
  return sites;
}

describe("dedup trigger accessible-name qualifier", () => {
  it("no more than one call site omits triggerQualifier", () => {
    const unqualified = [
      ...new Set(
        callSites()
          .filter((s) => !/triggerQualifier\s*:/.test(s.block))
          .map((s) => s.file),
      ),
    ].sort();
    // Naming failure: if this ever grows past the one deliberately-unqualified
    // site, the array diff below names every extra offender by file.
    expect(unqualified).toEqual(ALLOWED_UNQUALIFIED);
  });

  it("finds every call site by scanning the directory, so a new one cannot slip past", () => {
    // Discovery, not a hand-maintained list. Without this, a broken glob or a
    // renamed hook would make callSites() return [] silently, both assertions
    // above would vacuously pass, and the guard would stay green forever
    // while providing zero protection.
    const files = [...new Set(callSites().map((s) => s.file))].sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain("tasks-section.tsx");
    expect(files).toContain("gantt-view.tsx");
  });

  it("every passed triggerQualifier is non-empty", () => {
    const emptyQualifiers = callSites().filter((s) => {
      const match = /triggerQualifier\s*:\s*([^,}]+)/.exec(s.block);
      if (!match) return false; // no qualifier at all — covered by the test above
      const value = match[1].trim();
      return value === '""' || value === "''" || value === "``";
    });
    expect(emptyQualifiers.map((s) => s.file)).toEqual([]);
  });
});
