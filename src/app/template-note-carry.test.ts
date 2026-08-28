import { describe, it, expect } from "vitest";
import { sanitizeSeedTask, sanitizeSeed } from "./templates";

describe("sanitizeSeedNoteLog, through sanitizeSeedTask", () => {
  it("carries a captured note log instead of dropping it", () => {
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>note</p>", text: "note" },
      ],
    });
    expect(task?.noteLog).toHaveLength(1);
    expect(task?.noteLog?.[0].html).toBe("<p>note</p>");
  });

  it("derives text from the sanitised html, not from the captured projection", () => {
    // A captured `text` can disagree with `html` — a hand-edited template, or an
    // entry whose html was narrowed by a sink change since capture. The html is
    // the source of truth, so a stale projection must not survive.
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>real</p>", text: "STALE" },
      ],
    });
    expect(task?.noteLog?.[0].text).toBe("real");
  });

  it("drops an entry with no usable id or timestamp, keeping its siblings", () => {
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>keep</p>", text: "keep" },
        { html: "<p>no id</p>", text: "no id" },
      ],
    });
    expect(task?.noteLog).toHaveLength(1);
    expect(task?.noteLog?.[0].text).toBe("keep");
  });

  it("omits noteLog entirely when nothing survives, rather than storing []", () => {
    // The field is optional on Task. An empty array is a different value from
    // absent and would round-trip differently through the six write paths.
    const task = sanitizeSeedTask({ id: 1, taskName: "T1", noteLog: [{ html: "<p>x</p>" }] });
    expect(task?.noteLog).toBeUndefined();
  });
});

describe("the RAID seed carry", () => {
  it("carries a captured RAID note log", () => {
    const seed = sanitizeSeed({
      raid: [
        {
          id: 1,
          category: "R",
          title: "R1",
          status: "Open",
          noteLog: [
            { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>raid note</p>", text: "raid note" },
          ],
        },
      ],
    });
    expect(seed?.raid?.[0].noteLog).toHaveLength(1);
    expect(seed?.raid?.[0].noteLog?.[0].text).toBe("raid note");
  });
});

describe("the change seed carry", () => {
  it("carries a captured change note log", () => {
    const seed = sanitizeSeed({
      changes: [
        {
          id: 1,
          title: "C1",
          noteLog: [
            { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>change note</p>", text: "change note" },
          ],
        },
      ],
    });
    expect(seed?.changes?.[0].noteLog).toHaveLength(1);
    expect(seed?.changes?.[0].noteLog?.[0].text).toBe("change note");
  });
});
