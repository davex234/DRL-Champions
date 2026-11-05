/**
 * `GET /api/game/competitive` — COMPETITIVO / RANKED 2.0 (Fase 28). SOLO LECTURA.
 *
 *   GET                              → `CompetitiveSnapshot` (yo, escalera top, alrededor, historial reciente, evolución, cartas, recompensas)
 *   GET ?top=50                      → tamaño del top (acotado a 50)
 *   GET ?history=1[&before=<ms>]     → página del historial (cursor por `updated_at`, ≤ 20)
 *   GET ?match=<uuid>                → detalle de UNA partida terminada (solo sus dos jugadores; 404 al resto)
 *   GET ?player=<uuid>               → perfil competitivo público de un jugador (+ cara a cara conmigo)
 *   GET ?position=1                  → solo mi posición actual (foto barata para el post-partida)
 *   GET ?ladder=1[&offset=N&size=M]  → FASE 55 · una página de la escalera (≤ 50 filas, offset alineado)
 *   GET ?matchup=<uuid>              → FASE 55 · «rival encontrado»: los dos lados de una partida ranked (solo sus jugadores)
 *
 * No existe POST: nada aquí escribe rating, posición ni resultado. El `userId` sale del token.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import {
  getCompetitiveSnapshot, getCompetitiveHistory, getCompetitiveMatch, getCompetitivePlayer, getCompetitivePosition,
  getCompetitiveLadderPage, getCompetitiveMatchup,
} from "@/server/services/competitive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Sin caché HTTP: la posición y el rating propios deben verse recién liquidados nada más terminar
 * una partida. El top público podría cachearse unos segundos; se deja como P2 (no hay capa de
 * caché en la arquitectura actual y una cabecera compartida arrastraría también la posición propia).
 */
const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FASE 33 · Un 5xx del servicio lleva `e.message` (texto de Supabase/PostgREST): se registra en servidor y
 * al cliente viaja un texto genérico. Los 4xx (404 de no participante, 400) sí son mensajes de producto.
 */
function reply<T>(r: { ok: boolean; status: number; error?: string; code?: string; data?: T }) {
  if (r.ok) return NextResponse.json(r.data, { status: r.status, headers: NO_STORE });
  if (r.status >= 500) {
    console.error("[competitive]", r.error);
    return NextResponse.json({ error: "Error de servidor" }, { status: r.status, headers: NO_STORE });
  }
  return NextResponse.json(r.code ? { error: r.error, code: r.code } : { error: r.error }, { status: r.status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  const url = new URL(req.url);
  const q = url.searchParams;

  try {
    if (q.has("match")) {
      const id = q.get("match") ?? "";
      if (!UUID.test(id)) return NextResponse.json({ error: "Partida no válida" }, { status: 400, headers: NO_STORE });
      return reply(await getCompetitiveMatch(session.admin, session.userId, id));
    }
    if (q.has("player")) {
      const id = q.get("player") ?? "";
      if (!UUID.test(id)) return NextResponse.json({ error: "Jugador no válido" }, { status: 400, headers: NO_STORE });
      return reply(await getCompetitivePlayer(session.admin, session.userId, id));
    }
    if (q.has("history")) {
      const before = Number(q.get("before"));
      // Fase 55 · sin parámetro, `Number(null)` es 0 y `clampLimit` lo subía a 1: solo se parsea si viene.
      const limit = q.has("limit") ? Number(q.get("limit")) : NaN;
      return reply(await getCompetitiveHistory(session.admin, session.userId, {
        before: Number.isFinite(before) && before > 0 ? before : null,
        limit: Number.isFinite(limit) ? limit : undefined,
      }));
    }
    if (q.has("position")) {
      return reply(await getCompetitivePosition(session.admin, session.userId));
    }
    if (q.has("matchup")) {
      const id = q.get("matchup") ?? "";
      if (!UUID.test(id)) return NextResponse.json({ error: "Partida no válida" }, { status: 400, headers: NO_STORE });
      return reply(await getCompetitiveMatchup(session.admin, session.userId, id));
    }
    if (q.has("ladder")) {
      // El servicio acota (`ladderPage`): un offset o tamaño absurdo se recorta, nunca descarga la escalera.
      return reply(await getCompetitiveLadderPage(session.admin, session.userId, { offset: q.get("offset"), size: q.get("size") }));
    }
    // Fase 55 · BUG de la Fase 28: sin `?top`, `Number(null)` = 0 → `clampLimit` → escalera de UNA fila.
    const top = q.has("top") ? Number(q.get("top")) : NaN;
    return reply(await getCompetitiveSnapshot(session.admin, session.userId, { top: Number.isFinite(top) ? top : undefined }));
  } catch (e) {
    console.error("[competitive]", e);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500, headers: NO_STORE });
  }
}
