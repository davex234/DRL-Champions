"use client";

/**
 * DETALLE DE UN TURNO ANTERIOR (Fase 33). Solo lectura: tu carta, la del rival (ya revelada al
 * jugarse), el eje de cada uno, las cifras, el resultado y su explicación. Un turno futuro o el que
 * está en juego no tienen detalle (`turnDetail` devuelve `null`).
 */
import { cn } from "@/lib/format";
import { STAT_INFO, type DuelDeckCardDTO, type DuelEncounterSideView, type DuelMatchView } from "@/lib/duel/types";
import { turnDetail } from "@/lib/duel/experience";
import { DuelCard } from "../DuelCard";
import { Sheet } from "../deck/bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

const TONE = { WIN: "#3fc07a", LOSS: "#ff2e63", DRAW: "#ffd35c" } as const;

export function TurnDetailSheet({
  view, turnNumber, rivalName, onClose,
}: {
  view: Pick<DuelMatchView, "history" | "yourUsed" | "yourHand" | "rivalUsed">;
  turnNumber: number | null;
  rivalName: string;
  onClose: () => void;
}) {
  useLocale();
  const d = turnNumber === null ? null : turnDetail(view, turnNumber);
  const tone = d?.explanation.result ? TONE[d.explanation.result] : "#c9cfdc";
  return (
    <Sheet
      open={d !== null}
      scene="turn-detail"
      eyebrow={d ? (d.turn.attacker === "A" ? t("Atacaste tú") : t("Atacó {rivalName}", { rivalName })) : undefined}
      title={d ? t("Turno {number}", { number: d.turn.number }) : t("Turno")}
      onClose={onClose}
    >
      {d && (
        <div data-testid="turn-detail" data-result={d.explanation.result ?? "UNKNOWN"} data-reason={d.explanation.reason}>
          <p className="font-display text-h2 font-bold uppercase tracking-wide" style={{ color: tone }}>{td(d.explanation.headline)}</p>
          <p className="mt-1 text-body text-ink-secondary">{td(d.explanation.text)}</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Side title={t("Tú")} card={d.yourCard} side={d.turn.you} won={d.explanation.result === "WIN"} />
            <Side title={rivalName} card={d.rivalCard} side={d.turn.rival} won={d.explanation.result === "LOSS"} />
          </div>
          <p className="mt-4 text-caption text-ink-muted">
            {t("Marcador tras el turno:")} <b className="nx-readout text-white">{d.turn.scoreAfterYou} – {d.turn.scoreAfterRival}</b>
          </p>
        </div>
      )}
    </Sheet>
  );
}

function Side({ title, card, side, won }: { title: string; card: DuelDeckCardDTO | null; side: DuelEncounterSideView; won: boolean }) {
  useLocale();
  const info = STAT_INFO[side.stat];
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl border p-3", won ? "border-ok/45 bg-ok/[0.06]" : "border-white/10 bg-white/[0.02]")}>
      <span className="nx-label">{td(title)}</span>
      {card ? <DuelCard card={card} size="sm" highlightStat={side.stat} /> : <span className="grid aspect-[5/7] w-[84px] place-items-center rounded-xl border border-dashed border-white/15 text-caption text-ink-faint">{side.nick}</span>}
      <span className="font-display text-[10px] font-extrabold uppercase tracking-[0.18em]" style={{ color: info.color }}>{td(info.label)}</span>
      <b className="nx-readout text-[30px] leading-none text-white">{side.value}</b>
      {won && <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ok">{t("Gana el turno")}</span>}
    </div>
  );
}
