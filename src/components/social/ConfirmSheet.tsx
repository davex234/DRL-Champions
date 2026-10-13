"use client";

/**
 * CONFIRMACIÓN (Fase 29): eliminar amigo y bloquear son irreversibles a un clic, así que piden
 * un segundo. Misma hoja inferior que el resto del sistema. Escape, botón o tocar fuera cierran.
 */
import { useEffect, useRef } from "react";
import { NxButton } from "@/components/ui/NxButton";

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmSheet({ open, title, body, confirmLabel, busy, onConfirm, onClose }: ConfirmSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} data-scene="confirm-sheet">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 rounded-t-2xl border border-white/12 bg-[#0b0e17] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,480px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:px-7 sm:py-6"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirm-sheet-title" className="font-display text-h2 font-bold uppercase tracking-wide text-white">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar" className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white">✕</button>
        </div>
        <p className="mt-3 text-body text-ink-secondary">{body}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <NxButton variant="danger" onClick={onConfirm} disabled={busy} data-testid="confirm-yes">{confirmLabel}</NxButton>
          <NxButton variant="ghost" onClick={onClose} disabled={busy}>Cancelar</NxButton>
        </div>
      </section>
    </div>
  );
}
