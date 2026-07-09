/**
 * FINGERPRINT (Fase 5) — SHA-256 del CardSpec CANÓNICO (claves ordenadas recursivamente para
 * que la huella no dependa del orden de serialización). REUTILIZA `sha256Hex` de platform
 * (Web Crypto) — no se duplica hashing. Sirve para detección de cambios, cache y rebuild
 * incremental. Determinista.
 */
import { sha256Hex } from "@/platform/verify";
import type { CardSpec } from "@/card-generator";
import type { Digest, MaterializationFingerprint } from "./types";

export const defaultDigest: Digest = (bytes) => sha256Hex(bytes);

/** JSON canónico: claves de objeto ordenadas en todos los niveles (arrays conservan orden). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function fingerprintSpec(spec: CardSpec, digest: Digest = defaultDigest): Promise<MaterializationFingerprint> {
  return digest(new TextEncoder().encode(canonicalJson(spec)));
}
