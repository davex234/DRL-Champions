/**
 * F86 · GANCHO DE LIQUIDACIÓN DE TORNEO (solo servidor). Módulo mínimo a propósito: lo importa `duelsPvp` y no debe
 * arrastrar el servicio de torneos (que a su vez importa `duelsPvp` para crear partidas).
 *
 * Cuando una partida `PVP_PRIVATE` queda terminal (fin por reglas, abandono o cierre), se pide a la BD
 * `cup_settle_game(id)`: si la partida es de un cruce de torneo, la BD lee el resultado del MOTOR y lo propaga al cuadro
 * UNA vez (cerrojo de la copa); si no lo es, responde NOT_CUP con una lectura por índice. El cliente nunca dice quién
 * ganó. Nunca lanza: si falla, la red es la siguiente lectura del torneo (que vuelve a pedir la liquidación).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/server/ops/log";

export async function settleCupGame(sb: SupabaseClient, gameMatchId: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("cup_settle_game", { p_game: gameMatchId });
    if (error) {
      // Sin 0069 (función ausente) no hay torneos que liquidar: silencio. Cualquier otro fallo se registra.
      if (!/cup_settle_game|PGRST202|does not exist/i.test(error.message ?? "")) logEvent("error", "cups.settle", error.message, { game: gameMatchId });
      return null;
    }
    const code = String((data as { code?: string } | null)?.code ?? "");
    if (code === "SETTLED" || code === "HELD" || code === "RECORDED_CANCELLED") logEvent("info", "cups.settle", code, { game: gameMatchId });
    return code;
  } catch (e) {
    logEvent("error", "cups.settle", e instanceof Error ? e.message : String(e), { game: gameMatchId });
    return null;
  }
}
