/**
 * `/api/telemetry` — LA ÚNICA PUERTA DE ESCRITURA DE TELEMETRÍA (Fase 14, bloque 4).
 *
 *   POST { event_name, session_id?, zone?, flow?, source?, severity?, metadata? } → 204
 *
 * ────────────────────────── POR QUÉ HAY RUTA SI LA TABLA EXISTE ──────────────────────────
 *
 * Porque el cliente no puede escribir en `telemetry_events` — y no debe. La migración 0029
 * le retira todos los privilegios a `anon` y `authenticated`, así que esta ruta es
 * literalmente el único camino. Eso es deliberado: si el navegador pudiera insertar,
 * cualquiera podría inflar las métricas o meter texto en `metadata` para que lo leyera
 * después un panel de administración.
 *
 * Y porque RLS filtra FILAS, no CONTENIDO. Aquí se aplica la lista blanca de claves, se
 * redactan los secretos por forma y se recorta el tamaño ANTES de escribir. Lo que llega a
 * la base de datos es lo que el contrato aprueba, no lo que manda el navegador.
 *
 * ────────────────────────── LO QUE EL SERVIDOR NO ACEPTA DEL CLIENTE ──────────────────────────
 *
 *   user_id       — sale del Bearer con `getSession`. Un `userId` en el cuerpo es
 *                   exactamente el vector que permite escribir en nombre de otro.
 *   occurred_at   — lo pone el `default now()` de la tabla. El reloj de un navegador
 *                   puede estar mal puesto, en otra zona horaria, o mentir a propósito.
 *   environment   — sale de `NODE_ENV`. Si viniera del cuerpo, cualquiera podría marcar
 *                   sus eventos como `production` desde su portátil.
 *   app_version   — sale de `src/platform/version.ts`, la fuente canónica del proyecto.
 *
 * Si alguno de esos cuatro llega en el cuerpo, **se ignora en silencio**. No se rechaza la
 * petición: un cliente antiguo que mande un campo de más no debe perder el evento.
 *
 * ────────────────────────── ANÓNIMO SÍ ──────────────────────────
 *
 * NEXUS funciona sin cuenta en `/inventario` y `/coleccion` (modo local de un jugador,
 * verificado en la Fase 13). Un visitante sin sesión genera eventos legítimos con
 * `user_id = null`. Rechazarlos dejaría ciego justo el tramo anterior al registro, que es
 * la mitad del embudo de primera experiencia.
 *
 * ────────────────────────── TELEMETRÍA NO ES AUTORIDAD ──────────────────────────
 *
 * Esta ruta no concede nada, no lee nada del jugador y no devuelve nada. Su respuesta es
 * `204 No Content` incluso cuando la escritura falla, porque el cliente no tiene ninguna
 * decisión que tomar con esa información y sí tiene un producto que seguir mostrando.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { APP_VERSION } from "@/platform/version";
import {
  isEventName, isZone, isFlow, isSource, isSeverity, isUuid,
  sanitizeMetadata, shapeError, type TelemetryInput,
} from "@/lib/telemetry/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Cuerpo máximo. Un evento saneado no pasa de ~1 KB; 8 KB es margen de sobra. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * ENTORNO. Del servidor, nunca del cuerpo.
 *
 * `NODE_ENV` es la convención que el proyecto ya usa (`src/config/admin.ts`,
 * `RegisterSW.tsx`) y sus tres valores coinciden con el CHECK de la migración.
 */
function environment(): "development" | "test" | "production" {
  const e = process.env.NODE_ENV;
  return e === "production" ? "production" : e === "test" ? "test" : "development";
}

