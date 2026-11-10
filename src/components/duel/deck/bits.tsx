"use client";

/**
 * PIEZAS DEL CONSTRUCTOR DE EQUIPOS (Fase 32). Presentación pura:
 *
 *   · `Sheet`     — hoja inferior en móvil, diálogo centrado en escritorio, o pantalla completa. Foco al
 *                   abrir, foco devuelto al cerrar, Escape cierra SOLO la hoja de arriba.
 *   · `StatBar`   — cifra + etiqueta + barra. La barra es decoración: el número siempre se lee.
 *   · `DeltaText` — «▲ +4», «▼ −2», «=»: el signo va en texto, no solo en color.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import type { RoleId } from "@/domain/cards/types";
import { deltaText } from "@/domain/deckBuilder/builder";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export const ROLE_GLYPH: Record<RoleId, string> = {
  Duelista: "✦", Controlador: "◍", Iniciador: "➤", Centinela: "▣", Flex: "◆",
};

/** Pila de hojas abiertas: Escape cierra solo la última. */
const stack: number[] = [];
let seq = 0;

export function Sheet({
  open, title, eyebrow, onClose, children, footer, size = "md", scene,
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "full";
  scene?: string;
}) {
  useLocale();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    stack.push(id);
    const prev = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) { e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const box = size === "full"
    ? t("inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[92vh] sm:w-[min(94vw,920px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl")
    : size === "lg"
      ? t("inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[min(94vw,760px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl")
      : t("inset-x-0 bottom-0 max-h-[86vh] rounded-t-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[86vh] sm:w-[min(92vw,540px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl");

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} data-scene={scene}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cn("fixed flex flex-col border border-white/12 bg-[#0b0e17] shadow-2xl", box)}
      >
        {size !== "full" && <span aria-hidden className="mx-auto mt-2.5 block h-1 w-10 shrink-0 rounded-full bg-white/20 sm:hidden" />}
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {eyebrow && <span className="nx-label">{td(eyebrow)}</span>}
            <h2 id={titleId} className="truncate font-display text-h2 font-bold uppercase tracking-wide text-white">{td(title)}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("Cerrar")}
            className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-white/10 px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 sm:px-6">{footer}</footer>
        )}
      </section>
    </div>
  );
}

export function DeltaText({ value, className }: { value: number | null; className?: string }) {
  const tone = value === null || value === 0 ? "text-ink-faint" : value > 0 ? "text-ok" : "text-bad";
  const arrow = value === null || value === 0 ? "" : value > 0 ? "▲ " : "▼ ";
  return <span className={cn("font-display font-bold tabular-nums", tone, className)}>{td(arrow)}{deltaText(value)}</span>;
}

export function StatBar({ label, abbr, value, color }: { label: string; abbr?: string; value: number | null; color: string }) {
  useLocale();
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="truncate text-caption font-semibold uppercase tracking-wide text-ink-secondary">
        {td(label)}
        {abbr && <span className="ml-1.5 text-ink-faint">{abbr}</span>}
      </span>
      <span className="nx-readout text-[18px] tabular-nums text-white">{value ?? "—"}</span>
      <span aria-hidden className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%`, background: color }} />
      </span>
    </div>
  );
}

/** «Editado hoy», «ayer», «hace 3 días», «el 12 sept». `now` entra por parámetro (reloj del servidor). */
export function fmtEdited(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return t("Editado hoy");
  if (days === 1) return t("Editado ayer");
  if (days < 7) return t("Editado hace {days} días", { days });
  return t("Editado el {v}", { v: new Date(at).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" }) });
}
