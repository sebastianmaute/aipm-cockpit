import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
  learningEnabled: true,
  loadProblem: null,
  pendingWrites: 0,
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
  // ★ This renders an ALREADY normalised snapshot; that the hook normalises on
  // load is pinned in use-action-learning.test.tsx.
  it("renders a normalised singular-plus-plural snapshot as one row", () => {
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

  // §780 — the Adjustment column shows what is APPLIED (`effectiveBias`, the
  // value `buildBiasMap` feeds the engine), not the learned bias alone: a row set
  // to "Always suppress" used to read "+12". Under an override the learned value
  // stays visible, marked as learned. Fixture: 4 acted + 1 dismissed → learned
  // bias round(20 × 3/5) = +12, distinct from ±BIAS_CAP and 0, so every
  // override's cell differs from the learned one.
  describe("Adjustment column (§780)", () => {
    const state = { "raid:actionRaidWhySeverity": { acted: 4, snoozed: 0, dismissed: 1, lastAt: 0 } };
    // The first body row's cell under the Adjustment header, found by header, not position.
    const adjustmentCell = (lang: Lang = "en-US") => {
      const col = screen.getAllByRole("columnheader").findIndex((th) => th.textContent === t(lang, "learningColBias"));
      expect(col).toBeGreaterThanOrEqual(0);
      return within(screen.getAllByRole("row")[1]).getAllByRole("cell")[col];
    };
    const cases = [
      ["auto", "+12", null],
      ["surface", "+20", "learned +12"],
      ["suppress", "-20", "learned +12"],
      ["off", "0", "learned +12"],
    ] as const;
    for (const [override, applied, note] of cases) {
      it(`shows ${applied} for "${override}"${note ? ", with the learned value marked" : ""}`, () => {
        render(<LearningInsights {...baseProps()} state={state} overrides={{ "raid:actionRaidWhySeverity": override }} now={0} />);
        const cell = adjustmentCell();
        expect(cell.firstElementChild?.textContent).toBe(applied);
        if (note) expect(within(cell).getByText(note)).toBeTruthy();
        else expect(cell.textContent).toBe(applied);
      });
    }
    it("marks the learned value in German", () => {
      render(<LearningInsights {...baseProps()} lang="de" state={state} overrides={{ "raid:actionRaidWhySeverity": "suppress" }} now={0} />);
      expect(within(adjustmentCell("de")).getByText("gelernt +12")).toBeTruthy();
    });

    // With learning switched off the hook hands the engine NO bias (`useActionLearning`
    // returns {} unless `config.enabled`), so 0 is applied whatever the override.
    for (const override of ["auto", "surface", "suppress", "off"] as const) {
      it(`shows 0, marked "learning off", when learning is disabled (${override})`, () => {
        render(<LearningInsights {...baseProps()} learningEnabled={false} state={state} overrides={{ "raid:actionRaidWhySeverity": override }} now={0} />);
        const cell = adjustmentCell();
        expect(cell.firstElementChild?.textContent).toBe("0");
        expect(within(cell).getByText("learning off")).toBeTruthy();
      });
    }
    it("marks disabled learning in German", () => {
      render(<LearningInsights {...baseProps()} lang="de" learningEnabled={false} state={state} now={0} />);
      expect(within(adjustmentCell("de")).getByText("Lernen aus")).toBeTruthy();
    });
  });

  // §781 — when the stored learning could not be read, the view says so: the
  // counts shown are this session's only, and nothing is saved until a read works.
  it("shows a notice while the stored learning cannot be read", () => {
    const { rerender } = render(<LearningInsights {...baseProps()} now={0} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<LearningInsights {...baseProps()} loadProblem="unreadable" now={0} />);
    expect(screen.getByRole("status").textContent).toBe(t("en-US", "learningLoadFailedNotice"));
  });
  // §781 — a rejected token and a Turso store without a usable config each say
  // what is wrong and where to fix it.
  it("names a rejected token, a store that is not ready, and a final failure", () => {
    const { rerender } = render(<LearningInsights {...baseProps()} loadProblem="token-rejected" now={0} />);
    expect(screen.getByRole("status").textContent).toBe(t("en-US", "learningTokenRejectedNotice"));
    rerender(<LearningInsights {...baseProps()} loadProblem="store-not-ready" now={0} />);
    expect(screen.getByRole("status").textContent).toBe(t("en-US", "learningStoreNotReadyNotice"));
    rerender(<LearningInsights {...baseProps()} loadProblem="failed" now={0} />);
    expect(screen.getByRole("status").textContent).toBe(t("en-US", "learningLoadFailedFinalNotice"));
    expect(t("en-US", "learningLoadFailedFinalToast")).toContain("not saved yet");
  });

  // §781 — a reload starts with an empty queue, so the final notice and toast must say it
  // discards the held changes and that fixing the settings is what saves them, in both languages.
  it("the final notice and toast say a reload discards the held changes", () => {
    expect(t("en-US", "learningLoadFailedFinalNotice")).toMatch(/[Rr]eloading the app discards your unsaved changes/);
    expect(t("en-US", "learningLoadFailedFinalNotice")).toContain("fixing the Turso settings saves them");
    expect(t("en-US", "learningLoadFailedFinalToast")).toMatch(/[Rr]eloading the app discards it/);
    expect(t("en-US", "learningLoadFailedFinalToast")).toContain("fixing the Turso settings saves it");
    expect(t("de", "learningLoadFailedFinalNotice")).toContain("verwirft Ihre ungespeicherten Änderungen");
    expect(t("de", "learningLoadFailedFinalNotice")).toContain("Turso-Einstellungen");
    expect(t("de", "learningLoadFailedFinalToast")).toContain("Neuladen der App verwirft sie");
  });

  // The count is not a second "not saved yet" after the notice's own sentence.
  it("the final notice and the held count do not repeat 'not saved yet'", () => {
    render(<LearningInsights {...baseProps()} loadProblem="failed" pendingWrites={3} now={0} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text.match(/not saved yet/g)).toHaveLength(1);
    expect(text).toContain("3 changes not saved yet.");
  });

  // §781 — the notice counts the changes waiting to be saved, when there are any.
  it("counts the held changes in the notice", () => {
    const { rerender } = render(<LearningInsights {...baseProps()} loadProblem="unreadable" pendingWrites={3} now={0} />);
    expect(screen.getByRole("status").textContent).toBe(`${t("en-US", "learningLoadFailedNotice")} 3 changes not saved yet.`);
    rerender(<LearningInsights {...baseProps()} loadProblem="unreadable" pendingWrites={1} now={0} />);
    expect(screen.getByRole("status").textContent).toContain("1 change not saved yet.");
    rerender(<LearningInsights {...baseProps()} lang="de" loadProblem="unreadable" pendingWrites={2} now={0} />);
    expect(screen.getByRole("status").textContent).toContain("2 Änderungen noch nicht gespeichert.");
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
