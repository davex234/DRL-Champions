"use client";

/**
 * TU EQUIPO VS RIVAL (Fase 33) — la entrada a la partida.
 *
 * Tu equipo se ve: tres cartas protagonistas (las de mayor OVR) y el resto en tira ligera; nada de diez
 * cartas pesadas. El rival NUNCA: en PvE el servidor elige su mazo al empezar, y en PvP el emparejamiento
 * lo decide el rating. Se enseñan diez reversos y, si existe, su identidad pública. No se pide ningún
 * dato más para esto.
 *
 * `compact`: una sola fila para hojas estrechas (el reto privado): tres cartas, VS y los reversos.
 */
import { cn } from "@/lib/format";
import { DUEL_DECK_SIZE } from "@/domain/cardgame";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { DuelCard, DuelCardBack } from "../DuelCard";

export type VersusRival =
  | { kind: "BOT"; label: string }
  | { kind: "RANKED" }
  | { kind: "PRIVATE"; username: string; avatar: string };

export function PreMatchVersus({ deck, rival, className, compact = false }: { deck: DuelDeckDTO; rival: VersusRival; className?: string; compact?: boolean }) {
  const top = [...deck.cards].sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick)).slice(0, 3);
  const topIds = new Set(top.map((c) => c.uid));
  const rest = deck.cards.filter((c) => !topIds.has(c.uid));
  const rivalTitle = rival.kind === "BOT" ? `Bot · ${rival.label}` : rival.kind === "RANKED" ? "Rival por rating" : rival.username;
  const rivalHint = rival.kind === "BOT"
    ? "Su equipo se revela carta a carta, turno a turno."
    : rival.kind === "RANKED"
      ? "El servidor lo elige al emparejar. Su equipo sigue oculto."
      : "Su equipo sigue oculto hasta que juegue cada carta.";

  if (compact) {
    return (
      <section aria-label="Tu equipo contra el rival" data-testid="prematch-versus" data-rival={rival.kind} data-compact="true" className={cn("nx-clip-sm relative overflow-hidden border border-white/10 bg-white/[0.03] p-3", className)}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="min-w-0">
            <span className="nx-label !text-ok/80">Tu equipo</span>
            <b className="block truncate font-display text-[13px] font-bold uppercase text-white">{deck.name}</b>
            <div className="mt-1.5 flex gap-1">
              {top.map((c) => <DuelCard key={c.uid} card={c} size="xs" className="!w-[clamp(34px,11vw,46px)]" />)}
            </div>
          </div>
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full font-display text-[12px] font-bold text-white" style={{ background: "radial-gradient(circle at 50% 35%, rgba(255,46,99,0.4), rgba(0,0,0,0.75) 70%)", boxShadow: "inset 0 0 0 1.5px rgba(255,46,99,0.8)" }}>
            VS
          </span>
          <div className="min-w-0 text-right">
            <span className="nx-label !text-drl/80">Rival</span>
            <b className="block truncate font-display text-[13px] font-bold uppercase text-white">
              {rival.kind === "PRIVATE" && <span aria-hidden className="mr-1">{rival.avatar}</span>}
              {rivalTitle}
            </b>
            <div className="mt-1.5 flex justify-end gap-0.5" aria-label={`Equipo rival: ${DUEL_DECK_SIZE} cartas ocultas`}>
              {Array.from({ length: DUEL_DECK_SIZE }, (_, i) => (
                <span key={i} className="w-[clamp(10px,3vw,14px)]"><DuelCardBack size="xs" className="!w-full" /></span>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">{rivalHint}</p>
      </section>
    );
  }

  return (
    <section aria-label="Tu equipo contra el rival" data-testid="prematch-versus" data-rival={rival.kind} className={cn("nx-stage nx-clip relative overflow-hidden p-4 sm:p-5", className)}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(60% 90% at 50% 50%, rgba(255,46,99,0.12), transparent 70%)" }} />
      <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <span className="nx-label !text-ok/80">Tu equipo</span>
          <b className="block truncate font-display text-h2 font-bold uppercase text-white">{deck.name}</b>
          <div className="mt-2 flex items-end gap-2">
            {top.map((c) => <DuelCard key={c.uid} card={c} size="md" className="!w-[clamp(72px,18vw,108px)]" />)}
          </div>
          {rest.length > 0 && (
            <div className="mt-2 flex gap-1" aria-label="Resto del equipo">
              {rest.map((c) => <span key={c.uid} className="min-w-0 max-w-[44px] flex-1"><DuelCard card={c} size="xs" className="!w-full" /></span>)}
            </div>
          )}
        </div>
        <span
          aria-hidden
          className="mx-auto grid h-14 w-14 place-items-center rounded-full font-display text-lg font-bold text-white"
          style={{ background: "radial-gradient(circle at 50% 35%, rgba(255,46,99,0.4), rgba(0,0,0,0.75) 70%)", boxShadow: "0 0 30px -6px rgba(255,46,99,0.9), inset 0 0 0 2px rgba(255,46,99,0.8)" }}
        >
          VS
        </span>
        <div className="min-w-0 md:text-right">
          <span className="nx-label !text-drl/80">Rival</span>
          <b className="block truncate font-display text-h2 font-bold uppercase text-white">
            {rival.kind === "PRIVATE" && <span aria-hidden className="mr-1">{rival.avatar}</span>}
            {rivalTitle}
          </b>
          <div className="mt-2 flex gap-1 md:justify-end" aria-label={`Equipo rival: ${DUEL_DECK_SIZE} cartas ocultas`}>
            {Array.from({ length: DUEL_DECK_SIZE }, (_, i) => (
              <span key={i} className="w-[clamp(22px,5vw,34px)]"><DuelCardBack size="xs" className="!w-full" /></span>
            ))}
          </div>
          <p className="mt-2 text-caption text-ink-muted">{rivalHint}</p>
        </div>
      </div>
    </section>
  );
}
