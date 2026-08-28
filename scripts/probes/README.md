# Register probes

A probe is the executable half of a `docs/open-followups.md` entry. It exists so
an entry can be settled by running something rather than by re-reading code.

## Why probes and not `node -e` in the markdown

`scripts/followup-claims-lib.mjs` will not run a command containing a shell
metacharacter, so no real JavaScript one-liner is runnable from the register.
That guard is deliberate and stays: `node -e` would mean executing arbitrary
JavaScript lifted verbatim out of a markdown file on every `--run-repro`.

A probe is an ordinary repo file. Lint sees it, review sees it, `git log` sees
it, and `node scripts/probes/followup-NNN.mjs` IS in the runner's grammar.

Run `node scripts/probes/followup-grammar.mjs` for the executable statement of
which shapes the runner accepts. It keeps its FALSE rows on purpose — a probe
that shows only what works cannot show what to avoid.

## Contract

- Name it `followup-<entry number>.mjs`, or a descriptive name for a probe that
  serves no single entry.
- Print the finding on stdout. A reader must be able to judge the entry from the
  output alone, without opening the probe.
- **Exit 0** when the scan SUCCEEDED — including when it found the defect. The
  exit code reports whether the probe could do its job, not whether the news is
  good.
- **Exit 2** when the probe could not scan at all: a missing file, a parser that
  returned nothing. A scan that reads nothing passes everything, so this vacuity
  guard is mandatory.
- Exit 1 only if the probe is also used as a gate. `followup-grammar.mjs` is the
  worked example of the rule biting: it self-checks a documented invariant and
  its first cut exited 1 on a disagreement, contradicting this page. It exits 0
  now and prints the disagreement count instead. A drifted grammar is a
  FINDING, not a failure to scan.
- No shebang line. A `#!` on a `.mjs` that is ever imported makes vitest throw a
  SyntaxError naming the wrong file — and the error names the importer, not the
  file carrying the shebang.
- Print WHICH method produced an answer when a probe has fallbacks. A fallback
  hit that reads like a primary hit is a measurement nobody can audit.

## Citing one

In the entry's `**Status:**` line, in a fenced block:

    node scripts/probes/followup-213.mjs

Never a `path:LINE` citation — `docs/open-followups.md` is inside
`doc-claims-check`'s scan set, and that gate is a ratchet.
