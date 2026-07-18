import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./data-table";
import { TABLE_HEAD_CLASS } from "./table-styles";

function renderTable(props?: Partial<Parameters<typeof DataTable>[0]>) {
  return render(
    <DataTable
      head={<tr><th>Name</th></tr>}
      {...props}
    >
      <tr><td>Row 1</td></tr>
    </DataTable>,
  );
}

describe("DataTable", () => {
  test("renders a table with the sanctioned head class and the rows", () => {
    renderTable();
    const table = screen.getByRole("table");
    const thead = table.querySelector("thead");
    // The whole sanctioned head class is applied by construction.
    for (const cls of TABLE_HEAD_CLASS.split(" ")) {
      expect(thead?.className).toContain(cls);
    }
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Row 1" })).toBeInTheDocument();
  });

  test("defaults the table element class and honours an override", () => {
    const { rerender } = renderTable();
    expect(screen.getByRole("table").className).toBe("min-w-full text-left text-sm");
    rerender(
      <DataTable head={<tr><th>H</th></tr>} className="w-full text-xs">
        <tr><td>R</td></tr>
      </DataTable>,
    );
    expect(screen.getByRole("table").className).toBe("w-full text-xs");
  });

  test("applies tbodyClassName and forwards native table props", () => {
    renderTable({ tbodyClassName: "divide-y", "aria-label": "Risks" } as never);
    const table = screen.getByRole("table", { name: "Risks" });
    expect(table.querySelector("tbody")?.className).toBe("divide-y");
  });
});
