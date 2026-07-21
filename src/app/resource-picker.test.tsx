import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { t } from "./i18n";
import type { Resource } from "./types";
import type { Contact } from "./contacts";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} });

const resources: Resource[] = [res(1, "Sample", "Dummy", "Sample@x.com"), res(2, "Bob", "Lee", "bob@x.com")];
const contacts: Contact[] = [{ name: "Old Contact", email: "old@x.com" }];

function setup(value: ResourcePickerValue, over: Partial<Parameters<typeof ResourcePicker>[0]> = {}) {
  const onChange = vi.fn();
  const onCreateResource = vi.fn(() => 99);
  const { container } = render(
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
  return { onChange, onCreateResource, container };
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

  it("the clear button wipes the name and email too, not just the FK", () => {
    // Reported as "clicking x does not clear the assignee field". The handler
    // used to keep name+email and drop only the link, and since the displayed
    // string is the same either way, the only visible effect was the button
    // itself vanishing — so the control read as dead. An ✕ inside a text input
    // means clear.
    const { onChange } = setup({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i })); // popover closed
    expect(onChange).toHaveBeenCalledWith({ name: "", email: "", resourceId: null });
  });

  // Its OWN test: this is the only coverage of the preventDefault, and folding it
  // into the assertion above meant a retitle or trim of that test could drop the
  // guard silently. The inline task-row assignee commits on blur and closes the
  // editor, so if mousedown blurs the input first the clear lands on an already
  // closed editor and is swallowed — the bug ebcd0788 fixed.
  it("does not let mousedown blur the input, or commit-on-blur editors swallow the clear", () => {
    setup({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
    const clearBtn = screen.getByRole("button", { name: /^clear$/i });
    // fireEvent returns dispatchEvent's result: false ⇔ preventDefault was called.
    expect(fireEvent.mouseDown(clearBtn)).toBe(false);
  });

  // A healthy link and a BROKEN one (resource deleted) differ only by the green
  // vs pink border and glyph — colour alone (WCAG 1.4.1). The button's accessible
  // NAME stays the action ("Clear") for both, so the state has to ride the
  // description, or a screen-reader user is never told the assignment is dangling
  // and has no reason to re-pick it.
  it("announces a healthy link in the clear button's description", () => {
    setup({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
    const btn = screen.getByRole("button", { name: /^clear$/i });
    expect(btn).toHaveAttribute("title", t("en-US", "resourcePickerLinked"));
  });

  it("announces a dangling link in the clear button's description, not just in pink", () => {
    setup({ name: "Ghost", email: "g@x.com", resourceId: 404 });
    const btn = screen.getByRole("button", { name: /^clear$/i });
    expect(btn).toHaveAttribute("title", t("en-US", "resourcePickerDangling"));
    // The two states must not share a description, or the distinction is lost.
    expect(t("en-US", "resourcePickerDangling")).not.toBe(t("en-US", "resourcePickerLinked"));
  });

  // WCAG 1.4.1: linked vs dangling differed ONLY by the green/pink border and
  // glyph colour. The title fixed the screen-reader case but is hover-only, so a
  // sighted user with a colour deficiency still got nothing — a non-colour SHAPE
  // has to carry it too.
  it("marks a dangling link with a shape, not only a colour", () => {
    const { container } = setup({ name: "Ghost", email: "g@x.com", resourceId: 404 });
    expect(container.querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  it("shows no dangling marker for a healthy link", () => {
    const { container } = setup({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
    expect(container.querySelector("[data-dangling-marker]")).toBeNull();
  });

  // The control says "Clear", so it has to be there whenever there is something
  // to clear. It used to render only for a linked/dangling value, leaving a
  // typed-in name with no affordance but select-all-delete.
  it("offers Clear for a free-text name with no linked resource", () => {
    const { onChange } = setup({ name: "Bob from vendor", email: "b@x.com", resourceId: null });
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith({ name: "", email: "", resourceId: null });
  });

  it("offers no Clear when the field is already empty", () => {
    setup({ name: "", email: "", resourceId: null });
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
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

  // A dangling FK (the resource was deleted) still renders the cached name and a
  // clear control. Clearing wipes the whole field rather than repairing the link
  // in place: re-picking from the dropdown is the repair path, and one glyph
  // doing two different things depending on a colour is worse than losing it.
  it("dangling FK falls back to the stored name and clears without crashing", () => {
    const { onChange } = setup({ name: "Ghost", email: "g@x.com", resourceId: 404 });
    expect(screen.getByRole("combobox")).toHaveValue("Ghost");
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith({ name: "", email: "", resourceId: null });
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

  it("omits the + Add row entirely when onCreateResource is not provided (link-only)", () => {
    const onChange = vi.fn();
    render(
      <ResourcePicker
        lang="en-US"
        value={{ name: "Brand New", email: "", resourceId: null }}
        resources={resources}
        contacts={contacts}
        onChange={onChange}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
  });
});
