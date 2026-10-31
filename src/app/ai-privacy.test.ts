import { describe, expect, it } from "vitest";
import { hasUnredactableContent, holdsUnredactableContent } from "./ai-privacy";

// Review 4, M2: only CONTENT can be unredactable — a message's content blocks and a tool_result's content. A
// `tool_use.input` is data the model wrote: an object in it that happens to say {type:"image"} is not an image the
// request carries, and must not lock every later protected send in the thread.

const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
const pdf = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } };
const textDoc = { type: "document", source: { type: "text", media_type: "text/plain", data: "notes" } };

const toolUse = (input: unknown) => ({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "update_task", input }] });

describe("holdsUnredactableContent (review 4, M2)", () => {
  it("an image or PDF in a message's content is unredactable", () => {
    expect(holdsUnredactableContent([{ role: "user", content: [{ type: "text", text: "see" }, image] }])).toBe(true);
    expect(holdsUnredactableContent([{ role: "user", content: [pdf] }])).toBe(true);
    expect(holdsUnredactableContent(image)).toBe(true);
    expect(holdsUnredactableContent([image])).toBe(true);
  });

  it("an image inside a tool_result's content (nested arrays too) is unredactable", () => {
    const result = { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "x" }, image] };
    expect(holdsUnredactableContent([{ role: "user", content: [result] }])).toBe(true);
    expect(hasUnredactableContent(JSON.stringify({ messages: [{ role: "user", content: [result] }] }))).toBe(true);
  });

  it("a plain-text document and text blocks are redactable", () => {
    expect(holdsUnredactableContent([{ role: "user", content: [textDoc, { type: "text", text: "hi" }] }])).toBe(false);
    expect(hasUnredactableContent(JSON.stringify({ system: "s", messages: [{ role: "user", content: "hi" }] }))).toBe(false);
  });

  it("an image- or document-shaped object inside a tool_use input is NOT content", () => {
    const history = [
      { role: "user", content: "attach it" },
      toolUse({ id: 1, payload: image, nested: [{ deeper: pdf }] }),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ];
    expect(holdsUnredactableContent(history)).toBe(false);
    expect(hasUnredactableContent(JSON.stringify({ messages: history }))).toBe(false);
    // The same objects as a direct input value are still not content.
    expect(holdsUnredactableContent([toolUse(image)])).toBe(false);
  });
});
