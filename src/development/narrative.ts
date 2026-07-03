/**
 * DESARROLLO × NARRATIVA — el significado de la EVOLUCIÓN (sin frases de UI).
 *
 * Lee las TRANSICIONES de desarrollo (antes/después de partido/entrenamiento/temporada)
 * y detecta hitos: breakthrough, slump, legendary season, confidence lost, burnout,
 * perfect training, tactical/leadership growth, veteran mentor, new star, everything
 * clicks, mental collapse. Mismo patrón que `detectCoachEvents`/`detectTacticalEvents`. PURO.
 */
import type { DevTransition, DevelopmentEvent, DevelopmentEventType } from "./types";

const mag = (n: number) => Math.min(100, Math.max(1, Math.round(n)));
const sumPos = (o: Record<string, number>) => Object.values(o).filter((v) => v > 0).reduce((a, b) => a + b, 0);

/**
 * Detecta eventos de desarrollo sobre una lista de transiciones (en orden temporal).
 * `names` opcional resuelve playerId → nick para la UI.
 */
export function detectDevelopmentEvents(transitions: DevTransition[], names: Record<string, string> = {}): DevelopmentEvent[] {
  const out: DevelopmentEvent[] = [];
  const negStreak: Record<string, number> = {}; // partidos seguidos a la baja por jugador

  for (const t of transitions) {
    const id = t.playerId;
    const name = t.name ?? names[id];
    const d = t.after.rating - t.before.rating;
    const cb = t.before.condition, ca = t.after.condition;
    const push = (type: DevelopmentEventType, magnitude: number, detail?: string) =>
      out.push({ type, playerId: id, name, season: t.season, magnitude: mag(magnitude), detail });

    // Rachas a la baja (para slump).
    if (t.cause === "match") negStreak[id] = d < -0.4 ? (negStreak[id] ?? 0) + 1 : 0;

    // — Progreso —
    if (t.cause === "match" && d >= 2) {
      if (t.after.age <= 21 && t.after.rating >= 60) push("new_star", 70 + d * 4, `${name ?? id} emerge (${Math.round(t.after.rating)})`);
      else push("breakthrough", 55 + d * 6, `salto a ${Math.round(t.after.rating)}`);
    }
    if (t.cause === "season" && d >= 3 && t.after.rating >= 80) push("legendary_season", 90, `temporada histórica (${Math.round(t.after.rating)})`);
    if (t.cause === "match" && ca.form >= 75 && d > 0.5) push("everything_clicks", 60 + ca.form * 0.3, "todo encaja");

    // — Regresión —
    if (negStreak[id] >= 2) push("slump", 50 + negStreak[id] * 8, `${negStreak[id]} partidos a la baja`);
    if (ca.confidence <= cb.confidence - 8) push("confidence_lost", 45 + (cb.confidence - ca.confidence), "pierde confianza");
    if (ca.burnout >= 60) push("burnout", 60 + (ca.burnout - 60), "agotamiento");
    if (ca.confidence < 30 && ca.morale < 35) push("mental_collapse", 80, "colapso mental");

    // — Entrenamiento —
    if (t.cause === "training" && sumPos({ ...t.changes.traits, ...t.changes.attrs, ...t.changes.skills } as Record<string, number>) >= 2 && ca.fatigue < 62) {
      push("perfect_training", 55, "sesión productiva");
    }

    // — Crecimiento específico —
    const tg = (t.changes.traits.tacticalIQ ?? 0) + (t.changes.attrs.gameSense ?? 0);
    if (tg >= 0.6) push("tactical_growth", 45 + tg * 10, "crece su lectura de juego");
    if ((t.changes.traits.leadershipDrive ?? 0) >= 0.4) push("leadership_growth", 45, "crece como líder");
    if (t.cause === "season" && t.after.age >= 29 && ((t.changes.traits.leadershipDrive ?? 0) > 0 || (t.changes.traits.tacticalIQ ?? 0) > 0)) {
      push("veteran_mentor", 55, "veterano que guía al equipo");
    }
  }
  return out;
}
