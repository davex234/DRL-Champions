"use client";

/**
 * HERRAMIENTAS INTERNAS — la puerta al panel, donde tiene que estar.
 *
 * ────────────────────────── POR QUÉ AQUÍ Y NO EN LA NAVEGACIÓN ──────────────────────────
 *
 * La barra principal del juego es `JUGAR · COLECCIÓN · TIENDA · PROGRESO · MUNDO`, y eso es
 * lo que un jugador entiende que es NEXUS. Meter «ADMIN» ahí convertiría un videojuego en un
 * panel de gestión para todo el que pasara por delante, incluidos los que nunca podrán
 * pulsarlo. Administrar no es un modo de juego: es una herramienta interna, y vive donde
 * viven las cosas de tu cuenta.
 *
 * Para un jugador normal esto **no existe**: no se pinta, no ocupa sitio y no deja hueco.
 *
 * ────────────────────────── QUIÉN DECIDE ──────────────────────────
 *
 * El servidor. `useAdminSession` pregunta a `GET /api/admin/session`, que resuelve el Bearer
 * contra GoTrue y comprueba `profiles.is_admin` con `service_role`. Aquí no hay ninguna
 * decisión de permisos: hay un `if` sobre una respuesta ajena.
 *
 * Y esto es **navegación, no seguridad**. Quien fuerce este componente en su navegador
 * consigue ver un enlace; al pulsarlo se encuentra el mismo `AdminGuard` y las mismas rutas
 * `/api/admin/*` devolviéndole 401. El enlace no abre nada: solo ahorra teclear la URL.
 */
import Link from "next/link";
import { Plate, Recessed } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { useAdminSession } from "@/lib/supabase/useAdminSession";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("layout");

export function InternalTools() {
  useLocale();
  const gate = useAdminSession();

  /*
   * Solo `granted` pinta. `checking` tampoco: enseñar el bloque mientras se comprueba haría
   * parpadear un acceso de administración en la cuenta de cualquiera durante el arranque.
   * Es preferible que aparezca un instante tarde a que aparezca un instante de más.
   */
  if (gate !== "granted") return null;

  return (
    <section aria-labelledby="h-herramientas" className="animate-rise">
      <Plate className="space-y-4 p-5">
        <SectionTitle as="h2" className="mb-0">
          <span id="h-herramientas">{t("Herramientas internas")}</span>
        </SectionTitle>

        <Recessed className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">
              {t("Administración NEXUS")}
            </p>
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-white/50">
              {t("Catálogo de cartas, pools de distribución, torneos y operaciones. Los cambios afectan a todos los jugadores y quedan registrados con tu nombre.")}
            </p>
          </div>

          <Link
            href="/admin"
            className="nx-clip-sm nx-focus inline-flex min-h-[44px] shrink-0 items-center px-5
                       font-display text-sm font-bold uppercase tracking-wide text-drl-gold
                       shadow-[inset_0_0_0_1px_rgba(255,211,92,0.5)] transition duration-fast
                       hover:bg-drl-gold/10 hover:shadow-[inset_0_0_0_1px_rgba(255,211,92,0.9)]"
          >
            {t("Abrir panel →")}
          </Link>
        </Recessed>
      </Plate>
    </section>
  );
}
