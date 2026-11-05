/**
 * `/api/admin/operations` — EL SNAPSHOT DE LA SALA DE CONTROL (Fase 14, bloque 6).
 *
 *   GET ?window=24h|7d|30d → OperationsSnapshot
 *
 * ────────────────────────── AUTORIZACIÓN REAL ──────────────────────────
 *
 * `verifyAdmin(req)`: Bearer de Supabase Auth → usuario → `profiles.is_admin` comprobado
 * con `service_role`. La columna está protegida por el trigger `SEC-02` (migración 0009),
 * así que un jugador no puede concedérsela.
 *
 * **NO se usa `ADMIN_ENABLED`.** Esa constante lee `NEXT_PUBLIC_ADMIN`, es decir, una
 * variable que llega al navegador: sirve para ocultar un enlace, no para proteger un dato.
 * La pantalla la usa para no enseñar la sección; esta ruta no la mira siquiera.
 *
 * ────────────────────────── LOS TRES RESULTADOS ──────────────────────────
 *
 *   sin sesión            → 401
 *   con sesión, sin admin → 403
 *   admin                 → 200 con el snapshot
 *
 * Se distinguen 401 y 403 a propósito. Las rutas admin anteriores del proyecto devuelven
 * 401 en los dos casos; aquí se separa porque son cosas distintas —«no sé quién eres» y
 * «sé quién eres y no puedes»— y la pantalla necesita saber cuál es para decir lo correcto.
 * Ninguno de los dos devuelve ni un dato.
 *
 * ────────────────────────── LO QUE EL CLIENTE NO PUEDE ELEGIR ──────────────────────────
 *
 * Solo la ventana, y solo entre tres valores cerrados. No hay rango de fechas arbitrario,
 * no hay `user_id`, no hay filtro por entorno: un rango libre desde el navegador es una
 * consulta libre contra la base de datos. Un valor desconocido cae en `24h`, que es la
 * respuesta segura.
 *
 * ────────────────────────── SOLO AGREGADOS ──────────────────────────
 *
 * El snapshot no lleva identificadores de usuario, ni correos, ni IP, ni recorridos
 * individuales. Todo lo que devuelve son cifras de conjunto.
 */
import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { bearerToken } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOperationsSnapshot, isWindowKey } from "@/server/services/operations";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  // Sin Bearer no hay nada que comprobar: no sabemos quién pregunta.
  if (!bearerToken(req)) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  const admin = await verifyAdmin(req);
  if (!admin) {
    /*
     * 403 y no 401: hay un token, así que sabemos quién es. Lo que no tiene es permiso.
     *
     * El mensaje no dice si el token era inválido o si el usuario simplemente no es
     * administrador. Distinguirlo aquí serviría para averiguar quién lo es.
     */
    return NextResponse.json({ error: "Acceso restringido" }, { status: 403, headers: NO_STORE });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "Supabase admin no configurado" }, { status: 503, headers: NO_STORE },
    );
  }

  const raw = new URL(req.url).searchParams.get("window");
  const window = isWindowKey(raw) ? raw : "24h";

  try {
    const snapshot = await getOperationsSnapshot(sb, window);
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch (e) {
    /*
     * Aquí no debería llegarse: cada bloque del snapshot atrapa su propio fallo y la
     * consola está pensada para funcionar a medias. Si aun así revienta, se devuelve el
     * motivo y no una página en blanco.
     */
    return internalError("api/admin/operations", e, req);
  }
}
