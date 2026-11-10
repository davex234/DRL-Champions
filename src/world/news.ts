/**
 * NOTICIAS DEL MUNDO — un periódico vivo. Convierte los eventos del mundo en `NewsItem`
 * (el mismo tipo que consume `useNewsStore`), con ids deterministas para deduplicar. No
 * usa plantillas planas: el titular nace del hito y su detalle. PURO.
 */
import type { NewsItem, NewsKind } from "@/intel";
import type { WorldEvent, WorldEventType } from "./types";

const KIND: Record<WorldEventType, NewsKind> = {
  transfer_bomb: "transfer", record_transfer: "transfer",
  retirement: "record", legend_created: "record", historic_dynasty: "record",
  the_next_star: "special", academy_wonderkid: "special",
  coach_fired: "event", coach_hired: "event", great_collapse: "event",
  historic_rivalry: "event", golden_generation: "event", the_last_dance: "event",
  perfect_season: "record", perfect_split: "record", historic_comeback: "record",
};

const HEAD: Record<WorldEventType, string> = {
  historic_dynasty: "DINASTÍA HISTÓRICA", great_collapse: "GRAN COLAPSO", transfer_bomb: "BOMBAZO DE MERCADO",
  retirement: "SE RETIRA", academy_wonderkid: "PERLA DE LA CANTERA", legend_created: "NACE UNA LEYENDA",
  historic_rivalry: "CLÁSICO", golden_generation: "GENERACIÓN DORADA", the_next_star: "LA PRÓXIMA ESTRELLA",
  the_last_dance: "EL ÚLTIMO BAILE", coach_fired: "DESTITUCIÓN", coach_hired: "NUEVO TÉCNICO",
  record_transfer: "FICHAJE RÉCORD", perfect_season: "TEMPORADA PERFECTA", perfect_split: "SPLIT PERFECTO",
  historic_comeback: "REMONTADA HISTÓRICA",
};

export function worldNews(events: WorldEvent[]): NewsItem[] {
  return events.map((e): NewsItem => ({
    id: `world:${e.season}:${e.type}:${e.subject}`.toLowerCase().replace(/\s+/g, "-"),
    at: e.season,
    kind: KIND[e.type],
    title: `${HEAD[e.type]}: ${e.subject}`,
    body: e.detail,
    tags: ["mundo", e.type],
  }));
}
