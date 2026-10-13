import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TursoSetupSteps } from "./turso-setup-steps";
import { t } from "../i18n";
import { INSTALL_GUIDE_URL } from "../version";

const NONE = { urlDone: false, tokenDone: false, testDone: false };

function renderSteps(state = NONE) {
  return render(
    <TursoSetupSteps
      lang="en-US"
      state={state}
      urlStep={<input aria-label="url-field" />}
      tokenStep={<input aria-label="token-field" />}
      testStep={<button type="button">test-button</button>}
    />,
  );
}

describe("TursoSetupSteps", () => {
  it("renders an ordered list of four steps with the nodes in their steps", () => {
    renderSteps();
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[1]).getByLabelText("url-field")).toBeInTheDocument();
    expect(within(items[2]).getByLabelText("token-field")).toBeInTheDocument();
    expect(within(items[3]).getByRole("button", { name: "test-button" })).toBeInTheDocument();
  });

  it("links step 1 to turso.tech and explains where to pick the location", () => {
    renderSteps();
    const link = screen.getByRole("link", { name: t("en-US", "tursoStepCreate") });
    expect(link).toHaveAttribute("href", "https://turso.tech/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(t("en-US", "tursoStepCreateHint"))).toBeInTheDocument();
  });

  it("tells the user to create the token without an expiry", () => {
    renderSteps();
    expect(screen.getByText(/without an expiry/i)).toBeInTheDocument();
  });

  it("marks each of the three steps done independently", () => {
    const { rerender } = renderSteps();
    const items = () => within(screen.getByRole("list")).getAllByRole("listitem");
    const done = t("en-US", "tursoStepDone");
    expect(screen.queryByText(done)).toBeNull();
    const props = {
      lang: "en-US" as const,
      urlStep: <input aria-label="url-field" />,
      tokenStep: <input aria-label="token-field" />,
      testStep: <button type="button">test-button</button>,
    };
    rerender(<TursoSetupSteps {...props} state={{ ...NONE, urlDone: true }} />);
    expect(within(items()[1]).getByText(done)).toBeInTheDocument();
    expect(within(items()[2]).queryByText(done)).toBeNull();
    expect(within(items()[3]).queryByText(done)).toBeNull();
    rerender(<TursoSetupSteps {...props} state={{ ...NONE, tokenDone: true }} />);
    expect(within(items()[1]).queryByText(done)).toBeNull();
    expect(within(items()[2]).getByText(done)).toBeInTheDocument();
    rerender(<TursoSetupSteps {...props} state={{ ...NONE, testDone: true }} />);
    expect(within(items()[3]).getByText(done)).toBeInTheDocument();
    expect(within(items()[2]).queryByText(done)).toBeNull();
  });

  it("hides the check glyph from assistive tech and keeps the 'done' text", () => {
    renderSteps({ ...NONE, urlDone: true });
    const done = screen.getByText(t("en-US", "tursoStepDone"));
    expect(done).toHaveClass("sr-only");
    const glyph = done.parentElement?.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toBe("✓");
  });

  it("links the step-by-step guide to the install guide", () => {
    renderSteps();
    const link = screen.getByRole("link", { name: t("en-US", "tursoStepGuide") });
    expect(link).toHaveAttribute("href", INSTALL_GUIDE_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });
});
