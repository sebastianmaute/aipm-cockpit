#!/usr/bin/env node
// scripts/chat-erasure.mjs — the operator's command line for saved AI chats in Turso:
// keygen, search, delete, expire. All logic is in chat-erasure-lib.mjs; this file only
// wires the real network, files, clock, prompt and console. Run `npm run chats:erase`
// with no arguments for usage.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { runCli, writePrivateKeyFile } from "./chat-erasure-lib.mjs";

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  fetchImpl: (url, init) => fetch(url, init),
  readTextFile: (path) => readFileSync(path, "utf8"),
  writePrivateKey: writePrivateKeyFile,
  isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  confirm,
  now: () => new Date(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
process.exitCode = code;
