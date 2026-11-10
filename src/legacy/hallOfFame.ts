/**
 * HALL OF FAME — generado AUTOMÁTICAMENTE del ecosistema (Career Fase 6/7).
 *
 * No solo jugadores: entrenadores, clubes, temporadas, equipos, dinastías, rookies y
 * transferencias. DERIVA de timeline (bestRating), rankings, history y transfers ya
 * persistidos. Umbrales de inducción deterministas. PURO. No duplica el Timeline/News.
 */
import type { WorldState } from "@/world";
import type { HallOfFame, HofEntry } from "./types";

const entry = (id: string, name: string, category: HofEntry["category"], detail: string, score: number, season: number): HofEntry => ({ id, name, category, detail, score: Math.round(score), season });
const bySc = (a: HofEntry, b: HofEntry) => b.score - a.score;

export function hallOfFame(world: WorldState, limit = 12): HallOfFame {
  const season = world.season;

  // Jugadores: por pico de rating (Timeline) + títulos (world.players).
  const players = Object.values(world.timeline.players)
    .map((p) => ({ p, wp: world.players[p.id] }))
    .filter(({ p, wp }) => (p.bestRating ?? 0) >= 80 || (wp?.titles ?? 0) >= 3)
    .map(({ p, wp }) => entry(p.id, p.nick, "player", `pico ${Math.round(p.bestRating ?? 0)} · ${wp?.titles ?? 0} títulos`, (p.bestRating ?? 0) + (wp?.titles ?? 0) * 6, p.firstSeason))
    .sort(bySc).slice(0, limit);

  // Entrenadores: por títulos.
  const coaches = Object.values(world.coaches)
    .filter((c) => c.titles >= 2)
    .map((c) => entry(c.id, c.name, "coach", `${c.titles} títulos · rating ${c.rating}`, c.titles * 20 + c.rating, season))
    .sort(bySc).slice(0, limit);

  // Clubes: por títulos + prestigio.
  const clubs = Object.values(world.teams)
    .filter((t) => t.titles >= 2)
    .map((t) => entry(t.id, t.name, "club", `${t.titles} títulos · prestigio ${Math.round(t.prestige)}`, t.titles * 25 + t.prestige, season))
    .sort(bySc).slice(0, limit);

  // Temporadas legendarias: campeonatos con pocas derrotas.
  const seasons: HofEntry[] = [];
  for (const t of Object.values(world.teams)) {
    for (const s of t.standings) if (s.champion && s.losses <= 2) seasons.push(entry(`${t.id}:${s.season}`, `${t.name} T${s.season}`, "season", `campeón ${s.wins}-${s.losses}`, 90 + (3 - s.losses) * 3, s.season));
  }
  seasons.sort(bySc);

  // Equipos legendarios (generación dorada): rosters jóvenes de alto techo (evento persistido).
  const teams = world.events.filter((e) => e.type === "golden_generation" || e.type === "perfect_season")
    .map((e) => entry(`${e.type}:${e.subject}:${e.season}`, e.subject, "team", e.detail, e.magnitude, e.season)).sort(bySc).slice(0, limit);

  // Dinastías: del récord + eventos.
  const dynRec = world.history.records["dynasty"];
  const dynasties: HofEntry[] = dynRec ? [entry("dynasty", dynRec.holder, "dynasty", `${dynRec.value} títulos seguidos`, 100, dynRec.season)] : [];
  for (const e of world.events.filter((e) => e.type === "historic_dynasty")) dynasties.push(entry(`dyn:${e.subject}:${e.season}`, e.subject, "dynasty", e.detail, e.magnitude, e.season));

  // Rookies del año (history).
  const rookies = world.history.rookieOfYear.slice(-limit).map((r) => entry(r.playerId, r.nick, "rookie", `Rookie del año T${r.season}`, 70, r.season)).reverse();

  // Transferencias históricas: mayores fees.
  const transfers = [...world.transfers].filter((t) => t.fee > 0).sort((a, b) => b.fee - a.fee).slice(0, limit)
    .map((t) => entry(`tr:${t.playerId}:${t.season}`, t.nick, "transfer", `${t.fee} → ${world.teams[t.to ?? ""]?.name ?? "?"} (T${t.season})`, t.fee / 200, t.season));

  return { players, coaches, clubs, seasons: seasons.slice(0, limit), teams, dynasties: dynasties.slice(0, limit), rookies, transfers };
}
