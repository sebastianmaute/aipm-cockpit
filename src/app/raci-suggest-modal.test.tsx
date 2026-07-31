import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  RaciSuggestModal,
  SKIP_KEY_ORDER,
  SKIP_KEY_RANK,
  SKIP_REASON_KEY,
} from "./raci-suggest-modal";
import { t } from "./i18n";
import type { GroundedRaciCell, SkippedRaciCell } from "./raci-suggest/raci-suggest";

const cell = (
  stakeholderId: number,
  stakeholderName: string,
  milestoneId: number,
  milestoneName: string,
): GroundedRaciCell => ({
  stakeholderId,
  stakeholderName,
  milestoneId,
  milestoneName,
  role: "R",
  currentRole: null,
});

/** Live lists default to exactly the entities the cells mention, so a test that
 *  says nothing about the workspace behaves as if the proposal were all of it.
 *  Pass `live` explicitly to model entities that exist but were NOT proposed. */
function renderModal(
  cells: readonly GroundedRaciCell[],
  live?: {
    stakeholders?: readonly { id: number; name: string }[];
    milestones?: readonly { id: number; name: string }[];
  },
) {
  const derivedStakeholders = [
    ...new Map(cells.map((c) => [c.stakeholderId, { id: c.stakeholderId, name: c.stakeholderName }])).values(),
  ];
  const derivedMilestones = [
    ...new Map(cells.map((c) => [c.milestoneId, { id: c.milestoneId, name: c.milestoneName }])).values(),
  ];
  render(
    <RaciSuggestModal
      lang="en-US"
      open
      cells={cells}
      skipped={[]}
      truncated={false}
      contextTruncated={false}
      stakeholders={live?.stakeholders ?? derivedStakeholders}
      milestones={live?.milestones ?? derivedMilestones}
      selected={new Set(cells.map((c) => `${c.stakeholderId}:${c.milestoneId}`))}
      onToggle={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      busy={false}
    />,
  );
}

// ★★ BE CLEAR ABOUT WHAT THESE TWO DO AND DO NOT DO. Against the CURRENT
// implementation neither can fail, and calling them a safety net would be the
// same self-deception this file has already been caught in twice. The real
// guarantee is at COMPILE time: SKIP_KEY_ORDER is derived from the keys of the
// exhaustive SKIP_KEY_RANK, so omitting a bucket is TS2741 and a duplicate is
// impossible from Object.keys.
//
// They are kept because they pin the INVARIANT rather than the mechanism. The
// order was a hand-written literal until moments before these were added, and
// "simplify the derivation back to an array" is an obvious future edit — one
// that silently restores the hole, since `readonly SkipMessageKey[]` means "an
// array of these", never "all of these". After such an edit these DO fail.
// That is their whole purpose; they earn their place prospectively, not today.
describe("skip-reason bucket wiring", () => {
  it("orders EVERY bucket a reason can map to", () => {
    // A reason classified into a bucket that is never rendered does not merely
    // vanish: the wrapper would draw its border around nothing, which tells the
    // user less than showing nothing at all would.
    const ranked = new Set(SKIP_KEY_ORDER);
    for (const key of Object.values(SKIP_REASON_KEY)) {
      expect(ranked.has(key)).toBe(true);
    }
  });

  it("ranks each bucket exactly once", () => {
    // A duplicate paired with an omission still satisfies a length check, which
    // is why membership is asserted above rather than a count.
    expect(new Set(SKIP_KEY_ORDER).size).toBe(SKIP_KEY_ORDER.length);
  });

  it("gives each bucket a DISTINCT rank", () => {
    // Array.prototype.sort is stable, so two buckets sharing a rank fall back
    // to Object.keys order — i.e. declaration order — quietly reinstating the
    // very dependency the sort exists to remove. Output stays deterministic
    // across runs, so this never reproduces the model-order bug; what it costs
    // is that the numbers stop being the source of truth they are written as.
    const ranks = Object.values(SKIP_KEY_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("produces the intended SEQUENCE, not merely a stable one", () => {
    // The order test proves two arrival orders agree; it does not pin which
    // sequence they agree on, so reversing the ranks passes it. The sequence is
    // deliberate — the general "did not match this project" first, then the two
    // specific refusals — so it is pinned here.
    //
    // ★ Deleting the `.sort` outright is NOT caught, and cannot be: Object.keys
    // returns declaration order, which today equals rank order, so both spell
    // the same sequence. That is not a hole in this test but the sort's whole
    // point — it exists so the rendered order stops depending on where the
    // three lines happen to sit. Its absence is harmless until someone
    // alphabetises or inserts a key, and THAT edit this test does catch.
    expect([...SKIP_KEY_ORDER]).toEqual([
      "raciSuggestSkipped",
      "raciSuggestSkippedInvalidRole",
      "raciSuggestSkippedAccountable",
    ]);
  });
});

describe("RaciSuggestModal skipped-cell reporting", () => {
  function renderSkipped(skipped: readonly SkippedRaciCell[]) {
    render(
      <RaciSuggestModal
        lang="en-US"
        open
        cells={[]}
        skipped={skipped}
        truncated={false}
        contextTruncated={false}
        stakeholders={[]}
        milestones={[]}
        selected={new Set()}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
      />,
    );
  }

  const skip = (reason: SkippedRaciCell["reason"]): SkippedRaciCell => ({
    stakeholderId: 1,
    milestoneId: 10,
    reason,
  });

  it("explains a refused Accountable as an ownership conflict, NOT as a no-match", () => {
    // "duplicate-accountable" is the one reason that is the OPPOSITE of a
    // no-match: the cell named a real stakeholder and a real milestone, and was
    // refused because that milestone already has an Accountable. Reporting it
    // under the generic string tells the user the cell "did not match this
    // project", which is false and hides the only skip they can act on.
    renderSkipped([skip("duplicate-accountable")]);
    expect(screen.getByText(t("en-US", "raciSuggestSkippedAccountable", 1))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "raciSuggestSkipped", 1))).not.toBeInTheDocument();
  });

  it("reports a capped CONTEXT separately from a capped response", () => {
    // Distinct causes, distinct sentences: `truncated` means the reply was cut,
    // `contextTruncated` means the model never saw some rows. Conflating them
    // would tell the user assignments were dropped when in fact people were.
    render(
      <RaciSuggestModal
        lang="en-US"
        open
        cells={[]}
        skipped={[]}
        truncated={false}
        contextTruncated
        stakeholders={[]}
        milestones={[]}
        selected={new Set()}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByText(t("en-US", "raciSuggestContextTruncated"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "raciSuggestTruncated"))).not.toBeInTheDocument();
  });

  it("gives invalid-role its OWN sentence, not the no-match one", () => {
    // invalid-role is not a no-match: both the stakeholder and the milestone
    // resolved, and only the role letter was rejected. Telling that user the
    // cell "did not match this project" is the same wrong answer the bucketing
    // exists to remove. Without this test, mapping invalid-role back into the
    // catch-all is a one-character revert that leaves the suite green.
    renderSkipped([skip("invalid-role")]);
    expect(screen.getByText(t("en-US", "raciSuggestSkippedInvalidRole", 1))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "raciSuggestSkipped", 1))).not.toBeInTheDocument();
  });

  it("lists the buckets in a FIXED order regardless of the order skips arrive", () => {
    // The counts live in a Map, which iterates in insertion order — i.e. the
    // order the model happened to return its skips. Two runs of the same
    // feature on the same project would otherwise list the same explanations
    // in different orders.
    const read = () =>
      Array.from(document.querySelectorAll("p"))
        .map((p) => p.textContent ?? "")
        .filter((s) =>
          [
            t("en-US", "raciSuggestSkipped", 1),
            t("en-US", "raciSuggestSkippedInvalidRole", 1),
            t("en-US", "raciSuggestSkippedAccountable", 1),
          ].includes(s),
        );

    renderSkipped([skip("invalid-role"), skip("unknown-stakeholder"), skip("duplicate-accountable")]);
    const first = read();
    cleanup();
    renderSkipped([skip("duplicate-accountable"), skip("unknown-stakeholder"), skip("invalid-role")]);
    expect(read()).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("says nothing can be applied when there are no cells to apply", () => {
    // The zero-cell branch. "Claude proposed no assignments" is false here —
    // it proposed them and they were refused — and this branch had no test at
    // all, so that wording could return silently.
    renderSkipped([skip("unknown-stakeholder")]);
    expect(screen.getByText(t("en-US", "raciSuggestAllSkipped"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "raciSuggestNoProposal"))).not.toBeInTheDocument();
  });

  it("counts the two buckets separately when both occur", () => {
    // A single total cannot be right for both: it would over-count whichever
    // sentence it is attached to.
    renderSkipped([
      skip("unknown-stakeholder"),
      skip("unknown-milestone"),
      skip("duplicate-accountable"),
    ]);
    expect(screen.getByText(t("en-US", "raciSuggestSkipped", 2))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "raciSuggestSkippedAccountable", 1))).toBeInTheDocument();
  });
});

