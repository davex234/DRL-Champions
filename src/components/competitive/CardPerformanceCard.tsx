"use client";

/**
 * TUS CARTAS EN RANKED (Fase 28). Estadística PERSONAL sobre tus últimas partidas: la carta que
 * más has jugado y la que más turnos ha ganado. No es balance ni winrate global (dataset pequeño;
 * P2 documentado). Solo tus turnos, nunca los del rival.
 */
import { Plate } from "@/components/ui/Surface";
import type { CardPerformance } from "@/domain/pvpLadder/ladder";

export function CardPerformanceCard({ cards, className }: { cards: { mostUsed: CardPerformance | null; mostWinning: CardPerformance | null; sample: number }; className?: string }) {
  if (!cards.mostUsed) {
    return (
      <Plate className={`p-4 ${className ?? ""}`} data-cards="none">
        <span className="nx-label">Tus cartas en ranked</span>
        <p className="mt-1 text-caption text-ink-muted">Cuando juegues partidas ranked verás aquí qué cartas te funcionan.</p>
      </Plate>
    );
  }
  return (
    <Plate className={`p-4 ${className ?? ""}`} data-cards={cards.sample}>
      <span className="nx-label">Tus cartas en ranked <span className="text-white/35">· últimas {cards.sample} partidas</span></span>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <span className="nx-label block !text-white/45">Más usada</span>
          <b className="block font-display text-h3 font-bold uppercase text-white">{cards.mostUsed.nick}</b>
          <span className="text-caption text-ink-muted">{cards.mostUsed.played} turnos · {cards.mostUsed.turnsWon} ganados</span>
        </div>
        {cards.mostWinning && (
          <div>
            <span className="nx-label block !text-white/45">Más turnos ganados</span>
            <b className="block font-display text-h3 font-bold uppercase text-white">{cards.mostWinning.nick}</b>
            <span className="text-caption text-ink-muted">{cards.mostWinning.turnsWon} de {cards.mostWinning.played} turnos</span>
          </div>
        )}
      </div>
    </Plate>
  );
}
