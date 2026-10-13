"use client";

/**
 * FASE 44 · GAME SHEET / GAME MODAL — capas con profundidad, no un modal de Bootstrap.
 *
 * Contrato de accesibilidad y de «no atascar nada» (lo recorre el fuzzer de movimiento):
 *   · `role="dialog"` + `aria-modal` + título; el foco entra al abrir y VUELVE a quien lo abrió al cerrar;
 *   · Escape cierra (salvo `dismissable={false}`, reservado a confirmaciones que no deben perderse) y el tabulador
 *     no escapa de la capa mientras está abierta;
 *   · al cerrar se desmonta entera: no queda ninguna capa invisible con `pointer-events` encima de la pantalla;
 *   · el scroll del documento se bloquea solo mientras está abierta y se restaura exactamente como estaba.
 * Movimiento: hoja con muelle (nivel 2), diálogo con escala corta; movimiento reducido → fundido.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SPRING, reducedTransition } from "@/design/motion";
import { lockScroll } from "@/lib/gameExperience/scrollLock";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("ui");

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * F64 · exportado como `useDialogLayer`: el MISMO contrato para cualquier capa del juego que no sea `GameSheet`/`GameModal`
 * (foco dentro al abrir y de vuelta al cerrar, Escape, tabulador atrapado, scroll bloqueado).
 */
export function useDialogLayer(open: boolean, onClose: () => void, dismissable: boolean, panel: React.RefObject<HTMLElement | null>) {
  useLayer(open, onClose, dismissable, panel as React.RefObject<HTMLDivElement | null>);
}

function useLayer(open: boolean, onClose: () => void, dismissable: boolean, panel: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    // Fase 44.1 · bloqueo compartido con contador sobre <html> (se libera siempre al cerrar/desmontar).
    const release = lockScroll();
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel.current)?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      release();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, onClose, dismissable, panel]);
}

export function GameSheet({
  open, onClose, title, eyebrow, children, dismissable = true, className, testId = "game-sheet",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  dismissable?: boolean;
  className?: string;
  testId?: string;
}) {
  useLocale();
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayer(open, onClose, dismissable, panel);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-stretch sm:justify-end" data-testid={`${testId}-layer`}>
          <motion.button
            type="button"
            aria-label={tr("Cerrar")}
            tabIndex={-1}
            className="nx-scrim absolute inset-0 cursor-default"
            onClick={() => { if (dismissable) onClose(); }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={reduced ? reducedTransition : { duration: 0.18 }}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            data-testid={testId}
            data-motion-level="2"
            className={cn("nx-sheet relative flex max-h-[88dvh] w-full flex-col outline-none sm:max-h-none sm:w-[420px]", className)}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            initial={reduced ? { opacity: 0 } : { y: 48, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 36, opacity: 0 }}
            transition={reduced ? reducedTransition : SPRING.sheet}
          >
            <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-6">
              <div>
                {eyebrow && <p className="nx-label">{td(eyebrow)}</p>}
                <h2 id={id} className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.04em] text-white">{td(title)}</h2>
              </div>
              {dismissable && (
                <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center text-white/60 hover:text-white" aria-label={tr("Cerrar")}>
                  <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 5l14 14M19 5 5 19" /></svg>
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function GameModal({
  open, onClose, title, eyebrow, children, actions, dismissable = true, className, testId = "game-modal",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  dismissable?: boolean;
  className?: string;
  testId?: string;
}) {
  useLocale();
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayer(open, onClose, dismissable, panel);
  /*
   * F79 · el diálogo se pinta en `document.body` (portal) una vez montado. Dentro de `PageTransition` (transform) su
   * `fixed z-[90]` quedaba atrapado en ese contexto: lo que venía después en el DOM (el aviso «Instalar NEXUS») se
   * pintaba ENCIMA y en móvil tapaba los botones. En el render de servidor (y en los tests de HTML) sigue en línea.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const tree = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4" data-testid={`${testId}-layer`}>
          <motion.button
            type="button" aria-label={tr("Cerrar")} tabIndex={-1}
            className="nx-scrim absolute inset-0 cursor-default"
            onClick={() => { if (dismissable) onClose(); }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={reduced ? reducedTransition : { duration: 0.18 }}
          />
          <motion.div
            ref={panel}
            role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
            data-testid={testId} data-motion-level="2"
            className={cn("nx-dialog relative w-full max-w-md px-6 py-7 outline-none", className)}
            // F79 · nunca más alto que la pantalla: el contenido largo se desplaza DENTRO y las acciones siguen alcanzables.
            style={{ maxHeight: "calc(100dvh - 2rem)", overflowY: "auto" }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 10 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={reduced ? reducedTransition : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {eyebrow && <p className="nx-label">{td(eyebrow)}</p>}
            <h2 id={id} className="font-display text-[26px] font-bold uppercase leading-tight tracking-[0.04em] text-white">{td(title)}</h2>
            {children && <div className="mt-3 text-[15px] leading-relaxed text-white/70">{children}</div>}
            {actions && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
  return mounted && typeof document !== "undefined" ? createPortal(tree, document.body) : tree;
}
