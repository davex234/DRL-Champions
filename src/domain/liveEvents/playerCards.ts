/**
 * JUGADOR REAL → CARTA DEL CATÁLOGO (Fase 30). Puro y determinista.
 *
 * `public.players.id` es el id VLR (texto). El catálogo de cartas conoce a los jugadores por su
 * slug (`Player.id`), y la única costura persistida entre ambos es `src/data/vlr/players-vct-2026.json`
 * (`vlrId` → `id`). Se resuelve por `vlrId` y, si no está, por el nick normalizado. Si no hay
 * costura, el jugador NO tiene cartas: no se inventa ninguna y no cuenta como «carta que falta».
 */
import VLR_ROSTER from "@/data/vlr/players-vct-2026.json";

interface RosterRow { id: string; vlrId: string; nick: string }

const normNick = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, "");

let BY_VLR: Map<string, string> | null = null;
let BY_NICK: Map<string, string> | null = null;

function index(): { byVlr: Map<string, string>; byNick: Map<string, string> } {
  if (!BY_VLR || !BY_NICK) {
    BY_VLR = new Map(); BY_NICK = new Map();
    for (const r of VLR_ROSTER as RosterRow[]) {
      if (r.vlrId) BY_VLR.set(String(r.vlrId), r.id);
      const n = normNick(r.nick);
      if (n && !BY_NICK.has(n)) BY_NICK.set(n, r.id);
    }
  }
  return { byVlr: BY_VLR, byNick: BY_NICK };
}

/** Slug del jugador del catálogo para un jugador real, o `null` si no existe costura. */
export function catalogPlayerIdFor(player: { id: string; nick: string | null }, extraByNick?: Map<string, string>): string | null {
  const { byVlr, byNick } = index();
  const byId = byVlr.get(String(player.id));
  if (byId) return byId;
  const n = normNick(player.nick);
  if (!n) return null;
  return byNick.get(n) ?? extraByNick?.get(n) ?? null;
}

/** Cuántas filas conoce la costura (para pruebas y el informe). */
export const rosterBridgeSize = (): number => index().byVlr.size;
