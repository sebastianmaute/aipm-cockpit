// Parsing and classification for the open-followups register gate.
// Pure: no `process.exit`, no `console`, no IO beyond what the caller injects —
// so every rule below is unit-testable. Mirrors `doc-claims-lib.mjs`, whose
// fence parser and citation resolver this file REUSES rather than re-derives.
import path from "node:path";
import url from "node:url";

import { citesOnLine, stripFencedBlocks, THIRD_PARTY_RE } from "./doc-claims-lib.mjs";
import { ABSENCE_MARKERS, isGatedSymbolName } from "./agents-symbols-lib.mjs";

export const REGISTER = "docs/open-followups.md";

/** ★★★ THIS SWEEP'S OWN FILES, EXCLUDED FROM THE TREE IT JUDGES AGAINST — the
 *  same hazard `GATE_SELF_FILES` documents at three stars in the symbol gate,
 *  reproduced here because the design invites it: the test file's whole method
 *  is quoting register prose VERBATIM, so every name it quotes becomes a name
 *  the scan finds. Measured against the pre-fix files, 2026-08-10: 19 of the
 *  372 gated symbols the 92 open entries name were written verbatim inside these
 *  three — among them `resetAllCols` (§7), `useFocusTrap` (§8), `csvToWorkspace`
 *  (§28) and `ToggleButton` (§55). ★ Do not trust that pair of numbers; both
 *  move with the register. The overlap is RE-MEASURED on every run by the
 *  "quotes the register's own symbols back at it" test in
 *  `followup-claims-lib.test.mjs`, which is the reproduce command.
 *
 *  ★★ No false CLEAN resulted, because all 19 also exist in `src/` — which is
 *  exactly what makes it dangerous. The failure is one-way and silent: delete
 *  one of those names from `src/` and its entry reports CLEAN forever, vouched
 *  for by this harness's own fixture, at exit 0 either way.
 *
 *  ★ Derived from this module's location, never `process.cwd()`, for the reason
 *  the sibling constant records: a cwd-relative list is correct only while an
 *  unwritten repo-root invariant holds, and there are two consumers now. */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const SWEEP_SELF_FILES = new Set([
  path.join(HERE, "check-followup-claims.mjs"),
  path.join(HERE, "followup-claims-lib.mjs"),
  path.join(HERE, "followup-claims-lib.test.mjs"),
]);

/** `## 42. Title` opens an entry. */
export const ENTRY_RE = /^##\s+(\d+)\.\s+(.*)$/;

/** Any OTHER level-2 heading closes the current entry. The register carries
 *  three ("Decided — do not re-litigate", "Provenance …", "Standing notes …")
 *  and their prose makes no claim about the entry above. `###` sub-headings are
 *  body: `\s+` cannot match the third `#`. */
export const SECTION_RE = /^##\s+(?!\d+\.\s)/;

export function parseEntries(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = ENTRY_RE.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { n: Number(m[1]), title: m[2], startLine: i + 1, body: [] };
      return;
    }
    if (SECTION_RE.test(line)) {
      if (cur) out.push(cur);
      cur = null;
      return;
    }
    if (cur) cur.body.push(line);
  });
  if (cur) out.push(cur);
  return out;
}

/** ★ Matched on the HEADING only, and case-sensitively on the bare word. The
 *  register's bodies discuss popovers being "closed" constantly; reading the
 *  body would mark live entries done. */
export function isClosed(title) {
  return /\bCLOSED\b/.test(title) || title.includes("~~");
}

/** Fenced content, delimiters removed — the complement of `stripFencedBlocks`.
 *  ★★ Derived from that function rather than re-parsed: it is hardened against
 *  blockquoted, tilde, inline and nested fences, all four of which were live
 *  defects. A second parser here would drift from it silently. */
