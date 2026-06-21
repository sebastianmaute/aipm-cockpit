// src/app/csv-codecs.ts
//
// CSV codec barrel. The implementation is split across three modules
// (one-way deps: core <- config <- decode):
//   - ./csv-codecs-core   leaf primitives, registries, field codecs, encoders
//   - ./csv-codecs-config status/project/config-blob codecs + workspaceToCsv
//   - ./csv-codecs-decode parseCsv splitter + entity decoders + csvToWorkspace
// Importers keep using "./csv-codecs" unchanged.
export * from "./csv-codecs-core";
export * from "./csv-codecs-config";
export * from "./csv-codecs-decode";
