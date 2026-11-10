/**
 * `/api/game/pickem-brackets` — F87 · PICK'EMS 2.0 (cuadros de predicción sobre eventos esports REALES).
 *
 *   GET                 → «Mis Pick'ems»: ámbitos publicados / liquidados (con sesión, mi progreso en cada uno)
 *   GET ?slug=<slug>    → un cuadro: descriptor congelado, partidos REALES, cierres, clasificación (nombre + #TAG) y,
 *                         con sesión, MIS picks + revisión + puntuación + reclamo
 *   POST { action: "pick", slug, matchId, teamId | null, revision }  → guarda / quita un pick (409 LOCKED / STALE)
 *   POST { action: "claim", slug }                                     → reclama la recompensa (exactamente una vez)
 *
 * Sin sesión el cuadro REAL es público (son datos esports públicos); los picks propios exigen sesión y nunca se
 * cachean entre cuentas (`private, no-store`). El cuerpo solo lleva un partido y un equipo: el servidor deriva los
 * participantes válidos del cuadro DEL JUGADOR; el cierre lo decide la BD con su reloj.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { claimBracket, getBracketView, listBrackets, savePick, type Result } from "@/server/services/pickemBrackets";
import { safeServerMessage } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
const PUBLIC = { "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" };
const bad = (error: string, status = 400, code?: string) => NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
const tooMany = (retryAfter: number) => NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });
const reply = <T,>(r: Result<T>, headers: Record<string, string> = NO_STORE) =>
  NextResponse.json(r.ok ? r.data : { ...safeServerMessage("api/game/pickem-brackets", r.status, r.error), code: r.code, ...(r.data ? { state: r.data } : {}) }, { status: r.ok ? 200 : r.status, headers: r.ok ? headers : NO_STORE });

function failed(e: unknown) {
  console.error("[pickem-brackets]", e);
  if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  return bad("Error de servidor", 500);
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MATCH = /^[A-Za-z0-9_-]{1,64}$/;
const TEAM = /^[A-Za-z0-9_.-]{1,64}$/;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const hasToken = !!req.headers.get("authorization");
  const session = hasToken ? await getSession(req) : null;
  if (hasToken && !session) return bad("No autenticado", 401);
  const sb = session?.admin ?? getSupabaseAdmin();
  if (!sb) return bad("Servidor sin configurar", 503);
  if (session) {
    const rate = await takeRate(session.admin, session.userId, "pickem_read");
    if (!rate.allowed) return tooMany(rate.retryAfter);
  }
  const viewer = session?.userId ?? null;
  // Sin sesión la respuesta es la misma para todos (cacheable un momento); con sesión, privada.
  const headers = viewer ? NO_STORE : PUBLIC;
  try {
    const slug = q.get("slug");
    if (slug !== null) {
      if (!SLUG.test(slug) || slug.length > 64) return bad("Pick'em no válido");
      return reply(await getBracketView(sb, slug, viewer), headers);
    }
    return reply(await listBrackets(sb, viewer), headers);
  } catch (e) {
    return failed(e);
  }
}

interface Body { action?: unknown; slug?: unknown; matchId?: unknown; teamId?: unknown; revision?: unknown }
const KEYS = new Set(["action", "slug", "matchId", "teamId", "revision"]);

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return bad("Cuerpo no válido"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  // Lista blanca: un «userId», un ganador real, unos puntos o un escalón en el cuerpo es un 400, no un campo ignorado.
  const extra = Object.keys(body).find((k) => !KEYS.has(k));
  if (extra) return bad(`Campo no permitido: ${extra.slice(0, 40)}`);
  const slug = typeof body.slug === "string" && SLUG.test(body.slug) && body.slug.length <= 64 ? body.slug : null;
  if (!slug) return bad("Pick'em no válido");
  try {
    if (body.action === "pick") {
      const matchId = typeof body.matchId === "string" && MATCH.test(body.matchId) ? body.matchId : null;
      if (!matchId) return bad("Partido no válido");
      const teamId = body.teamId === null ? null : typeof body.teamId === "string" && TEAM.test(body.teamId) ? body.teamId : undefined;
      if (teamId === undefined) return bad("Equipo no válido");
      const revision = Number.isInteger(body.revision) && (body.revision as number) >= 0 ? (body.revision as number) : null;
      if (revision === null) return bad("Falta la revisión");
      const rate = await takeRate(session.admin, session.userId, "pickem_write");
      if (!rate.allowed) return tooMany(rate.retryAfter);
      return reply(await savePick(session.admin, session.userId, slug, matchId, teamId, revision));
    }
    if (body.action === "claim") {
      if (body.matchId !== undefined || body.teamId !== undefined || body.revision !== undefined) return bad("Campos no permitidos en un reclamo");
      const rate = await takeRate(session.admin, session.userId, "economy_write");
      if (!rate.allowed) return tooMany(rate.retryAfter);
      return reply(await claimBracket(session.admin, session.userId, slug));
    }
    return bad("Acción no válida");
  } catch (e) {
    return failed(e);
  }
}