export function fencedLines(text) {
  const raw = text.split(/\r?\n/);
  const stripped = stripFencedBlocks(text);
  return raw.filter(
    (l, i) => stripped[i] === "" && l.trim() !== "" && !/^\s*(?:>\s?)*(?:`{3,}|~{3,})/.test(l),
  );
}

/** Commands safe to execute. ★★★ NO SHELL METACHARACTERS, because the runner
 *  spawns with `shell: false` — and because a piped command reports the PIPE's
 *  exit status, so a "reproduce" that silently always passes is worse than
 *  none. Blockquote markers are stripped first.
 *
 *  ★★★ IT BOUNDS A COMMAND'S SHAPE, NEVER ITS EFFECT, AND IT IS NOT A PRIVILEGE
 *  BOUNDARY. Read as one, it would be a bad one: `npm run …` admits any script
 *  name matching its character class — `build` and `stop` among them — the
 *  `node scripts/…` alternative admits any file in that directory, and the `npx`
 *  one carries no end anchor, so anything `npx` will fetch and run is in scope. What makes that acceptable is
 *  the threat model, not the regex — this runner is opt-in (`--run-repro`), never
 *  runs in CI, and its input is a tracked file that needs the same review access
 *  as this script. So it is a FOOT-GUN guard: it keeps a careless reproduce line
 *  from doing something surprising, and it must not be cited as containment.
 *  Tightening it is a separate change, and one that has to MEASURE what it drops
 *  from today's register first. */
const RUNNABLE_RE = /^(?:grep\b|node -e |node scripts\/[\w.-]+|npm run [a-z0-9:_-]+$|npx [\w@/.-]+)/;
const SHELL_META = /[|;&><`$(){}]/;

/** Split a shell-ish line into the command and its trailing `# …` comment.
 *  ★★★ Splitting, not discarding, and that distinction cost a false finding:
 *  the comment is the REGISTER'S OWN STATEMENT of what the command is expected
 *  to do (`# no hits`, `# 3 failed / 17 passed`). Thrown away, the runner had
 *  nothing to compare a non-zero exit against and reported §95's two
 *  deliberately-no-match greps as rotted evidence. Callers keep it and print it
 *  beside the exit code.
 *
 *  Stripping it off the ARGV is still required, and is not cosmetic: the runner
 *  spawns with `shell: false`, so there is no shell to strip one — every token
 *  after the `#` would arrive as literal argv.
 *
 *  Only a BARE `#` opens a comment — one starting a token, outside quotes — so
 *  `--color=#fff` and `grep '#define'` survive intact. Quote state is tracked
 *  POSIX-style (a backslash escapes the next character except inside single
 *  quotes) because the register's lines are written as shell text.
 *
 *  ★★ Returns `null` when the quoting does not resolve, and the caller DROPS
 *  that line. This list is executed: a wrongly-parsed command is worse than a
 *  missing one, so an unbalanced quote is never guessed at. */
export function splitTrailingComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && !inSingle) {
      i++; // escaped character, whatever it is — cannot open a quote or comment
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return { cmd: line.slice(0, i).trimEnd(), comment: line.slice(i).trim() };
    }
  }
  return inSingle || inDouble ? null : { cmd: line, comment: "" };
}

/** The command alone. Kept as its own export because most callers want exactly
 *  that, and because the tests that pin the quote model were written against
 *  this signature. */
export function stripTrailingComment(line) {
  return splitTrailingComment(line)?.cmd ?? null;
}

