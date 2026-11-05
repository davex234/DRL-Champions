/**
 * F60 · CARTAS DEL PANEL — reglas puras del asistente de alta (/admin/cards/new) y de la puerta de publicación.
 *
 * LA CARTA ES EL ASSET: lo impreso (rol de carta, OVR y seis estadísticas, equipo impreso) describe la imagen que se
 * sube. El OVR impreso es también el OVR de juego (igual que en las 331 del catálogo diseñado), así que la
 * clasificación económica (clase de sobre, valor, desguace) se DERIVA con las funciones de siempre; no se escribe.
 * El rol de la CARTA puede no coincidir con el del jugador. El equipo impreso no cambia si el jugador cambia de equipo.
 */
import type { CardDef, PrintedStats, RoleId, VariantId } from "@/domain/cards/types";
import { DESIGNED_EDITIONS, getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { packCardClass, PACK_CLASS_LABEL } from "@/domain/packs/packClass";
import { ns } from "@/i18n/runtime";

const t = ns("admin");

export const CARD_ROLES: readonly RoleId[] = ["Duelista", "Iniciador", "Controlador", "Centinela", "Flex"];
export const PRINTED_KEYS: readonly (keyof PrintedStats)[] = ["dmg", "scr", "fks", "hs", "ast", "clu"];
export const PRINTED_LABEL: Record<keyof PrintedStats, string> = { dmg: "DMG", scr: "SCR", fks: "FKS", hs: "HS", ast: "AST", clu: "CLU" };

export interface CardDraftInput {
  playerId?: string; variantId?: string; role?: string; ovr?: number; stats?: Partial<Record<keyof PrintedStats, number>>;
  team?: string; imageAssetId?: string | null;
}
export type CardFieldErrors = Partial<Record<"playerId" | "variantId" | "role" | "ovr" | "stats" | "team" | "imageAssetId", string>>;

const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function validateCardDraft(i: CardDraftInput, opts: { requireArt: boolean }): CardFieldErrors {
  const e: CardFieldErrors = {};
  if (!i.playerId || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(i.playerId)) e.playerId = t("Elige un jugador");
  if (!i.variantId || !DESIGNED_EDITIONS.has(i.variantId as VariantId)) e.variantId = t("Elige una de las ediciones diseñadas");
  if (!i.role || !(CARD_ROLES as string[]).includes(i.role)) e.role = t("Elige el rol de la carta");
  if (!int(i.ovr, 40, 99)) e.ovr = t("OVR entero entre 40 y 99");
  if (!i.stats || PRINTED_KEYS.some((k) => !int(i.stats![k], 1, 99))) e.stats = t("Las seis estadísticas, enteros entre 1 y 99");
  if (!i.team || !/^[A-Za-z0-9 .&-]{2,12}$/.test(i.team.trim())) e.team = t("Equipo impreso de 2 a 12 caracteres (letras, cifras, espacio . & -)");
  if (opts.requireArt && !i.imageAssetId) e.imageAssetId = t("Sube el arte de la carta");
  return e;
}

export const cardIdOf = (playerId: string, variantId: string): string => `${playerId}__${variantId}`;

/** Clasificación económica DERIVADA (nunca editable): clase de sobre, valor de mercado y desguace. */
export function economicClass(card: Pick<CardDef, "variantId" | "ovr">): { packClass: string | null; packClassLabel: string; marketValue: number; salvageValue: number; editionLabel: string } {
  const cls = packCardClass(card as CardDef);
  return {
    packClass: cls, packClassLabel: cls ? PACK_CLASS_LABEL[cls] : t("Sin clase"),
    marketValue: marketValue(card), salvageValue: salvageValue(card as CardDef),
    editionLabel: getVariant(card.variantId as VariantId).label,
  };
}

export interface CardPublishRow { origin: string; lifecycle: string; presentation: { printed?: unknown; imageAssetId?: string; imagePath?: string; role?: string; team?: string } | null }

/** Lo que falta para publicar una carta del panel (la BD lo vuelve a exigir con un trigger). */
export function cardPublishChecklist(r: CardPublishRow, assetOk: boolean): { key: string; label: string; ok: boolean }[] {
  const p = r.presentation;
  return [
    { key: "draft", label: t("Está en borrador"), ok: ["DRAFT", "REVIEW", "APPROVED"].includes(r.lifecycle) },
    { key: "printed", label: t("OVR y seis estadísticas impresas"), ok: !!p?.printed },
    { key: "role", label: t("Rol de la carta"), ok: !!p?.role },
    { key: "team", label: t("Equipo impreso"), ok: !!p?.team },
    { key: "art", label: t("Arte subido y aprobado"), ok: !!p?.imageAssetId && !!p?.imagePath && assetOk },
  ];
}
