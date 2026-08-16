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
//
// ★★ The scan is RECURSIVE and ALIAS-AWARE (code review caught both holes in
// an earlier revision of this file). src/app has convention subdirectories
// that hold view-mounted .tsx components (dashboard-sections/, insights/,
// settings-sections/, ...) — a non-recursive `readdirSync(__dirname)` cannot
// see a third mount placed in one of them, so it would ship a real WCAG
// 2.4.6 regression through a fully green guard. And a literal
// `"useTasksDedup("` substring search is defeated by
// `import { useTasksDedup as useDedup } from "./use-tasks-dedup"` — the call
// site would contribute zero matches and be silently exempt from every
// assertion. So this file (1) walks every subdirectory under src/app and
// (2) resolves each scanned file's own LOCAL binding name for the hook from
// its import statement before searching for a call.

const HOOK_MODULE_SUFFIX = "use-tasks-dedup";
const HOOK_EXPORT_NAME = "useTasksDedup";
// The single pre-existing mount that deliberately keeps the unqualified
// original name (see the doc comment on TasksDedupDeps.triggerQualifier).
const ALLOWED_UNQUALIFIED = ["tasks-section.tsx"];

interface CallSite {
  /** Path relative to src/app, forward-slash separated (e.g. "dashboard-sections/foo.tsx"). */
  file: string;
  /** Raw text of the resolved-binding-name `(...)` call argument, parens included. */
  block: string;
}

/** Extracts the full `(...)` argument block for one call, via paren counting. */
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

/**
 * Walks src/app RECURSIVELY, returning every non-test .ts/.tsx file as a
 * forward-slash relative path. A plain `readdirSync(__dirname)` only sees
 * top-level files — this project's convention subdirectories
 * (dashboard-sections/, settings-sections/, insights/, task-dedup/, ...)
 * would be invisible to it.
 */
function listSourceFiles(dir: string, relBase = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(join(dir, entry.name), rel));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Resolves the LOCAL binding name the hook was imported under in this file's
 * source, so `import { useTasksDedup as useDedup } from "./use-tasks-dedup"`
 * is caught under the alias "useDedup" rather than silently missed. Returns
 * null when the file doesn't import the hook at all (nothing to scan there).
 *
 * Deliberately does NOT resolve a namespace import (`import * as X from
 * "./use-tasks-dedup"`) — nothing in this codebase imports a hook that way
 * (grep-verified), and detecting `X.useTasksDedup(...)` call expressions is
 * meaningfully more parsing for a style this project doesn't use.
 */
function resolveLocalBindingName(source: string): string | null {
  const importMatch = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*${HOOK_MODULE_SUFFIX}["']`,
  ).exec(source);
  if (!importMatch) return null;
  const bindingMatch = new RegExp(`\\b${HOOK_EXPORT_NAME}\\b(?:\\s+as\\s+(\\w+))?`).exec(importMatch[1]);
  if (!bindingMatch) return null;
  return bindingMatch[1] ?? HOOK_EXPORT_NAME;
}

/**
 * The scan reads EVERY non-test source file under src/app — 868 files, ~6.9MB —
 * and that read is the entire cost of this file. All three tests below need the
 * same result, so without this memo the tree is walked and re-read three times.
 * Measured: file total 2.44s -> 0.83s, a ~3x cut in synchronous CPU-bound fs
 * work, which is what a saturated full-suite run is short of.
 *
 * ★★ IT DOES NOT HELP AGAINST THE 20s PER-TEST TIMEOUT, and an earlier revision
 * of this comment claimed it did. That cap is per TEST; the 2.44s was the FILE
 * total across three of them. Per-test before: 828/683/968ms. After: 833/1/1ms.
 * The worst single test is UNCHANGED — the first test still pays one full scan,
 * and no memo can make the first scan cheaper. The win is whole-suite CPU, not
 * headroom under the cap. Stated because the wrong reason invites the wrong fix:
 * anyone chasing the cap here should split the scan, not cache it harder.
 *
 * ★ Safe to cache for the lifetime of the module: the files are read from disk
 * and nothing in this suite writes to them, so a second scan is by construction
 * identical to the first. Scoped to this file by vitest's per-file module
 * registry, so it cannot leak across files under `--sequence.shuffle`, and
 * whichever test runs first pays the scan under intra-file shuffle.
 *
 * ★★ The element type is `Readonly<CallSite>`, not just a `readonly` ARRAY, and
 * the difference is the whole guarantee: `readonly CallSite[]` freezes the array
 * while leaving `callSites()[0].file = "x"` typecheck-CLEAN — i.e. it would not
 * prevent the one-test-corrupts-the-next failure this comment claims to prevent.
 * With both, in-place `.sort()`/`.push()` AND element writes are typecheck
 * errors, so that failure cannot be written silently. `.filter()`/`.map()` still
 * hand callers ordinary mutable arrays, so nothing downstream is inconvenienced.
 */
let cachedCallSites: readonly Readonly<CallSite>[] | null = null;

function callSites(): readonly Readonly<CallSite>[] {
  if (cachedCallSites === null) cachedCallSites = scanCallSites();
  return cachedCallSites;
}

function scanCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  const files = listSourceFiles(__dirname)
    // The hook DEFINES useTasksDedup(deps); it does not call itself.
    .filter((f) => f !== "use-tasks-dedup.tsx");
  for (const file of files) {
    const source = readFileSync(join(__dirname, ...file.split("/")), "utf8");
    const localName = resolveLocalBindingName(source);
    if (!localName) continue; // file doesn't import the hook — nothing to scan
    const callToken = `${localName}(`;
    let searchFrom = 0;
    for (;;) {
      const idx = source.indexOf(callToken, searchFrom);
      if (idx === -1) break;
      sites.push({ file, block: extractCallBlock(source, idx) });
      searchFrom = idx + callToken.length;
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
    // site, the array diff below names every extra offender by file (with its
    // subdirectory path, since `file` is the relative path from the recursive walk).
    expect(unqualified).toEqual(ALLOWED_UNQUALIFIED);
  });

  it("finds every call site by scanning the directory tree, so a new one cannot slip past", () => {
    // Discovery, not a hand-maintained list. Without this, a broken walk or a
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
