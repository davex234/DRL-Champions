/**
 * MIDDLEWARE — la capa de borde de las superficies administrativas (V-1, bloque 8.1).
 *
 * ────────────────────────── LO QUE ESTE ARCHIVO NO PUEDE HACER ──────────────────────────
 *
 * Conviene empezar por ahí, porque el instinto al leer «V-1: falta protección server-side»
 * es escribir aquí un `if (!isAdmin) redirect()`, y **en este proyecto eso no funciona**:
 *
 *   La sesión de Supabase vive en `localStorage` (`lib/supabase/client.ts` usa el
 *   almacenamiento por defecto del SDK; no hay `@supabase/ssr` ni una sola cookie de auth
 *   en todo el código). Un middleware solo ve cabeceras y cookies de la NAVEGACIÓN. En una
 *   navegación a `/admin` el navegador no adjunta ningún token, así que aquí todo el mundo
 *   es anónimo — el administrador legítimo también.
 *
 *   Un `if (!isAdmin)` en esta capa no protegería: bloquearía a todos por igual, que es lo
 *   mismo que apagar el panel. Y la alternativa —mover la sesión a cookies— es rehacer la
 *   autenticación del producto entero, justo lo que el bloque pide no hacer.
 *
 * Así que la comprobación real de `is_admin` se hace donde SÍ llega el token: en
 * `/api/admin/session` (para la interfaz) y en cada ruta `/api/admin/*` con `verifyAdmin`
 * (para los datos). Ver `app/api/admin/session/route.ts`.
 *
 * ────────────────────────── LO QUE SÍ HACE, Y POR QUÉ MERECE LA PENA ──────────────────────────
 *
 * 1. **Rechaza en el borde toda petición a `/api/admin/*` sin `Authorization: Bearer`.**
 *    No sustituye a `verifyAdmin` —que sigue ejecutándose y sigue siendo la autoridad—,
 *    pero corta el sondeo anónimo antes de que toque un route handler, una conexión a
 *    GoTrue o la base de datos. Es la comprobación más barata que existe y la que más
 *    tráfico ilegítimo descarta.
 *
 *    Es seguro por construcción: el panel llama SIEMPRE con token (`adminFetch` es el único
 *    camino y lanza si no hay sesión), así que ninguna llamada legítima carece de cabecera.
 *
 * 2. **Marca `/admin/*` y `/api/admin/*` como no cacheables y no indexables.** Una respuesta
 *    de una superficie administrativa guardada en una CDN o en un índice es un problema
 *    aunque el contenido sea inocuo.
 *
 * Ninguna de las dos cosas es «la barrera». La barrera es `verifyAdmin`. Esto es lo que se
 * puede hacer honestamente en el borde con la arquitectura de sesión que hay.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isGatedRequest, isSanctionActive, SANCTION_DENIED_MESSAGE } from "@/domain/admin/sanctions";
import { qaHarnessBlocked, tooLarge } from "@/domain/ops/edge";
import { serverSupabaseOrigin } from "@/lib/supabase/serverUrl";

const NO_STORE = "no-store, no-cache, must-revalidate, private";

/*
 * F58 · 3. SANCIONES: RESPUESTA LEGIBLE EN EL BORDE (no es la autoridad).
 *
 * Una cuenta sancionada que intenta MUTAR algo del juego recibe aquí un 403 con un mensaje claro, en vez del 401
 * «No autenticado» que daría `getSession` (que es quien de verdad la bloquea, con la identidad verificada).
 *
 * El `sub` se lee del JWT SIN verificar la firma, y es seguro porque solo sirve para DENEGAR: un token falsificado
 * con el `sub` de otro solo consigue bloquearse a sí mismo, y cualquier token que pase de aquí vuelve a ser verificado
 * por la ruta. Caché corta por usuario para no consultar la base de datos en cada petición.
 */
const SANCTION_TTL_MS = 15_000;
const sanctionCache = new Map<string, { at: number; until: string | null; type: string | null }>();

function jwtSub(auth: string | null): string | null {
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const parts = auth.slice(7).trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" && /^[0-9a-f-]{36}$/i.test(json.sub) ? json.sub : null;
  } catch { return null; }
}

