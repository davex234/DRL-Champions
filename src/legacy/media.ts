/**
 * MEDIOS — el ecosistema de prensa (Career Fase 6/7).
 *
 * Periódicos, analistas, podcasts, influencers y prensa internacional generan narrativa a
 * partir de los HITOS del mundo (`world.events`, que ya produce el motor de Narrativa). Nunca
 * texto aleatorio: plantillas deterministas sobre eventos reales. PURO. Reutiliza Narrative.
 */
import type { WorldState } from "@/world";
import type { MediaItem, MediaOutlet } from "./types";

const OUTLET_LABEL: Record<MediaOutlet, string> = { newspaper: "Prensa", analyst: "Analista", podcast: "Podcast", influencer: "Influencer", international: "Prensa internacional" };

function outletFor(type: string, i: number): MediaOutlet {
  if (type === "historic_dynasty" || type === "record_transfer" || type === "perfect_season") return "newspaper";
  if (type === "great_collapse" || type === "perfect_split" || type === "golden_generation") return "analyst";
  if (type === "historic_rivalry" || type === "coach_fired" || type === "coach_hired") return "podcast";
  if (type === "transfer_bomb" || type === "the_next_star" || type === "academy_wonderkid") return "influencer";
  if (type === "legend_created" || type === "retirement" || type === "the_last_dance") return "international";
  return (["newspaper", "analyst", "podcast", "influencer", "international"] as MediaOutlet[])[i % 5];
}

function headline(outlet: MediaOutlet, subject: string): string {
  switch (outlet) {
    case "newspaper": return `PORTADA: ${subject}`;
    case "analyst": return `Análisis: las claves de ${subject}`;
    case "podcast": return `En el podcast: todo sobre ${subject}`;
    case "influencer": return `🔥 ${subject} lo está petando`;
    case "international": return `${subject}, en la portada mundial`;
  }
}

/** Resumen mediático de la temporada a partir de los hitos del mundo. Determinista. */
export function mediaDigest(world: WorldState, limit = 8): MediaItem[] {
  return [...world.events]
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, limit)
    .map((e, i) => {
      const outlet = outletFor(e.type, i);
      return { id: `media:${e.season}:${e.type}:${e.subject}`, outlet, headline: `${OUTLET_LABEL[outlet]} · ${headline(outlet, e.subject)}`, body: e.detail, subject: e.subject, heat: e.magnitude };
    });
}
