// The SPDX ids this repo's licence check recognises: a reviewed subset of the
// SPDX licence list (https://spdx.org/licenses/), not the whole of it.
// No shebang: vitest imports this module through licences.mjs.
//
// ★ It fails closed. An id missing here reads as "unknown licence" and stops a
// release, which is the right default for a licence nobody has looked at: add
// the id after checking it on the SPDX list, in its exact SPDX spelling.
//
// Covers every id in the shipped set as measured on 2026-11-02, the root
// production closure, the deny list in .github/workflows/security.yml, the
// deprecated GPL family spellings old package.json files still carry (so they
// are caught as denied, not merely unknown), and the app's own EUPL-1.2.
export const SPDX_LICENCE_IDS = [
  "0BSD",
  "AGPL-1.0",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "EUPL-1.2",
  "GPL-1.0",
  "GPL-1.0-only",
  "GPL-1.0-or-later",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-2.0-with-classpath-exception",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
];

/** Ids that may follow `WITH`. */
export const SPDX_EXCEPTION_IDS = ["Classpath-exception-2.0", "LLVM-exception"];
