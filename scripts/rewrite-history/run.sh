#!/usr/bin/env bash
# One-pass history rewrite for the GitHub migration (sanitise plan, Task 11).
#
# Usage:
#   scripts/rewrite-history/run.sh <mirror-clone> <replacements> <mailmap>
#
#   <mirror-clone>  a FRESH `git clone --no-local --mirror` in a scratch directory outside
#                   any working tree. It is rewritten in place; keep a second untouched mirror
#                   as the original for the verification step.
#   <replacements>  git-filter-repo `--replace-text` file, `regex:PATTERN==>REPLACEMENT` per
#                   line, bytes regexes. NEVER TRACKED — it names every identifier. Build it
#                   from the leak gate's untracked list (LEAK_LIST_FILE), longest entry first.
#                   ★★ Word-bounded entries need a BYTES boundary: filter-repo matches bytes,
#                   so `\b` is ASCII-only and cuts German words containing a name. Use
#                   `(?<![A-Za-z0-9_])(?<![\xc3-\xc5][\x80-\xbf])` before and
#                   `(?![A-Za-z0-9_\xc3-\xc5])` after (UTF-8 Latin letters count as letters).
#                   Treating EVERY non-ASCII byte as a letter is too wide: on 2026-09-22 it
#                   left 6 hits standing beside arrows (lead byte E2), which verify-rewrite
#                   caught.
#   <mailmap>       git mailmap mapping every historical author/committer/tagger identity to
#                   its replacement. NEVER TRACKED.
#
# Needs git-filter-repo (`py -m git_filter_repo` or `git filter-repo`). Does not push.
#
# What it rewrites, over every ref (a mirror has no --refs restriction):
#   - blob contents and commit/tag messages through <replacements>
#   - file paths through the same rules (a rename of an identifier-bearing path)
#   - identities through <mailmap>
#   - drops the assistant session-trailer lines and the assistant co-author lines. It matches
#     the TRAILER KEYS at the start of a line, never the assistant's name: commits mention it
#     legitimately because a shipped feature carries it.
#   - keeps every commit (no pruning), so the commit count before and after must be equal.
#
# The filter-repo commit map lands at <mirror-clone>/filter-repo/commit-map.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <mirror-clone> <replacements> <mailmap>" >&2
  exit 2
fi
MIRROR=$1
REPL=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
MAILMAP=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
for f in "$REPL" "$MAILMAP"; do
  [ -s "$f" ] || { echo "missing or empty: $f" >&2; exit 2; }
done

if git filter-repo --version >/dev/null 2>&1; then
  FR=(git filter-repo)
elif py -m git_filter_repo --version >/dev/null 2>&1; then
  FR=(py -m git_filter_repo)
else
  echo "git-filter-repo not found; do not substitute filter-branch" >&2
  exit 2
fi

export RW_REPLACEMENTS="$REPL"

cd "$MIRROR"
"${FR[@]}" \
  --replace-text "$REPL" \
  --replace-message "$REPL" \
  --mailmap "$MAILMAP" \
  --prune-empty never \
  --prune-degenerate never \
  --message-callback '
import re
keep = [l for l in message.split(b"\n")
        if not re.match(rb"(?i)^\s*(claude-session:|co-authored-by:\s*claude\b)", l)]
return b"\n".join(keep)
' \
  --filename-callback '
import os, re
global _rw_rules
try:
    _rw_rules
except NameError:
    _rw_rules = []
    with open(os.environ["RW_REPLACEMENTS"], "rb") as fh:
        for ln in fh.read().splitlines():
            if ln.startswith(b"regex:"):
                pat, _, rep = ln[len(b"regex:"):].partition(b"==>")
                _rw_rules.append((re.compile(pat), rep.replace(b"\\", b"\\\\")))
for pat, rep in _rw_rules:
    filename = pat.sub(rep, filename)
return filename
'
