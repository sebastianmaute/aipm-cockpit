// Reviewed licences for libraries vendored inside Next (`next/dist/compiled/*`)
// that declare none: Next's compile step strips the `license` field from these
// folders' package.json, or writes no package.json at all.
//
// ★★ Applied only to a vendored entry with no licence of its own, so it can never
// overrule a declaration or settle a package shipped as files. An entry needs
// evidence somebody read, written in `reason`, which the notices print. A folder
// without any stays out of here and fails `checkLicences` as unknown: that is the
// reminder to go and look, the day it starts to ship.
//
// Not listed, because nothing local establishes their licence and none ships as
// measured on 2026-11-02: `@modelcontextprotocol/sdk`, `constants-browserify`,
// `cssnano-simple` and the packages named from the `babel-packages` bundle.
const META_MIT = "the LICENSE in Next's folder is the MIT text, copyright Meta Platforms";

export const LICENCE_OVERRIDES = {
  busboy: { spdx: "MIT", reason: "the LICENSE in Next's folder is the MIT text, copyright Brian White" },
  "ignore-loader": { spdx: "MIT", reason: "the LICENSE in Next's folder is the MIT text, copyright Cherry Ng" },
  "image-detector": {
    spdx: "MIT",
    reason: "Next's image detector is cut from image-size: 73% of the code in its folder is verbatim in Next's image-size, which declares MIT and carries the MIT text",
  },
  "querystring-es3": { spdx: "MIT", reason: "the LICENSE in Next's folder is the MIT text, copyright Irakli Gozalishvili" },
  react: { spdx: "MIT", reason: `${META_MIT}; the react package itself declares MIT` },
  "react-dom": { spdx: "MIT", reason: `${META_MIT}; the react-dom package itself declares MIT` },
  "react-server-dom-turbopack": { spdx: "MIT", reason: META_MIT },
  "react-server-dom-webpack": { spdx: "MIT", reason: META_MIT },
  scheduler: { spdx: "MIT", reason: `${META_MIT}; the scheduler package itself declares MIT` },
};
