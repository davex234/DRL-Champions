/**
 * RÉCORDS — personales, del club, mundiales y de carrera (Career Fase 7/7).
 *
 * DERIVA de career.stats/history, clubLegacy y world.history.records (Living World). PURO.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { clubLegacy } from "@/legacy";
import { formatCredits } from "@/lib/format";
import type { CareerRecords, RecordLine } from "./types";
import type { EndgameStats } from "./types";
import { clubIdOf } from "./util";

export function careerRecords(career: ManagerCareer, world: WorldState, stats: EndgameStats): CareerRecords {
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const R = world.history.records;
  const line = (label: string, value: string, detail?: string): RecordLine => ({ label, value, detail });

  const personal: RecordLine[] = [
    line("Mejor racha de victorias", `${stats.bestWinStreak}`),
    line("Títulos en carrera", `${stats.titles}`),
    line("Mejor % de victorias", `${stats.winRate}%`),
    line("Reputación", `${stats.reputationScore}`, stats.reputationTier),
    line("Nivel de entrenador", `${stats.level}`, `OVR ${stats.overall}`),
  ];

  const club: RecordLine[] = legacy ? [
    line("Trofeos del club", `${legacy.trophies}`),
    line("Racha de títulos", `${legacy.longestTitleStreak}`),
    line("Mejor puesto", `${legacy.bestFinish}º`, legacy.bestSeason ? `T${legacy.bestSeason}` : undefined),
    legacy.records.biggestTransfer ? line("Fichaje más caro", `${legacy.records.biggestTransfer.nick}`, formatCredits(legacy.records.biggestTransfer.fee)) : line("Cantera formada", `${legacy.records.academyGraduates}`),
    legacy.records.greatestPlayer ? line("Mejor jugador", legacy.records.greatestPlayer.nick, `pico ${legacy.records.greatestPlayer.rating}`) : line("Temporadas jugadas", `${legacy.seasonsPlayed}`),
  ] : [];

  const world_: RecordLine[] = [
    R["dynasty"] ? line("Mayor dinastía", R["dynasty"].holder, `${R["dynasty"].value} títulos seguidos`) : line("Dinastías", "—"),
    R["transfer"] ? line("Transferencia récord", R["transfer"].holder, formatCredits(R["transfer"].value)) : line("Transferencia récord", "—"),
    R["worlds"] ? line("Campeones del Mundo", R["worlds"].holder, `${R["worlds"].value} veces`) : line("World Championship", "—"),
    R["coach"] ? line("Mejor entrenador del mundo", R["coach"].holder, `${R["coach"].value} títulos`) : line("Mejor entrenador", "—"),
    R["clutch"] ? line("Mejor clutch", R["clutch"].holder) : line("Mejor clutch", "—"),
  ];

  const careerR: RecordLine[] = [
    line("Temporadas dirigidas", `${stats.seasonsCoached}`),
    line("Equipos dirigidos", `${stats.teamsCoached}`),
    line("Partidos", `${stats.matches}`, `${stats.wins}V-${stats.losses}D`),
    line("Dinero generado", formatCredits(stats.moneyGenerated)),
    line("Jugadores entrenados", `${stats.playersTrained}`),
  ];

  return { personal, club, world: world_, career: careerR };
}
