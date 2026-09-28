import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as secrets from "./secrets";
import { sealDevice, sealPassphrase, SECRET_IDS } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked, migratePlaintextSecrets, probeDeviceSecretReadable, SECRETS_KEY, beginSealedWrite, invalidateAllSealedWrites, snapshotSealedWrite } from "./secrets-store";
import { logDiag } from "./diagnostics";

vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("secrets-store", () => {
  it("saves, reads back a device secret, and reports not passphrase-locked", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("device");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
    expect(isPassphraseLocked("anthropicApiKey")).toBe(false);
  });

  it("returns null for a passphrase secret on device read, and flags it locked", async () => {
    saveSealed(await sealPassphrase("tursoAuthToken", "tok-1", "pw"));
    expect(await readDeviceSecret("tursoAuthToken")).toBeNull();
    expect(isPassphraseLocked("tursoAuthToken")).toBe(true);
  });

  it("removeSealed deletes the entry", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    removeSealed("anthropicApiKey");
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("migrates plaintext apiKey + authToken + jiraApiToken + timelogApiToken + sttApiKey to device-sealed secrets, blanks input", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    expect(blanked).toEqual({ apiKey: "", authToken: "", jiraApiToken: "", timelogApiToken: "", sttApiKey: "" });
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-x");
    expect(await readDeviceSecret("tursoAuthToken")).toBe("tok-y");
    expect(await readDeviceSecret("jiraApiToken")).toBe("jira-z");
    expect(await readDeviceSecret("timelogApiToken")).toBe("timelog-z");
    expect(await readDeviceSecret("sttApiKey")).toBe("stt-z");
  });

  it("is a no-op when inputs are already blank", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "", authToken: undefined });
    expect(blanked).toEqual({ apiKey: "", authToken: "", jiraApiToken: "", timelogApiToken: "", sttApiKey: "" });
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(loadSealed("jiraApiToken")).toBeNull();
    expect(loadSealed("timelogApiToken")).toBeNull();
    expect(loadSealed("sttApiKey")).toBeNull();
  });

  it("migratePlaintextSecrets does not clobber an already-sealed (passphrase) secret", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-orig", "pw"));
    await migratePlaintextSecrets({ apiKey: "sk-new-plaintext" });
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("passphrase"); // untouched
  });

  it("does not reject when sealing fails (no IndexedDB/WebCrypto) and keeps the plaintext un-migrated", async () => {
    // Simulate a degraded env: sealDevice rejects (e.g. indexedDB.open / crypto.subtle absent).
    vi.spyOn(secrets, "sealDevice").mockRejectedValue(new Error("no IndexedDB"));
    const result = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    // Failed seals return the ORIGINAL plaintext so the caller keeps it for the session.
    expect(result).toEqual({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    // Nothing was persisted to the secret store.
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(loadSealed("tursoAuthToken")).toBeNull();
  });

  it("ignores a corrupt/garbage secrets record in localStorage", async () => {
    localStorage.setItem("aipm-cockpit:secrets", JSON.stringify({ anthropicApiKey: { junk: true } }));
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("readDeviceSecret logs (never the value) and returns null when a sealed secret can't be decrypted", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    vi.spyOn(secrets, "openDevice").mockRejectedValue(new Error("bad key"));
    expect(await readDeviceSecret("anthropicApiKey")).toBeNull();
    expect(logDiag).toHaveBeenCalledWith("warn", "secrets.decryptFailed", expect.objectContaining({ id: "anthropicApiKey" }));
    // The plaintext value must never appear in the diagnostic fields.
    const fields = vi.mocked(logDiag).mock.calls.at(-1)?.[2] ?? {};
    expect(JSON.stringify(fields)).not.toContain("sk-1");
  });

  it("probeDeviceSecretReadable distinguishes empty / ok / unreadable", async () => {
    expect(await probeDeviceSecretReadable("anthropicApiKey")).toBe("empty");
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    expect(await probeDeviceSecretReadable("anthropicApiKey")).toBe("ok");
    vi.spyOn(secrets, "openDevice").mockRejectedValue(new Error("bad key"));
    expect(await probeDeviceSecretReadable("anthropicApiKey")).toBe("unreadable");
  });

  it("probeDeviceSecretReadable reports a passphrase-wrapped secret as empty (device read n/a)", async () => {
    saveSealed(await sealPassphrase("tursoAuthToken", "tok-1", "pw"));
    expect(await probeDeviceSecretReadable("tursoAuthToken")).toBe("empty");
  });

  // §567 — ONE seal → store → read round-trip per id, generated from
  // `SECRET_IDS`, so an id added to the list is covered without being named.
  // A missed id in either derivation fails its own row here.
  it.each(SECRET_IDS)("seals, stores and reads back %s", async (id) => {
    saveSealed(await sealDevice(id, `value-for-${id}`));
    expect(loadSealed(id)?.id).toBe(id);
    expect(await readDeviceSecret(id)).toBe(`value-for-${id}`);
  });

  it("reads back every SECRET_IDS entry when all are stored together", async () => {
    for (const id of SECRET_IDS) saveSealed(await sealDevice(id, id));
    // Control: all of them really are on disk, so a null below is a READ drop.
    const onDisk = JSON.parse(localStorage.getItem(SECRETS_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual([...SECRET_IDS].sort());
    for (const id of SECRET_IDS) expect(loadSealed(id), id).not.toBeNull();
  });
});

// §609 — a seal awaits WebCrypto before it writes; a clear or a newer seal that starts in the
// meantime must win, so the late commit writes nothing and reports `false`.
describe("beginSealedWrite (§609)", () => {
  it("commits a lone write and reports true", async () => {
    const commit = beginSealedWrite("anthropicApiKey");
    expect(commit(await sealDevice("anthropicApiKey", "sk-1"))).toBe(true);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
  });

  it("a removeSealed after the write began cancels it", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-1");
    const commit = beginSealedWrite("anthropicApiKey");
    removeSealed("anthropicApiKey");
    expect(commit(sealed)).toBe(false);
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("a newer write for the same id supersedes the older one, whichever commits first", async () => {
    const sealedA = await sealDevice("anthropicApiKey", "sk-A");
    const sealedB = await sealDevice("anthropicApiKey", "sk-B");
    const commitA = beginSealedWrite("anthropicApiKey");
    const commitB = beginSealedWrite("anthropicApiKey");
    expect(commitB(sealedB)).toBe(true);
    expect(commitA(sealedA)).toBe(false);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-B");
  });

  it("different ids never cancel each other", async () => {
    const sealedKey = await sealDevice("anthropicApiKey", "sk-1");
    const sealedStt = await sealDevice("sttApiKey", "stt-1");
    const commitKey = beginSealedWrite("anthropicApiKey");
    const commitStt = beginSealedWrite("sttApiKey");
    removeSealed("anthropicApiKey");
    expect(commitKey(sealedKey)).toBe(false);
    expect(commitStt(sealedStt)).toBe(true);
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(await readDeviceSecret("sttApiKey")).toBe("stt-1");
  });

  it("invalidateAllSealedWrites cancels every write in flight", async () => {
    const commits = SECRET_IDS.map((id) => [id, beginSealedWrite(id)] as const);
    invalidateAllSealedWrites();
    for (const [id, commit] of commits) expect(commit(await sealDevice(id, id)), id).toBe(false);
    expect(localStorage.getItem(SECRETS_KEY)).toBeNull();
  });

  it("snapshotSealedWrite commits when nothing began since, and never cancels a write in flight", async () => {
    const sealedUser = await sealDevice("anthropicApiKey", "sk-user");
    const snapshot = snapshotSealedWrite("anthropicApiKey");
    expect(snapshot(await sealDevice("anthropicApiKey", "sk-bg"))).toBe(true);
    const commitUser = beginSealedWrite("anthropicApiKey");
    snapshotSealedWrite("anthropicApiKey"); // taken after the user's begin: bumps nothing
    expect(commitUser(sealedUser)).toBe(true);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-user");
  });
});

// §609 I1 — the boot migration's seal can land after the §548 merge timeout has handed the UI
// over; a user clear or a new value committed in that window must win over the legacy value.
describe("migratePlaintextSecrets vs user writes in flight (§609)", () => {
  function heldSeal() {
    let release: (s: secrets.SealedSecret) => void = () => {};
    const promise = new Promise<secrets.SealedSecret>((r) => {
      release = r;
    });
    return { promise, release };
  }

  it("a clear during the migration's seal wins: nothing is written", async () => {
    const legacy = await sealDevice("anthropicApiKey", "sk-legacy");
    const seal = heldSeal();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const migrating = migratePlaintextSecrets({ apiKey: "sk-legacy" });
    removeSealed("anthropicApiKey");
    seal.release(legacy);

    expect((await migrating).apiKey).toBe("");
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("a user save that begins during the migration's seal wins, whichever lands first", async () => {
    const legacy = await sealDevice("anthropicApiKey", "sk-legacy");
    const sealedUser = await sealDevice("anthropicApiKey", "sk-user");
    const seal = heldSeal();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const migrating = migratePlaintextSecrets({ apiKey: "sk-legacy" });
    const commitUser = beginSealedWrite("anthropicApiKey");
    seal.release(legacy);
    await migrating;
    expect(loadSealed("anthropicApiKey")).toBeNull(); // the migration's write was dropped
    expect(commitUser(sealedUser)).toBe(true);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-user");
  });

  it("a user save that began BEFORE the migration and lands during its seal is not overwritten", async () => {
    const legacy = await sealDevice("anthropicApiKey", "sk-legacy");
    const sealedUser = await sealDevice("anthropicApiKey", "sk-user");
    const seal = heldSeal();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const commitUser = beginSealedWrite("anthropicApiKey");
    const migrating = migratePlaintextSecrets({ apiKey: "sk-legacy" });
    expect(commitUser(sealedUser)).toBe(true);
    seal.release(legacy);
    await migrating;

    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-user");
  });

  it("with no user action, a held migration seal still writes when it lands", async () => {
    const legacy = await sealDevice("anthropicApiKey", "sk-legacy");
    const seal = heldSeal();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const migrating = migratePlaintextSecrets({ apiKey: "sk-legacy" });
    seal.release(legacy);

    expect((await migrating).apiKey).toBe("");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-legacy");
  });

  // Round 2 I1: every snapshot is taken before the FIRST await. A clear of a LATER id while an
  // earlier id is still sealing used to precede that id's own (late) snapshot, so its legacy
  // value was written back.
  it("a clear of a later id while an earlier id is still sealing wins too", async () => {
    const legacy = await sealDevice("anthropicApiKey", "sk-legacy");
    const seal = heldSeal();
    // Only the first seal (anthropicApiKey) is held; jira's runs for real afterwards.
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const migrating = migratePlaintextSecrets({ apiKey: "sk-legacy", jiraApiToken: "jira-legacy" });
    removeSealed("jiraApiToken"); // the user blanks the Jira token in the §548 window
    seal.release(legacy);
    const result = await migrating;

    expect(secrets.sealDevice).toHaveBeenCalledWith("jiraApiToken", "jira-legacy"); // it did seal
    expect(loadSealed("jiraApiToken")).toBeNull(); // …but never wrote
    expect(result.jiraApiToken).toBe("");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-legacy"); // control: untouched id
  });
});
