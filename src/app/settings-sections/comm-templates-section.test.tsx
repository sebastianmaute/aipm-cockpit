import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommTemplatesSection } from "./comm-templates-section";
import type { CommTemplate } from "../comm-templates";
import { defaultSettings } from "../settings-types";

const saveVersion = vi.fn(async () => {});
vi.mock("../use-comm-template-versions", () => ({
  useCommTemplateVersions: () => ({
    versions: [{ id: "x-v-1", templateId: "t1", name: "v1", body: "<p>old</p>", isAuto: false, createdAt: "2026-06-15T00:00:00Z" }],
    busy: false,
    saveVersion,
    removeVersion: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../rich-text-editor", () => ({
  RichTextEditor: (p: {
    value: string;
    onChange: (html: string) => void;
    label: string;
    mergeFields: readonly string[];
    fieldLabel: (f: string) => string;
  }) => (
    <div>
      <textarea aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      {p.mergeFields.map((f) => (
        <button key={f} type="button" onClick={() => p.onChange(p.value + `{{${f}}}`)}>
          {p.fieldLabel(f)}
        </button>
      ))}
    </div>
  ),
}));

const tpl = (over: Partial<CommTemplate> = {}): CommTemplate => ({
  id: "t1", category: "status-inquiry", name: "Inquiry A", body: "Hello ", isDefault: false, createdAt: "", updatedAt: "", ...over,
});

function setup(templates: CommTemplate[], onChange = vi.fn()) {
  const handlers = { onCreate: vi.fn(), onRename: vi.fn(), onSaveBody: vi.fn(), onRemove: vi.fn(), onSetDefault: vi.fn() };
  render(<CommTemplatesSection lang="en-US" templates={templates} config={null} settings={defaultSettings} onChange={onChange} {...handlers} />);
  return { ...handlers, onChange };
}

describe("CommTemplatesSection", () => {
  it("creates a template in the selected category", () => {
    const h = setup([]);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Weekly ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(h.onCreate).toHaveBeenCalledWith("status-inquiry", "Weekly ping", "");
  });

  it("inserts a merge field token into the body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Task name" }));
    expect(body.value).toContain("{{taskName}}");
  });

  it("sets a template as default", () => {
    const h = setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    expect(h.onSetDefault).toHaveBeenCalledWith("status-inquiry", "t1");
  });

  it("saves a named version of the current body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    vi.spyOn(window, "prompt").mockReturnValue("My version");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(saveVersion).toHaveBeenCalledWith("My version", expect.any(String), false);
  });

  it("cancels editing: reverts the body draft and does not save", async () => {
    const h = setup([tpl({ body: "Hello " })]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Hello CHANGED" } });
    expect(body.value).toBe("Hello CHANGED");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    const reverted = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    expect(reverted.value).toBe("Hello ");
    expect(h.onSaveBody).not.toHaveBeenCalled();
  });

  it("compares Current against a version and shows the diff", async () => {
    setup([tpl({ body: "<p>new</p>" })]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare: Current" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare: v1" }));
    expect(await screen.findByLabelText(/removed: old/)).toBeTruthy();
    expect(screen.getByLabelText(/added: new/)).toBeTruthy();
  });

  it("changes the send mode via the radio group", () => {
    const { onChange } = setup([], vi.fn());
    fireEvent.click(screen.getByRole("radio", { name: "Outlook draft (HTML)" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ commTemplateSendMode: "outlook-draft" }));
  });
});
