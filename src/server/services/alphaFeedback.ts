/**
 * F86.2 · FEEDBACK DE LA CLOSED ALPHA (servidor). Escribe en `alpha_feedback` (0070) con service_role.
 *
 *   · El usuario sale de la SESIÓN, nunca del cuerpo (un `userId` en el cuerpo es un 400 antes de llegar aquí).
 *   · Idempotente por la clave de envío: repetir el mismo id (doble clic, dos pestañas, reintento) → ALREADY, sin
 *     segunda fila. Si esa clave fuera de OTRA cuenta (no debería: es un uuid aleatorio del cliente), un 409 neutro que
 *     no dice nada de la fila ajena.
 *   · Tope por cuenta en la BD (FEEDBACK_LIMIT) → 409 con un texto humano.
 *   · Ninguna lectura para jugadores: el feedback solo lo ve un administrador (`server/admin/alpha.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { feedbackRow, type FeedbackInput } from "@/domain/feedback/alpha";

export type FeedbackResult =
  | { ok: true; status: 200; data: { code: "SAVED" | "ALREADY"; id: string } }
  | { ok: false; status: number; error: string; code?: string };

export async function submitFeedback(sb: SupabaseClient, userId: string, input: FeedbackInput, appVersion: string | null): Promise<FeedbackResult> {
  const { error } = await sb.from("alpha_feedback").insert(feedbackRow(userId, input, appVersion));
  if (!error) return { ok: true, status: 200, data: { code: "SAVED", id: input.id } };
  const code = (error as { code?: string }).code;
  if (code === "23505") {
    const { data, error: readErr } = await sb.from("alpha_feedback").select("user_id").eq("id", input.id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if ((data as { user_id?: string } | null)?.user_id === userId) return { ok: true, status: 200, data: { code: "ALREADY", id: input.id } };
    return { ok: false, status: 409, error: "No se pudo guardar este envío. Vuelve a abrir el formulario.", code: "CONFLICT" };
  }
  if (/FEEDBACK_LIMIT/.test(error.message ?? "")) {
    return { ok: false, status: 409, error: "Ya nos has enviado muchas respuestas: ¡gracias! Si es urgente, díselo a quien te invitó.", code: "LIMIT" };
  }
  throw new Error(error.message);
}
