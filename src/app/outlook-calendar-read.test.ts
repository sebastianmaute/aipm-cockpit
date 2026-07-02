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
    const { events, truncated } = await fetchProjectEventDates("tok", "proj-1");
    expect(events).toEqual([
      { id: "e1", date: "2026-04-01", endDate: null, isCancelled: false },
      { id: "e2", date: "2026-04-05", endDate: null, isCancelled: true },
      { id: "e3", date: null, endDate: null, isCancelled: false },
    ]);
    expect(truncated).toBe(false);
  });
  it("converts an exclusive all-day end back to an inclusive endDate", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockResolvedValueOnce({
      value: [
        { id: "e1", start: { dateTime: "2026-04-01T00:00:00.0000000" }, end: { dateTime: "2026-04-02T00:00:00.0000000" }, isCancelled: false },
      ],
    });
    const { events } = await fetchProjectEventDates("tok", "proj-1", "absence");
    // Graph all-day end is EXCLUSIVE (2026-04-02) => inclusive endDate is the day before.
    expect(events).toEqual([{ id: "e1", date: "2026-04-01", endDate: "2026-04-01", isCancelled: false }]);
  });
  it("selects the event end field in the built URL", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockResolvedValueOnce({ value: [] });
    await fetchProjectEventDates("tok", "proj-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (graphGet as any).mock.calls[0][1] as string;
    expect(url).toContain("$select=id,start,end,isCancelled");
  });
  it("follows @odata.nextLink paging", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any)
      .mockResolvedValueOnce({ value: [{ id: "e1", start: { dateTime: "2026-04-01T00:00:00" }, isCancelled: false }], "@odata.nextLink": "https://next" })
      .mockResolvedValueOnce({ value: [{ id: "e2", start: { dateTime: "2026-04-02T00:00:00" }, isCancelled: false }] });
    const { events, truncated } = await fetchProjectEventDates("tok", "proj-1");
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
    // nextLink ends (second page has no nextLink) → fully fetched.
    expect(truncated).toBe(false);
  });
  it("reports truncated:true when paging never ends before MAX_PAGES", async () => {
    // Always return an @odata.nextLink so the loop exits only on the page cap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (graphGet as any).mockResolvedValue({
      value: [{ id: "e", start: { dateTime: "2026-04-01T00:00:00" }, isCancelled: false }],
      "@odata.nextLink": "https://next",
    });
    const { truncated } = await fetchProjectEventDates("tok", "proj-1");
    expect(truncated).toBe(true);
    // MAX_PAGES mocked to 100 → exactly that many page requests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((graphGet as any).mock.calls.length).toBe(100);
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
