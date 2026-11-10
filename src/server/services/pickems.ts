/**
 * PICK'EMS SERVER-SIDE (SOLO SERVIDOR) — bloques F, G y H.
 *
 * Tres responsabilidades, todas del servidor:
 *   · guardar una predicción, rechazándola si la pregunta ya ha cerrado;
 *   · corregir un Pick'em contra el resultado real y repartir puntos;
 *   · conceder la recompensa correspondiente, una sola vez.
 *
 * El CIERRE no se comprueba aquí sino dentro de `app_submit_pick`, con el reloj
 * de la base de datos. Si se comprobara en Node, dos procesos con relojes
 * distintos podrían discrepar, y un reintento tardío podría colarse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { rewardForPoints, tierForPoints, REWARD_TIERS } from "@/domain/pickems/rewards";
import type { Reward } from "@/domain/events/types";
import { award } from "./rewards";
import type { ServiceResult } from "./packs";

const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

/** Guarda (o cambia) la predicción de un usuario para una pregunta. */
export async function submitPick(
  sb: SupabaseClient, userId: string, questionId: string, option: string,
): Promise<ServiceResult<{ questionId: string; option: string }>> {
  const { data, error } = await sb.rpc("app_submit_pick", {
    p_user: userId, p_question_id: questionId, p_option: option,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("Predicción cerrada")) {
      return fail("Esta predicción ya está cerrada", 409);
    }
    if (msg.includes("Opción inválida")) return fail("Opción no válida", 400);
    // F87.1 · 0072: los Pick'ems clásicos creados tras el corte no admiten predicciones (las nuevas van por Pick'ems 2.0).
    if (msg.includes("PICKEM_LEGACY_RETIRED")) return fail("Este Pick'em clásico ya no admite predicciones", 409);
    if (msg.includes("Pregunta inexistente")) return fail("Pregunta no encontrada", 404);
    return fail(msg || "No se pudo guardar la predicción", 500);
  }
  return { ok: true, data: data as { questionId: string; option: string } };
}

/**
 * Fija el resultado de una pregunta (lo usa el corrector cuando un partido acaba).
 */
export async function setCorrectOption(
  sb: SupabaseClient, questionId: string, correct: string,
): Promise<void> {
  const { error } = await sb.rpc("app_set_correct_option", {
    p_question_id: questionId, p_correct: correct,
  });
  if (error) throw new Error(error.message);
}

export interface ScoreOutcome {
  users: number;
  pointsAwarded: number;
  rewarded: { userId: string; points: number; tier: string | null }[];
}

/**
 * Corrige un Pick'em y reparte puntos + recompensas.
 *
 * Idempotente por partida doble:
 *   · `app_score_pickem_event` recalcula desde cero y ajusta `profiles.points`
 *     por DIFERENCIA, así que reejecutarlo no infla los puntos.
 *   · las recompensas usan `ref` en el libro mayor, así que tampoco se duplican.
 */
/**
 * FASE 42 · lo que paga un escalón descontando los escalones INFERIORES ya pagados de ese evento (créditos y XP de su
 * definición). Pura. Si el escalón ya estaba pagado, su clave lo hace idempotente igualmente.
 */
export function pickemTierDelta(tierId: string, paidRefs: ReadonlySet<string>, pickemEventId: string, full: Reward): Reward {
  const idx = REWARD_TIERS.findIndex((t) => t.id === tierId);
  let credits = 0; let xp = 0;
  for (const t of REWARD_TIERS.slice(0, Math.max(0, idx))) {
    if (paidRefs.has(`pickem:${pickemEventId}:${t.id}`)) { credits = Math.max(credits, t.reward.credits ?? 0); xp = Math.max(xp, t.reward.xp ?? 0); }
  }
  return { ...full, credits: Math.max(0, (full.credits ?? 0) - credits), xp: Math.max(0, (full.xp ?? 0) - xp) };
}

export async function scorePickemEvent(
  sb: SupabaseClient, pickemEventId: string,
): Promise<ServiceResult<ScoreOutcome>> {
  const { data, error } = await sb.rpc("app_score_pickem_event", {
    p_pickem_event_id: pickemEventId,
  });
  if (error) return fail(error.message || "No se pudo corregir el Pick'em", 500);

  const summary = data as { users: number; pointsAwarded: number };

  // Recompensas por escalón alcanzado.
  const { data: scores } = await sb
    .from("pickem_scores")
    .select("user_id, points")
    .eq("pickem_event_id", pickemEventId);

  const rewarded: ScoreOutcome["rewarded"] = [];
  /*
   * FASE 42 · RECORRECCIÓN SIN DUPLICAR. El contrato es «se concede EL MÁS ALTO alcanzado, no la suma», pero cada
   * escalón tiene su clave: si un evento se corregía varias veces subiendo (participación → acertante → …), se pagaban
   * TODOS los escalones intermedios (hasta 11.000 créditos frente a 6.000). Ahora se lee UNA vez lo ya pagado de este
   * evento (una consulta para todos los usuarios, sin N+1) y el escalón nuevo paga solo la DIFERENCIA de créditos y XP.
   * Los sobres de un escalón inferior ya entregados no se retiran (el libro mayor no se reescribe); el del escalón nuevo
   * se entrega una vez por su clave.
   */
  const tierRefs = REWARD_TIERS.map((t) => `pickem:${pickemEventId}:${t.id}`);
  const { data: paidRows } = await sb.from("credit_transactions").select("user_id, ref, delta").in("ref", tierRefs);
  const paidByUser = new Map<string, Set<string>>();
  for (const p of (paidRows ?? []) as { user_id: string; ref: string }[]) {
    const set = paidByUser.get(p.user_id) ?? new Set<string>(); set.add(p.ref); paidByUser.set(p.user_id, set);
  }
  for (const row of (scores as { user_id: string; points: number }[]) ?? []) {
    const tier = tierForPoints(row.points);
    rewarded.push({ userId: row.user_id, points: row.points, tier: tier?.id ?? null });
    if (!tier) continue;

    const reward = pickemTierDelta(tier.id, paidByUser.get(row.user_id) ?? new Set(), pickemEventId, rewardForPoints(row.points));
    /*
     * Una sola clave para todo el paquete de recompensa y una sola transacción.
     * Reintentar o recorregir el Pick'em no puede conceder media recompensa ni duplicarla.
     *
     * Fase 10: pasa por `services/rewards`, la ruta única, en vez de llamar a la RPC a
     * mano. Efecto práctico: si un escalón futuro lleva un cosmético o una carta —cosas
     * que `Reward` admite— se entregan, en vez de perderse porque esta llamada no las
     * pasaba.
     *
     * Los PUNTOS no van por aquí: los reparte `app_score_pickem_event` a partir de las
     * respuestas acertadas, que es donde está la regla. Sumarlos también aquí los daría
     * dos veces.
     */
    try {
      const res = await award(sb, {
        userId: row.user_id,
        ref: `pickem:${pickemEventId}:${tier.id}`,
        reason: `pickem_reward:${tier.id}`,
        reward,
      });
      if (res.unsupported.length > 0) {
        console.warn(`[pickems] ${tier.id}: sin ruta de entrega para ${res.unsupported.join(", ")}`);
      }
    } catch (e) {
      // Un fallo al recompensar no debe tumbar la corrección entera: los puntos
      // ya están repartidos y la recompensa es reintentable por su idempotencia.
      console.error(`[pickems] recompensa fallida para ${row.user_id}: ${(e as Error).message}`);
    }
  }

  return { ok: true, data: { ...summary, rewarded } };
}
