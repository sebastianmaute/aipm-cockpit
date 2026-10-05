// src/app/markdown-codecs.meta-slices.test.ts
//
// §630 — the Markdown half of §620, twin of csv-codecs.meta-slices.test.ts. A
// meta slice whose fenced JSON does not parse, or that parses but SANITIZES TO
// NOTHING, was dropped in silence by the Markdown decoders, and the next save
// rewrote the file without it. `markdownToWorkspace(text, diag)` now pushes the
// slice's key into `diag.decodeFailedSlices` — the same accumulator and the same
// 13 key names `jsonToWorkspace` uses.
//
// ★★ The §617 rule still holds: a stored `[]`, `{}` or blank value sanitizes to
//  nothing too, and must stay SILENT (each report pauses saving).
// ★ A heading whose ```json fence the decoder's regex cannot find still reads
//  as ABSENT, not as a failure — a known limitation noted at
//  `markdownToFieldVisibility`, and deliberately not pinned here.
// ★ The per-slice values are shared with the CSV twin
//  (src/test/meta-slices-fixtures.ts); this file adds only the headings.

import { afterEach, describe, expect, it, vi, onTestFinished } from "vitest";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";
import {
  ALL_META_KEYS,
  META_BLOB_CASES,
  type BlobKey,
  decodeWithDiag,
  fullMetaWorkspace,
  metaSlice as slice,
} from "../test/meta-slices-fixtures";

