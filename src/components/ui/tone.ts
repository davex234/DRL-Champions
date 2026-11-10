/**
 * TONO SEMÁNTICO — el vocabulario de color de las primitivas de estado.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * Las superficies ya tenían su tinte (`Surface.tsx`), pero las piezas que dicen ESTADO —una
 * insignia, un punto de presencia, una barra de progreso— no tenían ninguno, así que cada una
 * escribía sus hexadecimales: el launcher llegó a llevar 48 literales `#rrggbb` repartidos por
 * sus componentes, con tres verdes distintos para la misma idea de «correcto».
 *
 * Siete tonos y ninguno más. Ninguno inventa color: los cinco semánticos salen de `SEMANTIC`,
 * los dos de marca de `ACCENT` y el apagado de `TEXT`. Si hace falta un tono nuevo, se añade
 * en `tokens.ts` primero.
 */
import { ACCENT, SEMANTIC, TEXT } from "@/design/tokens";

export type Tone = "key" | "gold" | "info" | "ok" | "warn" | "bad" | "muted";

export const TONE: Record<Tone, string> = {
  /** Identidad y acción principal. */
  key: ACCENT.primary,
  /** Logro, recompensa, actualización disponible. */
  gold: ACCENT.gold,
  /** Algo en curso o informativo. */
  info: SEMANTIC.info,
  /** Correcto, completado, disponible. */
  ok: SEMANTIC.success,
  /** Atención: pausado, caducando, incompleto. */
  warn: SEMANTIC.warning,
  /** Error o acción destructiva. */
  bad: SEMANTIC.danger,
  /** Inactivo, desconectado, no disponible. */
  muted: TEXT.muted,
};
