import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SharePointPickerModal } from "./sharepoint-picker-modal";

const acquire = vi.fn(async () => "tok");

function mockFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

describe("SharePointPickerModal", () => {
  it("searches sites and lists results", async () => {
    mockFetch({ value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] });
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());
  });

  it("calls onClose from Escape", () => {
    mockFetch({ value: [] });
    const onClose = vi.fn();
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