/** Tokenize a command line for `spawnSync(..., { shell: false })`.
 *
 *  ★★★ SPLITTING ON WHITESPACE FABRICATES DRIFT, and it fabricates it on the
 *  commands most worth running. Nothing strips quotes without a shell, so
 *  `grep -n "Showing the first" a.ts b.ts` split on `/\s+/` searches for
 *  `"Showing` in files named `the` and `first"` — grep exits 2 on the missing
 *  files and the runner reports a reproduce command that "no longer exits 0".
 *  A gate reporting a green branch as red is the expensive direction, and this
 *  one did: the register's `grep -n "Showing the first" …` reported drift under
 *  the naive split and exits 0 once tokenized. ★★ It did NOT explain every
 *  non-zero exit that run — which is the point: with the bug present you cannot
 *  tell the two apart, so no number from that run is worth quoting. Reproduce
 *  the fabricated half, whose `2` is grep failing to open files named `the` and
 *  `first"`:
 *    node -e "const{spawnSync:s}=require('node:child_process');const c='grep -n \"Showing the first\" src/app/doc-render-pptx.ts'.split(/\s+/);console.log(s(c[0],c.slice(1),{encoding:'utf8'}).status)"
 *
 *  ★★★ THIS IS THE MOST SAFETY-CRITICAL FUNCTION IN THIS FILE — it decides what
 *  reaches `spawnSync`. It lives HERE, and not next to the runner, for exactly
 *  that reason: in the CLI it was module-local to a file that reads the register
 *  and `process.exit`s at import, so nothing could import it and nothing tested
 *  it — while its far less dangerous sibling `stripTrailingComment` had a whole
 *  describe block of its own.
 *
 *  Quote handling mirrors `splitTrailingComment`'s model — a backslash escapes
 *  the next character except inside single quotes. The two agreeing about where
 *  a quoted span ends is not a coincidence to be trusted: a DIFFERENTIAL test
 *  pins it, because a comment claiming they "cannot disagree" enforces nothing.
 *
 *  Returns `null` on unbalanced quoting, on a trailing backslash that escapes
 *  nothing, and on an empty result; the caller then reports the command
 *  UNRUNNABLE rather than spawn a guess.
 *  ★ A `*` reaches the child literally: there is no shell to expand it. Whether
 *  it still matches is the child's business (MSYS builds glob for themselves,
 *  GNU grep on Linux does not), which is one more reason a non-zero exit from
 *  this runner is a lead and not a verdict. */
export function toArgv(cmd) {
  const argv = [];
  let cur = "";
  let started = false; // `""` is a real empty argument, so emptiness cannot end one
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "\\" && quote !== "'") {
      if (i + 1 >= cmd.length) return null; // trailing backslash escapes nothing
      cur += cmd[++i];
      started = true;
      continue;
    }
    if (quote === null && /\s/.test(ch)) {
      if (started) argv.push(cur);
      cur = "";
      started = false;
      continue;
    }
    if (quote === null && (ch === "'" || ch === '"')) {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    cur += ch;
    started = true;
  }
  if (quote !== null) return null;
  if (started) argv.push(cur);
  return argv.length ? argv : null;
}

/** `{ cmd, comment }` per runnable fenced line. */
export function reproEntriesIn(text) {
  return fencedLines(text)
    .map((l) => splitTrailingComment(l.replace(/^\s*(?:>\s?)*/, "").trim()))
    // ★ The comment is split off BEFORE the two guards, so both judge what will
    // actually be spawned. That is stricter, not weaker: metacharacters inside
    // a set-aside comment can never reach the runner, while metacharacters in
    // the command itself are still rejected.
    .filter((e) => e !== null && RUNNABLE_RE.test(e.cmd) && !SHELL_META.test(e.cmd));
}

export function reproCommandsIn(text) {
  return reproEntriesIn(text).map((e) => e.cmd);
}

/** Backticked names the symbol gate would check. Same predicate, imported —
 *  two gates disagreeing about what a symbol is would be worse than either.
 *
 *  ★★ DISTINCT names, like `pathsIn` beside it. The two disagreed when this
 *  sweep first shipped, and both consequences were live on the first snapshot:
 *  §88 printed its one missing symbol TWICE, and `counts.symbols` was a MENTION
 *  count while
 *  `counts.paths` was a distinct one — so the snapshot moved whenever prose
 *  merely repeated a name, which is noise in the one artifact that exists to be
 *  diffed. */
export function symbolsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (isGatedSymbolName(m[1])) out.add(m[1]);
  }
  return [...out];
}

/** Bare repo paths an entry names. Excludes anything already carrying `:LINE`
 *  — that is a citation and is checked with the line number attached. */
export function pathsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([\w./-]+\.(?:tsx|ts|mjs|json|css|md|yml))`/g)) out.add(m[1]);
  return [...out];
}

export function citesIn(text) {
  const out = [];
  for (const line of stripFencedBlocks(text)) out.push(...citesOnLine(line));
  return out;
}

/** The bare state words of the symbol gate's shared marker list, lower-cased.
 *  Its SCREAMING members are exactly those words, so this is a DERIVATION and
 *  not a second vocabulary — a word added there flows through here. A test pins
 *  the subset relationship. */
export const ABSENCE_STATE_WORDS = ABSENCE_MARKERS.filter((m) => /^[A-Z]{3,}$/.test(m)).map((m) =>
  m.toLowerCase(),
);

/** A run of backticked names, optionally separated by `/`, `·` or a comma —
 *  the register's list punctuation ("`a.ts` / `b.ts` / `c.ts` are all missing"). */
const NAME_RUN = "(?:`[^`\\n]+`(?:\\s*[/·,]\\s*|\\s+)?)+";

