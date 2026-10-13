import type { EventDef, EventType, MissionDef } from "@/domain/events/types";
import { EVENT_EDITIONS } from "@/domain/events/editions";
import type { Tournament } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("engine");

/** Mapea el tipo de torneo a un tipo de evento del juego. */
function eventType(t: Tournament): EventType {
  if (t.type === "champions") return "champions";
  if (t.type === "ewc") return "ewc";
  return "masters";
}

function missions(label: string, type: EventType): MissionDef[] {
  return [
    { id: "open10", label: tr("Abre 10 sobres"), metric: "open_packs", goal: 10, passXp: 120, reward: { credits: 1500} },
    { id: "eventpacks", label: tr("Abre 5 Sobres {label}", { label: td(label) }), metric: "open_event_packs", goal: 5, passXp: 200, reward: {} },
    // Mismas reglas que `data/events` (catálogo diseñado): sin edición del torneo, no hay «carta del evento».
    ...(EVENT_EDITIONS[type].length ? [{ id: "getcard", label: tr("Consigue una carta {label}", { label: td(label) }), metric: "get_event_card", goal: 1, passXp: 150, reward: { credits: 2000} } satisfies MissionDef] : []),
    { id: "getmvp", label: tr("Consigue una carta legendaria"), metric: "get_legendary", goal: 1, passXp: 250, reward: {} },
    { id: "getwinner", label: tr("Consigue una carta épica o superior"), metric: "get_epic", goal: 1, passXp: 200, reward: {} },
  ];
}


/**
 * Genera automáticamente un evento (misiones, recompensas, sobre y tienda) a
 * partir de un torneo detectado. Reutiliza la estructura de eventos del juego.
 */
export function generateEvent(t: Tournament): EventDef {
  const type = eventType(t);
  const label = type === "champions" ? "Champions" : type === "ewc" ? "EWC" : "Masters";
  const packId = type;
  const accent = type === "champions" ? "#ffd35c" : type === "ewc" ? "#19e3ff" : "#ff8a3d";
  return {
    id: `auto-${t.id}`,
    name: t.name,
    subtitle: tr("Evento generado automáticamente por DRL Data Engine."),
    type,
    accent,
    startOffsetDays: 0,
    durationDays: 30,
    packIds: [packId],
    missions: missions(label, type),
    passLevels: 50,
    passXpPerLevel: 100,
  };
}