describe("RaciSuggestModal per-row accessible names", () => {
  it("keeps the name unqualified when it is already unambiguous", () => {
    renderModal([cell(1, "Ada", 10, "Design freeze")]);
    expect(
      screen.getByRole("checkbox", {
        name: `${t("en-US", "raciSuggestInclude")} – Ada – Design freeze`,
      }),
    ).toBeInTheDocument();
  });

  it("distinguishes two DIFFERENT stakeholders who share a name", () => {
    // Cells are deduped by (stakeholderId, milestoneId), never by name, so two
    // real people called "Ada" on the same milestone both get a row. Without
    // qualification both checkboxes announce identically — a WCAG 2.4.6 failure
    // the axe gate cannot detect (it reports missing names, never duplicate
    // ones). getByRole throws on multiple matches, so an unqualified label
    // fails this test rather than passing quietly.
    renderModal([cell(1, "Ada", 10, "Design freeze"), cell(2, "Ada", 10, "Design freeze")]);
    const include = t("en-US", "raciSuggestInclude");
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada (#1) – Design freeze` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada (#2) – Design freeze` }),
    ).toBeInTheDocument();
    // The VISIBLE text must carry the same qualifier. Disambiguating only the
    // accessible name leaves two rows that read identically on screen, in a
    // dialog whose whole purpose is choosing which of them to commit — the
    // sighted user has strictly less information than the screen-reader user.
    expect(screen.getByText(/Ada \(#1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ada \(#2\)/)).toBeInTheDocument();
  });

  it("qualifies a LONE proposed row when a same-named stakeholder exists but was not proposed", () => {
    // The case that motivated measuring ambiguity against the workspace rather
    // than the proposal. Only one "Ada" is being assigned, so a proposal-scoped
    // check sees no collision and renders a bare "Ada" — but two Adas exist,
    // and the user cannot tell which one this write lands on. Nothing else in
    // this suite covers it: every other case keeps both colliding cells in
    // `cells`, where the narrower check happens to give the same answer.
    renderModal([cell(1, "Ada", 10, "Design freeze")], {
      stakeholders: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Ada" },
      ],
    });
    expect(
      screen.getByRole("checkbox", {
        name: `${t("en-US", "raciSuggestInclude")} – Ada (#1) – Design freeze`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ada \(#1\)/)).toBeInTheDocument();
  });

  it("distinguishes two DIFFERENT milestones that share a name", () => {
    // The mirror of the case above. Nothing constrains Milestone.name to be
    // unique, and cells dedupe on (stakeholderId, milestoneId), so one person
    // on two same-named milestones yields two rows. Qualifying only the
    // stakeholder side would leave these identical.
    renderModal([cell(1, "Ada", 10, "Review"), cell(1, "Ada", 11, "Review")]);
    const include = t("en-US", "raciSuggestInclude");
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Review (#10)` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Review (#11)` }),
    ).toBeInTheDocument();
  });

  it("leaves the SAME stakeholder's rows unqualified across milestones", () => {
    // One person on two milestones is not a collision — the milestone already
    // separates the names, so qualifying here would be noise.
    renderModal([cell(1, "Ada", 10, "Design freeze"), cell(1, "Ada", 11, "Go live")]);
    const include = t("en-US", "raciSuggestInclude");
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Design freeze` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `${include} – Ada – Go live` }),
    ).toBeInTheDocument();
  });
});
