// src/test/unzip-bytes.ts — TEST-ONLY. Read a STORE-only ZIP Blob back as raw
// bytes per part.
//
// ★★ `export-ooxml.test.ts` has a sibling helper that decodes every part with
// TextDecoder. That is right for XML and USELESS for an image: invalid UTF-8
// becomes U+FFFD, so a byte-comparison against the original would fail for
// correct output and pass for some wrong output. Media assertions use THIS one.

/**
 * jsdom's Blob shim omits `.arrayBuffer()`, and Node's Blob cannot wrap a jsdom
 * Blob as a BlobPart (it serialises to "[object Blob]"). FileReader is the one
 * path both shims implement — same reasoning as `export-ooxml.test.ts`.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const LOCAL_FILE_HEADER = 0x04034b50;

export async function unzipBytes(blob: Blob): Promise<Map<string, Uint8Array>> {
  const buf = await blobToArrayBuffer(blob);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();

  let offset = 0;
  while (offset + 30 < buf.byteLength) {
    if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) break;
    const fnLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const name = dec.decode(bytes.slice(nameStart, nameStart + fnLen));
    const dataStart = nameStart + fnLen + extraLen;
    files.set(name, bytes.slice(dataStart, dataStart + compSize));
    offset = dataStart + compSize;
  }
  return files;
}

/** Decode one part as UTF-8 — for asserting on XML alongside binary parts. */
export function partText(parts: Map<string, Uint8Array>, path: string): string {
  const part = parts.get(path);
  if (!part) throw new Error(`no such part: ${path} (have: ${[...parts.keys()].join(", ")})`);
  return new TextDecoder().decode(part);
}
