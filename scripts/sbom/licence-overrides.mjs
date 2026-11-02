// Reviewed licences for libraries vendored inside Next (`next/dist/compiled/*`)
// that declare none: Next's compile step strips the `license` field from these
// folders' package.json, or writes no package.json at all.
//
// ★★ Applied only to a vendored entry with no licence of its own, so it can never
// overrule a declaration or settle a package shipped as files. Every `reason`
// cites the file in the installed `next` package that was READ to establish the
// licence (a test holds each entry to that), and the notices print the reason
// beside that file's full text. Resemblance is not evidence: a folder whose
// origin nobody has read stays out of here and fails `checkLicences` as unknown.
//
// Not listed, because nothing in the local install establishes their licence:
//   - `image-detector` SHIPS (the image optimizer's detect-content-type.js
//     requires it). Its folder holds only `detector.js`: no package.json, no
//     licence file, no banner naming an upstream; Next's build script that
//     compiles it is not published in the npm package. A release fails on it
//     until its licence is established from evidence and added here.
//   - `@modelcontextprotocol/sdk`, `constants-browserify`, `cssnano-simple` and
//     the packages named from the `babel-packages` bundle: none ships as
//     measured on 2026-11-02.
const META_MIT = "the MIT text, copyright Meta Platforms";

export const LICENCE_OVERRIDES = {
  busboy: { spdx: "MIT", reason: "next/dist/compiled/busboy/LICENSE is the MIT text, copyright Brian White" },
  "ignore-loader": { spdx: "MIT", reason: "next/dist/compiled/ignore-loader/LICENSE is the MIT text, copyright Cherry Ng" },
  "querystring-es3": { spdx: "MIT", reason: "next/dist/compiled/querystring-es3/LICENSE is the MIT text, copyright Irakli Gozalishvili" },
  react: { spdx: "MIT", reason: `next/dist/compiled/react/LICENSE is ${META_MIT}` },
  "react-dom": { spdx: "MIT", reason: `next/dist/compiled/react-dom/LICENSE is ${META_MIT}` },
  "react-server-dom-turbopack": { spdx: "MIT", reason: `next/dist/compiled/react-server-dom-turbopack/LICENSE is ${META_MIT}` },
  "react-server-dom-webpack": { spdx: "MIT", reason: `next/dist/compiled/react-server-dom-webpack/LICENSE is ${META_MIT}` },
  scheduler: { spdx: "MIT", reason: `next/dist/compiled/scheduler/LICENSE is ${META_MIT}` },
};
