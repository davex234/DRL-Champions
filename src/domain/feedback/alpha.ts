import { ns } from "@/i18n/runtime";

const tr = ns("feedback");

/**
 * F86.2 · FEEDBACK DE LA CLOSED ALPHA (dominio puro: preguntas, validación y forma del envío).
 *
 * Lo rellena una persona real después de jugar. Aquí no hay opiniones inventadas: solo las preguntas, sus límites y la
 * lista blanca de campos. El servidor pone el usuario (de la sesión) y la hora; el cliente solo manda respuestas y una
 * CLAVE de envío (uuid) que hace el envío idempotente (doble clic, dos pestañas o reintento → una sola fila).
 */
export const FEEDBACK_TEXT_MAX = 2000;
export const FEEDBACK_SOURCES = ["menu", "cup", "home", "profile", "result"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_TEXT_FIELDS = ["hardToUnderstand", "lostMoment", "likedMost", "likedLeast", "errorDetail", "comment"] as const;
export type FeedbackTextField = (typeof FEEDBACK_TEXT_FIELDS)[number];

/** Las preguntas, en el orden en que se ven. */
export const FEEDBACK_QUESTIONS: { field: FeedbackTextField; label: string; hint: string }[] = [
  { field: "hardToUnderstand", label: "¿Qué parte te costó entender?", hint: "Una pantalla, una regla, un botón…" },
  { field: "lostMoment", label: "¿En algún momento no sabías qué hacer?", hint: "Dónde estabas y qué buscabas." },
  { field: "likedMost", label: "¿Qué fue lo que más te gustó?", hint: "" },
  { field: "likedLeast", label: "¿Qué fue lo que menos te gustó?", hint: "" },
];
export const FEEDBACK_ERROR_LABEL = "¿Hubo algún error?";
export const FEEDBACK_ERROR_DETAIL_LABEL = "Cuéntanos qué pasó (qué hacías y qué viste)";
export const FEEDBACK_RETURN_LABEL = "Del 1 al 10, ¿volverías a jugar?";
export const FEEDBACK_COMMENT_LABEL = "Comentario libre";

export interface FeedbackInput {
  id: string;
  source: FeedbackSource;
  hardToUnderstand: string | null;
  lostMoment: string | null;
  likedMost: string | null;
  likedLeast: string | null;
  hadError: boolean | null;
  errorDetail: string | null;
  wouldReturn: number | null;
  comment: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Claves que admite el cuerpo (más `action`). Cualquier otra —un `userId`, una fecha— es un 400. */
export const FEEDBACK_KEYS = new Set<string>(["action", "id", "source", ...FEEDBACK_TEXT_FIELDS, "hadError", "wouldReturn"]);

export type FeedbackParse = { ok: true; value: FeedbackInput } | { ok: false; error: string; code: string };

const fail = (error: string, code = "BAD_REQUEST"): FeedbackParse => ({ ok: false, error, code });

/** Valida el cuerpo de un envío. Textos: recortados, vacío = null, ≤ 2000. Al menos UNA respuesta. */
export function parseFeedback(body: unknown): FeedbackParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(tr("Cuerpo no válido"));
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !FEEDBACK_KEYS.has(k));
  if (extra) return fail(tr("Campo no permitido: {extra}", { extra: extra.slice(0, 40) }), "FIELD_NOT_ALLOWED");
  if (typeof b.id !== "string" || !UUID.test(b.id)) return fail(tr("Falta la clave del envío"));
  const source = b.source === undefined ? "menu" : b.source;
  if (typeof source !== "string" || !(FEEDBACK_SOURCES as readonly string[]).includes(source)) return fail(tr("Origen no válido"));
  const texts = {} as Record<FeedbackTextField, string | null>;
  for (const f of FEEDBACK_TEXT_FIELDS) {
    const v = b[f];
    if (v === undefined || v === null) { texts[f] = null; continue; }
    if (typeof v !== "string") return fail(tr("Respuesta no válida"));
    const t = v.trim();
    if (t.length > FEEDBACK_TEXT_MAX) return fail(tr("Cada respuesta puede tener como mucho {FEEDBACK_TEXT_MAX} caracteres.", { FEEDBACK_TEXT_MAX }), "TOO_LONG");
    texts[f] = t.length ? t : null;
  }
  let hadError: boolean | null = null;
  if (b.hadError !== undefined && b.hadError !== null) {
    if (typeof b.hadError !== "boolean") return fail(tr("Respuesta no válida"));
    hadError = b.hadError;
  }
  let wouldReturn: number | null = null;
  if (b.wouldReturn !== undefined && b.wouldReturn !== null) {
    if (typeof b.wouldReturn !== "number" || !Number.isInteger(b.wouldReturn) || b.wouldReturn < 1 || b.wouldReturn > 10) {
      return fail(tr("La puntuación va del 1 al 10."));
    }
    wouldReturn = b.wouldReturn;
  }
  const value: FeedbackInput = { id: b.id.toLowerCase(), source: source as FeedbackSource, ...texts, hadError, wouldReturn };
  if (isEmptyFeedback(value)) return fail(tr("Responde al menos una pregunta antes de enviar."), "EMPTY");
  return { ok: true, value };
}

export function isEmptyFeedback(v: Omit<FeedbackInput, "id" | "source">): boolean {
  return FEEDBACK_TEXT_FIELDS.every((f) => !v[f]) && v.hadError === null && v.wouldReturn === null;
}

/** Fila de la tabla (0070) a partir de un envío válido. */
export function feedbackRow(userId: string, v: FeedbackInput, appVersion: string | null) {
  return {
    id: v.id, user_id: userId, source: v.source,
    hard_to_understand: v.hardToUnderstand, lost_moment: v.lostMoment, liked_most: v.likedMost, liked_least: v.likedLeast,
    had_error: v.hadError, error_detail: v.errorDetail, would_return: v.wouldReturn, comment: v.comment,
    app_version: appVersion ? appVersion.slice(0, 64) : null,
  };
}

/** Pasos del embudo derivado (0070 · app_alpha_funnel), en el orden del recorrido, con su texto para el panel. */
export const FUNNEL_STEPS: { key: string; label: string }[] = [
  { key: "starter_granted", label: "Recibieron sus sobres de bienvenida" },
  { key: "pack_opened", label: "Abrieron al menos un sobre" },
  { key: "starter_claimed", label: "Pidieron un Sobre Inicial extra gratis" },
  { key: "deck_saved", label: "Guardaron un equipo" },
  { key: "quick_started", label: "Empezaron una partida rápida" },
  { key: "quick_completed", label: "Terminaron una partida rápida" },
  { key: "ranked_touched", label: "Entraron en la cola ranked" },
  { key: "social_used", label: "Usaron lo social (solicitud o reto)" },
  { key: "friend_added", label: "Tienen al menos un amigo" },
  { key: "cup_registered", label: "Se inscribieron en un torneo" },
  { key: "cup_played", label: "Jugaron un cruce de torneo" },
  { key: "cup_final", label: "Llegaron a una final" },
  { key: "feedback_sent", label: "Enviaron feedback" },
];
