/**
 * WALKOUT 0.5 · EL WALKOUT DENTRO DE LA APERTURA REAL (puro).
 *
 * EL SERVIDOR DECIDE, EL WALKOUT PRESENTA. Aquí no entra nada que no venga ya del resultado PERSISTIDO de una apertura
 * (las instancias que devolvió el servidor, resueltas contra el catálogo por `buildRevealPlan`): ni se sortea, ni se
 * reordena el contenido, ni se toca una carta. Solo se decide QUÉ cartas se presentan con un walkout, con QUÉ intensidad
 * y con QUÉ identidad, y cómo encaja eso en el ritmo de la ceremonia.
 *
 * INTENSIDAD = CLASE DE SOBRE DE LA CARTA (`packCardClass`, la clasificación con la que sortea la economía). Decisión del
 * producto (2026-10-08) frente a la rareza de la edición, porque en TODOS los planes de sobre una Future Star sale menos
 * que una Champions S (la rareza las ordena al revés):
 *
 *   Base (70–92), Masters L / SDC ...... STANDARD  — la revelación de siempre (hero + resto)
 *   Champions S ........................ RARE      — presentación breve (de pie en la plataforma)
 *   Future Star (clase «prime») ........ WALKOUT   — entrada humana completa
 *   Record Breaker / Moments («icon») .. MEGA_WALKOUT — entrada completa con el clímax mayor
 *
 * Nunca el OVR (una Base puede tener 92 y una Champions S 80), nunca el precio del sobre, nunca la rareza.
 */
import { packCardClass } from "@/domain/packs/packClass";
import type { CardDef, Player } from "@/domain/cards/types";
import type { WalkoutIntensity } from "./timeline";
import { walkoutIdentityFromCard, type WalkoutCardIdentity } from "./input";

export function walkoutIntensityForCard(card: Pick<CardDef, "variantId" | "ovr">): WalkoutIntensity {
  switch (packCardClass(card)) {
    case "champions": return "RARE";
    case "prime": return "WALKOUT";
    case "icon": return "MEGA_WALKOUT";
    // base / plata / oro / masters, y una carta sin clase (edición fuera de la línea): la revelación de siempre
    default: return "STANDARD";
  }
}

/** Lo mínimo de un `RevealItem` que hace falta (el plan de la ceremonia ya resolvió carta y jugador del catálogo). */
export interface WalkoutSource { uid: string; card: CardDef; player: Player | null }

export interface PackWalkoutItem {
  /** uid PERSISTIDO de la instancia (la clave de la escena: cada walkout la suya). */
  uid: string;
  cardId: string;
  intensity: Exclude<WalkoutIntensity, "STANDARD">;
  /** Identidad 100 % de la carta: sin `overrides` (los ajustes DEV no existen en la apertura real). */
  identity: WalkoutCardIdentity;
}

/**
 * La cola de walkouts de una apertura: las cartas especiales EN EL ORDEN DE PRESENTACIÓN ya establecido (`plan.order`:
 * la hero primero y el resto por OVR, empates en el orden del servidor). Puede haber cero, una o varias (un Icon de 3
 * cartas son 3), con repetidas incluidas: cada instancia es la suya.
 */
export function packWalkoutQueue(order: readonly WalkoutSource[]): PackWalkoutItem[] {
  const out: PackWalkoutItem[] = [];
  for (const it of order) {
    const intensity = walkoutIntensityForCard(it.card);
    if (intensity === "STANDARD") continue;
    out.push({ uid: it.uid, cardId: it.card.id, intensity, identity: walkoutIdentityFromCard(it.card, it.player ?? undefined) });
  }
  return out;
}

/**
 * Cómo encaja en la ceremonia: cuántos walkouts, si la HERO (mayor OVR) es uno de ellos —entonces su walkout ES su
 * presentación y no se repite con la hero de siempre— y cuántas cartas quedan para el resto escalonado.
 */
export function walkoutFlow(count: number, heroUid: string | null, queue: readonly Pick<PackWalkoutItem, "uid">[]): { walkouts: number; heroWalked: boolean; rest: number } {
  const heroWalked = !!heroUid && queue.some((q) => q.uid === heroUid);
  const rest = Math.max(0, count - queue.length - (heroWalked ? 0 : 1));
  return { walkouts: queue.length, heroWalked, rest };
}

/* ═══════════════════════ despliegue (feature flag) ═══════════════════════ */

/** Modo de despliegue del walkout en la apertura real (`config/features · PACK_WALKOUT_3D_ENABLED`). */
export type PackWalkoutRollout = "off" | "admins" | "all";

/**
 * ¿Se presenta el walkout a ESTE jugador? Falla cerrado: «off» nunca (salvo la QA local), «admins» solo con el veredicto
 * EXPLÍCITO del servidor (`profiles.is_admin` → `granted`), «all» siempre. Fuera de producción, un navegador puede
 * activarlo para sí (la prueba local de la integración); en una build de producción `devOptIn` no cuenta.
 */
export function packWalkoutAllowed(o: { rollout: PackWalkoutRollout; admin: "checking" | "granted" | "denied" | "unconfigured" | null; devOptIn: boolean; production: boolean; qa?: boolean }): boolean {
  if (o.qa === true && !o.production) return true;
  if (o.devOptIn && !o.production) return true;
  if (o.rollout === "all") return true;
  if (o.rollout === "admins") return o.admin === "granted";
  return false;
}

/** Clave local (solo `next dev`) para probar la integración en ESTE navegador. */
export const PACK_WALKOUT_DEV_KEY = "drl:walkout3d";
