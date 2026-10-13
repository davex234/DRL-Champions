/**
 * `/api/game/player` — PLAYER IDENTITY 2.0 (Fase 31). La identidad pública canónica.
 *
 *   GET ?id=<uuid>   → `PlayerIdentitySnapshot` (PUBLIC; SELF si el Bearer es de ese jugador)
 *   GET ?me=1        → la foto SELF del usuario del token (401 sin sesión)
 *   GET ?id=<uuid>&history=1[&before=<ms>]  → F89 · página siguiente del historial (las mismas reglas de visibilidad:
 *                                             un perfil ajeno nunca recibe duelos privados; inexistente → 404)
 *
 *   POST (solo con sesión, solo sobre uno mismo):
 *     { action: "set_showcase", cardUids: string[], expectedVersion: number | null }
 *     { action: "set_featured_achievements", achievementIds: string[], expectedVersion: number | null }
 *     { action: "set_avatar", avatar: string }
 *     { action: "set_featured_badges", badgeIds: string[], expectedVersion: number | null }        (F82)
 *     { action: "set_favorite_team", teamId: string | null, expectedVersion: number | null }      (F89)
 *
 * El `userId` sale SIEMPRE del token; el cuerpo nunca lleva de quién es el perfil. Cuerpo ESTRICTO:
 * claves desconocidas → 400. La propiedad de cada carta y el estado de cada logro los valida el
 * servidor (servicio + RPC en la misma transacción). Las lecturas se limitan por usuario o, sin
 * sesión, por una huella de la IP que no se guarda en claro.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getPlayerIdentity, getPlayerHistory, setShowcase, setFeaturedAchievements, setFeaturedBadges, setFavoriteTeam, setAvatar, type IdentityResult } from "@/server/services/playerIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string, status = 400, code?: string) => NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
const tooMany = (retryAfter: number) => NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });

/** Un fallo del backend nunca viaja crudo. */
const reply = <T,>(r: IdentityResult<T>) => {
  if (!r.ok && r.status >= 500 && r.code !== "NOT_READY") {
    console.error("[player]", r.error);
    return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
};

const anonSubject = (req: Request): string => {
  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "local").split(",")[0].trim();
  return `anon:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
};

export async function GET(req: Request) {
  const session = await getSession(req);
  const admin = session?.admin ?? getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  const q = new URL(req.url).searchParams;

  const rate = await takeRate(admin, session?.userId ?? anonSubject(req), "profile_read");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  try {
    if (q.has("me")) {
      if (!session) return bad("No autenticado", 401);
      return reply(await getPlayerIdentity(admin, session.userId, session.userId));
    }
    const id = q.get("id") ?? "";
    if (!UUID.test(id)) return bad("Jugador no válido");
    // F89 · historial paginado: solo `id`, `history` y un cursor numérico; cualquier otro parámetro → 400.
    if (q.has("history")) {
      if ([...q.keys()].some((k) => k !== "id" && k !== "history" && k !== "before")) return bad("Parámetro no válido");
      const raw = q.get("before");
      const before = raw === null ? null : Number(raw);
      if (before !== null && (!Number.isInteger(before) || before <= 0)) return bad("Cursor no válido");
      return reply(await getPlayerHistory(admin, session?.userId ?? null, id, before));
    }
    return reply(await getPlayerIdentity(admin, session?.userId ?? null, id));
  } catch (e) {
    console.error("[player]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Error de servidor", 500);
  }
}

const SCHEMA: Record<string, readonly string[]> = {
  set_showcase: ["action", "cardUids", "expectedVersion"],
  set_featured_achievements: ["action", "achievementIds", "expectedVersion"],
  set_avatar: ["action", "avatar"],
  // F82 · insignias destacadas (solo las que posees; lo comprueba el RPC).
  set_featured_badges: ["action", "badgeIds", "expectedVersion"],
  // F89 · equipo esports favorito (id del catálogo o null; lo valida el servidor).
  set_favorite_team: ["action", "teamId", "expectedVersion"],
};

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  let body: Record<string, unknown>;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Cuerpo no válido");
    body = parsed as Record<string, unknown>;
  } catch { return bad("Cuerpo no válido"); }

  const action = typeof body.action === "string" ? body.action : "";
  const allowed = SCHEMA[action];
  if (!allowed) return bad("Acción no válida");
  if (Object.keys(body).some((k) => !allowed.includes(k))) return bad("Campos no permitidos", 400, "BAD_BODY");

  const rate = await takeRate(session.admin, session.userId, "profile_write");
  if (!rate.allowed) return tooMany(rate.retryAfter);

  const { admin, userId } = session;
  try {
    switch (action) {
      case "set_showcase": return reply(await setShowcase(admin, userId, body.cardUids, body.expectedVersion));
      case "set_featured_achievements": return reply(await setFeaturedAchievements(admin, userId, body.achievementIds, body.expectedVersion));
      case "set_avatar": return reply(await setAvatar(admin, userId, body.avatar));
      case "set_featured_badges": return reply(await setFeaturedBadges(admin, userId, body.badgeIds, body.expectedVersion));
      case "set_favorite_team": return reply(await setFavoriteTeam(admin, userId, body.teamId, body.expectedVersion));
      default: return bad("Acción no válida");
    }
  } catch (e) {
    console.error("[player]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Error de servidor", 500);
  }
}
