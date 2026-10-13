"use client";

/**
 * AYUDA DEL DUELO («?», Fase 26).
 *
 * Una hoja con las reglas en lenguaje de jugador, siempre a mano desde la pre-partida y la arena.
 * En móvil es una HOJA INFERIOR (bottom sheet); en escritorio, un diálogo centrado. Se cierra con
 * Escape, con el botón o tocando fuera.
 *
 * No copia ninguna tabla del dominio: la respuesta obligada la impone el servidor y la arena la
 * enseña en cada turno («Obligado a responder con…»). Aquí solo se explica que existe.
 */
import { useEffect, useRef } from "react";
import { STAT_INFO } from "@/lib/duel/types";

export type HelpMode = "PVE" | "PVP";

export function HelpSheet({ open, onClose, mode = "PVE" }: { open: boolean; onClose: () => void; mode?: HelpMode }) {
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
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      data-scene="help"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="duel-help-title"
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-2xl border border-white/12 bg-[#0b0e17] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,600px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:px-7 sm:py-6"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <h2 id="duel-help-title" className="font-display text-h2 font-bold uppercase tracking-wide text-white">Cómo se juega</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar ayuda"
            className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <ol className="mt-4 space-y-3 text-body leading-relaxed text-ink-secondary">
          <Step n={1} title="Diez turnos, diez cartas">
            Cada turno juegas UNA carta y se gasta: no vuelve a la mano. El ataque alterna cada turno.
          </Step>
          <Step n={2} title="Quien ataca declara">
            Elige carta y una de sus tres estadísticas. El rival responde con una carta y con la
            estadística que impone la tabla del juego: la arena te la dice cuando defiendes.
          </Step>
          <Step n={3} title="Gana el valor mayor">
            Se comparan las dos cifras. El mayor se lleva el turno. Si empatan, nadie puntúa y las dos
            cartas se gastan igual.
          </Step>
          <Step n={4} title="El final">
            Gana quien más turnos se lleva. Si el marcador queda igualado decide la suma de OVR de los
            mazos (otorga un punto); si también empata, la estadística total declarada (no otorga punto); y si ni así,
            es empate. La pantalla final te dice cuál se aplicó.
          </Step>
          {mode === "PVP" ? (
            <Step n={5} title="Contra otra persona">
              El servidor fija un tiempo por turno. Si se agota, pierde quien no jugó. La cuenta atrás
              que ves solo informa. Si pierdes la conexión, vuelve: la partida se reconstruye desde el
              servidor y tu mazo oculto sigue oculto para el rival.
            </Step>
          ) : (
            <Step n={5} title="Contra el bot">
              Ningún nivel ve tus cartas no jugadas. Fácil decide sin plan; Normal mezcla; Difícil
              elige con criterio casi siempre. Las reglas son las mismas en los tres.
            </Step>
          )}
        </ol>

        <h3 className="nx-label mt-5 mb-2">Las tres estadísticas</h3>
        <ul className="grid gap-2 sm:grid-cols-3" aria-label="Estadísticas">
          {(Object.keys(STAT_INFO) as (keyof typeof STAT_INFO)[]).map((k) => {
            const s = STAT_INFO[k];
            return (
              <li key={k} className="nx-clip-sm border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="font-display text-[11px] font-extrabold tracking-[0.12em]" style={{ color: s.color }}>{s.abbr}</span>
                <b className="ml-2 font-display text-body font-bold uppercase text-white">{s.label}</b>
                <p className="mt-0.5 text-caption text-ink-muted">{s.blurb}</p>
              </li>
            );
          })}
        </ul>

        <p className="mt-5 text-caption text-ink-faint">
          Todo lo decide el servidor: quién gana cada turno, el marcador, el desempate y la recompensa.
          La pantalla solo lo enseña.
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="nx-readout mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-[12px] text-white/70">{n}</span>
      <span>
        <b className="block font-display text-body font-bold uppercase tracking-wide text-white">{title}</b>
        <span className="block">{children}</span>
      </span>
    </li>
  );
}
