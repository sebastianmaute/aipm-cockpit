import { describe, it, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorSchemeEditor } from "./color-scheme-editor";
import { addScheme, loadSchemes } from "./color-schemes";

describe("ColorSchemeEditor", () => {
  beforeEach(() => localStorage.clear());

  it("renders a labeled color picker for each core token", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    expect(screen.getByLabelText("Brand primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent")).toBeInTheDocument();
  });

  it("calls onApply with the resolved color map including a changed token", () => {
    addScheme("Draft", { "--ui-green": "#000000" }, {}); // editable USER scheme active (Apply enabled)
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0] as Record<string, string>;
    expect(arg["--ui-green"]).toBe("#123456");
    expect(arg["--ui-green-strong"]).toBeDefined();
  });

  it("shows a below-AA warning when text/background contrast is poor", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "#eeeeee" } });
    expect(screen.getByText(/below AA/i)).toBeInTheDocument();
  });

  it("saves the working draft as a named scheme", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={() => {}} />);
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Acme Blue" } });
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    expect(loadSchemes().schemes.some((s) => s.name === "Acme Blue")).toBe(true);
  });

  it("hides per-scheme branding fields for a read-only built-in (no duplicate app-name)", () => {
    // Fresh store → the default built-in is active; the global app-name input in
    // AppearanceSection covers built-ins, so the editor must not also show one.
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    expect(screen.queryByLabelText("App name")).not.toBeInTheDocument();
  });

  it("shows per-scheme branding fields for an editable user scheme", () => {
    addScheme("Draft", { "--ui-green": "#000000" }, {}); // user scheme active
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    expect(screen.getByLabelText("App name")).toBeInTheDocument();
  });

  it("marks the active built-in scheme read-only (rename/delete disabled)", () => {
    // Fresh store → the default built-in is the active scheme.
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    expect(screen.getByText(/save as new to customise/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rename$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDisabled();
    // Apply is disabled too, so a live edit can't write the boot key while the
    // store still points at the untouched built-in (coherence: no silent revert).
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
  });
});

// Coherence: the active USER scheme must always == what is applied (rendered).
describe("ColorSchemeEditor coherence", () => {
  beforeEach(() => localStorage.clear());

  it("applies a newly saved scheme", () => {
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Acme" } });
    onApply.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    expect(onApply).toHaveBeenCalled();
    expect(onApply.mock.calls.at(-1)![0]["--ui-green"]).toBe("#123456");
  });

  it("clears the applied colors when the active USER scheme is deleted", () => {
    addScheme("Red", { "--ui-green": "#ff0000" }, {}); // active = Red (user)
    const onClear = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("persists applied edits to the active USER scheme (survives reload)", () => {
    addScheme("Red", { "--ui-green": "#ff0000" }, {});
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    const red = loadSchemes().schemes.find((s) => s.name === "Red");
    expect(red!.light["--ui-green"]).toBe("#00ff00");
  });
});

// Review HIGH: a color-only save of an UNBRANDED scheme must NOT call
// onApplyBranding — otherwise AppearanceSection's mergeAppliedBranding(current, {})
// silently WIPES a globally-set settings.branding.slogan/footerSlogan.
describe("ColorSchemeEditor branding-apply guard", () => {
  beforeEach(() => localStorage.clear());

  it("does not call onApplyBranding when saving a color-only scheme with empty branding", () => {
    const onApplyBranding = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} onApplyBranding={onApplyBranding} />);
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Colors Only" } });
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    expect(onApplyBranding).not.toHaveBeenCalled();
  });

  it("calls onApplyBranding when the scheme carries branding", () => {
    addScheme("Branded", { "--ui-green": "#000000" }, {}); // user scheme active → branding editable
    const onApplyBranding = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} onApplyBranding={onApplyBranding} />);
    fireEvent.change(screen.getByLabelText("App name"), { target: { value: "My Tracker" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApplyBranding).toHaveBeenCalledWith(expect.objectContaining({ slogan: "My Tracker" }));
  });

  // Review MEDIUM: a USER scheme is owned by the user (Apply/rename are only
  // reachable for user schemes), so CLEARING its app-name via Apply must
  // PROPAGATE the empty value — the empty-guard is scoped to saveNew/import,
  // which can originate while a built-in is active.
  it("clearing a user scheme's branding via Apply propagates the clear", () => {
    addScheme("Branded", { "--ui-green": "#000000" }, { slogan: "Acme PMO" }); // branded user scheme active
    const onApplyBranding = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} onApplyBranding={onApplyBranding} />);
    fireEvent.change(screen.getByLabelText("App name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApplyBranding).toHaveBeenCalledWith(expect.objectContaining({ slogan: "" }));
  });
});

describe("ColorSchemeEditor file import", () => {
  beforeEach(() => localStorage.clear());

  test("importing a full portable theme keeps dark and structural", async () => {
    // Headline claim FIRST: the editor's picker used to call addScheme alone,
    // silently degrading a light+dark+structural theme to light-only.
    const user = userEvent.setup();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    const file = new File(
      [JSON.stringify({
        name: "Portable",
        supportsDark: true,
        light: { "--surface": "#ffffff" },
        dark: { "--surface": "#121619" },
        structural: { "--shadow-card": "none" },
        branding: {},
      })],
      "portable.json",
      { type: "application/json" },
    );
    const input = (screen.queryByLabelText(/import/i) ??
      document.querySelector('input[type="file"]')) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      const s = loadSchemes().schemes.find((x) => x.name === "Portable");
      expect(s?.dark?.["--surface"]).toBe("#121619");
      expect(s?.structural?.["--shadow-card"]).toBe("none");
      expect(s?.supportsDark).toBe(true);
    });
  });
});
