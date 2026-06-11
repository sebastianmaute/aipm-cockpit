import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import type { Resource } from "./types";
import type { Contact } from "./contacts";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} });

const resources: Resource[] = [res(1, "Sample", "Dummy", "Sample@x.com"), res(2, "Bob", "Lee", "bob@x.com")];
const contacts: Contact[] = [{ name: "Old Contact", email: "old@x.com" }];

function setup(value: ResourcePickerValue, over: Partial<Parameters<typeof ResourcePicker>[0]> = {}) {
  const onChange = vi.fn();
  const onCreateResource = vi.fn(() => 99);
  render(
    <ResourcePicker
      lang="en-US"
      value={value}
      resources={resources}
      contacts={contacts}
      onChange={onChange}
      onCreateResource={onCreateResource}
      {...over}
    />,
  );
  return { onChange, onCreateResource };
}

describe("ResourcePicker", () => {
  it("lists resource matches before contact matches", () => {
    setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    const sarahIdx = options.findIndex((t) => t.includes("Alex Example"));
    const contactIdx = options.findIndex((t) => t.includes("Old Contact"));
    expect(sarahIdx).toBeGreaterThanOrEqual(0);
    expect(contactIdx).toBeGreaterThan(sarahIdx);
  });

  it("picking a resource emits the FK and the resource name/email", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Alex Example"));
    expect(onChange).toHaveBeenCalledWith({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
  });

  it("picking a contact emits resourceId null", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Old Contact"));
    expect(onChange).toHaveBeenCalledWith({ name: "Old Contact", email: "old@x.com", resourceId: null });
  });

  it("typing a name emits free text with resourceId null", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Brand New" } });
    expect(onChange).toHaveBeenLastCalledWith({ name: "Brand New", email: "", resourceId: null });
  });

  it("offers + Add as resource for an unmatched name and creates+links it", () => {
    const { onChange, onCreateResource } = setup({ name: "Brand New", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText(/Add .*Brand New.* as resource/i));
    expect(onCreateResource).toHaveBeenCalledWith("Brand New", "");
    expect(onChange).toHaveBeenCalledWith({ name: "Brand New", email: "", resourceId: 99 });
  });

  it("does not offer + Add when the typed name exactly matches a resource", () => {
    setup({ name: "Alex Example", email: "Sample@x.com", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
  });

  it("display authority: a linked value shows the resource's CURRENT name, not the stale stored string", () => {
    setup({ name: "stale string", email: "stale@x.com", resourceId: 1 });
    expect(screen.getByRole("combobox")).toHaveValue("Alex Example");
  });

  it("dangling FK falls back to the stored name and renders an unlink control without crashing", () => {
    const { onChange } = setup({ name: "Ghost", email: "g@x.com", resourceId: 404 });
    expect(screen.getByRole("combobox")).toHaveValue("Ghost");
    fireEvent.click(screen.getByRole("button", { name: /unlink from resource/i }));
    expect(onChange).toHaveBeenCalledWith({ name: "Ghost", email: "g@x.com", resourceId: null });
  });

  it("renders sectioned Resources and Recent headers when both kinds are present", () => {
    setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("disabled suppresses the popover and create row", () => {
    setup({ name: "Brand New", email: "", resourceId: null }, { disabled: true });
    // A disabled input cannot be focused, so this attempt is a no-op.
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
  });
});
