"use client";

/**
 * F71.2 · EL LATERAL DEL RIVAL — su SH / GS / EF, simétrico al tuyo (izquierda = rival, rojo; derecha = tú, cian).
 *
 * INFORMACIÓN OCULTA. Este componente solo recibe la carta PÚBLICA del rival: `view.pendingRival.card`, que el
 * servidor manda únicamente cuando el rival ya ha DECLARADO su carta (ataca). Mientras su carta del turno está
 * oculta, al navegador no le llega ningún dato de ella —ni aquí ni en ningún otro sitio— y el lateral enseña «?».
 * No hay nada que esconder con CSS: no existe el dato.
 *
 * Dos formas: `side` (lateral de `lg`, tres tercios como el tuyo) y `strip` (estrecho: una fila compacta encima
 * del enfrentamiento: rival arriba, cartas en medio, tú abajo).
 */
import { cn } from "@/lib/format";
import { STAT_INFO, type CombatStatKey, type DuelDeckCardDTO } from "@/lib/duel/types";
import { STAT_ABBR, STAT_GRID, STAT_KEYS, STAT_TERCIO, STAT_VALUE } from "./StatSelector";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

const RIVAL = "#ff2e63";

export function RivalStats({
  card, stat, variant = "side", className,
}: {
  /** La carta del rival SOLO si es pública (`view.pendingRival?.card`); `null` = oculta. */
  card: DuelDeckCardDTO | null;
  /** La estadística que el rival ha declarado. DUEL GAMEPLAY UX 2.0 · es pública aunque su carta siga boca abajo. */
  stat: CombatStatKey | null;
  variant?: "side" | "strip";
  className?: string;
}) {
  useLocale();
  const state = card ? "revealed" : "hidden";

  if (variant === "strip") {
    return (
      <div
        data-testid="rival-stats"
        data-rival-state={state}
        role="group"
        aria-label={card ? t("Estadísticas de la carta rival: {v}", { v: STAT_KEYS.map((k) => `${STAT_INFO[k].abbr} ${card.combat[k]}`).join(", ") }) : t("Carta rival oculta")}
        className={cn("flex items-center justify-center gap-1.5", className)}
      >
        {STAT_KEYS.map((k) => {
          const info = STAT_INFO[k];
          const on = stat === k;
          return (
            <span
              key={k}
              aria-hidden
              data-testid={`rival-stat-${info.abbr}`}
              className="nx-clip-sm flex min-w-[78px] items-baseline justify-between gap-2 border px-2 py-1"
              style={{ borderColor: on ? RIVAL : "rgba(255,46,99,0.35)", background: on ? "rgba(255,46,99,0.22)" : "rgba(40,6,18,0.7)" }}
            >
              <span className="font-display text-[15px] font-extrabold leading-none" style={{ color: info.color }}>{info.abbr}</span>
              <b className={cn("nx-readout text-[20px] leading-none tabular-nums", card ? "text-white" : "text-[#ff9db5]/60")}>{card ? card.combat[k] : "?"}</b>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="rival-stats"
      data-rival-state={state}
      role="group"
      aria-label={card ? t("Estadísticas de la carta rival: {v}", { v: STAT_KEYS.map((k) => `${STAT_INFO[k].abbr} ${card.combat[k]}`).join(", ") }) : t("Carta rival oculta")}
      className={cn(STAT_GRID, className)}
    >
      {STAT_KEYS.map((k) => {
        const info = STAT_INFO[k];
        const on = stat === k;
        return (
          <div
            key={k}
            aria-hidden
            data-testid={`rival-stat-${info.abbr}`}
            data-state={!card ? (on ? "declared-hidden" : "hidden") : on ? "declared" : "revealed"}
            className={cn(STAT_TERCIO, !card && "opacity-60", card && stat && !on && "opacity-55")}
            style={{
              borderColor: on ? RIVAL : "rgba(255,46,99,0.28)",
              boxShadow: on ? `0 0 28px ${RIVAL}55, inset 0 0 24px ${RIVAL}33` : undefined,
              background: on ? `linear-gradient(240deg, ${RIVAL}38, rgba(0,0,0,0.6) 62%)` : "linear-gradient(240deg, rgba(255,46,99,0.10), rgba(0,0,0,0.55) 60%)",
            }}
          >
            <span className={STAT_ABBR} style={{ color: info.color }}>{info.abbr}</span>
            <b className={cn(STAT_VALUE, card ? "text-white" : "text-[#ff9db5]/50")}>{card ? card.combat[k] : "?"}</b>
          </div>
        );
      })}
    </div>
  );
}
