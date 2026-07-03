/**
 * CONTEXTO DE PRESENTACIÓN (Collection Fase 7/7).
 *
 * Fuentes de datos de SOLO LECTURA que la capa de presentación proyecta. La única obligatoria es el
 * `CollectionEngine` (dueño del inventario). El resto se INYECTA desde los motores existentes
 * (Marketplace/Battle Pass/Deck/Craft/Career) — nunca los recalcula ni los posee. Todo opcional para
 * que la presentación funcione con lo que haya disponible.
 */
import type { CollectionEngine } from "@/collection";
import type { Deck } from "@/deck";
import type { Materials } from "@/craft";

export interface PresentationContext {
  /** ÚNICA fuente obligatoria: el dueño del inventario. */
  collection: CollectionEngine;
  /** Reloj lógico para líneas de tiempo relativas (opcional). */
  now?: number;
  /** Valor de mercado por carta (inyectado desde `MarketEngine.value`). */
  marketValue?: (cardId: string, serial?: number | null) => number;
  /** Analytics de mercado (proyectada tal cual). */
  marketAnalytics?: unknown;
  /** Historial de transacciones de mercado (proyectado tal cual). */
  marketHistory?: unknown[];
  /** Analytics del Battle Pass (proyectada tal cual). */
  pass?: unknown;
  /** Historial de temporadas archivadas del Battle Pass. */
  passArchive?: unknown[];
  /** Decks del usuario (para "más usada"). SOLO LECTURA. */
  decks?: Deck[];
  /** Materiales de crafting (valor de craft). */
  materials?: Materials;
  /** Historial de carrera (proyectado tal cual). */
  careerHistory?: unknown[];
}
