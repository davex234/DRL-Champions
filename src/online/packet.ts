/**
 * PACKET MANAGER + SERIALIZER — sobres de red con integridad y compresión preparada (Fase 1/7).
 *
 * Cada paquete lleva protocolo, secuencia/ack (orden/dedupe), reloj y CHECKSUM (protección contra
 * paquetes inválidos, base para anti-cheat futuro). La compresión es un HOOK inyectable (identidad
 * por defecto; lista para gzip/delta binaria en fases futuras). Determinista, sin efectos.
 */
import type { Packet, PacketType } from "./types";
import { PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL } from "./protocol";

/** Compresor inyectable (preparado). Por defecto = identidad. */
export interface Compressor { compress(s: string): string; decompress(s: string): string }
export const identityCompressor: Compressor = { compress: (s) => s, decompress: (s) => s };

/** FNV-1a 32-bit sobre una cadena. Determinista. */
function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function digestBody(p: Omit<Packet, "checksum">): string {
  return `${p.protocol}|${p.type}|${p.seq}|${p.ack}|${p.ts}|${p.from}|${JSON.stringify(p.payload)}`;
}

export function checksumOf(p: Omit<Packet, "checksum">): number {
  return fnv1a(digestBody(p));
}

/** Construye un paquete firmado (checksum incluido). */
export function makePacket(from: string, type: PacketType, seq: number, ack: number, ts: number, payload: unknown): Packet {
  const body = { protocol: PROTOCOL_VERSION, type, seq, ack, ts, from, payload };
  return { ...body, checksum: checksumOf(body) };
}

/** Valida un paquete: protocolo aceptable + checksum íntegro. NUNCA confía en el cliente. */
export function verifyPacket(p: Packet): boolean {
  if (typeof p !== "object" || p === null) return false;
  if (typeof p.protocol !== "number" || p.protocol < MIN_COMPATIBLE_PROTOCOL || p.protocol > PROTOCOL_VERSION) return false;
  if (typeof p.checksum !== "number") return false;
  const { checksum, ...body } = p;
  return checksum === checksumOf(body);
}

/** Serializa a texto (con compresión inyectable). */
export function encodePacket(p: Packet, comp: Compressor = identityCompressor): string {
  return comp.compress(JSON.stringify(p));
}

/** Deserializa desde texto. Devuelve null si es inválido (protección). */
export function decodePacket(raw: string, comp: Compressor = identityCompressor): Packet | null {
  try {
    const p = JSON.parse(comp.decompress(raw)) as Packet;
    return verifyPacket(p) ? p : null;
  } catch {
    return null;
  }
}
