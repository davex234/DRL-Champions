/**
 * F86.2 · cliente del feedback de la Closed Alpha. Un solo POST con la sesión; la clave de envío (uuid) la genera la
 * pantalla UNA vez por formulario, así que un doble clic o un reintento tras perder la respuesta guardan una sola fila.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { FeedbackSource } from "@/domain/feedback/alpha";

export class FeedbackError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export interface FeedbackPayload {
  id: string; source: FeedbackSource;
  hardToUnderstand?: string; lostMoment?: string; likedMost?: string; likedLeast?: string;
  hadError?: boolean | null; errorDetail?: string; wouldReturn?: number | null; comment?: string;
}

export async function sendFeedback(p: FeedbackPayload): Promise<{ code: "SAVED" | "ALREADY"; id: string }> {
  const sb = getSupabase();
  const t = sb ? (await sb.auth.getSession()).data.session?.access_token ?? null : null;
  if (!t) throw new FeedbackError("Inicia sesión para enviar tu opinión", 401);
  let res: Response;
  try {
    res = await fetch("/api/game/feedback", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "submit", ...p }) });
  } catch {
    throw new FeedbackError("Sin conexión: tu opinión no se ha enviado todavía. Vuelve a pulsar «Enviar» cuando vuelva la red.", 0, "OFFLINE");
  }
  const json = (await res.json().catch(() => ({}))) as { code?: string; id?: string; error?: string };
  if (!res.ok) throw new FeedbackError(json.error ?? "No se pudo enviar. Vuelve a intentarlo.", res.status, json.code);
  return { code: json.code === "ALREADY" ? "ALREADY" : "SAVED", id: json.id ?? p.id };
}

/** uuid v4 del navegador (crypto.randomUUID donde exista; si no, a partir de getRandomValues). */
export function newSubmissionId(): string {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  (c ?? { getRandomValues: (x: Uint8Array) => { for (let i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 256); return x; } }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
