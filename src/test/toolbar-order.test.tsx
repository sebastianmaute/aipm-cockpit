import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { buttonNames, controlNames } from "./toolbar-order";

// §279 / §308 — `controlNames` must report the ACCESSIBLE name, not
// `aria-label || textContent`. Each case below is one place the two differ.
describe("controlNames reports the accessible name", () => {
  it("names an input by its <label for>", () => {
    render(
      <>
        <label htmlFor="a">Alpha</label>
        <input id="a" type="checkbox" />
        <label htmlFor="b">Beta</label>
        <input id="b" type="checkbox" />
      </>,
    );
    expect(controlNames(["checkbox"])).toEqual(["Alpha", "Beta"]);
  });

  it("leaves aria-hidden content out of the name", () => {
    render(
      <>
        <button type="button">
          <span aria-hidden="true">Foo</span>Bar
        </button>
        <button type="button">
          Foo<span aria-hidden="true">Bar</span>
        </button>
      </>,
    );
    expect(buttonNames()).toEqual(["Bar", "Foo"]);
  });

  it("falls back to title for an icon-only button", () => {
    render(
      <>
        <button type="button" title="Expand row" />
        <button type="button" title="Collapse row" />
      </>,
    );
    expect(buttonNames()).toEqual(["Expand row", "Collapse row"]);
  });

  it("ranks aria-labelledby above aria-label", () => {
    render(
      <>
        <span id="lbl">Real name</span>
        <button type="button" aria-labelledby="lbl" aria-label="Ignored">
          x
        </button>
      </>,
    );
    expect(buttonNames()).toEqual(["Real name"]);
  });

  it("still uses the content when aria-label is empty", () => {
    render(
      <button type="button" aria-label="">
        Save
      </button>,
    );
    expect(buttonNames()).toEqual(["Save"]);
  });

  it("collapses and trims whitespace", () => {
    render(<button type="button">{"  Risk   A  "}</button>);
    expect(buttonNames()).toEqual(["Risk A"]);
  });
});
