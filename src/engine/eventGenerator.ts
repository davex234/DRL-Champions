import type { EventDef, EventType, MissionDef, ShopItemDef } from "@/domain/events/types";
import type { Tournament } from "./types";

/** Mapea el tipo de torneo a un tipo de evento del juego. */
function eventType(t: Tournament): EventType {
  if (t.type === "champions") return "champions";
  if (t.type === "ewc") return "ewc";
  return "masters";
}

function missions(label: string): MissionDef[] {
  return [
    { id: "open10", label: "Abre 10 sobres", metric: "open_packs", goal: 10, passXp: 120, reward: { credits: 1500, tokens: 20 } },
    { id: "eventpacks", label: `Abre 5 Sobres ${label}`, metric: "open_event_packs", goal: 5, passXp: 200, reward: { tokens: 80 } },
    { id: "getcard", label: `Consigue una carta ${label}`, metric: "get_event_card", goal: 1, passXp: 150, reward: { credits: 2000, tokens: 30 } },
    { id: "getmvp", label: "Consigue un MVP", metric: "get_mvp", goal: 1, passXp: 250, reward: { tokens: 100 } },
    { id: "getwinner", label: "Consigue un Winner", metric: "get_winner", goal: 1, passXp: 200, reward: { tokens: 70 } },
  ];
}

function shop(label: string, packId: string): ShopItemDef[] {
  return [
    { id: "pack", label: `Sobre ${label} extra`, cost: 120, reward: { packId, packCount: 1 } },
    { id: "credits", label: "Paquete de 5.000 créditos", cost: 150, reward: { credits: 5000 } },
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
    subtitle: "Evento generado automáticamente por DRL Data Engine.",
    type,
    accent,
    startOffsetDays: 0,
    durationDays: 30,
    packIds: [packId],
    tokensPerPack: 8,
    missions: missions(label),
    shop: shop(label, packId),
    passLevels: 50,
    passXpPerLevel: 100,
  };
}
