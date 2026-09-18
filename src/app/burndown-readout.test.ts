import { describe, expect, it } from "vitest";
import type { ChartModel } from "./burndown-geometry";
import { nearestStop, readoutAt, readoutStops } from "./burndown-readout";

const BASE: ChartModel = {
  empty: false,
  xDomain: ["2026-01-01", "2026-03-01"],
  yDomain: [0, 100],
  total: 100,
  planned: [{ date: "2026-01-01", value: 100 }, { date: "2026-03-01", value: 0 }],
  actual: [{ date: "2026-01-01", value: 100 }, { date: "2026-02-01", value: 60 }],
  over: false,
  pace: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 10 },
    endFigure: -10, vac: -10,
  },
  efficiency: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 20 },
    endFigure: -5, vac: -5,
  },
  runOut: { date: "2026-02-15", value: 0 },
  ev: { date: "2026-02-01", value: 55 },
  evSegments: null,
  evJoins: [],
  evPartialNames: [],
  evUnavailable: null,
  bacSteps: null,
  bacBaseline: null,
  bacMarkers: [],
  bacLine: 100,
  today: "2026-02-01",
  planEnd: "2026-03-01",
  frameDiffers: false,
};
const model = (over: Partial<ChartModel>): ChartModel => ({ ...BASE, ...over });

describe("readoutStops", () => {
  it("unions every series date with today, plan end, markers and the run-out", () => {
    const stops = readoutStops(model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 100 }],
      bacBaseline: 90,
      bacMarkers: [{ date: "2026-01-20", value: 100, amount: 10, label: "Vendor", removed: false }],
    }));
    expect(stops).toEqual([
      "2026-01-01", "2026-01-20", "2026-02-01", "2026-02-15", "2026-03-01",
    ]);
  });

  it("de-duplicates and sorts", () => {
    const stops = readoutStops(model({ actual: [{ date: "2026-03-01", value: 0 }] }));
    expect(stops).toEqual(["2026-01-01", "2026-02-01", "2026-02-15", "2026-03-01"]);
  });

  it("is empty for an empty model", () => {
    expect(readoutStops(model({ empty: true }))).toEqual([]);
  });
});

