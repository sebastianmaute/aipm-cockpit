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
    onImported: vi.fn(),
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

  test("the file input is not a second tab stop next to the load Button", async () => {
    // Headline claim FIRST: the sr-only input exists only to open the file dialog.
    // Left tabbable it is a duplicate tab stop announcing the same name as the
    // Button, which axe cannot see (it reports missing names, never duplicates).
    // `.focus()` would prove nothing here — only a real tab walk does.
    const user = userEvent.setup();
    renderGallery({ schemes: [] });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const load = screen.getByRole("button", { name: "Load theme file…" });

    await user.tab();
    expect(document.activeElement).toBe(load);
    await user.tab();
    expect(document.activeElement).not.toBe(input);
  });

  test("lists user schemes and excludes built-ins", () => {
    renderGallery({
      schemes: [
        { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: {}, branding: {} },
        { id: "u-1", name: "Mine", supportsDark: false, light: {}, branding: {} },
      ],
    });
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Harbor")).not.toBeInTheDocument();
  });

  test("lists themes two-up with no Apply button and no Active label", () => {
    render(
      <ThemeGallery
        lang="en-US"
        schemes={[
          { id: "u-1", name: "Ocean", light: {}, supportsDark: false } as never,
          { id: "u-2", name: "Dust", light: {}, supportsDark: false } as never,
        ]}
        onImported={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByRole("list").className).toMatch(/sm:grid-cols-2/);
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.getByRole("button", { name: /Ocean/ })).toBeTruthy();
  });

  test("row controls carry the scheme NAME so two rows never share an accessible name", () => {
    renderGallery({
      schemes: [
        { id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} },
        { id: "u-2", name: "Beta", supportsDark: false, light: {}, branding: {} },
      ],
    });
    // Headline claim FIRST: axe cannot see duplicate names, only missing ones.
    expect(screen.getByRole("button", { name: "Remove Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Beta" })).toBeInTheDocument();
  });

  test("Remove calls its handler with the row's id", async () => {
    const user = userEvent.setup();
    const props = renderGallery({
      schemes: [{ id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} }],
    });
    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(props.onRemove).toHaveBeenCalledWith("u-1");
  });

  test("an empty library shows the empty message, not a bare list", () => {
    renderGallery({ schemes: [] });
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
