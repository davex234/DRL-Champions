/**
 * GET /api/admin/session — LA AUTORIDAD de «¿esta persona es administradora?» (V-1).
 *
 * ────────────────────────── EL PROBLEMA QUE CIERRA ──────────────────────────
 *
 * Hasta este bloque, `/admin/*` se protegía con `ADMIN_ENABLED`, que es
 * `process.env.NEXT_PUBLIC_ADMIN === "1" || NODE_ENV !== "production"`: una constante
 * PÚBLICA que viaja en el bundle del navegador. Eso no es una comprobación de acceso, es
 * una preferencia de compilación. Cualquiera con la variable puesta en el despliegue podía
 * cargar la interfaz de administración entera.
 *
 * Esta ruta es la comprobación que faltaba, y **se ejecuta en el servidor**: resuelve el
 * Bearer contra GoTrue y consulta `profiles.is_admin` con `service_role`, reutilizando
 * `verifyAdmin` —el mismo que ya protege `/api/admin/{assets,operations,releases,
 * tournaments}`— en vez de inventar una segunda vía de autenticación.
 *
 * ────────────────────────── POR QUÉ UNA RUTA Y NO UN MIDDLEWARE ──────────────────────────
 *
 * Conviene decirlo con precisión, porque es una decisión de arquitectura y tiene un
 * porqué medible: **en este proyecto la sesión de Supabase vive en `localStorage`, no en
 * una cookie** (`lib/supabase/client.ts`, `persistSession: true` con el almacenamiento por
 * defecto del SDK; no se usa `@supabase/ssr` y no hay ni una cookie de auth en el código).
 *
 * Un `middleware.ts` y un layout de servidor solo ven cabeceras y cookies. Sin cookie de
 * sesión **no pueden saber quién pide la página**: devolverían siempre «anónimo» y
 * bloquearían también a los administradores legítimos. Montar cookies de sesión sería
 * cambiar la arquitectura de autenticación del producto entero — precisamente lo que este
 * bloque pide no hacer («no crear una arquitectura de auth paralela»).
 *
 * Así que la comprobación se hace donde SÍ llega el token: en una petición con
 * `Authorization: Bearer`. El navegador no decide nada; solo transporta el token y obedece
 * la respuesta. Y la barrera de verdad —la que importa aunque alguien se salte la
 * interfaz— sigue siendo que TODAS las rutas `/api/admin/*` verifican por su cuenta.
 * La interfaz no guarda secretos: los pide, y esta ruta decide si se los dan.
 *
 * Respuestas: 200 `{ admin: true, userId }` · 401 `{ admin: false }` en cualquier otro caso
 * (sin token, token inválido, usuario sin `is_admin`, servidor sin configurar). Nunca
 * distingue entre esos casos: decir «el token es válido pero no eres admin» confirmaría al
 * curioso que su sesión sirve para algo aquí.
 */
import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/supabase/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nunca cacheable: una respuesta de autorización guardada es una autorización robada. */
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ admin: false }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json({ admin: true, userId: admin.userId }, { headers: NO_STORE });
}
