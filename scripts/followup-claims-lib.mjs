// Parsing and classification for the open-followups register gate.
// Pure: no `process.exit`, no `console`, no IO beyond what the caller injects —
// so every rule below is unit-testable. Mirrors `doc-claims-lib.mjs`, whose
// fence parser and citation resolver this file REUSES rather than re-derives.
import { citesOnLine, stripFencedBlocks, THIRD_PARTY_RE } from "./doc-claims-lib.mjs";
import { ABSENCE_MARKERS, isGatedSymbolName } from "./agents-symbols-lib.mjs";

export const REGISTER = "docs/open-followups.md";

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
 *  none. Blockquote markers are stripped first. */
const RUNNABLE_RE = /^(?:grep\b|node -e |node scripts\/[\w.-]+|npm run [a-z0-9:_-]+$|npx [\w@/.-]+)/;
const SHELL_META = /[|;&><`$(){}]/;

/** Drop a trailing `# …` comment. ★★★ Required, not cosmetic: the runner
 *  spawns with `shell: false`, so there is no shell to strip one — every token
 *  after the `#` arrives as literal argv. Register lines really do carry them
 *  (`npx vitest run … --sequence.seed=1  # 3 failed / 17 passed`); enumerate
 *  today's with the extraction command in `followup-claims-lib.test.mjs`.
 *
 *  Only a BARE `#` opens a comment — one starting a token, outside quotes — so
 *  `--color=#fff` and `grep '#define'` survive intact. Quote state is tracked
 *  POSIX-style (a backslash escapes the next character except inside single
 *  quotes) because the register's lines are written as shell text.
 *
 *  ★★ Returns `null` when the quoting does not resolve, and the caller DROPS
 *  that line. This list is executed: a wrongly-parsed command is worse than a
 *  missing one, so an unbalanced quote is never guessed at. */
export function stripTrailingComment(line) {
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
      return line.slice(0, i).trimEnd();
    }
  }
  return inSingle || inDouble ? null : line;
}

export function reproCommandsIn(text) {
  return fencedLines(text)
    .map((l) => stripTrailingComment(l.replace(/^\s*(?:>\s?)*/, "").trim()))
    // ★ The comment is stripped BEFORE the two guards, so both judge what will
    // actually be spawned. That is stricter, not weaker: metacharacters inside
    // a discarded comment can never reach the runner, while metacharacters in
    // the command itself are still rejected.
    .filter((l) => l !== null && RUNNABLE_RE.test(l) && !SHELL_META.test(l));
}

/** Backticked names the symbol gate would check. Same predicate, imported —
 *  two gates disagreeing about what a symbol is would be worse than either. */
export function symbolsIn(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (isGatedSymbolName(m[1])) out.push(m[1]);
  }
  return out;
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
 *  PROXIMITY characters of a mention. That rule was tuned for AGENTS.md bullet
 *  prose and it does NOT transfer here — measured against the real register, not
 *  reasoned: at the shared 240-char window, 54 of 957 backticked mentions across
 *  the 92 open entries sit near a marker, and 48 of those name a thing that
 *  EXISTS. Every one would have become a false "this follow-up is done".
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
  const repro = reproCommandsIn(entry.body.join("\n"));
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
    if (!present) problems.push({ kind: "SYMBOL_MISSING", detail: s });
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
  const done = problems.find((p) => p.kind === "ASSERTED_ABSENT_NOW_PRESENT");
  const actionable = problems.find((p) => !THIRD_PARTY_KINDS.has(p.kind));
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
