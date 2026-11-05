/**
 * RUEDA DE PRENSA FINAL — periodistas, analistas, fans, exjugadores y colegas reaccionan al
 * legado (Career Fase 7/7). Citas DETERMINISTAS sobre datos REALES (nunca aleatorias). PURO.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { clubLegacy } from "@/legacy";
import type { PressConference, PressQuote, EndgameStats } from "./types";
import { clubIdOf } from "./util";
import { ns } from "@/i18n/runtime";

const t = ns("endgame");

export function pressConference(career: ManagerCareer, world: WorldState, stats: EndgameStats): PressConference {
  const name = career.coach.name;
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const fav = legacy?.legends.find((l) => l.kind === "player");
  const q: PressQuote[] = [];
  const push = (speaker: string, role: PressQuote["role"], quote: string, sentiment: number) => q.push({ speaker, role, quote, sentiment });

  push(t("Prensa DRL"), "journalist", t("{titles} títulos en {seasonsCoached} temporadas. ¿Cómo se resume una carrera así, {name}?", { titles: stats.titles, seasonsCoached: stats.seasonsCoached, name }), 70);
  push(t("Analista táctico"), "analyst", t("Un {winRate}% de victorias y {playersTrained} jugadores formados. Los números hablan de una era.", { winRate: stats.winRate, playersTrained: stats.playersTrained }), 80);
  push(t("Peña del club"), "fan", t("Gracias por cada título y cada noche mágica. {v} es tu casa para siempre.", { v: legacy?.name ?? t("El club") }), 95);
  if (fav) push(fav.name, "ex_player", t("{name} me hizo mejor jugador y mejor persona. Todo lo que soy se lo debo a él.", { name }), 92);
  push(t("Rival de banquillo"), "coach", t("Enfrentarme a {name} fue un privilegio. Elevó el nivel de todo el circuito.", { name }), 78);
  push(t("Salón de la Fama"), "legend", t("{name} entra por la puerta grande. Su nombre ya es sinónimo de esports.", { name }), 90);

  return { headline: t("{name} anuncia su retirada tras {seasonsCoached} temporadas", { name, seasonsCoached: stats.seasonsCoached }), quotes: q };
}
