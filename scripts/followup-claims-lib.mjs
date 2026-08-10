// Parsing and classification for the open-followups register gate.
// Pure: no `process.exit`, no `console`, no IO beyond what the caller injects —
// so every rule below is unit-testable. Mirrors `doc-claims-lib.mjs`, whose
// fence parser and citation resolver this file REUSES rather than re-derives.
import { citesOnLine, stripFencedBlocks, THIRD_PARTY_RE } from "./doc-claims-lib.mjs";
import { isGatedSymbolName } from "./agents-symbols-lib.mjs";

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

  for (const s of symbols) {
    if (!env.knownSymbols.has(s)) problems.push({ kind: "SYMBOL_MISSING", detail: s });
  }
  for (const p of paths) {
    if (env.resolve(p).length === 0) problems.push({ kind: "PATH_MISSING", detail: p });
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
  // cite standing earlier in an entry cannot hide the real breakage behind it —
  // the under-reporting direction. It is only the verdict when nothing else
  // went wrong; `problems` always carries every finding in document order.
  const actionable = problems.find((p) => p.kind !== "CITE_THIRD_PARTY");
  const verdict = actionable
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
