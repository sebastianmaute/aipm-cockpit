// src/app/markdown-codecs.ts
//
// Markdown codec barrel. Implementation split across two modules (one-way dep
// core <- decode):
//   - ./markdown-codecs-core   columns, escape, encoders, config/project codecs,
//                              workspaceToMarkdown, shared row primitives
//   - ./markdown-codecs-decode splitMarkdownSections + entity decoders +
//                              markdownToWorkspace
// Importers keep using "./markdown-codecs" unchanged.
export * from "./markdown-codecs-core";
export * from "./markdown-codecs-decode";