/* ═══════════════════════════ LÍMITE DE FRECUENCIA ═══════════════════════════
 *
 * En memoria del proceso, sin infraestructura. La auditoría del bloque 1 encontró que el
 * único límite de frecuencia del proyecto vive en SQL (`_check_rate` cuenta filas de
 * `market_audit` en la última hora), y ese patrón no encaja aquí: contar filas antes de
 * cada inserción DUPLICARÍA el trabajo de base de datos del endpoint de mayor volumen del
 * producto, para proteger una tabla que no decide nada.
 *
 * Qué protege de verdad: un bucle de render que dispare mil eventos, un reintento
 * enloquecido, o alguien curioseando con `curl`. Para eso basta una ventana deslizante.
 *
 * QUÉ NO PROTEGE, dicho claramente: es por proceso y se reinicia con el servidor. Con
 * varias instancias, el límite efectivo se multiplica por el número de instancias. Es
 * suficiente porque el peor caso de saltárselo son filas de más en una tabla con retención
 * de 90 días — no un crédito, ni un punto, ni una carta. Documentado en INGESTION.md.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120; // ~2 por segundo sostenido; una sesión real hace ~20 por minuto
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Barrido perezoso: sin esto el Map crecería para siempre con sesiones muertas.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return false;
  }
  b.count++;
  return b.count > RATE_MAX;
}

export async function POST(req: Request) {
  // ── 1. Tamaño, antes de leer nada ──
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413, headers: NO_STORE });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413, headers: NO_STORE });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400, headers: NO_STORE });
  }
  const raw = body as Record<string, unknown>;

  // ── 2. Conjuntos cerrados ──
  //
  // Se RECHAZA un valor desconocido en vez de reetiquetarlo como `other` en silencio.
  // Fallar en voz alta durante el desarrollo es lo que impide que la taxonomía se
  // corrompa: un `zone` mal escrito que se guarda como `other` no se descubre nunca.
  if (!isEventName(raw.event_name)) {
    return NextResponse.json({ error: "event_name no válido" }, { status: 400, headers: NO_STORE });
  }
  if (raw.zone !== undefined && !isZone(raw.zone)) {
    return NextResponse.json({ error: "zone no válida" }, { status: 400, headers: NO_STORE });
  }
  if (raw.flow !== undefined && !isFlow(raw.flow)) {
    return NextResponse.json({ error: "flow no válido" }, { status: 400, headers: NO_STORE });
  }
  if (raw.source !== undefined && !isSource(raw.source)) {
    return NextResponse.json({ error: "source no válido" }, { status: 400, headers: NO_STORE });
  }
  if (raw.severity !== undefined && !isSeverity(raw.severity)) {
    return NextResponse.json({ error: "severity no válida" }, { status: 400, headers: NO_STORE });
  }
  if (raw.session_id !== undefined && !isUuid(raw.session_id)) {
    return NextResponse.json({ error: "session_id no válido" }, { status: 400, headers: NO_STORE });
  }

  const input: TelemetryInput = {
    event_name: raw.event_name,
    session_id: raw.session_id as string | undefined,
    zone: raw.zone as TelemetryInput["zone"],
    flow: raw.flow as TelemetryInput["flow"],
    source: raw.source as TelemetryInput["source"],
    severity: raw.severity as TelemetryInput["severity"],
    metadata: raw.metadata as Record<string, unknown> | undefined,
  };

  // ── 3. Coherencia entre campos (la misma que el CHECK de 0029) ──
  const bad = shapeError(input);
  if (bad) return NextResponse.json({ error: bad }, { status: 400, headers: NO_STORE });

  // ── 4. Identidad: del token, jamás del cuerpo ──
  //
  // `getSession` devuelve null sin Bearer válido, y eso NO es un error: es un visitante
  // anónimo, que genera eventos igual de legítimos con `user_id = null`.
  const session = await getSession(req).catch(() => null);
  const userId = session?.userId ?? null;

  // ── 5. Frecuencia ──
  //
  // Por sesión cuando la hay, porque es lo que identifica a un cliente concreto; por
  // usuario si no; y una cubeta compartida para lo que no trae ninguna de las dos, que no
  // debería existir pero no puede quedar sin techo.
  const key = input.session_id ?? userId ?? "sin-identificar";
  if (rateLimited(key)) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }

  // ── 6. Escritura ──
  const admin = getSupabaseAdmin();
  if (!admin) {
    // Sin configuración de servidor no se escribe nada, y tampoco se rompe nada.
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }

  try {
    await admin.from("telemetry_events").insert({
      event_name: input.event_name,
      user_id: userId,
      session_id: input.session_id ?? null,
      zone: input.zone ?? null,
      flow: input.flow ?? null,
      source: input.source ?? null,
      severity: input.severity ?? null,
      environment: environment(),
      app_version: APP_VERSION,
      metadata: sanitizeMetadata(input.event_name, input.metadata),
      // `occurred_at` no se envía: lo pone el `default now()` de la tabla.
    });
  } catch {
    /*
     * AISLAMIENTO DE FALLOS.
     *
     * Si la base de datos falla, el jugador no se entera y no debe enterarse. Registrar
     * telemetría es lo MENOS importante que hace este servidor: perder un evento es
     * gratis, y devolver un error aquí solo conseguiría que el cliente reintentara o
     * —peor— que capturara ese fallo como otro evento de error.
     */
  }

  // Nada que devolver. Ni un dato, ni un id, ni una confirmación que alguien pudiera
  // acabar usando para algo.
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