describe("readoutAt", () => {
  it("lists plan, budget and actual where their points exist", () => {
    const out = readoutAt(model({}), "2026-01-01")!;
    expect(out.rows.map((r) => [r.kind, r.value])).toEqual([
      ["plan", 100], ["budget", 100], ["actual", 100],
    ]);
    expect(out.today).toBe(false);
  });

  it("omits a series that has no point at the stop", () => {
    const out = readoutAt(model({}), "2026-02-01")!;
    expect(out.rows.some((r) => r.kind === "plan")).toBe(false);
    expect(out.rows.some((r) => r.kind === "actual")).toBe(true);
    expect(out.today).toBe(true);
  });

  it("reads the stepped budget at its current level, plus the baseline row", () => {
    const stepped = model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 100 }],
      bacBaseline: 90,
      bacLine: null,
    });
    expect(readoutAt(stepped, "2026-01-01")!.rows.find((r) => r.kind === "budget")!.value).toBe(90);
    expect(readoutAt(stepped, "2026-02-01")!.rows.find((r) => r.kind === "budget")!.value).toBe(100);
    expect(readoutAt(stepped, "2026-02-01")!.rows.find((r) => r.kind === "baseline")!.value).toBe(90);
  });

  it("interpolates each forecast inside its own segment and omits it outside", () => {
    const at = readoutAt(model({}), "2026-02-15")!;
    const pace = at.rows.find((r) => r.kind === "pace")!;
    const eff = at.rows.find((r) => r.kind === "efficiency")!;
    // 14 of 28 days from 60 → 10 is 35; 60 → 20 is 40.
    expect(pace.value).toBeCloseTo(35, 5);
    expect(pace.forecast).toBe(true);
    expect(eff.value).toBeCloseTo(40, 5);
    const before = readoutAt(model({}), "2026-01-01")!;
    expect(before.rows.some((r) => r.kind === "pace" || r.kind === "efficiency")).toBe(false);
    const after = readoutAt(model({}), "2026-03-15")!;
    expect(after.rows.some((r) => r.kind === "pace" || r.kind === "efficiency")).toBe(false);
  });

  it("takes a forecast's own endpoint value rather than interpolating a zero-length span", () => {
    const flat = model({
      pace: {
        from: { date: "2026-02-01", value: 60 }, to: { date: "2026-02-01", value: 60 },
        endFigure: 0, vac: 0,
      },
    });
    expect(readoutAt(flat, "2026-02-01")!.rows.find((r) => r.kind === "pace")!.value).toBe(60);
  });

  it("reads the stepped budget at a real duplicate-date change (before/after pair, same date)", () => {
    const stepped = model({
      bacSteps: [
        { date: "2026-01-01", value: 90 },
        { date: "2026-01-20", value: 90 },
        { date: "2026-01-20", value: 82 },
        { date: "2026-03-01", value: 82 },
      ],
      bacBaseline: 90,
      bacLine: null,
    });
    expect(readoutAt(stepped, "2026-01-20")!.rows.find((r) => r.kind === "budget")!.value).toBe(82);
  });

  it("shows the EV diamond (evPoint) in the default burndown shape, where evSegments is null", () => {
    const out = readoutAt(model({}), "2026-02-01")!;
    expect(out.rows.find((r) => r.kind === "evPoint")).toMatchObject({ value: 55 });
    expect(out.rows.some((r) => r.kind === "ev")).toBe(false);
  });

  it("shows both the EV history row and the EV diamond in the cumulative shape, ev before evPoint", () => {
    const withBoth = model({
      evSegments: [
        { partial: false, points: [{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 55 }] },
      ],
      ev: { date: "2026-02-01", value: 55 },
    });
    const out = readoutAt(withBoth, "2026-02-01")!;
    const kinds = out.rows.map((r) => r.kind);
    expect(kinds).toContain("ev");
    expect(kinds).toContain("evPoint");
    expect(kinds.indexOf("ev")).toBeLessThan(kinds.indexOf("evPoint"));
  });

  it("omits the EV diamond at a stop that is not the EV point's own date", () => {
    const out = readoutAt(model({}), "2026-01-01")!;
    expect(out.rows.some((r) => r.kind === "evPoint")).toBe(false);
  });

  it("flags a partial earned-value point and prefers a complete span on a shared boundary", () => {
    const withEv = model({
      evSegments: [
        { partial: true, points: [{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 55 }] },
        { partial: false, points: [{ date: "2026-02-01", value: 55 }, { date: "2026-03-01", value: 80 }] },
      ],
    });
    expect(readoutAt(withEv, "2026-01-01")!.rows.find((r) => r.kind === "ev")!.partial).toBe(true);
    expect(readoutAt(withEv, "2026-02-01")!.rows.find((r) => r.kind === "ev")!.partial).toBe(false);
  });

  it("adds the marker's names and signed amount on a change date", () => {
    const out = readoutAt(model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 82 }],
      bacBaseline: 90,
      bacLine: null,
      bacMarkers: [{ date: "2026-01-20", value: 82, amount: -8, label: "Ops", removed: true }],
    }), "2026-01-20")!;
    const change = out.rows.find((r) => r.kind === "change")!;
    expect(change).toMatchObject({ value: -8, label: "Ops", removed: true });
  });

  it("adds the run-out row only on the run-out date", () => {
    expect(readoutAt(model({}), "2026-02-15")!.rows.some((r) => r.kind === "runOut")).toBe(true);
    expect(readoutAt(model({}), "2026-02-01")!.rows.some((r) => r.kind === "runOut")).toBe(false);
  });

  it("returns null when nothing is drawn at the date", () => {
    expect(readoutAt(model({ bacLine: null }), "2026-01-15")).toBeNull();
  });
});

describe("nearestStop", () => {
  const stops = ["2026-01-01", "2026-02-01", "2026-03-01"];

  it("picks the closest stop by x", () => {
    // x spans 0…60 over 59 days, so 2026-02-01 sits near 31.5.
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 30)).toBe("2026-02-01");
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 1)).toBe("2026-01-01");
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 100)).toBe("2026-03-01");
  });

  it("returns null with no stops", () => {
    expect(nearestStop([], ["2026-01-01", "2026-03-01"], 0, 60, 10)).toBeNull();
  });
});
