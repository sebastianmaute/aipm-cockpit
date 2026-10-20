// §757 — the scroll panes whose first control sat flush with their clip edge carry RING_ROOM, so a 2px focus
// ring outside the control is not cut off. jsdom has no layout, so the class on each pane is the pin; the
// browser audit that found them is recorded in the register (§757).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RING_ROOM } from "./interaction-styles";

const PANES: readonly [file: string, container: RegExp][] = [
  ["steering-committee-panel.tsx", /className=\{`min-h-0 flex-1 overflow-auto \$\{RING_ROOM\}`\}/],
  ["report-table.tsx", /className=\{`min-h-0 flex-1 space-y-6 overflow-y-auto \$\{RING_ROOM\} pr-2`\}/],
  ["budget-panel.tsx", /className=\{`min-h-0 flex-1 space-y-6 overflow-y-auto \$\{RING_ROOM\} pr-2`\}/],
  ["documents-panel.tsx", /className=\{`flex min-h-0 flex-1 flex-col gap-3 overflow-auto \$\{RING_ROOM\}`\}/],
];

describe("RING_ROOM (§757)", () => {
  it("pads, and never by a negative margin that overlaps a neighbour", () => {
    expect(RING_ROOM).toBe("p-0.5");
  });

  it.each(PANES)("%s gives its scroll pane room for the ring", (file, container) => {
    expect(readFileSync(join(__dirname, file), "utf8")).toMatch(container);
  });
});
