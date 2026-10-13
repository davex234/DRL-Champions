/**
 * `/api/game/coach-matches` — EL HISTORIAL DE PARTIDOS DIRIGIDOS.
 *
 *   GET                → mis partidos (los más recientes primero) y mi balance
 *   POST { match }     → registrar un partido TERMINADO. Idempotente.
 *
 * ────────────────────────── POR QUÉ HAY RUTA Y NO ESCRITURA DIRECTA ──────────────────────────
 *
 * `coach_matches` no tiene política de `insert` y el permiso está revocado: por PostgREST no
 * se puede escribir ni una fila. Se escribe SOLO aquí, con `service_role`, y el `user_id` sale
 * del token — nunca del cuerpo.
 *
 * Leer sí es directo si alguien quiere: la política de `select` ya limita a lo propio, y leer
 * el historial de uno mismo no cambia nada. Esta ruta lo ofrece igual porque devuelve además
 * el balance ya calculado, y calcularlo en el cliente sería repetir la misma resta en dos
 * sitios.
 *
 * ────────────────────────── HASTA DÓNDE LLEGA LA AUTORIDAD ──────────────────────────
 *
 * El simulador del Entrenador corre en el navegador: es su diseño desde el principio y este
 * encargo prohíbe tocarlo. El servidor no puede, por tanto, recalcular el marcador — así que
 * lo que manda aquí es la IDENTIDAD (de quién es el partido), el PERMISO (que se pueda
 * escribir) y la FORMA (que los valores sean admisibles y coherentes entre sí).
 *
 * Es un historial personal, no un registro competitivo: no puntúa, no concede nada y no
 * alimenta ningún ranking. Las recompensas del partido siguen yendo por su camino de siempre.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import {
  validarPartido, registrarPartido, historial, balance, partidoPorId,
} from "@/server/services/coachMatches";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** Forma de un id de partido. Lo que no la tiene no llega a la base de datos. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * ────────────────────────── TECHO DE FRECUENCIA ──────────────────────────
 *
 * En memoria del proceso: el mismo patrón que `/api/telemetry`. Un partido dirigido dura
 * minutos, así que ni la revancha más rápida registra más de uno por minuto. Veinte deja margen
 * de sobra a los reintentos legítimos —que además son idempotentes— y corta un bucle de render
 * o un `curl` en bucle antes de llenar la tabla de filas con semillas inventadas.
 *
 * QUÉ NO PROTEGE: es por proceso y se reinicia con el servidor; con varias instancias el techo
 * se multiplica. Basta porque el peor caso de saltárselo son filas de más en el historial
 * PROPIO, que no puntúa, no concede nada y nadie más ve.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return false;
  }
  b.count++;
  return b.count > RATE_MAX;
}

export async function GET(req: Request): Promise<NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  const url = new URL(req.url);

  /*
   * FASE 51 · `?id=<uuid>`: UN partido, el del plan táctico. Inexistente, ajeno o id mal formado
   * responden IGUAL (404 «Partida no encontrada»): no se distingue «no existe» de «no es tuyo».
   */
  const unico = url.searchParams.get("id");
  if (unico !== null) {
    if (!UUID_RE.test(unico)) return NextResponse.json({ error: "Partida no encontrada" }, { status: 404, headers: NO_STORE });
    try {
      const fila = await partidoPorId(session.admin, session.userId, unico);
      if (!fila) return NextResponse.json({ error: "Partida no encontrada" }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ match: fila }, { headers: NO_STORE });
    } catch {
      return NextResponse.json({ error: "No se pudo leer la partida" }, { status: 500, headers: NO_STORE });
    }
  }

  const limite = Number(url.searchParams.get("limit") ?? 30);
  const desde = Number(url.searchParams.get("offset") ?? 0);
  try {
    /*
     * La página y el balance son dos lecturas a propósito. El balance es de TODOS los partidos;
     * sacarlo de la página lo dejaba clavado en su tamaño.
     */
    const [rows, record] = await Promise.all([
      historial(session.admin, session.userId, Number.isFinite(limite) ? limite : 30,
        Number.isFinite(desde) ? desde : 0),
      balance(session.admin, session.userId),
    ]);
    return NextResponse.json({ matches: rows, record, total: record.jugados }, { headers: NO_STORE });
  } catch {
    // Un fallo de lectura NO es «no has jugado». Se dice que ha fallado.
    return NextResponse.json({ error: "No se pudo leer el historial" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  if (rateLimited(session.userId)) {
    return NextResponse.json({ error: "Demasiados registros seguidos" }, { status: 429, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const val = validarPartido(body.match ?? body);
  if (!val.ok) {
    return NextResponse.json({ error: val.error }, { status: 400, headers: NO_STORE });
  }

  const r = await registrarPartido(session.admin, session.userId, val.value);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 500, headers: NO_STORE });
  }
  /*
   * 200 tanto si es nuevo como si ya estaba. Un 409 obligaría al cliente a tratar como error
   * lo que es el resultado correcto de recargar la pantalla final — y a acordarse de si ya
   * había guardado, que es justo lo que la idempotencia le ahorra.
   */
  return NextResponse.json({ match: r.row, duplicate: r.duplicado }, { headers: NO_STORE });
}
