"use client";

/**
 * EL TABLERO DEL EQUIPO (Fase 32). Diez huecos agrupados por rol, sacados de la composición canónica
 * (`DUEL_ROLES` × `DUEL_COMPOSITION`): nunca un «2» escrito a mano.
 *
 * Cada hueco es UN botón con nombre propio («Centinela 2: vacío…», «Duelista 1: Kaelis, OVR 84…») y tres
 * estados: EMPTY, FILLED, INVALID (con el motivo pegado debajo y asociado con `aria-describedby`).
 * Teclado: Enter abre el hueco; Supr/Retroceso quita la carta; Alt+↑/↓ la mueve dentro de su rol.
 * El resaltado de compatibilidad sale de `compatibleSlots`: un hueco donde el validador la rechazaría
 * no se ilumina nunca.
 */
import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame";
import type { Board, BoardSlot } from "@/domain/deckBuilder/builder";
import { DuelCard } from "../DuelCard";
import { ROLE_GLYPH } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export interface TeamBoardProps {
  board: Board;
  selectedSlot: string | null;
  /** Huecos donde la carta elegida puede entrar: añadir o sustituir. */
  fits: ReadonlyMap<string, "add" | "replace">;
  /** Cartas que el autocompletado SÍ puede cambiar (el resto se respeta). */
  released: ReadonlySet<string>;
  /** Carta recién colocada (animación de entrada). */
  freshUid: string | null;
  onSlot: (slot: BoardSlot) => void;
  onRemove: (slot: BoardSlot) => void;
  onMove: (slot: BoardSlot, dir: -1 | 1) => void;
}

