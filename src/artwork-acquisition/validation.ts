/**
 * VALIDATION — un candidato descargado SOLO se registra si cumple TODO: formato real
 * (huella mágica + decodificable), resolución mínima, aspect ratio, transparencia cuando
 * la categoría la exige, peso máximo e integridad. Si no cumple: RECHAZADO (jamás se
 * registra un asset inválido).
 */
import sharp from "sharp";
import type { ArtworkCategory } from "@/artwork";
import type { CandidateValidation, CategoryRequirements, ValidationIssue } from "./types";

/** Requisitos por categoría (tamaños estándar = convenciones del Artwork Manager). */
export const REQUIREMENTS: Partial<Record<ArtworkCategory, CategoryRequirements>> = {
  player: { minSize: 256, aspect: 1, aspectTolerance: 0.34, requiresAlpha: true, maxBytes: 8_000_000, normalizedWidth: 512 },
  team: { minSize: 128, aspect: 1, aspectTolerance: 0.25, requiresAlpha: true, maxBytes: 4_000_000, normalizedWidth: 256 },
  "tournament-logo": { minSize: 128, aspect: 1, aspectTolerance: 0.5, requiresAlpha: false, maxBytes: 4_000_000, normalizedWidth: 256 },
  country: { minSize: 40, aspect: 4 / 3, aspectTolerance: 0.4, requiresAlpha: false, maxBytes: 1_000_000, normalizedWidth: 80 },
  role: { minSize: 48, aspect: 1, aspectTolerance: 0.2, requiresAlpha: true, maxBytes: 1_000_000, normalizedWidth: 128 },
  region: { minSize: 48, aspect: 1, aspectTolerance: 0.2, requiresAlpha: true, maxBytes: 1_000_000, normalizedWidth: 128 },
  agent: { minSize: 64, aspect: 1, aspectTolerance: 0.3, requiresAlpha: false, maxBytes: 2_000_000, normalizedWidth: 128 },
  map: { minSize: 128, aspect: 16 / 9, aspectTolerance: 0.6, requiresAlpha: false, maxBytes: 4_000_000, normalizedWidth: 512 },
  badge: { minSize: 48, aspect: 1, aspectTolerance: 0.2, requiresAlpha: true, maxBytes: 1_000_000, normalizedWidth: 128 },
  collection: { minSize: 48, aspect: 1, aspectTolerance: 0.3, requiresAlpha: false, maxBytes: 1_000_000, normalizedWidth: 128 },
};

/** Huella mágica del contenido (formato REAL, no la extensión que diga el proveedor). */
export function sniffFormat(bytes: Uint8Array): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  const head = Buffer.from(bytes.slice(0, 256)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return "unknown";
}

const ACCEPTED = new Set(["png", "jpg", "webp", "svg"]);

export async function validateCandidate(bytes: Uint8Array, category: ArtworkCategory): Promise<CandidateValidation> {
  const issues: ValidationIssue[] = [];
  const req = REQUIREMENTS[category];
  const format = sniffFormat(bytes);
  const bad = (code: ValidationIssue["code"], message: string): void => { issues.push({ code, message }); };

  if (!ACCEPTED.has(format)) bad("BAD_FORMAT", `formato no aceptado: ${format}`);
  if (req && bytes.length > req.maxBytes) bad("TOO_HEAVY", `${bytes.length} bytes > ${req.maxBytes}`);

  let width = 0, height = 0, hasAlpha = false;
  if (ACCEPTED.has(format)) {
    try {
      const meta = await sharp(Buffer.from(bytes)).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      hasAlpha = meta.hasAlpha ?? false;
      // Integridad REAL: se decodifica hasta el último píxel (no solo la cabecera).
      await sharp(Buffer.from(bytes)).raw().toBuffer();
    } catch (e) {
      bad("CORRUPT", `no decodifica: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (req && width > 0 && height > 0) {
    if (Math.min(width, height) < req.minSize) bad("TOO_SMALL", `${width}x${height} < mínimo ${req.minSize}`);
    const aspect = width / height;
    if (Math.abs(aspect - req.aspect) > req.aspectTolerance) bad("BAD_ASPECT", `aspecto ${aspect.toFixed(2)} fuera de ${req.aspect.toFixed(2)}±${req.aspectTolerance}`);
    if (req.requiresAlpha && !hasAlpha && format !== "svg") bad("NO_ALPHA", "la categoría exige fondo transparente");
  }

  return { ok: issues.length === 0, issues, width, height, format, hasAlpha };
}
