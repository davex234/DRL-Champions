"use client";

/**
 * F71 · EL SELECTOR DE ESTADÍSTICA — F71.2: SOLO SIGLA Y CIFRA.
 *
 * Ofrece EXACTAMENTE lo que permiten las reglas, que llegan resueltas del servidor:
 *   · atacando → las tres estadísticas de combate (SH / GS / EF) con la cifra de la carta elegida;
 *   · defendiendo → las tres a la vista, la OBLIGADA (`view.requiredStat`) destacada y bloqueada, las otras dos
 *     apagadas (no son opciones).
 *
 * F71.2 · cada tercio es «SH 58» y nada más: sigla a un lado, cifra al otro, las dos enormes. Sin nombres largos
 * ni descripciones (siguen en el nombre accesible). La elegida lleva una marca ✓; la obligada, una etiqueta corta
 * «OBLIGADA». En `lg` es el lateral DERECHO (el tuyo, cian); el izquierdo es el del rival (`RivalStats`).
 *
 * Aquí no se calcula nada: la cifra es `card.combat[k]` tal cual viene en el DTO y la obligada es la que manda el
 * servidor. Tampoco se envía nada: elegir llama a `onSelect` y el tablero sigue con su cerrojo y su confirmar.
 *
 * CONTRATO CON LOS RECORRIDOS AUTOMÁTICOS. Los scripts de E2E buscan los botones de estadística por su texto
 * (`/^(SH|GS|EF)\s*\d+$/`) y SIN `aria-label`. Dentro del botón solo van la sigla y la cifra; la marca ✓ va en una
 * capa hermana (`aria-hidden`, `pointer-events-none`: el clic cae en el botón que cubre todo el tercio) y el nombre
 * accesible completo se da con `aria-labelledby`.
 */
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/format";
import { STAT_INFO, type CombatStatKey, type DuelDeckCardDTO } from "@/lib/duel/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export const STAT_KEYS: readonly CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

export interface StatSelectorProps {
  /** La carta elegida de la mano (o `null` si aún no hay). */
  card: DuelDeckCardDTO | null;
  attacking: boolean;
  /** Estadística declarada por el atacante (estado local del tablero). */
  stat: CombatStatKey | null;
  /** Estadística obligada al defender, tal cual la manda el servidor. */
  required: CombatStatKey | null;
  /** Cerrojo de la jugada (en vuelo o turno del rival). */
  locked: boolean;
  onSelect: (k: CombatStatKey) => void;
  className?: string;
}

/* Escala compartida por los dos laterales (tuyo y del rival): la misma jerarquía a los dos lados. */
export const STAT_ABBR = "font-display font-extrabold leading-none tracking-[0.04em] text-[clamp(20px,5.4vw,26px)] lg:text-[clamp(28px,min(3.3vw,5.4vh),56px)]";
export const STAT_VALUE = "nx-readout leading-none tabular-nums text-[clamp(26px,7vw,36px)] lg:text-[clamp(40px,min(4.6vw,9vh),88px)]";
export const STAT_TERCIO = "nx-clip-sm relative flex w-full items-center justify-between gap-2 border-2 px-3 min-h-[56px] lg:h-full lg:px-[clamp(12px,1.4vw,24px)]";
/** Tres filas iguales que llenan el lateral y pueden encoger; en estrecho, tres en fila. */
export const STAT_GRID = "grid grid-cols-3 gap-1.5 lg:min-h-0 lg:flex-1 lg:grid-cols-1 lg:grid-rows-[repeat(3,minmax(0,1fr))] lg:gap-2.5";

