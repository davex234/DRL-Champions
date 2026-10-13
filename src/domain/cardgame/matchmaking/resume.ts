/**
 * F76 · ¿SIGUE VIVA LA PARTIDA DE UNA ENTRADA `MATCHED`? Decisión PURA (la toma el servidor).
 *
 * `MATCHED` es un estado TERMINAL de la cola (0032): la entrada se queda así para siempre como historia de esa
 * búsqueda, y `duel_pvp_status` la devuelve como «última conocida» cuando no hay búsqueda viva. Eso sirve para que
 * quien recarga justo al emparejar descubra su partida… y era también el bug: la última conocida podía apuntar a una
 * partida TERMINADA hace días, y la cola la presentaba como «tu partida». La pantalla se iba al resultado viejo, el
 * sondeo se paraba y `cancel` no tenía nada que cancelar.
 *
 * La regla, una sola y en servidor: una entrada `MATCHED` solo se presenta como partida actual si su partida EXISTE, es
 * ranked, el usuario JUEGA en ella y su ciclo de vida canónico (`lifecycleFromStatus`) NO es terminal. En cualquier
 * otro caso la entrada es historia: la cola responde como si no hubiera búsqueda y el jugador puede buscar de nuevo.
 * La fila NO se reescribe (sigue siendo la historia verdadera de esa búsqueda); lo que se corrige es la PROYECCIÓN.
 */
import { isTerminal, lifecycleFromStatus } from "../pvp/lifecycle";

/** Columnas de `duel_matches` que bastan para decidir. Nunca `state` ni `rng`. */
export interface MatchedMatchFacts {
  id: string;
  mode: string;
  user_id: string;
  player_b_id: string | null;
  status: string;
  closed_reason: string | null;
}

export type MatchedEntryVerdict = "LIVE" | "STALE";

export function matchedEntryVerdict(userId: string, matchId: string | null, match: MatchedMatchFacts | null): MatchedEntryVerdict {
  if (!matchId || !match || match.id !== matchId) return "STALE";
  // La cola ranked solo crea partidas `PVP`; una privada no sale nunca de aquí.
  if (match.mode !== "PVP") return "STALE";
  if (match.user_id !== userId && match.player_b_id !== userId) return "STALE";
  return isTerminal(lifecycleFromStatus(match.status, match.closed_reason)) ? "STALE" : "LIVE";
}
