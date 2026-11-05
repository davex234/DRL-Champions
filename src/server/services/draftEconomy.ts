/**
 * DRAFT GAUNTLET · ECONOMÍA CON AUTORIDAD DE SERVIDOR (F72, SOLO SERVIDOR). SIN MIGRACIÓN.
 *
 * El ÚNICO sitio donde el modo mueve dinero. `draftGauntlet.ts` decide CUÁNDO (crear la run, cerrarla); esto decide
 * CÓMO, siempre por las puertas que ya existen y con una clave de idempotencia por hecho económico:
 *
 *   ENTRADA   `app_adjust_credits(-fee, ref = draft:entry:<runId>)` → `_ledger_apply` (0019): bloqueo del perfil, suelo 0
 *             («Saldo insuficiente» ⇒ no se cobra nada) y asiento `debit`. Misma ref ⇒ no cobra dos veces: una run, un
 *             cargo, aunque lleguen doble clic, reintento, recarga o dos pestañas.
 *   PREMIO    `award()` → `app_grant_reward` (0026) con `ref = draft:reward:<runId>`: créditos (+ título si completa).
 *   SOBRE     `award()` con `ref = draft:jackpot:<userId>:<semana ISO>` y motivo `draft_jackpot:<runId>`: la clave del
 *             libro mayor ES el tope semanal. Si ya existe con otro motivo, el sobre de esa semana era de otra run.
 *
 * Nada de esto lo decide el cliente: la ruta no acepta cantidades, victorias ni recompensas (lista cerrada de claves).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { award } from "./rewards";
import {
  DRAFT_CHAMPION_TITLE, DRAFT_JACKPOT, entryReason, entryRef, jackpotReason, jackpotRef, rewardReason, rewardRef,
  type DraftRewardState,
} from "@/domain/draft/economy";

export type ChargeOutcome = { ok: true; balance: number | null } | { ok: false; reason: "INSUFFICIENT" | "ERROR"; message: string };

/** Saldo actual (solo lectura). `null` si no se pudo leer. */
export async function readCredits(sb: SupabaseClient, userId: string): Promise<number | null> {
  const { data, error } = await sb.from("profiles").select("credits").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const n = Number((data as { credits: unknown }).credits);
  return Number.isFinite(n) ? n : null;
}

/** ¿Existe ya el asiento de la entrada de esta run? (lectura; es la verdad de «pagada»). */
export async function entryCharged(sb: SupabaseClient, userId: string, runId: string): Promise<boolean> {
  const { data, error } = await sb.from("credit_transactions").select("ref").eq("user_id", userId).eq("ref", entryRef(runId)).limit(1);
  if (error) throw new Error(error.message);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** Cobra la entrada de UNA run. Idempotente por run: repetirla no cobra otra vez. */
export async function chargeEntry(sb: SupabaseClient, userId: string, runId: string, fee: number): Promise<ChargeOutcome> {
  if (!(fee > 0) || !Number.isInteger(fee)) return { ok: false, reason: "ERROR", message: "Entrada inválida" };
  const { data, error } = await sb.rpc("app_adjust_credits", { p_user: userId, p_delta: -fee, p_reason: entryReason, p_ref: entryRef(runId) }) as { data: unknown; error: { code?: string; message: string } | null };
  if (error) {
    if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "INSUFFICIENT", message: "Saldo insuficiente" };
    // Dos cargos simultáneos de la MISMA run: `credit_tx_ref_uniq (user_id, ref)` (0011) tumba el segundo entero
    // (se deshace también su saldo). El primero cobró: la entrada está pagada una vez.
    if (error.code === "23505" || /duplicate key/i.test(error.message)) return { ok: true, balance: null };
    return { ok: false, reason: "ERROR", message: error.message };
  }
  const n = Number(data);
  return { ok: true, balance: Number.isFinite(n) ? n : null };
}

export interface GrantOutcome { credits: number; jackpot: boolean; title: boolean }

/**
 * Concede la recompensa YA FIJADA en la run (`state.reward`, escrita por el servidor al cerrarla). Idempotente: se
 * puede repetir tras un fallo, una recarga o desde otra pestaña sin pagar dos veces. Lanza si la BD falla (la run
 * queda con la recompensa pendiente y se reintenta en la siguiente lectura o entrada).
 */
export async function grantRunReward(sb: SupabaseClient, userId: string, runId: string, reward: DraftRewardState): Promise<GrantOutcome> {
  if (reward.credits > 0 || reward.title) {
    await award(sb, {
      userId, ref: rewardRef(runId), reason: rewardReason(reward.wins),
      reward: { credits: reward.credits, ...(reward.title ? { cosmetics: [DRAFT_CHAMPION_TITLE] } : {}) },
    });
  }
  let jackpot = false;
  if (reward.jackpotWeek) {
    const ref = jackpotRef(userId, reward.jackpotWeek);
    const out = await award(sb, {
      userId, ref, reason: jackpotReason(runId),
      reward: { packId: DRAFT_JACKPOT.packId, packCount: DRAFT_JACKPOT.packCount },
    });
    if (out.applied) jackpot = true;
    else {
      // Ya estaba: ¿era de ESTA run (reintento) o de otra run de la misma semana?
      const { data, error } = await sb.from("credit_transactions").select("reason").eq("user_id", userId).eq("ref", ref).limit(1);
      if (error) throw new Error(error.message);
      jackpot = ((data as { reason: string }[] | null) ?? [])[0]?.reason === jackpotReason(runId);
    }
  }
  return { credits: reward.credits, jackpot, title: reward.title };
}
