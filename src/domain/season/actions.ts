/**
 * «¿QUÉ HAGO AHORA?» DE LA TEMPORADA (Fase 34). PURO.
 *
 * NO es un segundo NextUp. Los candidatos se construyen con hechos reales de la foto de temporada y se
 * ordenan con LA MISMA prioridad de la home (`todayActions` de `domain/progression/meta`):
 *
 *   partida a medias > reto > recompensa pendiente > Pick'em abierto > objetivo casi completo >
 *   sobre por abrir > equipo incompleto > jugar > circuito
 *
 * Máximo 5. Sin candidatos, lista vacía (la pantalla lo dice).
 */
import { todayActions, type MetaObjective, type TodayAction } from "@/domain/progression/meta";

export const SEASON_ACTIONS_MAX = 5;

export interface SeasonActionFacts {
  activeDuel: boolean;
  claimable: { levels: number; missions: number; achievements: number };
  pendingPicks: number;
  unopenedPacks: number;
  /** `null` = no se pudo leer (no se propone construir por si acaso). */
  hasValidDeck: boolean | null;
  objectives: MetaObjective[];
  rankedGames: number;
  liveEvent: { id: string; name: string } | null;
}

export function seasonActionCandidates(f: SeasonActionFacts): TodayAction[] {
  const out: TodayAction[] = [];
  if (f.activeDuel) out.push({ id: "resume-duel", kind: "resume", label: "Retoma tu duelo", detail: "Tienes una partida sin terminar.", href: "/duelos/jugar", urgent: true });
  const claim = f.claimable.levels + f.claimable.missions + f.claimable.achievements;
  if (claim > 0) {
    const parts = [
      f.claimable.levels > 0 ? `${f.claimable.levels} ${f.claimable.levels === 1 ? "nivel del pase" : "niveles del pase"}` : null,
      f.claimable.missions > 0 ? `${f.claimable.missions} ${f.claimable.missions === 1 ? "objetivo" : "objetivos"}` : null,
      f.claimable.achievements > 0 ? `${f.claimable.achievements} ${f.claimable.achievements === 1 ? "logro" : "logros"}` : null,
    ].filter(Boolean);
    out.push({ id: "claim", kind: "claim", label: "Reclama tus recompensas", detail: `${parts.join(" · ")} sin reclamar.`, href: "/logros", count: claim });
  }
  if (f.pendingPicks > 0) out.push({ id: "predict", kind: "predict", label: "Haz tus Pick'ems", detail: `${f.pendingPicks} ${f.pendingPicks === 1 ? "predicción abierta" : "predicciones abiertas"} sin responder.`, href: "/pickems", count: f.pendingPicks, urgent: true });
  if (f.unopenedPacks > 0) out.push({ id: "open", kind: "open", label: "Abre tus sobres", detail: `${f.unopenedPacks} ${f.unopenedPacks === 1 ? "sobre" : "sobres"} sin abrir.`, href: "/inventario", count: f.unopenedPacks });
  if (f.hasValidDeck === false) out.push({ id: "build", kind: "build", label: "Completa tu equipo", detail: "Sin un equipo legal no puedes jugar duelos ni ranked.", href: "/duelos/mazos" });
  if (f.hasValidDeck) {
    out.push(f.rankedGames === 0
      ? { id: "play-ranked", kind: "play", label: "Juega tu primera ranked", detail: "Entra en la escalera competitiva de NEXUS.", href: "/duelos/pvp" }
      : { id: "play-ranked", kind: "play", label: "Juega ranked", detail: `${f.rankedGames} ${f.rankedGames === 1 ? "partida" : "partidas"} ranked en esta temporada.`, href: "/duelos/pvp" });
  }
  if (f.liveEvent) out.push({ id: "explore", kind: "explore", label: "Sigue el evento", detail: `${f.liveEvent.name} · en directo en NEXUS.`, href: `/torneos/${f.liveEvent.id}` });
  return out;
}

export function seasonActions(f: SeasonActionFacts): TodayAction[] {
  return todayActions({ steps: seasonActionCandidates(f), objectives: f.objectives, max: SEASON_ACTIONS_MAX });
}