async function sanctionOf(userId: string, now: number): Promise<{ type: string; until: string | null } | null> {
  const hit = sanctionCache.get(userId);
  if (hit && now - hit.at < SANCTION_TTL_MS) return hit.type ? { type: hit.type, until: hit.until } : null;
  const url = serverSupabaseOrigin(); // valorosters.com · el servidor habla con Supabase por el origen interno
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/user_sanctions?select=type,expires_at,revoked_at&user_id=eq.${userId}&revoked_at=is.null&limit=10`,
      { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!r.ok) return null;
    const rows = (await r.json()) as { type: string; expires_at: string | null; revoked_at: string | null }[];
    const active = rows.filter((s) => isSanctionActive(s, now));
    const g = active.find((s) => s.expires_at == null) ?? active.sort((a, b) => Date.parse(b.expires_at!) - Date.parse(a.expires_at!))[0];
    sanctionCache.set(userId, { at: now, type: g?.type ?? null, until: g?.expires_at ?? null });
    return g ? { type: g.type, until: g.expires_at } : null;
  } catch { return null; }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  /*
   * F67 · arneses de QA (/design-system) fuera de la release pública: 404 en producción salvo NEXUS_QA_HARNESS=1.
   */
  if (qaHarnessBlocked(pathname, { NODE_ENV: process.env.NODE_ENV, NEXUS_QA_HARNESS: process.env.NEXUS_QA_HARNESS })) {
    return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": NO_STORE, "X-Robots-Tag": "noindex" } });
  }
  if (pathname.startsWith("/api/")) {
    /*
     * F67 · TAMAÑO DE CUERPO. Ninguna API del juego necesita más de unos KB; sin esto, `await req.json()` aceptaba
     * cualquier tamaño. Se corta por `Content-Length` antes de tocar la ruta (las subidas tienen su propio límite).
     */
    if (tooLarge(pathname, req.method, req.headers.get("content-length"))) {
      return NextResponse.json({ error: "La solicitud es demasiado grande", code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": NO_STORE } });
    }
  }
  const rid = requestIdFor(req);
  return withRequestId(req, rid, await gate(req, pathname, rid));
}

function requestIdFor(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
}

/*
 * F67 · CORRELACIÓN. Cada petición a /api lleva un `x-request-id` (el del cliente si es razonable, si no uno nuevo) que
 * la ruta recibe en sus cabeceras y que vuelve en la respuesta. Con él, «error ABC» se encuentra en el log.
 */
function withRequestId(req: NextRequest, rid: string, res: NextResponse): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) res.headers.set("x-request-id", rid);
  return res;
}

async function gate(req: NextRequest, pathname: string, rid: string): Promise<NextResponse> {

  if (isGatedRequest(req.method, pathname)) {
    const sub = jwtSub(req.headers.get("authorization"));
    const s = sub ? await sanctionOf(sub, Date.now()) : null;
    if (s) {
      return NextResponse.json(
        { error: SANCTION_DENIED_MESSAGE, sanction: { type: s.type, until: s.until } },
        { status: 403, headers: { "Cache-Control": NO_STORE } },
      );
    }
    return nextWithId(req, rid);
  }
  // Las rutas del juego que no son mutaciones pasan intactas: ni cabeceras de caché ni `noindex` del panel.
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api/admin/")) return nextWithId(req, rid);

  if (pathname.startsWith("/api/admin/")) {
    const auth = req.headers.get("authorization");
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
      /*
       * Mismo cuerpo y mismo código que devolvería `verifyAdmin` al no encontrar token. Que
       * la respuesta sea indistinguible es deliberado: quien sondea no debe poder deducir
       * de la forma del 401 en qué capa le han parado.
       */
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401, headers: { "Cache-Control": NO_STORE } },
      );
    }
  }

  const res = nextWithId(req, rid);
  res.headers.set("Cache-Control", NO_STORE);
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

/** Pasa la petición a la ruta con su `x-request-id` en las cabeceras de ENTRADA (la ruta lo lee para sus logs). */
function nextWithId(req: NextRequest, rid: string): NextResponse {
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", rid);
  return NextResponse.next({ request: { headers } });
}

/**
 * Solo las superficies administrativas. Un matcher amplio metería este middleware en el
 * camino de cada petición del juego para no aportar nada.
 */
export const config = {
  // F58 · además de las superficies admin, las MUTACIONES del juego (el propio middleware deja pasar los GET sin tocarlos).
  // F67 · todas las /api (tamaño de cuerpo + x-request-id) y los arneses /design-system (ocultos en producción).
  matcher: ["/admin/:path*", "/api/:path*", "/design-system", "/design-system/:path*"],
};
