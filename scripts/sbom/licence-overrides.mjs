// Reviewed licences for libraries vendored inside Next (`next/dist/compiled/*`)
// that declare none: Next's compile step strips the `license` field from these
// folders' package.json, or writes no package.json at all.
//
// ★★ Applied only to a vendored entry with no licence of its own, so it can never
// overrule a declaration or settle a package shipped as files. Every `reason`
// cites what was READ to establish the licence — a licence file in the installed
// `next` package, or a URL to the source that says where the code comes from (a
// test holds each entry to that) — and the notices print the reason beside the
// full licence text. Resemblance is not evidence: a folder whose origin nobody
// has read stays out of here and fails `checkLicences` as unknown.
//
// `textFrom` names a sibling folder under the same `next/dist/compiled/` whose
// licence file is the text to print, for a folder Next built from another
// package and shipped with no licence file of its own. If that sibling is
// missing, `checkLicences` fails rather than printing an id with no text.
//
// Not listed, because nothing establishes their licence and none ships as
// measured on 2026-11-02: `@modelcontextprotocol/sdk`, `constants-browserify`,
// `cssnano-simple` and the packages named from the `babel-packages` bundle.
const META_MIT = "the MIT text, copyright Meta Platforms";

export const LICENCE_OVERRIDES = {
  busboy: { spdx: "MIT", reason: "next/dist/compiled/busboy/LICENSE is the MIT text, copyright Brian White" },
  "ignore-loader": { spdx: "MIT", reason: "next/dist/compiled/ignore-loader/LICENSE is the MIT text, copyright Cherry Ng" },
  "image-detector": {
    spdx: "MIT",
    textFrom: "image-size",
    reason:
      "Next's build script (https://github.com/vercel/next.js/blob/canary/packages/next/taskfile.js, task ncc_image_detector, read 2026-11-02) " +
      "compiles image-size/dist/detector.js into this folder; image-size is MIT, and next/dist/compiled/image-size/LICENSE is its MIT text, copyright Aditya Yadav",
  },
  "querystring-es3": { spdx: "MIT", reason: "next/dist/compiled/querystring-es3/LICENSE is the MIT text, copyright Irakli Gozalishvili" },
  react: { spdx: "MIT", reason: `next/dist/compiled/react/LICENSE is ${META_MIT}` },
  "react-dom": { spdx: "MIT", reason: `next/dist/compiled/react-dom/LICENSE is ${META_MIT}` },
  "react-server-dom-turbopack": { spdx: "MIT", reason: `next/dist/compiled/react-server-dom-turbopack/LICENSE is ${META_MIT}` },
  "react-server-dom-webpack": { spdx: "MIT", reason: `next/dist/compiled/react-server-dom-webpack/LICENSE is ${META_MIT}` },
  scheduler: { spdx: "MIT", reason: `next/dist/compiled/scheduler/LICENSE is ${META_MIT}` },
};