/** ★★★ THE VOCABULARY IS THE SYMBOL GATE'S; THE GRAMMAR IS THIS REGISTER'S, AND
 *  THE DIFFERENCE IS LOAD-BEARING. `markedNear` asks whether a marker sits within
 *  `PROXIMITY` characters of a mention. That rule was tuned for AGENTS.md bullet
 *  prose and it does NOT transfer here — measured against the real register, not
 *  reasoned: at the shared window, 54 of 957 backticked mentions across the 92
 *  open entries sit near a marker, and 48 of those name a thing that EXISTS.
 *  Every one would have become a false "this follow-up is done".
 *
 *  The cause is structural, so no window value fixes it: register entries pack
 *  many names onto one table row, and a negation routinely sits a few characters
 *  from an unrelated live name. §7's own A1 row runs
 *  "no `src/app/form-field.tsx` exists. | **A3** | `resetAllCols` chains…" — a
 *  genuine absence assertion 15 characters from a symbol that is very much
 *  present. Narrowing the window cannot separate those two; nothing positional can.
 *
 *  So these patterns ANCHOR: the marker must CAPTURE the name it negates. That
 *  removes the window constant from the design entirely, which is why no
 *  register-specific PROXIMITY is defined.
 *
 *  ★★★ IT ALSO EXCLUDES THE GENERIC MARKERS STRUCTURALLY, WHICH IS THE POINT.
 *  `Do NOT`, `do NOT`, `not built`, `deprecated` cannot name a target, so no
 *  pattern here can use one. That matters: those four fired on 20 mentions in
 *  the register, ALL of them existing code, because this document is full of
 *  prescriptive prose ("Deliberately not built", "controls do NOT use that
 *  primitive"). A curated denylist would have to be maintained; a grammar that
 *  cannot express them needs no maintenance.
 *
 *  ★★ THE BARE `no <name>` SHAPE IS DELIBERATELY NOT A PATTERN. In this register
 *  it overwhelmingly means "not used HERE", not "does not exist": "no
 *  `useFocusTrap` import", "the file creates no `AbortController` anywhere", "a
 *  read tool with no `isReadOnly` guard". Admitting it matched 15 existing
 *  symbols against 2 genuinely absent ones. An existence verb must be present.
 *
 *  Re-derive all of the above by re-running `node scripts/check-followup-claims.mjs`
 *  and comparing verdicts; the anchored set is what the current tally reflects. */
export const REGISTER_ABSENCE_PATTERNS = [
  // §7: "no `src/app/form-field.tsx` exists."
  { id: "no-NAME-exists", re: new RegExp(`\\bno\\s+(${NAME_RUN})\\*{0,2}exists?\\b`, "gi") },
  // "no such `X`" — `no such` is a shared ABSENCE_MARKERS member.
  { id: "no-such-NAME", re: new RegExp(`\\bno such\\s+(${NAME_RUN})`, "gi") },
  // "`X` does not exist" — likewise a shared member, anchored to its subject.
  { id: "NAME-does-not-exist", re: new RegExp(`(${NAME_RUN})(?:does|do)\\s+not\\s+exist\\b`, "gi") },
  { id: "NAME-never-existed", re: new RegExp(`(${NAME_RUN})never existed\\b`, "gi") },
  // §7: "`docs/refactor-review-2026-06-19.md` was **deleted in the same cleanup**"
  {
    id: "NAME-state",
    re: new RegExp(
      `(${NAME_RUN})(?:was|were|is|are)\\s+\\*{0,2}(?:${ABSENCE_STATE_WORDS.join("|")})\\b`,
      "gi",
    ),
  },
  // §44: "`graph-recurrence.ts` / … / `use-event-calendar-pull.ts` are all **missing**"
  // ★ `missing` is the one word here with no ABSENCE_MARKERS counterpart. It is
  // register-specific and earns its place on that line alone: four of the seven
  // assertions the sweep finds today come from it.
  {
    id: "NAME-missing",
    re: new RegExp(`(${NAME_RUN})(?:is|are)\\s+(?:all\\s+)?\\*{0,2}missing\\b`, "gi"),
  },
];

