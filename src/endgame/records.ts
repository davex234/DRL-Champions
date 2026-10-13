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
import { ns } from "@/i18n/runtime";

const t = ns("endgame");

export function careerRecords(career: ManagerCareer, world: WorldState, stats: EndgameStats): CareerRecords {
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const R = world.history.records;
  const line = (label: string, value: string, detail?: string): RecordLine => ({ label, value, detail });

  const personal: RecordLine[] = [
    line(t("Mejor racha de victorias"), `${stats.bestWinStreak}`),
    line(t("Títulos en carrera"), `${stats.titles}`),
    line(t("Mejor % de victorias"), `${stats.winRate}%`),
    line("Reputación", `${stats.reputationScore}`, stats.reputationTier),
    line(t("Nivel de entrenador"), `${stats.level}`, `OVR ${stats.overall}`),
  ];

  const club: RecordLine[] = legacy ? [
    line(t("Trofeos del club"), `${legacy.trophies}`),
    line(t("Racha de títulos"), `${legacy.longestTitleStreak}`),
    line(t("Mejor puesto"), `${legacy.bestFinish}º`, legacy.bestSeason ? `T${legacy.bestSeason}` : undefined),
    legacy.records.biggestTransfer ? line(t("Fichaje más caro"), `${legacy.records.biggestTransfer.nick}`, formatCredits(legacy.records.biggestTransfer.fee)) : line(t("Cantera formada"), `${legacy.records.academyGraduates}`),
    legacy.records.greatestPlayer ? line(t("Mejor jugador"), legacy.records.greatestPlayer.nick, `pico ${legacy.records.greatestPlayer.rating}`) : line(t("Temporadas jugadas"), `${legacy.seasonsPlayed}`),
  ] : [];

  const world_: RecordLine[] = [
    R["dynasty"] ? line(t("Mayor dinastía"), R["dynasty"].holder, t("{value} títulos seguidos", { value: R["dynasty"].value })) : line("Dinastías", "—"),
    R["transfer"] ? line(t("Transferencia récord"), R["transfer"].holder, formatCredits(R["transfer"].value)) : line(t("Transferencia récord"), "—"),
    R["worlds"] ? line(t("Campeones del Mundo"), R["worlds"].holder, `${R["worlds"].value} veces`) : line(t("World Championship"), "—"),
    R["coach"] ? line(t("Mejor entrenador del mundo"), R["coach"].holder, `${R["coach"].value} títulos`) : line(t("Mejor entrenador"), "—"),
    R["clutch"] ? line(t("Mejor clutch"), R["clutch"].holder) : line(t("Mejor clutch"), "—"),
  ];

  const careerR: RecordLine[] = [
    line(t("Temporadas dirigidas"), `${stats.seasonsCoached}`),
    line(t("Equipos dirigidos"), `${stats.teamsCoached}`),
    line("Partidos", `${stats.matches}`, `${stats.wins}V-${stats.losses}D`),
    line(t("Dinero generado"), formatCredits(stats.moneyGenerated)),
    line(t("Jugadores entrenados"), `${stats.playersTrained}`),
  ];

  return { personal, club, world: world_, career: careerR };
}
