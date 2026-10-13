"use client";

/**
 * HOJA DE RETO (Fase 29): elegir el mazo para ENVIAR o ACEPTAR un reto. Misma hoja inferior que la
 * ayuda del duelo (móvil: bottom sheet; escritorio: diálogo centrado). Solo se pueden elegir mazos
 * que el servidor ya marcó como legales (`d.valid`); el mazo se vuelve a validar al crear la partida.
 * Es un duelo PRIVADO: sin rating, sin escalera, sin recompensas competitivas. Se dice aquí.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { PreMatchVersus } from "@/components/duel/experience/PreMatchVersus";
import type { DuelDeckDTO } from "@/lib/duel/types";
import type { SocialPlayer } from "@/server/services/social";
import { playerMessage } from "@/components/ui/game/GameStates";

export interface ChallengeSheetProps {
  open: boolean;
  mode: "send" | "accept";
  target: SocialPlayer | null;
  decks: DuelDeckDTO[] | null;
  busy: boolean;
  error: string | null;
  /** Revancha: la partida anterior que se referencia. Solo texto. */
  rematch?: boolean;
  onConfirm: (deckId: string) => void;
  onClose: () => void;
  /** FASE 32 · equipo activo: si es legal, es el que se propone primero. No se envía a nadie. */
  activeDeckId?: string | null;
}

export function ChallengeSheet({ open, mode, target, decks, busy, error, rematch, onConfirm, onClose, activeDeckId = null }: ChallengeSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [deckId, setDeckId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !decks) return;
    setDeckId((cur) => (cur && decks.some((d) => d.id === cur && d.valid) ? cur : decks.find((d) => d.valid && d.id === activeDeckId)?.id ?? decks.find((d) => d.valid)?.id ?? null));
  }, [open, decks, activeDeckId]);

  if (!open || !target) return null;
  const validos = decks?.filter((d) => d.valid) ?? [];
  const elegido = validos.find((d) => d.id === deckId) ?? null;
  const titulo = mode === "send" ? (rematch ? "Pedir revancha" : "Retar a un amigo") : "Aceptar el reto";

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} data-scene="challenge-sheet" data-mode={mode}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-2xl border border-white/12 bg-[#0b0e17] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:px-7 sm:py-6"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="nx-label">Duelo privado · sin rating</span>
            <h2 id="challenge-sheet-title" className="font-display text-h2 font-bold uppercase tracking-wide text-white">{titulo}</h2>
            <p className="mt-1 text-caption text-ink-muted">
              <span aria-hidden className="mr-1">{target.avatar}</span>{target.username} · misma arena y mismas reglas que el ranked; no mueve tu rating ni tu posición.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar" className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white">✕</button>
        </div>

        <div className="mt-4">
          <span className="nx-label">Tu equipo</span>
          {decks === null ? (
            <p className="mt-2 text-caption text-ink-muted" role="status">Leyendo tus equipos…</p>
          ) : validos.length === 0 ? (
            <div className="mt-2 rounded-xl border border-dashed border-white/15 p-4 text-center">
              <p className="text-sm text-white">No tienes ningún equipo válido todavía.</p>
              <Link href="/duelos/mazos" className="nx-action mt-2 inline-block">Ir a Mis equipos →</Link>
            </div>
          ) : (
            <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Elige un equipo">
              {decks.map((d) => {
                const sel = d.id === deckId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => d.valid && setDeckId(d.id)}
                    disabled={!d.valid}
                    data-deck={d.id}
                    className={[
                      "nx-clip flex min-h-[52px] items-center justify-between gap-3 px-3 py-2 text-left transition",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-drl-cyan",
                      d.valid ? "cursor-pointer" : "cursor-not-allowed opacity-45",
                      sel ? "bg-drl-cyan/12 ring-1 ring-drl-cyan/60" : "bg-white/[0.04] hover:bg-white/[0.07]",
                    ].join(" ")}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{d.name}</span>
                      <span className="block text-[11px] text-white/40">{d.valid ? `${d.cards.length} cartas · listo` : "No es legal todavía"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {d.id === activeDeckId && <span className="nx-label text-ok">Activo</span>}
                      {sel && <span className="nx-label text-drl-cyan">Elegido</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Fase 33 · pre-partida del duelo privado: tu equipo contra el amigo, con su equipo OCULTO (reversos). */}
        {elegido && <PreMatchVersus compact deck={elegido} rival={{ kind: "PRIVATE", username: target.username, avatar: target.avatar }} className="mt-4" />}

        {error && <p role="alert" className="mt-3 text-caption text-drl-red">{playerMessage(error)}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <NxButton variant="primary" onClick={() => deckId && onConfirm(deckId)} disabled={busy || !deckId} data-testid="challenge-confirm">
            {busy ? "Enviando…" : mode === "send" ? "Enviar reto" : "Aceptar y jugar"}
          </NxButton>
          <NxButton variant="ghost" onClick={onClose} disabled={busy}>Cancelar</NxButton>
        </div>
        <p className="mt-3 text-[11px] text-white/35">
          {mode === "send" ? "Duelo AMISTOSO: sin rating, sin colocación y sin Top. El reto caduca en 5 minutos si no responde; puedes cancelarlo mientras esté pendiente." : "Al aceptar, la partida nace en el servidor y los dos entráis en la arena."}
        </p>
      </section>
    </div>
  );
}
