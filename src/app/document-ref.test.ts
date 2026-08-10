import { describe, expect, it } from "vitest";
import {
  MAX_LINKS_PER_DOC,
  indexDocumentsByEntity,
  refKey,
  resolveDocRef,
  sanitizeDocEntityRefs,
  type DocEntityRef,
  type DocRefLookups,
} from "./document-ref";

describe("sanitizeDocEntityRefs", () => {
  it("keeps a well-formed ref and drops the label when absent", () => {
    // ★★ toStrictEqual, NOT toEqual: toEqual IGNORES a key whose value is
    // `undefined`, so it would pass against `{ kind, id, label: undefined }` —
    // the exact shape the sparse rule exists to prevent, and the one that would
    // break the byte-pinned goldens. Only toStrictEqual sees the missing key.
    expect(sanitizeDocEntityRefs([{ kind: "task", id: 7 }])).toStrictEqual([{ kind: "task", id: 7 }]);
  });

  it("drops a blank or whitespace-only label rather than storing it", () => {
    expect(sanitizeDocEntityRefs([{ kind: "task", id: 7, label: "   " }])).toStrictEqual([
      { kind: "task", id: 7 },
    ]);
  });

  it("truncates an over-long label and trims what the cut exposes", () => {
    const label = `${"a".repeat(195)}${" ".repeat(20)}b`;
    const [ref] = sanitizeDocEntityRefs([{ kind: "task", id: 7, label }]);
    // slice-then-trim: the 200-char cut lands inside the run of spaces, and the
    // trim removes them. trim-then-slice would keep them.
    expect(ref.label).toBe("a".repeat(195));
  });

  it("drops an unknown kind rather than defaulting it", () => {
    expect(sanitizeDocEntityRefs([{ kind: "resource", id: 7 }])).toEqual([]);
  });

  it("drops a non-positive or non-finite id", () => {
    expect(
      sanitizeDocEntityRefs([
        { kind: "task", id: 0 },
        { kind: "task", id: "x" },
        { kind: "task", id: -1 },
        { kind: "task", id: Infinity },
        { kind: "task", id: NaN },
      ]),
    ).toEqual([]);
  });

  it("drops a FRACTIONAL id rather than flooring it to a real entity", () => {
    expect(sanitizeDocEntityRefs([{ kind: "task", id: 7.9 }])).toEqual([]);
  });

  it("drops a non-NUMBER id instead of coercing it", () => {
    // ★★ A bare `Number(...)` accepts all four of these: `Number(true)` is 1,
    // `Number("7")` and `Number(["7"])` are 7, and an object with a numeric
    // valueOf coerces too — each one silently inventing a link to a real
    // entity from a corrupt blob. Only `false` was rejected, and only by the
    // accident of coercing to 0.
    expect(
      sanitizeDocEntityRefs([
        { kind: "task", id: true },
        { kind: "task", id: "7" },
        { kind: "task", id: ["7"] },
        { kind: "task", id: { valueOf: () => 7 } },
      ]),
    ).toEqual([]);
  });

  it("de-duplicates on (kind, id) but keeps the same id under a different kind", () => {
    const out = sanitizeDocEntityRefs([
      { kind: "task", id: 7 },
      { kind: "task", id: 7 },
      { kind: "raid", id: 7 },
    ]);
    expect(out).toEqual([{ kind: "task", id: 7 }, { kind: "raid", id: 7 }]);
  });

  it("truncates at MAX_LINKS_PER_DOC", () => {
    const many = Array.from({ length: MAX_LINKS_PER_DOC + 5 }, (_, i) => ({ kind: "task", id: i + 1 }));
    expect(sanitizeDocEntityRefs(many)).toHaveLength(MAX_LINKS_PER_DOC);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeDocEntityRefs("nope")).toEqual([]);
  });
});

describe("resolveDocRef", () => {
  const lookups: DocRefLookups = {
    task: new Map([[7, "Live title"]]),
    milestone: new Map(),
    raid: new Map(),
    change: new Map(),
  };

  it("prefers the LIVE title over the stored tombstone label", () => {
    const ref: DocEntityRef = { kind: "task", id: 7, label: "Stale label" };
    expect(resolveDocRef(ref, lookups)).toEqual({ title: "Live title", dangling: false });
  });

  it("falls back to the label only when the id no longer resolves", () => {
    const ref: DocEntityRef = { kind: "task", id: 99, label: "Deleted thing" };
    expect(resolveDocRef(ref, lookups)).toEqual({ title: "Deleted thing", dangling: true });
  });

  it("reports dangling with an empty title when there is no label either", () => {
    expect(resolveDocRef({ kind: "task", id: 99 }, lookups)).toEqual({ title: "", dangling: true });
  });
});

describe("indexDocumentsByEntity", () => {
  it("keys by kind and id, and a document with two refs appears under both", () => {
    const docs: { id: number; linkedEntities?: DocEntityRef[] }[] = [
      { id: 1, linkedEntities: [{ kind: "task", id: 7 }, { kind: "raid", id: 7 }] },
      { id: 2, linkedEntities: [{ kind: "task", id: 7 }] },
      { id: 3 },
    ];
    const index = indexDocumentsByEntity(docs);
    expect(index.get(refKey("task", 7))?.map((d) => d.id)).toEqual([1, 2]);
    expect(index.get(refKey("raid", 7))?.map((d) => d.id)).toEqual([1]);
    expect(index.get(refKey("change", 7))).toBeUndefined();
  });
});
