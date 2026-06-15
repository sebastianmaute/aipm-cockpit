import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommTemplatesSection } from "./comm-templates-section";
import type { CommTemplate } from "../comm-templates";

const tpl = (over: Partial<CommTemplate> = {}): CommTemplate => ({
  id: "t1", category: "status-inquiry", name: "Inquiry A", body: "Hello ", isDefault: false, createdAt: "", updatedAt: "", ...over,
});

function setup(templates: CommTemplate[]) {
  const handlers = { onCreate: vi.fn(), onRename: vi.fn(), onSaveBody: vi.fn(), onRemove: vi.fn(), onSetDefault: vi.fn() };
  render(<CommTemplatesSection lang="en-US" templates={templates} {...handlers} />);
  return handlers;
}

describe("CommTemplatesSection", () => {
  it("creates a template in the selected category", () => {
    const h = setup([]);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Weekly ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(h.onCreate).toHaveBeenCalledWith("status-inquiry", "Weekly ping", "");
  });

  it("inserts a merge field token into the body", () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = screen.getByLabelText("Body") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Task name" }));
    expect(body.value).toContain("{{taskName}}");
  });

  it("sets a template as default", () => {
    const h = setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    expect(h.onSetDefault).toHaveBeenCalledWith("status-inquiry", "t1");
  });
});
