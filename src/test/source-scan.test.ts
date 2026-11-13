import { describe, expect, it } from "vitest";
import { callsNodeHttp, stripComments } from "./source-scan";

describe("stripComments", () => {
  it("drops a line comment and a block comment", () => {
    expect(stripComments("a(); // fetch(x)\nb(); /* fetch(y) */ c();")).toBe("a(); \nb();  c();");
  });

  it("keeps the line break a line comment ends on, and the ones inside a block comment", () => {
    expect(stripComments("a /* one\ntwo */ b // c\nd")).toBe("a \n b \nd");
  });

  it("keeps a URL in a string, and the code after it on the same line", () => {
    const src = 'const u = "https://x"; fetch(u);';
    expect(stripComments(src)).toBe(src);
  });

  it("keeps a /* … */ inside a string, and the code after it", () => {
    const src = 'const g = "/*glob*/"; fetch(g); const h = "*/";';
    expect(stripComments(src)).toBe(src);
  });

  it("keeps an opening /* in a single-quoted string from swallowing the next lines", () => {
    const src = "const g = '/*'; fetch(a);\nconst h = 1; /* real */";
    expect(stripComments(src)).toBe("const g = '/*'; fetch(a);\nconst h = 1; ");
  });

  it("keeps a template literal, its interpolations and a string nested in one", () => {
    const src = "const t = `//${x ? \"//\" : `/*${y}*/`} done`; fetch(t); // gone";
    expect(stripComments(src)).toBe("const t = `//${x ? \"//\" : `/*${y}*/`} done`; fetch(t); ");
  });

  it("drops a comment inside an interpolation", () => {
    expect(stripComments("`a${b /* c */}d`")).toBe("`a${b }d`");
  });

  it("keeps an escaped quote from ending the string", () => {
    const src = 'const s = "a\\"// still string"; fetch(s);';
    expect(stripComments(src)).toBe(src);
  });

  it("keeps a regex literal that holds // or /*", () => {
    const src = "const r = /https?:\\/\\/x/; const q = /[/*]/g; fetch(r);";
    expect(stripComments(src)).toBe(src);
  });

  it("still reads a division as a division", () => {
    expect(stripComments("const a = b / c; // gone\nd();")).toBe("const a = b / c; \nd();");
  });
});

describe("callsNodeHttp", () => {
  it.each([
    ['import https from "node:https";\nhttps.get(u);'],
    ['import * as http from "node:http";\nhttp.request(u);'],
    ['import http from "http";\nhttp.get(u);'],
    ['import { request } from "node:https";\nrequest(u);'],
    ['import { get } from "node:http";\nget(u);'],
    ['import { request as send } from "https";\nsend(u);'],
    ['import { get as httpGet, request } from "node:http";\nhttpGet(u);'],
    ["https.get(u);"],
    ["http.request(u);"],
    ['import client, { request } from "node:https";\nrequest(u);'],
    ['import client, { get } from "node:https";\nclient.request(u);'],
    ['import client, * as other from "node:http";\nother.get(u);'],
    ['const { request } = require("node:https");\nrequest(u);'],
    ['const { get: fetchIt, request } = require("https");\nfetchIt(u);'],
    ['const client = require("node:http");\nclient.get(u);'],
    ['const { request } = await import("node:https");\nrequest(u);'],
    ['const mod = await import("node:https");\nmod.request(u);'],
    ['import("node:https").then((m) => m.get(u));'],
  ])("finds a node:http(s) call: %s", (src) => {
    expect(callsNodeHttp(src)).toBe(true);
  });

  it.each([
    ['import type { RequestOptions } from "node:http";\nconst o: RequestOptions = {};'],
    ['import { request } from "./local";\nrequest(u);'],
    ["const request = (u: string) => u;\nrequest(u);"],
    ['import { request } from "node:https";\nconst f = request;'],
    ['const { STATUS_CODES } = require("node:http");\nlog(STATUS_CODES);'],
    ['const { request } = require("./local");\nrequest(u);'],
    ['import client, { STATUS_CODES } from "./local";\nclient.get(u);'],
  ])("ignores what is not a node:http(s) call: %s", (src) => {
    expect(callsNodeHttp(src)).toBe(false);
  });
});
