"use client";

/**
 * HISTORIAL DE TURNOS (Fase 8).
 *
 * Lista compacta de lo ya jugado. Al abrir un turno se ve el enfrentamiento completo: las dos
 * cartas, las estadísticas declaradas y sus valores. Todo sale de `DuelTurnView`, que produce el
 * servidor a partir del audit trail del Combat Resolver.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import { STAT_INFO, type DuelTurnView } from "@/lib/duel/types";
import { turnLabel } from "./Scoreboard";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("duel");

const MARK: Record<DuelTurnView["outcome"], string> = { A: "✓", B: "✕", TIE: "=" };

export function TurnHistory({
  turns, className, emptyLabel = tr("Aún no se ha jugado ningún turno."),
  openTurn, onOpenTurn,
}: {
  turns: DuelTurnView[];
  className?: string;
  emptyLabel?: string;
  /** Turno abierto controlado desde fuera (repetición). Si no se pasa, se gestiona aquí. */
  openTurn?: number | null;
  onOpenTurn?: (n: number | null) => void;
}) {
  useLocale();
  const [internal, setInternal] = useState<number | null>(null);
  const controlled = openTurn !== undefined;
  const open = controlled ? openTurn : internal;
  const setOpen = (n: number | null) => (controlled ? onOpenTurn?.(n) : setInternal(n));

  if (turns.length === 0) {
    return <p className={cn("text-xs text-white/35", className)}>{td(emptyLabel)}</p>;
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {turns.map((t) => {
        const { text, tone } = turnLabel(t);
        const isOpen = open === t.number;
        return (
          <div key={t.number} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : t.number)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-drl"
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded font-display text-[11px] font-bold",
                  tone === "win" && "bg-emerald-400/20 text-emerald-300",
                  tone === "loss" && "bg-drl/20 text-drl-glow",
                  tone === "tie" && "bg-white/10 text-white/70",
                )}
                aria-hidden
              >
                {td(MARK[t.outcome])}
              </span>
              <span className="w-8 shrink-0 font-display text-[11px] font-bold text-white/45">T{t.number}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-white/70">
                {t.you.nick} <span style={{ color: STAT_INFO[t.you.stat].color }}>{t.you.value}</span>
                <span className="mx-1 text-white/25">{t.outcome === "A" ? "›" : t.outcome === "B" ? "‹" : "="}</span>
                <span style={{ color: STAT_INFO[t.rival.stat].color }}>{t.rival.value}</span> {t.rival.nick}
              </span>
              <span className="shrink-0 font-display text-[11px] font-bold tabular-nums text-white/55">
                {t.scoreAfterYou}–{t.scoreAfterRival}
              </span>
            </button>

            {isOpen && (
              <div className="grid grid-cols-2 gap-2 border-t border-white/10 bg-base-900/50 px-2.5 py-2 text-[11px]">
                <TurnSide label={tr("Tú")} side={t.you} won={t.outcome === "A"} />
                <TurnSide label={tr("Bot")} side={t.rival} won={t.outcome === "B"} align="right" />
                <p className="col-span-2 pt-1 text-[10px] text-white/40">
                  {t.attacker === "A" ? tr("Atacaste tú") : tr("Atacó el rival")} · {td(text)}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TurnSide({
  label, side, won, align = "left",
}: {
  label: string;
  side: DuelTurnView["you"];
  won: boolean;
  align?: "left" | "right";
}) {
  useLocale();
  const info = STAT_INFO[side.stat];
  return (
    <div className={cn(align === "right" && "text-right")}>
      <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">{td(label)}</span>
      <b className={cn("block truncate font-display text-sm", won ? "text-emerald-300" : "text-white/80")}>
        {side.nick}
      </b>
      <span className="text-[10px] text-white/45">{td(side.role)} · {side.team}</span>
      <div className={cn("mt-1 flex items-baseline gap-1.5", align === "right" && "justify-end")}>
        <span className="text-[10px] font-extrabold" style={{ color: info.color }}>{info.abbr}</span>
        <span className="font-display text-lg font-bold leading-none">{side.value}</span>
      </div>
    </div>
  );
}
