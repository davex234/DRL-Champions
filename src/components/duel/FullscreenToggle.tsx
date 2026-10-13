"use client";

/**
 * BOTÓN DE PANTALLA COMPLETA (Fase 22.2, §20).
 *
 * Presentación pura: entra/sale de pantalla completa del navegador para que la Arena ocupe todo
 * el monitor. Si la Fullscreen API no está disponible, NO se pinta (degradación limpia; no se
 * obliga a nadie). Accesible: objetivo táctil de 44 px, `aria-pressed`, foco visible.
 */
import { useFullscreen } from "@/lib/useFullscreen";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function FullscreenToggle({ className }: { className?: string }) {
  useLocale();
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => toggle()}
      aria-pressed={active}
      aria-label={active ? t("Salir de pantalla completa") : t("Pantalla completa")}
      title={active ? t("Salir de pantalla completa") : t("Pantalla completa")}
      className={
        "nx-focus grid h-11 w-11 min-h-[44px] shrink-0 place-items-center rounded-full border border-white/15 bg-black/40 text-white/70 backdrop-blur transition hover:bg-black/70 hover:text-white " +
        (className ?? "")
      }
    >
      <span aria-hidden className="text-base leading-none">{active ? "⤢" : "⛶"}</span>
    </button>
  );
}
