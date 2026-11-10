/**
 * `/api/game/social` — SOCIAL 1.0 (Fase 29). Amigos, presencia, retos y duelos privados.
 *
 *   GET                      → `SocialSnapshot` (yo, amigos con presencia, solicitudes, retos, rivales recientes, bandeja, badge)
 *   GET ?badge=1             → solo el número de la navegación (barato)
 *   GET ?q=<texto>           → búsqueda ACOTADA por nombre de usuario (≥ 2 letras, ≤ 10, sin correo)
 *   GET ?player=<uuid>       → perfil social de un jugador (relación, presencia, cara a cara RANKED/PRIVADO/TOTAL)
 *   GET ?match=<uuid>        → quién hay enfrente en un duelo de dos personas + cara a cara (solo sus dos jugadores)
 *   GET ?friends=1&offset=N  → F85 · página de amigos (≤ 100)
 *   GET ?compare=<uuid>      → F85 · comparación lado a lado con SOLO datos públicos (sin puntuación compuesta)
 *   GET ?q=<texto>&offset=N  → F85 · búsqueda paginada (10 por página, ≤ 5 páginas)
 *   POST { action: "pulse" } → F85 · latido + contador + retos en curso (una petición cada 20 s por pestaña visible)
 *
 *   POST { action, targetUserId?, challengeId?, deckId?, previousMatchId? }
 *     friend_request · friend_accept · friend_decline · unfriend · block · unblock
 *     challenge_create · challenge_accept · challenge_decline · challenge_cancel · heartbeat
 *
 * El `userId` sale SIEMPRE del token. El cuerpo solo lleva ids: nunca bandos, nunca resultados,
 * nunca «quién es amigo de quién». Cada transición la decide una RPC atómica en Postgres.
 * Un duelo privado nace en el servidor con `mode = 'PVP_PRIVATE'` y NUNCA liquida rating.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import {
  takeRate, maybeSweepRates, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE, type RateBucket,
} from "@/server/services/rateLimit";
import {
  getSocialSnapshot, getSocialBadge, searchPlayers, getSocialPlayer, getPrivateMatchInfo, heartbeat, socialPulse, getFriendsPage, getSocialCompare,
  friendRequest, respondFriend, unfriend, blockPlayer, unblockPlayer,
  createChallenge, respondChallenge, cancelChallenge, type SocialResult,
} from "@/server/services/social";
import { safeServerMessage } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string, status = 400, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
const tooMany = (retryAfter: number) =>
  NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });
// F67 · un fallo ≥ 500 del servicio no viaja crudo (era `error.message` de la BD): texto genérico con código de error.
const reply = <T,>(r: SocialResult<T>) =>
  NextResponse.json(r.ok ? r.data : { ...safeServerMessage("api/game/social", r.status, r.error), code: r.code }, { status: r.status, headers: NO_STORE });

function failed(e: unknown) {
  console.error("[social]", e);
  if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  return bad("Error de servidor", 500);
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  const q = new URL(req.url).searchParams;

  const bucket: RateBucket = q.has("q") ? "social_search" : "social_read";
  const rate = await takeRate(session.admin, session.userId, bucket);
  if (!rate.allowed) return tooMany(rate.retryAfter);
  void maybeSweepRates(session.admin);

  try {
    if (q.has("q")) return reply(await searchPlayers(session.admin, session.userId, q.get("q"), { offset: q.get("offset") }));
    if (q.has("friends")) return reply(await getFriendsPage(session.admin, session.userId, q.get("offset")));
    if (q.has("compare")) {
      const id = q.get("compare") ?? "";
      if (!UUID.test(id)) return bad("Jugador no válido");
      return reply(await getSocialCompare(session.admin, session.userId, id));
    }
    if (q.has("player")) {
      const id = q.get("player") ?? "";
      if (!UUID.test(id)) return bad("Jugador no válido");
      return reply(await getSocialPlayer(session.admin, session.userId, id));
    }
    if (q.has("match")) {
      const id = q.get("match") ?? "";
      if (!UUID.test(id)) return bad("Partida no válida");
      return reply(await getPrivateMatchInfo(session.admin, session.userId, id));
    }
    if (q.has("badge")) return reply(await getSocialBadge(session.admin, session.userId));
    return reply(await getSocialSnapshot(session.admin, session.userId));
  } catch (e) {
    return failed(e);
  }
}

const ACTIONS = new Set([
  "friend_request", "friend_accept", "friend_decline", "unfriend", "block", "unblock",
  "challenge_create", "challenge_accept", "challenge_decline", "challenge_cancel", "heartbeat", "pulse",
]);

interface Body { action?: unknown; targetUserId?: unknown; challengeId?: unknown; deckId?: unknown; previousMatchId?: unknown }

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  let body: Body;
  // FULL GAME AUDIT · `null`/no-objeto: 400 (antes TypeError → 500).
  const parsedBody = await readJsonObject<Body>(req);
  if (!parsedBody) return bad("Cuerpo no válido");
  body = parsedBody;
  const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : null;
  if (!action) return bad("Acción no válida");

  // Cubeta por tipo de acción; el sujeto es el usuario del Bearer, nunca algo que elija el cliente.
  const rate = await takeRate(session.admin, session.userId, action === "heartbeat" || action === "pulse" ? "social_heartbeat" : "social_write");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  const target = typeof body.targetUserId === "string" ? body.targetUserId : "";
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const deckId = typeof body.deckId === "string" ? body.deckId : null;
  const previousMatchId = typeof body.previousMatchId === "string" ? body.previousMatchId : null;
  const { admin, userId } = session;

  try {
    switch (action) {
      case "heartbeat": return reply(await heartbeat(admin, userId));
      case "pulse": return reply(await socialPulse(admin, userId));
      case "friend_request": return reply(await friendRequest(admin, userId, target));
      case "friend_accept": return reply(await respondFriend(admin, userId, target, true));
      case "friend_decline": return reply(await respondFriend(admin, userId, target, false));
      case "unfriend": return reply(await unfriend(admin, userId, target));
      case "block": return reply(await blockPlayer(admin, userId, target));
      case "unblock": return reply(await unblockPlayer(admin, userId, target));
      case "challenge_create":
        return reply(await createChallenge(admin, userId, { targetUserId: target, deckId: deckId ?? "", previousMatchId }));
      case "challenge_accept": return reply(await respondChallenge(admin, userId, { challengeId, accept: true, deckId }));
      case "challenge_decline": return reply(await respondChallenge(admin, userId, { challengeId, accept: false }));
      case "challenge_cancel": return reply(await cancelChallenge(admin, userId, challengeId));
      default: return bad("Acción no válida");
    }
  } catch (e) {
    return failed(e);
  }
}
