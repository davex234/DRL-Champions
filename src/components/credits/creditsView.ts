/**
 * DRL CREDITS — presentación de los paquetes (Fase 49.1). Sin economía: qué arte, qué frase y qué etiqueta
 * lleva cada paquete. Cantidades y productos salen del catálogo (`domain/economy/drlCredits`); los precios en
 * euros no existen todavía y no se inventan.
 */
import { CREDITS_ART, type CreditsArt } from "@/data/creditsArt";
import type { CreditProduct } from "@/domain/economy/drlCredits";

/** `drlc-starter` → `starter`. El arte de un paquete se elige por su id, nunca por su posición. */
export const artKey = (productId: string): string => productId.replace(/^drlc-/, "");

export function creditsArtFor(productId: string): CreditsArt | undefined {
  return CREDITS_ART.find((a) => a.id === artKey(productId));
}

export const CREDITS_HERO_ART = CREDITS_ART.find((a) => a.id === "hero")!;

/** Una línea por paquete. Texto de tienda, sin promesas de valor ni de precio. */
export const PACK_TAGLINE: Readonly<Record<string, string>> = {
  starter: "Tus primeras monedas.",
  basic: "Unos cuantos sobres más.",
  popular: "Para jugar toda la semana.",
  large: "Un cofre lleno de créditos.",
  ultimate: "El cofre más grande de NEXUS.",
};

/**
 * Etiqueta comercial del paquete. «Más elegido» viene del catálogo (`metadata.badge`); «Mayor paquete» se
 * DERIVA (es el de más créditos), así que no afirma nada que no sea cierto.
 */
export function packBadge(p: CreditProduct, all: readonly CreditProduct[]): string | null {
  if (p.metadata?.badge) return p.metadata.badge === "El más elegido" ? "Más elegido" : p.metadata.badge;
  const max = Math.max(...all.map((x) => x.credits));
  return p.credits === max && all.length > 1 ? "Mayor paquete" : null;
}

export const formatAmount = (n: number): string => new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Math.trunc(n));
