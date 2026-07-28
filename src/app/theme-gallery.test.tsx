import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";
import { ThemeGallery } from "./theme-gallery";
import { addScheme, loadSchemes } from "./color-schemes";

vi.mock("./color-schemes-store", () => ({
  upsertSchemeAsync: vi.fn(async () => {}),
  deleteSchemeAsync: vi.fn(async () => {}),
}));

const FULL_THEME = JSON.stringify({
  name: "Portable",
  supportsDark: true,
  light: { "--surface": "#ffffff" },
  dark: { "--surface": "#121619" },
  structural: { "--shadow-card": "none" },
  branding: {},
});

function renderGallery(over: Partial<ComponentProps<typeof ThemeGallery>> = {}) {
  const props = {
    lang: "en-US" as const,
    schemes: loadSchemes().schemes,
    activeId: loadSchemes().activeId,
    onImported: vi.fn(),
    onApply: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<ThemeGallery {...props} />);
  return props;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("ThemeGallery", () => {
  test("loading a theme file imports it and reports the new id", async () => {
    const user = userEvent.setup();
    const props = renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([FULL_THEME], "portable.json", { type: "application/json" }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1));
    const created = loadSchemes().schemes.find((s) => s.name === "Portable");
    expect(created?.dark?.["--surface"]).toBe("#121619");
    expect(created?.structural?.["--shadow-card"]).toBe("none");
  });

  test("lists user schemes and excludes built-ins", () => {
    renderGallery({
      schemes: [
        { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: {}, branding: {} },
        { id: "u-1", name: "Mine", supportsDark: false, light: {}, branding: {} },
      ],
      activeId: "harbor",
    });
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Harbor")).not.toBeInTheDocument();
  });

  test("row controls carry the scheme NAME so two rows never share an accessible name", () => {
    renderGallery({
      schemes: [
        { id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} },
        { id: "u-2", name: "Beta", supportsDark: false, light: {}, branding: {} },
      ],
      activeId: null,
    });
    // Headline claim FIRST: axe cannot see duplicate names, only missing ones.
    expect(screen.getByRole("button", { name: "Apply Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Beta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Beta" })).toBeInTheDocument();
  });

  test("Apply and Remove call their handlers with the row's id", async () => {
    const user = userEvent.setup();
    const props = renderGallery({
      schemes: [{ id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} }],
      activeId: null,
    });
    await user.click(screen.getByRole("button", { name: "Apply Alpha" }));
    expect(props.onApply).toHaveBeenCalledWith("u-1");
    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(props.onRemove).toHaveBeenCalledWith("u-1");
  });

  test("the active scheme is marked and cannot be applied again", () => {
    renderGallery({
      schemes: [{ id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} }],
      activeId: "u-1",
    });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Alpha" })).toBeDisabled();
  });

  test("an empty library shows the empty message, not a bare list", () => {
    renderGallery({ schemes: [], activeId: null });
    expect(screen.getByText("No themes in your library yet.")).toBeInTheDocument();
  });

  test("a malformed file surfaces the import error and imports nothing", async () => {
    const user = userEvent.setup();
    const props = renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["{ not json"], "bad.json", { type: "application/json" }));
    await waitFor(() => expect(screen.getByText("Could not import that theme.")).toBeInTheDocument());
    expect(props.onImported).not.toHaveBeenCalled();
  });

  test("a scheme already in the library is not duplicated by a re-import", async () => {
    addScheme("Portable", { "--surface": "#ffffff" }, {});
    const user = userEvent.setup();
    renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([FULL_THEME], "portable.json", { type: "application/json" }));
    await waitFor(() => expect(loadSchemes().schemes.filter((s) => s.name === "Portable")).toHaveLength(1));
  });
});
