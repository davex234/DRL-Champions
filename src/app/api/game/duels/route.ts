/**
 * `/api/game/duels` — MAZOS / EQUIPOS del usuario autenticado (Fase 8, extendida en la Fase 32).
 *
 *   GET → `DeckWorkspaceDTO` { decks, collection, activeDeckId, activeSupported, maxDecks, serverNow }
 *         (compatible con la forma anterior { decks, collection }).
 *
 *   POST (cuerpo ESTRICTO por acción, ver `parseDeckRequest`):
 *     { action: "save",             id?, name, cardUids }                 ← Fase 8 (hoja «Añadir al equipo»)
 *     { action: "save_composition", id, name, cardUids, expectedVersion } ← guardado atómico del constructor
 *     { action: "create",           name?, cardUids? }
 *     { action: "rename",           id, name, expectedVersion }
 *     { action: "duplicate",        id }
 *     { action: "delete",           id, expectedVersion?, confirmActive? }
 *     { action: "set_active",       id, expectedVersion? }
 *
 * El usuario sale SIEMPRE del token, nunca del cuerpo. La propiedad de cada carta se comprueba contra
 * `user_cards`; un equipo de otro responde 404. Lecturas y escrituras con cubeta propia (`deck_read`,
 * `deck_write`). Un fallo del backend nunca viaja crudo: 503 genérico.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { saveDeck } from "@/server/services/duels";
import {
  getDeckWorkspace, saveComposition, createTeam, renameTeam, duplicateTeam, deleteTeam, setActiveTeam, type TeamResult,
} from "@/server/services/deckTeams";
import { parseDeckRequest } from "@/domain/deckBuilder/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const unavailable = () => NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
const tooMany = (retryAfter: number) => NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });

function reply<T>(r: TeamResult<T>) {
  if (!r.ok && r.status >= 500 && r.code !== "NOT_READY") {
    console.error("[duels]", r.error);
    return unavailable();
  }
  if (!r.ok) {
    const extra = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : {};
    return NextResponse.json({ ...extra, error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
  }
  return NextResponse.json(r.data, { headers: NO_STORE });
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rate = await takeRate(session.admin, session.userId, "deck_read");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  try {
    return reply(await getDeckWorkspace(session.admin, session.userId));
  } catch (e) {
    console.error("[duels]", e);
    return unavailable();
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rate = await takeRate(session.admin, session.userId, "deck_write");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const parsed = parseDeckRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400, headers: NO_STORE });
  const r = parsed.req;
  const { admin, userId } = session;

  try {
    switch (r.action) {
      case "save":
        return reply(await saveDeck(admin, userId, { id: r.id, name: r.name, cardUids: r.cardUids }) as TeamResult<unknown>);
      case "save_composition":
        return reply(await saveComposition(admin, userId, { id: r.id, name: r.name, cardUids: r.cardUids, expectedVersion: r.expectedVersion }));
      case "create":
        return reply(await createTeam(admin, userId, { name: r.name, cardUids: r.cardUids }));
      case "rename":
        return reply(await renameTeam(admin, userId, { id: r.id, name: r.name, expectedVersion: r.expectedVersion }));
      case "duplicate":
        return reply(await duplicateTeam(admin, userId, r.id));
      case "delete":
        return reply(await deleteTeam(admin, userId, { id: r.id, expectedVersion: r.expectedVersion, confirmActive: r.confirmActive }));
      case "set_active":
        return reply(await setActiveTeam(admin, userId, { id: r.id, expectedVersion: r.expectedVersion }));
    }
  } catch (e) {
    console.error("[duels]", e);
    if (isDependencyDown(e)) return unavailable();
    return unavailable();
  }
}
