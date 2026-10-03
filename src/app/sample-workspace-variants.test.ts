import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCALED_VARIANTS, decodeSampleMaster, scaleSample } from "./sample-workspace-variants";

// §238 — the committed big/huge samples are GENERATED from the master by
// `scripts/generate-sample-workspace.ts` (decode with the real sanitizers, scale, re-encode),
// so they go stale when the master, a sanitizer default or the JSON encoder changes. This
// regenerates both in memory through the generator's own shared functions and compares them.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The generator writes LF; the working tree is CRLF under core.autocrlf (`git ls-files --eol`
// reports i/lf w/crlf for all three samples), so EOL is normalised before comparing.
const readSample = (name: string): string =>
  readFileSync(join(ROOT, `sample-workspace-${name}.json`), "utf8").replace(/\r\n/g, "\n");

const REGENERATE_HINT =
  "The committed sample is stale against sample-workspace-small.json. Run " +
  "`npx vite-node scripts/generate-sample-workspace.ts`, then regenerate the golden fixtures " +
  "(`__fixtures__/golden-*`, see AGENTS.md \"Sample data is JSON-only, tiered\").";

describe("generated sample workspaces match their master", () => {
  const master = decodeSampleMaster(readSample("small"));

  it.each(SCALED_VARIANTS)(
    "sample-workspace-$name.json equals the $factor x regeneration",
    ({ name, factor }) => {
      const { json } = scaleSample(master, factor);
      const committed = readSample(name);
      const matches = json === committed;
      if (!matches) {
        // Name the first differing offset so the failure is not a 10 MB diff.
        let i = 0;
        while (i < json.length && json[i] === committed[i]) i++;
        throw new Error(
          `${REGENERATE_HINT} sample-workspace-${name}.json first differs at char ${i} ` +
            `(regenerated ${json.length} chars, committed ${committed.length}).`,
        );
      }
      expect(matches).toBe(true);
    },
    60_000,
  );
});
