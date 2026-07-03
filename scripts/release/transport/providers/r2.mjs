/**
 * CLOUDFLARE R2 PROVIDER — destino S3-compatible (Cloudflare R2). Solo se activa SI existe
 * configuración (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`).
 * No añade dependencias: firma SigV4 con node:crypto y sube con `fetch` global.
 *
 * Si faltan secrets, `configured()` devuelve false y el selector elige otro provider → "todo
 * funciona aunque falten Secrets".
 */
import { createHash, createHmac } from "node:crypto";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** Firma SigV4 para un objeto S3 (service "s3", region "auto"). */
function signedHeaders({ method, host, path, payload, accessKey, secretKey, region = "auto", amzDate, dateStamp, contentType }) {
  const payloadHash = sha256hex(payload ?? "");
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedH = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedH, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  let k = hmac(`AWS4${secretKey}`, dateStamp);
  k = hmac(k, region); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
  const signature = createHmac("sha256", k).update(stringToSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedH}, Signature=${signature}`;
  return {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "content-type": contentType,
  };
}

const stamps = (date) => {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
};
const guessType = (key) =>
  key.endsWith(".json") ? "application/json"
    : key.endsWith(".md") ? "text/markdown"
      : key.endsWith(".exe") || key.endsWith(".msi") ? "application/octet-stream"
        : "application/octet-stream";

export function createR2Provider({ env = process.env, now = () => new Date() } = {}) {
  const account = env.R2_ACCOUNT_ID || null;
  const accessKey = env.R2_ACCESS_KEY_ID || null;
  const secretKey = env.R2_SECRET_ACCESS_KEY || null;
  const bucket = env.R2_BUCKET || null;
  const publicBase = env.R2_PUBLIC_BASE || (account && bucket ? `https://${account}.r2.cloudflarestorage.com/${bucket}` : null);
  const host = account ? `${account}.r2.cloudflarestorage.com` : null;

  const request = async (method, key, payload = null) => {
    const path = `/${bucket}/${key}`;
    const { amzDate, dateStamp } = stamps(now());
    const contentType = guessType(key);
    const headers = signedHeaders({ method, host, path, payload, accessKey, secretKey, amzDate, dateStamp, contentType });
    return fetch(`https://${host}${path}`, { method, headers, body: payload ?? undefined });
  };

  return {
    name: "r2",
    bucket,

    configured() {
      return !!(account && accessKey && secretKey && bucket && typeof fetch === "function");
    },

    async health() {
      if (!this.configured()) return { ok: false, detail: "r2: faltan credenciales/bucket" };
      try {
        const res = await request("HEAD", ".drl-health");
        // 200/404/403 implican que el endpoint responde (objeto inexistente es esperable).
        return { ok: res.status < 500, detail: `r2: endpoint responde (${res.status})` };
      } catch (e) {
        return { ok: false, detail: `r2: ${e.message}` };
      }
    },

    async put({ key, path = null, bytes = null }) {
      const { readFileSync } = await import("node:fs");
      const buf = bytes ?? readFileSync(path);
      const res = await request("PUT", key, buf);
      if (!res.ok) throw new Error(`r2 PUT ${key} → ${res.status}`);
      return { key, size: buf.length, sha256: sha256hex(buf), url: this.url(key) };
    },

    async getBytes(key) {
      const res = await request("GET", key);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },

    async list() {
      // Listado vía ListObjectsV2 omitido en esta fase (no necesario para publicar/verificar).
      return [];
    },

    async remove(key) {
      await request("DELETE", key);
    },

    async copy(fromKey, toKey) {
      const buf = await this.getBytes(fromKey);
      if (!buf) return false;
      await this.put({ key: toKey, bytes: buf });
      return true;
    },

    url(key) {
      return publicBase ? `${publicBase.replace(/\/$/, "")}/${key}` : `https://${host}/${bucket}/${key}`;
    },
  };
}

export default { createR2Provider };
