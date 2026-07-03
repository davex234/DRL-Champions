/**
 * MUSEO DEL CLUB — generado AUTOMÁTICAMENTE (Career Fase 7/7).
 *
 * Trofeos, camisetas retiradas, jugadores/entrenadores históricos, temporadas legendarias,
 * récords, partidos históricos, transferencias y noticias — todo DERIVADO de clubLegacy +
 * world.history + world.events + career.events. PURO. Reutiliza el Legacy Engine.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { clubLegacy } from "@/legacy";
import type { Museum, MuseumItem, MuseumSection } from "./types";
import { clubIdOf } from "./util";

export function buildMuseum(career: ManagerCareer, world: WorldState): Museum {
  const clubId = clubIdOf(career, world);
  const team = clubId ? world.teams[clubId] : null;
  const legacy = clubId ? clubLegacy(world, clubId) : null;
  const items: MuseumItem[] = [];
  const add = (section: MuseumSection, title: string, subtitle: string, season: number, detail: string) => items.push({ section, title, subtitle, season, detail });

  if (legacy) {
    for (const t of legacy.titles) add("trophies", `Título ${t.competition}`, "Campeón", t.season, `T${t.season}`);
    for (const l of legacy.legends) add(l.kind === "coach" ? "coaches" : "players", l.name, l.kind === "coach" ? "Entrenador histórico" : "Jugador histórico", 0, l.note);
    // Camisetas retiradas: los 3 mejores jugadores.
    for (const l of legacy.legends.filter((x) => x.kind === "player").slice(0, 3)) add("jerseys", l.name, "Camiseta retirada", 0, `Pico ${l.peakRating}`);
    for (const s of legacy.legendarySeasons) add("seasons", `Temporada ${s}`, "Legendaria", s, "Campeón con dominio");
    if (legacy.records.biggestTransfer) add("transfers", legacy.records.biggestTransfer.nick, "Fichaje histórico", legacy.records.biggestTransfer.season, `${legacy.records.biggestTransfer.fee}`);
    for (const d of legacy.dynasties) add("records", `Dinastía ${d.titles}×`, "Récord de club", d.to, `T${d.from}–${d.to}`);
  }

  // Partidos/hitos históricos del mundo relacionados con el club.
  const clubName = team?.name;
  for (const e of world.events.filter((e) => (e.type === "perfect_season" || e.type === "historic_comeback" || e.type === "historic_dynasty") && (!clubName || e.subject === clubName)).slice(0, 6))
    add("matches", e.subject, "Partido/hito histórico", e.season, e.detail);

  // Noticias históricas de la carrera (los hitos de mayor magnitud).
  for (const ev of [...career.events].sort((a, b) => b.magnitude - a.magnitude).slice(0, 6))
    add("news", ev.detail, "Titular histórico", ev.season, ev.type);

  const counts = { trophies: 0, jerseys: 0, players: 0, coaches: 0, seasons: 0, records: 0, matches: 0, transfers: 0, news: 0 } as Record<MuseumSection, number>;
  for (const it of items) counts[it.section]++;

  return { clubName: team?.name ?? career.currentTeam ?? "—", founded: legacy?.foundedSeason ?? 1, items, counts };
}
