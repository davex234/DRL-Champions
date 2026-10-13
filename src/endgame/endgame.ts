/**
 * ENDGAME — el orquestador de cierre de carrera (Career Fase 7/7, FINAL).
 *
 * Compone estadísticas + récords + museo + documental + prensa + inducción al Hall of Fame +
 * semilla de New Game+ en un `EndgameState` CONGELADO (persistible). Empuja las noticias al
 * buzón ÚNICO (`endgameNews`, patrón de legacyNews/orgNews/marketNews). PURO. Determinista.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import type { NewsItem, NewsKind } from "@/intel";
import type { EndgameState, EndgameEvent, EndgameEventType } from "./types";
import { endgameStats } from "./stats";
import { careerRecords } from "./records";
import { buildMuseum } from "./museum";
import { buildDocumentary } from "./documentary";
import { pressConference } from "./press";
import { hallOfFameInduction } from "./induction";
import { newGamePlusSeed } from "./newgameplus";
import { clubIdOf } from "./util";
import { ns, td } from "@/i18n/runtime";

const t = ns("endgame");

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Construye el estado de fin de carrera a partir de los datos REALES. Determinista. */
export function buildEndgame(career: ManagerCareer, world: WorldState, at: number): { endgame: EndgameState; events: EndgameEvent[] } {
  const stats = endgameStats(career, world);
  const records = careerRecords(career, world, stats);
  const museum = buildMuseum(career, world);
  const documentary = buildDocumentary(career, world);
  const press = pressConference(career, world, stats);
  const induction = hallOfFameInduction(career, world, stats);
  const ngp = newGamePlusSeed(career, world);

  const clubId = clubIdOf(career, world);
  const rankIdx = clubId ? world.rankings.teams.findIndex((r) => r.id === clubId) : -1;
  const worldRankPos = rankIdx >= 0 ? rankIdx + 1 : world.rankings.teams.length;
  const impactScore = clamp(Math.round(stats.reputationScore * 0.4 + Math.min(30, stats.titles * 3) + Math.min(20, stats.playersTrained * 0.5) + (induction.inducted ? 10 : 0)), 0, 100);
  const headline = t("{name} se retira: {titles} títulos y un legado de {tier}", { name: career.coach.name, titles: stats.titles, tier: td(induction.tier) });

  const endgame: EndgameState = {
    coachName: career.coach.name,
    clubName: museum.clubName,
    retiredSeason: career.season,
    headline,
    stats, records, museum, documentary, press, induction,
    newGamePlus: ngp,
    worldRankPos, worldRankTotal: Object.keys(world.teams).length,
    impactScore,
  };

  const ev = (type: EndgameEventType, subject: string, detail: string, magnitude: number): EndgameEvent =>
    ({ id: `endgame:${career.season}:${type}:${subject}`.replace(/\s+/g, "_"), type, season: career.season, at, subject, detail, magnitude });
  const events: EndgameEvent[] = [
    ev("retirement", career.coach.name, t("{name} anuncia su retirada tras {seasonsCoached} temporadas y {titles} títulos.", { name: career.coach.name, seasonsCoached: stats.seasonsCoached, titles: stats.titles }), 96),
    ev("last_season", museum.clubName ?? career.coach.name, t("{name} dirige su última temporada.", { name: career.coach.name }), 80),
  ];
  if (induction.inducted) events.push(ev("hall_of_fame", career.coach.name, induction.citation, 98));
  const topRec = records.career[3]; if (topRec) events.push(ev("career_record", career.coach.name, t("Legado económico: {value} generados en su carrera.", { value: td(topRec.value) }), 70));
  if (ngp.reconversions[0]) events.push(ev("successor", ngp.reconversions[0].nick, t("{nick} {note} — la escuela de {name} continúa.", { nick: ngp.reconversions[0].nick, note: td(ngp.reconversions[0].note), name: career.coach.name }), 72));
  events.push(ev("legacy", career.coach.name, ngp.worldMemoryNote, 85));

  return { endgame, events };
}

const KIND: Record<EndgameEventType, NewsKind> = { retirement: "special", hall_of_fame: "special", career_record: "record", last_season: "event", legacy: "special", successor: "transfer" };
const TITLE: Record<EndgameEventType, string> = { retirement: "Una leyenda se retira", hall_of_fame: "Hall of Fame", career_record: "Récord de carrera", last_season: "Última temporada", legacy: "Un legado imborrable", successor: "La escuela continúa" };

/** Eventos de cierre → NewsItem (buzón único, ids deterministas). `at` lo inyecta el store. */
export function endgameNews(events: EndgameEvent[]): NewsItem[] {
  return events.map((e) => ({ id: e.id, at: e.at, kind: KIND[e.type], title: TITLE[e.type], body: e.detail, tags: ["carrera", "endgame", e.type] }));
}

/** Vista previa del legado "si te retiraras ahora" (sin congelar). */
export function previewEndgame(career: ManagerCareer, world: WorldState): EndgameState {
  return buildEndgame(career, world, 0).endgame;
}
