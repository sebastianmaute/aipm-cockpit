import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreateFieldsList } from "./create-fields-list";
import { fieldLabel } from "./inline-ai-edit/field-labels";

// §440 — the create card lists what a create writes, labelled like an update row.
describe("CreateFieldsList", () => {
  const item = {
    entity: "raid", title: "Vendor slip", toolName: "create_raid_item", input: {},
    fields: [{ field: "title", value: "Vendor slip" }, { field: "probability", value: "4" }],
  };

  it("renders one labelled line per field", () => {
    render(<CreateFieldsList lang="en-US" item={item} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      `${fieldLabel("en-US", "raid", "title")}: Vendor slip`,
      `${fieldLabel("en-US", "raid", "probability")}: 4`,
    ]);
  });

  it("renders nothing for a create with no listed fields", () => {
    const { container } = render(<CreateFieldsList lang="en-US" item={{ ...item, fields: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
