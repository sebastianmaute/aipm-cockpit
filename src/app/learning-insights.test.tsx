import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearningInsights } from "./learning-insights";
import { learningKindLabel } from "./learning-kind-label";
import { en, loadI18n, t, type Lang } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";
import { buttonNames, expectButtonOrder } from "../test/toolbar-order";
import { INNER_TABLE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { normalizeLearningSnapshot } from "./action-learning";
import { canonicalLearningKind } from "./next-actions/learning-kind";

beforeAll(async () => {
  await loadI18n("de");
});

const baseProps = () => ({
  lang: "en-US" as const,
  state: { "raid:actionRaidWhySeverity": { acted: 5, snoozed: 1, dismissed: 0, lastAt: 0 } },
  overrides: {} as Record<string, "auto" | "surface" | "suppress" | "off">,
  onSetOverride: vi.fn(),
  onReset: vi.fn(),
  onBack: vi.fn(),
});

const stats = (acted: number) => ({ acted, snoozed: 0, dismissed: 0, lastAt: 0 });
const PRINT = t("en-US", "printHint");
const RESET_SIZE = t("en-US", "tableResetSizeHint");

describe("LearningInsights", () => {
  it("renders a row per kind with counts", () => {
    render(<LearningInsights {...baseProps()} now={0} />);
    expect(screen.getByText("5")).toBeTruthy(); // acted count
  });
  it("changing the override select calls onSetOverride", () => {
    const p = baseProps();
    render(<LearningInsights {...p} now={0} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "suppress" } });
    expect(p.onSetOverride).toHaveBeenCalledWith("raid:actionRaidWhySeverity", "suppress");
  });
  // §102: Reset learned data is the shared secondary Button. The hand-rolled one
  // had no focus ring at all. §777: toolbar size, like its row neighbours.
  it("renders Reset learned data as the secondary Button", () => {
    render(<LearningInsights {...baseProps()} now={0} />);
    expect(screen.getByRole("button", { name: "Reset learned data" }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
  it("shows the empty state with no data", () => {
    render(<LearningInsights {...baseProps()} state={{}} now={0} />);
    expect(screen.getByText(/No learning data yet/i)).toBeTruthy();
  });

  // §247/§248: `kind` (the React key here) cannot repeat in one render, so no
  // token map — but qualifying with the SOURCE label alone does not hold:
  // several sources legitimately emit more than one `why.key` in one render.
  // Seed exactly that — two REAL kinds sharing one source
  // ("milestone:actionMilestoneWhyOverdue" / "milestone:actionMilestoneWhyAtRisk",
  // both from next-actions/providers/milestone.ts) — the smallest fixture that
  // can tell a name carrying the reason from one carrying the source alone.
  // `requireCollisionSeed` does not fit this file (nothing here is SUPPOSED to
  // collide once fixed), so this asserts distinctness directly, over a fixture
  // engineered to be adversarial rather than merely distinct. If you change it,
  // keep two why-keys under one shared source or this stops proving anything.
  it("keeps the override select distinct for two kinds sharing one source", () => {
    const state = {
      "milestone:actionMilestoneWhyOverdue": stats(1),
      "milestone:actionMilestoneWhyAtRisk": stats(0),
    };
    render(<LearningInsights {...baseProps()} state={state} now={0} />);
    // Measured: 2 override comboboxes + Back + Reset learned data + Print + reset-size = 6.
    expectRowUniqueNames({
      minControls: 6,
      roles: ["combobox", "button"],
    });
  });

  // §777 — the owner's case: two "Attention" rows that differed ONLY by the raw
  // kind id. Each now carries a translated reason, and the override select's
  // accessible name stays row-unique without the raw id.
  it("labels two Attention rows by their translated reasons, not the raw kind id", () => {
    const state = {
      "task-attention:actionTaskWhyUnassigned": stats(1),
      "task-attention:actionTaskWhyStale": stats(2),
    };
    const { container } = render(<LearningInsights {...baseProps()} state={state} now={0} />);
    expect(screen.getByText("No owner assigned")).toBeTruthy();
    expect(screen.getByText("No recent update")).toBeTruthy();
    expect(container.textContent).not.toContain("task-attention:");
    expect(container.textContent).not.toContain("actionTaskWhy");
    const names = screen.getAllByRole("combobox").map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual([
      "Override – Attention: No owner assigned",
      "Override – Attention: No recent update",
    ]);
    expectRowUniqueNames({ minControls: 6, roles: ["combobox", "button"] });
  });

  it("shows the reason in German after loadI18n('de')", () => {
    const state = {
      "task-attention:actionTaskWhyUnassigned": stats(1),
      "task-attention:actionTaskWhyStale": stats(2),
    };
    const { container } = render(<LearningInsights {...baseProps()} lang="de" state={state} now={0} />);
    expect(screen.getByText("Länger nicht aktualisiert")).toBeTruthy();
    expect(container.textContent).not.toContain("actionTaskWhy");
  });

  // A kind this build does not know (a retired why key, or data written by a
  // newer build) has no label to show — the raw why key is then the only thing
  // that tells two such rows apart, so it stays as the fallback.
  it("falls back to the raw why key for a kind it cannot translate", () => {
    render(<LearningInsights {...baseProps()} state={{ "raid:someRetiredWhy": stats(1) }} now={0} />);
    expect(screen.getByText("someRetiredWhy")).toBeTruthy();
  });

  // §778 — one reason, one row: a stored singular-count row ("…One") merges into
  // its plural sibling when the snapshot is read (useActionLearning's load), so
  // the view the hook feeds shows one row and one override for both.
  it("shows one row for a reason stored under its singular and plural kinds", () => {
    const snap = normalizeLearningSnapshot({
      state: {
        "task-due:actionTaskWhySoonOne": stats(2),
        "task-due:actionTaskWhySoon": stats(1),
      },
      overrides: {},
    });
    const { container } = render(<LearningInsights {...baseProps()} state={snap.state} now={0} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByText("Due soon")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // 2 + 1 acted
  });

  // §777 — the view is a standard pane: the resizable card, an inner scroll
  // region for the table (so the page itself never scrolls), the shared heading
  // colours, and ONE toolbar row: Back leads, the bulk reset precedes the
  // trailing Print · reset-size group.
  describe("pane chrome (§777)", () => {
    it("renders inside the resizable pane card", () => {
      const { container } = render(<LearningInsights {...baseProps()} now={0} />);
      expect((container.firstElementChild as HTMLElement).className).toContain(VIEW_PANE_RESIZABLE_CLASS);
    });
    it("scrolls the table inside the pane", () => {
      render(<LearningInsights {...baseProps()} now={0} />);
      expect(screen.getByRole("table").parentElement?.className).toBe(INNER_TABLE_CLASS);
    });
    it("gives the heading the pane heading colours", () => {
      render(<LearningInsights {...baseProps()} now={0} />);
      const h2 = screen.getByRole("heading", { level: 2, name: "Action Center learning" });
      expect(h2.className).toContain("text-ui-dark-blue");
      expect(h2.className).toContain("dark:text-ui-light-grey");
    });
    it("puts the title and every button in one header row", () => {
      render(<LearningInsights {...baseProps()} now={0} />);
      const header = screen.getByRole("heading", { level: 2 }).closest("header") as HTMLElement;
      expect(header).toBeTruthy();
      expect(buttonNames(header)).toEqual(buttonNames());
    });
    it("orders the toolbar Back · Reset learned data · Print · reset-size", () => {
      render(<LearningInsights {...baseProps()} now={0} />);
      expect(buttonNames()[0]).toBe("Back");
      expectButtonOrder(["wizardBack", "settingsLearningReset", "printHint", "tableResetSizeHint"]);
      expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });
      expect(buttonNames().slice(-2)).toEqual([PRINT, RESET_SIZE]);
    });
    it("renders Back as the secondary Button and calls onBack", () => {
      const p = baseProps();
      render(<LearningInsights {...p} now={0} />);
      const back = screen.getByRole("button", { name: "Back" });
      expect(back.className).toBe(buttonClassFor({ variant: "secondary", size: "xs", className: "print:hidden" }));
      fireEvent.click(back);
      expect(p.onBack).toHaveBeenCalledTimes(1);
    });
    it("keeps Back and the trailing group in the empty state", () => {
      render(<LearningInsights {...baseProps()} state={{}} now={0} />);
      expect(buttonNames()).toEqual(["Back", PRINT, RESET_SIZE]);
    });
  });
});

// §777 — every why key the Action Center can emit gets a translated, param-free
// reason label, and the labels never collide, in both dictionaries. The key set
// is DERIVED from the EN dictionary (`action…Why…`), so a new why key is covered
// without being named here.
describe("learningKindLabel", () => {
  const whyKeys = Object.keys(en).filter((k) => /^action[A-Za-z]*Why[A-Za-z0-9]*$/.test(k));

  it("finds the why keys it is meant to cover", () => {
    // A floor, not an exact count, so adding a key does not break this; losing
    // the pattern (zero matches) does. Reproduce:
    //   grep -cE "^\s*action[A-Za-z]*Why[A-Za-z0-9]*:" src/app/i18n.ts
    expect(whyKeys.length).toBeGreaterThanOrEqual(40);
    expect(whyKeys).toContain("actionTaskWhyStale");
  });

  for (const lang of ["en-US", "de"] as Lang[]) {
    it(`gives every why key a reason with no placeholder and no raw key (${lang})`, () => {
      const bad = whyKeys.filter((k) => {
        const { reason } = learningKindLabel(lang, `raid:${k}`);
        return !reason || /\{\d+\}/.test(reason) || reason === k;
      });
      expect(bad).toEqual([]);
    });
    // §778: over CANONICAL keys — a singular-count key ("…One") is the same
    // learning kind as its plural sibling, so it shares that reason by design.
    it(`gives every canonical why key a distinct reason (${lang})`, () => {
      const seen = new Map<string, string[]>();
      for (const k of whyKeys.filter((w) => canonicalLearningKind(`raid:${w}`) === `raid:${w}`)) {
        const { reason } = learningKindLabel(lang, `raid:${k}`);
        seen.set(reason, [...(seen.get(reason) ?? []), k]);
      }
      const dupes = [...seen.entries()].filter(([, ks]) => ks.length > 1);
      expect(dupes).toEqual([]);
    });
  }

  it("translates the source and keeps an unknown source as written", () => {
    expect(learningKindLabel("en-US", "task-attention:actionTaskWhyBlocked")).toEqual({
      source: "Attention",
      reason: "Blocked",
    });
    expect(learningKindLabel("en-US", "mystery:x").source).toBe("mystery");
  });

  it("labels a singular-count kind as its plural sibling (§778)", () => {
    expect(learningKindLabel("en-US", "committee:actionCommitteeInfoWhyOne")).toEqual(
      learningKindLabel("en-US", "committee:actionCommitteeInfoWhy"),
    );
  });

  it("does not treat an Object.prototype name as a why key", () => {
    expect(learningKindLabel("en-US", "raid:constructor").reason).toBe("constructor");
  });

  it("does not treat an Object.prototype name as a source", () => {
    expect(learningKindLabel("en-US", "constructor:x").source).toBe("constructor");
  });

  // A kind with no why key (no ":", or nothing after it) has no reason to name;
  // the raw kind keeps two such rows apart instead of an empty line.
  it("falls back to the raw kind when the why key is empty", () => {
    expect(learningKindLabel("en-US", "legacykind").reason).toBe("legacykind");
    expect(learningKindLabel("en-US", "raid:").reason).toBe("raid:");
  });
});
