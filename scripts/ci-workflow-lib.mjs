/** Pure text helpers over this repository's GitHub workflow files and the required-check list in
 *  docs/AGENTS/ci.md. They assume the fixed layout the workflows are written in: top-level keys at
 *  column 0, job ids at two spaces under `jobs:`, steps as `- ` list items. They are NOT a YAML
 *  parser; ci-workflow.test.mjs pins exactly what they accept. No shebang: this file is imported. */

const JOB_LINE = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const TOP_LEVEL = /^\S/;
const SHA_PIN = /^[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_PIN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const STEP_START = /^ {6}- /;

function jobsSection(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => TOP_LEVEL.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

export function jobIds(text) {
  return jobsSection(text).map((l) => JOB_LINE.exec(l)?.[1]).filter(Boolean);
}

export function jobBlock(text, id) {
  const lines = jobsSection(text);
  const start = lines.findIndex((l) => JOB_LINE.exec(l)?.[1] === id);
  if (start === -1) throw new Error(`no job "${id}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => JOB_LINE.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function unpinnedUses(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(l);
    if (!m) continue;
    const v = m[1];
    if (v.startsWith("./") || SHA_PIN.test(v) || DOCKER_PIN.test(v)) continue;
    out.push(v);
  }
  return out;
}

export function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === `${key}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => TOP_LEVEL.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter(Boolean);
}

export function requiredChecksFromDoc(md) {
  const begin = md.indexOf("<!-- required-checks:begin -->");
  const end = md.indexOf("<!-- required-checks:end -->");
  if (begin === -1 || end === -1 || end < begin) throw new Error("required-checks markers missing");
  const ids = md.slice(begin, end).split(/\r?\n/).map((l) => /^- `([a-z0-9-]+)`/.exec(l)?.[1]).filter(Boolean);
  if (ids.length === 0) throw new Error("required-checks block is empty");
  return ids;
}

/** Every `run:` value containing a pipe whose list item (step) does not declare `shell: bash`. */
export function pipedRunsWithoutBash(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let step = [];
  const flush = () => {
    const runIdx = step.findIndex((l) => /^\s*(?:-\s*)?run:/.test(l));
    if (runIdx !== -1) {
      const indent = step[runIdx].search(/\S/);
      const body = [step[runIdx].replace(/^\s*(?:-\s*)?run:\s*\|?\s*/, "")];
      for (const l of step.slice(runIdx + 1)) {
        if (l.trim() === "" || l.search(/\S/) > indent) body.push(l.trim());
        else break;
      }
      const cmd = body.filter(Boolean);
      const hasBash = step.some((l) => /^\s*(?:-\s*)?shell:\s*bash\s*$/.test(l));
      if (cmd.some((c) => /(^|[^|])\|([^|]|$)/.test(c)) && !hasBash) out.push(cmd[0]);
    }
    step = [];
  };
  for (const l of lines) {
    // Steps are list items at exactly six spaces in this layout; a job or top-level key also ends one.
    if (STEP_START.test(l) || TOP_LEVEL.test(l) || JOB_LINE.test(l)) flush();
    step.push(l);
  }
  flush();
  return out;
}
