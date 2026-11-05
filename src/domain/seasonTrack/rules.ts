/**
 * F83 · REGLAS DE XP DE TEMPORADA (puras). El servidor las aplica sobre EVENTOS que él mismo produce; el cliente nunca
 * envía cantidades. Reutiliza el motor de F73:
 *   · `matchCounts` (terminada por reglas, no privada, ≥ 5 decisiones humanas: anti-AFK de F72.8/F73);
 *   · `evaluate` para el progreso de los retos (misma condición tipada que las misiones).
 *
 * Fuentes:
 *   MATCH       partida que cuenta → base por modo (+ bonus de victoria). Perder también suma (la base). Tope diario.
 *   CRAFT       crafteo real completado (sobre o carta). Tope diario. NUNCA desguace (no es un evento).
 *   COLLECTION  Collection Set de F82 COMPLETADO durante la temporada (clave por set: una vez).
 *   (sin XP)    abrir/comprar sobres, partidas privadas, abandonos, partidas sin decisiones humanas.
 */
import { evaluate, matchCounts } from "@/domain/missionEngine/evaluate";
import type { MissionDef, MissionEvent, ProgressOp } from "@/domain/missionEngine/types";
import type { ActiveChallenges } from "./rotation";
import type { ChallengeDef, SeasonConfig } from "./types";

/** Eventos de temporada: los de F73 (partida, apertura, crafteo) + colección completada (F82). */
export type SeasonEvent = MissionEvent | { kind: "COLLECTION"; key: string; setId: string };

export interface XpGrant { source: "MATCH" | "CRAFT" | "COLLECTION"; amount: number; dailyCap: number | null }

/** XP base de un evento (o `null`: el evento no da XP de temporada ni cuenta para retos). */
export function baseXp(config: SeasonConfig, e: SeasonEvent): XpGrant | null {
  switch (e.kind) {
    case "MATCH": {
      if (!matchCounts(e)) return null;
      if (e.mode === "PRIVATE") return null;
      const base = config.xp.match[e.mode];
      return { source: "MATCH", amount: base + (e.won ? config.xp.match.winBonus : 0), dailyCap: config.xp.match.dailyCap };
    }
    case "CRAFT_PACK": case "CRAFT_CARD":
      return { source: "CRAFT", amount: config.xp.craft.amount, dailyCap: config.xp.craft.dailyCap };
    case "COLLECTION":
      return { source: "COLLECTION", amount: config.xp.collection, dailyCap: null };
    default:
      return null; // OPEN_PACK: sin XP (no se incentiva el gasto)
  }
}

/** Adaptador: un reto se evalúa EXACTAMENTE como una misión de F73 con su condición y objetivo. */
const asMission = (c: ChallengeDef): MissionDef => ({
  id: c.id, name: c.label, description: "", condition: c.condition, target: c.target, dependsOn: [], reward: {},
  projectId: null, status: "ACTIVE", sortOrder: 0, availableFrom: null, availableTo: null, version: 1,
});

export interface ChallengeOp { challenge: string; period: string; op: ProgressOp["op"]; value: number; target: number; xp: number }

/** Operaciones de progreso de los retos ACTIVOS para este evento (diarios + semanales del periodo actual). */
export function challengeOps(active: ActiveChallenges, e: SeasonEvent): ChallengeOp[] {
  if (e.kind === "COLLECTION") return [];
  const out: ChallengeOp[] = [];
  for (const [group, period] of [[active.daily, active.daily.period.key], [active.weekly, active.weekly.period.key]] as const) {
    for (const c of group.challenges) {
      const op = evaluate(asMission(c), e);
      if (!op) continue;
      out.push({ challenge: c.id, period, op: op.op, value: op.op === "INC" ? op.value : 0, target: c.target, xp: c.xp });
    }
  }
  return out;
}
