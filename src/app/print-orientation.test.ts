import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read globals.css from the filesystem directly. Resolving the .css via
// `new URL("./globals.css", import.meta.url)` does not work here because
// vitest's `css: true` routes .css imports through Vite's dev server,
// yielding an http:// URL that `fileURLToPath` rejects.
const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

describe("print orientation", () => {
  test("default @page is portrait A4 (Activity Log and other print-roots)", () => {
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4;/);
    // The DEFAULT (unnamed) page must NOT be landscape.
    expect(css).not.toMatch(/@page\s*\{[^}]*size:\s*A4 landscape/);
  });

  test("a named landscape @page exists for reports", () => {
    expect(css).toMatch(/@page landscape\s*\{[^}]*size:\s*A4 landscape/);
  });

  test(".print-landscape opts a print-root into the landscape page", () => {
    expect(css).toMatch(/\.print-landscape\s*\{[^}]*page:\s*landscape/);
  });
});