/** Names an entry asserts do NOT exist, mapped to the pattern that read it.
 *  Matched on the entry's own prose, so an assertion can never reach across
 *  entries — the same one-document scoping `markedNear` documents. */
export function assertedAbsentNames(prose) {
  const out = new Map();
  for (const { id, re } of REGISTER_ABSENCE_PATTERNS) {
    for (const m of prose.matchAll(re)) {
      for (const nm of m[1].matchAll(/`([^`\n]+)`/g)) if (!out.has(nm[1])) out.set(nm[1], id);
    }
  }
  return out;
}

/** ★ Paths are compared by SUFFIX, not equality: §7's A1 row names the same file
 *  twice — `form-field.tsx` as the proposal and `src/app/form-field.tsx` as the
 *  verified absence — and the two mentions must not disagree. This mirrors how
 *  `resolveCandidates` already matches a cited path against the tree. Symbols are
 *  matched exactly; there is no such thing as a partial identifier. */
function assertedAbsent(name, isPath, absent) {
  if (absent.has(name)) return true;
  if (!isPath) return false;
  for (const k of absent.keys()) {
    if (k.endsWith(`/${name}`) || name.endsWith(`/${k}`)) return true;
  }
  return false;
}

/** `env` is injected so this stays pure and testable:
 *    knownSymbols : Set<string>      identifiers present in src/scripts/e2e
 *    resolve      : (path) => path[] doc-claims-lib's resolveCandidates, bound
 *    lineCounts   : Map<path, number>
 */
export function classify(entry, env) {
  const prose = stripFencedBlocks(entry.body.join("\n")).join("\n");
  const symbols = symbolsIn(prose);
  const paths = pathsIn(prose);
  const cites = citesIn(entry.body.join("\n"));
  // ★★ `{ cmd, comment }`, not a bare string: the comment is the register's own
  // statement of the expected outcome, and the runner needs it to tell a
  // deliberate no-match from rotted evidence. See `splitTrailingComment`.
  const repro = reproEntriesIn(entry.body.join("\n"));
  const problems = [];

  // ★★★ AN ENTRY THAT ASSERTS A THING IS ABSENT MUST NOT BE FLAGGED FOR ITS
  // ABSENCE — and the INVERSE is the most valuable signal this sweep can emit.
  // §7 proposes extracting `src/app/form-field.tsx` and records that it does not
  // exist yet; reporting that as rot is backwards. But suppressing it outright
  // would be worse: if that file ever APPEARS, the follow-up is DONE, and "this
  // entry no longer applies" is the one conclusion a static pass can reach on
  // its own. So the check INVERTS rather than vanishing.
  const absent = assertedAbsentNames(prose);

  for (const s of symbols) {
    const present = env.knownSymbols.has(s);
    if (assertedAbsent(s, false, absent)) {
      if (present) {
        problems.push({
          kind: "ASSERTED_ABSENT_NOW_PRESENT",
          detail: `${s} (the entry says it does not exist — it now does)`,
        });
      }
      continue;
    }
    if (!present) {
      // ★★★ THE SYMBOL EXISTS; THE SWEEP CANNOT SEE IT, AND THAT IS DELIBERATE.
      // `SWEEP_SELF_FILES` is excluded from `knownSymbols` so this harness cannot
      // vouch for the names it checks — see that constant's three-star note. The
      // consequence was a permanent SYMBOL_MISSING on §138, which documents this
      // sweep and therefore names its internals: `markedNear`, `toArgv` and
      // `collectIdentifiers` are all in the tree, in 5, 3 and 5 files.
      // ★★ Reported, never dropped. "I was not allowed to look" is a different
      // statement from "it is gone", and collapsing them into CLEAN is exactly
      // the circularity the exclusion exists to prevent.
      const kind = env.selfExcludedSymbols?.has(s) ? "SYMBOL_SELF_EXCLUDED" : "SYMBOL_MISSING";
      problems.push({ kind, detail: s });
    }
  }
  for (const p of paths) {
    // ★★ Mirrors CITE_THIRD_PARTY exactly, including its ORDER: classified on
    // the path itself, BEFORE resolution, because it is a property of the path
    // and not of the failure — nothing under `node_modules/` could resolve
    // anyway, since the resolver walks src/scripts/e2e and docs only.
    // ★ REPORTED, never dropped, for the reason the sibling bucket records:
    // dependency references rot on any upgrade and one of them carries a
    // content hash in its filename, so it WILL break and nothing will say so.
    if (THIRD_PARTY_RE.test(p)) {
      problems.push({ kind: "PATH_THIRD_PARTY", detail: `${p} (dependency)` });
      continue;
    }
    const present = env.resolve(p).length > 0;
    if (assertedAbsent(p, true, absent)) {
      if (present) {
        problems.push({
          kind: "ASSERTED_ABSENT_NOW_PRESENT",
          detail: `${p} (the entry says it does not exist — it now does)`,
        });
      }
      continue;
    }
    if (!present) problems.push({ kind: "PATH_MISSING", detail: p });
  }
  for (const c of cites) {
    // ★★ A citation into a DEPENDENCY is not repo debt. Same reasoning, and the
    // same predicate, as `doc-claims-lib.mjs`'s `thirdParty` bucket: mixing
    // these into the number a human is meant to act on is the fastest way to
    // get that number ignored. Classified BEFORE resolution, because it is a
    // property of the path, not of the failure — nothing under `node_modules/`
    // could resolve anyway (the resolver walks src/scripts/e2e only).
    // ★ REPORTED, never dropped: they rot on any upgrade, and one of them
    // carries a content hash in its filename, so it WILL break silently.
    if (THIRD_PARTY_RE.test(c.citedPath)) {
      problems.push({ kind: "CITE_THIRD_PARTY", detail: `${c.citedPath}:${c.lineNo} (dependency)` });
      continue;
    }
    const [resolved] = env.resolve(c.citedPath);
    if (!resolved) {
      problems.push({ kind: "CITE_BROKEN", detail: `${c.citedPath} (unresolvable)` });
      continue;
    }
    const max = env.lineCounts.get(resolved) ?? 0;
    if (Number(c.lineNo) > max) {
      problems.push({ kind: "CITE_BROKEN", detail: `${c.citedPath}:${c.lineNo} > ${max}` });
    }
  }

  const hasClaim = symbols.length + paths.length + cites.length + repro.length > 0;
  // ★★ The verdict is the first problem that is REPO debt, so a third-party
  // cite or PATH standing earlier in an entry cannot hide the real breakage
  // behind it — the under-reporting direction. Such a finding is only the
  // verdict when nothing else went wrong; `problems` always carries every
  // finding in document order.
  // ★★ ASSERTED_ABSENT_NOW_PRESENT outranks even that: it is evidence the entry
  // may be COMPLETE, which is worth more than any stale name inside an entry
  // that still applies. Without this tier a single missing symbol earlier in the
  // body would bury it.
  const THIRD_PARTY_KINDS = new Set(["CITE_THIRD_PARTY", "PATH_THIRD_PARTY"]);
  // ★★ Not repo debt either, for the same reason and with the same consequence:
  // a finding no probe can resolve must not stand in front of one that can.
  const NON_ACTIONABLE = new Set([...THIRD_PARTY_KINDS, "SYMBOL_SELF_EXCLUDED"]);
  const done = problems.find((p) => p.kind === "ASSERTED_ABSENT_NOW_PRESENT");
  const actionable = problems.find((p) => !NON_ACTIONABLE.has(p.kind));
  const verdict = done
    ? done.kind
    : actionable
      ? actionable.kind
      : problems.length
        ? problems[0].kind
        : hasClaim
          ? "CLEAN"
          : "NO_MACHINE_CLAIM";
  return {
    n: entry.n,
    title: entry.title,
    startLine: entry.startLine,
    verdict,
    problems,
    repro,
    counts: { symbols: symbols.length, paths: paths.length, cites: cites.length },
    // ★★ EVERY entry reaching here needs a human or a probe. CLEAN means
    // "nothing static disproved it", never "it still applies".
    needsProbe: true,
  };
}