export function StatSelector({ card, attacking, stat, required, locked, onSelect, className }: StatSelectorProps) {
  useLocale();
  const uid = useId();
  const group = useRef<HTMLDivElement>(null);

  /* Flechas para moverse entre los tres bloques; Enter/Espacio los activa (son `<button>` de verdad). */
  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || !group.current) return;
    const btns = [...group.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + dir + btns.length) % btns.length]?.focus();
  }

  /* ─────────── DEFENDIENDO: las tres a la vista; la obligada destacada, las otras apagadas ─────────── */
  if (!attacking) {
    if (!required) return null;
    return (
      <div data-testid="stat-options-defense" data-layout="side" className={cn(STAT_GRID, !card && "hidden lg:grid", className)}>
        {STAT_KEYS.map((k) => {
          const info = STAT_INFO[k];
          const value = card ? card.combat[k] : null;
          if (k !== required) {
            return (
              <div
                key={k}
                aria-hidden
                data-testid={`stat-unavailable-${info.abbr}`}
                className={cn(STAT_TERCIO, "border-white/10 bg-black/40 opacity-35")}
              >
                <span className={STAT_ABBR} style={{ color: info.color }}>{info.abbr}</span>
                <span className={cn(STAT_VALUE, "text-white/60")}>{value ?? "—"}</span>
              </div>
            );
          }
          return (
            <div
              key={k}
              data-testid={`stat-option-${info.abbr}`}
              data-state="forced"
              role="group"
              aria-label={t("Estadística obligada: {label}{v}", { label: td(info.label), v: value !== null ? `, ${value}` : "" })}
              className={STAT_TERCIO}
              style={{ borderColor: info.color, boxShadow: `0 0 26px ${info.color}55, inset 0 0 22px ${info.color}33`, background: `linear-gradient(120deg, ${info.color}33, rgba(0,0,0,0.6) 62%)` }}
            >
              <span aria-hidden className="flex min-w-0 flex-col items-start gap-1.5">
                <span className={STAT_ABBR} style={{ color: info.color }}>{info.abbr}</span>
                <span
                  data-testid="stat-forced-tag"
                  className="inline-flex items-center gap-1 rounded-sm px-1.5 py-[1px] font-display text-[9px] font-extrabold uppercase tracking-[0.14em] text-black lg:text-[11px]"
                  style={{ background: info.color }}
                >
                  <LockGlyph /><span className="hidden xl:inline">{t("Obligada")}</span>
                </span>
              </span>
              <b aria-hidden className={cn(STAT_VALUE, "text-white")}>{value ?? "—"}</b>
            </div>
          );
        })}
      </div>
    );
  }

  /* ─────────── ATACANDO: las tres, «SH 58», a tercios del lateral ─────────── */
  return (
    <div
      ref={group}
      role="group"
      aria-label={t("¿Con qué peleas?")}
      data-testid="stat-options"
      data-layout="side"
      onKeyDown={onKey}
      className={cn(STAT_GRID, !card && "hidden lg:grid", className)}
    >
      {STAT_KEYS.map((k) => {
        const info = STAT_INFO[k];
        const on = stat === k;
        const dim = stat !== null && !on;
        const value = card ? card.combat[k] : null;
        const labelId = `${uid}-${info.abbr}`;
        return (
          <div key={k} className={cn("relative lg:h-full", dim && "opacity-55 transition-opacity duration-fast")}>
            <button
              type="button"
              data-testid={`stat-option-${info.abbr}`}
              data-state={on ? "selected" : "idle"}
              onClick={() => { if (!locked && card) onSelect(k); }}
              disabled={locked || !card}
              aria-pressed={on}
              aria-labelledby={labelId}
              title={`${info.label} · ${info.blurb}`}
              className={cn(
                STAT_TERCIO,
                "text-left transition duration-fast",
                "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white",
                "disabled:cursor-not-allowed disabled:opacity-45",
                on ? "bg-white/[0.12]" : "border-white/15 bg-black/55 enabled:hover:border-white/50 enabled:hover:bg-white/[0.07]",
              )}
              style={on
                ? { borderColor: info.color, boxShadow: `0 0 30px ${info.color}66, inset 0 0 26px ${info.color}33`, background: `linear-gradient(120deg, ${info.color}33, rgba(0,0,0,0.55) 65%)` }
                : { background: `linear-gradient(120deg, ${info.color}14, rgba(0,0,0,0.55) 60%)` }}
            >
              <span className={STAT_ABBR} style={{ color: info.color }}>{info.abbr}</span>
              <b className={cn(STAT_VALUE, "text-white")}>{value ?? "—"}</b>
            </button>
            {/* La marca de elegida: un ✓ en la esquina, fuera del texto del botón y lejos de la cifra. */}
            {on && (
              <span
                aria-hidden
                data-testid="stat-selected-badge"
                className="pointer-events-none absolute left-1/2 top-1 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full text-[12px] font-black leading-none text-black shadow lg:left-auto lg:right-2 lg:top-2 lg:h-7 lg:w-7 lg:translate-x-0 lg:text-[16px]"
                style={{ background: info.color }}
              >
                ✓
              </span>
            )}
            <span id={labelId} className="sr-only">
              {`${info.label} (${info.abbr})${value !== null ? `: ${value}` : ""}${on ? ", elegida" : ""}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="h-[1em] w-[1em]" fill="currentColor" aria-hidden>
      <path d="M3.5 5V3.8a2.5 2.5 0 0 1 5 0V5h.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h.5Zm1.2 0h2.6V3.8a1.3 1.3 0 0 0-2.6 0V5Z" />
    </svg>
  );
}
