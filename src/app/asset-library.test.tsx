import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibrary } from "./asset-library";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";

const assets = [
  { id: "a1", name: "chart.png", mime: "image/png", size: 2048, width: 800, height: 600, hash: "h1", createdAt: "2026-08-21T10:00:00.000Z" },
  { id: "a2", name: "logo.png", mime: "image/png", size: 1024, width: 100, height: 100, hash: "h2", createdAt: "2026-08-21T10:00:00.000Z" },
];

const base = {
  lang: "en-US" as const,
  assets,
  usage: { a1: 3, a2: 0 },
  danglingIds: new Set<string>(),
  busyId: null,
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onInsert: undefined,
  onUpload: vi.fn(),
};

describe("AssetLibrary", () => {
  // ★★★ THE ONLY DETECTOR THAT WILL EVER EXIST. axe cannot see two controls
  //     sharing an accessible name — in ANY view, at ANY seed size — so this
  //     test, rendering TWO rows, is the entire coverage for WCAG 2.4.6 here.
  it("gives every per-row control a row-unique accessible name", () => {
    render(<AssetLibrary {...base} onInsert={vi.fn()} />);
    for (const verb of [/rename/i, /delete/i, /insert/i]) {
      const names = screen.getAllByRole("button", { name: verb }).map((b) => b.getAttribute("aria-label"));
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((n) => n?.includes("chart.png"))).toBe(true);
      expect(names.some((n) => n?.includes("logo.png"))).toBe(true);
    }
  });

  it("shows how many documents use each asset", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // ★★ Not colour alone: the dangling state carries a non-colour marker, the
  //    same rule ResourcePicker's data-dangling-marker follows.
  it("marks a dangling asset with a non-colour cue", () => {
    render(<AssetLibrary {...base} danglingIds={new Set(["a1"])} />);
    const row = screen.getByText("chart.png").closest("tr");
    expect(row?.querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  it("does not mark a healthy asset", () => {
    render(<AssetLibrary {...base} />);
    const row = screen.getByText("logo.png").closest("tr");
    expect(row?.querySelector("[data-dangling-marker]")).toBeNull();
  });

  it("renders no insert control when no insert handler is supplied", () => {
    render(<AssetLibrary {...base} onInsert={undefined} />);
    expect(screen.queryByRole("button", { name: /insert/i })).toBeNull();
  });

  it("disables that row's controls while it is busy, and only that row", () => {
    render(<AssetLibrary {...base} busyId="a1" />);
    expect(screen.getByRole("button", { name: /delete.*chart\.png/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete.*logo\.png/i })).toBeEnabled();
  });

  // ★ Delete is confirm-gated INSIDE AssetLibrary (see the component's own
  // docstring) — the confirm message needs the usage count, and this
  // component is the one place that already holds both `assets` and `usage`
  // together, so the gate cannot live one layer out without duplicating that
  // text-building logic at both mounting sites (Tasks 16-17). Driving the
  // confirmation is therefore part of exercising this call, mirroring how
  // `activity-log-panel.test.tsx` drives the branded ConfirmProvider for its
  // own confirm-gated Clear button.
  it("calls onDelete with the asset id once the confirm dialog is accepted", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <AssetLibrary {...base} onDelete={onDelete} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: /delete.*chart\.png/i }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("en-US", "confirm") }));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("does not call onDelete when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <AssetLibrary {...base} onDelete={onDelete} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: /delete.*chart\.png/i }));
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("shows a total size disclosure", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.getByText(/3(\.0)? KB|3072/)).toBeInTheDocument();
  });

  it("renders an empty state rather than a headerless table", () => {
    render(<AssetLibrary {...base} assets={[]} usage={{}} />);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
