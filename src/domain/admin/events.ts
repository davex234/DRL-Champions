/**
 * F58 · EVENTOS DEL PANEL — reglas puras de los borradores (`admin_event_drafts`, 0055) y de su estado visible.
 *
 * El evento CANÓNICO del juego es `public.events` (lo consumen live events y los desafíos, pagados con `award()`).
 * El panel crea BORRADORES y, al publicar, la RPC inserta la fila canónica con `source = 'admin'`. Las recompensas NO
 * se inventan aquí: salen de `challengeSetFor` (tipo/región), igual que para cualquier evento del circuito.
 *
 * Estados visibles (del dominio): DRAFT · SCHEDULED (publicado, aún no empieza) · ACTIVE · ENDED · CANCELLED.
 * Se calculan con `eventPhase` (fechas en UTC; el panel las muestra en la zona del navegador).
 */
import { eventPhase } from "@/domain/events/lifecycle";
import { challengeSetFor } from "@/domain/events/challenges";
import { cleanReason, type Parsed } from "./sanctions";
import { ns } from "@/i18n/runtime";

const t = ns("admin");

export const EVENT_TYPES = ["masters", "champions", "ewc", "international", "regional"] as const;
export type AdminEventType = (typeof EVENT_TYPES)[number];
export const EVENT_REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;
export const EVENT_TYPE_LABEL: Record<AdminEventType, string> = {
  masters: "Masters", champions: "Champions", ewc: "Esports World Cup", international: "Internacional", regional: "Regional / circuito",
};
/** Una ventana de evento razonable: de 1 hora a 120 días. */
export const EVENT_MIN_HOURS = 1;
export const EVENT_MAX_DAYS = 120;

export interface EventDraftInput {
  name: string; description: string | null; imageUrl: string | null;
  type: AdminEventType; region: (typeof EVENT_REGIONS)[number] | null; startsAt: string; endsAt: string;
}

const IMAGE = /^(\/[A-Za-z0-9/_.-]+|https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9/_.%-]*)$/;

const clean = (v: unknown, max: number): string | null => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : null);

export function parseEventDraft(body: Record<string, unknown>, now: number): Parsed<EventDraftInput> {
  const name = clean(body.name, 80);
  if (!name || name.length < 3) return { ok: false, error: t("El nombre es obligatorio (3–80 caracteres)") };
  const description = clean(body.description, 600) || null;
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  if (imageUrl && (!IMAGE.test(imageUrl) || imageUrl.includes(".."))) return { ok: false, error: t("Imagen inválida (ruta /… del proyecto o URL https)") };
  const type = body.type;
  if (typeof type !== "string" || !(EVENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: t("Tipo de evento inválido") };
  const region = body.region == null || body.region === "" ? null : body.region;
  if (region !== null && !(EVENT_REGIONS as readonly unknown[]).includes(region)) return { ok: false, error: t("Región inválida") };
  const s = Date.parse(String(body.startsAt ?? "")), e = Date.parse(String(body.endsAt ?? ""));
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, error: t("Fechas inválidas") };
  if (e - s < EVENT_MIN_HOURS * 3_600_000) return { ok: false, error: t("El evento debe durar al menos 1 hora") };
  if (e - s > EVENT_MAX_DAYS * 86_400_000) return { ok: false, error: t("El evento no puede durar más de {EVENT_MAX_DAYS} días", { EVENT_MAX_DAYS }) };
  if (e <= now) return { ok: false, error: t("La fecha de fin ya ha pasado") };
  return { ok: true, value: { name, description, imageUrl, type: type as AdminEventType, region: region as EventDraftInput["region"], startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() } };
}

export type AdminEventState = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";

export function draftState(d: { status: string; starts_at: string; ends_at: string }, now: number): AdminEventState {
  if (d.status === "cancelled") return "CANCELLED";
  if (d.status === "draft") return "DRAFT";
  return canonicalState({ status: "upcoming", start_date: d.starts_at, end_date: d.ends_at }, now);
}

export function canonicalState(ev: { status: string | null; start_date: string | null; end_date: string | null }, now: number): AdminEventState {
  const phase = eventPhase({ status: ev.status, startDate: ev.start_date, endDate: ev.end_date }, now);
  return phase === "upcoming" ? "SCHEDULED" : phase === "live" || phase === "ending" ? "ACTIVE" : "ENDED";
}

/** Lo que el evento repartirá: el conjunto de desafíos que el juego le asignará por tipo/región. */
export function eventRewardsPreview(type: string, region: string | null) {
  const set = challengeSetFor({ id: "preview", type, region });
  return { setId: set.id, label: set.label, challenges: set.challenges.map((c) => ({ id: c.id, label: c.label, description: c.description, goal: c.goal, reward: c.reward })) };
}

export const cancelReason = cleanReason;
