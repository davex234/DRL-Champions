"use client";

/**
 * FASE 61 · SALIR DE UNA PARTIDA, SABIENDO QUÉ PASA.
 *
 * Antes, en PvE, «Salir» llamaba directamente a `abandonDuel`: un clic sin confirmar BORRABA la partida (el servidor
 * la elimina: no cuenta, no paga). Y el botón Atrás del navegador sacaba de la arena sin decir nada.
 *
 * Este diálogo enseña la consecuencia REAL de cada salida (`leaveConsequence`, leída del servidor, sin inventar
 * penalizaciones) y separa las dos salidas cuando existen: conservar la partida (se retoma desde JUGAR ·
 * Continuar partida) o abandonarla. La acción por defecto —y la que tiene el foco— es seguir jugando.
 */
import { useEffect, useRef } from "react";
import { NxButton } from "@/components/ui/NxButton";
import type { LeaveConsequence } from "@/lib/duel/matchFlow";

export function LeaveMatchDialog({
  open, consequence, busy = false, onStay, onKeep, onAbandon,
}: {
  open: boolean;
  consequence: LeaveConsequence;
  busy?: boolean;
  onStay: () => void;
  onKeep?: () => void;
  onAbandon?: () => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    stayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onStay(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStay]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4" data-testid="leave-dialog" onClick={onStay}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-body"
        className="nx-clip w-full max-w-md border border-white/15 bg-[#080b14] p-5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="leave-title" className="font-display text-[20px] font-bold uppercase tracking-[0.04em] text-white">{consequence.title}</h2>
        <p id="leave-body" className="mt-2 text-[14px] text-white/70">{consequence.body}</p>

        <div className="mt-5 flex flex-col gap-2">
          <NxButton ref={stayRef} variant="primary" size="lg" onClick={onStay} disabled={busy} data-testid="leave-stay">
            {consequence.stay}
          </NxButton>
          {consequence.keep && onKeep && (
            <div>
              <NxButton variant="secondary" size="lg" className="w-full" onClick={onKeep} disabled={busy} data-testid="leave-keep">
                {consequence.keep.label}
              </NxButton>
              <p className="mt-1 text-center text-[12px] text-white/50">{consequence.keep.note}</p>
            </div>
          )}
          {consequence.abandon && onAbandon && (
            <div>
              <NxButton variant="danger" size="md" className="w-full" onClick={onAbandon} disabled={busy} data-testid="leave-abandon">
                {consequence.abandon.label}
              </NxButton>
              <p className="mt-1 text-center text-[12px] text-white/50">{consequence.abandon.note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
