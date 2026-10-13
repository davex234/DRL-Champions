"use client";

/**
 * PUERTA DE ADMINISTRACIÓN (V-1) — nada de `/admin/*` se pinta sin que el SERVIDOR lo diga.
 *
 * No decide nada por su cuenta. Pregunta a `GET /api/admin/session`, que resuelve el Bearer
 * contra GoTrue y comprueba `profiles.is_admin` con `service_role`, y obedece. Lo que había
 * antes en cada página era `if (!ADMIN_ENABLED)`, es decir, una constante pública del
 * bundle: una cortina, no una puerta.
 *
 * ────────────────────────── QUÉ PROTEGE Y QUÉ NO ──────────────────────────
 *
 * Esto impide que la interfaz se pinte. **No es la barrera de seguridad**, y es importante
 * no confundirlo: la barrera son las rutas `/api/admin/*`, que verifican cada una por su
 * cuenta y no se enteran de si hay interfaz delante. Aunque alguien parchee este componente
 * en su propio navegador, no obtiene ni un dato ni una escritura: obtiene un formulario que
 * recibe 401.
 *
 * Ese reparto es deliberado y es el correcto con sesión en `localStorage` (ver la cabecera
 * de `api/admin/session/route.ts`, que explica por qué un middleware no puede hacer esto).
 *
 * ────────────────────────── FALLA CERRADO ──────────────────────────
 *
 * Cualquier cosa que no sea un 200 explícito —401, 403, 500, red caída, servidor sin
 * configurar, respuesta con `admin` que no es `true`— deja la puerta CERRADA. El estado
 * inicial es "checking" y solo se sale de él con una respuesta afirmativa del servidor;
 * no hay ningún camino en el que un error acabe en acceso concedido.
 */
import Link from "next/link";
import { useAdminSession } from "@/lib/supabase/useAdminSession";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("layout");

/*
 * La comprobación vive en `useAdminSession`, no aquí.
 *
 * No es un adorno de refactor: al añadir el acceso al panel desde la cuenta hacía falta la
 * misma pregunta en dos sitios, y dos copias de una comprobación de autorización son dos
 * sitios donde arreglar un fallo y uno donde olvidarse. El comportamiento de esta puerta no
 * cambia ni un paso: mismo endpoint, mismo `admin === true`, mismo fallo cerrado.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  useLocale();
  const gate = useAdminSession();

  if (gate === "granted") return <>{children}</>;

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      {gate === "checking" ? (
        <p className="font-display text-sm uppercase tracking-widest text-white/40">
          {t("Comprobando permisos…")}
        </p>
      ) : (
        <div>
          <p className="font-display text-2xl font-bold uppercase text-white">{t("Acceso restringido")}</p>
          <p className="mt-2 max-w-sm text-white/50">
            {gate === "unconfigured"
              ? t("Esta zona necesita el backend configurado para comprobar permisos de administración.")
              : t("Esta zona es solo para administradores. Inicia sesión con una cuenta autorizada.")}
          </p>
          <Link
            href="/cuenta"
            className="mt-5 inline-block rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 font-display text-sm uppercase text-white/70 transition hover:bg-white/10"
          >
            {t("Ir a mi cuenta")}
          </Link>
        </div>
      )}
    </div>
  );
}
