/**
 * F60 · SOBRES DEL PANEL — reglas puras.
 *
 * Un sobre nuevo NO trae economía nueva: hereda la de una PLANTILLA (un sobre de código ACTIVO y de pago). Precio, nº de
 * cartas, pesos, garantías y tabla de clases F57.3 son los de la plantilla y no se editan (la economía está congelada,
 * F57.6). El panel decide: identidad (nombre, descripción, acento), arte, ventana de venta y POOL de elegibilidad.
 *
 * Publicar exige una SIMULACIÓN de servidor que cumpla los invariantes que ya existían (no se inventa ninguno):
 *   · ninguna clase vacía (el motor falla cerrado con `EmptyPackClassError`);
 *   · liquidación < 70 % del precio (F57.6);
 *   · valor/precio dentro de la banda de la línea principal: no puede dominarla (salvo plantilla Icon, como el propio Icon).
 */
import { PACKS, getPack } from "@/data/packs";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { isIconPack } from "@/domain/packs/packClass";
import type { PackDef } from "@/domain/packs/types";

export type CmsPackLifecycle = "DRAFT" | "ACTIVE" | "RETIRED";

export interface CmsPackRow {
  id: string; name: string; description: string; template_pack_id: string; price: number; card_count: number;
  art_asset_id: string | null; accent: string | null; lifecycle: CmsPackLifecycle; available_from: string | null; available_to: string | null;
  sim_summary: CmsSimSummary | null; version: number; created_at: string; updated_at: string; published_at: string | null; retired_at: string | null;
}

export const CMS_PACK_ID = /^cms-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Plantillas admitidas: sobres de CÓDIGO, activos y de pago (ni el Inicial gratis, ni borradores, ni retirados). */
export function packTemplates(): PackDef[] {
  return PACKS.filter((p) => !p.cms && p.price > 0 && packLifecycle(p) === "ACTIVE");
}
export const isValidTemplate = (id: string): boolean => packTemplates().some((p) => p.id === id);

/** Id a partir del nombre: `cms-<slug>`. */
export const suggestPackId = (name: string): string =>
  `cms-${name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sobre"}`;

export interface PackDraftInput { id?: string; name?: string; description?: string; templatePackId?: string; accent?: string | null; availableFrom?: string | null; availableTo?: string | null }
export type PackFieldErrors = Partial<Record<keyof PackDraftInput, string>>;

export function validatePackDraft(i: PackDraftInput, opts: { creating: boolean }): PackFieldErrors {
  const e: PackFieldErrors = {};
  if (opts.creating) {
    if (!i.id || !CMS_PACK_ID.test(i.id) || i.id.length > 48) e.id = "Id: «cms-» + minúsculas/cifras con guiones (máx. 48)";
    else if (getPack(i.id) && !getPack(i.id)?.cms) e.id = "Ese id ya lo usa un sobre del juego";
  }
  if (i.name !== undefined || opts.creating) {
    const n = (i.name ?? "").trim();
    if (n.length < 3 || n.length > 60) e.name = "Nombre de 3 a 60 caracteres";
    else if (/[<>]/.test(n)) e.name = "El nombre no puede contener < ni >";
  }
  if (i.description !== undefined && (i.description.length > 400 || /[<>]/.test(i.description))) e.description = "Descripción de hasta 400 caracteres, sin < ni >";
  if (i.templatePackId !== undefined || opts.creating) {
    if (!i.templatePackId || !isValidTemplate(i.templatePackId)) e.templatePackId = "Elige un sobre plantilla activo y de pago";
  }
  if (i.accent != null && i.accent !== "" && !/^#[0-9a-fA-F]{6}$/.test(i.accent)) e.accent = "Color #rrggbb";
  const from = i.availableFrom ? Date.parse(i.availableFrom) : null;
  const to = i.availableTo ? Date.parse(i.availableTo) : null;
  if ((i.availableFrom && Number.isNaN(from)) || (i.availableTo && Number.isNaN(to))) e.availableFrom = "Fecha inválida";
  else if (from !== null && to !== null && to <= from) e.availableTo = "El fin debe ser posterior al inicio";
  return e;
}

/** La economía que hereda un sobre de su plantilla (lo único que el servidor admite guardar como precio/cartas). */
export function inheritedEconomy(templateId: string): { price: number; cardCount: number } | null {
  const t = getPack(templateId);
  return t && !t.cms ? { price: t.price, cardCount: t.cardCount } : null;
}

/**
 * El `PackDef` jugable de un sobre del panel: la plantilla ENTERA (economía y reglas de elegibilidad) con la identidad
 * del sobre nuevo. Sin campo `eventId` (no se ata a un evento por herencia).
 */
export function packDefFromCms(row: CmsPackRow, artUrl: string | null): PackDef | null {
  const t = getPack(row.template_pack_id);
  if (!t || t.cms) return null;
  const { eventId: _e, tag: _t, ...template } = t;
  return {
    ...template,
    id: row.id, name: row.name, description: row.description || t.description,
    price: t.price, cardCount: t.cardCount,
    accent: row.accent ?? t.accent, tag: "Nuevo",
    lifecycle: row.lifecycle, retired: row.lifecycle === "RETIRED",
    cms: { templateId: t.id, availableFrom: row.available_from, availableTo: row.available_to, art: artUrl },
  };
}

// ────────────────────────── Simulación y puerta de publicación ──────────────────────────

export interface CmsSimSummary {
  n: number; seed: string; ev: number; evOverPrice: number; salvageEV: number; salvageOverPrice: number;
  classes: Record<string, number>; ovr: { p10: number; p50: number; p90: number; max: number };
  primePct: number; iconPct: number; eligibleCards: number; poolKey: string | null; error: string | null;
  at: string;
}

export interface GateResult { ok: boolean; blockers: string[]; warnings: string[] }

/** Los invariantes EXISTENTES (F57.6), aplicados a la simulación del sobre nuevo. */
export function packPublishGate(s: CmsSimSummary | null, band: { lo: number; hi: number }, templateId: string): GateResult {
  const blockers: string[] = []; const warnings: string[] = [];
  if (!s) return { ok: false, blockers: ["Falta la simulación"], warnings };
  if (s.error) blockers.push(`La simulación falla: ${s.error}`);
  if (s.eligibleCards <= 0) blockers.push("El pool no deja ninguna carta elegible");
  if (!(s.salvageOverPrice < 0.7)) blockers.push(`Liquidación ${Math.round(s.salvageOverPrice * 100)} % ≥ 70 % del precio: bucle económico`);
  if (!isIconPack(templateId) && s.evOverPrice > band.hi) blockers.push(`Valor/precio ${s.evOverPrice.toFixed(2)}× por encima de la banda (${band.hi.toFixed(2)}×): dominaría la línea principal`);
  if (!isIconPack(templateId) && s.evOverPrice < band.lo * 0.5) warnings.push(`Valor/precio ${s.evOverPrice.toFixed(2)}× muy por debajo de la banda: poco atractivo`);
  if (s.eligibleCards < 10) warnings.push(`Sólo ${s.eligibleCards} cartas elegibles: se repetirán mucho`);
  return { ok: blockers.length === 0, blockers, warnings };
}
