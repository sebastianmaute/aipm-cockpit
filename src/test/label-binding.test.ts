import { describe, it, expect, afterEach } from "vitest";
import {
  labelsBoundToButtons,
  labelsWithDanglingFor,
  labelsContainingLabels,
  expectNoLabelBoundToButton,
} from "./label-binding";

// The helper reads `document`, so each case builds a tiny real DOM rather than
// rendering a component — these pin the HELPER, not any app surface.
function mount(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("labelsBoundToButtons", () => {
  it("reports a label that adopted a button, naming both sides", () => {
    mount(`<label><span>Linked tasks</span><button aria-label="Unlink #7">x</button></label>`);
    // The caption side is the label's WHOLE textContent, so it swallows the
    // button's own glyph ("x") — matching what the real failures print.
    expect(labelsBoundToButtons()).toEqual(['"Linked tasksx" -> button "Unlink #7"']);
  });

  it("stays silent when a real input outranks a trailing button", () => {
    mount(`<label><span>Title</span><input id="t"><button aria-label="Mic">m</button></label>`);
    expect(labelsBoundToButtons()).toEqual([]);
  });
});

describe("labelsWithDanglingFor", () => {
  // ★★★ THE GAP THIS CLOSES. Fix strategy (b) is `<label htmlFor="x">` + a
  // matching `id="x"`, written by hand in two places — this change alone
  // introduced seven such id strings. Neither gate could see a TYPO in one of
  // them: the source scan asks only whether the string `htmlFor=` is present,
  // and `labelsBoundToButtons` filters on `control?.tagName === "BUTTON"`, so a
  // dangling `htmlFor` (control === null) fell through BOTH. The failure it let
  // through is the exact one the whole change exists to prevent — a required
  // field with no accessible name, in a real browser, with every gate green.
  // ★ Keyed on the ATTRIBUTE being present, never on `control === null` alone:
  // a wrapping label around a non-labelable widget also has a null control, and
  // that shape is legitimate. An `htmlFor` that resolves to nothing never is.
  it("reports an htmlFor that resolves to no element", () => {
    mount(`<label for="typo-id">Title</label><input id="raid-title">`);
    expect(labelsWithDanglingFor()).toEqual(['"Title" -> htmlFor="typo-id" matches nothing']);
  });

  it("stays silent when the htmlFor resolves", () => {
    mount(`<label for="raid-title">Title</label><input id="raid-title">`);
    expect(labelsWithDanglingFor()).toEqual([]);
  });

  it("ignores a wrapping label that has no htmlFor at all", () => {
    // Null control, but nothing claims otherwise — this is the legitimate shape.
    mount(`<label><span>Notes</span><div contenteditable="true"></div></label>`);
    expect(labelsWithDanglingFor()).toEqual([]);
  });
});

describe("expectNoLabelBoundToButton", () => {
  it("throws on an adopted button", () => {
    mount(`<label><span>Priority</span><button>Low</button></label>`);
    expect(() => expectNoLabelBoundToButton()).toThrow(/bound to a <button>/);
  });

  it("throws on a dangling htmlFor", () => {
    mount(`<label for="nope">Title</label><input id="real">`);
    expect(() => expectNoLabelBoundToButton()).toThrow(/matches nothing/);
  });

  it("throws rather than passing vacuously when no label is rendered", () => {
    mount(`<div>no labels here</div>`);
    expect(() => expectNoLabelBoundToButton()).toThrow(/vacuous/);
  });

  it("passes a correctly wired tree", () => {
    mount(`<label for="a">Title</label><input id="a">`);
    expect(() => expectNoLabelBoundToButton()).not.toThrow();
  });

  it("throws on a caption wrapping a checkbox grid", () => {
    // The shape neither other check can see: no button, no htmlFor to dangle.
    mount(
      `<label><span>Regulatory</span><div>
         <label><input type="checkbox">GDPR</label>
         <label><input type="checkbox">SOX</label>
       </div></label>`,
    );
    expect(() => expectNoLabelBoundToButton()).toThrow(/nested <label>/);
  });
});

describe("labelsContainingLabels", () => {
  it("reports the outer label and names the control it adopts", () => {
    mount(
      `<label><span>Regulatory</span><div>
         <label><input type="checkbox">GDPR</label>
       </div></label>`,
    );
    const [hit, ...rest] = labelsContainingLabels();
    expect(rest).toEqual([]);
    // The message must name the ADOPTED control, since "which box gets ticked"
    // is the whole question a reader has when this fires.
    expect(hit).toMatch(/adopts <input type=checkbox>/);
    expect(hit).toMatch(/Regulatory/);
  });

  it("does not report sibling labels, only nested ones", () => {
    mount(`<label for="a">One</label><input id="a"><label for="b">Two</label><input id="b">`);
    expect(labelsContainingLabels()).toEqual([]);
  });

  it("does not report a label whose only descendant control is its own input", () => {
    mount(`<label><input type="checkbox">GDPR</label>`);
    expect(labelsContainingLabels()).toEqual([]);
  });
});
