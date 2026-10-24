/**
 * Zaisma's backups bucket at Backblaze B2, through its S3 API (docs/DECISIONS.md, "A copy outside
 * Cloudflare that nobody can delete"). The key can only list and write: every upload is a new version the
 * bucket's Object Lock keeps for 28 days, and its lifecycle rule hides and deletes it after. Requests are
 * signed with AWS Signature Version 4 here, in WebCrypto, rather than with a library. Object Lock buckets
 * refuse an upload without Content-MD5, so each request's bytes are held whole to hash them: an object up
 * to BACKUP_STORAGE_LIMITS.partSizeBytes goes in one request, a bigger one in parts of that size.
 */

export const BACKUP_STORAGE_LIMITS = {
  /** The most one request carries, held in memory to hash it; an object past it goes as a multipart upload. */
  partSizeBytes: 32 * 1024 * 1024,
  /** Tries per request when Backblaze answers 5xx or 429, or the connection breaks. */
  requestTryCount: 3,
} as const;

/** Where the bucket is and the key that writes to it (wrangler.jsonc: BACKUP_* settings and secrets). */
export interface BackupStorageSettings {
  endpointUrl: string;
  regionName: string;
  bucketName: string;
  keyId: string;
  keySecret: string;
}

/** One version of an object in the bucket, as ListObjectVersions answers it. */
export interface BackupObjectVersion {
  key: string;
  versionId: string;
  lastModifiedAtMs: number;
}

/** How a storage waits before trying a request again: the real wait, unless a test gives one that doesn't. */
export type BackupWait = (durationMs: number) => Promise<void>;
const waitFor: BackupWait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

export class BackupStorageError extends Error {}