// Forces the documents/documentVersions rich-field pass to throw, as
// browser-backend.test.ts does for §620: a sanitizer that throws for any reason
// OTHER than a missing DOM (since §97 a real missing DOM throws
// `DomUnavailableError`, which `decodeMetaJson` rethrows). Delegates to the REAL implementation unless the
// flag is set, so every other test here runs the genuine pass.
const richFieldCtl = vi.hoisted(() => ({ throwing: false }));
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: Parameters<typeof actual.sanitizeDocumentRichFields>[0]) => {
      if (richFieldCtl.throwing) throw new TypeError("simulated rich-field sanitizer failure");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

afterEach(() => {
  richFieldCtl.throwing = false;
});

const HEADINGS: Record<BlobKey, string> = {
  fieldVisibility: "## Field Visibility",
  features: "## Functions",
  steeringCommittee: "## Steering Committee",
  timelogLinks: "## Timelog Links",
  knowledgeItems: "## Knowledge Items",
  insights: "## Insights",
  settingsOverrides: "## Settings Overrides",
  documents: "## Documents",
  documentVersions: "## Document versions",
  activityLog: "## Activity Log",
  budgetHistory: "## Budget History",
};

/** The shared eleven blob cases, each with its fenced-JSON heading. */
const BLOB_CASES = META_BLOB_CASES.map((c) => ({ ...c, heading: HEADINGS[c.key] }));

/** An empty workspace's Markdown with one extra section appended. */
function withSection(section: string): string {
  return `${workspaceToMarkdown(emptyWorkspace())}\n${section}`;
}

const fenced = (heading: string, json: string): string => [heading, "", "```json", json, "```", ""].join("\n");

const load = (text: string) => decodeWithDiag(markdownToWorkspace, text);

describe("markdownToWorkspace — a meta slice it could not keep is reported (§630)", () => {
  it.each(BLOB_CASES)("records $key when its JSON does not parse", ({ key, heading }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, "{not json")));
    expect(failed).toEqual([key]);
    expect(slice(ws, key)).toBeUndefined();
    expect(slice(bare, key)).toBeUndefined();
  });

  it.each(BLOB_CASES)("records $key when it parses but sanitizes to nothing", ({ key, heading, junk }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, JSON.stringify(junk))));
    expect(failed).toEqual([key]);
    // features is assigned whenever it decodes (an explicit [] means Simple
    // mode), so a drop leaves [] — the same return as before §630.
    expect(slice(ws, key)).toEqual(key === "features" ? [] : undefined);
    expect(slice(bare, key)).toEqual(slice(ws, key));
  });

  it.each(BLOB_CASES)("stays silent for a stored empty $key", ({ key, heading, empty, emptyDecoded }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, JSON.stringify(empty))));
    expect(failed).toEqual([]);
    expect(slice(ws, key)).toEqual(emptyDecoded);
    expect(slice(bare, key)).toEqual(emptyDecoded);
  });

  // ★ A blank fenced block carries nothing (§617), so it is silent — not a
  // parse failure — and decodes to absent, as the old `JSON.parse("")` throw did.
  it.each(["", "   "])("stays silent for a blank insights block %j", (inner) => {
    const { ws, failed } = load(withSection(fenced("## Insights", inner)));
    expect(failed).toEqual([]);
    expect(ws.insights).toBeUndefined();
  });

  it("records status when every field is dropped by the sanitizer", () => {
    const { ws, failed, bare } = load(withSection("## Project Status\n\n- ragOverride: X\n"));
    expect(failed).toEqual(["status"]);
    expect(ws.status).toEqual({});
    expect(bare.status).toEqual({});
  });

  it("records project when the sanitizer rejects the whole record", () => {
    const { ws, failed, bare } = load(withSection("## Project Meta\n\n- name: Proj\n- naceSection: ZZ\n"));
    expect(failed).toEqual(["project"]);
    expect(ws.project).toBeUndefined();
    expect(bare.project).toBeUndefined();
  });

  it.each([
    ["status", "## Project Status\n\n- narrative: \n"],
    ["project", "## Project Meta\n\n- name: \n"],
  ])("stays silent for a blank %s section", (_key, section) => {
    expect(load(withSection(section)).failed).toEqual([]);
  });

  it("stays silent when no meta section is present", () => {
    expect(load(workspaceToMarkdown(emptyWorkspace())).failed).toEqual([]);
  });

  it("records nothing for genuine values of all thirteen slices, and decodes each as before", () => {
    const full = fullMetaWorkspace();
    const { ws, failed, bare } = load(workspaceToMarkdown(full));
    expect(failed).toEqual([]);
    for (const key of ALL_META_KEYS) {
      expect(slice(ws, key), key).toBeDefined();
      // ★ Against the SOURCE value, not only the no-diag decode: both of those
      // go through decodeMetaJson, so a helper that returned the raw parse
      // instead of the sanitized value would pass a with/without comparison.
      expect(slice(ws, key), key).toEqual(slice(full, key));
      expect(slice(bare, key), key).toEqual(slice(full, key));
    }
    expect(Object.keys(ws.status ?? {}).length).toBeGreaterThan(0);
  });

  it("records each broken slice once when several fail in one file", () => {
    const text = withSection(
      fenced("## Insights", "{not json") + "\n" + fenced("## Activity Log", JSON.stringify([{ nope: 1 }])),
    );
    expect(load(text).failed.sort()).toEqual(["activityLog", "insights"]);
  });

  // ★ End to end through markdownToWorkspace, not only decodeMetaJson's own
  // unit test: a throw in the DOM-dependent rich-field pass loses both document
  // slices, and each must be reported while every other slice still decodes.
  it("records documents and documentVersions when the rich-field pass throws", () => {
    // ★ The clock is pinned: both decodes below stamp `new Date()` at day
    // precision, so a run across midnight would otherwise compare two dates.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const text = workspaceToMarkdown(fullMetaWorkspace());
    const reference = markdownToWorkspace(text);
    expect(reference.documents?.length, "non-vacuity").toBeGreaterThan(0);
    expect(reference.documentVersions?.length, "non-vacuity").toBeGreaterThan(0);
    richFieldCtl.throwing = true;
    const { ws, failed, bare } = load(text);
    expect([...failed].sort()).toEqual(["documentVersions", "documents"]);
    expect(ws.documents).toBeUndefined();
    expect(ws.documentVersions).toBeUndefined();
    expect(bare.documents).toBeUndefined();
    expect(bare.documentVersions).toBeUndefined();
    // Everything else decodes exactly as it does without the throw.
    const withoutDocs = (w: typeof ws) => ({ ...w, documents: undefined, documentVersions: undefined });
    expect(withoutDocs(ws)).toEqual(withoutDocs(reference));
    expect(ws.tasks.length).toBeGreaterThan(0);
  });

  it("does not throw without a diag", () => {
    expect(() => markdownToWorkspace(withSection(fenced("## Insights", "{not json")))).not.toThrow();
    expect(() => markdownToWorkspace(withSection("## Project Status\n\n- ragOverride: X\n"))).not.toThrow();
  });
});
