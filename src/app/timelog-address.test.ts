import { describe, it, expect } from "vitest";
import { parseTimelogAddress } from "./timelog-address";

describe("parseTimelogAddress", () => {
  it.each([
    ["https://app.timelog.com/acme/registration/week", { host: "app.timelog.com", tenant: "acme" }],
    ["https://APP2.timelog.com/acme", { host: "app2.timelog.com", tenant: "acme" }],
    ["https://app.timelog.com/acme/#/registration", { host: "app.timelog.com", tenant: "acme" }],
    ["  https://app.timelog.com/acme/?x=1\n", { host: "app.timelog.com", tenant: "acme" }],
    ["https://timelog.com/acme", { host: "timelog.com", tenant: "acme" }],
    ["https://app.timelog.com//acme", { host: "app.timelog.com", tenant: "acme" }],
    ["https://app.timelog.com/ac%20me/x", { host: "app.timelog.com", tenant: "ac me" }],
  ])("parses %s", (raw, want) => {
    expect(parseTimelogAddress(raw)).toEqual(want);
  });

  it.each([
    "http://app.timelog.com/acme",
    "https://app.timelog.com/",
    "https://app.timelog.com",
    "https://app.timelog.com/#/acme",
    "https://eviltimelog.com/acme",
    "https://app.timelog.com.attacker.com/acme",
    "https://evil.com@app.timelog.com/acme",
    "https://app.timelog.com:8080/acme",
    "https://app.timelog.com:443/acme",
    // Adversarial authorities (B2/B3): each must be rejected, none may reach the stored host.
    "https://app.timelog.com\@evil.com/acme",
    "https://app.timelog.com./acme",
    "https://app%40evil.com.timelog.com/acme",
    "https://app%2etimelog.com/acme",
    "https://app.timelog.com%2e/acme",
    "https://app.timelog。com/acme",
    "https://.timelog.com/acme",
    "https://app..timelog.com/acme",
    // A tenant that decodes to a control character is not a tenant.
    "https://app.timelog.com/ac%00me",
    "https://app.timelog.com/ac%0Ame",
    "https://app.timelog.com/%09acme",
    "https://app.timelog.com/acme%7F",
    "https://app.timelog.com/%E0%A4%A",
    "acme",
    "",
    "   ",
  ])("rejects %j", (raw) => {
    expect(parseTimelogAddress(raw)).toBeNull();
  });
});
