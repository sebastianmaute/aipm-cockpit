// src/app/markdown-fenced-json.ts
//
// The one reader for the Markdown backend's fenced-json meta slices (§578).
// Each slice used to be read with its own copy of
//   /## <Heading>\s*\n+```json\s*\n([\s\S]*?)\n```/
// which is quadratic on a heading followed by a long whitespace run: `\s*`
// and `\n+` (and, after the fence, `\s*` and `\n`) both match "\n", so every
// way of splitting the run is tried before the next literal fails —
// 32 / 125 / 501 ms at 10k / 20k / 40k newlines after one heading, per
// heading, on a file with no size cap.
//
// readFencedJsonSection returns EXACTLY that regex's capture group — the same
// leftmost heading, the same fence, the same body — but with forward scans
// only. markdown-fenced-json.test.ts holds the old regex as a differential
// oracle; keep the two in step if the format ever changes.

/** A whitespace run, as the old regex's `\s` defined it. Sticky and greedy with
 *  nothing after it, so it never backtracks. */
const WS_RUN = /\s*/y;

function wsRunEnd(md: string, from: number): number {
  WS_RUN.lastIndex = from;
  WS_RUN.test(md);
  return WS_RUN.lastIndex;
}

/** The largest k in (lo, hi] with md[k - 1] === "\n", or -1. Only ever called
 *  over a whitespace run, so it scans that run and nothing more. */
function lastLineStart(md: string, lo: number, hi: number): number {
  for (let k = hi; k > lo; k--) if (md.charCodeAt(k - 1) === 10) return k;
  return -1;
}

const OPEN_FENCE = "```json";
const CLOSE_FENCE = "\n```";

/** The body of the first `## <heading>` section whose ```json fence the old
 *  regex would have found, or undefined.
 *
 *  How each regex step maps onto a scan:
 *  - `\s*\n+```json`: "`" is not whitespace, so the fence can only start where
 *    the whitespace run after the heading ENDS, and the run must end in "\n".
 *  - `\s*\n`: the body starts after the LAST "\n" of the run after the fence —
 *    greedy `\s*` gives back one character at a time.
 *  - `([\s\S]*?)\n````: lazy, so the body ends at the first "\n```" from there.
 *    If there is none, the regex backtracks to the run's previous "\n"; the only
 *    "\n```" that adds is one at the run's very end, so that is the one case
 *    re-tried below.
 *  - a heading occurrence that fails is followed by the next, as the unanchored
 *    regex did. Each occurrence scans only its own two whitespace runs, which
 *    cannot overlap another's. The close-fence search runs at most ONCE per
 *    call: it either returns, or finds no "\n```" past this body start — and
 *    every later heading's own open fence would be one, so none can pass the
 *    open-fence check and reach it again. */
export function readFencedJsonSection(md: string, heading: string): string | undefined {
  const head = `## ${heading}`;
  for (let at = md.indexOf(head); at !== -1; at = md.indexOf(head, at + 1)) {
    const afterHead = at + head.length;
    const fence = wsRunEnd(md, afterHead);
    if (fence === afterHead || md.charCodeAt(fence - 1) !== 10 || !md.startsWith(OPEN_FENCE, fence)) continue;
    const afterFence = fence + OPEN_FENCE.length;
    const runEnd = wsRunEnd(md, afterFence);
    const bodyStart = lastLineStart(md, afterFence, runEnd);
    if (bodyStart === -1) continue;
    const close = md.indexOf(CLOSE_FENCE, bodyStart);
    if (close !== -1) return md.slice(bodyStart, close);
    // The run itself ends in "\n```": reachable only from an earlier "\n".
    if (bodyStart === runEnd && md.startsWith("```", runEnd)) {
      const earlier = lastLineStart(md, afterFence, runEnd - 1);
      if (earlier !== -1) return md.slice(earlier, runEnd - 1);
    }
  }
  return undefined;
}
