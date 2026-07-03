/**
 * RUEDA DE PRENSA FINAL — periodistas, analistas, fans, exjugadores y colegas reaccionan al
 * legado (Career Fase 7/7). Citas DETERMINISTAS sobre datos REALES (nunca aleatorias). PURO.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { clubLegacy } from "@/legacy";
import type { PressConference, PressQuote, EndgameStats } from "./types";
import { clubIdOf } from "./util";

export function pressConference(career: ManagerCareer, world: WorldState, stats: EndgameStats): PressConference {
  const name = career.coach.name;
  const clubId = clubIdOf(career, world);
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const fav = legacy?.legends.find((l) => l.kind === "player");
  const q: PressQuote[] = [];
  const push = (speaker: string, role: PressQuote["role"], quote: string, sentiment: number) => q.push({ speaker, role, quote, sentiment });

  push("Prensa DRL", "journalist", `${stats.titles} títulos en ${stats.seasonsCoached} temporadas. ¿Cómo se resume una carrera así, ${name}?`, 70);
  push("Analista táctico", "analyst", `Un ${stats.winRate}% de victorias y ${stats.playersTrained} jugadores formados. Los números hablan de una era.`, 80);
  push("Peña del club", "fan", `Gracias por cada título y cada noche mágica. ${legacy?.name ?? "El club"} es tu casa para siempre.`, 95);
  if (fav) push(fav.name, "ex_player", `${name} me hizo mejor jugador y mejor persona. Todo lo que soy se lo debo a él.`, 92);
  push("Rival de banquillo", "coach", `Enfrentarme a ${name} fue un privilegio. Elevó el nivel de todo el circuito.`, 78);
  push("Salón de la Fama", "legend", `${name} entra por la puerta grande. Su nombre ya es sinónimo de esports.`, 90);

  return { headline: `${name} anuncia su retirada tras ${stats.seasonsCoached} temporadas`, quotes: q };
}
