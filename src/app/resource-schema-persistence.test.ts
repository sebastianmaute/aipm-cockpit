// Guards the new Resource/Role persisted fields (isExternal, emails, Role.order)
// across the byte text backends (CSV + Markdown) and the JSON path. CSV columns
// also drive the Turso single + tenant schemas, so a CSV round-trip covers those.
import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
  jsonToWorkspace,
  workspaceToJson,
} from "./storage";
import { RESOURCES_CSV_COLUMNS, ROLES_CSV_COLUMNS } from "./csv-codecs-core";
import type { Workspace } from "./workspace";

function seed(): Workspace {
  return {
    ...emptyWorkspace(),
    resources: [
      {
        id: 1,
        firstName: "Ada",
        lastName: "Byte",
        email: "ada@example.com",
        emails: ["ada.alt@example.com", "ada@contractor.io"],
        isExternal: true,
        roleId: 10,
        utilizationMode: "percent",
        utilization: {},
      },
    ],
    roles: [
      { id: 10, disciplineId: 1, gradeId: 2, internalRate: 100, externalRate: 150, order: 3 },
    ],
  };
}

describe("Resource/Role new persisted fields", () => {
  it("emails + isExternal are in the CSV column registry (drives CSV + Turso)", () => {
    expect(RESOURCES_CSV_COLUMNS as readonly string[]).toContain("emails");
    expect(RESOURCES_CSV_COLUMNS as readonly string[]).toContain("isExternal");
    expect(ROLES_CSV_COLUMNS as readonly string[]).toContain("order");
  });

  it("survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seed()));
    const r = back.resources[0];
    expect(r?.isExternal).toBe(true);
    expect(r?.emails).toEqual(["ada.alt@example.com", "ada@contractor.io"]);
    expect(back.roles[0]?.order).toBe(3);
  });

  it("survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seed()));
    const r = back.resources[0];
    expect(r?.isExternal).toBe(true);
    expect(r?.emails).toEqual(["ada.alt@example.com", "ada@contractor.io"]);
    expect(back.roles[0]?.order).toBe(3);
  });

  it("survives the JSON round-trip", () => {
    const back = jsonToWorkspace(workspaceToJson(seed()));
    const r = back.resources[0];
    expect(r?.isExternal).toBe(true);
    expect(r?.emails).toEqual(["ada.alt@example.com", "ada@contractor.io"]);
    expect(back.roles[0]?.order).toBe(3);
  });

  it("drops the primary email, blanks, and case-insensitive dupes from emails", () => {
    const back = csvToWorkspace(
      workspaceToCsv({
        ...emptyWorkspace(),
        resources: [
          {
            id: 1,
            firstName: "Ada",
            lastName: "Byte",
            email: "ada@example.com",
            emails: ["ADA@example.com", "dup@x.io", "dup@x.io", "  ", "second@x.io"],
            roleId: null,
            utilizationMode: "percent",
            utilization: {},
          },
        ],
      }),
    );
    expect(back.resources[0]?.emails).toEqual(["dup@x.io", "second@x.io"]);
  });
});