const EMPTY_SHA256_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export class BackupStorage {
  constructor(
    private readonly settings: BackupStorageSettings,
    private readonly wait: BackupWait = waitFor,
  ) {}

  /**
   * Writes the source's bytes as the object's newest version: in one request when they fit in a part,
   * else as a multipart upload. Answers the size written. An upload that fails part way is left for the
   * bucket's lifecycle rule to cancel (the key can't).
   */
  async uploadObject(key: string, source: AsyncIterable<Uint8Array>): Promise<number> {
    let held: Uint8Array[] = [];
    let heldSizeBytes = 0;
    let uploadId: string | null = null;
    const partEtags: string[] = [];
    let sizeBytes = 0;
    const sendPart = async () => {
      const bytes = joinBytes(held, heldSizeBytes);
      held = [];
      heldSizeBytes = 0;
      uploadId ??= await this.startMultipartUpload(key);
      const response = await this.send("PUT", key, { partNumber: String(partEtags.length + 1), uploadId }, bytes);
      const etag = response.headers.get("etag");
      if (!etag) throw new BackupStorageError(`Backblaze answered part ${partEtags.length + 1} of ${key} without an ETag.`);
      partEtags.push(etag);
    };
    for await (const chunk of source) {
      if (!chunk.byteLength) continue;
      held.push(chunk);
      heldSizeBytes += chunk.byteLength;
      sizeBytes += chunk.byteLength;
      if (heldSizeBytes >= BACKUP_STORAGE_LIMITS.partSizeBytes) await sendPart();
    }
    if (uploadId === null) {
      await this.send("PUT", key, {}, joinBytes(held, heldSizeBytes));
      return sizeBytes;
    }
    if (heldSizeBytes) await sendPart();
    const parts = partEtags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${escapeXml(etag)}</ETag></Part>`).join("");
    const response = await this.send("POST", key, { uploadId }, new TextEncoder().encode(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`));
    // S3 can answer 200 with an error in the body once the parts are joined.
    const answerText = await response.text();
    if (answerText.includes("<Error>")) throw new BackupStorageError(`Backblaze didn't join the parts of ${key}: ${xmlValue(answerText, "Message") ?? answerText.slice(0, 200)}`);
    return sizeBytes;
  }

  /** Every version of the objects whose key starts with prefix, oldest page first, up to versionLimitCount. */
  async listObjectVersions(prefix: string, versionLimitCount = 1000): Promise<BackupObjectVersion[]> {
    const response = await this.send("GET", "", { versions: "", prefix, "max-keys": String(versionLimitCount) }, null);
    const answerText = await response.text();
    return [...answerText.matchAll(/<Version>([\s\S]*?)<\/Version>/g)].map((match) => ({
      key: xmlValue(match[1]!, "Key") ?? "",
      versionId: xmlValue(match[1]!, "VersionId") ?? "",
      lastModifiedAtMs: Date.parse(xmlValue(match[1]!, "LastModified") ?? ""),
    }));
  }

  private async startMultipartUpload(key: string): Promise<string> {
    const response = await this.send("POST", key, { uploads: "" }, new Uint8Array());
    const uploadId = xmlValue(await response.text(), "UploadId");
    if (!uploadId) throw new BackupStorageError(`Backblaze didn't start a multipart upload of ${key}.`);
    return uploadId;
  }

  /** One signed request, tried again on 5xx, 429 or a broken connection; any other refusal throws with Backblaze's message. */
  private async send(method: "GET" | "PUT" | "POST", key: string, query: Record<string, string>, body: Uint8Array | null): Promise<Response> {
    let lastFailure = "";
    for (let tryNumber = 1; tryNumber <= BACKUP_STORAGE_LIMITS.requestTryCount; tryNumber++) {
      if (tryNumber > 1) await this.wait(500 * 2 ** tryNumber);
      let response: Response;
      try {
        response = await fetch(await this.signedRequest(method, key, query, body));
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        continue;
      }
      if (response.ok) return response;
      const answerText = await response.text();
      lastFailure = `${response.status} ${xmlValue(answerText, "Code") ?? ""} ${xmlValue(answerText, "Message") ?? answerText.slice(0, 200)}`.trim();
      if (response.status < 500 && response.status !== 429) break;
    }
    throw new BackupStorageError(`Backblaze refused ${method} ${key || "the bucket"}: ${lastFailure}`);
  }

  private async signedRequest(method: string, key: string, query: Record<string, string>, body: Uint8Array | null): Promise<Request> {
    const { endpointUrl, regionName, bucketName, keyId, keySecret } = this.settings;
    const url = new URL(endpointUrl);
    const canonicalPath = `/${encodeSegment(bucketName)}${key ? `/${key.split("/").map(encodeSegment).join("/")}` : "/"}`;
    const canonicalQuery = Object.entries(query)
      .map(([name, queryValue]) => [encodeSegment(name), encodeSegment(queryValue)] as const)
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([name, queryValue]) => `${name}=${queryValue}`)
      .join("&");
    const nowIso = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateText = nowIso.slice(0, 8);
    const payloadSha256Hex = body ? hex(await crypto.subtle.digest("SHA-256", body)) : EMPTY_SHA256_HEX;
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadSha256Hex, "x-amz-date": nowIso };
    if (body) headers["content-md5"] = base64(await crypto.subtle.digest("MD5", body));
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalRequest = [method, canonicalPath, canonicalQuery, ...signedHeaderNames.map((name) => `${name}:${headers[name]}`), "", signedHeaderNames.join(";"), payloadSha256Hex].join("\n");
    const scope = `${dateText}/${regionName}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", nowIso, scope, hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRequest)))].join("\n");
    let signingKey: ArrayBuffer = new TextEncoder().encode(`AWS4${keySecret}`).buffer as ArrayBuffer;
    for (const part of [dateText, regionName, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
    const signature = hex(await hmac(signingKey, stringToSign));
    const sentHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
    return new Request(`${url.origin}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
      method,
      headers: { ...sentHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}` },
      body: body && method !== "GET" ? body : undefined,
    });
  }
}

/** S3's own encoding of a path segment or query part: everything but letters, digits and -._~ as %XX. */
function encodeSegment(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmac(key: ArrayBuffer, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(text));
}

function joinBytes(chunks: Uint8Array[], sizeBytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const joined = new Uint8Array(sizeBytes);
  let offsetBytes = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offsetBytes);
    offsetBytes += chunk.byteLength;
  }
  return joined;
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlValue = (xml: string, tagName: string) => new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`).exec(xml)?.[1]?.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") ?? null;
