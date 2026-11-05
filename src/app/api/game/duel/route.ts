/**
 * `/api/game/duel` — LA PARTIDA (Fase 8).
 *
 *   POST { action: "start",   deckId, difficulty }
 *   POST { action: "play",    matchId, cardUid, stat? }   ← `stat` solo cuando atacas
 *   POST { action: "state",   matchId }
 *   POST { action: "active"  }                            ← partida en curso, para retomar
 *   POST { action: "replay",  matchId }
 *   POST { action: "replays" }
 *   POST { action: "abandon", matchId }
 *
 * TODO ocurre en servidor: el mazo se resuelve contra el inventario real, las semillas se generan
 * aquí y no salen, el orquestador decide qué es legal y el Combat Resolver decide quién gana. La
 * respuesta es siempre la proyección REDACTADA: nunca contiene las cartas no jugadas del rival.
 *
 * Defendiendo, el cliente NO envía estadística: la impone la tabla del documento de diseño.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import {
  startMatch, playTurn, getMatch, getActiveMatch, getReplay, listReplays, abandonMatch,
} from "@/server/services/duels";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATS = new Set(["stronghold", "gamesense", "entryfrag"]);

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const action = typeof body.action === "string" ? body.action : "";
  const matchId = typeof body.matchId === "string" && UUID.test(body.matchId) ? body.matchId : "";

  try {
    switch (action) {
      case "start": {
        const deckId = typeof body.deckId === "string" && UUID.test(body.deckId) ? body.deckId : "";
        const difficulty = typeof body.difficulty === "string" ? body.difficulty : "";
        if (!deckId) return bad("Equipo no válido");
        return send(await startMatch(session.admin, session.userId, deckId, difficulty));
      }

      case "play": {
        if (!matchId) return bad("Partida no válida");
        // `uid` puede ser un uuid (tus cartas) — las del rival nunca las envía el cliente.
        const cardUid = typeof body.cardUid === "string" && UUID.test(body.cardUid) ? body.cardUid : "";
        if (!cardUid) return bad("Carta no válida");
        const raw = typeof body.stat === "string" ? body.stat : undefined;
        const stat = raw && STATS.has(raw) ? raw : undefined;
        if (raw && !stat) return bad("Estadística no válida");
        // F67 · versión que el cliente veía (opcional: un cliente antiguo sin ella conserva el comportamiento anterior).
        const ev = body.expectedVersion;
        const expectedVersion = typeof ev === "number" && Number.isInteger(ev) && ev >= 0 ? ev : undefined;
        if (ev !== undefined && expectedVersion === undefined) return bad("Versión de estado no válida");
        return send(await playTurn(session.admin, session.userId, matchId, cardUid, stat, expectedVersion));
      }

      case "state":
        if (!matchId) return bad("Partida no válida");
        return send(await getMatch(session.admin, session.userId, matchId));

      case "active":
        return send(await getActiveMatch(session.admin, session.userId));

      case "replay":
        if (!matchId) return bad("Partida no válida");
        return send(await getReplay(session.admin, session.userId, matchId));

      case "replays":
        return send(await listReplays(session.admin, session.userId));

      case "abandon":
        if (!matchId) return bad("Partida no válida");
        return send(await abandonMatch(session.admin, session.userId, matchId));

      default:
        return bad("Acción inválida");
    }
  } catch (e) {
    // FASE 33 · un fallo interno nunca viaja crudo al cliente.
    console.error("[duel]", e);
    return NextResponse.json({ error: "Error en la partida" }, { status: 500 });
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

function send<T>(r: { ok: boolean; status: number; error?: string; code?: string; data?: T }) {
  if (!r.ok && r.status >= 500) {
    console.error("[duel]", r.error);
    return NextResponse.json({ error: "Error en la partida" }, { status: r.status });
  }
  // F66 · un conflicto viaja con su código y, si lo hay, con el estado REAL para que el cliente se resincronice.
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}), ...(r.data ? r.data as object : {}) }, { status: r.status, headers: NO_STORE });
  return NextResponse.json(r.data, { headers: NO_STORE });
}
