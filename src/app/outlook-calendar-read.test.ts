import { describe, it, expect, vi } from "vitest";

vi.mock("./outlook-graph", () => ({
  GRAPH: "https://graph.microsoft.com/v1.0",
  MAX_PAGES: 100,
  graphGet: vi.fn(),
}));
import { graphGet } from "./outlook-graph";
import { fetchProjectEventDates } from "./outlook-calendar-read";

describe("fetchProjectEventDates", () => {
  it("maps all-day start to a date-only string and surfaces isCancelled", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockResolvedValueOnce({
      value: [
        { id: "e1", start: { dateTime: "2026-04-01T00:00:00.0000000" }, isCancelled: false },
        { id: "e2", start: { dateTime: "2026-04-05T00:00:00" }, isCancelled: true },
        { id: "e3", start: null, isCancelled: false },
      ],
    });
    const out = await fetchProjectEventDates("tok", "proj-1");
    expect(out).toEqual([
      { id: "e1", date: "2026-04-01", isCancelled: false },
      { id: "e2", date: "2026-04-05", isCancelled: true },
      { id: "e3", date: null, isCancelled: false },
    ]);
  });
  it("follows @odata.nextLink paging", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any)
      .mockResolvedValueOnce({ value: [{ id: "e1", start: { dateTime: "2026-04-01T00:00:00" }, isCancelled: false }], "@odata.nextLink": "https://next" })
      .mockResolvedValueOnce({ value: [{ id: "e2", start: { dateTime: "2026-04-02T00:00:00" }, isCancelled: false }] });
    const out = await fetchProjectEventDates("tok", "proj-1");
    expect(out.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
  it("filters by the type-scoped category when entityType is given", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockResolvedValueOnce({ value: [] });
    await fetchProjectEventDates("tok", "proj-1", "task");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (graphGet as any).mock.calls[0][1] as string;
    expect(url).toContain(encodeURIComponent("AIPM:proj-1:task"));
    expect(url).toContain(encodeURIComponent("categories/any(c:c eq 'AIPM:proj-1:task')"));
  });
});
