import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceEditModal } from "./resource-edit-modal";
import type { Resource } from "./types";

const base: Resource = {
  id: 1,
  firstName: "Sample",
  lastName: "Dummy",
  roleId: null,
  utilizationMode: "percent",
  utilization: {},
};

describe("ResourceEditModal", () => {
  it("renders nothing when resource is null", () => {
    const { container } = render(
      <ResourceEditModal
        lang="en-US"
        resource={null}
        isNew={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("saves with first/last preserved", () => {
    const onSave = vi.fn();
    render(
      <ResourceEditModal
        lang="en-US"
        resource={base}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /save resource/i }).closest("form")!,
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      firstName: "Sample",
      lastName: "Dummy",
    });
  });

  it("blocks save when both names are empty", () => {
    const onSave = vi.fn();
    render(
      <ResourceEditModal
        lang="en-US"
        resource={{ ...base, firstName: "", lastName: "" }}
        isNew
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /save resource/i }).closest("form")!,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides Delete in create mode", () => {
    render(
      <ResourceEditModal
        lang="en-US"
        resource={base}
        isNew
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("saves a full date when year is known", () => {
    const onSave = vi.fn();
    render(
      <ResourceEditModal
        lang="en-US"
        resource={{ ...base }}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // "Exact year unknown" defaults checked (no birthday) — uncheck it
    fireEvent.click(screen.getByLabelText(/exact year unknown/i));
    fireEvent.change(screen.getByLabelText("Birthday"), { target: { value: "1990-06-03" } });
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "1990-06-03" }));
  });

  it("strips the year to MM-DD when year is unknown", () => {
    const onSave = vi.fn();
    render(
      <ResourceEditModal
        lang="en-US"
        resource={{ ...base }}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // "Exact year unknown" defaults checked — leave it checked
    fireEvent.change(screen.getByLabelText("Birthday"), { target: { value: "2000-06-03" } });
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "06-03" }));
  });

  it("loads an existing MM-DD birthday (year-unknown, anchored) and re-saves it as MM-DD", () => {
    const onSave = vi.fn();
    render(
      <ResourceEditModal
        lang="en-US"
        resource={{ ...base, birthday: "06-03" }}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/exact year unknown/i)).toBeChecked();
    expect(screen.getByLabelText("Birthday")).toHaveValue("2000-06-03");
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "06-03" }));
  });
});
