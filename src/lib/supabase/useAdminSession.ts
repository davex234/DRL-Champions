"use client";

/**
 * ¿ES ADMINISTRADOR QUIEN ESTÁ MIRANDO? — la pregunta, hecha UNA sola vez.
 *
 * ────────────────────────── POR QUÉ UN HOOK Y NO UNA COPIA ──────────────────────────
 *
 * `AdminGuard` ya sabía preguntarlo: pide `GET /api/admin/session` con el Bearer de la
 * sesión y obedece la respuesta. Al añadir el acceso al panel desde la cuenta hacía falta
 * exactamente la misma pregunta en otro sitio, y copiarla habría dejado dos implementaciones
 * de una comprobación de autorización — dos sitios donde arreglar un fallo, y uno donde
 * olvidarse. Se extrae aquí y la consumen los dos.
 *
 * **No es una segunda fuente de verdad.** La fuente sigue siendo `profiles.is_admin`, leída
 * por `verifyAdmin()` en el servidor con `service_role`. Esto es un transporte: lleva el
 * token, trae el veredicto y no decide nada.
 *
 * ────────────────────────── QUÉ PROTEGE Y QUÉ NO ──────────────────────────
 *
 * Nada. Esto decide si se PINTA algo, no si se puede HACER algo. La barrera son las rutas
 * `/api/admin/*`, que verifican cada una por su cuenta y no se enteran de si hay interfaz
 * delante. Quien parchee esto en su navegador consigue ver un enlace; al pulsarlo se
 * encuentra el mismo 401 que antes.
 *
 * ────────────────────────── FALLA CERRADO ──────────────────────────
 *
 * El estado inicial es `checking` y solo se sale de él con un `200 { admin: true }`
 * explícito. Cualquier otra cosa —401, 500, red caída, backend sin configurar, un cuerpo
 * cuyo `admin` no sea exactamente `true`— deja `denied`. No hay ningún camino en el que un
 * error acabe concediendo.
 *
 * ────────────────────────── Y SE MANTIENE AL DÍA ──────────────────────────
 *
 * Se resuscribe a `onAuthStateChange`, así que la respuesta se vuelve a pedir al iniciar
 * sesión, al cerrarla, al refrescarse el token y al cambiar de usuario. Sin esto, cerrar
 * sesión dejaría el enlace de administración pintado hasta recargar —y enseñárselo al
 * siguiente que use el equipo es justo lo que este acceso no debe hacer—.
 */
import { useEffect, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "./client";
import type { Profile } from "./types";
import { fetchOwnProfile } from "./ownProfile";

export type AdminGate = "checking" | "granted" | "denied" | "unconfigured";

/**
 * ¿Tiene sentido siquiera preguntar?
 *
 * `profiles.is_admin` viaja en el perfil que la sesión ya trae, así que para la inmensa
 * mayoría de jugadores se sabe de antemano que la respuesta va a ser «no». Preguntar
 * igualmente costaba una petición por carga y **un 401 en la consola del navegador de cada
 * jugador** — ruido en la pantalla de cuenta de gente que no tiene nada que ver con esto, y
 * una comprobación de `ux:verify` en rojo.
 *
 * Esto NO es autorizar desde el cliente. Es no llamar a una puerta que ya sabemos cerrada.
 * Cuando la marca dice que sí, se pregunta igual y **manda la respuesta del servidor**; y si
 * alguien falsea su copia local del perfil, lo único que consigue es que la petición se haga
 * y que el servidor le diga que no.
 */
async function podríaSerAdmin(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session?.user?.id) return false;
  // F69 · la marca llega con el perfil propio por el servidor (misma lectura compartida que el proveedor de auth).
  const perfil: Pick<Profile, "is_admin"> | null = await fetchOwnProfile(session.access_token, session.user.id);
  return perfil?.is_admin === true;
}

/*
 * ────────────────────────── F58.2 · UNA SOLA COMPROBACIÓN PARA TODA LA APLICACIÓN ──────────────────────────
 *
 * El acceso «Administración» vive en el menú del juego (desktop y móvil), en /cuenta y en el propio panel. Si cada sitio
 * montara su propia comprobación, abrir un desplegable dispararía peticiones y cada instancia podría ver un estado
 * distinto un instante. Por eso el veredicto es un ALMACÉN compartido del módulo (`useSyncExternalStore`): se pregunta
 * una vez y todos leen lo mismo.
 *
 * Reglas (las de siempre, más una):
 *   · estado inicial `checking` (y es también el del servidor/hidratación): nada de admin se pinta hasta `granted`;
 *   · cierre de sesión → `denied` al instante, cancelando cualquier comprobación en vuelo (no puede volver a conceder);
 *   · cambio de usuario → `checking` y se vuelve a preguntar;
 *   · refresco de token / mismo usuario → se revalida EN SEGUNDO PLANO (F58: sin desmontar /admin);
 *   · NUEVO: al volver a la pestaña, se revalida si han pasado ≥ 60 s. Un permiso retirado no queda cacheado: el
 *     acceso desaparece (y /admin se cierra) en cuanto el servidor deja de concederlo.
 */
const REVALIDATE_MS = 60_000;
let gateState: AdminGate = "checking";
const listeners = new Set<() => void>();
let started = false;
let seq = 0;
let lastUser: string | null | undefined;
let lastCheck = 0;

function setGate(next: AdminGate): void {
  if (gateState === next) return;
  gateState = next;
  for (const l of listeners) l();
}

async function comprobar(): Promise<void> {
  const my = ++seq;
  lastCheck = Date.now();
  const apply = (g: AdminGate) => { if (my === seq) setGate(g); };
  if (!isSupabaseConfigured()) {
    /*
     * Sin backend no hay `profiles.is_admin` que consultar, así que no hay forma de
     * demostrar que alguien es admin. Se deniega: la ausencia de comprobación posible
     * nunca puede significar «adelante».
     */
    apply("unconfigured");
    return;
  }
  try {
    const sb = getSupabase();
    const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) { apply("denied"); return; }

    // Sin marca en el perfil no se molesta al servidor: la respuesta ya se conoce.
    if (!(await podríaSerAdmin())) { apply("denied"); return; }

    const res = await fetch("/api/admin/session", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = res.ok ? ((await res.json()) as { admin?: boolean }) : null;
    apply(res.ok && body?.admin === true ? "granted" : "denied");
  } catch {
    apply("denied");
  }
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void comprobar();
  /*
   * Al cambiar la sesión se vuelve a preguntar. Cierre o cambio de usuario: nada sobrevive a la transición (conservar
   * el veredicto anterior es exactamente cómo un enlace de administración sobreviviría a un cierre de sesión).
   * Refresco del mismo usuario: en segundo plano (F58), sin desmontar el panel.
   */
  getSupabase()?.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null;
    const sameUser = lastUser !== undefined && uid !== null && uid === lastUser;
    lastUser = uid;
    if (event === "SIGNED_OUT" || !uid) { seq++; setGate("denied"); return; }
    if (event === "INITIAL_SESSION") return; // la sesión con la que arranca ya la está comprobando `start()`
    if (!sameUser) setGate("checking");
    void comprobar();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && gateState !== "checking" && Date.now() - lastCheck >= REVALIDATE_MS) void comprobar();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Pregunta al servidor (una vez para toda la app) si la sesión actual es de un administrador. */
export function useAdminSession(): AdminGate {
  useEffect(() => { start(); }, []);
  // Servidor e hidratación: `checking` siempre → ningún acceso de admin en el HTML inicial ni desajuste al hidratar.
  return useSyncExternalStore(subscribe, () => gateState, () => "checking");
}
