import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ThemeGallery } from "./theme-gallery";

describe("ThemeGallery", () => {
  beforeEach(() => localStorage.clear());

  test("renders the two shipped themes with import buttons", () => {
    render(<ThemeGallery lang="en-US" onImported={() => {}} />);
    expect(screen.getByRole("button", { name: /AIPM/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dashboard/i })).toBeInTheDocument();
  });

  test("import fetches the theme file, persists structural, calls onImported", async () => {
    const iccRaw = { name: "AIPM", supportsDark: true, light: { "--AIPM-dark-blue": "#004159" }, dark: { "--AIPM-dark-blue": "#004159", "--background": "#0b0f12" }, structural: { "--shadow-card": "none" }, branding: {} };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(iccRaw) })) as unknown as typeof fetch);
    const onImported = vi.fn();
    render(<ThemeGallery lang="en-US" onImported={onImported} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.stringMatching(/^u-\d+$/)));
    // The imported scheme persisted with structural + dark.
    const store = JSON.parse(localStorage.getItem("aipm-cockpit:color-schemes") ?? "{}");
    const u = (store.schemes ?? []).find((s: {id:string}) => s.id.startsWith("u-"));
    expect(u.structural?.["--shadow-card"]).toBe("none");
    expect(u.supportsDark).toBe(true);
    vi.unstubAllGlobals();
  });

  test("re-importing the same theme reuses the existing scheme (no duplicate)", async () => {
    const iccRaw = { name: "AIPM", supportsDark: true, light: { "--AIPM-dark-blue": "#004159" }, structural: {}, branding: {} };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(iccRaw) })) as unknown as typeof fetch);
    const onImported = vi.fn();
    render(<ThemeGallery lang="en-US" onImported={onImported} />);
    const iccBtn = screen.getAllByRole("button")[0];
    fireEvent.click(iccBtn);
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    const firstId = onImported.mock.calls[0][0];
    fireEvent.click(iccBtn);
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(2));
    // Second import activated the SAME scheme, and no second copy was created.
    expect(onImported.mock.calls[1][0]).toBe(firstId);
    const store = JSON.parse(localStorage.getItem("aipm-cockpit:color-schemes") ?? "{}");
    expect((store.schemes ?? []).filter((s: { name: string }) => s.name === "AIPM")).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
