// Golden-file guard for the dual-use workspace serializers.
//
// The no-config invocations `workspaceToCsv(ws)` / `workspaceToMarkdown(ws)`
// are the byte-stable STORAGE round-trip used by the file backend: users'
// on-disk files are re-emitted through them on every save. Any refactor of
// storage.ts (e.g. the planned module split) that changes a single emitted
// byte would silently rewrite users' files — these fixtures pin the exact
// bytes so such a change fails loudly here instead.
//
// The fixtures under src/app/__fixtures__/ were generated ONCE from the
// repo-root sample-workspace.json via the real decoder + serializers and are
// committed verbatim (marked `-text` in .gitattributes so git never performs
// line-ending conversion on them). They are intentionally DISTINCT from the
// repo-root sample-workspace.md / sample-workspace.csv, which are curated
// sources of truth with hand-escaped cells that the serializer does not
// reproduce. Do NOT regenerate the fixtures to "fix" a failure of this test:
// a failure means the storage byte format changed, which is the bug.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  csvToWorkspace,
  jsonToWorkspace,
  markdownToWorkspace,
  workspaceToCsv,
  workspaceToMarkdown,
} from "./storage";

const repoRoot = join(import.meta.dirname, "..", "..");
const fixturesDir = join(import.meta.dirname, "__fixtures__");

const sampleJson = readFileSync(join(repoRoot, "sample-workspace.json"), "utf8");
const ws = jsonToWorkspace(sampleJson);

// Note: readFileSync with "utf8" performs NO line-ending normalization — the
// raw bytes come through as-is, which is what byte-identity comparison needs.
const goldenCsv = readFileSync(join(fixturesDir, "golden-workspace.csv"), "utf8");
const goldenMd = readFileSync(join(fixturesDir, "golden-workspace.md"), "utf8");

// A failed toBe on a ~15 KB string prints an unreadable wall of diff; surface
// the first differing line instead, then fall through to toBe for the record.
function expectBytesEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    const actualLines = actual.split("\n");
    const expectedLines = expected.split("\n");
    const firstDiff = actualLines.findIndex((l, i) => l !== expectedLines[i]);
    const at = firstDiff === -1 ? expectedLines.length : firstDiff;
    throw new Error(
      `${label}: first difference at line ${at + 1}\n` +
        `  expected: ${JSON.stringify(expectedLines[at] ?? "<missing>")}\n` +
        `  actual:   ${JSON.stringify(actualLines[at] ?? "<missing>")}`,
    );
  }
  // Only reachable on equality — kept so the test still registers an assertion.
  expect(actual).toBe(expected);
}

describe("golden workspace serializer bytes (storage path, no export config)", () => {
  test("workspaceToCsv(ws) is byte-identical to the committed CSV fixture", () => {
    expectBytesEqual(workspaceToCsv(ws), goldenCsv, "CSV vs fixture");
  });

  test("workspaceToMarkdown(ws) is byte-identical to the committed Markdown fixture", () => {
    expectBytesEqual(workspaceToMarkdown(ws), goldenMd, "Markdown vs fixture");
  });

  test("CSV fixture parses back and re-serializes to the same bytes (stable fixed point)", () => {
    expectBytesEqual(workspaceToCsv(csvToWorkspace(goldenCsv)), goldenCsv, "CSV fixed point");
  });

  test("Markdown fixture parses back and re-serializes to the same bytes (stable fixed point)", () => {
    expectBytesEqual(workspaceToMarkdown(markdownToWorkspace(goldenMd)), goldenMd, "Markdown fixed point");
  });

  test("fixture line endings are untouched by checkout (CSV pure CRLF, MD pure LF)", () => {
    // workspaceToCsv emits RFC 4180 CRLF rows; workspaceToMarkdown emits LF.
    // If git eol-conversion ever mutated the fixtures (e.g. the -text
    // .gitattributes entries were lost), one of these would flip.
    const crlfCount = (goldenCsv.match(/\r\n/g) ?? []).length;
    expect((goldenCsv.match(/\r/g) ?? []).length).toBe(crlfCount); // no lone CR
    expect((goldenCsv.match(/\n/g) ?? []).length).toBe(crlfCount); // no lone LF
    expect(crlfCount).toBeGreaterThan(0);
    expect(goldenMd.includes("\r")).toBe(false);
  });
});
