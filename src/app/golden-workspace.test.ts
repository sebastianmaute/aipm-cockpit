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

const goldenCsv = readFileSync(join(fixturesDir, "golden-workspace.csv"), "utf8");
const goldenMd = readFileSync(join(fixturesDir, "golden-workspace.md"), "utf8");

describe("golden workspace serializer bytes (storage path, no export config)", () => {
  test("workspaceToCsv(ws) is byte-identical to the committed CSV fixture", () => {
    expect(workspaceToCsv(ws)).toBe(goldenCsv);
  });

  test("workspaceToMarkdown(ws) is byte-identical to the committed Markdown fixture", () => {
    expect(workspaceToMarkdown(ws)).toBe(goldenMd);
  });

  test("CSV fixture parses back and re-serializes to the same bytes (stable fixed point)", () => {
    expect(workspaceToCsv(csvToWorkspace(goldenCsv))).toBe(goldenCsv);
  });

  test("Markdown fixture parses back and re-serializes to the same bytes (stable fixed point)", () => {
    expect(workspaceToMarkdown(markdownToWorkspace(goldenMd))).toBe(goldenMd);
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
