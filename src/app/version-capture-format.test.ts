import { describe, it, expect } from "vitest";
import {
  CAPTURE_FORMAT,
  PRE_FORMAT_2_BLIND_SLICES,
  readCaptureFormat,
  speaksForEmptySlices,
  stampCaptureFormat,
} from "./version-capture-format";

// A payload in the exact shape `workspaceToJson` emits: JSON.stringify(obj, null, 2).
const payload = (obj: Record<string, unknown>) => JSON.stringify(obj, null, 2);

describe("stampCaptureFormat", () => {
  it("round-trips through readCaptureFormat", () => {
    const stamped = stampCaptureFormat(payload({ tasks: [{ id: 1 }] }));
    expect(readCaptureFormat(stamped)).toBe(CAPTURE_FORMAT);
  });

  it("leaves the payload valid JSON with every original key intact", () => {
    const original = { tasks: [{ id: 1, title: "T" }], status: {}, milestones: [] };
    const parsed = JSON.parse(stampCaptureFormat(payload(original))) as Record<string, unknown>;
    // The marker is additive: nothing the workspace serializer wrote may move or vanish.
    expect(parsed.captureFormat).toBe(CAPTURE_FORMAT);
    for (const [k, v] of Object.entries(original)) expect(parsed[k]).toEqual(v);
  });

  // ★★ THE GUARD IS WHAT KEEPS THIS TOTAL, and the empty-object case is the one
  // that would produce INVALID JSON if it were dropped: `{}` does not start
  // `{\n  "`, and blind surgery on it yields `{\n  "captureFormat": 2,\n}` — a
  // trailing comma, which JSON.parse rejects. An unrecognised payload must come
  // back byte-identical and simply read as format 1, the safe reading.
  it("returns an unrecognised payload unchanged rather than corrupting it", () => {
    for (const odd of ["{}", "[]", "", "not json", '{"tasks":[]}']) {
      expect(stampCaptureFormat(odd)).toBe(odd);
    }
    expect(() => JSON.parse(stampCaptureFormat("{}"))).not.toThrow();
  });

  it("is idempotent in effect — stamping twice still reads one format", () => {
    const once = stampCaptureFormat(payload({ tasks: [] }));
    expect(readCaptureFormat(stampCaptureFormat(once))).toBe(CAPTURE_FORMAT);
  });
});

describe("readCaptureFormat", () => {
  it("returns null for an unstamped capture — every payload written before db217e08", () => {
    expect(readCaptureFormat(payload({ tasks: [{ id: 1 }] }))).toBeNull();
  });

  it("returns null rather than throwing on a malformed or non-object payload", () => {
    // A truncated payload is a load failure; the caller's own strict parse
    // reports it. Reading `null` here is the SAFE answer, not a silent one.
    for (const bad of ["", "{", "null", "[1,2]", '"a string"']) {
      expect(readCaptureFormat(bad)).toBeNull();
    }
  });

  it("ignores a non-numeric or non-finite marker", () => {
    for (const v of ['"2"', "null", "true", "1e999"]) {
      expect(readCaptureFormat(`{"captureFormat": ${v}, "tasks": []}`)).toBeNull();
    }
  });
});

describe("speaksForEmptySlices", () => {
  it("is false for an unstamped capture and true at the current format", () => {
    expect(speaksForEmptySlices(null)).toBe(false);
    expect(speaksForEmptySlices(CAPTURE_FORMAT)).toBe(true);
  });

  // ★★ `>=`, not `===`. A payload written by a NEWER build — a second tab
  // mid-upgrade, or a Turso project shared with one — carries a higher number
  // and still speaks for all six. Reading that as "cannot speak" is safe but
  // wrong, and would silently disable restore for anyone straddling a release.
  it("accepts a FUTURE format, not just the current one", () => {
    expect(speaksForEmptySlices(CAPTURE_FORMAT + 1)).toBe(true);
    expect(speaksForEmptySlices(CAPTURE_FORMAT + 99)).toBe(true);
    expect(speaksForEmptySlices(CAPTURE_FORMAT - 1)).toBe(false);
  });
});

describe("PRE_FORMAT_2_BLIND_SLICES", () => {
  // ★★★ Pinned by NAME, because both a wider and a narrower set is a defect and
  // neither shows up as a type error. Wider (adding `project`, or any of the
  // other always-emitted additive keys) silently turns every revert-to-unset
  // into a no-op. Narrower — dropping the singleton `settingsOverrides`, the
  // easy mistake, since its five siblings are arrays — lets a restore blank a
  // project's timezone and notification overrides. These are exactly the six
  // slices db217e08 added to `getVersionPayload`.
  it("holds exactly db217e08's six slices", () => {
    expect([...PRE_FORMAT_2_BLIND_SLICES].sort()).toEqual([
      "calendarEvents", "documentVersions", "documents",
      "insights", "knowledgeItems", "settingsOverrides",
    ]);
  });

  it("excludes the additive keys that were emitted all along", () => {
    for (const k of ["project", "steeringCommittee", "timelogLinks", "tasks", "fxRates"]) {
      expect(PRE_FORMAT_2_BLIND_SLICES.has(k)).toBe(false);
    }
  });
});
