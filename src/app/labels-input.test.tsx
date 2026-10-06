import { beforeAll, describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { LabelsInput } from "./labels-input";
import { loadI18n, t } from "./i18n";
import { sanitizeLabels } from "./sanitize";
import { expectRowUniqueNames } from "../test/row-unique-names";

describe("LabelsInput — every chip's remove button has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each chip's ✕ is named "Remove <label>", so two chips carrying the same label would share a
  // name. The labels reach this control through `sanitizeLabels`, which drops case-insensitive
  // repeats, so the fixture runs a list that DOES repeat (in case and in exact spelling) through
  // it, the way a stored or imported task's labels arrive.
  const RAW = ["Frontend", "frontend", "FRONTEND", "API", "api", "Release 2", "Release 2", "Docs"];
  const LABELS = sanitizeLabels(RAW);

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  test("renders real German for the de case", () => {
    expect(t("de", "remove")).not.toBe(t("en-US", "remove"));
  });

  test.each(["en-US", "de"] as const)("names every chip's remove button distinctly in %s", (lang) => {
    expect(LABELS).toEqual(["Frontend", "API", "Release 2", "Docs"]);
    render(<LabelsInput lang={lang} value={LABELS} suggestions={["Backend", "QA"]} onChange={() => {}} />);
    // One ✕ per chip plus the dropdown's chevron.
    expectRowUniqueNames({ minControls: LABELS.length + 1 });
  });
});
