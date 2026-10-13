/**
 * PLAYER JOURNEY · PRESENTACIÓN PURA (Fase 40).
 *
 * Decide CÓMO se enseña el recorrido que ya viene calculado por el servidor dentro de la foto del Daily Loop. No decide
 * pasos ni prioridades: si la acción principal NO es del recorrido (p. ej. una partida a medias), el recorrido baja a una
 * tira discreta. «Explorar por mi cuenta» solo cambia esta presentación: nunca el estado del juego.
 */
import type { CardDef, Player, RoleId } from "@/domain/cards/types";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import { eventRoute } from "@/domain/dailyLoop";
import { DISCOVERY, type DiscoveryDestination, type JourneyStep, type PlayerJourney } from "@/domain/journey";
import { DUEL_ROLES } from "@/domain/cardgame/types";

export type HomeJourneyMode = "mission" | "strip" | "discovery" | "none";

export const isJourneyAction = (id: string) => id.startsWith("journey-");

export function homeJourneyMode(snap: DailyLoopSnapshot, opts: { dismissed: boolean }): HomeJourneyMode {
  const j = snap.journey;
  if (!snap.signedIn || !j) return "none";
  if (j.isComplete) return j.justCompleted ? "discovery" : "none";
  if (!isJourneyAction(snap.primaryAction.id) || opts.dismissed) return "strip";
  return "mission";
}

export const STEP_STATE_LABEL = (s: JourneyStep) => (s.done ? "Hecho" : s.current ? "Ahora" : "Después");

export const WELCOME_PILLARS: readonly { verb: string; line: string }[] = [
  { verb: "Colecciona", line: "Cartas de jugadores reales, con sus estadísticas." },
  { verb: "Construye", line: "Una plantilla de diez: dos por rol." },
  { verb: "Compite", line: "Diez turnos. Gana el valor más alto." },
];

/** Tres cartas REALES del catálogo para la bienvenida: roles distintos, mayor OVR, orden determinista. No son suyas. */
export function welcomeCards(cards: readonly CardDef[], player: (id: string) => Player | undefined, n = 3): CardDef[] {
  const out: CardDef[] = [];
  const roles = new Set<RoleId>();
  const players = new Set<string>();
  const sorted = [...cards].filter((c) => !!c.combat).sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1));
  for (const c of sorted) {
    const p = player(c.playerId);
    const rol = c.role ?? p?.role;
    if (!p || !rol || roles.has(rol) || players.has(c.playerId)) continue;
    roles.add(rol); players.add(c.playerId); out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/** Roles de la plantilla con lo que tiene y lo que necesita (texto además de color). */
export function roleChips(j: PlayerJourney): { role: RoleId; label: string; complete: boolean }[] {
  return DUEL_ROLES.map((role) => {
    const r = j.context.roles.find((x) => x.role === role) ?? { have: 0, need: 2 };
    return { role, label: `${role} ${r.have}/${r.need}`, complete: r.have >= r.need };
  });
}

/**
 * Destinos tras la primera sesión: los cinco reales y, SOLO si hay un partido en directo de verdad, el evento. Un evento
 * de DEMOSTRACIÓN (`isDemo`) nunca se anuncia como «en directo» aquí (medido en real: la demo de Madrid tiene partidos
 * marcados en juego).
 */
export function discoveryItems(snap: DailyLoopSnapshot): DiscoveryDestination[] {
  const f = snap.live?.featured ?? null;
  const live = f && !f.isDemo && f.lifecycle === "ACTIVE" && f.liveCount > 0 ? f : null;
  return live ? [...DISCOVERY, { id: "live", title: live.name, line: "Hay partidos en directo ahora mismo.", href: eventRoute(live.id) }] : [...DISCOVERY];
}
