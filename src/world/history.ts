/**
 * HISTORIA — la crónica del universo tras varias temporadas: dinastías, fracasos, rookie
 * del año, mejor coach, mejor clutch, fichaje más caro. Mantiene `WorldHistory.records` y
 * produce una crónica legible. PURO.
 */
import type { WorldState, RecordHolder } from "./types";
import type { SeasonResult } from "./season";

function setRecord(world: WorldState, key: string, holder: string, value: number, season: number, force = false): void {
  const cur = world.history.records[key];
  if (force || !cur || value > cur.value) world.history.records[key] = { label: key, holder, value, season };
}

export function updateHistory(world: WorldState, result: SeasonResult): void {
  const season = world.season;
  const seasonTransfers = world.transfers.filter((t) => t.season === season);

  // Fichaje más caro de la historia.
  for (const t of seasonTransfers) setRecord(world, "transfer", `${t.nick}`, t.fee, season);

  // Mayor dinastía (títulos seguidos del mismo equipo).
  let best = 0, bestTeam = "";
  let run = 0, prev = "";
  for (const c of world.history.champions) {
    run = c.teamId === prev ? run + 1 : 1; prev = c.teamId;
    if (run > best) { best = run; bestTeam = c.teamName; }
  }
  if (bestTeam) setRecord(world, "dynasty", bestTeam, best, season, true);

  // Mayor fracaso (colapso de prestigio más fuerte) — aproximado por el equipo de menor prestigio con títulos pasados.
  const collapses = Object.values(world.teams).filter((t) => t.titles > 0).map((t) => ({ t, drop: t.titles * 6 + 50 - t.prestige }));
  const worst = collapses.sort((a, b) => b.drop - a.drop)[0];
  if (worst && worst.drop > 0) setRecord(world, "failure", worst.t.name, Math.round(worst.drop), season, true);

  // Rookie del año (mejor academia con ≤1 temporada).
  const rookie = Object.values(world.players)
    .filter((p) => p.status === "active" && p.origin === "academy" && p.dev.seasonsPlayed <= 1)
    .sort((a, b) => b.value - a.value)[0];
  if (rookie) world.history.rookieOfYear.push({ season, playerId: rookie.id, nick: rookie.nick });

  // Mejor coach (más títulos) y mejor clutch (mayor skill de clutch).
  const coach = Object.values(world.coaches).sort((a, b) => b.titles - a.titles)[0];
  if (coach && coach.titles > 0) setRecord(world, "coach", coach.name, coach.titles, season, true);
  const clutch = Object.values(world.players).filter((p) => p.status === "active").sort((a, b) => b.dev.skill.clutch - a.dev.skill.clutch)[0];
  if (clutch) setRecord(world, "clutch", clutch.nick, Math.round(clutch.dev.skill.clutch), season, true);
}

/** Crónica legible tras varias temporadas. */
export function worldChronicle(world: WorldState): string[] {
  const r = world.history.records;
  const line = (k: string, fmt: (h: RecordHolder) => string) => (r[k] ? fmt(r[k]) : null);
  return [
    line("dynasty", (h) => `La mayor dinastía: ${h.holder} (${h.value} títulos seguidos).`),
    line("failure", (h) => `El mayor fracaso: ${h.holder}.`),
    world.history.rookieOfYear.length ? `Rookie del año (T${world.history.rookieOfYear[world.history.rookieOfYear.length - 1].season}): ${world.history.rookieOfYear[world.history.rookieOfYear.length - 1].nick}.` : null,
    line("coach", (h) => `El mejor coach: ${h.holder} (${h.value} títulos).`),
    line("clutch", (h) => `El mejor clutch: ${h.holder}.`),
    line("transfer", (h) => `La transferencia más cara: ${h.holder} (${h.value}).`),
  ].filter((x): x is string => x != null);
}
