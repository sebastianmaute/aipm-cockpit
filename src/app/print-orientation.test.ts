import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("print orientation", () => {
  test("in-app @page defaults to A4 landscape", () => {
    // Read globals.css from the filesystem directly. Resolving the .css via
    // `new URL("./globals.css", import.meta.url)` does not work here because
    // vitest's `css: true` routes .css imports through Vite's dev server,
    // yielding an http:// URL that `fileURLToPath` rejects.
    const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4 landscape/);
  });
});
