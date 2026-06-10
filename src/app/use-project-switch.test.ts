import { describe, expect, it } from "vitest";
import {
  deriveRegistryEntry,
  localKindForFormat,
  projectNameFromFileName,
} from "./use-project-switch";
import type { ProjectMeta } from "./types";
import type { StorageConfig } from "./storage";

describe("localKindForFormat", () => {
  it("maps json to local-json", () => {
    expect(localKindForFormat("json")).toBe("local-json");
  });
  it("maps csv to local-csv", () => {
    expect(localKindForFormat("csv")).toBe("local-csv");
  });
  it("maps md to local-md", () => {
    expect(localKindForFormat("md")).toBe("local-md");
  });
});

describe("projectNameFromFileName", () => {
  it("strips the extension", () => {
    expect(projectNameFromFileName("acme.json")).toBe("acme");
  });
  it("strips directory segments", () => {
    expect(projectNameFromFileName("C:\\projects\\acme.csv")).toBe("acme");
    expect(projectNameFromFileName("/home/x/acme.md")).toBe("acme");
  });
  it("keeps a dotfile name intact (leading dot is not an extension)", () => {
    expect(projectNameFromFileName(".acme")).toBe(".acme");
  });
  it("returns empty string for undefined or empty", () => {
    expect(projectNameFromFileName(undefined)).toBe("");
    expect(projectNameFromFileName("")).toBe("");
  });
});

describe("deriveRegistryEntry", () => {
  const storageConfig: StorageConfig = { kind: "local-json" };

  function meta(overrides: Partial<ProjectMeta>): ProjectMeta {
    return {
      name: "",
      code: "",
      projectManager: "",
      keyStakeholdersInternal: [],
      keyStakeholdersExternal: [],
      customer: "",
      naceSection: "",
      identityTypes: [],
      products: "",
      deployment: "cloud" as ProjectMeta["deployment"],
      startDate: "",
      endDate: "",
      profitCenter: "",
      contactPersons: [],
      regulatory: [],
      ...overrides,
    };
  }

  it("uses the project meta name and code when present", () => {
    const entry = deriveRegistryEntry({
      id: "id-1",
      storageConfig,
      project: meta({ name: "Acme Migration", code: "ACM-1" }),
      fileName: "whatever.json",
    });
    expect(entry).toEqual({
      id: "id-1",
      name: "Acme Migration",
      code: "ACM-1",
      storageConfig,
    });
  });

  it("falls back to the file name when meta has no name", () => {
    const entry = deriveRegistryEntry({
      id: "id-2",
      storageConfig,
      project: undefined,
      fileName: "C:\\data\\portfolio.csv",
    });
    expect(entry.name).toBe("portfolio");
    expect(entry.code).toBe("");
  });

  it("uses 'Untitled project' when neither meta name nor file name resolve", () => {
    const entry = deriveRegistryEntry({
      id: "id-3",
      storageConfig,
      project: undefined,
      fileName: undefined,
    });
    expect(entry.name).toBe("Untitled project");
  });

  it("prefers a meta name even when a file name is available", () => {
    const entry = deriveRegistryEntry({
      id: "id-4",
      storageConfig,
      project: meta({ name: "Named", code: "N-1" }),
      fileName: "fromfile.json",
    });
    expect(entry.name).toBe("Named");
  });
});
