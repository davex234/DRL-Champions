"use client";

/**
 * WALKOUT 0.8 · AJUSTE «ANIMACIONES DE APERTURA» — Cinemática 3D · Automático · Reducidas (ver `lib/walkout/animationPref`).
 * Se guarda en este dispositivo, como el sonido. Botones nativos con `aria-pressed` (teclado y lector de pantalla), 44 px.
 */
import { useEffect, useState } from "react";
import { OPENING_ANIMATIONS, describeOpeningMode, setOpeningAnimation, useOpeningAnimation } from "@/lib/walkout/animationPref";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

export function OpeningAnimationSettings({ className }: { className?: string }) {
  useLocale();
  const pref = useOpeningAnimation();
  const [systemReduced, setSystemReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    const on = () => setSystemReduced(m.matches);
    on(); m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);

  return (
    <div className={cn("space-y-3", className)} data-testid="opening-animation-settings" data-pref={pref}>
      <div>
        <span className="font-display text-[15px] font-bold uppercase tracking-[0.08em] text-white">{t("Animaciones de apertura")}</span>
        <span className="mt-0.5 block text-[12px] text-white/50">{t("Cómo se presentan las cartas especiales al abrir sobres")}</span>
      </div>
      <div role="group" aria-label={t("Animaciones de apertura")} className="grid grid-cols-3 gap-2">
        {OPENING_ANIMATIONS.map((o) => {
          const on = pref === o.id;
          return (
            <button key={o.id} type="button" aria-pressed={on} title={td(o.hint)} onClick={() => setOpeningAnimation(o.id)} data-testid={`opening-animation-${o.id}`}
              className={cn("nx-clip-sm min-h-[44px] px-2 font-display text-[12px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                on ? "bg-drl-cyan/15 text-drl-cyan shadow-[inset_0_0_0_1px_rgba(25,227,255,0.5)]" : "bg-white/[0.05] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]")}>
              {td(o.label)}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-white/60" data-testid="opening-animation-active">{t("Activo:")} {describeOpeningMode(pref, systemReduced)}</p>
      <p className="text-[12px] text-white/45">{td(OPENING_ANIMATIONS.find((o) => o.id === pref)?.hint)}{t(". Se guarda en este dispositivo.")}</p>
    </div>
  );
}
