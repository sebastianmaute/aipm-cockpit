// src/app/csv-codecs.ts
//
// CSV codec barrel. The implementation is split across four modules
// (one-way deps: core <- document-asset-codecs <- config <- decode):
//   - ./csv-codecs-core          leaf primitives, registries, field codecs, encoders
//   - ./document-asset-codecs    the documentAssets CSV codec (leaf; depends on core)
//   - ./csv-codecs-config        status/project/config-blob codecs + workspaceToCsv
//   - ./csv-codecs-decode        parseCsv splitter + entity decoders + csvToWorkspace
// Importers keep using "./csv-codecs" unchanged.
export * from "./csv-codecs-core";
export * from "./document-asset-codecs";
export * from "./csv-codecs-config";
export * from "./csv-codecs-decode";
