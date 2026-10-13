"use client";

/**
 * HUD DEL PARTIDO — la franja de estado, y la barra de acción.
 *
 * ────────────────────────── LA JERARQUÍA QUE FALTABA ──────────────────────────
 *
 * La pantalla del partido tenía muchos números y ningún orden entre ellos. El marcador, los
 * créditos, las bajas, la voz, los tiempos muertos, la velocidad y la ronda vivían en cajas
 * distintas, con el mismo tamaño y el mismo peso — y la acción principal, que es lo único
 * que hay que hacer, colgaba debajo de todo.
 *
 * Aquí solo hay dos piezas, y su reparto ES la jerarquía del encargo:
 *
 *   ESTADO   → `MatchHUD`, arriba, fijo. Ronda, marcador, lado. Nada más.
 *   ACCIÓN   → `PrimaryAction`, abajo, fijo. Una sola, grande, siempre visible.
 *
 * El contexto y las estadísticas van en medio, dentro del contenido, donde se consultan si
 * hacen falta. Lo que NO puede pasar es que una cifra de apoyo esté por delante de lo que
 * toca hacer.
 *
 * ────────────────────────── QUÉ NÚMEROS SE QUEDAN ARRIBA ──────────────────────────
 *
 * Tres, y se justifican solos:
 *
 *   · **Ronda** — dónde estás en el partido.
 *   · **Marcador** — quién va ganando. Es EL número; por eso es el más grande de la franja.
 *   · **Lado** — atacas o defiendes. Cambia lo que significa todo lo demás.
 *
 * Fuera de la franja se quedan créditos, bajas, ADR, momentum y velocidad: siguen existiendo
 * en sus paneles, pero dejan de competir con el marcador.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

export interface MatchHUDProps {
  /** Número de ronda en curso. */
  round: number;
  score: { home: number; away: number };
  teams: { home: string; away: string };
  /** Lado del jugador en esta mitad. */
  side: "ATK" | "DEF";
  /** Nombre del mapa. El real: el que dice el partido, no uno elegido para decorar. */
  map: string;
  /** Rótulo del estado actual: «Sala táctica», «Fase de compra», «En vivo»… */
  state: string;
  /** Controles discretos a la derecha (pausa, velocidad, timeout). */
  aside?: ReactNode;
}

const SIDE_LABEL = { ATK: "Ataque", DEF: "Defensa" } as const;

export function MatchHUD({ round, score, teams, side, map, state, aside }: MatchHUDProps) {
  useLocale();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4">
      {/* ── Izquierda: dónde estás ── */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "nx-clip-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.22em]",
            side === "ATK" ? "bg-drl/20 text-drl-glow" : "bg-cyan-400/15 text-cyan-200",
          )}
        >
          {td(SIDE_LABEL[side])}
        </span>
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          {t("Ronda")} <b className="nx-readout text-[13px] text-white">{round}</b>
        </span>
      </div>

      {/*
        ── Centro: EL número ──
        El marcador es lo único que se pinta a tamaño de titular en toda la franja. Que sea
        el mayor no es estética: es la respuesta a «¿voy ganando?», que es la pregunta que
        el entrenador se hace cada treinta segundos.
      */}
      <div className="order-last flex w-full items-center justify-center gap-3 sm:order-none sm:w-auto sm:flex-1">
        <span className="min-w-0 flex-1 truncate text-right font-display text-[12px] font-bold uppercase tracking-wide text-white/75 sm:flex-none sm:max-w-[180px]">
          {td(teams.home)}
        </span>
        <span className="nx-readout shrink-0 text-[26px] leading-none text-white sm:text-[30px]">
          {score.home}
          <span className="mx-1.5 text-ink-faint">–</span>
          {score.away}
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[12px] font-bold uppercase tracking-wide text-white/50 sm:flex-none sm:max-w-[180px]">
          {td(teams.away)}
        </span>
      </div>

      {/* ── Derecha: contexto y mandos ── */}
      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden font-display text-[10px] uppercase tracking-[0.22em] text-ink-faint md:inline">
          {td(map)}
        </span>
        <span className="nx-clip-sm bg-white/6 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
          {td(state)}
        </span>
        {aside}
      </div>
    </div>
  );
}

export interface PrimaryActionProps {
  /** Qué toca hacer. En imperativo y corto: es una orden, no una descripción. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Una línea de apoyo. Explica la consecuencia, no repite el rótulo. */
  hint?: string;
  /** `go` para avanzar, `calm` para un paso neutro. */
  tone?: "go" | "calm";
  /** Acción alternativa, si existe DE VERDAD. No se inventa una para llenar el hueco. */
  secondary?: { label: string; onClick: () => void };
}

/**
 * LA BARRA DE ACCIÓN — siempre al pie, siempre visible, siempre una sola cosa.
 *
 * Está anclada al escenario, no al final del documento: da igual cuánto contenido haya en
 * medio, lo que toca hacer no se va de la pantalla. Ese anclaje es toda la corrección del
 * problema que traía el encargo —«tengo que bajar para encontrar el botón»—.
 */
export function PrimaryAction({
  label, onClick, disabled, hint, tone = "go", secondary,
}: PrimaryActionProps) {
  useLocale();
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4">
      {hint && (
        <p className="order-last w-full text-caption text-ink-muted sm:order-none sm:w-auto sm:flex-1">
          {td(hint)}
        </p>
      )}
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="nx-focus nx-clip-sm min-h-[44px] border border-white/15 px-5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/8"
        >
          {td(secondary.label)}
        </button>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "nx-focus nx-clip-sm min-h-[52px] flex-1 px-7 font-display text-[15px] font-bold uppercase tracking-[0.14em] transition duration-fast sm:flex-none sm:min-w-[260px]",
          tone === "go"
            ? "bg-drl text-white shadow-glow enabled:hover:brightness-110"
            : "border border-white/20 text-white enabled:hover:bg-white/10",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        {td(label)}
      </button>
    </div>
  );
}
