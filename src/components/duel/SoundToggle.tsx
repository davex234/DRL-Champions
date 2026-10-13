"use client";

/**
 * SILENCIO (Fase 26). Los cues del duelo (`lib/sound`) ya respetaban `isMuted()`, pero ninguna
 * pantalla ofrecía silenciarlos: el único interruptor vivía fuera del juego. Este botón vive en el
 * cromo de la arena, junto a pantalla completa. Estado de módulo, no de partida: nada se guarda.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { isMuted, setMuted, playCue } from "@/lib/sound";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function SoundToggle({ className }: { className?: string }) {
  useLocale();
  const [muted, setM] = useState(false);
  useEffect(() => { setM(isMuted()); }, []);

  function toggle() {
    const next = !muted;
    setMuted(next);
    setM(next);
    if (!next) playCue("ui");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? t("Activar sonido") : t("Silenciar sonido")}
      title={muted ? t("Activar sonido") : t("Silenciar sonido")}
      className={cn(
        "nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-control border border-white/12 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.1] hover:text-white",
        muted && "text-white/40",
        className,
      )}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4z" />
        {muted ? (
          <path d="m23 9-6 6m0-6 6 6" />
        ) : (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 5a9 9 0 0 1 0 14" />
          </>
        )}
      </svg>
    </button>
  );
}
