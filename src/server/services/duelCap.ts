/**
 * FASE 42 · TOPE DIARIO PvE ATÓMICO — cupos numerados en `economy_ops` (sin migración).
 *
 * Hasta la Fase 41 el tope contaba los asientos `duel_%` de hoy y DESPUÉS pagaba: N partidas terminadas a la vez con el
 * recuento en 19 veían «19 < 20» y cobraban todas (nada impide tener varias partidas PvE abiertas). Con el tráfico del
 * vestíbulo vivo eso era un exploit económico real.
 *
 * Ahora cada partida PAGADA ocupa un cupo del día: la fila `economy_ops` con clave `duelcap:<uid>:<AAAA-MM-DD>:<k>`
 * (k = 1…20). La clave primaria GLOBAL de `economy_ops` hace que dos peticiones nunca obtengan el mismo k: la segunda
 * recibe 23505 y prueba el siguiente. Sin cupo libre, la partida se liquida «topada» (0). La asignación de ESTA partida
 * se guarda aparte (`duelcap:m:<matchId>`), así que reintentar la liquidación no gasta otro cupo.
 *
 * Días anteriores a esta fase: se empieza a numerar después de lo que el libro mayor ya pagó hoy (nunca por debajo).
 * Límite conocido: si dos liquidaciones de LA MISMA partida corren a la vez, pueden gastar dos cupos (el jugador pierde
 * uno; nunca cobra de más).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";

export const utcDayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export const capSlotRef = (userId: string, day: string, k: number) => `duelcap:${userId}:${day}:${k}`;
export const capMatchRef = (matchId: string) => `duelcap:m:${matchId}`;

export interface CapDecision { paid: boolean; slot: number | null; reused: boolean }

const isDuplicate = (e: { code?: string; message?: string } | null) => !!e && (e.code === "23505" || /duplicate/i.test(e.message ?? ""));

/**
 * CORE GAME LOOP · SOLO LECTURA: el cupo que ocupó una partida ya liquidada (`null` si nunca pidió cupo). No escribe,
 * así que leerlo tras F5 o desde otra pestaña no gasta ni cambia nada.
 */
export async function readDuelPaySlot(sb: SupabaseClient, userId: string, matchId: string): Promise<{ paid: boolean; slot: number | null } | null> {
  const r = await sb.from("economy_ops").select("result").eq("ref", capMatchRef(matchId)).eq("user_id", userId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  const res = (r.data as { result: { paid?: boolean; slot?: number | null } }).result ?? {};
  return { paid: res.paid === true, slot: res.paid === true && typeof res.slot === "number" ? res.slot : null };
}

export async function takeDuelPaySlot(sb: SupabaseClient, userId: string, matchId: string, now: number): Promise<CapDecision> {
  const prior = await sb.from("economy_ops").select("result").eq("ref", capMatchRef(matchId)).eq("user_id", userId).maybeSingle();
  if (prior.data) {
    const r = (prior.data as { result: { paid?: boolean; slot?: number | null } }).result ?? {};
    return { paid: r.paid === true, slot: r.slot ?? null, reused: true };
  }

  const day = utcDayKey(now);
  const dayStart = `${day}T00:00:00.000Z`;
  // Punto de partida: lo ya pagado hoy (asientos `duel_win|draw|loss`, incluidos los de antes de esta fase). Solo una
  // optimización del primer intento: la corrección la da la clave primaria.
  const { count } = await sb.from("credit_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", userId).in("reason", ["duel_win", "duel_draw", "duel_loss"]).gte("created_at", dayStart);
  let k = Math.max(1, (count ?? 0) + 1);
  let slot: number | null = null;
  while (k <= DAILY_DUEL_AWARD_CAP) {
    const ins = await sb.from("economy_ops").insert({ ref: capSlotRef(userId, day, k), user_id: userId, kind: "duel_cap_slot", result: { matchId } });
    if (!ins.error) { slot = k; break; }
    if (!isDuplicate(ins.error)) throw new Error(ins.error.message);
    k++;
  }
  const decision: CapDecision = { paid: slot !== null, slot, reused: false };
  const mark = await sb.from("economy_ops").insert({ ref: capMatchRef(matchId), user_id: userId, kind: "duel_cap_match", result: { paid: decision.paid, slot } });
  if (mark.error && isDuplicate(mark.error)) {
    // Otra liquidación de esta misma partida ganó: manda la suya.
    const again = await sb.from("economy_ops").select("result").eq("ref", capMatchRef(matchId)).eq("user_id", userId).maybeSingle();
    const r = ((again.data as { result: { paid?: boolean; slot?: number | null } } | null)?.result) ?? {};
    return { paid: r.paid === true, slot: r.slot ?? null, reused: true };
  }
  if (mark.error) throw new Error(mark.error.message);
  return decision;
}
