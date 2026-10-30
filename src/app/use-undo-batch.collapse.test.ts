// §774 — a staged plan collapses into ONE undo entry; its toast keeps what the captures said, but stays short.
import { describe, expect, it } from "vitest";
import { collapseCaptures } from "./use-undo-batch";
import { captureFieldPart, type CaptureCompositeOpts } from "./undo/use-undo-stack";

const part = () => captureFieldPart<{ id: number; a: number }>({ setter: () => {}, edits: [{ id: 1, before: { a: 1 }, after: { a: 2 } }] });
const opts = (toastText?: string): CaptureCompositeOpts => ({ kind: "task.updated", primaryCount: 1, parts: [part()], ...(toastText ? { toastText } : {}) });

describe("collapseCaptures keeps the captures' toast text, briefly", () => {
  it("joins up to two texts", () => {
    expect(collapseCaptures([opts("A moved."), opts(), opts("B moved.")])?.toastText).toBe("A moved. B moved.");
  });
  it("shows two and counts the rest", () => {
    expect(collapseCaptures([opts("A."), opts("B."), opts("C."), opts("D.")])?.toastText).toBe("A. B. (+2)");
  });
  it("leaves the generic toast when no capture had a text", () => {
    expect(collapseCaptures([opts(), opts()])?.toastText).toBeUndefined();
  });
});