export function TeamBoard({ board, selectedSlot, fits, released, freshUid, onSlot, onRemove, onMove }: TeamBoardProps) {
  useLocale();
  return (
    <div className="grid gap-2.5 lg:grid-cols-5 lg:gap-3" role="list" aria-label={t("Tu equipo por roles")} data-testid="team-board">
      {DUEL_ROLES.map((role) => {
        const slots = board.byRole[role];
        const filled = slots.filter((s) => s.uid).length;
        const need = DUEL_COMPOSITION[role];
        const complete = filled === need && slots.every((s) => s.state === "FILLED");
        return (
          <section
            key={role}
            role="listitem"
            aria-label={t("{role}: {filled} de {need}", { role: td(role), filled, need })}
            data-role={role}
            className={cn(
              "nx-clip-sm flex items-center gap-3 border p-2.5 transition-colors lg:flex-col lg:items-stretch lg:p-3",
              complete ? "border-ok/30 bg-ok/[0.04]" : "border-white/10 bg-white/[0.025]",
            )}
          >
            {/* F69 · a 1024 las cinco columnas son estrechas: el rol partía la palabra («CONTRO/LADOR»); ahora baja el recuento, no la palabra. */}
            <header className="flex w-[86px] shrink-0 flex-col gap-1 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-2">
              <span className="font-display text-[10.5px] font-bold uppercase leading-tight tracking-[0.02em] text-white [overflow-wrap:anywhere] sm:text-[12px] sm:tracking-[0.12em] lg:text-[10.5px] lg:tracking-[0.02em] xl:text-[12px] xl:tracking-[0.08em]">
                <span aria-hidden className="mr-1 text-drl-cyan">{td(ROLE_GLYPH[role])}</span>
                {td(role)}
              </span>
              <span className={cn("nx-readout text-[12px] tabular-nums", complete ? "text-ok" : "text-white/50")}>
                {filled}/{need}
              </span>
            </header>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-2.5">
              {slots.map((slot) => (
                <SlotTile
                  key={slot.key}
                  slot={slot}
                  selected={selectedSlot === slot.key}
                  fit={fits.get(slot.key) ?? null}
                  released={!!slot.uid && released.has(slot.uid)}
                  fresh={!!slot.uid && slot.uid === freshUid}
                  onSlot={onSlot}
                  onRemove={onRemove}
                  onMove={onMove}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SlotTile({
  slot, selected, fit, released, fresh, onSlot, onRemove, onMove,
}: {
  slot: BoardSlot;
  selected: boolean;
  fit: "add" | "replace" | null;
  released: boolean;
  fresh: boolean;
  onSlot: (slot: BoardSlot) => void;
  onRemove: (slot: BoardSlot) => void;
  onMove: (slot: BoardSlot, dir: -1 | 1) => void;
}) {
  useLocale();
  const issueId = useId();
  const card = slot.card;
  const label = card
    ? t("{label}: {nick}, OVR {ovr}{problem}{action}", { label: td(slot.label), nick: card.nick, ovr: card.ovr, problem: slot.state === "INVALID" ? t(". Problema: {issue}", { issue: td(slot.issue) }) : "", action: fit === "replace" ? t(". Pulsa para sustituirla por la carta elegida") : t(". Pulsa para cambiar, comparar o quitar") })
    : t("{label}: vacío. {v}", { label: td(slot.label), v: fit === "add" ? t("Pulsa para colocar aquí la carta elegida") : t("Pulsa para elegir carta") });

  return (
    <div className="min-w-0" data-slot={slot.key} data-state={slot.state} data-fit={fit ?? "none"}>
      <button
        type="button"
        aria-label={td(label)}
        aria-pressed={selected}
        aria-describedby={slot.issue ? issueId : undefined}
        onClick={() => onSlot(slot)}
        onKeyDown={(e) => {
          if (!slot.uid) return;
          if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(slot); }
          else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); onMove(slot, -1); }
          else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); onMove(slot, 1); }
        }}
        className={cn(
          "nx-focus relative mx-auto block w-full max-w-[150px] rounded-xl text-left transition duration-fast",
          fit === "add" && "ring-2 ring-drl-cyan ring-offset-2 ring-offset-base-900 shadow-[0_0_24px_rgba(63,210,255,0.35)]",
          fit === "replace" && "ring-2 ring-drl-gold ring-offset-2 ring-offset-base-900",
          !fit && selected && "ring-2 ring-white/80 ring-offset-2 ring-offset-base-900",
          !fit && slot.state === "INVALID" && "ring-2 ring-bad ring-offset-2 ring-offset-base-900",
        )}
      >
        {card ? (
          <motion.div
            key={slot.uid}
            initial={fresh ? { scale: 0.86, opacity: 0.35 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
          >
            <DuelCard card={card} size="sm" className="!w-full" />
          </motion.div>
        ) : (
          <span
            className={cn(
              "flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-1 text-center",
              fit === "add" ? "border-drl-cyan/80 bg-drl-cyan/[0.08]" : "border-white/15 bg-black/25",
            )}
          >
            <span aria-hidden className={cn("font-display text-2xl leading-none", fit === "add" ? "text-drl-cyan" : "text-white/25")}>+</span>
            <span className="nx-label !text-[9px] leading-tight">{fit === "add" ? t("Colocar aquí") : td(slot.role)}</span>
          </span>
        )}
        {slot.state === "INVALID" && (
          <span aria-hidden className="absolute -right-1 -top-1 z-20 grid h-6 w-6 place-items-center rounded-full bg-bad font-display text-[13px] font-bold text-white">!</span>
        )}
        {card && released && (
          <span className="absolute -left-1 -top-1 z-20 rounded bg-drl-gold px-1 text-[9px] font-bold uppercase text-black">{t("Libre")}</span>
        )}
        {fit === "replace" && (
          <span className="absolute inset-x-1 bottom-1 z-20 rounded bg-drl-gold/90 px-1 text-center text-[9px] font-bold uppercase text-black">{t("Sustituir")}</span>
        )}
      </button>
      {slot.issue && <p id={issueId} className="mx-auto mt-1 line-clamp-3 max-w-[150px] text-[10.5px] leading-snug text-bad">{td(slot.issue)}</p>}
    </div>
  );
}
