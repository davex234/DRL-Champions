/**
 * F83 · PLANTILLA DE LA PRIMERA TEMPORADA EN BD — «Temporada 2 · Asalto» (BORRADOR).
 *
 * Por qué «Temporada 2»: en producción ya corre la Temporada 1 · Ascenso del pase heredado (`SEASON_CALENDAR`
 * `nexus-s1`, 2026-09-07 → 2026-11-30, `user_pass`). La primera temporada del sistema F83 es la SIGUIENTE y empieza
 * cuando aquella termina; la BD y la validación impiden que se solapen. Nombre propio, sin marcas de terceros.
 *
 * Retos: pool PEQUEÑO y realizable jugando normal (partidas, victorias, rondas, IA). Nada de ranked (población baja:
 * no siempre hay rival), ni Draft (cuesta entrada), ni colecciones (inviables para muchos), ni abrir sobres (gasto).
 * Recompensas CONSERVADORAS (ver economía/simulación en el informe F83): ~57 % del valor del carril libre heredado.
 */
import { buildLevels } from "./curve";
import type { ChallengeDef, GameSeason, LevelReward, SeasonConfig } from "./types";

const ch = (id: string, family: string, label: string, condition: ChallengeDef["condition"], target: number, xp: number): ChallengeDef => ({ id, family, label, condition, target, xp });

export const DAILY_POOL: ChallengeDef[] = [
  ch("d-jugar-2", "play", "Juega 2 partidas", { type: "MATCH_PLAY" }, 2, 120),
  ch("d-jugar-3", "play", "Juega 3 partidas", { type: "MATCH_PLAY" }, 3, 160),
  ch("d-ganar-1", "win", "Gana 1 partida", { type: "MATCH_WIN" }, 1, 150),
  ch("d-ganar-2", "win", "Gana 2 partidas", { type: "MATCH_WIN" }, 2, 220),
  ch("d-rondas-8", "rounds", "Gana 8 rondas", { type: "TURN_WIN" }, 8, 140),
  ch("d-rondas-12", "rounds", "Gana 12 rondas", { type: "TURN_WIN" }, 12, 180),
  ch("d-ia-normal", "pve", "Gana a la IA en Normal o Difícil", { type: "WIN_PVE", minDifficulty: "NORMAL" }, 1, 170),
];

export const WEEKLY_POOL: ChallengeDef[] = [
  ch("w-jugar-10", "play", "Juega 10 partidas", { type: "MATCH_PLAY" }, 10, 450),
  ch("w-jugar-15", "play", "Juega 15 partidas", { type: "MATCH_PLAY" }, 15, 600),
  ch("w-ganar-5", "win", "Gana 5 partidas", { type: "MATCH_WIN" }, 5, 500),
  ch("w-ganar-8", "win", "Gana 8 partidas", { type: "MATCH_WIN" }, 8, 700),
  ch("w-rondas-40", "rounds", "Gana 40 rondas", { type: "TURN_WIN" }, 40, 450),
  ch("w-ia-dificil", "pve-hard", "Gana 2 veces a la IA en Difícil", { type: "WIN_PVE", minDifficulty: "HARD" }, 2, 600),
  ch("w-racha-3", "streak", "Consigue una racha de 3 victorias", { type: "WIN_STREAK" }, 3, 550),
];

const SLUG = "temporada-2";
export const T2_BADGE_SILVER = `insignia:temporada:${SLUG}-plata`;
export const T2_BADGE_GOLD = `insignia:temporada:${SLUG}-oro`;

/** Recompensas de nivel (40 niveles). Pares sin múltiplo de 10: 150 créditos; 5/15/25/35: 1.000; 10/30: Bronce; 20/40: Plata (+ insignia). */
export function t2Rewards(maxLevel = 40): LevelReward[] {
  const out: LevelReward[] = [];
  for (let l = 1; l <= maxLevel; l++) {
    if (l === 20) out.push({ level: l, reward: { packId: "premium", packCount: 1, badge: T2_BADGE_SILVER } });
    else if (l === 40) out.push({ level: l, reward: { packId: "premium", packCount: 1, badge: T2_BADGE_GOLD } });
    else if (l % 10 === 0) out.push({ level: l, reward: { packId: "estandar", packCount: 1 } });
    else if (l % 5 === 0) out.push({ level: l, reward: { credits: 1000 } });
    else if (l % 2 === 0) out.push({ level: l, reward: { credits: 150 } });
  }
  return out;
}

export function t2Config(): SeasonConfig {
  const maxLevel = 40, base = 1500, step = 50;
  return {
    version: 1,
    curve: { base, step },
    levels: buildLevels(maxLevel, base, step),
    xp: { match: { PVE: 40, DRAFT: 50, RANKED: 60, winBonus: 30, dailyCap: 600 }, craft: { amount: 50, dailyCap: 100 }, collection: 300 },
    rewards: t2Rewards(maxLevel),
    challenges: { daily: { count: 3, pool: DAILY_POOL }, weekly: { count: 5, pool: WEEKLY_POOL } },
  };
}

/** Borrador: empieza cuando termina la Temporada 1 heredada; 12 semanas (lunes a lunes, UTC); 14 días de gracia. */
export function t2Draft(): Omit<GameSeason, "checksum" | "publishedAt" | "rowVersion"> {
  const startsAt = Date.parse("2026-11-30T00:00:00.000Z");
  const endsAt = Date.parse("2027-02-22T00:00:00.000Z");
  return {
    id: SLUG, number: 2, name: "Temporada 2 · Asalto",
    description: "Doce semanas de ruta: juega, gana y completa retos diarios y semanales para subir de nivel y reclamar recompensas.",
    status: "DRAFT", startsAt, endsAt, claimUntil: endsAt + 14 * 86_400_000, maxLevel: 40, config: t2Config(), configVersion: 1,
  };
}
