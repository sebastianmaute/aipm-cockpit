// src/app/text-diff.ts — minimal LCS-based line diff for comparing two rendered
// plain-text template bodies. No dependency. A changed line shows as a removed
// line followed by an added line.
export type DiffLine = { type: "same" | "added" | "removed"; text: string };

export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // lcs[i][j] = length of the longest common subsequence of before[i..] / after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: "same", text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "removed", text: before[i] });
      i++;
    } else {
      out.push({ type: "added", text: after[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "removed", text: before[i] }); i++; }
  while (j < m) { out.push({ type: "added", text: after[j] }); j++; }
  return out;
}
