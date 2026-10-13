/**
 * `/api/game/cups` — F86 · TORNEOS DE JUGADORES («copas»; en la interfaz, «Torneos»).
 *
 *   GET                    → hub: en inscripción, próximos, en curso, finalizados (paginado), mis torneos, mi cruce listo
 *   GET ?archive=N         → hub con la página N del archivo de finalizados
 *   GET ?slug=<slug>       → ficha: cabecera, reglas, horario, participantes (identidad pública), CUADRO entero y mi estado
 *   GET ?status=1          → (con sesión) F86.1 · estado LIGERO: mi cruce vivo (listo/esperando/en juego/plazo), nivel de
 *                            sondeo y nº de cruces que piden acción (`?badge=1` es el mismo, por compatibilidad)
 *   POST { action: "register" | "withdraw", slug }
 *   POST { action: "ready", slug, round, slot, deckId }   → «estoy listo»: WAITING o STARTED (+ id de la partida)
 *
 * El cuadro es PÚBLICO (sin sesión también: identidad pública, sin ids). Con sesión se añade «mi» estado. El cuerpo
 * solo lleva un slug, un cruce (ronda + posición) y un id de equipo: nunca un ganador, un seed, una ronda a la que
 * avanzar ni un trofeo. Todo lo que cambia la competición lo decide la BD (0069).
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getCupHub, getCupDetail, getCupBadge, registerCup, readyCupMatch, type CupResult } from "@/server/services/cups";
import { safeServerMessage } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const bad = (error: string, status = 400, code?: string) => NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
const tooMany = (retryAfter: number) => NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(retryAfter) });
const reply = <T,>(r: CupResult<T>) =>
  NextResponse.json(r.ok ? r.data : { ...safeServerMessage("api/game/cups", r.status, r.error), code: r.code }, { status: r.status, headers: NO_STORE });

function failed(e: unknown) {
  console.error("[cups]", e);
  if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  return bad("Error de servidor", 500);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  // Con token: sesión verificada (y su límite). Sin token: lectura pública del mismo cuadro, sin «mi» estado.
  const hasToken = !!req.headers.get("authorization");
  const session = hasToken ? await getSession(req) : null;
  if (hasToken && !session) return bad("No autenticado", 401);
  const sb = session?.admin ?? getSupabaseAdmin();
  if (!sb) return bad("Servidor sin configurar", 503);
  if (session) {
    const rate = await takeRate(session.admin, session.userId, q.has("status") || q.has("badge") ? "cup_status" : "cup_read");
    if (!rate.allowed) return tooMany(rate.retryAfter);
  }
  const viewer = session?.userId ?? null;
  try {
    // F86.1 · estado LIGERO (sin cuadro): lo sondea el armazón y la espera del rival, a ritmo adaptativo.
    if (q.has("badge") || q.has("status")) {
      if (!viewer) return bad("No autenticado", 401);
      return reply(await getCupBadge(sb, viewer));
    }
    if (q.has("slug")) return reply(await getCupDetail(sb, viewer, q.get("slug")));
    return reply(await getCupHub(sb, viewer, { offset: q.get("archive") }));
  } catch (e) {
    return failed(e);
  }
}

interface Body { action?: unknown; slug?: unknown; round?: unknown; slot?: unknown; deckId?: unknown }
const ACTIONS = new Set(["register", "withdraw", "ready"]);
const KEYS = new Set(["action", "slug", "round", "slot", "deckId"]);

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return bad("Cuerpo no válido"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  // Lista blanca: un ganador, un seed o un «userId» en el cuerpo es un 400, no un campo ignorado.
  const extra = Object.keys(body).find((k) => !KEYS.has(k));
  if (extra) return bad(`Campo no permitido: ${extra.slice(0, 40)}`);
  const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : null;
  if (!action) return bad("Acción no válida");
  const rate = await takeRate(session.admin, session.userId, "cup_write");
  if (!rate.allowed) return tooMany(rate.retryAfter);
  try {
    if (action === "ready") return reply(await readyCupMatch(session.admin, session.userId, { slug: body.slug, round: body.round, slot: body.slot, deckId: body.deckId }));
    return reply(await registerCup(session.admin, session.userId, body.slug, action === "register"));
  } catch (e) {
    return failed(e);
  }
}
