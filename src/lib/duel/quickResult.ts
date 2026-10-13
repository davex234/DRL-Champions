/**
 * RESULTADO DE PARTIDA RÁPIDA (presentación pura).
 *
 * La pantalla final de una PARTIDA RÁPIDA es mínima: veredicto, marcador, el motivo que ya redactó el resolver y dos
 * salidas (SEGUIR JUGANDO · VOLVER AL MENÚ PRINCIPAL). El resto de modos conservan su resultado completo.
 *
 * Se decide con DOS fuentes que tienen que coincidir:
 *   · el SERVIDOR: `view.context === "QUICK"` (lo deriva de la BD: `duel_matches.mode` y `campaign_attempts.match_id`);
 *   · la PÁGINA: la arena montada es la de partida rápida (ni draft ni nodo de campaña).
 * Si falta cualquiera de las dos (contexto desconocido, lectura fallida, otro modo), se enseña el resultado completo de
 * siempre. Ranked, duelo amistoso y torneos viven en otra ruta (`/duelos/pvp`) y no pasan nunca por aquí.
 *
 * No toca recompensas ni progresión: el servidor ya pagó la partida al terminarla (`awardMatchOutcome`, misiones,
 * temporada); esta pantalla solo deja de ENSEÑARLO.
 */
import type { ArenaMode } from "./arenas";
import type { DuelMatchView } from "./types";

export function isQuickMatchResult(view: Pick<DuelMatchView, "status" | "result" | "context"> | null | undefined, arenaMode: ArenaMode): boolean {
  if (!view || view.status === "IN_PROGRESS" || !view.result) return false;
  return view.context === "QUICK" && arenaMode === "quick";
}

/** Ruta canónica del menú principal (el vestíbulo, `/`). */
export const MAIN_MENU_HREF = "/";
