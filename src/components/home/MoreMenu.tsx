"use client";

/**
 * MENÚ SECUNDARIO («MÁS») — donde vive todo lo que sale del menú principal SIN desaparecer.
 *
 * La Home pasa a tener tres acciones. Eso NO significa que Temporada, Misiones, Logros, Eventos,
 * Pick'ems, Social, Perfil o Ajustes se borren: significa que dejan de competir con JUGAR. Todo
 * sigue a un toque desde aquí, y desde Escape.
 *
 * Las rutas son las REALES del producto (`src/design/nav.ts`): este menú no estrena URLs ni
 * inventa secciones. Si algo no existe, no está.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "@/design/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/format";
import { NAV_MENU_ITEM, NAV_MENU_LABEL, NAV_MENU_ROW } from "@/design/nav";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("home");

/**
 * Rutas reales, agrupadas por para qué sirven. Nada aquí es nuevo. Navegación global limpia (2026-10-07): solo nombres,
 * en mayúsculas y centrados (misma regla `NAV_MENU_*` que el armazón); sin descripción debajo.
 */
const GRUPOS: { titulo: string; items: { href: string; label: string }[] }[] = [
  {
    // IA 2026-10-07 · la sección TEMPORADA: su hub y sus tres áreas (Progresión vive en Mi cuenta).
    titulo: "Temporada",
    items: [
      { href: "/temporada", label: "Temporada" },
      { href: "/temporada/pase", label: "Pase de batalla" },
      { href: "/misiones", label: "Objetivos" },
      { href: "/misiones/crafting", label: "Crafteo" },
    ],
  },
  {
    titulo: "Circuito",
    items: [
      // F86.2 · desde la portada también se llega al ranked y a los torneos de jugadores (antes solo desde el armazón).
      { href: "/competitivo", label: "Competitivo" },
      { href: "/copas", label: "Torneos" },
      { href: "/torneos", label: "Eventos" },
      { href: "/pickems", label: "Pick'ems" },
      { href: "/social", label: "Social" },
    ],
  },
  {
    titulo: "Cuenta",
    items: [
      // IA 2026-10-07 · Mi perfil, Cuenta y ajustes, Progresión y Dar feedback están dentro de MI CUENTA: una entrada.
      { href: "/cuenta", label: "Mi cuenta" },
      // F63 · la guía (misma explicación que la primera sesión, sin estado ni recompensas).
      { href: "/como-jugar", label: "Cómo jugar" },
    ],
  },
];

export function MoreMenu({
  open, onClose, signedIn,
}: {
  open: boolean;
  onClose: () => void;
  signedIn: boolean;
}) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);

  /* Al abrir, el foco entra en el panel: quien navega con teclado no se queda fuera del diálogo. */
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE.out }}
        >
          <button type="button" aria-label={t("Cerrar menú")} className="absolute inset-0 bg-black/72" onClick={onClose} />
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t("Más opciones")}
            data-testid="more-menu"
            initial={{ x: 44 }}
            animate={{ x: 0 }}
            exit={{ x: 44 }}
            transition={{ duration: 0.22, ease: EASE.out }}
            /* Se desplaza: en pantallas bajas la lista no cabe, y lo que desborda tiene que moverse. */
            className="relative h-full w-[min(94vw,360px)] overflow-y-auto border-l border-white/10 bg-[#070a13]/95 p-5 outline-none"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-[13px] font-extrabold uppercase tracking-[0.3em] text-white">{t("Más")}</h2>
              <button
                type="button"
                onClick={onClose}
                className="nx-label rounded-md px-2 py-1 text-white/45 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
              >
                {t("Cerrar")}
              </button>
            </div>

            {GRUPOS.map((g) => (
              <section key={g.titulo} className="mb-5">
                <h3 className="nx-label mb-2 text-white/35">{td(g.titulo)}</h3>
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((it) => (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        onClick={() => playSound("ui.confirm")}
                        className={cn("rounded-lg transition-colors duration-normal hover:bg-white/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70", NAV_MENU_ITEM, NAV_MENU_ROW)}
                      >
                        <b className={cn(NAV_MENU_LABEL, "text-[12px] tracking-[0.14em] text-white/90")}>{td(it.label)}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {!signedIn && (
              <Link
                href="/cuenta"
                className="block rounded-lg bg-drl/15 px-3 py-2.5 text-center font-display text-[12px] font-bold uppercase tracking-[0.16em] text-drl focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
              >
                {t("Iniciar sesión")}
              </Link>
            )}

            <p className="nx-label mt-6 !text-[9px] leading-relaxed text-white/25">
              {t("Escape abre y cierra este menú.")}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
