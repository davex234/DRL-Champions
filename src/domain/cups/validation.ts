/**
 * F86 · VALIDACIÓN DE UN TORNEO (puro). La usa el panel (vista previa y guardado) y la vuelve a hacer la BD al
 * publicar (`cup_admin_publish`) y con sus CHECK: el panel avisa, la BD manda.
 */
import { bracketSize, roundsFor } from "./bracket";
import { CUP_MAX_PARTICIPANTS, CUP_MIN_PARTICIPANTS, CUP_WINDOW_MAX, CUP_WINDOW_MIN, type CupVisibility } from "./types";

export const CUP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const CUP_NAME_MIN = 3, CUP_NAME_MAX = 60, CUP_DESC_MAX = 1000, CUP_RULES_MIN = 10, CUP_RULES_MAX = 2000;
/** Un torneo no dura más de 30 días desde el inicio (rondas × ventana). */
export const CUP_MAX_SPAN_DAYS = 30;

export interface CupDraftInput {
  slug: string;
  name: string;
  description: string;
  rules: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startsAt: string;
  minParticipants: number;
  maxParticipants: number;
  roundWindowMinutes: number;
  visibility: CupVisibility;
}

export interface CupDraft {
  slug: string; name: string; description: string; rules: string;
  registrationOpenAt: number; registrationCloseAt: number; startsAt: number;
  minParticipants: number; maxParticipants: number; roundWindowMinutes: number; visibility: CupVisibility;
}

export type CupFieldError = { field: keyof CupDraftInput | "dates" | "schedule"; message: string };

const DRAFT_KEYS: readonly (keyof CupDraftInput)[] = ["slug", "name", "description", "rules", "registrationOpenAt", "registrationCloseAt", "startsAt", "minParticipants", "maxParticipants", "roundWindowMinutes", "visibility"];
export const CUP_DRAFT_KEYS = DRAFT_KEYS;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const time = (v: unknown): number | null => (typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : null);

/**
 * Valida un borrador. `forPublish` añade lo que solo exige publicar: el cierre de la inscripción tiene que estar en el
 * futuro (no se publica un torneo que ya habría cerrado) y las reglas no pueden estar vacías.
 */
export function validateCupDraft(raw: Partial<Record<keyof CupDraftInput, unknown>>, now: number, opts: { forPublish?: boolean } = {}):
  { ok: true; value: CupDraft; errors: [] } | { ok: false; errors: CupFieldError[] } {
  const e: CupFieldError[] = [];
  const slug = text(raw.slug)?.toLowerCase() ?? "";
  if (!CUP_SLUG_PATTERN.test(slug)) e.push({ field: "slug", message: "Identificador: 3–48 letras minúsculas, números o guiones" });
  const name = text(raw.name) ?? "";
  if (name.length < CUP_NAME_MIN || name.length > CUP_NAME_MAX) e.push({ field: "name", message: `El nombre necesita ${CUP_NAME_MIN}–${CUP_NAME_MAX} caracteres` });
  const description = text(raw.description) ?? "";
  if (description.length > CUP_DESC_MAX) e.push({ field: "description", message: `Descripción de ${CUP_DESC_MAX} caracteres como máximo` });
  const rules = text(raw.rules) ?? "";
  if (rules.length > CUP_RULES_MAX) e.push({ field: "rules", message: `Reglas de ${CUP_RULES_MAX} caracteres como máximo` });
  if (opts.forPublish && rules.length < CUP_RULES_MIN) e.push({ field: "rules", message: "Escribe las reglas antes de publicar" });
  const open = time(raw.registrationOpenAt), close = time(raw.registrationCloseAt), starts = time(raw.startsAt);
  if (open === null) e.push({ field: "registrationOpenAt", message: "Fecha de apertura inválida" });
  if (close === null) e.push({ field: "registrationCloseAt", message: "Fecha de cierre inválida" });
  if (starts === null) e.push({ field: "startsAt", message: "Fecha de inicio inválida" });
  if (open !== null && close !== null && open >= close) e.push({ field: "dates", message: "La inscripción tiene que abrir antes de cerrar" });
  if (close !== null && starts !== null && close > starts) e.push({ field: "dates", message: "El torneo no puede empezar antes de que cierre la inscripción" });
  if (opts.forPublish && close !== null && close <= now) e.push({ field: "registrationCloseAt", message: "La inscripción ya habría cerrado: cambia las fechas" });
  const min = int(raw.minParticipants), max = int(raw.maxParticipants);
  if (min === null || min < CUP_MIN_PARTICIPANTS || min > CUP_MAX_PARTICIPANTS) e.push({ field: "minParticipants", message: `Mínimo entre ${CUP_MIN_PARTICIPANTS} y ${CUP_MAX_PARTICIPANTS}` });
  if (max === null || max < CUP_MIN_PARTICIPANTS || max > CUP_MAX_PARTICIPANTS) e.push({ field: "maxParticipants", message: `Máximo entre ${CUP_MIN_PARTICIPANTS} y ${CUP_MAX_PARTICIPANTS}` });
  if (min !== null && max !== null && min > max) e.push({ field: "minParticipants", message: "El mínimo no puede superar al máximo" });
  const win = int(raw.roundWindowMinutes);
  if (win === null || win < CUP_WINDOW_MIN || win > CUP_WINDOW_MAX) e.push({ field: "roundWindowMinutes", message: `Ventana por ronda de ${CUP_WINDOW_MIN} min a 7 días` });
  if (win !== null && max !== null && bracketSize(Math.min(Math.max(max, CUP_MIN_PARTICIPANTS), CUP_MAX_PARTICIPANTS)) !== null) {
    const rounds = roundsFor(bracketSize(Math.min(Math.max(max, CUP_MIN_PARTICIPANTS), CUP_MAX_PARTICIPANTS))!);
    if (rounds * win > CUP_MAX_SPAN_DAYS * 24 * 60) e.push({ field: "schedule", message: `Con ${rounds} rondas esa ventana supera los ${CUP_MAX_SPAN_DAYS} días` });
  }
  const visibility = raw.visibility === "UNLISTED" ? "UNLISTED" : raw.visibility === "PUBLIC" || raw.visibility === undefined ? "PUBLIC" : null;
  if (visibility === null) e.push({ field: "visibility", message: "Visibilidad inválida" });
  if (e.length) return { ok: false, errors: e };
  return {
    ok: true, errors: [],
    value: { slug, name, description, rules, registrationOpenAt: open!, registrationCloseAt: close!, startsAt: starts!, minParticipants: min!, maxParticipants: max!, roundWindowMinutes: win!, visibility: visibility! },
  };
}

/** Campos que se pueden corregir con el torneo publicado: solo texto que no cambia la competición. */
export const CUP_SAFE_FIELDS = ["name", "description", "rules"] as const;
