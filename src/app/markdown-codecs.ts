// src/app/markdown-codecs.ts
//
// Markdown codec barrel. Implementation split across three modules (one-way
// dep columns <- core <- decode):
//   - ./markdown-columns       the *_MD_COLUMNS registries (leaf; also
//                              imported directly by markdown-codecs-core.ts
//                              and markdown-codecs-decode.ts)
//   - ./markdown-codecs-core   escape, encoders, config/project codecs,
//                              workspaceToMarkdown, shared row primitives
//   - ./markdown-codecs-decode splitMarkdownSections + entity decoders +
//                              markdownToWorkspace
// Importers keep using "./markdown-codecs" unchanged.
export * from "./markdown-columns";
export * from "./markdown-codecs-core";
export * from "./markdown-codecs-decode";
